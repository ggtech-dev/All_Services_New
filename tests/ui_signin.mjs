// Corporate-style customer login: 👋 Sign in = mobile number + password (no OTP), "Login with OTP instead";
// 🆕 Sign up = mobile → OTP → name + create password. Agent + admin logins unchanged; help buttons without number text.
// API in SMS test mode; test numbers 900000096x are removed at the end.
import bcrypt from 'bcryptjs';
import puppeteer from 'puppeteer-core';
import pg from 'pg';
import './testadmin.mjs';
import { withLocation } from './geo_browser.mjs';
let pass = 0, fails = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x !== '' ? ` — ${String(x).slice(0, 160)}` : ''}`); c ? pass++ : fails++; };
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
const NEW = '9000000961', NEW2 = '9000000962', OLD_OTP = '9000000963';
const wipe = async () => {
  await db.query("DELETE FROM users WHERE phone IN ($1, $2, $3) AND username LIKE 'm90000009%'", [NEW, NEW2, OLD_OTP]);
  await db.query('DELETE FROM phone_otps WHERE phone IN ($1, $2, $3)', [NEW, NEW2, OLD_OTP]);
};
await wipe();
// an older customer who joined by OTP only (no password yet)
await db.query(`INSERT INTO users (username, password_hash, full_name, role, phone, phone_verified_at, has_password)
                VALUES ('m9000000963', $1, 'Zt Old Otp', 'customer', $2, now(), false)`, [await bcrypt.hash('random-unknown-xyz', 10), OLD_OTP]);
const browser = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });
withLocation(browser); // 📍 a phone in Siddipet with location allowed
const errors = [];
const page = async () => {
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport({ width: 400, height: 860 });
  p.on('pageerror', (e) => errors.push(e.message));
  return p;
};
const text = (p) => p.evaluate(() => document.body.innerText);
const otpFlow = async (p, phone) => {
  await db.query('DELETE FROM phone_otps WHERE phone = $1', [phone]);
  await p.waitForSelector('input[type=tel]');
  await p.type('input[type=tel]', phone);
  await p.click('form button.btn-primary');
  await p.waitForSelector('.test-code b');
  await p.type('.code-input', await p.$eval('.test-code b', (b) => b.textContent));
  await p.click('form button.btn-primary');
};
const passwordLogin = async (p, user, pw) => {
  await p.waitForSelector('input[autocomplete=username]');
  await p.type('input[autocomplete=username]', user);
  await p.type('input[autocomplete=current-password]', pw);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
};
try {
  // ---- the Sign in screen ----
  const a = await page();
  await a.goto('http://localhost:5173/login', { waitUntil: 'networkidle2' });
  await a.waitForSelector('.account-switch');
  const at = await text(a);
  check('Sign in (default): mobile number + password + Login — no "Send OTP"', at.includes('Welcome back') && !!(await a.$('input[autocomplete=current-password]')) && !at.includes('Send OTP'));
  check('Sign in: "Forgot password?" and "Login with OTP instead"', at.includes('Forgot password?') && at.includes('Login with OTP instead'));
  check('help: 3 Call / WhatsApp / Mail buttons, no number text', (await a.$$eval('.support-btn', (x) => x.filter((b) => b.offsetParent).length)) === 3 && !/86886|gmail\.com/.test(at));
  await a.screenshot({ path: 'shots/login-signin.png' });

  // ---- Sign up: OTP → name + password ----
  await a.evaluate(() => [...document.querySelectorAll('.account-switch button')][1].click());
  await a.waitForFunction(() => document.body.innerText.includes('Create your account'));
  check('Sign up: "Create your account" with Send OTP', (await text(a)).includes('Send OTP'));
  await otpFlow(a, NEW);
  await a.waitForSelector('input[autocomplete=name]');
  check('Sign up: after OTP asks name + create password + confirm', (await a.$$('input[autocomplete=new-password]')).length === 2);
  await a.type('input[autocomplete=name]', 'Zt Signup Test');
  const pws = await a.$$('input[autocomplete=new-password]');
  await pws[0].type('zt_pass11');
  await pws[1].type('zt_pass12');
  await a.click('form button.btn-primary');
  await a.waitForFunction(() => document.body.innerText.includes('do not match'));
  check('Sign up: passwords that do not match are refused', true);
  await pws[1].focus();
  for (let i = 0; i < 12; i++) await a.keyboard.press('Backspace');
  await pws[1].type('zt_pass11');
  await a.screenshot({ path: 'shots/login-signup-final.png' });
  await Promise.all([a.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), a.click('form button.btn-primary')]);
  const nu = (await db.query('SELECT has_password FROM users WHERE phone = $1', [NEW])).rows[0];
  check('Sign up: account created WITH a password, on the home page', new URL(a.url()).pathname === '/' && nu?.has_password === true, JSON.stringify(nu));

  // ---- next time: Sign in with number + password, no OTP ----
  const b = await page();
  await b.goto('http://localhost:5173/login', { waitUntil: 'networkidle2' });
  const otpRows = (await db.query('SELECT count(*)::int n FROM phone_otps WHERE phone = $1', [NEW])).rows[0].n;
  await passwordLogin(b, NEW, 'zt_pass11');
  check('Sign in: number + password → straight in, no OTP sent', new URL(b.url()).pathname === '/' && (await db.query('SELECT count(*)::int n FROM phone_otps WHERE phone = $1', [NEW])).rows[0].n === otpRows);
  const c = await page();
  await c.goto('http://localhost:5173/login', { waitUntil: 'networkidle2' });
  await passwordLogin(c, NEW, 'wrong-pass');
  await c.waitForSelector('.alert');
  check('Sign in: wrong password → "Wrong mobile number or password"', (await c.$eval('.alert', (x) => x.textContent)).includes('Wrong mobile number or password'));

  // ---- older OTP-only customer ----
  const d = await page();
  await d.goto('http://localhost:5173/login', { waitUntil: 'networkidle2' });
  await passwordLogin(d, OLD_OTP, 'anything1');
  await d.waitForSelector('.alert');
  check('old OTP-only customer: polite "set a password / use OTP" message', /haven't set a password yet/.test(await d.$eval('.alert', (x) => x.textContent)));
  await d.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Login with OTP instead')).click());
  await otpFlow(d, OLD_OTP);
  await d.waitForFunction(() => location.pathname === '/', { timeout: 15000 }).catch(() => {});
  check('"Login with OTP instead" logs the old customer in', new URL(d.url()).pathname === '/');

  // ---- Sign in by OTP with a new number → create account (name + password) ----
  const e = await page();
  await e.goto('http://localhost:5173/login?method=otp', { waitUntil: 'networkidle2' });
  await otpFlow(e, NEW2);
  await e.waitForSelector('input[autocomplete=name]');
  check('OTP with a new number: "No account yet — let’s create one" + password fields', (await text(e)).includes('No account with this number yet') && (await e.$$('input[autocomplete=new-password]')).length === 2);
  await e.goto('http://localhost:5173/register', { waitUntil: 'networkidle2' });
  await e.waitForSelector('.account-switch');
  check('/register opens Sign up', (await text(e)).includes('Create your account'));

  // ---- agents + admin unchanged ----
  const f = await page();
  await f.goto('http://localhost:5174/login', { waitUntil: 'networkidle2' });
  await f.waitForSelector('.method-switch');
  check('agent login unchanged (Mobile OTP + Password tabs, no Sign in / Sign up)', !(await f.$('.account-switch')) && (await text(f)).includes('Agent login') && (await text(f)).includes('Send OTP'));
  await f.goto('http://localhost:5175/login', { waitUntil: 'networkidle2' });
  await f.waitForSelector('form');
  check('admin login unchanged (username + password)', !(await f.$('.account-switch')) && !(await f.$('.method-switch')) && (await text(f)).includes('Username'));
} finally {
  await browser.close();
  await wipe();
  await db.end();
}
check('no page errors', !errors.length, errors.join(' | '));
console.log(`\n${pass} passed, ${fails} failed`);
