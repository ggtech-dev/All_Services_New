// Test browsers behave like a phone in Siddipet with location allowed (checkout needs the delivery location since the
// 📍 location rules). Call once right after puppeteer.launch(); every page opened later gets it.
// The 📍 "Change location" box opens by itself on a first visit; test pages count as "already asked" so it doesn't
// cover what they test — withLocation(browser, SIDDIPET, { firstVisit: true }) keeps the real first visit.
export const SIDDIPET = { latitude: 18.1035, longitude: 78.8528, accuracy: 15 };
const ORIGINS = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176', // dev servers
  'http://localhost:5000', 'http://localhost:5001', 'http://localhost:5002', 'http://localhost:5003']; // the built apps the API serves

export function withLocation(browser, where = SIDDIPET, { firstVisit = false } = {}) {
  const prepare = async (ctx) => {
    for (const o of ORIGINS) await ctx.overridePermissions(o, ['geolocation']).catch(() => {});
    const newPage = ctx.newPage.bind(ctx);
    ctx.newPage = async (...args) => {
      const p = await newPage(...args);
      await p.setGeolocation(where).catch(() => {});
      // a returning phone in Siddipet has its place chosen already (Old Bus Stand, nearest area to the GPS); a guest
      // without a place sees the location box first (2026-10-30) and the first tap outside only closes it
      const place = where === SIDDIPET ? JSON.stringify({ area: 'Old Bus Stand', locality_id: 463, city: 'Siddipet', franchise_id: 1, village: false,
        lat: SIDDIPET.latitude, lng: SIDDIPET.longitude, accuracy: 15, gps: true, at: Date.now() }) : null;
      if (!firstVisit) await p.evaluateOnNewDocument((place) => { try { localStorage.setItem('as_place_asked', '1'); if (place && !localStorage.getItem('as_place')) localStorage.setItem('as_place', place); } catch {} }, place).catch(() => {});
      return p;
    };
    return ctx;
  };
  const create = browser.createBrowserContext.bind(browser);
  browser.createBrowserContext = async (...args) => prepare(await create(...args));
  prepare(browser.defaultBrowserContext());
  return browser;
}
