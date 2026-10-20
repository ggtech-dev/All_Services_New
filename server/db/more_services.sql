-- 👷 Daily Workers and 💡 Digital Services (2026-10-20). Re-runnable. Runs after franchise.sql.
-- (🛠️ Shop For Me needs no tables: its 8 shops are "write your list" services — see setup.js and services.max_items.)

-- ============ 👷 Daily Workers ============
-- A free directory: the franchise admin adds local workers (masons, painters, helpers…) with their permission
-- (recorded in the admin's register and ticked here). Customers see the list; the phone number after a free login,
-- then call or WhatsApp directly. No booking and no payment — All Services only shares the contact.
CREATE TABLE IF NOT EXISTS workers (
  id               SERIAL PRIMARY KEY,
  franchise_id     INT NOT NULL REFERENCES franchises(id),
  tab              VARCHAR(12) NOT NULL CHECK (tab IN ('construction', 'painters', 'other')),
  name             VARCHAR(60) NOT NULL,
  phone            VARCHAR(10) NOT NULL,
  skill            VARCHAR(60) NOT NULL,
  area             VARCHAR(80) NOT NULL,
  experience_years INT CHECK (experience_years BETWEEN 0 AND 60),
  is_available     BOOLEAN NOT NULL DEFAULT true,   -- "Not available" = shown greyed (busy / out of town)
  id_checked       BOOLEAN NOT NULL DEFAULT false,  -- the admin saw their Aadhaar → "✔ ID checked"
  consent_recorded BOOLEAN NOT NULL CHECK (consent_recorded),
  is_active        BOOLEAN NOT NULL DEFAULT true,   -- switched off = hidden from customers
  call_count       INT NOT NULL DEFAULT 0,
  created_by       INT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workers_phone_unique ON workers (franchise_id, phone) WHERE is_active;
CREATE INDEX IF NOT EXISTS workers_list_idx ON workers (franchise_id, tab) WHERE is_active;

-- "Number not working / bad experience" from customers → the franchise admin checks it.
CREATE TABLE IF NOT EXISTS worker_reports (
  id          SERIAL PRIMARY KEY,
  worker_id   INT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  customer_id INT REFERENCES users(id) ON DELETE SET NULL,
  reason      VARCHAR(30) NOT NULL CHECK (reason IN ('wrong_number', 'not_answering', 'bad_experience', 'other')),
  note        VARCHAR(300),
  status      VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worker_reports_worker_idx ON worker_reports (worker_id);
CREATE OR REPLACE TRIGGER workers_audit AFTER INSERT OR UPDATE OR DELETE ON workers FOR EACH ROW EXECUTE FUNCTION trg_audit();

-- Adds (p_id NULL) or changes a worker. p_franchise: the admin's franchise (NULL on update = keep).
CREATE OR REPLACE FUNCTION fn_save_worker(p_id INT, p_franchise INT, p_tab TEXT, p_name TEXT, p_phone TEXT, p_skill TEXT, p_area TEXT,
                                          p_experience INT, p_available BOOLEAN, p_id_checked BOOLEAN, p_consent BOOLEAN,
                                          p_active BOOLEAN, p_user INT)
RETURNS workers
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v workers;
  v_phone TEXT := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
BEGIN
  IF length(v_phone) = 12 AND v_phone LIKE '91%' THEN v_phone := substr(v_phone, 3); END IF;
  IF p_tab NOT IN ('construction', 'painters', 'other') THEN
    RAISE EXCEPTION 'Choose the tab: Construction, Painters or Other work' USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'Enter the worker''s name' USING ERRCODE = '22023';
  END IF;
  IF v_phone !~ '^[6-9]\d{9}$' THEN
    RAISE EXCEPTION 'Enter a valid 10-digit mobile number' USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p_skill, ''))) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'Enter the work they do (mason, helper, painter…)' USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p_area, ''))) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'Enter the area or village' USING ERRCODE = '22023';
  END IF;
  IF p_experience IS NOT NULL AND p_experience NOT BETWEEN 0 AND 60 THEN
    RAISE EXCEPTION 'Experience must be 0 to 60 years' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(p_consent, false) THEN
    RAISE EXCEPTION 'Add a worker only after they agree to show their number — tick "Worker''s permission recorded"' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM workers WHERE phone = v_phone AND is_active AND id IS DISTINCT FROM p_id
                AND franchise_id = coalesce(p_franchise, (SELECT franchise_id FROM workers WHERE id = p_id))) THEN
    RAISE EXCEPTION 'A worker with this number is already in the list' USING ERRCODE = '55000';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO workers (franchise_id, tab, name, phone, skill, area, experience_years, is_available, id_checked, consent_recorded, is_active, created_by)
    VALUES (p_franchise, p_tab, trim(p_name), v_phone, trim(p_skill), trim(p_area), p_experience, coalesce(p_available, true),
            coalesce(p_id_checked, false), true, coalesce(p_active, true), p_user)
    RETURNING * INTO v;
  ELSE
    UPDATE workers SET tab = p_tab, name = trim(p_name), phone = v_phone, skill = trim(p_skill), area = trim(p_area), experience_years = p_experience,
                       is_available = coalesce(p_available, is_available), id_checked = coalesce(p_id_checked, id_checked),
                       consent_recorded = true, is_active = coalesce(p_active, is_active), updated_at = now()
     WHERE id = p_id RETURNING * INTO v;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Worker not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v;
END $$;

-- ============ 💡 Digital Services ============
-- Customers ask for software / website / app / video work; ONLY HQ (Super Admin) sees the requests, calls the person and
-- closes the deal outside the app. No price and no payment in the app.
CREATE TABLE IF NOT EXISTS digital_requests (
  id          SERIAL PRIMARY KEY,
  customer_id INT REFERENCES users(id) ON DELETE SET NULL,
  tab         VARCHAR(10) NOT NULL CHECK (tab IN ('software', 'video')),
  service     VARCHAR(60) NOT NULL,
  name        VARCHAR(60) NOT NULL,
  phone       VARCHAR(10) NOT NULL,
  details     VARCHAR(1500) NOT NULL,
  timing      VARCHAR(40) NOT NULL,
  budget      VARCHAR(40),
  link        VARCHAR(500),
  city        VARCHAR(60),
  status      VARCHAR(10) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'called', 'quoted', 'won', 'lost')),
  notes       VARCHAR(1000),
  updated_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS digital_requests_status_idx ON digital_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS digital_requests_customer_idx ON digital_requests (customer_id, created_at DESC);
