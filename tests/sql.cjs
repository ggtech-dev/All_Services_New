// node sql.cjs "SELECT …"  → rows as a table (local DB, all_services schema)
const pg = require('pg');
const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, options: '-c search_path=all_services' });
c.connect().then(() => c.query(process.argv[2])).then((r) => console.table(r.rows)).catch((e) => console.log('ERR', e.message)).finally(() => c.end());
