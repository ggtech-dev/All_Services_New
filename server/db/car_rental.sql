-- 🚗 Car Rental by car model (2026-10-26): the customer picks the exact car on photo cards (Swift, Dzire, Ertiga,
-- Innova…) and only partners whose car of that model was approved by the franchise admin see the booking — the first
-- to accept takes it, then they call each other and agree the price (we never show a price). Nobody free? The
-- customer can ask every car with as many seats. "Any car" bookings go to every car partner, as before.
-- The partners' cars are shared_cars (same papers and approval as Share Ride). Runs after share_ride.sql.

ALTER TABLE car_models ADD COLUMN IF NOT EXISTS image_url TEXT; -- our own AI photo of the model (customer cards)

-- 🚗 Swift (hatchback, 4 passengers) — the other models are in share_ride.sql
INSERT INTO car_models (name, layout)
SELECT 'Maruti Swift (4 passengers)', '[{"name": "Front", "cells": "S_D"}, {"name": "Back", "cells": "SSS"}]'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM car_models WHERE name ILIKE 'Maruti Swift (%');

-- passenger seats of a model (its seat layout, driver not counted)
CREATE OR REPLACE FUNCTION fn_model_seats(p_model_id INT) RETURNS INT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT count(*)::int FROM car_models m CROSS JOIN LATERAL fn_layout_seats(m.layout) s WHERE m.id = p_model_id
$$;

-- cars of the same size, for "ask all cars with as many seats": 4 seats · 6–7 seats · 12 seats
CREATE OR REPLACE FUNCTION fn_seat_group(p_seats INT) RETURNS INT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_seats IS NULL THEN NULL WHEN p_seats <= 4 THEN 4 WHEN p_seats <= 8 THEN 7 ELSE 12 END
$$;

-- "Maruti Ertiga (6 passengers)" → "Maruti Ertiga"
CREATE OR REPLACE FUNCTION fn_model_short(p_name TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(coalesce(p_name, ''), '\s*\(.*\)\s*$', '')
$$;

-- What customers choose from on the booking form: trip types, and the car cards (small → big).
CREATE OR REPLACE FUNCTION fn_trip_options() RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object(
    'trip_types', jsonb_build_array('Local (within city)', 'One way', 'Round trip', 'Airport', 'Railway / Bus station',
                                    'Wedding / Function', 'Temple / Tour'),
    'car_types', jsonb_build_array('Any car'),
    'cars', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'name', fn_model_short(m.name), 'seats', fn_model_seats(m.id),
                                                          'image_url', m.image_url) ORDER BY fn_model_seats(m.id), m.name)
                        FROM car_models m WHERE m.is_active), '[]'::jsonb))
$$;

-- The car part of a booking form (called by fn_check_trip): a chosen model → {car_type, car_model_id, car_seats};
-- no model → {car_type} ("Any car", or the size text of bookings made before car cards existed).
CREATE OR REPLACE FUNCTION fn_trip_car(p JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  m car_models;
  v_car TEXT := coalesce(nullif(trim(coalesce(p->>'car_type', '')), ''), 'Any car');
BEGIN
  IF coalesce(p->>'car_model_id', '') = '' THEN
    IF v_car NOT IN ('Any car', 'Hatchback (4 seats)', 'Sedan (4 seats)', 'SUV / MUV (6-7 seats)') THEN
      RAISE EXCEPTION 'Choose the car' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('car_type', v_car);
  END IF;
  IF p->>'car_model_id' !~ '^\d{1,9}$' THEN
    RAISE EXCEPTION 'Choose the car' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM car_models WHERE id = (p->>'car_model_id')::int AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That car is not available any more — please choose another' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('car_type', fn_model_short(m.name), 'car_model_id', m.id, 'car_seats', fn_model_seats(m.id));
END $$;

-- May this partner take this booking (car part)? No car chosen → yes. A model chosen → the partner has an approved
-- car of that model, or — after the customer asked all cars of that size — any approved car with as many seats.
CREATE OR REPLACE FUNCTION fn_trip_car_ok(p_agent_id INT, p_order_id INT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  t JSONB;
BEGIN
  SELECT trip_details INTO t FROM orders WHERE id = p_order_id;
  IF t IS NULL OR coalesce(t->>'car_model_id', '') = '' THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM shared_cars c
     WHERE c.owner_id = p_agent_id AND c.status = 'approved'
       AND (c.model_id = (t->>'car_model_id')::int
            OR (coalesce((t->>'any_size')::boolean, false)
                AND fn_seat_group(fn_model_seats(c.model_id)) = fn_seat_group((t->>'car_seats')::int))));
END $$;

-- Who may take an order (same as subscriptions.sql, plus the car rule above). Replaces that version: this file runs
-- later, when shared_cars exists.
CREATE OR REPLACE FUNCTION fn_agent_may_take(p_agent_id INT, p_order_id INT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT (SELECT a.franchise_id FROM agents a WHERE a.user_id = p_agent_id)
           IS NOT DISTINCT FROM (SELECT o.franchise_id FROM orders o WHERE o.id = p_order_id)
     AND NOT EXISTS (SELECT 1 FROM unnest(fn_order_services(p_order_id)) sid
                      WHERE (fn_sub_terms((SELECT o.franchise_id FROM orders o WHERE o.id = p_order_id), sid)).required
                        AND NOT fn_subscription_active(p_agent_id, sid))
     AND fn_trip_car_ok(p_agent_id, p_order_id)
$$;

-- The customer: "No Ertiga free? Ask all 6–7 seater cars" (only while nobody has taken the booking).
CREATE OR REPLACE FUNCTION fn_trip_any_size(p_order_id INT, p_customer_id INT) RETURNS orders
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v orders;
BEGIN
  SELECT * INTO v FROM orders WHERE id = p_order_id AND customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.trip_details IS NULL OR coalesce(v.trip_details->>'car_model_id', '') = '' THEN
    RAISE EXCEPTION 'This booking already goes to every car partner' USING ERRCODE = '22023';
  END IF;
  IF v.status <> 'placed' THEN
    RAISE EXCEPTION 'A partner has already taken this booking' USING ERRCODE = '55000';
  END IF;
  UPDATE orders SET trip_details = trip_details || jsonb_build_object('any_size', true) WHERE id = v.id RETURNING * INTO v;
  RETURN v;
END $$;

-- The car coming for a taken booking: the partner's approved car of the chosen model (else one of the same size, else
-- their first approved car) — model, number, colour and the model's photo. NULL when nobody has taken it.
CREATE OR REPLACE FUNCTION fn_trip_car_of(p_order_id INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object('model', fn_model_short(m.name), 'seats', fn_model_seats(m.id), 'reg_number', c.reg_number,
                            'color', c.color, 'image_url', m.image_url)
    FROM orders o
    JOIN shared_cars c ON c.owner_id = o.agent_id AND c.status = 'approved'
    JOIN car_models m ON m.id = c.model_id
   WHERE o.id = p_order_id AND o.trip_details IS NOT NULL AND o.agent_id IS NOT NULL
   ORDER BY (c.model_id::text = o.trip_details->>'car_model_id') DESC,
            (fn_seat_group(fn_model_seats(m.id)) = fn_seat_group((o.trip_details->>'car_seats')::int)) DESC, c.id
   LIMIT 1
$$;
