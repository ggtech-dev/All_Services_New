-- 📢 Offers near you (2026-10-26): local shops (mobiles, jewellery, clothing…) advertise in their city. Re-runnable.
--   1. A shop asks in the app ("Advertise your shop") — the request goes straight to HQ.
--   2. HQ calls the shop, takes the payment and approves it (or HQ creates the ad itself for a chosen city).
--   3. It is live ONLY in that franchise's city from the start date, and ends by itself.
--   The franchise admin sees their city's offers and the taps (read only).
-- Plans (7 days / 30 days / ⭐ top of the strip) have HQ default prices; HQ can set a city's own price. While the
-- setting offers_free_first is on, a shop's first offer in a city is free. Customers' taps are counted for the shop.

CREATE TABLE IF NOT EXISTS offer_plans (
  code     VARCHAR(10) PRIMARY KEY,
  name     VARCHAR(60) NOT NULL,
  days     INT NOT NULL CHECK (days BETWEEN 1 AND 365),
  price    NUMERIC(8,2) NOT NULL CHECK (price >= 0),
  is_top   BOOLEAN NOT NULL DEFAULT false,      -- shown first in the strip and the list
  sort     INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO offer_plans (code, name, days, price, is_top, sort) VALUES
  ('week',  '7 days', 7, 199, false, 1),
  ('month', '30 days', 30, 499, false, 2),
  ('top',   '⭐ Top offer · 30 days', 30, 999, true, 3)
ON CONFLICT (code) DO NOTHING;
-- a city's own price for a plan (HQ)
CREATE TABLE IF NOT EXISTS offer_plan_prices (
  franchise_id INT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  code         VARCHAR(10) NOT NULL REFERENCES offer_plans(code) ON DELETE CASCADE,
  price        NUMERIC(8,2) NOT NULL CHECK (price >= 0),
  updated_by   INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (franchise_id, code)
);

CREATE TABLE IF NOT EXISTS local_offers (
  id           SERIAL PRIMARY KEY,
  franchise_id INT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  shop_name    VARCHAR(80)  NOT NULL,
  owner_name   VARCHAR(80),
  phone        VARCHAR(10)  NOT NULL,
  category     VARCHAR(12)  NOT NULL CHECK (category IN ('mobiles', 'jewellery', 'clothing', 'food', 'electronics', 'beauty', 'others')),
  title        VARCHAR(80)  NOT NULL,
  details      VARCHAR(600),
  image_url    TEXT NOT NULL,
  address      VARCHAR(200) NOT NULL,
  lat          NUMERIC(9,6),
  lng          NUMERIC(9,6),
  plan_code    VARCHAR(10) NOT NULL REFERENCES offer_plans(code),
  days         INT NOT NULL,
  price        NUMERIC(8,2) NOT NULL,
  is_top       BOOLEAN NOT NULL DEFAULT false,
  free_launch  BOOLEAN NOT NULL DEFAULT false,
  starts_on    DATE NOT NULL,
  ends_on      DATE,                               -- set when HQ approves
  status       VARCHAR(10) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled')),
  payment_mode VARCHAR(6) CHECK (payment_mode IN ('cash', 'upi', 'free')),
  paid_amount  NUMERIC(8,2),
  paid_at      TIMESTAMPTZ,
  submitted_by INT REFERENCES users(id) ON DELETE SET NULL,
  note         VARCHAR(300),                       -- HQ's own note (call details…)
  decided_by   INT REFERENCES users(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  reason       VARCHAR(300),
  seen         INT NOT NULL DEFAULT 0,             -- shown in the strip / list
  opens        INT NOT NULL DEFAULT 0,             -- offer page opened
  calls        INT NOT NULL DEFAULT 0,
  whatsapp     INT NOT NULL DEFAULT 0,
  directions   INT NOT NULL DEFAULT 0,
  is_sample    BOOLEAN NOT NULL DEFAULT false,     -- test offers (removed by the test cleanup)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS local_offers_city_idx ON local_offers (franchise_id, status, ends_on);
CREATE INDEX IF NOT EXISTS local_offers_by_idx ON local_offers (submitted_by);

INSERT INTO site_settings (key, value) VALUES ('offers_free_first', 'on') ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION fn_ist_date() RETURNS DATE
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- Is the offer showing to customers today?
CREATE OR REPLACE FUNCTION fn_offer_is_live(o local_offers) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT o.status = 'approved' AND fn_ist_date() BETWEEN o.starts_on AND o.ends_on
$$;

-- What a customer / admin sees as the state: requested · sent · upcoming · live · ended · rejected · cancelled
CREATE OR REPLACE FUNCTION fn_offer_state(o local_offers) RETURNS TEXT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT CASE WHEN o.status <> 'approved' THEN o.status
              WHEN fn_ist_date() < o.starts_on THEN 'upcoming'
              WHEN fn_ist_date() > o.ends_on THEN 'ended' ELSE 'live' END
$$;

-- A city's plans with its prices (the HQ default unless HQ set the city's own).
CREATE OR REPLACE FUNCTION fn_offer_plans(p_franchise INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'code', p.code, 'name', p.name, 'days', p.days, 'is_top', p.is_top, 'default', p.price,
           'price', coalesce(c.price, p.price), 'own', c.price IS NOT NULL) ORDER BY p.sort), '[]'::jsonb)
    FROM offer_plans p LEFT JOIN offer_plan_prices c ON c.code = p.code AND c.franchise_id = p_franchise
   WHERE p.is_active
$$;

-- HQ sets a city's plan price (NULL = back to the default).
CREATE OR REPLACE PROCEDURE sp_set_offer_price(p_franchise INT, p_code TEXT, p_price NUMERIC, p_by INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM offer_plans WHERE code = p_code) THEN
    RAISE EXCEPTION 'Unknown plan' USING ERRCODE = '22023';
  END IF;
  IF p_price IS NULL THEN
    DELETE FROM offer_plan_prices WHERE franchise_id = p_franchise AND code = p_code;
  ELSIF p_price < 0 OR p_price > 100000 THEN
    RAISE EXCEPTION 'Enter a price from ₹0 to ₹1,00,000' USING ERRCODE = '22023';
  ELSE
    INSERT INTO offer_plan_prices (franchise_id, code, price, updated_by) VALUES (p_franchise, p_code, round(p_price, 2), p_by)
    ON CONFLICT (franchise_id, code) DO UPDATE SET price = EXCLUDED.price, updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;
END $$;

-- Will this shop's offer be free (its first in the city, while the launch offer is on)?
CREATE OR REPLACE FUNCTION fn_offer_free_for(p_franchise INT, p_phone TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce((SELECT value FROM site_settings WHERE key = 'offers_free_first'), 'off') = 'on'
     AND NOT EXISTS (SELECT 1 FROM local_offers WHERE franchise_id = p_franchise AND phone = p_phone
                      AND status NOT IN ('rejected', 'cancelled'))
$$;

-- A new offer: from the shop (status requested → HQ) or created by HQ for a city after calling the shop (p_hq:
-- approved at once, with the payment). p: {shop_name, owner_name, phone, category, title, details, image_url, address,
-- lat, lng, plan, starts_on, payment_mode, paid_amount, note}
DROP FUNCTION IF EXISTS fn_offer_send(INT, INT, INT, TEXT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS fn_offer_decide(INT, INT, BOOLEAN, TEXT);
CREATE OR REPLACE FUNCTION fn_offer_submit(p JSONB, p_by INT, p_franchise INT, p_hq BOOLEAN DEFAULT false) RETURNS local_offers
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v      local_offers;
  v_plan JSONB;
  v_start DATE;
  v_phone TEXT := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  v_free BOOLEAN;
BEGIN
  IF p_franchise IS NULL OR NOT EXISTS (SELECT 1 FROM franchises WHERE id = p_franchise AND status = 'active') THEN
    RAISE EXCEPTION 'Choose your city first (top of the app)' USING ERRCODE = '22023';
  END IF;
  v_phone := right(v_phone, 10);
  IF length(trim(coalesce(p->>'shop_name', ''))) < 2 THEN RAISE EXCEPTION 'Write the shop name' USING ERRCODE = '22023'; END IF;
  IF v_phone !~ '^[6-9]\d{9}$' THEN RAISE EXCEPTION 'Enter the shop''s 10-digit mobile number' USING ERRCODE = '22023'; END IF;
  IF coalesce(p->>'category', '') NOT IN ('mobiles', 'jewellery', 'clothing', 'food', 'electronics', 'beauty', 'others') THEN
    RAISE EXCEPTION 'Choose what the shop sells' USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p->>'title', ''))) < 5 THEN RAISE EXCEPTION 'Write the offer in a few words (e.g. 20%% off on all phones)' USING ERRCODE = '22023'; END IF;
  IF coalesce(p->>'image_url', '') !~ '^/uploads/' THEN RAISE EXCEPTION 'Add a photo or poster of the offer' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p->>'address', ''))) < 5 THEN RAISE EXCEPTION 'Write the shop address' USING ERRCODE = '22023'; END IF;
  SELECT x INTO v_plan FROM jsonb_array_elements(fn_offer_plans(p_franchise)) x WHERE x->>'code' = p->>'plan';
  IF v_plan IS NULL THEN RAISE EXCEPTION 'Choose a plan' USING ERRCODE = '22023'; END IF;
  v_start := CASE WHEN coalesce(p->>'starts_on', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (p->>'starts_on')::date ELSE fn_ist_date() END;
  IF v_start < fn_ist_date() OR v_start > fn_ist_date() + 60 THEN
    RAISE EXCEPTION 'Choose a start date from today to 60 days ahead' USING ERRCODE = '22023';
  END IF;
  v_free := fn_offer_free_for(p_franchise, v_phone);
  IF p_hq AND NOT v_free AND coalesce(p->>'payment_mode', '') NOT IN ('cash', 'upi') THEN
    RAISE EXCEPTION 'Choose how the shop paid (cash or UPI)' USING ERRCODE = '22023';
  END IF;

  INSERT INTO local_offers (franchise_id, shop_name, owner_name, phone, category, title, details, image_url, address, lat, lng,
                            plan_code, days, price, is_top, free_launch, starts_on, ends_on, status, submitted_by,
                            payment_mode, paid_amount, paid_at, decided_by, decided_at, note)
  VALUES (p_franchise, left(trim(p->>'shop_name'), 80), nullif(left(trim(coalesce(p->>'owner_name', '')), 80), ''), v_phone,
          p->>'category', left(trim(p->>'title'), 80), nullif(left(trim(coalesce(p->>'details', '')), 600), ''), p->>'image_url',
          left(trim(p->>'address'), 200),
          CASE WHEN (p->>'lat') ~ '^-?\d+(\.\d+)?$' AND (p->>'lat')::numeric BETWEEN 6 AND 37.5 THEN round((p->>'lat')::numeric, 6) END,
          CASE WHEN (p->>'lng') ~ '^-?\d+(\.\d+)?$' AND (p->>'lng')::numeric BETWEEN 68 AND 97.5 THEN round((p->>'lng')::numeric, 6) END,
          v_plan->>'code', (v_plan->>'days')::int, CASE WHEN v_free THEN 0 ELSE (v_plan->>'price')::numeric END,
          (v_plan->>'is_top')::boolean, v_free, v_start,
          CASE WHEN p_hq THEN v_start + (v_plan->>'days')::int - 1 END,
          CASE WHEN p_hq THEN 'approved' ELSE 'requested' END, p_by,
          CASE WHEN p_hq THEN CASE WHEN v_free THEN 'free' ELSE p->>'payment_mode' END END,
          CASE WHEN p_hq THEN CASE WHEN v_free THEN 0
                                   WHEN coalesce(p->>'paid_amount', '') ~ '^\d+(\.\d+)?$' THEN (p->>'paid_amount')::numeric
                                   ELSE (v_plan->>'price')::numeric END END,
          CASE WHEN p_hq THEN now() END, CASE WHEN p_hq THEN p_by END, CASE WHEN p_hq THEN now() END,
          CASE WHEN p_hq THEN nullif(left(trim(coalesce(p->>'note', '')), 300), '') END)
  RETURNING * INTO v;
  RETURN v;
END $$;

-- HQ (after calling the shop): approve with the payment — live from the start date (today if that has passed) for the
-- plan's days — or reject with a reason the shop sees.
CREATE OR REPLACE FUNCTION fn_offer_decide(p_id INT, p_by INT, p_approve BOOLEAN, p_reason TEXT,
                                           p_mode TEXT DEFAULT NULL, p_amount NUMERIC DEFAULT NULL, p_note TEXT DEFAULT NULL) RETURNS local_offers
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v local_offers;
  v_start DATE;
BEGIN
  SELECT * INTO v FROM local_offers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found' USING ERRCODE = 'P0002'; END IF;
  IF v.status <> 'requested' THEN RAISE EXCEPTION 'This offer was already decided' USING ERRCODE = '22023'; END IF;
  IF p_approve THEN
    IF NOT v.free_launch AND coalesce(p_mode, '') NOT IN ('cash', 'upi') THEN
      RAISE EXCEPTION 'Choose how the shop paid (cash or UPI)' USING ERRCODE = '22023';
    END IF;
    v_start := greatest(v.starts_on, fn_ist_date());
    UPDATE local_offers SET status = 'approved', starts_on = v_start, ends_on = v_start + v.days - 1,
           payment_mode = CASE WHEN v.free_launch THEN 'free' ELSE p_mode END,
           paid_amount = CASE WHEN v.free_launch THEN 0 ELSE greatest(coalesce(p_amount, v.price), 0) END, paid_at = now(),
           note = nullif(left(trim(coalesce(p_note, '')), 300), ''),
           decided_by = p_by, decided_at = now(), reason = NULL, updated_at = now()
     WHERE id = p_id RETURNING * INTO v;
  ELSE
    IF length(trim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Write why it is rejected (the shop sees it)' USING ERRCODE = '22023'; END IF;
    UPDATE local_offers SET status = 'rejected', decided_by = p_by, decided_at = now(), reason = left(trim(p_reason), 300), updated_at = now()
     WHERE id = p_id RETURNING * INTO v;
  END IF;
  RETURN v;
END $$;

-- Stop an offer (the shop: its own, not yet live; the franchise: its city's; HQ: any). Ended ones stay as they are.
CREATE OR REPLACE FUNCTION fn_offer_cancel(p_id INT, p_by INT, p_franchise INT, p_owner INT, p_reason TEXT) RETURNS local_offers
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v local_offers;
BEGIN
  SELECT * INTO v FROM local_offers WHERE id = p_id AND (p_franchise IS NULL OR franchise_id = p_franchise)
     AND (p_owner IS NULL OR submitted_by = p_owner) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found' USING ERRCODE = 'P0002'; END IF;
  IF fn_offer_state(v) IN ('ended', 'rejected', 'cancelled') THEN RAISE EXCEPTION 'This offer is already closed' USING ERRCODE = '22023'; END IF;
  IF p_owner IS NOT NULL AND v.status <> 'requested' THEN
    RAISE EXCEPTION 'Your offer is already approved — call us to stop it' USING ERRCODE = '22023';
  END IF;
  UPDATE local_offers SET status = 'cancelled', reason = nullif(left(trim(coalesce(p_reason, '')), 300), ''), decided_by = p_by,
         decided_at = now(), updated_at = now()
   WHERE id = p_id RETURNING * INTO v;
  RETURN v;
END $$;

-- The city's live offers for customers (⭐ top first, then the newest). p_category NULL = all.
CREATE OR REPLACE FUNCTION fn_city_offers(p_franchise INT, p_category TEXT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'shop_name', o.shop_name, 'category', o.category, 'title', o.title, 'image_url', o.image_url,
           'ends_on', o.ends_on::text, 'is_top', o.is_top) ORDER BY o.is_top DESC, o.decided_at DESC), '[]'::jsonb)
    FROM local_offers o
   WHERE o.franchise_id = p_franchise AND fn_offer_is_live(o) AND (p_category IS NULL OR o.category = p_category)
$$;

-- One live offer for its page (with the shop's phone, address and map pin).
CREATE OR REPLACE FUNCTION fn_offer_detail(p_id INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object('id', o.id, 'shop_name', o.shop_name, 'owner_name', o.owner_name, 'phone', o.phone,
           'category', o.category, 'title', o.title, 'details', o.details, 'image_url', o.image_url, 'address', o.address,
           'lat', o.lat, 'lng', o.lng, 'starts_on', o.starts_on::text, 'ends_on', o.ends_on::text, 'is_top', o.is_top,
           'city', f.city, 'franchise_id', o.franchise_id)
    FROM local_offers o JOIN franchises f ON f.id = o.franchise_id
   WHERE o.id = p_id AND fn_offer_is_live(o)
$$;

-- A customer saw / opened / called / messaged / asked directions (live offers only).
CREATE OR REPLACE FUNCTION fn_offer_tap(p_id INT, p_kind TEXT) RETURNS VOID
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF p_kind NOT IN ('seen', 'open', 'call', 'whatsapp', 'directions') THEN
    RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023';
  END IF;
  UPDATE local_offers o SET
         seen = seen + (p_kind = 'seen')::int, opens = opens + (p_kind = 'open')::int, calls = calls + (p_kind = 'call')::int,
         whatsapp = whatsapp + (p_kind = 'whatsapp')::int, directions = directions + (p_kind = 'directions')::int
   WHERE o.id = p_id AND fn_offer_is_live(o);
END $$;

-- The admin list: HQ (all / a city) or the franchise (its city, read only). p_tab: requests · live · upcoming · ended · closed
CREATE OR REPLACE FUNCTION fn_offers_admin(p_franchise INT, p_tab TEXT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  WITH o AS (
    SELECT o.*, fn_offer_state(o) AS state, f.city,
           (SELECT name FROM offer_plans WHERE code = o.plan_code) AS plan_name,
           (SELECT coalesce(full_name, username) FROM users WHERE id = o.submitted_by) AS submitted_by_name,
           (SELECT role FROM users WHERE id = o.submitted_by) AS submitted_by_role
      FROM local_offers o JOIN franchises f ON f.id = o.franchise_id
     WHERE (p_franchise IS NULL OR o.franchise_id = p_franchise)
  ), t AS (
    SELECT *, CASE state WHEN 'requested' THEN 'requests' WHEN 'live' THEN 'live' WHEN 'upcoming' THEN 'upcoming'
                         WHEN 'ended' THEN 'ended' ELSE 'closed' END AS tab
      FROM o
  )
  SELECT jsonb_build_object(
    'counts', (SELECT coalesce(jsonb_object_agg(tab, n), '{}'::jsonb) FROM (SELECT tab, count(*) AS n FROM t GROUP BY tab) c),
    'income_month', (SELECT coalesce(sum(paid_amount), 0) FROM t WHERE paid_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
                       AND status = 'approved'),
    'offers', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'franchise_id', franchise_id, 'city', city, 'shop_name', shop_name, 'owner_name', owner_name, 'phone', phone,
        'category', category, 'title', title, 'details', details, 'image_url', image_url, 'address', address, 'lat', lat, 'lng', lng,
        'plan_code', plan_code, 'plan_name', plan_name, 'days', days, 'price', price, 'is_top', is_top, 'free_launch', free_launch,
        'starts_on', starts_on::text, 'ends_on', ends_on::text, 'status', status, 'state', state,
        'payment_mode', payment_mode, 'paid_amount', paid_amount, 'note', note, 'reason', reason,
        'submitted_by_name', submitted_by_name, 'from_shop', coalesce(submitted_by_role, 'customer') = 'customer',
        'stats', jsonb_build_object('seen', seen, 'opens', opens, 'calls', calls, 'whatsapp', whatsapp, 'directions', directions),
        'created_at', created_at, 'is_sample', is_sample) ORDER BY created_at DESC)
      FROM t WHERE tab = p_tab), '[]'::jsonb))
$$;

-- A shop owner's own offers (Account → My shop offers), with the counts once live.
CREATE OR REPLACE FUNCTION fn_my_offers(p_user INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'shop_name', o.shop_name, 'title', o.title, 'image_url', o.image_url, 'category', o.category,
           'plan_name', (SELECT name FROM offer_plans WHERE code = o.plan_code), 'price', o.price, 'free_launch', o.free_launch,
           'starts_on', o.starts_on::text, 'ends_on', o.ends_on::text, 'state', fn_offer_state(o), 'reason', o.reason,
           'ends_soon', fn_offer_is_live(o) AND o.ends_on - fn_ist_date() <= 2,
           'stats', jsonb_build_object('seen', o.seen, 'opens', o.opens, 'calls', o.calls, 'whatsapp', o.whatsapp, 'directions', o.directions))
         ORDER BY o.created_at DESC), '[]'::jsonb)
    FROM local_offers o WHERE o.submitted_by = p_user
$$;

-- HQ's plan prices for every active city.
CREATE OR REPLACE FUNCTION fn_offer_prices_all() RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('franchise_id', f.id, 'city', f.city, 'plans', fn_offer_plans(f.id)) ORDER BY f.city), '[]'::jsonb)
    FROM franchises f WHERE f.status = 'active'
$$;
