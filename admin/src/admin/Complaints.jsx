import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Modal, timeAgo, useLoad, useToast } from './ui.jsx';

// Customer complaints. A franchise sees its own; the Super Admin sees all (or the franchise chosen at the top).
const STATUS = {
  open: ['Open', '#dc2626'],
  in_progress: ['Working on it', '#f59e0b'],
  resolved: ['Resolved', '#16a34a'],
  closed: ['Closed', '#64748b'],
};
const TABS = [['', 'All'], ['open', 'Open'], ['in_progress', 'Working on it'], ['resolved', 'Resolved'], ['closed', 'Closed']];

export default function Complaints() {
  const { user } = useAuth();
  const base = user.role === 'superadmin' ? '/super' : '/admin';
  const [tab, setTab] = useState('');
  const list = useLoad(() => api(`/franchise/complaints${tab ? `?status=${tab}` : ''}`), [tab]);
  const [open, setOpen] = useState(null);
  const rows = list.data || [];

  return (
    <div className="stack">
      <p className="muted toolbar-note">
        Problems customers report from their order page or account. Call them, reply here (they see your reply in the app) and mark it resolved.
      </p>
      <div className="tabs scroll-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Complaint</th><th>Customer</th>{user.role === 'superadmin' && <th>Franchise</th>}<th>Order</th><th>Status</th><th>When</th><th aria-label="Open" /></tr></thead>
            <tbody>
              {rows.map((c) => {
                const [label, color] = STATUS[c.status] || [c.status, '#64748b'];
                return (
                  <tr key={c.id} className={c.status === 'open' ? 'row-bad' : ''}>
                    <td><b>{c.subject}</b><div className="muted small clamp-2">{c.message}</div></td>
                    <td>{c.customer_name}<div className="small"><a className="link" href={`tel:${c.customer_phone}`}>📞 {c.customer_phone}</a></div></td>
                    {user.role === 'superadmin' && <td className="small">{c.city || '—'}</td>}
                    <td>{c.order_id ? <Link className="link" to={`${base}/orders?open=${c.order_id}`}>#{c.order_id}</Link> : <span className="muted">General</span>}
                      {c.agent_name && <div className="muted small">Agent: {c.agent_name}</div>}</td>
                    <td><span className="status-badge" style={{ '--c': color }}>{label}</span></td>
                    <td className="muted small nowrap">{timeAgo(c.created_at)}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => setOpen(c)}>{c.status === 'open' || c.status === 'in_progress' ? 'Reply' : 'View'}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.data && !rows.length && <p className="muted panel-pad">No complaints{tab ? ' here' : ' yet'}. 🎉</p>}
          {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}
          {list.error && <div className="alert">{list.error}</div>}
        </div>
      </section>
      {open && <ComplaintReply complaint={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); list.reload(); }} />}
    </div>
  );
}

function ComplaintReply({ complaint, onClose, onSaved }) {
  const toast = useToast();
  const [status, setStatus] = useState(complaint.status === 'open' ? 'resolved' : complaint.status);
  const [reply, setReply] = useState(complaint.reply || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/franchise/complaints/${complaint.id}`, { method: 'PATCH', body: { status, reply } });
      toast('Saved — the customer can see it');
      onSaved();
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title={complaint.subject} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="stack">
        <p className="complaint-msg">“{complaint.message}”</p>
        <p className="muted small">{complaint.customer_name} · {complaint.customer_phone}{complaint.order_id ? ` · order #${complaint.order_id}` : ''}</p>
        <label>Reply to the customer
          <textarea rows={4} maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="e.g. Sorry! We have spoken to the agent and refunded the delivery charge." />
        </label>
        <label>Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
    </Modal>
  );
}
