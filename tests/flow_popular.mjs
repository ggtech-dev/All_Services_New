// ⭐ "Our most popular services": HQ manages the cards (all cities / a city's own list); the franchise admin views and
// asks HQ (add a service / take a card off) → HQ approves. Leaves the 4 starting cards as they were.
import pg from 'pg';
import './testadmin.mjs';
const API = 'http://localhost:5000/api';
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 220)}` : ''}`); c ? pass++ : fail++; };
async function call(p, { method = 'GET', body, token, franchise } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (franchise) headers['X-Franchise'] = String(franchise);
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const t = r.status === 204 ? '' : await r.text();
  let d = {};
  try { d = t ? JSON.parse(t) : {}; } catch { d = { raw: t }; }
  return { s: r.status, d };
}
const login = async (u, portal) => (await call('/auth/login', { method: 'POST', body: { username: u, password: process.env.TEST_STAFF_PW, portal } })).d.token;
const hq = await login('zt_super', 'superadmin');
const admin = await login('zt_admin', 'admin');
const before = (await db.query('SELECT id FROM home_popular ORDER BY id')).rows.map((r) => r.id);
const svcId = async (slug) => (await db.query('SELECT id FROM services WHERE slug = $1', [slug])).rows[0].id;
const titles = async (fr) => (await call('/home-popular', { franchise: fr })).d.map((c) => c.title);

try {
  // ---------- customers ----------
  let pub = (await call('/home-popular', { franchise: 1 })).d;
  check('home page: the 6 cards in order', pub.map((c) => c.title).join() === 'Fresh Vegetables,Kirana,Fresh Meat & Fish,Car & Bike Wash,Shop For Me,Share Ride', pub.map((c) => c.title).join());
  check('… vegetables / kirana / meat open their shops, car & bike wash opens Vehicle Services',
    pub[0].href === '/service/food-daily-fresh-vegetables' && pub[1].href === '/service/food-daily-kirana-delivery' && pub[3].href === '/category/vehicle', pub.map((c) => c.href).join());
  check('… each with a photo', pub.every((c) => /^(https:|[/][a-z])/.test(c.image_url || ''))); // our own photos are served by the apps

  // ---------- franchise admin: view only, asks HQ ----------
  let r = await call('/admin/popular', { token: admin });
  check('franchise admin sees the cards, cannot edit', r.s === 200 && r.d.cards.length === 6 && r.d.can_edit === false);
  check('franchise admin cannot add a card (asks HQ)', (await call('/admin/popular', { method: 'POST', token: admin, body: { title: 'x', service_id: 1 } })).s === 403);
  const pooja = await svcId('food-daily-pooja-store');
  r = await call('/franchise/requests', { method: 'POST', token: admin, body: { kind: 'popular', service_id: pooja, details: 'Festival season' } });
  check('franchise admin asks HQ to add Pooja Store', r.s === 201 && r.d.kind === 'popular', JSON.stringify(r.d));
  const reqAdd = r.d;
  check('asking twice refused', (await call('/franchise/requests', { method: 'POST', token: admin, body: { kind: 'popular', service_id: pooja } })).s >= 400);
  check('asking for a service already shown refused', (await call('/franchise/requests', { method: 'POST', token: admin, body: { kind: 'popular', service_id: await svcId('food-daily-kirana-delivery') } })).s >= 400);
  const kirana = (await call('/admin/popular', { token: admin })).d.cards.find((c) => c.title === 'Kirana');
  r = await call('/franchise/requests', { method: 'POST', token: admin, body: { kind: 'popular_off', popular_id: kirana.id } });
  check('franchise admin asks HQ to take Kirana off', r.s === 201 && r.d.kind === 'popular_off', JSON.stringify(r.d));
  const reqOff = r.d;

  // ---------- HQ: all-cities list ----------
  r = await call('/admin/popular', { token: hq });
  check('HQ (all cities): can edit', r.s === 200 && r.d.can_edit === true && r.d.city === null);
  r = await call('/admin/popular', { method: 'POST', token: hq, body: { title: 'z', service_id: pooja } });
  check('a too-short title refused', r.s === 400);
  r = await call('/admin/popular', { method: 'POST', token: hq, body: { title: 'zt Card', service_id: pooja, category_id: 1 } });
  check('a card must open a service OR a category', r.s === 400);
  r = await call('/admin/popular', { method: 'POST', token: hq, body: { title: 'zt Card', service_id: pooja, image_url: 'http://x.example/a.jpg' } });
  check('photo must be https / uploaded', r.s === 400);
  r = await call('/admin/popular', { method: 'POST', token: hq, body: { title: 'zt Events', subtitle: 'Weddings & parties', category_id: (await db.query("SELECT id FROM categories WHERE slug = 'events'")).rows[0].id } });
  check('HQ adds a card for all cities (Events category)', r.s === 201, JSON.stringify(r.d));
  const ev = r.d;
  check('… shown at the end in every city using the all-cities list', (await titles(1)).at(-1) === 'zt Events');
  await call(`/admin/popular/${ev.id}/move`, { method: 'POST', token: hq, body: { dir: -1 } });
  check('HQ moves it up one place', (await titles(1)).at(-2) === 'zt Events', (await titles(1)).join());
  r = await call(`/admin/popular/${ev.id}`, { method: 'PUT', token: hq, body: { title: 'zt Events & Parties', category_id: ev.category_id, is_active: false } });
  check('HQ edits and switches it off → gone from the home page', r.s === 200 && !(await titles(1)).some((t) => t.startsWith('zt Events')));
  check('HQ deletes it', (await call(`/admin/popular/${ev.id}`, { method: 'DELETE', token: hq })).s === 204);

  // ---------- HQ: one city's own list ----------
  r = await call('/admin/popular', { token: hq, franchise: 1 });
  check('Siddipet uses the all-cities list (HQ must make its own to change it)', r.d.own_list === false && r.d.can_edit === false);
  check('… adding there first is refused with that hint', (await call('/admin/popular', { method: 'POST', token: hq, franchise: 1, body: { title: 'zt X', service_id: pooja } })).s === 409);
  // approving the franchise's requests makes the city's own list
  r = await call(`/super/requests/${reqAdd.id}/approve`, { method: 'POST', token: hq, body: {} });
  check('HQ approves "add Pooja Store" → Siddipet gets its own list with Pooja Store at the end', r.s === 200 && (await titles(1)).join() === 'Fresh Vegetables,Kirana,Fresh Meat & Fish,Car & Bike Wash,Shop For Me,Share Ride,Pooja Store', (await titles(1)).join());
  r = await call(`/super/requests/${reqOff.id}/approve`, { method: 'POST', token: hq, body: {} });
  check('HQ approves "take Kirana off" → gone in Siddipet', r.s === 200 && !(await titles(1)).includes('Kirana'), (await titles(1)).join());
  check('the all-cities list did not change (other cities still see Kirana)', (await titles(null)).includes('Kirana') && !(await titles(null)).includes('Pooja Store'));
  r = await call('/admin/popular', { token: hq, franchise: 1 });
  check('HQ now edits Siddipet\'s own list', r.d.own_list === true && r.d.can_edit === true);
  check('franchise admin sees the approved changes', (await call('/franchise/requests?status=approved', { token: admin })).d.filter?.((x) => [reqAdd.id, reqOff.id].includes(x.id)).length === 2);
  check('HQ drops the city list → back to the all-cities list', (await call('/admin/popular-own', { method: 'DELETE', token: hq, franchise: 1 })).s === 204
    && (await titles(1)).join() === 'Fresh Vegetables,Kirana,Fresh Meat & Fish,Car & Bike Wash,Shop For Me,Share Ride');
  check('a franchise admin cannot make / drop city lists', (await call('/admin/popular-own', { method: 'POST', token: admin })).s === 403);
} catch (e) {
  check('popular flow ran without crashing', false, e.stack);
} finally {
  // leave the starting cards exactly as they were
  await db.query('DELETE FROM home_popular WHERE NOT (id = ANY($1))', [before]);
  await db.query("DELETE FROM catalog_requests WHERE kind IN ('popular', 'popular_off') AND requested_by = (SELECT id FROM users WHERE username = 'zt_admin')");
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
