import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import AuthLayout from './AuthLayout.jsx';

// Forgot password (customers and agents): mobile number → OTP by SMS + new password → done.
export default function ForgotPassword() {
  const [params] = useSearchParams();
  const asAgent = params.get('as') === 'agent';
  const [step, setStep] = useState('phone'); // 'phone' | 'code' | 'done'
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const loginLink = `/login?${asAgent ? 'as=agent&' : ''}method=password`;

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async (e) => {
    e?.preventDefault();
    setError('');
    if (!/^[6-9]\d{9}$/.test(phone)) return setError('Enter a valid 10-digit mobile number');
    setBusy(true);
    try {
      setInfo(await api('/auth/phone/request', { method: 'POST', body: { phone } }));
      setStep('code');
      setCode('');
      setWait(30);
    } catch (err) {
      setError(err.message);
      const secs = err.message.match(/wait (\d+) seconds/);
      if (secs) {
        setStep('code');
        setWait(Number(secs[1]));
      }
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit OTP from the SMS');
    if (pw.password.length < 6) return setError('Password must be at least 6 characters');
    if (pw.password !== pw.confirm) return setError('The two passwords do not match');
    setBusy(true);
    try {
      await api('/auth/password/reset', { method: 'POST', body: { phone, code, password: pw.password, portal: asAgent ? 'agent' : 'user' } });
      setStep('done');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={step === 'done' ? 'Password changed ✅' : 'Forgot password?'}
      subtitle={step === 'done' ? 'You can now log in with your mobile number and new password.' : "We'll send an OTP to your mobile number to set a new password."}
    >
      {step === 'done' && (
        <div className="form">
          <Link className="btn btn-primary btn-center" to={loginLink}>Go to login</Link>
        </div>
      )}

      {step === 'phone' && (
        <form className="form" onSubmit={send}>
          <label>
            Mobile number on your account
            <div className="phone-field">
              <span className="phone-prefix">🇮🇳 +91</span>
              <input
                type="tel" inputMode="numeric" autoComplete="tel-national" autoFocus value={phone} maxLength={10}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').replace(/^(91|0)(?=\d{10})/, '').slice(0, 10))}
                placeholder="10-digit mobile number" required
              />
            </div>
          </label>
          {error && <div className="alert">{error}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending OTP…' : 'Send OTP'}</button>
        </form>
      )}

      {step === 'code' && (
        <form className="form" onSubmit={reset}>
          <p className="code-sent">
            OTP sent to <b>+91 {phone}</b>. It is valid for {info?.minutes || 10} minutes.{' '}
            <button type="button" className="link-btn" onClick={() => { setStep('phone'); setError(''); }}>Change</button>
          </p>
          {info?.devCode && <div className="test-code">🧪 Test mode (SMS not set up yet): your OTP is <b>{info.devCode}</b></div>}
          <label>
            6-digit OTP
            <input
              className="code-input" value={code} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" required autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          <div className="form-row">
            <label>New password<input type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} placeholder="Min 6 characters" required minLength={6} /></label>
            <label>Confirm<input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} placeholder="Repeat password" required /></label>
          </div>
          {error && <div className="alert">{error}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
          <button type="button" className="link-btn resend" disabled={busy || wait > 0} onClick={send}>
            {wait > 0 ? `Resend OTP in ${wait}s` : 'Resend OTP'}
          </button>
        </form>
      )}

      {step !== 'done' && <p className="switch">Remembered it? <Link to={loginLink}>Back to login</Link></p>}
    </AuthLayout>
  );
}
