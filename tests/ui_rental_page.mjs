// 🚗 Vehicle Rental page: 13 car cards (Any car + 12 with photos), tap Ertiga → booking form with Ertiga chosen.
import puppeteer from 'puppeteer-core';
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 200)}` : ''}`); c ? pass++ : fail++; };
const b = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe') });
const errs = [];
for (const [w, h, m] of [[1366, 800, false], [390, 844, true]]) {
  const p = await (await b.createBrowserContext()).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport({ width: w, height: h, isMobile: m, hasTouch: m, deviceScaleFactor: 1 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('as_welcome_seen', '1'); localStorage.setItem('as_city', '1'); } catch {} });
  await p.goto('http://localhost:5173/login', { waitUntil: 'networkidle2' });
  await p.type('input[autocomplete=username], input[type=tel]', '9000300101');
  await p.type('input[autocomplete=current-password]', process.env.TEST_USER_PW);
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), p.click('form button.btn-primary')]);
  await p.goto('http://localhost:5173/category/vehicle-rental', { waitUntil: 'networkidle2' });
  await p.waitForSelector('.rental-car', { timeout: 8000 }).catch(() => {});
  for (const h2 of await p.$$('.rental-car')) await h2.scrollIntoView();
  await new Promise((r) => setTimeout(r, 900));
  const st = await p.evaluate(() => ({ n: document.querySelectorAll('.rental-car').length, photos: [...document.querySelectorAll('.rental-car img')].filter((i) => i.naturalWidth > 0).length,
    wide: document.documentElement.scrollWidth > innerWidth + 1 }));
  check(`${w}px: ${st.n} car cards, ${st.photos} photos loaded, fits screen`, st.n === 13 && st.photos === 12 && !st.wide);
  await p.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 300));
  await p.screenshot({ path: `shots/rental-page-${w}.png` });
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    p.evaluate(() => [...document.querySelectorAll('.rental-car')].find((c) => /Ertiga/.test(c.innerText)).click())]);
  await p.waitForFunction(() => /Ertiga/.test(document.querySelector('.car-card.active b')?.innerText || ''), { timeout: 6000 }).catch(() => {});
  const chosen = await p.evaluate(() => document.querySelector('.car-card.active b')?.innerText);
  check(`${w}px: tap Ertiga → booking form with "${chosen}" chosen`, chosen === 'Maruti Ertiga');
}
check('no page errors', !errs.length, errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
