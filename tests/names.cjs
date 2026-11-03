// Realistic Telangana names for the zt_lt_ test people (screenshots only; cleanup.mjs removes them by username)
const pg = require('pg');
const first = ['Ravi','Lakshmi','Srinivas','Anitha','Mahesh','Swathi','Venkatesh','Padma','Ramesh','Kavitha','Suresh','Sravani','Naresh','Divya','Raju','Madhavi','Prakash','Sunitha','Kiran','Haritha','Vamshi','Shirisha','Anil','Bhavani','Rajesh','Manasa','Srikanth','Rekha','Praveen','Sandhya','Harish','Jyothi','Naveen','Pavani','Sai','Keerthi','Ashok','Usha','Vinod','Renuka'];
const last = ['Reddy','Goud','Rao','Yadav','Kumar','Chary','Naidu','Varma','Achary','Mudiraj','Patel','Sharma'];
(async () => {
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, options: '-c search_path=all_services' });
  await c.connect();
  const rows = (await c.query("SELECT id FROM users WHERE username LIKE 'zt\_lt\_%' ORDER BY id")).rows;
  let i = 0;
  for (const r of rows) { const n = `${first[i % first.length]} ${last[Math.floor(i / first.length) % last.length]}`; await c.query('UPDATE users SET full_name = $1 WHERE id = $2', [n, r.id]); i++; }
  await c.query("UPDATE orders o SET contact_name = u.full_name FROM users u WHERE u.id = o.customer_id AND u.username LIKE 'zt\_lt\_%'");
  console.log('renamed', rows.length);
  await c.end();
})();
