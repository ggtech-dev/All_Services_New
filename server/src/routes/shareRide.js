import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { query, asActor } from '../db.js';
import { requireAuth, requireRole, requireStaff } from '../middleware/auth.js';
import { DOC_DIR, removeFiles } from './agent.js';
import { pushTo } from '../push.js';
import { ticketPdf, upiLink } from '../ticket.js';

// 🚗 Share Ride — seats in commercial cars between towns (logic in db/share_ride.sql).
//   /api/share-ride/…          customers (search is open to guests; booking needs a login)
//   /api/share-ride/owner/…    car owners (agents with the shared_car_agent type)
//   /api/share-ride/admin/…    franchise admins (their city); the Super Admin watches all cities
const router = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const int = (v) => (/^\d{1,9}$/.test(String(v ?? '')) ? Number(v) : null);
const quiet = (p) => p.catch((err) => console.warn('notification skipped:', err.message));
const expire = () => query('CALL sp_ride_expire_holds()');

// ---------- car documents (private, admins only) ----------
export const CAR_DOCS = ['rc_doc', 'permit_doc', 'insurance_doc', 'car_photo'];
const carDocUpload = multer({
  storage: multer.diskStorage({
    destination: DOC_DIR,
    filename: (req, file, cb) =>
      cb(null, `${file.fieldname}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.mimetype);
    cb(ok ? null : Object.assign(new Error('Documents must be JPG, PNG, WEBP or PDF'), { status: 400 }), ok);
  },
}).fields(CAR_DOCS.map((name) => ({ name, maxCount: 1 })));

// Adds a car (from the owner's app or the agent application). Files are removed again when it fails.
export async function addCar(ownerId, req, actorId = ownerId) {
  const b = req.body || {};
  const doc = (name) => req.files?.[name]?.[0]?.filename ?? null;
  try {
    return await asActor(actorId, async (db) => (await db.query('SELECT * FROM fn_add_car($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      ownerId, int(b.car_model_id), b.reg_number || '', b.car_color || '', b.yellow_board === 'true' || b.yellow_board === true,
      doc('rc_doc'), doc('permit_doc'), doc('insurance_doc'), doc('car_photo'),
    ])).rows[0]);
  } catch (err) {
    await removeFiles(Object.fromEntries(CAR_DOCS.map((k) => [k, req.files?.[k]]).filter(([, v]) => v)));
    throw err;
  }
}

// ======================= customers =======================

router.get('/places', h(async (req, res) => {
  const { rows } = await query('SELECT name FROM share_places WHERE is_active ORDER BY name');
  res.json(rows.map((r) => r.name));
}));

router.get('/models', h(async (req, res) => {
  const { rows } = await query('SELECT id, name, layout FROM car_models WHERE is_active ORDER BY name');
  res.json(rows);
}));

// ?from=Siddipet&to=Hyderabad&date=2026-10-20&passengers=2&size=7&max_price=400
router.get('/search', h(async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Choose From and To' });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : null;
  await expire();
  const { rows } = await query('SELECT fn_search_rides($1,$2,$3,$4,$5,$6) AS list', [
    String(from).slice(0, 60), String(to).slice(0, 60), date, int(req.query.passengers) || 1, int(req.query.size), int(req.query.max_price),
  ]);
  res.json(rows[0].list);
}));

router.get('/rides/:id', h(async (req, res) => {
  await expire();
  const { rows } = await query('SELECT fn_ride_detail($1) AS r', [int(req.params.id)]);
  const r = rows[0]?.r;
  if (!r) return res.status(404).json({ error: 'Journey not found' });
  delete r.owner_id;
  delete r.franchise_id;
  res.json(r);
}));

// body: { passengers: [{ seat, name }], phone, pickup, drop, pay_mode: 'upi' | 'cash', agree: true }
router.post('/rides/:id/book', requireAuth, requireRole('customer'), h(async (req, res) => {
  const b = req.body || {};
  const passengers = Array.isArray(b.passengers)
    ? b.passengers.slice(0, 10).map((p) => ({ seat: String(p?.seat ?? '').slice(0, 8), name: String(p?.name ?? '').slice(0, 60) }))
    : null;
  const booking = await asActor(req.user.id, async (db) => (await db.query('SELECT * FROM fn_book_ride($1,$2,$3,$4,$5,$6,$7,$8)', [
    req.user.id, int(req.params.id), JSON.stringify(passengers), String(b.phone ?? ''), String(b.pickup ?? ''), String(b.drop ?? ''),
    String(b.pay_mode ?? ''), b.agree === true,
  ])).rows[0]);
  const { rows } = await query('SELECT owner_id, from_place, to_place FROM share_rides WHERE id = $1', [booking.ride_id]);
  if (booking.status === 'confirmed') {
    quiet(pushTo([rows[0].owner_id], {
      title: `🎫 ${booking.seats.length} seat${booking.seats.length > 1 ? 's' : ''} booked — ${rows[0].from_place} → ${rows[0].to_place}`,
      body: `${booking.code}: cash ₹${Number(booking.amount)} at pickup (${booking.pickup_point})`, url: '/agent/share-ride', tag: `ride-${booking.ride_id}`,
    }));
  }
  res.status(201).json(booking);
}));

// The customer's bookings, newest first.
router.get('/bookings', requireAuth, h(async (req, res) => {
  await expire();
  const { rows } = await query(
    `SELECT fn_ride_booking(b.id) AS b FROM ride_bookings b JOIN share_rides r ON r.id = b.ride_id
      WHERE b.customer_id = $1 ORDER BY (r.depart_at > now()) DESC, r.depart_at, b.id DESC LIMIT 50`, [req.user.id]);
  res.json(rows.map((r) => r.b));
}));

// One booking for the customer who made it, the car owner, or an admin of that city.
async function loadBooking(req, res) {
  await expire();
  const { rows } = await query('SELECT fn_ride_booking($1) AS b', [int(req.params.id)]);
  const b = rows[0]?.b;
  if (!b) {
    res.status(404).json({ error: 'Booking not found' });
    return null;
  }
  if (b.customer_id === req.user.id || b.owner_id === req.user.id) return b;
  const { rows: u } = await query(
    `SELECT u.role, u.franchise_id, r.franchise_id AS ride_franchise FROM users u, share_rides r WHERE u.id = $1 AND r.id = $2`,
    [req.user.id, b.ride_id]);
  if (u[0]?.role === 'superadmin' || (u[0]?.role === 'admin' && u[0].franchise_id === u[0].ride_franchise)) return b;
  res.status(404).json({ error: 'Booking not found' });
  return null;
}

router.get('/bookings/:id', requireAuth, h(async (req, res) => {
  const b = await loadBooking(req, res);
  if (!b) return;
  if (b.customer_id === req.user.id && b.status === 'held' && b.ride.upi_id) {
    b.upi_link = upiLink(b);
    b.upi_qr = await QRCode.toString(b.upi_link, { type: 'svg', margin: 1, width: 220 });
  }
  if (b.customer_id !== req.user.id) b.contact_phone_shown = b.contact_phone;
  res.json(b);
}));

// Paid by UPI: body { utr } → the owner is asked to check it.
router.post('/bookings/:id/paid', requireAuth, h(async (req, res) => {
  const b = await asActor(req.user.id, async (db) =>
    (await db.query('SELECT * FROM fn_ride_paid($1,$2,$3)', [req.user.id, int(req.params.id), String(req.body?.utr ?? '')])).rows[0]);
  const { rows } = await query('SELECT owner_id, from_place, to_place FROM share_rides WHERE id = $1', [b.ride_id]);
  quiet(pushTo([rows[0].owner_id], {
    title: `💰 Check payment ₹${Number(b.amount)} — ${b.code}`,
    body: `UPI ref ${b.utr} · ${rows[0].from_place} → ${rows[0].to_place}. Tap "Payment received" when you see it.`,
    url: '/agent/share-ride', tag: `booking-${b.id}`,
  }));
  res.json(b);
}));

// Leave a booking before paying (seats go back).
router.post('/bookings/:id/leave', requireAuth, h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_ride_leave($1,$2)', [req.user.id, int(req.params.id)]));
  res.status(204).end();
}));

// 🎫 The PDF ticket — only for a confirmed booking.
router.get('/bookings/:id/ticket.pdf', requireAuth, h(async (req, res) => {
  const b = await loadBooking(req, res);
  if (!b) return;
  if (b.status !== 'confirmed') return res.status(409).json({ error: 'The ticket is ready once the car owner confirms your payment' });
  const pdf = await ticketPdf(b);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${b.code}.pdf"`, 'Cache-Control': 'private, no-store' });
  res.send(pdf);
}));

// ======================= car owners =======================
const owner = Router();
owner.use(requireAuth, requireRole('agent'), h(async (req, res, next) => {
  const { rows } = await query('SELECT status, skills FROM agents WHERE user_id = $1', [req.user.id]);
  if (rows[0]?.status !== 'active') return res.status(403).json({ error: 'Your agent account is not active' });
  if (!rows[0].skills.includes('shared_car_agent')) return res.status(403).json({ error: 'Share Ride is for car owners. Ask your franchise admin to add "Share Ride car owners" to your types of work.' });
  next();
}));

// Everything for the owner's Share Ride page.
owner.get('/', h(async (req, res) => {
  await expire();
  const id = req.user.id;
  const [cars, rides, bookings, blocker, last, sub] = await Promise.all([
    query(`SELECT c.id, c.reg_number, c.color, c.status, c.status_reason, c.created_at, m.id AS model_id, m.name AS model, m.layout
             FROM shared_cars c JOIN car_models m ON m.id = c.model_id WHERE c.owner_id = $1 ORDER BY c.status = 'approved' DESC, c.id DESC`, [id]),
    query(`SELECT fn_ride_detail(r.id) AS r FROM share_rides r WHERE r.owner_id = $1 AND (r.depart_at > now() - interval '1 day')
            ORDER BY r.depart_at LIMIT 40`, [id]),
    query(`SELECT fn_ride_booking(b.id) AS b FROM ride_bookings b JOIN share_rides r ON r.id = b.ride_id
            WHERE r.owner_id = $1 AND r.depart_at > now() - interval '1 day' AND b.status IN ('held', 'paid', 'confirmed', 'cancelled', 'rejected')
            ORDER BY b.id DESC LIMIT 300`, [id]),
    query('SELECT fn_owner_blocker($1) AS why', [id]),
    query(`SELECT from_place, to_place, pickup_points, drop_points, row_prices, upi_id, allow_cash, car_id
             FROM share_rides WHERE owner_id = $1 ORDER BY id DESC LIMIT 1`, [id]),
    query(`SELECT s.status, s.paid_until FROM agent_subscriptions s WHERE s.agent_id = $1 AND s.service_id = fn_share_ride_service()`, [id]),
  ]);
  res.json({
    cars: cars.rows, rides: rides.rows.map((r) => r.r), bookings: bookings.rows.map((r) => r.b),
    hidden_reason: blocker.rows[0].why, last: last.rows[0] || null, subscription: sub.rows[0] || null,
  });
}));

owner.post('/cars', carDocUpload, h(async (req, res) => {
  res.status(201).json(await addCar(req.user.id, req));
}));

// body: { car_id, from, to, depart_at (ISO), pickups[], drops[], prices[], blocked[], upi_id, allow_cash, notes }
owner.post('/rides', h(async (req, res) => {
  const b = req.body || {};
  const list = (v, n = 10) => (Array.isArray(v) ? v.slice(0, n).map((x) => String(x ?? '').slice(0, 80)) : []);
  const depart = new Date(String(b.depart_at || ''));
  if (Number.isNaN(depart.getTime())) return res.status(400).json({ error: 'Choose the departure date and time' });
  const prices = Array.isArray(b.prices) ? b.prices.slice(0, 8).map((p) => (p === '' || p == null || !Number.isFinite(Number(p)) ? null : Number(p))) : [];
  const ride = await asActor(req.user.id, async (db) => (await db.query('SELECT * FROM fn_create_ride($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [
    req.user.id, int(b.car_id), String(b.from ?? ''), String(b.to ?? ''), depart.toISOString(), list(b.pickups), list(b.drops),
    prices, list(b.blocked, 30), String(b.upi_id ?? ''), b.allow_cash === true, String(b.notes ?? ''),
  ])).rows[0]);
  res.status(201).json(ride);
}));

owner.post('/rides/:id/cancel', h(async (req, res) => {
  const ride = int(req.params.id);
  const customers = await asActor(req.user.id, async (db) =>
    (await db.query('SELECT fn_cancel_ride($1,$2,$3) AS c', [req.user.id, ride, String(req.body?.reason ?? '')])).rows[0].c);
  quiet(pushTo(customers, {
    title: '❌ Your Share Ride journey was cancelled by the car owner',
    body: `Reason: ${String(req.body?.reason ?? '').slice(0, 120)}. If you paid, the owner returns your money — call them from your ticket.`,
    url: '/share-ride/tickets', tag: `ride-${ride}`,
  }));
  res.status(204).end();
}));

// body: { received: bool, reason? }
owner.post('/bookings/:id/decide', h(async (req, res) => {
  const b = await asActor(req.user.id, async (db) => (await db.query('SELECT * FROM fn_ride_owner_decide($1,$2,$3,$4)', [
    req.user.id, int(req.params.id), req.body?.received === true, String(req.body?.reason ?? ''),
  ])).rows[0]);
  quiet(pushTo([b.customer_id], b.status === 'confirmed'
    ? { title: `✅ Seats confirmed — ${b.code}`, body: 'Your payment is received. Your ticket is ready to download.', url: `/share-ride/booking/${b.id}`, tag: `booking-${b.id}` }
    : { title: `⚠️ Payment not received — ${b.code}`, body: b.status_reason || 'The car owner did not receive your payment.', url: `/share-ride/booking/${b.id}`, tag: `booking-${b.id}` }));
  res.json(b);
}));
router.use('/owner', owner);

// ======================= franchise admins (HQ watches) =======================
const admin = Router();
admin.use(requireAuth, requireStaff);
// HQ sees every city but changes nothing; car models and towns are shared lists any admin can add to.
admin.use((req, res, next) => {
  if (req.method !== 'GET' && req.isSuper && !/^\/(models|places)/.test(req.path)) {
    return res.status(403).json({ error: 'Share Ride cars and journeys are managed by the franchise admin of each city' });
  }
  next();
});
const inScope = async (req, res, sql, id) => {
  if (req.scope == null) return true;
  const { rows } = await query(sql, [id, req.scope]);
  if (!rows.length) res.status(404).json({ error: 'Not found' });
  return rows.length > 0;
};

admin.get('/', h(async (req, res) => {
  await expire();
  const s = req.scope;
  const [cars, rides, bookings, models, places, counts] = await Promise.all([
    query(`SELECT c.id, c.reg_number, c.color, c.status, c.status_reason, c.created_at, c.reviewed_at, c.franchise_id,
                  m.name AS model, u.id AS owner_id, u.full_name AS owner_name, u.phone AS owner_phone, a.status AS owner_status,
                  f.city, fn_owner_blocker(u.id) AS hidden_reason,
                  (c.rc_doc IS NOT NULL) AS has_rc, (c.permit_doc IS NOT NULL) AS has_permit,
                  (c.insurance_doc IS NOT NULL) AS has_insurance, (c.car_photo IS NOT NULL) AS has_photo
             FROM shared_cars c JOIN car_models m ON m.id = c.model_id JOIN users u ON u.id = c.owner_id
             LEFT JOIN agents a ON a.user_id = u.id LEFT JOIN franchises f ON f.id = c.franchise_id
            WHERE ($1::int IS NULL OR c.franchise_id = $1)
            ORDER BY array_position(ARRAY['pending','approved','rejected','removed'], c.status::text), c.id DESC`, [s]),
    query(`SELECT r.id, r.from_place, r.to_place, r.depart_at, r.status, r.cancel_reason, r.franchise_id, c.reg_number, m.name AS model,
                  u.full_name AS owner_name, u.phone AS owner_phone,
                  (SELECT count(*) FROM fn_layout_seats(r.layout))::int AS seats,
                  (SELECT count(*) FROM ride_booking_seats bs JOIN ride_bookings b ON b.id = bs.booking_id
                    WHERE bs.ride_id = r.id AND b.status = 'confirmed')::int AS booked,
                  (SELECT count(*) FROM ride_bookings b WHERE b.ride_id = r.id AND b.status = 'paid')::int AS waiting
             FROM share_rides r JOIN shared_cars c ON c.id = r.car_id JOIN car_models m ON m.id = c.model_id JOIN users u ON u.id = r.owner_id
            WHERE ($1::int IS NULL OR r.franchise_id = $1) AND r.depart_at > now() - interval '7 days'
            ORDER BY r.depart_at DESC LIMIT 200`, [s]),
    query(`SELECT b.id, b.code, b.status, b.amount, b.pay_mode, b.seats, b.created_at, b.utr, r.from_place, r.to_place, r.depart_at,
                  cu.full_name AS customer_name, b.contact_phone, o.full_name AS owner_name
             FROM ride_bookings b JOIN share_rides r ON r.id = b.ride_id JOIN users cu ON cu.id = b.customer_id JOIN users o ON o.id = r.owner_id
            WHERE ($1::int IS NULL OR r.franchise_id = $1) AND b.created_at > now() - interval '30 days'
            ORDER BY b.id DESC LIMIT 300`, [s]),
    query('SELECT id, name, layout, is_active FROM car_models ORDER BY is_active DESC, name'),
    query('SELECT id, name, is_active FROM share_places ORDER BY is_active DESC, name'),
    query(`SELECT count(*) FILTER (WHERE c.status = 'pending')::int AS pending_cars FROM shared_cars c WHERE ($1::int IS NULL OR c.franchise_id = $1)`, [s]),
  ]);
  res.json({
    cars: cars.rows, rides: rides.rows, bookings: bookings.rows, models: models.rows, places: places.rows,
    counts: counts.rows[0], can_edit: !req.isSuper,
  });
}));

// A car document (RC, permit, insurance, photo) — streamed, never public.
admin.get('/cars/:id/docs/:field', h(async (req, res) => {
  if (!CAR_DOCS.includes(req.params.field)) return res.status(404).json({ error: 'Unknown document' });
  if (!(await inScope(req, res, 'SELECT 1 FROM shared_cars WHERE id = $1 AND franchise_id = $2', int(req.params.id)))) return;
  const { rows } = await query(`SELECT ${req.params.field} AS file FROM shared_cars WHERE id = $1`, [int(req.params.id)]);
  if (!rows[0]?.file) return res.status(404).json({ error: 'Document not uploaded' });
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(path.join(DOC_DIR, path.basename(rows[0].file)));
}));

// body: { action: 'approve' | 'reject' | 'remove', reason }
admin.post('/cars/:id/review', h(async (req, res) => {
  const id = int(req.params.id);
  if (!(await inScope(req, res, 'SELECT 1 FROM shared_cars WHERE id = $1 AND franchise_id = $2', id))) return;
  await asActor(req.user.id, (db) => db.query('CALL sp_review_car($1,$2,$3,$4)', [id, String(req.body?.action ?? ''), String(req.body?.reason ?? ''), req.user.id]));
  const { rows } = await query('SELECT owner_id, reg_number, status, status_reason FROM shared_cars WHERE id = $1', [id]);
  const c = rows[0];
  quiet(pushTo([c.owner_id], c.status === 'approved'
    ? { title: `✅ Car ${c.reg_number} approved for Share Ride`, body: 'You can now list your journeys.', url: '/agent/share-ride', tag: `car-${id}` }
    : { title: `Car ${c.reg_number}: ${c.status}`, body: c.status_reason || '', url: '/agent/share-ride', tag: `car-${id}` }));
  res.status(204).end();
}));

// The admin cancels a journey (e.g. a complaint): same as the owner cancelling.
admin.post('/rides/:id/cancel', h(async (req, res) => {
  const id = int(req.params.id);
  if (!(await inScope(req, res, 'SELECT 1 FROM share_rides WHERE id = $1 AND franchise_id = $2', id))) return;
  const customers = await asActor(req.user.id, async (db) =>
    (await db.query('SELECT fn_cancel_ride(NULL,$1,$2,true) AS c', [id, String(req.body?.reason ?? '')])).rows[0].c);
  quiet(pushTo(customers, {
    title: '❌ Your Share Ride journey was cancelled',
    body: `Reason: ${String(req.body?.reason ?? '').slice(0, 120)}. If you paid, the car owner returns your money.`,
    url: '/share-ride/tickets', tag: `ride-${id}`,
  }));
  res.status(204).end();
}));

// Car models: body { name, layout: [{ name, cells }], is_active }
const saveModel = (withId) => h(async (req, res) => {
  const b = req.body || {};
  const layout = Array.isArray(b.layout)
    ? b.layout.slice(0, 10).map((r) => ({ name: String(r?.name ?? '').slice(0, 30), cells: String(r?.cells ?? '').toUpperCase().slice(0, 10) }))
    : null;
  const { rows } = await asActor(req.user.id, (db) => db.query('SELECT * FROM fn_save_car_model($1,$2,$3,$4,$5)', [
    withId ? int(req.params.id) : null, String(b.name ?? ''), JSON.stringify(layout), typeof b.is_active === 'boolean' ? b.is_active : null, req.user.id,
  ]));
  res.status(withId ? 200 : 201).json(rows[0]);
});
admin.post('/models', saveModel(false));
admin.put('/models/:id', saveModel(true));

// Towns: body { name } (add) · PUT { is_active }
admin.post('/places', h(async (req, res) => {
  const name = String(req.body?.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Enter the town name' });
  const { rows } = await asActor(req.user.id, (db) => db.query(
    `INSERT INTO share_places (name) VALUES ($1) ON CONFLICT ((lower(name))) DO UPDATE SET is_active = true RETURNING *`, [name]));
  res.status(201).json(rows[0]);
}));
admin.put('/places/:id', h(async (req, res) => {
  const { rows } = await asActor(req.user.id, (db) => db.query(
    'UPDATE share_places SET is_active = $2 WHERE id = $1 RETURNING *', [int(req.params.id), req.body?.is_active === true]));
  if (!rows[0]) return res.status(404).json({ error: 'Town not found' });
  res.json(rows[0]);
}));
router.use('/admin', admin);

export default router;
