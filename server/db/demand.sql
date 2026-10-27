-- 🔎 What customers ask for (HQ, city by city): words searched with nothing found, and the items customers wrote
-- themselves (Shop For Me, Instant "Others", Village "Other things", own lists). HQ sees which new services or
-- products each city wants. Only the words, the city and the time are kept — no name, no phone. Runs after franchise.sql.

CREATE TABLE IF NOT EXISTS search_misses (
  id           BIGSERIAL PRIMARY KEY,
  franchise_id INT REFERENCES franchises(id) ON DELETE SET NULL, -- the customer's city (NULL: not chosen yet)
  term         VARCHAR(60) NOT NULL,                             -- lower case, single spaces
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_misses_city_idx ON search_misses (franchise_id, created_at DESC);

-- "Nothing found" for a search (the customer looked at it for a moment — sent by the app). The same words from the same
-- city within 10 minutes count once (one customer retrying is not ten customers).
CREATE OR REPLACE PROCEDURE sp_search_miss(p_franchise INT, p_term TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v TEXT := left(lower(trim(regexp_replace(coalesce(p_term, ''), '\s+', ' ', 'g'))), 60);
BEGIN
  IF length(v) < 3 OR v !~ '[[:alpha:]]' THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM search_misses WHERE term = v AND franchise_id IS NOT DISTINCT FROM p_franchise
                AND created_at > now() - interval '10 minutes') THEN
    RETURN;
  END IF;
  INSERT INTO search_misses (franchise_id, term) VALUES (p_franchise, v);
END $$;

-- HQ report for one city (NULL = all cities) over the last p_days days:
-- {misses: [{term, times, cities, last_at}], written: [{item, times, cities, shops, last_at}], summary}
CREATE OR REPLACE FUNCTION fn_demand_report(p_franchise INT, p_days INT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  WITH since AS (SELECT now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365))) AS t),
  miss AS (
    SELECT m.term, count(*) AS times, string_agg(DISTINCT coalesce(f.city, '—'), ', ') AS cities, max(m.created_at) AS last_at
      FROM search_misses m LEFT JOIN franchises f ON f.id = m.franchise_id, since
     WHERE m.created_at >= since.t AND (p_franchise IS NULL OR m.franchise_id = p_franchise)
     GROUP BY m.term
  ),
  -- lines the customer typed: not a product of our list, and not just the booked service itself
  wrote AS (
    SELECT lower(trim(regexp_replace(i.name, '\s+', ' ', 'g'))) AS item, count(*) AS times,
           string_agg(DISTINCT coalesce(f.city, '—'), ', ') AS cities, string_agg(DISTINCT s.name, ', ') AS shops, max(o.created_at) AS last_at
      FROM order_items i JOIN orders o ON o.id = i.order_id JOIN services s ON s.id = i.service_id
      LEFT JOIN franchises f ON f.id = o.franchise_id, since
     WHERE i.product_id IS NULL AND i.name <> s.name AND length(trim(i.name)) >= 2
       AND (s.allows_list OR s.is_village OR coalesce(cardinality(s.source_service_ids), 0) > 0)
       AND o.created_at >= since.t AND (p_franchise IS NULL OR o.franchise_id = p_franchise)
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'misses', coalesce((SELECT jsonb_agg(to_jsonb(miss) ORDER BY times DESC, last_at DESC) FROM (SELECT * FROM miss ORDER BY times DESC, last_at DESC LIMIT 100) miss), '[]'::jsonb),
    'written', coalesce((SELECT jsonb_agg(to_jsonb(wrote) ORDER BY times DESC, last_at DESC) FROM (SELECT * FROM wrote ORDER BY times DESC, last_at DESC LIMIT 100) wrote), '[]'::jsonb),
    'summary', jsonb_build_object('searches', (SELECT coalesce(sum(times), 0) FROM miss), 'words', (SELECT count(*) FROM miss),
                                  'written', (SELECT coalesce(sum(times), 0) FROM wrote), 'items', (SELECT count(*) FROM wrote)))
$$;
