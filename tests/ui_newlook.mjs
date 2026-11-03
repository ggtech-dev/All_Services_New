// New look, phase 1 — on Android (Pixel), Samsung Galaxy, iPhone and laptop: welcome screen, home (guest + logged in),
// icon tiles, search, bottom tabs, cart bar above the tabs, profile log out. Screenshots in shots/newlook/.
import fs from 'node:fs';
import puppeteer, { KnownDevices } from 'puppeteer-core';
import './testadmin.mjs';
import { makeCustomer } from './test_helpers.mjs';
import { withLocation } from './geo_browser.mjs';
const OUT = 'shots/newlook';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fails = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x !== '' ? ` — ${String(x).slice(0, 160)}` : ''}`); c ? pass++ : fails++; };
await makeCustomer('zt_look', 'Ravi Kumar', '9000000971');
const U = process.env.APP_URL || 'http://localhost:5173';
const DEVICES = [
  ['android-pixel', KnownDevices['Pixel 7'] || KnownDevices['Pixel 5']],
  ['samsung-galaxy', KnownDevices['Galaxy S9+'] || KnownDevices['Galaxy S8']],
  ['iphone', KnownDevices['iPhone 15 Pro'] || KnownDevices['iPhone 13']],
  ['laptop', { viewport: { width: 1366, height: 800 }, userAgent: '' }],
];
const browser = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });
withLocation(browser); // 📍 a phone in Siddipet with location allowed
const errors = [];
const noScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const visible = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; }, sel);
try {
  for (const [name, dev] of DEVICES) {
    const ctx = await browser.createBrowserContext();
    const p = await ctx.newPage();
    if (dev.userAgent) await p.emulate(dev); else await p.setViewport(dev.viewport);
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    const phone = name !== 'laptop';

    // 1) first visit → welcome screen
    await p.goto(`${U}/`, { waitUntil: 'networkidle2' });
    await p.waitForSelector('.welcome', { timeout: 15000 }).catch(() => {});
    check(`${name}: first visit shows the welcome screen`, new URL(p.url()).pathname === '/welcome' && (await p.evaluate(() => document.body.innerText)).includes('Get Started'));
    const photoOk = await p.evaluate(() => new Promise((r) => { const i = new Image(); i.onload = () => r(i.naturalWidth > 100); i.onerror = () => r(false); i.src = '/welcome-bridge-tall.jpg'; }));
    check(`${name}: Siddipet photo loads`, photoOk);
    check(`${name}: welcome fits the screen`, await noScroll(p));
    await p.screenshot({ path: `${OUT}/${name}-1-welcome.png` });

    // 2) explore as guest → home
    await p.click('.welcome-explore');
    await p.waitForSelector('a.cat-tile', { timeout: 15000 });
    const tiles = await p.$$eval('a.cat-tile', (t) => t.map((x) => x.innerText.trim()));
    check(`${name}: home has the icon tiles (${tiles.length})`, tiles.length >= 10 && (await p.$$('a.cat-tile svg')).length === tiles.length, tiles.join(' | '));
    check(`${name}: greeting (Good Morning / Afternoon / Evening) + search bar`, (await p.evaluate(() => document.querySelector('.home-head').innerText)).match(/Good (Morning|Afternoon|Evening)/) && !!(await p.$('.home-search input')));
    check(`${name}: bottom tabs ${phone ? 'shown' : 'hidden on laptop'}`, (await visible(p, '.bottom-tabs')) === phone);
    check(`${name}: home has no sideways scroll`, await noScroll(p));
    await p.screenshot({ path: `${OUT}/${name}-2-home-guest.png`, fullPage: true });
    await p.goto(`${U}/`, { waitUntil: 'networkidle2' });
    check(`${name}: welcome shown only once`, new URL(p.url()).pathname === '/');

    // 3) search
    await p.type('.home-search input', 'plumb');
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.keyboard.press('Enter')]);
    await p.waitForSelector('.search-row', { timeout: 15000 }).catch(() => {});
    check(`${name}: search "plumb" finds Plumber / plumbing`, /Plumb/i.test(await p.evaluate(() => document.body.innerText)));
    await p.goto(`${U}/search?q=tomato`, { waitUntil: 'networkidle2' });
    await p.waitForSelector('.search-row', { timeout: 15000 }).catch(() => {});
    check(`${name}: search "tomato" finds the item`, /Tomato/i.test(await p.evaluate(() => document.body.innerText)));
    await p.screenshot({ path: `${OUT}/${name}-3-search.png` });

    // 4) shop page: the cart bar stays above the tab bar
    await p.goto(`${U}/service/food-daily-fruit-delivery`, { waitUntil: 'networkidle2' });
    await p.waitForSelector('.add-btn');
    await p.click('.add-btn');
    await p.waitForSelector('.cart-bar');
    if (phone) {
      await p.evaluate(() => window.scrollTo(0, 0));
      const gap = await p.evaluate(() => document.querySelector('.bottom-tabs').getBoundingClientRect().top - document.querySelector('.cart-bar').getBoundingClientRect().bottom);
      check(`${name}: cart bar sits above the tab bar (not hidden)`, gap >= 0, `${gap}px`);
    }
    await p.screenshot({ path: `${OUT}/${name}-4-shop.png` });

    // 5) logged in: name in the greeting, Orders / Profile tabs, log out in Profile
    await p.goto(`${U}/login?method=password`, { waitUntil: 'networkidle2' });
    await p.type('input[autocomplete=username]', 'zt_look');
    await p.type('input[autocomplete=current-password]', process.env.TEST_STAFF_PW);
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
    await p.waitForSelector('.home-hello', { timeout: 15000 });
    check(`${name}: greeting uses the customer's name`, (await p.$eval('.home-hello h1', (x) => x.textContent)).includes('Ravi'));
    await p.screenshot({ path: `${OUT}/${name}-5-home-user.png` });
    if (phone) {
      await p.evaluate(() => document.querySelector('.bottom-tabs a[href="/account"]').click());
      await p.waitForSelector('.logout-btn', { timeout: 15000 });
      check(`${name}: Profile tab → account page with Log out`, true);
      await p.evaluate(() => document.querySelector('.bottom-tabs a[href="/orders"]').click());
      await p.waitForFunction(() => location.pathname === '/orders', { timeout: 10000 });
      check(`${name}: Orders tab works`, true);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
check('no page errors', !errors.length, errors.join(' | '));
console.log(`\n${pass} passed, ${fails} failed`);
