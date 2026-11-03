// 🔎 Customer app audit (phone 390, logged in as user1): every page — page errors, console errors, failed requests,
// broken images, wider than the screen, small tap targets (< 40 px), slow loads; then the same pages in Telugu:
// visible English words left (rough). Read-only (cart emptied at the end).
import puppeteer from 'puppeteer-core';
const B = 'http://localhost:5173', API = 'http://localhost:5000/api';
const cats = await (await fetch(`${API}/categories`, { headers: { 'x-franchise': '1' } })).json();
const pages = ['/', '/search?q=milk', '/orders', '/account', '/offers', '/transport', '/share-ride', '/meal', '/digital', '/workers', '/about', '/advertise', '/my-offers', '/share-ride/tickets'];
for (const c of cats) {
  pages.push(`/category/${c.slug}`);
  const d = await (await fetch(`${API}/categories/${c.slug}`, { headers: { 'x-franchise': '1' } })).json();
  for (const s of (d.services || []).slice(0, 3)) pages.push(`/service/${s.slug}`);
}
const b = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe') });
const ctx = await b.createBrowserContext();
const p = await ctx.newPage();
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
await p.evaluateOnNewDocument(() => { try { localStorage.setItem('as_welcome_seen', '1'); localStorage.setItem('as_city', '1'); } catch {} });
await p.goto(`${B}/login`, { waitUntil: 'networkidle2' });
await p.type('input[autocomplete=username], input[type=tel]', '9000300101');
await p.type('input[autocomplete=current-password]', process.env.TEST_USER_PW);
await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
const issues = [];
let cur = '';
p.on('pageerror', (e) => issues.push(`${cur} PAGE ERROR ${e.message.slice(0, 120)}`));
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED|net::ERR/i.test(m.text())) issues.push(`${cur} console: ${m.text().slice(0, 120)}`); });
p.on('response', (r) => { if (r.status() >= 400 && /\/api\//.test(r.url())) issues.push(`${cur} API ${r.status()} ${r.url().replace(/.*\/api/, '/api').slice(0, 80)}`); });
const slow = [], small = {}, wide = [], broken = [];
for (const path of [...new Set(pages)]) {
  cur = path;
  const t0 = Date.now();
  await p.goto(B + path, { waitUntil: 'networkidle2' }).catch(() => {});
  const ms = Date.now() - t0;
  if (ms > 2500) slow.push(`${path} ${ms} ms`);
  for (let i = 0; i < 8; i++) { const end = await p.evaluate(() => { window.scrollBy(0, innerHeight * 1.5); return innerHeight + scrollY >= document.body.scrollHeight - 5; }); await new Promise((r) => setTimeout(r, 80)); if (end) break; }
  await new Promise((r) => setTimeout(r, 400));
  const r = await p.evaluate(() => {
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const tiny = [...document.querySelectorAll('button, a.btn, [role=button], [role=tab]')].filter(vis)
      .filter((e) => { const b = e.getBoundingClientRect(); return b.height < 32 || b.width < 32; })
      .map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 25)).filter(Boolean);
    return { wide: document.documentElement.scrollWidth > innerWidth + 1,
      broken: [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => i.src.split('/').slice(-2).join('/')),
      tiny };
  });
  if (r.wide) wide.push(path);
  if (r.broken.length) broken.push(`${path}: ${r.broken.slice(0, 3).join(', ')}`);
  for (const t of r.tiny) (small[t] ||= new Set()).add(path);
}
// Telugu: English words still visible
await p.evaluate(() => localStorage.setItem('as_lang', 'te'));
const english = {};
for (const path of ['/', '/category/food-daily', '/service/food-daily-kirana-delivery', '/checkout?service=vehicle-rental-car-booking', '/orders', '/account', '/meal', '/transport', '/offers']) {
  await p.goto(B + path, { waitUntil: 'networkidle2' }).catch(() => {});
  await new Promise((r) => setTimeout(r, 700));
  const left = await p.evaluate(() => {
    const out = new Set();
    const w = document.createTreeWalker(document.querySelector('main') || document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const t = w.currentNode.textContent.trim();
      const el = w.currentNode.parentElement;
      if (!t || !el || el.closest('[translate=no], .product-brand, h3, .search, input, .car-card b') ) continue;
      if (/[a-z]{4,}/i.test(t) && !/[\u0C00-\u0C7F]/.test(t) && t.length < 80) out.add(t);
    }
    return [...out].slice(0, 12);
  });
  if (left.length) english[path] = left;
}
await p.evaluate(() => { localStorage.setItem('as_lang', 'en'); for (const k of Object.keys(localStorage)) if (/^as_cart_/.test(k)) localStorage.removeItem(k); });
await b.close();
console.log(`${[...new Set(pages)].length} pages checked\n`);
console.log('ERRORS / FAILED API:', issues.length ? '\n  ' + [...new Set(issues)].slice(0, 25).join('\n  ') : 'none');
console.log('WIDER THAN SCREEN:', wide.join(', ') || 'none');
console.log('BROKEN IMAGES:', broken.join(' | ') || 'none');
console.log('SLOW (>2.5 s):', slow.join(', ') || 'none');
console.log('SMALL TAP TARGETS (<32 px):', Object.entries(small).slice(0, 15).map(([t, s]) => `"${t}" (${s.size} pages)`).join(', ') || 'none');
console.log('\nTELUGU MODE — English still shown:');
for (const [k, v] of Object.entries(english)) console.log(`  ${k}: ${v.join(' | ')}`);
