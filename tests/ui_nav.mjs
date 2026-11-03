// 🔙 Navigation in the customer app: every page with a "← …" back link — tap it, and also the phone's back button —
// must land on a DIFFERENT page and stay there (no bouncing back, no dead end). Covers every category, every
// service / shop page, care types, Share Ride, Workers, Digital, Search, Credits, an order page, the tabs.
// Logged in as user8 (sim), phone size. Screenshots of any problem in shots/nav/.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { withLocation } from './geo_browser.mjs';
const OUT = './shots/nav';
fs.mkdirSync(OUT, { recursive: true });
const B = 'http://localhost:5173';
const API = 'http://localhost:5000/api';
let pass = 0, fail = 0;
const fails = [];
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 200)}` : ''}`); if (c) pass++; else { fail++; fails.push(l); } };
const browser = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });
withLocation(browser);
const ctx = await browser.createBrowserContext();
const errors = [];
let p;
// a fresh tab for each page tested (one tab for ~200 page loads crashes Chrome); the login is shared by the context
async function fresh() {
  if (p) await p.close().catch(() => {});
  p = await ctx.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`));
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('as_welcome_seen', '1'); } catch {} });
}
await fresh();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const path = () => new URL(p.url()).pathname + new URL(p.url()).search;
const settle = async () => { await p.waitForNetworkIdle({ idleTime: 300, timeout: 8000 }).catch(() => {}); await pause(700); };
const shot = async (name) => p.screenshot({ path: `${OUT}/${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png` });

// login (customer: mobile + password)
await p.goto(`${B}/login`, { waitUntil: 'networkidle2' });
await p.type('input[autocomplete=username]', '9000300108');
await p.type('input[autocomplete=current-password]', process.env.TEST_USER_PW);
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
check('logged in as user8', new URL(p.url()).pathname === '/');

// Open a page the way a person does (from Home, so the phone's back button has somewhere to go), then:
//  1) tap "← …" → a different page, and it stays there
//  2) open it again and press the phone's back button → a different page, and it stays there
async function testPage(url, label) {
  await fresh();
  await p.goto(`${B}/`, { waitUntil: 'networkidle2' });
  await p.evaluate((u) => { window.history.pushState({}, '', u); window.dispatchEvent(new PopStateEvent('popstate')); }, url);
  await settle();
  const at = path(); // after any redirect (one-service category → its shop)
  const back = await p.$('.back-link');
  if (back) {
    const label2 = await p.evaluate((el) => el.innerText.trim(), back);
    await back.click();
    await settle();
    const after = path();
    await pause(1200);
    const stays = path();
    const ok = after !== at && stays === after;
    check(`${label}: "${label2}" → ${after}`, ok, `on ${at}, after tap ${after}, then ${stays}`);
    if (!ok) await shot(`back-${label}`);
  } else {
    check(`${label}: has a way back (back link or bottom tabs)`, !!(await p.$('.bottom-tabs a, .tabbar a, nav a[href="/"]')), at);
  }
  // phone back button
  await p.goto(`${B}/`, { waitUntil: 'networkidle2' });
  await p.evaluate((u) => { window.history.pushState({}, '', u); window.dispatchEvent(new PopStateEvent('popstate')); }, url);
  await settle();
  const at2 = path();
  await p.goBack().catch(() => {});
  await settle();
  const after2 = path();
  await pause(1200);
  const ok2 = after2 !== at2 && path() === after2;
  check(`${label}: phone back button → ${after2}`, ok2, `on ${at2}, after back ${after2}, then ${path()}`);
  if (!ok2) await shot(`phoneback-${label}`);
}

try {
  const cats = await (await fetch(`${API}/categories`)).json();
  for (const c of cats) await testPage(`/category/${c.slug}`, `category ${c.name}`);
  // every shop / care page of every category
  for (const c of cats) {
    const d = await (await fetch(`${API}/categories/${c.slug}`)).json();
    for (const s of d.services || []) {
      if (s.type_count) await testPage(`/care/${s.slug}`, `care ${s.name}`);
      else if (s.product_count > 0 || s.allows_list) await testPage(`/service/${s.slug}`, `shop ${s.name}`);
    }
  }
  const inst = await (await fetch(`${API}/instant-services`)).json();
  for (const s of inst) await testPage(`/service/${s.slug}`, `instant ${s.name}`);
  for (const [u, l] of [['/share-ride', 'Share Ride search'], ['/share-ride/tickets', 'Share Ride tickets'], ['/workers', 'Daily Workers'], ['/digital', 'Digital Services'],
    ['/search?q=water', 'Search'], ['/credits', 'Photo credits'], ['/orders', 'Orders tab'], ['/account', 'Profile tab']]) await testPage(u, l);
  // an order page and a ticket page of user8 (if any)
  const tok = (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'user8', password: process.env.TEST_USER_PW }) })).json()).token;
  const orders = await (await fetch(`${API}/orders`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  if (orders[0]) await testPage(`/orders/${orders[0].id}`, `order #${orders[0].id}`);
  check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('navigation test ran without crashing', false, e.stack);
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) console.log('FAILED:\n - ' + fails.join('\n - '));
