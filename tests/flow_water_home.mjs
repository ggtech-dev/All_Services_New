// Services cleanup 1: 💧 water card (₹25, delivery included, our staff only, never mixed) and 🏠 home services with
// no price (agent pay 0). Test accounts are zt_ (removed by cleanup.mjs); acts only on its own orders.
import bcrypt from 'bcryptjs';
import pg from 'pg';
import './testadmin.mjs';
const API = 'http://localhost:5000/api';
let pass = 0, fails = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? ` — ${String(x).slice(0, 180)}` : ''}`); c ? pass++ : fails++; };
const call = async (p, { method = 'GET', body, token } = {}) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method, headers, body: body && JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return Array.isArray(d) ? Object.assign(d, { http: r.status }) : { ...d, http: r.status };
};
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
const hash = await bcrypt.hash(process.env.TEST_STAFF_PW, 10);
const area = (await db.query("SELECT id, pincode, lat::float, lng::float FROM localities WHERE is_active AND NOT is_village AND franchise_id = 1 ORDER BY id LIMIT 1")).rows[0];
const mkUser = async (username, role, phone) => (await db.query(
  `INSERT INTO users (username, password_hash, full_name, role, phone) VALUES ($1,$2,$3,$4,$5)
   ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`, [username, hash, username, role, phone])).rows[0].id;
const cust = await mkUser('zt_water_cust', 'customer', '9000000961');
const mkAgent = async (u, phone, skills) => {
  const id = await mkUser(u, 'agent', phone);
  await db.query(`INSERT INTO agents (user_id, status, franchise_id, locality_id, skills) VALUES ($1,'active',1,$2,$3)
                  ON CONFLICT (user_id) DO UPDATE SET status='active', skills=EXCLUDED.skills`, [id, area.id, skills]);
  return id;
};
await mkAgent('zt_staff_agent', '9000000962', ['our_service_employees']);
await mkAgent('zt_home_agent', '9000000963', ['home_service']);
const login = async (username, portal) => (await call('/auth/login', { method: 'POST', body: { username, password: process.env.TEST_STAFF_PW, portal } })).token;
const ct = await login('zt_water_cust', 'user');
const contact = { name: 'Zt Water', phone: '9000000961', address_line: 'H.No 1-2, Test street', locality_id: area.id, lat: Number(area.lat), lng: Number(area.lng) };

try {
  const cards = await call('/home-cards');
  const water = cards[0];
  check('home card: water ₹25 per can, one item', water && water.products.length === 1 && Number(water.products[0].price) === 25, JSON.stringify(water?.products));
  const cat = await call('/categories/home-services');
  check('water is not inside Everyday Home Services any more', !cat.services.some((s) => s.id === water.id));
  check('home services: no price, "price on discussion"', cat.services.every((s) => Number(s.base_price) === 0 && /discussion/.test(s.price_unit)), cat.services.map((s) => s.base_price).join());

  const q = await call(`/orders/quote?products=${water.products[0].id}`, { token: ct });
  check('water: delivery charge ₹0 (included in ₹25)', Number(q.delivery_fee) === 0, JSON.stringify(q));
  let r = await call('/orders', { method: 'POST', token: ct, body: { contact, items: [{ product_id: water.products[0].id, qty: 2 }], slot: 'As soon as possible' } });
  const wid = r.id ?? r.order?.id;
  const wo = wid && (await db.query('SELECT total, delivery_fee, skill_code FROM orders WHERE id = $1', [wid])).rows[0];
  check('2 water cans → ₹50 total, ₹0 delivery, goes to our service employees', wo && Number(wo.total) === 50 && Number(wo.delivery_fee) === 0 && wo.skill_code === 'our_service_employees', JSON.stringify(wo || r));

  const milk = (await db.query("SELECT p.id FROM products p JOIN services s ON s.id = p.service_id WHERE s.slug = 'food-daily-fruit-delivery' AND p.is_active AND s.window_from IS NULL LIMIT 1")).rows[0];
  r = await call('/orders', { method: 'POST', token: ct, body: { contact, items: [{ product_id: water.products[0].id, qty: 1 }, { product_id: milk.id, qty: 1 }], slot: 'As soon as possible' } });
  check('water + milk in one order → refused (separate order)', r.http === 400 && /separate order/.test(r.error), r.error);

  // staff agent sees + delivers the water order; no per-order pay
  const st = await login('zt_staff_agent', 'agent');
  await call('/agent/status', { method: 'PATCH', token: st, body: { online: true, locality_id: area.id } });
  const avail = await call('/agent/available', { token: st });
  const list = Array.isArray(avail) ? avail : avail.orders || [];
  check('staff agent sees the water order', list.some((o) => o.id === wid && o.skill_code === 'our_service_employees'));
  const ht = await login('zt_home_agent', 'agent');
  await call('/agent/status', { method: 'PATCH', token: ht, body: { online: true, locality_id: area.id } });
  const hl = await call('/agent/available', { token: ht });
  check('a home-service partner does NOT see the water order', !(Array.isArray(hl) ? hl : hl.orders || []).some((o) => o.id === wid));
  r = await call(`/agent/orders/${wid}/accept`, { method: 'POST', token: st });
  await call(`/agent/orders/${wid}/status`, { method: 'POST', token: st, body: { status: 'picked_up' } });
  r = await call(`/agent/orders/${wid}/status`, { method: 'POST', token: st, body: { status: 'delivered' } });
  const wd = (await db.query('SELECT status, agent_earning FROM orders WHERE id = $1', [wid])).rows[0];
  check('water delivered by staff: no per-order pay (company employee)', wd.status === 'delivered' && Number(wd.agent_earning) === 0, JSON.stringify(wd));

  // plumber booking: no price, partner gets no per-order pay from us
  const plumber = cat.services.find((s) => /plumber/i.test(s.name));
  r = await call('/orders', { method: 'POST', token: ct, body: { contact, service_id: plumber.id, slot: 'Today' } });
  const pid = r.id ?? r.order?.id;
  const po = pid && (await db.query('SELECT total, delivery_fee FROM orders WHERE id = $1', [pid])).rows[0];
  check('plumber booking: ₹0 total, ₹0 charges', po && Number(po.total) === 0 && Number(po.delivery_fee) === 0, JSON.stringify(po || r));
  const hl2 = await call('/agent/available', { token: ht });
  const card = (Array.isArray(hl2) ? hl2 : hl2.orders || []).find((o) => o.id === pid);
  check('home partner sees the booking with total 0', card && Number(card.total) === 0);
  await call(`/agent/orders/${pid}/accept`, { method: 'POST', token: ht });
  await call(`/agent/orders/${pid}/status`, { method: 'POST', token: ht, body: { status: 'picked_up' } });
  await call(`/agent/orders/${pid}/status`, { method: 'POST', token: ht, body: { status: 'delivered' } });
  const pd = (await db.query('SELECT status, agent_earning FROM orders WHERE id = $1', [pid])).rows[0];
  check('plumber booking done: partner gets no per-order pay from us', pd.status === 'delivered' && Number(pd.agent_earning) === 0, JSON.stringify(pd));
  const types = await call('/service-types');
  check('new type "Our service employees" listed', types.some((t) => t.code === 'our_service_employees'));
} finally {
  await db.end();
}
console.log(`\n${pass} passed, ${fails} failed`);
