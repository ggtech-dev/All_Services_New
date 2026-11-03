// 📢 Offers near you (API): a shop (customer user7) asks → straight to HQ (not the franchise) → HQ approves with the
// payment → live only in Siddipet; free first offer; taps counted (once a minute); the shop's "My offers"; HQ creates
// an ad for a city; reject / stop; checks. Test rows: phones 90003099xx, removed at the end.
import fs from 'node:fs';
import pg from 'pg';
import './testadmin.mjs';
const B = 'http://localhost:5000/api';
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x ? ` — ${String(x).slice(0, 240)}` : ''}`); c ? pass++ : fail++; };
const call = async (path, { method = 'GET', body, token, form, city } = {}) => {
  const r = await fetch(B + path, { method, headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }), ...(city && { 'x-franchise': String(city) }) },
    body: form || (body && JSON.stringify(body)) });
  return { s: r.status, d: r.status === 204 ? null : await r.json().catch(() => null) };
};
const login = async (username, password, portal) => (await call('/auth/login', { method: 'POST', body: { username, password, portal } })).d?.token;
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path = all_services');
const city = (await db.query("SELECT id FROM franchises WHERE code = 'FR-0001'")).rows[0].id;
const other = (await db.query("SELECT id FROM franchises WHERE id <> $1 AND status = 'active' ORDER BY id LIMIT 1", [city])).rows[0]?.id;
const img = fs.readFileSync('veg480/tomato.jpg');
const form = (fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  fd.append('image', new Blob([img], { type: 'image/jpeg' }), 'poster.jpg');
  return fd;
};
const today = (await db.query('SELECT fn_ist_date()::text AS d')).rows[0].d;
try {
  const user = await login('9000300107', process.env.TEST_USER_PW, 'user');
  const admin = await login('zt_admin', process.env.TEST_STAFF_PW, 'admin');
  const hq = await login('zt_super', process.env.TEST_STAFF_PW, 'super');
  const shop = { shop_name: 'zt Sri Lakshmi Mobiles', owner_name: 'Ravi', phone: '9000309901', category: 'mobiles', title: '20% off on all smartphones',
    details: 'Festival offer on Vivo, Oppo and Samsung phones. Free back cover.', address: 'zt Main Road, near Old Bus Stand, Siddipet', lat: '18.1035', lng: '78.8528', plan: 'month' };

  const noPhoto = await call('/offers/request', { method: 'POST', token: user, city, form: (() => { const fd = new FormData(); for (const [k, v] of Object.entries(shop)) fd.append(k, v); return fd; })() });
  check(`no poster → "${noPhoto.d?.error}"`, noPhoto.s === 400 && /photo|poster/i.test(noPhoto.d?.error || ''));
  const badPhone = await call('/offers/request', { method: 'POST', token: user, city, form: form({ ...shop, phone: '12345' }) });
  check(`a wrong phone → "${badPhone.d?.error}"`, badPhone.s === 400);
  const noCity = await call('/offers/request', { method: 'POST', token: user, form: form(shop) });
  check(`no city → "${noCity.d?.error}"`, noCity.s === 400);
  const guest = await call('/offers/request', { method: 'POST', city, form: form(shop) });
  check(`must be logged in (${guest.s})`, guest.s === 401);

  const req = await call('/offers/request', { method: 'POST', token: user, city, form: form(shop) });
  const o = req.d || {};
  check(`shop asks: #${o.id} "${o.status}", free first offer (₹${o.price}, free_launch ${o.free_launch})`, req.s === 201 && o.status === 'requested' && o.free_launch === true && Number(o.price) === 0, JSON.stringify(req.d));
  const mine = await call('/offers/mine', { token: user });
  check(`"My offers": ${mine.d?.[0]?.state}`, mine.d?.some((x) => x.id === o.id && x.state === 'requested'));
  check(`not shown to customers yet`, !(await call('/offers', { city })).d?.some((x) => x.id === o.id));

  // goes to HQ, not the franchise
  const frList = await call('/offers/admin/list?tab=requests', { token: admin });
  check(`the franchise admin doesn't get requests (sees "${frList.d ? 'live' : '?'}" list)`, frList.s === 200 && !frList.d.offers.some((x) => x.id === o.id) && !('requests' in frList.d.counts));
  const hqList = await call('/offers/admin/list?tab=requests', { token: hq });
  check(`HQ sees the request (${hqList.d?.counts?.requests} waiting)`, hqList.d?.offers?.some((x) => x.id === o.id && x.phone === '9000309901' && x.from_shop));
  const stats = await call('/admin/orders-stats', { token: hq });
  check(`HQ menu count offer_requests = ${stats.d?.offer_requests}`, Number(stats.d?.offer_requests) >= 1);
  const frDecide = await call(`/offers/admin/${o.id}/decide`, { method: 'POST', token: admin, body: { approve: true } });
  check(`a franchise admin can't approve (${frDecide.s})`, frDecide.s === 403);

  // HQ approves (free first offer: no payment needed)
  const ok = await call(`/offers/admin/${o.id}/decide`, { method: 'POST', token: hq, body: { approve: true, note: 'zt called Ravi' } });
  check(`HQ approves → live ${ok.d?.starts_on?.slice(0, 10)} … ${ok.d?.ends_on?.slice(0, 10)} (30 days), payment "${ok.d?.payment_mode}"`,
    ok.s === 200 && ok.d.status === 'approved' && ok.d.payment_mode === 'free', JSON.stringify(ok.d));
  const list = await call('/offers', { city });
  check(`customers in Siddipet see it (${list.d?.length} offers)`, list.d?.some((x) => x.id === o.id));
  const otherList = other ? await call('/offers', { city: other }) : { d: [] };
  check(`customers in another city don't`, !otherList.d?.some((x) => x.id === o.id));
  const cat = await call('/offers?category=jewellery', { city });
  check(`category filter (jewellery) leaves it out`, !cat.d?.some((x) => x.id === o.id));
  const det = await call(`/offers/${o.id}`);
  check(`offer page: ${det.d?.shop_name}, ${det.d?.phone}, ${det.d?.address}`, det.s === 200 && det.d.phone === '9000309901' && Number(det.d.lat) > 18);

  // taps
  for (const k of ['seen', 'open', 'call', 'call', 'whatsapp', 'directions']) await call(`/offers/${o.id}/tap`, { method: 'POST', body: { kind: k } });
  const t = (await db.query('SELECT seen, opens, calls, whatsapp, directions FROM local_offers WHERE id = $1', [o.id])).rows[0];
  check(`taps counted: seen ${t.seen}, opened ${t.opens}, calls ${t.calls} (a 2nd call within a minute not counted), WhatsApp ${t.whatsapp}, directions ${t.directions}`,
    t.seen === 1 && t.opens === 1 && t.calls === 1 && t.whatsapp === 1 && t.directions === 1);
  const badTap = await call(`/offers/${o.id}/tap`, { method: 'POST', body: { kind: 'like' } });
  check(`an unknown tap is refused (${badTap.s})`, badTap.s === 400);

  // the franchise sees its city's live offers (read only)
  const frLive = await call('/offers/admin/list?tab=live', { token: admin });
  check(`franchise admin sees it under Live with the taps`, frLive.d?.offers?.some((x) => x.id === o.id && x.stats.calls === 1));

  // 2nd offer from the same shop: not free; HQ needs the payment
  const req2 = await call('/offers/request', { method: 'POST', token: user, city, form: form({ ...shop, title: 'zt Exchange offer — up to ₹5,000', plan: 'top' }) });
  check(`2nd offer of the shop is paid: ₹${req2.d?.price} (⭐ top)`, req2.s === 201 && !req2.d.free_launch && Number(req2.d.price) === 999 && req2.d.is_top);
  const noPay = await call(`/offers/admin/${req2.d.id}/decide`, { method: 'POST', token: hq, body: { approve: true } });
  check(`approving without the payment → "${noPay.d?.error}"`, noPay.s === 400);
  const paid = await call(`/offers/admin/${req2.d.id}/decide`, { method: 'POST', token: hq, body: { approve: true, payment_mode: 'upi', paid_amount: 999 } });
  check(`HQ approves with UPI ₹999`, paid.s === 200 && paid.d.payment_mode === 'upi' && Number(paid.d.paid_amount) === 999);
  const top = (await call('/offers', { city })).d;
  check(`⭐ top offer shows first`, top?.[0]?.id === req2.d.id, top?.map((x) => x.id).join(','));

  // reject + the shop's own cancel
  const req3 = await call('/offers/request', { method: 'POST', token: user, city, form: form({ ...shop, title: 'zt Test offer to reject', plan: 'week' }) });
  const noReason = await call(`/offers/admin/${req3.d.id}/decide`, { method: 'POST', token: hq, body: { approve: false } });
  check(`rejecting needs a reason (${noReason.s})`, noReason.s === 400);
  const rej = await call(`/offers/admin/${req3.d.id}/decide`, { method: 'POST', token: hq, body: { approve: false, reason: 'zt Poster not clear' } });
  check(`HQ rejects with a reason → the shop sees it`, rej.d?.status === 'rejected' && (await call('/offers/mine', { token: user })).d.some((x) => x.id === req3.d.id && x.state === 'rejected' && /Poster/.test(x.reason)));
  const req4 = await call('/offers/request', { method: 'POST', token: user, city, form: form({ ...shop, title: 'zt Test offer to cancel', plan: 'week' }) });
  const cancel = await call(`/offers/${req4.d.id}/cancel`, { method: 'POST', token: user });
  check(`the shop can cancel its own request (${cancel.d?.status})`, cancel.d?.status === 'cancelled');
  const cancelLive = await call(`/offers/${o.id}/cancel`, { method: 'POST', token: user });
  check(`…but not one already approved ("${cancelLive.d?.error}")`, cancelLive.s === 400);

  // HQ creates an ad for a city after a phone call
  const hqForm = form({ ...shop, shop_name: 'zt Siddipet Gold Palace', phone: '9000309902', category: 'jewellery', title: 'zt No making charges on gold coins', plan: 'week', franchise_id: city, payment_mode: 'cash', starts_on: today });
  const made = await call('/offers/admin', { method: 'POST', token: hq, form: hqForm });
  check(`HQ creates an ad for Siddipet → "${made.d?.status}", live at once, ${made.d?.payment_mode}`, made.s === 201 && made.d.status === 'approved' && (await call('/offers?category=jewellery', { city })).d.some((x) => x.id === made.d.id));
  const frMake = await call('/offers/admin', { method: 'POST', token: admin, form: form(shop) });
  check(`a franchise admin can't create ads (${frMake.s})`, frMake.s === 403);

  // HQ stops an offer, plan prices for a city
  const stop = await call(`/offers/admin/${made.d.id}/cancel`, { method: 'POST', token: hq, body: { reason: 'zt shop asked' } });
  check(`HQ stops an offer → gone from the app`, stop.d?.status === 'cancelled' && !(await call('/offers', { city })).d.some((x) => x.id === made.d.id));
  const pr = await call(`/offers/admin/prices/${city}`, { method: 'PUT', token: hq, body: { code: 'week', price: 149 } });
  const plans = await call('/offers/plans', { city });
  check(`HQ sets Siddipet's 7-day plan to ₹149 (${pr.s}) → app shows ₹${plans.d?.plans?.find((p) => p.code === 'week')?.price}`, plans.d?.plans?.find((p) => p.code === 'week')?.price === 149);
  await call(`/offers/admin/prices/${city}`, { method: 'PUT', token: hq, body: { code: 'week', price: null } });
} catch (e) {
  check('offers API test ran without crashing', false, e.stack);
} finally {
  const gone = await db.query("DELETE FROM local_offers WHERE phone LIKE '90003099%' RETURNING image_url");
  for (const r of gone.rows) fs.rmSync(`../server${r.image_url}`, { force: true });
  await db.query('DELETE FROM offer_plan_prices WHERE franchise_id = $1', [city]);
  console.log(`cleanup: ${gone.rowCount} offers`);
  await db.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
