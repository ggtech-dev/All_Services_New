-- ⭐ "Our most popular services" on the customer home page: photo cards that open a service or a category.
-- HQ manages them — one list for all cities, and (when HQ makes one) a city's own list that replaces it there.
-- A franchise admin asks HQ to add a service to the row or take a card off (Requests to HQ). Re-runnable.

CREATE TABLE IF NOT EXISTS home_popular (
  id            SERIAL PRIMARY KEY,
  franchise_id  INT REFERENCES franchises(id) ON DELETE CASCADE, -- NULL = the list for all cities
  service_id    INT REFERENCES services(id) ON DELETE CASCADE,   -- opens this service …
  category_id   INT REFERENCES categories(id) ON DELETE CASCADE, -- … or this category
  title         VARCHAR(60)  NOT NULL,
  subtitle      VARCHAR(80),
  image_url     TEXT,                                           -- NULL = the service's / category's own photo
  image_credit  TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((service_id IS NULL) <> (category_id IS NULL))
);
CREATE INDEX IF NOT EXISTS home_popular_list_idx ON home_popular (franchise_id, sort_order);

-- The list a city shows: its own list when HQ made one, otherwise the all-cities list.
CREATE OR REPLACE FUNCTION fn_popular_list_of(p_franchise INT) RETURNS INT
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT CASE WHEN p_franchise IS NOT NULL AND EXISTS (SELECT 1 FROM home_popular WHERE franchise_id = p_franchise) THEN p_franchise END
$$;

-- Customer home: the active cards of the city (p_franchise NULL = no city chosen), with where each one opens.
-- Cards of a switched-off service / category, or one the city does not offer, are left out. At most 8.
CREATE OR REPLACE FUNCTION fn_home_popular(p_franchise INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x.sort_order, x.id), '[]'::jsonb) FROM (
    SELECT h.id, h.title, h.subtitle, h.sort_order,
           coalesce(h.image_url, s.image_url, c.image_url) AS image_url,
           CASE WHEN h.image_url IS NOT NULL THEN h.image_credit ELSE coalesce(s.image_credit, c.image_credit) END AS image_credit,
           coalesce(sc.icon, c.icon) AS icon, coalesce(sc.color, c.color) AS color,
           CASE WHEN s.id IS NOT NULL THEN
                  CASE WHEN EXISTS (SELECT 1 FROM products p WHERE p.service_id = s.id AND p.is_active) OR s.allows_list
                       THEN '/service/' || s.slug ELSE '/checkout?service=' || s.slug END
                ELSE '/category/' || c.slug END AS href
      FROM home_popular h
      LEFT JOIN services s ON s.id = h.service_id
      LEFT JOIN categories sc ON sc.id = s.category_id
      LEFT JOIN categories c ON c.id = h.category_id
     WHERE h.is_active AND h.franchise_id IS NOT DISTINCT FROM fn_popular_list_of(p_franchise)
       AND (s.id IS NULL OR (s.is_active AND sc.is_active AND fn_service_visible(p_franchise, s.id)))
       AND (c.id IS NULL OR c.is_active)
     ORDER BY h.sort_order, h.id
     LIMIT 8
  ) x
$$;

-- A city gets its own list (a copy of the all-cities list) the first time HQ changes it for that city.
CREATE OR REPLACE FUNCTION fn_popular_own_list(p_franchise INT) RETURNS VOID
LANGUAGE sql SET search_path FROM CURRENT AS $$
  INSERT INTO home_popular (franchise_id, service_id, category_id, title, subtitle, image_url, image_credit, sort_order, is_active)
  SELECT p_franchise, service_id, category_id, title, subtitle, image_url, image_credit, sort_order, is_active
    FROM home_popular d
   WHERE d.franchise_id IS NULL AND NOT EXISTS (SELECT 1 FROM home_popular WHERE franchise_id = p_franchise)
$$;

-- Franchise admin asks HQ:  {kind: 'popular', service_id, details?} · {kind: 'popular_off', popular_id, details?}
CREATE OR REPLACE FUNCTION fn_request_popular(p_franchise INT, p_by INT, p JSONB) RETURNS catalog_requests
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v catalog_requests;
  v_kind TEXT := p->>'kind';
  v_service INT := CASE WHEN p->>'service_id' ~ '^\d{1,9}$' THEN (p->>'service_id')::int END;
  v_card INT := CASE WHEN p->>'popular_id' ~ '^\d{1,9}$' THEN (p->>'popular_id')::int END;
  v_details TEXT := nullif(left(trim(coalesce(p->>'details', '')), 500), '');
  v_list INT := fn_popular_list_of(p_franchise);
  v_name TEXT;
BEGIN
  IF v_kind = 'popular' THEN
    IF NOT EXISTS (SELECT 1 FROM services WHERE id = v_service AND is_active) OR NOT fn_service_visible(p_franchise, v_service) THEN
      RAISE EXCEPTION 'Choose one of your city''s services' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM home_popular WHERE franchise_id IS NOT DISTINCT FROM v_list AND service_id = v_service AND is_active) THEN
      RAISE EXCEPTION 'This service is already in the popular row' USING ERRCODE = '55000';
    END IF;
    SELECT name INTO v_name FROM services WHERE id = v_service;
  ELSIF v_kind = 'popular_off' THEN
    SELECT title INTO v_name FROM home_popular WHERE id = v_card AND franchise_id IS NOT DISTINCT FROM v_list AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Choose one of the cards shown in your city' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'Choose: add a service to popular, or take a card off' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM catalog_requests WHERE franchise_id = p_franchise AND status = 'pending' AND kind = v_kind
              AND service_id IS NOT DISTINCT FROM CASE WHEN v_kind = 'popular' THEN v_service END
              AND popular_id IS NOT DISTINCT FROM CASE WHEN v_kind = 'popular_off' THEN v_card END) THEN
    RAISE EXCEPTION 'You have already asked for this — it is waiting for approval' USING ERRCODE = '55000';
  END IF;
  INSERT INTO catalog_requests (franchise_id, kind, service_id, popular_id, name, details, requested_by)
  VALUES (p_franchise, v_kind, CASE WHEN v_kind = 'popular' THEN v_service END, CASE WHEN v_kind = 'popular_off' THEN v_card END,
          v_name, v_details, p_by)
  RETURNING * INTO v;
  RETURN v;
END $$;

-- HQ approves: the city gets its own list (if it had none) and the card is added at the end / taken off.
CREATE OR REPLACE FUNCTION fn_approve_popular_request(r catalog_requests) RETURNS VOID
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_title TEXT;
  d home_popular;
BEGIN
  IF r.kind = 'popular' THEN
    PERFORM fn_popular_own_list(r.franchise_id);
    IF NOT EXISTS (SELECT 1 FROM home_popular WHERE franchise_id = r.franchise_id AND service_id = r.service_id AND is_active) THEN
      SELECT name INTO v_title FROM services WHERE id = r.service_id;
      INSERT INTO home_popular (franchise_id, service_id, title, subtitle, sort_order)
      VALUES (r.franchise_id, r.service_id, left(v_title, 60), NULL,
              coalesce((SELECT max(sort_order) FROM home_popular WHERE franchise_id = r.franchise_id), 0) + 1);
    END IF;
  ELSE
    SELECT * INTO d FROM home_popular WHERE id = r.popular_id;
    PERFORM fn_popular_own_list(r.franchise_id);
    -- the card asked about may be an all-cities one: take off the city's copy of it
    UPDATE home_popular SET is_active = false, updated_at = now()
     WHERE franchise_id = r.franchise_id AND (id = r.popular_id
           OR (d.franchise_id IS NULL AND service_id IS NOT DISTINCT FROM d.service_id AND category_id IS NOT DISTINCT FROM d.category_id));
  END IF;
END $$;
