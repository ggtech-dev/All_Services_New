import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { query, asActor } from '../db.js';
import { requireAuth, requireStaff, requireSuper } from '../middleware/auth.js';

// Super Admin (HQ): franchises (dealers), what each one offers, approvals, money, admins, users and platform reports.
// Day-to-day pages (orders, agents, reports…) are the /api/admin ones, used with the franchise chosen in the app.
const router = Router();
router.use(requireAuth, requireStaff, requireSuper);

const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const id = (v) => (/^\d{1,9}$/.test(String(v ?? '')) ? Number(v) : null);
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw Object.assign(new Error('Enter a valid number'), { status: 400 });
  return n;
};
const text = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : null);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// ---------- dashboard ----------
router.get('/dashboard', h(async (req, res) => {
  const { rows } = await query('SELECT fn_platform_dashboard() AS d');
  res.json(rows[0].d);
}));

// ---------- franchises ----------
router.get('/franchises', h(async (req, res) => {
  const { rows } = await query('SELECT fn_franchise_list() AS list');
  res.json(rows[0].list);
}));

// Small list for pickers (the franchise chooser at the top of the app).
router.get('/franchise-options', h(async (req, res) => {
  const { rows } = await query('SELECT id, code, name, city, status FROM franchises ORDER BY city');
  res.json(rows);
}));

// 📍 Where a franchise serves, set by HQ: centre point + range (km), village charges and — for a new franchise — its
// first areas and villages. Everything in the same transaction as the franchise itself.
//   body: { center_lat, center_lng, radius_km?, village_fee_near?, village_fee_far?,
//           areas?: [{ name, pincode?, lat, lng, is_village?, village_band? }] }
const bad = (message) => Object.assign(new Error(message), { status: 400 });
async function saveServiceZone(db, fid, b, isNew) {
  const lat = num(b.center_lat);
  const lng = num(b.center_lng);
  if ((lat == null) !== (lng == null) || (lat != null && (lat < 6 || lat > 37.5 || lng < 68 || lng > 97.5))) throw bad('Tap the map to set the centre of the city');
  if (isNew && lat == null) throw bad('Tap the map to set the centre of the city');
  const radius = b.radius_km == null || b.radius_km === '' ? null : num(b.radius_km);
  if (radius != null && (radius < 1 || radius > 100)) throw bad('Service range must be 1–100 km');
  for (const k of ['village_fee_near', 'village_fee_far']) {
    if (b[k] != null && b[k] !== '' && !(num(b[k]) >= 0)) throw bad('Village charges must be ₹0 or more');
  }
  await db.query(
    `UPDATE franchises SET center_lat = coalesce(round($2::numeric, 6), center_lat), center_lng = coalesce(round($3::numeric, 6), center_lng),
            radius_km = coalesce($4, radius_km), village_fee_near = coalesce($5, village_fee_near), village_fee_far = coalesce($6, village_fee_far)
      WHERE id = $1`,
    [fid, lat, lng, radius, b.village_fee_near === '' ? null : num(b.village_fee_near), b.village_fee_far === '' ? null : num(b.village_fee_far)]);
  if (!isNew || !Array.isArray(b.areas)) return;
  if (b.areas.length > 100) throw bad('Add up to 100 areas here; more later in Areas');
  const { rows: f } = await db.query('SELECT city, radius_km FROM franchises WHERE id = $1', [fid]);
  for (const a of b.areas) {
    const name = typeof a?.name === 'string' ? a.name.trim() : '';
    const km = await db.query('SELECT fn_distance_km(center_lat, center_lng, $2, $3) AS km FROM franchises WHERE id = $1', [fid, num(a?.lat), num(a?.lng)]);
    if (num(a?.lat) != null && Number(km.rows[0].km) > Number(f[0].radius_km)) {
      throw bad(`${name || 'An area'} is ${km.rows[0].km} km from the centre — outside the ${Number(f[0].radius_km)} km range`);
    }
    await db.query('SELECT fn_save_locality(NULL,$1,$2,$3,$4,true,$5,$6,$7)', [
      name || null, typeof a?.pincode === 'string' ? a.pincode : null, num(a?.lat), num(a?.lng), fid, a?.is_village === true,
      a?.is_village === true ? num(a?.village_band) : null]);
  }
}

// body: dealer details + first admin login { admin_username, admin_password, admin_name, admin_phone, admin_email }
//       + service zone (saveServiceZone)
router.post('/franchises', h(async (req, res) => {
  const b = req.body || {};
  const fr = await asActor(req.user.id, async (db) => {
    const { rows } = await db.query('SELECT * FROM fn_save_franchise(NULL, $1)', [JSON.stringify(b)]);
    await saveServiceZone(db, rows[0].id, b, true);
    if (b.admin_username) await createAdmin(db, rows[0].id, b.admin_username, b.admin_password, b.admin_name, b.admin_phone, b.admin_email);
    return (await db.query('SELECT * FROM franchises WHERE id = $1', [rows[0].id])).rows[0];
  });
  res.status(201).json(fr);
}));

router.get('/franchises/:id', h(async (req, res) => {
  const fid = id(req.params.id);
  const { rows } = await query('SELECT * FROM franchises WHERE id = $1', [fid]);
  if (!rows[0]) return res.status(404).json({ error: 'Franchise not found' });
  const [{ rows: stats }, { rows: admins }, { rows: areas }, { rows: docs }, { rows: ledger }] = await Promise.all([
    query('SELECT fn_franchise_stats($1) AS s', [fid]),
    query(`SELECT id, username, full_name, phone, email, is_active, created_at FROM users WHERE role = 'admin' AND franchise_id = $1 ORDER BY id`, [fid]),
    query('SELECT fn_admin_localities($1) AS list', [fid]),
    query('SELECT id, label, uploaded_at FROM franchise_documents WHERE franchise_id = $1 ORDER BY uploaded_at DESC', [fid]),
    query(`SELECT l.*, u.username AS created_by_name FROM franchise_ledger l LEFT JOIN users u ON u.id = l.created_by
            WHERE l.franchise_id = $1 ORDER BY l.entry_date DESC, l.id DESC LIMIT 200`, [fid]),
  ]);
  res.json({ franchise: rows[0], stats: stats[0].s, admins, areas: areas[0].list, documents: docs, ledger });
}));

router.put('/franchises/:id', h(async (req, res) => {
  const fid = id(req.params.id);
  const fr = await asActor(req.user.id, async (db) => {
    await db.query('SELECT * FROM fn_save_franchise($1, $2)', [fid, JSON.stringify(req.body || {})]);
    await saveServiceZone(db, fid, req.body || {}, false); // centre, range, village charges (areas: the Areas page)
    return (await db.query('SELECT * FROM franchises WHERE id = $1', [fid])).rows[0];
  });
  res.json(fr);
}));

// Work still open in a city — shown before HQ disables or suspends it (nobody but its admin can handle these orders).
router.get('/franchises/:id/open-work', h(async (req, res) => {
  const fid = id(req.params.id);
  const { rows } = await query(
    `SELECT (SELECT count(*) FROM orders WHERE franchise_id = $1 AND status = 'placed')::int AS waiting,
            (SELECT count(*) FROM orders WHERE franchise_id = $1 AND status IN ('assigned', 'picked_up'))::int AS on_the_way,
            (SELECT count(*) FROM v_agents WHERE franchise_id = $1 AND state = 'busy')::int AS agents_busy,
            (SELECT count(*) FROM v_agents WHERE franchise_id = $1 AND state IN ('free', 'busy'))::int AS agents_online,
            (SELECT count(*) FROM ride_bookings b JOIN share_rides r ON r.id = b.ride_id
              WHERE r.franchise_id = $1 AND r.depart_at > now() AND b.status IN ('held', 'paid', 'confirmed'))::int AS ride_bookings`,
    [fid]
  );
  res.json(rows[0]);
}));

// body: { status: active | disabled | suspended | pending, reason }
router.patch('/franchises/:id/status', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_set_franchise_status($1,$2,$3)', [id(req.params.id), text(req.body?.status, 12), text(req.body?.reason)]));
  res.status(204).end();
}));

// Full report of one franchise for a period: ?from&to (IST dates)
router.get('/franchises/:id/report', h(async (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'Choose a valid date range' });
  const fid = id(req.params.id);
  const [{ rows: s }, { rows: r }] = await Promise.all([
    query('SELECT fn_franchise_stats($1, $2::date, $3::date) AS s', [fid, from, to]),
    query('SELECT fn_report($1::date, $2::date, $3) AS r', [from, to, fid]),
  ]);
  res.json({ stats: s[0].s, report: r[0].r });
}));

// Customers of a franchise (people who ordered there).
router.get('/franchises/:id/users', h(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.username, u.full_name, u.phone, u.email, u.is_active, u.created_at,
            count(o.id)::int AS orders, count(o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered,
            coalesce(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) AS spent, max(o.created_at) AS last_order
       FROM users u JOIN orders o ON o.customer_id = u.id AND o.franchise_id = $1
      GROUP BY u.id ORDER BY max(o.created_at) DESC LIMIT 500`,
    [id(req.params.id)]
  );
  res.json(rows);
}));

// ---------- what a franchise offers ----------
router.get('/franchises/:id/services', h(async (req, res) => {
  const { rows } = await query('SELECT fn_franchise_services($1) AS list', [id(req.params.id)]);
  res.json(rows[0].list);
}));

router.patch('/franchises/:id/services/:sid', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_set_franchise_service($1,$2,$3)', [id(req.params.id), id(req.params.sid), req.body?.enabled !== false]));
  res.status(204).end();
}));

router.get('/franchises/:id/services/:sid/products', h(async (req, res) => {
  const { rows } = await query('SELECT fn_franchise_products($1, $2) AS list', [id(req.params.id), id(req.params.sid)]);
  res.json(rows[0].list);
}));

router.patch('/franchises/:id/products/:pid', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_set_franchise_product($1,$2,$3)', [id(req.params.id), id(req.params.pid), req.body?.enabled !== false]));
  res.status(204).end();
}));

// A master service for every franchise at once.
router.post('/services/:sid/assign-all', h(async (req, res) => {
  const { rows } = await asActor(req.user.id, (db) => db.query('SELECT fn_assign_service_to_all($1) AS n', [id(req.params.sid)]));
  res.json({ franchises: rows[0].n });
}));

// Which franchises have each service (for the master services page).
router.get('/service-coverage', h(async (req, res) => {
  const { rows } = await query(
    `SELECT s.id, count(fs.*) FILTER (WHERE fs.is_enabled)::int AS franchises
       FROM services s LEFT JOIN franchise_services fs ON fs.service_id = s.id GROUP BY s.id`
  );
  res.json(Object.fromEntries(rows.map((r) => [r.id, r.franchises])));
}));

// ---------- requests & approvals ----------
router.get('/requests', h(async (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await query('SELECT fn_catalog_requests($1, $2) AS list', [id(req.query.franchise), status]);
  res.json(rows[0].list);
}));

router.post('/requests/:rid/approve', h(async (req, res) => {
  // services / products, or a new area / village (or switching one off) — geo.sql
  const { rows } = await asActor(req.user.id, (db) => db.query('SELECT * FROM fn_approve_request($1,$2,$3)', [id(req.params.rid), req.user.id, text(req.body?.note)]));
  res.json(rows[0]);
}));

router.post('/requests/:rid/reject', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_reject_catalog_request($1,$2,$3)', [id(req.params.rid), req.user.id, text(req.body?.note)]));
  res.status(204).end();
}));

// ---------- money (entered by hand) ----------
router.get('/ledger', h(async (req, res) => {
  const { rows } = await query(
    `SELECT l.*, f.code AS franchise_code, f.name AS franchise_name, u.username AS created_by_name
       FROM franchise_ledger l JOIN franchises f ON f.id = l.franchise_id LEFT JOIN users u ON u.id = l.created_by
      WHERE $1::int IS NULL OR l.franchise_id = $1
      ORDER BY l.entry_date DESC, l.id DESC LIMIT 500`,
    [id(req.query.franchise)]
  );
  const { rows: m } = await query('SELECT fn_franchise_money($1) AS m', [id(req.query.franchise)]);
  res.json({ entries: rows, totals: m[0].m });
}));

// body: { type: commission | payment | expense | adjustment, amount, date, reference, note }
router.post('/franchises/:id/ledger', h(async (req, res) => {
  const b = req.body || {};
  const { rows } = await asActor(req.user.id, (db) =>
    db.query('SELECT * FROM fn_add_ledger_entry($1,$2,$3,$4,$5,$6,$7)', [
      id(req.params.id), text(b.type, 12), num(b.amount), isDate(b.date) ? b.date : null, text(b.reference, 60), text(b.note), req.user.id,
    ])
  );
  res.status(201).json(rows[0]);
}));

router.delete('/ledger/:lid', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('DELETE FROM franchise_ledger WHERE id = $1', [id(req.params.lid)]));
  res.status(204).end();
}));

// ---------- dealer documents (private files) ----------
const DOCS = path.resolve(import.meta.dirname, '../../private_uploads/franchise');
mkdirSync(DOCS, { recursive: true });
const docUpload = multer({
  storage: multer.diskStorage({
    destination: DOCS,
    filename: (req, file, cb) => cb(null, `fr-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.mimetype);
    cb(ok ? null : Object.assign(new Error('Documents must be JPG, PNG, WEBP or PDF'), { status: 400 }), ok);
  },
}).single('file');

router.post('/franchises/:id/documents', docUpload, h(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a file' });
  const label = (text(req.body?.label, 80) || '').trim();
  if (!label) {
    await unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Write what this document is (e.g. Agreement, GST certificate)' });
  }
  try {
    const { rows } = await query(
      'INSERT INTO franchise_documents (franchise_id, label, file, uploaded_by) VALUES ($1,$2,$3,$4) RETURNING id, label, uploaded_at',
      [id(req.params.id), label, req.file.filename, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    await unlink(req.file.path).catch(() => {});
    throw err;
  }
}));

router.get('/documents/:did', h(async (req, res) => {
  const { rows } = await query('SELECT file FROM franchise_documents WHERE id = $1', [id(req.params.did)]);
  if (!rows[0]) return res.status(404).json({ error: 'Document not found' });
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(path.join(DOCS, path.basename(rows[0].file)));
}));

router.delete('/documents/:did', h(async (req, res) => {
  const { rows } = await query('DELETE FROM franchise_documents WHERE id = $1 RETURNING file', [id(req.params.did)]);
  if (rows[0]) await unlink(path.join(DOCS, path.basename(rows[0].file))).catch(() => {});
  res.status(204).end();
}));

// ---------- franchise admins ----------
async function createAdmin(db, franchiseId, username, password, fullName, phone, email) {
  const u = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,30}$/.test(u)) throw Object.assign(new Error('Admin username must be 3-30 letters, numbers, _ or .'), { status: 400 });
  if (String(password || '').length < 8) throw Object.assign(new Error('Admin password must be at least 8 characters'), { status: 400 });
  if (!String(fullName || '').trim()) throw Object.assign(new Error("Enter the admin's name"), { status: 400 });
  try {
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, full_name, phone, email, role, franchise_id)
       VALUES ($1, $2, $3, nullif($4, ''), nullif(lower($5), ''), 'admin', $6) RETURNING id, username, full_name, phone, email, franchise_id, is_active`,
      [u, await bcrypt.hash(String(password), 10), String(fullName).trim().slice(0, 100), String(phone || '').replace(/\D/g, '').slice(-10),
        String(email || '').trim().slice(0, 120), franchiseId]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw Object.assign(new Error('That username or email is already used'), { status: 409 });
    throw err;
  }
}

router.get('/admins', h(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.username, u.full_name, u.phone, u.email, u.is_active, u.created_at, u.franchise_id, f.code AS franchise_code,
            f.name AS franchise_name, f.city,
            (SELECT max(created_at) FROM auth_audit_log a WHERE a.user_id = u.id AND a.event = 'login') AS last_login
       FROM users u LEFT JOIN franchises f ON f.id = u.franchise_id
      WHERE u.role = 'admin' AND ($1::int IS NULL OR u.franchise_id = $1)
      ORDER BY f.city NULLS LAST, u.full_name`,
    [id(req.query.franchise)]
  );
  res.json(rows);
}));

router.post('/admins', h(async (req, res) => {
  const b = req.body || {};
  if (!id(b.franchise_id)) return res.status(400).json({ error: 'Choose the franchise' });
  const admin = await asActor(req.user.id, (db) => createAdmin(db, id(b.franchise_id), b.username, b.password, b.full_name, b.phone, b.email));
  res.status(201).json(admin);
}));

// body: { is_active?, password?, franchise_id? }
router.patch('/admins/:aid', h(async (req, res) => {
  const b = req.body || {};
  const aid = id(req.params.aid);
  const { rows } = await query("SELECT id FROM users WHERE id = $1 AND role = 'admin'", [aid]);
  if (!rows[0]) return res.status(404).json({ error: 'Admin not found' });
  if (b.password != null && String(b.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  await asActor(req.user.id, async (db) => {
    if (typeof b.is_active === 'boolean') await db.query('UPDATE users SET is_active = $2 WHERE id = $1', [aid, b.is_active]);
    if (id(b.franchise_id)) await db.query('UPDATE users SET franchise_id = $2 WHERE id = $1', [aid, id(b.franchise_id)]);
    if (b.password != null) await db.query('CALL sp_set_password($1,$2,$3,$4)', [aid, await bcrypt.hash(String(b.password), 10), 'reset by Super Admin', null]);
  });
  res.status(204).end();
}));

// ---------- customers (all) ----------
router.get('/users', h(async (req, res) => {
  const q = text(req.query.q, 60)?.trim() || null;
  const { rows } = await query(
    `SELECT u.id, u.username, u.full_name, u.phone, u.email, u.is_active, u.created_at,
            count(o.id)::int AS orders, coalesce(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) AS spent,
            max(o.created_at) AS last_order,
            (SELECT f.city FROM orders o2 JOIN franchises f ON f.id = o2.franchise_id WHERE o2.customer_id = u.id ORDER BY o2.created_at DESC LIMIT 1) AS city
       FROM users u LEFT JOIN orders o ON o.customer_id = u.id
      WHERE u.role = 'customer'
        AND ($1::text IS NULL OR u.username ILIKE '%' || $1 || '%' OR u.full_name ILIKE '%' || $1 || '%' OR u.phone LIKE '%' || $1 || '%'
             OR u.email ILIKE '%' || $1 || '%')
        AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM orders x WHERE x.customer_id = u.id AND x.franchise_id = $2))
      GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500`,
    [q, id(req.query.franchise)]
  );
  res.json(rows);
}));

router.patch('/users/:uid/active', h(async (req, res) => {
  const { rowCount } = await asActor(req.user.id, (db) =>
    db.query("UPDATE users SET is_active = $2 WHERE id = $1 AND role = 'customer'", [id(req.params.uid), req.body?.is_active !== false]));
  if (!rowCount) return res.status(404).json({ error: 'Customer not found' });
  res.status(204).end();
}));

// ---------- platform reports ----------
// ?from&to&franchise (optional) → totals + per-franchise table + the detailed report
router.get('/reports', h(async (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'Choose a valid date range' });
  const fid = id(req.query.franchise);
  const [{ rows: totals }, { rows: per }, { rows: detail }] = await Promise.all([
    query('SELECT fn_franchise_stats($1, $2::date, $3::date) AS s', [fid, from, to]),
    query(
      `SELECT f.id, f.code, f.name, f.city, f.status, fn_franchise_stats(f.id, $1::date, $2::date) AS s
         FROM franchises f WHERE $3::int IS NULL OR f.id = $3 ORDER BY f.code`,
      [from, to, fid]
    ),
    query('SELECT fn_report($1::date, $2::date, $3) AS r', [from, to, fid]),
  ]);
  // services and products: what sells, per franchise
  const { rows: services } = await query(
    `SELECT s.name AS service, c.icon, f.city, count(DISTINCT o.id)::int AS orders,
            count(DISTINCT o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered
       FROM orders o JOIN franchises f ON f.id = o.franchise_id
       JOIN order_items i ON i.order_id = o.id LEFT JOIN products p ON p.id = i.product_id
       JOIN services s ON s.id = coalesce(o.via_service_id, i.service_id, p.service_id) JOIN categories c ON c.id = s.category_id
      WHERE (o.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date AND ($3::int IS NULL OR o.franchise_id = $3)
      GROUP BY s.id, s.name, c.icon, f.city ORDER BY count(DISTINCT o.id) DESC LIMIT 50`,
    [from, to, fid]
  );
  res.json({ totals: totals[0].s, franchises: per.map((r) => ({ ...r, ...r.s, s: undefined })), report: detail[0].r, services });
}));

export default router;
