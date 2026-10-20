import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

// Mobile number and password. Used on the customer Account page and in the agent app Profile tab.
// Accounts made by mobile OTP have no password yet: they can set one here (no "current password" needed).
export default function AccountSecurity() {
  const { user, setUser } = useAuth();
  const first = user.hasPassword === false;
  const [pw, setPw] = useState({ current: '', password: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const changePassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw.password !== pw.confirm) return setPwMsg({ error: 'The two new passwords do not match' });
    setBusy(true);
    try {
      const d = await api('/auth/password/change', { method: 'POST', body: { current: pw.current, password: pw.password } });
      setPw({ current: '', password: '', confirm: '' });
      setPwMsg({ ok: first ? 'Password set ✅ You can now also log in with your mobile number and password.' : 'Password changed ✅' });
      if (d.user) setUser(d.user);
    } catch (err) {
      setPwMsg({ error: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-grid">
      <section className="panel">
        <h3>📱 Mobile number</h3>
        <p className="muted small">You log in with this number and an OTP by SMS.</p>
        <div className="email-row">
          <b>{user.phone ? `+91 ${user.phone}` : 'Not added'}</b>
        </div>
      </section>

      <section className="panel">
        <h3>🔑 {first ? 'Set a password (optional)' : 'Change password'}</h3>
        {first && <p className="muted small">Log in without waiting for an OTP: your mobile number + this password.</p>}
        <form className="form" onSubmit={changePassword}>
          {!first && <label>Current password<input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></label>}
          <div className="form-row">
            <label>New password<input type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} required minLength={6} placeholder="Min 6 characters" /></label>
            <label>Confirm<input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></label>
          </div>
          {pwMsg?.error && <div className="alert">{pwMsg.error}</div>}
          {pwMsg?.ok && <div className="ok-msg">{pwMsg.ok}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : first ? 'Set password' : 'Change password'}</button>
          {!first && <small className="muted">Forgot your current password? Log out and use “Forgot password?” on the login page (OTP to your mobile).</small>}
        </form>
      </section>
    </div>
  );
}
