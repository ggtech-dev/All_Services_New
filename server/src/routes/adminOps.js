import { Router } from 'express';
import path from 'node:path';
import { query, asActor } from '../db.js';
import { requireAuth, requireStaff, requireSuper } from '../middleware/auth.js';
import { LIVE_SQL, TRAIL_SQL, loadOrder } from './orders.js';
import { DOC_DIR, DOC_FIELDS, createAgent, docUpload, franchiseForNewAgent, parseSkills, removeFiles } from './agent.js';
import { clearShopPaymentDetails, sendOrderFile } from '../orderFiles.js';
import { notifyAssigned, notifyCustomer } from '../push.js';

// Admin: manage orders and delivery agents.
// Used by franchise admins (always limited to their own franchise) and by the Super Admin (all franchises, or the
// one chosen in the app). req.scope = that franchise id, or null = all (see requireStaff).
const router = Router();
router.use(requireAuth, requireStaff);

const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
// '' / missing → null; anything that is not a real number (e.g. "abc" → NaN) is a 400, never stored.
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw Object.assign(new Error('Enter a valid number'), { status: 400 });
  return n;
};

// ---------- franchise guard: a record outside the admin's franchise simply does not exist for them ----------
const guard = (sql, what) => h(async (req, res, next) => {
  if (req.scope == null || !/^\d{1,9}$/.test(req.params.id)) return next();
  const { rows } = await query(sql, [Number(req.params.id), req.scope]);
  if (!rows.length) return res.status(404).json({ error: `${what} not found` });
  next();
});
router.use('/orders/:id', guard('SELECT 1 FROM orders WHERE id = $1 AND franchise_id = $2', 'Order'));
router.use('/agents/:id', guard('SELECT 1 FROM agents WHERE user_id = $1 AND franchise_id = $2', 'Agent'));
router.use('/customers/:id', guard('SELECT 1 FROM orders WHERE customer_id = $1 AND franchise_id = $2 LIMIT 1', 'Customer'));
router.use('/subscriptions/:id', guard(
  'SELECT 1 FROM agent_subscriptions s JOIN agents a ON a.user_id = s.agent_id WHERE s.id = $1 AND a.franchise_id = $2', 'Subscription'));
// Each city is run by its franchise admin: orders, agents, subscriptions, shops… The Super Admin (HQ) watches every city
// here but changes nothing — except what HQ sets up: agent types, delivery charges, subscription fees, and the city's
// areas, villages and village charges, the home page's popular row. A city that is not run well: HQ talks to its
// admin, or disables / suspends it.
const HQ_SETS_UP = /^\/(localities|village-fees|popular|popular-own)(\/|$)/;
const HQ_MAY_CHANGE = [/^\/service-types(\/|$)/, /^\/services\/\d+\/delivery-fee$/, /^\/delivery-charges\//, /^\/subscriptions\/services\/\d+$/, HQ_SETS_UP];
// 🗺️ a franchise admin asks HQ for a new area / village (Requests to HQ) instead of adding it
router.use((req, res, next) => {
  if (!req.isSuper && req.method !== 'GET' && HQ_SETS_UP.test(req.path)) {
    return res.status(403).json({ error: 'This is set by HQ — ask for a change in Requests to HQ' });
  }
  next();
});
router.use((req, res, next) => {
  if (req.isSuper && req.method !== 'GET' && !HQ_MAY_CHANGE.some((re) => re.test(req.path))) {
    return res.status(403).json({ error: 'HQ can view city operations only — the franchise admin of the city does this' });
  }
  next();
});
router.use('/shops/:id', guard('SELECT 1 FROM shops sh JOIN localities l ON l.id = sh.locality_id WHERE sh.id = $1 AND l.franchise_id = $2', 'Shop'));
router.use('/localities/:id', guard('SELECT 1 FROM localities WHERE id = $1 AND franchise_id = $2', 'Area'));

// An area id sent in a form must be one of this franchise's areas.
async function areaInScope(req, localityId) {
  if (req.scope == null || localityId == null) return true;
  const { rows } = await query('SELECT 1 FROM localities WHERE id = $1 AND franchise_id = $2', [localityId, req.scope]);
  return rows.length > 0;
}

// ---------- orders ----------
router.get('/orders-stats', h(async (req, res) => {
  const { rows } = await query(
    `SELECT fn_order_stats($1) || fn_subscription_counts($1) || jsonb_build_object(
            'low_ratings', (SELECT count(*) FROM order_ratings r JOIN orders o ON o.id = r.order_id
                             WHERE r.stars <= 2 AND r.created_at >= now() - interval '7 days' AND ($1::int IS NULL OR o.franchise_id = $1)),
            'pending_requests', (SELECT count(*) FROM catalog_requests WHERE status = 'pending' AND ($1::int IS NULL OR franchise_id = $1)),
            'open_complaints', (SELECT count(*) FROM complaints WHERE status IN ('open', 'in_progress') AND ($1::int IS NULL OR franchise_id = $1)),
            'pending_cars', (SELECT count(*) FROM shared_cars WHERE status = 'pending' AND ($1::int IS NULL OR franchise_id = $1)),
            'worker_reports', (SELECT count(*) FROM worker_reports r JOIN workers w ON w.id = r.worker_id
                                WHERE r.status = 'open' AND ($1::int IS NULL OR w.franchise_id = $1)),
            'new_digital', (SELECT count(*) FROM digital_requests WHERE status = 'new'),
            -- ⏰ open orders nobody took / finished in time (overdue.sql)
            'overdue', (SELECT count(*) FROM orders o WHERE o.status IN ('placed', 'assigned', 'picked_up')
                          AND ($1::int IS NULL OR o.franchise_id = $1) AND fn_order_overdue(o) IS NOT NULL),
            'rides_to_check', (SELECT count(*) FROM ride_bookings b JOIN share_rides r ON r.id = b.ride_id
                                WHERE b.status = 'paid' AND b.paid_at < now() - interval '1 hour' AND ($1::int IS NULL OR r.franchise_id = $1))) AS s`,
    [req.scope]
  );
  res.json(rows[0].s);
}));

// ?status=placed|assigned|picked_up|delivered|cancelled|active|overdue  ?q=  ?agent=  ?customer=  ?date=YYYY-MM-DD (India)
router.get('/orders', h(async (req, res) => {
  const { status, q, agent, customer, date } = req.query;
  const { rows } = await query(
    `SELECT o.id, o.kind, o.status, o.total, o.delivery_fee, o.created_at, o.assigned_at, o.delivered_at,
            fn_order_overdue(o) AS overdue, fn_order_due_at(o) AS due_at,
            o.contact_name, o.contact_phone, o.slot, o.agent_id, o.customer_id, o.franchise_id, f.city AS franchise_city,
            l.name AS locality_name, cu.username AS customer_username, ag.full_name AS agent_name, ag.phone AS agent_phone,
            o.skill_code, st.name AS skill_name, st.icon AS skill_icon,
            (SELECT count(*) FROM order_items i WHERE i.order_id = o.id)::int AS item_count,
            (SELECT string_agg(fn_item_label(i.name, i.qty, i.sell_by, i.unit), ', ' ORDER BY i.id)
               FROM order_items i WHERE i.order_id = o.id) AS summary
       FROM orders o
       JOIN localities l ON l.id = o.locality_id
       JOIN users cu ON cu.id = o.customer_id
       JOIN service_types st ON st.code = o.skill_code
       LEFT JOIN users ag ON ag.id = o.agent_id
       LEFT JOIN franchises f ON f.id = o.franchise_id
      WHERE ($1::text IS NULL OR ($1 = 'active' AND o.status IN ('placed', 'assigned', 'picked_up')) OR o.status = $1
             OR ($1 = 'overdue' AND o.status IN ('placed', 'assigned', 'picked_up') AND fn_order_overdue(o) IS NOT NULL))
        AND ($2::text IS NULL OR o.id::text = ltrim($2, '#') OR o.contact_name ILIKE '%' || $2 || '%'
             OR o.contact_phone LIKE '%' || $2 || '%' OR cu.username ILIKE '%' || $2 || '%' OR l.name ILIKE '%' || $2 || '%')
        AND ($3::int IS NULL OR o.agent_id = $3)
        AND ($4::int IS NULL OR o.customer_id = $4)
        AND ($5::date IS NULL OR (o.created_at AT TIME ZONE 'Asia/Kolkata')::date = $5::date)
        AND ($6::text IS NULL OR o.skill_code = $6)
        AND ($7::int IS NULL OR o.franchise_id = $7)
        AND ($8::text IS NULL OR o.kind = $8)
      ORDER BY o.created_at DESC
      LIMIT 300`,
    [status || null, q?.trim() || null, num(agent), num(customer), date || null, req.query.skill || null, req.scope,
      ['products', 'service'].includes(req.query.kind) ? req.query.kind : null]
  );
  res.json(rows);
}));

router.get('/orders/:id', h(async (req, res) => {
  const order = await loadOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  // Free/busy agents with distance to this order, to help the admin choose (same franchise, right type, allowed).
  const { rows: agents } = await query(
    `SELECT v.user_id, v.full_name, v.phone, v.state, v.vehicle_type, v.locality_name,
            CASE WHEN v.lat IS NOT NULL THEN fn_distance_km(v.lat, v.lng, $1, $2) END AS distance_km
       FROM v_agents v WHERE v.status = 'active' AND $3 = ANY (v.skills) AND fn_agent_may_take(v.user_id, $4)
      ORDER BY (v.state = 'free') DESC, distance_km NULLS LAST`,
    [order.locality_lat, order.locality_lng, order.skill_code, order.id]
  );
  const { rows: late } = await query('SELECT fn_order_overdue(o) AS overdue, fn_order_due_at(o) AS due_at FROM orders o WHERE o.id = $1', [order.id]);
  res.json({ ...order, ...late[0], candidates: agents });
}));

router.post('/orders/:id/assign', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('SELECT fn_admin_assign_order($1,$2)', [Number(req.params.id), num(req.body?.agent_id)]));
  notifyAssigned(Number(req.params.id), num(req.body?.agent_id));
  notifyCustomer(Number(req.params.id), 'assigned');
  res.status(204).end();
}));

router.post('/orders/:id/cancel', h(async (req, res) => {
  await asActor(req.user.id, (db) =>
    db.query('CALL sp_cancel_order($1,$2,true,$3)', [Number(req.params.id), req.user.id, req.body?.reason || null])
  );
  await clearShopPaymentDetails(Number(req.params.id));
  notifyCustomer(Number(req.params.id), 'cancelled');
  res.status(204).end();
}));

router.get('/orders/:id/files/:kind', h(async (req, res) => {
  await sendOrderFile(res, Number(req.params.id), req.params.kind);
}));

// Live position of an order's agent (for the order detail map).
router.get('/orders/:id/live', h(async (req, res) => {
  const { rows } = await query(`${LIVE_SQL} WHERE o.id = $1`, [Number(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
  const trail = (await query(TRAIL_SQL, [rows[0].id])).rows;
  res.json({ ...rows[0], trail });
}));

// ---------- live map: every active agent with a known position ----------
router.get('/live', h(async (req, res) => {
  const { rows } = await query(
    `SELECT v.user_id, v.full_name, v.phone, v.state, v.skills, v.vehicle_type, v.vehicle_number, v.locality_name,
            v.last_lat::float AS lat, v.last_lng::float AS lng, v.last_accuracy_m AS accuracy_m, v.last_location_at,
            extract(epoch FROM now() - v.last_location_at)::int AS age_seconds,
            o.id AS order_id, o.status AS order_status, o.contact_name, ol.name AS order_locality,
            coalesce(o.dest_lat, ol.lat)::float AS dest_lat, coalesce(o.dest_lng, ol.lng)::float AS dest_lng
       FROM v_agents v
       LEFT JOIN LATERAL (SELECT * FROM orders o WHERE o.agent_id = v.user_id AND o.status IN ('assigned', 'picked_up')
                           ORDER BY o.assigned_at DESC LIMIT 1) o ON true
       LEFT JOIN localities ol ON ol.id = o.locality_id
      WHERE v.status = 'active' AND v.last_lat IS NOT NULL AND ($1::int IS NULL OR v.franchise_id = $1)
      ORDER BY v.last_location_at DESC`,
    [req.scope]
  );
  res.json(rows);
}));

// One agent's movement today (or ?hours=N, max 72) plus their current order, for the tracking panel.
router.get('/agents/:id/track', h(async (req, res) => {
  const id = Number(req.params.id);
  const hours = Math.min(Math.max(Number(req.query.hours) || 12, 1), 72);
  const [{ rows: trail }, { rows: order }] = await Promise.all([
    query(
      `SELECT lat::float, lng::float, order_id, recorded_at FROM agent_location_trail
        WHERE agent_id = $1 AND recorded_at > now() - make_interval(hours => $2)
        ORDER BY recorded_at LIMIT 2000`,
      [id, hours]
    ),
    query(
      `${LIVE_SQL} WHERE o.agent_id = $1 AND o.status IN ('assigned', 'picked_up') ORDER BY o.assigned_at DESC LIMIT 1`,
      [id]
    ),
  ]);
  res.json({ trail, order: order[0] || null });
}));

// ---------- customers (for the orders page) ----------
router.get('/customers/:id', h(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.username, u.full_name, u.phone, u.created_at,
            count(o.id)::int AS orders, count(o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered,
            coalesce(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0) AS spent
       FROM users u LEFT JOIN orders o ON o.customer_id = u.id AND ($2::int IS NULL OR o.franchise_id = $2)
      WHERE u.id = $1 GROUP BY u.id`,
    [Number(req.params.id), req.scope]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
  res.json(rows[0]);
}));

// ---------- agents ----------
// ?state=free|busy|offline|pending|rejected|suspended|removed
router.get('/agents', h(async (req, res) => {
  const { rows } = await query(
    `SELECT v.user_id, v.username, v.full_name, v.phone, v.email, v.status, v.state, v.is_online, v.vehicle_type,
            v.vehicle_number, v.locality_name, v.active_orders, v.today_deliveries, v.last_seen_at, v.created_at, v.skills,
            v.rejection_reason, v.franchise_id, f.city AS franchise_city,
            (fn_agent_stats(v.user_id)->>'wallet_balance')::numeric AS wallet_balance,
            (fn_agent_stats(v.user_id)->>'cash_in_hand')::numeric AS cash_in_hand,
            (fn_agent_stats(v.user_id)->>'total_deliveries')::int AS total_deliveries,
            fn_agent_rating(v.user_id) AS rating
       FROM v_agents v LEFT JOIN franchises f ON f.id = v.franchise_id
      WHERE ($1::text IS NULL OR v.state = $1)
        AND ($2::text IS NULL OR $2 = ANY (v.skills))
        AND ($3::int IS NULL OR v.franchise_id = $3)
      ORDER BY array_position(ARRAY['pending','free','busy','offline','suspended','rejected','removed'], v.state), v.full_name`,
    [req.query.state || null, req.query.skill || null, req.scope]
  );
  res.json(rows);
}));

router.get('/agents/:id', h(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await query('SELECT * FROM v_agents WHERE user_id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Agent not found' });
  const [{ rows: stats }, { rows: orders }, { rows: wallet }, { rows: ratings }] = await Promise.all([
    query("SELECT fn_agent_stats($1) || jsonb_build_object('rating', fn_agent_rating($1)) AS s", [id]),
    query(
      `SELECT o.id, o.status, o.total, o.agent_earning, o.created_at, o.delivered_at, o.contact_name, l.name AS locality_name,
              round(extract(epoch FROM o.delivered_at - o.assigned_at) / 60) AS minutes
         FROM orders o JOIN localities l ON l.id = o.locality_id
        WHERE o.agent_id = $1 ORDER BY o.created_at DESC LIMIT 50`,
      [id]
    ),
    query(
      `SELECT w.*, u.username AS created_by_name FROM agent_wallet w LEFT JOIN users u ON u.id = w.created_by
        WHERE w.agent_id = $1 ORDER BY w.created_at DESC LIMIT 100`,
      [id]
    ),
    query(
      `SELECT r.order_id, r.stars, r.comment, r.tags, r.created_at, u.full_name AS customer_name
         FROM order_ratings r JOIN users u ON u.id = r.customer_id WHERE r.agent_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
      [id]
    ),
  ]);
  const agent = rows[0];
  // Which documents exist (the files themselves are fetched separately).
  const docs = Object.fromEntries(DOC_FIELDS.map((f) => [f, Boolean(agent[f])]));
  DOC_FIELDS.forEach((f) => delete agent[f]);
  res.json({ agent, docs, stats: stats[0].s, orders, wallet, ratings });
}));

// Streams an identity document to an admin. Never exposed publicly.
router.get('/agents/:id/docs/:field', h(async (req, res) => {
  if (!DOC_FIELDS.includes(req.params.field)) return res.status(404).json({ error: 'Unknown document' });
  const { rows } = await query(`SELECT ${req.params.field} AS file FROM agents WHERE user_id = $1`, [Number(req.params.id)]);
  if (!rows[0]?.file) return res.status(404).json({ error: 'Document not uploaded' });
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(path.join(DOC_DIR, path.basename(rows[0].file)));
}));

// Admin adds an agent directly (active straight away; documents optional). A franchise admin can only add agents
// in their own areas (the agent's franchise comes from the area).
router.post('/agents', docUpload, h(async (req, res) => {
  const loc = /^\d{1,9}$/.test(String(req.body?.locality_id ?? '')) ? Number(req.body.locality_id) : null;
  if (!(await areaInScope(req, loc))) {
    await removeFiles(req.files);
    return res.status(400).json({ error: 'Choose one of your franchise areas for this agent' });
  }
  const onlyFranchise = await franchiseForNewAgent(req, req.scope);
  const agent = await createAgent(req, 'active');
  // no area chosen: the agent works for the franchise that added them (or the only franchise there is)
  const home = req.scope ?? onlyFranchise;
  if (agent.franchise_id == null && home != null) {
    await query('UPDATE agents SET franchise_id = $2 WHERE user_id = $1', [agent.user_id, home]);
    agent.franchise_id = home;
  }
  res.status(201).json(agent);
}));

// body: { approve: bool, reason? }
router.post('/agents/:id/review', h(async (req, res) => {
  await asActor(req.user.id, (db) =>
    db.query('CALL sp_review_agent($1,$2,$3,$4)', [Number(req.params.id), Boolean(req.body?.approve), req.body?.reason || null, req.user.id])
  );
  res.status(204).end();
}));

// body: { skills: ['plumbing', 'electrical'] }
router.patch('/agents/:id/skills', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_set_agent_skills($1,$2)', [Number(req.params.id), parseSkills(req.body?.skills)]));
  res.status(204).end();
}));

// The franchise admin takes an agent off for good (kept for old orders, wallet and ratings; "Restore" brings them
// back). body: { reason }
router.post('/agents/:id/remove', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_remove_agent($1,$2,$3)', [Number(req.params.id), req.body?.reason || null, req.user.id]));
  res.status(204).end();
}));

// body: { status: 'active' | 'suspended' } — 'active' also restores a removed agent
router.patch('/agents/:id/status', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_set_agent_status($1,$2)', [Number(req.params.id), req.body?.status]));
  res.status(204).end();
}));

// body: { type: 'payout' | 'bonus' | 'cod_deposited', amount, note }
router.post('/agents/:id/wallet', h(async (req, res) => {
  await asActor(req.user.id, (db) =>
    db.query('CALL sp_wallet_entry($1,$2,$3,$4,$5)', [Number(req.params.id), req.body?.type, num(req.body?.amount), req.body?.note || null, req.user.id])
  );
  res.status(204).end();
}));

// ---------- reports ----------
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// ?from=YYYY-MM-DD&to=YYYY-MM-DD (India dates, inclusive)
router.get('/reports', h(async (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'Choose a valid date range' });
  const { rows } = await query('SELECT fn_report($1::date, $2::date, $3) AS r', [from, to, req.scope]);
  res.json(rows[0].r);
}));

// Every order in the range as a CSV file (opens in Excel / Google Sheets).
router.get('/reports/orders.csv', h(async (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'Choose a valid date range' });
  const { rows } = await query(
    `SELECT o.id AS "Order", to_char(o.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS "Placed (IST)",
            f.code AS "Franchise", f.city AS "City",
            o.status AS "Status", st.name AS "Agent type", o.contact_name AS "Customer", o.contact_phone AS "Phone",
            l.name AS "Area", o.pincode AS "Pincode",
            (SELECT string_agg(fn_item_label(i.name, i.qty, i.sell_by, i.unit) || coalesce(' (' || i.note || ')', ''), '; ' ORDER BY i.id) FROM order_items i WHERE i.order_id = o.id) AS "Items",
            o.subtotal AS "Items total", o.delivery_fee AS "Delivery fee", o.total AS "Total",
            ag.full_name AS "Agent", ag.phone AS "Agent phone",
            to_char(o.delivered_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS "Delivered (IST)",
            round(extract(epoch FROM o.delivered_at - o.created_at) / 60) AS "Minutes to deliver",
            o.agent_earning AS "Agent pay", o.cancel_reason AS "Cancel reason"
       FROM orders o
       JOIN localities l ON l.id = o.locality_id
       JOIN service_types st ON st.code = o.skill_code
       LEFT JOIN users ag ON ag.id = o.agent_id
       LEFT JOIN franchises f ON f.id = o.franchise_id
      WHERE (o.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR o.franchise_id = $3)
      ORDER BY o.id`,
    [from, to, req.scope]
  );
  const cols = rows.length ? Object.keys(rows[0]) : ['Order'];
  // Quote every cell; neutralise values starting with = + - @ so spreadsheets don't run them as formulas.
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="orders_${from}_to_${to}.csv"`);
  res.send('﻿' + csv); // BOM so Excel shows ₹ and Telugu names correctly
}));

// ---------- ratings (customers rate agents after delivery) ----------
// ?stars=low (1–2 ⭐) | 1..5   ?agent=
router.get('/ratings', h(async (req, res) => {
  const stars = req.query.stars === 'low' ? [1, 2] : /^[1-5]$/.test(req.query.stars || '') ? [Number(req.query.stars)] : null;
  const [{ rows: list }, { rows: watch }, { rows: sum }] = await Promise.all([
    query(
      `SELECT r.order_id, r.stars, r.comment, r.tags, r.created_at, r.agent_id, ag.full_name AS agent_name, ag.phone AS agent_phone,
              cu.full_name AS customer_name, cu.phone AS customer_phone, f.city AS franchise_city
         FROM order_ratings r JOIN orders o ON o.id = r.order_id JOIN users cu ON cu.id = r.customer_id
         LEFT JOIN users ag ON ag.id = r.agent_id LEFT JOIN franchises f ON f.id = o.franchise_id
        WHERE ($1::int[] IS NULL OR r.stars = ANY ($1)) AND ($2::int IS NULL OR r.agent_id = $2)
          AND ($3::int IS NULL OR o.franchise_id = $3)
        ORDER BY r.created_at DESC LIMIT 200`,
      [stars, num(req.query.agent), req.scope]
    ),
    query('SELECT fn_rating_watchlist($1) AS w', [req.scope]),
    query(
      `SELECT round(avg(r.stars), 1) AS avg, count(*)::int AS count,
              count(*) FILTER (WHERE r.stars <= 2 AND r.created_at >= now() - interval '7 days')::int AS low_7d,
              count(*) FILTER (WHERE r.created_at >= now() - interval '7 days')::int AS count_7d,
              (SELECT count(*)::int FROM orders x WHERE x.status = 'delivered' AND x.agent_id IS NOT NULL
                  AND ($1::int IS NULL OR x.franchise_id = $1)) AS delivered
         FROM order_ratings r JOIN orders o ON o.id = r.order_id
        WHERE $1::int IS NULL OR o.franchise_id = $1`,
      [req.scope]
    ),
  ]);
  res.json({ ratings: list, watchlist: watch[0].w, summary: sum[0] });
}));

// ---------- subscriptions (subscription-only services: requests, members, payments) ----------
router.get('/subscriptions', h(async (req, res) => {
  const [{ rows: services }, { rows: subs }, { rows: agents }, { rows: counts }] = await Promise.all([
    query(
      // terms in the chosen city (its own, or the HQ default), or the HQ defaults for "all cities"
      `SELECT s.id, s.name, c.name AS category_name, c.icon, s.skill_code, t.name AS skill_name, s.is_active,
              (st).required AS subscription_required, (st).fee AS subscription_fee, (st).days AS subscription_days,
              s.subscription_required AS hq_required, s.subscription_fee AS hq_fee, s.subscription_days AS hq_days,
              (fs.sub_required IS NOT NULL) AS city_terms,
              (SELECT count(*) FROM agent_subscriptions x JOIN agents a ON a.user_id = x.agent_id
                WHERE x.service_id = s.id AND x.status = 'active' AND x.paid_until >= now()
                  AND ($1::int IS NULL OR a.franchise_id = $1))::int AS members,
              (SELECT coalesce(sum(p.amount), 0) FROM subscription_payments p JOIN agent_subscriptions x ON x.id = p.subscription_id
                 JOIN agents a ON a.user_id = x.agent_id WHERE x.service_id = s.id AND ($1::int IS NULL OR a.franchise_id = $1)) AS collected
         FROM services s JOIN categories c ON c.id = s.category_id JOIN service_types t ON t.code = s.skill_code
         LEFT JOIN franchise_services fs ON fs.service_id = s.id AND fs.franchise_id = $1
         CROSS JOIN LATERAL (SELECT fn_sub_terms($1, s.id) AS st) x
        WHERE $1::int IS NULL OR fs.is_enabled
        ORDER BY (st).required DESC, c.sort_order, s.sort_order, s.name`,
      [req.scope]
    ),
    query('SELECT fn_admin_subscriptions($1) AS list', [req.scope]),
    query(`SELECT user_id, full_name, phone, username FROM v_agents WHERE status IN ('active', 'pending')
             AND ($1::int IS NULL OR franchise_id = $1) ORDER BY full_name`, [req.scope]),
    query('SELECT fn_subscription_counts($1) AS c', [req.scope]),
  ]);
  // a franchise admin sets the terms for its own city; the Super Admin sets the HQ defaults (all cities) or a city's
  // the franchise admin manages its own city; the Super Admin sees every city (or one) but changes nothing
  res.json({ services, subscriptions: subs[0].list, agents, counts: counts[0].c, can_edit_services: true,
    editing: req.scope == null ? 'hq' : 'city', read_only: req.isSuper });
}));

// The franchise admin turns "subscription only" on/off for a service in its city, and sets its fee and period
// (reset = back to the default the service came with).
router.put('/subscriptions/services/:id', h(async (req, res) => {
  const b = req.body || {};
  await asActor(req.user.id, (db) =>
    db.query('CALL sp_set_franchise_subscription($1,$2,$3,$4,$5,$6)', [req.scope, Number(req.params.id), b.required === true, num(b.fee), num(b.days), b.reset === true])
  );
  res.status(204).end();
}));

// add an agent directly (after a phone call) — paid or free
router.post('/subscriptions', h(async (req, res) => {
  const b = req.body || {};
  if (req.scope != null) {
    const { rows } = await query('SELECT 1 FROM agents WHERE user_id = $1 AND franchise_id = $2', [num(b.agent_id), req.scope]);
    if (!rows.length) return res.status(404).json({ error: 'Agent not found' });
  }
  const { rows } = await asActor(req.user.id, (db) =>
    db.query('SELECT * FROM fn_admin_add_subscription($1,$2,$3,$4,$5,$6,$7)', [
      num(b.agent_id), num(b.service_id), num(b.amount), b.mode, b.reference, num(b.days), req.user.id,
    ])
  );
  res.status(201).json(rows[0]);
}));

// payment received → activate / renew (extends from the current end date)
router.post('/subscriptions/:id/activate', h(async (req, res) => {
  const b = req.body || {};
  const { rows } = await asActor(req.user.id, (db) =>
    db.query('SELECT * FROM fn_admin_activate_subscription($1,$2,$3,$4,$5,$6)', [
      Number(req.params.id), num(b.amount), b.mode, b.reference, num(b.days), req.user.id,
    ])
  );
  res.json(rows[0]);
}));

router.post('/subscriptions/:id/reject', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_admin_reject_subscription($1,$2,$3)', [Number(req.params.id), req.body?.reason, req.user.id]));
  res.status(204).end();
}));

router.post('/subscriptions/:id/stop', h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_admin_stop_subscription($1,$2,$3)', [Number(req.params.id), req.body?.reason, req.user.id]));
  res.status(204).end();
}));

// ---------- delivery charges (per service, the same everywhere: changed by the Super Admin) ----------
router.get('/delivery-charges', h(async (req, res) => {
  const { rows } = await query('SELECT fn_admin_delivery_charges() AS list');
  res.json(rows[0].list);
}));

// body: { fee }
router.patch('/services/:id/delivery-fee', requireSuper, h(async (req, res) => {
  await asActor(req.user.id, (db) => db.query('CALL sp_set_service_delivery_fee($1,$2)', [Number(req.params.id), num(req.body?.fee)]));
  res.status(204).end();
}));

// Same charge for a whole category. body: { category_id, fee }
router.post('/delivery-charges/category', requireSuper, h(async (req, res) => {
  const { rows } = await asActor(req.user.id, (db) =>
    db.query('SELECT fn_set_category_delivery_fee($1,$2) AS n', [num(req.body?.category_id), num(req.body?.fee)])
  );
  res.json({ updated: rows[0].n });
}));

// ---------- shops (where agents buy) ----------
router.get('/shops', h(async (req, res) => {
  const { rows } = await query('SELECT fn_admin_shops($1) AS list', [req.scope]);
  res.json(rows[0].list);
}));

// Create (no id) or update a shop. body: { name, locality_id, address, phone, service_ids: [..], is_active }
const saveShop = (withId) => h(async (req, res) => {
  const b = req.body || {};
  const str = (v) => (typeof v === 'string' ? v : null);
  if (!(await areaInScope(req, num(b.locality_id)))) return res.status(400).json({ error: 'Choose one of your franchise areas' });
  if (req.scope != null && num(b.locality_id) == null) return res.status(400).json({ error: 'Choose the area of the shop' });
  const { rows } = await asActor(req.user.id, (db) =>
    db.query('SELECT * FROM fn_save_shop($1,$2,$3,$4,$5,$6,$7)', [
      withId ? Number(req.params.id) : null, str(b.name), num(b.locality_id), str(b.address), str(b.phone),
      Array.isArray(b.service_ids) ? b.service_ids.map(Number).filter(Number.isInteger) : [],
      typeof b.is_active === 'boolean' ? b.is_active : null,
    ])
  );
  res.status(withId ? 200 : 201).json(rows[0]);
});
router.post('/shops', saveShop(false));
router.put('/shops/:id', saveShop(true));

// ---------- service areas ----------
router.get('/localities', h(async (req, res) => {
  const { rows } = await query('SELECT fn_admin_localities($1) AS list', [req.scope]);
  res.json(rows[0].list);
}));

// Create (no id) or update an area. body: { name, pincode, lat, lng, is_active, franchise_id (Super Admin) }
// A franchise admin's areas always belong to their own franchise; the Super Admin chooses (or moves) the franchise.
const saveLocality = (withId) => h(async (req, res) => {
  const b = req.body || {};
  let franchise = req.scope ?? num(b.franchise_id);
  if (!withId && franchise == null) {
    // one city only: the area is simply in it
    const { rows: one } = await query("SELECT id FROM franchises WHERE status <> 'disabled'");
    if (one.length !== 1) return res.status(400).json({ error: 'Choose the franchise (city) this area belongs to' });
    franchise = one[0].id;
  }
  // 📍 an area must be inside its city's service range
  const { rows: fr } = await query(
    `SELECT f.city, f.radius_km, fn_distance_km(f.center_lat, f.center_lng, $2, $3) AS km FROM franchises f
      WHERE f.id = coalesce($1, (SELECT franchise_id FROM localities WHERE id = $4)) AND f.center_lat IS NOT NULL`,
    [franchise, num(b.lat), num(b.lng), withId ? Number(req.params.id) : null]);
  if (fr[0]?.km != null && Number(fr[0].km) > Number(fr[0].radius_km)) {
    return res.status(400).json({ error: `That place is ${fr[0].km} km from the centre of ${fr[0].city} — outside its ${Number(fr[0].radius_km)} km range` });
  }
  const { rows } = await asActor(req.user.id, (db) =>
    db.query('SELECT * FROM fn_save_locality($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
      withId ? Number(req.params.id) : null, typeof b.name === 'string' ? b.name : null,
      typeof b.pincode === 'string' ? b.pincode : null, num(b.lat), num(b.lng),
      typeof b.is_active === 'boolean' ? b.is_active : null, franchise,
      typeof b.is_village === 'boolean' ? b.is_village : null, num(b.village_band), // 🏡 village + distance band (1 / 2)
    ])
  );
  res.status(withId ? 200 : 201).json(rows[0]);
});
router.post('/localities', saveLocality(false));

// 🏡 Village delivery charges of the franchise (up to 10 km / 10–15 km). Set by HQ for the city chosen at the top.
router.get('/village-fees', h(async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, city, village_fee_near, village_fee_far FROM franchises
      WHERE ($1::int IS NULL OR id = $1) AND status <> 'disabled' ORDER BY city`, [req.scope]);
  res.json({ franchises: rows, can_edit: !!req.isSuper && req.scope != null });
}));
router.put('/village-fees', h(async (req, res) => {
  if (req.scope == null) return res.status(400).json({ error: 'Choose the city at the top first' });
  await asActor(req.user.id, (db) => db.query('CALL sp_set_village_fees($1,$2,$3)', [req.scope, num(req.body?.near), num(req.body?.far)]));
  res.status(204).end();
}));
router.put('/localities/:id', saveLocality(true));

// ---------- ⭐ "Our most popular services" on the home page (popular.sql) ----------
// HQ: the all-cities list (no city chosen at the top), or a city's own list (city chosen). A city without its own list
// shows the all-cities one — HQ taps "Make a list for this city" to change it there only. Franchise admin: view only
// (they ask HQ in Requests to HQ).
const POPULAR_SQL = `SELECT h.*, s.name AS service_name, s.slug AS service_slug, c.name AS category_name, c.slug AS category_slug,
                            coalesce(h.image_url, s.image_url, c.image_url) AS photo
                       FROM home_popular h LEFT JOIN services s ON s.id = h.service_id LEFT JOIN categories c ON c.id = h.category_id`;
router.get('/popular', h(async (req, res) => {
  const { rows: own } = await query('SELECT fn_popular_list_of($1) AS list', [req.scope]);
  const list = own[0].list; // null = the all-cities list
  const { rows } = await query(`${POPULAR_SQL} WHERE h.franchise_id IS NOT DISTINCT FROM $1 ORDER BY h.sort_order, h.id`, [list]);
  res.json({ cards: rows, city: req.scope, own_list: list != null, can_edit: !!req.isSuper && (req.scope == null || list != null) });
}));
// the list the request works on: HQ with a city chosen edits that city's own list (it must exist first)
const popularListOf = async (req) => {
  if (req.scope == null) return { list: null };
  const { rows } = await query('SELECT fn_popular_list_of($1) AS list', [req.scope]);
  if (rows[0].list == null) throw Object.assign(new Error('This city shows the all-cities list — tap "Make a list for this city" first'), { status: 409 });
  return { list: req.scope };
};
const popularBody = async (b) => {
  const title = typeof b.title === 'string' ? b.title.trim().replace(/\s+/g, ' ') : '';
  const subtitle = typeof b.subtitle === 'string' ? b.subtitle.trim().replace(/\s+/g, ' ') : '';
  if (title.length < 2 || title.length > 60) throw Object.assign(new Error('Write a title (2–60 letters)'), { status: 400 });
  if (subtitle.length > 80) throw Object.assign(new Error('Keep the short line under 80 letters'), { status: 400 });
  const service = num(b.service_id);
  const category = num(b.category_id);
  if ((service == null) === (category == null)) throw Object.assign(new Error('Choose the service (or category) the card opens'), { status: 400 });
  const ok = service != null
    ? (await query('SELECT 1 FROM services WHERE id = $1 AND is_active', [service])).rowCount
    : (await query('SELECT 1 FROM categories WHERE id = $1 AND is_active', [category])).rowCount;
  if (!ok) throw Object.assign(new Error('That service / category is not active'), { status: 400 });
  const image = typeof b.image_url === 'string' && b.image_url.trim() ? b.image_url.trim() : null;
  if (image && !/^(https:\/\/|\/uploads\/)/.test(image)) throw Object.assign(new Error('The photo must be an https:// link or an uploaded photo'), { status: 400 });
  return { title, subtitle: subtitle || null, service, category, image, credit: image ? (typeof b.image_credit === 'string' ? b.image_credit.slice(0, 300) : null) : null,
    active: b.is_active !== false };
};
router.post('/popular', h(async (req, res) => {
  const { list } = await popularListOf(req);
  const b = await popularBody(req.body || {});
  const { rows } = await asActor(req.user.id, (db) => db.query(
    `INSERT INTO home_popular (franchise_id, service_id, category_id, title, subtitle, image_url, image_credit, is_active, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, coalesce((SELECT max(sort_order) FROM home_popular WHERE franchise_id IS NOT DISTINCT FROM $1), 0) + 1) RETURNING *`,
    [list, b.service, b.category, b.title, b.subtitle, b.image, b.credit, b.active]));
  res.status(201).json(rows[0]);
}));
router.put('/popular/:id', h(async (req, res) => {
  const { list } = await popularListOf(req);
  const b = await popularBody(req.body || {});
  const { rows } = await asActor(req.user.id, (db) => db.query(
    `UPDATE home_popular SET service_id = $3, category_id = $4, title = $5, subtitle = $6, image_url = $7, image_credit = $8, is_active = $9, updated_at = now()
      WHERE id = $1 AND franchise_id IS NOT DISTINCT FROM $2 RETURNING *`,
    [num(req.params.id), list, b.service, b.category, b.title, b.subtitle, b.image, b.credit, b.active]));
  if (!rows[0]) return res.status(404).json({ error: 'Card not found in this list' });
  res.json(rows[0]);
}));
router.delete('/popular/:id', h(async (req, res) => {
  const { list } = await popularListOf(req);
  const { rowCount } = await asActor(req.user.id, (db) => db.query('DELETE FROM home_popular WHERE id = $1 AND franchise_id IS NOT DISTINCT FROM $2', [num(req.params.id), list]));
  if (!rowCount) return res.status(404).json({ error: 'Card not found in this list' });
  res.status(204).end();
}));
// body: { dir: -1 (up) | 1 (down) } — swaps the card with its neighbour
router.post('/popular/:id/move', h(async (req, res) => {
  const { list } = await popularListOf(req);
  const dir = req.body?.dir === -1 ? -1 : 1;
  await asActor(req.user.id, async (db) => {
    const { rows } = await db.query('SELECT id FROM home_popular WHERE franchise_id IS NOT DISTINCT FROM $1 ORDER BY sort_order, id', [list]);
    const i = rows.findIndex((r) => r.id === num(req.params.id));
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    for (const [k, r] of rows.entries()) await db.query('UPDATE home_popular SET sort_order = $2 WHERE id = $1', [r.id, k + 1]);
  });
  res.status(204).end();
}));
// a city's own list: start it (a copy of the all-cities list) · or drop it (back to the all-cities list)
router.post('/popular-own', h(async (req, res) => {
  if (req.scope == null) return res.status(400).json({ error: 'Choose the city at the top first' });
  await asActor(req.user.id, (db) => db.query('SELECT fn_popular_own_list($1)', [req.scope]));
  res.status(204).end();
}));
router.delete('/popular-own', h(async (req, res) => {
  if (req.scope == null) return res.status(400).json({ error: 'Choose the city at the top first' });
  await asActor(req.user.id, (db) => db.query('DELETE FROM home_popular WHERE franchise_id = $1', [req.scope]));
  res.status(204).end();
}));

// ---------- service types (which agents do which services) ----------
router.get('/service-types', h(async (req, res) => {
  const { rows } = await query('SELECT * FROM fn_service_type_overview($1)', [req.scope]);
  res.json(rows);
}));

// Create (no code) or update (code in URL) a type. body: { name, agent_title, icon, is_active } — Super Admin only
const saveType = (withCode) => h(async (req, res) => {
  const b = req.body || {};
  const { rows } = await asActor(req.user.id, (db) =>
    db.query('SELECT * FROM fn_save_service_type($1,$2,$3,$4,$5)', [
      withCode ? req.params.code : null, b.name, b.agent_title, b.icon, b.is_active ?? true,
    ])
  );
  res.status(withCode ? 200 : 201).json(rows[0]);
});
router.post('/service-types', requireSuper, saveType(false));
router.put('/service-types/:code', requireSuper, saveType(true));

export default router;
