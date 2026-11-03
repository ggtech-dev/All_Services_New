// Phone-first login (2026-10-17): customer OTP sign-up / login, password set + login by mobile number, forgot
// password by OTP, agent application with verified number → approval → OTP login, remove / restore agent.
// API must run in SMS test mode (api_testmode.mjs). Test numbers 9000000951 (customer) / 9000000952 (agent) are
// deleted at the end.
import pg from 'pg';
import './testadmin.mjs';
const API = 'http://localhost:5000/api';
let pass = 0, fails = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? ` — ${String(x).slice(0, 160)}` : ''}`); c ? pass++ : fails++; };
const call = async (p, { method = 'GET', body, token, form } = {}) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method, headers, body: form || (body && JSON.stringify(body)) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const C = '9000000951', A = '9000000952';
const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
await db.query('SET search_path=all_services');
// the 30 s / 5-per-hour OTP limits would stop a fast test: clear only these test numbers' old codes first
const otp = async (phone) => {
  await db.query('DELETE FROM phone_otps WHERE phone = $1', [phone]);
  return (await call('/auth/phone/request', { method: 'POST', body: { phone } })).devCode;
};
const wipe = async () => {
  const ids = (await db.query("SELECT id FROM users WHERE phone IN ($1,$2) AND (username LIKE 'm9000000951%' OR username LIKE 'a9000000952%')", [C, A])).rows.map((r) => r.id);
  if (ids.length) {
    await db.query('DELETE FROM agent_subscriptions WHERE agent_id = ANY($1)', [ids]).catch(() => {});
    await db.query('DELETE FROM subscription_requests WHERE agent_id = ANY($1)', [ids]).catch(() => {});
    await db.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
  }
  await db.query('DELETE FROM phone_otps WHERE phone IN ($1,$2)', [C, A]);
};
await wipe();

try {
  // ---------- customer ----------
  let r = await call('/auth/phone/request', { method: 'POST', body: { phone: C } });
  check('OTP request in test mode (no SMS)', r.sent && r.testMode && /^\d{6}$/.test(r.devCode), JSON.stringify(r));
  r = await call('/auth/phone/verify', { method: 'POST', body: { phone: C, code: r.devCode } });
  check('new number → asks the name', r.needName && r.proof);
  r = await call('/auth/phone/complete', { method: 'POST', body: { proof: r.proof, fullName: 'Zt Phone Customer' } });
  check('account created + logged in', r.status === 201 && r.token && r.user.role === 'customer' && r.user.hasPassword === false, JSON.stringify(r.user));
  const exp = JSON.parse(Buffer.from(r.token.split('.')[1], 'base64url').toString());
  check('customer stays logged in 30 days', Math.round((exp.exp - exp.iat) / 86400) === 30);
  let tok = r.token;
  r = await call('/auth/phone/verify', { method: 'POST', body: { phone: C, code: await otp(C) } });
  check('second time: same number logs straight in', r.token && r.user.phone === C);
  r = await call('/auth/login', { method: 'POST', body: { username: C, password: 'whatever1', portal: 'user' } });
  check('password login before a password is set → helpful message', r.status === 401 && /haven't set a password yet/.test(r.error), r.error);
  r = await call('/auth/password/change', { method: 'POST', token: tok, body: { password: 'zt_pass1' } });
  check('set a password without "current"', r.ok && r.user.hasPassword === true, JSON.stringify(r));
  r = await call('/auth/password/change', { method: 'POST', token: tok, body: { password: 'zt_pass2' } });
  check('after that, changing needs the current password', r.status === 400);
  r = await call('/auth/login', { method: 'POST', body: { username: C, password: 'zt_pass1', portal: 'user' } });
  check('login with MOBILE NUMBER + password', r.token && r.user.phone === C, r.error);
  r = await call('/auth/login', { method: 'POST', body: { username: `+91 ${C}`, password: 'zt_pass1', portal: 'user' } });
  check('login with +91 number works too', !!r.token, r.error);
  r = await call('/auth/login', { method: 'POST', body: { username: C, password: 'wrong99', portal: 'user' } });
  check('wrong password refused', r.status === 401);
  r = await call('/auth/password/reset', { method: 'POST', body: { phone: C, code: await otp(C), password: 'zt_pass3', portal: 'user' } });
  check('forgot password by OTP', r.ok, r.error);
  r = await call('/auth/login', { method: 'POST', body: { username: C, password: 'zt_pass3', portal: 'user' } });
  check('new password works', !!r.token);
  r = await call('/auth/password/reset', { method: 'POST', body: { phone: C, code: '000000', password: 'zt_pass4', portal: 'user' } });
  check('forgot password with wrong OTP refused', r.status === 400, r.error);
  for (const p of ['/auth/register/start', '/auth/otp/request', '/auth/password/forgot', '/auth/email/request']) {
    r = await call(p, { method: 'POST', body: { email: 'zt@example.com' } });
    check(`email endpoint gone: ${p}`, r.status === 404 || r.status === 401, r.status);
  }

  // ---------- agent ----------
  r = await call('/auth/phone/verify', { method: 'POST', body: { phone: A, code: await otp(A), portal: 'agent' } });
  check('agent OTP login with unknown number → apply first', r.status === 404 && /Apply/.test(r.error), r.error);
  r = await call('/auth/phone/verify', { method: 'POST', body: { phone: A, code: await otp(A), portal: 'agent_apply' } });
  check('application: number verified → proof', !!r.proof && r.phone === A);
  const proof = r.proof;
  const locs = await (await fetch(API + '/localities', { headers: { 'x-franchise': '1' } })).json(); // a Siddipet area (zt_admin is Siddipet's admin)
  const loc = (Array.isArray(locs) ? locs : Object.values(locs).filter((x) => x && x.id))[0];
  const png = new Blob([Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')], { type: 'image/png' });
  const form = (withProof) => {
    const fd = new FormData();
    Object.entries({ full_name: 'Zt Phone Agent', phone: '9999999999', vehicle_type: 'bike', locality_id: loc?.id ?? '', aadhaar_number: '123456789012', pan_number: 'ABCDE1234F', dl_number: 'TS0920190012345' })
      .forEach(([k, v]) => fd.append(k, v));
    fd.append('skills', 'delivery');
    for (const f of ['aadhaar_doc', 'pan_doc', 'dl_doc']) fd.append(f, png, `${f}.png`);
    if (withProof) fd.append('phone_proof', proof);
    return fd;
  };
  r = await call('/agents/apply', { method: 'POST', form: form(false) });
  check('application without verified number refused', r.status === 400 && /verify/i.test(r.error), r.error);
  r = await call('/agents/apply', { method: 'POST', form: form(true) });
  check('application with verified number accepted', r.ok === true && r.status === 'pending', r.error || r.status);
  const ag = (await db.query("SELECT u.id, u.username, u.phone, u.has_password, u.phone_verified_at, a.status FROM users u JOIN agents a ON a.user_id = u.id WHERE u.phone = $1", [A])).rows[0];
  check('agent saved with the VERIFIED number (not the typed one), auto username, no password', ag && ag.phone === A && ag.username === `a${A}` && ag.has_password === false && ag.phone_verified_at && ag.status === 'pending', JSON.stringify(ag));
  r = await call('/auth/phone/verify', { method: 'POST', body: { phone: A, code: await otp(A), portal: 'agent_apply' } });
  check('applying twice with same number → already under review', r.status === 409, r.error);
  r = await call('/auth/phone/verify', { method: 'POST', body: { phone: A, code: await otp(A), portal: 'agent' } });
  check('pending agent OTP login → under review message', r.status === 403 && /under review/.test(r.error), r.error);

  const admin = (await call('/auth/login', { method: 'POST', body: { username: 'zt_admin', password: process.env.TEST_STAFF_PW, portal: 'admin' } })).token;
  r = await call(`/admin/agents/${ag.id}/review`, { method: 'POST', token: admin, body: { approve: true } });
  check('franchise admin approves', r.status === 204, JSON.stringify(r));
  r = await call('/auth/phone/verify', { method: 'POST', body: { phone: A, code: await otp(A), portal: 'agent' } });
  check('approved agent logs in with OTP', r.token && r.user.role === 'agent', r.error);
  const atok = r.token;
  const aexp = JSON.parse(Buffer.from(atok.split('.')[1], 'base64url').toString());
  check('agent stays logged in 30 days', Math.round((aexp.exp - aexp.iat) / 86400) === 30);
  check('agent app works', (await call('/agent/me', { token: atok })).status === 200);
  r = await call('/auth/phone/verify', { method: 'POST', body: { phone: A, code: await otp(A), portal: 'user' } });
  check('same number in the customer app = separate customer account', r.needName === true);

  r = await call(`/admin/agents/${ag.id}/remove`, { method: 'POST', token: admin, body: {} });
  check('remove needs a reason', r.status === 400, r.error);
  r = await call(`/admin/agents/${ag.id}/remove`, { method: 'POST', token: admin, body: { reason: 'Zt test removal' } });
  check('franchise admin removes the agent', r.status === 204, r.error);
  check('removed agent is blocked at once (even logged in)', (await call('/agent/me', { token: atok })).status === 403);
  r = await call('/auth/phone/verify', { method: 'POST', body: { phone: A, code: await otp(A), portal: 'agent' } });
  check('removed agent OTP login → removed message with reason', r.status === 403 && /removed: Zt test removal/.test(r.error), r.error);
  const list = await call('/admin/agents', { token: admin });
  check('admin list shows state "removed"', Object.values(list).some((a) => a?.user_id === ag.id && a.state === 'removed'));
  r = await call(`/admin/agents/${ag.id}/status`, { method: 'PATCH', token: admin, body: { status: 'active' } });
  check('restore', r.status === 204, r.error);
  r = await call('/auth/phone/verify', { method: 'POST', body: { phone: A, code: await otp(A), portal: 'agent' } });
  check('restored agent can log in again', !!r.token, r.error);
  r = await call('/auth/password/reset', { method: 'POST', body: { phone: A, code: await otp(A), password: 'zt_agent1', portal: 'agent' } });
  check('agent forgot password by OTP', r.ok, r.error);
  r = await call('/auth/login', { method: 'POST', body: { username: A, password: 'zt_agent1', portal: 'agent' } });
  check('agent logs in with mobile number + password', r.token && r.user.role === 'agent', r.error);
  r = await call('/auth/login', { method: 'POST', body: { username: A, password: 'zt_agent1', portal: 'user' } });
  check('agent password does not open the customer app', !r.token);
  r = await call('/auth/login', { method: 'POST', body: { username: 'zt_admin', password: process.env.TEST_STAFF_PW, portal: 'admin' } });
  check('admin login unchanged (username + password, 7 days)', r.token && Math.round((JSON.parse(Buffer.from(r.token.split('.')[1], 'base64url')).exp - JSON.parse(Buffer.from(r.token.split('.')[1], 'base64url')).iat) / 86400) === 7);
} finally {
  await wipe();
  await db.end();
}
console.log(`\n${pass} passed, ${fails} failed`);
