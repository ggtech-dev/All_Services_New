// 🏙️ Armoor vs Siddipet: the Armoor admin's login sees only Armoor; products / services HQ switched off for Armoor are
// hidden there (and can't be ordered) but still in Siddipet; Armoor's own out-of-stock; location picks the city;
// an order from an Armoor area goes to Armoor (its admin sees it, Siddipet's doesn't). Password from ARMOOR_PW.
// Test order (user7) and stock changes are undone at the end.
import pg from 'pg';
import './testadmin.mjs';
const API = 'http://localhost:5000/api';
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 240)}` : ''}`); c ? pass++ : fail++; };
const call = async (path, { method = 'GET', body, token, city } = {}) => {
  const r = await fetch(API + path, { method, headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }), ...(city && { 'x-franchise': String(city) }) },
    body: body && JSON.stringify(body) });
  return { s: r.status, d: r.status === 204 ? null : await r.json().catch(() => null) };
};
const login = async (username, password, portal) => (await call('/auth/login', { method: 'POST', body: { username, password, portal } })).d?.token;
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path = all_services');
const sid = (await db.query("SELECT id FROM franchises WHERE code = 'FR-0001'")).rows[0].id;
const arm = (await db.query("SELECT id FROM franchises WHERE city = 'Armoor'")).rows[0].id;
const startedAt = (await db.query('SELECT now() AS t')).rows[0].t;
const names = async (slug, city) => ((await call(`/services/${slug}`, { city })).d?.products || []).map((p) => p.name);
let sugar = null;
try {
  // the Armoor admin
  const armAdmin = await login('zt_admin_ar', process.env.TEST_STAFF_PW, 'admin');
  check('armoor_admin logs in to the franchise admin app', !!armAdmin);
  const me = await call('/franchise/me', { token: armAdmin });
  check(`it is Armoor's admin: ${me.d?.franchise?.city} (${me.d?.franchise?.code}), ${me.d?.franchise?.status}`, me.d?.franchise?.city === 'Armoor' && me.d.franchise.status === 'active');
  const sidAdmin = await login('zt_admin', process.env.TEST_STAFF_PW, 'admin');

  // what customers see in each city
  const kS = await names('food-daily-kirana-delivery', sid), kA = await names('food-daily-kirana-delivery', arm);
  const offK = ['Ponni Rice', 'Black Rice', 'Sticky Rice', 'Nandini Pure Ghee', 'Disano Oats', 'Gold Winner Sunflower Oil', 'Heinz Tomato Ketchup'];
  // 📦 an item can have several pack sizes (each its own row): Armoor hides every size of the 7
  const offRows = kS.filter((n) => offK.includes(n)).length;
  check(`Kirana: Siddipet ${kS.length} items, Armoor ${kA.length} — the 7 switched off (${offRows} with their sizes) are hidden in Armoor only`,
    offK.every((n) => kS.includes(n) && !kA.includes(n)) && kA.length === kS.length - offRows, offK.filter((n) => kA.includes(n)).join(','));
  const fS = await names('food-daily-fruit-delivery', sid), fA = await names('food-daily-fruit-delivery', arm);
  check(`Fruits: Siddipet ${fS.length}, Armoor ${fA.length} (Kiwi, Avocado, Passion Fruit, Longan hidden in Armoor)`,
    ['Kiwi', 'Avocado', 'Passion Fruit', 'Longan'].every((n) => fS.includes(n) && !fA.includes(n)));
  const bS = await names('food-daily-bread-bakery-delivery', sid), bA = await names('food-daily-bread-bakery-delivery', arm);
  check(`Bakery: Photo Cake & Red Velvet Cake only in Siddipet (${bS.length} vs ${bA.length})`, ['Photo Cake', 'Red Velvet Cake'].every((n) => bS.includes(n) && !bA.includes(n)));
  const catS = ((await call('/categories/food-daily', { city: sid })).d?.services || []).map((s) => s.name);
  const catA = ((await call('/categories/food-daily', { city: arm })).d?.services || []).map((s) => s.name);
  // (Monthly Grocery is switched off everywhere since 27 Oct)
  check(`Food & Daily: Pet Food in Siddipet only (Siddipet ${catS.length} cards, Armoor ${catA.length})`,
    catS.includes('Pet Food Delivery') && !catA.includes('Pet Food Delivery') && !catS.includes('Monthly Grocery Subscription'));
  const pet = await call('/services/food-daily-pet-food-delivery', { city: arm });
  check(`opening Pet Food in Armoor → "${pet.d?.error}"`, pet.s === 404);
  const searchA = (await call('/search?q=ponni', { city: arm })).d?.products || [];
  check(`search "ponni" in Armoor finds nothing (${searchA.length})`, !searchA.some((p) => /Ponni/.test(p.name)));

  // Armoor's own out-of-stock (its admin)
  sugar = (await db.query("SELECT p.id FROM products p JOIN services s ON s.id = p.service_id WHERE s.slug = 'food-daily-kirana-delivery' AND p.name = 'Sugar'")).rows[0].id;
  const st = await call(`/franchise/products/${sugar}/stock`, { method: 'PATCH', token: armAdmin, body: { in_stock: false } });
  const sugarA = ((await call('/services/food-daily-kirana-delivery', { city: arm })).d?.products || []).find((p) => p.id === sugar);
  const sugarS = ((await call('/services/food-daily-kirana-delivery', { city: sid })).d?.products || []).find((p) => p.id === sugar);
  check(`Armoor admin marks Sugar out of stock (${st.s}) → Armoor out, Siddipet still in stock`, sugarA?.in_stock === false && sugarS?.in_stock === true);
  const offList = await call('/franchise/out-of-stock', { token: sidAdmin });
  check(`Siddipet admin's out-of-stock list doesn't show Armoor's Sugar`, !offList.d?.some((p) => p.id === sugar));

  // location → city
  const locA = await call('/locate?lat=18.7905&lng=78.287');
  check(`a customer standing in Armoor → ${JSON.stringify(locA.d || {}).match(/Armoor/) ? 'Armoor' : '?'}`, /Armoor/.test(JSON.stringify(locA.d || {})));

  // an order from an Armoor area
  const user = await login('9000300107', process.env.TEST_USER_PW, 'user');
  const area = (await call('/localities', { city: arm })).d.find((l) => l.name === 'Armoor Bus Stand');
  const dal = (await db.query("SELECT p.id FROM products p JOIN services s ON s.id = p.service_id WHERE s.slug = 'food-daily-kirana-delivery' AND p.name = 'Toor Dal (Kandi Pappu)'")).rows[0].id;
  const ponni = (await db.query("SELECT p.id FROM products p JOIN services s ON s.id = p.service_id WHERE s.slug = 'food-daily-kirana-delivery' AND p.name = 'Ponni Rice'")).rows[0].id;
  const contact = { name: 'User7', phone: '9000300107', address_line: 'zt H.No 4-5, Armoor', locality_id: area.id, lat: 18.7905, lng: 78.287 };
  const bad = await call('/orders', { method: 'POST', token: user, body: { contact, items: [{ product_id: ponni, qty: 1 }] } });
  check(`ordering Ponni Rice (off in Armoor) to Armoor → refused ("${bad.d?.error}")`, bad.s === 400 || bad.s === 404, JSON.stringify(bad.d));
  const outSugar = await call('/orders', { method: 'POST', token: user, body: { contact, items: [{ product_id: sugar, qty: 1 }] } });
  check(`ordering Sugar (out of stock in Armoor) → refused ("${outSugar.d?.error}")`, outSugar.s === 400);
  const ok = await call('/orders', { method: 'POST', token: user, body: { contact, items: [{ product_id: dal, qty: 1 }] } });
  const ord = (await db.query('SELECT franchise_id FROM orders WHERE id = $1', [ok.d?.id])).rows[0];
  check(`Toor Dal order #${ok.d?.id} from Armoor Bus Stand → goes to Armoor`, ok.s === 201 && ord?.franchise_id === arm, JSON.stringify(ok.d).slice(0, 160));
  const listA = (await call('/admin/orders?status=placed', { token: armAdmin })).d;
  const listS = (await call('/admin/orders?status=placed', { token: sidAdmin })).d;
  const has = (l) => JSON.stringify(l || []).includes(`"id":${ok.d?.id},`);
  check(`Armoor admin sees order #${ok.d?.id}; Siddipet admin doesn't`, has(listA) && !has(listS));
} catch (e) {
  check('Armoor test ran without crashing', false, e.stack);
} finally {
  if (sugar) await db.query('UPDATE franchise_products SET in_stock = true WHERE franchise_id = $1 AND product_id = $2', [arm, sugar]);
  const o = await db.query("DELETE FROM orders WHERE contact_phone = '9000300107' AND created_at >= $1 RETURNING id", [startedAt]);
  console.log(`cleanup: ${o.rowCount} test order(s), Sugar back in stock in Armoor`);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
