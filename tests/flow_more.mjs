// 🛠️ Shop For Me, 👷 Daily Workers, 💡 Digital Services — API test. zt_ test data only (cleanup.mjs removes it).
import pg from 'pg';
import './testadmin.mjs';
import { agentLogin, makeCustomer } from './test_helpers.mjs';
const API = 'http://localhost:5000/api';
let pass = 0, fails = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x !== '' ? ` — ${String(x).slice(0, 180)}` : ''}`); c ? pass++ : fails++; };
const call = async (p, { method = 'GET', body, token, form } = {}) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method, headers, body: form || (body && JSON.stringify(body)) });
  const d = r.status === 204 ? {} : await r.json().catch(() => ({}));
  return Array.isArray(d) ? Object.assign(d, { http: r.status }) : { ...d, http: r.status };
};
const login = async (u, portal) => (await call('/auth/login', { method: 'POST', body: { username: u, password: process.env.TEST_STAFF_PW, portal } })).token;
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
await makeCustomer('zt_more_cust', 'More Customer', '9000000931');
await makeCustomer('zt_more_cust2', 'More Customer Two', '9000000932');
const cust = await login('zt_more_cust', 'user');
const cust2 = await login('zt_more_cust2', 'user');
const admin = await login('zt_admin', 'admin');
const hq = await login('zt_super', 'superadmin');
const town = (await db.query('SELECT id FROM localities WHERE franchise_id = 1 AND is_active AND NOT is_village ORDER BY id LIMIT 1')).rows[0].id;
const townPin = (await db.query('SELECT lat::float, lng::float FROM localities WHERE id = $1', [town])).rows[0]; // 📍 delivery location
const contact = { name: 'Zt More', phone: '9000000931', address_line: 'H.No 9-9, Test Street', locality_id: town, ...townPin };

try {
  // ======================= 🛠️ SHOP FOR ME =======================
  const cats = await call('/categories');
  check('home: Shop For Me, Daily Workers, Digital Services categories', ['shop-for-me', 'daily-workers', 'digital-services'].every((s) => cats.some((c) => c.slug === s)));
  const sfm = await call('/categories/shop-for-me');
  check('Shop For Me has 8 tiles', sfm.services.length === 8, sfm.services.map((s) => s.name).join(' | '));
  const plumbing = (await call('/services/shop-for-me-plumbing-sanitary-items')).service;
  check('tile: write-your-list, up to 3 items, ₹50 delivery, ₹1,000 cash limit', plumbing.allows_list && plumbing.max_items === 3 && Number(plumbing.delivery_fee) === 50 && Number(plumbing.bill_cash_limit) === 1000);
  const line = (name) => ({ service_id: plumbing.id, name, qty_text: '1' });
  let r = await call('/orders', { method: 'POST', token: cust, body: { contact, items: [line('Tap'), line('Teflon tape'), line('Washer'), line('Pipe clip')], slot: 'As soon as possible' } });
  check('4 items refused: "up to 3 items"', r.http === 400 && /up to 3 items/.test(r.error), r.error);
  // launch offer: the first order of a mobile number has free delivery; after that ₹50
  const before = (await db.query("SELECT fn_free_deliveries_used(id) n FROM users WHERE username = 'zt_more_cust'")).rows[0]?.n ?? 1;
  r = await call('/orders', { method: 'POST', token: cust, body: { contact, items: [line('Kitchen tap (Parryware)'), line('Teflon tape'), line('Washer set')], slot: 'As soon as possible', shop_name: 'Zt Sri Sai Hardware, Main Road' } });
  const sid = r.id;
  const so = (await db.query('SELECT delivery_fee, skill_code, preferred_shop_name FROM orders WHERE id = $1', [sid])).rows[0];
  check(`3 items accepted: ${before ? '₹50' : '₹0 (first order offer)'} delivery, regular agents, customer’s shop saved`, so && Number(so.delivery_fee) === (before ? 50 : 0) && so.skill_code === 'delivery' && so.preferred_shop_name === 'Zt Sri Sai Hardware, Main Road', JSON.stringify(so || r));
  r = await call('/orders', { method: 'POST', token: cust, body: { contact, service_id: plumbing.id, slot: 'As soon as possible' } });
  check('a Shop For Me tile cannot be "booked" as a visit', r.http === 400 && /own page/.test(r.error), r.error);

  // agent: bill above ₹1,000 must be paid by the customer to the shop
  const f = new FormData();
  Object.entries({ full_name: 'Zt More Rider', phone: '9000000933', vehicle_type: 'bike', locality_id: town, skills: 'delivery' }).forEach(([k, v]) => f.append(k, v));
  await call('/admin/agents', { method: 'POST', token: admin, form: f });
  await agentLogin('zt_more_rider', '9000000933');
  const rider = await login('zt_more_rider', 'agent');
  await call('/agent/status', { method: 'PATCH', token: rider, body: { online: true, locality_id: town } });
  r = await call(`/agent/orders/${sid}/accept`, { method: 'POST', token: rider });
  const av = await call(`/agent/orders/${sid}`, { token: rider });
  check('agent accepts and sees "buy only from" the customer’s shop', (av.preferred_shop || av.order?.preferred_shop || '').includes('Sri Sai'), JSON.stringify(av).slice(0, 120));
  const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' });
  const bill = (amount, mode, upi) => {
    const b = new FormData();
    Object.entries({ amount, shop_name: 'Zt Sri Sai Hardware', mode, ...(upi && { upi_id: upi }) }).forEach(([k, v]) => b.append(k, v));
    b.append('bill_photo', png, 'bill.png');
    return call(`/agent/orders/${sid}/bill`, { method: 'POST', token: rider, form: b });
  };
  r = await bill(1500, 'agent_cash');
  check('bill ₹1,500 with agent cash refused (customer pays the shop by UPI)', r.http === 400 && /1000/.test(r.error), r.error);
  r = await bill(1500, 'customer_upi', 'zt.srisai@okaxis');
  check('bill ₹1,500 with "customer pays shop by UPI" accepted', r.http === 204, r.error);
  r = await bill(400, 'agent_cash');
  check('small bill ₹400 with agent cash is fine', r.http === 204, r.error);

  // ======================= 👷 DAILY WORKERS =======================
  r = await call('/workers', { method: 'POST', token: admin });
  let w = await call('/admin/localities', { token: admin }); // warm
  const add = (body, token = admin) => call('/workers/admin', { method: 'POST', token, body });
  const base = { tab: 'construction', name: 'Zt Mason Ramesh', phone: '9000000941', skill: 'Mason', area: 'Zt Nagar', experience_years: 10, is_available: true, id_checked: true };
  r = await add({ ...base, consent_recorded: false });
  check('worker without permission ticked refused', r.http === 400 && /permission/.test(r.error), r.error);
  const wk = await add({ ...base, consent_recorded: true });
  check('franchise admin adds a worker', wk.http === 201 && wk.id, wk.error);
  r = await add({ ...base, name: 'Zt Copy', consent_recorded: true });
  check('same number twice refused', r.http === 409, r.error);
  r = await add({ ...base, phone: '9000000942', consent_recorded: true }, hq);
  check('HQ cannot add workers (watch only)', r.http === 403);
  const off = await add({ ...base, name: 'Zt Switched Off', phone: '9000000943', consent_recorded: true });
  await call(`/workers/admin/${off.id}`, { method: 'PUT', token: admin, body: { ...base, name: 'Zt Switched Off', phone: '9000000943', consent_recorded: true, is_active: false } });
  const guest = await call('/workers?tab=construction');
  const gw = guest.workers.find((x) => x.id === wk.id);
  check('guest sees the worker but NOT the phone number', gw && !('phone' in gw) && guest.logged_in === false);
  check('switched-off worker hidden from customers', !guest.workers.some((x) => x.id === off.id));
  const logged = await call('/workers?tab=construction', { token: cust });
  check('logged-in customer sees the phone number', logged.workers.find((x) => x.id === wk.id)?.phone === '9000000941');
  check('other tab does not show him', !(await call('/workers?tab=painters')).workers.some((x) => x.id === wk.id));
  check('call without login refused', (await call(`/workers/${wk.id}/call`, { method: 'POST' })).http === 401);
  r = await call(`/workers/${wk.id}/call`, { method: 'POST', token: cust });
  const calls = (await db.query('SELECT call_count FROM workers WHERE id = $1', [wk.id])).rows[0].call_count;
  check('tap Call: counted for the admin', r.phone === '9000000941' && calls === 1, calls);
  r = await call(`/workers/${wk.id}/report`, { method: 'POST', token: cust, body: { reason: 'not_answering', note: 'Called 3 times' } });
  check('customer reports a problem', r.http === 201, r.error);
  r = await call(`/workers/${wk.id}/report`, { method: 'POST', token: cust, body: { reason: 'wrong_number' } });
  check('second report the same day refused', r.http === 409);
  let wa = await call('/workers/admin', { token: admin });
  const rep = wa.reports.find((x) => x.worker_id === wk.id && x.status === 'open');
  check('admin sees the report with the customer', rep && rep.customer_phone === '9000000931' && wa.workers.find((x) => x.id === wk.id).open_reports === 1);
  const stats = await call('/admin/orders-stats', { token: admin });
  check('sidebar badge counts open reports', stats.worker_reports >= 1);
  r = await call(`/workers/admin/reports/${rep.id}/close`, { method: 'POST', token: admin });
  check('admin marks the report checked', r.http === 204);
  check('HQ sees all workers (read only)', (await call('/workers/admin', { token: hq })).can_edit === false);
  r = await call('/orders', { method: 'POST', token: cust, body: { contact, service_id: (await call('/services/daily-workers-daily-workers')).service?.id, slot: 'As soon as possible' } });
  check('Daily Workers cannot be "booked" as an order', r.http === 400, r.error);

  // ======================= 💡 DIGITAL SERVICES =======================
  const ds = await call('/digital/services');
  check('2 tabs: 10 software + 8 video services', ds.tabs.software.items.length === 10 && ds.tabs.video.items.length === 8);
  const req = { tab: 'software', service: 'Website design', name: 'Zt More', phone: '9000000931', details: 'A website for my clothes shop with photos and a WhatsApp button', timing: 'Within a week', budget: '₹5,000 – ₹20,000', link: 'https://example.com' };
  check('sending needs a login', (await call('/digital/requests', { method: 'POST', body: req })).http === 401);
  r = await call('/digital/requests', { method: 'POST', token: cust, body: { ...req, details: 'web' } });
  check('too-short description refused', r.http === 400 && /what you need/.test(r.error), r.error);
  r = await call('/digital/requests', { method: 'POST', token: cust, body: { ...req, service: 'Hacking' } });
  check('unknown service refused', r.http === 400);
  r = await call('/digital/requests', { method: 'POST', token: cust, body: { ...req, link: 'javascript:alert(1)' } });
  check('bad link refused', r.http === 400 && /http/.test(r.error), r.error);
  const dr = await call('/digital/requests', { method: 'POST', token: cust, body: req });
  check('request sent', dr.http === 201 && dr.status === 'new');
  await call('/digital/requests', { method: 'POST', token: cust, body: { ...req, tab: 'video', service: 'Reels / Shorts editing', details: '10 reels a month for my bakery page', timing: 'No hurry', budget: '', link: '' } });
  const mine = await call('/digital/requests/mine', { token: cust });
  check('"My requests" lists both', mine.length === 2 && !('phone' in mine[0]) === true);
  check('another customer does not see them', (await call('/digital/requests/mine', { token: cust2 })).length === 0);
  check('franchise admin can NOT see Digital Services requests', (await call('/digital/admin', { token: admin })).http === 403);
  const hv = await call('/digital/admin', { token: hq });
  check('HQ sees the requests with phone and details', hv.requests.some((x) => x.id === dr.id && x.phone === '9000000931' && /clothes shop/.test(x.details)) && hv.counts.new >= 2);
  r = await call(`/digital/admin/${dr.id}`, { method: 'PUT', token: hq, body: { status: 'won', notes: 'Zt quoted ₹12,000, advance received' } });
  check('HQ marks it Won with notes', r.status === 'won' && /12,000/.test(r.notes));
  check('customer sees "Confirmed"', (await call('/digital/requests/mine', { token: cust })).some((x) => x.id === dr.id && x.status === 'won'));
  for (let i = 0; i < 3; i++) await call('/digital/requests', { method: 'POST', token: cust, body: req });
  r = await call('/digital/requests', { method: 'POST', token: cust, body: req });
  check('more than 5 requests a day refused (spam guard)', r.http === 429);
} finally {
  await db.query("DELETE FROM digital_requests WHERE customer_id IN (SELECT id FROM users WHERE username LIKE 'zt\\_%')");
  await db.query("DELETE FROM workers WHERE name LIKE 'Zt %'");
  await db.end();
}
console.log(`\n${pass} passed, ${fails} failed`);
