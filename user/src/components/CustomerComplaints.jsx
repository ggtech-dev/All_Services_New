import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Customers: report a problem (about an order or in general) and see the replies.
const SUBJECTS = ['Late delivery', 'Wrong or missing items', 'Poor quality', 'Agent behaviour', 'Payment / charges', 'App problem', 'Other'];
const STATUS = { open: 'Sent', in_progress: 'Being handled', resolved: 'Resolved', closed: 'Closed' };

export function ReportProblem({ orderId, onClose, onSent }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/me/complaints', { method: 'POST', body: { order_id: orderId, subject, message } });
      onSent?.();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="qr-scanner" role="dialog" aria-modal="true" aria-label="Report a problem" onClick={onClose}>
      <form className="company-qr-sheet complaint-sheet" onClick={(e) => e.stopPropagation()} onSubmit={send}>
        <h3>🙋 Report a problem</h3>
        <p className="muted small">{orderId ? `About order #${orderId}. ` : ''}We'll look into it and reply here.</p>
        <div className="rate-tags">
          {SUBJECTS.map((s) => (
            <button type="button" key={s} className={`tag-pill ${subject === s ? 'active' : ''}`} aria-pressed={subject === s} onClick={() => setSubject(s)}>{s}</button>
          ))}
        </div>
        <textarea rows={4} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell us what happened…" required />
        {error && <div className="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || !subject}>{busy ? 'Sending…' : 'Send'}</button>
        <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>Cancel</button>
      </form>
    </div>
  );
}

// "My complaints" in the account page.
export function MyComplaints() {
  const [list, setList] = useState(null);
  const [asking, setAsking] = useState(false);
  const load = () => api('/me/complaints').then(setList).catch(() => setList([]));
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="panel my-complaints">
      <div className="panel-head">
        <h3>🙋 Help & complaints</h3>
        <button className="btn btn-ghost btn-sm" onClick={() => setAsking(true)}>Report a problem</button>
      </div>
      {list && !list.length && <p className="muted small">No complaints. If something goes wrong with an order, open the order and tap “Report a problem”.</p>}
      <ul className="complaint-list">
        {(list || []).map((c) => (
          <li key={c.id}>
            <div className="complaint-top">
              <b>{c.subject}</b>{c.order_id && <span className="muted small"> · order #{c.order_id}</span>}
              <span className={`complaint-status st-${c.status}`}>{STATUS[c.status]}</span>
            </div>
            <p className="small muted">{c.message}</p>
            {c.reply && <p className="complaint-reply">💬 {c.reply}</p>}
          </li>
        ))}
      </ul>
      {asking && <ReportProblem onClose={() => setAsking(false)} onSent={() => { setAsking(false); load(); }} />}
    </section>
  );
}
