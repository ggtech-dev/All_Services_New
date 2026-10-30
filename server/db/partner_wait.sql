-- ⏳ Honest waiting (the way Swiggy / Zomato tell you "all our partners are busy"): while an order waits for an agent,
-- the customer sees the truth — how many partners of that type are online in the city, whether all of them are busy,
-- how many orders are ahead in the line, and a wait time only when we have real past deliveries to base it on.
-- Waiting orders are the queue: an agent holds one "now" order at a time (agent_max_active_orders, orders.sql); the
-- moment they deliver, the waiting orders show again in their app, nearest first.
-- state: 'free' (a partner is free, will take it soon) · 'busy' (all online partners are on other orders)
--      · 'none' (no partner of this type is online right now) · 'later' (booked for a later time, nothing to wait for)
-- NULL when the order is not waiting (taken, delivered, cancelled).
CREATE OR REPLACE FUNCTION fn_order_wait(p_order INT) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  o orders;
  v_online INT;
  v_free INT;
  v_ahead INT;
  v_avg NUMERIC;
  v_n INT;
  v_wait INT;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order;
  IF NOT FOUND OR o.status <> 'placed' OR o.agent_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF fn_order_due_at(o) > now() + interval '3 hours' THEN
    RETURN jsonb_build_object('state', 'later');
  END IF;

  -- partners who could take this order: same city, this type, active, online, allowed (subscription, car model…)
  SELECT count(*)::int,
         count(*) FILTER (WHERE fn_agent_active_count(a.user_id) < fn_setting_num('agent_max_active_orders', 1))::int
    INTO v_online, v_free
    FROM agents a
   WHERE a.franchise_id = o.franchise_id AND a.status = 'active' AND a.is_online
     AND o.skill_code = ANY (a.skills) AND fn_agent_may_take(a.user_id, o.id);

  -- orders of the same type in the same city that came first and are still waiting (only the "now" ones)
  SELECT count(*)::int INTO v_ahead
    FROM orders x
   WHERE x.franchise_id = o.franchise_id AND x.skill_code = o.skill_code AND x.status = 'placed' AND x.agent_id IS NULL
     AND (x.created_at, x.id) < (o.created_at, o.id) AND fn_order_due_at(x) <= now() + interval '3 hours';

  -- how long an order of this type takes from "accepted" to "delivered" here (last 30 days) — no guess without data
  SELECT avg(extract(epoch FROM delivered_at - assigned_at) / 60), count(*)::int INTO v_avg, v_n
    FROM orders
   WHERE franchise_id = o.franchise_id AND skill_code = o.skill_code AND status = 'delivered'
     AND assigned_at IS NOT NULL AND delivered_at > assigned_at AND delivered_at > now() - interval '30 days'
     AND event_details IS NULL AND trip_details IS NULL AND visit_details IS NULL;
  IF v_online > 0 AND v_free = 0 AND v_n >= 5 THEN
    -- every partner finishes one order, then the line moves by as many orders as there are partners
    v_wait := greatest(5, ceil((v_ahead / v_online + 1) * least(v_avg, 120) / 5) * 5)::int;
  END IF;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_online = 0 THEN 'none' WHEN v_free = 0 THEN 'busy' ELSE 'free' END,
    'online', v_online, 'free', v_free, 'busy', v_online - v_free, 'ahead', v_ahead, 'wait_min', v_wait);
END $$;

-- ⚡ waiting orders are looked up by city + agent type many times a second (every agent's list, every "busy" note):
-- a small index of only the waiting ones keeps that quick when hundreds wait at once.
CREATE INDEX IF NOT EXISTS orders_waiting_idx ON orders (franchise_id, skill_code, created_at) WHERE status = 'placed' AND agent_id IS NULL;
