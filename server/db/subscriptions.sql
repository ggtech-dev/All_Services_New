-- Subscription services. Re-runnable. Runs after shopping_list.sql.
-- A franchise admin can make a service "subscription only" (e.g. Plumber on Demand, ₹499 / 30 days): its orders then go
-- only to agents with an active subscription for it. Agents request a subscription in their app (and can pay their
-- franchise and type the reference); the franchise admin calls them, checks the payment and activates it. Activating also
-- gives the agent that type of work. A subscription simply stops working after its paid-until date.
-- Each franchise (dealer) sets the terms for its own city in franchise_services (subscription only?, fee, days);
-- where it hasn't, the default on the service applies. Only the franchise admin manages them; HQ only watches.

ALTER TABLE services ADD COLUMN IF NOT EXISTS subscription_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS subscription_fee      NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS subscription_days     INT NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS agent_subscriptions (
  id                SERIAL PRIMARY KEY,
  agent_id          INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id        INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  status            VARCHAR(12) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'active', 'rejected', 'stopped')),
  paid_until        TIMESTAMPTZ,
  pending_renewal   BOOLEAN NOT NULL DEFAULT false,   -- an active member asked to renew
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent_payment_ref VARCHAR(60),                      -- UPI reference the agent typed after paying
  agent_note        VARCHAR(200),
  admin_note        VARCHAR(200),
  decided_by        INT REFERENCES users(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, service_id)
);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id              SERIAL PRIMARY KEY,
  subscription_id INT NOT NULL REFERENCES agent_subscriptions(id) ON DELETE CASCADE,
  amount          NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  mode            VARCHAR(10) NOT NULL CHECK (mode IN ('upi', 'cash', 'other', 'free')),
  reference       VARCHAR(60),
  days            INT NOT NULL CHECK (days > 0),
  paid_until      TIMESTAMPTZ NOT NULL,
  received_by     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_payments_sub_idx ON subscription_payments(subscription_id);

-- ============ who may take an order ============

-- The subscription terms in one franchise (city): its own, or the HQ default on the service.
CREATE OR REPLACE FUNCTION fn_sub_terms(p_franchise INT, p_service_id INT, OUT required BOOLEAN, OUT fee NUMERIC, OUT days INT)
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(fs.sub_required, s.subscription_required), coalesce(fs.sub_fee, s.subscription_fee), coalesce(fs.sub_days, s.subscription_days)
    FROM services s LEFT JOIN franchise_services fs ON fs.service_id = s.id AND fs.franchise_id = p_franchise
   WHERE s.id = p_service_id
$$;

CREATE OR REPLACE FUNCTION fn_agent_franchise(p_agent_id INT) RETURNS INT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT franchise_id FROM agents WHERE user_id = p_agent_id
$$;

CREATE OR REPLACE FUNCTION fn_subscription_active(p_agent_id INT, p_service_id INT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT EXISTS (SELECT 1 FROM agent_subscriptions
                  WHERE agent_id = p_agent_id AND service_id = p_service_id AND status = 'active' AND paid_until >= now())
$$;

-- The services in an order (bookings, own-list lines and products).
CREATE OR REPLACE FUNCTION fn_order_services(p_order_id INT) RETURNS INT[]
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(array_agg(DISTINCT coalesce(i.service_id, p.service_id)), ARRAY[]::INT[])
    FROM order_items i LEFT JOIN products p ON p.id = i.product_id
   WHERE i.order_id = p_order_id
$$;

-- An agent may take an order unless it has a "subscription only" service they are not subscribed to.
-- Checked live, so switching a service's subscription off (or a subscription ending) takes effect at once.
-- (car_rental.sql replaces this with the same rules + the car rule for Car Rental bookings — change both together)
CREATE OR REPLACE FUNCTION fn_agent_may_take(p_agent_id INT, p_order_id INT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT (SELECT a.franchise_id FROM agents a WHERE a.user_id = p_agent_id)
           IS NOT DISTINCT FROM (SELECT o.franchise_id FROM orders o WHERE o.id = p_order_id)
     AND NOT EXISTS (SELECT 1 FROM unnest(fn_order_services(p_order_id)) sid
                      WHERE (fn_sub_terms((SELECT o.franchise_id FROM orders o WHERE o.id = p_order_id), sid)).required
                        AND NOT fn_subscription_active(p_agent_id, sid))
$$;

-- ============ admin: which services are subscription only ============

CREATE OR REPLACE PROCEDURE sp_set_service_subscription(p_service_id INT, p_required BOOLEAN, p_fee NUMERIC, p_days INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF p_fee IS NULL OR p_fee < 0 OR p_fee > 100000 THEN
    RAISE EXCEPTION 'Subscription fee must be between ₹0 and ₹1,00,000' USING ERRCODE = '22023';
  END IF;
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 366 THEN
    RAISE EXCEPTION 'Subscription period must be 1 to 366 days' USING ERRCODE = '22023';
  END IF;
  UPDATE services SET subscription_required = coalesce(p_required, false), subscription_fee = round(p_fee, 2), subscription_days = p_days
   WHERE id = p_service_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- A franchise sets the terms for its own city. p_reset = back to the HQ default.
CREATE OR REPLACE PROCEDURE sp_set_franchise_subscription(p_franchise INT, p_service_id INT, p_required BOOLEAN, p_fee NUMERIC,
                                                          p_days INT, p_reset BOOLEAN DEFAULT false)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT coalesce(p_reset, false) THEN
    IF p_fee IS NULL OR p_fee < 0 OR p_fee > 100000 THEN
      RAISE EXCEPTION 'Subscription fee must be between ₹0 and ₹1,00,000' USING ERRCODE = '22023';
    END IF;
    IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 366 THEN
      RAISE EXCEPTION 'Subscription period must be 1 to 366 days' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE franchise_services
     SET sub_required = CASE WHEN p_reset THEN NULL ELSE coalesce(p_required, false) END,
         sub_fee = CASE WHEN p_reset THEN NULL ELSE round(p_fee, 2) END,
         sub_days = CASE WHEN p_reset THEN NULL ELSE p_days END
   WHERE franchise_id = p_franchise AND service_id = p_service_id AND is_enabled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This service is not on in this city' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- ============ agent: request / renew ============

-- p_payment_ref: the UPI reference if the agent already paid the company UPI (optional).
CREATE OR REPLACE PROCEDURE sp_agent_request_subscription(p_agent_id INT, p_service_id INT, p_payment_ref TEXT, p_note TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  s  agent_subscriptions;
  sv services;
  v_ref TEXT := nullif(left(trim(coalesce(p_payment_ref, '')), 60), '');
  v_note TEXT := nullif(left(trim(coalesce(p_note, '')), 200), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agents WHERE user_id = p_agent_id AND status = 'active') THEN
    RAISE EXCEPTION 'Your account must be approved first' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO sv FROM services WHERE id = p_service_id AND is_active AND (fn_sub_terms(fn_agent_franchise(p_agent_id), id)).required;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This service has no subscription' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM agent_subscriptions WHERE agent_id = p_agent_id AND service_id = p_service_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO agent_subscriptions (agent_id, service_id, status, agent_payment_ref, agent_note)
    VALUES (p_agent_id, p_service_id, 'requested', v_ref, v_note);
  ELSIF s.status = 'active' AND s.paid_until >= now() THEN
    -- renewal: stays active; the admin extends it after payment
    IF s.paid_until > now() + interval '7 days' THEN
      RAISE EXCEPTION 'Your subscription is active until %. You can renew in its last 7 days.',
        to_char(s.paid_until AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') USING ERRCODE = '55000';
    END IF;
    UPDATE agent_subscriptions SET pending_renewal = true, requested_at = now(), agent_payment_ref = coalesce(v_ref, agent_payment_ref),
                                   agent_note = coalesce(v_note, agent_note)
     WHERE id = s.id;
  ELSE
    -- new request after a rejection, a stop or an expired subscription
    UPDATE agent_subscriptions SET status = 'requested', pending_renewal = false, requested_at = now(),
                                   agent_payment_ref = v_ref, agent_note = v_note, admin_note = NULL
     WHERE id = s.id;
  END IF;
END $$;

-- ============ admin: activate / renew, reject, stop ============

-- Records the payment and makes the subscription active until (later of now / current end) + p_days.
-- The agent also gets the service's type of work ("joins as plumber").
CREATE OR REPLACE FUNCTION fn_admin_activate_subscription(p_sub_id INT, p_amount NUMERIC, p_mode TEXT, p_reference TEXT,
                                                         p_days INT, p_admin_id INT) RETURNS agent_subscriptions
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  s   agent_subscriptions;
  v_until TIMESTAMPTZ;
  v_skill TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 100000 THEN
    RAISE EXCEPTION 'Enter the amount received (₹0 for free)' USING ERRCODE = '22023';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('upi', 'cash', 'other', 'free') THEN
    RAISE EXCEPTION 'Choose how it was paid: UPI, cash, other or free' USING ERRCODE = '22023';
  END IF;
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 366 THEN
    RAISE EXCEPTION 'Period must be 1 to 366 days' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM agent_subscriptions WHERE id = p_sub_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agents WHERE user_id = s.agent_id AND status = 'active') THEN
    RAISE EXCEPTION 'This agent is not active (approve or re-activate them first)' USING ERRCODE = '55000';
  END IF;

  v_until := greatest(coalesce(CASE WHEN s.status = 'active' THEN s.paid_until END, now()), now()) + make_interval(days => p_days);
  UPDATE agent_subscriptions
     SET status = 'active', paid_until = v_until, pending_renewal = false, decided_by = p_admin_id, decided_at = now(),
         admin_note = NULL
   WHERE id = s.id RETURNING * INTO s;
  INSERT INTO subscription_payments (subscription_id, amount, mode, reference, days, paid_until, received_by)
  VALUES (s.id, round(p_amount, 2), p_mode, nullif(left(trim(coalesce(p_reference, '')), 60), ''), p_days, v_until, p_admin_id);

  SELECT skill_code INTO v_skill FROM services WHERE id = s.service_id;
  UPDATE agents SET skills = array_append(skills, v_skill) WHERE user_id = s.agent_id AND NOT (v_skill = ANY (skills));
  RETURN s;
END $$;

-- The admin adds a subscription for an agent directly (e.g. after a phone call), paid or free.
CREATE OR REPLACE FUNCTION fn_admin_add_subscription(p_agent_id INT, p_service_id INT, p_amount NUMERIC, p_mode TEXT,
                                                    p_reference TEXT, p_days INT, p_admin_id INT) RETURNS agent_subscriptions
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_id INT;
BEGIN
  IF NOT coalesce((fn_sub_terms(fn_agent_franchise(p_agent_id), p_service_id)).required, false) THEN
    RAISE EXCEPTION 'Turn on "subscription only" for this service first' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agents WHERE user_id = p_agent_id) THEN
    RAISE EXCEPTION 'Agent not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO agent_subscriptions (agent_id, service_id, status) VALUES (p_agent_id, p_service_id, 'requested')
  ON CONFLICT (agent_id, service_id) DO UPDATE SET agent_id = EXCLUDED.agent_id
  RETURNING id INTO v_id;
  RETURN fn_admin_activate_subscription(v_id, p_amount, p_mode, p_reference, p_days, p_admin_id);
END $$;

-- Reject a new request, or turn down a renewal request (the current period keeps running).
CREATE OR REPLACE PROCEDURE sp_admin_reject_subscription(p_sub_id INT, p_reason TEXT, p_admin_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  s agent_subscriptions;
BEGIN
  SELECT * INTO s FROM agent_subscriptions WHERE id = p_sub_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription not found' USING ERRCODE = 'P0002';
  END IF;
  IF s.status = 'requested' THEN
    UPDATE agent_subscriptions SET status = 'rejected', admin_note = nullif(left(trim(coalesce(p_reason, '')), 200), ''),
                                   decided_by = p_admin_id, decided_at = now()
     WHERE id = s.id;
  ELSIF s.pending_renewal THEN
    UPDATE agent_subscriptions SET pending_renewal = false, admin_note = nullif(left(trim(coalesce(p_reason, '')), 200), '')
     WHERE id = s.id;
  ELSE
    RAISE EXCEPTION 'There is no request to reject' USING ERRCODE = '55000';
  END IF;
END $$;

-- Stop at once (e.g. complaints, refund): the agent stops getting these orders now.
CREATE OR REPLACE PROCEDURE sp_admin_stop_subscription(p_sub_id INT, p_reason TEXT, p_admin_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  UPDATE agent_subscriptions SET status = 'stopped', pending_renewal = false,
                                 admin_note = nullif(left(trim(coalesce(p_reason, '')), 200), ''), decided_by = p_admin_id, decided_at = now()
   WHERE id = p_sub_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only an active subscription can be stopped' USING ERRCODE = '55000';
  END IF;
END $$;

-- ============ lists ============

-- What a subscription looks like right now: requested / active / expiring (≤ 5 days left) / expired / rejected / stopped.
CREATE OR REPLACE FUNCTION fn_subscription_state(s agent_subscriptions) RETURNS TEXT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT CASE
    WHEN s.status = 'active' AND s.paid_until < now() THEN 'expired'
    WHEN s.status = 'active' AND s.paid_until < now() + interval '5 days' THEN 'expiring'
    ELSE s.status END
$$;

DROP FUNCTION IF EXISTS fn_admin_subscriptions();
CREATE OR REPLACE FUNCTION fn_admin_subscriptions(p_franchise INT DEFAULT NULL) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'agent_id', s.agent_id, 'agent_name', u.full_name, 'agent_phone', u.phone, 'agent_username', u.username,
           'service_id', s.service_id, 'service_name', sv.name, 'fee', (fn_sub_terms(a.franchise_id, sv.id)).fee,
           'days', (fn_sub_terms(a.franchise_id, sv.id)).days, 'franchise_id', a.franchise_id, 'franchise_city', f.city,
           'status', s.status, 'state', fn_subscription_state(s), 'paid_until', s.paid_until,
           'days_left', CASE WHEN s.paid_until IS NOT NULL THEN greatest(0, ceil(extract(epoch FROM s.paid_until - now()) / 86400))::int END,
           'pending_renewal', s.pending_renewal, 'requested_at', s.requested_at,
           'agent_payment_ref', s.agent_payment_ref, 'agent_note', s.agent_note, 'admin_note', s.admin_note,
           'payments', (SELECT coalesce(jsonb_agg(jsonb_build_object('amount', p.amount, 'mode', p.mode, 'reference', p.reference,
                                                                    'days', p.days, 'created_at', p.created_at) ORDER BY p.id DESC), '[]')
                          FROM subscription_payments p WHERE p.subscription_id = s.id),
           'total_paid', (SELECT coalesce(sum(p.amount), 0) FROM subscription_payments p WHERE p.subscription_id = s.id))
         ORDER BY (s.status = 'requested' OR s.pending_renewal) DESC, s.paid_until NULLS FIRST, s.requested_at DESC), '[]'::jsonb)
    FROM agent_subscriptions s JOIN users u ON u.id = s.agent_id JOIN services sv ON sv.id = s.service_id
    JOIN agents a ON a.user_id = s.agent_id LEFT JOIN franchises f ON f.id = a.franchise_id
   WHERE p_franchise IS NULL OR a.franchise_id = p_franchise
$$;

-- For the admin sidebar: requests to handle, members ending soon.
DROP FUNCTION IF EXISTS fn_subscription_counts();
CREATE OR REPLACE FUNCTION fn_subscription_counts(p_franchise INT DEFAULT NULL) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object(
    'pending_subscriptions', (SELECT count(*) FROM agent_subscriptions WHERE (status = 'requested' OR pending_renewal)
                                AND (p_franchise IS NULL OR agent_id IN (SELECT user_id FROM agents WHERE franchise_id = p_franchise))),
    'expiring_subscriptions', (SELECT count(*) FROM agent_subscriptions s WHERE fn_subscription_state(s) = 'expiring'
                                AND (p_franchise IS NULL OR s.agent_id IN (SELECT user_id FROM agents WHERE franchise_id = p_franchise))))
$$;

-- The agent's page: every subscription service, and where the agent stands with each.
CREATE OR REPLACE FUNCTION fn_agent_subscriptions(p_agent_id INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'service_id', sv.id, 'service_name', sv.name, 'service_icon', c.icon, 'fee', (fn_sub_terms(ag.franchise_id, sv.id)).fee,
           'days', (fn_sub_terms(ag.franchise_id, sv.id)).days,
           'skill_name', t.name, 'agent_title', t.agent_title,
           'id', s.id, 'state', CASE WHEN s.id IS NULL THEN 'none' ELSE fn_subscription_state(s) END,
           'paid_until', s.paid_until, 'pending_renewal', coalesce(s.pending_renewal, false), 'admin_note', s.admin_note,
           'agent_payment_ref', s.agent_payment_ref,
           -- the agent pays their own franchise (dealer), who activates it
           'franchise_name', fr.name, 'franchise_city', fr.city, 'franchise_phone', fr.phone,
           'days_left', CASE WHEN s.paid_until IS NOT NULL THEN greatest(0, ceil(extract(epoch FROM s.paid_until - now()) / 86400))::int END,
           'open_orders', (SELECT count(*) FROM orders o WHERE o.status = 'placed' AND o.franchise_id IS NOT DISTINCT FROM ag.franchise_id
                             AND sv.id = ANY (fn_order_services(o.id))))
         ORDER BY c.sort_order, sv.sort_order), '[]'::jsonb)
    FROM services sv
    JOIN categories c ON c.id = sv.category_id
    JOIN service_types t ON t.code = sv.skill_code
    JOIN agents ag ON ag.user_id = p_agent_id
    LEFT JOIN franchises fr ON fr.id = ag.franchise_id
    LEFT JOIN agent_subscriptions s ON s.service_id = sv.id AND s.agent_id = p_agent_id
   WHERE sv.is_active AND (fn_sub_terms(ag.franchise_id, sv.id)).required
     -- only services that are on in the agent's city
     AND (ag.franchise_id IS NULL OR EXISTS (SELECT 1 FROM franchise_services fs
                                              WHERE fs.franchise_id = ag.franchise_id AND fs.service_id = sv.id AND fs.is_enabled))
$$;

-- New agent application: for each type of work they picked that has subscription services, a request goes to the
-- admin (who calls them, takes the payment and activates it after approving the agent).
CREATE OR REPLACE PROCEDURE sp_subscription_requests_from_skills(p_agent_id INT)
LANGUAGE sql SET search_path FROM CURRENT AS $$
  INSERT INTO agent_subscriptions (agent_id, service_id, status, agent_note)
  SELECT a.user_id, s.id, 'requested', 'Chosen when applying'
    FROM agents a JOIN services s ON s.skill_code = ANY (a.skills) AND s.is_active AND (fn_sub_terms(a.franchise_id, s.id)).required
   WHERE a.user_id = p_agent_id
  ON CONFLICT (agent_id, service_id) DO NOTHING
$$;

-- For the application form: which types of work need a subscription, and for which services.
-- In a city: its terms. No city chosen: everything that needs a subscription in any city (with the default fee).
DROP FUNCTION IF EXISTS fn_subscription_by_skill();
CREATE OR REPLACE FUNCTION fn_subscription_by_skill(p_franchise INT DEFAULT NULL) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_object_agg(skill_code, list), '{}'::jsonb)
    FROM (SELECT s.skill_code, jsonb_agg(jsonb_build_object('service', s.name, 'fee', (t).fee, 'days', (t).days)
                                         ORDER BY s.sort_order) AS list
            FROM services s CROSS JOIN LATERAL (SELECT fn_sub_terms(p_franchise, s.id) AS t) x
           WHERE s.is_active
             AND CASE WHEN p_franchise IS NULL
                      THEN s.subscription_required OR EXISTS (SELECT 1 FROM franchise_services fs WHERE fs.service_id = s.id AND fs.sub_required)
                      ELSE (t).required AND fn_service_visible(p_franchise, s.id) END
           GROUP BY s.skill_code) x
$$;
