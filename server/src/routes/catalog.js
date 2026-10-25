import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';

const router = Router();

// The city (franchise) the customer chose in the app — X-Franchise header. None = everything (one-city setups).
const cityOf = (req) => {
  const h = String(req.get('x-franchise') || '');
  return /^\d{1,9}$/.test(h) ? Number(h) : null;
};

// Cities customers can choose.
router.get('/franchises', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT fn_public_franchises() AS list');
    res.json(rows[0].list);
  } catch (err) {
    next(err);
  }
});

// ⭐ "Our most popular services" on the home page: the city's photo cards (HQ sets them — popular.sql)
// 🍱 Tomorrow's Meal for the customer's city: the delivery day, the menu photo, the curries / charus to choose from
// (lunch and dinner) and the plates with prices (homefood.sql). No city chosen: our first city.
router.get('/meal-menu', async (req, res, next) => {
  try {
    const city = cityOf(req) ?? (await query("SELECT id FROM franchises WHERE status = 'active' ORDER BY id LIMIT 1")).rows[0]?.id ?? null;
    const { rows } = await query('SELECT fn_meal_menu($1) AS m', [city]);
    res.json(rows[0].m);
  } catch (err) {
    next(err);
  }
});

// 👩‍🍳 Book Your Cook: the price for 1, 1½ … 8 hours in the customer's city (homefood.sql works them out).
router.get('/cook-prices', async (req, res, next) => {
  try {
    const city = cityOf(req) ?? (await query("SELECT id FROM franchises WHERE status = 'active' ORDER BY id LIMIT 1")).rows[0]?.id ?? null;
    const { rows } = await query(
      `SELECT h / 2.0 AS hours, fn_cook_price(h / 2.0, $1) AS price FROM generate_series(2, 16) AS h ORDER BY h`, [city]);
    res.json(rows.map((r) => ({ hours: Number(r.hours), price: Number(r.price) })));
  } catch (err) {
    next(err);
  }
});

router.get('/home-popular', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT fn_home_popular($1) AS list', [cityOf(req)]);
    res.json(rows[0].list);
  } catch (err) {
    next(err);
  }
});

router.get('/localities', async (req, res, next) => {
  try {
    // ?franchise= (agent sign-up) · ?all=1 (the 📍 location search: every city we serve) · else the customer's city
    const fr = /^\d{1,9}$/.test(String(req.query.franchise || '')) ? Number(req.query.franchise)
      : req.query.all === '1' ? null : cityOf(req);
    const { rows } = await query(
      `SELECT l.id, l.name, l.pincode, l.lat::float AS lat, l.lng::float AS lng, l.franchise_id, f.city,
              l.is_village, l.village_band, CASE WHEN l.is_village THEN fn_village_fee(l.id) END AS village_fee
         FROM localities l LEFT JOIN franchises f ON f.id = l.franchise_id
        WHERE l.is_active AND (f.id IS NULL OR f.status = 'active') AND ($1::int IS NULL OR l.franchise_id = $1)
        ORDER BY f.city NULLS LAST, l.name`,
      [fr]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// 📍 ?lat&lng → the franchise (city) that serves this spot — the nearest one whose range covers it — with its areas,
// nearest first. { franchise: null } = we don't deliver there yet (geo.sql).
// 📍 "Notify me when you start here" (db/waitlist.sql). Open to guests; a logged-in customer is linked to it.
// body: { phone, name?, lat?, lng?, place_text? } — at most 10 per hour from one connection.
const waitlistHits = new Map(); // ip → [times]
router.post('/waitlist', async (req, res, next) => {
  try {
    // behind Nginx the visitor's own address is the first one in X-Forwarded-For
    const ip = String(req.get('x-forwarded-for') || '').split(',')[0].trim() || req.ip;
    const now = Date.now();
    const recent = (waitlistHits.get(ip) || []).filter((t) => now - t < 3600e3);
    if (recent.length >= 10) return res.status(429).json({ error: 'Too many requests — please try again in a while' });
    waitlistHits.set(ip, [...recent, now]);
    if (waitlistHits.size > 5000) waitlistHits.clear();

    let user = null;
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    try {
      user = t ? jwt.verify(t, process.env.JWT_SECRET) : null;
    } catch {
      user = null;
    }
    const b = req.body || {};
    const n = (v) => (/^-?\d{1,3}(\.\d+)?$/.test(String(v ?? '')) ? Number(v) : null);
    const s = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
    const { rows } = await query('SELECT fn_waitlist_join($1, $2, $3, $4, $5, $6) AS r',
      [user?.id || null, s(b.name, 80), s(b.phone, 20), n(b.lat), n(b.lng), s(b.place_text, 120)]);
    res.status(201).json(rows[0].r);
  } catch (err) {
    next(err);
  }
});

router.get('/locate', async (req, res, next) => {
  try {
    const n = (v) => (/^-?\d{1,3}(\.\d+)?$/.test(String(v ?? '')) ? Number(v) : null);
    const lat = n(req.query.lat);
    const lng = n(req.query.lng);
    if (lat == null || lng == null) return res.status(400).json({ error: 'Location missing' });
    const { rows: at } = await query(
      `SELECT f.id, f.code, f.city, f.radius_km, a.km FROM fn_franchise_at($1, $2) a JOIN franchises f ON f.id = a.franchise_id`, [lat, lng]);
    if (!at[0]) return res.json({ franchise: null });
    const { rows: areas } = await query(
      `SELECT l.id, l.name, l.pincode, l.is_village, l.village_band, fn_distance_km(l.lat, l.lng, $2, $3) AS km,
              CASE WHEN l.is_village THEN fn_village_fee(l.id) END AS village_fee
         FROM localities l WHERE l.franchise_id = $1 AND l.is_active ORDER BY 6, l.name`,
      [at[0].id, lat, lng]
    );
    res.json({ franchise: at[0], areas, nearest: areas[0] || null });
  } catch (err) {
    next(err);
  }
});

router.get('/service-types', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT code, name, agent_title, icon, fn_subscription_by_skill($1) -> code AS subscription
         FROM service_types WHERE is_active ORDER BY sort_order, name`,
      // the city's own subscription terms (?franchise= from the agent application form: the chosen area's city)
      [/^\d{1,9}$/.test(String(req.query.franchise || '')) ? Number(req.query.franchise) : cityOf(req)]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// 🎉 Event types for the event booking form.
router.get('/event-types', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT fn_event_types() AS t');
    res.json(rows[0].t);
  } catch (err) {
    next(err);
  }
});

// 🚗 Trip types and car types for the car booking form.
router.get('/trip-options', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT fn_trip_options() AS t');
    res.json(rows[0].t);
  } catch (err) {
    next(err);
  }
});

// Photo credits (free-licence photos must name their author): every photo the app shows, grouped by credit.
router.get('/credits', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT credit, array_agg(DISTINCT name ORDER BY name) AS used_for FROM (
         SELECT image_credit AS credit, name FROM categories WHERE is_active AND image_url IS NOT NULL AND image_credit IS NOT NULL
         UNION ALL SELECT image_credit, name FROM services WHERE is_active AND image_url IS NOT NULL AND image_credit IS NOT NULL
         UNION ALL SELECT image_credit, name FROM products WHERE is_active AND image_url IS NOT NULL AND image_credit IS NOT NULL
         UNION ALL SELECT image_credit, name FROM promotions WHERE image_url IS NOT NULL AND image_credit IS NOT NULL
         UNION ALL SELECT image_credit, title FROM home_popular WHERE is_active AND image_url IS NOT NULL AND image_credit IS NOT NULL
       ) x WHERE trim(credit) <> '' GROUP BY credit ORDER BY min(name)`
    );
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/settings', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT key, value FROM site_settings');
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  } catch (err) {
    next(err);
  }
});

router.get('/categories', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.slug, c.name, c.icon, c.description, c.image_url, c.image_credit, c.color,
              count(s.id)::int AS service_count
         FROM categories c
         LEFT JOIN services s ON s.category_id = c.id AND s.is_active AND s.parent_id IS NULL AND s.in_category_list AND fn_service_visible($1, s.id)
        WHERE c.is_active
        GROUP BY c.id
        ORDER BY c.sort_order`,
      [cityOf(req)]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/categories/:slug', async (req, res, next) => {
  try {
    const cat = await query('SELECT * FROM categories WHERE slug = $1 AND is_active', [req.params.slug]);
    if (!cat.rows[0]) return res.status(404).json({ error: 'Category not found' });

    const services = await query(
      `SELECT s.id, s.slug, s.name, s.description, s.image_url, s.image_credit, s.base_price, s.price_unit,
              s.eta_minutes, s.requires_license, s.price_on_bill, s.window_from, s.window_to, s.is_featured, s.allows_list,
              -- 🏠 a group (Home Doctor Visit): its types are chosen on its own page
              (SELECT count(*) FROM services x WHERE x.parent_id = s.id AND x.is_active AND fn_service_visible($2, x.id))::int AS type_count,
              (SELECT count(*) FROM products p WHERE p.service_id = ANY (fn_service_items(s.id) || coalesce(s.source_service_ids, ARRAY[]::int[])) AND p.is_active
                 AND ($2::int IS NULL OR fn_product_visible($2, p.id)))::int AS product_count
         FROM services s WHERE s.category_id = $1 AND s.is_active AND s.parent_id IS NULL AND NOT s.home_card AND s.in_category_list AND fn_service_visible($2, s.id)
        ORDER BY s.is_featured DESC, s.sort_order`,
      [cat.rows[0].id, cityOf(req)]
    );
    res.json({ category: cat.rows[0], services: services.rows });
  } catch (err) {
    next(err);
  }
});

// 🏠 A group service (Home Doctor Visit): its types, with how many partners can take each one in the customer's city.
router.get('/services/:slug/types', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.slug, s.name, s.description, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon,
              c.color AS category_color, fn_service_children(s.id, $2) AS types
         FROM services s JOIN categories c ON c.id = s.category_id
        WHERE s.slug = fn_service_page_slug($1) AND s.is_active AND c.is_active AND fn_service_visible($2, s.id)`,
      [req.params.slug, cityOf(req)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'This service is not available in your city' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Shops the customer may choose at checkout: ?services=19,2936 (the cart's services).
router.get('/shops', async (req, res, next) => {
  try {
    const ids = String(req.query.services || '').split(',').filter((x) => /^\d{1,9}$/.test(x)).slice(0, 40).map(Number);
    const { rows } = await query('SELECT fn_shops_for($1, $2) AS list', [ids, cityOf(req)]);
    res.json(rows[0].list);
  } catch (err) {
    next(err);
  }
});

// Services highlighted on the home page (e.g. fresh vegetables 6–10 AM).
// 💧 Services with their own big card at the top of the home page (drinking water cans), with their items.
router.get('/home-cards', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.slug, s.name, s.description, s.image_url, s.price_unit, s.eta_minutes, s.price_on_bill,
              c.icon AS category_icon, c.color AS category_color,
              coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'brand', p.brand, 'unit', p.unit, 'price', p.price,
                                 'mrp', p.mrp, 'icon', p.icon, 'image_url', p.image_url, 'sell_by', p.sell_by) ORDER BY p.sort_order, p.id)
                          FROM products p WHERE p.service_id = s.id AND p.is_active AND fn_product_in_stock($1, p.id)
                           AND ($1::int IS NULL OR fn_product_visible($1, p.id))), '[]') AS products
         FROM services s JOIN categories c ON c.id = s.category_id
        WHERE s.home_card AND s.is_active AND fn_service_visible($1, s.id)
        ORDER BY s.sort_order, s.id`,
      [cityOf(req)]
    );
    res.json(rows.filter((s) => s.products.length));
  } catch (err) {
    next(err);
  }
});

// 🔍 Home search: ?q=plumber → services (by name, description or category) and items (by name or brand) in the
// customer's city. Each result says where it opens: a shop page, a booking, or a category with its own page.
router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.json({ services: [], products: [] });
    const esc = (t) => `%${t.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    // the customer's words + the English names the app found for them (Telugu "కిరాణా" → "Kirana", "paalu" → "Milk")
    const also = String(req.query.also || '').split('|').map((t) => t.trim().slice(0, 40)).filter((t) => t.length >= 2).slice(0, 6);
    const likes = [q, ...also].map(esc);
    // "fast", "quick", "urgent", "10 min"… → ⚡ Instant Delivery first (the only 10-minute service)
    const fast = /^(instant|fast|quick|urgent|express|now|asap|10 ?min(ute)?s?|in 10 min(ute)?s?)$/i.test(q);
    const [services, products] = await Promise.all([
      query(
        `SELECT s.slug, s.name, s.price_unit, c.slug AS category_slug, c.name AS category_name, s.allows_list,
                (SELECT count(*) FROM services x WHERE x.parent_id = s.id AND x.is_active)::int AS type_count,
                (SELECT count(*) FROM products p WHERE p.service_id = ANY (fn_service_items(s.id) || coalesce(s.source_service_ids, ARRAY[]::int[])) AND p.is_active)::int AS product_count
           FROM services s JOIN categories c ON c.id = s.category_id
          WHERE s.is_active AND c.is_active AND s.parent_id IS NULL AND NOT s.home_card AND fn_service_visible($2, s.id)
            AND (s.name ILIKE ANY($1) OR s.description ILIKE ANY($1) OR c.name ILIKE ANY($1) OR ($3 AND s.skill_code = 'instant'))
          ORDER BY ($3 AND s.skill_code = 'instant') DESC, (s.name ILIKE ANY($1)) DESC, c.sort_order, s.sort_order LIMIT 20`, [likes, cityOf(req), fast]),
      query(
        `SELECT p.name, p.brand, p.unit, p.price, s.slug AS service_slug, s.name AS service_name, s.price_on_bill
           FROM products p JOIN services s ON s.id = p.service_id JOIN categories c ON c.id = s.category_id
          WHERE p.is_active AND s.is_active AND c.is_active AND fn_service_visible($2, s.id)
            AND ($2::int IS NULL OR fn_product_visible($2, p.id)) AND (p.name ILIKE ANY($1) OR p.brand ILIKE ANY($1))
          ORDER BY (p.name ILIKE ANY($1)) DESC, p.name LIMIT 20`, [likes, cityOf(req)]),
    ]);
    res.json({ services: services.rows, products: products.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/featured-services', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.slug, s.name, s.description, s.image_url, s.image_credit, s.price_unit, s.price_on_bill,
              s.window_from, s.window_to, c.icon AS category_icon, c.color AS category_color,
              (SELECT count(*) FROM products p WHERE p.service_id = ANY (fn_service_items(s.id) || coalesce(s.source_service_ids, ARRAY[]::int[])) AND p.is_active)::int AS product_count
         FROM services s JOIN categories c ON c.id = s.category_id
        WHERE s.is_featured AND s.is_active AND c.is_active AND fn_service_visible($1, s.id)
        ORDER BY c.sort_order, s.sort_order`,
      [cityOf(req)]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ⚡ Instant Delivery services (for the home page card).
router.get('/instant-services', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.slug, s.name, s.description, s.eta_minutes, s.image_url, c.color AS category_color,
              (SELECT array_agg(x.name ORDER BY array_position(s.source_service_ids, x.id)) FROM services x
                WHERE x.id = ANY (s.source_service_ids) AND x.is_active) AS source_names
         FROM services s JOIN categories c ON c.id = s.category_id
        WHERE s.is_active AND c.is_active AND coalesce(cardinality(s.source_service_ids), 0) > 0 AND NOT s.is_village AND fn_service_visible($1, s.id)
        ORDER BY s.sort_order, s.id`,
      [cityOf(req)]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// A service with the products customers can order in it. A service that is another name for one (Vegetable Delivery =
// Fresh Vegetables, fn_service_page_slug) opens that service.
router.get('/services/:slug', async (req, res, next) => {
  try {
    const svc = await query(
      `SELECT s.*, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
              ps.slug AS parent_slug, ps.name AS parent_name,
              -- services the category page lists (as /categories/:slug): with only one it opens that service directly,
              -- so the "back" link must go to all categories instead (else it bounces back here)
              (SELECT count(*) FROM services x WHERE x.category_id = s.category_id AND x.is_active AND x.parent_id IS NULL
                  AND NOT x.home_card AND x.in_category_list AND fn_service_visible($2, x.id))::int AS category_services
         FROM services s JOIN categories c ON c.id = s.category_id LEFT JOIN services ps ON ps.id = s.parent_id
        WHERE s.slug = fn_service_page_slug($1) AND s.is_active AND c.is_active AND fn_service_visible($2, s.id)`,
      [req.params.slug, cityOf(req)]
    );
    if (!svc.rows[0]) return res.status(404).json({ error: 'This service is not available in your city' });

    const s = svc.rows[0];
    // ⚡ Instant Delivery shows the products of its source shops (Kirana, Vegetables…) live, plus its own
    const sourceIds = s.source_service_ids || [];
    const products = await query(
      `SELECT p.id, p.slug, p.name, p.brand, p.description, p.icon, p.image_url, p.image_credit, p.unit, p.price, p.mrp, fn_product_in_stock($2, p.id) AS in_stock,
              p.sell_by, p.note_options, p.section, p.service_id AS source_service_id
         FROM products p JOIN services ps ON ps.id = p.service_id
        WHERE p.service_id = ANY ($1::int[]) AND p.is_active AND ps.is_active
          AND ($2::int IS NULL OR fn_product_visible($2, p.id)) AND ($2::int IS NOT NULL OR NOT p.only_assigned)
        ORDER BY array_position($1::int[], p.service_id), fn_product_in_stock($2, p.id) DESC, p.sort_order, p.id`,
      [[...sourceIds, s.id], cityOf(req)]
    );
    let sources = [];
    if (sourceIds.length) {
      ({ rows: sources } = await query(
        `SELECT s.id, s.slug, s.name, s.price_on_bill, c.icon AS category_icon, c.color AS category_color
           FROM services s JOIN categories c ON c.id = s.category_id
          WHERE s.id = ANY ($1::int[]) AND s.is_active ORDER BY array_position($1::int[], s.id)`,
        [sourceIds]
      ));
    }
    res.json({ service: s, products: products.rows, sources });
  } catch (err) {
    next(err);
  }
});

export default router;
