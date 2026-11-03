// ⏳ Honest waiting on the customer's order page (phone: Android Pixel + iPhone, English + Telugu):
//  1) every Siddipet delivery partner offline → "😔 No delivery partner is online right now"
//  2) every online delivery partner busy with another order → "⏳ All our delivery partners are busy right now", place in line
// Partners' online/offline and test orders are put back afterwards (test orders belong to zt_wait → cleanup.mjs).
import fs from 'node:fs';
import pg from 'pg';
import puppeteer, { KnownDevices } from 'puppeteer-core';
import './testadmin.mjs';
import { makeCustomer } from './test_helpers.mjs';
import { withLocation } from './geo_browser.mjs';
const OUT = './shots/wait';
fs.mkdirSync(OUT, { recursive: true });
const U = 'http://localhost:5173', API = 'http://localhost:5000/api';
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: '-c search_path=all_services' });
let pass = 0, fails = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x !== '' && !c ? ` — ${String(x).slice(0, 200)}` : ''}`); c ? pass++ : fails++; };
const PHONE = '9000000981';
await makeCustomer('zt_wait', 'Zt Wait Customer', PHONE);
const call = async (p, { method = 'GET', body, token } = {}) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-Franchise': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
  return r.status === 204 ? {} : r.json();
};
const token = (await call('/auth/login', { method: 'POST', body: { username: 'zt_wait', password: process.env.TEST_STAFF_PW, portal: 'user' } })).token;
const loc = (await call('/localities')).find((l) => !l.is_village);
const kir = (await call('/services/food-daily-kirana-delivery')).products.filter((p) => p.in_stock);
const place = async (k) => (await call('/orders', { method: 'POST', token, body: {
  contact: { name: 'Zt Wait Customer', phone: PHONE, address_line: 'zt H.No 9, Test Street', locality_id: loc.id, lat: Number(loc.lat), lng: Number(loc.lng) },
  slot: 'As soon as possible', items: [{ product_id: kir[k].id, qty: 1 }] } })).id;

const online = (await db.query("SELECT user_id FROM agents WHERE franchise_id = 1 AND 'delivery' = ANY (skills) AND is_online AND status = 'active'")).rows.map((r) => r.user_id);
const b = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe') });
withLocation(b);
async function shoot(id, name, expectText) {
  for (const [dev, d] of [['android', KnownDevices['Pixel 7'] || KnownDevices['Pixel 5']], ['iphone', KnownDevices['iPhone 13'] || KnownDevices['iPhone 12']]]) {
    for (const lang of ['en', 'te']) {
      const ctx = await b.createBrowserContext();
      const p = await ctx.newPage();
      await p.emulate(d);
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      await p.evaluateOnNewDocument((t, lang) => { try { localStorage.setItem('as_welcome_seen', '1'); localStorage.setItem('as_city', '1'); localStorage.setItem('as_lang', lang); } catch {} }, token, lang);
      await p.goto(`${U}/login`, { waitUntil: 'networkidle2' });
      await p.type('input[autocomplete=username], input[type=tel]', PHONE);
      await p.type('input[autocomplete=current-password]', process.env.TEST_STAFF_PW);
      await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
      await p.goto(`${U}/orders/${id}`, { waitUntil: 'networkidle2' });
      await p.waitForSelector('.wait-note', { timeout: 8000 }).catch(() => {});
      const r = await p.evaluate(() => { const n = document.querySelector('.wait-note'); return n && { text: n.innerText.replace(/\s+/g, ' '), w: n.getBoundingClientRect().width,
        right: n.getBoundingClientRect().right, vw: innerWidth, wide: document.documentElement.scrollWidth > innerWidth + 1 }; });
      await p.screenshot({ path: `${OUT}/${name}-${dev}-${lang}.png` });
      const want = lang === 'en' ? expectText.en : expectText.te;
      check(`${name} · ${dev} · ${lang === 'en' ? 'English' : 'Telugu'}: "${r?.text.slice(0, 90)}…"`, r && want.test(r.text) && !r.wide && r.right <= r.vw && !errs.length, JSON.stringify(r) + errs.join(' '));
      await ctx.close();
    }
  }
}
try {
  // 1) nobody online
  await db.query('UPDATE agents SET is_online = false WHERE user_id = ANY ($1)', [online]);
  const o1 = await place(0);
  await shoot(o1, 'none', { en: /No delivery partner is online right now/, te: /ఏ డెలివరీ భాగస్వామి ఆన్‌లైన్‌లో లేరు/ });
  await db.query('UPDATE agents SET is_online = true WHERE user_id = ANY ($1)', [online]);
  // 2) everyone busy: each online partner gets one of our orders, then one more order waits
  const held = [];
  for (const a of online) { const id = await place(held.length + 1); held.push(id); await db.query("UPDATE orders SET status = 'assigned', agent_id = $2, assigned_at = now() WHERE id = $1", [id, a]); }
  const o2 = await place(5);
  await shoot(o2, 'busy', { en: /All our delivery partners are busy right now.*online, all finishing other orders.*line/, te: /బిజీగా ఉన్నారు.*ఆన్‌లైన్‌లో ఉన్నారు.*(లైన్‌లో)/ });
  console.log(`(${online.length} delivery partners online in Siddipet during the test)`);
} finally {
  await db.query('UPDATE agents SET is_online = true WHERE user_id = ANY ($1)', [online]);
  await db.query("UPDATE orders SET status = 'cancelled', cancel_reason = 'zt test' WHERE customer_id = (SELECT id FROM users WHERE username = 'zt_wait') AND status <> 'cancelled'");
  await b.close(); await db.end();
}
console.log(`\n${pass} passed, ${fails} failed`);
