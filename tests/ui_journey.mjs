// 🧭 Customer walk-through of EVERY category and EVERY service (2026-10-24): home → category → service (shop / booking /
// types) → back. Each page: back button that really goes back, no page errors, no sideways scroll, no broken photos,
// no "undefined / NaN / null / ⏱ —" text, a main button; booking pages: address form, book button, note full width.
// Lists services without a photo (info). node ui_journey.mjs [width=390]
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { withLocation } from './geo_browser.mjs';
const W = Number(process.argv[2] || 390), H = W < 700 ? 844 : 800;
const OUT = `./shots/journey-${W}`;
fs.mkdirSync(OUT, { recursive: true });
const B = 'http://localhost:5173';
const API = 'http://localhost:5000/api';
const problems = [], noPhoto = [];
let pages = 0;
const problem = (where, what) => { problems.push(`${where}: ${what}`); console.log(`  ✗ ${where}: ${what}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = withLocation(await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true }));
const p = await (await b.createBrowserContext()).newPage();
await p.setViewport({ width: W, height: H, isMobile: W < 700, hasTouch: W < 700 });
let errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.evaluateOnNewDocument(() => { localStorage.setItem('as_welcome_seen', '1'); localStorage.setItem('as_install_dismissed', String(Date.now())); });
await p.goto(`${B}/login`, { waitUntil: 'networkidle2' });
await p.type('input[autocomplete=username]', '9000300106');
await p.type('input[autocomplete=current-password]', process.env.TEST_USER_PW);
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);

// one look at the page a customer is on
async function inspect(where, { checkout = false } = {}) {
  pages++;
  await p.evaluate(async () => { for (let y = 0; y < Math.min(document.body.scrollHeight, 9000); y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
  await wait(500);
  const st = await p.evaluate((checkout) => {
    const vis = (e) => e && e.offsetParent !== null;
    const main = document.querySelector('main') || document.body;
    const text = main.innerText;
    const broken = [...main.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).map((i) => i.getAttribute('src').slice(0, 60));
    const out = {
      h1: document.querySelector('main h1')?.innerText.trim() || '', back: vis(document.querySelector('main .back-link')),
      sideways: document.documentElement.scrollWidth > innerWidth + 1, broken,
      bad: (text.match(/\bundefined\b|\bNaN\b|\bnull\b|⏱ ?—|\[object Object\]/g) || []).slice(0, 3),
      button: [...main.querySelectorAll('a, button')].some((x) => vis(x) && !x.classList.contains('back-link')),
      cut: [...main.querySelectorAll('.btn, .add-btn')].filter((x) => vis(x) && x.scrollWidth > x.clientWidth + 2).map((x) => x.innerText.trim()).slice(0, 2),
    };
    if (checkout) {
      const note = document.querySelector('.totals .partner-note'), box = document.querySelector('.totals');
      out.noteNarrow = !!(note && box && note.getBoundingClientRect().width < box.getBoundingClientRect().width * 0.85);
      out.address = !!document.querySelector('input[placeholder*="Flat"], textarea');
      out.submit = [...document.querySelectorAll('button[type=submit], .checkout button.btn-primary')].map((x) => x.innerText.trim()).filter(Boolean)[0] || '';
      out.pin = document.querySelector('input[inputmode=numeric][maxlength="6"]')?.placeholder;
    }
    return out;
  }, checkout);
  if (!st.h1) problem(where, 'no page title');
  if (!st.back) problem(where, 'no back button');
  if (st.sideways) problem(where, 'page scrolls sideways');
  if (st.broken.length) problem(where, `broken photo ${st.broken.join(', ')}`);
  if (st.bad.length) problem(where, `odd text on screen: ${st.bad.join(', ')}`);
  if (!st.button) problem(where, 'no button to go on');
  if (st.cut.length) problem(where, `button text cut: ${st.cut.join(', ')}`);
  if (checkout) {
    if (!st.address) problem(where, 'no address form');
    if (!st.submit) problem(where, 'no book / place-order button');
    if (st.noteNarrow) problem(where, 'note squeezed in the price box');
    if (st.pin && st.pin !== '502103') problem(where, `pincode hint ${st.pin}`);
  }
  if (errs.length) { problem(where, `page error: ${errs[0]}`); errs = []; }
  return st;
}
// the back button takes the customer back to `expect`
async function goBack(where, expect) {
  const link = await p.$('main .back-link');
  if (!link) return;
  await link.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await Promise.all([p.waitForFunction((e) => location.pathname + location.search === e, { timeout: 8000 }, expect).catch(() => {}), link.click()]);
  await wait(300);
  const now = await p.evaluate(() => location.pathname + location.search);
  if (now !== expect) problem(where, `back button went to ${now}, not ${expect}`);
}

const cats = await (await fetch(`${API}/categories`)).json();
const OWN_PAGE = { 'share-ride': '/share-ride', 'daily-workers': '/workers', 'digital-services': '/digital' };
console.log(`Width ${W}: ${cats.length} categories`);
for (const c of cats) {
  const catUrl = `/category/${c.slug}`;
  await p.goto(`${B}/`, { waitUntil: 'networkidle2' });
  await p.waitForSelector(`a[href="${catUrl}"]`, { timeout: 8000 }).catch(() => {});
  const tile = await p.$(`.cat-grid a[href="${catUrl}"]`);
  if (!tile) { problem(c.name, 'no tile on the home page'); continue; }
  await tile.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), tile.click()]);
  await wait(600);
  const landed = await p.evaluate(() => location.pathname);
  console.log(`• ${c.name} → ${landed}`);
  if (OWN_PAGE[c.slug]) {
    await inspect(`${c.name} (own page)`);
    await p.screenshot({ path: `${OUT}/${c.slug}.png` });
    continue;
  }
  await p.waitForSelector('.service-card', { timeout: 10000 }).catch(() => {});
  await inspect(c.name);
  await p.screenshot({ path: `${OUT}/${c.slug}.png` });
  await goBack(c.name, '/');
  // every service on the category page
  await p.goto(`${B}${catUrl}`, { waitUntil: 'networkidle2' });
  await p.waitForSelector('.service-card', { timeout: 10000 }).catch(() => {});
  const services = await p.$$eval('.service-card', (cards) => cards.map((x) => ({
    name: x.querySelector('h3')?.innerText.trim(), href: x.querySelector('a.btn')?.getAttribute('href'), button: x.querySelector('a.btn')?.innerText.trim(),
    photo: !x.querySelector('.img-fallback'),
  })));
  for (const s of services) {
    if (!s.photo) noPhoto.push(`${c.name} › ${s.name}`);
    if (!s.href) { problem(`${c.name} › ${s.name}`, 'no button on the card'); continue; }
    await p.goto(`${B}${catUrl}`, { waitUntil: 'networkidle2' });
    await p.waitForSelector('.service-card a.btn', { timeout: 10000 }).catch(() => {});
    const btn = await p.$(`.service-card a.btn[href="${s.href.replace(/"/g, '\\"')}"]`);
    if (!btn) { problem(`${c.name} › ${s.name}`, 'card button not found'); continue; }
    await btn.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await wait(150);
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), btn.click()]);
    await wait(700);
    const where = `${c.name} › ${s.name} [${s.button}]`;
    const isCheckout = s.href.startsWith('/checkout');
    if (isCheckout) await p.waitForSelector('.checkout', { timeout: 10000 }).catch(() => {});
    else await p.waitForSelector('main h1', { timeout: 10000 }).catch(() => {});
    await inspect(where, { checkout: isCheckout });
    // a "types" page (Home Doctor Visit…): open the first type's booking page as well
    if (s.href.startsWith('/care/')) {
      const first = await p.$('main a.btn[href^="/checkout"], main a[href^="/checkout"]');
      if (first) {
        await first.evaluate((e) => e.scrollIntoView({ block: 'center' }));
        await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), first.click()]);
        await p.waitForSelector('.checkout', { timeout: 10000 }).catch(() => {});
        await inspect(`${where} › first type`, { checkout: true });
        await goBack(`${where} › first type`, s.href);
      } else problem(where, 'types page has no type to book');
    }
    await goBack(where, catUrl);
  }
}
await b.close();
console.log(`\nWidth ${W}: ${pages} pages checked.`);
console.log(problems.length ? `PROBLEMS (${problems.length}):\n - ${problems.join('\n - ')}` : 'NO PROBLEMS FOUND');
console.log(`\nServices without a photo yet (${noPhoto.length}): ${noPhoto.join(' | ')}`);
