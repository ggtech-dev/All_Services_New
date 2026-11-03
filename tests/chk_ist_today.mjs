// "Today" must be India's day even when the database runs on UTC (like the cloud server). Rolled back.
import pg from 'pg';
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect(); await db.query('SET search_path=all_services'); await db.query("SET TimeZone = 'UTC'"); await db.query('BEGIN');
const ok = (n, c, x = '') => console.log(c ? 'PASS' : 'FAIL', n, x);
const nowIST = (await db.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata') t")).rows[0].t;
const a = (await db.query("SELECT u.id FROM users u JOIN agents ag ON ag.user_id = u.id WHERE u.username = 'agent1'")).rows[0].id;
const o = (await db.query("SELECT id, franchise_id FROM orders WHERE agent_id = $1 AND status = 'delivered' LIMIT 1", [a])).rows[0];
const before = (await db.query('SELECT fn_agent_stats($1) s, fn_order_stats($2) f', [a, o.franchise_id])).rows[0];
// delivered at 1:00 AM India time today (= 7:30 PM UTC yesterday)
await db.query("UPDATE orders SET delivered_at = (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 hour') AT TIME ZONE 'Asia/Kolkata' WHERE id = $1", [o.id]);
await db.query("UPDATE agent_wallet SET created_at = (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 hour') AT TIME ZONE 'Asia/Kolkata' WHERE order_id = $1", [o.id]);
const after = (await db.query('SELECT fn_agent_stats($1) s, fn_order_stats($2) f, (SELECT today_deliveries FROM v_agents WHERE user_id = $1) v', [a, o.franchise_id])).rows[0];
console.log('India time now:', nowIST.toISOString().slice(0, 16), '· DB session: UTC');
ok('agent app: 1 AM delivery still counts as today', after.s.today_deliveries === before.s.today_deliveries, `${before.s.today_deliveries} → ${after.s.today_deliveries}`);
ok('agent app: its ₹25 still in today\'s earnings', Number(after.s.today_earnings) === Number(before.s.today_earnings), `${before.s.today_earnings} → ${after.s.today_earnings}`);
ok('admin dashboard: delivered today unchanged', after.f.delivered_today === before.f.delivered_today, `${before.f.delivered_today} → ${after.f.delivered_today}`);
ok('admin agents list: today deliveries', Number(after.v) === before.s.today_deliveries);
const last = after.s.last7[after.s.last7.length - 1];
ok('agent 7-day chart: today\'s bar is India\'s date and has it', last.day === nowIST.toISOString().slice(0, 10) && last.deliveries === after.s.today_deliveries, JSON.stringify(last));
await db.query('ROLLBACK'); await db.end();
