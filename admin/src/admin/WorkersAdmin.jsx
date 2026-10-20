import { useState } from 'react';
import { api } from '../api.js';
import { Modal, Switch, useLoad, useToast } from './ui.jsx';

// 👷 Daily Workers — the franchise admin adds local workers (with their permission, kept in the register), marks them
// available / not available and "ID checked", and looks at customers' reports. HQ sees every city (read only).
const TABS = { construction: '🧱 Construction', painters: '🎨 Painters', other: '🧹 Other work' };
const REASONS = { wrong_number: 'Wrong number', not_answering: 'Not answering', bad_experience: 'Bad experience', other: 'Other' };
const SKILLS = {
  construction: ['Mason', 'Helper', 'Centring worker', 'Bar bender', 'Tiles worker', 'Carpenter (construction)'],
  painters: ['Painter', 'Painter helper', 'Putty & polish'],
  other: ['Loading / unloading', 'House cleaning', 'Farm work', 'Gardener', 'Cook / helper', 'Driver (daily)'],
};
const blank = { tab: 'construction', name: '', phone: '', skill: '', area: '', experience_years: '', is_available: true, id_checked: false, consent_recorded: false, is_active: true };

export default function WorkersAdmin() {
  const toast = useToast();
  const data = useLoad(() => api('/workers/admin'));
  const [tab, setTab] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [view, setView] = useState('workers');
  const d = data.data;
  if (!d) return data.error ? <div className="alert">{data.error}</div> : <div className="center-block"><div className="spinner" /></div>;
  const canEdit = d.can_edit;
  const term = q.trim().toLowerCase();
  const list = d.workers.filter((w) => (!tab || w.tab === tab) && (!term || `${w.name} ${w.phone} ${w.skill} ${w.area}`.toLowerCase().includes(term)));
  const openReports = d.reports.filter((r) => r.status === 'open');

  const quick = async (w, change, msg) => {
    try {
      await api(`/workers/admin/${w.id}`, { method: 'PUT', body: { ...w, ...change, consent_recorded: true } });
      toast(msg);
      data.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const closeReport = async (r) => {
    try {
      await api(`/workers/admin/reports/${r.id}/close`, { method: 'POST' });
      data.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="stack">
      <section className="panel how-it-works">
        <b>👷 Daily Workers — a free list for customers</b>
        <p className="small muted">Add local workers <b>only after they agree</b> to show their number (keep it in your register). Customers see the list free; the phone
          number after a free login, then they call directly and fix the work and wages themselves. Mark <b>ID checked</b> only after you saw their Aadhaar.</p>
        {!canEdit && <p className="small">👀 HQ view — workers are added by each city’s franchise admin.</p>}
      </section>
      <div className="tabs scroll-tabs" role="tablist">
        <button role="tab" aria-selected={view === 'workers'} className={view === 'workers' ? 'active' : ''} onClick={() => setView('workers')}>👷 Workers <span className="count">{d.workers.filter((w) => w.is_active).length}</span></button>
        <button role="tab" aria-selected={view === 'reports'} className={view === 'reports' ? 'active' : ''} onClick={() => setView('reports')}>
          🚩 Reports {openReports.length > 0 && <span className="count alert-count">{openReports.length}</span>}
        </button>
      </div>

      {view === 'workers' ? (
        <>
          <div className="toolbar">
            <select value={tab} onChange={(e) => setTab(e.target.value)} aria-label="Tab">
              <option value="">All tabs</option>
              {Object.entries(TABS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input className="toolbar-search" placeholder="🔍 Name, phone, work or area…" value={q} onChange={(e) => setQ(e.target.value)} />
            {canEdit && <button className="btn btn-primary" onClick={() => setEditing(blank)}>➕ Add worker</button>}
          </div>
          <section className="panel table-panel">
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>Worker</th><th>Work</th><th>Area</th><th>Calls</th><th>Available</th><th>ID</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {list.map((w) => (
                    <tr key={w.id} className={w.is_active ? '' : 'row-muted'}>
                      <td><b>{w.name}</b><div className="small muted">+91 {w.phone}{w.city ? ` · ${w.city}` : ''}{!w.is_active ? ' · switched off' : ''}</div></td>
                      <td>{w.skill}<div className="small muted">{TABS[w.tab]}{w.experience_years != null ? ` · ${w.experience_years} yrs` : ''}</div></td>
                      <td className="small">{w.area}</td>
                      <td>{w.call_count}{w.open_reports > 0 && <div className="small danger-text">🚩 {w.open_reports}</div>}</td>
                      <td>{canEdit ? <Switch checked={w.is_available} onChange={() => quick(w, { is_available: !w.is_available }, `${w.name}: ${w.is_available ? 'not available' : 'available'}`)} label="" /> : (w.is_available ? 'Yes' : 'No')}</td>
                      <td>{w.id_checked ? '✔' : '—'}</td>
                      <td className="row-actions">{canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...w, experience_years: w.experience_years ?? '' })}>Edit</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!list.length && <p className="muted center-block">No workers yet. {canEdit && 'Tap “Add worker”.'}</p>}
            </div>
          </section>
        </>
      ) : (
        <section className="panel table-panel">
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>When</th><th>Worker</th><th>Problem</th><th>Customer</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {d.reports.map((r) => (
                  <tr key={r.id} className={r.status === 'open' ? '' : 'row-muted'}>
                    <td className="small">{new Date(r.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                    <td><b>{r.worker_name}</b><div className="small muted">+91 {r.worker_phone}</div></td>
                    <td>{REASONS[r.reason]}{r.note && <div className="small muted">{r.note}</div>}</td>
                    <td className="small">{r.customer_name || '—'}{r.customer_phone && <div className="muted">+91 {r.customer_phone}</div>}</td>
                    <td>{r.status === 'open' ? (canEdit && <button className="btn btn-ghost btn-sm" onClick={() => closeReport(r)}>✔ Checked</button>) : 'Closed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!d.reports.length && <p className="muted center-block">No reports. 👍</p>}
          </div>
        </section>
      )}
      {editing && <WorkerForm worker={editing} onClose={() => setEditing(null)} onSaved={(w, isNew) => { setEditing(null); data.reload(); toast(isNew ? `Added ${w.name}` : `Saved ${w.name}`); }} />}
    </div>
  );
}

function WorkerForm({ worker, onClose, onSaved }) {
  const isNew = !worker.id;
  const [f, setF] = useState({ ...worker, consent_recorded: isNew ? false : true });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const w = await api(isNew ? '/workers/admin' : `/workers/admin/${worker.id}`, { method: isNew ? 'POST' : 'PUT', body: f });
      onSaved(w, isNew);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={isNew ? 'Add worker' : `Edit ${worker.name}`} onClose={onClose} wide
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="worker-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="worker-form" className="stack-sm" onSubmit={save}>
        <div className="form-row">
          <label>Tab *
            <select value={f.tab} onChange={(e) => setF({ ...f, tab: e.target.value, skill: '' })}>
              {Object.entries(TABS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label>Work they do *
            <input value={f.skill} onChange={set('skill')} list="worker-skills" required maxLength={60} placeholder="e.g. Mason" />
            <datalist id="worker-skills">{SKILLS[f.tab].map((s) => <option key={s} value={s} />)}</datalist>
          </label>
        </div>
        <div className="form-row">
          <label>Name *<input value={f.name} onChange={set('name')} required maxLength={60} autoFocus={isNew} /></label>
          <label>Mobile number *<input value={f.phone} onChange={set('phone')} required inputMode="tel" placeholder="10-digit mobile" /></label>
        </div>
        <div className="form-row">
          <label>Area / village *<input value={f.area} onChange={set('area')} required maxLength={80} placeholder="e.g. Bharath Nagar" /></label>
          <label>Experience (years)<input type="number" min="0" max="60" value={f.experience_years} onChange={set('experience_years')} /></label>
        </div>
        <Switch checked={f.is_available} onChange={(v) => setF({ ...f, is_available: v })} label="Available for work now" />
        <Switch checked={f.id_checked} onChange={(v) => setF({ ...f, id_checked: v })} label="✔ ID checked (I saw their Aadhaar)" />
        {!isNew && <Switch checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Show in the app (off = removed from the list)" />}
        <label className="check-line consent-line">
          <input type="checkbox" checked={f.consent_recorded} onChange={(e) => setF({ ...f, consent_recorded: e.target.checked })} />
          <span>☑ <b>Worker’s permission recorded</b> — they agreed to show their name and number in the app (written in my register).</span>
        </label>
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}
