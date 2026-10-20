import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { query, asActor } from '../db.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { pushTo } from '../push.js';

// 👷 Daily Workers (/api/workers) and 💡 Digital Services (/api/digital) — tables in db/more_services.sql.
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const int = (v) => (/^\d{1,9}$/.test(String(v ?? '')) ? Number(v) : null);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const cityOf = (req) => int(req.get('x-franchise'));
// the logged-in user, if a valid token was sent (lists are open to guests)
const viewer = (req) => {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    return t ? jwt.verify(t, process.env.JWT_SECRET) : null;
  } catch {
    return null;
  }
};

// ======================= 👷 Daily Workers =======================
export const workers = Router();
const WORKER_COLS = `w.id, w.tab, w.name, w.skill, w.area, w.experience_years, w.is_available, w.id_checked, f.city`;

// ?tab=construction|painters|other — the phone number only for logged-in users (free login)
workers.get('/', h(async (req, res) => {
  const me = viewer(req);
  const { rows } = await query(
    `SELECT ${WORKER_COLS}${me ? ', w.phone' : ''} FROM workers w JOIN franchises f ON f.id = w.franchise_id
      WHERE w.is_active AND f.status = 'active' AND ($1::text IS NULL OR w.tab = $1) AND ($2::int IS NULL OR w.franchise_id = $2)
      ORDER BY w.is_available DESC, w.id_checked DESC, w.experience_years DESC NULLS LAST, w.name`,
    [['construction', 'painters', 'other'].includes(req.query.tab) ? req.query.tab : null, cityOf(req)]);
  res.json({ workers: rows, logged_in: !!me });
}));

// tapping Call / WhatsApp: counted for the admin (demand), returns the number
workers.post('/:id/call', requireAuth, h(async (req, res) => {
  const { rows } = await query('UPDATE workers SET call_count = call_count + 1 WHERE id = $1 AND is_active RETURNING phone', [int(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ error: 'Worker not found' });
  res.json({ phone: rows[0].phone });
}));

// body: { reason: wrong_number | not_answering | bad_experience | other, note }
workers.post('/:id/report', requireAuth, h(async (req, res) => {
  const reason = ['wrong_number', 'not_answering', 'bad_experience', 'other'].includes(req.body?.reason) ? req.body.reason : null;
  if (!reason) return res.status(400).json({ error: 'Choose what went wrong' });
  const id = int(req.params.id);
  const { rows: w } = await query('SELECT id FROM workers WHERE id = $1', [id]);
  if (!w[0]) return res.status(404).json({ error: 'Worker not found' });
  if ((await query(`SELECT 1 FROM worker_reports WHERE worker_id = $1 AND customer_id = $2 AND created_at > now() - interval '1 day'`, [id, req.user.id])).rowCount) {
    return res.status(409).json({ error: 'You already reported this worker today. The admin will check it.' });
  }
  await query('INSERT INTO worker_reports (worker_id, customer_id, reason, note) VALUES ($1, $2, $3, $4)', [id, req.user.id, reason, text(req.body?.note, 300) || null]);
  res.status(201).json({ ok: true });
}));

// ---- franchise admin: add / change workers, reports. HQ sees every city (read only). ----
const wadmin = Router();
wadmin.use(requireAuth, requireStaff, (req, res, next) => {
  if (req.method !== 'GET' && req.isSuper) return res.status(403).json({ error: 'Daily Workers are added by the franchise admin of each city' });
  next();
});
const inScope = async (req, res, id) => {
  if (req.scope == null) return true;
  const ok = (await query('SELECT 1 FROM workers WHERE id = $1 AND franchise_id = $2', [id, req.scope])).rowCount > 0;
  if (!ok) res.status(404).json({ error: 'Worker not found' });
  return ok;
};
wadmin.get('/', h(async (req, res) => {
  const [list, reports] = await Promise.all([
    query(`SELECT w.*, f.city, (SELECT count(*) FROM worker_reports r WHERE r.worker_id = w.id AND r.status = 'open')::int AS open_reports
             FROM workers w JOIN franchises f ON f.id = w.franchise_id
            WHERE $1::int IS NULL OR w.franchise_id = $1 ORDER BY w.is_active DESC, w.tab, w.name`, [req.scope]),
    query(`SELECT r.*, w.name AS worker_name, w.phone AS worker_phone, u.full_name AS customer_name, u.phone AS customer_phone
             FROM worker_reports r JOIN workers w ON w.id = r.worker_id LEFT JOIN users u ON u.id = r.customer_id
            WHERE ($1::int IS NULL OR w.franchise_id = $1) ORDER BY r.status, r.created_at DESC LIMIT 200`, [req.scope]),
  ]);
  res.json({ workers: list.rows, reports: reports.rows, can_edit: !req.isSuper });
}));
const saveWorker = (withId) => h(async (req, res) => {
  const b = req.body || {};
  const id = withId ? int(req.params.id) : null;
  if (withId && !(await inScope(req, res, id))) return;
  const { rows } = await asActor(req.user.id, (db) => db.query('SELECT * FROM fn_save_worker($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [
    id, withId ? null : req.scope, text(b.tab, 12), text(b.name, 60), text(b.phone, 15), text(b.skill, 60), text(b.area, 80),
    b.experience_years === '' || b.experience_years == null ? null : int(b.experience_years),
    typeof b.is_available === 'boolean' ? b.is_available : null, typeof b.id_checked === 'boolean' ? b.id_checked : null,
    b.consent_recorded === true, typeof b.is_active === 'boolean' ? b.is_active : null, req.user.id,
  ]));
  res.status(withId ? 200 : 201).json(rows[0]);
});
wadmin.post('/', saveWorker(false));
wadmin.put('/:id', saveWorker(true));
wadmin.post('/reports/:id/close', h(async (req, res) => {
  const { rowCount } = await query(
    `UPDATE worker_reports r SET status = 'closed' FROM workers w
      WHERE r.id = $1 AND w.id = r.worker_id AND ($2::int IS NULL OR w.franchise_id = $2)`, [int(req.params.id), req.scope]);
  if (!rowCount) return res.status(404).json({ error: 'Report not found' });
  res.status(204).end();
}));
workers.use('/admin', wadmin);

// ======================= 💡 Digital Services =======================
export const digital = Router();
export const DIGITAL_SERVICES = {
  software: {
    title: '💻 Software & Websites',
    items: [
      ['🌐', 'Website design', 'Business, shop, school, hospital or portfolio website'],
      ['📱', 'Mobile app development', 'Android and iPhone apps'],
      ['🛒', 'Online shop / e-commerce website', 'Sell your products online'],
      ['🧾', 'Business software', 'Billing, stock, school or hospital management'],
      ['📍', 'Google Business profile & SEO', 'Be found on Google search and Maps'],
      ['📣', 'Social media marketing', 'Instagram and Facebook pages and posts'],
      ['🎨', 'Logo & branding', 'Logo, visiting card, letterhead'],
      ['✉️', 'Domain, hosting & business email', 'yourname.com, hosting, email'],
      ['💬', 'WhatsApp Business setup', 'Catalog, quick replies, business profile'],
      ['🛠️', 'Website maintenance & updates', 'Changes, fixes and updates to your website'],
    ],
  },
  video: {
    title: '🎬 Video & Creative',
    items: [
      ['📹', 'Daily vlog editing', 'Clean cuts, music and titles'],
      ['▶️', 'YouTube video editing', 'Long videos edited for YouTube'],
      ['📲', 'Reels / Shorts editing', 'Short videos for Instagram and YouTube Shorts'],
      ['🎞️', 'Short film editing', 'Story editing, colour and sound'],
      ['🎵', 'Private songs / music videos', 'Editing for album and cover songs'],
      ['💍', 'Wedding & event video editing', 'Highlights and full videos'],
      ['🖼️', 'Thumbnails, posters & flyers', 'Designs for YouTube, shops and events'],
      ['✨', 'Intro / logo animation', 'A short animated intro for your channel or brand'],
    ],
  },
};
const TIMINGS = ['As soon as possible', 'Within a week', 'Within a month', 'No hurry'];
const BUDGETS = ['Not sure', 'Below ₹5,000', '₹5,000 – ₹20,000', '₹20,000 – ₹50,000', 'Above ₹50,000'];

digital.get('/services', (req, res) => res.json({ tabs: DIGITAL_SERVICES, timings: TIMINGS, budgets: BUDGETS }));

// body: { tab, service, name, phone, details, timing, budget, link }
digital.post('/requests', requireAuth, h(async (req, res) => {
  const b = req.body || {};
  const tab = DIGITAL_SERVICES[b.tab] ? b.tab : null;
  const service = tab && DIGITAL_SERVICES[tab].items.find((i) => i[1] === b.service)?.[1];
  const phone = String(b.phone || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const link = text(b.link, 500);
  const problem = !service ? 'Choose a service'
    : text(b.name, 60).length < 2 ? 'Enter your name'
    : !/^[6-9]\d{9}$/.test(phone) ? 'Enter a valid 10-digit mobile number'
    : text(b.details, 1500).length < 10 ? 'Tell us what you need (at least a few words)'
    : !TIMINGS.includes(b.timing) ? 'When do you need it?'
    : b.budget && !BUDGETS.includes(b.budget) ? 'Choose a budget'
    : link && !/^https?:\/\/\S+$/i.test(link) ? 'The link must start with http:// or https://'
    : null;
  if (problem) return res.status(400).json({ error: problem });
  if ((await query(`SELECT count(*)::int AS n FROM digital_requests WHERE customer_id = $1 AND created_at > now() - interval '1 day'`, [req.user.id])).rows[0].n >= 5) {
    return res.status(429).json({ error: 'You sent many requests today. Our team will call you — please wait for the call.' });
  }
  const city = (await query('SELECT city FROM franchises WHERE id = $1', [cityOf(req)])).rows[0]?.city || null;
  const { rows } = await query(
    `INSERT INTO digital_requests (customer_id, tab, service, name, phone, details, timing, budget, link, city)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.user.id, tab, service, text(b.name, 60), phone, text(b.details, 1500), b.timing, b.budget || null, link || null, city]);
  // only HQ hears about it
  const hq = (await query("SELECT id FROM users WHERE role = 'superadmin' AND is_active")).rows.map((r) => r.id);
  pushTo(hq, { title: `💡 New request: ${service}`, body: `${rows[0].name} · ${phone} — ${rows[0].timing}`, url: '/super/digital', tag: `digital-${rows[0].id}` })
    .catch((e) => console.warn('notification skipped:', e.message));
  res.status(201).json(rows[0]);
}));

digital.get('/requests/mine', requireAuth, h(async (req, res) => {
  const { rows } = await query(
    `SELECT id, tab, service, details, timing, budget, status, created_at FROM digital_requests WHERE customer_id = $1 ORDER BY id DESC LIMIT 50`,
    [req.user.id]);
  res.json(rows);
}));

// ---- HQ only (franchise admins never see these) ----
const dadmin = Router();
dadmin.use(requireAuth, requireStaff, (req, res, next) => {
  if (!req.isSuper) return res.status(403).json({ error: 'Only HQ handles Digital Services requests' });
  next();
});
dadmin.get('/', h(async (req, res) => {
  const [list, counts] = await Promise.all([
    query(`SELECT d.*, u.full_name AS account_name, x.full_name AS updated_by_name FROM digital_requests d
             LEFT JOIN users u ON u.id = d.customer_id LEFT JOIN users x ON x.id = d.updated_by
            ORDER BY (d.status = 'new') DESC, d.id DESC LIMIT 500`),
    query(`SELECT count(*) FILTER (WHERE status = 'new')::int AS new,
                  count(*) FILTER (WHERE status IN ('called', 'quoted'))::int AS open,
                  count(*) FILTER (WHERE status = 'won' AND updated_at >= date_trunc('month', now()))::int AS won_month,
                  count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS this_month
             FROM digital_requests`),
  ]);
  res.json({ requests: list.rows, counts: counts.rows[0] });
}));
// body: { status, notes }
dadmin.put('/:id', h(async (req, res) => {
  const status = ['new', 'called', 'quoted', 'won', 'lost'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Choose a status' });
  const { rows } = await query(
    `UPDATE digital_requests SET status = $2, notes = $3, updated_by = $4, updated_at = now() WHERE id = $1 RETURNING *`,
    [int(req.params.id), status, text(req.body?.notes, 1000) || null, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Request not found' });
  res.json(rows[0]);
}));
digital.use('/admin', dadmin);
