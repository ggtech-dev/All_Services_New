// 🏙️ Full-day simulation (LOCAL only), kept afterwards so the user can log in and look around:
//   20 customers user1–user20 sign up with mobile OTP + password (phones 9000300101–9000300120)
//   10 agents agent1–agent10 apply with OTP + documents, the franchise admin approves them (phones 9000300201–9000300210)
//   ~30 orders of every kind; agents accept / bill / pick up / deliver; cancels, give-backs, admin assign & cancel,
//   two agents tapping Accept at the same moment, ratings, Share Ride seats, Village Needs, Shop For Me, Instant.
// Then every number on the franchise Reports page, HQ reports & dashboard and the agents' wallets is checked against
// what this script itself did (an independent count, not the same SQL).
// Start again from zero: node sim_reset.mjs && node sim_all.mjs
import fs from 'node:fs';
import pg from 'pg';
const realFetch = globalThis.fetch;
await import('./testadmin.mjs'); // zt_admin (Siddipet franchise admin) + zt_super (HQ) test logins
globalThis.fetch = realFetch; // no automatic "fee paid": this script confirms delivery charges itself

const API = 'http://localhost:5000/api';
const PASS = process.env.TEST_USER_PW;
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');

let pass = 0, fail = 0;
const fails = [];
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra ? ` — ${String(extra).slice(0, 220)}` : ''}`);
  if (cond) pass++; else { fail++; fails.push(label); }
};
// every person has their own phone (own IP address), like in real life
async function call(p, { method = 'GET', body, token, form, ip = '10.30.0.1', raw } = {}) {
  const headers = { 'X-Forwarded-For': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await realFetch(API + p, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  if (raw) return res;
  const text = res.status === 204 ? '' : await res.text();
  let d = {};
  try { d = text ? JSON.parse(text) : {}; } catch { d = { raw: text.slice(0, 120) }; }
  return { s: res.status, d };
}
const ok2 = (r) => r.s >= 200 && r.s < 300;
const n = (x) => Number(x || 0);
const pad = (i) => String(i).padStart(2, '0');
const IMG = new Blob([fs.readFileSync('./shots/ride-ticket.png')], { type: 'image/png' });
const todayIST = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const RANGE = `from=${todayIST}&to=${todayIST}`;

// ---------- staff logins + "before" numbers ----------
const admin = (await call('/auth/login', { method: 'POST', body: { username: 'zt_admin', password: process.env.TEST_STAFF_PW, portal: 'admin' } })).d.token;
const hq = (await call('/auth/login', { method: 'POST', body: { username: 'zt_super', password: process.env.TEST_STAFF_PW, portal: 'superadmin' } })).d.token;
check('franchise admin + HQ logged in', admin && hq);
const before = {
  rep: (await call(`/admin/reports?${RANGE}`, { token: admin })).d,
  hqRep: (await call(`/super/reports?${RANGE}`, { token: hq })).d,
  dash: (await call('/super/dashboard', { token: hq })).d,
};
check('reports open before the simulation', before.rep.kpis && before.hqRep.totals && before.dash, JSON.stringify(before.rep).slice(0, 100));
const locs = (await call('/localities')).d;
const town = locs.filter((l) => !l.is_village);
const village = locs.find((l) => l.is_village && l.village_band === 1);
const types = Object.fromEntries((await call('/service-types')).d.map((t) => [t.code, t.name]));

// ---------- OTP helper (test mode shows the code; no SMS is sent) ----------
async function otp(phone, portal, ip, extra = {}) {
  await db.query('DELETE FROM phone_otps WHERE phone = $1', [phone]);
  const r = await call('/auth/phone/request', { method: 'POST', body: { phone }, ip });
  if (!r.d.devCode) throw new Error(`OTP for ${phone}: ${r.d.error || r.s}`);
  return call('/auth/phone/verify', { method: 'POST', body: { phone, code: r.d.devCode, portal, ...extra }, ip });
}

// =====================================================================================
// 1) 20 customers sign up (mobile → OTP → name + password), then log in with mobile + password
// =====================================================================================
const users = [];
for (let i = 1; i <= 20; i++) {
  const u = { i, name: `User${i}`, phone: `90003001${pad(i)}`, ip: `10.30.1.${i}`, loc: town[i % town.length] };
  const v = await otp(u.phone, 'user', u.ip);
  const c = await call('/auth/phone/complete', { method: 'POST', body: { proof: v.d.proof, fullName: u.name, password: PASS }, ip: u.ip });
  if (!c.d.token) { check(`user${i} signs up`, false, JSON.stringify(c.d)); continue; }
  await db.query("UPDATE users SET username = $1 WHERE phone = $2 AND role = 'customer'", [`user${i}`, u.phone]);
  const l = await call('/auth/login', { method: 'POST', body: { username: u.phone, password: PASS, portal: 'user' }, ip: u.ip });
  u.token = l.d.token;
  u.id = l.d.user?.id;
  users.push(u);
}
check('20 customers signed up with OTP + password', users.length === 20 && users.every((u) => u.token));
check('customer logs in with username too (user1)', !!(await call('/auth/login', { method: 'POST', body: { username: 'user1', password: PASS, portal: 'user' } })).d.token);
check('wrong password refused', (await call('/auth/login', { method: 'POST', body: { username: users[0].phone, password: 'wrong123', portal: 'user' } })).s === 401);
check('signing up again with the same number logs in (no 2nd account)',
  (await otp(users[1].phone, 'user', users[1].ip)).d.token && (await db.query("SELECT count(*)::int c FROM users WHERE phone = $1", [users[1].phone])).rows[0].c === 1);
const U = (i) => users[i - 1];

// =====================================================================================
// 2) 10 agents apply, franchise admin approves
// =====================================================================================
const AG = [
  { n: 1, name: 'Ravi', skills: ['delivery'], veh: 'bike' },
  { n: 2, name: 'Kiran', skills: ['delivery'], veh: 'bike' },
  { n: 3, name: 'Sai', skills: ['delivery', 'instant'], veh: 'scooter' },
  { n: 4, name: 'Ramesh', skills: ['our_service_employees'], veh: 'scooter' },
  { n: 5, name: 'Naresh', skills: ['home_service'], veh: 'bike' },
  { n: 6, name: 'Suresh', skills: ['vehicle'], veh: 'bike' },
  { n: 7, name: 'Lakshmi', skills: ['beauty'], veh: 'scooter' },
  { n: 8, name: 'Srinivas', skills: ['events_agent'], veh: 'bike' },
  { n: 9, name: 'Mahesh', skills: ['car_rental_agent'], veh: 'car' },
  { n: 10, name: 'Venkat', skills: ['shared_car_agent'], veh: 'car', car: true },
].map((a) => ({ ...a, full: `Agent${a.n} ${a.name}`, phone: `90003002${pad(a.n)}`, ip: `10.30.2.${a.n}`, delivered: 0, earn: 0, cash: 0, handled: 0, released: 0 }));
const A = (k) => AG[k - 1];
const models = (await call('/share-ride/models')).d;
const ertiga = models.find((m) => /Ertiga/.test(m.name)) || models[0];
for (const a of AG) {
  const v = await otp(a.phone, 'agent_apply', a.ip);
  const f = new FormData();
  const fields = { phone_proof: v.d.proof, full_name: a.full, locality_id: town[0].id, aadhaar_number: `1234567890${pad(a.n)}`, pan_number: 'ABCDE1234F',
    dl_number: `TS09202000${pad(a.n)}345`, vehicle_type: a.veh, vehicle_number: `TS36AG00${pad(a.n)}`, skills: a.skills.join(',') };
  if (a.car) Object.assign(fields, { owner_type: 'car', car_model_id: ertiga.id, reg_number: 'TS36SM0010', car_color: 'White', yellow_board: 'true' });
  Object.entries(fields).forEach(([k, x]) => f.append(k, x));
  for (const d of ['aadhaar_doc', 'pan_doc', 'dl_doc', 'photo_doc', ...(a.car ? ['rc_doc', 'permit_doc', 'insurance_doc'] : [])]) f.append(d, IMG, `${d}.png`);
  const r = await call('/agents/apply', { method: 'POST', form: f, ip: a.ip });
  if (r.s !== 201) check(`${a.full} applies`, false, JSON.stringify(r.d));
  a.id = (await db.query("SELECT id FROM users WHERE phone = $1 AND role = 'agent'", [a.phone])).rows[0]?.id;
}
check('10 agents applied (OTP-verified number + documents)', AG.every((a) => a.id));
let adminAgents = (await call('/admin/agents', { token: admin })).d;
const list = Array.isArray(adminAgents) ? adminAgents : adminAgents.agents || [];
check('franchise admin sees all 10 waiting for approval', AG.every((a) => list.some((x) => x.user_id === a.id && x.status === 'pending')), JSON.stringify(list.find((x) => x.user_id === AG[0].id)));
check('agent cannot log in before approval', !(await otp(A(1).phone, 'agent', A(1).ip)).d.token);
// HQ can do everything a franchise admin does in operations (by design); here it only watches
const hqAgents = (await call('/admin/agents', { token: hq })).d;
check('HQ also sees the 10 applications', AG.every((a) => (Array.isArray(hqAgents) ? hqAgents : hqAgents.agents || []).some((x) => x.user_id === a.id)));
for (const a of AG.filter((x) => !x.car)) {
  const r = await call(`/admin/agents/${a.id}/review`, { method: 'POST', token: admin, body: { approve: true } });
  if (r.s !== 204) check(`approve ${a.full}`, false, JSON.stringify(r.d));
}
const carRow = (await call('/share-ride/admin', { token: admin })).d.cars?.find((c) => c.owner_id === A(10).id);
check('car owner\'s car waits for approval with RC, permit, insurance', carRow?.status === 'pending' && carRow.has_rc && carRow.has_permit && carRow.has_insurance, JSON.stringify(carRow));
check('franchise admin approves the car (and its owner)', (await call(`/share-ride/admin/cars/${carRow?.id}/review`, { method: 'POST', token: admin, body: { action: 'approve' } })).s === 204);
// subscriptions asked for by the agents' types (car rental, Share Ride, …): admin switches them on (free, 30 days)
const subs = (await db.query("SELECT id FROM agent_subscriptions WHERE agent_id = ANY($1) AND status <> 'active'", [AG.map((a) => a.id)])).rows;
for (const s of subs) {
  const r = await call(`/admin/subscriptions/${s.id}/activate`, { method: 'POST', token: admin, body: { amount: 0, mode: 'free', days: 30 } });
  if (!ok2(r)) check(`subscription #${s.id} activated`, false, JSON.stringify(r.d));
}
check(`subscriptions activated (${subs.length})`, (await db.query("SELECT count(*)::int c FROM agent_subscriptions WHERE agent_id = ANY($1) AND status <> 'active'", [AG.map((a) => a.id)])).rows[0].c === 0);
for (const a of AG) {
  await db.query('UPDATE users SET username = $1 WHERE id = $2', [`agent${a.n}`, a.id]);
  const t = await otp(a.phone, 'agent', a.ip);
  a.token = t.d.token;
  await call('/agent/status', { method: 'PATCH', token: a.token, body: { online: true, locality_id: town[0].id }, ip: a.ip });
  await call('/agent/location', { method: 'POST', token: a.token, body: { lat: town[0].lat, lng: town[0].lng, accuracy: 15 }, ip: a.ip });
}
check('all 10 agents log in with OTP and go online', AG.every((a) => a.token));
const st = (await db.query("SELECT u.phone, a.status, a.skills FROM agents a JOIN users u ON u.id = a.user_id WHERE a.user_id = ANY($1)", [AG.map((a) => a.id)])).rows;
check('every agent active with exactly their own types', AG.every((a) => { const r = st.find((x) => x.phone === a.phone); return r?.status === 'active' && r.skills.slice().sort().join() === a.skills.slice().sort().join(); }),
  JSON.stringify(st));

// =====================================================================================
// 3) catalog the customers order from
// =====================================================================================
const svc = async (slug) => (await call(`/services/${slug}`)).d;
const inStock = (s) => (s.products || []).filter((p) => p.in_stock);
const fruit = await svc('food-daily-fruit-delivery');
const kirana = await svc('food-daily-kirana-delivery');
const instant = await svc('food-daily-instant-delivery');
const villageSvc = await svc('village-needs-village-needs');
const sfmElec = await svc('shop-for-me-electrical-items');
const sfmPlumb = await svc('shop-for-me-plumbing-sanitary-items');
const water = (await call('/home-cards')).d[0];
const catSvc = {};
for (const c of ['home-services', 'vehicle', 'personal', 'events', 'vehicle-rental']) for (const s of (await call(`/categories/${c}`)).d.services || []) catSvc[s.slug] = s;
const plumber = catSvc['home-services-plumber-on-demand'], electrician = catSvc['home-services-electrician-on-demand'];
const puncture = catSvc['vehicle-bike-puncture-service'], salon = catSvc['personal-beauty-salon-at-home'];
const photo = catSvc['events-photography'], carBook = catSvc['vehicle-rental-car-booking'];
check('catalog loaded (fruit, kirana, instant, village, Shop For Me, water, plumber, puncture, salon, photography, car)',
  inStock(fruit).length && inStock(kirana).length && instant.service && villageSvc.service && sfmElec.service && water?.products?.length && plumber && electrician && puncture && salon && photo && carBook);
const banana = inStock(fruit)[0], apple = inStock(fruit)[1] || inStock(fruit)[0], rice = inStock(kirana)[0];
const instProd = inStock(instant)[0], villProd = inStock(villageSvc)[0];

// =====================================================================================
// 4) customers place their orders (each phone's first order with a delivery charge is free — launch offer)
// =====================================================================================
const offerUsed = {};
const ORD = []; // what the script expects for every order
const day = (k) => new Date(Date.now() + k * 864e5 + 330 * 60000).toISOString().slice(0, 10);
// 📍 the delivery location: the chosen area's own map position (a customer standing there)
const pinOf = (id) => { const l = locs.find((x) => x.id === id); return { lat: Number(l.lat), lng: Number(l.lng) }; };
const contact = (u, loc = u.loc.id) => ({ name: u.name, phone: u.phone, address_line: `H.No ${u.i}-4-${u.i * 7}, Sim Colony`, landmark: 'Near Hanuman temple', locality_id: loc, ...pinOf(loc) });
async function place(u, body, { base = 0, village: vil = false, label }) {
  const expFee = vil ? base : base > 0 && !offerUsed[u.phone] ? 0 : base;
  const r = await call('/orders', { method: 'POST', token: u.token, body: { contact: contact(u, body.loc), slot: 'As soon as possible', ...body, loc: undefined }, ip: u.ip });
  if (r.s !== 201) { check(`${label}: placed`, false, JSON.stringify(r.d)); return null; }
  const o = { id: r.d.id, u, label, base, village: vil, fee: n(r.d.delivery_fee), expFee, subtotal: n(r.d.subtotal), total: n(r.d.total), skill: r.d.skill_code,
    kind: r.d.kind, loc: r.d.locality_id, status: 'placed', waived: !vil && base > 0 && expFee === 0, event: !!r.d.event_details, trip: !!r.d.trip_details };
  if (o.waived) offerUsed[u.phone] = true;
  ORD.push(o);
  check(`${label}: placed, delivery ₹${o.fee} (expected ₹${expFee}), total ₹${o.total}`, o.fee === expFee && o.total === o.subtotal + o.fee, JSON.stringify({ fee: o.fee, expFee, sub: o.subtotal, total: o.total }));
  return o;
}
const slotOf = async (u, q) => (await call(`/orders/quote?${q}`, { token: u.token })).d;

const O = {};
O.u1water = await place(U(1), { items: [{ product_id: water.products[0].id, qty: 2 }] }, { label: 'user1 💧 2 water cans (₹25 incl. delivery)' });
check('water order goes to our own staff', O.u1water?.skill === 'our_service_employees' && O.u1water.total === 50);
O.u1fruit = await place(U(1), { items: [{ product_id: banana.id, qty: 1 }] }, { base: 30, label: 'user1 🍌 fruit after water (offer still unused → free)' });
O.u2fruit = await place(U(2), { items: [{ product_id: apple.id, qty: 2 }] }, { base: 30, label: 'user2 🍎 fruit (first order → free)' });
O.u2fruit2 = await place(U(2), { items: [{ product_id: banana.id, qty: 1 }] }, { base: 30, label: 'user2 🍌 second order → ₹30' });
O.u3kirana = await place(U(3), { items: [{ product_id: rice.id, qty: 1 }, { service_id: kirana.service.id, name: 'Sugar', qty_text: '1 kg' }] }, { base: 30, label: 'user3 🛒 kirana + own list (shop bill)' });
O.u4instant = await place(U(4), { via_service_id: instant.service.id, items: [{ product_id: instProd.id, qty: 1 }, { service_id: instant.service.id, name: 'Dettol soap', qty_text: '2' }] },
  { base: n(instant.service.delivery_fee), label: 'user4 ⚡ Instant (shop + Others)' });
check('instant order goes to instant agents only', O.u4instant?.skill === 'instant');
const sfm = (s, names) => names.map((x) => ({ service_id: s.service.id, name: x, qty_text: '1' }));
O.u5sfm = await place(U(5), { items: sfm(sfmElec, ['LED bulb 9W', 'Extension board', 'Switch']), shop_name: 'Sri Sai Electricals' }, { base: 50, label: 'user5 🛠️ Shop For Me (big bill, UPI to shop)' });
O.u6sfm = await place(U(6), { items: sfm(sfmPlumb, ['Tap washer', 'Teflon tape']) }, { base: 50, label: 'user6 🛠️ Shop For Me first → free' });
O.u6sfm2 = await place(U(6), { items: sfm(sfmPlumb, ['Ball valve']) }, { base: 50, label: 'user6 🛠️ Shop For Me second → ₹50 (stays waiting)' });
O.u7plumber = await place(U(7), { service_id: plumber.id, notes: 'Kitchen tap leaking' }, { label: 'user7 🔧 plumber visit (talk price, no charge)' });
O.u7fruit = await place(U(7), { items: [{ product_id: banana.id, qty: 1 }] }, { base: 30, label: 'user7 🍌 fruit after plumber visit (offer still unused → free)' });
O.u8elec = await place(U(8), { service_id: electrician.id, notes: 'Fan not working' }, { label: 'user8 💡 electrician (stays in progress)' });
O.u9punct = await place(U(9), { service_id: puncture.id }, { label: 'user9 🏍️ bike puncture ₹99' });
O.u10salon = await place(U(10), { service_id: salon.id }, { label: 'user10 💇 beauty salon at home ₹499' });
O.u11photo = await place(U(11), { service_id: photo.id, event: { event_type: 'Birthday', event_date: day(10), event_time: '18:00', guests: '80', details: 'Candid photos' } }, { label: 'user11 📸 photography booking' });
O.u12car = await place(U(12), { service_id: carBook.id, trip: { trip_type: 'One way', drop: 'Hyderabad airport', trip_date: day(3), trip_time: '05:00', car_type: 'Sedan (4 seats)' } }, { label: 'user12 🚗 car booking' });
const vq = await slotOf(U(13), `via=${villageSvc.service.id}&locality=${village.id}`);
O.u13village = await place(U(13), { loc: village.id, via_service_id: villageSvc.service.id, slot: vq.slots?.[0],
  items: [{ product_id: villProd.id, qty: 1 }, { service_id: villageSvc.service.id, name: 'Bike chain lock', qty_text: '1' }] },
  { base: n(vq.delivery_fee), village: true, label: `user13 🏡 Village Needs to ${village.name} (₹${n(vq.delivery_fee)}, next day)` });
check('village order: our staff, next-day delivery date saved', O.u13village?.skill === 'our_service_employees' && (await db.query('SELECT deliver_on FROM orders WHERE id = $1', [O.u13village.id])).rows[0].deliver_on);
O.u15cancel = await place(U(15), { items: [{ product_id: banana.id, qty: 1 }] }, { base: 30, label: 'user15 🍌 order (will cancel)' });
let r = await call(`/orders/${O.u15cancel.id}/cancel`, { method: 'POST', token: U(15).token, body: { reason: 'Ordered by mistake' } });
check('user15 cancels before an agent accepts', r.s === 204);
O.u15cancel.status = 'cancelled'; offerUsed[U(15).phone] = false; O.u15cancel.reason = 'Ordered by mistake';
O.u15fruit = await place(U(15), { items: [{ product_id: apple.id, qty: 1 }] }, { base: 30, label: 'user15 🍎 new order after cancel (offer back → free)' });
O.u16fruit = await place(U(16), { items: [{ product_id: banana.id, qty: 2 }] }, { base: 30, label: 'user16 🍌 (agent gives it back)' });
O.u17fruit = await place(U(17), { items: [{ product_id: banana.id, qty: 1 }] }, { base: 30, label: 'user17 🍌 (admin assigns)' });
O.u18fruit = await place(U(18), { items: [{ product_id: apple.id, qty: 1 }] }, { base: 30, label: 'user18 🍎 (admin cancels)' });
O.u19fruit = await place(U(19), { items: [{ product_id: banana.id, qty: 1 }] }, { base: 30, label: 'user19 🍌 (3 agents tap Accept together)' });
O.u20fruit = await place(U(20), { items: [{ product_id: apple.id, qty: 3 }] }, { base: 30, label: 'user20 🍎 (late → 2-star rating)' });
for (const i of [14, 3, 5, 9, 10, 12]) { // more ordinary orders so every agent has a few
  const o = await place(U(i), { items: [{ product_id: banana.id, qty: 1 }] }, { base: 30, label: `user${i} 🍌 extra fruit order` });
  O[`extra${i}`] = o;
}
// things that must be refused
r = await call('/orders', { method: 'POST', token: U(19).token, body: { contact: contact(U(19)), slot: 'As soon as possible', items: [{ product_id: water.products[0].id, qty: 1 }, { product_id: banana.id, qty: 1 }] } });
check('water + other items in one order refused', r.s === 400 && /separate order/.test(r.d.error), r.d.error);
r = await call('/orders', { method: 'POST', token: U(19).token, body: { contact: contact(U(19)), slot: 'As soon as possible', items: sfm(sfmElec, ['a1', 'a2', 'a3', 'a4']) } });
check('Shop For Me with 4 items refused', r.s === 400 && /up to 3/.test(r.d.error), r.d.error);
r = await call('/orders', { method: 'POST', token: U(19).token, body: { contact: contact(U(19), village.id), slot: 'As soon as possible', items: [{ product_id: banana.id, qty: 1 }] } });
check('normal order to a village refused (use Village Needs)', r.s === 400 && /Village Needs/.test(r.d.error), r.d.error);
check('customer cannot open another customer\'s order', (await call(`/orders/${O.u1fruit.id}`, { token: U(19).token })).s === 404);
check('customer cannot open the admin orders', (await call('/admin/orders', { token: U(19).token })).s >= 401);

// =====================================================================================
// 5) what each agent is offered: only their own types, no customer phone before accepting
// =====================================================================================
const open = ORD.filter((o) => o.status === 'placed');
for (const a of AG) {
  const av = (await call('/agent/available', { token: a.token, ip: a.ip })).d;
  const mine = open.filter((o) => a.skills.includes(o.skill)).map((o) => o.id);
  const ids = (Array.isArray(av) ? av : []).map((o) => o.id);
  const wrong = (Array.isArray(av) ? av : []).filter((o) => !a.skills.includes(o.skill_code));
  check(`${a.full} [${a.skills.join(', ')}] sees only their orders (${mine.length})`, !wrong.length && mine.every((id) => ids.includes(id)),
    `wrong: ${wrong.map((o) => o.id + ':' + o.skill_code)} missing: ${mine.filter((id) => !ids.includes(id))}`);
  if (JSON.stringify(av).includes('90003001')) check(`${a.full}: no customer phone before accepting`, false);
}
check('agent of another type cannot accept (plumber takes a fruit order)', (await call(`/agent/orders/${O.u2fruit.id}/accept`, { method: 'POST', token: A(5).token })).s >= 400);

// =====================================================================================
// 6) agents work: accept → (shop bill) → pick up → (delivery charge) → deliver
// =====================================================================================
const PNG = IMG;
// 🧾 every shop item is "as per the shop bill" (since 2026-10-22): the agent adds the bill (paid in cash) before pick-up
async function shopBill(a, o, amount) {
  const f = new FormData();
  Object.entries({ amount: String(amount), shop_name: 'Sim Shop', mode: 'agent_cash' }).forEach(([k, v]) => f.append(k, v));
  f.append('bill_photo', PNG, 'bill.png');
  const x = await call(`/agent/orders/${o.id}/bill`, { method: 'POST', token: a.token, form: f });
  if (x.s !== 204) check(`${o.label}: bill ₹${amount} uploaded`, false, JSON.stringify(x.d));
  o.bill = amount; o.billMode = 'agent_cash'; o.total = amount + o.fee;
}
const billFor = (o) => 100 + (o.id % 7) * 10; // a different, known amount for each order
async function work(a, o, { bill, mode = 'agent_cash', upi, stopAt } = {}) {
  let x = await call(`/agent/orders/${o.id}/accept`, { method: 'POST', token: a.token, ip: a.ip });
  if (x.s !== 200) return check(`${a.full} accepts ${o.label}`, false, JSON.stringify(x.d));
  o.agent = a; o.status = 'assigned';
  const seen = (await call(`/agent/orders/${o.id}`, { token: a.token })).d;
  if (seen.contact_phone !== o.u.phone) check(`${a.full} sees the customer's phone after accepting`, false, seen.contact_phone);
  if (stopAt === 'assigned') return;
  if (bill == null && seen.items?.some((i) => i.on_bill)) bill = billFor(o); // fruit, milk… now priced by the shop bill
  if (bill != null) {
    const f = new FormData();
    Object.entries({ amount: String(bill), shop_name: 'Sim Shop', mode, ...(upi && { upi_id: upi }) }).forEach(([k, v]) => f.append(k, v));
    f.append('bill_photo', PNG, 'bill.png');
    x = await call(`/agent/orders/${o.id}/bill`, { method: 'POST', token: a.token, form: f });
    if (x.s !== 204) return check(`${o.label}: bill ₹${bill} uploaded`, false, JSON.stringify(x.d));
    o.bill = bill; o.billMode = mode; o.total = bill + o.fee;
    if (mode === 'customer_upi') {
      x = await call(`/agent/orders/${o.id}/status`, { method: 'POST', token: a.token, body: { status: 'picked_up' } });
      check(`${o.label}: cannot leave the shop before the shop confirms the customer's UPI`, x.s === 409, JSON.stringify(x.d));
      x = await call(`/agent/orders/${o.id}/confirm-payment`, { method: 'POST', token: a.token });
      if (x.s !== 204) check(`${o.label}: shop received payment`, false, JSON.stringify(x.d));
    }
  }
  x = await call(`/agent/orders/${o.id}/status`, { method: 'POST', token: a.token, body: { status: 'picked_up' } });
  if (x.s !== 204) return check(`${o.label}: picked up`, false, JSON.stringify(x.d));
  o.status = 'picked_up';
  if (stopAt === 'picked_up') return;
  if (o.fee > 0) {
    x = await call(`/agent/orders/${o.id}/status`, { method: 'POST', token: a.token, body: { status: 'delivered' } });
    check(`${o.label}: cannot finish before the ₹${o.fee} delivery charge is confirmed`, x.s === 409, JSON.stringify(x.d));
    x = await call(`/agent/orders/${o.id}/fee-received`, { method: 'POST', token: a.token, body: { mode: 'cash' } });
    if (x.s !== 204) check(`${o.label}: delivery charge paid in cash`, false, JSON.stringify(x.d));
  }
  const otpCode = (await call(`/orders/${o.id}`, { token: o.u.token })).d.delivery_otp;
  x = await call(`/agent/orders/${o.id}/status`, { method: 'POST', token: a.token, body: { status: 'delivered', otp: otpCode } });
  if (x.s !== 204) return check(`${o.label}: delivered`, false, JSON.stringify(x.d));
  o.status = 'delivered';
  // what we pay the agent: ₹25, except bookings with a talked price, event/car bookings and our own staff
  const pay = o.event || o.trip || (o.kind === 'service' && o.total === 0) || o.skill === 'our_service_employees' ? 0 : 25;
  o.earning = pay;
  a.delivered++; a.earn += pay;
  a.cash += o.total - (o.billMode === 'customer_upi' ? o.bill : 0);
  const back = (await call(`/orders/${o.id}`, { token: o.u.token })).d;
  check(`${o.label}: delivered by ${a.full} · total ₹${o.total} · agent pay ₹${pay}`, back.status === 'delivered' && n(back.total) === o.total && n(back.agent_earning) === pay,
    JSON.stringify({ status: back.status, total: back.total, pay: back.agent_earning }));
}
await work(A(4), O.u1water);
await work(A(1), O.u1fruit);
await work(A(1), O.u2fruit);
await work(A(2), O.u2fruit2);
await work(A(2), O.u3kirana, { bill: 245 });
await work(A(3), O.u4instant, { bill: 180 });
await work(A(1), O.u5sfm, { bill: 1500, mode: 'customer_upi', upi: 'srisai.elec@okaxis' });
await work(A(2), O.u6sfm, { bill: 320 });
await work(A(5), O.u7plumber);
await work(A(3), O.u7fruit);
await work(A(5), O.u8elec, { stopAt: 'assigned' });
await work(A(6), O.u9punct);
await work(A(7), O.u10salon);
await work(A(8), O.u11photo);
await work(A(9), O.u12car);
await work(A(4), O.u13village, { bill: 210 });
await work(A(1), O.u15fruit, { stopAt: 'picked_up' });
// give back → someone else
await work(A(2), O.u16fruit, { stopAt: 'assigned' });
r = await call(`/agent/orders/${O.u16fruit.id}/release`, { method: 'POST', token: A(2).token, body: { reason: 'Bike puncture' } });
check('agent2 gives user16\'s order back', r.s === 204 && (await call(`/orders/${O.u16fruit.id}`, { token: U(16).token })).d.status === 'placed');
A(2).released++; O.u16fruit.status = 'placed'; O.u16fruit.agent = null;
await work(A(3), O.u16fruit);
// admin assigns
const det = (await call(`/admin/orders/${O.u17fruit.id}`, { token: admin })).d;
check('admin order page lists free delivery agents (not plumber / staff)', det.candidates?.some((c) => c.user_id === A(1).id) && !det.candidates?.some((c) => c.user_id === A(5).id || c.user_id === A(4).id),
  JSON.stringify(det.candidates?.map((c) => c.full_name)));
r = await call(`/admin/orders/${O.u17fruit.id}/assign`, { method: 'POST', token: admin, body: { agent_id: A(3).id } });
check('admin assigns user17\'s order to agent3', r.s === 204);
O.u17fruit.agent = A(3); O.u17fruit.status = 'assigned';
{
  const o = O.u17fruit, a = A(3);
  await shopBill(a, o, billFor(o));
  await call(`/agent/orders/${o.id}/status`, { method: 'POST', token: a.token, body: { status: 'picked_up' } });
  if (o.fee > 0) await call(`/agent/orders/${o.id}/fee-received`, { method: 'POST', token: a.token, body: { mode: 'cash' } });
  const x = await call(`/agent/orders/${o.id}/status`, { method: 'POST', token: a.token, body: { status: 'delivered' } });
  check('agent3 delivers the assigned order', x.s === 204, JSON.stringify(x.d));
  o.status = 'delivered'; o.earning = 25; a.delivered++; a.earn += 25; a.cash += o.total;
}
r = await call(`/admin/orders/${O.u18fruit.id}/cancel`, { method: 'POST', token: admin, body: { reason: 'Customer not reachable' } });
check('admin cancels user18\'s order with a reason', r.s === 204);
O.u18fruit.status = 'cancelled'; O.u18fruit.reason = 'Customer not reachable';
// three agents tap Accept at the same moment
const race = await Promise.all([A(1), A(2), A(3)].map((a) => call(`/agent/orders/${O.u19fruit.id}/accept`, { method: 'POST', token: a.token })));
const winners = race.filter((x) => x.s === 200).length;
check('3 agents accept together → exactly 1 gets it, the others are told it is taken', winners === 1 && race.filter((x) => x.s === 409).length === 2, race.map((x) => x.s).join(','));
{
  const a = [A(1), A(2), A(3)][race.findIndex((x) => x.s === 200)];
  const o = O.u19fruit;
  o.agent = a; o.status = 'assigned';
  await shopBill(a, o, billFor(o));
  await call(`/agent/orders/${o.id}/status`, { method: 'POST', token: a.token, body: { status: 'picked_up' } });
  if (o.fee > 0) await call(`/agent/orders/${o.id}/fee-received`, { method: 'POST', token: a.token, body: { mode: 'cash' } });
  const x = await call(`/agent/orders/${o.id}/status`, { method: 'POST', token: a.token, body: { status: 'delivered' } });
  check(`the winner (${a.full}) delivers it`, x.s === 204, JSON.stringify(x.d));
  o.status = 'delivered'; o.earning = 25; a.delivered++; a.earn += 25; a.cash += o.total;
}
await work(A(2), O.u20fruit);
check('agent with an order on the way cannot take another one', (await call(`/agent/orders/${O.extra14.id}/accept`, { method: 'POST', token: A(1).token })).s === 409);
await work(A(3), O.extra14);
await work(A(2), O.extra3);
await work(A(3), O.extra5);
// extra9, extra10, extra12 stay waiting for an agent (placed)
check('agent cannot open another agent\'s order', (await call(`/agent/orders/${O.u1fruit.id}`, { token: A(6).token })).s === 404);

// ratings
for (const o of ORD.filter((x) => x.status === 'delivered' && x !== O.u20fruit).slice(0, 12)) {
  const x = await call(`/orders/${o.id}/rating`, { method: 'POST', token: o.u.token, body: { stars: 5, comment: 'Good service', tags: ['On time'] } });
  if (x.s !== 200) check(`rating for ${o.label}`, false, JSON.stringify(x.d));
}
r = await call(`/orders/${O.u20fruit.id}/rating`, { method: 'POST', token: U(20).token, body: { stars: 2, comment: 'Came very late', tags: [] } });
check('user20 gives 2 stars', r.s === 200, JSON.stringify(r.d));
check('cannot rate an order that is not delivered', (await call(`/orders/${O.extra9.id}/rating`, { method: 'POST', token: U(9).token, body: { stars: 5 } })).s >= 400);
const ratings = (await call('/admin/ratings', { token: admin })).d;
check('admin Ratings shows the 2-star review', JSON.stringify(ratings).includes('Came very late'));
check('low-rating badge counts it', (await call('/admin/orders-stats', { token: admin })).d.low_ratings >= 1);

// =====================================================================================
// 7) 🚗 Share Ride: agent10 lists a journey, user14 pays by UPI, user15 pays cash at pickup
// =====================================================================================
const ownerPage = (await call('/share-ride/owner', { token: A(10).token })).d;
const car = ownerPage.cars?.[0];
const depart = new Date(`${day(1)}T07:00:00+05:30`);
const rows = car?.layout?.length || 3;
const prices = [400, 350, 300, 250].slice(0, rows);
r = await call('/share-ride/owner/rides', { method: 'POST', token: A(10).token, body: { car_id: car?.id, from: 'Siddipet', to: 'Hyderabad', depart_at: depart.toISOString(),
  pickups: ['Old bus stand', 'Ponnala X roads'], drops: ['JBS', 'Ameerpet'], prices, blocked: [], upi_id: 'venkat.sim@okaxis', allow_cash: true, notes: 'AC car' } });
check('agent10 lists Siddipet → Hyderabad tomorrow 7 AM', r.s === 201, JSON.stringify(r.d));
const ride = r.d;
const found = (await call(`/share-ride/search?from=Siddipet&to=Hyderabad&date=${day(1)}&passengers=2`)).d;
check('customers find the journey in search', Array.isArray(found) && found.some((x) => x.id === ride.id), JSON.stringify(found).slice(0, 150));
const rd = (await call(`/share-ride/rides/${ride.id}`)).d;
const s1 = rd.seats[0], s2 = rd.seats[1], s3 = rd.seats[rd.seats.length - 1];
const bk = (u, seats, pay) => call(`/share-ride/rides/${ride.id}/book`, { method: 'POST', token: u.token, body: {
  passengers: seats.map((s, k) => ({ seat: s.code, name: `${u.name} P${k + 1}` })), phone: u.phone, pickup: 'Old bus stand', drop: 'JBS', pay_mode: pay, agree: true } });
const b14 = (await bk(U(14), [s1, s2], 'upi')).d;
check(`user14 books 2 seats ₹${n(s1.price) + n(s2.price)} (held for UPI payment)`, b14.status === 'held' && n(b14.amount) === n(s1.price) + n(s2.price), JSON.stringify(b14).slice(0, 150));
check('user15 cannot take the same seat', (await bk(U(15), [s1], 'upi')).s === 409);
r = await call(`/share-ride/bookings/${b14.id}/paid`, { method: 'POST', token: U(14).token, body: { utr: '4321 9876 5432' } });
check('user14 enters the UPI reference', r.s === 200 || r.s === 204, JSON.stringify(r.d));
r = await call(`/share-ride/owner/bookings/${b14.id}/decide`, { method: 'POST', token: A(10).token, body: { received: true } });
check('agent10 confirms "Payment received"', r.d.status === 'confirmed', JSON.stringify(r.d));
const pdf = await call(`/share-ride/bookings/${b14.id}/ticket.pdf`, { token: U(14).token, raw: true });
check('user14 downloads the PDF ticket', pdf.status === 200 && /pdf/.test(pdf.headers.get('content-type') || ''));
const b15 = (await bk(U(15), [s3], 'cash')).d;
check('user15 books 1 seat, cash at pickup → confirmed at once', b15.status === 'confirmed', JSON.stringify(b15).slice(0, 150));
const srAdmin = (await call('/share-ride/admin', { token: admin })).d;
check('franchise admin sees the journey with 3 seats booked', srAdmin.rides?.some((x) => x.id === ride.id && n(x.booked) === 3), JSON.stringify(srAdmin.rides?.find((x) => x.id === ride.id)));

// =====================================================================================
// 8) the numbers: franchise Reports, HQ Reports & Dashboard, agents' wallets
// =====================================================================================
const mineIds = new Set(ORD.map((o) => o.id));
const delivered = ORD.filter((o) => o.status === 'delivered');
const sum = (arr, f) => arr.reduce((t, o) => t + f(o), 0);
const exp = {
  orders: ORD.length, delivered: delivered.length, cancelled: ORD.filter((o) => o.status === 'cancelled').length,
  in_progress: ORD.filter((o) => ['placed', 'assigned', 'picked_up'].includes(o.status)).length,
  revenue: sum(delivered, (o) => o.total), delivery_fees: sum(delivered, (o) => o.fee), agent_pay: sum(delivered, (o) => o.earning),
  customers: new Set(ORD.map((o) => o.u.phone)).size, new_customers: 20,
  active_agents: new Set(delivered.map((o) => o.agent.id)).size,
};
console.log('\nexpected from this run:', JSON.stringify(exp));
const rep = (await call(`/admin/reports?${RANGE}`, { token: admin })).d;
const k1 = rep.kpis, k0 = before.rep.kpis;
for (const key of Object.keys(exp)) check(`franchise Reports · ${key}: ${n(k1[key]) - n(k0[key])} (expected ${exp[key]})`, n(k1[key]) - n(k0[key]) === exp[key]);
check('franchise Reports · today\'s bar = all orders', n(rep.by_day?.find((d) => d.day === todayIST)?.orders) - n(before.rep.by_day?.find((d) => d.day === todayIST)?.orders) === exp.orders);
check('franchise Reports · orders by hour add up', sum(rep.by_hour || [], (h) => n(h.orders)) - sum(before.rep.by_hour || [], (h) => n(h.orders)) === exp.orders);
// by type
const byType = {};
for (const o of ORD) {
  const t = (byType[types[o.skill]] ||= { orders: 0, delivered: 0, revenue: 0 });
  t.orders++; if (o.status === 'delivered') { t.delivered++; t.revenue += o.total; }
}
for (const [name, t] of Object.entries(byType)) {
  const now = rep.by_type.find((x) => x.name === name) || {}, was = before.rep.by_type?.find((x) => x.name === name) || {};
  check(`franchise Reports · by type "${name}": ${t.orders} orders, ${t.delivered} done, ₹${t.revenue}`,
    n(now.orders) - n(was.orders) === t.orders && n(now.delivered) - n(was.delivered) === t.delivered && n(now.revenue) - n(was.revenue) === t.revenue, JSON.stringify(now));
}
// by agent
for (const a of AG) {
  const row = rep.agents.find((x) => x.user_id === a.id) || {};
  const mine = ORD.filter((o) => o.agent === a);
  const expRow = { handled: mine.length, delivered: a.delivered, in_progress: mine.filter((o) => ['assigned', 'picked_up'].includes(o.status)).length,
    earnings: a.earn, order_value: sum(mine.filter((o) => o.status === 'delivered'), (o) => o.total), released: a.released, cash_in_hand: a.cash };
  const got = Object.fromEntries(Object.keys(expRow).map((k) => [k, n(row[k])]));
  check(`franchise Reports · ${a.full}: ${JSON.stringify(expRow)}`, JSON.stringify(got) === JSON.stringify(expRow), `got ${JSON.stringify(got)}`);
  const me = (await call('/agent/me', { token: a.token })).d.stats || {};
  const gotMe = { total_deliveries: n(me.total_deliveries), today_deliveries: n(me.today_deliveries), today_earnings: n(me.today_earnings), lifetime_earnings: n(me.lifetime_earnings), cash_in_hand: n(me.cash_in_hand) };
  const expMe = { total_deliveries: a.delivered, today_deliveries: a.delivered, today_earnings: a.earn, lifetime_earnings: a.earn, cash_in_hand: a.cash };
  check(`${a.full}'s own app: ${JSON.stringify(expMe)}`, JSON.stringify(gotMe) === JSON.stringify(expMe), `got ${JSON.stringify(gotMe)}`);
}
// by area
const byArea = {};
for (const o of ORD) {
  const name = locs.find((l) => l.id === o.loc)?.name;
  const t = (byArea[name] ||= { orders: 0, delivered: 0, revenue: 0 });
  t.orders++; if (o.status === 'delivered') { t.delivered++; t.revenue += o.total; }
}
const areaOk = Object.entries(byArea).every(([name, t]) => {
  const now = rep.by_area.find((x) => x.name === name) || {}, was = before.rep.by_area?.find((x) => x.name === name) || {};
  return n(now.orders) - n(was.orders) === t.orders && n(now.revenue) - n(was.revenue) === t.revenue;
});
check(`franchise Reports · by area (${Object.keys(byArea).length} areas) match`, areaOk, JSON.stringify(rep.by_area).slice(0, 200));
// by category: every order once; categories + delivery charges = revenue; Shop For Me shows its shop bills
const catRev = (rr) => sum(rr.by_category || [], (x) => n(x.revenue));
check(`franchise Reports · by category: categories ₹${catRev(rep) - catRev(before.rep)} + delivery ₹${exp.delivery_fees} = revenue ₹${exp.revenue}`,
  catRev(rep) - catRev(before.rep) + exp.delivery_fees === exp.revenue && sum(rep.by_category, (x) => n(x.orders)) - sum(before.rep.by_category || [], (x) => n(x.orders)) === exp.orders);
const sfmBills = sum(delivered.filter((o) => o.label.includes('Shop For Me')), (o) => o.total - o.fee);
const sfmRow = (rr) => n((rr.by_category || []).find((x) => x.name === 'Shop For Me')?.revenue);
check(`franchise Reports · Shop For Me category shows its bills ₹${sfmBills}`, sfmRow(rep) - sfmRow(before.rep) === sfmBills, `${sfmRow(rep)}`);
// top customers: user5 spent the most (₹1,500 bill)
const spent = {};
for (const o of delivered) spent[o.u.name] = (spent[o.u.name] || 0) + o.total;
const topName = Object.entries(spent).sort((x, y) => y[1] - x[1])[0];
check(`franchise Reports · top customer ${topName[0]} ₹${topName[1]}`, rep.top_customers?.[0]?.name === topName[0] && n(rep.top_customers[0].spent) === topName[1], JSON.stringify(rep.top_customers?.[0]));
check('franchise Reports · cancel reasons listed', ['Ordered by mistake', 'Customer not reachable'].every((x) => rep.cancel_reasons?.some((c) => c.reason === x)), JSON.stringify(rep.cancel_reasons));
const csv = await (await call(`/admin/reports/orders.csv?${RANGE}`, { token: admin, raw: true })).text();
check('franchise Reports · CSV download has every order', ORD.every((o) => csv.includes(String(o.id))));
// HQ
const hqRep = (await call(`/super/reports?${RANGE}`, { token: hq })).d;
const t1 = hqRep.totals, t0 = before.hqRep.totals;
const hqExp = { orders: ORD.filter((o) => o.kind === 'products').length, bookings: ORD.filter((o) => o.kind === 'service').length, completed: exp.delivered,
  cancelled: exp.cancelled, pending: exp.in_progress, revenue: exp.revenue, delivery_charges: exp.delivery_fees };
for (const key of Object.keys(hqExp)) check(`HQ Reports · ${key}: ${n(t1[key]) - n(t0[key])} (expected ${hqExp[key]})`, n(t1[key]) - n(t0[key]) === hqExp[key]);
check('HQ Reports · same detailed report as the franchise (one franchise)', n(hqRep.report?.kpis?.revenue) === n(rep.kpis.revenue) && n(hqRep.report?.kpis?.orders) === n(rep.kpis.orders));
const dash = (await call('/super/dashboard', { token: hq })).d;
check(`HQ Dashboard · revenue today +₹${exp.revenue}`, n(dash.revenue_today) - n(before.dash.revenue_today) === exp.revenue, `${n(dash.revenue_today) - n(before.dash.revenue_today)}`);
check(`HQ Dashboard · customers +20`, n(dash.users_total) - n(before.dash.users_total) === 20);
// customers see only their own orders
let ownOk = true;
for (const u of users) {
  const mine = (await call('/orders', { token: u.token })).d;
  const expIds = ORD.filter((o) => o.u === u).map((o) => o.id).sort().join();
  if ((Array.isArray(mine) ? mine : []).map((o) => o.id).sort().join() !== expIds) { ownOk = false; console.log('  orders of', u.name, mine.map?.((o) => o.id), expIds); }
}
check('every customer\'s "Orders" tab shows exactly their own orders', ownOk);

// =====================================================================================
// 9) offer banner, ⏰ overdue orders, HQ = view only for city operations, Disable/Suspend warning
// =====================================================================================
// 🎉 free deliveries left per mobile number (the home banner shows only while > 0)
const freeLeft = async (u) => (await call('/orders/offer', { token: u.token })).d.free_left;
check('offer: user1 used it (water first, then a free fruit delivery) → banner hidden', await freeLeft(U(1)) === 0);
check('offer: user8 only booked an electrician → still has 1 free delivery (banner shows)', await freeLeft(U(8)) === 1);
check('offer: user13 paid the village charge → still has 1', await freeLeft(U(13)) === 1);
check('offer: user15 cancelled, then used it on the next order → 0', await freeLeft(U(15)) === 0);

// ⏰ an order nobody took for 2 hours ("As soon as possible" is due 1 hour after it was placed)
const lateId = O.extra9.id;
await db.query("UPDATE orders SET created_at = now() - interval '2 hours' WHERE id = $1", [lateId]);
let late = (await call('/admin/orders?status=overdue', { token: admin })).d;
check('overdue: the 2-hour-old waiting order is in the admin "Overdue" tab, marked "not taken"', late.some((o) => o.id === lateId && o.overdue === 'not_taken'), JSON.stringify(late.map((o) => [o.id, o.overdue])));
check('overdue: fresh orders are not overdue', !late.some((o) => o.id === O.extra10.id));
check('overdue: sidebar count', n((await call('/admin/orders-stats', { token: admin })).d.overdue) >= 1);
check('overdue: order detail says when it was due', (await call(`/admin/orders/${lateId}`, { token: admin })).d.overdue === 'not_taken');
const offered = async (a, id) => ((await call('/agent/available', { token: a.token })).d || []).some((o) => o.id === id);
check('overdue: agents still see it in the first 24 hours (someone may still take it)', await offered(A(2), lateId));
await db.query("UPDATE orders SET created_at = created_at - interval '2 days' WHERE id = $1", [O.extra10.id]);
check('overdue: more than 24 hours past due → agents no longer see it', !(await offered(A(2), O.extra10.id)));
check('overdue: … but the admin still does', (await call('/admin/orders?status=overdue', { token: admin })).d.some((o) => o.id === O.extra10.id));
await db.query("UPDATE orders SET created_at = created_at + interval '2 days' WHERE id = $1", [O.extra10.id]); // back to today
check('overdue: a taken order still on the way 3 hours later → "not done"', await (async () => {
  await db.query("UPDATE orders SET created_at = now() - interval '4 hours' WHERE id = $1", [O.u15fruit.id]);
  const x = (await call('/admin/orders?status=overdue', { token: admin })).d.find((o) => o.id === O.u15fruit.id);
  await db.query("UPDATE orders SET created_at = now() WHERE id = $1", [O.u15fruit.id]);
  return x?.overdue === 'not_delivered';
})());

// 👁️ HQ watches city operations: every change there is refused; HQ's own settings still work
const hqTry = (method, path, body) => call(path, { method, token: hq, body });
const refused = [
  ['assign an order', 'POST', `/admin/orders/${O.extra12.id}/assign`, { agent_id: A(1).id }],
  ['cancel an order', 'POST', `/admin/orders/${O.extra12.id}/cancel`, { reason: 'x' }],
  ['approve / reject an agent', 'POST', `/admin/agents/${A(1).id}/review`, { approve: true }],
  ['suspend an agent', 'PATCH', `/admin/agents/${A(1).id}/status`, { status: 'suspended' }],
  ['remove an agent', 'POST', `/admin/agents/${A(1).id}/remove`, { reason: 'x' }],
  ["change an agent's types", 'PATCH', `/admin/agents/${A(1).id}/skills`, { skills: ['delivery'] }],
  ['pay an agent (wallet)', 'POST', `/admin/agents/${A(1).id}/wallet`, { type: 'bonus', amount: 1 }],
  ['add an agent', 'POST', '/admin/agents', {}],
  ['add a shop', 'POST', '/admin/shops', { name: 'x' }],
  ['activate a subscription', 'POST', '/admin/subscriptions', {}],
  ['answer a complaint', 'PATCH', '/franchise/complaints/1', { status: 'resolved' }],
  ['cancel a Share Ride journey', 'POST', `/share-ride/admin/rides/${ride.id}/cancel`, { reason: 'x' }],
];
for (const [what, m, p, b] of refused) {
  const x = await hqTry(m, p, b);
  check(`HQ cannot ${what} (view only)`, x.s === 403, `${x.s} ${JSON.stringify(x.d)}`);
}
check('HQ still reads every city page (orders, agents, areas, shops, complaints, ratings, live map)',
  (await Promise.all(['/admin/orders', '/admin/agents', '/admin/localities', '/admin/shops', '/franchise/complaints', '/admin/ratings', '/admin/live'].map((p) => call(p, { token: hq })))).every((x) => x.s === 200));
// 🗺️ areas, villages and village charges are HQ's; the franchise admin asks HQ
check('franchise admin cannot add an area (asks HQ)', (await call('/admin/localities', { method: 'POST', token: admin, body: { name: 'x', lat: 18.1, lng: 78.85 } })).s === 403);
check('franchise admin cannot change village charges (asks HQ)', (await call('/admin/village-fees', { method: 'PUT', token: admin, body: { near: 1, far: 2 } })).s === 403);
check('HQ still sets subscription fees (its own setting) — not refused', (await hqTry('PUT', '/admin/subscriptions/services/0', {})).s !== 403);
check('HQ still edits agent types (same everywhere) — not refused', (await hqTry('PUT', '/admin/service-types/zz_nope', {})).s !== 403);
check('the city\'s franchise admin can still assign (not affected)', (await call(`/admin/orders/${O.extra12.id}/assign`, { method: 'POST', token: admin, body: { agent_id: A(2).id } })).s === 204);
await call(`/agent/orders/${O.extra12.id}/release`, { method: 'POST', token: A(2).token, body: { reason: 'Test: back to waiting' } });
A(2).released++;

// ⚠️ before HQ disables a city: what is still open there
const openWork = (await call('/super/franchises/1/open-work', { token: hq })).d;
const dbWork = (await db.query(`SELECT (SELECT count(*)::int FROM orders WHERE franchise_id = 1 AND status = 'placed') w,
  (SELECT count(*)::int FROM orders WHERE franchise_id = 1 AND status IN ('assigned', 'picked_up')) t`)).rows[0];
check(`Disable/Suspend warning: ${openWork.waiting} waiting, ${openWork.on_the_way} on the way, ${openWork.ride_bookings} ride seats`,
  openWork.waiting === dbWork.w && openWork.on_the_way === dbWork.t && openWork.ride_bookings >= 2, JSON.stringify(openWork));
check('a franchise admin cannot open the HQ warning', (await call('/super/franchises/1/open-work', { token: admin })).s === 403);

// keep a list for the user
fs.writeFileSync('./sim_orders.json',
  JSON.stringify(ORD.map((o) => ({ id: o.id, user: o.u.name, what: o.label, status: o.status, fee: o.fee, total: o.total, agent: o.agent?.full || null })), null, 1));
console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) console.log('FAILED:\n - ' + fails.join('\n - '));
await db.end();
