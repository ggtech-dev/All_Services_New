import { useEffect, useState } from 'react';
import { api } from '../api.js';

// 📱 Login with a mobile number. Our server makes the 6-digit OTP and an SMS company (2Factor) delivers it.
// Steps: number → OTP → (new customer number: name). login(path, body) logs in, or returns { needName, proof }.
// portal: 'user' (customers) · 'agent' (approved agents) · 'agent_apply' (checks the number on the agent application)
const HINTS = {
  user: "We'll send a 6-digit OTP by SMS. New here? Your account is created automatically.",
  agent: "Use the mobile number you applied with. We'll send a 6-digit OTP by SMS.",
  agent_apply: "We'll send a 6-digit OTP to check it's your number. This number will be your login for the agent app.",
};

export default function PhoneLogin({ login, submitLabel = 'Login', portal = 'user' }) {
  const [step, setStep] = useState('phone'); // 'phone' | 'code' | 'name'
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [info, setInfo] = useState(null); // answer of /phone/request (devCode in test mode)
  const [proof, setProof] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

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

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit OTP from the SMS');
    setBusy(true);
    try {
      const d = await login('/auth/phone/verify', { phone, code, portal });
      if (d?.needName) {
        setProof(d.proof);
        setStep('name');
        setBusy(false);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const saveName = async (e) => {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) return setError('Please enter your name');
    setBusy(true);
    try {
      await login('/auth/phone/complete', { proof, fullName: name.trim() });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <>
      {step === 'phone' && (
        <form className="form" onSubmit={send}>
          <label>
            Mobile number
            <div className="phone-field">
              <span className="phone-prefix">🇮🇳 +91</span>
              <input
                type="tel" inputMode="numeric" autoComplete="tel-national" autoFocus value={phone} maxLength={10}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').replace(/^(91|0)(?=\d{10})/, '').slice(0, 10))}
                placeholder="10-digit mobile number" required
              />
            </div>
          </label>
          <p className="muted small">{HINTS[portal] || HINTS.user}</p>
          {error && <div className="alert">{error}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending OTP…' : 'Send OTP'}</button>
        </form>
      )}

      {step === 'code' && (
        <form className="form" onSubmit={verify}>
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
          {error && <div className="alert">{error}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : submitLabel}</button>
          <button type="button" className="link-btn resend" disabled={busy || wait > 0} onClick={send}>
            {wait > 0 ? `Resend OTP in ${wait}s` : 'Resend OTP'}
          </button>
        </form>
      )}

      {step === 'name' && (
        <form className="form" onSubmit={saveName}>
          <p className="code-sent">✅ <b>+91 {phone}</b> verified. You're new here — what's your name?</p>
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} autoComplete="name" placeholder="e.g. Ravi Kumar" required autoFocus />
          </label>
          {error && <div className="alert">{error}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating your account…' : 'Continue'}</button>
        </form>
      )}
    </>
  );
}
