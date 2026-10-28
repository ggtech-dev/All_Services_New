-- 📦 Pack sizes (the way Blinkit / Zepto do it): every size is its own product — its own stock per city, cart line and
-- bill line — and the sizes of one product are linked by pack_group (= the id of the product they were made from).
-- The customer sees one card and picks the size. No prices: in "pay as per the shop bill" shops the customer pays
-- the shop's price for the size bought, we charge only the delivery fee.

ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_group INT REFERENCES products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS products_pack_group_idx ON products (pack_group) WHERE pack_group IS NOT NULL;

-- grams / millilitres in a pack text, to sort sizes small → big: "200 g" = 200, "1 kg" / "1 L" = 1000,
-- "4 × 100 g" = 400, "4 pack" = 4. NULL when there is no number.
CREATE OR REPLACE FUNCTION fn_pack_qty(p_unit TEXT) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(m[1]::numeric, 1) * m[2]::numeric * CASE m[3] WHEN 'kg' THEN 1000 WHEN 'l' THEN 1000 ELSE 1 END
    FROM (SELECT regexp_match(lower(coalesce(p_unit, '')), '^\s*(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|ml|l)?\M') AS m) x
$$;

-- HQ adds a size to a product: a copy with the new pack text (same name, brand, photo, section, note choices), linked
-- in the same pack group. Its price is left empty (shop bill). It follows the product's city choices (switched off /
-- only for some cities). A size that was switched off before comes back.
CREATE OR REPLACE FUNCTION fn_add_pack_size(p_product INT, p_unit TEXT) RETURNS products
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  src products;
  v products;
  v_unit TEXT := trim(regexp_replace(coalesce(p_unit, ''), '\s+', ' ', 'g'));
  v_group INT;
  v_slug TEXT;
BEGIN
  SELECT * INTO src FROM products WHERE id = p_product;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = '22023';
  END IF;
  IF length(v_unit) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Enter the pack size, like 200 g or 1 L' USING ERRCODE = '22023';
  END IF;
  v_group := coalesce(src.pack_group, src.id);
  UPDATE products SET is_active = true, updated_at = now()
   WHERE (id = v_group OR pack_group = v_group) AND lower(unit) = lower(v_unit) AND NOT is_active
  RETURNING * INTO v;
  IF FOUND THEN
    RETURN v;
  END IF;
  IF EXISTS (SELECT 1 FROM products WHERE (id = v_group OR pack_group = v_group) AND lower(unit) = lower(v_unit)) THEN
    RAISE EXCEPTION '% already has the size %', src.name, v_unit USING ERRCODE = '55000';
  END IF;
  v_slug := left((SELECT slug FROM products WHERE id = v_group), 100) || '-' || trim(both '-' from regexp_replace(lower(v_unit), '[^a-z0-9]+', '-', 'g'));
  IF EXISTS (SELECT 1 FROM products WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || v_group;
  END IF;
  UPDATE products SET pack_group = v_group WHERE id = v_group AND pack_group IS NULL;
  INSERT INTO products (service_id, slug, name, brand, description, icon, image_url, unit, price, mrp, sell_by, note_options,
                        section, sort_order, only_assigned, pack_group)
  VALUES (src.service_id, v_slug, src.name, src.brand, src.description, src.icon, src.image_url, v_unit, 0, NULL, src.sell_by,
          src.note_options, src.section, src.sort_order, src.only_assigned, v_group)
  RETURNING * INTO v;
  INSERT INTO franchise_products (franchise_id, product_id, is_enabled)
  SELECT franchise_id, v.id, is_enabled FROM franchise_products WHERE product_id = src.id
  ON CONFLICT DO NOTHING;
  RETURN v;
END $$;

-- The sizes of one product stay one product: a new name, brand, description, emoji or section on one size is given to
-- all its sizes (only the pack text, stock and "live" are per size). A new photo goes to the sizes that shared the old
-- one — a size with its own photo (e.g. the 2 L bottle) keeps it.
CREATE OR REPLACE FUNCTION fn_pack_sync() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  UPDATE products SET image_url = CASE WHEN image_url IS NOT DISTINCT FROM OLD.image_url THEN NEW.image_url ELSE image_url END,
                      image_credit = CASE WHEN image_url IS NOT DISTINCT FROM OLD.image_url THEN NEW.image_credit ELSE image_credit END,
                      name = NEW.name, brand = NEW.brand,
                      description = NEW.description, icon = NEW.icon, section = NEW.section, updated_at = now()
   WHERE (pack_group = NEW.pack_group OR id = NEW.pack_group) AND id <> NEW.id
     AND (image_url, image_credit, name, brand, description, icon, section)
         IS DISTINCT FROM (NEW.image_url, NEW.image_credit, NEW.name, NEW.brand, NEW.description, NEW.icon, NEW.section);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS products_pack_sync ON products;
CREATE TRIGGER products_pack_sync AFTER UPDATE OF image_url, image_credit, name, brand, description, icon, section ON products
  FOR EACH ROW WHEN (NEW.pack_group IS NOT NULL AND pg_trigger_depth() = 0) EXECUTE FUNCTION fn_pack_sync();

-- Deleting the size the others are linked to: the next size becomes the link, so the card stays one card.
CREATE OR REPLACE FUNCTION fn_pack_relink() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_next INT;
BEGIN
  SELECT min(id) INTO v_next FROM products WHERE pack_group = OLD.id AND id <> OLD.id;
  IF v_next IS NOT NULL THEN
    UPDATE products SET pack_group = v_next WHERE pack_group = OLD.id AND id <> OLD.id;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS products_pack_relink ON products;
CREATE TRIGGER products_pack_relink BEFORE DELETE ON products FOR EACH ROW EXECUTE FUNCTION fn_pack_relink();
