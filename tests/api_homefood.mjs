// 🍱 Home Food & Cooks (API): the franchise admin sets the menu (dishes + menu-card photo) → customers see it →
// meal orders (one slot, delivered on the meal day, tomorrow_meals partners, prices from the plates) → the kitchen count.
// 👩‍🍳 Book a Cook: price from the hours (₹79 / ₹40 a half hour), book_cook partners, checks on day / time / hours.
// Test rows: dishes named "zt …", orders by user7; all removed at the end.
import fs from 'node:fs';
import pg from 'pg';
import './testadmin.mjs';
const B = 'http://localhost:5000/api';
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 220)}` : ''}`); c ? pass++ : fail++; };
const call = async (path, { method = 'GET', body, token, form } = {}) => {
  const r = await fetch(B + path, { method, headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) },
    body: form || (body && JSON.stringify(body)) });
  return { s: r.status, d: r.status === 204 ? null : await r.json().catch(() => null) };
};
const login = async (username, password, portal) => (await call('/auth/login', { method: 'POST', body: { username, password, portal } })).d?.token;
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path = all_services');
const orderIds = [];
let myPhoto = null, reqId = null;
try {
  const admin = await login('zt_admin', process.env.TEST_STAFF_PW, 'admin');
  const m0 = await call('/admin/meal-menu', { token: admin });
  const D = m0.d?.date;
  check(`admin: menu page for ${D} (the day customers order for now: ${m0.d?.ordering_for})`, m0.s === 200 && D === m0.d.ordering_for, JSON.stringify(m0.d).slice(0, 200));
  for (const [meal, kind, name] of [['lunch', 'curry', 'zt Aloo Fry'], ['lunch', 'curry', 'zt Dal'], ['lunch', 'curry', 'zt Bendakaya Fry'], ['lunch', 'charu', 'zt Tomato Charu'],
    ['lunch', 'charu', 'zt Sambar'], ['dinner', 'curry', 'zt Paneer Curry'], ['dinner', 'curry', 'zt Mix Veg'], ['dinner', 'charu', 'zt Rasam']]) {
    await call('/admin/meal-menu', { method: 'POST', token: admin, body: { date: D, meal, kind, name } });
  }
  const bad = await call('/admin/meal-menu', { method: 'POST', token: admin, body: { date: D, meal: 'lunch', kind: 'curry', name: 'x' } });
  check(`a one-letter dish is refused (${bad.d?.error})`, bad.s === 400);
  const fd = new FormData();
  fd.append('date', D);
  fd.append('image', new Blob([fs.readFileSync('veg480/tomato.jpg')], { type: 'image/jpeg' }), 'menu.jpg');
  const ph = await call('/admin/meal-menu/photo', { method: 'POST', token: admin, form: fd });
  myPhoto = ph.d?.image_url;
  check(`menu-card photo uploaded → ${ph.d?.image_url}`, ph.s === 201 && /^\/uploads\/menu-/.test(ph.d?.image_url || ''));
  const hq = await login('zt_super', process.env.TEST_STAFF_PW, 'super');
  const hqSee = await fetch(`${B}/admin/meal-menu`, { headers: { authorization: `Bearer ${hq}`, 'x-franchise': '1' } });
  check(`HQ (city chosen) sees the same menu (${hqSee.status})`, hqSee.status === 200);

  // customer side
  const menu = await call('/meal-menu');
  const lunchP = (n) => menu.d.products.find((p) => p.meal === 'lunch' && p.name.startsWith(n));
  check(`customers see ${menu.d.day_label}: photo, lunch ${menu.d.lunch.curries.filter((c) => c.startsWith('zt')).length} curries / ${menu.d.lunch.charus.filter((c) => c.startsWith('zt')).length} charus, ${menu.d.products.filter((p) => p.meal !== 'snacks').length} plates, ${menu.d.products.filter((p) => p.meal === 'snacks').length} snacks (${menu.d.snacks?.slot})`,
    menu.d.photo === ph.d.image_url && menu.d.lunch.curries.includes('zt Dal') && menu.d.dinner.charus.includes('zt Rasam')
      && menu.d.products.filter((p) => p.meal !== 'snacks').length === 8 && menu.d.products.filter((p) => p.meal === 'snacks').length >= 12 && /Snacks 11:00 AM – 8:00 PM/.test(menu.d.snacks?.slot));
  const user = await login('9000300107', process.env.TEST_USER_PW, 'user');
  const veg = lunchP('Veg Meal'), chicken = lunchP('Chicken Meal');
  const vegDinner = menu.d.products.find((p) => p.meal === 'dinner' && p.name.startsWith('Veg Meal'));
  const q = await call(`/orders/quote?products=${veg.id},${chicken.id}`, { token: user });
  check(`quote: one slot "${q.d?.slots?.[0]}"`, q.s === 200 && q.d.slots?.length === 1 && q.d.slots[0] === menu.d.lunch.slot);
  const area = (await call('/localities')).d.find((l) => l.name === 'Old Bus Stand');
  const contact = { name: 'User7', phone: '9000300107', address_line: 'zt H.No 1-2-3, Test Street', locality_id: area.id, lat: 18.1035, lng: 78.8528 };
  // 🥨 snacks: their own order, the evening slot, the product price
  const snack = menu.d.products.find((p) => p.slug === 'home-food-snack-sakinalu');
  const snackLunch = await call('/orders', { method: 'POST', token: user, body: { contact, items: [{ product_id: snack.id, qty: 1 }, { product_id: chicken.id, qty: 1 }] } });
  check(`snacks + lunch in one order → "${snackLunch.d?.error}"`, snackLunch.s === 400 && /snacks/.test(snackLunch.d?.error || ''));
  const sq = await call(`/orders/quote?products=${snack.id}`, { token: user });
  check(`snacks quote: one slot "${sq.d?.slots?.[0]}"`, sq.s === 200 && sq.d.slots?.length === 1 && sq.d.slots[0] === menu.d.snacks.slot);
  const sp = await call('/orders', { method: 'POST', token: user, body: { contact, items: [{ product_id: snack.id, qty: 3 }] } });
  if (sp.d?.id) orderIds.push(sp.d.id);
  check(`snacks order #${sp.d?.id}: 3 × Sakinalu = ₹${sp.d?.total}, "${sp.d?.slot}", to "${sp.d?.skill_code}"`,
    sp.s === 201 && Number(sp.d.total) === 3 * Number(snack.price) + Number(sp.d.delivery_fee || 0) && sp.d.slot === menu.d.snacks.slot && sp.d.skill_code === 'tomorrow_meals', JSON.stringify(sp.d).slice(0, 200));
  const mixed = await call('/orders', { method: 'POST', token: user, body: { contact, items: [{ product_id: chicken.id, qty: 1 }, { product_id: vegDinner.id, qty: 1 }] } });
  check(`lunch + dinner in one order → "${mixed.d?.error}"`, mixed.s === 400);
  const kirana = (await db.query("SELECT p.id FROM products p JOIN services s ON s.id = p.service_id WHERE s.slug = 'food-daily-kirana-delivery' AND p.is_active LIMIT 1")).rows[0].id;
  const withKirana = await call('/orders', { method: 'POST', token: user, body: { contact, items: [{ product_id: chicken.id, qty: 1 }, { product_id: kirana, qty: 1 }] } });
  check(`meal + kirana in one order → "${withKirana.d?.error}"`, withKirana.s === 400);
  const placed = await call('/orders', { method: 'POST', token: user, body: { contact, slot: 'anything', items: [
    { product_id: veg.id, qty: 2 }, { product_id: chicken.id, qty: 1 }] } }); // veg: no choice — the day's fixed menu
  if (placed.d?.id) orderIds.push(placed.d.id);
  const o = placed.d || {};
  if (o.id) o.deliver_on = (await db.query('SELECT deliver_on::text AS d FROM orders WHERE id = $1', [o.id])).rows[0].d;
  check(`meal order #${o.id}: slot "${o.slot}", day ${String(o.deliver_on).slice(0, 10)}, ₹${o.total}, to "${o.skill_code}" partners`,
    placed.s === 201 && o.slot === menu.d.lunch.slot && String(o.deliver_on).slice(0, 10) === D && Number(o.total) === 2 * Number(veg.price) + Number(chicken.price) && o.skill_code === 'tomorrow_meals',
    JSON.stringify(placed.d).slice(0, 200));

  // the kitchen count
  const k = (await call(`/admin/meal-menu?date=${D}`, { token: admin })).d.kitchen;
  const plates = Object.fromEntries(k.plates.map((p) => [p.name, Number(p.plates)]));
  check(`kitchen count: Veg Lunch ${plates['Veg Meal — Lunch']}, Chicken Lunch ${plates['Chicken Meal — Lunch']}, Sakinalu ${plates.Sakinalu} packs`,
    plates['Veg Meal — Lunch'] === 2 && plates['Chicken Meal — Lunch'] === 1 && plates.Sakinalu === 3 && k.plates.find((p) => p.name === 'Sakinalu')?.meal === 'snacks' && k.orders >= 2, JSON.stringify(k));

  // 💰 HQ sets a city's price → orders use it; a franchise asks → HQ approves → applied
  const city = (await db.query("SELECT id FROM franchises WHERE code = 'FR-0001'")).rows[0].id;
  const set = await call(`/super/home-food-prices/${city}`, { method: 'PUT', token: hq, body: { item: 'veg', price: 135 } });
  check(`HQ sets Veg plate in the city to ₹${set.d?.prices?.veg?.price}`, set.s === 200 && Number(set.d.prices.veg.price) === 135 && set.d.prices.veg.own);
  const vp = await call('/orders', { method: 'POST', token: user, body: { contact, items: [{ product_id: veg.id, qty: 2 }] } });
  if (vp.d?.id) orderIds.push(vp.d.id);
  check(`a veg order now costs 2 × ₹135 (subtotal ₹${vp.d?.subtotal})`, vp.s === 201 && Number(vp.d.subtotal) === 270, JSON.stringify(vp.d).slice(0, 160));
  const frSet = await call(`/super/home-food-prices/${city}`, { method: 'PUT', token: admin, body: { item: 'veg', price: 1 } });
  check(`a franchise admin cannot set prices (${frSet.s})`, frSet.s === 401 || frSet.s === 403);
  const ask = await call('/admin/meal-menu/price-request', { method: 'POST', token: admin, body: { item: 'cook_hour', price: 85, note: 'zt test' } });
  reqId = ask.d?.id;
  check(`franchise asks HQ: cook ₹85 an hour (request #${reqId})`, ask.s === 201 && ask.d.kind === 'price');
  const ok = await call(`/super/requests/${reqId}/approve`, { method: 'POST', token: hq, body: { note: '' } });
  const cp = (await db.query('SELECT fn_cook_price(2, $1) AS p', [city])).rows[0].p;
  check(`HQ approves (${ok.s}) → 2 hours of cook in the city = ₹${cp}`, ok.s < 300 && Number(cp) === 170);
  const hqAsk = await call('/admin/meal-menu/price-request', { method: 'POST', token: hq, body: { item: 'veg', price: 100 } });
  check(`HQ itself can't send a request (${hqAsk.d?.error})`, hqAsk.s === 400);
  await call(`/super/home-food-prices/${city}`, { method: 'PUT', token: hq, body: { item: 'cook_hour', price: null } }); // back to ₹79 for the cook checks


  // 👩‍🍳 Book a Cook
  const cookSvc = (await db.query("SELECT id FROM services WHERE slug = 'home-food-book-a-cook'")).rows[0].id;
  const cook = (body) => call('/orders', { method: 'POST', token: user, body: { contact, service_id: cookSvc, cook: body } });
  const c1 = await cook({ day: 'tomorrow', start: '07:00', hours: 1.5, woman: true });
  if (c1.d?.id) orderIds.push(c1.d.id);
  check(`cook 1½ hours → ₹${c1.d?.total}, "${c1.d?.slot}", to "${c1.d?.skill_code}"`, c1.s === 201 && Number(c1.d.total) === 119 && /1\.5 hours · woman cook/.test(c1.d.slot) && c1.d.skill_code === 'book_cook', JSON.stringify(c1.d).slice(0, 200));
  const c2 = await cook({ day: 'tomorrow', start: '18:00', hours: 3 });
  if (c2.d?.id) orderIds.push(c2.d.id);
  check(`cook 3 hours → ₹${c2.d?.total} (3 × 79)`, c2.s === 201 && Number(c2.d.total) === 237);
  const item = (await db.query('SELECT price, unit FROM order_items WHERE order_id = $1', [c2.d.id])).rows[0];
  check(`the order line says "${item.unit}" for ₹${item.price}`, item.unit === '3 hours' && Number(item.price) === 237);
  for (const [why, body] of [['hours 1.25', { day: 'tomorrow', start: '07:00', hours: 1.25 }], ['9 hours', { day: 'tomorrow', start: '07:00', hours: 9 }],
    ['after 8:30 PM', { day: 'tomorrow', start: '21:00', hours: 1 }], ['past 10 PM', { day: 'tomorrow', start: '20:00', hours: 3 }], ['no day', { start: '07:00', hours: 1 }]]) {
    const r = await cook(body);
    if (r.d?.id) orderIds.push(r.d.id);
    check(`cook ${why} → refused ("${r.d?.error}")`, r.s === 400);
  }
  const noHack = await call('/orders', { method: 'POST', token: user, body: { contact, service_id: cookSvc, cook: { day: 'tomorrow', start: '09:00', hours: 1, amount: 1 } } });
  if (noHack.d?.id) orderIds.push(noHack.d.id);
  check(`the app cannot set its own price (sent ₹1 → ₹${noHack.d?.total})`, Number(noHack.d?.total) === 79);
  // only the right partners see them
  const st = (await db.query("SELECT code FROM service_types WHERE code IN ('book_cook', 'tomorrow_meals') AND is_active")).rows.map((r) => r.code);
  check(`partner types exist: ${st.join(', ')}`, st.length === 2);
} catch (e) {
  check('home food API test ran without crashing', false, e.stack);
} finally {
  if (orderIds.length) await db.query('DELETE FROM orders WHERE id = ANY($1)', [orderIds]);
  await db.query("DELETE FROM home_food_prices WHERE franchise_id = (SELECT id FROM franchises WHERE code = 'FR-0001') AND item IN ('veg', 'cook_hour')");
  if (reqId) await db.query('DELETE FROM catalog_requests WHERE id = $1', [reqId]);
  const del = await db.query("DELETE FROM meal_menu WHERE name LIKE 'zt %'");
  const photo = await db.query('DELETE FROM meal_menu_photo WHERE image_url = $1 RETURNING image_url', [myPhoto]);
  for (const r of photo.rows) fs.rmSync(`../server${r.image_url}`, { force: true });
  console.log(`cleanup: ${orderIds.length} orders, ${del.rowCount} dishes, ${photo.rowCount} photo removed`);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
