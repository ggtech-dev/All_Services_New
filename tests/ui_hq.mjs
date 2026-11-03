// Screens for: free-delivery banner per mobile number, ⏰ overdue orders (franchise admin), HQ view-only city pages,
// the HQ Report Center (every report clicked), and the Disable warning (cancelled — nothing is switched off).
// Needs sim_all.mjs to have run. Screenshots in shots/hq/.
import fs from 'node:fs';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import { withLocation } from './geo_browser.mjs';
await import('./testadmin.mjs');
const OUT = './shots/hq';
fs.mkdirSync(OUT, { recursive: true });
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 220).replace(/\n/g, ' ')}` : ''}`); c ? pass++ : fail++; };
const browser = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });
withLocation(browser); // 📍 a phone in Siddipet with location allowed
const errors = [];
async function page(w, h, mobile = true) {
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`));
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('as_welcome_seen', '1'); } catch {} });
  return p;
}
const text = (p) => p.evaluate(() => document.body.innerText);
const waitText = (p, re, ms = 12000) => p.waitForFunction((src, fl) => new RegExp(src, fl).test(document.body.innerText), { timeout: ms }, re.source, re.flags).then(() => true, () => false);
const sideways = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
const go = (p, url) => p.goto(url, { waitUntil: 'networkidle2' });
const hasButton = (p, re) => p.evaluate((src) => [...document.querySelectorAll('button, a.btn')].some((b) => new RegExp(src).test(b.innerText) && b.offsetParent !== null), re.source);
const clickText = async (p, sel, re) => {
  const ok = await p.evaluate((s, src) => { const el = [...document.querySelectorAll(s)].find((b) => new RegExp(src).test(b.innerText)); if (el) el.click(); return !!el; }, sel, re.source);
  if (!ok) throw new Error(`no ${sel} matching ${re}`);
};
const login = async (p, base, user, pw) => {
  await go(p, `${base}/login`);
  await p.waitForSelector('input[autocomplete=username]');
  await p.type('input[autocomplete=username]', user);
  await p.type('input[autocomplete=current-password]', pw);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // ---------- 🎉 banner: only while the mobile number still has its free delivery ----------
  const u8 = await page(390, 844);
  await login(u8, 'http://localhost:5173', 'user8', process.env.TEST_USER_PW);
  check('user8 (no free delivery used yet) sees "Free delivery on your first order"', await waitText(u8, /Free delivery on your first order/));
  await u8.screenshot({ path: `${OUT}/1-user8-banner.png` });
  const u1 = await page(390, 844);
  await login(u1, 'http://localhost:5173', 'user1', process.env.TEST_USER_PW);
  await waitText(u1, /Good \w+, User1/);
  await pause(1500);
  check('user1 (already had the free delivery) does NOT see the banner', !/Free delivery on your first order/.test(await text(u1)));
  await u1.screenshot({ path: `${OUT}/2-user1-no-banner.png` });
  const guest = await page(390, 844);
  await go(guest, 'http://localhost:5173/');
  check('a visitor who is not logged in sees the banner', await waitText(guest, /Free delivery on your first order/));

  // ---------- ⏰ franchise admin: overdue ----------
  const late = (await db.query("SELECT o.id FROM orders o JOIN users u ON u.id = o.customer_id WHERE u.phone LIKE '90003001%' AND o.status IN ('placed','assigned','picked_up') AND fn_order_overdue(o) IS NOT NULL ORDER BY o.id LIMIT 1")).rows[0];
  check('there is a sim order that is overdue (from sim_all)', !!late);
  const ad = await page(1366, 800, false);
  await login(ad, 'http://localhost:5175', 'zt_admin', process.env.TEST_STAFF_PW);
  check('admin home: "Overdue orders" tile', await waitText(ad, /Overdue orders/));
  check('admin sidebar: red ⏰ count next to Orders', await ad.waitForSelector('.admin-nav-link .nav-badge-alert', { timeout: 10000 }).then(() => true, () => false));
  await ad.screenshot({ path: `${OUT}/3-admin-home.png` });
  await go(ad, 'http://localhost:5175/admin/orders');
  check('admin Orders: red "orders are overdue" bar', await waitText(ad, /overdue — not taken or not finished/));
  await clickText(ad, '.overdue-alert', /Show them/);
  await waitText(ad, new RegExp(`#${late?.id}`));
  check(`admin Overdue tab lists #${late?.id} with the red badge`, await ad.evaluate((id) => [...document.querySelectorAll('tr.row-overdue')].some((tr) => tr.innerText.includes(`#${id}`) && tr.querySelector('.overdue-badge')), late?.id));
  await ad.screenshot({ path: `${OUT}/4-admin-overdue-tab.png`, fullPage: true });
  await ad.evaluate((id) => [...document.querySelectorAll('tr.row-overdue')].find((tr) => tr.innerText.includes(`#${id}`))?.click(), late?.id);
  check('admin order window: "Was due by …" note and Assign / Cancel buttons', await waitText(ad, /Was due by/) && await hasButton(ad, /Cancel order/));
  await ad.screenshot({ path: `${OUT}/5-admin-overdue-order.png` });

  // ---------- 👁️ HQ: city pages are view only ----------
  const hq = await page(1366, 800, false);
  await login(hq, 'http://localhost:5176', 'zt_super', process.env.TEST_STAFF_PW);
  check('HQ sidebar: "Report Center" and "Watch cities · view only"', await waitText(hq, /Report Center/) && /Watch cities · view only/i.test(await text(hq)));
  await go(hq, `http://localhost:5176/super/orders?open=${late?.id}`);
  await waitText(hq, /View only/);
  check('HQ order window: "View only" note, no Assign, no Cancel order', !(await hasButton(hq, /^Assign$|Cancel order/)) && /View only/.test(await text(hq)));
  check('HQ order window still shows the overdue note', /Was due by/.test(await text(hq)));
  await hq.screenshot({ path: `${OUT}/6-hq-order-view-only.png` });
  await hq.keyboard.press('Escape');
  await go(hq, 'http://localhost:5176/super/agents');
  await waitText(hq, /Agent1 Ravi/);
  check('HQ Agents: view-only note, no "Add agent" / "Copy apply link"', /View only/.test(await text(hq)) && !(await hasButton(hq, /Add agent|Copy apply link/)));
  await clickText(hq, 'tr.clickable', /Agent1 Ravi/);
  await waitText(hq, /Wallet history/);
  check('HQ agent window: no Suspend / Remove / wallet Save, types shown as chips', !(await hasButton(hq, /^Suspend$|Remove$|^Save$|Save types|Approve/)) && /View only/.test(await text(hq)));
  await hq.screenshot({ path: `${OUT}/7-hq-agent-view-only.png`, fullPage: true });
  await hq.keyboard.press('Escape');
  // 🗺️ areas & villages are HQ's: HQ adds / edits them; the franchise admin asks HQ
  await go(hq, 'http://localhost:5176/super/areas');
  check('HQ Areas: can add and edit areas / villages', await waitText(hq, /Add area \/ village/) && await hasButton(hq, /^Edit$/));
  await go(ad, 'http://localhost:5175/admin/areas');
  check('franchise admin Areas: "Ask HQ for a new area / village" + "Ask to switch off", no Edit', await waitText(ad, /Ask HQ for a new area/) && await hasButton(ad, /Ask to switch off/) && !(await hasButton(ad, /^Edit$/)));
  await ad.screenshot({ path: `${OUT}/7b-admin-areas-ask.png`, fullPage: true });
  for (const [path, re, label] of [['shops', /Add shop/, 'Shops']]) {
    await go(hq, `http://localhost:5176/super/${path}`);
    await waitText(hq, /View only/);
    check(`HQ ${label}: view-only note, no add / edit buttons`, /View only/.test(await text(hq)) && !(await hasButton(hq, re)) && !(await hasButton(hq, /^Edit$/)));
  }
  await go(hq, 'http://localhost:5176/super/complaints');
  check('HQ Complaints: view-only note', await waitText(hq, /View only/));

  // ---------- 📈 HQ Report Center: every report ----------
  await go(hq, 'http://localhost:5176/super/reports');
  await waitText(hq, /Summary/);
  const items = await hq.$$eval('.rc-item', (b) => b.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  check(`Report Center lists 15 numbered reports (${items.length})`, items.length === 15, items.join(' | '));
  for (let i = 0; i < items.length; i++) {
    await hq.evaluate((k) => document.querySelectorAll('.rc-item')[k].click(), i);
    const title = items[i].replace(/^\d+\s*\S+\s*/, '');
    await hq.waitForFunction((t) => document.querySelector('.rc-head h2')?.innerText.includes(t), { timeout: 8000 }, title).catch(() => {});
    await hq.waitForFunction(() => !document.querySelector('.rc-view .spinner'), { timeout: 12000 }).catch(() => {});
    await pause(300);
    const st = await hq.evaluate(() => ({
      head: document.querySelector('.rc-head h2')?.innerText || '',
      error: document.querySelector('.rc-view .alert')?.innerText || '',
      content: !!document.querySelector('.rc-view table, .rc-view .kpi-grid, .rc-view svg, .rc-view .empty'),
    }));
    check(`Report ${i + 1} · ${title}: opens with content`, st.head.includes(title) && !st.error && st.content, JSON.stringify(st));
    if ([0, 1, 8, 10, 14].includes(i)) await hq.screenshot({ path: `${OUT}/8-report-${String(i + 1).padStart(2, '0')}.png`, fullPage: true });
  }
  // city chooser + period
  await hq.select('.rc-city select', '1');
  await waitText(hq, /Siddipet/);
  check('Report Center: choosing a city keeps the report list', (await hq.$$('.rc-item')).length === 15);
  await clickText(hq, '.rc-top .tabs button', /^Today$/);
  await hq.evaluate(() => document.querySelectorAll('.rc-item')[0].click());
  // today's revenue straight from the database (Siddipet = franchise 1, the city chosen above)
  const todayIST = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const rev = Number((await db.query('SELECT fn_report_kpis($1::date, $1::date, 1) k', [todayIST])).rows[0].k.revenue);
  const revText = `₹${rev.toLocaleString('en-IN')}`;
  check(`Report Center: Today's summary shows today's revenue ${revText}`, await waitText(hq, new RegExp(revText.replace(/[₹,]/g, (c) => `\\${c}`))));
  await hq.select('.rc-city select', '');
  // phone
  const hp = await page(390, 844);
  await login(hp, 'http://localhost:5176', 'zt_super', process.env.TEST_STAFF_PW);
  await go(hp, 'http://localhost:5176/super/reports?r=agents');
  await waitText(hp, /Agent performance/);
  check('Report Center on a phone: no sideways scroll, reports as a swipe row', !(await sideways(hp)) && await hp.evaluate(() => getComputedStyle(document.querySelector('.rc-list')).display === 'flex'));
  await hp.screenshot({ path: `${OUT}/9-report-phone.png` });

  // ---------- ⚠️ Disable warning (cancelled) ----------
  await go(hq, 'http://localhost:5176/super/franchises');
  await hq.waitForSelector('.status-select');
  await hq.select('.status-select', 'disabled');
  check('Disable shows the open work in the city before confirming', await waitText(hq, /still has open work/) && /waiting for an agent/.test(await text(hq)));
  await hq.screenshot({ path: `${OUT}/10-disable-warning.png` });
  await clickText(hq, '.modal button', /^Cancel$/);
  await pause(500);
  check('cancelled: the franchise is still active', (await db.query('SELECT status FROM franchises WHERE id = 1')).rows[0].status === 'active');
  await hq.select('.status-select', 'suspended');
  check('Suspend says: Disable first, let them finish', await waitText(hq, /Disable<\/b> first|Disable first/));
  await clickText(hq, '.modal button', /^Cancel$/);

  check('no page errors', !errors.length, errors.join(' | '));
} catch (e) {
  check('screens run without crashing', false, e.stack);
} finally {
  await browser.close();
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
