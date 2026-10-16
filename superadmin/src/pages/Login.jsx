import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import AuthLayout from './AuthLayout.jsx';
import EmailCode from '../components/EmailCode.jsx';
import PhoneLogin from '../components/PhoneLogin.jsx';
import { InstallButton } from '../components/InstallApp.jsx';
import { HOME_OF, PORTALS_OF, has } from '../appKind.js';

const ALL_PORTALS = {
  user: { label: 'User', icon: '👤', title: 'Welcome back 👋', subtitle: 'Log in to book your next service', button: 'Login' },
  agent: { label: 'Agent', icon: '🛵', title: 'Agent login', subtitle: 'Go online, pick orders near you and track your earnings', button: 'Login to agent app' },
  admin: { label: 'Admin', icon: '🛡️', title: 'Franchise admin login', subtitle: 'Run your city: orders, agents, areas and reports', button: 'Login to admin panel' },
  superadmin: { label: 'HQ', icon: '👑', title: 'Super Admin login', subtitle: 'All franchises, the master catalog and platform reports', button: 'Login to HQ' },
};
// only the logins of this app (the separate customer / agent / admin / HQ apps have one each)
const PORTALS = Object.fromEntries(PORTALS_OF.map((k) => [k, ALL_PORTALS[k]]));
const HOME = { user: '/', agent: '/agent', admin: '/admin', superadmin: '/super' };
const homeFor = (role) => HOME_OF[role] || '/';
const STAFF = ['admin', 'superadmin'];

export default function Login() {
  const { user, login, loginWithCode, loginWithPhone } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const portal = PORTALS[params.get('as')] ? params.get('as') : PORTALS_OF[0];
  // Customers: 📱 mobile OTP first (most people have a phone, not everyone uses email), or an email code, or a password.
  // Agents: password or email code. Admins always use a password.
  const asked = params.get('method');
  const method = STAFF.includes(portal) ? 'password'
    : portal === 'user' && (asked === 'phone' || !asked) ? 'phone'
    : asked === 'code' ? 'code' : 'password';
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const p = PORTALS[portal];
  const go = (next) => {
    setError('');
    setParams({ ...(next.portal !== PORTALS_OF[0] && { as: next.portal }), ...(next.method !== 'phone' && { method: next.method }) }, { replace: true });
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
    <AuthLayout title={p.title} subtitle={p.subtitle}>
      {PORTALS_OF.length > 1 && <div className={`portal-switch portals-${PORTALS_OF.length}`} role="tablist" aria-label="Login as">
        {Object.entries(PORTALS).map(([key, v]) => (
          <button key={key} type="button" role="tab" aria-selected={portal === key} className={portal === key ? 'active' : ''} onClick={() => go({ portal: key, method })}>
            <span>{v.icon}</span> {v.label}
          </button>
        ))}
      </div>}

      {!STAFF.includes(portal) && (
        <div className="method-switch" role="tablist" aria-label="Login method">
          {portal === 'user' && <button type="button" role="tab" aria-selected={method === 'phone'} className={method === 'phone' ? 'active' : ''} onClick={() => go({ portal, method: 'phone' })}>📱 Mobile OTP</button>}
          <button type="button" role="tab" aria-selected={method === 'password'} className={method === 'password' ? 'active' : ''} onClick={() => go({ portal, method: 'password' })}>🔑 Password</button>
          <button type="button" role="tab" aria-selected={method === 'code'} className={method === 'code' ? 'active' : ''} onClick={() => go({ portal, method: 'code' })}>📧 Email code</button>
        </div>
      )}

      {method === 'phone' ? (
        <PhoneLogin
          submitLabel={p.button}
          login={async (path, body) => {
            const d = await loginWithPhone(path, body);
            if (!d?.needName) done();
            return d;
          }}
        />
      ) : method === 'code' ? (
        <EmailCode
          key={portal}
          requestPath="/auth/otp/request"
          extra={{ portal }}
          submitLabel={p.button}
          onCode={async (email, code) => {
            await loginWithCode(email, code, portal);
            done();
          }}
        />
      ) : (
        <form onSubmit={onSubmit} className="form">
          <label>
            Username or email
            <input
              autoFocus
              autoComplete="username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder={STAFF.includes(portal) ? 'Admin username' : 'Username or email'}
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

      {portal === 'user' && has('customer') && <p className="switch">New here? <Link to="/register">Create an account</Link></p>}
      {portal === 'agent' && has('agent') && <p className="switch">Want to work with us? <Link to="/agent/apply">Apply as an agent</Link></p>}
      {portal === 'admin' && <p className="switch">Franchise admin logins are created by HQ (Super Admin).</p>}
      {portal === 'superadmin' && <p className="switch">HQ only. Every login is recorded.</p>}
      {!STAFF.includes(portal) && <InstallButton className="btn btn-ghost btn-block install-login" />}
    </AuthLayout>
  );
}
