// 🚚 Goods Transportation (API): the franchise admin adds a vehicle with 2 photos (owner's permission needed) → customers
// in Siddipet see it (number only when logged in), other cities don't → Call / WhatsApp counted → report → the admin
// closes it; edit keeps / removes photos; checks; HQ read only. Test vehicles: phone 90003099xx, removed at the end.
import fs from 'node:fs';
import pg from 'pg';
import './testadmin.mjs';
const B = 'http://localhost:5000/api';
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 240)}` : ''}`); c ? pass++ : fail++; };
const call = async (path, { method = 'GET', body, token, form, city } = {}) => {
  const r = await fetch(B + path, { method, headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }), ...(city && { 'x-franchise': String(city) }) },
    body: form || (body && JSON.stringify(body)) });
  return { s: r.status, d: r.status === 204 ? null : await r.json().catch(() => null) };
};
const login = async (username, password, portal) => (await call('/auth/login', { method: 'POST', body: { username, password, portal } })).d?.token;
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path = all_services');
const city = (await db.query("SELECT id FROM franchises WHERE code = 'FR-0001'")).rows[0].id;
const other = (await db.query("SELECT id FROM franchises WHERE id <> $1 AND status = 'active' ORDER BY id LIMIT 1", [city])).rows[0]?.id;
const img = fs.readFileSync('veg480/tomato.jpg');
const form = (fields, n = 2) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  for (let i = 0; i < n; i++) fd.append('photos', new Blob([img], { type: 'image/jpeg' }), `v${i}.jpg`);
  return fd;
};
const base = { vehicle_type: 'ace', model: 'zt Tata Ace Test', capacity: '750 kg', body: 'open', owner_name: 'zt Owner', phone: '9000309931',
  vehicle_number: 'TS 36 ZZ 9931', area: 'zt Old Bus Stand', rate_note: '₹400 a trip', verified: 'true', consent_recorded: 'true' };
try {
  const admin = await login('zt_admin', process.env.TEST_STAFF_PW, 'admin');
  const hq = await login('zt_super', process.env.TEST_STAFF_PW, 'super');
  const user = await login('9000300107', process.env.TEST_USER_PW, 'user');

  const noConsent = await call('/transport/admin', { method: 'POST', token: admin, form: form({ ...base, consent_recorded: 'false' }) });
  check(`no owner permission → "${noConsent.d?.error?.slice(0, 50)}…"`, noConsent.s === 400 && /permission/i.test(noConsent.d?.error || ''));
  const badNum = await call('/transport/admin', { method: 'POST', token: admin, form: form({ ...base, vehicle_number: '1234' }) });
  check(`a wrong vehicle number → "${badNum.d?.error}"`, badNum.s === 400);
  const four = await call('/transport/admin', { method: 'POST', token: admin, form: form(base, 4) });
  check(`more than 3 photos → "${four.d?.error}"`, four.s === 400 && /up to 3/.test(four.d?.error || ''));
  const made = await call('/transport/admin', { method: 'POST', token: admin, form: form(base, 2) });
  const v = made.d || {};
  check(`admin adds a vehicle with 2 photos (#${v.id}, ${v.photos?.length} photos, ${v.vehicle_number})`, made.s === 201 && v.photos?.length === 2 && v.vehicle_number === 'TS 36 ZZ 9931', JSON.stringify(made.d).slice(0, 200));
  const dup = await call('/transport/admin', { method: 'POST', token: admin, form: form(base, 0) });
  check(`the same vehicle twice → "${dup.d?.error}"`, dup.s === 409 || dup.s === 400);
  const hqAdd = await call('/transport/admin', { method: 'POST', token: hq, form: form({ ...base, vehicle_number: 'TS 36 ZZ 9932' }, 0) });
  check(`HQ can't add (read only) (${hqAdd.s})`, hqAdd.s === 403);
  const hqList = await call('/transport/admin', { token: hq });
  check(`HQ sees it in the list (read only)`, hqList.d?.vehicles?.some((x) => x.id === v.id) && hqList.d.can_edit === false);

  const guest = await call('/transport', { city });
  const g = guest.d?.vehicles?.find((x) => x.id === v.id);
  check(`guest in Siddipet sees it without the number (${guest.d?.counts?.ace} Tata Ace)`, g && g.phone === null && g.photos.length === 2);
  const logged = await call('/transport?type=ace', { city, token: user });
  check(`logged-in customer sees the number; type filter Tata Ace`, logged.d?.vehicles?.find((x) => x.id === v.id)?.phone === '9000309931' && logged.d.vehicles.every((x) => x.vehicle_type === 'ace'));
  const otherCity = other ? await call('/transport', { city: other }) : { d: { vehicles: [] } };
  check(`another city doesn't see it`, !otherCity.d?.vehicles?.some((x) => x.id === v.id));

  const anon = await call(`/transport/${v.id}/contact`, { method: 'POST', body: { kind: 'call' } });
  check(`calling needs login (${anon.s})`, anon.s === 401);
  const c1 = await call(`/transport/${v.id}/contact`, { method: 'POST', token: user, body: { kind: 'call' } });
  await call(`/transport/${v.id}/contact`, { method: 'POST', token: user, body: { kind: 'whatsapp' } });
  const cnt = (await db.query('SELECT call_count, whatsapp_count FROM transport_vehicles WHERE id = $1', [v.id])).rows[0];
  check(`Call → ${c1.d?.phone}; counted ${cnt.call_count} call, ${cnt.whatsapp_count} WhatsApp`, c1.d?.phone === '9000309931' && cnt.call_count === 1 && cnt.whatsapp_count === 1);

  const rep = await call(`/transport/${v.id}/report`, { method: 'POST', token: user, body: { reason: 'not_answering', note: 'zt test' } });
  const rep2 = await call(`/transport/${v.id}/report`, { method: 'POST', token: user, body: { reason: 'other' } });
  check(`customer reports (${rep.s}); twice a day refused (${rep2.s})`, rep.s === 201 && rep2.s === 409);
  const stats = await call('/admin/orders-stats', { token: admin });
  check(`admin menu count transport_reports = ${stats.d?.transport_reports}`, Number(stats.d?.transport_reports) >= 1);
  const list = await call('/transport/admin', { token: admin });
  const r = list.d?.reports?.find((x) => x.vehicle_id === v.id && x.status === 'open');
  const closed = await call(`/transport/admin/reports/${r?.id}/close`, { method: 'POST', token: admin });
  check(`admin closes the report (${closed.s})`, closed.s === 204);

  // edit: keep 1 photo, add 1, mark busy
  const keep = [v.photos[0]];
  const ed = await call(`/transport/admin/${v.id}`, { method: 'PUT', token: admin, form: form({ ...base, keep: JSON.stringify(keep), is_available: 'false' }, 1) });
  check(`edit: kept 1 photo + 1 new = ${ed.d?.photos?.length} photos, busy`, ed.s === 200 && ed.d.photos.length === 2 && ed.d.photos[0] === keep[0] && ed.d.is_available === false);
  const off = await call(`/transport/admin/${v.id}`, { method: 'PUT', token: admin, form: form({ ...base, keep: JSON.stringify(ed.d.photos), is_active: 'false' }, 0) });
  check(`switched off → gone for customers`, off.s === 200 && !(await call('/transport', { city })).d.vehicles.some((x) => x.id === v.id));
} catch (e) {
  check('transport API test ran without crashing', false, e.stack);
} finally {
  const gone = await db.query("DELETE FROM transport_vehicles WHERE phone LIKE '90003099%' RETURNING photos");
  for (const r of gone.rows) for (const p of r.photos) fs.rmSync(`../server${p}`, { force: true });
  console.log(`cleanup: ${gone.rowCount} test vehicles`);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
