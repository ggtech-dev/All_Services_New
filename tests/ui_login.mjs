// Screens of the phone-first login (dev servers 5173–5176, API in SMS test mode). Customer number 9000000953 is
// signed up through the UI and deleted at the end.
import puppeteer from 'puppeteer-core';
import pg from 'pg';
import './testadmin.mjs';
import { withLocation } from './geo_browser.mjs';
let pass = 0, fails = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? ` — ${String(x).slice(0, 150)}` : ''}`); c ? pass++ : fails++; };
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
const P = '9000000953';
const wipe = () => db.query("DELETE FROM users WHERE phone = $1 AND username LIKE 'm9000000953%'", [P]).then(() => db.query('DELETE FROM phone_otps WHERE phone = $1', [P]));
await wipe();
const browser = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });
withLocation(browser); // 📍 a phone in Siddipet with location allowed
const errors = [];
const text = (p) => p.evaluate(() => document.body.innerText);
try {
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport({ width: 400, height: 860 });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:5173/login?mode=signup', { waitUntil: 'networkidle2' });
  await p.waitForSelector('.account-switch');
  const t = await text(p);
  check('customer login: Sign in / Sign up, Sign up by mobile OTP, no Email', t.includes('Sign in') && t.includes('Create your account') && t.includes('Send OTP') && !t.includes('Email code'));
  check('no "Create an account" link', !t.includes('Create an account'));
  await p.screenshot({ path: 'shots/login-user.png' });
  await p.type('input[type=tel]', P);
  await p.click('form button.btn-primary');
  await p.waitForSelector('.test-code b');
  const code = await p.$eval('.test-code b', (b) => b.textContent);
  await p.type('.code-input', code);
  await p.click('form button.btn-primary');
  await p.waitForSelector('input[autocomplete=name]');
  await p.type('input[autocomplete=name]', 'Zt Ui Customer');
  for (const el of await p.$$('input[autocomplete=new-password]')) await el.type('zt_pass11');
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
  check('sign-up by OTP lands on home', new URL(p.url()).pathname === '/');
  await p.goto('http://localhost:5173/account', { waitUntil: 'networkidle2' });
  await p.waitForSelector('.account-grid');
  const acc = await text(p);
  check('account: shows number, "Change password" (set at sign-up), no email box', acc.includes(`+91 ${P}`) && acc.includes('Change password') && !acc.includes('📧'), acc.slice(0, 200));
  await p.screenshot({ path: 'shots/account-user.png', fullPage: true });
  await p.goto('http://localhost:5173/register', { waitUntil: 'networkidle2' });
  check('/register → login (or home when logged in)', ['/login', '/'].includes(new URL(p.url()).pathname));

  const g = await (await browser.createBrowserContext()).newPage();
  await g.setViewport({ width: 400, height: 860 });
  g.on('pageerror', (e) => errors.push(e.message));
  await g.goto('http://localhost:5173/forgot-password', { waitUntil: 'networkidle2' });
  check('forgot password asks the mobile number', (await text(g)).includes('Mobile number on your account'));
  await g.screenshot({ path: 'shots/forgot-user.png' });

  await g.goto('http://localhost:5174/login', { waitUntil: 'networkidle2' });
  await g.waitForSelector('.method-switch');
  const at = await text(g);
  check('agent login: Mobile OTP default, no Email', at.includes('Use the mobile number you applied with') && !at.includes('Email code'));
  await g.screenshot({ path: 'shots/login-agent.png' });
  await g.goto('http://localhost:5174/agent/apply', { waitUntil: 'networkidle2' });
  await g.waitForSelector('input[type=tel]');
  const ap = await text(g);
  check('agent apply: step 1 = verify number, form not shown yet', ap.includes('Step 1') && !ap.includes('Aadhaar number'));
  await g.screenshot({ path: 'shots/apply-step1.png' });

  const a = await (await browser.createBrowserContext()).newPage();
  await a.setViewport({ width: 1280, height: 860 });
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto('http://localhost:5175/login', { waitUntil: 'networkidle2' });
  check('admin login: password only', !(await a.$('.method-switch')));
  await a.type('input[autocomplete=username]', 'zt_admin');
  await a.type('input[autocomplete=current-password]', process.env.TEST_STAFF_PW);
  await Promise.all([a.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), a.click('form button.btn-primary')]);
  await a.goto('http://localhost:5175/admin/agents', { waitUntil: 'networkidle2' });
  await a.waitForSelector('.tabs');
  check('admin agents page has "Removed" tab', (await text(a)).includes('Removed'));
  await a.screenshot({ path: 'shots/admin-agents.png' });
} finally {
  await browser.close();
  await wipe();
  await db.end();
}
check('no page errors', !errors.length, errors.join(' | '));
console.log(`\n${pass} passed, ${fails} failed`);
