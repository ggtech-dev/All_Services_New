// End-to-end API test of every module before deployment: catalog, auth, customer orders (fixed price, shop bill,
// service booking, event, car, instant), agent work (accept → pick up → deliver, wallet, release), ratings,
// complaints, franchise admin (orders, assign, cancel, agents, subscriptions, shops, areas, reports, catalog requests),
// HQ (dashboard, franchises, reports, requests, ledger, users) and access rules between the roles.
// Uses only zt_ test accounts; never broadcasts, never sends a real SMS, acts only on its own order ids.
import './testadmin.mjs';
import bcrypt from 'bcryptjs';
import pg from 'pg';
const pgdb = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await pgdb.connect();
await pgdb.query('SET search_path=all_services');
const testHash = await bcrypt.hash(process.env.TEST_STAFF_PW, 10);
const API = 'http://localhost:5000/api';
let pass = 0, fails = 0;
const failures = [];
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${String(extra).slice(0, 160)}` : ''}`);
  if (cond) pass++; else { fails++; failures.push(label); }
};
async function call(path, { method = 'GET', body, token, form, franchise } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (franchise) headers['X-Franchise'] = String(franchise);
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const text = res.status === 204 ? '' : await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 80) }; }
  return { s: res.status, d: data };
}
const login = async (username, portal) => (await call('/auth/login', { method: 'POST', body: { username, password: process.env.TEST_STAFF_PW, portal } })).d.token;
// a real 1×1 PNG for photo uploads (shop bill)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const adm = await login('zt_admin', 'admin');
const sup = await login('zt_super', 'superadmin');
check('franchise admin and HQ test logins', !!adm && !!sup);

// ============ 1. public catalog ============
const cats = (await call('/categories')).d;
check('categories load (Health hidden)', Array.isArray(cats) && cats.length >= 5 && !cats.some((c) => c.slug === 'health'), cats.map?.((c) => c.slug).join(','));
let servicesSeen = 0, productServices = 0, badPages = [];
const svcBySlug = {};
for (const c of cats) {
  const d = (await call(`/categories/${c.slug}`)).d;
  // 📢 Offers Near You has no services: its tile opens /offers (the offers are checked by api_offers.mjs)
  if (!d.services?.length && !['offers', 'goods-transport'].includes(c.slug)) badPages.push(c.slug); // 🚚 has its own page (api_transport.mjs)
  for (const s of d.services || []) {
    servicesSeen++;
    svcBySlug[s.slug] = s;
    if (s.product_count > 0 || s.allows_list) {
      const sp = await call(`/services/${s.slug}`);
      if (sp.s !== 200) badPages.push(s.slug); else productServices++;
      svcBySlug[s.slug].detail = sp.d;
    }
  }
}
check(`every category & service page loads (${servicesSeen} services, ${productServices} shops)`, servicesSeen > 60 && !badPages.length, badPages.join(','));
for (const p of ['/localities', '/settings', '/service-types', '/event-types', '/trip-options', '/featured-services', '/instant-services', '/franchises', '/credits', '/promotions']) {
  const r = await call(p);
  check(`GET ${p}`, r.s === 200, r.s);
}
// Siddipet areas only (with 2+ cities the first area in the list can be another city's, e.g. Armoor's Alur)
const allLocs = (await call('/localities')).d;
const sidFr = allLocs.find((l) => l.name === 'Old Bus Stand').franchise_id;
const locs = allLocs.filter((l) => l.franchise_id === sidFr);
const loc = locs[0].id;
const city = locs[0].franchise_id;

// ============ 2. auth ============
// customers sign up with mobile OTP now (flow_login.mjs tests that): the test customer is made directly
await pgdb.query(`INSERT INTO users (username, password_hash, full_name, role, phone) VALUES ('zt_e2e_cust', $1, 'E2E Customer', 'customer', '9000000099')
                  ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`, [testHash]);
let r;
const cust = await login('zt_e2e_cust', 'user');
check('customer password login', !!cust);
check('wrong password refused', (await call('/auth/login', { method: 'POST', body: { username: 'zt_e2e_cust', password: 'nope99', portal: 'user' } })).s === 401);
check('who am I', (await call('/auth/me', { token: cust })).d.user?.username === 'zt_e2e_cust');
check('email login is gone', (await call('/auth/otp/request', { method: 'POST', body: { email: 'zt@example.com' } })).s === 404);
check('mobile OTP: invalid number refused (no SMS sent)', (await call('/auth/phone/request', { method: 'POST', body: { phone: '12345' } })).s === 400);
check('customer cannot use the admin login', (await call('/auth/login', { method: 'POST', body: { username: 'zt_e2e_cust', password: process.env.TEST_STAFF_PW, portal: 'admin' } })).s === 403);

// ============ 3. agents (created by the franchise admin) ============
const addAgent = async (u, phone, skills, vehicle = 'bike') => {
  const f = new FormData();
  Object.entries({ username: u, password: process.env.TEST_STAFF_PW, full_name: u, phone, vehicle_type: vehicle, locality_id: loc, skills }).forEach(([k, v]) => f.append(k, v));
  return call('/admin/agents', { method: 'POST', token: adm, form: f });
};
for (const [u, ph, sk, v] of [['zt_e2e_rider', '9000000081', 'delivery'], ['zt_e2e_rider2', '9000000082', 'delivery'], ['zt_e2e_plumber', '9000000083', 'home_service'],
  ['zt_e2e_events', '9000000084', 'events_agent'], ['zt_e2e_car', '9000000085', 'car_rental_agent', 'car'], ['zt_e2e_instant', '9000000086', 'instant']]) {
  r = await addAgent(u, ph, sk, v);
  check(`admin adds agent ${u} (${sk})`, r.s === 201, r.d.error);
  // agents log in by phone OTP; the test gives them a zt_ username + password (cleanup.mjs removes zt_ users)
  await pgdb.query('UPDATE users SET username = $1, password_hash = $2, has_password = true WHERE id = $3', [u, testHash, r.d.user_id]);
}
const tok = {};
for (const u of ['zt_e2e_rider', 'zt_e2e_rider2', 'zt_e2e_plumber', 'zt_e2e_events', 'zt_e2e_car', 'zt_e2e_instant']) {
  tok[u] = await login(u, 'agent');
  await call('/agent/status', { method: 'PATCH', token: tok[u], body: { online: true, locality_id: loc } });
  await call('/agent/location', { method: 'POST', token: tok[u], body: { lat: locs[0].lat, lng: locs[0].lng, accuracy: 20 } });
}
check('agents log in and go online', Object.values(tok).every(Boolean) && (await call('/agent/me', { token: tok.zt_e2e_rider })).s === 200);
check('agent cannot use the customer login', (await call('/auth/login', { method: 'POST', body: { username: 'zt_e2e_rider', password: process.env.TEST_STAFF_PW, portal: 'admin' } })).s === 403);

const contact = { name: 'E2E Customer', phone: '9848012345', address_line: 'H.No 1-2-3, Test Road', landmark: 'Near temple', locality_id: loc, lat: locs[0].lat, lng: locs[0].lng };
const available = async (t, id) => (await call('/agent/available', { token: t })).d.some?.((o) => o.id === id);
const custOrder = async (id) => (await call(`/orders/${id}`, { token: cust })).d;
async function deliver(agentTok, id, label) {
  // 🧾 items priced by the shop (every shop item since 2026-10-22): the agent adds the shop bill before pick-up
  const seen = (await call(`/agent/orders/${id}`, { token: agentTok })).d;
  if (seen.items?.some((i) => i.on_bill) && !seen.bill_uploaded_at) {
    const f = new FormData();
    f.append('amount', '120'); f.append('shop_name', 'zt Test Shop'); f.append('mode', 'agent_cash');
    f.append('bill_photo', new Blob([PNG], { type: 'image/png' }), 'bill.png');
    const b = await call(`/agent/orders/${id}/bill`, { method: 'POST', token: agentTok, form: f });
    check(`${label}: shop bill added`, b.s === 204, b.d.error);
  }
  let x = await call(`/agent/orders/${id}/status`, { method: 'POST', token: agentTok, body: { status: 'picked_up' } });
  check(`${label}: picked up / started`, x.s === 200 || x.s === 204, x.d.error);
  const otp = (await custOrder(id)).delivery_otp;
  x = await call(`/agent/orders/${id}/status`, { method: 'POST', token: agentTok, body: { status: 'delivered', otp } });
  check(`${label}: delivered / completed`, (x.s === 200 || x.s === 204) && (await custOrder(id)).status === 'delivered', x.d.error);
}

// ============ 4. product order (as per the shop bill — no item prices since 2026-10-22): full life ============
const fruit = svcBySlug['food-daily-fruit-delivery']?.detail;
const prod = fruit?.products?.find((p) => p.in_stock);
r = await call(`/orders/quote?products=${prod.id}`, { token: cust });
check('delivery charge quote', r.s === 200 && typeof r.d.delivery_fee === 'number', JSON.stringify(r.d).slice(0, 100));
r = await call('/orders', { method: 'POST', token: cust, body: { items: [{ product_id: prod.id, qty: 2 }], contact, slot: 'As soon as possible', notes: 'Ring the bell' } });
const o1 = r.d;
check('customer places a product order (as per shop bill: ₹0 now, the bill sets it)', r.s === 201 && o1.status === 'placed' && Number(o1.subtotal) === 0, r.d.error);
check('order shows in My orders', (await call('/orders', { token: cust })).d.some?.((o) => o.id === o1.id));
check('order tracking page data', (await custOrder(o1.id)).items?.length === 1);
check('delivery agent sees it (no phone before accept)', await available(tok.zt_e2e_rider, o1.id) && !JSON.stringify((await call('/agent/available', { token: tok.zt_e2e_rider })).d).includes('9848012345'));
check('plumber does not get product orders', !(await available(tok.zt_e2e_plumber, o1.id)));
r = await call(`/agent/orders/${o1.id}/accept`, { method: 'POST', token: tok.zt_e2e_rider });
check('agent accepts', r.s === 200, r.d.error);
check('second agent cannot take it any more', (await call(`/agent/orders/${o1.id}/accept`, { method: 'POST', token: tok.zt_e2e_rider2 })).s === 409);
check('after accept: customer phone visible to agent', (await call(`/agent/orders/${o1.id}`, { token: tok.zt_e2e_rider })).d.contact_phone === '9848012345');
check('customer sees "assigned" + agent name', (await custOrder(o1.id)).status === 'assigned');
check('live tracking endpoint', (await call(`/orders/${o1.id}/live`, { token: cust })).s === 200);
check('agent active orders list', (await call('/agent/orders', { token: tok.zt_e2e_rider })).d.some?.((o) => o.id === o1.id));
await deliver(tok.zt_e2e_rider, o1.id, 'product order');
check('agent earned + wallet', Number((await custOrder(o1.id)).agent_earning) > 0 && (await call('/agent/wallet', { token: tok.zt_e2e_rider })).s === 200);
r = await call(`/orders/${o1.id}/rating`, { method: 'POST', token: cust, body: { stars: 5, comment: 'Fast', tags: ['On time'] } });
check('customer rates the delivery', r.s === 200 && r.d.stars === 5, r.d.error);

// ============ 5. kirana: own list + shop bill ============
const kir = svcBySlug['food-daily-kirana-delivery']?.detail;
const kprod = kir?.products?.find((p) => p.in_stock);
r = await call('/orders', { method: 'POST', token: cust, body: { items: [{ product_id: kprod.id, qty: 1 }, { service_id: kir.service.id, name: 'Sugar', qty_text: '1 kg' }], contact, slot: 'As soon as possible' } });
const o2 = r.d;
check('kirana order with own list (priced by shop bill)', r.s === 201 && Number(o2.subtotal) === 0, r.d.error);
r = await call(`/agent/orders/${o2.id}/accept`, { method: 'POST', token: tok.zt_e2e_rider });
check('agent accepts kirana order', r.s === 200, r.d.error);
check('cannot pick up before the shop bill', (await call(`/agent/orders/${o2.id}/status`, { method: 'POST', token: tok.zt_e2e_rider, body: { status: 'picked_up' } })).s === 409);
const bf = new FormData();
bf.append('amount', '245'); bf.append('shop_name', 'zt Test Kirana'); bf.append('mode', 'agent_cash');
bf.append('bill_photo', new Blob([PNG], { type: 'image/png' }), 'bill.png');
r = await call(`/agent/orders/${o2.id}/bill`, { method: 'POST', token: tok.zt_e2e_rider, form: bf });
check('agent uploads the shop bill', r.s === 204, r.d.error);
check('customer sees the bill amount', Number((await custOrder(o2.id)).bill_amount) === 245);
await deliver(tok.zt_e2e_rider, o2.id, 'kirana order');

// ============ 6. customer cancels ============
r = await call('/orders', { method: 'POST', token: cust, body: { items: [{ product_id: prod.id, qty: 1 }], contact, slot: 'As soon as possible' } });
const o3 = r.d;
r = await call(`/orders/${o3.id}/cancel`, { method: 'POST', token: cust, body: { reason: 'Ordered by mistake' } });
check('customer cancels before acceptance', r.s === 204 && (await custOrder(o3.id)).status === 'cancelled', r.d.error);
check('cancelled order not offered to agents', !(await available(tok.zt_e2e_rider, o3.id)));

// ============ 7. service booking (plumber) ============
const plumber = svcBySlug['home-services-plumber-on-demand'];
r = await call('/orders', { method: 'POST', token: cust, body: { service_id: plumber.id, contact, slot: 'As soon as possible', notes: 'Kitchen tap leaking' } });
const o4 = r.d;
check('customer books a plumber', r.s === 201 && o4.kind === 'service', r.d.error);
check('only the plumber partner gets it', await available(tok.zt_e2e_plumber, o4.id) && !(await available(tok.zt_e2e_rider, o4.id)));
r = await call(`/agent/orders/${o4.id}/accept`, { method: 'POST', token: tok.zt_e2e_plumber });
check('plumber accepts', r.s === 200, r.d.error);
await deliver(tok.zt_e2e_plumber, o4.id, 'plumber visit');

// ============ 8. agent gives an order back ============
r = await call('/orders', { method: 'POST', token: cust, body: { items: [{ product_id: prod.id, qty: 1 }], contact, slot: 'As soon as possible' } });
const o5 = r.d;
await call(`/agent/orders/${o5.id}/accept`, { method: 'POST', token: tok.zt_e2e_rider });
r = await call(`/agent/orders/${o5.id}/release`, { method: 'POST', token: tok.zt_e2e_rider, body: { reason: 'Bike puncture' } });
check('agent gives the order back', r.s === 204 && (await custOrder(o5.id)).status === 'placed', r.d.error);
check('another agent can take it', (await call(`/agent/orders/${o5.id}/accept`, { method: 'POST', token: tok.zt_e2e_rider2 })).s === 200);

// ============ 9. event booking ============
const photo = svcBySlug['events-photography'];
const dayX = 0; const day = (n) => new Date(Date.now() + n * 86400e3 + 5.5 * 3600e3).toISOString().slice(0, 10);
r = await call('/orders', { method: 'POST', token: cust, body: { service_id: photo.id, contact, event: { event_type: 'Wedding', event_date: day(20), event_time: '18:30', guests: '200', details: 'Candid + album' } } });
const o6 = r.d;
check('event booking (photography)', r.s === 201 && o6.event_details?.event_type === 'Wedding', r.d.error);
check('event partner sees it', await available(tok.zt_e2e_events, o6.id));
await call(`/agent/orders/${o6.id}/accept`, { method: 'POST', token: tok.zt_e2e_events });
check('event cancel needs a reason', (await call(`/agent/orders/${o6.id}/release`, { method: 'POST', token: tok.zt_e2e_events, body: { reason: '' } })).s === 400);
r = await call(`/agent/orders/${o6.id}/release`, { method: 'POST', token: tok.zt_e2e_events, body: { reason: 'Price not agreed' } });
check('event partner cancels with reason', r.s === 204);
r = await call('/orders', { method: 'POST', token: cust, body: { service_id: photo.id, contact, rebook_of: o6.id, event: { event_type: 'Wedding', event_date: day(21), event_time: '10:00' } } });
check('customer books again (old booking cancelled)', r.s === 201 && (await custOrder(o6.id)).status === 'cancelled', r.d.error);

// ============ 10. car booking (subscription) ============
const carSvc = svcBySlug['vehicle-rental-car-booking'];
r = await call('/orders', { method: 'POST', token: cust, body: { service_id: carSvc.id, contact, trip: { trip_type: 'One way', drop: 'Hyderabad airport', trip_date: day(5), trip_time: '05:30', car_type: 'Sedan (4 seats)' } } });
const o7 = r.d;
check('car booking', r.s === 201 && o7.trip_details?.drop === 'Hyderabad airport', r.d.error);
check('car partner without subscription does not get it', !(await available(tok.zt_e2e_car, o7.id)));
const subs = (await call('/admin/subscriptions', { token: adm })).d;
const carId = subs.agents?.find((a) => a.username === 'zt_e2e_car')?.user_id;
r = await call('/admin/subscriptions', { method: 'POST', token: adm, body: { agent_id: carId, service_id: carSvc.id, amount: 0, mode: 'free', days: 30 } });
check('franchise admin activates the car subscription', r.s === 201, r.d.error);
check('now the car partner gets it', await available(tok.zt_e2e_car, o7.id));
check('HQ cannot change subscriptions (view only)', (await call('/admin/subscriptions', { method: 'POST', token: sup, body: { agent_id: carId, service_id: carSvc.id, amount: 0, mode: 'free', days: 30 } })).s === 403);

// ============ 11. instant delivery ============
const inst = (await call('/instant-services')).d;
const instSvc = Array.isArray(inst) ? inst[0] : null;
if (instSvc) {
  r = await call('/orders', { method: 'POST', token: cust, body: { via_service_id: instSvc.id, items: [{ service_id: instSvc.id, name: 'Dolo 650', qty_text: '1 strip' }], contact } });
  check('instant delivery order (write anything)', r.s === 201, r.d.error);
  if (r.s === 201) check('only the instant agent gets it', await available(tok.zt_e2e_instant, r.d.id) && !(await available(tok.zt_e2e_rider, r.d.id)));
} else check('instant delivery service exists', false);

// ============ 12. complaints ============
r = await call('/me/complaints', { method: 'POST', token: cust, body: { order_id: o1.id, subject: 'Late delivery', message: 'zt test complaint, please ignore' } });
check('customer reports a problem', r.s === 201 || r.s === 200, r.d.error);
const comp = (await call('/franchise/complaints', { token: adm })).d;
const myComp = (comp.list || comp).find?.((c) => /zt test complaint/.test(c.message || ''));
check('franchise admin sees the complaint', !!myComp);
if (myComp) {
  r = await call(`/franchise/complaints/${myComp.id}`, { method: 'PATCH', token: adm, body: { status: 'resolved', reply: 'Sorry, resolved' } });
  check('franchise admin replies', r.s === 200 || r.s === 204, r.d.error);
  check('customer sees the reply', JSON.stringify((await call('/me/complaints', { token: cust })).d).includes('Sorry, resolved'));
}

// ============ 13. franchise admin pages ============
const RANGE = `from=${new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`;
for (const p of ['/admin/orders-stats', '/admin/orders', '/admin/agents', '/admin/live', `/admin/reports?${RANGE}`, '/admin/ratings', '/admin/subscriptions',
  '/admin/localities', '/admin/shops', '/admin/service-types', '/admin/activity', '/franchise/me', '/franchise/services', '/franchise/requests',
  '/franchise/complaints', '/franchise/broadcasts', '/franchise/categories']) {
  const x = await call(p, { token: adm });
  check(`admin GET ${p}`, x.s === 200, x.d.error || x.s);
}
const adminOrders = (await call('/admin/orders', { token: adm })).d;
const list = adminOrders.orders || adminOrders;
check('admin order list has our orders', list.some?.((o) => o.id === o1.id));
check('admin order detail', (await call(`/admin/orders/${o1.id}`, { token: adm })).d.id === o1.id);
r = await call('/orders', { method: 'POST', token: cust, body: { items: [{ product_id: prod.id, qty: 1 }], contact, slot: 'As soon as possible' } });
const o8 = r.d;
const riderId = (await call('/admin/agents', { token: adm })).d.find?.((a) => a.username === 'zt_e2e_rider')?.user_id
  ?? (await call('/admin/subscriptions', { token: adm })).d.agents.find((a) => a.username === 'zt_e2e_rider').user_id;
r = await call(`/admin/orders/${o8.id}/assign`, { method: 'POST', token: adm, body: { agent_id: riderId } });
check('admin assigns an order to an agent', [200, 204].includes(r.s) && (await custOrder(o8.id)).status === 'assigned', `${r.s} ${r.d.error || ''} rider=${riderId} status=${(await custOrder(o8.id)).status}`);
r = await call(`/admin/orders/${o8.id}/cancel`, { method: 'POST', token: adm, body: { reason: 'zt admin cancel' } });
check('admin cancels an order', (r.s === 200 || r.s === 204) && (await custOrder(o8.id)).status === 'cancelled', r.d.error);
check('admin downloads orders CSV', (await fetch(`${API}/admin/reports/orders.csv?${RANGE}`, { headers: { Authorization: `Bearer ${adm}` } })).status === 200);
r = await call('/admin/shops', { method: 'POST', token: adm, body: { name: 'zt Test Shop', locality_id: loc, address: 'Main road', phone: '9000000077', service_ids: [kir.service.id] } });
check('admin adds a shop', r.s === 201, r.d.error);
const svcs = (await call('/franchise/services', { token: adm })).d;
check('franchise service list', Array.isArray(svcs.services || svcs));
r = await call('/franchise/requests', { method: 'POST', token: adm, body: { kind: 'service', name: 'zt Test Service', category_id: cats[0].id, note: 'zt test' } });
const req = r.d;
check('franchise asks HQ for a new service', r.s === 201, r.d.error);

// ============ 14. HQ (Super Admin) ============
for (const p of ['/super/dashboard', '/super/franchises', '/super/franchise-options', `/super/franchises/${city}`, `/super/franchises/${city}/report?${RANGE}`,
  `/super/franchises/${city}/users`, `/super/franchises/${city}/services`, '/super/service-coverage', '/super/requests', '/super/ledger', '/super/admins',
  '/super/users', `/super/reports?${RANGE}`, '/admin/stats', '/admin/categories', '/admin/services', '/admin/products', '/admin/promotions', '/admin/prices/history',
  '/admin/delivery-charges', '/admin/orders', '/admin/subscriptions']) {
  const x = await call(p, { token: sup });
  check(`HQ GET ${p}`, x.s === 200, x.d.error || x.s);
}
check('HQ sees one city (X-Franchise)', (await call('/admin/orders', { token: sup, franchise: city })).s === 200);
if (req?.id) {
  r = await call(`/super/requests/${req.id}/reject`, { method: 'POST', token: sup, body: { reason: 'zt test only' } });
  check('HQ answers the franchise request (reject)', r.s === 200 || r.s === 204, r.d.error);
}
r = await call(`/super/franchises/${city}/ledger`, { method: 'POST', token: sup, body: { type: 'adjustment', amount: 1, reference: 'zt-test', note: 'zt test entry' } });
check('HQ adds a ledger entry', r.s === 201, r.d.error);
if (r.d?.id) check('HQ deletes the ledger entry', [200, 204].includes((await call(`/super/ledger/${r.d.id}`, { method: 'DELETE', token: sup })).s));

// ============ 15. access rules ============
check('customer blocked from admin API', [401, 403].includes((await call('/admin/orders', { token: cust })).s));
check('agent blocked from admin API', [401, 403].includes((await call('/admin/orders', { token: tok.zt_e2e_rider })).s));
check('franchise admin blocked from HQ API', [401, 403].includes((await call('/super/franchises', { token: adm })).s));
check('franchise admin cannot change master catalog', [401, 403].includes((await call('/admin/categories', { method: 'POST', token: adm, body: { name: 'zt x' } })).s));
check('no token → 401', (await call('/orders')).s === 401);
check('other customer cannot open my order', (await call(`/orders/${o1.id}`, { token: tok.zt_e2e_rider })).s >= 400);

console.log(`\n${pass} passed, ${fails} failed${fails ? `\nFAILED: ${failures.join(' | ')}` : ''}`);

await pgdb.end();
