-- 🍱 Home Food & Cooks (2026-10-25)
--  👩‍🍳 Book a Cook: a cook at home by the hour — Today / Tomorrow, a start time, 1 to 8 hours in half-hour steps.
--     Fixed price: ₹79 an hour, ₹40 an extra half hour (settings cook_rate_hour / cook_rate_half_hour). Only
--     `book_cook` partners get these bookings; the customer pays the cook in cash after the work.
--  🍱 Tomorrow's Meal: every day the franchise admin uploads tomorrow's menu — a photo of the menu card and the
--     curries / charus of the day (a fixed menu, like a hotel — customers don't choose). Customers pre-order Lunch or Dinner: Veg or
--     Chicken / Mutton / Fish; cash on delivery. Orders close at 9 PM (setting meal_cutoff_hour); later orders are for
--     the day after. Only `tomorrow_meals` partners get them. The admin page counts what the kitchen must cook.
--  🥨 Snacks for tomorrow (same service, products home-food-snack-*): chegodilu, murukulu, appalu… by the pack, delivered
--     11 AM – 8 PM; a separate order from lunch / dinner. Their price is the product price (HQ: Master products).
-- 💰 Prices are per city and HQ sets them (home_food_prices); a city without its own price uses the default (the plate's
--    product price, the cook rate settings). A franchise asks HQ for a change in Requests to HQ ('price').
-- Re-runnable.

INSERT INTO service_types (code, name, agent_title, icon, sort_order) VALUES
  ('book_cook', 'Home cooks', 'Cook', '👩‍🍳', 70),
  ('tomorrow_meals', 'Tomorrow''s meals', 'Meal delivery partner', '🍱', 71)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cook_details JSONB;

-- ---------- 💰 prices per city (HQ) ----------
-- items: veg / chicken / mutton / fish (a plate, lunch or dinner) · cook_hour / cook_half (Book Your Cook)
CREATE TABLE IF NOT EXISTS home_food_prices (
  franchise_id INT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  item         VARCHAR(10) NOT NULL CHECK (item IN ('veg', 'chicken', 'mutton', 'fish', 'cook_hour', 'cook_half')),
  price        NUMERIC(8,2) NOT NULL CHECK (price >= 0),
  updated_by   INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (franchise_id, item)
);
-- The item of a meal product: home-food-meal-chicken-lunch → chicken
CREATE OR REPLACE FUNCTION fn_meal_item(p_slug TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT substring(p_slug FROM '^home-food-meal-([a-z]+)-') $$;
-- The default price of an item (no city price): the plate's product price, the cook rate settings.
CREATE OR REPLACE FUNCTION fn_home_food_default(p_item TEXT) RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT CASE p_item
           WHEN 'cook_hour' THEN fn_setting_num('cook_rate_hour', 79)
           WHEN 'cook_half' THEN fn_setting_num('cook_rate_half_hour', 40)
           ELSE (SELECT price FROM products WHERE slug = 'home-food-meal-' || p_item || '-lunch') END
$$;
-- The price in a city (NULL city = the default).
CREATE OR REPLACE FUNCTION fn_home_food_price(p_franchise INT, p_item TEXT) RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce((SELECT price FROM home_food_prices WHERE franchise_id = p_franchise AND item = p_item), fn_home_food_default(p_item))
$$;
-- HQ's price list: every active city × every item — the price, the default, and whether the city has its own.
CREATE OR REPLACE FUNCTION fn_home_food_prices() RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('franchise_id', f.id, 'city', f.city, 'prices',
           (SELECT jsonb_object_agg(i.item, jsonb_build_object('price', fn_home_food_price(f.id, i.item), 'default', fn_home_food_default(i.item),
                                     'own', EXISTS (SELECT 1 FROM home_food_prices x WHERE x.franchise_id = f.id AND x.item = i.item)))
              FROM unnest(ARRAY['veg', 'chicken', 'mutton', 'fish', 'cook_hour', 'cook_half']) AS i(item))) ORDER BY f.city), '[]'::jsonb)
    FROM franchises f WHERE f.status = 'active'
$$;
-- HQ sets a city's price (NULL price = back to the default).
CREATE OR REPLACE PROCEDURE sp_set_home_food_price(p_franchise INT, p_item TEXT, p_price NUMERIC, p_by INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF p_item NOT IN ('veg', 'chicken', 'mutton', 'fish', 'cook_hour', 'cook_half') THEN
    RAISE EXCEPTION 'Unknown price' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM franchises WHERE id = p_franchise) THEN
    RAISE EXCEPTION 'Franchise not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_price IS NULL THEN
    DELETE FROM home_food_prices WHERE franchise_id = p_franchise AND item = p_item;
  ELSIF p_price < 0 OR p_price > 5000 THEN
    RAISE EXCEPTION 'Enter a price from ₹0 to ₹5000' USING ERRCODE = '22023';
  ELSE
    INSERT INTO home_food_prices (franchise_id, item, price, updated_by) VALUES (p_franchise, p_item, round(p_price, 2), p_by)
    ON CONFLICT (franchise_id, item) DO UPDATE SET price = EXCLUDED.price, updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;
END $$;
-- A franchise asks HQ for a different price in its city (Requests to HQ). name = the item, unit = the price asked.
CREATE OR REPLACE FUNCTION fn_request_price(p_franchise INT, p_by INT, p_item TEXT, p_price NUMERIC, p_note TEXT) RETURNS catalog_requests
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v catalog_requests;
BEGIN
  IF p_item NOT IN ('veg', 'chicken', 'mutton', 'fish', 'cook_hour', 'cook_half') THEN
    RAISE EXCEPTION 'Choose which price' USING ERRCODE = '22023';
  END IF;
  IF p_price IS NULL OR p_price <= 0 OR p_price > 5000 THEN
    RAISE EXCEPTION 'Enter the price you want (₹1 to ₹5000)' USING ERRCODE = '22023';
  END IF;
  INSERT INTO catalog_requests (franchise_id, kind, name, unit, details, requested_by)
  VALUES (p_franchise, 'price', p_item, round(p_price, 2)::text, nullif(left(trim(coalesce(p_note, '')), 500), ''), p_by)
  RETURNING * INTO v;
  RETURN v;
END $$;
-- HQ approves it (fn_approve_request, geo.sql): the asked price becomes the city's price.
CREATE OR REPLACE FUNCTION fn_approve_price_request(r catalog_requests) RETURNS VOID
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  CALL sp_set_home_food_price(r.franchise_id, r.name, r.unit::numeric, NULL);
END $$;

-- ---------- 👩‍🍳 Book a Cook ----------
DROP FUNCTION IF EXISTS fn_cook_price(NUMERIC);
DROP FUNCTION IF EXISTS fn_check_cook(JSONB);
-- Price in a city for a number of hours (1, 1.5, 2 … 8): whole hours × the hourly rate + the half-hour rate for a half.
CREATE OR REPLACE FUNCTION fn_cook_price(p_hours NUMERIC, p_franchise INT DEFAULT NULL) RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT floor(p_hours) * fn_home_food_price(p_franchise, 'cook_hour')
       + CASE WHEN p_hours - floor(p_hours) >= 0.5 THEN fn_home_food_price(p_franchise, 'cook_half') ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION fn_is_cook_service(p_service_id INT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce((SELECT skill_code = 'book_cook' FROM services WHERE id = p_service_id), false)
$$;

-- The cook booking form: { day: 'today'|'tomorrow', start: 'HH:MI' (06:00–20:30, half hours), hours: 1–8 in halves,
-- woman: true/false } for the delivery area p_locality (its city's rates). Today: the start at least an hour from now.
-- The cook leaves by 10 PM.
CREATE OR REPLACE FUNCTION fn_check_cook(p JSONB, p_locality INT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  v_now   TIMESTAMP := now() AT TIME ZONE 'Asia/Kolkata';
  v_date  DATE;
  v_start TIME;
  v_hours NUMERIC;
  v_woman BOOLEAN := coalesce((p->>'woman')::boolean, false);
  v_amt   NUMERIC;
BEGIN
  IF p IS NULL OR coalesce(p->>'day', '') NOT IN ('today', 'tomorrow') THEN
    RAISE EXCEPTION 'Choose the day: today or tomorrow' USING ERRCODE = '22023';
  END IF;
  v_date := v_now::date + CASE WHEN p->>'day' = 'tomorrow' THEN 1 ELSE 0 END;
  IF coalesce(p->>'start', '') !~ '^([01]\d|2[0-3]):(00|30)$' THEN
    RAISE EXCEPTION 'Choose the time the cook should come' USING ERRCODE = '22023';
  END IF;
  v_start := (p->>'start')::time;
  IF v_start < '06:00' OR v_start > '20:30' THEN
    RAISE EXCEPTION 'Cooks come between 6 AM and 8:30 PM' USING ERRCODE = '22023';
  END IF;
  IF v_date = v_now::date AND v_date + v_start < v_now + interval '1 hour' THEN
    RAISE EXCEPTION 'For today, choose a time at least an hour from now' USING ERRCODE = '22023';
  END IF;
  v_hours := CASE WHEN (p->>'hours') ~ '^\d(\.[05]0?)?$' THEN (p->>'hours')::numeric END;
  IF v_hours IS NULL OR v_hours < 1 OR v_hours > 8 OR v_hours * 2 <> floor(v_hours * 2) THEN
    RAISE EXCEPTION 'Choose how many hours: 1 to 8 (half hours too)' USING ERRCODE = '22023';
  END IF;
  IF v_start + make_interval(mins => (v_hours * 60)::int) > '22:00'::time OR v_start + make_interval(mins => (v_hours * 60)::int) < v_start THEN
    RAISE EXCEPTION 'The cook finishes by 10 PM — choose an earlier time or fewer hours' USING ERRCODE = '22023';
  END IF;
  v_amt := fn_cook_price(v_hours, (SELECT franchise_id FROM localities WHERE id = p_locality));
  RETURN jsonb_build_object('day', p->>'day', 'date', v_date, 'start', to_char(v_start, 'HH24:MI'), 'hours', v_hours,
    'woman', v_woman, 'amount', v_amt,
    'label', to_char(v_date, 'Dy FMDD Mon') || ', ' || ltrim(to_char(v_start, 'HH12:MI AM'), '0') || ' · '
             || CASE WHEN v_hours = 1 THEN '1 hour' ELSE rtrim(rtrim(v_hours::text, '0'), '.') || ' hours' END
             || CASE WHEN v_woman THEN ' · woman cook' ELSE '' END);
END $$;

-- ---------- 🍱 Tomorrow's Meal ----------
-- The day's menu: what customers choose from (curries, charus) for lunch / dinner, per city.
CREATE TABLE IF NOT EXISTS meal_menu (
  id           SERIAL PRIMARY KEY,
  franchise_id INT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  menu_date    DATE NOT NULL,
  meal         VARCHAR(6)  NOT NULL CHECK (meal IN ('lunch', 'dinner')),
  kind         VARCHAR(6)  NOT NULL CHECK (kind IN ('curry', 'charu')),
  name         VARCHAR(60) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (franchise_id, menu_date, meal, kind, name)
);
-- The photo of the day's menu card (with prices) customers see on top.
CREATE TABLE IF NOT EXISTS meal_menu_photo (
  franchise_id INT NOT NULL REFERENCES franchises(id) ON DELETE CASCADE,
  menu_date    DATE NOT NULL,
  image_url    TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (franchise_id, menu_date)
);

-- The day meals ordered now are delivered: tomorrow, or the day after once tomorrow's orders have closed (9 PM).
CREATE OR REPLACE FUNCTION fn_meal_date() RETURNS DATE
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date
         + CASE WHEN extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata') >= fn_setting_num('meal_cutoff_hour', 21) THEN 2 ELSE 1 END
$$;

-- Lunch, dinner or snacks of a product of the Tomorrow's Meal service (plates end in -lunch / -dinner; snacks are
-- home-food-snack-…).
CREATE OR REPLACE FUNCTION fn_meal_of(p_slug TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_slug LIKE 'home-food-snack-%' THEN 'snacks'
              WHEN p_slug LIKE '%-lunch' THEN 'lunch' WHEN p_slug LIKE '%-dinner' THEN 'dinner' END
$$;

-- The delivery slot of a meal order, e.g. "Mon 27 Oct, Lunch 12:30 – 3:00 PM".
CREATE OR REPLACE FUNCTION fn_meal_slot(p_meal TEXT, p_date DATE) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT to_char(p_date, 'Dy FMDD Mon') || ', '
         || CASE p_meal WHEN 'lunch' THEN 'Lunch 12:30 – 3:00 PM' WHEN 'snacks' THEN 'Snacks 11:00 AM – 8:00 PM' ELSE 'Dinner 7:30 – 10:00 PM' END
$$;

-- For the products in a cart: are they meals, all of one meal, and the slot / day they are delivered.
-- { meals: n, others: n, meal: 'lunch'|'dinner'|'snacks'|null, mixed: bool, date, slot }
CREATE OR REPLACE FUNCTION fn_meal_cart(p_products INT[]) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  WITH x AS (
    SELECT p.id, fn_meal_of(p.slug) AS meal, s.skill_code = 'tomorrow_meals' AS is_meal
      FROM products p JOIN services s ON s.id = p.service_id WHERE p.id = ANY (p_products)
  ), m AS (SELECT count(*) FILTER (WHERE is_meal) AS meals, count(*) FILTER (WHERE NOT is_meal) AS others,
                  count(DISTINCT meal) FILTER (WHERE is_meal) AS kinds, min(meal) FILTER (WHERE is_meal) AS meal FROM x)
  SELECT jsonb_build_object('meals', m.meals, 'others', m.others, 'meal', m.meal, 'mixed', m.kinds > 1,
                            'date', fn_meal_date(), 'slot', CASE WHEN m.meal IS NOT NULL THEN fn_meal_slot(m.meal, fn_meal_date()) END)
    FROM m
$$;

-- What customers see: the delivery day, the menu photo, the choices for lunch and dinner, and the meal products
-- (Veg / Chicken / Mutton / Fish × lunch / dinner with their prices).
CREATE OR REPLACE FUNCTION fn_meal_menu(p_franchise INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  WITH d AS (SELECT fn_meal_date() AS dt)
  SELECT jsonb_build_object(
    'date', d.dt, 'day_label', to_char(d.dt, 'Dy FMDD Mon'),
    'is_tomorrow', d.dt = (now() AT TIME ZONE 'Asia/Kolkata')::date + 1,
    'cutoff_hour', fn_setting_num('meal_cutoff_hour', 21),
    'photo', (SELECT image_url FROM meal_menu_photo WHERE franchise_id = p_franchise AND menu_date = d.dt),
    'lunch', jsonb_build_object(
      'curries', coalesce((SELECT jsonb_agg(name ORDER BY id) FROM meal_menu WHERE franchise_id = p_franchise AND menu_date = d.dt AND meal = 'lunch' AND kind = 'curry'), '[]'::jsonb),
      'charus', coalesce((SELECT jsonb_agg(name ORDER BY id) FROM meal_menu WHERE franchise_id = p_franchise AND menu_date = d.dt AND meal = 'lunch' AND kind = 'charu'), '[]'::jsonb),
      'slot', fn_meal_slot('lunch', d.dt)),
    'dinner', jsonb_build_object(
      'curries', coalesce((SELECT jsonb_agg(name ORDER BY id) FROM meal_menu WHERE franchise_id = p_franchise AND menu_date = d.dt AND meal = 'dinner' AND kind = 'curry'), '[]'::jsonb),
      'charus', coalesce((SELECT jsonb_agg(name ORDER BY id) FROM meal_menu WHERE franchise_id = p_franchise AND menu_date = d.dt AND meal = 'dinner' AND kind = 'charu'), '[]'::jsonb),
      'slot', fn_meal_slot('dinner', d.dt)),
    'snacks', jsonb_build_object('slot', fn_meal_slot('snacks', d.dt)),
    'products', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name, 'unit', p.unit,
                                  'price', CASE WHEN fn_meal_item(p.slug) IS NULL THEN p.price ELSE fn_home_food_price(p_franchise, fn_meal_item(p.slug)) END,
                                  'description', p.description, 'icon', p.icon, 'image_url', p.image_url, 'meal', fn_meal_of(p.slug),
                                  'service_id', s.id, 'service_name', s.name) ORDER BY p.sort_order)
                            FROM products p JOIN services s ON s.id = p.service_id
                           WHERE s.skill_code = 'tomorrow_meals' AND s.is_active AND p.is_active AND fn_product_in_stock(p_franchise, p.id)
                             AND (p_franchise IS NULL OR fn_product_visible(p_franchise, p.id))), '[]'::jsonb))
  FROM d
$$;

-- For the kitchen / admin: a day's orders — how many plates / packs of each, per meal (lunch, dinner, snacks).
CREATE OR REPLACE FUNCTION fn_meal_kitchen(p_franchise INT, p_date DATE) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  WITH it AS (
    SELECT fn_meal_of(p.slug) AS meal, p.name, i.qty
      FROM orders o JOIN order_items i ON i.order_id = o.id JOIN products p ON p.id = i.product_id
      JOIN services s ON s.id = p.service_id AND s.skill_code = 'tomorrow_meals'
     WHERE o.deliver_on = p_date AND o.status <> 'cancelled' AND (p_franchise IS NULL OR o.franchise_id = p_franchise)
  )
  SELECT jsonb_build_object(
    'orders', (SELECT count(DISTINCT o.id) FROM orders o JOIN order_items i ON i.order_id = o.id JOIN products p ON p.id = i.product_id
                 JOIN services s ON s.id = p.service_id AND s.skill_code = 'tomorrow_meals'
                WHERE o.deliver_on = p_date AND o.status <> 'cancelled' AND (p_franchise IS NULL OR o.franchise_id = p_franchise)),
    'plates', coalesce((SELECT jsonb_agg(jsonb_build_object('meal', meal, 'name', name, 'plates', plates) ORDER BY meal DESC, name)
                          FROM (SELECT meal, name, sum(qty) AS plates FROM it GROUP BY 1, 2) z), '[]'::jsonb))
$$;

-- The time slot also holds a cook booking's label ("Mon 27 Oct, 12:30 PM · 1.5 hours · woman cook").
DO $$ BEGIN
  IF (SELECT character_maximum_length FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'slot') < 80 THEN
    ALTER TABLE orders ALTER COLUMN slot TYPE VARCHAR(80);
  END IF;
END $$;

-- 👩‍🍳 After a cook booking is placed (fn_place_order): its price for the hours booked (fn_check_cook worked it out),
-- the hours on the order line, the total and the day. The customer pays the cook this amount in cash after the work.
CREATE OR REPLACE PROCEDURE sp_cook_booking(p_order_id INT, p_cook JSONB)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_amt   NUMERIC := (p_cook->>'amount')::numeric;
  v_hours NUMERIC := (p_cook->>'hours')::numeric;
BEGIN
  UPDATE order_items SET qty = 1, price = v_amt, line_total = v_amt,
         unit = rtrim(rtrim(v_hours::text, '0'), '.') || CASE WHEN v_hours = 1 THEN ' hour' ELSE ' hours' END
   WHERE order_id = p_order_id;
  UPDATE orders SET cook_details = p_cook, subtotal = v_amt, total = v_amt + delivery_fee, deliver_on = (p_cook->>'date')::date
   WHERE id = p_order_id;
END $$;

-- 🍱 The meal rules for a cart before it is placed (p_items as the app sends them): only meals, all lunch or all
-- dinner, and every veg plate carries the customer's choice ("Aloo Fry, Dal + Tomato Charu"). NULL = not a meal order;
-- otherwise { meal, date, slot } — the slot the order gets.
CREATE OR REPLACE FUNCTION fn_check_meal_cart(p_items JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE
  v_ids INT[] := ARRAY(SELECT (x->>'product_id')::int FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x WHERE x->>'product_id' ~ '^\d{1,9}$');
  v     JSONB := fn_meal_cart(v_ids);
BEGIN
  IF coalesce((v->>'meals')::int, 0) = 0 THEN RETURN NULL; END IF;
  IF (v->>'others')::int > 0 OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x->>'product_id' IS NULL) THEN
    RAISE EXCEPTION 'Tomorrow''s meals are a separate order — please order the other items separately' USING ERRCODE = '22023';
  END IF;
  IF (v->>'mixed')::boolean THEN
    RAISE EXCEPTION 'Please order lunch, dinner and snacks as separate orders' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('meal', v->>'meal', 'date', v->>'date', 'slot', v->>'slot');
END $$;

-- 🍱 After a meal order is placed: each plate at its city's price (snacks keep their product price), the totals, the day.
CREATE OR REPLACE PROCEDURE sp_meal_order(p_order_id INT, p_date DATE)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_city INT := (SELECT l.franchise_id FROM orders o JOIN localities l ON l.id = o.locality_id WHERE o.id = p_order_id);
BEGIN
  UPDATE order_items i SET price = fn_home_food_price(v_city, fn_meal_item(p.slug)),
                           line_total = round(fn_home_food_price(v_city, fn_meal_item(p.slug)) * i.qty, 2)
    FROM products p WHERE p.id = i.product_id AND i.order_id = p_order_id AND fn_meal_item(p.slug) IS NOT NULL;
  UPDATE orders o SET subtotal = s.total, total = s.total + o.delivery_fee, deliver_on = p_date
    FROM (SELECT coalesce(sum(line_total), 0) AS total FROM order_items WHERE order_id = p_order_id) s
   WHERE o.id = p_order_id;
END $$;
