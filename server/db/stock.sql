-- 🚫 Out of stock per city (2026-10-25). Re-runnable. Runs after franchise.sql.
-- The franchise admin marks a product out of stock in their own city (Kirana, vegetables, fruits, pooja…); the
-- customer sees it greyed out ("Out of stock") at the end of its section and cannot order it. HQ still has the
-- all-cities switch (products.in_stock) and still alone adds / changes products, services and categories.
-- franchise_products.in_stock = false → out of stock in that city (a row is added just for that; is_enabled keeps
-- its meaning, so switching stock never shows or hides a product).

ALTER TABLE franchise_products ADD COLUMN IF NOT EXISTS in_stock BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE franchise_products ADD COLUMN IF NOT EXISTS stock_changed_at TIMESTAMPTZ;
ALTER TABLE franchise_products ADD COLUMN IF NOT EXISTS stock_changed_by INT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS franchise_products_out_idx ON franchise_products (franchise_id) WHERE NOT in_stock;

-- Can this city sell the product now? (all-cities stock AND the city's own; no city = all-cities only)
CREATE OR REPLACE FUNCTION fn_product_in_stock(p_franchise INT, p_product_id INT) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT p.in_stock AND (p_franchise IS NULL OR NOT EXISTS (
           SELECT 1 FROM franchise_products fp WHERE fp.franchise_id = p_franchise AND fp.product_id = p.id AND NOT fp.in_stock))
    FROM products p WHERE p.id = p_product_id
$$;

-- Mark a product in / out of stock in one city. Only a product the city shows; logged in the activity log.
-- Returns {id, name, in_stock}.
CREATE OR REPLACE FUNCTION fn_set_city_stock(p_franchise INT, p_product_id INT, p_in_stock BOOLEAN, p_by INT) RETURNS JSONB
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_name TEXT;
  v_city TEXT := (SELECT city FROM franchises WHERE id = p_franchise);
BEGIN
  IF v_city IS NULL THEN
    RAISE EXCEPTION 'Choose the city first' USING ERRCODE = '22023';
  END IF;
  IF p_in_stock IS NULL THEN
    RAISE EXCEPTION 'Choose in stock or out of stock' USING ERRCODE = '22023';
  END IF;
  SELECT trim(coalesce(p.brand || ' ', '') || p.name) INTO v_name FROM products p WHERE p.id = p_product_id AND p.is_active;
  IF v_name IS NULL OR NOT fn_product_visible(p_franchise, p_product_id) THEN
    RAISE EXCEPTION 'This product is not offered in your city' USING ERRCODE = 'P0002';
  END IF;
  IF p_in_stock AND fn_product_in_stock(p_franchise, p_product_id) IS NOT DISTINCT FROM (SELECT in_stock FROM products WHERE id = p_product_id) THEN
    RETURN jsonb_build_object('id', p_product_id, 'name', v_name, 'in_stock', true); -- nothing to change
  END IF;
  INSERT INTO franchise_products (franchise_id, product_id, in_stock, stock_changed_at, stock_changed_by)
  VALUES (p_franchise, p_product_id, p_in_stock, now(), p_by)
  ON CONFLICT (franchise_id, product_id) DO UPDATE
    SET in_stock = EXCLUDED.in_stock, stock_changed_at = now(), stock_changed_by = EXCLUDED.stock_changed_by
    WHERE franchise_products.in_stock IS DISTINCT FROM EXCLUDED.in_stock;
  IF FOUND THEN
    INSERT INTO admin_audit_log (actor_id, entity, entity_id, action, details)
    VALUES (p_by, 'stock', p_product_id, CASE WHEN p_in_stock THEN 'in_stock' ELSE 'out_of_stock' END,
            jsonb_build_object('name', v_name, 'city', v_city, 'franchise_id', p_franchise));
  END IF;
  RETURN jsonb_build_object('id', p_product_id, 'name', v_name, 'in_stock', p_in_stock);
END $$;

-- "All back in stock": every product of the city (or of one service in it) that the city marked out of stock.
-- Returns how many came back.
CREATE OR REPLACE FUNCTION fn_city_restock(p_franchise INT, p_service_id INT, p_by INT) RETURNS INT
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_n INT;
BEGIN
  UPDATE franchise_products fp SET in_stock = true, stock_changed_at = now(), stock_changed_by = p_by
    FROM products p
   WHERE p.id = fp.product_id AND fp.franchise_id = p_franchise AND NOT fp.in_stock
     AND (p_service_id IS NULL OR p.service_id = p_service_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    INSERT INTO admin_audit_log (actor_id, entity, entity_id, action, details)
    VALUES (p_by, 'stock', p_service_id, 'restock_all',
            jsonb_build_object('name', coalesce((SELECT name FROM services WHERE id = p_service_id), 'All products'),
                               'city', (SELECT city FROM franchises WHERE id = p_franchise), 'products', v_n, 'franchise_id', p_franchise));
  END IF;
  RETURN v_n;
END $$;

-- What the city has out of stock (the franchise admin's list and the menu count; HQ's view of a city).
CREATE OR REPLACE FUNCTION fn_city_out_of_stock(p_franchise INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'brand', p.brand, 'unit', p.unit, 'image_url', p.image_url, 'icon', p.icon,
           'service_id', s.id, 'service_name', s.name, 'since', fp.stock_changed_at,
           'by', (SELECT coalesce(u.full_name, u.username) FROM users u WHERE u.id = fp.stock_changed_by))
         ORDER BY s.name, p.sort_order), '[]'::jsonb)
    FROM franchise_products fp JOIN products p ON p.id = fp.product_id AND p.is_active
    JOIN services s ON s.id = p.service_id AND s.is_active
   WHERE fp.franchise_id = p_franchise AND NOT fp.in_stock
$$;

-- The products of a service in one franchise (My services → Products): now with the city's stock.
CREATE OR REPLACE FUNCTION fn_franchise_products(p_franchise INT, p_service_id INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'brand', p.brand, 'unit', p.unit, 'icon', p.icon, 'image_url', p.image_url,
           'section', p.section, 'is_active', p.is_active, 'only_assigned', p.only_assigned,
           'enabled', fn_product_visible(p_franchise, p.id),
           'in_stock_all', p.in_stock,                                   -- HQ's all-cities switch
           'in_stock', NOT EXISTS (SELECT 1 FROM franchise_products fp   -- this city's own
                                    WHERE fp.franchise_id = p_franchise AND fp.product_id = p.id AND NOT fp.in_stock))
         ORDER BY p.sort_order, p.id), '[]'::jsonb)
    FROM products p WHERE p.service_id = p_service_id
$$;
