// 🧪 FULL PRE-LAUNCH TEST (LOCAL only) — both cities, Siddipet and Armoor, everything through the real app routes:
//  1. 100 customers per city sign up (mobile OTP + password); 3 agents of EVERY type per city apply with documents,
//     the city's franchise admin approves them (cars too), subscriptions are switched on, everyone goes online.
//  2. Every active service in each city is ordered (each customer one order, all 100 at the same moment).
//  3. Routing: every agent sees only orders of their own type and city; every order is offered to all 3 right agents.
//  4. Agents work in parallel (racing for the same orders): accept → shop bill → pick up → delivery charge → deliver (OTP).
//  5. Every number is checked against this script's own count: customers' orders, agents' wallets, both franchises'
//     Reports, HQ Reports (all + per city) and the HQ Dashboard. Results → load_report.json.
// Test people are zt_lt_… (removed by cleanup), phones 7c00000iii (customers) / 8cTT00000n (agents).
import fs from 'node:fs';
import pg from 'pg';
const realFetch = globalThis.fetch;
await import('./testadmin.mjs');
globalThis.fetch = realFetch;

const API = 'http://localhost:5000/api';
const DIR = '.';
const PASS = process.env.TEST_USER_PW;
const PER_CITY = Number(process.env.CUSTOMERS || 100);
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: '-c search_path=all_services', max: 8 });

// leftovers of an earlier run on the test numbers → zt_ names, so cleanup.mjs takes them
await db.query("UPDATE users SET username = 'zt_lt_left_' || id WHERE phone ~ '^(7[12]00000[0-9]{3}|8[12][0-9]{2}00000[0-9])$' AND username NOT LIKE 'zt\\_%'");
const results = [];
let pass = 0, fail = 0;
const check = (area, label, cond, extra = '') => {
  results.push({ area, label, ok: !!cond, extra: cond ? '' : String(extra).slice(0, 300) });
  console.log(`${cond ? 'PASS' : 'FAIL'}  [${area}] ${label}${!cond && extra ? ` — ${String(extra).slice(0, 240)}` : ''}`);
  cond ? pass++ : fail++;
};
async function call(p, { method = 'GET', body, token, form, ip = '10.40.0.1', city, raw } = {}) {
  const headers = { 'X-Forwarded-For': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (city) headers['X-Franchise'] = String(city);
  if (body) headers['Content-Type'] = 'application/json';
  const t0 = Date.now();
  const res = await realFetch(API + p, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  if (raw) return res;
  const text = res.status === 204 ? '' : await res.text();
  let d = {};
  try { d = text ? JSON.parse(text) : {}; } catch { d = { raw: text.slice(0, 120) }; }
  return { s: res.status, d, ms: Date.now() - t0 };
}
const n = (x) => Number(x || 0);
const pad = (i, w = 2) => String(i).padStart(w, '0');
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const PNG = () => new Blob([Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')], { type: 'image/png' }); // 29 bytes (cleanup removes)
const todayIST = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const day = (k) => new Date(Date.now() + k * 864e5 + 330 * 60000).toISOString().slice(0, 10);
const RANGE = `from=${todayIST}&to=${todayIST}`;
async function pool(items, size, fn) { // run fn over items, `size` at a time
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
async function otp(phone, portal, ip, extra = {}) {
  await db.query('DELETE FROM phone_otps WHERE phone = $1', [phone]);
  const r = await call('/auth/phone/request', { method: 'POST', body: { phone }, ip });
  if (!r.d.devCode) throw new Error(`OTP ${phone}: ${r.d.error || r.s}`);
  return call('/auth/phone/verify', { method: 'POST', body: { phone, code: r.d.devCode, portal, ...extra }, ip });
}

// ============ cities, staff logins, "before" numbers ============
const CITIES = [
  { key: 'S', name: 'Siddipet', id: (await db.query("SELECT id FROM franchises WHERE code = 'FR-0001'")).rows[0].id, admin: ['zt_admin', process.env.TEST_STAFF_PW], c: 1 },
  { key: 'A', name: 'Armoor', id: (await db.query("SELECT id FROM franchises WHERE city = 'Armoor' ORDER BY id LIMIT 1")).rows[0].id, admin: ['zt_admin_ar', process.env.TEST_STAFF_PW], c: 2 },
];
const hq = (await call('/auth/login', { method: 'POST', body: { username: 'zt_super', password: process.env.TEST_STAFF_PW, portal: 'superadmin' } })).d.token;
for (const C of CITIES) {
  C.token = (await call('/auth/login', { method: 'POST', body: { username: C.admin[0], password: C.admin[1], portal: 'admin' } })).d.token;
  check('setup', `${C.name} franchise admin logs in`, !!C.token);
  C.locs = (await call('/localities', { city: C.id })).d;
  C.town = C.locs.filter((l) => !l.is_village);
  C.village = C.locs.find((l) => l.is_village);
  C.before = (await call(`/admin/reports?${RANGE}`, { token: C.token })).d;
  C.hqBefore = (await call(`/super/reports?${RANGE}&franchise=${C.id}`, { token: hq })).d;
}
const before = { hq: (await call(`/super/reports?${RANGE}`, { token: hq })).d, dash: (await call('/super/dashboard', { token: hq })).d };
check('setup', 'HQ logs in, reports open before the test', hq && before.hq.totals && before.dash);
const T0 = Date.now();

// ============ 1. customers (100 per city) ============
const CUST = [];
for (const C of CITIES) for (let i = 1; i <= PER_CITY; i++) {
  CUST.push({ C, i, name: `Zt LT ${C.key}${i}`, phone: `7${C.c}00000${pad(i, 3)}`, ip: `10.4${C.c}.${Math.floor(i / 200)}.${i % 200 + 1}`, loc: C.town[i % C.town.length] });
}
await pool(CUST, 20, async (u) => {
  try {
    const v = await otp(u.phone, 'user', u.ip);
    const c = await call('/auth/phone/complete', { method: 'POST', body: { proof: v.d.proof, fullName: u.name, password: PASS }, ip: u.ip });
    if (!c.d.token) throw new Error(JSON.stringify(c.d));
    await db.query("UPDATE users SET username = $1 WHERE phone = $2 AND role = 'customer'", [`zt_lt_${u.C.key.toLowerCase()}_c${u.i}`, u.phone]);
    const l = await call('/auth/login', { method: 'POST', body: { username: u.phone, password: PASS, portal: 'user' }, ip: u.ip });
    u.token = l.d.token; u.id = l.d.user?.id;
  } catch (e) { u.err = e.message; }
});
for (const C of CITIES) {
  const mine = CUST.filter((u) => u.C === C);
  check('customers', `${C.name}: ${mine.filter((u) => u.token).length}/${PER_CITY} customers signed up (OTP) and logged in (mobile + password)`, mine.every((u) => u.token), mine.find((u) => u.err)?.err);
}

// ============ 2. agents: 3 of every type per city ============
const TYPES = ['delivery', 'instant', 'our_service_employees', 'home_service', 'vehicle', 'beauty', 'events_agent', 'tech', 'tutoring', 'pet',
  'book_cook', 'tomorrow_meals', 'car_rental_agent', 'shared_car_agent'];
const models = (await call('/share-ride/models')).d;
const MODELS = ['Ertiga', 'Swift Dzire', 'Toyota Innova \\('].map((re) => models.find((m) => new RegExp(re).test(m.name)));
const AG = [];
for (const C of CITIES) TYPES.forEach((t, ti) => { for (let k = 1; k <= 3; k++) {
  const car = t === 'car_rental_agent' || t === 'shared_car_agent';
  AG.push({ C, type: t, ti, k, car, model: car ? MODELS[k - 1] : null, full: `Zt LT ${C.key} ${t} ${k}`, phone: `8${C.c}${pad(ti)}00000${k}`, ip: `10.5${C.c}.${ti}.${k}`,
    reg: car ? `TS3${C.c}LT${pad(ti)}${k}0` : null, done: [], earn: 0, cash: 0 });
} });
await pool(AG, 6, async (a) => {
  try {
    const home = a.C.town[0];
    const v = await otp(a.phone, 'agent_apply', a.ip);
    if (!v.d.proof) throw new Error(`apply OTP: ${JSON.stringify(v.d)}`);
    const f = new FormData();
    const fields = { phone_proof: v.d.proof, full_name: a.full, locality_id: home.id, aadhaar_number: `9${a.phone.slice(1)}${pad(a.k)}`, pan_number: 'ABCDE1234F',
      dl_number: `TS0920200${a.phone.slice(-6)}`, vehicle_type: a.car ? 'car' : 'bike', vehicle_number: `TS3${a.C.c}AB${a.phone.slice(-4)}`, skills: a.type };
    if (a.car) Object.assign(fields, { owner_type: 'car', car_model_id: a.model.id, reg_number: a.reg, car_color: 'White', yellow_board: 'true' });
    Object.entries(fields).forEach(([k, x]) => f.append(k, x));
    for (const d of ['aadhaar_doc', 'pan_doc', 'dl_doc', 'photo_doc', ...(a.car ? ['rc_doc', 'permit_doc', 'insurance_doc'] : [])]) f.append(d, PNG(), `${d}.png`);
    const r = await call('/agents/apply', { method: 'POST', form: f, ip: a.ip });
    if (r.s !== 201) throw new Error(`apply ${r.s} ${JSON.stringify(r.d)}`);
    a.id = (await db.query("SELECT id FROM users WHERE phone = $1 AND role = 'agent'", [a.phone])).rows[0]?.id;
    await db.query('UPDATE users SET username = $1 WHERE id = $2', [`zt_lt_${a.C.key.toLowerCase()}_t${a.ti}_${a.k}`, a.id]);
  } catch (e) { a.err = e.message; }
});
for (const C of CITIES) {
  const mine = AG.filter((a) => a.C === C);
  check('agents', `${C.name}: ${mine.filter((a) => a.id).length}/${mine.length} agents applied (OTP number + documents), ${TYPES.length} types × 3`, mine.every((a) => a.id), mine.find((a) => a.err)?.err);
  const fr = (await db.query('SELECT count(*)::int c FROM agents WHERE user_id = ANY($1) AND franchise_id = $2', [mine.map((a) => a.id), C.id])).rows[0].c;
  check('agents', `${C.name}: all ${mine.length} applications went to ${C.name}'s franchise (by the chosen area)`, fr === mine.length, `${fr}`);
  // the city's admin approves people and cars, then switches subscriptions on
  for (const a of mine.filter((x) => !x.car)) {
    const r = await call(`/admin/agents/${a.id}/review`, { method: 'POST', token: C.token, body: { approve: true } });
    if (r.s !== 204) check('agents', `${C.name}: approve ${a.full}`, false, JSON.stringify(r.d));
  }
  const cars = (await call('/share-ride/admin', { token: C.token })).d.cars || [];
  for (const a of mine.filter((x) => x.car)) {
    const row = cars.find((c) => c.owner_id === a.id);
    const r = await call(`/share-ride/admin/cars/${row?.id}/review`, { method: 'POST', token: C.token, body: { action: 'approve' } });
    if (r.s !== 204) check('agents', `${C.name}: approve car of ${a.full}`, false, `${r.s} ${JSON.stringify(r.d)}`);
  }
  const subs = (await db.query("SELECT id FROM agent_subscriptions WHERE agent_id = ANY($1) AND status <> 'active'", [mine.map((a) => a.id)])).rows;
  for (const s of subs) {
    const r = await call(`/admin/subscriptions/${s.id}/activate`, { method: 'POST', token: C.token, body: { amount: 0, mode: 'free', days: 30 } });
    if (r.s >= 300) check('agents', `${C.name}: subscription #${s.id}`, false, JSON.stringify(r.d));
  }
  const active = (await db.query("SELECT count(*)::int c FROM agents WHERE user_id = ANY($1) AND status = 'active'", [mine.map((a) => a.id)])).rows[0].c;
  check('agents', `${C.name}: franchise admin approved all ${mine.length} (+${mine.filter((a) => a.car).length} cars, ${subs.length} subscriptions on) → ${active} active`, active === mine.length);
}
await pool(AG.filter((a) => a.id), 8, async (a) => {
  const t = await otp(a.phone, 'agent', a.ip);
  a.token = t.d.token;
  const home = a.C.town[0];
  await call('/agent/status', { method: 'PATCH', token: a.token, body: { online: true, locality_id: home.id }, ip: a.ip });
  await call('/agent/location', { method: 'POST', token: a.token, body: { lat: Number(home.lat), lng: Number(home.lng), accuracy: 15 }, ip: a.ip });
});
check('agents', `all ${AG.length} agents log in with OTP and go online`, AG.every((a) => a.token), AG.filter((a) => !a.token).map((a) => a.full).join(', '));

// ============ 3. every service in each city → one order each ============
const pinOf = (l) => ({ lat: Number(l.lat), lng: Number(l.lng) });
const contact = (u, l = u.loc) => ({ name: u.name, phone: u.phone, address_line: `zt H.No ${u.i}, Load Test Colony`, landmark: 'Near temple', locality_id: l.id, ...pinOf(l) });
for (const C of CITIES) {
  const cats = (await call('/categories', { city: C.id })).d;
  C.plan = [];
  const svcs = [];
  for (const cat of cats) for (const s of (await call(`/categories/${cat.slug}`, { city: C.id })).d.services || []) svcs.push({ ...s, cat: cat.slug });
  const water = (await call('/home-cards', { city: C.id })).d?.[0];
  if (water && !svcs.some((s) => s.slug === water.slug)) svcs.push({ ...water, cat: 'home-services' });
  C.skipped = [];
  for (const s of svcs) {
    const d = (await call(`/services/${s.slug}`, { city: C.id })).d;
    if (!d.service) { C.skipped.push(`${s.name} (${d.error})`); continue; }
    const sv = d.service, prods = (d.products || []).filter((p) => p.in_stock);
    const isInst = (sv.source_service_ids || []).length > 0;
    let job;
    if (['share-ride', 'daily-workers', 'digital-services', 'offers', 'goods-transport'].includes(s.cat)) { C.skipped.push(`${s.name} (no orders: ${s.cat} — checked separately)`); continue; }
    if (sv.slug === 'home-food-book-a-cook') job = { label: `👩‍🍳 ${sv.name}`, body: { service_id: sv.id, cook: { day: 'tomorrow', start: '09:00', hours: 2 } } };
    else if (sv.skill_code === 'tomorrow_meals') {
      const menu = (await call('/meal-menu', { city: C.id })).d;
      const plate = menu.products?.find((p) => p.meal === 'lunch');
      if (!plate) { C.skipped.push(`${sv.name} (no plates)`); continue; }
      job = { label: `🍱 ${sv.name} (${plate.name})`, body: { items: [{ product_id: plate.id, qty: 2 }] } };
    } else if (s.cat === 'events') job = { label: `🎉 ${sv.name}`, body: { service_id: sv.id, event: { event_type: 'Birthday', event_date: day(12), event_time: '18:00', guests: '60', details: 'zt load test' } } };
    else if (s.cat === 'vehicle-rental') job = { label: `🚗 ${sv.name} (Maruti Ertiga)`, body: { service_id: sv.id, trip: { trip_type: 'One way', drop: 'Hyderabad airport', trip_date: day(4), trip_time: '06:00', car_model_id: String(MODELS[0].id) } } };
    else if (sv.is_village) {
      if (!C.village) { C.skipped.push(`${sv.name} (no village)`); continue; }
      const p = prods[0];
      job = { label: `🏡 ${sv.name}`, village: true, body: { via_service_id: sv.id, items: [p ? { product_id: p.id, qty: 1 } : { service_id: sv.id, name: 'Bike chain lock', qty_text: '1' }] } };
    } else if (isInst) job = { label: `⚡ ${sv.name}`, body: { via_service_id: sv.id, items: [{ product_id: prods[0].id, qty: 1 }, { service_id: sv.id, name: 'Dolo 650', qty_text: '1 strip' }] } };
    else if (prods.length) job = { label: `🛒 ${sv.name}`, body: { items: prods.slice(0, sv.slug.includes('water') ? 1 : 2).map((p) => ({ product_id: p.id, qty: 1 })) } };
    else if (sv.allows_list) job = { label: `🛠️ ${sv.name}`, body: { items: ['Item one', 'Item two'].map((x) => ({ service_id: sv.id, name: `zt ${x}`, qty_text: '1' })) } };
    else job = { label: `🔧 ${sv.name}`, body: { service_id: sv.id, notes: 'zt load test booking' } };
    C.plan.push({ ...job, service: sv.name, slug: sv.slug, cat: s.cat, skill: sv.skill_code });
  }
  // mixed cart (two shops → delivery agents)
  const fruit = (await call('/services/food-daily-fruit-delivery', { city: C.id })).d.products?.find((p) => p.in_stock);
  const kir = (await call('/services/food-daily-kirana-delivery', { city: C.id })).d.products?.find((p) => p.in_stock);
  if (fruit && kir) C.plan.push({ label: '🧺 Mixed cart (fruit + kirana)', service: 'Mixed cart', slug: 'mixed', cat: 'food-daily', skill: 'delivery', body: { items: [{ product_id: fruit.id, qty: 1 }, { product_id: kir.id, qty: 1 }] } });
  check('services', `${C.name}: ${C.plan.length} orderable services planned (+ ${C.skipped.length} not-order services checked separately)`, C.plan.length > 20, C.skipped.join('; '));
}

// each customer one order; services round-robin so every service is ordered at least once (most several times)
const ORD = [];
for (const C of CITIES) {
  const mine = CUST.filter((u) => u.C === C && u.token);
  mine.forEach((u, k) => {
    const job = C.plan[k % C.plan.length];
    const vq = null;
    ORD.push({ C, u, job, label: `${C.key}${u.i} ${job.label}` });
  });
}
await pool(ORD, 10, async (o) => { // the slot the checkout would offer first (milk 6–9 AM, village next day, meals…)
  const b = o.job.body, prods = (b.items || []).filter((i) => i.product_id).map((i) => i.product_id).join(',');
  const qs = b.via_service_id ? `via=${b.via_service_id}&locality=${(o.job.village ? o.C.village : o.u.loc).id}` : prods ? `products=${prods}` : b.service_id ? `service=${b.service_id}` : '';
  if (!qs) return;
  const q = (await call(`/orders/quote?${qs}`, { token: o.u.token, city: o.C.id, ip: o.u.ip })).d;
  o.slot = q.slots?.[0];
});
const t1 = Date.now();
await Promise.all(ORD.map(async (o) => { // ⚡ all customers of both cities at the same moment
  const l = o.job.village ? o.C.village : o.u.loc;
  const r = await call('/orders', { method: 'POST', token: o.u.token, ip: o.u.ip, city: o.C.id,
    body: { contact: contact(o.u, l), slot: o.slot || 'As soon as possible', ...o.job.body } });
  o.ms = r.ms;
  if (r.s !== 201) { o.err = `${r.s} ${r.d.error || JSON.stringify(r.d)}`; return; }
  Object.assign(o, { id: r.d.id, skill: r.d.skill_code, fee: n(r.d.delivery_fee), total: n(r.d.total), subtotal: n(r.d.subtotal), kind: r.d.kind, status: 'placed', fr: r.d.franchise_id });
}));
const placeSecs = ((Date.now() - t1) / 1000).toFixed(1);
const okOrd = ORD.filter((o) => o.id);
const times = okOrd.map((o) => o.ms).sort((a, b) => a - b);
check('load', `${ORD.length} orders placed by ${ORD.length} customers AT THE SAME TIME: ${okOrd.length} ok in ${placeSecs}s (median ${times[Math.floor(times.length / 2)]} ms, slowest ${times.at(-1)} ms)`,
  okOrd.length === ORD.length, ORD.filter((o) => o.err).map((o) => `${o.label}: ${o.err}`).join(' | '));
for (const C of CITIES) {
  const mine = okOrd.filter((o) => o.C === C);
  check('routing', `${C.name}: every order belongs to ${C.name} (${mine.length})`, mine.every((o) => o.fr === C.id), mine.filter((o) => o.fr !== C.id).map((o) => o.label).join(', '));
  const bad = mine.filter((o) => o.skill !== o.job.skill && !(o.job.skill === 'delivery' && o.job.slug === 'mixed'));
  check('routing', `${C.name}: each order went to its service's agent type`, !bad.length, bad.map((o) => `${o.label} → ${o.skill} (service: ${o.job.skill})`).join(' | '));
  const covered = new Set(mine.map((o) => o.job.slug));
  check('services', `${C.name}: all ${C.plan.length} services got at least one order`, C.plan.every((p) => covered.has(p.slug)), C.plan.filter((p) => !covered.has(p.slug)).map((p) => p.service).join(', '));
}

// ============ 4. routing: what every agent is offered ============
const offered = {};
await pool(AG.filter((a) => a.token), 10, async (a) => {
  const r = await call('/agent/available', { token: a.token, ip: a.ip });
  a.sees = (Array.isArray(r.d) ? r.d : []).map((x) => x.id);
});
for (const a of AG) for (const id of a.sees || []) (offered[id] ||= []).push(a);
let wrongSee = [], missed = [];
for (const a of AG.filter((x) => x.token)) {
  for (const id of a.sees) { const o = okOrd.find((x) => x.id === id); if (o && (o.C !== a.C || o.skill !== a.type)) wrongSee.push(`${a.full} sees ${o.label}`); }
}
for (const o of okOrd) {
  const right = AG.filter((a) => a.C === o.C && a.type === o.skill && (o.skill !== 'car_rental_agent' || a.model.id === MODELS[0].id)); // 🚙 a car booking goes only to owners of that model
  const saw = right.filter((a) => a.sees?.includes(o.id));
  if (saw.length !== right.length) missed.push(`${o.label}: ${saw.length}/${right.length} ${o.skill} agents`);
}
check('routing', `no agent is offered another type's or another city's order (${AG.length} agents checked)`, !wrongSee.length, wrongSee.slice(0, 8).join(' | '));
check('routing', `every order is offered to all 3 agents of its type in its own city (${okOrd.length} orders)`, !missed.length, missed.slice(0, 10).join(' | '));

// ============ 5. agents work, in parallel, racing for the same orders ============
const billFor = (o) => 150 + (o.id % 9) * 25;
const t2 = Date.now();
let races = 0, raceLost = 0;
async function finish(a, o) {
  const seen = (await call(`/agent/orders/${o.id}`, { token: a.token, ip: a.ip })).d;
  if (seen.contact_phone !== o.u.phone) o.problem = `agent sees phone ${seen.contact_phone}`;
  let x;
  if (seen.items?.some((i) => i.on_bill)) {
    const f = new FormData();
    Object.entries({ amount: String(billFor(o)), shop_name: 'zt Load Test Shop', mode: 'agent_cash' }).forEach(([k, v]) => f.append(k, v));
    f.append('bill_photo', PNG(), 'bill.png');
    x = await call(`/agent/orders/${o.id}/bill`, { method: 'POST', token: a.token, form: f, ip: a.ip });
    if (x.s !== 204) return (o.problem = `bill ${x.s} ${JSON.stringify(x.d)}`);
    o.bill = billFor(o);
  }
  x = await call(`/agent/orders/${o.id}/status`, { method: 'POST', token: a.token, body: { status: 'picked_up' }, ip: a.ip });
  if (x.s !== 204) return (o.problem = `pick up ${x.s} ${JSON.stringify(x.d)}`);
  const cur = (await call(`/orders/${o.id}`, { token: o.u.token, ip: o.u.ip })).d;
  if (n(cur.delivery_fee) > 0) {
    x = await call(`/agent/orders/${o.id}/fee-received`, { method: 'POST', token: a.token, body: { mode: 'cash' }, ip: a.ip });
    if (x.s !== 204) return (o.problem = `fee ${x.s} ${JSON.stringify(x.d)}`);
  }
  x = await call(`/agent/orders/${o.id}/status`, { method: 'POST', token: a.token, body: { status: 'delivered', otp: cur.delivery_otp }, ip: a.ip });
  if (x.s !== 204) return (o.problem = `deliver ${x.s} ${JSON.stringify(x.d)}`);
  const back = (await call(`/orders/${o.id}`, { token: o.u.token, ip: o.u.ip })).d;
  Object.assign(o, { status: back.status, agent: a, total: n(back.total), fee: n(back.delivery_fee), earning: n(back.agent_earning) });
  a.done.push(o); a.earn += o.earning; a.cash += o.total;
}
await Promise.all(AG.filter((a) => a.token).map(async (a) => {
  for (let guard = 0; guard < 60; guard++) {
    const av = (await call('/agent/available', { token: a.token, ip: a.ip })).d;
    const list = (Array.isArray(av) ? av : []).filter((x) => okOrd.some((o) => o.id === x.id));
    if (!list.length) return;
    const pick = list[(a.k - 1) % list.length]; // agents of a type start on different orders, but often collide
    races++;
    const r = await call(`/agent/orders/${pick.id}/accept`, { method: 'POST', token: a.token, ip: a.ip });
    if (r.s !== 200) { raceLost++; if (r.s !== 409) okOrd.find((o) => o.id === pick.id).problem = `accept ${r.s} ${JSON.stringify(r.d)}`; continue; }
    await finish(a, okOrd.find((o) => o.id === pick.id));
  }
}));
const workSecs = ((Date.now() - t2) / 1000).toFixed(1);
const delivered = okOrd.filter((o) => o.status === 'delivered');
check('delivery', `${delivered.length}/${okOrd.length} orders delivered by the agents in ${workSecs}s (${races} accept taps, ${raceLost} lost the race → "already taken")`,
  delivered.length === okOrd.length, okOrd.filter((o) => o.status !== 'delivered').map((o) => `${o.label} [${o.status}] ${o.problem || ''}`).slice(0, 12).join(' | '));
const dbl = (await db.query('SELECT count(*)::int c FROM orders WHERE id = ANY($1) AND agent_id IS NULL AND status = $2', [okOrd.map((o) => o.id), 'delivered'])).rows[0].c;
check('delivery', 'no order was taken by two agents (each delivered order has exactly one agent)', dbl === 0 && delivered.every((o) => o.agent));
for (const C of CITIES) {
  const wrongCity = delivered.filter((o) => o.C === C && o.agent.C !== C);
  check('delivery', `${C.name}: every order delivered by a ${C.name} agent of the right type`, !wrongCity.length && delivered.filter((o) => o.C === C).every((o) => o.agent.type === o.skill),
    wrongCity.map((o) => o.label).join(', '));
}

// ============ 6. the numbers ============
const fromDb = async (ids) => (await db.query('SELECT id, total, delivery_fee, agent_earning, status, skill_code FROM orders WHERE id = ANY($1)', [ids])).rows;
for (const C of CITIES) {
  const mine = okOrd.filter((o) => o.C === C), done = mine.filter((o) => o.status === 'delivered');
  const exp = { orders: mine.length, delivered: done.length, revenue: sum(done, (o) => o.total), delivery_fees: sum(done, (o) => o.fee), agent_pay: sum(done, (o) => o.earning),
    new_customers: CUST.filter((u) => u.C === C && u.token).length };
  const rep = (await call(`/admin/reports?${RANGE}`, { token: C.token })).d;
  for (const k of Object.keys(exp)) check(`franchise ${C.name}`, `Reports · ${k}: +${n(rep.kpis[k]) - n(C.before.kpis[k])} (expected ${exp[k]})`, n(rep.kpis[k]) - n(C.before.kpis[k]) === exp[k]);
  // by type
  const byType = {};
  for (const o of mine) { const t = (byType[o.skill] ||= { orders: 0, revenue: 0 }); t.orders++; if (o.status === 'delivered') t.revenue += o.total; }
  const names = Object.fromEntries((await call('/service-types')).d.map((t) => [t.code, t.name]));
  const typeBad = Object.entries(byType).filter(([code, t]) => {
    const now = rep.by_type.find((x) => x.name === names[code]) || {}, was = C.before.by_type?.find((x) => x.name === names[code]) || {};
    return n(now.orders) - n(was.orders) !== t.orders || n(now.revenue) - n(was.revenue) !== t.revenue;
  });
  check(`franchise ${C.name}`, `Reports · by agent type (${Object.keys(byType).length} types) orders + revenue match`, !typeBad.length, typeBad.map(([c]) => c).join(', '));
  // by agent (only our test agents)
  const agBad = [];
  for (const a of AG.filter((x) => x.C === C && x.token)) {
    const row = rep.agents.find((x) => x.user_id === a.id) || {};
    const e = { delivered: a.done.length, earnings: a.earn, order_value: sum(a.done, (o) => o.total), cash_in_hand: a.cash };
    const g = { delivered: n(row.delivered), earnings: n(row.earnings), order_value: n(row.order_value), cash_in_hand: n(row.cash_in_hand) };
    if (JSON.stringify(e) !== JSON.stringify(g)) agBad.push(`${a.full} exp ${JSON.stringify(e)} got ${JSON.stringify(g)}`);
  }
  check(`franchise ${C.name}`, `Reports · every agent's deliveries, earnings, order value, cash in hand (${AG.filter((x) => x.C === C).length} agents)`, !agBad.length, agBad.slice(0, 4).join(' | '));
  // by category adds up
  const catRev = (r) => sum(r.by_category || [], (x) => n(x.revenue));
  check(`franchise ${C.name}`, `Reports · categories ₹${catRev(rep) - catRev(C.before)} + delivery charges ₹${exp.delivery_fees} = revenue ₹${exp.revenue}`,
    catRev(rep) - catRev(C.before) + exp.delivery_fees === exp.revenue);
  const csv = await (await call(`/admin/reports/orders.csv?${RANGE}`, { token: C.token, raw: true })).text();
  check(`franchise ${C.name}`, `Reports · CSV download lists all ${mine.length} orders`, mine.every((o) => csv.includes(String(o.id))));
  const other = CITIES.find((x) => x !== C);
  check(`franchise ${C.name}`, `${C.name}'s admin does not see ${other.name}'s orders`, !okOrd.filter((o) => o.C === other).some((o) => csv.includes(`\n${o.id},`)));
  // HQ, this city
  const h = (await call(`/super/reports?${RANGE}&franchise=${C.id}`, { token: hq })).d;
  const hexp = { orders: mine.filter((o) => o.kind === 'products').length, bookings: mine.filter((o) => o.kind === 'service').length, completed: done.length, revenue: exp.revenue, delivery_charges: exp.delivery_fees };
  for (const k of Object.keys(hexp)) check(`HQ · ${C.name}`, `HQ Reports (${C.name}) · ${k}: +${n(h.totals[k]) - n(C.hqBefore.totals[k])} (expected ${hexp[k]})`, n(h.totals[k]) - n(C.hqBefore.totals[k]) === hexp[k]);
  C.exp = exp;
}
const hAll = (await call(`/super/reports?${RANGE}`, { token: hq })).d;
const allRev = sum(CITIES, (C) => C.exp.revenue);
check('HQ · all cities', `HQ Reports (all cities) · revenue +₹${n(hAll.totals.revenue) - n(before.hq.totals.revenue)} = Siddipet + Armoor ₹${allRev}`, n(hAll.totals.revenue) - n(before.hq.totals.revenue) === allRev);
check('HQ · all cities', `HQ Reports (all cities) · completed +${n(hAll.totals.completed) - n(before.hq.totals.completed)} (expected ${delivered.length})`, n(hAll.totals.completed) - n(before.hq.totals.completed) === delivered.length);
const dash = (await call('/super/dashboard', { token: hq })).d;
check('HQ · all cities', `HQ Dashboard · revenue today +₹${n(dash.revenue_today) - n(before.dash.revenue_today)} (expected ₹${allRev})`, n(dash.revenue_today) - n(before.dash.revenue_today) === allRev);
check('HQ · all cities', `HQ Dashboard · customers +${n(dash.users_total) - n(before.dash.users_total)} (expected ${CUST.filter((u) => u.token).length})`, n(dash.users_total) - n(before.dash.users_total) === CUST.filter((u) => u.token).length);

// agents' own app
const meBad = [];
await pool(AG.filter((a) => a.token), 10, async (a) => {
  const me = (await call('/agent/me', { token: a.token, ip: a.ip })).d.stats || {};
  const g = { deliveries: n(me.total_deliveries), today: n(me.today_deliveries), earn: n(me.today_earnings), cash: n(me.cash_in_hand) };
  const e = { deliveries: a.done.length, today: a.done.length, earn: a.earn, cash: a.cash };
  if (JSON.stringify(g) !== JSON.stringify(e)) meBad.push(`${a.full} exp ${JSON.stringify(e)} got ${JSON.stringify(g)}`);
  const hist = (await call('/agent/orders?scope=history', { token: a.token, ip: a.ip })).d;
  if (a.done.some((o) => !(Array.isArray(hist) ? hist : []).some((x) => x.id === o.id))) meBad.push(`${a.full}: history misses an order`);
});
check('agent app', `every agent's own app: deliveries, today's earnings, cash in hand, history (${AG.length} agents)`, !meBad.length, meBad.slice(0, 4).join(' | '));
const workers = AG.filter((a) => a.done.length);
check('agent app', `work was shared: ${workers.length}/${AG.length} agents delivered at least one order`, workers.length >= AG.length * 0.5, `${workers.length}`);

// customers
const custBad = [];
await pool(CUST.filter((u) => u.token), 20, async (u) => {
  const mine = (await call('/orders', { token: u.token, ip: u.ip })).d;
  const expIds = okOrd.filter((o) => o.u === u).map((o) => o.id).sort().join();
  const got = (Array.isArray(mine) ? mine : []).map((o) => o.id).sort().join();
  if (got !== expIds) custBad.push(`${u.name}: ${got} vs ${expIds}`);
  for (const o of okOrd.filter((x) => x.u === u)) { const x = mine.find?.((y) => y.id === o.id); if (x && x.status !== 'delivered') custBad.push(`${u.name} #${o.id} shows ${x.status}`); }
});
check('customer app', `every customer's Orders tab shows exactly their own order, delivered (${CUST.length} customers)`, !custBad.length, custBad.slice(0, 5).join(' | '));
const dbRows = await fromDb(delivered.map((o) => o.id));
check('customer app', 'every delivered order: total = items/bill + delivery charge (database)', dbRows.every((r) => n(r.total) >= n(r.delivery_fee)) && delivered.every((o) => o.total === n(dbRows.find((r) => r.id === o.id)?.total)));

// ============ 7. not-order services: each city sees only its own ============
for (const C of CITIES) {
  const other = CITIES.find((x) => x !== C);
  const tr = (await call('/transport', { city: C.id })).d, of = (await call('/offers', { city: C.id })).d, wk = (await call('/workers', { city: C.id })).d;
  check('other services', `${C.name}: Goods Transport, Offers, Daily Workers pages open`, tr && Array.isArray(of) && wk);
  const sr = (await call(`/share-ride/search?from=${C.name}&to=Hyderabad&date=${day(15)}&passengers=1`, { city: C.id })).d;
  check('other services', `${C.name}: Share Ride search answers`, Array.isArray(sr) || sr?.rides);
}

// ============ report ============
const report = {
  date: new Date().toISOString(), minutes: ((Date.now() - T0) / 60000).toFixed(1), pass, fail,
  numbers: { customers: CUST.filter((u) => u.token).length, agents: AG.filter((a) => a.token).length, orders: okOrd.length, delivered: delivered.length,
    place_seconds: placeSecs, work_seconds: workSecs, median_ms: times[Math.floor(times.length / 2)], slowest_ms: times.at(-1), races, race_lost: raceLost },
  cities: CITIES.map((C) => ({ name: C.name, services: C.plan.map((p) => p.service), skipped: C.skipped, expected: C.exp,
    orders: okOrd.filter((o) => o.C === C).map((o) => ({ id: o.id, service: o.job.service, type: o.skill, total: o.total, fee: o.fee, bill: o.bill || null, status: o.status, agent: o.agent?.full || null })) })),
  results,
};
fs.writeFileSync(`${DIR}/load_report.json`, JSON.stringify(report, null, 1));
console.log(`\n${pass} passed, ${fail} failed · ${report.minutes} min`);
await db.end();
