// Removes ONLY the simulation data: accounts with phone 90003001xx (user1–user20) and 90003002xx (agent1–agent10),
// their orders, ratings, ride bookings, cars, journeys, subscriptions, digital requests, OTPs and document files.
// LOCAL database only. Run:  node sim_reset.mjs
import fs from 'node:fs';
import pg from 'pg';
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
const SIM = `SELECT id FROM users WHERE phone ~ '^90003(001|002)\\d\\d$'`;
const files = (await db.query(
  `SELECT unnest(ARRAY[a.aadhaar_doc, a.pan_doc, a.dl_doc, a.photo_doc]) f FROM agents a WHERE a.user_id IN (${SIM})
   UNION ALL SELECT unnest(ARRAY[c.rc_doc, c.permit_doc, c.insurance_doc, c.car_photo]) FROM shared_cars c WHERE c.owner_id IN (${SIM})`)).rows
  .map((r) => r.f).filter(Boolean);
await db.query('BEGIN');
try {
  // never touch someone else's order: sim agents only ever work on sim customers' orders
  const foreign = (await db.query(`SELECT id FROM orders WHERE agent_id IN (${SIM}) AND customer_id NOT IN (${SIM})`)).rows;
  if (foreign.length) throw new Error(`sim agents touched other orders: ${foreign.map((o) => '#' + o.id).join(', ')} — nothing removed`);
  const rb = await db.query(`DELETE FROM ride_bookings WHERE customer_id IN (${SIM}) OR ride_id IN (SELECT id FROM share_rides WHERE owner_id IN (${SIM}))`);
  await db.query(`DELETE FROM share_rides WHERE owner_id IN (${SIM})`);
  await db.query(`DELETE FROM shared_cars WHERE owner_id IN (${SIM})`);
  await db.query(`DELETE FROM digital_requests WHERE customer_id IN (${SIM})`);
  await db.query(`DELETE FROM worker_reports WHERE customer_id IN (${SIM})`);
  const o = await db.query(`DELETE FROM orders WHERE customer_id IN (${SIM})`);
  const u = await db.query(`DELETE FROM users WHERE id IN (${SIM})`);
  await db.query(`DELETE FROM phone_otps WHERE phone ~ '^90003(001|002)\\d\\d$'`);
  await db.query('COMMIT');
  let n = 0;
  for (const f of files) { try { fs.unlinkSync(`../server/private_uploads/${f}`); n++; } catch {} }
  console.log(`sim reset: ${u.rowCount} accounts, ${o.rowCount} orders, ${rb.rowCount} ride bookings, ${n} document files removed`);
} catch (e) {
  await db.query('ROLLBACK');
  console.error('sim reset failed (nothing removed):', e.message);
  process.exitCode = 1;
}
await db.end();
