import crypto from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { query, asActor } from '../db.js';
import { requireAuth, requireStaff, requireSuper } from '../middleware/auth.js';
import { pushTo } from '../push.js';
import { UPLOAD_DIR } from './admin.js';

// 📢 Offers near you (db/offers.sql) — local shops' offers in their city.
//   customers: /offers (live list) · /offers/:id · /offers/:id/tap · /offers/plans
//   shops (logged in): POST /offers/request (goes straight to HQ) · GET /offers/mine · POST /offers/:id/cancel
//   franchise admin: GET /offers/admin/list — their city's offers and taps (read only)
//   HQ: the requests; calls the shop, then approves with the payment / rejects, or creates an ad for a city; stops
//   an offer; plan prices per city; the free-first-offer switch
const router = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const id = (v) => (/^\d{1,9}$/.test(String(v ?? '')) ? Number(v) : null);
const cityOf = (req) => {
  const v = String(req.get('x-franchise') || '');
  return /^\d{1,9}$/.test(v) ? Number(v) : null;
};
const CATEGORIES = ['mobiles', 'jewellery', 'clothing', 'food', 'electronics', 'beauty', 'others'];

const poster = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `offer-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp)$/.test(file.mimetype);
    cb(ok ? null : Object.assign(new Error('Only JPG, PNG or WEBP photos'), { status: 400 }), ok);
  },
});
// the form fields + the uploaded poster → the JSON fn_offer_submit takes
const offerBody = (req) => ({ ...(req.body || {}), image_url: req.file ? `/uploads/${req.file.filename}` : null });

// ---------- customers ----------
router.get('/plans', h(async (req, res) => {
  const { rows } = await query("SELECT fn_offer_plans($1) AS plans, coalesce((SELECT value FROM site_settings WHERE key = 'offers_free_first'), 'off') = 'on' AS free_first",
    [cityOf(req)]);
  res.json(rows[0]);
}));

router.get('/', h(async (req, res) => {
  const city = cityOf(req);
  if (city == null) return res.json([]);
  const cat = CATEGORIES.includes(req.query.category) ? req.query.category : null;
  const { rows } = await query('SELECT fn_city_offers($1, $2) AS list', [city, cat]);
  res.json(rows[0].list);
}));

// taps are counted at most once a minute per phone / offer / kind (a refresh doesn't inflate the shop's numbers)
const recentTaps = new Map();
router.post('/:id/tap', h(async (req, res, next) => {
  const oid = id(req.params.id);
  if (oid == null) return next();
  const kind = String(req.body?.kind || '');
  const key = `${req.get('x-forwarded-for') || req.ip}|${oid}|${kind}`;
  const now = Date.now();
  if ((recentTaps.get(key) || 0) > now - 60_000) return res.status(204).end();
  recentTaps.set(key, now);
  if (recentTaps.size > 20000) for (const [k, t] of recentTaps) if (t < now - 60_000) recentTaps.delete(k);
  await query('SELECT fn_offer_tap($1, $2)', [oid, kind]);
  res.status(204).end();
}));

// ---------- shops (any logged-in customer can advertise their shop) ----------
router.get('/mine', requireAuth, h(async (req, res) => {
  const { rows } = await query('SELECT fn_my_offers($1) AS list', [req.user.id]);
  res.json(rows[0].list);
}));

router.post('/request', requireAuth, poster.single('image'), h(async (req, res) => {
  const { rows } = await query('SELECT * FROM fn_offer_submit($1, $2, $3, false)', [offerBody(req), req.user.id, cityOf(req)]);
  res.status(201).json(rows[0]);
}));

// ---------- franchise admin (read only) & HQ ----------
const staff = [requireAuth, requireStaff];
const hq = [requireAuth, requireStaff, requireSuper];
const TABS = ['requests', 'live', 'upcoming', 'ended', 'closed'];
router.get('/admin/list', ...staff, h(async (req, res) => {
  let tab = TABS.includes(req.query.tab) ? req.query.tab : req.isSuper ? 'requests' : 'live';
  if (!req.isSuper && tab === 'requests') tab = 'live'; // requests go to HQ
  const { rows } = await query('SELECT fn_offers_admin($1, $2) AS r', [req.scope, tab]);
  if (!req.isSuper) delete rows[0].r.counts.requests;
  res.json(rows[0].r);
}));
router.get('/admin/plans', ...staff, h(async (req, res) => {
  const fr = id(req.query.franchise) ?? req.scope;
  const { rows } = await query("SELECT fn_offer_plans($1) AS plans, coalesce((SELECT value FROM site_settings WHERE key = 'offers_free_first'), 'off') = 'on' AS free_first",
    [fr]);
  res.json(rows[0]);
}));
// HQ creates an ad for a city after calling the shop (live from the start date, payment recorded)
router.post('/admin', ...hq, poster.single('image'), h(async (req, res) => {
  const fr = id(req.body?.franchise_id) ?? req.scope;
  if (fr == null) return res.status(400).json({ error: 'Choose the city' });
  const { rows } = await asActor(req.user.id, (db) => db.query('SELECT * FROM fn_offer_submit($1, $2, $3, true)', [offerBody(req), req.user.id, fr]));
  res.status(201).json(rows[0]);
}));
// body: { approve: true|false, reason, payment_mode: cash|upi, paid_amount, note }
router.post('/admin/:id/decide', ...hq, h(async (req, res) => {
  const b = req.body || {};
  const approve = b.approve === true;
  const amount = b.paid_amount === '' || b.paid_amount == null || !Number.isFinite(Number(b.paid_amount)) ? null : Number(b.paid_amount);
  const { rows } = await asActor(req.user.id, (db) => db.query('SELECT * FROM fn_offer_decide($1, $2, $3, $4, $5, $6, $7)',
    [id(req.params.id), req.user.id, approve, b.reason || null, b.payment_mode || null, amount, b.note || null]));
  const o = rows[0];
  // the days as text from the database (a JS Date of a DATE can shift a day with the time zone)
  const d = (await query("SELECT to_char(starts_on, 'FMDD Mon') AS s, to_char(ends_on, 'FMDD Mon') AS e FROM local_offers WHERE id = $1", [o.id])).rows[0];
  pushTo([o.submitted_by], approve
    ? { title: '🎉 Your offer is approved', body: `“${o.title}” shows in the app from ${d.s} to ${d.e}`, url: '/my-offers', tag: `offer-${o.id}` }
    : { title: '📢 Your offer was not approved', body: o.reason || o.title, url: '/my-offers', tag: `offer-${o.id}` }).catch(() => {});
  res.json(o);
}));
router.post('/admin/:id/cancel', ...hq, h(async (req, res) => {
  const { rows } = await asActor(req.user.id, (db) => db.query('SELECT * FROM fn_offer_cancel($1, $2, NULL, NULL, $3)', [id(req.params.id), req.user.id, req.body?.reason || null]));
  const o = rows[0];
  pushTo([o.submitted_by], { title: '📢 Your offer was stopped', body: `${o.title}${o.reason ? ` — ${o.reason}` : ''}`, url: '/my-offers', tag: `offer-${o.id}` }).catch(() => {});
  res.json(o);
}));
router.get('/admin/prices', ...hq, h(async (req, res) => {
  const { rows } = await query("SELECT fn_offer_prices_all() AS cities, coalesce((SELECT value FROM site_settings WHERE key = 'offers_free_first'), 'off') = 'on' AS free_first");
  res.json(rows[0]);
}));
// body: { code, price } — price null = back to the default
router.put('/admin/prices/:franchise', ...hq, h(async (req, res) => {
  const b = req.body || {};
  const price = b.price === null || b.price === '' || b.price === undefined ? null : Number(b.price);
  if (price !== null && !Number.isFinite(price)) return res.status(400).json({ error: 'Enter a valid price' });
  await asActor(req.user.id, (db) => db.query('CALL sp_set_offer_price($1, $2, $3, $4)', [id(req.params.franchise), String(b.code || ''), price, req.user.id]));
  res.status(204).end();
}));
router.put('/admin/free-first', ...hq, h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query(
    "INSERT INTO site_settings (key, value) VALUES ('offers_free_first', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [req.body?.on ? 'on' : 'off']));
  res.status(204).end();
}));

// ---------- one offer (after the fixed paths) ----------
router.post('/:id/cancel', requireAuth, h(async (req, res, next) => {
  if (id(req.params.id) == null) return next();
  const { rows } = await query('SELECT * FROM fn_offer_cancel($1, $2, NULL, $2, $3)', [id(req.params.id), req.user.id, req.body?.reason || null]);
  res.json(rows[0]);
}));
router.get('/:id', h(async (req, res, next) => {
  const oid = id(req.params.id);
  if (oid == null) return next();
  const { rows } = await query('SELECT fn_offer_detail($1) AS o', [oid]);
  if (!rows[0].o) return res.status(404).json({ error: 'This offer has ended' });
  res.json(rows[0].o);
}));

export default router;
