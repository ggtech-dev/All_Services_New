// 🏙️ Armoor franchise on this PC (local data, like a real 2nd city): HQ creates it with its admin login, centre + 25 km
// range, areas & villages, activates it; HQ then switches some products and two services off ONLY for Armoor.
// The admin password is generated here and printed once (not saved anywhere).
import crypto from 'node:crypto';
import pg from 'pg';
import './testadmin.mjs';
const API = 'http://localhost:5000/api';
const call = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(API + path, { method, headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { s: r.status, d: r.status === 204 ? null : await r.json().catch(() => null) };
};
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path = all_services');
if ((await db.query("SELECT 1 FROM franchises WHERE city = 'Armoor'")).rowCount) { console.log('Armoor already exists'); process.exit(0); }
const hq = (await call('/auth/login', { method: 'POST', body: { username: 'zt_super', password: process.env.TEST_STAFF_PW, portal: 'super' } })).d.token;
const password = `Armoor@${crypto.randomInt(1000, 9999)}${crypto.randomBytes(2).toString('hex')}`;
const r = await call('/super/franchises', { method: 'POST', token: hq, body: {
  name: 'All Services Armoor', owner_name: 'Ravi Kumar', phone: '9000304400', email: '', address: 'Main Road, near Bus Stand, Armoor',
  city: 'Armoor', state: 'Telangana', pincode: '503224',
  center_lat: 18.7905, center_lng: 78.287, radius_km: 25, village_fee_near: 120, village_fee_far: 180,
  admin_username: 'armoor_admin', admin_password: password, admin_name: 'Suresh (Armoor Admin)', admin_phone: '9000304401',
  areas: [
    { name: 'Armoor Bus Stand', pincode: '503224', lat: 18.7905, lng: 78.287 },
    { name: 'Armoor Main Road', pincode: '503224', lat: 18.788, lng: 78.2895 },
    { name: 'Mamidipally', pincode: '503224', lat: 18.7975, lng: 78.2805 },
    { name: 'Gandhi Nagar, Armoor', pincode: '503224', lat: 18.7932, lng: 78.2921 },
    { name: 'Perkit', lat: 18.78, lng: 78.33, is_village: true, village_band: 1 },
    { name: 'Alur', lat: 18.748, lng: 78.244, is_village: true, village_band: 1 },
  ] } });
if (r.s !== 201) { console.log('create failed', r.s, r.d); process.exit(1); }
const fid = r.d.id;
const act = await call(`/super/franchises/${fid}/status`, { method: 'PATCH', token: hq, body: { status: 'active' } });
console.log(`Armoor franchise #${fid} (${r.d.code}) created, activated: ${act.s}`);

// HQ switches some products off only for Armoor (not sold there)
const off = [
  ['food-daily-kirana-delivery', ['Ponni Rice', 'Black Rice', 'Sticky Rice', 'Nandini Pure Ghee', 'Disano Oats', 'Gold Winner Sunflower Oil', 'Heinz Tomato Ketchup']],
  ['food-daily-fruit-delivery', ['Kiwi', 'Avocado', 'Passion Fruit', 'Longan']],
  ['food-daily-bread-bakery-delivery', ['Photo Cake', 'Red Velvet Cake']],
];
for (const [svc, names] of off) {
  const { rows } = await db.query('SELECT p.id, p.name FROM products p JOIN services s ON s.id = p.service_id WHERE s.slug = $1 AND p.name = ANY($2)', [svc, names]);
  for (const p of rows) {
    const x = await call(`/super/franchises/${fid}/products/${p.id}`, { method: 'PATCH', token: hq, body: { enabled: false } });
    console.log(`  product off in Armoor: ${p.name} (${x.s})`);
  }
}
// …and two whole services
for (const slug of ['food-daily-monthly-grocery-subscription', 'food-daily-pet-food-delivery']) {
  const s = (await db.query('SELECT id, name FROM services WHERE slug = $1', [slug])).rows[0];
  const x = await call(`/super/franchises/${fid}/services/${s.id}`, { method: 'PATCH', token: hq, body: { enabled: false } });
  console.log(`  service off in Armoor: ${s.name} (${x.s})`);
}
console.log(`\nLOGIN  username: armoor_admin   password: ${password}`);
await db.end();
