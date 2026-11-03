// 🎉 Events in the browser: book Photography with the event form → event partner sees details (no phone) →
// accepts (phone shown) → cancels with a reason → customer sees the banner. Plus Telugu labels. zt_ data only.
import puppeteer from 'puppeteer-core';
import './testadmin.mjs';
import { agentLogin, makeCustomer } from './test_helpers.mjs';
import { withLocation } from './geo_browser.mjs';

const S = '.';
const OUT = `${S}/shots`;
const B = 'http://localhost:5173';
const API = 'http://localhost:5000/api';
const browser = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });
withLocation(browser); // 📍 a phone in Siddipet with location allowed
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (label, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label} ${extra}`); if (!cond) fails++; };
let promptAnswer = '';
async function newPage(width = 400, height = 860) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewport({ width, height });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept()));
  return page;
}
const text = (p) => p.evaluate(() => document.body.innerText);
const clickText = async (p, sel, t) => { await p.waitForFunction((s, t) => [...document.querySelectorAll(s)].some((b) => b.textContent.includes(t) && !b.disabled), {}, sel, t); await p.evaluate((s, t) => [...document.querySelectorAll(s)].find((b) => b.textContent.includes(t) && !b.disabled).click(), sel, t); };
// React-controlled inputs: set through the native setter so onChange fires
const setVal = (p, sel, v) => p.$eval(sel, (el, v) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}, v);
const call = async (path, { method = 'GET', body, token, form } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  return res.status === 204 ? {} : res.json().catch(() => ({}));
};
const login = async (p, u, as = '') => {
  // separate apps: partners log in on the agent app (5174), customers on the customer app (5173)
  const base = as.includes('agent') ? 'http://localhost:5174' : B;
  await p.goto(`${base}/login?method=password`, { waitUntil: 'networkidle2' });
  await p.type('input[autocomplete=username]', u);
  await p.type('input[autocomplete=current-password]', process.env.TEST_STAFF_PW);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
};

try {
  const email = 'zt.ev.web@example.com';
  await makeCustomer('zt_ev_web', 'Event Web');
  const admin = (await call('/auth/login', { method: 'POST', body: { username: 'zt_admin', password: process.env.TEST_STAFF_PW, portal: 'admin' } })).token; // the city's admin adds agents (HQ only watches)
  const locs = (await call('/localities')).filter((l) => Number(l.franchise_id) === 1 && !l.is_village); // Siddipet town areas (zt_admin is Siddipet's admin)
  const f = new FormData();
  Object.entries({ username: 'zt_ev_partner', password: process.env.TEST_STAFF_PW, full_name: 'Event Kiran', phone: '9111111721', vehicle_type: 'bike', locality_id: locs[0].id, skills: 'events_agent' }).forEach(([k, v]) => f.append(k, v));
  await call('/admin/agents', { method: 'POST', token: admin, form: f });
  await agentLogin('zt_ev_partner', '9111111721');

  // 1) customer: Events category + event form
  const c = await newPage();
  await login(c, 'zt_ev_web');
  await c.goto(`${B}/category/events`, { waitUntil: 'networkidle2' });
  const cat = await text(c);
  check('Events page lists the services', ['Photography', 'Catering', 'Tent House & Rentals', 'Other Event Services'].every((n) => cat.includes(n)));
  await c.screenshot({ path: `${OUT}/e1-category.png` });

  await c.goto(`${B}/checkout?service=events-photography`, { waitUntil: 'networkidle2' });
  await c.waitForSelector('.event-form select option:nth-child(3)');
  const ck = await text(c);
  check('checkout: event form, venue heading, no time slots', ck.includes('Event details') && ck.includes('Event venue') && !(await c.$('.slot-grid')));
  check('checkout: price agreed with the partner', ck.includes('agreed with the partner') && ck.includes('Book event'));
  const future = new Date(Date.now() + 25 * 86400e3 + 5.5 * 3600e3).toISOString().slice(0, 10);
  await setVal(c, '.event-form select', 'Wedding');
  await setVal(c, '.event-form input[type=date]', future);
  await setVal(c, '.event-form input[type=time]', '10:30');
  await setVal(c, '.event-form input[type=number]', '250');
  await setVal(c, '.event-form textarea', 'Candid photos + album, haldi and wedding');
  await setVal(c, 'input[placeholder="10-digit mobile"]', '9848022339');
  await setVal(c, 'input[placeholder^="e.g. Flat"]', 'Sri Sai Function Hall, Main Road');
  // the area list shows the areas nearest the phone's location → the first one offered
  await setVal(c, '.checkout select:not(.event-form select)', await c.$eval('.checkout select:not(.event-form select) option[value]:not([value=""])', (o) => o.value));
  await c.screenshot({ path: `${OUT}/e2-checkout.png`, fullPage: true });
  await clickText(c, '.checkout-side button', 'Book event');
  await c.waitForSelector('.placed-banner', { timeout: 20000 });
  const id = Number(c.url().match(/orders\/(\d+)/)[1]);
  check('event booked', id > 0, `#${id}`);
  check('order page shows the event details', (await text(c)).includes('Candid photos + album') && (await text(c)).includes('10:30 AM'));
  await c.screenshot({ path: `${OUT}/e3-order.png`, fullPage: true });

  // 2) event partner: details before accepting, no phone
  const a = await newPage();
  await login(a, 'zt_ev_partner', '?as=agent');
  await a.waitForSelector('.online-toggle');
  await a.click('.online-toggle');
  await a.waitForFunction((id) => [...document.querySelectorAll('.avail-card')].some((x) => x.innerText.includes('#' + id)), {}, id);
  const card = await a.evaluate((id) => [...document.querySelectorAll('.avail-card')].find((x) => x.innerText.includes('#' + id)).innerText, id);
  check('partner sees type, date, guests, needs', /Wedding/.test(card) && /250/.test(card) && /Candid photos/.test(card), card.replace(/\s+/g, ' ').slice(0, 160));
  check('…but not the phone before accepting', !card.includes('9848022339') && !(await a.$('a[href="tel:9848022339"]')));
check('no per-order pay shown on event bookings', !card.includes('+₹'));
  await a.screenshot({ path: `${OUT}/e4-partner-card.png` });

  // accept → phone + venue
  await a.evaluate((id) => [...document.querySelectorAll('.avail-card')].find((x) => x.innerText.includes('#' + id)).querySelector('button.btn-primary').click(), id);
  await a.waitForSelector('a[href="tel:9848022339"]');
  check('after accepting: call button + venue + event details', (await text(a)).includes('Function Hall') && (await text(a)).includes('Candid photos'));
  await a.screenshot({ path: `${OUT}/e5-partner-active.png`, fullPage: true });

  // cancel with a reason
  promptAnswer = 'Camera broke, cannot cover the wedding';
  await clickText(a, 'button', 'Cancel this booking');
  // the in-app reason box (reason required)
  await a.waitForSelector('#ask-reason-form textarea');
  await a.type('#ask-reason-form textarea', promptAnswer);
  await clickText(a, '.modal-footer button', 'Cancel booking');
  await wait(1500);
  const after = await call(`/orders/${id}`, { token: (await call('/auth/login', { method: 'POST', body: { username: 'zt_ev_web', password: process.env.TEST_STAFF_PW } })).token });
  check('booking is waiting for the next partner', after.status === 'placed' && after.agent_id === null, after.status);

  // 3) customer sees why
  await c.reload({ waitUntil: 'networkidle2' });
  await c.waitForSelector('.partner-cancelled');
  const banner = await c.$eval('.partner-cancelled', (b) => b.innerText);
  check('customer sees the cancel banner with the reason', banner.includes('had to cancel') && banner.includes('Camera broke'), banner.replace(/\s+/g, ' '));
  await c.screenshot({ path: `${OUT}/e6-customer-cancelled.png` });

  // 4) Telugu
  await c.evaluate(() => localStorage.setItem('as_lang', 'te'));
  await c.reload({ waitUntil: 'networkidle2' });
  await c.waitForSelector('.partner-cancelled');
  await wait(500);
  const teBanner = await c.$eval('.partner-cancelled', (b) => b.innerText);
  check('Telugu: cancel banner', teBanner.includes('రద్దు చేయాల్సి వచ్చింది') && teBanner.includes('చింతించకండి'), teBanner.replace(/\s+/g, ' '));
  await c.goto(`${B}/checkout?service=events-catering`, { waitUntil: 'networkidle2' });
  await c.waitForSelector('.event-form select option:nth-child(3)');
  await wait(500);
  const te = await text(c);
  check('Telugu: event form labels', te.includes('వేడుక రకం') && te.includes('వేడుక తేదీ') && te.includes('వేడుక జరిగే చోటు') && te.includes('వేడుక బుక్ చేయండి'));
  check('Telugu: event types', te.includes('పెళ్లి') || (await c.$$eval('.event-form option', (o) => o.map((x) => x.textContent).join(','))).includes('పెళ్లి'));
  await c.screenshot({ path: `${OUT}/e7-telugu-checkout.png`, fullPage: true });
  check('no sideways scroll (phone)', await c.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
} finally {
  await browser.close();
}
check('no page errors', !errors.length, errors.join(' | '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
