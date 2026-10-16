-- 🚗 Vehicle Rental (cars only): the customer books with pickup, drop, date, time, trip type and car type; only
-- car partners (agent type car_rental_agent, with a subscription) get these bookings. They call the customer and
-- agree the price directly — we never show a price. Re-runnable. Runs after events.sql.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS trip_details JSONB;

CREATE OR REPLACE FUNCTION fn_is_trip_service(p_service_id INT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT EXISTS (SELECT 1 FROM services s JOIN categories c ON c.id = s.category_id WHERE s.id = p_service_id AND c.slug = 'vehicle-rental')
$$;

-- What customers choose from on the booking form.
CREATE OR REPLACE FUNCTION fn_trip_options() RETURNS JSONB
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'trip_types', jsonb_build_array('Local (within city)', 'One way', 'Round trip', 'Airport', 'Railway / Bus station',
                                    'Wedding / Function', 'Temple / Tour'),
    'car_types', jsonb_build_array('Any car', 'Hatchback (4 seats)', 'Sedan (4 seats)', 'SUV / MUV (6-7 seats)'))
$$;

-- Checks the booking form and returns it cleaned up:
-- {trip_type, drop, trip_date, trip_time, return_date, passengers, car_type, details, label}
-- trip_date YYYY-MM-DD (today … 6 months ahead), trip_time HH:MM, return_date (round trip, optional) on/after trip_date.
CREATE OR REPLACE FUNCTION fn_check_trip(p JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  o JSONB := fn_trip_options();
  v_type TEXT := trim(coalesce(p->>'trip_type', ''));
  v_car TEXT := coalesce(nullif(trim(coalesce(p->>'car_type', '')), ''), 'Any car');
  v_drop TEXT := left(trim(regexp_replace(coalesce(p->>'drop', ''), '\s+', ' ', 'g')), 200);
  v_date DATE;
  v_time TIME;
  v_return DATE;
  v_pax INT;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Tell us where to go, the date and the time' USING ERRCODE = '22023';
  END IF;
  IF NOT (o->'trip_types' ? v_type) THEN
    RAISE EXCEPTION 'Choose the type of trip' USING ERRCODE = '22023';
  END IF;
  IF NOT (o->'car_types' ? v_car) THEN
    RAISE EXCEPTION 'Choose the type of car' USING ERRCODE = '22023';
  END IF;
  IF length(v_drop) < 2 THEN
    RAISE EXCEPTION 'Tell us where to go (drop place)' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p->>'trip_date', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Choose the travel date' USING ERRCODE = '22023';
  END IF;
  v_date := (p->>'trip_date')::date;
  IF v_date < v_today OR v_date > v_today + 183 THEN
    RAISE EXCEPTION 'The travel date must be from today up to 6 months ahead' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p->>'trip_time', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' THEN
    RAISE EXCEPTION 'Choose the pickup time' USING ERRCODE = '22023';
  END IF;
  v_time := (p->>'trip_time')::time;
  IF v_date = v_today AND v_time < (now() AT TIME ZONE 'Asia/Kolkata')::time THEN
    RAISE EXCEPTION 'That time has already passed today' USING ERRCODE = '22023';
  END IF;
  IF v_type = 'Round trip' AND coalesce(p->>'return_date', '') <> '' THEN
    IF p->>'return_date' !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'Choose the return date (or leave it empty)' USING ERRCODE = '22023';
    END IF;
    v_return := (p->>'return_date')::date;
    IF v_return < v_date OR v_return > v_date + 60 THEN
      RAISE EXCEPTION 'The return date must be on or after the travel date (up to 60 days)' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF coalesce(p->>'passengers', '') <> '' THEN
    IF p->>'passengers' !~ '^\d{1,2}$' OR (p->>'passengers')::int NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'Passengers must be 1 to 20 (or leave it empty)' USING ERRCODE = '22023';
    END IF;
    v_pax := (p->>'passengers')::int;
  END IF;
  RETURN jsonb_build_object(
    'trip_type', v_type, 'drop', v_drop, 'trip_date', v_date, 'trip_time', to_char(v_time, 'HH24:MI'),
    'return_date', v_return, 'passengers', v_pax, 'car_type', v_car,
    'details', nullif(left(trim(regexp_replace(coalesce(p->>'details', ''), '\s+', ' ', 'g')), 400), ''),
    -- shown as the booking time everywhere: "Sat 12 Dec 2026, 6:30 AM"
    'label', to_char(v_date, 'Dy DD Mon YYYY') || ', ' || ltrim(to_char(v_time, 'HH12:MI AM'), '0'),
    'return_label', CASE WHEN v_return IS NOT NULL THEN to_char(v_return, 'Dy DD Mon YYYY') END);
END $$;

-- "Book again" (after a partner cancelled, or to change the details): the customer places a new booking and the
-- earlier one — still waiting for a partner — is cancelled in the same step, so there are never two.
CREATE OR REPLACE PROCEDURE sp_rebook_cancel(p_old_id INT, p_customer_id INT, p_new_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v orders;
BEGIN
  SELECT * INTO v FROM orders WHERE id = p_old_id AND customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.status <> 'placed' THEN
    RAISE EXCEPTION 'Booking #% already has a partner — it can''t be booked again', p_old_id USING ERRCODE = '55000';
  END IF;
  CALL sp_cancel_order(p_old_id, p_customer_id, false, 'Booked again as #' || p_new_id);
END $$;

-- Car partners drive a car: 'car' is a vehicle type (older databases had the list without it).
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_vehicle_type_check;
ALTER TABLE agents ADD CONSTRAINT agents_vehicle_type_check CHECK (vehicle_type IN ('bike', 'scooter', 'bicycle', 'auto', 'van', 'car'));
