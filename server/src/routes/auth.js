import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { SMS_TEST_MODE, sendOtpSms } from '../sms.js';

// Logins (2026-10-17, phone first — no email login any more):
//   customers: 📱 mobile number + OTP (the first OTP creates the account), or mobile number / username + password
//   agents:    apply with a verified mobile number → franchise admin approves → 📱 mobile number + OTP (or password)
//   admins:    username + password
// "Forgot password" for customers and agents goes by mobile OTP.
const router = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const publicUser = (u) => ({
  id: u.id, username: u.username, fullName: u.full_name, phone: u.phone, role: u.role, franchiseId: u.franchise_id ?? null,
  email: u.email, hasPassword: u.has_password !== false,
});

// Customers and agents stay logged in on their phone for 30 days (one OTP a month, not every day); staff 7 days.
const signToken = (u) =>
  jwt.sign({ id: u.id, username: u.username, role: u.role }, process.env.JWT_SECRET, {
    expiresIn: u.role === 'customer' || u.role === 'agent' ? '30d' : '7d',
  });

const ipOf = (req) => (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '').trim().slice(0, 64);
const log = (userId, email, event, detail, ip) =>
  query('CALL sp_auth_log($1,$2,$3,$4,$5)', [userId, email, event, detail, ip]).catch((e) => console.error('auth log:', e.message));

const validPassword = (p) => typeof p === 'string' && p.length >= 6 && p.length <= 100;
const PASSWORD_RULE = 'Password must be 6–100 characters';
const setPassword = async (userId, password, why, ip) => {
  await query('CALL sp_set_password($1,$2,$3,$4)', [userId, await bcrypt.hash(password, 10), why, ip]);
  await query('UPDATE users SET has_password = true WHERE id = $1', [userId]);
};

const OTP_MINUTES = 10;
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

// ---------- which portal may this account use ----------
// portal: 'user' | 'agent' | 'admin' | 'superadmin' — the app being logged in to. Returns an error message or null.
async function portalError(user, portal) {
  if (user.is_active === false) return 'This account is switched off. Please contact support.';
  if (portal === 'superadmin' && user.role !== 'superadmin') return 'This is not a Super Admin account.';
  if (portal === 'admin' && user.role === 'superadmin') return 'Super Admin please use the Super Admin login.';
  if (portal === 'admin' && user.role !== 'admin') return 'This account does not have admin access. Please use the User login.';
  if (portal === 'admin') {
    // franchise admins: only while their franchise is not suspended
    const { rows: f } = await query('SELECT status, status_reason FROM franchises WHERE id = $1', [user.franchise_id]);
    if (!f[0]) return 'This admin account is not linked to a franchise. Please contact the Super Admin.';
    if (f[0].status === 'suspended') return `Your franchise is suspended${f[0].status_reason ? `: ${f[0].status_reason}` : ''}. Please contact the Super Admin.`;
  }
  if (portal === 'agent') {
    if (user.role !== 'agent') return 'This is not a delivery agent account.';
    const { rows: a } = await query('SELECT status, rejection_reason, removed_reason FROM agents WHERE user_id = $1', [user.id]);
    const messages = {
      pending: 'Your application is under review. You can log in once the admin approves it.',
      rejected: `Your application was not approved: ${a[0]?.rejection_reason || 'please contact support'}.`,
      suspended: 'Your agent account is suspended. Please contact the admin.',
      removed: `Your agent account was removed${a[0]?.removed_reason ? `: ${a[0].removed_reason}` : ''}. Please contact the admin.`,
    };
    if (messages[a[0]?.status]) return messages[a[0].status];
  }
  if (portal !== 'agent' && user.role === 'agent') return 'Delivery agents please use the Agent login.';
  return null;
}

// Auth endpoints only take plain text fields; an array/object (e.g. {"username":["a"]}) is a bad request, not a crash.
router.use((req, res, next) => {
  const odd = Object.values(req.body || {}).some((v) => v !== null && typeof v === 'object');
  if (odd) return res.status(400).json({ error: 'Invalid request' });
  next();
});

// ---------- mobile numbers ----------
const cleanPhone = (v) => String(v || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
const samePhone = "right(regexp_replace(coalesce(u.phone, ''), '\\D', '', 'g'), 10) = $1";

// The customer account for a number: one already verified by OTP first, else the newest one.
const customerByPhone = async (phone) => (await query(
  `SELECT u.* FROM users u WHERE u.role = 'customer' AND ${samePhone}
    ORDER BY (u.phone_verified_at IS NOT NULL) DESC, u.created_at DESC LIMIT 1`, [phone])).rows[0];

// The agent account for a number: a working one first, then pending, then old rejected / removed ones.
const agentByPhone = async (phone) => (await query(
  `SELECT u.* FROM users u JOIN agents a ON a.user_id = u.id WHERE u.role = 'agent' AND ${samePhone}
    ORDER BY array_position(ARRAY['active','suspended','pending','rejected','removed'], a.status::text), u.created_at DESC LIMIT 1`,
  [phone])).rows[0];

const accountByPhone = (phone, portal) => (portal === 'agent' ? agentByPhone(phone) : customerByPhone(phone));

// ---------- password login ----------
// body: { username, password, portal } — username can also be the 10-digit mobile number (customers and agents).
router.post('/login', h(async (req, res) => {
  const { username, password, portal = 'user' } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Mobile number / username and password are required' });
  const id = username.trim().toLowerCase();
  const phone = cleanPhone(id);

  let user = (await query('SELECT * FROM users WHERE username = $1 LIMIT 1', [id])).rows[0];
  if (!user && /^[6-9]\d{9}$/.test(phone) && (portal === 'user' || portal === 'agent')) user = await accountByPhone(phone, portal);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    log(user?.id ?? null, null, 'login_failed', `password (${portal})`, ipOf(req));
    const noPassword = user && user.has_password === false;
    return res.status(401).json({
      error: noPassword ? 'This account has no password yet. Log in with Mobile OTP, or use "Forgot password?" to set one.' : 'Wrong mobile number / username or password',
    });
  }
  const blocked = await portalError(user, portal);
  if (blocked) return res.status(403).json({ error: blocked });
  log(user.id, user.email, 'login', `password (${portal})`, ipOf(req));
  res.json({ token: signToken(user), user: publicUser(user) });
}));

// ---------- 📱 mobile number + OTP ----------
// Our server makes and checks the 6-digit code; 2Factor only delivers the SMS (src/sms.js).
//   1) POST /phone/request  { phone }                → SMS sent
//   2) POST /phone/verify   { phone, code, portal }  → portal 'user':  existing customer logged in · new number: { needName, proof }
//                                                      portal 'agent': approved agent logged in
//                                                      portal 'agent_apply': { proof } for the agent application form
//   3) POST /phone/complete { proof, fullName }      → customer account created and logged in
// Google Play review: REVIEW_PHONE + REVIEW_OTP in .env give one fixed number a fixed OTP and no SMS. Leave both
// empty except while the app is in review.
const phoneHash = (phone, code) =>
  crypto.createHash('sha256').update(`${phone}|phone|${code}|${process.env.JWT_SECRET}`).digest('hex');
const proofFor = (phone, purpose, expiresIn) => jwt.sign({ phone, purpose }, process.env.JWT_SECRET, { expiresIn });
const reviewNumber = (phone) =>
  Boolean(process.env.REVIEW_PHONE) && cleanPhone(process.env.REVIEW_PHONE) === phone && /^\d{6}$/.test(process.env.REVIEW_OTP || '');

const PHONE_ERRORS = {
  no_code: 'That OTP is not valid. Please ask for a new one.',
  expired: 'That OTP has expired. Please ask for a new one.',
  locked: 'Too many wrong tries. Please ask for a new OTP.',
};
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

// Checks a phone + OTP pair (the OTP is used up). Returns the clean phone number or throws a friendly error.
async function checkPhoneCode(body, ip) {
  const phone = cleanPhone(body?.phone);
  const code = String(body?.code || '').trim();
  if (!/^[6-9]\d{9}$/.test(phone)) throw badRequest('Enter a valid 10-digit mobile number');
  if (!/^\d{6}$/.test(code)) throw badRequest('Enter the 6-digit OTP from the SMS');
  const { rows } = await query('SELECT * FROM fn_phone_otp_check($1,$2,$3)', [phone, phoneHash(phone, code), ip]);
  const r = rows[0];
  if (r.status === 'ok') return phone;
  throw badRequest(r.status === 'wrong' ? `Wrong OTP. ${r.attempts_left} ${r.attempts_left === 1 ? 'try' : 'tries'} left.` : PHONE_ERRORS[r.status]);
}

router.post('/phone/request', h(async (req, res) => {
  const phone = cleanPhone(req.body?.phone);
  if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
  const review = reviewNumber(phone);
  const code = review ? process.env.REVIEW_OTP : newCode();
  const { rows } = await query('SELECT fn_phone_otp_request($1,$2,$3,$4) AS id', [phone, phoneHash(phone, code), ipOf(req), OTP_MINUTES]);
  if (!review) {
    try {
      await sendOtpSms(phone, code);
    } catch (err) {
      await query('CALL sp_phone_otp_failed($1)', [rows[0].id]).catch(() => {});
      throw err;
    }
  }
  res.json({
    sent: true, minutes: OTP_MINUTES, testMode: SMS_TEST_MODE,
    devCode: SMS_TEST_MODE && process.env.NODE_ENV !== 'production' ? code : undefined,
  });
}));

async function phoneLogin(req, res, user, phone, portal) {
  const blocked = await portalError(user, portal);
  if (blocked) return res.status(403).json({ error: blocked });
  const { rows } = await query('UPDATE users SET phone = $2, phone_verified_at = coalesce(phone_verified_at, now()) WHERE id = $1 RETURNING *', [user.id, phone]);
  log(user.id, user.email, 'login', `mobile OTP (${portal})`, ipOf(req));
  res.json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
}

router.post('/phone/verify', h(async (req, res) => {
  const portal = ['user', 'agent', 'agent_apply'].includes(req.body?.portal) ? req.body.portal : 'user';
  const phone = await checkPhoneCode(req.body, ipOf(req));
  if (portal === 'agent_apply') {
    // one agent account per number: an earlier application must be finished first
    const a = await agentByPhone(phone);
    const { rows } = a ? await query('SELECT status FROM agents WHERE user_id = $1', [a.id]) : { rows: [] };
    if (['active', 'suspended'].includes(rows[0]?.status)) return res.status(409).json({ error: 'You already have an agent account with this number. Please log in.' });
    if (rows[0]?.status === 'pending') return res.status(409).json({ error: 'Your application with this number is already under review.' });
    return res.json({ proof: proofFor(phone, 'agent_apply', '2h'), phone }); // time to fill the form and upload documents
  }
  if (portal === 'agent') {
    const agent = await agentByPhone(phone);
    if (!agent) return res.status(404).json({ error: 'No agent account with this number. New here? Apply as an agent first.' });
    return phoneLogin(req, res, agent, phone, 'agent');
  }
  const user = await customerByPhone(phone);
  if (user) return phoneLogin(req, res, user, phone, 'user');
  res.json({ needName: true, proof: proofFor(phone, 'phone_signup', '15m') }); // new number: ask the name
}));

router.post('/phone/complete', h(async (req, res) => {
  let phone;
  try {
    const p = jwt.verify(String(req.body?.proof || ''), process.env.JWT_SECRET);
    if (p.purpose !== 'phone_signup') throw new Error('bad');
    phone = p.phone;
  } catch {
    return res.status(401).json({ error: 'Your OTP check has expired. Please start again.' });
  }
  const existing = await customerByPhone(phone); // e.g. two taps: never create a second account
  if (existing) return phoneLogin(req, res, existing, phone, 'user');
  const name = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Please enter your name (2–60 letters)' });
  const randomPassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10); // they log in with OTP
  let username = `m${phone}`;
  for (let i = 2; (await query('SELECT 1 FROM users WHERE username = $1', [username])).rowCount; i++) username = `m${phone}_${i}`;
  const { rows } = await query(
    `INSERT INTO users (username, password_hash, full_name, phone, role, phone_verified_at, has_password)
     VALUES ($1, $2, $3, $4, 'customer', now(), false) RETURNING *`, [username, randomPassword, name, phone]);
  log(rows[0].id, null, 'register', 'mobile OTP', ipOf(req));
  res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
}));

// The agent application form sends this proof (from /phone/verify portal 'agent_apply'). Returns the phone or null.
export function verifiedApplyPhone(proof) {
  try {
    const p = jwt.verify(String(proof || ''), process.env.JWT_SECRET);
    return p.purpose === 'agent_apply' ? p.phone : null;
  } catch {
    return null;
  }
}

// ---------- forgot password (by mobile OTP) ----------
// 1) POST /phone/request { phone }  2) POST /password/reset { phone, code, password, portal: 'user' | 'agent' }
router.post('/password/reset', h(async (req, res) => {
  const { password } = req.body || {};
  const portal = req.body?.portal === 'agent' ? 'agent' : 'user';
  if (!validPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });
  const phone = await checkPhoneCode(req.body, ipOf(req));
  const user = await accountByPhone(phone, portal);
  if (!user) {
    return res.status(404).json({ error: portal === 'agent' ? 'No agent account with this number.' : 'No account with this number. Log in with Mobile OTP to create one.' });
  }
  await setPassword(user.id, password, 'forgot password (mobile OTP)', ipOf(req));
  await query('UPDATE users SET phone_verified_at = coalesce(phone_verified_at, now()) WHERE id = $1', [user.id]);
  res.json({ ok: true, message: 'Password changed. You can log in with your mobile number and new password.' });
}));

// ---------- logged-in account ----------
router.get('/me', requireAuth, h(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(rows[0]) });
}));

// body: { current, password }. An account made by mobile OTP has no password yet: it sets one without "current".
router.post('/password/change', requireAuth, h(async (req, res) => {
  const { current, password } = req.body || {};
  if (!validPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const first = rows[0]?.has_password === false;
  if (!rows[0] || (!first && !(await bcrypt.compare(current || '', rows[0].password_hash)))) {
    log(req.user.id, rows[0]?.email, 'password_change_failed', 'wrong current password', ipOf(req));
    return res.status(400).json({ error: 'Your current password is not correct' });
  }
  await setPassword(req.user.id, password, first ? 'password set in account' : 'changed in account', ipOf(req));
  const { rows: u } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  res.json({ ok: true, user: publicUser(u[0]) });
}));

export default router;
