import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

// 🔑 A customer who logged in by OTP but has no password yet (an older account, or one that always used OTP) sets
// one right away — next time they sign in with mobile number + password, no OTP (and no SMS for us).
// The server lets a first password be set without a "current password".
export default function SetPasswordGate() {
  const { user, setUser, logout } = useAuth();
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user || user.role !== 'customer' || user.hasPassword) return null;

  const save = async (e) => {
    e.preventDefault();
    setError('');
    if (pw.password.length < 6) return setError('Create a password of at least 6 characters');
    if (pw.password !== pw.confirm) return setError('The two passwords do not match');
    setBusy(true);
    try {
      const d = await api('/auth/password/change', { method: 'POST', body: { password: pw.password } });
      setUser(d.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="set-pw-title">
      <form className="modal panel form set-password" onSubmit={save}>
        <h3 id="set-pw-title">🔑 Set your password</h3>
        <p className="muted small">Next time, sign in with your mobile number and this password — no OTP needed.</p>
        <label>
          Create a password
          <input type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })}
            placeholder="At least 6 characters" required minLength={6} autoFocus />
        </label>
        <label>
          Confirm password
          <input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            placeholder="Type it again" required />
        </label>
        {error && <div className="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        <button type="button" className="link-btn" onClick={logout}>Not you? Log out</button>
      </form>
    </div>,
    document.body,
  );
}
