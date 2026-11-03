// 📸 Screenshots for the franchise presentation (LOCAL, built apps on 5000–5003, today's test activity):
// customer phone (EN + TE), partner phone, franchise admin + HQ laptop. → shots/deck/<name>.png
// Live state made first: 4 orders waiting (partner list), 1 order on the way (tracking). All zt_ data (cleanup.mjs).
import fs from 'node:fs';
import pg from 'pg';
import puppeteer, { KnownDevices } from 'puppeteer-core';
import './testadmin.mjs';
import { withLocation } from './geo_browser.mjs';
const OUT = './shots/deck';
fs.mkdirSync(OUT, { recursive: true });
const API = 'http://localhost:5000/api', U = 'http://localhost:5000', AG = 'http://localhost:5001', AD = 'http://localhost:5002', HQ = 'http://localhost:5003';
const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: '-c search_path=all_services' });
const call = async (p, { method = 'GET', body, token, city = 1 } = {}) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-Franchise': String(city), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
  return r.status === 204 ? {} : r.json();
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (phone) => (await call('/auth/login', { method: 'POST', body: { username: phone, password: process.env.TEST_USER_PW, portal: 'user' } })).token;
const agentToken = async (phone) => {
  await db.query('DELETE FROM phone_otps WHERE phone = $1', [phone]);
  const r = await call('/auth/phone/request', { method: 'POST', body: { phone } });
  return (await call('/auth/phone/verify', { method: 'POST', body: { phone, code: r.devCode, portal: 'agent' } })).token;
};

await db.query("UPDATE users SET full_name = 'Siddipet Admin' WHERE username = 'zt_admin'");
await db.query("UPDATE users SET full_name = 'HQ Admin' WHERE username = 'zt_super'");
// ---------- live state ----------
const locs = (await call('/localities')).filter((l) => !l.is_village && l.franchise_id === 1);
const kir = (await call('/services/food-daily-kirana-delivery')).products.filter((p) => p.in_stock);
const veg = (await call('/services/food-daily-fresh-vegetables')).products.filter((p) => p.in_stock);
const place = async (phone, items, k) => {
  const t = await login(phone);
  const me = (await db.query('SELECT full_name FROM users WHERE phone = $1', [phone])).rows[0].full_name;
  const l = locs[k % locs.length];
  return (await call('/orders', { method: 'POST', token: t, body: { contact: { name: me, phone, address_line: `H.No ${3 + k}-${12 + k}, Main Road`, landmark: 'Near Hanuman temple', locality_id: l.id, lat: Number(l.lat), lng: Number(l.lng) }, slot: 'As soon as possible', items } })).id;
};
for (let k = 2; k <= 5; k++) await place(`71000000${String(k).padStart(2, '0')}`, [{ product_id: veg[k].id, qty: 1 }, { product_id: veg[k + 4].id, qty: 1 }], k);
const ravi = '7100000001';
const onWay = await place(ravi, [{ product_id: kir[3].id, qty: 1 }, { product_id: kir[8].id, qty: 2 }, { product_id: veg[1].id, qty: 1 }], 0);
const mahesh = await agentToken('8100000002');
await call(`/agent/orders/${onWay}/accept`, { method: 'POST', token: mahesh });
await call(`/agent/orders/${onWay}/status`, { method: 'POST', token: mahesh, body: { status: 'picked_up' } });
const l0 = locs[0];
await call('/agent/location', { method: 'POST', token: mahesh, body: { lat: Number(l0.lat) + 0.004, lng: Number(l0.lng) - 0.003, accuracy: 12 } });
console.log('live state ready: 4 waiting, #' + onWay + ' on the way');

// ---------- browser ----------
const b = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe') });
withLocation(b);
const PHONE = { viewport: { width: 412, height: 892, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true }, userAgent: (KnownDevices['Pixel 7'] || KnownDevices['Pixel 5']).userAgent };
const LAPTOP = { viewport: { width: 1440, height: 900, deviceScaleFactor: 1.5 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' };
async function open(dev, lang = 'en') {
  const ctx = await b.createBrowserContext();
  for (const o of [U, AG, AD, HQ]) await ctx.overridePermissions(o, ['geolocation', 'notifications']); // like a phone after tapping Allow
  const p = await ctx.newPage();
  await p.emulate(dev);
  await p.evaluateOnNewDocument((lang) => { try { localStorage.setItem('as_welcome_seen', '1'); localStorage.setItem('as_city', '1'); localStorage.setItem('as_lang', lang); localStorage.setItem('as_install_dismissed', String(Date.now())); } catch {} }, lang);
  return p;
}
async function pwLogin(p, base, user, pw) {
  await p.goto(`${base}/login`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('input[autocomplete=username], input[type=tel]');
  await p.type('input[autocomplete=username], input[type=tel]', user);
  await p.type('input[autocomplete=current-password]', pw);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
}
async function shot(p, url, name, { scroll = 0, settle = 1500, clip } = {}) {
  if (url) await p.goto(url, { waitUntil: 'networkidle2' }).catch(() => {});
  await wait(settle);
  if (scroll) { await p.evaluate((y) => window.scrollTo(0, y), scroll); await wait(700); }
  await p.screenshot({ path: `${OUT}/${name}.png`, ...(clip ? { clip } : {}) });
  console.log('shot', name);
}

try {
  // customer, English
  const c = await open(PHONE);
  await pwLogin(c, U, ravi, process.env.TEST_USER_PW);
  await shot(c, `${U}/`, 'c-home');
  await shot(c, null, 'c-home-2', { scroll: 760, settle: 300 });
  await shot(c, `${U}/category/food-daily`, 'c-food-daily');
  await shot(c, `${U}/service/food-daily-kirana-delivery`, 'c-kirana', { scroll: 520 });
  await shot(c, `${U}/service/food-daily-fresh-vegetables`, 'c-vegetables', { scroll: 520 });
  await shot(c, `${U}/category/vehicle-rental`, 'c-cars', { scroll: 150 });
  await shot(c, `${U}/category/events`, 'c-events');
  await shot(c, `${U}/category/home-services`, 'c-home-services');
  await shot(c, `${U}/share-ride/ride/59`, 'c-seatmap', { scroll: 300, settle: 2000 });
  await shot(c, `${U}/orders/${onWay}`, 'c-track', { settle: 3500 });
  // customer, Telugu
  const t = await open(PHONE, 'te');
  await pwLogin(t, U, ravi, process.env.TEST_USER_PW);
  await shot(t, `${U}/`, 'c-home-te', { settle: 2000 });
  await shot(t, `${U}/service/food-daily-kirana-delivery`, 'c-kirana-te', { scroll: 520 });
  await shot(t, `${U}/orders/${onWay}`, 'c-track-te', { settle: 3500 });

  // partner (agent) phone: OTP login
  for (const [lang, sfx] of [['en', ''], ['te', '-te']]) {
    const a = await open(PHONE, lang);
    await db.query('DELETE FROM phone_otps WHERE phone = $1', ['8100000001']);
    await a.goto(`${AG}/login`, { waitUntil: 'networkidle2' });
    await a.waitForSelector('input[type=tel]');
    await a.type('input[type=tel]', '8100000001');
    await a.click('form button.btn-primary');
    await a.waitForSelector('.test-code b');
    await a.type('.code-input', await a.$eval('.test-code b', (x) => x.textContent));
    await Promise.all([a.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), a.click('form button.btn-primary')]);
    await shot(a, `${AG}/agent`, `a-home${sfx}`, { settle: 2500 });
    await shot(a, null, `a-home-2${sfx}`, { scroll: 600, settle: 300 });
    await shot(a, `${AG}/agent/wallet`, `a-wallet${sfx}`, { settle: 2000 });
  }

  // franchise admin, laptop
  const ad = await open(LAPTOP);
  await pwLogin(ad, AD, 'zt_admin', process.env.TEST_STAFF_PW);
  await shot(ad, `${AD}/admin`, 'f-dashboard', { settle: 2500, clip: { x: 0, y: 0, width: 1440, height: 640 } }); // no money-with-HQ box
  await shot(ad, `${AD}/admin/orders`, 'f-orders', { settle: 2500 });
  await shot(ad, `${AD}/admin/reports`, 'f-reports', { settle: 3000 });
  await shot(ad, null, 'f-reports-2', { scroll: 850, settle: 800 });
  await shot(ad, `${AD}/admin/agents`, 'f-agents', { settle: 2500 });
  await shot(ad, `${AD}/admin/live`, 'f-live', { settle: 4000 });

  // HQ, laptop
  const h = await open(LAPTOP);
  await pwLogin(h, HQ, 'zt_super', process.env.TEST_STAFF_PW);
  await shot(h, `${HQ}/super`, 'h-dashboard', { settle: 3000 });
  await shot(h, `${HQ}/super/reports`, 'h-reports', { settle: 3000 });
  await shot(h, `${HQ}/super/franchises`, 'h-franchises', { settle: 2500 });
  await shot(h, `${HQ}/super/waitlist`, 'h-waitlist', { settle: 2500 });
} finally {
  await b.close(); await db.end();
}
