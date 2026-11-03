// 📍 Location rules end to end, with a test franchise "zt Armoor" (placed near Nirmal, ~125 km from Siddipet and outside
// the real Armoor franchise's range) that HQ sets up in one go:
//   HQ creates it (details + admin login + centre/range + areas & villages + village charges) and activates it;
//   Armoor's franchise admin cannot add areas but asks HQ (new village, switch an area off) → HQ approves;
//   /locate; customers in Armoor / Siddipet / Hyderabad; agents inside / outside their franchise's range.
// Everything is zt_ / "zt …" → cleanup.mjs removes it. LOCAL only.
import pg from 'pg';
import './testadmin.mjs';
import { agentLogin, makeCustomer } from './test_helpers.mjs';

const API = 'http://localhost:5000/api';
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
let pass = 0, fail = 0;
const fails = [];
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 220)}` : ''}`); if (c) pass++; else { fail++; fails.push(l); } };
async function call(p, { method = 'GET', body, token, form, franchise } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (franchise) headers['X-Franchise'] = String(franchise);
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + p, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const t = res.status === 204 ? '' : await res.text();
  let d = {};
  try { d = t ? JSON.parse(t) : {}; } catch { d = { raw: t.slice(0, 100) }; }
  return { s: res.status, d };
}
const login = async (username, password, portal) => (await call('/auth/login', { method: 'POST', body: { username, password, portal } })).d.token;

// places
const ARMOOR = { lat: 19.0903, lng: 78.3495 };
const SIDDIPET = { lat: 18.1035, lng: 78.8528 };
const HYDERABAD = { lat: 17.385, lng: 78.4867 };

const hq = await login('zt_super', process.env.TEST_STAFF_PW, 'superadmin');
const sidAdmin = await login('zt_admin', process.env.TEST_STAFF_PW, 'admin');
check('HQ + Siddipet franchise admin logged in', hq && sidAdmin);
await db.query("DELETE FROM franchises WHERE name LIKE 'zt %' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.franchise_id = franchises.id)").catch(() => {});

try {
  // ======================= 1) HQ sets up the new franchise on one page =======================
  const base = { name: 'zt Armoor Franchise', owner_name: 'Zt Owner', phone: '9111111890', city: 'zt Armoor', state: 'Telangana', pincode: '503224' };
  let r = await call('/super/franchises', { method: 'POST', token: hq, body: base });
  check('new franchise without a centre on the map refused', r.s === 400 && /centre/i.test(r.d.error), r.d.error);
  r = await call('/super/franchises', { method: 'POST', token: hq, body: { ...base, center_lat: ARMOOR.lat, center_lng: ARMOOR.lng,
    areas: [{ name: 'zt Far Away', lat: HYDERABAD.lat, lng: HYDERABAD.lng }] } });
  check('an area outside the range refused — and nothing is created', r.s === 400 && /outside/.test(r.d.error)
    && !(await db.query("SELECT 1 FROM franchises WHERE city = 'zt Armoor'")).rowCount, r.d.error);
  r = await call('/super/franchises', { method: 'POST', token: hq, body: {
    ...base, center_lat: ARMOOR.lat, center_lng: ARMOOR.lng, radius_km: 25, village_fee_near: 120, village_fee_far: 180,
    admin_username: 'zt_armoor_admin', admin_password: process.env.TEST_STAFF_PW, admin_name: 'Zt Armoor Admin', admin_phone: '9111111891',
    areas: [
      { name: 'zt Armoor Bus Stand', pincode: '503224', lat: 19.0905, lng: 78.3470 },
      { name: 'zt Armoor Market', lat: 19.0860, lng: 78.3520 },
      { name: 'zt Perkit', lat: 19.0800, lng: 78.3900, is_village: true, village_band: 1 },
    ] } });
  const armoor = r.d;
  check('HQ creates zt Armoor: details, centre, 25 km, village charges ₹120/₹180, admin login', r.s === 201 && Number(armoor.center_lat) === ARMOOR.lat
    && Number(armoor.radius_km) === 25 && Number(armoor.village_fee_near) === 120 && armoor.status === 'pending', JSON.stringify(r.d).slice(0, 200));
  const areas0 = (await db.query('SELECT name, is_village, village_band FROM localities WHERE franchise_id = $1 ORDER BY name', [armoor.id])).rows;
  check('… with its 3 areas (2 town, 1 village up to 10 km)', areas0.length === 3 && areas0.filter((a) => a.is_village).length === 1, JSON.stringify(areas0));
  check('not live yet: /locate in Armoor finds nothing while Pending', !(await call(`/locate?lat=${ARMOOR.lat}&lng=${ARMOOR.lng}`)).d.franchise);
  r = await call(`/super/franchises/${armoor.id}/status`, { method: 'PATCH', token: hq, body: { status: 'active' } });
  check('HQ activates it', r.s === 204, r.d.error);
  r = await call(`/super/franchises/${armoor.id}`, { method: 'PUT', token: hq, body: { ...base, radius_km: 30 } });
  check('HQ can change the range later (30 km) without losing the centre', r.s === 200 && Number(r.d.radius_km) === 30 && Number(r.d.center_lat) === ARMOOR.lat, JSON.stringify(r.d).slice(0, 150));
  await call(`/super/franchises/${armoor.id}`, { method: 'PUT', token: hq, body: { ...base, radius_km: 25 } });

  // ======================= 2) areas: HQ sets them, Armoor's admin asks =======================
  const arAdmin = await login('zt_armoor_admin', process.env.TEST_STAFF_PW, 'admin');
  check('the Armoor admin logs in with the password HQ set', !!arAdmin);
  const myAreas = (await call('/admin/localities', { token: arAdmin })).d;
  check('Armoor admin sees only Armoor\'s areas', Array.isArray(myAreas) && myAreas.length === 3 && myAreas.every((a) => /^zt /.test(a.name)), JSON.stringify(myAreas).slice(0, 120));
  check('Armoor admin cannot add an area (asks HQ instead)', (await call('/admin/localities', { method: 'POST', token: arAdmin, body: { name: 'zt X', lat: 19.09, lng: 78.35 } })).s === 403);
  check('Armoor admin cannot change village charges', (await call('/admin/village-fees', { method: 'PUT', token: arAdmin, body: { near: 1, far: 2 } })).s === 403);
  r = await call('/franchise/requests', { method: 'POST', token: arAdmin, body: { kind: 'area', name: 'zt Mamidipally', lat: 19.1050, lng: 78.3650, village_band: 1, details: 'Many customers asking' } });
  check('Armoor admin asks HQ for a new village (pin on the map)', r.s === 201 && r.d.kind === 'area', JSON.stringify(r.d));
  const reqArea = r.d;
  r = await call('/franchise/requests', { method: 'POST', token: arAdmin, body: { kind: 'area', name: 'zt Hyd', lat: HYDERABAD.lat, lng: HYDERABAD.lng } });
  check('asking for a place outside the range refused', r.s === 400 && /outside/.test(r.d.error), r.d.error);
  r = await call('/franchise/requests', { method: 'POST', token: arAdmin, body: { kind: 'area', name: 'zt Mamidipally', lat: 19.1050, lng: 78.3650 } });
  check('asking twice refused (already waiting)', r.s >= 400 && /already/.test(r.d.error), r.d.error);
  const market = myAreas.find((a) => a.name === 'zt Armoor Market');
  r = await call('/franchise/requests', { method: 'POST', token: arAdmin, body: { kind: 'area_off', locality_id: market.id, details: 'No agents there' } });
  check('Armoor admin asks to switch an area off', r.s === 201 && r.d.kind === 'area_off');
  const reqOff = r.d;
  const pending = (await call('/super/requests?status=pending', { token: hq })).d;
  const seen = pending.find?.((x) => x.id === reqArea.id);
  check('HQ sees the area request with the pin and km from the centre', seen && Number(seen.area_lat) === 19.105 && seen.km_from_center > 0 && seen.village_band === 1, JSON.stringify(seen));
  check('Siddipet\'s admin does not see Armoor\'s requests', !(await call('/franchise/requests', { token: sidAdmin })).d.some?.((x) => x.id === reqArea.id));
  check('a franchise admin cannot approve', (await call(`/super/requests/${reqArea.id}/approve`, { method: 'POST', token: arAdmin, body: {} })).s === 403);
  r = await call(`/super/requests/${reqArea.id}/approve`, { method: 'POST', token: hq, body: { note: 'Approved' } });
  const made = (await db.query("SELECT is_active, is_village, village_band FROM localities WHERE franchise_id = $1 AND name = 'zt Mamidipally'", [armoor.id])).rows[0];
  check('HQ approves → the village is added to Armoor at once', r.s === 200 && made?.is_active && made.is_village && made.village_band === 1, JSON.stringify(made));
  r = await call(`/super/requests/${reqOff.id}/approve`, { method: 'POST', token: hq, body: {} });
  check('HQ approves switch-off → the area is off for customers', r.s === 200 && !(await db.query('SELECT is_active FROM localities WHERE id = $1', [market.id])).rows[0].is_active);
  check('Armoor admin sees both requests approved', (await call('/franchise/requests?status=approved', { token: arAdmin })).d.filter?.((x) => [reqArea.id, reqOff.id].includes(x.id)).length === 2);
  r = await call('/admin/localities', { method: 'POST', token: hq, franchise: armoor.id, body: { name: 'zt Armoor Fort', lat: 19.0950, lng: 78.3450 } });
  check('HQ adds an area directly (city chosen at the top)', r.s === 201, r.d.error);
  r = await call('/admin/localities', { method: 'POST', token: hq, franchise: armoor.id, body: { name: 'zt Too Far', lat: SIDDIPET.lat, lng: SIDDIPET.lng } });
  check('… but not outside the city\'s range', r.s === 400 && /outside/.test(r.d.error), r.d.error);
  r = await call('/admin/village-fees', { method: 'PUT', token: hq, franchise: armoor.id, body: { near: 130, far: 190 } });
  check('HQ changes Armoor\'s village charges', r.s === 204 && Number((await db.query('SELECT village_fee_near FROM franchises WHERE id = $1', [armoor.id])).rows[0].village_fee_near) === 130, r.d.error);

  // ======================= 3) /locate =======================
  let z = (await call(`/locate?lat=${ARMOOR.lat}&lng=${ARMOOR.lng}`)).d;
  check('/locate in Armoor → zt Armoor, nearest area first', z.franchise?.id === armoor.id && z.areas?.[0]?.name === 'zt Armoor Bus Stand', JSON.stringify(z).slice(0, 200));
  check('/locate: switched-off area not offered', !z.areas.some((a) => a.name === 'zt Armoor Market'));
  z = (await call(`/locate?lat=${SIDDIPET.lat}&lng=${SIDDIPET.lng}`)).d;
  check('/locate in Siddipet → Siddipet', z.franchise?.city === 'Siddipet', JSON.stringify(z.franchise));
  z = (await call(`/locate?lat=${HYDERABAD.lat}&lng=${HYDERABAD.lng}`)).d;
  check('/locate in Hyderabad → not served yet', z.franchise === null);

  // ======================= 4) agents of each city =======================
  const fb = await db.query("SELECT l.id FROM localities l WHERE l.franchise_id = $1 AND l.name = 'zt Armoor Bus Stand'", [armoor.id]);
  const arArea = fb.rows[0].id;
  const sidArea = (await db.query("SELECT id FROM localities WHERE franchise_id = 1 AND is_active AND NOT is_village ORDER BY id LIMIT 1")).rows[0].id;
  const addAgent = async (token, phone, loc, name) => {
    const f = new FormData();
    Object.entries({ full_name: name, phone, vehicle_type: 'bike', locality_id: loc, skills: 'delivery' }).forEach(([k, v]) => f.append(k, v));
    return call('/admin/agents', { method: 'POST', token, form: f });
  };
  r = await addAgent(arAdmin, '9111111801', arArea, 'Zt Armoor Rider');
  check('Armoor admin adds an Armoor agent', r.s === 201, r.d.error);
  await agentLogin('zt_geo_armoor_rider', '9111111801');
  r = await addAgent(sidAdmin, '9111111802', sidArea, 'Zt Siddipet Rider');
  await agentLogin('zt_geo_sid_rider', '9111111802');
  const arRider = await login('zt_geo_armoor_rider', process.env.TEST_STAFF_PW, 'agent');
  const sidRider = await login('zt_geo_sid_rider', process.env.TEST_STAFF_PW, 'agent');
  // the server keeps one GPS point per 5 seconds: pretend the last one is older (as if the agent drove there)
  const at = async (tok, p) => {
    await db.query("UPDATE agents SET last_location_at = last_location_at - interval '10 seconds' WHERE user_id IN (SELECT id FROM users WHERE phone IN ('9111111801', '9111111802'))");
    return call('/agent/location', { method: 'POST', token: tok, body: { lat: p.lat, lng: p.lng, accuracy: 10 } });
  };
  await call('/agent/status', { method: 'PATCH', token: arRider, body: { online: true } });
  await call('/agent/status', { method: 'PATCH', token: sidRider, body: { online: true } });
  await at(arRider, ARMOOR);
  await at(sidRider, SIDDIPET);
  check('Armoor agent in Armoor: inside the zone', (await call('/agent/me', { token: arRider })).d.zone?.inside === true);

  // ======================= 5) customers =======================
  await makeCustomer('zt_geo_cust', 'Zt Geo Customer', '9111111811');
  const cust = await login('zt_geo_cust', process.env.TEST_STAFF_PW, 'user');
  const fruit = (await call('/services/food-daily-fruit-delivery')).d.products.find((p) => p.in_stock);
  const order = (contact) => call('/orders', { method: 'POST', token: cust, body: { items: [{ product_id: fruit.id, qty: 1 }], slot: 'As soon as possible',
    contact: { name: 'Zt Geo', phone: '9111111811', address_line: 'H.No 9-9-9, Test Road', ...contact } } });
  r = await order({ locality_id: arArea });
  check('no location → refused ("share your delivery location")', r.s === 400 && /location/i.test(r.d.error), r.d.error);
  r = await order({ locality_id: sidArea, lat: HYDERABAD.lat, lng: HYDERABAD.lng });
  check('customer in Hyderabad → "we don\'t deliver to your location yet"', r.s === 400 && /does not deliver/.test(r.d.error), r.d.error);
  r = await order({ locality_id: sidArea, lat: ARMOOR.lat, lng: ARMOOR.lng });
  check('in Armoor but choosing a Siddipet area → refused', r.s === 400 && /Armoor service zone/.test(r.d.error), r.d.error);
  r = await order({ locality_id: arArea, lat: ARMOOR.lat, lng: ARMOOR.lng });
  check('customer in Armoor + Armoor area → order placed', r.s === 201, r.d.error);
  const arOrder = r.d;
  check('… stamped with the Armoor franchise', (await db.query('SELECT franchise_id FROM orders WHERE id = $1', [arOrder.id])).rows[0]?.franchise_id === armoor.id);
  r = await order({ locality_id: sidArea, lat: SIDDIPET.lat, lng: SIDDIPET.lng });
  check('customer in Siddipet + Siddipet area → order placed (Siddipet)', r.s === 201, r.d.error);
  const sidOrder = r.d;
  const offered = async (tok) => ((await call('/agent/available', { token: tok })).d || []).map((o) => o.id);
  let ar = await offered(arRider), sd = await offered(sidRider);
  check('Armoor agent gets the Armoor order, not Siddipet\'s', ar.includes(arOrder.id) && !ar.includes(sidOrder.id), `ar=${ar}`);
  check('Siddipet agent gets the Siddipet order, not Armoor\'s', sd.includes(sidOrder.id) && !sd.includes(arOrder.id), `sd=${sd}`);
  check('Siddipet agent cannot accept the Armoor order', (await call(`/agent/orders/${arOrder.id}/accept`, { method: 'POST', token: sidRider })).s >= 400);

  // the Armoor agent drives to Siddipet: outside their zone → no orders, cannot accept
  await at(arRider, SIDDIPET);
  const zone = (await call('/agent/me', { token: arRider })).d.zone;
  check(`Armoor agent in Siddipet: outside the zone (${zone?.km} km)`, zone?.inside === false && zone.km > 25, JSON.stringify(zone));
  check('… gets no orders there', (await offered(arRider)).length === 0);
  r = await call(`/agent/orders/${arOrder.id}/accept`, { method: 'POST', token: arRider });
  check('… and cannot accept ("outside the zt Armoor service zone")', r.s === 409 && /outside the zt Armoor service zone/.test(r.d.error), r.d.error);
  await at(arRider, ARMOOR);
  r = await call(`/agent/orders/${arOrder.id}/accept`, { method: 'POST', token: arRider });
  check('back in Armoor → accepts the Armoor order', r.s === 200, r.d.error);
  check('Siddipet agent accepts the Siddipet order', (await call(`/agent/orders/${sidOrder.id}/accept`, { method: 'POST', token: sidRider })).s === 200);
  // admin views stay per city
  check('Armoor admin sees the Armoor order only', (await call('/admin/orders', { token: arAdmin })).d.every?.((o) => o.franchise_id === armoor.id));
  check('Siddipet admin does not see the Armoor order', !(await call('/admin/orders', { token: sidAdmin })).d.some?.((o) => o.id === arOrder.id));

  // the Disable / Suspend warning counts Armoor's open work
  const w = (await call(`/super/franchises/${armoor.id}/open-work`, { token: hq })).d;
  check('Disable warning for Armoor: 1 order on the way', w.on_the_way === 1 && w.waiting === 0, JSON.stringify(w));
  // release the agents' orders so nothing is left on the way
  for (const [id, tok] of [[arOrder.id, arRider], [sidOrder.id, sidRider]]) await call(`/agent/orders/${id}/release`, { method: 'POST', token: tok, body: { reason: 'test done' } });
  for (const id of [arOrder.id, sidOrder.id]) await call(`/orders/${id}/cancel`, { method: 'POST', token: cust, body: { reason: 'test done' } });
} catch (e) {
  check('geo flow ran without crashing', false, e.stack);
} finally {
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) console.log('FAILED:\n - ' + fails.join('\n - '));
