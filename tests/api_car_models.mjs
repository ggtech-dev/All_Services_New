// 🚗 Car Rental by car model (API): agent9 (car partner, Siddipet) gets an approved Ertiga for the test.
//  Dzire booking → agent9 can't see/take it · Ertiga booking → sees it, accepts, customer sees "Maruti Ertiga" + number
//  · "Any car" → can take · Innova booking → no; after the customer asks all 6–7 seaters → yes · Dzire widened → still no
//  (4-seater) · a removed / unknown model is refused. Test orders and the test car are removed at the end.
import pg from 'pg';
const API = 'http://localhost:5000/api';
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 220)}` : ''}`); c ? pass++ : fail++; };
const call = async (p, { method = 'GET', body, token } = {}) => {
  const r = await fetch(API + p, { method, headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { s: r.status, d: await r.json().catch(() => null) };
};
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path = all_services');
const start = (await db.query('SELECT now() t')).rows[0].t;
const AG = (await db.query("SELECT id FROM users WHERE username = 'agent9'")).rows[0].id;
const model = async (re) => (await db.query('SELECT id FROM car_models WHERE name ~* $1 ORDER BY id LIMIT 1', [re])).rows[0].id;
const ERTIGA = await model('^Maruti Ertiga'), DZIRE = await model('Swift Dzire'), INNOVA = await model('^Toyota Innova [(]');
let carId = null;
try {
  carId = (await db.query(`INSERT INTO shared_cars (owner_id, franchise_id, model_id, reg_number, color, rc_doc, permit_doc, insurance_doc, status)
                           VALUES ($1, 1, $2, 'TS36ZT9999', 'White', 'x', 'x', 'x', 'approved') RETURNING id`, [AG, ERTIGA])).rows[0].id;
  const cust = (await call('/auth/login', { method: 'POST', body: { username: '9000300101', password: process.env.TEST_USER_PW, portal: 'user' } })).d.token;
  const svc = (await db.query("SELECT id FROM services WHERE slug = 'vehicle-rental-car-booking'")).rows[0].id;
  const loc = (await db.query("SELECT id, lat::float, lng::float FROM localities WHERE franchise_id = 1 AND is_active AND NOT is_village AND lat IS NOT NULL ORDER BY id LIMIT 1")).rows[0];
  const area = loc.id;
  const day = new Date(Date.now() + 330 * 60000 + 3 * 864e5).toISOString().slice(0, 10);
  const contact = { name: 'User1', phone: '9000300101', address_line: 'zt H.No 1, Siddipet', locality_id: area, lat: loc.lat, lng: loc.lng };
  const book = async (car_model_id) => call('/orders', { method: 'POST', token: cust, body: { service_id: svc, contact,
    trip: { trip_type: 'One way', drop: 'Hyderabad airport', trip_date: day, trip_time: '06:00', car_model_id: car_model_id ?? '' } } });
  const may = async (o) => (await db.query('SELECT fn_agent_may_take($1,$2) ok', [AG, o])).rows[0].ok;

  const dz = await book(DZIRE);
  check(`Dzire booking placed → "${dz.d?.trip_details?.car_type}" (${dz.s})`, dz.s === 201 && dz.d.trip_details.car_type === 'Maruti Swift Dzire');
  check('… the Ertiga partner can NOT see / take it', (await may(dz.d.id)) === false);
  const er = await book(ERTIGA);
  check('Ertiga booking → the Ertiga partner can take it', er.s === 201 && (await may(er.d.id)) === true);
  const any = await book('');
  check(`"Any car" booking → ${any.d?.trip_details?.car_type} → can take it`, any.s === 201 && any.d.trip_details.car_type === 'Any car' && (await may(any.d.id)) === true);
  const inn = await book(INNOVA);
  check('Innova booking → Ertiga partner can NOT take it', inn.s === 201 && (await may(inn.d.id)) === false);
  const w = await call(`/orders/${inn.d.id}/any-car`, { method: 'POST', token: cust });
  check(`customer asks all 6–7 seaters (${w.s}) → now the Ertiga partner can take it`, w.s === 200 && w.d.trip_details.any_size === true && (await may(inn.d.id)) === true);
  const w2 = await call(`/orders/${dz.d.id}/any-car`, { method: 'POST', token: cust });
  check('Dzire widened to all 4-seaters → still not the Ertiga (6 seats)', w2.s === 200 && (await may(dz.d.id)) === false);
  const bad = await book(999999);
  check(`unknown car is refused: "${bad.d?.error}"`, bad.s === 400);
  // the partner accepts the Ertiga booking (accept function, as the agent app does)
  await db.query('SELECT fn_agent_accept_order($1,$2)', [AG, er.d.id]);
  const seen = await call(`/orders/${er.d.id}`, { token: cust });
  check(`customer sees the car coming: ${JSON.stringify(seen.d?.trip_car)}`, seen.d?.trip_car?.model === 'Maruti Ertiga' && seen.d.trip_car.reg_number === 'TS36ZT9999');
  const late = await call(`/orders/${er.d.id}/any-car`, { method: 'POST', token: cust });
  check(`after a partner took it, "ask all cars" is refused (${late.s})`, late.s >= 400);
  const opts = (await call('/trip-options')).d;
  check(`booking form: ${opts.cars.length} cars, small → big (${opts.cars.map((c) => c.seats).join(',')})`, opts.cars.length >= 12 && opts.cars.every((c, i, a) => !i || a[i - 1].seats <= c.seats));
} catch (e) {
  check('ran without error', false, e.stack);
} finally {
  const o = await db.query("DELETE FROM orders WHERE contact_phone = '9000300101' AND created_at >= $1 AND trip_details IS NOT NULL RETURNING id", [start]);
  if (carId) await db.query('DELETE FROM shared_cars WHERE id = $1', [carId]);
  console.log(`cleanup: ${o.rowCount} test bookings, test car removed`);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
