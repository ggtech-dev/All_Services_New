// 🚫 Out of stock per city in the browser: franchise admin (zt_admin) → My services & stock → Kirana → Products →
// search "Sugar" → Out of stock; the menu count and the top panel; the customer (phone) sees Sugar greyed out with no
// ADD; "All back in stock"; HQ's franchise page shows the same switches. Shots: shots/stock/.
import fs from 'node:fs';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import './testadmin.mjs';
import { withLocation, SIDDIPET } from './geo_browser.mjs';
const OUT = './shots/stock';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 260)}` : ''}`); c ? pass++ : fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path = all_services');
const city = (await db.query("SELECT id FROM franchises WHERE code = 'FR-0001'")).rows[0].id;
const sugar = (await db.query("SELECT p.id FROM products p JOIN services s ON s.id = p.service_id WHERE s.slug = 'food-daily-kirana-delivery' AND p.name = 'Sugar' AND p.unit = '1 kg'")).rows[0].id;
const errors = [];
const b = withLocation(await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true }), SIDDIPET);
const clickText = (p, sel, re) => p.evaluate((sel, src) => {
  const el = [...document.querySelectorAll(sel)].find((x) => new RegExp(src).test(x.innerText));
  if (el) { el.scrollIntoView({ block: 'center' }); el.click(); }
  return !!el;
}, sel, re.source);
async function staff(port, user, w = 1366, h = 900) {
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: w, height: h, isMobile: w < 700, hasTouch: w < 700 });
  p.on('pageerror', (e) => errors.push(`${port}: ${e.message}`));
  await p.goto(`http://localhost:${port}/login`, { waitUntil: 'networkidle2' });
  await p.type('input[autocomplete=username]', user);
  await p.type('input[autocomplete=current-password]', process.env.TEST_STAFF_PW);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
  return { p, ctx };
}
async function customerShop() {
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  p.on('pageerror', (e) => errors.push(`user: ${e.message}`));
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('as_welcome_seen', '1'); localStorage.setItem('as_loc_asked', '1'); localStorage.setItem('as_city', '1'); } catch {} }); // Siddipet (2 cities now)
  await p.goto('http://localhost:5173/service/food-daily-kirana-delivery', { waitUntil: 'networkidle2' });
  await p.keyboard.press('Escape');
  await p.waitForSelector('.product-card');
  await p.type('input[placeholder^="Search items"]', 'Sugar');
  await wait(500);
  const card = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.product-card')].find((x) => /\bSugar\b/.test(x.innerText) && /Madhur/i.test(x.innerText) && !/Brown|White/.test(x.innerText));
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    return { soldOut: c.classList.contains('sold-out'), badge: c.querySelector('.stock-badge')?.innerText || '', addDisabled: !!c.querySelector('.add-btn')?.disabled,
      // 📦 Sugar has 3 pack sizes: the size out of stock is struck through, the card shows a size that is in stock
      struck: [...c.querySelectorAll('.pack-sizes button.sold')].map((b) => b.innerText.trim()), shown: c.querySelector('.pack-sizes button.active')?.innerText.trim() };
  });
  await p.screenshot({ path: `${OUT}/customer-sugar.png` });
  await ctx.close();
  return card;
}

try {
  // ---------- franchise admin ----------
  const { p, ctx } = await staff(5175, 'zt_admin');
  await p.waitForSelector('a[href="/admin/my-services"]', { timeout: 10000 });
  const nav = await p.$eval('a[href="/admin/my-services"]', (a) => a.innerText.replace(/\s+/g, ' ').trim());
  check(`menu says "${nav}"`, /My services & stock/.test(nav));
  await p.click('a[href="/admin/my-services"]');
  await p.waitForSelector('.table', { timeout: 10000 });
  await p.evaluate(() => {
    const row = [...document.querySelectorAll('.table tbody tr')].find((r) => /Kirana Delivery/.test(r.innerText));
    [...row.querySelectorAll('button')].find((x) => /Products/.test(x.innerText)).click();
  });
  await p.waitForSelector('.stock-table', { timeout: 8000 });
  await wait(600);
  const rows0 = await p.$$eval('.stock-table tbody tr', (r) => r.length);
  const photos = await p.$$eval('.stock-table img.stock-thumb', (r) => r.length);
  check(`Kirana products window: ${rows0} products, ${photos} with photos, stock switches`, rows0 >= 250 && photos >= 180 && !!(await p.$('.stock-toggle.in')));
  await p.type('.modal input[type=search]', 'sugar');
  await wait(300);
  const found = await p.$$eval('.stock-table tbody tr', (r) => r.map((x) => x.innerText.split('\n')[0]));
  check(`search "sugar" → ${found.join(', ')}`, found.length >= 2 && found.length < 40 && found.some((x) => /^Sugar/.test(x)));
  await p.evaluate(() => {
    const row = [...document.querySelectorAll('.stock-table tbody tr')].find((r) => /^Sugar/.test(r.innerText.trim()) && /(^|\D)1 kg/.test(r.innerText));
    row.querySelector('.stock-toggle').click();
  });
  await p.waitForSelector('.toast', { timeout: 4000 }).catch(() => {});
  const t1 = await p.$eval('.toast', (x) => x.innerText).catch(() => '');
  await wait(600);
  const sw = await p.evaluate(() => [...document.querySelectorAll('.stock-table tbody tr')].find((r) => /^Sugar/.test(r.innerText.trim()) && /(^|\D)1 kg/.test(r.innerText))?.querySelector('.stock-toggle')?.innerText);
  check(`Sugar → "${sw}" (toast "${t1}")`, sw === 'Out of stock' && /out of stock/.test(t1));
  await clickText(p, '.modal .tabs button', /Out of stock/);
  await wait(300);
  const outRows = await p.$$eval('.stock-table tbody tr', (r) => r.map((x) => x.innerText.split('\n')[0]));
  check(`"Out of stock" tab shows only Sugar (${outRows.join(', ')})`, outRows.length === 1 && /Sugar/.test(outRows[0]));
  await p.screenshot({ path: `${OUT}/admin-products.png` });
  await p.keyboard.press('Escape');
  await clickText(p, '.modal button, button[aria-label="Close"]', /×|✕|Close/);
  await wait(800);
  const panel = await p.$eval('.stock-panel', (x) => x.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check(`top panel: "${panel.slice(0, 70)}…"`, /Out of stock in your city · 1/.test(panel) && /Sugar/.test(panel));
  await p.reload({ waitUntil: 'networkidle2' });
  await p.waitForSelector('a[href="/admin/my-services"] .nav-badge', { timeout: 8000 }).catch(() => {});
  const badge = await p.$eval('a[href="/admin/my-services"]', (a) => a.innerText.replace(/\s+/g, ' ').trim());
  check(`menu count: "${badge}"`, /1/.test(badge));
  await p.screenshot({ path: `${OUT}/admin-my-services.png` });

  // ---------- customer ----------
  const c1 = await customerShop();
  check(`customer (phone): Sugar 1 kg struck through (${c1?.struck}), card shows ${c1?.shown} which can be added`,
    c1 && c1.struck?.join() === '1 kg' && c1.shown && c1.shown !== '1 kg' && !c1.soldOut && !c1.addDisabled, JSON.stringify(c1));

  // ---------- all back in stock ----------
  await p.waitForSelector('.stock-panel');
  await clickText(p, '.stock-panel button', /All back in stock/);
  await p.waitForSelector('.confirm-text', { timeout: 4000 }).catch(() => {});
  await clickText(p, 'button.btn-primary', /Yes, all back in stock/);
  await wait(1200);
  check(`"All back in stock" → panel gone`, !(await p.$('.stock-panel')));
  const c2 = await customerShop();
  check(`customer: Sugar can be added again`, c2 && !c2.soldOut && !c2.addDisabled, JSON.stringify(c2));
  await ctx.close();

  // ---------- phone width admin ----------
  {
    const { p: pp, ctx: c } = await staff(5175, 'zt_admin', 390, 844);
    await pp.goto('http://localhost:5175/admin/my-services', { waitUntil: 'networkidle2' });
    await pp.waitForSelector('.table', { timeout: 10000 });
    await pp.evaluate(() => {
      const row = [...document.querySelectorAll('.table tbody tr')].find((r) => /Fresh Vegetables/.test(r.innerText));
      [...row.querySelectorAll('button')].find((x) => /Products/.test(x.innerText)).click();
    });
    await pp.waitForSelector('.stock-table', { timeout: 8000 });
    await wait(500);
    const wide = await pp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    check(`admin on a phone: vegetables products window fits (no sideways page)`, !wide);
    await pp.screenshot({ path: `${OUT}/admin-phone-veg.png` });
    await c.close();
  }

  // ---------- HQ ----------
  {
    const { p: hp, ctx: c } = await staff(5176, 'zt_super');
    await hp.goto(`http://localhost:5176/super/franchises/${city}`, { waitUntil: 'networkidle2' });
    await clickText(hp, 'button, [role=tab]', /Services/);
    await hp.waitForSelector('.table', { timeout: 10000 });
    await hp.evaluate(() => {
      const row = [...document.querySelectorAll('.table tbody tr')].find((r) => /Pooja Store/.test(r.innerText));
      [...row.querySelectorAll('button')].find((x) => /Products/.test(x.innerText)).click();
    });
    await hp.waitForSelector('.stock-table', { timeout: 8000 });
    await hp.waitForSelector('.stock-table tbody tr', { timeout: 8000 }).catch(() => {});
    await wait(500);
    const hasBoth = await hp.evaluate(() => ({ heads: [...document.querySelectorAll('.stock-table thead th')].map((x) => x.innerText), toggles: document.querySelectorAll('.stock-toggle').length, cells: [...document.querySelectorAll('.stock-table tbody tr td:last-child')].slice(0, 3).map((x) => x.innerText) }));
    check(`HQ franchise page → Pooja Store: "${hasBoth.heads.join(' | ')}" with ${hasBoth.toggles} stock switches`, hasBoth.heads.some((h) => /shown here/i.test(h)) && hasBoth.toggles > 5, JSON.stringify(hasBoth.cells));
    await c.close();
  }
} catch (e) {
  check('stock UI test ran without crashing', false, e.stack);
} finally {
  await db.query('UPDATE franchise_products SET in_stock = true WHERE franchise_id = $1 AND product_id = $2', [city, sugar]);
  await db.end();
  await b.close();
}
check('no page errors', !errors.length, errors.join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
