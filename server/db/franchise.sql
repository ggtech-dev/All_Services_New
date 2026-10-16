-- Franchises (dealers): one per city, run under the Super Admin. Re-runnable. Runs last.
-- Tables/columns are in schema.sql. Here: rules (who sees what), Super Admin management, requests & approvals,
-- the manual commission ledger, complaints, broadcast notifications and dashboards.

-- ============ extra tables ============

-- Dealer documents (agreement, GST, PAN…). Files live in server/private_uploads/franchise (never public).
CREATE TABLE IF NOT EXISTS franchise_documents (
  id           SERIAL PRIMARY KEY,
  franchise_id INT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  label        VARCHAR(80) NOT NULL,
  file         TEXT NOT NULL,
  uploaded_by  INT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Money between HQ and a dealer, entered by the Super Admin by hand (no automatic calculation):
--   commission = the dealer owes HQ · payment = the dealer paid HQ · expense = a dealer expense noted for reports
--   adjustment = correction (+ owes more, − owes less)
CREATE TABLE IF NOT EXISTS franchise_ledger (
  id           SERIAL PRIMARY KEY,
  franchise_id INT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  type         VARCHAR(12) NOT NULL CHECK (type IN ('commission', 'payment', 'expense', 'adjustment')),
  amount       NUMERIC(12,2) NOT NULL,
  entry_date   DATE NOT NULL DEFAULT current_date,
  reference    VARCHAR(60),
  note         VARCHAR(300),
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS franchise_ledger_idx ON franchise_ledger(franchise_id, entry_date DESC);

-- A dealer asks for a service or product: an existing master one to be switched on for them, or a brand new one.
CREATE TABLE IF NOT EXISTS catalog_requests (
  id            SERIAL PRIMARY KEY,
  franchise_id  INT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  kind          VARCHAR(8) NOT NULL CHECK (kind IN ('service', 'product')),
  service_id    INT REFERENCES services(id) ON DELETE SET NULL,   -- existing service (or the service a new product goes in)
  product_id    INT REFERENCES products(id) ON DELETE SET NULL,   -- existing product
  name          VARCHAR(120),                                     -- proposed new service / product name
  category_id   INT REFERENCES categories(id) ON DELETE SET NULL, -- new service: where it goes
  unit          VARCHAR(30),                                      -- new product: pack size
  details       VARCHAR(500),                                     -- why / description
  status        VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  admin_note    VARCHAR(300),
  requested_by  INT REFERENCES users(id) ON DELETE SET NULL,
  decided_by    INT REFERENCES users(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catalog_requests_idx ON catalog_requests(status, created_at DESC);

-- Customer complaints (about an order or in general). Handled by the dealer; the Super Admin sees all.
CREATE TABLE IF NOT EXISTS complaints (
  id           SERIAL PRIMARY KEY,
  franchise_id INT REFERENCES franchises(id) ON DELETE SET NULL,
  customer_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id     INT REFERENCES orders(id) ON DELETE SET NULL,
  subject      VARCHAR(80) NOT NULL,
  message      VARCHAR(1000) NOT NULL,
  status       VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  reply        VARCHAR(1000),
  replied_by   INT REFERENCES users(id) ON DELETE SET NULL,
  replied_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS complaints_idx ON complaints(franchise_id, status, created_at DESC);

-- Messages sent to phones (web push) from the Super Admin or a dealer, kept for the history list.
CREATE TABLE IF NOT EXISTS broadcasts (
  id           SERIAL PRIMARY KEY,
  franchise_id INT REFERENCES franchises(id) ON DELETE SET NULL, -- NULL = every franchise
  audience     VARCHAR(10) NOT NULL CHECK (audience IN ('customers', 'agents', 'everyone')),
  title        VARCHAR(80) NOT NULL,
  body         VARCHAR(300) NOT NULL,
  url          VARCHAR(200),
  sent_count   INT NOT NULL DEFAULT 0,
  sent_by      INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ who belongs where ============

CREATE OR REPLACE FUNCTION fn_franchise_of_locality(p_locality_id INT) RETURNS INT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT franchise_id FROM localities WHERE id = p_locality_id
$$;

-- Orders and agents take their franchise from their area (a new order / agent, or an agent who changes area).
CREATE OR REPLACE FUNCTION trg_franchise_from_locality() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.locality_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.locality_id IS DISTINCT FROM OLD.locality_id OR NEW.franchise_id IS NULL) THEN
    NEW.franchise_id := coalesce(fn_franchise_of_locality(NEW.locality_id), NEW.franchise_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS orders_franchise ON orders;
CREATE TRIGGER orders_franchise BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION trg_franchise_from_locality();
DROP TRIGGER IF EXISTS agents_franchise ON agents;
CREATE TRIGGER agents_franchise BEFORE INSERT OR UPDATE OF locality_id ON agents FOR EACH ROW EXECUTE FUNCTION trg_franchise_from_locality();

-- An area moved to another franchise takes its agents' home with it (orders keep the franchise they were placed in).
CREATE OR REPLACE FUNCTION trg_locality_franchise_moved() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.franchise_id IS DISTINCT FROM OLD.franchise_id THEN
    UPDATE agents SET franchise_id = NEW.franchise_id WHERE locality_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS localities_franchise_moved ON localities;
CREATE TRIGGER localities_franchise_moved AFTER UPDATE OF franchise_id ON localities FOR EACH ROW EXECUTE FUNCTION trg_locality_franchise_moved();

-- ============ what customers of a franchise can see ============

-- p_franchise NULL = no city chosen (one-city setups and old app versions): everything active is shown.
CREATE OR REPLACE FUNCTION fn_service_visible(p_franchise INT, p_service_id INT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT p_franchise IS NULL
      OR EXISTS (SELECT 1 FROM franchise_services fs WHERE fs.franchise_id = p_franchise AND fs.service_id = p_service_id AND fs.is_enabled)
$$;

CREATE OR REPLACE FUNCTION fn_product_visible(p_franchise INT, p_product_id INT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT CASE
    WHEN p_franchise IS NULL THEN NOT p.only_assigned
    WHEN NOT fn_service_visible(p_franchise, p.service_id) AND NOT EXISTS (
           -- ⚡ Instant shows its source shops' products: visible if the instant service is on here
           SELECT 1 FROM services s JOIN franchise_services fs ON fs.service_id = s.id AND fs.franchise_id = p_franchise AND fs.is_enabled
            WHERE p.service_id = ANY (s.source_service_ids)) THEN false
    WHEN p.only_assigned THEN EXISTS (SELECT 1 FROM franchise_products fp WHERE fp.franchise_id = p_franchise AND fp.product_id = p.id AND fp.is_enabled)
    ELSE NOT EXISTS (SELECT 1 FROM franchise_products fp WHERE fp.franchise_id = p_franchise AND fp.product_id = p.id AND NOT fp.is_enabled)
  END
  FROM products p WHERE p.id = p_product_id
$$;

-- Cities customers can choose (active franchises with at least one active area).
CREATE OR REPLACE FUNCTION fn_public_franchises() RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'city', f.city, 'state', f.state, 'name', f.name) ORDER BY f.city), '[]'::jsonb)
    FROM franchises f
   WHERE f.status = 'active' AND EXISTS (SELECT 1 FROM localities l WHERE l.franchise_id = f.id AND l.is_active)
$$;

-- Checked when an order is placed: the area's franchise is open and offers everything in the order.
CREATE OR REPLACE FUNCTION fn_check_franchise_order(p_locality_id INT, p_service_ids INT[], p_product_ids INT[]) RETURNS INT
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  f franchises;
  v_bad TEXT;
BEGIN
  SELECT fr.* INTO f FROM franchises fr JOIN localities l ON l.franchise_id = fr.id WHERE l.id = p_locality_id;
  IF NOT FOUND THEN
    RETURN NULL; -- area not under any franchise (old data): no extra rules
  END IF;
  IF f.status <> 'active' THEN
    RAISE EXCEPTION 'Sorry, All Services is not taking orders in % right now. Please try again later.', f.city USING ERRCODE = '55000';
  END IF;
  SELECT s.name INTO v_bad FROM services s
   WHERE s.id = ANY (coalesce(p_service_ids, '{}')) AND NOT fn_service_visible(f.id, s.id) LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '% is not available in % yet', v_bad, f.city USING ERRCODE = '22023';
  END IF;
  SELECT p.name INTO v_bad FROM products p
   WHERE p.id = ANY (coalesce(p_product_ids, '{}')) AND NOT fn_product_visible(f.id, p.id) LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '% is not available in % — please remove it from your cart', v_bad, f.city USING ERRCODE = '22023';
  END IF;
  RETURN f.id;
END $$;

-- ============ Super Admin: franchises ============

CREATE OR REPLACE FUNCTION fn_next_franchise_code() RETURNS TEXT
LANGUAGE sql VOLATILE SET search_path FROM CURRENT AS $$
  SELECT 'FR-' || lpad((coalesce(max(substring(code FROM '^FR-(\d+)$')::int), 0) + 1)::text, 4, '0') FROM franchises
$$;

-- Create (p_id NULL) or update a franchise. p: {name, owner_name, phone, email, address, city, state, pincode, gst_number, notes}
-- A new franchise gets every active master service ("at launch every dealer gets everything").
CREATE OR REPLACE FUNCTION fn_save_franchise(p_id INT, p JSONB) RETURNS franchises
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v franchises;
  v_phone TEXT := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  t TEXT;
BEGIN
  IF length(trim(coalesce(p->>'name', ''))) < 3 THEN
    RAISE EXCEPTION 'Enter the franchise name' USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p->>'city', ''))) < 2 THEN
    RAISE EXCEPTION 'Enter the city' USING ERRCODE = '22023';
  END IF;
  IF length(v_phone) = 12 AND v_phone LIKE '91%' THEN v_phone := substr(v_phone, 3); END IF;
  IF v_phone <> '' AND v_phone !~ '^[6-9]\d{9}$' THEN
    RAISE EXCEPTION 'Enter a valid 10-digit mobile number' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p->>'email', '') <> '' AND NOT fn_valid_email(p->>'email') THEN
    RAISE EXCEPTION 'Enter a valid email address' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p->>'pincode', '') <> '' AND p->>'pincode' !~ '^\d{6}$' THEN
    RAISE EXCEPTION 'PIN code must be 6 digits' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM franchises WHERE lower(city) = lower(trim(p->>'city')) AND id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'There is already a franchise for %', trim(p->>'city') USING ERRCODE = '55000';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO franchises (code, name, owner_name, phone, email, address, city, state, pincode, gst_number, notes, status)
    VALUES (fn_next_franchise_code(), trim(p->>'name'), nullif(trim(p->>'owner_name'), ''), nullif(v_phone, ''),
            nullif(lower(trim(p->>'email')), ''), nullif(trim(p->>'address'), ''), trim(p->>'city'),
            coalesce(nullif(trim(p->>'state'), ''), 'Telangana'), nullif(trim(p->>'pincode'), ''),
            nullif(upper(trim(p->>'gst_number')), ''), nullif(trim(p->>'notes'), ''), 'pending')
    RETURNING * INTO v;
    INSERT INTO franchise_services (franchise_id, service_id)
    SELECT v.id, s.id FROM services s WHERE s.is_active ON CONFLICT DO NOTHING;
  ELSE
    UPDATE franchises SET name = trim(p->>'name'), owner_name = nullif(trim(p->>'owner_name'), ''), phone = nullif(v_phone, ''),
           email = nullif(lower(trim(p->>'email')), ''), address = nullif(trim(p->>'address'), ''), city = trim(p->>'city'),
           state = coalesce(nullif(trim(p->>'state'), ''), 'Telangana'), pincode = nullif(trim(p->>'pincode'), ''),
           gst_number = nullif(upper(trim(p->>'gst_number')), ''), notes = nullif(trim(p->>'notes'), ''), updated_at = now()
     WHERE id = p_id RETURNING * INTO v;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Franchise not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v;
END $$;

-- pending → active (go live), active ↔ disabled (closed for now), suspended (problem: dealer admins locked out too)
CREATE OR REPLACE PROCEDURE sp_set_franchise_status(p_id INT, p_status TEXT, p_reason TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF p_status NOT IN ('pending', 'active', 'disabled', 'suspended') THEN
    RAISE EXCEPTION 'Unknown status' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'active' AND NOT EXISTS (SELECT 1 FROM localities WHERE franchise_id = p_id) THEN
    RAISE EXCEPTION 'Add at least one service area for this franchise before activating it' USING ERRCODE = '55000';
  END IF;
  UPDATE franchises SET status = p_status, status_reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now() WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Franchise not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- Switch a service on/off for one franchise (also adds a service it did not have).
CREATE OR REPLACE PROCEDURE sp_set_franchise_service(p_franchise INT, p_service_id INT, p_enabled BOOLEAN)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM franchises WHERE id = p_franchise) OR NOT EXISTS (SELECT 1 FROM services WHERE id = p_service_id) THEN
    RAISE EXCEPTION 'Franchise or service not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO franchise_services (franchise_id, service_id, is_enabled) VALUES (p_franchise, p_service_id, coalesce(p_enabled, true))
  ON CONFLICT (franchise_id, service_id) DO UPDATE SET is_enabled = EXCLUDED.is_enabled;
END $$;

-- Give a service to every franchise at once (e.g. a new master service for all dealers).
CREATE OR REPLACE FUNCTION fn_assign_service_to_all(p_service_id INT) RETURNS INT
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE n INT;
BEGIN
  INSERT INTO franchise_services (franchise_id, service_id) SELECT f.id, p_service_id FROM franchises f
  ON CONFLICT (franchise_id, service_id) DO UPDATE SET is_enabled = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE PROCEDURE sp_set_franchise_product(p_franchise INT, p_product_id INT, p_enabled BOOLEAN)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM franchises WHERE id = p_franchise) OR NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Franchise or product not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO franchise_products (franchise_id, product_id, is_enabled) VALUES (p_franchise, p_product_id, coalesce(p_enabled, true))
  ON CONFLICT (franchise_id, product_id) DO UPDATE SET is_enabled = EXCLUDED.is_enabled;
END $$;

-- Manual money entries.
CREATE OR REPLACE FUNCTION fn_add_ledger_entry(p_franchise INT, p_type TEXT, p_amount NUMERIC, p_date DATE, p_reference TEXT,
                                               p_note TEXT, p_by INT) RETURNS franchise_ledger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE v franchise_ledger;
BEGIN
  IF p_type NOT IN ('commission', 'payment', 'expense', 'adjustment') THEN
    RAISE EXCEPTION 'Choose commission, payment, expense or adjustment' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount = 0 OR abs(p_amount) > 100000000 OR (p_type <> 'adjustment' AND p_amount < 0) THEN
    RAISE EXCEPTION 'Enter a valid amount' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM franchises WHERE id = p_franchise) THEN
    RAISE EXCEPTION 'Franchise not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO franchise_ledger (franchise_id, type, amount, entry_date, reference, note, created_by)
  VALUES (p_franchise, p_type, round(p_amount, 2), coalesce(p_date, current_date), nullif(left(trim(coalesce(p_reference, '')), 60), ''),
          nullif(left(trim(coalesce(p_note, '')), 300), ''), p_by)
  RETURNING * INTO v;
  RETURN v;
END $$;

-- Commission / paid / pending for one franchise (or NULL = all).
CREATE OR REPLACE FUNCTION fn_franchise_money(p_franchise INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object(
    'commission', coalesce(sum(amount) FILTER (WHERE type IN ('commission', 'adjustment')), 0),
    'paid',       coalesce(sum(amount) FILTER (WHERE type = 'payment'), 0),
    'pending',    coalesce(sum(amount) FILTER (WHERE type IN ('commission', 'adjustment')), 0) - coalesce(sum(amount) FILTER (WHERE type = 'payment'), 0),
    'expenses',   coalesce(sum(amount) FILTER (WHERE type = 'expense'), 0))
    FROM franchise_ledger WHERE p_franchise IS NULL OR franchise_id = p_franchise
$$;

-- ============ numbers ============

-- One franchise's figures (or all with NULL) for [p_from, p_to] (IST dates); NULL dates = all time.
-- Revenue = value of delivered orders (items + delivery/visit charges, shop bills included when known).
CREATE OR REPLACE FUNCTION fn_franchise_stats(p_franchise INT, p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  WITH o AS (
    SELECT * FROM orders
     WHERE (p_franchise IS NULL OR franchise_id = p_franchise)
       AND (p_from IS NULL OR (created_at AT TIME ZONE 'Asia/Kolkata')::date >= p_from)
       AND (p_to IS NULL OR (created_at AT TIME ZONE 'Asia/Kolkata')::date <= p_to)
  )
  SELECT jsonb_build_object(
    'users',            (SELECT count(DISTINCT customer_id) FROM o),
    'agents',           (SELECT count(*) FROM agents a WHERE (p_franchise IS NULL OR a.franchise_id = p_franchise) AND a.status = 'active'),
    'agents_pending',   (SELECT count(*) FROM agents a WHERE (p_franchise IS NULL OR a.franchise_id = p_franchise) AND a.status = 'pending'),
    'admins',           (SELECT count(*) FROM users u WHERE u.role = 'admin' AND (p_franchise IS NULL OR u.franchise_id = p_franchise)),
    'areas',            (SELECT count(*) FROM localities l WHERE (p_franchise IS NULL OR l.franchise_id = p_franchise) AND l.is_active),
    'services',         (SELECT count(*) FROM franchise_services fs JOIN services s ON s.id = fs.service_id
                          WHERE fs.is_enabled AND s.is_active AND (p_franchise IS NULL OR fs.franchise_id = p_franchise)),
    'products',         CASE WHEN p_franchise IS NULL THEN (SELECT count(*) FROM products WHERE is_active)
                             ELSE (SELECT count(*) FROM products p WHERE p.is_active AND fn_product_visible(p_franchise, p.id)) END,
    'orders',           (SELECT count(*) FROM o WHERE kind = 'products'),
    'bookings',         (SELECT count(*) FROM o WHERE kind = 'service'),
    'completed',        (SELECT count(*) FROM o WHERE status = 'delivered'),
    'cancelled',        (SELECT count(*) FROM o WHERE status = 'cancelled'),
    'pending',          (SELECT count(*) FROM o WHERE status IN ('placed', 'assigned', 'picked_up')),
    'revenue',          (SELECT coalesce(sum(total + coalesce(bill_amount, 0)), 0) FROM o WHERE status = 'delivered'),
    'delivery_charges', (SELECT coalesce(sum(delivery_fee), 0) FROM o WHERE status = 'delivered'),
    'revenue_today',    (SELECT coalesce(sum(total + coalesce(bill_amount, 0)), 0) FROM orders
                          WHERE status = 'delivered' AND (p_franchise IS NULL OR franchise_id = p_franchise)
                            AND (delivered_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
    'revenue_month',    (SELECT coalesce(sum(total + coalesce(bill_amount, 0)), 0) FROM orders
                          WHERE status = 'delivered' AND (p_franchise IS NULL OR franchise_id = p_franchise)
                            AND date_trunc('month', delivered_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')),
    'rating',           (SELECT round(avg(r.stars), 1) FROM order_ratings r JOIN orders x ON x.id = r.order_id
                          WHERE p_franchise IS NULL OR x.franchise_id = p_franchise),
    'complaints_open',  (SELECT count(*) FROM complaints c WHERE c.status IN ('open', 'in_progress') AND (p_franchise IS NULL OR c.franchise_id = p_franchise)),
    'money',            fn_franchise_money(p_franchise))
$$;

-- The Franchise Management table: every franchise with its numbers.
CREATE OR REPLACE FUNCTION fn_franchise_list() RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(f) || jsonb_build_object('stats', fn_franchise_stats(f.id)) ORDER BY f.code), '[]'::jsonb)
    FROM franchises f
$$;

-- Platform dashboard for the Super Admin.
CREATE OR REPLACE FUNCTION fn_platform_dashboard() RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT fn_franchise_stats(NULL) || jsonb_build_object(
    'franchises',         (SELECT count(*) FROM franchises),
    'franchises_active',  (SELECT count(*) FROM franchises WHERE status = 'active'),
    'franchises_pending', (SELECT count(*) FROM franchises WHERE status = 'pending'),
    'users_total',        (SELECT count(*) FROM users WHERE role = 'customer'),
    'admins',             (SELECT count(*) FROM users WHERE role = 'admin'),
    'services_total',     (SELECT count(*) FROM services WHERE is_active),
    'products_total',     (SELECT count(*) FROM products WHERE is_active),
    'requests_pending',   (SELECT count(*) FROM catalog_requests WHERE status = 'pending'),
    'by_franchise', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'code', f.code, 'name', f.name, 'city', f.city, 'status', f.status)
                                     || fn_franchise_stats(f.id) ORDER BY f.code), '[]'::jsonb) FROM franchises f))
$$;

-- ============ requests & approvals ============

-- Dealer asks. p: {kind, service_id?, product_id?, name?, category_id?, unit?, details?}
CREATE OR REPLACE FUNCTION fn_request_catalog(p_franchise INT, p_by INT, p JSONB) RETURNS catalog_requests
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v catalog_requests;
  v_kind TEXT := p->>'kind';
  v_service INT := CASE WHEN p->>'service_id' ~ '^\d{1,9}$' THEN (p->>'service_id')::int END;
  v_product INT := CASE WHEN p->>'product_id' ~ '^\d{1,9}$' THEN (p->>'product_id')::int END;
  v_category INT := CASE WHEN p->>'category_id' ~ '^\d{1,9}$' THEN (p->>'category_id')::int END;
  v_name TEXT := nullif(left(trim(regexp_replace(coalesce(p->>'name', ''), '\s+', ' ', 'g')), 120), '');
BEGIN
  IF v_kind NOT IN ('service', 'product') THEN
    RAISE EXCEPTION 'Choose service or product' USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'service' THEN
    IF v_service IS NULL AND (v_name IS NULL OR v_category IS NULL) THEN
      RAISE EXCEPTION 'Choose a service from the list, or write a new service name and its category' USING ERRCODE = '22023';
    END IF;
    IF v_service IS NOT NULL AND fn_service_visible(p_franchise, v_service) THEN
      RAISE EXCEPTION 'You already have this service' USING ERRCODE = '55000';
    END IF;
    v_product := NULL;
  ELSE
    IF v_product IS NULL AND (v_name IS NULL OR v_service IS NULL) THEN
      RAISE EXCEPTION 'Choose a product from the list, or write a new product name and the service it belongs to' USING ERRCODE = '22023';
    END IF;
    IF v_product IS NOT NULL AND fn_product_visible(p_franchise, v_product) THEN
      RAISE EXCEPTION 'You already have this product' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM catalog_requests WHERE franchise_id = p_franchise AND status = 'pending' AND kind = v_kind
              AND service_id IS NOT DISTINCT FROM v_service AND product_id IS NOT DISTINCT FROM v_product
              AND lower(coalesce(name, '')) = lower(coalesce(v_name, ''))) THEN
    RAISE EXCEPTION 'You have already asked for this — it is waiting for approval' USING ERRCODE = '55000';
  END IF;
  INSERT INTO catalog_requests (franchise_id, kind, service_id, product_id, name, category_id, unit, details, requested_by)
  VALUES (p_franchise, v_kind, v_service, v_product, CASE WHEN v_kind = 'service' AND v_service IS NOT NULL THEN NULL
                                                          WHEN v_kind = 'product' AND v_product IS NOT NULL THEN NULL ELSE v_name END,
          CASE WHEN v_kind = 'service' AND v_service IS NULL THEN v_category END,
          nullif(left(trim(coalesce(p->>'unit', '')), 30), ''), nullif(left(trim(coalesce(p->>'details', '')), 500), ''), p_by)
  RETURNING * INTO v;
  RETURN v;
END $$;

-- Super Admin approves: an existing master service/product is switched on for the dealer; a new one is created
-- (only for that dealer — the Super Admin can give it to others later) and switched on.
CREATE OR REPLACE FUNCTION fn_approve_catalog_request(p_id INT, p_by INT, p_note TEXT) RETURNS catalog_requests
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  r catalog_requests;
  v_service INT;
  v_product INT;
  v_cat categories;
  v_skill TEXT;
BEGIN
  SELECT * INTO r FROM catalog_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'This request was already %', r.status USING ERRCODE = '55000';
  END IF;

  IF r.kind = 'service' THEN
    v_service := r.service_id;
    IF v_service IS NULL THEN
      SELECT * INTO v_cat FROM categories WHERE id = r.category_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Choose the category for the new service' USING ERRCODE = '22023';
      END IF;
      SELECT coalesce((SELECT skill_code FROM services WHERE category_id = v_cat.id GROUP BY skill_code ORDER BY count(*) DESC LIMIT 1), 'general')
        INTO v_skill;
      INSERT INTO services (category_id, slug, name, description, price_unit, sort_order, skill_code)
      VALUES (v_cat.id, v_cat.slug || '-' || trim(both '-' from lower(regexp_replace(r.name, '[^a-zA-Z0-9]+', '-', 'g'))) || '-' || r.id,
              r.name, r.details, 'as per visit', 99, v_skill)
      RETURNING id INTO v_service;
      -- a brand-new service starts only in the requesting franchise
    END IF;
    CALL sp_set_franchise_service(r.franchise_id, v_service, true);
    UPDATE catalog_requests SET service_id = v_service WHERE id = r.id;
  ELSE
    v_product := r.product_id;
    IF v_product IS NULL THEN
      IF NOT EXISTS (SELECT 1 FROM services WHERE id = r.service_id) THEN
        RAISE EXCEPTION 'The service for this product no longer exists' USING ERRCODE = '22023';
      END IF;
      INSERT INTO products (service_id, slug, name, unit, price, description, only_assigned, sort_order)
      VALUES (r.service_id, 'req-' || r.id || '-' || trim(both '-' from lower(regexp_replace(r.name, '[^a-zA-Z0-9]+', '-', 'g'))),
              r.name, coalesce(r.unit, '1 pc'), 0, r.details, true, 999)
      RETURNING id INTO v_product;
    END IF;
    CALL sp_set_franchise_product(r.franchise_id, v_product, true);
    -- the product's service must be on too
    SELECT service_id INTO v_service FROM products WHERE id = v_product;
    IF NOT fn_service_visible(r.franchise_id, v_service) THEN
      CALL sp_set_franchise_service(r.franchise_id, v_service, true);
    END IF;
    UPDATE catalog_requests SET product_id = v_product WHERE id = r.id;
  END IF;

  UPDATE catalog_requests SET status = 'approved', decided_by = p_by, decided_at = now(),
         admin_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   WHERE id = r.id RETURNING * INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE PROCEDURE sp_reject_catalog_request(p_id INT, p_by INT, p_note TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  UPDATE catalog_requests SET status = 'rejected', decided_by = p_by, decided_at = now(),
         admin_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a waiting request can be rejected' USING ERRCODE = '55000';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_catalog_requests(p_franchise INT, p_status TEXT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'status', r.status, 'created_at', r.created_at, 'decided_at', r.decided_at,
           'franchise_id', f.id, 'franchise_code', f.code, 'franchise_name', f.name, 'city', f.city,
           'service_id', r.service_id, 'service_name', s.name, 'product_id', r.product_id, 'product_name', p.name,
           'name', r.name, 'category_name', c.name, 'unit', r.unit, 'details', r.details, 'admin_note', r.admin_note,
           'requested_by', u.full_name, 'is_new', (r.kind = 'service' AND r.name IS NOT NULL) OR (r.kind = 'product' AND r.name IS NOT NULL))
         ORDER BY (r.status = 'pending') DESC, r.created_at DESC), '[]'::jsonb)
    FROM catalog_requests r
    JOIN franchises f ON f.id = r.franchise_id
    LEFT JOIN services s ON s.id = r.service_id
    LEFT JOIN products p ON p.id = r.product_id
    LEFT JOIN categories c ON c.id = r.category_id
    LEFT JOIN users u ON u.id = r.requested_by
   WHERE (p_franchise IS NULL OR r.franchise_id = p_franchise) AND (p_status IS NULL OR r.status = p_status)
$$;

-- Services of one franchise for the assignment screen: every master service with on/off for this franchise.
CREATE OR REPLACE FUNCTION fn_franchise_services(p_franchise INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'slug', s.slug, 'is_active', s.is_active, 'category_id', c.id, 'category_name', c.name,
           'category_icon', c.icon, 'skill_code', s.skill_code,
           'enabled', coalesce(fs.is_enabled, false), 'assigned', fs.service_id IS NOT NULL,
           'products', (SELECT count(*) FROM products p WHERE p.service_id = s.id AND p.is_active),
           'orders', (SELECT count(*) FROM orders o JOIN order_items i ON i.order_id = o.id
                       LEFT JOIN products p ON p.id = i.product_id
                      WHERE o.franchise_id = p_franchise AND coalesce(i.service_id, p.service_id) = s.id))
         ORDER BY c.sort_order, s.sort_order, s.name), '[]'::jsonb)
    FROM services s
    JOIN categories c ON c.id = s.category_id
    LEFT JOIN franchise_services fs ON fs.service_id = s.id AND fs.franchise_id = p_franchise
$$;

-- Products of one service as seen by one franchise (for switching single products off/on).
CREATE OR REPLACE FUNCTION fn_franchise_products(p_franchise INT, p_service_id INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'brand', p.brand, 'unit', p.unit, 'icon', p.icon, 'image_url', p.image_url,
           'section', p.section, 'is_active', p.is_active, 'only_assigned', p.only_assigned,
           'enabled', fn_product_visible(p_franchise, p.id))
         ORDER BY p.sort_order, p.id), '[]'::jsonb)
    FROM products p WHERE p.service_id = p_service_id
$$;

-- ============ complaints ============

CREATE OR REPLACE FUNCTION fn_create_complaint(p_customer INT, p_order INT, p_subject TEXT, p_message TEXT) RETURNS complaints
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v complaints;
  v_franchise INT;
BEGIN
  IF length(trim(coalesce(p_subject, ''))) < 3 THEN
    RAISE EXCEPTION 'Choose what the problem is about' USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p_message, ''))) < 10 THEN
    RAISE EXCEPTION 'Please tell us a little more (at least 10 letters)' USING ERRCODE = '22023';
  END IF;
  IF p_order IS NOT NULL THEN
    SELECT franchise_id INTO v_franchise FROM orders WHERE id = p_order AND customer_id = p_customer;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    -- general complaint: the franchise of the customer's latest order
    SELECT franchise_id INTO v_franchise FROM orders WHERE customer_id = p_customer ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF (SELECT count(*) FROM complaints WHERE customer_id = p_customer AND created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Too many complaints in a short time. Please call us instead.' USING ERRCODE = '55000';
  END IF;
  INSERT INTO complaints (franchise_id, customer_id, order_id, subject, message)
  VALUES (v_franchise, p_customer, p_order, left(trim(p_subject), 80), left(trim(p_message), 1000))
  RETURNING * INTO v;
  RETURN v;
END $$;

CREATE OR REPLACE PROCEDURE sp_update_complaint(p_id INT, p_status TEXT, p_reply TEXT, p_by INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF p_status NOT IN ('open', 'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Unknown status' USING ERRCODE = '22023';
  END IF;
  UPDATE complaints SET status = p_status,
         reply = coalesce(nullif(left(trim(coalesce(p_reply, '')), 1000), ''), reply),
         replied_by = CASE WHEN coalesce(trim(p_reply), '') <> '' THEN p_by ELSE replied_by END,
         replied_at = CASE WHEN coalesce(trim(p_reply), '') <> '' THEN now() ELSE replied_at END,
         updated_at = now()
   WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Complaint not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_complaints(p_franchise INT, p_status TEXT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'subject', c.subject, 'message', c.message, 'status', c.status, 'reply', c.reply,
           'created_at', c.created_at, 'replied_at', c.replied_at, 'order_id', c.order_id,
           'customer_name', u.full_name, 'customer_phone', u.phone, 'franchise_id', f.id, 'franchise_name', f.name, 'city', f.city,
           'agent_name', ag.full_name)
         ORDER BY (c.status IN ('open', 'in_progress')) DESC, c.created_at DESC), '[]'::jsonb)
    FROM complaints c
    JOIN users u ON u.id = c.customer_id
    LEFT JOIN franchises f ON f.id = c.franchise_id
    LEFT JOIN orders o ON o.id = c.order_id
    LEFT JOIN users ag ON ag.id = o.agent_id
   WHERE (p_franchise IS NULL OR c.franchise_id = p_franchise) AND (p_status IS NULL OR c.status = p_status)
$$;
