import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { query, asActor } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { loadOrder } from './orders.js';
import { verifiedApplyPhone } from './auth.js';
import { notifyCustomer, notifyNewOrder } from '../push.js';
import { clearShopPaymentDetails, discardUploads, orderPhotoUpload, removeOrderFiles, sendOrderFile, uploadedName } from '../orderFiles.js';

const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------- identity documents (Aadhaar, PAN, licence, photo) ----------
// Stored outside the public uploads folder; only admins can view them through the API.
export const DOC_DIR = path.resolve(import.meta.dirname, '../../private_uploads');
mkdirSync(DOC_DIR, { recursive: true });

export const DOC_FIELDS = ['aadhaar_doc', 'pan_doc', 'dl_doc', 'photo_doc'];

const docStorage = (fields) => multer({
  storage: multer.diskStorage({
    destination: DOC_DIR,
    filename: (req, file, cb) =>
      cb(null, `${file.fieldname}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: fields.length },
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.mimetype);
    cb(ok ? null : Object.assign(new Error('Documents must be JPG, PNG, WEBP or PDF'), { status: 400 }), ok);
  },
}).fields(fields.map((name) => ({ name, maxCount: 1 })));
export const docUpload = docStorage(DOC_FIELDS);
// 🚗 Share Ride car owners apply with their car's papers too (same fields as routes/shareRide.js CAR_DOCS)
const APPLY_CAR_DOCS = ['rc_doc', 'permit_doc', 'insurance_doc', 'car_photo'];
const applyUpload = docStorage([...DOC_FIELDS, ...APPLY_CAR_DOCS]);

export const removeFiles = (files) =>
  Promise.all(Object.values(files || {}).flat().map((f) => unlink(f.path).catch(() => {})));

// Skills arrive from forms as repeated fields, a comma list or an array: always return an array.
export const parseSkills = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);

// Creates an agent from a multipart form. status: 'pending' (public application) or 'active' (added by admin).
// Agents log in with their mobile number + OTP, so the username (a<phone>) and a random password are made here;
// "Forgot password?" in the agent app sets a real password if they want one.
export async function createAgent(req, status) {
  const b = req.body || {};
  const doc = (name) => req.files?.[name]?.[0]?.filename ?? null;
  try {
    const phone = String(b.phone || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(phone)) throw Object.assign(new Error('Enter a valid 10-digit mobile number'), { status: 400 });
    let username = `a${phone}`;
    for (let i = 2; (await query('SELECT 1 FROM users WHERE username = $1', [username])).rowCount; i++) username = `a${phone}_${i}`;
    const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
    const agent = await asActor(req.user?.id ?? null, async (db) =>
      (await db.query('SELECT * FROM fn_create_agent($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)', [
        username, hash, b.full_name, phone, null, b.vehicle_type || 'bike', b.vehicle_number,
        b.aadhaar_number, b.pan_number, b.dl_number, b.locality_id ? Number(b.locality_id) : null,
        doc('aadhaar_doc'), doc('pan_doc'), doc('dl_doc'), doc('photo_doc'), status, req.user?.id ?? null,
        parseSkills(b.skills),
      ])).rows[0]
    );
    await query('UPDATE users SET has_password = false WHERE id = $1', [agent.user_id]);
    return agent;
  } catch (err) {
    await removeFiles(req.files); // don't keep documents of a failed application
    if (err.code === '23505') {
      const msg = err.constraint === 'users_email_unique' ? 'An account with this email already exists' : 'That username is already taken';
      throw Object.assign(new Error(msg), { status: 409 });
    }
    throw err;
  }
}

// An agent without an area: with a single franchise they simply belong to it; with several cities the area
// (which decides the franchise) must be chosen. Returns the franchise id, null when not needed, or throws.
export async function franchiseForNewAgent(req, scope) {
  const hasArea = /^\d{1,9}$/.test(String(req.body?.locality_id ?? ''));
  if (hasArea || scope != null) return null;
  const { rows } = await query("SELECT id FROM franchises WHERE status <> 'disabled'");
  if (rows.length === 1) return rows[0].id;
  await removeFiles(req.files);
  throw Object.assign(new Error('Choose your city and area'), { status: 400 });
}

// Public: anyone can apply to become a delivery agent. An admin must approve before they can log in.
export const applyRouter = Router();
applyRouter.post('/apply', applyUpload, h(async (req, res) => {
  // the mobile number was checked by OTP on the form (that number is also the agent's login)
  const phone = verifiedApplyPhone(req.body?.phone_proof);
  if (!phone) {
    await removeFiles(req.files);
    return res.status(400).json({ error: 'Please verify your mobile number with OTP first (step 1). It may have expired — verify again.' });
  }
  req.body.phone = phone;
  // 🚗 Car owner: 🚗 Share Ride (sell seats between towns) and/or 🚙 Car Rental (trips with driver) — only those types of
  // work, and the car (with its papers) is checked before the account exists
  const carOwner = req.body.owner_type === 'car';
  if (carOwner) {
    const b = req.body;
    const carWork = [b.skills].flat().filter((s) => s === 'shared_car_agent' || s === 'car_rental_agent');
    const file = (k) => req.files?.[k]?.[0];
    const reg = String(b.reg_number || '').toUpperCase().replace(/[\s-]/g, '');
    const problem = !/^\d{1,9}$/.test(String(b.car_model_id || '')) ? 'Choose your car model'
      : !/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(reg) ? 'Enter the car number like TS36T1234'
      : b.yellow_board !== 'true' ? 'Only commercial (yellow number plate) cars with a valid permit can carry paying passengers'
      : !file('rc_doc') || !file('permit_doc') || !file('insurance_doc') ? 'Upload the RC, permit and insurance of the car'
      : (await query("SELECT 1 FROM shared_cars WHERE upper(reg_number) = $1 AND status IN ('pending', 'approved')", [reg])).rowCount
        ? 'This car number is already registered' : null;
    if (problem) {
      await removeFiles(req.files);
      return res.status(400).json({ error: problem });
    }
    req.body.skills = carWork.length ? [...new Set(carWork)] : ['shared_car_agent'];
    req.body.vehicle_type = 'car';
    req.body.vehicle_number = reg;
  }
  const onlyFranchise = await franchiseForNewAgent(req, null);
  const agent = await createAgent(req, 'pending');
  if (onlyFranchise && agent.franchise_id == null) await query('UPDATE agents SET franchise_id = $2 WHERE user_id = $1', [agent.user_id, onlyFranchise]);
  await query('UPDATE users SET phone_verified_at = now() WHERE id = $1', [agent.user_id]);
  if (carOwner) {
    const doc = (k) => req.files?.[k]?.[0]?.filename ?? null;
    try {
      await asActor(agent.user_id, (db) => db.query('SELECT fn_add_car($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        agent.user_id, Number(req.body.car_model_id), req.body.reg_number, req.body.car_color || '', true,
        doc('rc_doc'), doc('permit_doc'), doc('insurance_doc'), doc('car_photo'),
      ]));
    } catch (err) {
      await query('DELETE FROM users WHERE id = $1', [agent.user_id]); // no half-made application
      await removeFiles(req.files);
      throw err;
    }
  }
  // picked a type of work with subscription services → requests go to the admin
  await query('CALL sp_subscription_requests_from_skills($1)', [agent.user_id]);
  res.status(201).json({ ok: true, status: agent.status });
}));

// ---------- the agent's own app ----------
const router = Router();
router.use(requireAuth, requireRole('agent'), h(async (req, res, next) => {
  const { rows } = await query('SELECT status FROM agents WHERE user_id = $1', [req.user.id]);
  if (rows[0]?.status !== 'active') return res.status(403).json({ error: 'Your agent account is not active' });
  next();
}));

router.get('/me', h(async (req, res) => {
  const [{ rows: agent }, { rows: stats }] = await Promise.all([
    query(
      `SELECT v.user_id, v.username, v.full_name, v.phone, v.email, v.vehicle_type, v.vehicle_number, v.locality_id,
              v.locality_name, v.is_online, v.state, v.status, v.joined_at, v.skills,
              (SELECT json_agg(json_build_object('code', t.code, 'name', t.name, 'icon', t.icon) ORDER BY t.sort_order)
                 FROM service_types t WHERE t.code = ANY (v.skills)) AS skill_list
         FROM v_agents v WHERE v.user_id = $1`,
      [req.user.id]
    ),
    query("SELECT fn_agent_stats($1) || jsonb_build_object('pay_per_order', fn_setting_num('agent_pay_per_order', 25), 'rating', fn_agent_rating($1)) AS s", [req.user.id]),
  ]);
  // 📍 inside / outside their franchise's service range (geo.sql) — the app shows a banner when outside
  const { rows: zone } = await query('SELECT fn_agent_zone($1) AS z', [req.user.id]);
  res.json({ agent: agent[0], stats: stats[0].s, zone: zone[0].z });
}));

// body: { lat, lng, accuracy } — sent every ~10 s by the agent app while online.
router.post('/location', h(async (req, res) => {
  const { lat, lng, accuracy } = req.body || {};
  const { rows } = await query('SELECT fn_agent_location($1,$2,$3,$4) AS stored', [
    req.user.id, Number(lat), Number(lng), accuracy == null ? null : Math.round(Number(accuracy)),
  ]);
  res.json({ stored: rows[0].stored });
}));

// body: { online: bool, locality_id? }
router.patch('/status', h(async (req, res) => {
  await query('CALL sp_set_agent_online($1,$2,$3)', [
    req.user.id, req.body?.online === true || req.body?.online === 'true', req.body?.locality_id ? Number(req.body.locality_id) : null,
  ]);
  res.status(204).end();
}));

// Open orders nobody has taken yet, nearest first. Customer phone/address are hidden until accepted.
router.get('/available', h(async (req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.kind, o.total, o.delivery_fee, o.slot, o.created_at, l.name AS locality_name, o.pincode, o.event_details, o.trip_details, o.visit_details, o.notes,
            EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.on_bill) AS on_bill,
            (SELECT coalesce(sh.name, o.preferred_shop_name) FROM (SELECT 1) x LEFT JOIN shops sh ON sh.id = o.preferred_shop_id) AS preferred_shop,
            (o.list_photo IS NOT NULL) AS has_list_photo, (o.via_service_id IS NOT NULL AND o.deliver_on IS NULL) AS instant, o.deliver_on,
            st.code AS skill_code, st.name AS skill_name, st.icon AS skill_icon,
            (SELECT count(*) FROM order_items i WHERE i.order_id = o.id)::int AS item_count,
            (SELECT string_agg(fn_item_label(i.name, i.qty, i.sell_by, i.unit), ', ' ORDER BY i.id)
               FROM order_items i WHERE i.order_id = o.id) AS summary,
            CASE WHEN me.lat IS NOT NULL
                 THEN fn_distance_km(me.lat, me.lng, coalesce(o.dest_lat, l.lat), coalesce(o.dest_lng, l.lng)) END AS distance_km
       FROM orders o
       JOIN localities l ON l.id = o.locality_id
       JOIN service_types st ON st.code = o.skill_code
       -- where the agent is: live GPS if under 10 minutes old, otherwise the centre of their chosen area
       LEFT JOIN (SELECT CASE WHEN a.last_location_at > now() - interval '10 minutes' THEN a.last_lat ELSE l2.lat END AS lat,
                         CASE WHEN a.last_location_at > now() - interval '10 minutes' THEN a.last_lng ELSE l2.lng END AS lng
                    FROM agents a LEFT JOIN localities l2 ON l2.id = a.locality_id WHERE a.user_id = $1) me ON true
      WHERE o.status = 'placed' AND o.agent_id IS NULL
        AND o.franchise_id = (SELECT franchise_id FROM agents WHERE user_id = $1) -- own city first (index), then the rules below
        AND o.skill_code = ANY ((SELECT skills FROM agents WHERE user_id = $1)::text[])
        AND fn_agent_may_take($1, o.id) -- subscription-only services: subscribed agents only
        AND now() < fn_order_due_at(o) + interval '24 hours' -- ⏰ long overdue: only the admin handles it (overdue.sql)
        AND fn_agent_in_zone($1) -- 📍 only while inside their franchise's range (geo.sql)
      -- nearest first, but an order already waiting 10+ minutes for now goes to the top (oldest first), so a far-away
      -- order is never left behind while newer, nearer ones keep getting taken (the line the customer is told about)
      ORDER BY (o.created_at < now() - interval '10 minutes' AND fn_order_due_at(o) <= now() + interval '3 hours') DESC,
               CASE WHEN o.created_at < now() - interval '10 minutes' AND fn_order_due_at(o) <= now() + interval '3 hours' THEN o.created_at END, distance_km NULLS LAST, o.created_at
      LIMIT 50`,
    [req.user.id]
  );
  res.json(rows);
}));

router.post('/orders/:id/accept', h(async (req, res) => {
  const { rows: zone } = await query('SELECT fn_agent_zone($1) AS z', [req.user.id]);
  const z = zone[0]?.z;
  if (z && !z.inside) {
    return res.status(409).json({ error: `You are outside the ${z.city} service zone${z.km != null ? ` (${z.km} km from the centre)` : ''}. Come within ${Number(z.radius_km)} km to take orders.` });
  }
  await asActor(req.user.id, (db) => db.query('SELECT fn_agent_accept_order($1,$2)', [req.user.id, Number(req.params.id)]));
  notifyCustomer(Number(req.params.id), 'assigned');
  res.json(await loadOrder(Number(req.params.id)));
}));

// scope=active (default) or history
router.get('/orders', h(async (req, res) => {
  const active = req.query.scope !== 'history';
  const { rows } = await query(
    `SELECT o.id, o.kind, o.status, o.total, o.agent_earning, o.created_at, o.assigned_at, o.delivered_at,
            o.contact_name, l.name AS locality_name,
            (SELECT string_agg(fn_item_label(i.name, i.qty, i.sell_by, i.unit), ', ' ORDER BY i.id)
               FROM order_items i WHERE i.order_id = o.id) AS summary
       FROM orders o JOIN localities l ON l.id = o.locality_id
      WHERE o.agent_id = $1 AND (CASE WHEN $2 THEN o.status IN ('assigned', 'picked_up') ELSE o.status IN ('delivered', 'cancelled') END)
      ORDER BY coalesce(o.delivered_at, o.assigned_at, o.created_at) DESC
      LIMIT 200`,
    [req.user.id, active]
  );
  res.json(rows);
}));

router.get('/orders/:id', h(async (req, res) => {
  const order = await loadOrder(Number(req.params.id));
  if (!order || order.agent_id !== req.user.id) return res.status(404).json({ error: 'Order not found' });
  delete order.delivery_otp; // the agent must get the OTP from the customer
  res.json(order);
}));

// body: { status: 'picked_up' | 'delivered', otp? }
router.post('/orders/:id/status', h(async (req, res) => {
  await asActor(req.user.id, (db) =>
    db.query('SELECT fn_agent_update_order($1,$2,$3,$4)', [req.user.id, Number(req.params.id), req.body?.status, req.body?.otp ?? null])
  );
  if (req.body?.status === 'delivered') await clearShopPaymentDetails(Number(req.params.id));
  notifyCustomer(Number(req.params.id), req.body?.status);
  res.status(204).end();
}));

// At the shop: bill photo + amount, and how the shop gets paid.
// multipart: amount, shop_name, mode ('customer_upi' | 'agent_cash'), upi_id, bill_photo (file), qr_photo (file)
router.post('/orders/:id/bill', orderPhotoUpload(['bill_photo', 'qr_photo']), h(async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await asActor(req.user.id, (db) =>
      db.query('SELECT * FROM fn_agent_upload_bill($1,$2,$3,$4,$5,$6,$7,$8)', [
        req.user.id, Number(req.params.id), b.amount === '' || b.amount == null ? null : Number(b.amount), b.shop_name || null,
        b.mode, b.upi_id || null, uploadedName(req, 'bill_photo'), uploadedName(req, 'qr_photo'),
      ])
    );
    await removeOrderFiles([rows[0]?.old_bill_photo, rows[0]?.old_qr_photo]);
  } catch (err) {
    await discardUploads(req);
    throw err;
  }
  res.status(204).end();
}));

// At the door: the customer paid the delivery charge. body: { mode: 'company_upi' | 'cash' }
router.post('/orders/:id/fee-received', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_agent_fee_received($1,$2,$3)', [req.user.id, Number(req.params.id), req.body?.mode ?? null]));
  res.status(204).end();
}));

// The shopkeeper has received the customer's UPI payment.
router.post('/orders/:id/confirm-payment', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_agent_confirm_payment($1,$2)', [req.user.id, Number(req.params.id)]));
  res.status(204).end();
}));

router.get('/orders/:id/files/:kind', h(async (req, res) => {
  await sendOrderFile(res, Number(req.params.id), req.params.kind, 'agent_id = $2', [req.user.id]);
}));

router.post('/orders/:id/release', h(async (req, res) => {
  await asActor(req.user.id, (db) =>
    db.query('CALL sp_agent_release_order($1,$2,$3)', [req.user.id, Number(req.params.id), req.body?.reason || null])
  );
  notifyNewOrder(Number(req.params.id)); // back in the queue → alert the other agents
  notifyCustomer(Number(req.params.id), 'released'); // tell the customer: finding another partner
  res.status(204).end();
}));

// ---------- subscriptions: earn from subscription-only services (plumber…) ----------
router.get('/subscriptions', h(async (req, res) => {
  const { rows } = await query('SELECT fn_agent_subscriptions($1) AS list', [req.user.id]);
  res.json(rows[0].list);
}));

// request a subscription (or a renewal); payment_ref = UPI reference if already paid to the company UPI
router.post('/subscriptions', h(async (req, res) => {
  const b = req.body || {};
  const text = (v) => (typeof v === 'string' ? v : null);
  await query('CALL sp_agent_request_subscription($1,$2,$3,$4)', [req.user.id, Number(b.service_id) || null, text(b.payment_ref), text(b.note)]);
  res.status(204).end();
}));

router.get('/wallet', h(async (req, res) => {
  const [{ rows: stats }, { rows: entries }] = await Promise.all([
    query('SELECT fn_agent_stats($1) AS s', [req.user.id]),
    query(
      `SELECT id, type, amount, order_id, note, created_at FROM agent_wallet
        WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [req.user.id]
    ),
  ]);
  res.json({ stats: stats[0].s, entries });
}));

export default router;
