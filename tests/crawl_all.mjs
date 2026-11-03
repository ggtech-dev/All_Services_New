// Full crawl before go-live: opens every customer page (all categories, all services, product lists, booking forms),
// every agent page, every franchise-admin page and every HQ page — phone + desktop, English + Telugu — and reports:
// JS errors, failed API calls (4xx/5xx), error boxes, sideways scroll, broken images, empty pages, untranslated text.
// Uses only zt_ test users (removed by cleanup.mjs). Read-only: it never places, cancels or changes anything.
import puppeteer from 'puppeteer-core';
import './testadmin.mjs';
import { agentLogin, makeCustomer } from './test_helpers.mjs';
import { withLocation } from './geo_browser.mjs';

// the four separate apps (new repository layout), served by the server on 5000–5003
const U = 'http://localhost:5000', AG = 'http://localhost:5001', AD = 'http://localhost:5002', HQ = 'http://localhost:5003';
const API = 'http://localhost:5000/api';
const OUT = './shots/crawl';
import fs from 'fs';
fs.mkdirSync(OUT, { recursive: true });
const call = async (p, o = {}) => {
  const h = { 'Content-Type': 'application/json' };
  if (o.token) h.Authorization = `Bearer ${o.token}`;
  const r = await fetch(API + p, { method: o.method || 'GET', headers: h, body: o.body && JSON.stringify(o.body) });
  return r.json().catch(() => ({}));
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- test users
const email = 'zt.crawl@example.com';
await makeCustomer('zt_crawl', 'Crawl Customer');
const adm = (await call('/auth/login', { method: 'POST', body: { username: 'zt_admin', password: process.env.TEST_STAFF_PW, portal: 'admin' } })).token;
const locs = await call('/localities');
const f = new FormData();
Object.entries({ username: 'zt_crawl_agent', password: process.env.TEST_STAFF_PW, full_name: 'Crawl Agent', phone: '9111111991', vehicle_type: 'bike', locality_id: locs[0].id, skills: 'delivery' }).forEach(([k, v]) => f.append(k, v));
await fetch(`${API}/admin/agents`, { method: 'POST', headers: { Authorization: `Bearer ${adm}` }, body: f });
await agentLogin('zt_crawl_agent', '9111111991');

// ---- what to visit
const cats = await call('/categories');
const customerPages = ['/', '/orders', '/account', '/credits', '/checkout'];
for (const c of cats) {
  customerPages.push(`/category/${c.slug}`);
  const d = await call(`/categories/${c.slug}`);
  for (const s of d.services) {
    if (s.type_count > 0) {
      customerPages.push(`/care/${s.slug}`);
      const t = await call(`/services/${s.slug}/types`);
      for (const x of t.types) customerPages.push(`/checkout?service=${x.slug}`);
    } else if (s.product_count > 0 || s.allows_list) customerPages.push(`/service/${s.slug}`);
    else customerPages.push(`/checkout?service=${s.slug}`);
  }
}
// 🚗 Share Ride has its own pages (the category opens /share-ride); its service is never a checkout booking
for (let i = customerPages.length - 1; i >= 0; i--) if (/share-ride-share-ride|daily-workers-daily-workers|digital-services-digital-services/.test(customerPages[i])) customerPages.splice(i, 1);
customerPages.push('/welcome', '/search?q=plumber', '/search?q=tomato', '/share-ride', '/share-ride/tickets', '/workers', '/workers?tab=painters', '/workers?tab=other', '/digital', '/digital?tab=video');
const agentPages = ['/agent', '/agent/orders', '/agent/wallet', '/agent/profile', '/agent/pay-qr', '/agent/subscriptions'];
const adminPages = ['/admin', '/admin/orders', '/admin/agents', '/admin/live', '/admin/complaints', '/admin/ratings', '/admin/subscriptions', '/admin/share-ride', '/admin/workers',
  '/admin/my-services', '/admin/requests', '/admin/areas', '/admin/shops', '/admin/messages', '/admin/reports', '/admin/service-types', '/admin/activity'];
const franchiseId = locs[0].franchise_id;
const superPages = ['/super', '/super/platform-reports', '/super/franchises', '/super/franchises/new', `/super/franchises/${franchiseId}`,
  `/super/franchises/${franchiseId}/edit`, '/super/requests', '/super/payments', '/super/categories', '/super/services', '/super/products',
  '/super/pricing', '/super/service-types', '/super/delivery-charges', '/super/promotions', '/super/orders', '/super/agents', '/super/live',
  '/super/reports', '/super/complaints', '/super/ratings', '/super/subscriptions', '/super/share-ride', '/super/workers', '/super/digital', '/super/areas', '/super/shops', '/super/users',
  '/super/admins', '/super/notifications', '/super/activity', '/super/settings', '/super/catalog-dashboard'];
const publicPages = [[U, '/login'], [U, '/login?method=password'], [U, '/login?method=code'], [U, '/register'], [U, '/forgot-password'], [AG, '/login'], [AG, '/agent/apply'], [AG, '/forgot-password'], [AD, '/login'], [HQ, '/login']];

const browser = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true });

withLocation(browser); // 📍 a phone in Siddipet with location allowed
const problems = [];
let visited = 0;
const IGNORE = /favicon|tile\.openstreetmap|basemaps|\/sw\.js|workbox|push|ERR_CONNECTION_RESET|ERR_ABORTED|net::ERR_NAME|staticflickr|wikimedia|unsplash/i;

async function session(label, width, height, loginAs, lang, B = U) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewport({ width, height });
  let current = '';
  page.on('pageerror', (e) => problems.push(`[${label}] ${current} JS error: ${e.message.split('\n')[0]}`));
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push(`[${label}] ${current} console: ${m.text().slice(0, 160)}`); });
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/') && r.status() >= 400 && !/\/auth\/me|\/push\//.test(u)) problems.push(`[${label}] ${current} API ${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '')}`);
  });
  page.on('dialog', (d) => d.dismiss());
  if (lang) await page.evaluateOnNewDocument((l) => localStorage.setItem('as_lang', l), lang);
  await page.evaluateOnNewDocument(() => localStorage.setItem('as_welcome_seen', '1')); // crawl the pages, not the one-time welcome
  if (loginAs) {
    const [u, as] = loginAs;
    await page.goto(`${B}/login${as && !as.includes('method=') ? `${as}&method=password` : as || '?method=password'}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[autocomplete=username]');
    await page.type('input[autocomplete=username]', u);
    await page.type('input[autocomplete=current-password]', process.env.TEST_STAFF_PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('form button.btn-primary')]);
  }
  return {
    base(b) { B = b; },
    async visit(path, shot) {
      current = `${B.slice(-4)}${path}`;
      visited++;
      try {
        await page.goto(B + path, { waitUntil: 'networkidle2', timeout: 30000 });
      } catch (e) {
        // still busy after 30 s (or failed): note it, then check what is on screen anyway
        problems.push(`[${label}] ${current} slow / not settled: ${e.message.split('\n')[0]}`);
      }
      await wait(700);
      const r = await page.evaluate(() => {
        const vis = (el) => !!(el.offsetWidth || el.offsetHeight);
        const alerts = [...document.querySelectorAll('.alert')].filter(vis).map((a) => a.innerText.trim()).filter(Boolean);
        const broken = [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0 && vis(i) && i.src && !i.src.startsWith('data:')).map((i) => i.src.slice(-60));
        const main = document.querySelector('main, .admin-main, .agent-main, #root');
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          alerts, broken,
          textLen: (main?.innerText || '').trim().length,
          spinner: !!document.querySelector('.spinner, .skeleton'),
          notFound: /page not found|404/i.test(document.body.innerText.slice(0, 400)),
        };
      });
      if (r.overflow > 2) problems.push(`[${label}] ${current} sideways scroll ${r.overflow}px`);
      for (const a of r.alerts) problems.push(`[${label}] ${current} error box: ${a.slice(0, 120)}`);
      for (const b of r.broken) problems.push(`[${label}] ${current} broken image …${b}`);
      if (r.textLen < 40) problems.push(`[${label}] ${current} looks empty (${r.textLen} chars)`);
      if (r.notFound) problems.push(`[${label}] ${current} shows "not found"`);
      if (shot) await page.screenshot({ path: `${OUT}/${label}-${path.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`, fullPage: false });
    },
    async untranslated() {
      // English words left on a Telugu page (only for visible short texts)
      return page.evaluate(() => {
        const out = new Set();
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walk.nextNode()) {
          const n = walk.currentNode;
          const t = n.nodeValue.trim();
          const el = n.parentElement;
          if (!t || !el || el.closest('[translate="no"], script, style, input, textarea, .brand, .navbar-brand')) continue;
          if (!(el.offsetWidth || el.offsetHeight)) continue;
          if (/[a-z]{3,}/i.test(t) && !/[\u0C00-\u0C7F]/.test(t) && /^[A-Z][a-z]+( [a-z]+){1,}/.test(t)) out.add(t.slice(0, 60));
        }
        return [...out];
      });
    },
    close: () => ctx.close(),
  };
}

const untrans = new Map();
try {
  // public pages, phone
  let s = await session('public-phone', 400, 860);
  for (const [base, p] of publicPages) { s.base(base); await s.visit(p); }
  await s.close();

  // customer: phone (English), desktop (English), phone (Telugu)
  for (const [label, w, h, lang] of [['cust-phone', 400, 860], ['cust-desktop', 1280, 800], ['cust-te', 400, 860, 'te']]) {
    s = await session(label, w, h, ['zt_crawl', '?method=password'], lang, U);
    for (const p of customerPages) {
      await s.visit(p, label === 'cust-phone' && !p.includes('checkout?service='));
      if (lang) for (const t of await s.untranslated()) untrans.set(t, (untrans.get(t) || 0) + 1);
    }
    await s.close();
  }

  // agent: phone + Telugu
  for (const [label, lang] of [['agent-phone'], ['agent-te', 'te']]) {
    s = await session(label, 400, 860, ['zt_crawl_agent', ''], lang, AG);
    for (const p of agentPages) {
      await s.visit(p, !lang);
      if (lang) for (const t of await s.untranslated()) untrans.set(t, (untrans.get(t) || 0) + 1);
    }
    await s.close();
  }

  // franchise admin: desktop + phone
  for (const [label, w, h] of [['admin-desktop', 1366, 768], ['admin-phone', 400, 860]]) {
    s = await session(label, w, h, ['zt_admin', ''], undefined, AD);
    for (const p of adminPages) await s.visit(p, label === 'admin-desktop');
    await s.close();
  }

  // HQ: desktop + phone
  for (const [label, w, h] of [['hq-desktop', 1366, 768], ['hq-phone', 400, 860]]) {
    s = await session(label, w, h, ['zt_super', ''], undefined, HQ);
    for (const p of superPages) await s.visit(p, label === 'hq-desktop');
    await s.close();
  }
} finally {
  await browser.close();
}

const uniq = [...new Set(problems)];
console.log(`Visited ${visited} pages (${customerPages.length} customer pages × 3, ${agentPages.length} agent × 2, ${adminPages.length} admin × 2, ${superPages.length} HQ × 2, ${publicPages.length} public).`);
console.log(uniq.length ? `\n${uniq.length} PROBLEMS:\n${uniq.join('\n')}` : '\nNO PROBLEMS FOUND');
const top = [...untrans.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
if (top.length) console.log(`\nEnglish left on Telugu pages (${untrans.size} texts):\n${top.map(([t, n]) => `  ${n}× ${t}`).join('\n')}`);
