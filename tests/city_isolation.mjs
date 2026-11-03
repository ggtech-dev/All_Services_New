// 🏙️ Each city sees only its own things: a temporary test city "zt Armoor" (HQ creates + activates it, all services
// assigned like a real new city) next to Siddipet. Checks, as a customer whose location is Armoor vs Siddipet:
// offers, goods vehicles, daily workers, out-of-stock, tomorrow's menu dishes, home-food prices, services offered,
// the areas list, and "Deliver to" / where orders go. Everything zt_ is removed at the end (cleanup + direct deletes).
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
let arm = null;
try {
  const hq = await login('zt_super', process.env.TEST_STAFF_PW, 'super');
  const r = await call('/super/franchises', { method: 'POST', token: hq, body: {
    name: 'zt Armoor Franchise', owner_name: 'Zt Owner', phone: '9111111890', city: 'zt Armoor', state: 'Telangana', pincode: '503224',
    center_lat: 18.7905, center_lng: 78.287, radius_km: 25, village_fee_near: 120, village_fee_far: 180,
    admin_username: 'zt_armoor_admin', admin_password: process.env.TEST_STAFF_PW, admin_name: 'Zt Armoor Admin', admin_phone: '9111111891',
    areas: [{ name: 'zt Armoor Bus Stand', pincode: '503224', lat: 18.7905, lng: 78.287 }, { name: 'zt Armoor Market', lat: 18.786, lng: 78.292 }] } });
  arm = r.d?.id;
  await call(`/super/franchises/${arm}/status`, { method: 'PATCH', token: hq, body: { status: 'active' } });
  check(`test city "zt Armoor" created and active (#${arm})`, r.s === 201 && !!arm, JSON.stringify(r.d).slice(0, 200));

  // where the customer is → which city
  const locA = await call('/locate?lat=18.7905&lng=78.287');
  const locS = await call('/locate?lat=18.1035&lng=78.8528');
  check(`location in Armoor → ${locA.d?.franchise?.city || locA.d?.city || JSON.stringify(locA.d).slice(0, 60)}; in Siddipet → ${locS.d?.franchise?.city || locS.d?.city || ''}`,
    JSON.stringify(locA.d || {}).includes('Armoor') && JSON.stringify(locS.d || {}).includes('Siddipet'), JSON.stringify(locA.d).slice(0, 200));
  const areasA = (await call('/localities', { city: arm })).d || [];
  const areasS = (await call('/localities', { city: sid })).d || [];
  check(`areas: Armoor shows its ${areasA.length} areas only; Siddipet shows no Armoor area`,
    areasA.length >= 2 && areasA.every((a) => /zt Armoor/.test(a.name)) && !areasS.some((a) => /Armoor/.test(a.name)));

  // 📢 offers (Siddipet has 4 sample offers)
  const offS = (await call('/offers', { city: sid })).d || [];
  const offA = (await call('/offers', { city: arm })).d || [];
  check(`📢 offers: Siddipet ${offS.length}, Armoor ${offA.length} (Siddipet's not shown in Armoor)`, offS.length >= 1 && offA.length === 0);

  // 🚚 goods vehicles
  const trS = (await call('/transport', { city: sid })).d;
  const trA = (await call('/transport', { city: arm })).d;
  check(`🚚 vehicles: Siddipet ${trS?.vehicles?.length}, Armoor ${trA?.vehicles?.length}`, trS?.vehicles?.length >= 1 && trA?.vehicles?.length === 0);

  // 👷 daily workers
  const wS = (await call('/workers', { city: sid })).d?.workers || [];
  const wA = (await call('/workers', { city: arm })).d?.workers || [];
  check(`👷 daily workers: Siddipet ${wS.length}, Armoor ${wA.length}`, wA.every((w) => w.city !== 'Siddipet'));

  // 🚫 out of stock only in Siddipet
  const sugar = (await db.query("SELECT p.id FROM products p JOIN services s ON s.id = p.service_id WHERE s.slug = 'food-daily-kirana-delivery' AND p.name = 'Sugar'")).rows[0].id;
  await db.query('INSERT INTO franchise_products (franchise_id, product_id, in_stock) VALUES ($1, $2, false) ON CONFLICT (franchise_id, product_id) DO UPDATE SET in_stock = false', [sid, sugar]);
  const kS = (await call('/services/food-daily-kirana-delivery', { city: sid })).d?.products?.find((p) => p.id === sugar);
  const kA = (await call('/services/food-daily-kirana-delivery', { city: arm })).d?.products?.find((p) => p.id === sugar);
  check(`🚫 Sugar out of stock in Siddipet only (Siddipet ${kS?.in_stock}, Armoor ${kA?.in_stock})`, kS?.in_stock === false && kA?.in_stock === true, JSON.stringify(kA || {}).slice(0, 120));
  await db.query('UPDATE franchise_products SET in_stock = true WHERE franchise_id = $1 AND product_id = $2', [sid, sugar]);

  // 🍱 tomorrow's menu dishes + 💰 prices per city
  const D = (await db.query('SELECT fn_meal_date()::text AS d')).rows[0].d;
  await db.query("INSERT INTO meal_menu (franchise_id, menu_date, meal, kind, name) VALUES ($1, $2, 'lunch', 'curry', 'zt Siddipet Dal') ON CONFLICT DO NOTHING", [sid, D]);
  await db.query("INSERT INTO home_food_prices (franchise_id, item, price) VALUES ($1, 'veg', 135) ON CONFLICT (franchise_id, item) DO UPDATE SET price = 135", [arm]);
  const mS = (await call('/meal-menu', { city: sid })).d;
  const mA = (await call('/meal-menu', { city: arm })).d;
  const vegPrice = (m) => Number(m?.products?.find((p) => p.meal === 'lunch' && /^Veg/.test(p.name))?.price);
  check(`🍱 menu dish only in Siddipet; veg plate Siddipet ₹${vegPrice(mS)}, Armoor ₹${vegPrice(mA)} (Armoor's own price)`,
    mS?.lunch?.curries?.includes('zt Siddipet Dal') && !mA?.lunch?.curries?.includes('zt Siddipet Dal') && vegPrice(mA) === 135 && vegPrice(mS) !== 135,
    JSON.stringify({ s: mS?.lunch, a: mA?.lunch }).slice(0, 200));

  // 🧰 services: HQ switches one off only for Armoor
  const svc = (await db.query("SELECT id FROM services WHERE slug = 'food-daily-egg-delivery'")).rows[0].id;
  await call(`/super/franchises/${arm}/services/${svc}`, { method: 'PATCH', token: hq, body: { enabled: false } });
  const catS = (await call('/categories/food-daily', { city: sid })).d?.services || [];
  const catA = (await call('/categories/food-daily', { city: arm })).d?.services || [];
  check(`🧰 Egg Delivery switched off for Armoor only (Siddipet ${catS.some((s) => s.id === svc)}, Armoor ${catA.some((s) => s.id === svc)})`,
    catS.some((s) => s.id === svc) && !catA.some((s) => s.id === svc));

  // a place we don't serve
  const hyd = await call('/locate?lat=17.385&lng=78.4867');
  check(`Hyderabad (no franchise) → not served ("Notify me")`, !JSON.stringify(hyd.d || {}).match(/Siddipet|Armoor/) || hyd.d?.served === false, JSON.stringify(hyd.d).slice(0, 200));
} catch (e) {
  check('city test ran without crashing', false, e.stack);
} finally {
  await db.query("DELETE FROM meal_menu WHERE name LIKE 'zt %'");
  if (arm) {
    await db.query('DELETE FROM home_food_prices WHERE franchise_id = $1', [arm]);
  }
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
