// Shared test setup, imported by every test:
//  1) temporary staff accounts (removed by cleanup.mjs): zt_admin = Siddipet (FR-0001) franchise admin,
//     zt_super = Super Admin (HQ). Password from $TEST_STAFF_PW. Real admin passwords are never used by tests.
//  2) delivering needs the delivery charge confirmed first: tests confirm it as "paid in cash" just before "delivered".
import bcrypt from 'bcryptjs';
import pg from 'pg';
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
const hash = await bcrypt.hash(process.env.TEST_STAFF_PW, 10);
await db.query(`INSERT INTO users (username, password_hash, full_name, role, franchise_id)
                VALUES ('zt_admin', $1, 'Test Admin', 'admin', (SELECT id FROM franchises WHERE code = 'FR-0001'))
                ON CONFLICT (username) DO UPDATE SET franchise_id = EXCLUDED.franchise_id, password_hash = EXCLUDED.password_hash, is_active = true`, [hash]);
await db.query(`INSERT INTO users (username, password_hash, full_name, role, franchise_id)
                VALUES ('zt_admin_ar', $1, 'Test Admin Armoor', 'admin', (SELECT id FROM franchises WHERE city = 'Armoor' ORDER BY id LIMIT 1))
                ON CONFLICT (username) DO UPDATE SET franchise_id = EXCLUDED.franchise_id, password_hash = EXCLUDED.password_hash, is_active = true`, [hash]);
await db.query(`INSERT INTO users (username, password_hash, full_name, role) VALUES ('zt_super', $1, 'Test Super Admin', 'superadmin')
                ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true`, [hash]);
await db.end();

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const m = String(url).match(/\/api\/agent\/orders\/(\d+)\/status$/);
  if (m && opts.method === 'POST' && typeof opts.body === 'string' && opts.body.includes('"delivered"')) {
    await realFetch(String(url).replace(/\/status$/, '/fee-received'), {
      method: 'POST', headers: { ...(opts.headers || {}), 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'cash' }),
    }).catch(() => {});
  }
  return realFetch(url, opts);
};
