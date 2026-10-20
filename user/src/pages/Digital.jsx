import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Skeleton from '../components/Skeleton.jsx';

// 💡 Digital Services: websites, apps, software and video editing. The customer sends a request; our team (HQ) calls
// them and agrees everything on the phone. No price and no payment in the app.
const STATUS = { new: ['Received', 'warn'], called: ['We called you', 'ok'], quoted: ['Quotation sent', 'ok'], won: ['Confirmed', 'ok'], lost: ['Closed', ''] };

export default function Digital() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [info, setInfo] = useState(null);
  const [mine, setMine] = useState([]);
  const [picked, setPicked] = useState(null); // [icon, name, hint]
  const [done, setDone] = useState(false);
  const tab = params.get('tab') === 'video' ? 'video' : 'software';

  useEffect(() => {
    api('/digital/services').then(setInfo).catch(() => {});
  }, []);
  const loadMine = () => user && api('/digital/requests/mine').then(setMine).catch(() => {});
  useEffect(() => {
    loadMine();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!info) return <Skeleton variant="grid" />;
  const choose = (item) => {
    if (!user) return navigate('/login', { state: { from: location.pathname + location.search } });
    setDone(false);
    setPicked(item);
    window.scrollTo(0, 0);
  };

  return (
    <div className="digital-page">
      <Link to="/" className="back-link">← All categories</Link>
      <section className="digital-hero">
        <h1>💡 Digital Services</h1>
        <p className="digital-tagline">Your vision, our execution</p>
        <p>Websites, mobile apps, software and video editing. Tell us what you need — our team calls you and plans it with you.</p>
      </section>

      {done && <div className="ok-msg digital-done">✅ Request received! Our team will call you within 24 hours.</div>}
      {picked ? (
        <RequestForm tab={tab} item={picked} info={info} user={user} onCancel={() => setPicked(null)} onSent={() => { setPicked(null); setDone(true); loadMine(); window.scrollTo(0, 0); }} />
      ) : (
        <>
          <div className="shop-tabs" role="tablist">
            {Object.entries(info.tabs).map(([k, t]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setParams({ tab: k }, { replace: true })}>{t.title}</button>
            ))}
          </div>
          <div className="digital-grid">
            {info.tabs[tab].items.map((it) => (
              <button key={it[1]} type="button" className="digital-card" onClick={() => choose(it)}>
                <span className="digital-icon">{it[0]}</span>
                <b>{it[1]}</b>
                <small>{it[2]}</small>
                <span className="digital-cta">Request →</span>
              </button>
            ))}
          </div>
        </>
      )}

      {mine.length > 0 && (
        <section className="panel">
          <h3>📋 My requests</h3>
          <ul className="digital-mine">
            {mine.map((r) => {
              const [label, tone] = STATUS[r.status] || [r.status, ''];
              return (
                <li key={r.id}>
                  <div><b>{r.service}</b><small className="muted">{new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {r.timing}</small></div>
                  <span className={`ride-status ${tone}`}>{label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function RequestForm({ tab, item, info, user, onCancel, onSent }) {
  const [f, setF] = useState({ name: user.fullName || '', phone: user.phone || '', details: '', timing: '', budget: '', link: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const send = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/digital/requests', { method: 'POST', body: { ...f, tab, service: item[1] } });
      onSent();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <form className="panel form digital-form" onSubmit={send}>
      <h3>{item[0]} {item[1]}</h3>
      <p className="muted small">{item[2]}</p>
      <div className="form-row">
        <label>Your name *<input value={f.name} onChange={set('name')} required maxLength={60} /></label>
        <label>Mobile number *<input value={f.phone} onChange={set('phone')} required inputMode="tel" placeholder="10-digit mobile" /></label>
      </div>
      <label>What do you need? *
        <textarea rows={4} maxLength={1500} value={f.details} onChange={set('details')} required
          placeholder={tab === 'video' ? 'e.g. 3 vlogs a week, 8–10 minutes each, with music and titles' : 'e.g. A website for my clothes shop with photos, WhatsApp button and Google Maps'} />
      </label>
      <div className="form-row">
        <label>When do you need it? *
          <select value={f.timing} onChange={set('timing')} required>
            <option value="">Choose…</option>
            {info.timings.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>Budget (optional)
          <select value={f.budget} onChange={set('budget')}>
            <option value="">Not sure</option>
            {info.budgets.filter((b) => b !== 'Not sure').map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
      </div>
      <label>{tab === 'video' ? 'Link to your videos (Google Drive etc., optional)' : 'Reference link (a website you like, optional)'}
        <input value={f.link} onChange={set('link')} placeholder="https://…" inputMode="url" />
      </label>
      {error && <div className="alert">{error}</div>}
      <div className="form-row">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>← Back</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
      </div>
      <p className="muted small">Our team calls you within 24 hours to understand your needs and share a quotation. Nothing to pay in the app.</p>
    </form>
  );
}
