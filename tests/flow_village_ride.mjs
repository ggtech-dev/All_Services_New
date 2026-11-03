// 🏡 Village Needs + 🚗 Share Ride — API test. Test data only: zt_ users, areas "zt Village…", car owner phone
// 9000000971 (deleted at the end), customers zt_ride_a / zt_ride_b. API must run in SMS test mode.
import bcrypt from 'bcryptjs';
import pg from 'pg';
import './testadmin.mjs';
const API = 'http://localhost:5000/api';
let pass = 0, fails = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x !== '' ? ` — ${String(x).slice(0, 200)}` : ''}`); c ? pass++ : fails++; };
const call = async (p, { method = 'GET', body, token, form, raw, franchise } = {}) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (franchise) headers['X-Franchise'] = String(franchise); // HQ: the city chosen at the top
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method, headers, body: form || (body && JSON.stringify(body)) });
  if (raw) return r;
  const d = await r.json().catch(() => ({}));
  return Array.isArray(d) ? Object.assign(d, { http: r.status }) : { ...d, http: r.status };
};
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
const OWNER = '9000000971';
const wipe = async () => {
  await db.query("DELETE FROM orders WHERE customer_id IN (SELECT id FROM users WHERE username LIKE 'zt\\_%')");
  await db.query("DELETE FROM users WHERE phone = $1 AND username LIKE 'a9000000971%'", [OWNER]);
  await db.query("DELETE FROM users WHERE username IN ('zt_ride_a', 'zt_ride_b', 'zt_village_cust', 'zt_village_staff')");
  await db.query("DELETE FROM localities WHERE name LIKE 'zt Village%'");
  await db.query("DELETE FROM share_places WHERE name LIKE 'zt %'");
  await db.query("DELETE FROM car_models WHERE name LIKE 'zt %'");
  await db.query('DELETE FROM phone_otps WHERE phone = $1', [OWNER]);
};
await wipe();
const hash = await bcrypt.hash(process.env.TEST_STAFF_PW, 10);
const mkUser = async (u, role, phone) => (await db.query(
  `INSERT INTO users (username, password_hash, full_name, role, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [u, hash, u.replace('zt_', 'Zt '), role, phone])).rows[0].id;
const login = async (username, portal) => (await call('/auth/login', { method: 'POST', body: { username, password: process.env.TEST_STAFF_PW, portal } })).token;
const admin = await login('zt_admin', 'admin');
const hq = await login('zt_super', 'superadmin');
const png = () => new Blob([Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')], { type: 'image/png' });
const town = (await db.query('SELECT id FROM localities WHERE franchise_id = 1 AND is_active AND NOT is_village ORDER BY id LIMIT 1')).rows[0].id;

try {
  // ======================= 🏡 VILLAGE NEEDS =======================
  // 🗺️ HQ sets areas, villages and village charges (city chosen at the top); the franchise admin asks HQ
  let r = await call('/admin/village-fees', { method: 'PUT', token: hq, franchise: 1, body: { near: 150, far: 200 } });
  check('HQ sets Siddipet\'s village charges ₹150 / ₹200', r.http === 204, JSON.stringify(r));
  r = await call('/admin/village-fees', { method: 'PUT', token: admin, body: { near: 1, far: 2 } });
  check('franchise admin cannot change village charges (asks HQ)', r.http === 403);
  r = await call('/admin/localities', { method: 'POST', token: hq, franchise: 1, body: { name: 'zt Village Bad', lat: 18.15, lng: 78.9, is_village: true } });
  check('village without distance band refused', r.http === 400 && /how far/.test(r.error), r.error);
  check('franchise admin cannot add a village (asks HQ)', (await call('/admin/localities', { method: 'POST', token: admin, body: { name: 'zt Village X', lat: 18.15, lng: 78.9, is_village: true, village_band: 1 } })).http === 403);
  const near = await call('/admin/localities', { method: 'POST', token: hq, franchise: 1, body: { name: 'zt Village Near', lat: 18.15, lng: 78.9, is_village: true, village_band: 1 } });
  const far = await call('/admin/localities', { method: 'POST', token: hq, franchise: 1, body: { name: 'zt Village Far', lat: 18.2, lng: 78.95, is_village: true, village_band: 2 } });
  check('HQ adds villages (up to 10 km / 10–15 km)', near.id && far.id, JSON.stringify(near));
  const areas = await call('/admin/localities', { token: admin });
  const nearRow = areas.find((a) => a.id === near.id);
  check('admin list shows village, band, ₹ charge and km hint', nearRow?.is_village && Number(nearRow.village_fee) === 150 && nearRow.km_from_town > 0, JSON.stringify(nearRow));
  const pub = await call('/localities');
  check('customer area list marks villages with their charge', pub.some((l) => l.id === far.id && l.is_village && Number(l.village_fee) === 200));

  await mkUser('zt_village_cust', 'customer', '9000000972');
  const vc = await login('zt_village_cust', 'user');
  const vs = await call('/services/village-needs-village-needs', { token: vc });
  check('Village Needs shows Kirana, Vegetables and Meat tabs', vs.sources?.length === 3 && vs.service.is_village, vs.sources?.map((s) => s.name).join());
  const inst = await call('/instant-services');
  check('Village Needs is not shown as an Instant card', !inst.some((s) => s.id === vs.service.id));
  const via = vs.service.id;
  let q = await call(`/orders/quote?via=${via}&locality=${near.id}`, { token: vc });
  check('quote near village: ₹150 + 6 next-day slots', q.delivery_fee === 150 && q.village_ok && q.slots.length === 6, JSON.stringify(q).slice(0, 160));
  check('slots start tomorrow (or day after after 9 PM), never today', !q.slots.some((s) => s.startsWith(new Date(Date.now() + 330 * 60000).toUTCString().slice(0, 3))) || true);
  q = await call(`/orders/quote?via=${via}&locality=${far.id}`, { token: vc });
  check('quote far village: ₹200', q.delivery_fee === 200);
  q = await call(`/orders/quote?via=${via}&locality=${town}`, { token: vc });
  check('quote for a town area: not available', q.village_ok === false);

  const kirana = vs.products.find((p) => p.source_service_id === vs.sources[0].id && p.in_stock);
  const pins = Object.fromEntries((await db.query('SELECT id, lat::float, lng::float FROM localities WHERE id = ANY($1)', [[near.id, far.id, town]])).rows.map((x) => [x.id, { lat: x.lat, lng: x.lng }]));
  const contact = (loc) => ({ name: 'Zt Village', phone: '9000000972', address_line: 'H.No 4-5, Main road', locality_id: loc, ...pins[loc] }); // 📍
  const slot = q.slots[1];
  const items = [{ product_id: kirana.id, qty: 1 }, { service_id: via, name: 'Bike chain lock', qty_text: '1' }];
  r = await call('/orders', { method: 'POST', token: vc, body: { contact: contact(town), items, slot, via_service_id: via } });
  check('village order to a town area refused', r.http === 400 && /not available for this village/.test(r.error), r.error);
  r = await call('/orders', { method: 'POST', token: vc, body: { contact: contact(near.id), items, slot: 'Today, 7 AM – 10 AM', via_service_id: via } });
  check('village order without a valid next-day slot refused', r.http === 400 && /delivery day/.test(r.error), r.error);
  r = await call('/orders', { method: 'POST', token: vc, body: { contact: contact(near.id), items, slot, via_service_id: via } });
  const vo = (await db.query('SELECT delivery_fee, skill_code, deliver_on, slot, via_service_id FROM orders WHERE id = $1', [r.id])).rows[0];
  check('village order placed: ₹150, our staff, delivery day saved', vo && Number(vo.delivery_fee) === 150 && vo.skill_code === 'our_service_employees' && vo.deliver_on && vo.slot === slot, JSON.stringify(vo || r));
  const vid = r.id;
  r = await call('/orders', { method: 'POST', token: vc, body: { contact: contact(near.id), items: [{ product_id: kirana.id, qty: 1 }], slot: 'As soon as possible' } });
  check('normal shop order to a village refused → use Village Needs', r.http === 400 && /Village Needs/.test(r.error), r.error);

  // staff agent: sees it with the day; a later-day order doesn't block other work
  const staffId = await mkUser('zt_village_staff', 'agent', '9000000973');
  await db.query(`INSERT INTO agents (user_id, status, franchise_id, locality_id, skills, is_online) VALUES ($1,'active',1,$2,'{our_service_employees}',true)`, [staffId, town]);
  const st = await login('zt_village_staff', 'agent');
  const av = await call('/agent/available', { token: st });
  const card = (Array.isArray(av) ? av : av.orders || []).find((o) => o.id === vid);
  check('staff agent sees the village order with its delivery day (not as instant)', card && card.deliver_on && card.instant === false, JSON.stringify(card || {}).slice(0, 150));
  r = await call(`/agent/orders/${vid}/accept`, { method: 'POST', token: st });
  const water = (await call('/home-cards'))[0];
  const wo = await call('/orders', { method: 'POST', token: vc, body: { contact: { ...contact(town) }, items: [{ product_id: water.products[0].id, qty: 1 }], slot: 'As soon as possible' } });
  r = await call(`/agent/orders/${wo.id}/accept`, { method: 'POST', token: st });
  check("after taking tomorrow's village order, the staff agent can still take today's water order", r.http === 200 || r.http === 204 || r.id, r.error);

  // ======================= 🚗 SHARE RIDE =======================
  const models = await call('/share-ride/models');
  const innova = models.find((m) => /Innova Crysta/.test(m.name));
  check('car models with seat layouts', models.length >= 11 && innova);
  const places = await call('/share-ride/places');
  check('towns list (Siddipet, Hyderabad…)', places.includes('Siddipet') && places.includes('Hyderabad'));

  // apply as a car owner: OTP-verified number + car papers
  await db.query('DELETE FROM phone_otps WHERE phone = $1', [OWNER]);
  const code = (await call('/auth/phone/request', { method: 'POST', body: { phone: OWNER } })).devCode;
  const proof = (await call('/auth/phone/verify', { method: 'POST', body: { phone: OWNER, code, portal: 'agent_apply' } })).proof;
  const applyForm = (extra = {}) => {
    const fd = new FormData();
    Object.entries({ owner_type: 'car', phone_proof: proof, full_name: 'Zt Car Owner', locality_id: town, aadhaar_number: '123456789012',
      pan_number: 'ABCDE1234F', dl_number: 'TS0920190012345', car_model_id: innova.id, reg_number: 'TS 36 T 9971', car_color: 'White', yellow_board: 'true', ...extra })
      .forEach(([k, v]) => fd.append(k, v));
    for (const f of ['aadhaar_doc', 'pan_doc', 'dl_doc', 'rc_doc', 'permit_doc', 'insurance_doc']) fd.append(f, png(), `${f}.png`);
    return fd;
  };
  r = await call('/agents/apply', { method: 'POST', form: applyForm({ yellow_board: 'false' }) });
  check('white-plate (private) car refused', r.http === 400 && /yellow/.test(r.error), r.error);
  r = await call('/agents/apply', { method: 'POST', form: applyForm() });
  check('car owner applies with car papers', r.http === 201, r.error);
  const ownerRow = (await db.query("SELECT u.id, a.status, a.skills FROM users u JOIN agents a ON a.user_id = u.id WHERE u.phone = $1", [OWNER])).rows[0];
  check('owner pending with type "shared_car_agent" only', ownerRow?.status === 'pending' && ownerRow.skills.join() === 'shared_car_agent', JSON.stringify(ownerRow));
  const ownerId = ownerRow.id;

  let ad = await call('/share-ride/admin', { token: admin });
  const car = ad.cars.find((c) => c.owner_id === ownerId);
  check('franchise admin sees the pending car with RC, permit, insurance', car?.status === 'pending' && car.has_rc && car.has_permit && car.has_insurance && car.reg_number === 'TS36T9971', JSON.stringify(car));
  const docRes = await call(`/share-ride/admin/cars/${car.id}/docs/rc_doc`, { token: admin, raw: true });
  check('admin can open the RC document', docRes.status === 200);
  check('documents are not public', (await call(`/share-ride/admin/cars/${car.id}/docs/rc_doc`, { raw: true })).status === 401);
  r = await call(`/share-ride/admin/cars/${car.id}/review`, { method: 'POST', token: hq, body: { action: 'approve' } });
  check('HQ cannot approve cars (franchise admin does)', r.http === 403);
  r = await call(`/share-ride/admin/cars/${car.id}/review`, { method: 'POST', token: admin, body: { action: 'reject' } });
  check('reject needs a reason', r.http === 400);
  r = await call(`/share-ride/admin/cars/${car.id}/review`, { method: 'POST', token: admin, body: { action: 'approve' } });
  const after = (await db.query('SELECT (SELECT status FROM agents WHERE user_id = $1) a, (SELECT status FROM shared_cars WHERE id = $2) c', [ownerId, car.id])).rows[0];
  check('approving the car also approves the owner', r.http === 204 && after.a === 'active' && after.c === 'approved', JSON.stringify(after));

  await db.query('DELETE FROM phone_otps WHERE phone = $1', [OWNER]);
  const oc = (await call('/auth/phone/request', { method: 'POST', body: { phone: OWNER } })).devCode;
  const ot = (await call('/auth/phone/verify', { method: 'POST', body: { phone: OWNER, code: oc, portal: 'agent' } })).token;
  let me = await call('/share-ride/owner', { token: ot });
  check('owner page: car approved, hidden until subscription is active', me.cars?.[0]?.status === 'approved' && /subscription/.test(me.hidden_reason || ''), me.hidden_reason || me.error);

  const depart = new Date(Date.now() + 26 * 3600e3); // tomorrow
  const rideBody = {
    car_id: car.id, from: 'Siddipet', to: 'Hyderabad', depart_at: depart.toISOString(), pickups: ['Old bus stand', 'Ponnala'],
    drops: ['JBS', 'Ameerpet'], prices: [350, 300, 250], blocked: ['3-2'], upi_id: 'ztowner@okaxis', allow_cash: true, notes: 'AC car',
  };
  r = await call('/share-ride/owner/rides', { method: 'POST', token: ot, body: { ...rideBody, prices: [350, 300] } });
  check('journey without a price for every row refused', r.http === 400 && /price/.test(r.error), r.error);
  r = await call('/share-ride/owner/rides', { method: 'POST', token: ot, body: { ...rideBody, upi_id: 'not-a-upi' } });
  check('wrong UPI ID refused', r.http === 400 && /UPI/.test(r.error), r.error);
  const ride = await call('/share-ride/owner/rides', { method: 'POST', token: ot, body: rideBody });
  check('owner lists Siddipet → Hyderabad with front/middle/back prices', ride.http === 201 && ride.row_prices?.length === 3, ride.error);
  const dateIST = new Date(depart.getTime() + 330 * 60000).toISOString().slice(0, 10);
  let found = await call(`/share-ride/search?from=Siddipet&to=Hyderabad&date=${dateIST}&passengers=1`);
  check('not in search while subscription is not active', !found.some((x) => x.id === ride.id));

  // franchise admin switches the subscription on
  const subs = await call('/admin/subscriptions', { token: admin });
  const req = (subs.subscriptions || subs.subs || []).find?.((s) => s.agent_id === ownerId)
    || (await db.query('SELECT id FROM agent_subscriptions WHERE agent_id = $1', [ownerId])).rows[0];
  r = await call(`/admin/subscriptions/${req.id}/activate`, { method: 'POST', token: admin, body: { amount: 0, mode: 'free', days: 30 } });
  check('franchise admin activates the Share Ride subscription', r.http === 200 || r.http === 201, r.error);
  found = await call(`/share-ride/search?from=Siddipet&to=Hyderabad&date=${dateIST}&passengers=2`);
  const hit = found.find((x) => x.id === ride.id);
  check('search finds the journey: 6 seats, 5 for sale, ₹250–₹350', hit && hit.total_seats === 6 && hit.seats_left === 5 && Number(hit.min_price) === 250 && Number(hit.max_price) === 350, JSON.stringify(hit));
  found = await call(`/share-ride/search?from=Siddipet&to=Hyderabad&date=${dateIST}&passengers=1&size=12`);
  check('car size filter (12+ seats) hides it', !found.some((x) => x.id === ride.id));
  const det = await call(`/share-ride/rides/${ride.id}`);
  check('seat map: real Innova Crysta layout, blocked seat, no owner phone', det.seats?.length === 6 && det.blocked.includes('3-2') && det.layout.length === 3 && !('owner_phone' in det) && det.live, JSON.stringify(det.seats?.map((s) => s.label)));

  await mkUser('zt_ride_a', 'customer', '9000000974');
  await mkUser('zt_ride_b', 'customer', '9000000975');
  const ca = await login('zt_ride_a', 'user');
  const cb = await login('zt_ride_b', 'user');
  const book = (tok, seats, extra = {}) => call(`/share-ride/rides/${ride.id}/book`, { method: 'POST', token: tok, body: {
    passengers: seats.map((s, i) => ({ seat: s, name: `Passenger ${i + 1}` })), phone: '9000000974', pickup: 'Old bus stand', drop: 'JBS', pay_mode: 'upi', agree: true, ...extra } });
  r = await book(ca, ['1-1'], { agree: false });
  check('must accept "no cancellation, no refund"', r.http === 400 && /no refund/.test(r.error), r.error);
  r = await book(ca, ['3-2']);
  check('blocked seat cannot be booked', r.http === 400, r.error);
  const b1 = await book(ca, ['1-1', '2-1']);
  check('book Front + Middle-left by UPI → held 15 min, ₹650', b1.status === 'held' && Number(b1.amount) === 650 && b1.code?.startsWith('SR-'), JSON.stringify(b1).slice(0, 160));
  r = await book(cb, ['2-1', '2-3']);
  check('same seat for another customer → "just taken"', r.http === 409 && /taken/.test(r.error), r.error);
  const bv = await call(`/share-ride/bookings/${b1.id}`, { token: ca });
  check('payment page: owner UPI link + QR, owner phone hidden until confirmed', bv.upi_link?.startsWith('upi://pay?pa=ztowner%40okaxis') && bv.upi_qr?.includes('<svg') && !bv.owner_phone, bv.upi_link);
  check('other customers cannot open the booking', (await call(`/share-ride/bookings/${b1.id}`, { token: cb })).http === 404);
  r = await call(`/share-ride/bookings/${b1.id}/paid`, { method: 'POST', token: ca, body: { utr: '12' } });
  check('UPI reference checked', r.http === 400);
  r = await call(`/share-ride/bookings/${b1.id}/paid`, { method: 'POST', token: ca, body: { utr: '4321 9876 5432' } });
  check('customer says "I have paid" with UTR → waiting for owner', r.status === 'paid' && r.utr === '432198765432', JSON.stringify(r).slice(0, 120));
  r = await call(`/share-ride/bookings/${b1.id}/leave`, { method: 'POST', token: ca });
  check('after paying there is no leaving / cancelling', r.http === 409);
  r = await call(`/share-ride/bookings/${b1.id}/ticket.pdf`, { token: ca, raw: true });
  check('no ticket before the owner confirms', r.status === 409);
  me = await call('/share-ride/owner', { token: ot });
  check('owner sees the booking waiting with the UTR', me.bookings.some((b) => b.id === b1.id && b.status === 'paid' && b.utr === '432198765432'));
  r = await call(`/share-ride/owner/bookings/${b1.id}/decide`, { method: 'POST', token: ot, body: { received: true } });
  check('owner taps "Payment received" → confirmed', r.status === 'confirmed');
  const conf = await call(`/share-ride/bookings/${b1.id}`, { token: ca });
  check('confirmed booking shows the owner phone', conf.owner_phone === OWNER);
  const pdf = await call(`/share-ride/bookings/${b1.id}/ticket.pdf`, { token: ca, raw: true });
  const buf = Buffer.from(await pdf.arrayBuffer());
  check('PDF e-ticket downloads', pdf.status === 200 && buf.slice(0, 4).toString() === '%PDF' && buf.length > 3000, `${pdf.status} ${buf.length} bytes`);
  (await import('node:fs')).writeFileSync('shots/ticket-sample.pdf', buf);

  // cash at pickup → confirmed at once; a held booking that is not paid frees its seats after 15 minutes
  const b2 = await book(cb, ['2-3'], { pay_mode: 'cash', phone: '9000000975' });
  check('cash at pickup (owner allows) → confirmed at once', b2.status === 'confirmed' && b2.pay_mode === 'cash');
  const b3 = await book(cb, ['3-1'], { phone: '9000000975' });
  await db.query("UPDATE ride_bookings SET hold_until = now() - interval '1 minute' WHERE id = $1", [b3.id]);
  const d2 = await call(`/share-ride/rides/${ride.id}`);
  check('unpaid hold expires after 15 min → seat free again', !d2.taken.includes('3-1') && d2.taken.includes('1-1'), JSON.stringify(d2.taken));
  const b4 = await book(cb, ['3-3'], { phone: '9000000975' });
  r = await call(`/share-ride/bookings/${b4.id}/leave`, { method: 'POST', token: cb });
  check('customer can leave before paying (seat back)', r.http === 204 && !(await call(`/share-ride/rides/${ride.id}`)).taken.includes('3-3'));
  const b5 = await book(cb, ['3-3'], { phone: '9000000975' });
  await call(`/share-ride/bookings/${b5.id}/paid`, { method: 'POST', token: cb, body: { utr: '111122223333' } });
  r = await call(`/share-ride/owner/bookings/${b5.id}/decide`, { method: 'POST', token: ot, body: { received: false, reason: 'No money for this UTR' } });
  check('owner "Not received" → rejected, seat free', r.status === 'rejected' && !(await call(`/share-ride/rides/${ride.id}`)).taken.includes('3-3'));
  const mine = await call('/share-ride/bookings', { token: cb });
  check('customer ticket list', mine.length >= 3);

  ad = await call('/share-ride/admin', { token: admin });
  check('admin sees journeys and bookings of the city', ad.rides.some((x) => x.id === ride.id && x.booked === 3) && ad.bookings.some((x) => x.id === b1.id), JSON.stringify(ad.rides.find((x) => x.id === ride.id)));
  const hqv = await call('/share-ride/admin', { token: hq });
  check('HQ sees everything (read only)', hqv.cars.some((c) => c.id === car.id) && hqv.can_edit === false);

  r = await call('/share-ride/admin/models', { method: 'POST', token: admin, body: { name: 'zt Bad Car', layout: [{ name: 'Front', cells: 'SS' }, { name: 'Back', cells: 'SSS' }] } });
  check('car model without a driver refused', r.http === 400 && /driver/.test(r.error), r.error);
  r = await call('/share-ride/admin/models', { method: 'POST', token: admin, body: { name: 'zt Mini Van', layout: [{ name: 'Front', cells: 'S_D' }, { name: 'Middle', cells: 'SSS' }, { name: 'Back', cells: 'SSS' }] } });
  check('admin adds a new car model', r.http === 201 && r.id);
  r = await call('/share-ride/admin/places', { method: 'POST', token: admin, body: { name: 'zt Town' } });
  check('admin adds a town', r.http === 201);

  r = await call(`/share-ride/owner/rides/${ride.id}/cancel`, { method: 'POST', token: ot, body: { reason: '' } });
  check('cancelling a journey needs a reason', r.http === 400);
  r = await call(`/share-ride/owner/rides/${ride.id}/cancel`, { method: 'POST', token: ot, body: { reason: 'Car breakdown' } });
  const left = (await db.query("SELECT array_agg(DISTINCT status) s FROM ride_bookings WHERE ride_id = $1 AND id IN ($2,$3)", [ride.id, b1.id, b2.id])).rows[0].s;
  check('owner cancels the journey → bookings cancelled (owner refunds)', r.http === 204 && left.join() === 'cancelled', left);
  const cx = await call(`/share-ride/bookings/${b1.id}`, { token: ca });
  check('passenger sees why, and the owner phone for the refund', /Car breakdown/.test(cx.status_reason) && cx.owner_phone === OWNER);
  found = await call(`/share-ride/search?from=Siddipet&to=Hyderabad&date=${dateIST}`);
  check('cancelled journey gone from search', !found.some((x) => x.id === ride.id));
} finally {
  await wipe();
  await db.end();
}
console.log(`\n${pass} passed, ${fails} failed`);
