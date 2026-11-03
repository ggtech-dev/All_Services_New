// Browser test of the 🏡 Village Needs and 🚗 Share Ride screens (customer, car owner, franchise admin, HQ).
// Dev servers 5173–5176 + API in SMS test mode. Test data only (zt_…, "zt Village…", owner 9000000981); removed at the end.
import puppeteer from 'puppeteer-core';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import './testadmin.mjs';
import { withLocation } from './geo_browser.mjs';
const API = 'http://localhost:5000/api';
let pass = 0, fails = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x !== '' ? ` — ${String(x).slice(0, 180)}` : ''}`); c ? pass++ : fails++; };
const call = async (p, { method = 'GET', body, token, form } = {}) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method, headers, body: form || (body && JSON.stringify(body)) });
  const d = await r.json().catch(() => ({}));
  return Array.isArray(d) ? Object.assign(d, { http: r.status }) : { ...d, http: r.status };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
const OWNER = '9000000981';
const wipe = async () => {
  await db.query("DELETE FROM orders WHERE customer_id IN (SELECT id FROM users WHERE username LIKE 'zt\\_%')");
  await db.query("DELETE FROM users WHERE phone IN ($1, '9000000985') AND (username LIKE 'a9000000981%' OR username LIKE 'a9000000985%')", [OWNER]);
  await db.query("DELETE FROM users WHERE username IN ('zt_ui_cust')");
  await db.query("DELETE FROM localities WHERE name LIKE 'zt Village%'");
  await db.query("DELETE FROM phone_otps WHERE phone IN ($1, '9000000985')", [OWNER]);
};
await wipe();
const hash = await bcrypt.hash(process.env.TEST_STAFF_PW, 10);
await db.query(`INSERT INTO users (username, password_hash, full_name, role, phone) VALUES ('zt_ui_cust', $1, 'Zt Ui Customer', 'customer', '9000000982')`, [hash]);
const login = async (username, portal) => (await call('/auth/login', { method: 'POST', body: { username, password: process.env.TEST_STAFF_PW, portal } })).token;
const admin = await login('zt_admin', 'admin');
const town = (await db.query('SELECT id FROM localities WHERE franchise_id = 1 AND is_active AND NOT is_village ORDER BY id LIMIT 1')).rows[0].id;
// 🗺️ villages are added by HQ (for the city chosen at the top: X-Franchise)
const hqTok = await login('zt_super', 'superadmin');
await fetch(`${API}/admin/localities`, { method: 'POST', headers: { Authorization: `Bearer ${hqTok}`, 'X-Franchise': '1', 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'zt Village Ramakkapet', lat: 18.13, lng: 78.92, is_village: true, village_band: 1 }) });

// a car owner with an approved car, an active subscription and a journey tomorrow (made through the API)
const otp = async (phone) => {
  await db.query('DELETE FROM phone_otps WHERE phone = $1', [phone]);
  return (await call('/auth/phone/request', { method: 'POST', body: { phone } })).devCode;
};
const proof = (await call('/auth/phone/verify', { method: 'POST', body: { phone: OWNER, code: await otp(OWNER), portal: 'agent_apply' } })).proof;
const png = () => new Blob([Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')], { type: 'image/png' });
const models = await call('/share-ride/models');
const ertiga = models.find((m) => /Ertiga/.test(m.name));
const fd = new FormData();
Object.entries({ owner_type: 'car', phone_proof: proof, full_name: 'Zt Ramesh Owner', locality_id: town, aadhaar_number: '123456789012', pan_number: 'ABCDE1234F',
  dl_number: 'TS0920190012345', car_model_id: ertiga.id, reg_number: 'TS36T9981', car_color: 'Silver', yellow_board: 'true', skills: 'shared_car_agent' }).forEach(([k, v]) => fd.append(k, v));
for (const f of ['aadhaar_doc', 'pan_doc', 'dl_doc', 'rc_doc', 'permit_doc', 'insurance_doc']) fd.append(f, png(), `${f}.png`);
await call('/agents/apply', { method: 'POST', form: fd });
const ownerId = (await db.query('SELECT id FROM users WHERE phone = $1 AND role = $2', [OWNER, 'agent'])).rows[0].id;
const carId = (await db.query('SELECT id FROM shared_cars WHERE owner_id = $1', [ownerId])).rows[0].id;

const browser = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });

withLocation(browser); // 📍 a phone in Siddipet with location allowed
const errors = [];
const page = async (w = 400, h = 860) => {
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport({ width: w, height: h });
  p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`));
  p.on('dialog', (d) => d.dismiss());
  return p;
};
const text = (p) => p.evaluate(() => document.body.innerText);
const clickText = async (p, sel, t) => {
  await p.waitForFunction((s, x) => [...document.querySelectorAll(s)].some((b) => b.textContent.includes(x)), { timeout: 15000 }, sel, t);
  await p.evaluate((s, x) => [...document.querySelectorAll(s)].find((b) => b.textContent.includes(x)).click(), sel, t);
};
const passwordLogin = async (p, base, user) => {
  await p.goto(`${base}/login?method=password`, { waitUntil: 'networkidle2' });
  await p.type('input[autocomplete=username]', user);
  await p.type('input[autocomplete=current-password]', process.env.TEST_STAFF_PW);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
};
const noScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  // ---------- franchise admin: approve the car, Share Ride page, areas with villages ----------
  const a = await page(1280, 900);
  await passwordLogin(a, 'http://localhost:5175', 'zt_admin');
  await a.goto('http://localhost:5175/admin/share-ride', { waitUntil: 'networkidle2' });
  await a.waitForSelector('.share-admin');
  check('admin: Share Ride page lists the pending car with its papers', (await text(a)).includes('TS36T9981') && !!(await a.$('.doc-btns button')));
  await a.screenshot({ path: 'shots/admin-share-ride.png' });
  await a.evaluate(() => [...document.querySelectorAll('tr')].find((t) => t.innerText.includes('TS36T9981')).querySelector('.btn-success').click());
  await clickText(a, '.modal button', 'Approve');
  await a.waitForFunction(() => [...document.querySelectorAll('tr')].find((t) => t.innerText.includes('TS36T9981'))?.innerText.includes('Approved'), { timeout: 15000 }).catch(() => {});
  check('admin: car approved from the screen', (await db.query('SELECT status FROM shared_cars WHERE id = $1', [carId])).rows[0].status === 'approved');
  await clickText(a, '[role=tab]', 'Car models');
  await a.waitForSelector('.model-card');
  await a.click('.model-card');
  await a.waitForSelector('.model-form .seatmap');
  check('admin: car model editor shows the seat-map preview', (await a.$$('.model-form .seat')).length >= 7);
  await a.screenshot({ path: 'shots/admin-model-editor.png' });
  await a.keyboard.press('Escape');
  await a.goto('http://localhost:5175/admin/areas', { waitUntil: 'networkidle2' });
  await a.waitForSelector('.village-fees');
  const at = await text(a);
  check('admin: areas page has village charges + village rows', at.includes('Village delivery charges') && at.includes('zt Village Ramakkapet') && at.includes('up to 10 km'));
  await a.screenshot({ path: 'shots/admin-areas-villages.png', fullPage: true });
  // subscription on (API) and a journey tomorrow (owner, API)
  const sub = (await db.query('SELECT id FROM agent_subscriptions WHERE agent_id = $1', [ownerId])).rows[0];
  await call(`/admin/subscriptions/${sub.id}/activate`, { method: 'POST', token: admin, body: { amount: 0, mode: 'free', days: 30 } });

  // ---------- car owner (agent app): lands on Share Ride, lists a journey from the form ----------
  const o = await page();
  await db.query('DELETE FROM phone_otps WHERE phone = $1', [OWNER]); // the 30-second resend rule
  await o.goto('http://localhost:5174/login', { waitUntil: 'networkidle2' });
  await o.type('input[type=tel]', OWNER);
  await o.click('form button.btn-primary');
  await o.waitForSelector('.test-code b');
  await o.type('.code-input', await o.$eval('.test-code b', (b) => b.textContent));
  await Promise.all([o.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), o.click('form button.btn-primary')]);
  await o.waitForSelector('.share-owner', { timeout: 20000 });
  check('owner: only-car owner lands on 🚗 Share Ride, journeys live', new URL(o.url()).pathname === '/agent/share-ride' && (await text(o)).includes('Your journeys are live'));
  check('owner: tabs Share Ride / Subscription / Profile', (await o.$$eval('.agent-tabs a', (l) => l.map((x) => x.textContent))).join('|').includes('Share Ride'));
  await clickText(o, '.shop-tabs button', 'New');
  await o.waitForSelector('form .seatmap');
  await o.evaluate(() => {
    const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(el.__proto__, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const ta = document.querySelectorAll('form textarea');
    set(ta[0], 'Old bus stand\nPonnala');
    set(ta[1], 'JBS\nAmeerpet');
  });
  const priceInputs = await o.$$('fieldset input[type=number]');
  for (const [i, el] of priceInputs.entries()) await el.type(String([400, 300, 250][i] || 250));
  await o.click('form .seat-free'); // keep the front seat
  await o.type('input[placeholder="yourname@okaxis"]', 'ztramesh@okaxis');
  await o.screenshot({ path: 'shots/owner-new-journey.png', fullPage: true });
  await clickText(o, 'form button.btn-primary', 'List this journey');
  await o.waitForFunction(() => document.body.innerText.includes('booked'), { timeout: 15000 }).catch(() => {});
  const ride = (await db.query('SELECT id, blocked_seats, row_prices FROM share_rides WHERE owner_id = $1', [ownerId])).rows[0];
  check('owner: journey listed from the form (prices per row, front seat not for sale)', ride && ride.blocked_seats.includes('1-1') && ride.row_prices.map(Number).join() === '400,300,250', JSON.stringify(ride));
  check('owner page: no sideways scroll on phone', await noScroll(o));
  await o.screenshot({ path: 'shots/owner-journeys.png', fullPage: true });

  // ---------- customer: Village Needs ----------
  const c = await page();
  await passwordLogin(c, 'http://localhost:5173', 'zt_ui_cust');
  await c.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });
  const home = await text(c);
  check('home: Village Needs and Share Ride categories', home.includes('Village Needs') && home.includes('Share Ride'));
  await c.goto('http://localhost:5173/category/village-needs', { waitUntil: 'networkidle2' });
  await c.waitForSelector('.village-check', { timeout: 15000 });
  check('Village Needs opens its shop straight away', /\/service\/village-needs/.test(c.url()));
  const tabs = await c.$$eval('.instant-tabs button', (b) => b.map((x) => x.textContent.trim()));
  check('tabs: Kirana, Vegetables, Meat & Fish, Other things', tabs.length === 4 && tabs[3].includes('Other things'), tabs.join(' | '));
  await c.type('.village-check input', 'ramakka');
  await c.waitForFunction(() => document.querySelector('.village-check').innerText.includes('We deliver to'));
  await c.click('.village-check input', { clickCount: 3 });
  await c.type('.village-check input', 'Nowhere');
  check('village check: not covered → "not available for this village"', (await text(c)).includes('not available for'));
  await c.screenshot({ path: 'shots/village-shop.png' });
  await c.waitForSelector('.add-btn');
  await c.click('.add-btn');
  await clickText(c, '.instant-tabs button', 'Other things');
  await c.waitForSelector('.own-list input, .own-line input, input[aria-label="Item 1"]');
  await c.type('input[aria-label="Item 1"]', 'Splendor clutch cable');
  await c.waitForSelector('.cart-bar-village');
  check('cart bar says "Village order"', (await c.$eval('.cart-bar', (x) => x.textContent)).includes('Village order'));
  await c.click('.cart-bar');
  await c.waitForSelector('.village-banner');
  await c.waitForFunction(() => document.querySelectorAll('select[required] option').length > 1, { timeout: 15000 }).catch(() => {}); // areas load after the page
  const opts =await c.$$eval('select[required] option', (o) => o.map((x) => x.textContent));
  check('checkout: only villages with their charge in the area list', opts.some((x) => /zt Village Ramakkapet.*— delivery ₹150/.test(x)) && !opts.some((x) => /Bharath|Mustabad/.test(x) && !x.includes('delivery')), opts.slice(0, 4).join(' | '));
  await c.evaluate(() => {
    const s = [...document.querySelectorAll('select[required]')].find((x) => [...x.options].some((o) => o.textContent.includes('Ramakkapet')));
    const v = [...s.options].find((o) => o.textContent.includes('Ramakkapet')).value;
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    set.call(s, v);
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await c.evaluate(() => {
    const i = [...document.querySelectorAll('input')].find((x) => x.placeholder?.startsWith('e.g. Flat'));
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(i, 'House 12, Temple street');
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await c.waitForFunction(() => [...document.querySelectorAll('.slot')].some((s) => /Tomorrow|Wed|Tue|Thu|Fri|Sat|Sun|Mon/.test(s.textContent)), { timeout: 15000 });
  const slots = await c.$$eval('.slot', (s) => s.map((x) => x.textContent));
  check('checkout: next-day slots (no "As soon as possible")', slots.length === 6 && !slots.some((s) => /soon|Today/.test(s)), slots.join(' | '));
  await c.waitForFunction(() => document.querySelector('.checkout-side').innerText.includes('150'), { timeout: 10000 }).catch(() => {});
  check('checkout: ₹150 village delivery charge in the summary', (await c.$eval('.checkout-side', (x) => x.innerText)).includes('150'));
  await c.screenshot({ path: 'shots/village-checkout.png', fullPage: true });
  await Promise.all([c.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), c.click('.checkout-side button.btn-primary')]);
  await c.waitForFunction(() => /\/orders\/\d+/.test(location.pathname), { timeout: 15000 }).catch(() => {});
  const vo = (await db.query("SELECT o.deliver_on, o.delivery_fee, o.skill_code FROM orders o JOIN users u ON u.id = o.customer_id WHERE u.username = 'zt_ui_cust' ORDER BY o.id DESC LIMIT 1")).rows[0];
  check('village order placed from the screen (₹150, our staff, delivery day)', vo && Number(vo.delivery_fee) === 150 && vo.skill_code === 'our_service_employees' && vo.deliver_on, JSON.stringify(vo));

  // ---------- customer: Share Ride ----------
  await c.goto('http://localhost:5173/category/share-ride', { waitUntil: 'networkidle2' });
  await c.waitForSelector('.ride-search');
  const tomorrow = new Date(Date.now() + 330 * 60000 + 864e5).toISOString().slice(0, 10);
  const dep = (await db.query("SELECT to_char(depart_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') d FROM share_rides WHERE id = $1", [ride.id])).rows[0].d;
  await c.evaluate((d) => {
    const i = document.querySelector('.ride-search input[type=date]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(i, d);
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  }, dep);
  await c.click('.ride-search button.btn-primary');
  await c.waitForSelector('.ride-card', { timeout: 15000 });
  check('search: the Ertiga journey shows with 5 seats left and prices', (await c.$eval('.ride-results', (x) => x.innerText)).includes('5 seats left'), dep + ' vs ' + tomorrow);
  check('Share Ride page: no sideways scroll on phone', await noScroll(c));
  await c.screenshot({ path: 'shots/ride-search.png', fullPage: true });
  await c.click(`a[href^="/share-ride/ride/${ride.id}?"]`);
  await c.waitForSelector('.seatmap');
  check('seat map: real Ertiga rows (Front, Middle, Back) with the front seat not for sale', (await c.$$('.seat-blocked')).length === 1 && (await c.$$('.seat-free')).length === 5);
  const free = await c.$$('.seat-free');
  await free[0].click();
  await free[1].click();
  await c.waitForSelector('.ride-book-bar b');
  check('choosing 2 seats shows the total (₹600)', (await c.$eval('.ride-book-bar', (x) => x.innerText)).includes('₹600'));
  const nameInputs = await c.$$('input[placeholder="Passenger name"]');
  await nameInputs[1].type('Zt Second');
  await c.click('.agree input');
  await c.screenshot({ path: 'shots/ride-seats.png', fullPage: true });
  await Promise.all([c.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), c.click('.ride-book-bar button')]);
  await c.waitForSelector('.ride-pay', { timeout: 15000 });
  check('booking page: 15-minute hold, UPI button and QR', (await text(c)).includes('Seats held for you') && !!(await c.$('.ride-qr svg')) && !!(await c.$('a[href^="upi://pay"]')));
  await c.screenshot({ path: 'shots/ride-pay.png', fullPage: true });
  await c.type('.ride-pay input', '765432109876');
  await clickText(c, '.ride-pay button', 'I have paid');
  await c.waitForFunction(() => document.body.innerText.includes('Waiting for the car owner'), { timeout: 15000 });
  check('after "I have paid": waiting for the owner', true);

  // owner confirms in the agent app
  await o.reload({ waitUntil: 'networkidle2' });
  await o.waitForSelector('.ride-waiting', { timeout: 20000 });
  check('owner sees "Check these payments" with the UTR', (await o.$eval('.ride-waiting', (x) => x.innerText)).includes('765432109876'));
  await o.screenshot({ path: 'shots/owner-check-payment.png', fullPage: true });
  await clickText(o, '.ride-waiting button', 'Received');
  await clickText(o, '.modal button', 'Yes, received');
  await o.waitForFunction(() => !document.querySelector('.ride-waiting'), { timeout: 15000 }).catch(() => {});
  await c.reload({ waitUntil: 'networkidle2' });
  await c.waitForFunction(() => document.body.innerText.includes('Download ticket'), { timeout: 15000 });
  check('customer: confirmed ticket with download + WhatsApp share + owner phone', (await text(c)).includes(`+91 ${OWNER}`) && !!(await c.$('a[href^="https://wa.me/"]')));
  await c.screenshot({ path: 'shots/ride-ticket.png', fullPage: true });
  await c.goto('http://localhost:5173/share-ride/tickets', { waitUntil: 'networkidle2' });
  check('My tickets lists it', (await text(c)).includes('Confirmed'));

  // agent application page: the car-owner choice and car fields
  const g = await page();
  await g.goto('http://localhost:5174/agent/apply', { waitUntil: 'networkidle2' });
  await g.type('input[type=tel]', '9000000985');
  await g.click('fieldset button.btn-primary');
  await g.waitForSelector('.test-code b');
  await g.type('.code-input', await g.$eval('.test-code b', (b) => b.textContent));
  await g.click('fieldset button.btn-primary');
  await g.waitForSelector('.owner-type');
  await clickText(g, '.owner-type button', 'Car owner');
  await g.waitForSelector('.agent-form');
  const ap = await text(g);
  check('apply: car owner form asks car model, number, yellow plate, RC/permit/insurance (no work types)', ap.includes('Car model') && ap.includes('yellow') && ap.includes('Taxi / contract-carriage permit') && !ap.includes('What work will you do'));
  await g.screenshot({ path: 'shots/apply-car-owner.png', fullPage: true });

  // HQ: watches Share Ride
  const s = await page(1280, 900);
  await passwordLogin(s, 'http://localhost:5176', 'zt_super');
  await s.goto('http://localhost:5176/super/share-ride', { waitUntil: 'networkidle2' });
  await s.waitForSelector('.share-admin');
  check('HQ: sees the car, read-only (no Approve/Remove buttons)', (await text(s)).includes('TS36T9981') && (await text(s)).includes('HQ view') && !(await s.$('.row-actions button')));
} finally {
  await browser.close();
  await wipe();
  await db.end();
}
check('no page errors', !errors.length, errors.join(' | '));
console.log(`\n${pass} passed, ${fails} failed`);
