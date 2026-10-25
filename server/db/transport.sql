-- 🚚 Goods Transportation (2026-10-26). Re-runnable. Runs after franchise.sql.
-- A directory of goods vehicles (Tata Ace, Bolero pickup, goods auto, DCM, tractor, lorry…): the franchise admin adds
-- the vehicles of their city — with 2–3 photos the owner sent and the owner's permission — and customers call or
-- WhatsApp the owner directly. All Services only connects them: no booking and no payment in the app; the rate and the
-- trip are agreed between the customer and the owner. Customers can report a wrong number / bad experience.
CREATE TABLE IF NOT EXISTS transport_vehicles (
  id               SERIAL PRIMARY KEY,
  franchise_id     INT NOT NULL REFERENCES franchises(id),
  vehicle_type     VARCHAR(10) NOT NULL CHECK (vehicle_type IN ('ace', 'pickup', 'auto', 'dcm', 'tempo', 'tractor', 'lorry', 'other')),
  model            VARCHAR(60) NOT NULL,                  -- e.g. Tata Ace Gold, Mahindra Bolero Pickup
  capacity         VARCHAR(40) NOT NULL,                  -- e.g. 750 kg, 1.5 ton
  body             VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (body IN ('open', 'closed', 'trolley')),
  owner_name       VARCHAR(60) NOT NULL,
  phone            VARCHAR(10) NOT NULL,
  vehicle_number   VARCHAR(15) NOT NULL,                  -- e.g. TS 36 AB 1234
  area             VARCHAR(80) NOT NULL,
  rate_note        VARCHAR(100),                          -- e.g. ₹400 a trip in town (a hint — agreed with the owner)
  photos           TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(photos) <= 3),
  verified         BOOLEAN NOT NULL DEFAULT false,        -- the admin saw the RC and the driving licence
  consent_recorded BOOLEAN NOT NULL CHECK (consent_recorded),
  is_available     BOOLEAN NOT NULL DEFAULT true,         -- "Busy today" = shown greyed
  is_active        BOOLEAN NOT NULL DEFAULT true,         -- switched off = hidden (sold, owner stopped)
  call_count       INT NOT NULL DEFAULT 0,
  whatsapp_count   INT NOT NULL DEFAULT 0,
  is_sample        BOOLEAN NOT NULL DEFAULT false,        -- test vehicles (removable)
  created_by       INT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS transport_vehicle_number_unique ON transport_vehicles (franchise_id, vehicle_number) WHERE is_active;
CREATE INDEX IF NOT EXISTS transport_list_idx ON transport_vehicles (franchise_id, vehicle_type) WHERE is_active;
CREATE OR REPLACE TRIGGER transport_vehicles_audit AFTER INSERT OR UPDATE OR DELETE ON transport_vehicles FOR EACH ROW EXECUTE FUNCTION trg_audit();

CREATE TABLE IF NOT EXISTS transport_reports (
  id          SERIAL PRIMARY KEY,
  vehicle_id  INT NOT NULL REFERENCES transport_vehicles(id) ON DELETE CASCADE,
  customer_id INT REFERENCES users(id) ON DELETE SET NULL,
  reason      VARCHAR(30) NOT NULL CHECK (reason IN ('wrong_number', 'not_answering', 'bad_experience', 'other')),
  note        VARCHAR(300),
  status      VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transport_reports_vehicle_idx ON transport_reports (vehicle_id);

-- Adds (p_id NULL) or changes a vehicle. p_franchise: the admin's city (NULL on update = keep).
-- p: {vehicle_type, model, capacity, body, owner_name, phone, vehicle_number, area, rate_note, photos[], verified,
--     consent_recorded, is_available, is_active}
CREATE OR REPLACE FUNCTION fn_save_vehicle(p_id INT, p_franchise INT, p JSONB, p_user INT) RETURNS transport_vehicles
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v        transport_vehicles;
  v_phone  TEXT := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  v_number TEXT := upper(regexp_replace(trim(coalesce(p->>'vehicle_number', '')), '\s+', ' ', 'g'));
  v_city   INT := coalesce(p_franchise, (SELECT franchise_id FROM transport_vehicles WHERE id = p_id));
  v_photos TEXT[] := ARRAY(SELECT x FROM jsonb_array_elements_text(coalesce(p->'photos', '[]'::jsonb)) x WHERE x ~ '^/uploads/' LIMIT 3);
BEGIN
  IF length(v_phone) = 12 AND v_phone LIKE '91%' THEN v_phone := substr(v_phone, 3); END IF;
  IF coalesce(p->>'vehicle_type', '') NOT IN ('ace', 'pickup', 'auto', 'dcm', 'tempo', 'tractor', 'lorry', 'other') THEN
    RAISE EXCEPTION 'Choose the vehicle type' USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p->>'model', ''))) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'Enter the vehicle (e.g. Tata Ace Gold)' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p->>'capacity', ''))) NOT BETWEEN 2 AND 40 THEN RAISE EXCEPTION 'Enter how much it carries (e.g. 750 kg, 1.5 ton)' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p->>'owner_name', ''))) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'Enter the owner''s name' USING ERRCODE = '22023'; END IF;
  IF v_phone !~ '^[6-9]\d{9}$' THEN RAISE EXCEPTION 'Enter the owner''s 10-digit mobile number' USING ERRCODE = '22023'; END IF;
  IF v_number !~ '^[A-Z]{2} ?\d{1,2} ?[A-Z]{0,3} ?\d{1,4}$' THEN RAISE EXCEPTION 'Enter the vehicle number (e.g. TS 36 AB 1234)' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p->>'area', ''))) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Enter the area or village' USING ERRCODE = '22023'; END IF;
  IF coalesce(p->>'body', 'open') NOT IN ('open', 'closed', 'trolley') THEN RAISE EXCEPTION 'Choose the body: open, closed or trolley' USING ERRCODE = '22023'; END IF;
  IF NOT coalesce((p->>'consent_recorded')::boolean, false) THEN
    RAISE EXCEPTION 'Add a vehicle only after the owner agrees to show the photos and number — tick "Owner''s permission recorded"' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM transport_vehicles WHERE vehicle_number = v_number AND is_active AND id IS DISTINCT FROM p_id AND franchise_id = v_city) THEN
    RAISE EXCEPTION 'This vehicle is already in the list' USING ERRCODE = '55000';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO transport_vehicles (franchise_id, vehicle_type, model, capacity, body, owner_name, phone, vehicle_number, area, rate_note, photos,
                                    verified, consent_recorded, is_available, is_active, created_by)
    VALUES (p_franchise, p->>'vehicle_type', trim(p->>'model'), trim(p->>'capacity'), coalesce(p->>'body', 'open'), trim(p->>'owner_name'), v_phone,
            v_number, trim(p->>'area'), nullif(left(trim(coalesce(p->>'rate_note', '')), 100), ''), v_photos,
            coalesce((p->>'verified')::boolean, false), true, coalesce((p->>'is_available')::boolean, true), coalesce((p->>'is_active')::boolean, true), p_user)
    RETURNING * INTO v;
  ELSE
    UPDATE transport_vehicles SET vehicle_type = p->>'vehicle_type', model = trim(p->>'model'), capacity = trim(p->>'capacity'),
           body = coalesce(p->>'body', body), owner_name = trim(p->>'owner_name'), phone = v_phone, vehicle_number = v_number,
           area = trim(p->>'area'), rate_note = nullif(left(trim(coalesce(p->>'rate_note', '')), 100), ''), photos = v_photos,
           verified = coalesce((p->>'verified')::boolean, verified), consent_recorded = true,
           is_available = coalesce((p->>'is_available')::boolean, is_available), is_active = coalesce((p->>'is_active')::boolean, is_active),
           updated_at = now()
     WHERE id = p_id RETURNING * INTO v;
    IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN v;
END $$;

-- The city's vehicles for customers (the owner's number only when p_with_phone — logged-in customers), with how many
-- of each type. p_type NULL = all. Available first, then verified, then the most called.
CREATE OR REPLACE FUNCTION fn_transport_list(p_franchise INT, p_type TEXT, p_with_phone BOOLEAN) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object(
    'counts', coalesce((SELECT jsonb_object_agg(vehicle_type, n) FROM (SELECT vehicle_type, count(*) AS n FROM transport_vehicles
                         WHERE franchise_id = p_franchise AND is_active GROUP BY 1) c), '{}'::jsonb),
    'vehicles', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', v.id, 'vehicle_type', v.vehicle_type, 'model', v.model, 'capacity', v.capacity, 'body', v.body, 'owner_name', v.owner_name,
        'phone', CASE WHEN p_with_phone THEN v.phone END, 'vehicle_number', v.vehicle_number, 'area', v.area, 'rate_note', v.rate_note,
        'photos', to_jsonb(v.photos), 'verified', v.verified, 'is_available', v.is_available)
        ORDER BY v.is_available DESC, v.verified DESC, v.call_count + v.whatsapp_count DESC, v.id)
      FROM transport_vehicles v
     WHERE v.franchise_id = p_franchise AND v.is_active AND (p_type IS NULL OR v.vehicle_type = p_type)), '[]'::jsonb))
$$;

-- A customer taps Call / WhatsApp: counted for the admin (demand) — returns the owner's number.
CREATE OR REPLACE FUNCTION fn_transport_contact(p_id INT, p_kind TEXT) RETURNS TEXT
LANGUAGE sql SET search_path FROM CURRENT AS $$
  UPDATE transport_vehicles SET call_count = call_count + (p_kind = 'call')::int, whatsapp_count = whatsapp_count + (p_kind = 'whatsapp')::int
   WHERE id = p_id AND is_active RETURNING phone
$$;
