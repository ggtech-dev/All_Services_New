-- 📍 Location rules. Each franchise serves a circle: its centre point (set by HQ on the map) and a range (25 km by
-- default, franchises.radius_km). Re-runnable; runs after every other file.
--   Customers: an order needs the delivery location (GPS or a pin on the map). It goes to the nearest active franchise
--              whose range covers that location — the chosen area must belong to that franchise.
--   Agents:    get and accept orders only while they are inside their own franchise's range.
--   Areas:     HQ adds areas and villages; a franchise asks for a new one (or to switch one off) in Requests to HQ.

-- The nearest active franchise whose range covers this point (both NULL: none — we don't serve there yet).
CREATE OR REPLACE FUNCTION fn_franchise_at(p_lat NUMERIC, p_lng NUMERIC, OUT franchise_id INT, OUT km NUMERIC)
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT f.id, fn_distance_km(f.center_lat, f.center_lng, p_lat, p_lng)
    FROM franchises f
   WHERE f.status = 'active' AND f.center_lat IS NOT NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL
     AND fn_distance_km(f.center_lat, f.center_lng, p_lat, p_lng) <= f.radius_km
   ORDER BY 2, f.id
   LIMIT 1
$$;

-- Checks the delivery location of a new order (p_contact: {lat, lng, locality_id}) — called by fn_place_order.
CREATE OR REPLACE FUNCTION fn_check_order_location(p_contact JSONB) RETURNS VOID
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  v_lat  NUMERIC := CASE WHEN p_contact->>'lat' ~ '^-?\d{1,3}(\.\d+)?$' THEN (p_contact->>'lat')::numeric END;
  v_lng  NUMERIC := CASE WHEN p_contact->>'lng' ~ '^-?\d{1,3}(\.\d+)?$' THEN (p_contact->>'lng')::numeric END;
  v_area INT := CASE WHEN p_contact->>'locality_id' ~ '^\d{1,9}$' THEN (p_contact->>'locality_id')::int END;
  v_at   RECORD;
  v_city TEXT;
BEGIN
  IF v_lat IS NULL OR v_lng IS NULL OR v_lat NOT BETWEEN 6 AND 37.5 OR v_lng NOT BETWEEN 68 AND 97.5 THEN
    RAISE EXCEPTION 'Please share your delivery location: tap "Use my current location" or set the pin on the map' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_at FROM fn_franchise_at(v_lat, v_lng);
  IF v_at.franchise_id IS NULL THEN
    RAISE EXCEPTION 'Sorry, All Services does not deliver to your location yet.' USING ERRCODE = '22023';
  END IF;
  IF v_at.franchise_id IS DISTINCT FROM (SELECT franchise_id FROM localities WHERE id = v_area) THEN
    SELECT city INTO v_city FROM franchises WHERE id = v_at.franchise_id;
    RAISE EXCEPTION 'Your location is in our % service zone — please choose one of its areas', v_city USING ERRCODE = '22023';
  END IF;
END $$;

-- Where an agent is for the zone check: live GPS (under 10 minutes old), otherwise the centre of their chosen area.
-- inside = within their franchise's range (a franchise without a centre yet: no limit).
CREATE OR REPLACE FUNCTION fn_agent_zone(p_agent INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object(
           'city', f.city, 'radius_km', f.radius_km, 'km', d.km, 'from', p.src,
           'inside', f.center_lat IS NULL OR (d.km IS NOT NULL AND d.km <= f.radius_km))
    FROM agents a
    JOIN franchises f ON f.id = a.franchise_id
    LEFT JOIN localities l ON l.id = a.locality_id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN a.last_location_at > now() - interval '10 minutes' THEN a.last_lat ELSE l.lat END AS lat,
             CASE WHEN a.last_location_at > now() - interval '10 minutes' THEN a.last_lng ELSE l.lng END AS lng,
             CASE WHEN a.last_location_at > now() - interval '10 minutes' THEN 'gps' ELSE 'area' END AS src) p
    CROSS JOIN LATERAL (SELECT CASE WHEN f.center_lat IS NOT NULL AND p.lat IS NOT NULL
                                    THEN fn_distance_km(f.center_lat, f.center_lng, p.lat, p.lng) END AS km) d
   WHERE a.user_id = p_agent
$$;

CREATE OR REPLACE FUNCTION fn_agent_in_zone(p_agent INT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce((fn_agent_zone(p_agent)->>'inside')::boolean, true)
$$;

-- ---------- 🗺️ areas: HQ sets them; a franchise asks ----------
-- p: {kind: 'area', name, lat, lng, pincode?, village_band? (1 = up to 10 km, 2 = 10–15 km; none = town area), details?}
--    {kind: 'area_off', locality_id, details?}
CREATE OR REPLACE FUNCTION fn_request_area(p_franchise INT, p_by INT, p JSONB) RETURNS catalog_requests
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v      catalog_requests;
  f      franchises;
  v_kind TEXT := p->>'kind';
  v_name TEXT := nullif(left(trim(regexp_replace(coalesce(p->>'name', ''), '\s+', ' ', 'g')), 80), '');
  v_lat  NUMERIC := CASE WHEN p->>'lat' ~ '^-?\d{1,3}(\.\d+)?$' THEN round((p->>'lat')::numeric, 6) END;
  v_lng  NUMERIC := CASE WHEN p->>'lng' ~ '^-?\d{1,3}(\.\d+)?$' THEN round((p->>'lng')::numeric, 6) END;
  v_band INT := CASE WHEN p->>'village_band' IN ('1', '2') THEN (p->>'village_band')::int END;
  v_pin  TEXT := nullif(trim(coalesce(p->>'pincode', '')), '');
  v_area INT := CASE WHEN p->>'locality_id' ~ '^\d{1,9}$' THEN (p->>'locality_id')::int END;
  v_km   NUMERIC;
BEGIN
  SELECT * INTO f FROM franchises WHERE id = p_franchise;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Franchise not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_kind = 'area' THEN
    IF v_name IS NULL OR length(v_name) < 2 THEN
      RAISE EXCEPTION 'Write the name of the area or village' USING ERRCODE = '22023';
    END IF;
    IF v_lat IS NULL OR v_lng IS NULL OR v_lat NOT BETWEEN 6 AND 37.5 OR v_lng NOT BETWEEN 68 AND 97.5 THEN
      RAISE EXCEPTION 'Tap the map to show where it is' USING ERRCODE = '22023';
    END IF;
    IF v_pin IS NOT NULL AND v_pin !~ '^[1-9]\d{5}$' THEN
      RAISE EXCEPTION 'PIN code must be 6 digits' USING ERRCODE = '22023';
    END IF;
    IF f.center_lat IS NOT NULL THEN
      v_km := fn_distance_km(f.center_lat, f.center_lng, v_lat, v_lng);
      IF v_km > f.radius_km THEN
        RAISE EXCEPTION 'That place is % km from the centre of % — outside the % km service range', v_km, f.city, f.radius_km USING ERRCODE = '22023';
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM localities WHERE franchise_id = p_franchise AND lower(name) = lower(v_name)) THEN
      RAISE EXCEPTION '% is already one of your areas', v_name USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM catalog_requests WHERE franchise_id = p_franchise AND status = 'pending' AND kind = 'area' AND lower(name) = lower(v_name)) THEN
      RAISE EXCEPTION 'You have already asked for this — it is waiting for approval' USING ERRCODE = '55000';
    END IF;
    INSERT INTO catalog_requests (franchise_id, kind, name, area_lat, area_lng, area_pincode, village_band, details, requested_by)
    VALUES (p_franchise, 'area', v_name, v_lat, v_lng, v_pin, v_band, nullif(left(trim(coalesce(p->>'details', '')), 500), ''), p_by)
    RETURNING * INTO v;
  ELSIF v_kind = 'area_off' THEN
    IF NOT EXISTS (SELECT 1 FROM localities WHERE id = v_area AND franchise_id = p_franchise AND is_active) THEN
      RAISE EXCEPTION 'Choose one of your areas that is on now' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM catalog_requests WHERE franchise_id = p_franchise AND status = 'pending' AND kind = 'area_off' AND locality_id = v_area) THEN
      RAISE EXCEPTION 'You have already asked for this — it is waiting for approval' USING ERRCODE = '55000';
    END IF;
    INSERT INTO catalog_requests (franchise_id, kind, locality_id, name, details, requested_by)
    VALUES (p_franchise, 'area_off', v_area, (SELECT name FROM localities WHERE id = v_area),
            nullif(left(trim(coalesce(p->>'details', '')), 500), ''), p_by)
    RETURNING * INTO v;
  ELSE
    RAISE EXCEPTION 'Choose: a new area / village, or switch an area off' USING ERRCODE = '22023';
  END IF;
  RETURN v;
END $$;

-- HQ approves any request: services / products (franchise.sql) or areas — a new area or village is made in that
-- franchise, or the area is switched off (old orders keep it).
CREATE OR REPLACE FUNCTION fn_approve_request(p_id INT, p_by INT, p_note TEXT) RETURNS catalog_requests
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  r catalog_requests;
  l localities;
BEGIN
  SELECT * INTO r FROM catalog_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002';
  END IF;
  IF r.kind IN ('service', 'product') THEN
    RETURN fn_approve_catalog_request(p_id, p_by, p_note);
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'This request was already %', r.status USING ERRCODE = '55000';
  END IF;
  IF r.kind = 'area' THEN
    l := fn_save_locality(NULL, r.name, r.area_pincode, r.area_lat, r.area_lng, true, r.franchise_id, r.village_band IS NOT NULL, r.village_band);
    UPDATE catalog_requests SET locality_id = l.id WHERE id = r.id;
  ELSIF r.kind = 'area_off' THEN
    UPDATE localities SET is_active = false WHERE id = r.locality_id AND franchise_id = r.franchise_id;
  ELSE
    PERFORM fn_approve_popular_request(r); -- ⭐ the home page's popular row (popular.sql)
  END IF;
  UPDATE catalog_requests SET status = 'approved', decided_by = p_by, decided_at = now(),
         admin_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   WHERE id = r.id RETURNING * INTO r;
  RETURN r;
END $$;
