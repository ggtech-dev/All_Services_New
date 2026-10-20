import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import AuthLayout from './AuthLayout.jsx';
import PhoneLogin from '../components/PhoneLogin.jsx';
import { InstallButton } from '../components/InstallApp.jsx';
import { HOME_OF, PORTALS_OF, has } from '../appKind.js';

const ALL_PORTALS = {
  user: { label: 'User', icon: '👤', title: 'Welcome 👋', subtitle: 'Log in with your mobile number to book services', button: 'Login' },
  agent: { label: 'Agent', icon: '🛵', title: 'Agent login', subtitle: 'Go online, pick orders near you and track your earnings', button: 'Login to agent app' },
  admin: { label: 'Admin', icon: '🛡️', title: 'Franchise admin login', subtitle: 'Run your city: orders, agents, areas and reports', button: 'Login to admin panel' },
  superadmin: { label: 'HQ', icon: '👑', title: 'Super Admin login', subtitle: 'All franchises, the master catalog and platform reports', button: 'Login to HQ' },
};
// only the logins of this app (the separate customer / agent / admin / HQ apps have one each)
const PORTALS = Object.fromEntries(PORTALS_OF.map((k) => [k, ALL_PORTALS[k]]));
const HOME = { user: '/', agent: '/agent', admin: '/admin', superadmin: '/super' };
const homeFor = (role) => HOME_OF[role] || '/';
const STAFF = ['admin', 'superadmin'];

// Password login stays for customers and agents until 2Factor's SMS approval is final; then set this to false
// and only 📱 Mobile OTP is left. Admins always use a password.
const PASSWORD_LOGIN = true;

export default function Login() {
  const { user, login, loginWithPhone } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const portal = PORTALS[params.get('as')] ? params.get('as') : PORTALS_OF[0];
  // Customers and agents: 📱 mobile OTP first, or mobile number / username + password.
  // customers choose 👋 Sign in (existing) or 🆕 Sign up (new) — both by mobile OTP; a password only for Sign in
  const signup = portal === 'user' && params.get('mode') === 'signup';
  const method = STAFF.includes(portal) ? 'password' : PASSWORD_LOGIN && !signup && params.get('method') === 'password' ? 'password' : 'phone';
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === 'customer' ? location.state?.from || '/' : homeFor(user.role)} replace />;

  const p = PORTALS[portal];
  const go = (next) => {
    setError('');
    setParams({ ...(next.portal !== PORTALS_OF[0] && { as: next.portal }), ...(next.method !== 'phone' && { method: next.method }), ...(next.signup && { mode: 'signup' }) },
      { replace: true, state: location.state }); // keep "where to go after login" when switching tabs
  };
  const done = () => navigate(portal === 'user' ? location.state?.from || '/' : HOME[portal], { replace: true });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(form.username.trim(), form.password, portal);
      done();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={portal !== 'user' ? p.title : signup ? 'Create your account 🆕' : 'Welcome back 👋'}
      subtitle={portal !== 'user' ? p.subtitle : signup ? 'Sign up free with your mobile number' : 'Sign in with your mobile number'}
    >
      {portal === 'user' && has('customer') && (
        <div className="account-switch" role="tablist" aria-label="Sign in or sign up">
          <button type="button" role="tab" aria-selected={!signup} className={!signup ? 'active' : ''} onClick={() => go({ portal, method: 'phone' })}>
            <b>👋 Sign in</b><small>I already have an account</small>
          </button>
          <button type="button" role="tab" aria-selected={signup} className={signup ? 'active' : ''} onClick={() => go({ portal, method: 'phone', signup: true })}>
            <b>🆕 Sign up</b><small>I am a new customer</small>
          </button>
        </div>
      )}
      {PORTALS_OF.length > 1 && <div className={`portal-switch portals-${PORTALS_OF.length}`} role="tablist" aria-label="Login as">
        {Object.entries(PORTALS).map(([key, v]) => (
          <button key={key} type="button" role="tab" aria-selected={portal === key} className={portal === key ? 'active' : ''} onClick={() => go({ portal: key, method })}>
            <span>{v.icon}</span> {v.label}
          </button>
        ))}
      </div>}

      {!STAFF.includes(portal) && PASSWORD_LOGIN && !signup && (
        <div className="method-switch" role="tablist" aria-label="Login method">
          <button type="button" role="tab" aria-selected={method === 'phone'} className={method === 'phone' ? 'active' : ''} onClick={() => go({ portal, method: 'phone' })}>📱 Mobile OTP</button>
          <button type="button" role="tab" aria-selected={method === 'password'} className={method === 'password' ? 'active' : ''} onClick={() => go({ portal, method: 'password' })}>🔑 Password</button>
        </div>
      )}

      {method === 'phone' ? (
        <PhoneLogin
          key={`${portal}-${signup}`}
          portal={portal}
          intent={signup ? 'signup' : 'signin'}
          submitLabel={p.button}
          login={async (path, body) => {
            const d = await loginWithPhone(path, body);
            if (!d?.needName) done();
            return d;
          }}
        />
      ) : (
        <form onSubmit={onSubmit} className="form">
          <label>
            {STAFF.includes(portal) ? 'Username' : 'Mobile number or username'}
            <input
              autoFocus
              autoComplete="username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder={STAFF.includes(portal) ? 'Admin username' : '10-digit mobile number or username'}
              required
            />
          </label>
          <label>
            <span className="label-row">
              Password
              {!STAFF.includes(portal) && <Link className="link-small" to={`/forgot-password${portal === 'agent' ? '?as=agent' : ''}`}>Forgot password?</Link>}
            </span>
            <div className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Enter your password"
                required
              />
              <button type="button" className="link-btn" onClick={() => setShowPassword((s) => !s)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          {error && <div className="alert">{error}</div>}
          <button className={`btn btn-primary ${STAFF.includes(portal) ? 'btn-dark' : portal === 'agent' ? 'btn-agent' : ''}`} disabled={busy}>
            {busy ? 'Logging in…' : p.button}
          </button>
        </form>
      )}

      {portal === 'user' && has('customer') && (
        <Link to={location.state?.from && !/^\/(checkout|orders|account)/.test(location.state.from) ? location.state.from : '/'} className="btn btn-ghost btn-block guest-link">
          👀 Continue as guest — just looking
        </Link>
      )}
      {portal === 'agent' && has('agent') && <p className="switch">Want to work with us? <Link to="/agent/apply">Apply as an agent</Link></p>}
      {portal === 'admin' && <p className="switch">Franchise admin logins are created by HQ (Super Admin).</p>}
      {portal === 'superadmin' && <p className="switch">HQ only. Every login is recorded.</p>}
      {!STAFF.includes(portal) && <InstallButton className="btn btn-ghost btn-block install-login" />}
    </AuthLayout>
  );
}
