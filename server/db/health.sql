-- 💊 Health: two services. Re-runnable. Runs after vehicle.sql.
--  * Medicine Delivery: like kirana — the customer writes the medicines / sends a photo of the doctor's prescription,
--    the partner buys at a medical shop, uploads the bill (+ shop UPI QR), the customer pays the shop, partner delivers.
--  * 🏠 Home Doctor Visit: a group of types (RMP, General Physician, Nurse, BP check…). Each type is a service with
--    services.parent_id = Home Doctor Visit, taken only by doctor partners (doctor_type) subscribed to that type in
--    the customer's city. The customer asks for "now" or a date & time; the fee is agreed with the doctor directly.

ALTER TABLE services ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS icon VARCHAR(8); -- emoji for a type in a group (🩺, 💉…)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS visit_details JSONB;

-- Checks the "when" of a home visit: {mode:'now'} or {mode:'schedule', visit_date:'YYYY-MM-DD', visit_time:'HH:MM'}.
-- Returns {mode, visit_date, visit_time, label}; label is the booking time shown everywhere.
CREATE OR REPLACE FUNCTION fn_check_visit(p JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  v_mode TEXT := coalesce(p->>'mode', '');
  v_date DATE;
  v_time TIME;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF v_mode = 'now' THEN
    RETURN jsonb_build_object('mode', 'now', 'label', 'Now — as soon as possible');
  END IF;
  IF v_mode <> 'schedule' THEN
    RAISE EXCEPTION 'Choose when: now, or a date and time' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p->>'visit_date', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Choose the date' USING ERRCODE = '22023';
  END IF;
  v_date := (p->>'visit_date')::date;
  IF v_date < v_today OR v_date > v_today + 60 THEN
    RAISE EXCEPTION 'The date must be from today up to 2 months ahead' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p->>'visit_time', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' THEN
    RAISE EXCEPTION 'Choose the time' USING ERRCODE = '22023';
  END IF;
  v_time := (p->>'visit_time')::time;
  IF v_date = v_today AND v_time < (now() AT TIME ZONE 'Asia/Kolkata')::time THEN
    RAISE EXCEPTION 'That time has already passed today' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('mode', 'schedule', 'visit_date', v_date, 'visit_time', to_char(v_time, 'HH24:MI'),
    'label', to_char(v_date, 'Dy DD Mon YYYY') || ', ' || ltrim(to_char(v_time, 'HH12:MI AM'), '0'));
END $$;

-- The types under a group service (Home Doctor Visit) and how many partners can take each one in a city right now
-- (active agent of that type, in that franchise, with an active subscription when the type needs one).
CREATE OR REPLACE FUNCTION fn_service_children(p_parent INT, p_franchise INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'slug', s.slug, 'name', s.name, 'description', s.description, 'icon', s.icon,
           'image_url', s.image_url, 'price_unit', s.price_unit,
           'available', (SELECT count(*) FROM agents a
                          WHERE a.status = 'active' AND s.skill_code = ANY (a.skills)
                            AND a.franchise_id IS NOT DISTINCT FROM p_franchise
                            AND (NOT (fn_sub_terms(p_franchise, s.id)).required OR fn_subscription_active(a.user_id, s.id))))
         ORDER BY s.sort_order, s.name), '[]'::jsonb)
    FROM services s
   WHERE s.parent_id = p_parent AND s.is_active AND fn_service_visible(p_franchise, s.id)
$$;
