-- ⏰ Overdue orders: open orders nobody took (or finished) in time. The franchise admin sees a red "Overdue" badge
-- and decides (call the customer, assign, cancel) — nothing is cancelled automatically. Agents stop being offered an
-- order 24 hours after it became overdue (routes/agent.js). Re-runnable; runs after every other file.

-- End of a delivery slot, India time. Understands every slot text the apps make:
--   "Today 7–9 PM", "Tomorrow 11 AM–1 PM"            (checkout times, day = the day the order was placed)
--   "Thu 1 Oct, 6 AM – 7 AM"                          (daily-fresh windows, daily_fresh.sql)
--   "Sat 24 Oct 2026, 5:00 AM"                        (event / car / visit date and time)
-- NULL for "As soon as possible", "Now — within 15 min" and anything else.
CREATE OR REPLACE FUNCTION fn_slot_end(p_slot TEXT, p_placed TIMESTAMPTZ) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  v_base DATE := (p_placed AT TIME ZONE 'Asia/Kolkata')::date;
  v_day  DATE;
  m      TEXT[];
  t      TEXT[];
BEGIN
  IF p_slot IS NULL THEN
    RETURN NULL;
  ELSIF p_slot ~ '^Today\M' THEN
    v_day := v_base;
  ELSIF p_slot ~ '^Tomorrow\M' THEN
    v_day := v_base + 1;
  ELSE
    m := regexp_match(p_slot, '^[A-Za-z]{3},? (\d{1,2}) ([A-Za-z]{3})(?: (\d{4}))?,');
    IF m IS NULL THEN
      RETURN NULL;
    END IF;
    BEGIN
      v_day := to_date(m[1] || ' ' || m[2] || ' ' || coalesce(m[3], extract(year FROM v_base)::text), 'DD Mon YYYY');
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
    IF m[3] IS NULL AND v_day < v_base - 1 THEN
      v_day := (v_day + interval '1 year')::date; -- "Fri 1 Jan" chosen on 31 Dec
    END IF;
  END IF;
  -- the last time in the text is when the slot ends ("7–9 PM" → 9 PM)
  t := regexp_match(p_slot, '^.*[^\d:](\d{1,2})(?::(\d{2}))? ?(AM|PM)\s*$');
  IF t IS NULL THEN
    RETURN (v_day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata';
  END IF;
  RETURN (v_day + make_interval(hours => t[1]::int % 12 + CASE WHEN t[3] = 'PM' THEN 12 ELSE 0 END, mins => coalesce(t[2], '0')::int))
         AT TIME ZONE 'Asia/Kolkata';
END $$;

-- When an open order becomes overdue if nobody has taken it:
--   event / car / home-visit bookings: the end of their date · village orders: the end of their delivery day
--   a chosen time slot: 1 hour after it ends · "As soon as possible" / instant: 1 hour after it was placed
CREATE OR REPLACE FUNCTION fn_order_due_at(o orders) RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT CASE
    WHEN o.event_details->>'event_date' ~ '^\d{4}-\d{2}-\d{2}$' THEN ((o.event_details->>'event_date')::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
    WHEN o.trip_details->>'trip_date' ~ '^\d{4}-\d{2}-\d{2}$' THEN ((o.trip_details->>'trip_date')::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
    WHEN o.visit_details->>'visit_date' ~ '^\d{4}-\d{2}-\d{2}$' THEN ((o.visit_details->>'visit_date')::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
    WHEN o.deliver_on IS NOT NULL THEN (o.deliver_on + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'
    ELSE coalesce(fn_slot_end(o.slot, o.created_at), o.created_at) + interval '1 hour'
  END
$$;

-- 'not_taken' (still waiting for an agent after it was due) · 'not_delivered' (taken, but still not done 2 hours
-- after it was due) · NULL (on time, or finished)
CREATE OR REPLACE FUNCTION fn_order_overdue(o orders) RETURNS TEXT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT CASE
    WHEN o.status = 'placed' AND now() > fn_order_due_at(o) THEN 'not_taken'
    WHEN o.status IN ('assigned', 'picked_up') AND now() > fn_order_due_at(o) + interval '2 hours' THEN 'not_delivered'
  END
$$;
