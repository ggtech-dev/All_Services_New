// PWA check of the four apps: Chrome's own installability verdict (what Android / Samsung use to offer "Install app"),
// manifest, icons (sizes, maskable, Apple touch icon), iPhone home-screen tags, service worker, offline start,
// and the login + main pages on Android Pixel, Samsung Galaxy, iPhone and laptop screens.
import puppeteer, { KnownDevices } from 'puppeteer-core';
import './testadmin.mjs';
import { agentLogin, makeCustomer } from './test_helpers.mjs';
import { withLocation } from './geo_browser.mjs';
const OUT = './shots/pwa';
import fs from 'fs';
fs.mkdirSync(OUT, { recursive: true });
const APPS = [
  { name: 'user', url: 'http://localhost:5000', start: '/', title: 'All Services', login: ['zt_pwa_cust', '?method=password'], main: ['/', '/orders', '/service/food-daily-fresh-vegetables', '/checkout'] },
  { name: 'agent', url: 'http://localhost:5001', start: '/agent', title: 'All Services Partner', login: ['zt_pwa_agent', '?method=password'], main: ['/agent', '/agent/orders', '/agent/wallet', '/agent/profile'] },
  { name: 'admin', url: 'http://localhost:5002', start: '/admin', title: 'All Services Franchise Admin', login: ['zt_admin', ''], main: ['/admin', '/admin/orders', '/admin/agents', '/admin/reports'] },
  { name: 'superadmin', url: 'http://localhost:5003', start: '/super', title: 'All Services HQ', login: ['zt_super', ''], main: ['/super', '/super/franchises', '/super/orders', '/super/products'] },
];
const DEVICES = [
  ['android-pixel', KnownDevices['Pixel 7'] || KnownDevices['Pixel 5']],
  ['samsung-galaxy', { viewport: { width: 360, height: 780, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36' }],
  ['iphone', KnownDevices['iPhone 15 Pro'] || KnownDevices['iPhone 13']],
  ['laptop', { viewport: { width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' }],
];
let pass = 0, fails = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? ` — ${String(x).slice(0, 200)}` : ''}`); c ? pass++ : fails++; };
const pngSize = (buf) => (buf.slice(1, 4).toString() === 'PNG' ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null);

// test accounts
const API = 'http://localhost:5000/api';
const call = async (p, o = {}) => { const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = `Bearer ${o.token}`; const r = await fetch(API + p, { method: o.method || 'GET', headers: h, body: o.form || (o.body && JSON.stringify(o.body)) }); return r.json().catch(() => ({})); };
await makeCustomer('zt_pwa_cust', 'PWA Customer');
const adm = (await call('/auth/login', { method: 'POST', body: { username: 'zt_admin', password: process.env.TEST_STAFF_PW, portal: 'admin' } })).token;
const loc = (await call('/localities')).find((l) => Number(l.franchise_id) === 1 && !l.is_village).id; // a Siddipet area (zt_admin is Siddipet's admin)
const fd = new FormData();
Object.entries({ username: 'zt_pwa_agent', password: process.env.TEST_STAFF_PW, full_name: 'PWA Agent', phone: '9000000092', vehicle_type: 'bike', locality_id: loc, skills: 'delivery' }).forEach(([k, v]) => fd.append(k, v));
await fetch(`${API}/admin/agents`, { method: 'POST', headers: { Authorization: `Bearer ${adm}` }, body: fd });
await agentLogin('zt_pwa_agent', '9000000092');

const browser = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });

withLocation(browser); // 📍 a phone in Siddipet with location allowed
try {
  for (const app of APPS) {
    console.log(`\n===== ${app.name} (${app.url}) =====`);
    // ---- manifest + icons + iPhone tags (plain HTTP checks)
    const html = await (await fetch(`${app.url}/login`)).text();
    const man = await (await fetch(`${app.url}/manifest.webmanifest`)).json();
    check(`${app.name}: manifest name "${man.name}"`, man.name === app.title && man.short_name && man.display === 'standalone' && man.start_url === app.start, `${man.name} / ${man.start_url}`);
    let iconsOk = true;
    for (const ic of man.icons) {
      const buf = Buffer.from(await (await fetch(app.url + ic.src)).arrayBuffer());
      const sz = pngSize(buf);
      if (!sz || `${sz[0]}x${sz[1]}` !== ic.sizes) { iconsOk = false; console.log('   icon problem', ic.src, sz); }
    }
    check(`${app.name}: icons 192/512/maskable load at the right size`, iconsOk && man.icons.some((i) => i.purpose === 'maskable'));
    const apple = Buffer.from(await (await fetch(`${app.url}/icons/apple-touch-icon.png`)).arrayBuffer());
    check(`${app.name}: iPhone home-screen icon + tags`, !!pngSize(apple) && /apple-touch-icon/.test(html) && /apple-mobile-web-app-capable" content="yes/.test(html)
      && /apple-mobile-web-app-title" content="[^"]+/.test(html) && /viewport-fit=cover/.test(html), `icon ${pngSize(apple)}`);
    check(`${app.name}: shortcuts point inside this app`, (man.shortcuts || []).every((s) => !s.url.startsWith('/agent') || app.name === 'agent'));

    // ---- Chrome's installability verdict + service worker + offline (Android Chrome rules)
    // a normal (not incognito) window: Chrome only judges installability there
    const p = await browser.defaultBrowserContext().newPage();
    await p.emulate(DEVICES[0][1]);
    await p.goto(`${app.url}/login`, { waitUntil: 'networkidle2' });
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload({ waitUntil: 'networkidle2' });
    const cdp = await p.createCDPSession();
    const inst = await cdp.send('Page.getInstallabilityErrors');
    check(`${app.name}: Chrome says INSTALLABLE (Android / Samsung "Install app")`, inst.installabilityErrors.length === 0, JSON.stringify(inst.installabilityErrors));
    const ctrl = await p.evaluate(() => !!navigator.serviceWorker.controller);
    check(`${app.name}: service worker active`, ctrl);
    await p.setOfflineMode(true);
    await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    const offline = await p.evaluate(() => (document.querySelector('#root')?.innerText || '').trim().length);
    check(`${app.name}: opens offline (app shell from the phone)`, offline > 20, `${offline} chars`);
    await p.setOfflineMode(false);
    await p.close();

    // ---- each device: login, main pages, layout
    for (const [dev, desc] of DEVICES) {
      const c = await browser.createBrowserContext();
      const pg = await c.newPage();
      await pg.emulate(desc);
      const errs = [];
      pg.on('pageerror', (e) => errs.push(e.message));
      pg.on('dialog', (d) => d.dismiss());
      await pg.goto(`${app.url}/login${app.login[1]}`, { waitUntil: 'networkidle2' });
      await pg.screenshot({ path: `${OUT}/${app.name}-${dev}-login.png` });
      const loginWide = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      await pg.waitForSelector('input[autocomplete=username]');
      await pg.type('input[autocomplete=username]', app.login[0]);
      await pg.type('input[autocomplete=current-password]', process.env.TEST_STAFF_PW);
      await Promise.all([pg.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), pg.click('form button.btn-primary')]);
      const logged = new URL(pg.url()).pathname.startsWith(app.start);
      let wide = [], empty = [];
      for (const path of app.main) {
        await pg.goto(app.url + path, { waitUntil: 'networkidle2' });
        await new Promise((r) => setTimeout(r, 500));
        const r = await pg.evaluate(() => ({ w: document.documentElement.scrollWidth - innerWidth, t: (document.querySelector('#root')?.innerText || '').trim().length }));
        if (r.w > 2) wide.push(`${path} +${r.w}px`);
        if (r.t < 40) empty.push(path);
      }
      await pg.goto(app.url + app.main[0], { waitUntil: 'networkidle2' });
      await pg.screenshot({ path: `${OUT}/${app.name}-${dev}-home.png` });
      check(`${app.name} on ${dev}: login + ${app.main.length} pages fit the screen`, logged && loginWide <= 2 && !wide.length && !empty.length && !errs.length,
        [!logged && 'login failed', loginWide > 2 && `login +${loginWide}px`, ...wide, ...empty.map((e) => `empty ${e}`), ...errs].filter(Boolean).join(', '));
      await c.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fails} failed`);
