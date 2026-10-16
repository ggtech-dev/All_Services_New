import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { TEST_MODE, sendOtpEmail } from '../mailer.js';
import { SMS_TEST_MODE, sendOtpSms } from '../sms.js';

const router = Router();
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const publicUser = (u) => ({
  id: u.id, username: u.username, fullName: u.full_name, phone: u.phone, role: u.role, franchiseId: u.franchise_id ?? null,
  email: u.email, emailVerified: Boolean(u.email_verified_at),
});

const signToken = (u) =>
  jwt.sign({ id: u.id, username: u.username, role: u.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

const ipOf = (req) => (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '').trim().slice(0, 64);
const log = (userId, email, event, detail, ip) =>
  query('CALL sp_auth_log($1,$2,$3,$4,$5)', [userId, email, event, detail, ip]).catch((e) => console.error('auth log:', e.message));

const validPassword = (p) => typeof p === 'string' && p.length >= 6 && p.length <= 100;
const PASSWORD_RULE = 'Password must be 6–100 characters';

// ---------- OTP codes ----------
const OTP_MINUTES = 10;
// Only a keyed hash of the code is stored, bound to the email and purpose.
const hashCode = (email, purpose, code) =>
  crypto.createHash('sha256').update(`${email.trim().toLowerCase()}|${purpose}|${code}|${process.env.JWT_SECRET}`).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

const OTP_ERRORS = {
  no_code: 'That code is not valid. Please ask for a new one.',
  expired: 'That code has expired. Please ask for a new one.',
  locked: 'Too many wrong attempts. Please ask for a new code.',
};

async function checkCode(email, purpose, code, ip) {
  if (!/^\d{6}$/.test(String(code || '').trim())) throw Object.assign(new Error('Enter the 6-digit code from your email'), { status: 400 });
  const { rows } = await query('SELECT * FROM fn_otp_check($1,$2,$3,$4)', [email, purpose, hashCode(email, purpose, String(code).trim()), ip]);
  const r = rows[0];
  if (r.status === 'ok') return r.user_id;
  const message = r.status === 'wrong'
    ? `Wrong code. ${r.attempts_left} attempt${r.attempts_left === 1 ? '' : 's'} left.`
    : OTP_ERRORS[r.status];
  throw Object.assign(new Error(message), { status: 400 });
}

// Sends a code by email. In test mode the code is printed in the server terminal, and outside production
// it is also returned as `devCode` so the login screen can show it while testing.
async function issueCode({ email, purpose, userId = null, ip }) {
  const code = newCode();
  const { rows } = await query('SELECT * FROM fn_otp_request($1,$2,$3,$4,$5,$6)', [
    email, purpose, hashCode(email, purpose, code), userId, ip, OTP_MINUTES,
  ]);
  const target = rows[0];
  if (Math.random() < 0.02) query('CALL sp_auth_cleanup()').catch(() => {}); // occasional housekeeping
  if (target.user_id) {
    await sendOtpEmail({ to: email.trim(), name: target.full_name, code, purpose, minutes: OTP_MINUTES });
  }
  return TEST_MODE && process.env.NODE_ENV !== 'production' && target.user_id ? code : undefined;
}

// ---------- which portal may this account use ----------
// portal: 'user' | 'agent' | 'admin' — the tab chosen on the login page. Returns an error message or null.
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
    const { rows: a } = await query('SELECT status, rejection_reason FROM agents WHERE user_id = $1', [user.id]);
    const messages = {
      pending: 'Your application is under review. You can log in once the admin approves it.',
      rejected: `Your application was not approved: ${a[0]?.rejection_reason || 'please contact support'}.`,
      suspended: 'Your agent account is suspended. Please contact the admin.',
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

// ---------- sign-up (email verified with a code before the account exists) ----------
// Step 1. body: { username, email, password, fullName, phone } → emails a 6-digit code.
router.post('/register/start', h(async (req, res) => {
  const { username, password, fullName, phone, email } = req.body || {};
  if (!username || !password || !email) return res.status(400).json({ error: 'Username, email and password are required' });
  if (!validPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });
  const code = newCode();
  await query('SELECT fn_register_start($1,$2,$3,$4,$5,$6,$7)', [
    username, email, await bcrypt.hash(password, 10), fullName || null, phone || null,
    hashCode(email, 'register', code), ipOf(req),
  ]);
  await sendOtpEmail({ to: email.trim(), name: fullName || username, code, purpose: 'register', minutes: OTP_MINUTES });
  res.json({
    sent: true, message: `We sent a 6-digit code to ${email.trim()}.`, minutes: OTP_MINUTES, testMode: TEST_MODE,
    devCode: TEST_MODE && process.env.NODE_ENV !== 'production' ? code : undefined,
  });
}));

// Step 2. body: { email, code } → creates the account and logs in.
router.post('/register/verify', h(async (req, res) => {
  const { email, code } = req.body || {};
  if (!/^\d{6}$/.test(String(code || '').trim())) return res.status(400).json({ error: 'Enter the 6-digit code from your email' });
  const { rows } = await query('SELECT * FROM fn_register_complete($1,$2,$3)', [email || '', hashCode(email || '', 'register', String(code).trim()), ipOf(req)]);
  const r = rows[0];
  const errors = {
    ...OTP_ERRORS,
    wrong: `Wrong code. ${r.attempts_left} attempt${r.attempts_left === 1 ? '' : 's'} left.`,
    username_taken: 'Sorry, that username was just taken. Please start again with another one.',
    email_taken: 'An account with this email already exists. Try logging in with an email code.',
  };
  if (r.status !== 'ok') return res.status(400).json({ error: errors[r.status] });
  const { rows: u } = await query('SELECT * FROM users WHERE id = $1', [r.user_id]);
  res.status(201).json({ token: signToken(u[0]), user: publicUser(u[0]) });
}));

// ---------- password login ----------

// Password login with username or email.
router.post('/login', h(async (req, res) => {
  const { username, password, portal = 'user' } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  const id = username.trim().toLowerCase();

  const { rows } = await query('SELECT * FROM users WHERE username = $1 OR lower(email) = $1 LIMIT 1', [id]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    log(user?.id ?? null, user?.email ?? (id.includes('@') ? id : null), 'login_failed', `password (${portal})`, ipOf(req));
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const blocked = await portalError(user, portal);
  if (blocked) return res.status(403).json({ error: blocked });
  log(user.id, user.email, 'login', `password (${portal})`, ipOf(req));
  res.json({ token: signToken(user), user: publicUser(user) });
}));

// ---------- email OTP login ----------
// body: { email, portal }. Always answers the same way whether or not the email is registered.
router.post('/otp/request', h(async (req, res) => {
  const { email, portal = 'user' } = req.body || {};
  if (portal === 'admin' || portal === 'superadmin') return res.status(400).json({ error: 'Admins log in with their password' });
  const devCode = await issueCode({ email: email || '', purpose: 'login', ip: ipOf(req) });
  res.json({ sent: true, message: 'If this email is registered, a 6-digit code is on its way.', minutes: OTP_MINUTES, testMode: TEST_MODE, devCode });
}));

// body: { email, code, portal }
router.post('/otp/login', h(async (req, res) => {
  const { email, code, portal = 'user' } = req.body || {};
  if (portal === 'admin' || portal === 'superadmin') return res.status(400).json({ error: 'Admins log in with their password' });
  const userId = await checkCode(email || '', 'login', code, ipOf(req));
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  const blocked = await portalError(rows[0], portal);
  if (blocked) return res.status(403).json({ error: blocked });
  log(userId, email, 'login', `email code (${portal})`, ipOf(req));
  res.json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
}));

// ---------- 📱 mobile number + OTP (customers) ----------
// Our server makes and checks the 6-digit code; 2Factor only delivers the SMS (src/sms.js).
//   1) POST /phone/request  { phone }          → SMS sent
//   2) POST /phone/verify   { phone, code }    → existing customer: logged in · new number: { needName, proof }
//   3) POST /phone/complete { proof, fullName } → account created and logged in
const phoneHash = (phone, code) =>
  crypto.createHash('sha256').update(`${phone}|phone|${code}|${process.env.JWT_SECRET}`).digest('hex');
const cleanPhone = (v) => String(v || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
const proofFor = (phone) => jwt.sign({ phone, purpose: 'phone_signup' }, process.env.JWT_SECRET, { expiresIn: '15m' });

router.post('/phone/request', h(async (req, res) => {
  const phone = cleanPhone(req.body?.phone);
  if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
  const code = newCode();
  const { rows } = await query('SELECT fn_phone_otp_request($1,$2,$3,$4) AS id', [phone, phoneHash(phone, code), ipOf(req), OTP_MINUTES]);
  try {
    await sendOtpSms(phone, code);
  } catch (err) {
    await query('CALL sp_phone_otp_failed($1)', [rows[0].id]).catch(() => {});
    throw err;
  }
  res.json({
    sent: true, minutes: OTP_MINUTES, testMode: SMS_TEST_MODE,
    devCode: SMS_TEST_MODE && process.env.NODE_ENV !== 'production' ? code : undefined,
  });
}));

// The customer account for a number: one already verified by OTP first, else the newest one.
const customerByPhone = async (phone) => (await query(
  `SELECT * FROM users WHERE role = 'customer' AND right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1
    ORDER BY (phone_verified_at IS NOT NULL) DESC, created_at DESC LIMIT 1`, [phone])).rows[0];

async function phoneLogin(req, res, user, phone) {
  const blocked = await portalError(user, 'user');
  if (blocked) return res.status(403).json({ error: blocked });
  const { rows } = await query('UPDATE users SET phone = $2, phone_verified_at = coalesce(phone_verified_at, now()) WHERE id = $1 RETURNING *', [user.id, phone]);
  log(user.id, user.email, 'login', 'mobile OTP (user)', ipOf(req));
  res.json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
}

router.post('/phone/verify', h(async (req, res) => {
  const phone = cleanPhone(req.body?.phone);
  const code = String(req.body?.code || '').trim();
  if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit OTP from the SMS' });
  const { rows } = await query('SELECT * FROM fn_phone_otp_check($1,$2,$3)', [phone, phoneHash(phone, code), ipOf(req)]);
  const r = rows[0];
  if (r.status !== 'ok') {
    const errors = {
      ...OTP_ERRORS,
      no_code: 'That OTP is not valid. Please ask for a new one.',
      expired: 'That OTP has expired. Please ask for a new one.',
      locked: 'Too many wrong tries. Please ask for a new OTP.',
      wrong: `Wrong OTP. ${r.attempts_left} ${r.attempts_left === 1 ? 'try' : 'tries'} left.`,
    };
    return res.status(400).json({ error: errors[r.status] });
  }
  const user = await customerByPhone(phone);
  if (user) return phoneLogin(req, res, user, phone);
  res.json({ needName: true, proof: proofFor(phone) }); // new number: ask the name (proof is valid 15 minutes)
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
  if (existing) return phoneLogin(req, res, existing, phone);
  const name = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Please enter your name (2–60 letters)' });
  const randomPassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10); // they log in with OTP
  let username = `m${phone}`;
  for (let i = 2; (await query('SELECT 1 FROM users WHERE username = $1', [username])).rowCount; i++) username = `m${phone}_${i}`;
  const { rows } = await query(
    `INSERT INTO users (username, password_hash, full_name, phone, role, phone_verified_at)
     VALUES ($1, $2, $3, $4, 'customer', now()) RETURNING *`, [username, randomPassword, name, phone]);
  log(rows[0].id, null, 'register', 'mobile OTP', ipOf(req));
  res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
}));

// ---------- forgot password ----------
// body: { email }
router.post('/password/forgot', h(async (req, res) => {
  const devCode = await issueCode({ email: req.body?.email || '', purpose: 'reset', ip: ipOf(req) });
  res.json({ sent: true, message: 'If this email is registered, a 6-digit code is on its way.', minutes: OTP_MINUTES, testMode: TEST_MODE, devCode });
}));

// body: { email, code, password }
router.post('/password/reset', h(async (req, res) => {
  const { email, code, password } = req.body || {};
  if (!validPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });
  const userId = await checkCode(email || '', 'reset', code, ipOf(req));
  await query('CALL sp_set_password($1,$2,$3,$4)', [userId, await bcrypt.hash(password, 10), 'forgot password (email code)', ipOf(req)]);
  res.json({ ok: true, message: 'Password changed. You can log in with your new password.' });
}));

// ---------- logged-in account ----------
router.get('/me', requireAuth, h(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(rows[0]) });
}));

// body: { current, password }
router.post('/password/change', requireAuth, h(async (req, res) => {
  const { current, password } = req.body || {};
  if (!validPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });
  const { rows } = await query('SELECT password_hash, email FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0] || !(await bcrypt.compare(current || '', rows[0].password_hash))) {
    log(req.user.id, rows[0]?.email, 'password_change_failed', 'wrong current password', ipOf(req));
    return res.status(400).json({ error: 'Your current password is not correct' });
  }
  await query('CALL sp_set_password($1,$2,$3,$4)', [req.user.id, await bcrypt.hash(password, 10), 'changed in account', ipOf(req)]);
  res.json({ ok: true });
}));

// Add or change email: a code is sent to the NEW address and must be confirmed. body: { email }
router.post('/email/request', requireAuth, h(async (req, res) => {
  const devCode = await issueCode({ email: req.body?.email || '', purpose: 'verify_email', userId: req.user.id, ip: ipOf(req) });
  res.json({ sent: true, message: `We sent a code to ${req.body.email}.`, minutes: OTP_MINUTES, testMode: TEST_MODE, devCode });
}));

// body: { email, code }
router.post('/email/verify', requireAuth, h(async (req, res) => {
  const userId = await checkCode(req.body?.email || '', 'verify_email', req.body?.code, ipOf(req));
  if (userId !== req.user.id) return res.status(400).json({ error: 'That code is not valid. Please ask for a new one.' });
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  res.json({ user: publicUser(rows[0]) });
}));

export default router;
