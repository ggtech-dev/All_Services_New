// Guest browsing: open the customer app without an account, browse, add to cart, then sign in at checkout and land
// back on checkout with the same cart. Protected pages ask to sign in. Uses a zt_ test customer only.
import puppeteer from 'puppeteer-core';
import './testadmin.mjs';
import { withLocation } from './geo_browser.mjs';
const U = process.env.APP_URL || 'http://localhost:5000';
let pass = 0, fails = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? ` — ${String(x).slice(0, 150)}` : ''}`); c ? pass++ : fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const API = 'http://localhost:5000/api';
const call = async (p, o = {}) => { const h = { 'Content-Type': 'application/json' }; const r = await fetch(API + p, { method: o.method || 'GET', headers: h, body: o.body && JSON.stringify(o.body) }); return r.json().catch(() => ({})); };
{
  const pg = (await import('pg')).default;
  const bcrypt = (await import('bcryptjs')).default;
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  await c.query('SET search_path=all_services');
  await c.query(`INSERT INTO users (username, password_hash, full_name, role, phone) VALUES ('zt_guest_cust', $1, 'Guest Then Customer', 'customer', '9000000991')
                  ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`, [await bcrypt.hash(process.env.TEST_STAFF_PW, 10)]);
  await c.end();
}

const browser = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });

withLocation(browser); // 📍 a phone in Siddipet with location allowed
const errors = [];
try {
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport({ width: 400, height: 860 });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.dismiss());
  await p.goto(`${U}/`, { waitUntil: 'networkidle2' });
  // first visit: the welcome screen, then "Explore first" as a guest
  await p.waitForSelector('.welcome');
  check('first visit shows the welcome screen (Get Started / Login / Explore first)', (await p.evaluate(() => document.body.innerText)).includes('Get Started'));
  await p.click('.welcome-explore');
  await p.waitForSelector('.navbar');
  await p.waitForSelector('a[href^="/category/"]');
  check('guest opens the app: home page, not the login page', new URL(p.url()).pathname === '/' && (await p.$('.cat-card, .category-card, .categories, a[href^="/category/"]')) !== null);
  check('top bar shows "Log in" and the cart, no logout', !!(await p.$('.nav-login')) && !!(await p.$('.cart-link')) && !(await p.evaluate(() => document.body.innerText.includes('Logout'))));
  await p.screenshot({ path: 'shots/guest-home.png' });
  await p.goto(`${U}/category/food-daily`, { waitUntil: 'networkidle2' });
  check('guest opens a category', (await p.evaluate(() => document.body.innerText)).includes('Fruit Delivery'));
  await p.goto(`${U}/service/food-daily-fruit-delivery`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('.add-btn');
  await p.click('.add-btn');
  await p.waitForSelector('.cart-bar');
  const itemName = await p.$eval('.product-card h3', (h) => h.textContent);
  check('guest adds to cart', (await p.$eval('.cart-count', (c) => c.textContent)) === '1');
  await p.reload({ waitUntil: 'networkidle2' });
  check('guest cart survives a reload', (await p.$eval('.cart-count', (c) => c.textContent).catch(() => '0')) === '1');
  await p.click('.cart-bar');
  await p.waitForFunction(() => location.pathname === '/login');
  check('checkout asks the guest to sign in', true);
  check('login page offers "Continue as guest"', !!(await p.$('.guest-link')));
  await p.screenshot({ path: 'shots/guest-login.png' });
  await clickTab(p, 'Password');
  await p.type('input[autocomplete=username]', 'zt_guest_cust');
  await p.type('input[autocomplete=current-password]', process.env.TEST_STAFF_PW);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
  await p.waitForFunction(() => location.pathname === '/checkout', { timeout: 15000 }).catch(() => {});
  check('after signing in: back on checkout', new URL(p.url()).pathname === '/checkout', p.url());
  await p.waitForSelector('.summary-lines li', { timeout: 10000 }).catch(() => {});
  const summary = await p.evaluate(() => document.querySelector('.summary-lines')?.innerText || '');
  check('the guest cart moved into the account', summary.includes(itemName.trim()), summary.slice(0, 80));
  check('top bar now shows the account', !!(await p.$('button[aria-label="Logout"]')) && !(await p.$('.nav-login')));

  // a fresh guest: protected pages ask to sign in; "Continue as guest" goes home
  const g = await (await browser.createBrowserContext()).newPage();
  await g.evaluateOnNewDocument(() => localStorage.setItem('as_welcome_seen', '1'));
  await g.setViewport({ width: 1280, height: 800 });
  g.on('pageerror', (e) => errors.push(e.message));
  for (const path of ['/orders', '/account', '/orders/1162']) {
    await g.goto(U + path, { waitUntil: 'networkidle2' });
    check(`guest opening ${path} is asked to sign in`, new URL(g.url()).pathname === '/login');
  }
  await g.click('.guest-link');
  await g.waitForFunction(() => location.pathname === '/');
  check('"Continue as guest" opens the home page', true);
  check('desktop: no sideways scroll for guests', await g.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
} finally {
  await browser.close();
}
check('no page errors', !errors.length, errors.join(' | '));
console.log(`\n${pass} passed, ${fails} failed`);

// customer Sign in opens on the password form now (no tabs): just wait for it
async function clickTab(p) {
  await p.waitForSelector('input[autocomplete=username]');
}
