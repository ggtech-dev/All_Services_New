// ⚡ Instant Delivery end to end (API, LOCAL, Siddipet): 2 instant partners + 1 regular delivery partner (added by the
// franchise admin), a new customer orders twice (1st delivery free, 2nd ₹40 = the quote); only instant partners see
// the orders; two accept at the same moment → one wins; shop bill → picked up → charge → delivered with the code;
// the franchise report counts them under "Instant delivery agents". zt_ data (cleanup.mjs).
import pg from 'pg';
const realFetch = globalThis.fetch;
await import('./testadmin.mjs');
globalThis.fetch = realFetch;
const { makeCustomer, agentLogin } = await import('./test_helpers.mjs');
const API = 'http://localhost:5000/api';
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect(); await db.query('SET search_path=all_services');
let pass = 0, fail = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${!c && x !== '' ? ` — ${String(x).slice(0, 220)}` : ''}`); c ? pass++ : fail++; };
const call = async (p, { method = 'GET', body, token, form } = {}) => {
  const h = { 'X-Franchise': '1' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body) h['Content-Type'] = 'application/json';
  const r = await realFetch(API + p, { method, headers: h, body: form || (body ? JSON.stringify(body) : undefined) });
  const t = r.status === 204 ? '' : await r.text();
  let d = {}; try { d = t ? JSON.parse(t) : {}; } catch { d = { raw: t }; }
  return { s: r.status, d };
};
const PNG = () => new Blob([Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')], { type: 'image/png' });
const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

const adm = (await call('/auth/login', { method: 'POST', body: { username: 'zt_admin', password: process.env.TEST_STAFF_PW, portal: 'admin' } })).d.token;
const loc = (await call('/localities')).d.find((l) => !l.is_village && l.franchise_id === 1);
const before = (await call(`/admin/reports?from=${day}&to=${day}`, { token: adm })).d;
const people = [['zt_inst_a1', 'Zt Instant One', '9000000962', 'instant'], ['zt_inst_a2', 'Zt Instant Two', '9000000963', 'instant'], ['zt_inst_d1', 'Zt Regular Rider', '9000000964', 'delivery']];
const ag = {};
for (const [u, name, phone, skill] of people) {
  const f = new FormData();
  Object.entries({ username: u, password: process.env.TEST_STAFF_PW, full_name: name, phone, vehicle_type: 'bike', locality_id: loc.id, skills: skill }).forEach(([k, v]) => f.append(k, v));
  const r = await call('/admin/agents', { method: 'POST', token: adm, form: f });
  await agentLogin(u, phone);
  const t = (await call('/auth/login', { method: 'POST', body: { username: u, password: process.env.TEST_STAFF_PW, portal: 'agent' } })).d.token;
  await call('/agent/status', { method: 'PATCH', token: t, body: { online: true, locality_id: loc.id } });
  await call('/agent/location', { method: 'POST', token: t, body: { lat: Number(loc.lat), lng: Number(loc.lng), accuracy: 10 } });
  ag[u] = t;
  check(`franchise admin adds ${name} (${skill}) → logs in, online`, r.s === 201 && t, JSON.stringify(r.d));
}

await makeCustomer('zt_inst_cust', 'Zt Instant Customer', '9000000961');
const ct = (await call('/auth/login', { method: 'POST', body: { username: 'zt_inst_cust', password: process.env.TEST_STAFF_PW, portal: 'user' } })).d.token;
const page = (await call('/services/food-daily-instant-delivery', { token: ct })).d;
const sv = page.service, items = (page.products || []).filter((p) => p.in_stock);
check(`Instant Delivery page: ${items.length} items from other shops, delivery ₹${Number(sv?.delivery_fee)}`, sv && items.length > 0 && Number(sv.delivery_fee) === 40);
const place = async (k) => {
  const q = (await call(`/orders/quote?via=${sv.id}`, { token: ct })).d;
  const r = await call('/orders', { method: 'POST', token: ct, body: {
    contact: { name: 'Zt Instant Customer', phone: '9000000961', address_line: 'zt H.No 7, Instant Street', locality_id: loc.id, lat: Number(loc.lat), lng: Number(loc.lng) },
    slot: 'As soon as possible', via_service_id: sv.id,
    items: [{ product_id: items[k].id, qty: 1 }, { service_id: sv.id, name: 'Dolo 650', qty_text: '1 strip' }] } });
  return { q: Number(q.delivery_fee), id: r.d.id, s: r.s, fee: Number(r.d.delivery_fee), skill: r.d.skill_code, err: r.d.error };
};
const o1 = await place(0), o2 = await place(1);
check(`1st instant order: free delivery (quote ₹${o1.q}, charged ₹${o1.fee}) → goes to instant partners`, o1.s === 201 && o1.fee === 0 && o1.q === 0 && o1.skill === 'instant', JSON.stringify(o1));
check(`2nd instant order: ₹40 delivery (quote ₹${o2.q}, charged ₹${o2.fee})`, o2.s === 201 && o2.fee === 40 && o2.q === 40 && o2.skill === 'instant', JSON.stringify(o2));

const sees = async (u) => ((await call('/agent/available', { token: ag[u] })).d || []).map((x) => x.id);
const s1 = await sees('zt_inst_a1'), s2 = await sees('zt_inst_a2'), sd = await sees('zt_inst_d1');
check('both instant partners see both orders', [o1.id, o2.id].every((id) => s1.includes(id) && s2.includes(id)));
check('the regular delivery partner does NOT see instant orders', ![o1.id, o2.id].some((id) => sd.includes(id)));

const race = await Promise.all(['zt_inst_a1', 'zt_inst_a2'].map((u) => call(`/agent/orders/${o1.id}/accept`, { method: 'POST', token: ag[u] })));
const winner = race[0].s === 200 ? 'zt_inst_a1' : 'zt_inst_a2', loser = winner === 'zt_inst_a1' ? 'zt_inst_a2' : 'zt_inst_a1';
check(`two partners tap Accept at the same moment → exactly one gets it (${race.map((r) => r.s).join(' / ')})`, race.filter((r) => r.s === 200).length === 1, JSON.stringify(race.map((r) => r.d.error)));
const r2 = await call(`/agent/orders/${o2.id}/accept`, { method: 'POST', token: ag[loser] });
check('the other partner takes the 2nd order', r2.s === 200, JSON.stringify(r2.d));

const finish = async (u, id, amount) => {
  const f = new FormData();
  Object.entries({ amount: String(amount), shop_name: 'zt Medical Store', mode: 'agent_cash' }).forEach(([k, v]) => f.append(k, v));
  f.append('bill_photo', PNG(), 'bill.png');
  const b = await call(`/agent/orders/${id}/bill`, { method: 'POST', token: ag[u], form: f });
  const pk = await call(`/agent/orders/${id}/status`, { method: 'POST', token: ag[u], body: { status: 'picked_up' } });
  const cur = (await call(`/orders/${id}`, { token: ct })).d;
  if (Number(cur.delivery_fee) > 0) await call(`/agent/orders/${id}/fee-received`, { method: 'POST', token: ag[u], body: { mode: 'cash' } });
  const dv = await call(`/agent/orders/${id}/status`, { method: 'POST', token: ag[u], body: { status: 'delivered', otp: cur.delivery_otp } });
  const end = (await call(`/orders/${id}`, { token: ct })).d;
  return { ok: b.s === 204 && pk.s === 204 && dv.s === 204 && end.status === 'delivered', total: Number(end.total), err: [b, pk, dv].map((x) => x.d.error).filter(Boolean).join(' / ') };
};
const d1 = await finish(winner, o1.id, 180), d2 = await finish(loser, o2.id, 95);
check(`order 1 delivered: shop bill ₹180 + free delivery = ₹${d1.total}`, d1.ok && d1.total === 180, d1.err);
check(`order 2 delivered: shop bill ₹95 + ₹40 delivery = ₹${d2.total}`, d2.ok && d2.total === 135, d2.err);

const after = (await call(`/admin/reports?from=${day}&to=${day}`, { token: adm })).d;
const t = (r) => r.by_type?.find((x) => /instant/i.test(x.name)) || {};
check(`Siddipet report: "Instant delivery agents" +${Number(t(after).orders || 0) - Number(t(before).orders || 0)} orders, +₹${Number(t(after).revenue || 0) - Number(t(before).revenue || 0)} revenue (expected 2, ₹315)`,
  Number(t(after).orders || 0) - Number(t(before).orders || 0) === 2 && Number(t(after).revenue || 0) - Number(t(before).revenue || 0) === 315, JSON.stringify(t(after)));
check(`Siddipet report: delivery charges +₹${Number(after.kpis.delivery_fees) - Number(before.kpis.delivery_fees)} (expected ₹40)`, Number(after.kpis.delivery_fees) - Number(before.kpis.delivery_fees) === 40);
console.log(`\n${pass} passed, ${fail} failed`);
await db.end();
