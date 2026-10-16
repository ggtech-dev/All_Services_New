-- 🎉 Events (photography, decoration, catering…): the customer books with the event's date, time, venue and details;
-- only event partners (agent type events_agent) get these bookings. Re-runnable. Runs after franchise.sql.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS event_details JSONB;

CREATE OR REPLACE FUNCTION fn_is_event_service(p_service_id INT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT EXISTS (SELECT 1 FROM services s JOIN categories c ON c.id = s.category_id WHERE s.id = p_service_id AND c.slug = 'events')
$$;

-- The event types customers choose from.
CREATE OR REPLACE FUNCTION fn_event_types() RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['Wedding', 'Engagement', 'Birthday', 'Haldi / Mehendi', 'Reception', 'House warming', 'Naming ceremony',
               'Baby shower', 'Puja / Vratham', 'Anniversary', 'Corporate event', 'Other']
$$;

-- Checks the booking form and returns it cleaned up: {event_type, event_date, event_time, guests, details, label}
-- event_date YYYY-MM-DD (today … 18 months ahead), event_time HH:MM, guests 1–100000 (optional).
CREATE OR REPLACE FUNCTION fn_check_event(p JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  v_type TEXT := trim(coalesce(p->>'event_type', ''));
  v_date DATE;
  v_time TIME;
  v_guests INT;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Tell us the event date, time and venue' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_type = ANY (fn_event_types())) THEN
    RAISE EXCEPTION 'Choose the type of event' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p->>'event_date', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Choose the event date' USING ERRCODE = '22023';
  END IF;
  v_date := (p->>'event_date')::date;
  IF v_date < v_today OR v_date > v_today + 548 THEN
    RAISE EXCEPTION 'The event date must be from today up to 18 months ahead' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p->>'event_time', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' THEN
    RAISE EXCEPTION 'Choose the event start time' USING ERRCODE = '22023';
  END IF;
  v_time := (p->>'event_time')::time;
  IF v_date = v_today AND v_time < (now() AT TIME ZONE 'Asia/Kolkata')::time THEN
    RAISE EXCEPTION 'That time has already passed today' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p->>'guests', '') <> '' THEN
    IF p->>'guests' !~ '^\d{1,6}$' OR (p->>'guests')::int NOT BETWEEN 1 AND 100000 THEN
      RAISE EXCEPTION 'Enter the number of guests (or leave it empty)' USING ERRCODE = '22023';
    END IF;
    v_guests := (p->>'guests')::int;
  END IF;
  RETURN jsonb_build_object(
    'event_type', v_type, 'event_date', v_date, 'event_time', to_char(v_time, 'HH24:MI'), 'guests', v_guests,
    'details', nullif(left(trim(regexp_replace(coalesce(p->>'details', ''), '\s+', ' ', 'g')), 600), ''),
    -- shown as the booking time everywhere: "Sat 12 Dec 2026, 6:30 PM"
    'label', to_char(v_date, 'Dy DD Mon YYYY') || ', ' || ltrim(to_char(v_time, 'HH12:MI AM'), '0'));
END $$;
