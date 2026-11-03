// Test logins since phone-first login (2026-10-17): there is no email sign-up any more, and agents added by the admin
// get the username a<phone> with no password. Tests make zt_ customers directly and give their zt_ agents a
// username + password (password from $TEST_STAFF_PW). cleanup.mjs removes all of them.
import bcrypt from 'bcryptjs';
import pg from 'pg';

const hash = await bcrypt.hash(process.env.TEST_STAFF_PW, 10);
const run = async (sql, args) => {
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  await db.query('SET search_path=all_services');
  try {
    return await db.query(sql, args);
  } finally {
    await db.end();
  }
};

export const makeCustomer = (username, fullName, phone = null) => run(
  `INSERT INTO users (username, password_hash, full_name, role, phone) VALUES ($1, $2, $3, 'customer', $4)
   ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`, [username, hash, fullName, phone]);

// after POST /admin/agents: the agent with this phone gets the test username + password
export const agentLogin = (username, phone) => run(
  `UPDATE users SET username = $1, password_hash = $2, has_password = true WHERE phone = $3 AND role = 'agent' AND username LIKE 'a%'`,
  [username, hash, phone]);
