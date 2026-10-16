import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useScope } from '../scope.js';
import { timeAgo, useLoad, useToast } from './ui.jsx';

// Send a phone notification (web push) to customers and/or agents — a franchise to its own city, HQ to one city or all.
const AUDIENCE = { customers: '👥 Customers', agents: '🛵 Agents', everyone: '📣 Everyone' };

export default function Notifications() {
  const toast = useToast();
  const { user } = useAuth();
  const scope = useScope();
  const history = useLoad(() => api('/franchise/broadcasts'));
  const [form, setForm] = useState({ audience: 'customers', title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const where = user.role === 'superadmin' ? (scope ? 'the franchise chosen at the top' : 'ALL franchises') : 'your city';

  const send = async (e) => {
    e.preventDefault();
    if (!confirm(`Send "${form.title}" to ${AUDIENCE[form.audience].slice(3).toLowerCase()} in ${where}?`)) return;
    setBusy(true);
    try {
      const r = await api('/franchise/broadcasts', { method: 'POST', body: form });
      toast(`Sent to ${r.sent_count} phone${r.sent_count === 1 ? '' : 's'} (${r.people} people; others haven't turned on notifications)`);
      setForm({ ...form, title: '', body: '' });
      history.reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <section className="panel">
        <h3>📣 Send a notification</h3>
        <p className="muted small">Goes to the phones of people who turned on notifications in the app — {where}. Use it for offers, timings, holidays or agent announcements.</p>
        <form className="stack" onSubmit={send}>
          <div className="tabs" role="radiogroup">
            {Object.entries(AUDIENCE).map(([k, l]) => (
              <button type="button" key={k} role="radio" aria-checked={form.audience === k} className={form.audience === k ? 'active' : ''} onClick={() => setForm({ ...form, audience: k })}>{l}</button>
            ))}
          </div>
          <label>Title<input value={form.title} maxLength={80} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. 🎉 Free delivery this Sunday" required /></label>
          <label>Message<textarea rows={3} maxLength={300} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="e.g. Order vegetables before 10 AM — no delivery charge!" required /></label>
          <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send now'}</button></div>
        </form>
      </section>
      <section className="panel table-panel">
        <div className="panel-pad"><h3>Sent</h3></div>
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Message</th><th>To</th>{user.role === 'superadmin' && <th>Franchise</th>}<th>Phones</th><th>When</th></tr></thead>
            <tbody>
              {(history.data || []).map((b) => (
                <tr key={b.id}>
                  <td><b>{b.title}</b><div className="muted small">{b.body}</div></td>
                  <td>{AUDIENCE[b.audience]}</td>
                  {user.role === 'superadmin' && <td className="small">{b.city || 'All'}</td>}
                  <td>{b.sent_count}</td>
                  <td className="muted small nowrap">{timeAgo(b.created_at)} · {b.sent_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.data && !history.data.length && <p className="muted panel-pad">Nothing sent yet.</p>}
        </div>
      </section>
    </div>
  );
}
