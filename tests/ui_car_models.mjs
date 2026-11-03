// 🚗 Browser: customer checkout for Car Booking shows the car photo cards (Any car + 12 models), picking Ertiga highlights
// it; the car partner (agent9, Car Rental) has a "My cars" tab with the add-car form. Screenshots in shots/.
import pg from 'pg';
import puppeteer from 'puppeteer-core';
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 200)}` : ''}`); c ? pass++ : fail++; };
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path = all_services');
const b = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe') });
const errs = [];
try {
  const p = await b.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('as_welcome_seen', '1'); localStorage.setItem('as_city', '1'); } catch {} });
  await p.goto('http://localhost:5173/login', { waitUntil: 'networkidle2' });
  await p.type('input[autocomplete=username], input[type=tel]', '9000300101');
  await p.type('input[autocomplete=current-password]', process.env.TEST_USER_PW);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
  const svc = (await db.query("SELECT id FROM services WHERE slug = 'vehicle-rental-car-booking'")).rows[0].id;
  await p.goto(`http://localhost:5173/checkout?service=vehicle-rental-car-booking`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('.car-cards', { timeout: 8000 }).catch(() => {});
  const cards = await p.evaluate(() => [...document.querySelectorAll('.car-card b')].map((x) => x.innerText));
  check(`car cards: ${cards.length} (${cards.slice(0, 4).join(', ')}…)`, cards.length === 13 && cards[0] === 'Any car');
  await p.evaluate(() => [...document.querySelectorAll('.car-card')].find((c) => /Ertiga/.test(c.innerText)).click());
  await new Promise((r) => setTimeout(r, 300));
  const st = await p.evaluate(() => ({ active: document.querySelector('.car-card.active b')?.innerText, hint: document.querySelector('.car-pick > small')?.innerText,
    wide: document.documentElement.scrollWidth > innerWidth + 1 }));
  check(`tap Ertiga → selected (${st.active}); "${st.hint}"`, st.active === 'Maruti Ertiga' && /Only partners with a Maruti Ertiga/.test(st.hint) && !st.wide);
  for (const h of await p.$$('.car-card')) { await h.scrollIntoView(); await new Promise((r) => setTimeout(r, 120)); } // photos load as they scroll into view
  await new Promise((r) => setTimeout(r, 800));
  const img = await p.evaluate(() => { const i = [...document.querySelectorAll('.car-card-img img')]; return { n: i.length, broken: i.filter((x) => !x.complete || !x.naturalWidth).length }; });
  check(`car photos: ${img.n} shown, ${img.broken} broken`, img.n === 12 && !img.broken);
  const el = await p.$('.car-pick');
  await el.screenshot({ path: 'shots/car-cards.png' });
  // partner: agent9 (Car Rental) → My cars
  const a = await (await b.createBrowserContext()).newPage();
  a.on('pageerror', (e) => errs.push(`agent: ${e.message}`));
  await a.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await db.query("DELETE FROM phone_otps WHERE phone = '9000300209'");
  const code = (await (await fetch('http://localhost:5000/api/auth/phone/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '9000300209' }) })).json()).devCode;
  const tok = (await (await fetch('http://localhost:5000/api/auth/phone/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '9000300209', code, portal: 'agent' }) })).json()).token;
  await a.goto('http://localhost:5174/', { waitUntil: 'networkidle2' });
  await a.evaluate((t) => { for (const k of ['as_token', 'token', 'agent_token']) localStorage.setItem(k, t); }, tok);
  await a.goto('http://localhost:5174/agent/my-cars', { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));
  const ag = await a.evaluate(() => ({ tab: [...document.querySelectorAll('.agent-tabs a')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()), h: document.querySelector('h2')?.innerText, add: !!document.querySelector('.btn-ghost') }));
  check(`partner: tabs ${ag.tab.join(' | ')}; page "${ag.h}"`, ag.tab.some((t) => /My cars/.test(t)) && /My cars/.test(ag.h || ''), JSON.stringify(ag));
  await a.screenshot({ path: 'shots/agent-my-cars.png' });
  check('no page errors', !errs.length, errs.join(' | '));
} finally {
  await db.query("DELETE FROM phone_otps WHERE phone = '9000300209'");
  await b.close();
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
