-- 🚗 Share Ride (2026-10-19). Re-runnable. Runs after subscriptions.sql and franchise.sql.
-- Car owners (agent type shared_car_agent) list journeys between towns (Siddipet → Hyderabad…) with their own price per
-- seat row; customers pick seats on the real seat map of that car model and pay the OWNER directly (UPI) — or cash at
-- pickup when the owner allows it. All Services never takes the money.
--  · A car is listed only when: the car is approved by the franchise admin (documents: RC, permit, insurance — commercial
--    yellow-board cars only), the owner is an active agent, and the owner's Share Ride subscription is active.
--  · UPI booking: seats are held 15 minutes → the customer pays and types the UPI reference → the owner taps
--    "Payment received" → booking confirmed → PDF ticket. "Not received" frees the seats.
--  · No cancellation and no refund by the customer after payment (shown before booking). If the OWNER cancels the
--    journey, every booking is cancelled and the owner must return the money.

-- ============ car models and their seat layouts ============
-- layout: [{ "name": "Front", "cells": "S_D" }, { "name": "Back", "cells": "SSS" }]  — rows from front to back;
-- in cells: S = passenger seat, D = driver, _ = gap / aisle. Seat code = "<row>-<column>" (1-based), e.g. "2-3".
CREATE TABLE IF NOT EXISTS car_models (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(60) NOT NULL,
  layout      JSONB NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS car_models_name_unique ON car_models (lower(name));

-- Towns a journey can start or end in (franchise admins add more).
CREATE TABLE IF NOT EXISTS share_places (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(60) NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS share_places_name_unique ON share_places (lower(name));

CREATE TABLE IF NOT EXISTS shared_cars (
  id            SERIAL PRIMARY KEY,
  owner_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  franchise_id  INT REFERENCES franchises(id),
  model_id      INT NOT NULL REFERENCES car_models(id),
  reg_number    VARCHAR(16) NOT NULL,
  color         VARCHAR(30),
  rc_doc        TEXT,            -- files in server/private_uploads (admins only)
  permit_doc    TEXT,
  insurance_doc TEXT,
  car_photo     TEXT,
  status        VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  status_reason VARCHAR(300),
  reviewed_by   INT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shared_cars_reg_unique ON shared_cars (upper(reg_number)) WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS shared_cars_owner_idx ON shared_cars (owner_id);

CREATE TABLE IF NOT EXISTS share_rides (
  id            SERIAL PRIMARY KEY,
  car_id        INT NOT NULL REFERENCES shared_cars(id),
  owner_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  franchise_id  INT REFERENCES franchises(id),
  from_place    VARCHAR(60) NOT NULL,
  to_place      VARCHAR(60) NOT NULL,
  depart_at     TIMESTAMPTZ NOT NULL,
  pickup_points TEXT[] NOT NULL,
  drop_points   TEXT[] NOT NULL,
  layout        JSONB NOT NULL,            -- the model's layout when listed (later model edits never move booked seats)
  row_prices    NUMERIC(10,2)[] NOT NULL,  -- price per seat for each layout row (same order)
  blocked_seats TEXT[] NOT NULL DEFAULT '{}',
  upi_id        VARCHAR(60),
  allow_cash    BOOLEAN NOT NULL DEFAULT false,
  notes         VARCHAR(300),
  status        VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
  cancel_reason VARCHAR(300),
  cancelled_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS share_rides_search_idx ON share_rides (lower(from_place), lower(to_place), depart_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS share_rides_owner_idx ON share_rides (owner_id, depart_at DESC);

CREATE SEQUENCE IF NOT EXISTS ride_booking_code_seq START 100001;
CREATE TABLE IF NOT EXISTS ride_bookings (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(12) NOT NULL UNIQUE DEFAULT ('SR-' || nextval('ride_booking_code_seq')),
  ride_id       INT NOT NULL REFERENCES share_rides(id) ON DELETE CASCADE,
  customer_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seats         TEXT[] NOT NULL,
  passengers    JSONB NOT NULL,           -- [{ "seat": "2-1", "label": "Middle-left", "name": "Ravi", "price": 300 }]
  contact_phone VARCHAR(15) NOT NULL,
  pickup_point  TEXT NOT NULL,
  drop_point    TEXT NOT NULL,
  amount        NUMERIC(10,2) NOT NULL,
  pay_mode      VARCHAR(6) NOT NULL CHECK (pay_mode IN ('upi', 'cash')),
  utr           VARCHAR(30),             -- UPI reference the customer typed after paying
  status        VARCHAR(10) NOT NULL CHECK (status IN ('held', 'paid', 'confirmed', 'expired', 'rejected', 'cancelled', 'left')),
  status_reason VARCHAR(300),
  hold_until    TIMESTAMPTZ,
  paid_at       TIMESTAMPTZ,
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ride_bookings_ride_idx ON ride_bookings (ride_id);
CREATE INDEX IF NOT EXISTS ride_bookings_customer_idx ON ride_bookings (customer_id, created_at DESC);

-- One row per taken seat while a booking is held / waiting / confirmed: the primary key makes double booking impossible.
CREATE TABLE IF NOT EXISTS ride_booking_seats (
  ride_id    INT NOT NULL REFERENCES share_rides(id) ON DELETE CASCADE,
  seat_code  TEXT NOT NULL,
  booking_id INT NOT NULL REFERENCES ride_bookings(id) ON DELETE CASCADE,
  PRIMARY KEY (ride_id, seat_code)
);

-- the admins' Activity page (audit log) shows changes to cars, models, places and journeys
CREATE OR REPLACE TRIGGER shared_cars_audit AFTER INSERT OR UPDATE OR DELETE ON shared_cars FOR EACH ROW EXECUTE FUNCTION trg_audit();
CREATE OR REPLACE TRIGGER car_models_audit AFTER INSERT OR UPDATE OR DELETE ON car_models FOR EACH ROW EXECUTE FUNCTION trg_audit();
CREATE OR REPLACE TRIGGER share_places_audit AFTER INSERT OR UPDATE OR DELETE ON share_places FOR EACH ROW EXECUTE FUNCTION trg_audit();
CREATE OR REPLACE TRIGGER share_rides_audit AFTER INSERT OR UPDATE OR DELETE ON share_rides FOR EACH ROW EXECUTE FUNCTION trg_audit();

-- ============ seats ============

-- The seats of a layout with names: [{ code, row, col, row_name, label, window }]. Driver and gaps are not seats.
-- Names: 1 seat in a row → the row name; 2 → left/right; 3 → left/middle/right; more → "Row 2 seat 4".
CREATE OR REPLACE FUNCTION fn_layout_seats(p_layout JSONB) RETURNS TABLE (code TEXT, row_no INT, col_no INT, row_name TEXT, label TEXT, is_window BOOLEAN)
LANGUAGE sql IMMUTABLE AS $$
  WITH r AS (
    SELECT (ord)::int AS row_no, x->>'name' AS row_name, x->>'cells' AS cells
      FROM jsonb_array_elements(p_layout) WITH ORDINALITY AS t(x, ord)
  ), c AS (
    SELECT r.row_no, r.row_name, r.cells, i AS col_no, substr(r.cells, i, 1) AS ch
      FROM r, generate_series(1, length(r.cells)) AS i
  ), s AS (
    SELECT c.*, row_number() OVER (PARTITION BY c.row_no ORDER BY c.col_no) AS pos,
           count(*) OVER (PARTITION BY c.row_no) AS n,
           min(c.col_no) OVER (PARTITION BY c.row_no) AS first_col,
           max(c.col_no) OVER (PARTITION BY c.row_no) AS last_col
      FROM c WHERE c.ch = 'S'
  )
  SELECT s.row_no || '-' || s.col_no, s.row_no, s.col_no, s.row_name,
         CASE WHEN s.n = 1 THEN s.row_name
              WHEN s.n = 2 THEN s.row_name || CASE WHEN s.pos = 1 THEN '-left' ELSE '-right' END
              WHEN s.n = 3 THEN s.row_name || CASE s.pos WHEN 1 THEN '-left' WHEN 2 THEN '-middle' ELSE '-right' END
              ELSE s.row_name || ' seat ' || s.pos END,
         s.col_no IN (1, length(s.cells))
    FROM s ORDER BY s.row_no, s.col_no
$$;

-- Checks a layout typed by an admin; returns the number of passenger seats.
CREATE OR REPLACE FUNCTION fn_check_layout(p_layout JSONB) RETURNS INT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_row JSONB;
  v_drivers INT := 0;
  v_seats INT;
BEGIN
  IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'array' OR jsonb_array_length(p_layout) NOT BETWEEN 2 AND 8 THEN
    RAISE EXCEPTION 'A car needs 2 to 8 seat rows' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_layout) LOOP
    IF coalesce(trim(v_row->>'name'), '') = '' OR length(v_row->>'name') > 20 THEN
      RAISE EXCEPTION 'Give every row a short name (Front, Middle, Back…)' USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_row->>'cells', '') !~ '^[SD_]{1,5}$' THEN
      RAISE EXCEPTION 'Row "%": use S for a seat, D for the driver and _ for a gap (up to 5 places)', v_row->>'name' USING ERRCODE = '22023';
    END IF;
    v_drivers := v_drivers + length(v_row->>'cells') - length(replace(v_row->>'cells', 'D', ''));
  END LOOP;
  IF v_drivers <> 1 OR position('D' IN p_layout->0->>'cells') = 0 THEN
    RAISE EXCEPTION 'Put the driver (D) once, in the first row' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_seats FROM fn_layout_seats(p_layout);
  IF v_seats NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'A car needs 1 to 30 passenger seats' USING ERRCODE = '22023';
  END IF;
  RETURN v_seats;
END $$;

-- Seats taken (held, waiting for the owner, or confirmed) on a journey.
CREATE OR REPLACE FUNCTION fn_ride_taken(p_ride_id INT) RETURNS TEXT[]
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(array_agg(seat_code), ARRAY[]::TEXT[]) FROM ride_booking_seats WHERE ride_id = p_ride_id
$$;

-- Unpaid holds older than 15 minutes give their seats back. Called before every read / booking.
CREATE OR REPLACE PROCEDURE sp_ride_expire_holds()
LANGUAGE sql SET search_path FROM CURRENT AS $$
  WITH gone AS (
    UPDATE ride_bookings SET status = 'expired', status_reason = 'Not paid within 15 minutes'
     WHERE status = 'held' AND hold_until < now() RETURNING id
  )
  DELETE FROM ride_booking_seats WHERE booking_id IN (SELECT id FROM gone)
$$;

-- ============ who may list ============

CREATE OR REPLACE FUNCTION fn_share_ride_service() RETURNS INT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT id FROM services WHERE slug = 'share-ride-share-ride'
$$;

-- Owner may have journeys shown: active agent with the shared_car_agent type and (when the city asks for it) an
-- active Share Ride subscription.
CREATE OR REPLACE FUNCTION fn_owner_live(p_owner_id INT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT EXISTS (
    SELECT 1 FROM agents a
     WHERE a.user_id = p_owner_id AND a.status = 'active' AND 'shared_car_agent' = ANY (a.skills)
       AND (NOT coalesce((fn_sub_terms(a.franchise_id, fn_share_ride_service())).required, false)
            OR fn_subscription_active(p_owner_id, fn_share_ride_service())))
$$;

-- Why an owner's journeys are hidden (NULL = shown).
CREATE OR REPLACE FUNCTION fn_owner_blocker(p_owner_id INT) RETURNS TEXT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT CASE
    WHEN a.user_id IS NULL OR a.status <> 'active' THEN 'Your agent account is not active.'
    WHEN NOT ('shared_car_agent' = ANY (a.skills)) THEN 'Your account is not set up for Share Ride. Please contact your franchise admin.'
    WHEN coalesce((fn_sub_terms(a.franchise_id, fn_share_ride_service())).required, false)
         AND NOT fn_subscription_active(p_owner_id, fn_share_ride_service())
      THEN 'Your Share Ride subscription is not active. Customers cannot see your journeys until your franchise admin switches it on.'
  END
    FROM (SELECT 1) x LEFT JOIN agents a ON a.user_id = p_owner_id
$$;

-- ============ journeys ============

CREATE OR REPLACE FUNCTION fn_create_ride(p_owner_id INT, p_car_id INT, p_from TEXT, p_to TEXT, p_depart TIMESTAMPTZ,
                                          p_pickups TEXT[], p_drops TEXT[], p_prices NUMERIC[], p_blocked TEXT[],
                                          p_upi TEXT, p_allow_cash BOOLEAN, p_notes TEXT)
RETURNS share_rides
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  c shared_cars;
  m car_models;
  v share_rides;
  v_rows INT;
  v_from TEXT;
  v_to TEXT;
  v_pick TEXT[];
  v_drop TEXT[];
  v_upi TEXT := nullif(trim(coalesce(p_upi, '')), '');
BEGIN
  SELECT * INTO c FROM shared_cars WHERE id = p_car_id AND owner_id = p_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose one of your cars' USING ERRCODE = '22023';
  END IF;
  IF c.status <> 'approved' THEN
    RAISE EXCEPTION 'This car is not approved yet. Your franchise admin checks the documents first.' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agents WHERE user_id = p_owner_id AND status = 'active') THEN
    RAISE EXCEPTION 'Your agent account is not active' USING ERRCODE = '55000';
  END IF;
  SELECT name INTO v_from FROM share_places WHERE lower(name) = lower(trim(p_from)) AND is_active;
  SELECT name INTO v_to FROM share_places WHERE lower(name) = lower(trim(p_to)) AND is_active;
  IF v_from IS NULL OR v_to IS NULL THEN
    RAISE EXCEPTION 'Choose the From and To towns from the list' USING ERRCODE = '22023';
  END IF;
  IF v_from = v_to THEN
    RAISE EXCEPTION 'From and To must be different towns' USING ERRCODE = '22023';
  END IF;
  IF p_depart IS NULL OR p_depart < now() + interval '30 minutes' OR p_depart > now() + interval '30 days' THEN
    RAISE EXCEPTION 'Departure must be at least 30 minutes from now and within 30 days' USING ERRCODE = '22023';
  END IF;
  v_pick := ARRAY(SELECT DISTINCT left(trim(x), 80) FROM unnest(coalesce(p_pickups, '{}')) x WHERE trim(x) <> '');
  v_drop := ARRAY(SELECT DISTINCT left(trim(x), 80) FROM unnest(coalesce(p_drops, '{}')) x WHERE trim(x) <> '');
  IF cardinality(v_pick) NOT BETWEEN 1 AND 10 OR cardinality(v_drop) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'Add 1 to 10 pickup points and 1 to 10 drop points' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO m FROM car_models WHERE id = c.model_id;
  v_rows := jsonb_array_length(m.layout);
  IF cardinality(p_prices) <> v_rows OR EXISTS (
       SELECT 1 FROM fn_layout_seats(m.layout) s WHERE p_prices[s.row_no] IS NULL OR p_prices[s.row_no] < 1 OR p_prices[s.row_no] > 10000) THEN
    RAISE EXCEPTION 'Enter the price per seat for every row (₹1 – ₹10,000)' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(p_blocked, '{}')) b WHERE b NOT IN (SELECT code FROM fn_layout_seats(m.layout))) THEN
    RAISE EXCEPTION 'Unknown seat in "not for sale"' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM fn_layout_seats(m.layout)) <= cardinality(coalesce(p_blocked, '{}')) THEN
    RAISE EXCEPTION 'Leave at least one seat for sale' USING ERRCODE = '22023';
  END IF;
  IF v_upi IS NOT NULL AND v_upi !~ '^[A-Za-z0-9.\-_]{2,60}@[A-Za-z0-9]{2,30}$' THEN
    RAISE EXCEPTION 'UPI ID looks wrong — it should look like name@okaxis' USING ERRCODE = '22023';
  END IF;
  IF v_upi IS NULL AND NOT coalesce(p_allow_cash, false) THEN
    RAISE EXCEPTION 'Add your UPI ID, or allow cash at pickup' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM share_rides WHERE car_id = c.id AND status = 'open'
                AND depart_at BETWEEN p_depart - interval '1 hour' AND p_depart + interval '1 hour') THEN
    RAISE EXCEPTION 'This car already has a journey within an hour of that time' USING ERRCODE = '55000';
  END IF;
  INSERT INTO share_rides (car_id, owner_id, franchise_id, from_place, to_place, depart_at, pickup_points, drop_points, layout,
                           row_prices, blocked_seats, upi_id, allow_cash, notes)
  VALUES (c.id, p_owner_id, c.franchise_id, v_from, v_to, date_trunc('minute', p_depart), v_pick, v_drop, m.layout,
          p_prices, coalesce(p_blocked, '{}'), v_upi, coalesce(p_allow_cash, false), nullif(left(trim(coalesce(p_notes, '')), 300), ''))
  RETURNING * INTO v;
  RETURN v;
END $$;

-- The owner cancels a journey: every live booking is cancelled (the owner returns any money taken).
CREATE OR REPLACE FUNCTION fn_cancel_ride(p_owner_id INT, p_ride_id INT, p_reason TEXT, p_admin BOOLEAN DEFAULT false) RETURNS INT[]
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_customers INT[];
BEGIN
  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Please give a reason — your passengers will see it' USING ERRCODE = '22023';
  END IF;
  UPDATE share_rides SET status = 'cancelled', cancel_reason = left(trim(p_reason), 300), cancelled_at = now()
   WHERE id = p_ride_id AND (p_admin OR owner_id = p_owner_id) AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found or already cancelled' USING ERRCODE = 'P0002';
  END IF;
  WITH c AS (
    UPDATE ride_bookings SET status = 'cancelled', status_reason = 'Journey cancelled by the car owner: ' || left(trim(p_reason), 250)
     WHERE ride_id = p_ride_id AND status IN ('held', 'paid', 'confirmed') RETURNING customer_id
  )
  SELECT array_agg(DISTINCT customer_id) INTO v_customers FROM c;
  DELETE FROM ride_booking_seats WHERE ride_id = p_ride_id;
  RETURN coalesce(v_customers, '{}');
END $$;

-- ============ search ============

-- Open journeys for a route and day with enough free seats. p_min_seats: car size (5 → 4 passenger seats…).
CREATE OR REPLACE FUNCTION fn_search_rides(p_from TEXT, p_to TEXT, p_date DATE, p_passengers INT, p_min_seats INT, p_max_price NUMERIC)
RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'depart_at'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
             'id', r.id, 'from_place', r.from_place, 'to_place', r.to_place, 'depart_at', r.depart_at,
             'pickup_points', r.pickup_points, 'drop_points', r.drop_points, 'allow_cash', r.allow_cash, 'notes', r.notes,
             'model', m.name, 'color', c.color, 'total_seats', st.n, 'seats_left', st.free,
             'min_price', st.min_price, 'max_price', st.max_price,
             'owner_name', split_part(u.full_name, ' ', 1),
             'trips_done', (SELECT count(*) FROM share_rides z WHERE z.owner_id = r.owner_id AND z.status = 'open' AND z.depart_at < now())) AS x
      FROM share_rides r
      JOIN shared_cars c ON c.id = r.car_id AND c.status = 'approved'
      JOIN car_models m ON m.id = c.model_id
      JOIN users u ON u.id = r.owner_id
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS n,
               count(*) FILTER (WHERE NOT (s.code = ANY (r.blocked_seats)) AND NOT (s.code = ANY (fn_ride_taken(r.id))))::int AS free,
               min(r.row_prices[s.row_no]) FILTER (WHERE NOT (s.code = ANY (r.blocked_seats))) AS min_price,
               max(r.row_prices[s.row_no]) FILTER (WHERE NOT (s.code = ANY (r.blocked_seats))) AS max_price
          FROM fn_layout_seats(r.layout) s) st
     WHERE r.status = 'open' AND r.depart_at > now() + interval '10 minutes'
       AND lower(r.from_place) = lower(trim(p_from)) AND lower(r.to_place) = lower(trim(p_to))
       AND (p_date IS NULL OR (r.depart_at AT TIME ZONE 'Asia/Kolkata')::date = p_date)
       AND st.free >= greatest(coalesce(p_passengers, 1), 1)
       AND (p_min_seats IS NULL OR st.n >= p_min_seats)
       AND (p_max_price IS NULL OR st.min_price <= p_max_price)
       AND fn_owner_live(r.owner_id)
  ) q
$$;

-- One journey for the seat map. Owner phone only for the owner / admins (customers get it on their ticket).
CREATE OR REPLACE FUNCTION fn_ride_detail(p_ride_id INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object(
           'id', r.id, 'from_place', r.from_place, 'to_place', r.to_place, 'depart_at', r.depart_at, 'status', r.status,
           'cancel_reason', r.cancel_reason, 'pickup_points', r.pickup_points, 'drop_points', r.drop_points,
           'allow_cash', r.allow_cash, 'upi', r.upi_id IS NOT NULL, 'notes', r.notes, 'layout', r.layout,
           'row_prices', to_jsonb(r.row_prices), 'blocked', to_jsonb(r.blocked_seats), 'taken', to_jsonb(fn_ride_taken(r.id)),
           'seats', (SELECT jsonb_agg(jsonb_build_object('code', s.code, 'row', s.row_no, 'col', s.col_no, 'label', s.label,
                                                         'window', s.is_window, 'price', r.row_prices[s.row_no]) ORDER BY s.row_no, s.col_no)
                       FROM fn_layout_seats(r.layout) s),
           'model', m.name, 'color', c.color, 'reg_number', c.reg_number, 'owner_name', split_part(u.full_name, ' ', 1),
           'owner_id', r.owner_id, 'franchise_id', r.franchise_id,
           'live', r.status = 'open' AND r.depart_at > now() + interval '10 minutes' AND fn_owner_live(r.owner_id) AND c.status = 'approved')
    FROM share_rides r JOIN shared_cars c ON c.id = r.car_id JOIN car_models m ON m.id = c.model_id JOIN users u ON u.id = r.owner_id
   WHERE r.id = p_ride_id
$$;

-- ============ booking ============

-- p_passengers: [{ "seat": "2-1", "name": "Ravi" }]. UPI → held 15 minutes; cash at pickup → confirmed at once.
CREATE OR REPLACE FUNCTION fn_book_ride(p_customer_id INT, p_ride_id INT, p_passengers JSONB, p_phone TEXT,
                                        p_pickup TEXT, p_drop TEXT, p_pay_mode TEXT, p_agree BOOLEAN)
RETURNS ride_bookings
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  r share_rides;
  v ride_bookings;
  v_phone TEXT := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_seats TEXT[];
  v_list JSONB;
  v_amount NUMERIC;
BEGIN
  CALL sp_ride_expire_holds();
  SELECT * INTO r FROM share_rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'open' OR r.depart_at <= now() + interval '10 minutes' THEN
    RAISE EXCEPTION 'This journey is not open for booking any more' USING ERRCODE = '55000';
  END IF;
  IF NOT fn_owner_live(r.owner_id) OR NOT EXISTS (SELECT 1 FROM shared_cars WHERE id = r.car_id AND status = 'approved') THEN
    RAISE EXCEPTION 'This journey is not open for booking right now' USING ERRCODE = '55000';
  END IF;
  IF r.owner_id = p_customer_id THEN
    RAISE EXCEPTION 'You cannot book seats on your own journey' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(p_agree, false) THEN
    RAISE EXCEPTION 'Please accept: no cancellation and no refund after payment' USING ERRCODE = '22023';
  END IF;
  IF length(v_phone) = 12 AND v_phone LIKE '91%' THEN v_phone := substr(v_phone, 3); END IF;
  IF v_phone !~ '^[6-9]\d{9}$' THEN
    RAISE EXCEPTION 'Enter a valid 10-digit mobile number' USING ERRCODE = '22023';
  END IF;
  IF NOT (p_pickup = ANY (r.pickup_points)) OR NOT (p_drop = ANY (r.drop_points)) THEN
    RAISE EXCEPTION 'Choose your pickup and drop point' USING ERRCODE = '22023';
  END IF;
  IF p_pay_mode NOT IN ('upi', 'cash') OR (p_pay_mode = 'upi' AND r.upi_id IS NULL) OR (p_pay_mode = 'cash' AND NOT r.allow_cash) THEN
    RAISE EXCEPTION 'Choose how you will pay' USING ERRCODE = '22023';
  END IF;
  IF p_passengers IS NULL OR jsonb_typeof(p_passengers) <> 'array' OR jsonb_array_length(p_passengers) NOT BETWEEN 1 AND 6 THEN
    RAISE EXCEPTION 'Choose 1 to 6 seats' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_passengers) p WHERE length(trim(coalesce(p->>'name', ''))) NOT BETWEEN 2 AND 50) THEN
    RAISE EXCEPTION 'Enter the name of every passenger' USING ERRCODE = '22023';
  END IF;
  -- the seats: real seats of this car, not blocked, each once
  SELECT array_agg(p->>'seat'),
         jsonb_agg(jsonb_build_object('seat', s.code, 'label', s.label, 'name', left(trim(p->>'name'), 50), 'price', r.row_prices[s.row_no]) ORDER BY s.row_no, s.col_no),
         sum(r.row_prices[s.row_no])
    INTO v_seats, v_list, v_amount
    FROM jsonb_array_elements(p_passengers) p LEFT JOIN fn_layout_seats(r.layout) s ON s.code = p->>'seat';
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) x WHERE x->>'label' IS NULL)
     OR (SELECT count(DISTINCT x) FROM unnest(v_seats) x) <> cardinality(v_seats)
     OR v_seats && r.blocked_seats THEN
    RAISE EXCEPTION 'Choose free seats on the seat map' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM ride_bookings WHERE ride_id = r.id AND customer_id = p_customer_id AND status = 'held') > 0 THEN
    RAISE EXCEPTION 'You already have seats waiting for payment on this journey. Finish or leave that booking first.' USING ERRCODE = '55000';
  END IF;

  INSERT INTO ride_bookings (ride_id, customer_id, seats, passengers, contact_phone, pickup_point, drop_point, amount, pay_mode,
                             status, hold_until, confirmed_at)
  VALUES (r.id, p_customer_id, v_seats, v_list, v_phone, p_pickup, p_drop, v_amount, p_pay_mode,
          CASE WHEN p_pay_mode = 'cash' THEN 'confirmed' ELSE 'held' END,
          CASE WHEN p_pay_mode = 'upi' THEN now() + interval '15 minutes' END,
          CASE WHEN p_pay_mode = 'cash' THEN now() END)
  RETURNING * INTO v;
  BEGIN
    INSERT INTO ride_booking_seats (ride_id, seat_code, booking_id) SELECT r.id, x, v.id FROM unnest(v_seats) x;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Sorry, one of those seats was just taken. Please choose again.' USING ERRCODE = '55000';
  END;
  RETURN v;
END $$;

-- The customer paid by UPI and typed the reference: waiting for the owner (the hold no longer runs out).
CREATE OR REPLACE FUNCTION fn_ride_paid(p_customer_id INT, p_booking_id INT, p_utr TEXT) RETURNS ride_bookings
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v ride_bookings;
  v_utr TEXT := upper(regexp_replace(coalesce(p_utr, ''), '\s', '', 'g'));
BEGIN
  CALL sp_ride_expire_holds();
  IF v_utr !~ '^[A-Z0-9]{6,30}$' THEN
    RAISE EXCEPTION 'Enter the UPI reference number (UTR) from your payment app — usually 12 digits' USING ERRCODE = '22023';
  END IF;
  UPDATE ride_bookings SET status = 'paid', utr = v_utr, paid_at = now(), hold_until = NULL
   WHERE id = p_booking_id AND customer_id = p_customer_id AND status = 'held'
   RETURNING * INTO v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This booking is no longer waiting for payment (the 15 minutes may have run out). Please book again.' USING ERRCODE = '55000';
  END IF;
  RETURN v;
END $$;

-- The customer leaves before paying: seats go back at once.
CREATE OR REPLACE PROCEDURE sp_ride_leave(p_customer_id INT, p_booking_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  UPDATE ride_bookings SET status = 'left', status_reason = 'Left before paying'
   WHERE id = p_booking_id AND customer_id = p_customer_id AND status = 'held';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a booking not paid yet can be left. After payment there is no cancellation.' USING ERRCODE = '55000';
  END IF;
  DELETE FROM ride_booking_seats WHERE booking_id = p_booking_id;
END $$;

-- The owner checks the payment: received → confirmed (ticket); not received → rejected, seats free again.
CREATE OR REPLACE FUNCTION fn_ride_owner_decide(p_owner_id INT, p_booking_id INT, p_received BOOLEAN, p_reason TEXT) RETURNS ride_bookings
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v ride_bookings;
BEGIN
  IF NOT p_received AND coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Tell the passenger why (e.g. no money received for that UPI reference)' USING ERRCODE = '22023';
  END IF;
  UPDATE ride_bookings b
     SET status = CASE WHEN p_received THEN 'confirmed' ELSE 'rejected' END,
         confirmed_at = CASE WHEN p_received THEN now() END,
         status_reason = CASE WHEN p_received THEN NULL ELSE left(trim(p_reason), 300) END
    FROM share_rides r
   WHERE b.id = p_booking_id AND r.id = b.ride_id AND r.owner_id = p_owner_id AND b.status IN ('paid', 'held')
   RETURNING b.* INTO v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found or already decided' USING ERRCODE = 'P0002';
  END IF;
  IF NOT p_received THEN
    DELETE FROM ride_booking_seats WHERE booking_id = v.id;
  END IF;
  RETURN v;
END $$;

-- A booking with its journey, car and (once confirmed) the owner's phone — for the customer, the owner and admins.
CREATE OR REPLACE FUNCTION fn_ride_booking(p_booking_id INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT to_jsonb(b) - 'utr' || jsonb_build_object(
           'utr', b.utr,
           'customer_name', cu.full_name,
           'ride', jsonb_build_object('id', r.id, 'from_place', r.from_place, 'to_place', r.to_place, 'depart_at', r.depart_at,
                                      'status', r.status, 'cancel_reason', r.cancel_reason, 'upi_id', r.upi_id, 'notes', r.notes),
           'car', jsonb_build_object('model', m.name, 'reg_number', c.reg_number, 'color', c.color),
           'owner_id', r.owner_id, 'owner_name', o.full_name,
           'owner_phone', CASE WHEN b.status IN ('confirmed', 'paid', 'cancelled') THEN o.phone END)
    FROM ride_bookings b JOIN share_rides r ON r.id = b.ride_id JOIN shared_cars c ON c.id = r.car_id
    JOIN car_models m ON m.id = c.model_id JOIN users o ON o.id = r.owner_id JOIN users cu ON cu.id = b.customer_id
   WHERE b.id = p_booking_id
$$;

-- ============ cars (owner adds, franchise admin approves) ============

CREATE OR REPLACE FUNCTION fn_add_car(p_owner_id INT, p_model_id INT, p_reg TEXT, p_color TEXT, p_yellow BOOLEAN,
                                      p_rc TEXT, p_permit TEXT, p_insurance TEXT, p_photo TEXT)
RETURNS shared_cars
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v shared_cars;
  v_reg TEXT := upper(regexp_replace(coalesce(p_reg, ''), '[\s-]', '', 'g'));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM car_models WHERE id = p_model_id AND is_active) THEN
    RAISE EXCEPTION 'Choose your car model' USING ERRCODE = '22023';
  END IF;
  IF v_reg !~ '^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$' THEN
    RAISE EXCEPTION 'Enter the car number like TS36T1234' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(p_yellow, false) THEN
    RAISE EXCEPTION 'Only commercial (yellow number plate) cars with a valid permit can carry paying passengers' USING ERRCODE = '22023';
  END IF;
  IF p_rc IS NULL OR p_permit IS NULL OR p_insurance IS NULL THEN
    RAISE EXCEPTION 'Upload the RC, permit and insurance of the car' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM shared_cars WHERE upper(reg_number) = v_reg AND status IN ('pending', 'approved')) THEN
    RAISE EXCEPTION 'This car number is already registered' USING ERRCODE = '55000';
  END IF;
  INSERT INTO shared_cars (owner_id, franchise_id, model_id, reg_number, color, rc_doc, permit_doc, insurance_doc, car_photo)
  VALUES (p_owner_id, fn_agent_franchise(p_owner_id), p_model_id, v_reg, nullif(left(trim(coalesce(p_color, '')), 30), ''),
          p_rc, p_permit, p_insurance, p_photo)
  RETURNING * INTO v;
  RETURN v;
END $$;

-- Franchise admin: approve (also approves a still-pending owner), reject or remove a car.
CREATE OR REPLACE PROCEDURE sp_review_car(p_car_id INT, p_action TEXT, p_reason TEXT, p_admin_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  c shared_cars;
BEGIN
  SELECT * INTO c FROM shared_cars WHERE id = p_car_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Car not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_action NOT IN ('approve', 'reject', 'remove') THEN
    RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023';
  END IF;
  IF p_action <> 'approve' AND coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Please give a reason — the owner sees it' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'approve' THEN
    IF c.status NOT IN ('pending', 'rejected', 'removed') THEN
      RAISE EXCEPTION 'This car is already approved' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM shared_cars WHERE upper(reg_number) = upper(c.reg_number) AND id <> c.id AND status IN ('pending', 'approved')) THEN
      RAISE EXCEPTION 'Another car with this number is already registered' USING ERRCODE = '55000';
    END IF;
    IF (SELECT status FROM agents WHERE user_id = c.owner_id) = 'pending' THEN
      CALL sp_review_agent(c.owner_id, true, NULL, p_admin_id);
    END IF;
    IF (SELECT status FROM agents WHERE user_id = c.owner_id) <> 'active' THEN
      RAISE EXCEPTION 'The owner''s agent account is not active' USING ERRCODE = '55000';
    END IF;
  END IF;
  UPDATE shared_cars
     SET status = CASE p_action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'removed' END,
         status_reason = CASE WHEN p_action = 'approve' THEN NULL ELSE left(trim(p_reason), 300) END,
         reviewed_by = p_admin_id, reviewed_at = now()
   WHERE id = c.id;
END $$;

-- Car models: add or change (layout checked). Booked journeys keep their own copy of the layout.
CREATE OR REPLACE FUNCTION fn_save_car_model(p_id INT, p_name TEXT, p_layout JSONB, p_active BOOLEAN, p_user INT) RETURNS car_models
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v car_models;
BEGIN
  IF length(trim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'Enter the car model name' USING ERRCODE = '22023';
  END IF;
  PERFORM fn_check_layout(p_layout);
  IF EXISTS (SELECT 1 FROM car_models WHERE lower(name) = lower(trim(p_name)) AND id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'A model with this name already exists' USING ERRCODE = '55000';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO car_models (name, layout, is_active, created_by) VALUES (trim(p_name), p_layout, coalesce(p_active, true), p_user) RETURNING * INTO v;
  ELSE
    UPDATE car_models SET name = trim(p_name), layout = p_layout, is_active = coalesce(p_active, is_active) WHERE id = p_id RETURNING * INTO v;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Model not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v;
END $$;

-- ============ seed: common taxi models and towns (only when missing; admin edits are kept) ============
INSERT INTO car_models (name, layout) VALUES
  ('Maruti Swift Dzire (4 passengers)', '[{"name":"Front","cells":"S_D"},{"name":"Back","cells":"SSS"}]'),
  ('Toyota Etios (4 passengers)',       '[{"name":"Front","cells":"S_D"},{"name":"Back","cells":"SSS"}]'),
  ('Hyundai Aura (4 passengers)',       '[{"name":"Front","cells":"S_D"},{"name":"Back","cells":"SSS"}]'),
  ('Honda Amaze (4 passengers)',        '[{"name":"Front","cells":"S_D"},{"name":"Back","cells":"SSS"}]'),
  ('Maruti Ertiga (6 passengers)',      '[{"name":"Front","cells":"S_D"},{"name":"Middle","cells":"SSS"},{"name":"Back","cells":"S_S"}]'),
  ('Kia Carens (6 passengers)',         '[{"name":"Front","cells":"S_D"},{"name":"Middle","cells":"SSS"},{"name":"Back","cells":"S_S"}]'),
  ('Toyota Innova Crysta – captain seats (6 passengers)', '[{"name":"Front","cells":"S_D"},{"name":"Middle","cells":"S_S"},{"name":"Back","cells":"SSS"}]'),
  ('Toyota Innova (7 passengers)',      '[{"name":"Front","cells":"S_D"},{"name":"Middle","cells":"SSS"},{"name":"Back","cells":"SSS"}]'),
  ('Mahindra Xylo (7 passengers)',      '[{"name":"Front","cells":"S_D"},{"name":"Middle","cells":"SSS"},{"name":"Back","cells":"SSS"}]'),
  ('Mahindra Marazzo (7 passengers)',   '[{"name":"Front","cells":"S_D"},{"name":"Middle","cells":"SSS"},{"name":"Back","cells":"SSS"}]'),
  ('Force Tempo Traveller (12 passengers)', '[{"name":"Front","cells":"S_D"},{"name":"Row 2","cells":"SS_S"},{"name":"Row 3","cells":"SS_S"},{"name":"Row 4","cells":"SS_S"},{"name":"Back","cells":"SS"}]')
ON CONFLICT DO NOTHING;

INSERT INTO share_places (name) VALUES
  ('Siddipet'), ('Hyderabad'), ('Secunderabad'), ('Karimnagar'), ('Warangal'), ('Hanamkonda'), ('Medak'), ('Sangareddy'),
  ('Gajwel'), ('Husnabad'), ('Dubbaka'), ('Cheriyal'), ('Jangaon'), ('Kamareddy'), ('Nizamabad'), ('Prajapur'), ('Shamshabad Airport')
ON CONFLICT DO NOTHING;
