// 📦 Pack sizes in the browser (phone): Kirana shows ONE Colgate card with 4 size buttons (small → big, "Market price");
// tapping 200 g → ADD adds "Toothpaste 200 g"; 100 g also; the cart shows both sizes; a dot marks sizes in the cart;
// a size out of stock (Siddipet) shows struck through and can't be added; Armoor never shows Ponni Rice (any size);
// laptop width fits. The stock change is undone at the end.
import pg from 'pg';
import puppeteer from 'puppeteer-core';
const B = 'http://localhost:5173';
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 220)}` : ''}`); c ? pass++ : fail++; };
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path = all_services');
const big = (await db.query("SELECT id FROM products WHERE name = 'Toothpaste' AND brand = 'Colgate' AND unit = '300 g'")).rows[0].id;
await db.query('INSERT INTO franchise_products (franchise_id, product_id, in_stock) VALUES (1, $1, false) ON CONFLICT (franchise_id, product_id) DO UPDATE SET in_stock = false', [big]);
const b = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe') });
const errs = [];
try {
  const p = await b.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('as_welcome_seen', '1'); localStorage.setItem('as_city', '1'); } catch {} });
  // log in as test customer user1 (checkout needs an account)
  await p.goto(`${B}/login`, { waitUntil: 'networkidle2' });
  await p.type('input[autocomplete=username], input[type=tel]', '9000300101');
  await p.type('input[autocomplete=current-password]', process.env.TEST_USER_PW);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (/^as_cart_/.test(k)) localStorage.removeItem(k); });
  await p.goto(`${B}/service/food-daily-kirana-delivery`, { waitUntil: 'networkidle2' });
  await p.evaluate(() => document.querySelector('[role=dialog] button[aria-label]')?.click());
  await p.type('.shop-header .search', 'colgate');
  await new Promise((r) => setTimeout(r, 500));
  const cardSel = '.product-card';
  const info = await p.evaluate(() => [...document.querySelectorAll('.product-card')].filter((c) => /Toothpaste/.test(c.innerText) && /Colgate/i.test(c.innerText))
    .map((c) => ({ sizes: [...c.querySelectorAll('.pack-sizes button')].map((x) => x.innerText.trim()), sold: [...c.querySelectorAll('.pack-sizes button.sold')].map((x) => x.innerText.trim()),
      active: c.querySelector('.pack-sizes button.active')?.innerText.trim(), price: c.querySelector('.market-price')?.innerText })));
  check(`one Colgate Toothpaste card with sizes ${JSON.stringify(info[0]?.sizes)} (shown: ${info[0]?.active}, ${info[0]?.price})`,
    info.length === 1 && info[0].sizes.join(',') === '100 g,150 g,200 g,300 g' && info[0].active === '200 g' && info[0].price === 'Market price', JSON.stringify(info));
  check(`300 g is out of stock in Siddipet → struck through (${info[0]?.sold})`, info[0]?.sold?.join() === '300 g');
  const tap = (txt) => p.evaluate((txt) => [...document.querySelector('.product-card .pack-sizes').querySelectorAll('button')].find((x) => x.innerText.trim() === txt).click(), txt);
  await tap('300 g');
  await new Promise((r) => setTimeout(r, 200));
  check('on 300 g the button says "Sold out" and is off', await p.evaluate(() => { const b = document.querySelector('.product-card .add-btn'); return b?.disabled && /Sold out/.test(b.innerText); }));
  await tap('100 g');
  await p.evaluate(() => document.querySelector('.product-card .add-btn').click());
  await tap('200 g');
  await p.evaluate(() => document.querySelector('.product-card .add-btn').click());
  await p.evaluate(() => document.querySelector('.product-card .stepper button:last-child').click()); // 200 g × 2
  await new Promise((r) => setTimeout(r, 300));
  const dots = await p.evaluate(() => [...document.querySelectorAll('.product-card .pack-sizes button')].filter((x) => x.querySelector('.pack-in-cart')).map((x) => x.innerText.trim()));
  check(`sizes in the cart are marked: ${dots.join(', ')}`, dots.join(',') === '100 g,200 g');
  await p.screenshot({ path: 'shots/packs-card.png' });
  const cart = await p.evaluate(() => { const k = Object.keys(localStorage).find((x) => /^as_cart_/.test(x)); return k ? JSON.parse(localStorage.getItem(k)) : null; });
  const lines = (cart || []).filter((i) => /Toothpaste/.test(i.name)).map((i) => `${i.unit}×${i.qty}`);
  check(`cart: ${lines.join(', ')}`, lines.sort().join(',') === '100 g×1,200 g×2', JSON.stringify(cart).slice(0, 200));
  // checkout page shows each size as its own line
  await p.goto(`${B}/checkout`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));
  const co = await p.evaluate(() => document.body.innerText);
  await p.screenshot({ path: 'shots/packs-checkout.png', fullPage: true });
  check('checkout lists "Toothpaste" with 100 g and 200 g', /100 g/.test(co) && /200 g/.test(co) && /Toothpaste/.test(co), co.slice(0, 300));
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (/^as_cart_/.test(k)) localStorage.removeItem(k); });
  // laptop fits
  await p.setViewport({ width: 1366, height: 800 });
  await p.goto(`${B}/service/food-daily-kirana-delivery`, { waitUntil: 'networkidle2' });
  check('laptop: page fits the screen', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  // Armoor: Ponni Rice hidden in every size
  const a = await (await b.createBrowserContext()).newPage();
  await a.evaluateOnNewDocument(() => { try { localStorage.setItem('as_welcome_seen', '1'); localStorage.setItem('as_city', '61'); } catch {} });
  await a.goto(`${B}/service/food-daily-kirana-delivery`, { waitUntil: 'networkidle2' });
  check('Armoor: no Ponni Rice in any size', await a.evaluate(() => !/Ponni Rice/.test(document.body.innerText)));
  check('no page errors', !errs.length, errs.join(' | '));
} finally {
  await b.close();
  await db.query('UPDATE franchise_products SET in_stock = true WHERE franchise_id = 1 AND product_id = $1', [big]);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
