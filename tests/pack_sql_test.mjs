// 📦 pack-size SQL rules inside a transaction that is rolled back: photo sync across sizes; adding a size twice is
// refused; deleting the linked size keeps the others linked.
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await c.connect();
await c.query('SET search_path = all_services');
let pass = 0, fail = 0;
const check = (l, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${!ok && x ? ` — ${x}` : ''}`); ok ? pass++ : fail++; };
await c.query('BEGIN');
try {
  const g = (await c.query("SELECT id FROM products WHERE name = 'Toothpaste' AND brand = 'Colgate' AND pack_group = id")).rows[0].id;
  await c.query("UPDATE products SET image_url = '/zt/test.jpg' WHERE pack_group = $1 AND unit = '100 g'", [g]);
  const imgs = (await c.query('SELECT DISTINCT image_url FROM products WHERE pack_group = $1 OR id = $1', [g])).rows.map((r) => r.image_url);
  check(`new photo on one size → all 4 sizes have it (${imgs.join()})`, imgs.length === 1 && imgs[0] === '/zt/test.jpg');
  await c.query('SAVEPOINT s');
  const dup = await c.query("SELECT fn_add_pack_size($1, '200 G')", [g]).catch((e) => e);
  check(`adding "200 G" again is refused: ${dup.message}`, /already has the size/.test(dup.message || ''));
  await c.query('ROLLBACK TO SAVEPOINT s');
  const added = (await c.query("SELECT * FROM fn_add_pack_size($1, '500 g')", [g])).rows[0];
  check(`HQ adds 500 g → new size linked (${added.unit}, price ${added.price}, group ${added.pack_group === g})`, added.pack_group === g && Number(added.price) === 0);
  await c.query('DELETE FROM order_items WHERE product_id = $1', [g]).catch(() => {});
  await c.query('DELETE FROM franchise_products WHERE product_id = $1', [g]);
  await c.query('DELETE FROM products WHERE id = $1', [g]);
  const left = (await c.query("SELECT DISTINCT pack_group FROM products WHERE name = 'Toothpaste' AND brand = 'Colgate'")).rows;
  check(`deleting the linked size keeps the other ${''}sizes on one card (${left.length} group)`, left.length === 1 && left[0].pack_group);
} catch (e) {
  check('ran without error', false, e.message);
} finally {
  await c.query('ROLLBACK');
  await c.end();
}
console.log(`\n${pass} passed, ${fail} failed (all changes rolled back)`);
