// 🧪 WAVE 2 (LOCAL only) — runs after load_test.mjs, on its people (zt_lt_… customers and agents, both cities):
//  A. ⏳ The queue + honest waiting: all 3 Siddipet delivery partners busy → new orders say "all our delivery partners
//     are busy", with their place in the line; a busy partner can't take a 2nd order; when one delivers, the first
//     waiting order is theirs. Armoor pet partners all offline → "no partner is online". A later booking → nothing.
//  B. 💸 Second orders pay the delivery charge (the free first delivery is used up): the charge on the order = the
//     checkout's quote; agents' pay and every report add up again.
//  C. ❌ cancel before a partner takes it · 🔁 a partner gives an order back → the next partner gets it.
//  D. 🚙 car bookings go only to partners with that car model; "any car of this size" widens it.
//  E. ⭐ ratings → each agent's average in their app.
//  F. 🔥 BURST: every customer places 5 orders at the same moment (1,000 orders), agents poll while it happens,
//     then the 84 agents clear the whole line (one order at a time each). Times for every step.
import fs from 'node:fs';
import pg from 'pg';
const realFetch = globalThis.fetch;
await import('./testadmin.mjs');
globalThis.fetch = realFetch;

const API = 'http://localhost:5000/api';
const DIR = '.';
const PASS = process.env.TEST_USER_PW;
const BURST = Number(process.env.BURST || 5);
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: '-c search_path=all_services', max: 8 });
const results = [];
let pass = 0, fail = 0;
const check = (area, label, cond, extra = '') => {
  results.push({ area, label, ok: !!cond, extra: cond ? '' : String(extra).slice(0, 300) });
  console.log(`${cond ? 'PASS' : 'FAIL'}  [${area}] ${label}${!cond && extra ? ` — ${String(extra).slice(0, 260)}` : ''}`);
  cond ? pass++ : fail++;
};
async function call(p, { method = 'GET', body, token, form, ip = '10.40.0.1', city, raw } = {}) {
  const headers = { 'X-Forwarded-For': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (city) headers['X-Franchise'] = String(city);
  if (body) headers['Content-Type'] = 'application/json';
  const t0 = Date.now();
  let res;
  try { res = await realFetch(API + p, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) }); }
  catch (e) { return { s: 0, d: { error: `connection failed: ${e.cause?.code || e.message}` }, ms: Date.now() - t0 }; } // refused / timed out
  if (raw) return res;
  const text = res.status === 204 ? '' : await res.text();
  let d = {};
  try { d = text ? JSON.parse(text) : {}; } catch { d = { raw: text.slice(0, 120) }; }
  return { s: res.status, d, ms: Date.now() - t0 };
}
const n = (x) => Number(x || 0);
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const PNG = () => new Blob([Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')], { type: 'image/png' });
const todayIST = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const day = (k) => new Date(Date.now() + k * 864e5 + 330 * 60000).toISOString().slice(0, 10);
const RANGE = `from=${todayIST}&to=${todayIST}`;
async function pool(items, size, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
async function otpLogin(phone, ip) {
  await db.query('DELETE FROM phone_otps WHERE phone = $1', [phone]);
  const r = await call('/auth/phone/request', { method: 'POST', body: { phone }, ip });
  return (await call('/auth/phone/verify', { method: 'POST', body: { phone, code: r.d.devCode, portal: 'agent' }, ip })).d.token;
}

// ============ the people of wave 1 ============
const CITIES = [
  { key: 'S', name: 'Siddipet', id: (await db.query("SELECT id FROM franchises WHERE code = 'FR-0001'")).rows[0].id, admin: 'zt_admin' },
  { key: 'A', name: 'Armoor', id: (await db.query("SELECT id FROM franchises WHERE city = 'Armoor' ORDER BY id LIMIT 1")).rows[0].id, admin: 'zt_admin_ar' },
];
const hq = (await call('/auth/login', { method: 'POST', body: { username: 'zt_super', password: process.env.TEST_STAFF_PW, portal: 'superadmin' } })).d.token;
const CUST = [], AG = [];
for (const C of CITIES) {
  C.token = (await call('/auth/login', { method: 'POST', body: { username: C.admin, password: process.env.TEST_STAFF_PW, portal: 'admin' } })).d.token;
  C.locs = (await call('/localities', { city: C.id })).d.filter((l) => !l.is_village);
  C.before = (await call(`/admin/reports?${RANGE}`, { token: C.token })).d;
  C.hqBefore = (await call(`/super/reports?${RANGE}&franchise=${C.id}`, { token: hq })).d;
  for (const u of (await db.query(`SELECT id, phone, full_name FROM users WHERE username LIKE $1 ORDER BY id`, [`zt\\_lt\\_${C.key.toLowerCase()}\\_c%`])).rows)
    CUST.push({ C, id: u.id, phone: u.phone, name: u.full_name, i: CUST.filter((x) => x.C === C).length + 1, ip: `10.6${C.key === 'S' ? 1 : 2}.${u.id % 250}.${(u.id >> 8) % 250 + 1}`, loc: C.locs[u.id % C.locs.length] });
  for (const a of (await db.query(`SELECT u.id, u.phone, u.full_name, a.skills[1] AS type, (SELECT model_id FROM shared_cars s WHERE s.owner_id = u.id LIMIT 1) AS model
                                     FROM users u JOIN agents a ON a.user_id = u.id WHERE u.username LIKE $1 ORDER BY u.id`, [`zt\\_lt\\_${C.key.toLowerCase()}\\_t%`])).rows)
    AG.push({ C, ...a, full: a.full_name, k: Number(a.full_name.slice(-1)), ip: `10.7${C.key === 'S' ? 1 : 2}.${a.id % 250}.1`, done: [] });
}
const before = { hq: (await call(`/super/reports?${RANGE}`, { token: hq })).d };
await pool(CUST, 20, async (u) => {
  u.token = (await call('/auth/login', { method: 'POST', body: { username: u.phone, password: PASS, portal: 'user' }, ip: u.ip })).d.token;
});
await pool(AG, 8, async (a) => { a.token = await otpLogin(a.phone, a.ip); });
check('setup', `wave 1 people log in again: ${CUST.filter((u) => u.token).length} customers (mobile + password), ${AG.filter((a) => a.token).length} agents (OTP)`,
  CUST.length === 200 && CUST.every((u) => u.token) && AG.length === 84 && AG.every((a) => a.token));
const T0 = Date.now();
const S = CITIES[0], A = CITIES[1];
const agents = (C, type) => AG.filter((a) => a.C === C && a.type === type);
const contact = (u) => ({ name: u.name, phone: u.phone, address_line: `zt H.No ${u.i}, Wave 2 Street`, landmark: 'Near school', locality_id: u.loc.id, lat: Number(u.loc.lat), lng: Number(u.loc.lng) });
const ALL = []; // every order of this wave
async function order(u, body, label) {
  const r = await call('/orders', { method: 'POST', token: u.token, ip: u.ip, city: u.C.id, body: { contact: contact(u), slot: 'As soon as possible', ...body } });
  const o = { u, C: u.C, label, body, ms: r.ms, s: r.s, err: r.s === 201 ? null : r.d.error, id: r.d.id, skill: r.d.skill_code, fee: n(r.d.delivery_fee) };
  if (o.id) ALL.push(o);
  return o;
}
const view = async (o) => (await call(`/orders/${o.id}`, { token: o.u.token, ip: o.u.ip })).d;
async function finish(a, o) { // bill (shop-bill items) → picked up → delivery charge → delivered with the OTP
  const seen = (await call(`/agent/orders/${o.id}`, { token: a.token, ip: a.ip })).d;
  let x;
  if (seen.items?.some((i) => i.on_bill)) {
    const f = new FormData();
    Object.entries({ amount: String(120 + (o.id % 7) * 30), shop_name: 'zt Wave 2 Shop', mode: 'agent_cash' }).forEach(([k, v]) => f.append(k, v));
    f.append('bill_photo', PNG(), 'bill.png');
    x = await call(`/agent/orders/${o.id}/bill`, { method: 'POST', token: a.token, form: f, ip: a.ip });
    if (x.s !== 204) return (o.problem = `bill ${x.s} ${JSON.stringify(x.d)}`);
  }
  x = await call(`/agent/orders/${o.id}/status`, { method: 'POST', token: a.token, body: { status: 'picked_up' }, ip: a.ip });
  if (x.s !== 204) return (o.problem = `pick up ${x.s} ${JSON.stringify(x.d)}`);
  const cur = await view(o);
  if (n(cur.delivery_fee) > 0) await call(`/agent/orders/${o.id}/fee-received`, { method: 'POST', token: a.token, body: { mode: 'cash' }, ip: a.ip });
  x = await call(`/agent/orders/${o.id}/status`, { method: 'POST', token: a.token, body: { status: 'delivered', otp: cur.delivery_otp }, ip: a.ip });
  if (x.s !== 204) return (o.problem = `deliver ${x.s} ${JSON.stringify(x.d)}`);
  o.status = 'delivered'; o.agent = a; a.done.push(o);
}
const accept = (a, o) => call(`/agent/orders/${o.id}/accept`, { method: 'POST', token: a.token, ip: a.ip });
const kirana = (await call('/services/food-daily-kirana-delivery', { city: S.id })).d;
const kiranaA = (await call('/services/food-daily-kirana-delivery', { city: A.id })).d;
const kItem = (svc, k) => ({ items: [{ product_id: svc.products.filter((p) => p.in_stock)[k % 20].id, qty: 1 }] });

// ============ A. the queue + honest waiting ============
{
  const dl = agents(S, 'delivery');
  // other (demo) Siddipet delivery partners go offline for this part, and come back as they were afterwards
  const others = (await db.query("UPDATE agents SET is_online = false WHERE franchise_id = $1 AND 'delivery' = ANY (skills) AND is_online AND user_id <> ALL ($2) RETURNING user_id", [S.id, AG.map((a) => a.id)])).rows.map((r) => r.user_id);
  for (let k = 0; k < 8; k++) CUST[k].loc = S.locs[0];
  const first = [];
  for (let k = 0; k < 3; k++) first.push(await order(CUST[k], kItem(kirana, k), `A busy-${k}`));
  for (let k = 0; k < 3; k++) await accept(dl[k], first[k]);
  const w0 = (await view(first[0])).wait;
  check('queue', 'an order a partner has taken shows no waiting note', w0 == null, JSON.stringify(w0));
  const waiting = [];
  for (let k = 3; k < 8; k++) waiting.push(await order(CUST[k], kItem(kirana, k), `A wait-${k}`));
  const ws = [];
  for (const o of waiting) ws.push((await view(o)).wait);
  check('queue', `all 3 Siddipet delivery partners busy → the 5 new orders say "busy" (3 online, 3 busy)`, ws.every((w) => w?.state === 'busy' && w.online === 3 && w.busy === 3), JSON.stringify(ws[0]));
  const base = ws[0]?.ahead ?? -1; // orders that were already waiting before ours (demo data)
  check('queue', `place in the line is right: ${ws.map((w) => w?.ahead).join(', ')} orders ahead (${base} were waiting before, then +1 each)`, ws.map((w) => w?.ahead).join() === [0, 1, 2, 3, 4].map((k) => base + k).join());
  check('queue', `wait time comes from real past deliveries: ${ws.map((w) => w?.wait_min).join(', ')} min`, ws.every((w) => w?.wait_min >= 5));
  const sees = (await call('/agent/available', { token: dl[0].token, ip: dl[0].ip })).d.map((x) => x.id);
  check('queue', 'a busy partner still sees the waiting orders (the line)', waiting.every((o) => sees.includes(o.id)));
  const x = await accept(dl[0], waiting[0]);
  check('queue', `a busy partner cannot take a 2nd order: "${x.d.error}"`, x.s >= 400 && /Finish your current order/.test(x.d.error));
  await finish(dl[0], first[0]);
  const next = (await call('/agent/available', { token: dl[0].token, ip: dl[0].ip })).d;
  const mineNext = next.find((x) => waiting.some((o) => o.id === x.id));
  check('queue', 'after delivering, the first of the waiting orders comes first in the partner\'s list (same street → oldest first)', mineNext?.id === waiting[0].id, `${mineNext?.id} vs ${waiting[0].id}`);
  const y = await accept(dl[0], waiting[0]);
  check('queue', 'the free partner takes the first waiting order', y.s === 200);
  const w1 = (await view(waiting[1])).wait;
  check('queue', `the line moves: the next order is now ${w1?.ahead} ahead (was ${base + 1}), still "busy"`, w1?.state === 'busy' && w1.ahead === base, JSON.stringify(w1));
  if (others.length) await db.query('UPDATE agents SET is_online = true WHERE user_id = ANY ($1)', [others]);
  // nobody online
  const pets = agents(A, 'beauty');
  for (const a of pets) await call('/agent/status', { method: 'PATCH', token: a.token, ip: a.ip, body: { online: false } });
  let beauty = null;
  for (const cat of (await call('/categories', { city: A.id })).d) {
    for (const s of (await call(`/categories/${cat.slug}`, { city: A.id })).d.services || []) {
      const p = (await call(`/services/${s.slug}`, { city: A.id })).d.service;
      if (p?.skill_code === 'beauty' && !(p.products || []).length) { beauty = p; break; }
    }
    if (beauty) break;
  }
  const po = beauty ? await order(CUST.find((u) => u.C === A), { service_id: beauty.id, notes: 'zt nobody online' }, `A beauty-none ${beauty.name}`) : { err: 'no beauty service in Armoor' };
  const pw = po.id ? (await view(po)).wait : null;
  check('queue', 'Armoor beauty partners all offline → the booking says "no partner is online right now"', pw?.state === 'none' && pw.online === 0, `${po.err || ''} ${JSON.stringify(pw)}`);
  for (const a of pets) await call('/agent/status', { method: 'PATCH', token: a.token, ip: a.ip, body: { online: true, locality_id: A.locs[0].id } });
  const pw2 = po.id ? (await view(po)).wait : null;
  check('queue', 'the beauty partners come online → the note goes away (a partner is free)', pw2?.state === 'free', JSON.stringify(pw2));
  // a booking for a later day
  const ev = (await call('/categories/events', { city: S.id })).d.services?.[0];
  const eo = await order(CUST[9], { service_id: ev.id, event: { event_type: 'Wedding', event_date: day(20), event_time: '11:00', guests: '200', details: 'zt wave 2' } }, 'A event-later');
  const ew = (await view(eo)).wait;
  check('queue', 'an event booked for later shows no "busy" note', ew?.state === 'later', JSON.stringify(ew));
}

// ============ C. cancel + give back ============
{
  const c = await order(CUST[20], kItem(kirana, 3), 'C cancel');
  const x = await call(`/orders/${c.id}/cancel`, { method: 'POST', token: c.u.token, ip: c.u.ip, body: { reason: 'Ordered by mistake' } });
  c.status = (await view(c)).status;
  check('cancel', 'customer cancels before a partner takes it → cancelled', x.s === 204 && c.status === 'cancelled', JSON.stringify(x.d));
  const free = agents(S, 'delivery').find((a) => !ALL.some((o) => o.agent === a && o.status !== 'delivered'));
  const y = await accept(agents(S, 'delivery')[2], c);
  check('cancel', 'nobody can accept a cancelled order', y.s >= 400, JSON.stringify(y.d));
  // give back: an Armoor home-service partner takes a booking and gives it back
  const hs = agents(A, 'home_service');
  const svc = (await call('/categories/home-services', { city: A.id })).d.services.find((s) => s.skill_code === 'home_service' || true);
  const page = (await call(`/services/${svc.slug}`, { city: A.id })).d.service;
  const r = await order(CUST.find((u) => u.C === A && u.i === 30), { service_id: page.id, notes: 'zt give back test' }, 'C release');
  const who = agents(A, r.skill);
  await accept(who[0], r);
  const z = await call(`/agent/orders/${r.id}/release`, { method: 'POST', token: who[0].token, ip: who[0].ip, body: { reason: 'Bike puncture' } });
  const rv = await view(r);
  const others = (await call('/agent/available', { token: who[1].token, ip: who[1].ip })).d.map((q) => q.id);
  check('cancel', `partner gives a booking back ("Bike puncture") → waiting again, the customer sees why, the other ${r.skill} partners get it`,
    z.s === 204 && rv.status === 'placed' && JSON.stringify(rv.events).includes('Bike puncture') && others.includes(r.id), `${z.s} ${rv.status}`);
  void free; void hs;
}

// ============ C2. the free first delivery, when a NEW customer taps "Place order" 3 times at once ============
{
  const fresh = [];
  for (let k = 1; k <= 4; k++) {
    const phone = `730000000${k}`, ip = `10.80.0.${k}`;
    await db.query('DELETE FROM phone_otps WHERE phone = $1', [phone]);
    const rq = await call('/auth/phone/request', { method: 'POST', body: { phone }, ip });
    const v = await call('/auth/phone/verify', { method: 'POST', body: { phone, code: rq.d.devCode, portal: 'user' }, ip });
    const c = await call('/auth/phone/complete', { method: 'POST', body: { proof: v.d.proof, fullName: `Zt LT New ${k}`, password: PASS }, ip });
    await db.query("UPDATE users SET username = $1 WHERE phone = $2 AND role = 'customer'", [`zt_lt_new_${k}`, phone]);
    fresh.push({ C: S, i: 900 + k, name: `Zt LT New ${k}`, phone, ip, loc: S.locs[k % S.locs.length], token: c.d.token });
  }
  const freeLeft = (await call('/orders/offer', { token: fresh[0].token, ip: fresh[0].ip })).d.free_left;
  const got = [];
  for (const u of fresh) {
    const os = await Promise.all([0, 1, 2].map((k) => order(u, kItem(kirana, 30 + k), `C2 new ${u.phone}.${k}`)));
    got.push(os.filter((o) => o.id && o.fee === 0).length);
  }
  check('fees', `a new customer gets ${freeLeft} free deliver${freeLeft === 1 ? 'y' : 'ies'}, even tapping "Place order" 3 times at once (free: ${got.join(', ')})`,
    got.every((g) => g === Math.min(3, freeLeft)), `free per customer: ${got.join(', ')}`);
}

// ============ D. car models ============
{
  const cars = agents(S, 'car_rental_agent');
  const models = (await call('/share-ride/models')).d;
  const svc = (await call('/categories/vehicle-rental', { city: S.id })).d.services[0];
  const trips = [];
  for (const a of cars) {
    const m = models.find((x) => x.id === a.model);
    const o = await order(CUST[40 + a.k], { service_id: svc.id, trip: { trip_type: 'Round trip', drop: 'Tirupati', trip_date: day(6), trip_time: '05:00', car_model_id: String(a.model) } }, `D car ${m.name}`);
    trips.push({ o, a, m });
  }
  const sees = {};
  for (const a of cars) sees[a.id] = (await call('/agent/available', { token: a.token, ip: a.ip })).d.map((x) => x.id);
  const ok = trips.every(({ o, a }) => cars.every((b) => sees[b.id].includes(o.id) === (b === a)));
  check('cars', `each car booking (${trips.map((t) => t.m.name).join(', ')}) goes ONLY to the partner with that car model`, ok,
    trips.map(({ o, m }) => `${m.name}: ${cars.filter((b) => sees[b.id].includes(o.id)).map((b) => b.k).join('/')}`).join(' · '));
  const t0 = trips.find((t) => /Ertiga/.test(t.m.name)); // Ertiga (6) → the 6–7 seater group also has the Innova (7); the Dzire (4) stays out
  const same = cars.filter((b) => b !== t0.a && /Innova/.test(models.find((x) => x.id === b.model).name));
  const x = await call(`/orders/${t0.o.id}/any-car`, { method: 'POST', token: t0.o.u.token, ip: t0.o.u.ip });
  const after = await pool(cars, 3, async (b) => (await call('/agent/available', { token: b.token, ip: b.ip })).d.some((q) => q.id === t0.o.id));
  check('cars', `"Any 6–7 seater" on the ${t0.m.name} booking → also offered to ${same.map((b) => models.find((x) => x.id === b.model).name).join(', ') || 'no other same-size car'}`,
    x.s === 200 && cars.every((b, i) => after[i] === (b === t0.a || same.includes(b))), `${x.s} ${JSON.stringify(after)}`);
}

// clear everything waiting so far (A, C, D) before the burst
async function drain(label) {
  const t = Date.now();
  let taps = 0, lost = 0;
  const lat = [];
  await Promise.all(AG.map(async (a) => {
    // finish what this agent already holds
    for (const o of ALL.filter((x) => x.status !== 'delivered')) {
      const v = await call(`/agent/orders/${o.id}`, { token: a.token, ip: a.ip });
      if (v.s === 200 && v.d.agent_id === a.id && ['assigned', 'picked_up'].includes(v.d.status)) await finish(a, o);
    }
    for (let guard = 0; guard < 400; guard++) {
      const av = await call('/agent/available', { token: a.token, ip: a.ip });
      lat.push(av.ms);
      const list = (Array.isArray(av.d) ? av.d : []).filter((x) => ALL.some((o) => o.id === x.id && o.status !== 'delivered' && o.status !== 'cancelled'));
      if (!list.length) return;
      const pick = list[(a.k - 1) % Math.min(list.length, 3)];
      taps++;
      const r = await accept(a, pick);
      if (r.s !== 200) { lost++; continue; }
      await finish(a, ALL.find((o) => o.id === pick.id));
    }
  }));
  return { secs: ((Date.now() - t) / 1000).toFixed(1), taps, lost, p50: pct(lat, 0.5), p95: pct(lat, 0.95), max: Math.max(...lat) };
}
{
  const d = await drain('before burst');
  const open = ALL.filter((o) => o.status !== 'delivered' && !['C cancel'].includes(o.label));
  check('queue', `every waiting order of A–D delivered by its partners (${ALL.filter((o) => o.status === 'delivered').length}) in ${d.secs}s`, !open.length,
    open.map((o) => `${o.label}#${o.id} ${o.problem || ''}`).join(' | '));
}

// ============ F. BURST: 5 orders per customer at the same moment ============
const plans = {};
for (const C of CITIES) {
  const shops = ['food-daily-kirana-delivery', 'food-daily-fruit-delivery', 'food-daily-fresh-vegetables', 'food-daily-egg-delivery', 'pooja-store'];
  plans[C.id] = [];
  for (const slug of shops) {
    const d = (await call(`/services/${slug}`, { city: C.id })).d;
    const ps = (d.products || []).filter((p) => p.in_stock);
    if (ps.length) plans[C.id].push((k) => ({ items: [{ product_id: ps[k % ps.length].id, qty: 1 + (k % 2) }, { product_id: ps[(k + 7) % ps.length].id, qty: 1 }] }));
  }
  const hsv = (await call('/categories/home-services', { city: C.id })).d.services.slice(0, 6);
  for (const s of hsv) { const p = (await call(`/services/${s.slug}`, { city: C.id })).d.service; if (p && !p.is_village && !(p.source_service_ids || []).length) plans[C.id].push(() => ({ service_id: p.id, notes: 'zt burst booking' })); }
}
// the quote the checkout shows for each customer's FIRST burst order (the charge on that order must equal it)
const burstJobs = [];
for (const u of CUST) for (let k = 0; k < BURST; k++) { const pl = plans[u.C.id]; burstJobs.push({ u, k, body: pl[(u.i + k) % pl.length](u.i * 7 + k), first: k === 0 }); }
const quotes = {};
await pool(burstJobs.filter((j) => j.first), 20, async (j) => {
  const b = j.body, qs = b.items ? `products=${b.items.map((i) => i.product_id).join(',')}` : `service=${b.service_id}`;
  quotes[j.u.id] = n((await call(`/orders/quote?${qs}`, { token: j.u.token, ip: j.u.ip, city: j.u.C.id })).d.delivery_fee);
  j.u.freeLeft = (await call('/orders/offer', { token: j.u.token, ip: j.u.ip })).d.free_left; // the home banner's number
});
const pollLat = [];
let polling = true;
const pollers = AG.slice(0, 20).map(async (a) => { while (polling) { const r = await call('/agent/available', { token: a.token, ip: a.ip }); pollLat.push(r.ms); } });
const tb = Date.now();
// at most 300 requests open at once — like nginx in front of the API on the server (Windows on this PC refuses
// more than ~200 brand-new connections waiting at the same instant, whatever the app asks for)
const burst = await pool(burstJobs, 300, (j) => order(j.u, j.body, `F burst ${j.u.C.key}${j.u.i}.${j.k}`).then((o) => Object.assign(o, { job: j })));
const burstSecs = ((Date.now() - tb) / 1000).toFixed(1);
polling = false;
await Promise.all(pollers);
const bOk = burst.filter((o) => o.id), bLat = burst.map((o) => o.ms);
check('burst', `${burst.length} orders placed at the same moment by ${CUST.length} customers: ${bOk.length} ok in ${burstSecs}s · median ${pct(bLat, 0.5)} ms, 95% under ${pct(bLat, 0.95)} ms, slowest ${Math.max(...bLat)} ms`,
  bOk.length === burst.length, [...new Set(burst.filter((o) => !o.id).map((o) => `${o.s} ${o.err}`))].join(' | '));
check('burst', `agents' order list stays quick while 1,000 orders arrive: median ${pct(pollLat, 0.5)} ms, 95% ${pct(pollLat, 0.95)} ms (${pollLat.length} polls)`, pct(pollLat, 0.95) < 3000);
const dupIds = bOk.length - new Set(bOk.map((o) => o.id)).size;
check('burst', 'every order got its own number (no duplicates)', dupIds === 0);
const wrongCity = (await db.query('SELECT o.id FROM orders o WHERE o.id = ANY($1) AND o.franchise_id <> $2', [bOk.filter((o) => o.C === S).map((o) => o.id), S.id])).rows;
check('burst', 'every Siddipet burst order is in Siddipet, every Armoor one in Armoor', !wrongCity.length &&
  !(await db.query('SELECT 1 FROM orders o WHERE o.id = ANY($1) AND o.franchise_id <> $2', [bOk.filter((o) => o.C === A).map((o) => o.id), A.id])).rowCount);
const firstWithQuote = bOk.filter((o) => o.job.first);
// a paid quote must be charged exactly; a ₹0 quote (free delivery still left) may lose the free one to the same
// customer's other order placed in the same moment — then exactly one of their shop orders is the free one
const paidQuote = firstWithQuote.filter((o) => quotes[o.u.id] > 0);
const feeBad = paidQuote.filter((o) => o.fee !== quotes[o.u.id]);
check('fees', `delivery charge on each first burst order with a paid quote = the quote (${paidQuote.length} orders: ${[...new Set(paidQuote.map((o) => `₹${o.fee}`))].join(', ')})`, !feeBad.length,
  feeBad.slice(0, 5).map((o) => `#${o.id} charged ₹${o.fee}, quote ₹${quotes[o.u.id]}`).join(' | '));
const shopOrders = bOk.filter((o) => o.body.items);
const freeLeftUsers = new Set(CUST.filter((u) => u.freeLeft > 0 && shopOrders.some((o) => o.u === u)).map((u) => u.id));
const freeBad = CUST.filter((u) => shopOrders.filter((o) => o.u === u && !o.fee).length !== (freeLeftUsers.has(u.id) ? 1 : 0));
check('fees', `5 orders at once: customers with no free delivery left pay on every shop order; the ${freeLeftUsers.size} who still had one get it on exactly ONE order (${shopOrders.length} shop orders)`,
  !freeBad.length, freeBad.slice(0, 5).map((u) => `${u.name}: ${shopOrders.filter((o) => o.u === u && !o.fee).length} free`).join(', '));
const w = (await view(bOk.find((o) => o.skill === 'delivery'))).wait;
check('queue', `with ~${bOk.filter((o) => o.skill === 'delivery').length / 2} delivery orders per city waiting, customers are told the truth: "${w?.state}", ${w?.ahead} ahead, ${w?.online} partners`, w && w.state !== 'none');

const dr = await drain('burst');
const open = ALL.filter((o) => o.status !== 'delivered' && o.label !== 'C cancel');
check('burst', `${ALL.filter((o) => o.status === 'delivered').length} orders delivered in all; the line cleared in ${dr.secs}s by 84 agents (${dr.taps} accept taps, ${dr.lost} lost the race) · order list median ${dr.p50} ms, 95% ${dr.p95} ms`,
  !open.length, open.slice(0, 8).map((o) => `${o.label}#${o.id} ${o.problem || ''}`).join(' | '));
const twice = (await db.query(`SELECT order_id FROM order_events WHERE order_id = ANY($1) AND status = 'assigned' GROUP BY order_id HAVING count(DISTINCT actor_id) > 1`, [ALL.map((o) => o.id)])).rows
  .filter((r) => !ALL.find((o) => o.id === r.order_id)?.label.startsWith('C release'));
check('burst', 'no order was ever taken by two agents', !twice.length, twice.map((r) => r.order_id).join(','));

// ============ E. ratings ============
const rated = ALL.filter((o) => o.status === 'delivered').slice(0, 150);
await pool(rated, 15, async (o) => {
  o.stars = 1 + (o.id % 5);
  const r = await call(`/orders/${o.id}/rating`, { method: 'POST', token: o.u.token, ip: o.u.ip, body: { stars: o.stars, comment: 'zt wave 2', tags: ['On time'] } });
  if (r.s !== 200) o.rateErr = JSON.stringify(r.d);
});
check('ratings', `${rated.length} customers rate their delivered order`, !rated.some((o) => o.rateErr), rated.find((o) => o.rateErr)?.rateErr);
const rateBad = [];
await pool(AG.filter((a) => rated.some((o) => o.agent === a)), 10, async (a) => {
  const mine = rated.filter((o) => o.agent === a);
  const me = (await call('/agent/me', { token: a.token, ip: a.ip })).d.stats.rating;
  const avg = Math.round((sum(mine, (o) => o.stars) / mine.length) * 10) / 10;
  if (me.count !== mine.length || Math.abs(n(me.avg) - avg) > 0.05) rateBad.push(`${a.full}: ${me.count}×${me.avg} vs ${mine.length}×${avg}`);
});
check('ratings', 'each agent\'s rating in their app = the average of their stars', !rateBad.length, rateBad.slice(0, 4).join(' | '));
const bad = await call(`/orders/${rated[0].id}/rating`, { method: 'POST', token: rated[1].u.token, ip: rated[1].u.ip, body: { stars: 5 } });
check('ratings', 'a customer cannot rate someone else\'s order', bad.s >= 400);

// ============ the numbers, again ============
const fromDb = (await db.query(`SELECT o.id, o.franchise_id, o.status, o.total, o.delivery_fee, o.agent_earning, o.kind, o.agent_id FROM orders o WHERE o.id = ANY($1)`, [ALL.map((o) => o.id)])).rows;
for (const C of CITIES) {
  const mine = fromDb.filter((r) => r.franchise_id === C.id), done = mine.filter((r) => r.status === 'delivered');
  const exp = { orders: mine.length, delivered: done.length, cancelled: mine.filter((r) => r.status === 'cancelled').length,
    revenue: sum(done, (r) => n(r.total)), delivery_fees: sum(done, (r) => n(r.delivery_fee)), agent_pay: sum(done, (r) => n(r.agent_earning)), new_customers: C === S ? 4 : 0 } // the 4 new customers of C2;
  const rep = (await call(`/admin/reports?${RANGE}`, { token: C.token })).d;
  const diffs = Object.keys(exp).map((k) => [k, n(rep.kpis[k]) - n(C.before.kpis[k]), exp[k]]);
  check(`franchise ${C.name}`, `Reports after wave 2 · ${diffs.map(([k, g]) => `${k} +${g}`).join(', ')}`, diffs.every(([, g, e]) => g === e), diffs.filter(([, g, e]) => g !== e).map(([k, g, e]) => `${k} ${g}≠${e}`).join(', '));
  const agBad = [];
  for (const a of AG.filter((x) => x.C === C)) {
    const row = rep.agents.find((x) => x.user_id === a.id) || {}, was = C.before.agents.find((x) => x.user_id === a.id) || {};
    const myDone = done.filter((r) => r.agent_id === a.id);
    const e = [myDone.length, sum(myDone, (r) => n(r.agent_earning)), sum(myDone, (r) => n(r.total))];
    const g = [n(row.delivered) - n(was.delivered), n(row.earnings) - n(was.earnings), n(row.order_value) - n(was.order_value)];
    if (e.join() !== g.join()) agBad.push(`${a.full}: ${g} vs ${e}`);
  }
  check(`franchise ${C.name}`, 'Reports · each agent\'s deliveries, earnings, order value after wave 2', !agBad.length, agBad.slice(0, 4).join(' | '));
  const catRev = (r) => sum(r.by_category || [], (x) => n(x.revenue));
  check(`franchise ${C.name}`, `Reports · categories + delivery charges = revenue (wave 2: ₹${catRev(rep) - catRev(C.before)} + ₹${exp.delivery_fees} = ₹${exp.revenue})`,
    catRev(rep) - catRev(C.before) + exp.delivery_fees === exp.revenue);
  const h = (await call(`/super/reports?${RANGE}&franchise=${C.id}`, { token: hq })).d;
  const hd = [['completed', done.length], ['revenue', exp.revenue], ['delivery_charges', exp.delivery_fees]].map(([k, e]) => [k, n(h.totals[k]) - n(C.hqBefore.totals[k]), e]);
  check(`HQ · ${C.name}`, `HQ Reports (${C.name}) after wave 2 · ${hd.map(([k, g]) => `${k} +${g}`).join(', ')}`, hd.every(([, g, e]) => g === e), hd.filter(([, g, e]) => g !== e).map(([k, g, e]) => `${k} ${g}≠${e}`).join(', '));
  C.exp = exp;
}
const hAll = (await call(`/super/reports?${RANGE}`, { token: hq })).d;
check('HQ · all cities', `HQ Reports (all cities) · revenue +₹${n(hAll.totals.revenue) - n(before.hq.totals.revenue)} = Siddipet + Armoor`, n(hAll.totals.revenue) - n(before.hq.totals.revenue) === sum(CITIES, (C) => C.exp.revenue));
// agents' wallets
const walBad = [];
await pool(AG, 10, async (a) => {
  const me = (await call('/agent/me', { token: a.token, ip: a.ip })).d.stats;
  const all = (await db.query("SELECT count(*)::int c, coalesce(sum(agent_earning),0)::numeric e FROM orders WHERE agent_id = $1 AND status = 'delivered'", [a.id])).rows[0];
  if (me.total_deliveries !== all.c || n(me.lifetime_earnings) !== n(all.e)) walBad.push(`${a.full}: app ${me.total_deliveries}/₹${me.lifetime_earnings} vs db ${all.c}/₹${all.e}`);
  const wal = (await call('/agent/wallet', { token: a.token, ip: a.ip }));
  if (wal.s !== 200) walBad.push(`${a.full}: wallet ${wal.s}`);
});
check('agent app', 'every agent\'s app: total deliveries + lifetime earnings = their delivered orders; wallet opens', !walBad.length, walBad.slice(0, 4).join(' | '));

const report = { date: new Date().toISOString(), minutes: ((Date.now() - T0) / 60000).toFixed(1), pass, fail,
  burst: { orders: burst.length, seconds: burstSecs, p50: pct(bLat, 0.5), p95: pct(bLat, 0.95), max: Math.max(...bLat), poll_p50: pct(pollLat, 0.5), poll_p95: pct(pollLat, 0.95), drain: dr },
  cities: CITIES.map((C) => ({ name: C.name, expected: C.exp })), results };
fs.writeFileSync(`${DIR}/wave2_report.json`, JSON.stringify(report, null, 1));
console.log(`\n${pass} passed, ${fail} failed · ${report.minutes} min`);
await db.end();
