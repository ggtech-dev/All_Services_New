import { Router } from 'express';
import { query, asActor } from '../db.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { pushTo } from '../push.js';

// Franchise admin pages (also used by the Super Admin with a franchise chosen, or all):
// my franchise, my services, requests for new services/products, complaints, messages to phones.
const router = Router();
router.use(requireAuth, requireStaff);

const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const id = (v) => (/^\d{1,9}$/.test(String(v ?? '')) ? Number(v) : null);
const text = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : null);
// Pages that only make sense for one franchise.
const needOne = (req, res) => {
  if (req.scope == null) {
    res.status(400).json({ error: 'Choose a franchise first (top of the page)' });
    return false;
  }
  return true;
};

// ---------- my franchise ----------
router.get('/me', h(async (req, res) => {
  if (!needOne(req, res)) return;
  const [{ rows: f }, { rows: s }] = await Promise.all([
    query('SELECT id, code, name, owner_name, phone, email, address, city, state, pincode, status, status_reason, registered_at FROM franchises WHERE id = $1', [req.scope]),
    query('SELECT fn_franchise_stats($1) AS s', [req.scope]),
  ]);
  res.json({ franchise: f[0], stats: s[0].s });
}));

// ---------- my services & products (switched on/off by the Super Admin; the dealer can request more) ----------
router.get('/services', h(async (req, res) => {
  if (!needOne(req, res)) return;
  const { rows } = await query('SELECT fn_franchise_services($1) AS list', [req.scope]);
  res.json(rows[0].list);
}));

router.get('/services/:sid/products', h(async (req, res) => {
  if (!needOne(req, res)) return;
  const { rows } = await query('SELECT fn_franchise_products($1, $2) AS list', [req.scope, id(req.params.sid)]);
  res.json(rows[0].list);
}));

// 🚫 out of stock in this city (stock.sql): the franchise admin's switch; HQ with a city chosen uses it too.
router.get('/out-of-stock', h(async (req, res) => {
  if (!needOne(req, res)) return;
  const { rows } = await query('SELECT fn_city_out_of_stock($1) AS list', [req.scope]);
  res.json(rows[0].list);
}));
// body: { in_stock: true|false }
router.patch('/products/:pid/stock', h(async (req, res) => {
  if (!needOne(req, res)) return;
  if (typeof req.body?.in_stock !== 'boolean') return res.status(400).json({ error: 'Choose in stock or out of stock' });
  const { rows } = await query('SELECT fn_set_city_stock($1, $2, $3, $4) AS p', [req.scope, id(req.params.pid), req.body.in_stock, req.user.id]);
  res.json(rows[0].p);
}));
// "All back in stock" — ?service=<id> for one service, else every product of the city
router.post('/restock', h(async (req, res) => {
  if (!needOne(req, res)) return;
  const { rows } = await query('SELECT fn_city_restock($1, $2, $3) AS n', [req.scope, id(req.query.service), req.user.id]);
  res.json({ restocked: rows[0].n });
}));

// Categories for the "request a new service" form.
router.get('/categories', h(async (req, res) => {
  const { rows } = await query('SELECT id, name, icon FROM categories WHERE is_active ORDER BY sort_order');
  res.json(rows);
}));

// ---------- requests ----------
router.get('/requests', h(async (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await query('SELECT fn_catalog_requests($1, $2) AS list', [req.scope, status]);
  res.json(rows[0].list);
}));

// body: { kind: service|product, service_id?, product_id?, name?, category_id?, unit?, details? }
router.post('/requests', h(async (req, res) => {
  if (req.isSuper) return res.status(400).json({ error: 'The Super Admin adds services directly in Master services' });
  // 🗺️ { kind: 'area', name, lat, lng, pincode?, village_band? } · { kind: 'area_off', locality_id } — geo.sql
  // ⭐ { kind: 'popular', service_id } · { kind: 'popular_off', popular_id } — popular.sql
  const kind = req.body?.kind;
  const fn = ['area', 'area_off'].includes(kind) ? 'fn_request_area' : ['popular', 'popular_off'].includes(kind) ? 'fn_request_popular' : 'fn_request_catalog';
  const { rows } = await asActor(req.user.id, (db) => db.query(`SELECT * FROM ${fn}($1,$2,$3)`, [req.scope, req.user.id, JSON.stringify(req.body || {})]));
  res.status(201).json(rows[0]);
}));

router.post('/requests/:rid/cancel', h(async (req, res) => {
  const { rowCount } = await asActor(req.user.id, (db) =>
    db.query("UPDATE catalog_requests SET status = 'cancelled' WHERE id = $1 AND status = 'pending' AND ($2::int IS NULL OR franchise_id = $2)", [id(req.params.rid), req.scope]));
  if (!rowCount) return res.status(404).json({ error: 'No waiting request to cancel' });
  res.status(204).end();
}));

// ---------- complaints ----------
router.get('/complaints', h(async (req, res) => {
  const status = ['open', 'in_progress', 'resolved', 'closed'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await query('SELECT fn_complaints($1, $2) AS list', [req.scope, status]);
  res.json(rows[0].list);
}));

// body: { status, reply } — the city's franchise admin answers; HQ only watches (see adminOps.js)
router.patch('/complaints/:cid', h(async (req, res) => {
  if (req.isSuper) return res.status(403).json({ error: 'HQ can view city operations only — the franchise admin of the city does this' });
  const cid = id(req.params.cid);
  if (req.scope != null) {
    const { rows } = await query('SELECT 1 FROM complaints WHERE id = $1 AND franchise_id = $2', [cid, req.scope]);
    if (!rows.length) return res.status(404).json({ error: 'Complaint not found' });
  }
  await asActor(req.user.id, (db) => db.query('CALL sp_update_complaint($1,$2,$3,$4)', [cid, text(req.body?.status, 12), text(req.body?.reply, 1000), req.user.id]));
  res.status(204).end();
}));

// ---------- messages to phones (web push) ----------
router.get('/broadcasts', h(async (req, res) => {
  const { rows } = await query(
    `SELECT b.*, f.city, u.username AS sent_by_name FROM broadcasts b LEFT JOIN franchises f ON f.id = b.franchise_id
       LEFT JOIN users u ON u.id = b.sent_by
      WHERE $1::int IS NULL OR b.franchise_id = $1 ORDER BY b.created_at DESC LIMIT 100`,
    [req.scope]
  );
  res.json(rows);
}));

// body: { audience: customers | agents | everyone, title, body, url? } — franchise admin: own city; Super Admin: chosen city or all
router.post('/broadcasts', h(async (req, res) => {
  const b = req.body || {};
  const audience = ['customers', 'agents', 'everyone'].includes(b.audience) ? b.audience : null;
  const title = (text(b.title, 80) || '').trim();
  const body = (text(b.body, 300) || '').trim();
  if (!audience || title.length < 3 || body.length < 3) return res.status(400).json({ error: 'Choose who gets it and write a title and a message' });
  const url = typeof b.url === 'string' && /^\/[\w\-/?=&#.]*$/.test(b.url) ? b.url.slice(0, 200) : '/';
  const { rows: people } = await query(
    `SELECT DISTINCT u.id FROM users u
      WHERE u.is_active AND (
        ($1 IN ('customers', 'everyone') AND u.role = 'customer'
          AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id AND o.franchise_id = $2)))
     OR ($1 IN ('agents', 'everyone') AND u.role = 'agent'
          AND EXISTS (SELECT 1 FROM agents a WHERE a.user_id = u.id AND a.status = 'active' AND ($2::int IS NULL OR a.franchise_id = $2))))`,
    [audience, req.scope]
  );
  const sent = await pushTo(people.map((p) => p.id), { title, body, url: audience === 'agents' ? '/agent' : url, tag: `msg-${Date.now()}`, kind: 'broadcast' }).catch(() => 0);
  const { rows } = await query(
    'INSERT INTO broadcasts (franchise_id, audience, title, body, url, sent_count, sent_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [req.scope, audience, title, body, url, sent, req.user.id]
  );
  res.status(201).json({ ...rows[0], people: people.length });
}));

export default router;
