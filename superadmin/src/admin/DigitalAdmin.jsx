import { useState } from 'react';
import { api } from '../api.js';
import { useLoad, useToast } from './ui.jsx';

// 💡 Digital Services requests — HQ only. Call the person, close the deal outside the app, keep the status and notes here.
const STATUS = [['new', '🆕 New'], ['called', '📞 Called'], ['quoted', '📄 Quotation sent'], ['won', '🏆 Won'], ['lost', 'Lost']];

export default function DigitalAdmin() {
  const data = useLoad(() => api('/digital/admin'));
  const [filter, setFilter] = useState('');
  const d = data.data;
  if (!d) return data.error ? <div className="alert">{data.error}</div> : <div className="center-block"><div className="spinner" /></div>;
  const list = d.requests.filter((r) => !filter || r.status === filter);
  return (
    <div className="stack">
      <div className="stat-row">
        <div className="panel stat"><b>{d.counts.new}</b><small>New — call them</small></div>
        <div className="panel stat"><b>{d.counts.open}</b><small>In talks</small></div>
        <div className="panel stat"><b>{d.counts.won_month}</b><small>Won this month</small></div>
        <div className="panel stat"><b>{d.counts.this_month}</b><small>Requests this month</small></div>
      </div>
      <div className="tabs scroll-tabs" role="tablist">
        <button role="tab" aria-selected={!filter} className={!filter ? 'active' : ''} onClick={() => setFilter('')}>All</button>
        {STATUS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
            {l} <span className="count">{d.requests.filter((r) => r.status === k).length}</span>
          </button>
        ))}
      </div>
      {list.map((r) => <Request key={r.id} r={r} reload={data.reload} />)}
      {!list.length && <p className="muted center-block">No requests here.</p>}
    </div>
  );
}

function Request({ r, reload }) {
  const toast = useToast();
  const [status, setStatus] = useState(r.status);
  const [notes, setNotes] = useState(r.notes || '');
  const [busy, setBusy] = useState(false);
  const changed = status !== r.status || notes !== (r.notes || '');
  const save = async () => {
    setBusy(true);
    try {
      await api(`/digital/admin/${r.id}`, { method: 'PUT', body: { status, notes } });
      toast('Saved');
      reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const wa = `https://wa.me/91${r.phone}?text=${encodeURIComponent(`Hello ${r.name}, this is about your request for "${r.service}" on All Services.`)}`;
  return (
    <section className={`panel digital-req status-${r.status}`}>
      <div className="digital-req-head">
        <div>
          <b>{r.tab === 'video' ? '🎬' : '💻'} {r.service}</b>
          <div className="small muted">#{r.id} · {new Date(r.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{r.city ? ` · ${r.city}` : ''}</div>
        </div>
        <div className="row-actions">
          <a className="btn btn-primary btn-sm" href={`tel:+91${r.phone}`}>📞 {r.name} · +91 {r.phone}</a>
          <a className="btn btn-ghost btn-sm" href={wa} target="_blank" rel="noreferrer">💬 WhatsApp</a>
        </div>
      </div>
      <p className="digital-details">{r.details}</p>
      <div className="small muted">⏱ {r.timing}{r.budget ? ` · 💰 ${r.budget}` : ''}{r.link && <> · 🔗 <a href={r.link} target="_blank" rel="noreferrer noopener">{r.link.slice(0, 60)}</a></>}</div>
      <div className="digital-update">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 1000))} placeholder="Notes (quotation amount, next call…)" />
        <button className="btn btn-primary btn-sm" disabled={busy || !changed} onClick={save}>Save</button>
      </div>
      {r.updated_by_name && <div className="small muted">Last updated by {r.updated_by_name}</div>}
    </section>
  );
}
