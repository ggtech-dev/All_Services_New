// 🚫 Out of stock per city (stock.sql): the franchise admin (zt_admin, Siddipet) marks Kirana / vegetable items out of
// stock → the customer's shop shows them out of stock (only in Siddipet), an order with them is refused, "buy again"
// leaves them out; restock (one / a service / all); the activity log; HQ's switch for a city; checks.
// Everything is put back at the end.
import pg from 'pg';
import './testadmin.mjs';
const B = 'http://localhost:5000/api';
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 240)}` : ''}`); c ? pass++ : fail++; };
const call = async (path, { method = 'GET', body, token, city } = {}) => {
  const r = await fetch(B + path, { method, headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }), ...(city && { 'x-franchise': String(city) }) },
    body: body && JSON.stringify(body) });
  return { s: r.status, d: r.status === 204 ? null : await r.json().catch(() => null) };
};
const login = async (username, password, portal) => (await call('/auth/login', { method: 'POST', body: { username, password, portal } })).d?.token;
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path = all_services');
const city = (await db.query("SELECT id FROM franchises WHERE code = 'FR-0001'")).rows[0].id;
const other = (await db.query("SELECT id FROM franchises WHERE id <> $1 AND status = 'active' ORDER BY id LIMIT 1", [city])).rows[0]?.id;
const prod = async (svc, name) => (await db.query('SELECT p.id, p.name FROM products p JOIN services s ON s.id = p.service_id WHERE s.slug = $1 AND p.name = $2', [svc, name])).rows[0];
const sugar = await prod('food-daily-kirana-delivery', 'Sugar');
const dal = await prod('food-daily-kirana-delivery', 'Toor Dal (Kandi Pappu)');
const onion = await prod('food-daily-fresh-vegetables', 'Onion (Ullipaya)');
const kiranaSvc = (await db.query("SELECT id FROM services WHERE slug = 'food-daily-kirana-delivery'")).rows[0].id;
const startedAt = (await db.query('SELECT now() AS t')).rows[0].t;
const shopStock = async (slug, cityId, pid) => (await call(`/services/${slug}`, { city: cityId })).d?.products?.find((p) => p.id === pid);
try {
  const admin = await login('zt_admin', process.env.TEST_STAFF_PW, 'admin');
  const hq = await login('zt_super', process.env.TEST_STAFF_PW, 'super');
  check(`test items found: ${sugar?.name}, ${dal?.name}, ${onion?.name}`, sugar && dal && onion);

  // the admin's product list has the city's stock
  const list = await call(`/franchise/services/${kiranaSvc}/products`, { token: admin });
  const s0 = list.d?.find((p) => p.id === sugar.id);
  check(`admin sees Kirana products with stock (${list.d?.length} items; Sugar in_stock=${s0?.in_stock})`, list.s === 200 && s0?.in_stock === true && 'in_stock_all' in s0);

  // out of stock
  const out1 = await call(`/franchise/products/${sugar.id}/stock`, { method: 'PATCH', token: admin, body: { in_stock: false } });
  const out2 = await call(`/franchise/products/${onion.id}/stock`, { method: 'PATCH', token: admin, body: { in_stock: false } });
  await call(`/franchise/products/${dal.id}/stock`, { method: 'PATCH', token: admin, body: { in_stock: false } });
  check(`admin marks Sugar + Onion + Toor Dal out of stock (${out1.s}, ${out2.s})`, out1.s === 200 && out1.d.in_stock === false && out2.s === 200);
  const oos = await call('/franchise/out-of-stock', { token: admin });
  check(`out-of-stock list: ${oos.d?.map((p) => p.name).join(', ')}`, oos.d?.length >= 3 && oos.d.some((p) => p.id === onion.id && p.service_name));
  const stats = await call('/admin/orders-stats', { token: admin });
  check(`menu count out_of_stock = ${stats.d?.out_of_stock}`, Number(stats.d?.out_of_stock) >= 3);

  // the customer
  const sh = await shopStock('food-daily-kirana-delivery', city, sugar.id);
  check(`customer in Siddipet: Sugar shows out of stock`, sh && sh.in_stock === false);
  const shOther = other ? await shopStock('food-daily-kirana-delivery', other, sugar.id) : { in_stock: true };
  check(`customer in another city: Sugar still in stock`, !shOther || shOther.in_stock === true, JSON.stringify(shOther));
  const prods = (await call('/services/food-daily-kirana-delivery', { city })).d.products;
  const dalSection = prods.filter((p) => p.section === 'Dals & Pulses');
  check(`out-of-stock Toor Dal sits at the end of its section`, dalSection.at(-1)?.id === dal.id, dalSection.map((p) => `${p.name}:${p.in_stock}`).join(' | '));
  const user = await login('9000300107', process.env.TEST_USER_PW, 'user');
  const area = (await call('/localities')).d.find((l) => l.name === 'Old Bus Stand');
  const contact = { name: 'User7', phone: '9000300107', address_line: 'zt H.No 1-2-3, Test Street', locality_id: area.id, lat: 18.1035, lng: 78.8528 };
  const order = await call('/orders', { method: 'POST', token: user, body: { contact, items: [{ product_id: sugar.id, qty: 1 }] } });
  check(`ordering Sugar is refused: "${order.d?.error}"`, order.s === 400 && /out of stock/i.test(order.d?.error || ''));

  // checks
  const bad = await call(`/franchise/products/${sugar.id}/stock`, { method: 'PATCH', token: admin, body: { in_stock: 'no' } });
  check(`a wrong value is refused (${bad.s})`, bad.s === 400);
  const hidden = (await db.query('SELECT p.id FROM products p WHERE NOT p.is_active LIMIT 1')).rows[0];
  if (hidden) {
    const r = await call(`/franchise/products/${hidden.id}/stock`, { method: 'PATCH', token: admin, body: { in_stock: false } });
    check(`a product not offered in the city can't be switched (${r.s})`, r.s === 404);
  }
  const custTry = await call(`/franchise/products/${sugar.id}/stock`, { method: 'PATCH', token: user, body: { in_stock: true } });
  check(`a customer can't switch stock (${custTry.s})`, custTry.s === 401 || custTry.s === 403);

  // back in stock: one, then the rest
  const back = await call(`/franchise/products/${sugar.id}/stock`, { method: 'PATCH', token: admin, body: { in_stock: true } });
  check(`Sugar back in stock (${back.s}) → customer sees it in stock`, back.s === 200 && (await shopStock('food-daily-kirana-delivery', city, sugar.id))?.in_stock === true);
  const rk = await call(`/franchise/restock?service=${kiranaSvc}`, { method: 'POST', token: admin });
  check(`"All back in stock" for Kirana → ${rk.d?.restocked} item(s); Onion (vegetables) still out`, rk.d?.restocked >= 1
    && (await shopStock('food-daily-fresh-vegetables', city, onion.id))?.in_stock === false);
  const ra = await call('/franchise/restock', { method: 'POST', token: admin });
  check(`"All back in stock" for the city → ${ra.d?.restocked} more`, ra.d?.restocked >= 1 && (await shopStock('food-daily-fresh-vegetables', city, onion.id))?.in_stock === true);

  // the activity log
  const log = (await db.query("SELECT action, details->>'name' AS name FROM admin_audit_log WHERE entity = 'stock' AND created_at >= $1 ORDER BY id", [startedAt])).rows;
  check(`activity log: ${log.map((l) => `${l.action} ${l.name}`).join(' · ')}`, log.some((l) => l.action === 'out_of_stock') && log.some((l) => l.action === 'in_stock') && log.some((l) => l.action === 'restock_all'));

  // HQ for a city
  const h1 = await call(`/super/franchises/${city}/products/${dal.id}/stock`, { method: 'PATCH', token: hq, body: { in_stock: false } });
  const h2 = await call(`/super/franchises/${city}/out-of-stock`, { token: hq });
  const h3 = await call(`/super/franchises/${city}/restock`, { method: 'POST', token: hq });
  check(`HQ: switch a city's item (${h1.s}), see its list (${h2.d?.length}), restock (${h3.d?.restocked})`, h1.s === 200 && h2.d?.length >= 1 && h3.d?.restocked >= 1);
  const adminHq = await call(`/super/franchises/${city}/restock`, { method: 'POST', token: admin });
  check(`a franchise admin can't use HQ's routes (${adminHq.s})`, adminHq.s === 401 || adminHq.s === 403);
} catch (e) {
  check('stock API test ran without crashing', false, e.stack);
} finally {
  await db.query('UPDATE franchise_products SET in_stock = true WHERE franchise_id = $1 AND product_id = ANY($2) AND NOT in_stock', [city, [sugar?.id, dal?.id, onion?.id].filter(Boolean)]);
  await db.query("DELETE FROM orders WHERE contact_phone = '9000300107' AND created_at >= $1", [startedAt]);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
