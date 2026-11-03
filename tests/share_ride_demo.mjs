// 🚗 Share Ride DEMO data (to show franchise clients): 10 car owners (driver1–driver10, one password), 15 cars of
// 11 different models, 2 journeys per car (out + back) 15–21 days from today, cash or UPI. A few seats are already
// booked by user1–user6 (cash → confirmed, ticket downloadable) so the seat maps look real.
// Goes through the real app routes (apply with OTP → admin approves car + subscription → owner lists journeys).
//   node share_ride_demo.mjs            create (skips what exists)
//   node share_ride_demo.mjs remove     delete the 10 owners (their cars, journeys and bookings go with them)
// Env: DEMO_PW = the drivers' password.
import fs from 'node:fs';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';
const bcrypt = createRequire('../server/package.json')('bcryptjs');
import './testadmin.mjs';
const API = 'http://localhost:5000/api';
const DIR = '.';
const call = async (p, { method = 'GET', body, token, form } = {}) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method, headers, body: form || (body && JSON.stringify(body)) });
  const d = await r.json().catch(() => ({}));
  if (r.status >= 400) throw new Error(`${method} ${p}: ${d.error || r.status}`);
  return d;
};
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
const PHONE = (n) => `90003003${String(n).padStart(2, '0')}`;

if (process.argv[2] === 'remove') {
  const r = await db.query("DELETE FROM users WHERE phone LIKE '90003003%' AND role = 'agent' RETURNING username");
  console.log(`removed ${r.rowCount} demo owners: ${r.rows.map((x) => x.username).join(', ')}`);
  await db.end();
  process.exit(0);
}
if (!process.env.DEMO_PW) { console.log('set DEMO_PW'); process.exit(1); }

// a "document" picture that plainly says DEMO (the admin can open it; nobody mistakes it for a real RC)
const DOC = `${DIR}/shots/demo-doc.png`;
if (!fs.existsSync(DOC)) {
  const b = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe') });
  const p = await b.newPage();
  await p.setViewport({ width: 800, height: 500 });
  await p.setContent(`<body style="margin:0;height:500px;display:grid;place-items:center;background:#f1f5f9;font:600 28px system-ui;color:#334155;text-align:center">
    <div style="border:4px dashed #94a3b8;border-radius:24px;padding:40px 60px">📄 DEMO DOCUMENT<br><span style="font-size:18px;font-weight:400">All Services · Share Ride demo data<br>not a real RC / permit / insurance</span></div></body>`);
  await p.screenshot({ path: DOC });
  await b.close();
}
const pic = () => new Blob([fs.readFileSync(DOC)], { type: 'image/png' });

const admin = (await call('/auth/login', { method: 'POST', body: { username: 'zt_admin', password: process.env.TEST_STAFF_PW, portal: 'admin' } })).token;
const otp = async (phone, portal, extra = {}) => {
  await db.query('DELETE FROM phone_otps WHERE phone = $1', [phone]);
  const code = (await call('/auth/phone/request', { method: 'POST', body: { phone } })).devCode;
  return call('/auth/phone/verify', { method: 'POST', body: { phone, code, portal, ...extra } });
};
const town = (await db.query('SELECT id FROM localities WHERE franchise_id = 1 AND is_active AND NOT is_village ORDER BY id LIMIT 1')).rows[0].id;
const models = await call('/share-ride/models');
const model = (re) => models.find((m) => re.test(m.name));

// routes: [from, to, pickups, drops, base price per seat]
const ROUTES = {
  hyd: ['Siddipet', 'Hyderabad', ['Old bus stand', 'New bus stand', 'Ponnala X roads'], ['JBS', 'Secunderabad station', 'Ameerpet'], 350],
  air: ['Siddipet', 'Shamshabad Airport', ['Old bus stand', 'Rangadhampally'], ['Airport departures'], 650],
  knr: ['Siddipet', 'Karimnagar', ['New bus stand', 'Mustabad X roads'], ['Karimnagar bus stand', 'Clock tower'], 220],
  wgl: ['Siddipet', 'Warangal', ['Old bus stand'], ['Hanamkonda bus stand', 'Warangal station'], 300],
  nzb: ['Siddipet', 'Nizamabad', ['New bus stand'], ['Nizamabad bus stand'], 330],
  mdk: ['Siddipet', 'Medak', ['Old bus stand'], ['Medak church', 'Medak bus stand'], 200],
  sec: ['Siddipet', 'Secunderabad', ['Old bus stand', 'Ponnala X roads'], ['Secunderabad station', 'Paradise'], 340],
  gjw: ['Gajwel', 'Hyderabad', ['Gajwel bus stand'], ['JBS', 'Ameerpet'], 250],
};
// 10 owners, 15 cars (owners 1–5 have two), every model used
const OWNERS = [
  ['Ramesh Goud', [[/Dzire/, 'White', 'hyd', 15, '05:30'], [/Innova Crysta/, 'Grey', 'air', 16, '04:00']]],
  ['Srinivas Reddy', [[/Ertiga/, 'Silver', 'hyd', 15, '07:00'], [/Tempo Traveller/, 'White', 'hyd', 17, '06:00']]],
  ['Mahesh Yadav', [[/Etios/, 'White', 'knr', 15, '08:30'], [/Kia Carens/, 'Blue', 'wgl', 18, '06:30']]],
  ['Venkatesh Rao', [[/Aura/, 'Red', 'sec', 16, '06:00'], [/Toyota Innova \(7/, 'White', 'hyd', 19, '05:00']]],
  ['Naresh Kumar', [[/Amaze/, 'Silver', 'mdk', 16, '09:00'], [/Xylo/, 'White', 'nzb', 17, '07:30']]],
  ['Raju Patel', [[/Marazzo/, 'Brown', 'air', 18, '03:30']]],
  ['Anil Kumar', [[/Dzire/, 'Blue', 'gjw', 19, '07:00']]],
  ['Prakash Chary', [[/Ertiga/, 'White', 'wgl', 20, '06:00']]],
  ['Shiva Prasad', [[/Innova Crysta/, 'White', 'hyd', 20, '08:00']]],
  ['Kiran Varma', [[/Tempo Traveller/, 'Silver', 'knr', 21, '07:00']]],
];
const NOTES = ['AC car · 1 bag per person', 'AC · music · water bottle free', 'Experienced driver · on-time start', 'AC · stops once for tea',
  'Clean car · luggage carrier on top', 'Ladies-friendly · family trips welcome'];
const prices = (layout, base) => layout.map((_, i) => (i === 0 ? base + 50 : i === layout.length - 1 && layout.length > 2 ? base - 50 : base));
const ist = (day, time) => {
  const date = new Date(Date.now() + 330 * 60000 + day * 864e5).toISOString().slice(0, 10);
  return new Date(`${date}T${time}:00+05:30`).toISOString();
};
const addHours = (iso, h) => new Date(new Date(iso).getTime() + h * 36e5).toISOString();

const hash = await bcrypt.hash(process.env.DEMO_PW, 10);
let carNo = 0, rideCount = 0;
const rideIds = [];
for (const [i, [name, cars]] of OWNERS.entries()) {
  const n = i + 1, phone = PHONE(n);
  let user = (await db.query("SELECT id FROM users WHERE phone = $1 AND role = 'agent'", [phone])).rows[0];
  const [m0, color0] = cars[0];
  if (!user) {
    const { proof } = await otp(phone, 'agent_apply');
    const f = new FormData();
    Object.entries({ owner_type: 'car', phone_proof: proof, full_name: name, locality_id: town, aadhaar_number: '123456789012', pan_number: 'ABCDE1234F',
      dl_number: `TS362018000${String(n).padStart(4, '0')}`, car_model_id: model(m0).id, reg_number: `TS36UD${String(1000 + ++carNo)}`, car_color: color0,
      yellow_board: 'true', skills: 'shared_car_agent' }).forEach(([k, v]) => f.append(k, v));
    for (const d of ['aadhaar_doc', 'pan_doc', 'dl_doc', 'rc_doc', 'permit_doc', 'insurance_doc']) f.append(d, pic(), `${d}.png`);
    await call('/agents/apply', { method: 'POST', form: f });
    user = (await db.query("SELECT id FROM users WHERE phone = $1 AND role = 'agent'", [phone])).rows[0];
  } else carNo++;
  const approve = async () => {
    for (const c of (await db.query("SELECT id FROM shared_cars WHERE owner_id = $1 AND status = 'pending'", [user.id])).rows) {
      await call(`/share-ride/admin/cars/${c.id}/review`, { method: 'POST', token: admin, body: { action: 'approve' } });
    }
  };
  await approve(); // approving the first car also approves the owner
  // easy demo login: driverN + one password (agent app: "Password" tab)
  await db.query('UPDATE users SET username = $2, password_hash = $3, has_password = true WHERE id = $1', [user.id, `driver${n}`, hash]);
  const { token } = await otp(phone, 'agent').catch(async () => ({ token: (await call('/auth/login', { method: 'POST', body: { username: `driver${n}`, password: process.env.DEMO_PW, portal: 'agent' } })).token }));
  // the second car
  for (const [mre, color] of cars.slice(1)) {
    const has = (await db.query('SELECT 1 FROM shared_cars WHERE owner_id = $1 AND model_id = $2', [user.id, model(mre).id])).rowCount;
    if (has) { carNo++; continue; }
    const f = new FormData();
    Object.entries({ car_model_id: model(mre).id, reg_number: `TS36UD${String(1000 + ++carNo)}`, car_color: color, yellow_board: 'true' }).forEach(([k, v]) => f.append(k, v));
    for (const d of ['rc_doc', 'permit_doc', 'insurance_doc']) f.append(d, pic(), `${d}.png`);
    await call('/share-ride/owner/cars', { method: 'POST', token, form: f });
  }
  // admin approves the second car + 60 days of subscription
  await approve();
  const sub = (await db.query('SELECT id, status, paid_until FROM agent_subscriptions WHERE agent_id = $1 AND service_id = fn_share_ride_service()', [user.id])).rows[0];
  if (sub && (sub.status !== 'active' || new Date(sub.paid_until) < new Date(Date.now() + 40 * 864e5))) {
    await call(`/admin/subscriptions/${sub.id}/activate`, { method: 'POST', token: admin, body: { amount: 0, mode: 'free', days: 60 } });
  }
  // journeys: each car goes out in the morning and comes back the same evening
  for (const [mre, , route, day, time] of cars) {
    const car = (await db.query('SELECT id FROM shared_cars WHERE owner_id = $1 AND model_id = $2', [user.id, model(mre).id])).rows[0];
    const layout = model(mre).layout;
    const [from, to, pick, drop, base] = ROUTES[route];
    const out = ist(day, time);
    for (const [f, t, pk, dr, at] of [[from, to, pick, drop, out], [to, from, drop, pick, addHours(out, 10)]]) {
      const exists = (await db.query('SELECT id FROM share_rides WHERE car_id = $1 AND depart_at = $2', [car.id, at])).rows[0];
      if (exists) { rideIds.push(exists.id); continue; }
      const r = await call('/share-ride/owner/rides', { method: 'POST', token, body: {
        car_id: car.id, from: f, to: t, depart_at: at, pickups: pk, drops: dr, prices: prices(layout, base), blocked: [],
        upi_id: `driver${n}@okaxis`, allow_cash: true, notes: NOTES[(n + rideCount) % NOTES.length],
      } });
      rideIds.push(r.id);
      rideCount++;
    }
  }
}

// a few seats already taken (user1–user6, cash → confirmed) so the seat maps look lived-in
const PASSENGERS = ['Ravi', 'Lakshmi', 'Sai Teja', 'Anjali', 'Praveen', 'Swathi', 'Harish', 'Divya', 'Manoj', 'Keerthi'];
let booked = 0;
for (const [k, rid] of rideIds.entries()) {
  if (k % 3 !== 0) continue;
  if ((await db.query("SELECT 1 FROM ride_bookings WHERE ride_id = $1 AND status = 'confirmed'", [rid])).rowCount) continue;
  const u = (k / 3) % 6 + 1;
  const tok = (await call('/auth/login', { method: 'POST', body: { username: `user${u}`, password: process.env.TEST_USER_PW, portal: 'user' } })).token;
  const ride = (await db.query('SELECT layout, pickup_points, drop_points FROM share_rides WHERE id = $1', [rid])).rows[0];
  const seats = (await db.query('SELECT code FROM fn_layout_seats($1::jsonb) ORDER BY row_no DESC, col_no', [JSON.stringify(ride.layout)])).rows.map((x) => x.code);
  const take = seats.slice(0, 1 + (k % 2));
  await call(`/share-ride/rides/${rid}/book`, { method: 'POST', token: tok, body: {
    passengers: take.map((seat, j) => ({ seat, name: PASSENGERS[(k + j) % PASSENGERS.length] })), phone: `90003001${String(u).padStart(2, '0')}`,
    pickup: ride.pickup_points[0], drop: ride.drop_points[0], pay_mode: 'cash', agree: true } });
  booked++;
}
await db.query("DELETE FROM phone_otps WHERE phone LIKE '90003003%'");
const show = await db.query(`SELECT u.username, u.full_name, u.phone, a.status AS agent,
         string_agg(DISTINCT m.name || ' ' || c.reg_number, ' | ') AS cars,
         (SELECT count(*) FROM share_rides r WHERE r.owner_id = u.id AND r.status = 'open') AS journeys
    FROM users u JOIN agents a ON a.user_id = u.id JOIN shared_cars c ON c.owner_id = u.id JOIN car_models m ON m.id = c.model_id
   WHERE u.phone LIKE '90003003%' GROUP BY u.id, a.status ORDER BY u.phone`);
console.table(show.rows);
console.log(`${rideIds.length} journeys, ${booked} demo bookings added now`);
console.table((await db.query(`SELECT to_char(depart_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI') AS depart, from_place, to_place, m.name AS car
    FROM share_rides r JOIN shared_cars c ON c.id = r.car_id JOIN car_models m ON m.id = c.model_id
   WHERE r.owner_id IN (SELECT id FROM users WHERE phone LIKE '90003003%') ORDER BY depart_at LIMIT 40`)).rows);
await db.end();
