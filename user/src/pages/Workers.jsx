import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Skeleton from '../components/Skeleton.jsx';

// 👷 Daily Workers: a free list of local workers (added by the franchise admin with their permission). Anyone can see
// the list; the phone number shows after a free login. Customers call or WhatsApp the worker directly.
const TABS = [['construction', '🧱 Construction'], ['painters', '🎨 Painters'], ['other', '🧹 Other work']];
const REASONS = [['wrong_number', 'Wrong number'], ['not_answering', 'Not answering'], ['bad_experience', 'Bad experience'], ['other', 'Something else']];

export default function Workers() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'construction';
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [reporting, setReporting] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setData(null);
    api(`/workers?tab=${tab}`).then(setData).catch((e) => setData({ workers: [], error: e.message }));
  }, [tab, user?.id]);

  const term = q.trim().toLowerCase();
  const list = (data?.workers || []).filter((w) => !term || `${w.name} ${w.skill} ${w.area}`.toLowerCase().includes(term));
  const contact = (w, how) => {
    if (!user) return navigate('/login', { state: { from: location.pathname + location.search } });
    api(`/workers/${w.id}/call`, { method: 'POST' }).catch(() => {}); // counted for the admin; the number is already shown
    window.location.href = how === 'call' ? `tel:+91${w.phone}` : `https://wa.me/91${w.phone}?text=${encodeURIComponent(`Hello ${w.name}, I found your number on All Services. I need a ${w.skill}.`)}`;
  };

  return (
    <div className="workers-page">
      <Link to="/" className="back-link">← All categories</Link>
      <section className="workers-hero">
        <h1>👷 Daily Workers</h1>
        <p>Masons, helpers, painters and more near you. Call them directly — it’s free.</p>
      </section>
      <div className="partner-note" role="note">
        <b>👷 Local workers’ contacts</b>
        <p>We only share the contact details of local workers. Call them directly and fix the work and wages with them.</p>
        <p className="partner-note-legal">All Services does not employ these workers and is not responsible for their work, wages, safety or behaviour. Please check their ID before work starts.</p>
      </div>

      <div className="shop-tabs workers-tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setParams({ tab: k }, { replace: true })}>{l}</button>
        ))}
      </div>
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search by work or area (e.g. mason, Ponnala)" />
      {!user && (
        <div className="workers-login">
          🔒 <span><Link to="/login" state={{ from: location.pathname + location.search }}>Log in free with your mobile number</Link> to see phone numbers.</span>
        </div>
      )}
      {msg && <div className="ok-msg">{msg}</div>}

      {!data ? <Skeleton variant="list" /> : list.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">👷</div><h3>No workers listed here yet</h3><p className="muted">Please check another tab, or come back soon.</p></div>
      ) : (
        <div className="worker-list">
          {list.map((w) => (
            <article key={w.id} className={`worker-card ${w.is_available ? '' : 'busy'}`}>
              <div className="worker-avatar">{w.name[0]}</div>
              <div className="worker-info">
                <b>{w.name}</b>
                <span className="worker-skill">{w.skill}</span>
                <small className="muted">📍 {w.area}{w.experience_years != null ? ` · ${w.experience_years} yrs experience` : ''}</small>
                <div className="worker-tags">
                  {w.id_checked && <span className="worker-tag ok">✔ ID checked</span>}
                  {!w.is_available && <span className="worker-tag">⏸ Not available now</span>}
                </div>
                {w.phone && <small className="worker-phone">📱 +91 {w.phone}</small>}
              </div>
              <div className="worker-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => contact(w, 'call')}>📞 Call</button>
                <button type="button" className="btn btn-ghost btn-sm wa" onClick={() => contact(w, 'wa')}>💬 WhatsApp</button>
                {user && <button type="button" className="link-btn small" onClick={() => { setMsg(''); setReporting(w); }}>Report a problem</button>}
              </div>
            </article>
          ))}
        </div>
      )}
      {reporting && <ReportBox worker={reporting} onClose={() => setReporting(null)} onDone={() => { setReporting(null); setMsg('Thank you — the admin will check it.'); }} />}
    </div>
  );
}

function ReportBox({ worker, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const send = async (e) => {
    e.preventDefault();
    try {
      await api(`/workers/${worker.id}/report`, { method: 'POST', body: { reason, note } });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal panel form" onClick={(e) => e.stopPropagation()} onSubmit={send}>
        <h3>Report a problem — {worker.name}</h3>
        {REASONS.map(([k, l]) => (
          <label key={k} className="check-line"><input type="radio" name="reason" checked={reason === k} onChange={() => setReason(k)} /> <span>{l}</span></label>
        ))}
        <label>More details (optional)<textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {error && <div className="alert">{error}</div>}
        <div className="form-row">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!reason}>Send</button>
        </div>
      </form>
    </div>
  );
}
