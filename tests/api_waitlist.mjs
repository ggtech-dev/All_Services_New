import './testadmin.mjs'; // zt_super / zt_admin test staff
// 📍 Notify me + saved addresses + HQ waitlist (API). Uses test numbers 90003099xx and removes its own rows at the end.
import pg from 'pg';
const B = 'http://localhost:5000/api';
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 200)}` : ''}`); c ? pass++ : fail++; };
const call = async (path, { method = 'GET', body, token, ip } = {}) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...(ip && { 'x-forwarded-for': ip }) },
    body: body && JSON.stringify(body) });
  return { s: r.status, d: r.status === 204 ? null : await r.json().catch(() => null) };
};
const login = async (username, password, portal) => (await call('/auth/login', { method: 'POST', body: { username, password, portal } })).d?.token;
const RUN = Math.floor(Math.random() * 250); // fresh visitor addresses each run (the API remembers the last hour)
const HYD = { lat: 17.385, lng: 78.4867 }, SIDDIPET = { lat: 18.1035, lng: 78.8528 };

const r1 = await call('/waitlist', { method: 'POST', ip: `10.${RUN}.0.1`, body: { phone: '9000309901', name: 'zt Hyd', ...HYD } });
check(`Hyderabad spot → saved (${r1.s})`, r1.s === 201 && r1.d.again === false, JSON.stringify(r1));
const r2 = await call('/waitlist', { method: 'POST', ip: `10.${RUN}.0.1`, body: { phone: '+91 90003 09901', lat: 17.39, lng: 78.49 } });
check('same number, ~1 km away → the same request (asked again)', r2.s === 201 && r2.d.again === true && r2.d.id === r1.d.id, JSON.stringify(r2));
const r3 = await call('/waitlist', { method: 'POST', ip: `10.${RUN}.0.1`, body: { phone: '9000309902', place_text: 'zt Gajwel' } });
check('typed place, no GPS → saved', r3.s === 201, JSON.stringify(r3));
const r4 = await call('/waitlist', { method: 'POST', ip: `10.${RUN}.0.1`, body: { phone: '9000309903', ...SIDDIPET } });
check(`a place we serve → refused ("${r4.d?.error}")`, r4.s === 400 && /already deliver/.test(r4.d?.error || ''));
const r5 = await call('/waitlist', { method: 'POST', ip: `10.${RUN}.0.1`, body: { phone: '12345', ...HYD } });
check(`bad number → refused ("${r5.d?.error}")`, r5.s === 400);
const r6 = await call('/waitlist', { method: 'POST', ip: `10.${RUN}.0.1`, body: { phone: '9000309904' } });
check(`no spot and no place → refused ("${r6.d?.error}")`, r6.s === 400);
// 10 per hour from one visitor (4 + 6 more = 10 allowed, the 11th refused)
for (let i = 0; i < 6; i++) await call('/waitlist', { method: 'POST', ip: `10.${RUN}.0.2`, body: { phone: '9000309905', place_text: `zt flood ${i}` } });
const flood = await call('/waitlist', { method: 'POST', ip: `10.${RUN}.0.2`, body: { phone: '9000309905', place_text: 'zt flood x' } });
check(`one visitor: 7th request is fine, the limit is per visitor (${flood.s})`, flood.s === 201);
for (let i = 0; i < 4; i++) await call('/waitlist', { method: 'POST', ip: `10.${RUN}.0.2`, body: { phone: '9000309905', place_text: `zt flood y${i}` } });
const over = await call('/waitlist', { method: 'POST', ip: `10.${RUN}.0.2`, body: { phone: '9000309905', place_text: 'zt flood z' } });
check(`11th request in an hour from one visitor → 429`, over.s === 429);
const other = await call('/waitlist', { method: 'POST', ip: `10.${RUN}.0.3`, body: { phone: '9000309906', place_text: 'zt other' } });
check('another visitor is not blocked', other.s === 201);

// HQ view
const hq = await login('zt_super', process.env.TEST_STAFF_PW, 'super');
const rep = await call('/super/waitlist', { token: hq });
const mine = rep.d?.requests?.filter((x) => /^90003099/.test(x.phone)) || [];
check(`HQ sees the requests (${mine.length}) and grouped places (${rep.d?.spots?.length}) — waiting ${rep.d?.summary?.waiting}`,
  rep.s === 200 && mine.length >= 3 && rep.d.spots.some((s) => s.people >= 1 && Number(s.km) > 50));
const hy = mine.find((x) => x.phone === '9000309901');
check(`Hyderabad request: ${hy?.km_to_nearest} km from ${hy?.nearest_city}, asked ${hy?.asked_times}×`, hy && Number(hy.km_to_nearest) > 80 && hy.nearest_city === 'Siddipet' && hy.asked_times === 2);
const mark = await call(`/super/waitlist/${hy.id}`, { method: 'PATCH', token: hq, body: { status: 'contacted' } });
const after = await call('/super/waitlist', { token: hq });
check('HQ marks "contacted" → leaves the waiting list', mark.s === 204 && !after.d.requests.some((x) => x.id === hy.id));
const all = await call('/super/waitlist?status=all', { token: hq });
check('…and shows under "all"', all.d.requests.some((x) => x.id === hy.id && x.status === 'contacted'));
const cust = await login('9000300101', process.env.TEST_USER_PW, 'user');
const no = await call('/super/waitlist', { token: cust });
check(`a customer cannot see HQ's list (${no.s})`, no.s === 403 || no.s === 401);

// saved addresses (user1 has delivered orders)
const ad = await call('/orders/addresses', { token: cust });
check(`user1 saved addresses: ${ad.d?.map((a) => `${a.address_line} · ${a.area}`).join(' | ')}`, ad.s === 200 && ad.d.length >= 1 && ad.d.length <= 3 && ad.d.every((a) => a.area && a.franchise_id));
const guest = await call('/orders/addresses');
check('guests have no saved addresses (401)', guest.s === 401);

// clean up our own rows
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
const del = await db.query("DELETE FROM all_services.area_waitlist WHERE phone LIKE '90003099%'");
await db.end();
console.log(`cleanup: ${del.rowCount} test requests removed`);
console.log(`\n${pass} passed, ${fail} failed`);
