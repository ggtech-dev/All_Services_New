// Removes ONLY test data: users whose username starts with zt_ (and phone-login test accounts m90000000xx),
// orders placed by them, franchises named "zt …", OTPs of test numbers, test promotions.
// Never touches a real customer's order: if a test agent touched one, it is reported and that agent is kept.
import pg from 'pg';
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
await db.query('BEGIN');
try {
  const TEST_USERS = `SELECT id FROM users WHERE username LIKE 'zt\\_%' OR username LIKE 'm90000000%' OR username LIKE 'a90000000%'`;
  const touched = (await db.query(
    `SELECT o.id, o.agent_id FROM orders o WHERE o.agent_id IN (${TEST_USERS}) AND o.customer_id NOT IN (${TEST_USERS})`)).rows;
  if (touched.length) console.warn(`⚠️  test agents touched REAL orders: ${touched.map((o) => '#' + o.id).join(', ')} — those agents are kept`);
  const keep = touched.map((o) => o.agent_id);

  // test franchises: their orders, areas and admins go first
  const zf = `SELECT id FROM franchises WHERE name LIKE 'zt %'`;
  const o1 = await db.query(`DELETE FROM orders WHERE customer_id IN (${TEST_USERS}) OR franchise_id IN (${zf})`);
  await db.query(`DELETE FROM users WHERE franchise_id IN (${zf}) AND username LIKE 'zt\\_%'`);
  const agentsInZf = await db.query(`DELETE FROM users WHERE id IN (SELECT user_id FROM agents WHERE franchise_id IN (${zf})) AND username LIKE 'zt\\_%'`);
  await db.query(`DELETE FROM localities WHERE franchise_id IN (${zf})`);
  const f = await db.query(`DELETE FROM franchises WHERE id IN (${zf})`);
  const u = await db.query(`DELETE FROM users WHERE id IN (${TEST_USERS}) AND NOT (id = ANY($1::int[]))`, [keep]);
  await db.query(`DELETE FROM phone_otps WHERE phone LIKE '90000000%'`);
  await db.query(`DELETE FROM promotions WHERE name LIKE 'zt %'`);
  await db.query(`DELETE FROM shops WHERE name LIKE 'zt %'`);
  await db.query('COMMIT');
  console.log(`cleanup: ${o1.rowCount} orders, ${u.rowCount + agentsInZf.rowCount} users, ${f.rowCount} franchises removed`);
} catch (e) {
  await db.query('ROLLBACK');
  console.error('cleanup failed (nothing removed):', e.message);
  process.exitCode = 1;
}
await db.end();

// test documents: the tests upload a 29-byte fake PNG; real documents are never that small
{
  const fs = await import('node:fs');
  const dir = '../server/private_uploads';
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    const p = `${dir}/${f}`;
    const st = fs.statSync(p);
    if (st.isFile() && st.size === 29) { fs.unlinkSync(p); n++; }
  }
  if (n) console.log(`cleanup: ${n} test document files removed`);
}
