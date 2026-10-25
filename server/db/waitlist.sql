-- 📍 "Notify me": people in places we don't deliver to yet leave their mobile number (and their spot, or the place
-- they typed). HQ sees where people want us next (map + list) and calls them when a franchise opens there.
-- One open request per mobile number per spot (within ~2 km): asking again only refreshes it. Re-runnable.

CREATE TABLE IF NOT EXISTS area_waitlist (
  id            SERIAL PRIMARY KEY,
  user_id       INT REFERENCES users(id) ON DELETE SET NULL,
  name          VARCHAR(80),
  phone         VARCHAR(10)  NOT NULL,
  lat           NUMERIC(9,6),
  lng           NUMERIC(9,6),
  place_text    VARCHAR(120),                        -- what they searched for, when there is no GPS spot
  km_to_nearest NUMERIC(7,1),                        -- distance to our nearest city centre (when we have the spot)
  nearest_city  VARCHAR(80),
  status        VARCHAR(12)  NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'contacted', 'started', 'closed')),
  asked_times   INT          NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (lat IS NOT NULL OR place_text IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS area_waitlist_open_idx ON area_waitlist (status, created_at DESC);

-- Join the list. p_lat/p_lng from "Detect my location" (or NULL with p_text from the search box).
CREATE OR REPLACE FUNCTION fn_waitlist_join(p_user INT, p_name TEXT, p_phone TEXT, p_lat NUMERIC, p_lng NUMERIC, p_text TEXT)
RETURNS JSONB LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_phone TEXT := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_text  TEXT := nullif(left(trim(coalesce(p_text, '')), 120), '');
  v_km    NUMERIC;
  v_city  TEXT;
  v_old   INT;
BEGIN
  IF v_phone !~ '^[6-9]\d{9}$' THEN
    RAISE EXCEPTION 'Please enter a valid 10-digit mobile number' USING ERRCODE = '22023';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 6 AND 37.5 OR p_lng NOT BETWEEN 68 AND 97.5 THEN
    p_lat := NULL; p_lng := NULL;
    IF v_text IS NULL THEN
      RAISE EXCEPTION 'Please share your location or type your town / village' USING ERRCODE = '22023';
    END IF;
  ELSIF (SELECT franchise_id FROM fn_franchise_at(p_lat, p_lng)) IS NOT NULL THEN
    RAISE EXCEPTION 'Good news — we already deliver to this place. Choose it with "Detect my location".' USING ERRCODE = '22023';
  END IF;

  IF p_lat IS NOT NULL THEN
    SELECT f.city, fn_distance_km(f.center_lat, f.center_lng, p_lat, p_lng) INTO v_city, v_km
      FROM franchises f WHERE f.status = 'active' AND f.center_lat IS NOT NULL ORDER BY 2 LIMIT 1;
    SELECT id INTO v_old FROM area_waitlist
     WHERE phone = v_phone AND status = 'waiting' AND lat IS NOT NULL AND fn_distance_km(lat, lng, p_lat, p_lng) <= 2
     ORDER BY created_at DESC LIMIT 1;
  ELSE
    SELECT id INTO v_old FROM area_waitlist
     WHERE phone = v_phone AND status = 'waiting' AND lower(place_text) = lower(v_text) ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_old IS NOT NULL THEN
    UPDATE area_waitlist SET asked_times = asked_times + 1, updated_at = now(),
           name = coalesce(nullif(left(trim(coalesce(p_name, '')), 80), ''), name), user_id = coalesce(p_user, user_id)
     WHERE id = v_old;
    RETURN jsonb_build_object('id', v_old, 'again', true);
  END IF;

  INSERT INTO area_waitlist (user_id, name, phone, lat, lng, place_text, km_to_nearest, nearest_city)
  VALUES (p_user, nullif(left(trim(coalesce(p_name, '')), 80), ''), v_phone, p_lat, p_lng, v_text,
          round(v_km, 1), v_city)
  RETURNING id INTO v_old;
  RETURN jsonb_build_object('id', v_old, 'again', false);
END $$;

-- HQ: every request (newest first) + places grouped (~5 km squares) with how many people asked there.
CREATE OR REPLACE FUNCTION fn_waitlist_report(p_status TEXT DEFAULT 'waiting') RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  WITH w AS (
    SELECT * FROM area_waitlist WHERE p_status = 'all' OR status = p_status
  ), spots AS (
    SELECT round(avg(lat), 5) AS lat, round(avg(lng), 5) AS lng, count(*)::int AS people,
           sum(asked_times)::int AS asks, min(km_to_nearest) AS km, min(nearest_city) AS nearest_city, max(created_at) AS last_at
      FROM w WHERE lat IS NOT NULL
     GROUP BY round(lat / 0.045), round(lng / 0.045)
  )
  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'waiting', (SELECT count(*) FROM area_waitlist WHERE status = 'waiting'),
      'last_7_days', (SELECT count(*) FROM area_waitlist WHERE created_at > now() - interval '7 days'),
      'places', (SELECT count(*) FROM spots),
      'typed', (SELECT count(*) FROM w WHERE lat IS NULL)),
    'spots', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.people DESC, s.last_at DESC) FROM spots s), '[]'::jsonb),
    'cities', coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'city', f.city, 'lat', f.center_lat, 'lng', f.center_lng, 'radius_km', f.radius_km))
      FROM franchises f WHERE f.status = 'active' AND f.center_lat IS NOT NULL), '[]'::jsonb),
    'requests', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', coalesce(w.name, u.full_name), 'phone', w.phone, 'lat', w.lat, 'lng', w.lng, 'place_text', w.place_text,
        'km_to_nearest', w.km_to_nearest, 'nearest_city', w.nearest_city, 'status', w.status, 'asked_times', w.asked_times,
        'customer', u.id IS NOT NULL, 'created_at', w.created_at, 'updated_at', w.updated_at) ORDER BY w.updated_at DESC)
      FROM (SELECT * FROM w ORDER BY updated_at DESC LIMIT 500) w LEFT JOIN users u ON u.id = w.user_id), '[]'::jsonb)
  )
$$;
