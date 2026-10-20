-- 🏡 Village Needs (2026-10-19). Re-runnable. Runs after franchise.sql and instant.sql.
-- Villages within 15 km of town get kirana, vegetables, fresh meat and "other things" (written list or photo), delivered
-- NEXT DAY by the company's own staff (agent type our_service_employees). It works like ⚡ Instant Delivery: one service
-- (services.is_village) shows the products of other shops live (source_service_ids) plus its own "Others" list.
--  · Only villages the franchise admin added (localities.is_village) can order it; town areas cannot.
--  · Delivery charge by distance band: up to 10 km → franchises.village_fee_near (₹150), 10–15 km → village_fee_far (₹200).
--  · Delivery day + time: tomorrow or the day after (after 9 PM: from the day after tomorrow), 3 windows a day.
-- Columns are in schema.sql; the order itself is placed by fn_place_order (orders.sql).

-- Delivery windows (hours, India time) and the order cut-off for "tomorrow".
CREATE OR REPLACE FUNCTION fn_village_windows() RETURNS INT[][]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[[7, 10], [10, 13], [16, 19]] $$;

-- The slots a customer can choose now, e.g. 'Tue 21 Oct, 7 AM – 10 AM' (same text style as fn_delivery_slots).
CREATE OR REPLACE FUNCTION fn_village_slots() RETURNS TEXT[]
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  WITH t AS (SELECT now() AT TIME ZONE 'Asia/Kolkata' AS n),
       first AS (SELECT (n::date + CASE WHEN extract(hour FROM n) >= 21 THEN 2 ELSE 1 END) AS d FROM t)
  SELECT array_agg(to_char(day, 'Dy FMDD Mon') || ', ' || fn_hour_label(w[1]) || ' – ' || fn_hour_label(w[2]) ORDER BY day, w[1])
    FROM first, generate_series(first.d, first.d + 1, interval '1 day') AS g(day),
         LATERAL (SELECT ARRAY[(fn_village_windows())[i][1], (fn_village_windows())[i][2]] AS w
                    FROM generate_subscripts(fn_village_windows(), 1) AS i) x
$$;

-- The delivery day of a chosen slot (NULL when the slot is not one of today's choices).
CREATE OR REPLACE FUNCTION fn_village_slot_date(p_slot TEXT) RETURNS DATE
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT d::date FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date + 1, (now() AT TIME ZONE 'Asia/Kolkata')::date + 3, interval '1 day') AS g(d)
   WHERE p_slot = ANY (fn_village_slots()) AND p_slot LIKE to_char(d, 'Dy FMDD Mon') || ',%'
   LIMIT 1
$$;

-- Delivery charge to a village (NULL = not a village we serve).
CREATE OR REPLACE FUNCTION fn_village_fee(p_locality_id INT) RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT CASE l.village_band WHEN 1 THEN f.village_fee_near WHEN 2 THEN f.village_fee_far END
    FROM localities l JOIN franchises f ON f.id = l.franchise_id
   WHERE l.id = p_locality_id AND l.is_active AND l.is_village AND f.status = 'active'
$$;

-- Straight-line km from the town (the middle of the franchise's town areas) — a hint for the admin's distance band.
CREATE OR REPLACE FUNCTION fn_km_from_town(p_franchise INT, p_lat NUMERIC, p_lng NUMERIC) RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT round((6371 * 2 * asin(sqrt(power(sin(radians(p_lat - c.lat) / 2), 2)
                + cos(radians(c.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - c.lng) / 2), 2))))::numeric, 1)
    FROM (SELECT avg(lat) AS lat, avg(lng) AS lng FROM localities
           WHERE franchise_id = p_franchise AND NOT is_village AND is_active) c
   WHERE c.lat IS NOT NULL AND p_lat IS NOT NULL
$$;

-- Checkout quote for a Village Needs order: the village charge (needs the chosen village) and the day/time slots.
CREATE OR REPLACE FUNCTION fn_village_quote(p_via_service_id INT, p_locality_id INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object(
    'base_fee', coalesce(fn_village_fee(p_locality_id), 0),
    'delivery_fee', coalesce(fn_village_fee(p_locality_id), 0),
    'free_left', 0,
    'on_bill', true,
    'instant', false,
    'village', true,
    'village_ok', fn_village_fee(p_locality_id) IS NOT NULL,
    'window', NULL, 'window_conflict', false,
    'slots', to_jsonb(fn_village_slots()))
    FROM services s WHERE s.id = p_via_service_id AND s.is_active AND s.is_village
$$;

-- The franchise admin's two village charges. HQ watches only.
CREATE OR REPLACE PROCEDURE sp_set_village_fees(p_franchise INT, p_near NUMERIC, p_far NUMERIC)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF p_near IS NULL OR p_far IS NULL OR p_near < 0 OR p_far < 0 OR p_near > 2000 OR p_far > 2000 THEN
    RAISE EXCEPTION 'Enter both delivery charges (₹0 – ₹2000)' USING ERRCODE = '22023';
  END IF;
  UPDATE franchises SET village_fee_near = round(p_near, 2), village_fee_far = round(p_far, 2) WHERE id = p_franchise;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Franchise not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- Areas list for the admin: + village, band, km hint.
CREATE OR REPLACE FUNCTION fn_admin_localities(p_franchise INT DEFAULT NULL) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'name', l.name, 'pincode', l.pincode, 'lat', l.lat, 'lng', l.lng, 'is_active', l.is_active, 'franchise_id', l.franchise_id,
           'franchise_name', (SELECT f.name FROM franchises f WHERE f.id = l.franchise_id),
           'is_village', l.is_village, 'village_band', l.village_band,
           'village_fee', CASE WHEN l.is_village THEN fn_village_fee(l.id) END,
           'km_from_town', CASE WHEN l.is_village THEN fn_km_from_town(l.franchise_id, l.lat, l.lng) END,
           'orders', (SELECT count(*) FROM orders o WHERE o.locality_id = l.id),
           'agents', (SELECT count(*) FROM agents a WHERE a.locality_id = l.id))
         ORDER BY l.is_active DESC, l.is_village, l.name), '[]'::jsonb)
    FROM localities l
   WHERE p_franchise IS NULL OR l.franchise_id = p_franchise
$$;

-- Creates (p_id NULL) or updates an area — a town area, or a village with its distance band (1 or 2).
DROP FUNCTION IF EXISTS fn_save_locality(INT, TEXT, TEXT, NUMERIC, NUMERIC, BOOLEAN, INT);
CREATE OR REPLACE FUNCTION fn_save_locality(p_id INT, p_name TEXT, p_pincode TEXT, p_lat NUMERIC, p_lng NUMERIC, p_is_active BOOLEAN,
                                            p_franchise INT DEFAULT NULL, p_is_village BOOLEAN DEFAULT NULL, p_band INT DEFAULT NULL)
RETURNS localities
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v localities;
  v_village BOOLEAN;
BEGIN
  IF coalesce(trim(p_name), '') = '' OR length(trim(p_name)) > 80 THEN
    RAISE EXCEPTION 'Enter the area name (up to 80 letters)' USING ERRCODE = '22023';
  END IF;
  IF nullif(trim(p_pincode), '') IS NOT NULL AND trim(p_pincode) !~ '^[1-9]\d{5}$' THEN
    RAISE EXCEPTION 'Pincode must be 6 digits' USING ERRCODE = '22023';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 6 AND 37.5 OR p_lng NOT BETWEEN 68 AND 97.5 THEN
    RAISE EXCEPTION 'Tap the map to set where this area is' USING ERRCODE = '22023';
  END IF;
  v_village := coalesce(p_is_village, (SELECT is_village FROM localities WHERE id = p_id), false);
  IF v_village AND coalesce(p_band, (SELECT village_band FROM localities WHERE id = p_id)) IS NULL THEN
    RAISE EXCEPTION 'Choose how far the village is: up to 10 km, or 10–15 km' USING ERRCODE = '22023';
  END IF;
  IF p_band IS NOT NULL AND p_band NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Choose how far the village is: up to 10 km, or 10–15 km' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO localities (name, pincode, lat, lng, is_active, franchise_id, is_village, village_band)
    VALUES (trim(p_name), nullif(trim(p_pincode), ''), round(p_lat, 6), round(p_lng, 6), coalesce(p_is_active, true), p_franchise,
            v_village, CASE WHEN v_village THEN p_band END)
    RETURNING * INTO v;
  ELSE
    UPDATE localities SET name = trim(p_name), pincode = nullif(trim(p_pincode), ''), lat = round(p_lat, 6), lng = round(p_lng, 6),
                          is_active = coalesce(p_is_active, is_active), franchise_id = coalesce(p_franchise, franchise_id),
                          is_village = v_village,
                          village_band = CASE WHEN v_village THEN coalesce(p_band, village_band) END
     WHERE id = p_id RETURNING * INTO v;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Area not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v;
END $$;
