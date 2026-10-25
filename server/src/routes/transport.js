import crypto from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { query, asActor } from '../db.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { UPLOAD_DIR } from './admin.js';

// 🚚 Goods Transportation (/api/transport — db/transport.sql): goods vehicles of the city. Customers see the list (the
// owner's number after a free login) and call / WhatsApp the owner directly — we only connect them. The franchise
// admin adds and changes the vehicles of their city (2–3 photos); HQ sees every city (read only).
const router = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const int = (v) => (/^\d{1,9}$/.test(String(v ?? '')) ? Number(v) : null);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const cityOf = (req) => int(req.get('x-franchise'));
const TYPES = ['ace', 'pickup', 'auto', 'dcm', 'tempo', 'tractor', 'lorry', 'other'];
const viewer = (req) => {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    return t ? jwt.verify(t, process.env.JWT_SECRET) : null;
  } catch {
    return null;
  }
};

// ?type=ace|pickup|… — the owner's number only for logged-in customers
router.get('/', h(async (req, res) => {
  const city = cityOf(req);
  if (city == null) return res.json({ counts: {}, vehicles: [], logged_in: !!viewer(req) });
  const me = viewer(req);
  const { rows } = await query('SELECT fn_transport_list($1, $2, $3) AS r', [city, TYPES.includes(req.query.type) ? req.query.type : null, !!me]);
  res.json({ ...rows[0].r, logged_in: !!me });
}));

// body: { kind: call | whatsapp } — counted for the admin, returns the owner's number
router.post('/:id/contact', requireAuth, h(async (req, res) => {
  const kind = req.body?.kind === 'whatsapp' ? 'whatsapp' : 'call';
  const { rows } = await query('SELECT fn_transport_contact($1, $2) AS phone', [int(req.params.id), kind]);
  if (!rows[0].phone) return res.status(404).json({ error: 'Vehicle not found' });
  res.json({ phone: rows[0].phone });
}));

// body: { reason: wrong_number | not_answering | bad_experience | other, note }
router.post('/:id/report', requireAuth, h(async (req, res) => {
  const reason = ['wrong_number', 'not_answering', 'bad_experience', 'other'].includes(req.body?.reason) ? req.body.reason : null;
  if (!reason) return res.status(400).json({ error: 'Choose what went wrong' });
  const id = int(req.params.id);
  if (!(await query('SELECT 1 FROM transport_vehicles WHERE id = $1', [id])).rowCount) return res.status(404).json({ error: 'Vehicle not found' });
  if ((await query(`SELECT 1 FROM transport_reports WHERE vehicle_id = $1 AND customer_id = $2 AND created_at > now() - interval '1 day'`, [id, req.user.id])).rowCount) {
    return res.status(409).json({ error: 'You already reported this vehicle today. The admin will check it.' });
  }
  await query('INSERT INTO transport_reports (vehicle_id, customer_id, reason, note) VALUES ($1, $2, $3, $4)', [id, req.user.id, reason, text(req.body?.note, 300) || null]);
  res.status(201).json({ ok: true });
}));

// ---- franchise admin: add / change vehicles, reports. HQ sees every city (read only). ----
const photos = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `vehicle-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 6 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp)$/.test(file.mimetype);
    cb(ok ? null : Object.assign(new Error('Only JPG, PNG or WEBP photos'), { status: 400 }), ok);
  },
});
// more than 3 photos (or a too-big one) → a clear message instead of an error
const upload = (req, res, next) => photos.array('photos', 3)(req, res, (err) => {
  if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Add up to 3 photos of the vehicle' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'A photo is too big (6 MB at most)' });
  next(err);
});
const admin = Router();
admin.use(requireAuth, requireStaff, (req, res, next) => {
  if (req.method !== 'GET' && req.isSuper) return res.status(403).json({ error: 'Vehicles are added by the franchise admin of each city' });
  next();
});
admin.get('/', h(async (req, res) => {
  const [list, reports] = await Promise.all([
    query(`SELECT v.*, f.city, (SELECT count(*) FROM transport_reports r WHERE r.vehicle_id = v.id AND r.status = 'open')::int AS open_reports
             FROM transport_vehicles v JOIN franchises f ON f.id = v.franchise_id
            WHERE $1::int IS NULL OR v.franchise_id = $1 ORDER BY v.is_active DESC, v.vehicle_type, v.model`, [req.scope]),
    query(`SELECT r.*, v.model, v.vehicle_number, v.owner_name, v.phone AS owner_phone, u.full_name AS customer_name, u.phone AS customer_phone
             FROM transport_reports r JOIN transport_vehicles v ON v.id = r.vehicle_id LEFT JOIN users u ON u.id = r.customer_id
            WHERE ($1::int IS NULL OR v.franchise_id = $1) ORDER BY r.status, r.created_at DESC LIMIT 200`, [req.scope]),
  ]);
  res.json({ vehicles: list.rows, reports: reports.rows, can_edit: !req.isSuper });
}));
// multipart: the fields + up to 3 new photos ("photos"); keep = JSON list of the photos already saved that stay
const save = (withId) => h(async (req, res) => {
  const id = withId ? int(req.params.id) : null;
  if (withId && req.scope != null && !(await query('SELECT 1 FROM transport_vehicles WHERE id = $1 AND franchise_id = $2', [id, req.scope])).rowCount) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }
  if (!withId && req.scope == null) return res.status(400).json({ error: 'Choose the city first' });
  const b = req.body || {};
  let keep = [];
  // uploaded photos, or our own vehicle-type photos that the sample vehicles use (files of the app itself)
  try { keep = JSON.parse(b.keep || '[]').filter((u) => typeof u === 'string' && /^\/(uploads|products\/transport)\/[\w.-]+$/.test(u)); } catch { keep = []; }
  const bool = (v) => (v === 'true' || v === true ? true : v === 'false' || v === false ? false : null);
  const p = {
    vehicle_type: text(b.vehicle_type, 10), model: text(b.model, 60), capacity: text(b.capacity, 40), body: text(b.body, 10) || 'open',
    owner_name: text(b.owner_name, 60), phone: text(b.phone, 15), vehicle_number: text(b.vehicle_number, 20), area: text(b.area, 80),
    rate_note: text(b.rate_note, 100), photos: [...keep, ...(req.files || []).map((f) => `/uploads/${f.filename}`)].slice(0, 3),
    verified: bool(b.verified), consent_recorded: bool(b.consent_recorded) === true, is_available: bool(b.is_available), is_active: bool(b.is_active),
  };
  const { rows } = await asActor(req.user.id, (db) => db.query('SELECT * FROM fn_save_vehicle($1, $2, $3, $4)', [id, withId ? null : req.scope, p, req.user.id]));
  res.status(withId ? 200 : 201).json(rows[0]);
});
admin.post('/', upload, save(false));
admin.put('/:id', upload, save(true));
admin.post('/reports/:id/close', h(async (req, res) => {
  const { rowCount } = await query(
    `UPDATE transport_reports r SET status = 'closed' FROM transport_vehicles v
      WHERE r.id = $1 AND v.id = r.vehicle_id AND ($2::int IS NULL OR v.franchise_id = $2)`, [int(req.params.id), req.scope]);
  if (!rowCount) return res.status(404).json({ error: 'Report not found' });
  res.status(204).end();
}));
router.use('/admin', admin);

export default router;
