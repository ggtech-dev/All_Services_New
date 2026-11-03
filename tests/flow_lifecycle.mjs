// One order through all four separate apps, by clicking like real people (browser pop-ups BLOCKED, as on a phone
// where Chrome was told to stop dialogs — every step must use the in-app boxes):
//   customer app (5000): shop → cart → checkout → order placed → tracking
//   agent app (5001):    online → sees order → accept → picked up → cash collected → Mark delivered (in-app confirm)
//   customer app:        sees "delivered" → rates 5 stars
//   admin app (5002) and HQ app (5003): the order is in their Orders lists
//   each app keeps to itself: customer app has no /agent, agent app no /admin, admin app no /super
import puppeteer from 'puppeteer-core';
import './testadmin.mjs';
import { agentLogin, makeCustomer } from './test_helpers.mjs';
import { withLocation } from './geo_browser.mjs';
const U = 'http://localhost:5000', AG = 'http://localhost:5001', AD = 'http://localhost:5002', HQ = 'http://localhost:5003';
const API = `${U}/api`;
const OUT = './shots';
let pass = 0, fails = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? ` — ${String(x).slice(0, 160)}` : ''}`); c ? pass++ : fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (p, o = {}) => {
  const h = {}; if (o.token) h.Authorization = `Bearer ${o.token}`; if (o.body) h['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method: o.method || 'GET', headers: h, body: o.form || (o.body && JSON.stringify(o.body)) });
  return r.json().catch(() => ({}));
};
const errors = [];
let dialogs = 0;
const browser = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });
withLocation(browser); // 📍 a phone in Siddipet with location allowed
async function page(w = 400, h = 860) {
  const p = await (await browser.createBrowserContext()).newPage();
  p.setDefaultTimeout(20000);
  await p.setViewport({ width: w, height: h });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => { dialogs++; d.dismiss(); }); // like a browser that blocks pop-ups
  return p;
}
const clickText = async (p, sel, t) => {
  await p.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((b) => b.textContent.includes(t) && !b.disabled), {}, sel, t);
  await p.evaluate((s, t) => [...document.querySelectorAll(s)].find((b) => b.textContent.includes(t) && !b.disabled).click(), sel, t);
};
const setVal = (p, sel, v) => p.$eval(sel, (el, v) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}, v);
async function login(p, base, user, query = '') {
  await p.goto(`${base}/login${query || '?method=password'}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input[autocomplete=username]');
  await p.type('input[autocomplete=username]', user);
  await p.type('input[autocomplete=current-password]', process.env.TEST_STAFF_PW);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
}

try {
  // test customer + rider
  const email = 'zt.flow.cust@example.com';
  await makeCustomer('zt_flow_cust', 'Flow Customer');
  const adm = (await call('/auth/login', { method: 'POST', body: { username: 'zt_admin', password: process.env.TEST_STAFF_PW, portal: 'admin' } })).token;
  const locs = (await call("/localities")).filter((l) => !l.is_village && Number(l.franchise_id ?? 1) === 1); // a Siddipet town area (shop orders go to towns)
  const f = new FormData();
  Object.entries({ username: 'zt_flow_rider', password: process.env.TEST_STAFF_PW, full_name: 'Flow Ravi', phone: '9000000091', vehicle_type: 'bike', locality_id: locs[0].id, skills: 'delivery' }).forEach(([k, v]) => f.append(k, v));
  await call('/admin/agents', { method: 'POST', token: adm, form: f });
  await agentLogin('zt_flow_rider', '9000000091');

  // ---- customer app: shop → checkout
  const c = await page();
  await login(c, U, 'zt_flow_cust', '?method=password');
  check('customer app: logged in to the home page', new URL(c.url()).pathname === '/' && (await c.title()).includes('All Services'));
  await c.goto(`${U}/service/food-daily-fruit-delivery`, { waitUntil: 'networkidle2' });
  await c.waitForSelector('.add-btn');
  await c.click('.add-btn');
  await c.waitForSelector('.cart-bar');
  check('item added, cart bar shows', true);
  await c.click('.cart-bar');
  await c.waitForSelector('.checkout');
  await setVal(c, 'input[placeholder="10-digit mobile"]', '9848011111');
  await setVal(c, 'input[placeholder^="e.g. Flat"]', 'H.No 5-6, Flow Street');
  // areas load after the page; the list shows the areas nearest the phone's location → take the first one offered
  await c.waitForFunction(() => document.querySelectorAll('.checkout select option[value]:not([value=""])').length > 0);
  await setVal(c, '.checkout select', await c.$eval('.checkout select option[value]:not([value=""])', (o) => o.value));
  // 📍 wait for the phone's location (the test browser allows it, like a customer tapping Allow)
  await c.waitForFunction(() => /Location pinned/.test(document.body.innerText), { timeout: 15000 });
  await c.screenshot({ path: `${OUT}/L1-checkout.png`, fullPage: true });
  await clickText(c, '.checkout-side button', 'Place order');
  await c.waitForSelector('.placed-banner', { timeout: 20000 });
  const id = Number(c.url().match(/orders\/(\d+)/)[1]);
  check('order placed and tracking page open', id > 0, `#${id}`);

  // ---- agent app: accept → pick up → cash → delivered
  const a = await page();
  await login(a, AG, 'zt_flow_rider');
  check('agent app: logged in', new URL(a.url()).pathname.startsWith('/agent') && (await a.title()).includes('Partner'));
  await a.waitForSelector('.online-toggle');
  if (!(await a.$('.online-toggle.on, .online-toggle[aria-checked="true"]'))) await a.click('.online-toggle');
  await a.waitForFunction((id) => [...document.querySelectorAll('.avail-card')].some((x) => x.innerText.includes('#' + id)), { timeout: 30000 }, id);
  check('agent sees the new order', true);
  await a.evaluate((id) => [...document.querySelectorAll('.avail-card')].find((x) => x.innerText.includes('#' + id)).querySelector('button.btn-primary').click(), id);
  await a.waitForSelector('.active-card');
  check('agent accepted: active order with call button', !!(await a.$('a[href="tel:9848011111"]')));
  // 🧾 shop items are priced by the shop bill (since 2026-10-22): the agent adds the bill before pick-up
  await clickText(a, '.active-card button', 'Add shop bill');
  await a.waitForSelector('.shop-bill-form');
  await a.type('.shop-bill-form input[type=number]', '140');
  const billInput = await a.$('.shop-bill-form input[type=file]');
  await billInput.uploadFile('./shots/ride-ticket.png');
  await clickText(a, '.shop-bill-form button', 'I paid cash');
  await clickText(a, '.shop-bill-form button', 'Save bill');
  await a.waitForFunction(() => !document.querySelector('.shop-bill-form') && /140/.test(document.querySelector('.active-card')?.innerText || ''), { timeout: 15000 });
  check('agent adds the shop bill (₹140, paid cash) before pick-up', true);
  await clickText(a, '.active-card button', 'Picked up');
  // the first order of a number has free delivery (launch offer) → nothing to collect; later orders show the cash button
  await a.waitForFunction(() => [...document.querySelectorAll('.active-card button')].some((b) => /in cash|Mark delivered/.test(b.innerText)), { timeout: 15000 });
  if (await a.evaluate(() => [...document.querySelectorAll('.active-card button')].some((b) => b.innerText.includes('in cash')))) {
    await clickText(a, '.active-card button', 'in cash');
    await wait(800);
  }
  await clickText(a, '.active-card button', 'Mark delivered');
  await a.waitForSelector('.modal .confirm-text');
  check('in-app confirm box appears (no browser pop-up)', (await a.$eval('.modal .confirm-text', (e) => e.innerText)).includes(`#${id}`));
  await a.screenshot({ path: `${OUT}/L2-agent-confirm.png` });
  await clickText(a, '.modal-footer button', 'Yes, delivered');
  await a.waitForFunction(() => !document.querySelector('.active-card'), { timeout: 15000 });
  check('agent marked it delivered', (await call(`/orders/${id}`, { token: (await call('/auth/login', { method: 'POST', body: { username: 'zt_flow_cust', password: process.env.TEST_STAFF_PW } })).token })).status === 'delivered');

  // ---- customer: delivered + rating
  await c.reload({ waitUntil: 'networkidle2' });
  await c.waitForSelector('.star-picker');
  check('customer sees delivered', /Delivered/i.test(await c.evaluate(() => document.body.innerText)));
  await c.click('.star-picker button:nth-child(5)');
  await clickText(c, '.rate-card button', 'Submit rating');
  await c.waitForSelector('.rate-card.rated');
  check('customer rated 5 stars', true);
  await c.screenshot({ path: `${OUT}/L3-customer-rated.png`, fullPage: true });

  // ---- admin app + HQ app see the order
  const ad = await page(1366, 800);
  await login(ad, AD, 'zt_admin');
  await ad.goto(`${AD}/admin/orders`, { waitUntil: 'networkidle2' });
  await clickText(ad, '.tabs button', 'Delivered');
  await ad.waitForFunction((id) => document.body.innerText.includes('#' + id) || document.body.innerText.includes(String(id)), { timeout: 20000 }, id).catch(() => {});
  check('franchise admin app lists the order', (await ad.evaluate(() => document.body.innerText)).includes(String(id)) && (await ad.title()).includes('Franchise Admin'));
  await ad.screenshot({ path: `${OUT}/L4-admin-orders.png` });
  const hq = await page(1366, 800);
  await login(hq, HQ, 'zt_super');
  await hq.goto(`${HQ}/super/orders`, { waitUntil: 'networkidle2' });
  await clickText(hq, '.tabs button', 'Delivered');
  await hq.waitForFunction((id) => document.body.innerText.includes(String(id)), { timeout: 20000 }, id).catch(() => {});
  check('HQ app lists the order', (await hq.evaluate(() => document.body.innerText)).includes(String(id)) && (await hq.title()).includes('HQ'));

  // ---- each app keeps to itself
  await c.goto(`${U}/agent`, { waitUntil: 'networkidle2' });
  check('customer app has no agent pages', new URL(c.url()).pathname === '/');
  await a.goto(`${AG}/admin`, { waitUntil: 'networkidle2' });
  check('agent app has no admin pages', new URL(a.url()).pathname.startsWith('/agent'));
  await ad.goto(`${AD}/super`, { waitUntil: 'networkidle2' });
  check('admin app has no HQ pages', new URL(ad.url()).pathname.startsWith('/admin'));
  await hq.goto(`${HQ}/`, { waitUntil: 'networkidle2' });
  check('HQ app opens on HQ pages', new URL(hq.url()).pathname.startsWith('/super'));
  const anon = await page();
  await anon.goto(`${AG}/login`, { waitUntil: 'networkidle2' });
  check('agent app login has no customer/admin tabs', !(await anon.$('.portal-switch')) && (await anon.evaluate(() => document.body.innerText)).includes('Apply'));
} finally {
  await browser.close();
}
check('no browser pop-ups were needed', dialogs === 0, `${dialogs} pop-ups`);
check('no page errors', !errors.length, errors.join(' | '));
console.log(`\n${pass} passed, ${fails} failed`);
