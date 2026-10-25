-- Orders, delivery agents and agent wallet. Re-runnable (CREATE OR REPLACE).
-- Same conventions as functions.sql: 22023 = validation error (HTTP 400), P0002 = not found (404),
-- 55000 = conflict such as "order already taken" (409). Every function pins its search_path.

-- ============ helpers ============

-- Numeric site setting with a fallback (settings are editable text in the admin panel).
CREATE OR REPLACE FUNCTION fn_setting_num(p_key TEXT, p_default NUMERIC) RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(
    (SELECT value::numeric FROM site_settings WHERE key = p_key AND value ~ '^\d+(\.\d+)?$'),
    p_default)
$$;

-- Straight-line distance in km between two points (haversine).
CREATE OR REPLACE FUNCTION fn_distance_km(lat1 NUMERIC, lng1 NUMERIC, lat2 NUMERIC, lng2 NUMERIC) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $$
  SELECT round((6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))::numeric, 1)
$$;

-- Delivery charge the customer pays on their next order, whose normal charge is p_base
-- (set per service by the admin): free for their first N deliveries that have a charge (setting free_delivery_orders).
DROP FUNCTION IF EXISTS fn_delivery_fee_for(INT);
-- Free deliveries (launch offer) already given to this customer's MOBILE NUMBER — by any account that has the
-- number — so the offer is given once per number, not once per account. Only orders whose charge was really waived
-- count (orders.free_delivery): a water can (delivery included) or a plumber visit (no charge) does not use it up,
-- and a cancelled order gives it back.
DROP FUNCTION IF EXISTS fn_customer_order_count(INT);
CREATE OR REPLACE FUNCTION fn_free_deliveries_used(p_customer_id INT) RETURNS INT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  WITH me AS (SELECT right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) AS ph FROM users WHERE id = p_customer_id)
  SELECT count(*)::int FROM orders o
   WHERE o.status <> 'cancelled' AND o.free_delivery
     AND (o.customer_id = p_customer_id
          OR o.customer_id IN (SELECT u.id FROM users u, me WHERE length(me.ph) = 10
                                 AND right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10) = me.ph))
$$;

CREATE OR REPLACE FUNCTION fn_delivery_fee_for(p_customer_id INT, p_base NUMERIC) RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT CASE
    WHEN fn_free_deliveries_used(p_customer_id)
         < fn_setting_num('free_delivery_orders', 3) THEN 0
    ELSE greatest(coalesce(p_base, 0), 0)
  END
$$;

-- ============ tracking timeline ============

CREATE OR REPLACE FUNCTION trg_order_event() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
    INSERT INTO order_events (order_id, status, note, actor_id)
    VALUES (NEW.id, NEW.status, nullif(current_setting('app.event_note', true), ''), fn_current_actor());
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER orders_event AFTER INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION trg_order_event();

-- ============ customer: place / cancel ============

-- Places an order. Prices always come from the database, never from the browser.
--   p_items:      product order, any mix of
--                   {"product_id": 1, "qty": 2, "note": "curry cut"}           (qty 1.5 for kg items)
--                   {"service_id": 19, "name": "Sugar", "qty_text": "2 kg"}     (customer's own list — kirana etc.)
--   p_service_id: a service to book instead of products
--   p_contact:    {"name","phone","address_line","landmark","locality_id","pincode"}
--   p_list_photo: file name of a photo of the customer's handwritten list (already saved by the API)
--   p_shop_id / p_shop_name: the shop the customer wants the agent to buy from (optional)
--   p_via_service_id: ordered through ⚡ Instant Delivery (instant.sql): products from its source shops and its own
--                 "Others" list; no delivery time window; the order goes only to that service's agent type
DROP FUNCTION IF EXISTS fn_place_order(INT, JSONB, INT, JSONB, TEXT, TEXT);
DROP FUNCTION IF EXISTS fn_place_order(INT, JSONB, INT, JSONB, TEXT, TEXT, TEXT, INT, TEXT);
CREATE OR REPLACE FUNCTION fn_place_order(
  p_customer_id INT, p_items JSONB, p_service_id INT, p_contact JSONB, p_slot TEXT, p_notes TEXT,
  p_list_photo TEXT DEFAULT NULL, p_shop_id INT DEFAULT NULL, p_shop_name TEXT DEFAULT NULL,
  p_via_service_id INT DEFAULT NULL
) RETURNS orders
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v          orders;
  v_item     JSONB;
  v_prod     RECORD;
  v_svc      services;
  v_lsvc     RECORD;
  v_qty      NUMERIC;
  v_price    NUMERIC;
  v_win      RECORD;
  v_sub      NUMERIC := 0;
  v_fee      NUMERIC := 0;
  v_offer    BOOLEAN := false;  -- the delivery charge was waived by the launch offer
  v_base     NUMERIC := 0;
  v_kind     TEXT;
  v_skills   TEXT[] := ARRAY[]::TEXT[];
  v_skill    TEXT;
  v_services INT[];
  v_name     TEXT;
  v_qtytext  TEXT;
  v_via      services;  -- ⚡ Instant Delivery (or NULL)
  v_slot     TEXT := p_slot;
  v_shopname TEXT := nullif(left(trim(regexp_replace(coalesce(p_shop_name, ''), '\s+', ' ', 'g')), 80), '');
  v_phone    TEXT := regexp_replace(coalesce(p_contact->>'phone', ''), '\D', '', 'g');
BEGIN
  -- contact & address
  IF coalesce(trim(p_contact->>'name'), '') = '' THEN
    RAISE EXCEPTION 'Please enter the name for delivery' USING ERRCODE = '22023';
  END IF;
  IF length(v_phone) = 12 AND v_phone LIKE '91%' THEN v_phone := substr(v_phone, 3); END IF;
  IF v_phone !~ '^[6-9]\d{9}$' THEN
    RAISE EXCEPTION 'Enter a valid 10-digit mobile number' USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p_contact->>'address_line', ''))) < 5 THEN
    RAISE EXCEPTION 'Please enter your full address (house no, street)' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM localities WHERE id = (p_contact->>'locality_id')::int AND is_active) THEN
    RAISE EXCEPTION 'Please choose your area' USING ERRCODE = '22023';
  END IF;
  -- 📍 the delivery location (GPS / pin) is required and must be inside the chosen area's franchise range (geo.sql)
  PERFORM fn_check_order_location(p_contact);

  v_kind := CASE WHEN p_service_id IS NOT NULL THEN 'service' ELSE 'products' END;

  IF v_kind = 'service' THEN
    SELECT s.* INTO v_svc FROM services s JOIN categories c ON c.id = s.category_id
     WHERE s.id = p_service_id AND s.is_active AND c.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This service is not available right now' USING ERRCODE = '22023';
    END IF;
    -- shops with their own page (⚡ Instant, 🏡 Village Needs) and 🚗 Share Ride (seat bookings) are never a "visit" booking
    IF v_svc.is_village OR coalesce(cardinality(v_svc.source_service_ids), 0) > 0 OR v_svc.skill_code = 'shared_car_agent'
       OR v_svc.allows_list OR EXISTS (SELECT 1 FROM categories c WHERE c.id = v_svc.category_id AND c.slug IN ('daily-workers', 'digital-services')) THEN
      RAISE EXCEPTION 'Please order this from its own page' USING ERRCODE = '22023';
    END IF;
    -- franchise (city) of the delivery area: open, and offering this service (franchise.sql)
    PERFORM fn_check_franchise_order((p_contact->>'locality_id')::int, ARRAY[p_service_id], NULL);
    v_sub := v_svc.base_price;
    v_skill := v_svc.skill_code;
    v_fee := fn_delivery_fee_for(p_customer_id, v_svc.delivery_fee);
    v_offer := coalesce(v_svc.delivery_fee, 0) > 0 AND v_fee = 0;
  ELSE
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'Your cart is empty' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_items) > 40 THEN
      RAISE EXCEPTION 'Too many different items in one order (max 40)' USING ERRCODE = '22023';
    END IF;
    -- own-list lines only for services that take lists (checked first, so the message is the right one)
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x
                WHERE x->>'product_id' IS NULL
                  AND NOT EXISTS (SELECT 1 FROM services s WHERE s.id::text = x->>'service_id' AND s.is_active AND s.allows_list)) THEN
      RAISE EXCEPTION 'Your own list can only be sent for kirana and similar shops' USING ERRCODE = '22023';
    END IF;
    -- every service in the cart: of the picked products, and of the customer's own list lines
    v_services := ARRAY(
      SELECT p.service_id FROM products p
       WHERE p.id IN (SELECT (x->>'product_id')::int FROM jsonb_array_elements(p_items) x WHERE x->>'product_id' ~ '^\d{1,9}$')
      UNION
      SELECT (x->>'service_id')::int FROM jsonb_array_elements(p_items) x
       WHERE x->>'product_id' IS NULL AND x->>'service_id' ~ '^\d{1,9}$');
    -- 🛠️ some shops take only a few items per order (Shop For Me: 3 — small things that fit on a bike)
    SELECT s.name, s.max_items INTO v_lsvc FROM services s
     WHERE s.max_items IS NOT NULL
       AND (SELECT count(*) FROM jsonb_array_elements(p_items) x WHERE x->>'product_id' IS NULL AND x->>'service_id' = s.id::text) > s.max_items
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'You can order up to % items at a time from %. Please place another order for the rest.', v_lsvc.max_items, v_lsvc.name USING ERRCODE = '22023';
    END IF;
    -- franchise (city) of the delivery area: open, and offering every service / product in this order (franchise.sql)
    PERFORM fn_check_franchise_order((p_contact->>'locality_id')::int, v_services || coalesce(p_via_service_id, NULL::int),
      ARRAY(SELECT (x->>'product_id')::int FROM jsonb_array_elements(p_items) x WHERE x->>'product_id' ~ '^\d{1,9}$'));

    IF p_via_service_id IS NOT NULL THEN
      -- ⚡ Instant: only products of its source shops and lines of its own "Others" list; its own charge; no window
      SELECT s.* INTO v_via FROM services s JOIN categories c ON c.id = s.category_id
       WHERE s.id = p_via_service_id AND s.is_active AND c.is_active AND coalesce(cardinality(s.source_service_ids), 0) > 0;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Instant delivery is not available right now' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM unnest(v_services) x WHERE NOT (x = ANY (v_via.source_service_ids || v_via.id))) THEN
        RAISE EXCEPTION 'Some items in your cart are not part of % — please order them separately', v_via.name USING ERRCODE = '22023';
      END IF;
      IF v_via.is_village THEN
        -- 🏡 Village Needs (village.sql): only to villages we serve; the village's charge; next-day slot
        v_fee := fn_village_fee((p_contact->>'locality_id')::int);
        IF v_fee IS NULL THEN
          RAISE EXCEPTION 'Sorry, Village Needs is not available for this village yet. Please choose your village from the list.' USING ERRCODE = '22023';
        END IF;
        IF fn_village_slot_date(p_slot) IS NULL THEN
          RAISE EXCEPTION 'Please choose a delivery day and time (orders are delivered from tomorrow)' USING ERRCODE = '22023';
        END IF;
        v_slot := p_slot;
      ELSE
        v_fee := fn_delivery_fee_for(p_customer_id, v_via.delivery_fee);
        v_offer := coalesce(v_via.delivery_fee, 0) > 0 AND v_fee = 0;
        v_slot := format('Now — within %s min', coalesce(v_via.eta_minutes, 10));
      END IF;
      v_services := v_services || v_via.id;
    ELSE
    -- Villages get shop items only through 🏡 Village Needs (next day, our own staff).
    IF EXISTS (SELECT 1 FROM localities WHERE id = (p_contact->>'locality_id')::int AND is_village) THEN
      RAISE EXCEPTION 'For villages, please order through 🏡 Village Needs (next-day delivery).' USING ERRCODE = '22023';
    END IF;
    -- One trip: a cart from several shops pays the highest delivery charge among them.
    SELECT coalesce(max(s.delivery_fee), 0) INTO v_base FROM services s WHERE s.id = ANY(v_services);
    v_fee := fn_delivery_fee_for(p_customer_id, v_base);
    v_offer := v_base > 0 AND v_fee = 0;

    -- Daily services deliver only in their time window (e.g. 6–10 AM): the slot must be one we offered.
    SELECT * INTO v_win FROM fn_window_of(v_services);
    IF v_win.conflict THEN
      RAISE EXCEPTION 'Some items in your cart are delivered at different times of the day. Please order them separately.' USING ERRCODE = '22023';
    END IF;
    IF v_win.win_from IS NOT NULL AND NOT (coalesce(trim(p_slot), '') = ANY(fn_delivery_slots(v_win.win_from, v_win.win_to))) THEN
      RAISE EXCEPTION 'Please choose a delivery time between % and %', fn_hour_label(v_win.win_from), fn_hour_label(v_win.win_to) USING ERRCODE = '22023';
    END IF;
    END IF;

    -- the shop to buy from: one of ours (selling for this cart), or a name the customer typed
    IF p_shop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shops WHERE id = p_shop_id AND is_active AND service_ids && v_services) THEN
      RAISE EXCEPTION 'Please choose the shop again from the list' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO orders (customer_id, kind, contact_name, contact_phone, address_line, landmark, locality_id, pincode,
                      slot, notes, subtotal, delivery_fee, total, delivery_otp, skill_code, dest_lat, dest_lng,
                      list_photo, preferred_shop_id, preferred_shop_name, via_service_id)
  VALUES (p_customer_id, v_kind, trim(p_contact->>'name'), v_phone, trim(p_contact->>'address_line'),
          nullif(trim(p_contact->>'landmark'), ''), (p_contact->>'locality_id')::int,
          nullif(trim(p_contact->>'pincode'), ''), nullif(trim(v_slot), ''), nullif(trim(p_notes), ''),
          0, v_fee, 0, lpad(floor(random() * 10000)::int::text, 4, '0'), coalesce(v_skill, 'delivery'),
          -- exact pin only if it looks like a real point in India
          CASE WHEN (p_contact->>'lat') ~ '^-?\d+(\.\d+)?$' AND (p_contact->>'lat')::numeric BETWEEN 6 AND 37.5
                AND (p_contact->>'lng') ~ '^-?\d+(\.\d+)?$' AND (p_contact->>'lng')::numeric BETWEEN 68 AND 97.5
               THEN round((p_contact->>'lat')::numeric, 6) END,
          CASE WHEN (p_contact->>'lat') ~ '^-?\d+(\.\d+)?$' AND (p_contact->>'lat')::numeric BETWEEN 6 AND 37.5
                AND (p_contact->>'lng') ~ '^-?\d+(\.\d+)?$' AND (p_contact->>'lng')::numeric BETWEEN 68 AND 97.5
               THEN round((p_contact->>'lng')::numeric, 6) END,
          CASE WHEN v_kind = 'products' THEN nullif(p_list_photo, '') END,
          CASE WHEN v_kind = 'products' THEN p_shop_id END,
          CASE WHEN v_kind = 'products' AND p_shop_id IS NULL THEN v_shopname END, v_via.id)
  RETURNING * INTO v;
  IF v_via.is_village THEN
    UPDATE orders SET deliver_on = fn_village_slot_date(p_slot) WHERE id = v.id RETURNING * INTO v;
  END IF;

  IF v_kind = 'service' THEN
    INSERT INTO order_items (order_id, service_id, name, unit, price, qty, line_total)
    VALUES (v.id, v_svc.id, v_svc.name, v_svc.price_unit, v_svc.base_price, 1, v_svc.base_price);
  ELSE
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      IF v_item->>'product_id' IS NULL THEN
        -- a line of the customer's own list: "Sugar — 2 kg", priced by the shop bill
        SELECT s.id, s.name, s.skill_code INTO v_lsvc FROM services s JOIN categories c ON c.id = s.category_id
         WHERE s.id = CASE WHEN v_item->>'service_id' ~ '^\d{1,9}$' THEN (v_item->>'service_id')::int END
           AND s.is_active AND c.is_active AND s.allows_list;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Your own list can only be sent for kirana and similar shops' USING ERRCODE = '22023';
        END IF;
        v_name := left(trim(regexp_replace(coalesce(v_item->>'name', ''), '\s+', ' ', 'g')), 80);
        v_qtytext := left(trim(regexp_replace(coalesce(v_item->>'qty_text', ''), '\s+', ' ', 'g')), 30);
        IF length(v_name) < 2 THEN
          RAISE EXCEPTION 'Write the item name for every line of your list' USING ERRCODE = '22023';
        END IF;
        IF v_qtytext = '' AND v_via.id IS NOT NULL AND v_lsvc.id = v_via.id THEN
          v_qtytext := 'as written'; -- ⚡ "Others": anything, the quantity is optional
        ELSIF v_qtytext = '' THEN
          RAISE EXCEPTION 'Write how much you need of %', v_name USING ERRCODE = '22023';
        END IF;
        INSERT INTO order_items (order_id, service_id, name, unit, price, qty, line_total, sell_by, on_bill, note)
        VALUES (v.id, v_lsvc.id, v_name, v_qtytext, 0, 1, 0, 'custom', true,
                nullif(left(trim(regexp_replace(coalesce(v_item->>'note', ''), '\s+', ' ', 'g')), 200), ''));
        v_skills := array_append(v_skills, v_lsvc.skill_code);
        CONTINUE;
      END IF;

      SELECT p.id, p.name, p.brand, p.unit, p.price, p.in_stock, p.sell_by, p.note_options, s.skill_code, s.price_on_bill INTO v_prod
        FROM products p JOIN services s ON s.id = p.service_id
       WHERE p.id = CASE WHEN v_item->>'product_id' ~ '^\d{1,9}$' THEN (v_item->>'product_id')::int END AND p.is_active AND s.is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'An item in your cart is no longer available. Please remove it and try again.' USING ERRCODE = '22023';
      END IF;
      IF NOT fn_product_in_stock(v.franchise_id, v_prod.id) THEN
        RAISE EXCEPTION '% is out of stock. Please remove it from your cart.', v_prod.name USING ERRCODE = '22023';
      END IF;
      -- kg in 250 g steps, litres in 500 ml steps, packs / bunches / pieces 1–50
      v_qty := CASE WHEN (v_item->>'qty') ~ '^\d{1,3}(\.\d{1,2})?$' THEN (v_item->>'qty')::numeric END;
      IF NOT fn_qty_ok(v_prod.sell_by, v_qty) THEN
        RAISE EXCEPTION 'Please choose a valid quantity for %', v_prod.name USING ERRCODE = '22023';
      END IF;
      -- "price as per shop bill" items count ₹0 now; the shop bill sets the amount later
      v_price := CASE WHEN v_prod.price_on_bill THEN 0 ELSE v_prod.price END;
      INSERT INTO order_items (order_id, product_id, name, unit, price, qty, line_total, sell_by, on_bill, note)
      VALUES (v.id, v_prod.id, v_prod.name, v_prod.unit, v_price, v_qty, round(v_price * v_qty, 2), v_prod.sell_by,
              v_prod.price_on_bill, nullif(left(trim(regexp_replace(coalesce(v_item->>'note', ''), '\s+', ' ', 'g')), 200), ''));
      v_sub := v_sub + round(v_price * v_qty, 2);
      v_skills := array_append(v_skills, v_prod.skill_code);
    END LOOP;
    -- Products from one kind of service go to that type of agent; a mixed cart goes to delivery agents.
    v_skill := CASE WHEN (SELECT count(DISTINCT x) FROM unnest(v_skills) x) = 1 THEN v_skills[1] ELSE 'delivery' END;
    -- 💧 water cans are delivered by the company's own staff: never in one order with other items
    -- (🏡 Village Needs orders also go to our staff, through v_via below — they are not water orders)
    IF v_via.id IS NULL AND 'our_service_employees' = ANY (v_skills) AND v_skill <> 'our_service_employees' THEN
      RAISE EXCEPTION 'Water cans are delivered by our own team as a separate order. Please order them alone (remove the other items first).' USING ERRCODE = '22023';
    END IF;
    -- ⚡ Instant orders go only to the instant service's agent type, whatever shops the items come from
    IF v_via.id IS NOT NULL THEN
      v_skill := v_via.skill_code;
    END IF;
  END IF;

  UPDATE orders SET subtotal = v_sub, total = v_sub + v_fee, skill_code = v_skill, free_delivery = v_offer WHERE id = v.id RETURNING * INTO v;
  RETURN v;
END $$;

-- Customers can cancel while nobody has picked the order up; admins any time before delivery.
CREATE OR REPLACE PROCEDURE sp_cancel_order(p_order_id INT, p_actor_id INT, p_is_admin BOOLEAN, p_reason TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v orders;
BEGIN
  SELECT * INTO v FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR (NOT p_is_admin AND v.customer_id <> p_actor_id) THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'This order is already %', v.status USING ERRCODE = '55000';
  END IF;
  IF NOT p_is_admin AND v.status NOT IN ('placed', 'assigned') THEN
    RAISE EXCEPTION 'Your order is already on the way and can''t be cancelled. Please call support.' USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('app.event_note', coalesce(nullif(trim(p_reason), ''), CASE WHEN p_is_admin THEN 'Cancelled by admin' ELSE 'Cancelled by customer' END), true);
  UPDATE orders SET status = 'cancelled', cancelled_at = now(),
         cancel_reason = coalesce(nullif(trim(p_reason), ''), CASE WHEN p_is_admin THEN 'Cancelled by admin' ELSE 'Cancelled by customer' END)
   WHERE id = p_order_id;
END $$;

-- ============ agents: apply, review, status ============

-- Validates a list of service-type codes for an agent: known, active, at least one, no duplicates.
CREATE OR REPLACE FUNCTION fn_clean_skills(p_skills TEXT[]) RETURNS TEXT[]
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  v TEXT[] := ARRAY(SELECT DISTINCT trim(x) FROM unnest(coalesce(p_skills, '{}')) x WHERE trim(x) <> '' ORDER BY 1);
  v_bad TEXT;
BEGIN
  IF cardinality(v) = 0 THEN
    RAISE EXCEPTION 'Choose at least one type of work' USING ERRCODE = '22023';
  END IF;
  SELECT x INTO v_bad FROM unnest(v) x WHERE NOT EXISTS (SELECT 1 FROM service_types t WHERE t.code = x AND t.is_active) LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown type of work: %', v_bad USING ERRCODE = '22023';
  END IF;
  RETURN v;
END $$;

-- Admin changes which types of orders an agent can take.
CREATE OR REPLACE PROCEDURE sp_set_agent_skills(p_agent_id INT, p_skills TEXT[])
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  UPDATE agents SET skills = fn_clean_skills(p_skills) WHERE user_id = p_agent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- Creates the login + agent profile. p_status 'pending' for applications, 'active' when an admin adds the agent.
-- p_skills: the types of work the agent does, e.g. {plumbing} or {electrical,appliance}.
DROP FUNCTION IF EXISTS fn_create_agent(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TEXT, TEXT, TEXT, TEXT, INT);
CREATE OR REPLACE FUNCTION fn_create_agent(
  p_username TEXT, p_password_hash TEXT, p_full_name TEXT, p_phone TEXT, p_email TEXT,
  p_vehicle_type TEXT, p_vehicle_number TEXT, p_aadhaar TEXT, p_pan TEXT, p_dl TEXT, p_locality_id INT,
  p_aadhaar_doc TEXT, p_pan_doc TEXT, p_dl_doc TEXT, p_photo_doc TEXT, p_status TEXT, p_reviewed_by INT,
  p_skills TEXT[] DEFAULT '{delivery}'
) RETURNS agents
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_user_id INT;
  v_phone   TEXT := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_aadhaar TEXT := regexp_replace(coalesce(p_aadhaar, ''), '\s', '', 'g');
  v_pan     TEXT := upper(trim(coalesce(p_pan, '')));
  v_dl      TEXT := upper(regexp_replace(coalesce(p_dl, ''), '[\s-]', '', 'g'));
  v agents;
BEGIN
  IF coalesce(trim(p_full_name), '') = '' THEN
    RAISE EXCEPTION 'Full name is required' USING ERRCODE = '22023';
  END IF;
  IF length(v_phone) = 12 AND v_phone LIKE '91%' THEN v_phone := substr(v_phone, 3); END IF;
  IF v_phone !~ '^[6-9]\d{9}$' THEN
    RAISE EXCEPTION 'Enter a valid 10-digit mobile number' USING ERRCODE = '22023';
  END IF;
  IF p_email IS NOT NULL AND trim(p_email) <> '' AND p_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Enter a valid email address' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'pending' THEN
    IF v_aadhaar !~ '^\d{12}$' THEN
      RAISE EXCEPTION 'Aadhaar number must be 12 digits' USING ERRCODE = '22023';
    END IF;
    IF v_pan !~ '^[A-Z]{5}\d{4}[A-Z]$' THEN
      RAISE EXCEPTION 'PAN must look like ABCDE1234F' USING ERRCODE = '22023';
    END IF;
    IF v_dl !~ '^[A-Z0-9]{8,20}$' THEN
      RAISE EXCEPTION 'Enter a valid driving licence number' USING ERRCODE = '22023';
    END IF;
    IF p_aadhaar_doc IS NULL OR p_pan_doc IS NULL OR p_dl_doc IS NULL THEN
      RAISE EXCEPTION 'Please upload Aadhaar, PAN and driving licence' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_vehicle_type NOT IN ('bike', 'scooter', 'bicycle', 'auto', 'van', 'car') THEN
    RAISE EXCEPTION 'Choose a vehicle type' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM agents a JOIN users u ON u.id = a.user_id
              WHERE u.phone = v_phone AND a.status IN ('pending', 'active', 'suspended')) THEN
    RAISE EXCEPTION 'An agent with this mobile number already exists or is under review' USING ERRCODE = '55000';
  END IF;

  INSERT INTO users (username, password_hash, full_name, phone, email, role)
  VALUES (lower(trim(p_username)), p_password_hash, trim(p_full_name), v_phone, nullif(lower(trim(p_email)), ''), 'agent')
  RETURNING id INTO v_user_id;

  INSERT INTO agents (user_id, status, vehicle_type, vehicle_number, aadhaar_masked, pan_number, dl_number,
                      aadhaar_doc, pan_doc, dl_doc, photo_doc, locality_id, reviewed_by, reviewed_at, skills)
  VALUES (v_user_id, p_status, p_vehicle_type, nullif(upper(trim(p_vehicle_number)), ''),
          CASE WHEN v_aadhaar ~ '^\d{12}$' THEN 'XXXX XXXX ' || right(v_aadhaar, 4) END,
          nullif(v_pan, ''), nullif(v_dl, ''), p_aadhaar_doc, p_pan_doc, p_dl_doc, p_photo_doc, p_locality_id,
          CASE WHEN p_status = 'active' THEN p_reviewed_by END, CASE WHEN p_status = 'active' THEN now() END,
          fn_clean_skills(p_skills))
  RETURNING * INTO v;
  RETURN v;
END $$;

CREATE OR REPLACE PROCEDURE sp_review_agent(p_agent_id INT, p_approve BOOLEAN, p_reason TEXT, p_admin_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT p_approve AND coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Please give a reason for rejecting' USING ERRCODE = '22023';
  END IF;
  UPDATE agents
     SET status = CASE WHEN p_approve THEN 'active' ELSE 'rejected' END,
         rejection_reason = CASE WHEN p_approve THEN NULL ELSE trim(p_reason) END,
         reviewed_by = p_admin_id, reviewed_at = now()
   WHERE user_id = p_agent_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or already reviewed' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- Suspend / re-activate an agent. Suspending takes them offline.
CREATE OR REPLACE PROCEDURE sp_set_agent_status(p_agent_id INT, p_status TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Status must be active or suspended' USING ERRCODE = '22023';
  END IF;
  UPDATE agents SET status = p_status, is_online = CASE WHEN p_status = 'suspended' THEN false ELSE is_online END
   WHERE user_id = p_agent_id AND status IN ('active', 'suspended');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

CREATE OR REPLACE PROCEDURE sp_set_agent_online(p_agent_id INT, p_online BOOLEAN, p_locality_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF p_locality_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM localities WHERE id = p_locality_id) THEN
    RAISE EXCEPTION 'Unknown area' USING ERRCODE = '22023';
  END IF;
  UPDATE agents
     SET is_online = p_online, locality_id = coalesce(p_locality_id, locality_id), last_seen_at = now()
   WHERE user_id = p_agent_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your account is not active' USING ERRCODE = '55000';
  END IF;
END $$;

-- ============ agents: work an order ============

CREATE OR REPLACE FUNCTION fn_agent_active_count(p_agent_id INT) RETURNS INT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  -- event, car and home-visit bookings, and village orders for a later day, don't block taking other work
  SELECT count(*)::int FROM orders WHERE agent_id = p_agent_id AND status IN ('assigned', 'picked_up')
                                     AND event_details IS NULL AND trip_details IS NULL AND visit_details IS NULL
                                     AND (deliver_on IS NULL OR deliver_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date)
$$;

-- Agent picks an open order. Safe when two agents tap "Accept" at the same moment:
-- only the first UPDATE matches (status is still 'placed').
CREATE OR REPLACE FUNCTION fn_agent_accept_order(p_agent_id INT, p_order_id INT) RETURNS orders
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  a agents;
  v orders;
BEGIN
  SELECT * INTO a FROM agents WHERE user_id = p_agent_id;
  IF NOT FOUND OR a.status <> 'active' THEN
    RAISE EXCEPTION 'Your account is not active' USING ERRCODE = '55000';
  END IF;
  IF NOT a.is_online THEN
    RAISE EXCEPTION 'Go online to accept orders' USING ERRCODE = '55000';
  END IF;
  IF (SELECT event_details IS NULL AND trip_details IS NULL AND visit_details IS NULL
             AND (deliver_on IS NULL OR deliver_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date) FROM orders WHERE id = p_order_id)
     AND fn_agent_active_count(p_agent_id) >= fn_setting_num('agent_max_active_orders', 1) THEN
    RAISE EXCEPTION 'Finish your current order before taking a new one' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (SELECT 1 FROM orders WHERE id = p_order_id AND NOT (skill_code = ANY (a.skills))) THEN
    RAISE EXCEPTION 'This order is only for: %',
      (SELECT t.name FROM orders o JOIN service_types t ON t.code = o.skill_code WHERE o.id = p_order_id)
      USING ERRCODE = '55000';
  END IF;
  IF (SELECT franchise_id FROM agents WHERE user_id = p_agent_id) IS DISTINCT FROM (SELECT franchise_id FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'This order is in another city' USING ERRCODE = '55000';
  END IF;
  -- subscription-only services (subscriptions.sql): only subscribed agents
  IF NOT fn_agent_may_take(p_agent_id, p_order_id) THEN
    RAISE EXCEPTION 'This order is for subscribed agents only. See Subscriptions in your profile.' USING ERRCODE = '55000';
  END IF;

  PERFORM set_config('app.event_note', 'Accepted by agent', true);
  UPDATE orders SET agent_id = p_agent_id, status = 'assigned', assigned_at = now()
   WHERE id = p_order_id AND status = 'placed' AND agent_id IS NULL
  RETURNING * INTO v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sorry, this order was just taken by another agent' USING ERRCODE = '55000';
  END IF;
  RETURN v;
END $$;

-- Admin assigns (or re-assigns) an order that hasn't been picked up yet.
CREATE OR REPLACE FUNCTION fn_admin_assign_order(p_order_id INT, p_agent_id INT) RETURNS orders
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v orders;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agents WHERE user_id = p_agent_id AND status = 'active') THEN
    RAISE EXCEPTION 'Choose an active agent' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM orders o JOIN agents a ON a.user_id = p_agent_id
                  WHERE o.id = p_order_id AND o.skill_code = ANY (a.skills)) THEN
    RAISE EXCEPTION 'This agent is not in "%". Add it to their types of work first.',
      (SELECT t.name FROM orders o JOIN service_types t ON t.code = o.skill_code WHERE o.id = p_order_id)
      USING ERRCODE = '22023';
  END IF;
  IF (SELECT franchise_id FROM agents WHERE user_id = p_agent_id) IS DISTINCT FROM (SELECT franchise_id FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'This agent works for another franchise (city). Choose an agent from this order''s franchise.' USING ERRCODE = '22023';
  END IF;
  IF NOT fn_agent_may_take(p_agent_id, p_order_id) THEN
    RAISE EXCEPTION 'This order is for a subscription service and this agent has no active subscription for it. Activate it in Subscriptions first.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.event_note', 'Assigned by admin', true);
  UPDATE orders SET agent_id = p_agent_id, status = 'assigned', assigned_at = now()
   WHERE id = p_order_id AND status IN ('placed', 'assigned')
  RETURNING * INTO v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only orders that are not yet picked up can be assigned' USING ERRCODE = '55000';
  END IF;
  RETURN v;
END $$;

-- Agent can't do an accepted order: it goes back to the open list for other agents.
-- Agent gives an order back before starting it; it returns to other agents. Event and car bookings (events.sql,
-- vehicle.sql) need a reason — the customer sees it, and the booking goes to the next partner.
CREATE OR REPLACE PROCEDURE sp_agent_release_order(p_agent_id INT, p_order_id INT, p_reason TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF coalesce(trim(p_reason), '') = '' AND EXISTS (SELECT 1 FROM orders WHERE id = p_order_id AND (event_details IS NOT NULL OR trip_details IS NOT NULL OR visit_details IS NOT NULL)) THEN
    RAISE EXCEPTION 'Please tell the customer why you are cancelling' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.event_note', 'Released by agent: ' || coalesce(nullif(left(trim(p_reason), 300), ''), 'no reason given'), true);
  UPDATE orders SET agent_id = NULL, status = 'placed', assigned_at = NULL
   WHERE id = p_order_id AND agent_id = p_agent_id AND status = 'assigned';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You can only cancel before starting it' USING ERRCODE = '55000';
  END IF;
END $$;

-- Agent moves the order forward: assigned -> picked_up -> delivered.
-- Delivery needs the customer's 4-digit OTP; it credits the agent's earning and records COD cash.
CREATE OR REPLACE FUNCTION fn_agent_update_order(p_agent_id INT, p_order_id INT, p_status TEXT, p_otp TEXT)
RETURNS orders
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v orders;
  v_pay NUMERIC;
  v_cash NUMERIC;
BEGIN
  SELECT * INTO v FROM orders WHERE id = p_order_id AND agent_id = p_agent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_status = 'picked_up' AND v.status = 'assigned' THEN
    -- Shop bill paid by the customer's UPI: the shop must have confirmed it before the agent leaves.
    -- Items priced by the shop (vegetables, meat…): the bill must be uploaded before leaving the shop.
    IF v.bill_uploaded_at IS NULL AND EXISTS (SELECT 1 FROM order_items WHERE order_id = v.id AND on_bill) THEN
      RAISE EXCEPTION 'These items are priced by the shop: add the shop bill (amount + photo) before pick-up' USING ERRCODE = '55000';
    END IF;
    IF v.bill_payment_mode = 'customer_upi' AND v.payment_confirmed_at IS NULL THEN
      RAISE EXCEPTION 'Wait until the shop confirms the customer''s UPI payment, then tap "Shop received payment"' USING ERRCODE = '55000';
    END IF;
    UPDATE orders SET status = 'picked_up', picked_up_at = now() WHERE id = v.id RETURNING * INTO v;

  ELSIF p_status = 'delivered' AND v.status = 'picked_up' THEN
    -- The customer's OTP is only checked when the admin turned on "Ask customer OTP on delivery".
    IF fn_setting_num('require_delivery_otp', 0) = 1 AND coalesce(trim(p_otp), '') <> v.delivery_otp THEN
      RAISE EXCEPTION 'Wrong OTP. Ask the customer for the 4-digit code shown in their app.' USING ERRCODE = '22023';
    END IF;
    -- The delivery charge must be confirmed first: received on the company UPI, or paid in cash.
    IF v.delivery_fee > 0 AND v.fee_paid_at IS NULL THEN
      RAISE EXCEPTION 'First confirm the delivery charge of ₹%: tap "Received on company UPI" or "Paid in cash"', trim_scale(v.delivery_fee) USING ERRCODE = '55000';
    END IF;
    -- No per-order pay from us for: event, car and home-visit bookings and other "price on discussion" bookings
    -- (plumber, electrician… — the independent partner is paid by the customer directly), and orders of our own
    -- staff (water cans: they are company employees).
    v_pay := CASE WHEN v.event_details IS NULL AND v.trip_details IS NULL AND v.visit_details IS NULL
                   AND NOT (v.kind = 'service' AND coalesce(v.total, 0) = 0) AND v.skill_code IS DISTINCT FROM 'our_service_employees'
                  THEN fn_setting_num('agent_pay_per_order', 25) ELSE 0 END;
    UPDATE orders SET status = 'delivered', delivered_at = now(), agent_earning = v_pay WHERE id = v.id RETURNING * INTO v;
    IF v_pay > 0 THEN
      INSERT INTO agent_wallet (agent_id, type, amount, order_id, note)
      VALUES (p_agent_id, 'earning', v_pay, v.id, 'Delivery #' || v.id);
    END IF;
    -- Cash the agent collects at the door = total, minus the shop bill if the customer already paid the shop by UPI,
    -- minus the delivery charge if it was paid to the company UPI.
    v_cash := v.total - CASE WHEN v.bill_payment_mode = 'customer_upi' AND v.payment_confirmed_at IS NOT NULL
                             THEN coalesce(v.bill_amount, 0) ELSE 0 END
                      - CASE WHEN v.fee_payment_mode = 'company_upi' THEN v.delivery_fee ELSE 0 END;
    IF v.payment_method = 'cod' AND v_cash > 0 THEN
      INSERT INTO agent_wallet (agent_id, type, amount, order_id, note)
      VALUES (p_agent_id, 'cod_collected', v_cash, v.id, 'Cash collected for #' || v.id);
    END IF;

  ELSE
    RAISE EXCEPTION 'Can''t change this order from % to %', v.status, p_status USING ERRCODE = '55000';
  END IF;
  RETURN v;
END $$;

-- ============ wallet ============

-- Admin wallet actions: pay the agent, give a bonus, or receive COD cash from them.
CREATE OR REPLACE PROCEDURE sp_wallet_entry(p_agent_id INT, p_type TEXT, p_amount NUMERIC, p_note TEXT, p_admin_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  s JSONB;
BEGIN
  IF p_type NOT IN ('payout', 'bonus', 'cod_deposited') THEN
    RAISE EXCEPTION 'Unknown wallet action' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount above ₹0' USING ERRCODE = '22023';
  END IF;
  s := fn_agent_stats(p_agent_id);
  IF p_type = 'payout' AND p_amount > (s->>'wallet_balance')::numeric THEN
    RAISE EXCEPTION 'Payout is more than the wallet balance (₹%)', s->>'wallet_balance' USING ERRCODE = '22023';
  END IF;
  IF p_type = 'cod_deposited' AND p_amount > (s->>'cash_in_hand')::numeric THEN
    RAISE EXCEPTION 'Agent is only holding ₹% in cash', s->>'cash_in_hand' USING ERRCODE = '22023';
  END IF;
  INSERT INTO agent_wallet (agent_id, type, amount, note, created_by)
  VALUES (p_agent_id, p_type, round(p_amount, 2), nullif(trim(p_note), ''), p_admin_id);
END $$;

-- ============ reports ============

-- Midnight today in India, whatever time zone the database server runs in (the cloud server is on UTC): every
-- "today" number starts here, so an order at 1 AM counts for today, not yesterday.
CREATE OR REPLACE FUNCTION fn_ist_today() RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
$$;

CREATE OR REPLACE FUNCTION fn_agent_stats(p_agent_id INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  WITH w AS (
    SELECT
      coalesce(sum(amount) FILTER (WHERE type IN ('earning', 'bonus')), 0)
        - coalesce(sum(amount) FILTER (WHERE type = 'payout'), 0) AS balance,
      coalesce(sum(amount) FILTER (WHERE type = 'cod_collected'), 0)
        - coalesce(sum(amount) FILTER (WHERE type = 'cod_deposited'), 0) AS cash,
      coalesce(sum(amount) FILTER (WHERE type IN ('earning', 'bonus')), 0) AS lifetime,
      coalesce(sum(amount) FILTER (WHERE type IN ('earning', 'bonus') AND created_at >= fn_ist_today()), 0) AS today_earn,
      coalesce(sum(amount) FILTER (WHERE type = 'payout'), 0) AS paid_out
    FROM agent_wallet WHERE agent_id = p_agent_id
  ), o AS (
    SELECT
      count(*) FILTER (WHERE status = 'delivered') AS total_deliveries,
      count(*) FILTER (WHERE status = 'delivered' AND delivered_at >= fn_ist_today()) AS today_deliveries,
      count(*) FILTER (WHERE status IN ('assigned', 'picked_up')) AS active_orders,
      round(avg(extract(epoch FROM delivered_at - assigned_at) / 60) FILTER (WHERE status = 'delivered')) AS avg_minutes
    FROM orders WHERE agent_id = p_agent_id
  )
  SELECT jsonb_build_object(
    'wallet_balance', w.balance, 'cash_in_hand', w.cash, 'lifetime_earnings', w.lifetime,
    'today_earnings', w.today_earn, 'paid_out', w.paid_out,
    'total_deliveries', o.total_deliveries, 'today_deliveries', o.today_deliveries,
    'active_orders', o.active_orders, 'avg_delivery_minutes', o.avg_minutes,
    'last7', (
      SELECT jsonb_agg(jsonb_build_object('day', d::date, 'deliveries', coalesce(x.n, 0), 'earnings', coalesce(x.e, 0)) ORDER BY d)
        FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - 6, (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') d
        LEFT JOIN (
          SELECT (delivered_at AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*) AS n, sum(agent_earning) AS e
            FROM orders WHERE agent_id = p_agent_id AND status = 'delivered'
           GROUP BY 1
        ) x ON x.day = d::date
    )
  )
  FROM w, o
$$;

-- Agents with their live state: free (online, no active order), busy, offline, pending, rejected, suspended.
DROP VIEW IF EXISTS v_agents;  -- recreated so new agents columns are picked up
CREATE VIEW v_agents AS
SELECT a.*, u.username, u.full_name, u.phone, u.email, u.created_at AS joined_at,
       l.name AS locality_name, l.lat, l.lng,
       coalesce(act.n, 0) AS active_orders,
       coalesce(tod.n, 0) AS today_deliveries,
       CASE
         WHEN a.status <> 'active' THEN a.status
         WHEN NOT a.is_online THEN 'offline'
         WHEN coalesce(act.n, 0) > 0 THEN 'busy'
         ELSE 'free'
       END AS state
  FROM agents a
  JOIN users u ON u.id = a.user_id
  LEFT JOIN localities l ON l.id = a.locality_id
  LEFT JOIN LATERAL (SELECT count(*) AS n FROM orders o WHERE o.agent_id = a.user_id AND o.status IN ('assigned', 'picked_up')) act ON true
  LEFT JOIN LATERAL (SELECT count(*) AS n FROM orders o WHERE o.agent_id = a.user_id AND o.status = 'delivered'
                       AND o.delivered_at >= fn_ist_today()) tod ON true;

DROP FUNCTION IF EXISTS fn_order_stats();
CREATE OR REPLACE FUNCTION fn_order_stats(p_franchise INT DEFAULT NULL) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT jsonb_build_object(
    'today_orders',     (SELECT count(*) FROM orders WHERE (p_franchise IS NULL OR franchise_id = p_franchise) AND created_at >= fn_ist_today()),
    'waiting',          (SELECT count(*) FROM orders WHERE (p_franchise IS NULL OR franchise_id = p_franchise) AND status = 'placed'),
    'in_progress',      (SELECT count(*) FROM orders WHERE (p_franchise IS NULL OR franchise_id = p_franchise) AND status IN ('assigned', 'picked_up')),
    'delivered_today',  (SELECT count(*) FROM orders WHERE (p_franchise IS NULL OR franchise_id = p_franchise) AND status = 'delivered' AND delivered_at >= fn_ist_today()),
    'cancelled_today',  (SELECT count(*) FROM orders WHERE (p_franchise IS NULL OR franchise_id = p_franchise) AND status = 'cancelled' AND cancelled_at >= fn_ist_today()),
    'revenue_today',    (SELECT coalesce(sum(total), 0) FROM orders WHERE (p_franchise IS NULL OR franchise_id = p_franchise) AND status = 'delivered' AND delivered_at >= fn_ist_today()),
    'agents_free',      (SELECT count(*) FROM v_agents WHERE (p_franchise IS NULL OR franchise_id = p_franchise) AND state = 'free'),
    'agents_busy',      (SELECT count(*) FROM v_agents WHERE (p_franchise IS NULL OR franchise_id = p_franchise) AND state = 'busy'),
    'agents_offline',   (SELECT count(*) FROM v_agents WHERE (p_franchise IS NULL OR franchise_id = p_franchise) AND state = 'offline'),
    'pending_applications', (SELECT count(*) FROM agents WHERE (p_franchise IS NULL OR franchise_id = p_franchise) AND status = 'pending'),
    'waiting_no_agent', (SELECT count(*) FROM orders o WHERE o.status = 'placed' AND (p_franchise IS NULL OR o.franchise_id = p_franchise)
                           AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.status = 'active' AND o.skill_code = ANY (a.skills) AND a.franchise_id IS NOT DISTINCT FROM o.franchise_id)),
    'cash_with_agents', (SELECT coalesce(sum(CASE WHEN type = 'cod_collected' THEN amount ELSE -amount END), 0)
                           FROM agent_wallet WHERE type IN ('cod_collected', 'cod_deposited')
                            AND (p_franchise IS NULL OR agent_id IN (SELECT user_id FROM agents WHERE franchise_id = p_franchise)))
  )
$$;

-- ============ service types ============

-- Creates or updates a service type. The code is made from the name for new types and never changes.
CREATE OR REPLACE FUNCTION fn_save_service_type(p_code TEXT, p_name TEXT, p_agent_title TEXT, p_icon TEXT, p_is_active BOOLEAN)
RETURNS service_types
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v service_types;
  v_code TEXT := trim(both '_' from lower(regexp_replace(trim(coalesce(nullif(p_code, ''), p_name, '')), '[^a-zA-Z0-9]+', '_', 'g')));
BEGIN
  IF coalesce(trim(p_name), '') = '' OR coalesce(trim(p_agent_title), '') = '' THEN
    RAISE EXCEPTION 'Name and agent title are required' USING ERRCODE = '22023';
  END IF;
  IF v_code = '' THEN
    RAISE EXCEPTION 'Enter a name' USING ERRCODE = '22023';
  END IF;
  INSERT INTO service_types (code, name, agent_title, icon, is_active, sort_order)
  VALUES (v_code, trim(p_name), trim(p_agent_title), nullif(trim(p_icon), ''), coalesce(p_is_active, true),
          (SELECT coalesce(max(sort_order) + 1, 0) FROM service_types))
  ON CONFLICT (code) DO UPDATE
     SET name = EXCLUDED.name, agent_title = EXCLUDED.agent_title, icon = EXCLUDED.icon, is_active = EXCLUDED.is_active
  RETURNING * INTO v;
  RETURN v;
END $$;

-- Coverage per type: services using it, agents who can do it (and free now), orders waiting for it.
DROP FUNCTION IF EXISTS fn_service_type_overview();
CREATE OR REPLACE FUNCTION fn_service_type_overview(p_franchise INT DEFAULT NULL) RETURNS TABLE (
  code TEXT, name TEXT, agent_title TEXT, icon TEXT, is_active BOOLEAN,
  services INT, agents INT, agents_free INT, orders_waiting INT
)
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT t.code::text, t.name::text, t.agent_title::text, t.icon::text, t.is_active,
         (SELECT count(*) FROM services s WHERE s.skill_code = t.code)::int,
         (SELECT count(*) FROM v_agents v WHERE (p_franchise IS NULL OR v.franchise_id = p_franchise) AND v.status = 'active' AND t.code = ANY (v.skills))::int,
         (SELECT count(*) FROM v_agents v WHERE (p_franchise IS NULL OR v.franchise_id = p_franchise) AND v.state = 'free' AND t.code = ANY (v.skills))::int,
         (SELECT count(*) FROM orders o WHERE (p_franchise IS NULL OR o.franchise_id = p_franchise) AND o.status = 'placed' AND o.skill_code = t.code)::int
    FROM service_types t
   ORDER BY t.sort_order, t.name
$$;

-- Quick change of which type of agent does a service (from the admin services table).
CREATE OR REPLACE PROCEDURE sp_set_service_skill(p_service_id INT, p_skill_code TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM service_types WHERE code = p_skill_code) THEN
    RAISE EXCEPTION 'Unknown type of work' USING ERRCODE = '22023';
  END IF;
  -- A switched-off type has no agents taking orders: the service's orders would wait forever.
  IF NOT EXISTS (SELECT 1 FROM service_types WHERE code = p_skill_code AND is_active) THEN
    RAISE EXCEPTION 'That type of work is switched off. Choose an active type.' USING ERRCODE = '22023';
  END IF;
  UPDATE services SET skill_code = p_skill_code WHERE id = p_service_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- ============ live GPS ============

-- Agent app reports its position. Ignored if it arrives less than 5 s after the previous one.
-- While the agent has an active order the point is also kept in the trail for that order.
-- Returns true when the point was stored.
CREATE OR REPLACE FUNCTION fn_agent_location(p_agent_id INT, p_lat NUMERIC, p_lng NUMERIC, p_accuracy INT)
RETURNS BOOLEAN
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  a agents;
  v_order INT;
BEGIN
  -- India bounding box: rejects nonsense and 0,0 from broken devices.
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 6 AND 37.5 OR p_lng NOT BETWEEN 68 AND 97.5 THEN
    RAISE EXCEPTION 'Location looks invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM agents WHERE user_id = p_agent_id;
  IF NOT FOUND OR a.status <> 'active' THEN
    RAISE EXCEPTION 'Your agent account is not active' USING ERRCODE = '55000';
  END IF;
  IF a.last_location_at > now() - interval '5 seconds' THEN
    RETURN false;
  END IF;

  UPDATE agents
     SET last_lat = round(p_lat, 6), last_lng = round(p_lng, 6), last_accuracy_m = p_accuracy,
         last_location_at = now(), last_seen_at = now()
   WHERE user_id = p_agent_id;

  SELECT id INTO v_order FROM orders
   WHERE agent_id = p_agent_id AND status IN ('assigned', 'picked_up')
   ORDER BY assigned_at DESC LIMIT 1;
  INSERT INTO agent_location_trail (agent_id, order_id, lat, lng, accuracy_m)
  VALUES (p_agent_id, v_order, round(p_lat, 6), round(p_lng, 6), p_accuracy);

  -- Keep the trail small: 3 days of history.
  IF random() < 0.01 THEN
    DELETE FROM agent_location_trail WHERE recorded_at < now() - interval '3 days';
  END IF;
  RETURN true;
END $$;

-- Rough arrival time in minutes: straight-line distance at ~18 km/h city speed, plus 2 minutes to park and reach the door.
CREATE OR REPLACE FUNCTION fn_eta_minutes(p_km NUMERIC) RETURNS INT
LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $$
  SELECT CASE WHEN p_km IS NULL THEN NULL ELSE ceil(p_km / 18 * 60 * 1.3)::int + 2 END
$$;
