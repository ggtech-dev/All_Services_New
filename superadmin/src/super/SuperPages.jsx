import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { rupees } from '../orderStatus.jsx';
import { setScope } from '../scope.js';
import { timeAgo, useLoad, useToast } from '../admin/ui.jsx';
import { AdminForm } from './Franchises.jsx';

const useFranchises = () => useLoad(() => api('/super/franchise-options'));
const FranchiseSelect = ({ value, onChange, list, all = 'All franchises' }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Franchise">
    <option value="">{all}</option>
    {(list || []).map((f) => <option key={f.id} value={f.id}>{f.code} · {f.city}</option>)}
  </select>
);

// ---------- franchise admins ----------
export function Admins() {
  const toast = useToast();
  const franchises = useFranchises();
  const [fr, setFr] = useState('');
  const list = useLoad(() => api(`/super/admins${fr ? `?franchise=${fr}` : ''}`), [fr]);
  const [adding, setAdding] = useState(false);
  const patch = async (a, body, msg) => {
    try {
      await api(`/super/admins/${a.id}`, { method: 'PATCH', body });
      toast(msg);
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <div className="stack">
      <div className="toolbar">
        <FranchiseSelect value={fr} onChange={setFr} list={franchises.data} />
        <p className="muted toolbar-note">Each franchise admin runs one city in the Admin app. They cannot change the catalog or other cities.</p>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>➕ New admin</button>
      </div>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Admin</th><th>Franchise</th><th>Contact</th><th>Last login</th><th>Login</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {(list.data || []).map((a) => (
                <tr key={a.id} className={a.is_active ? '' : 'row-muted'}>
                  <td><b>{a.full_name}</b><div className="muted small">@{a.username}</div></td>
                  <td>{a.franchise_code ? <Link className="link" to={`/super/franchises/${a.franchise_id}`} onClick={() => setScope(a.franchise_id)}>{a.franchise_code} · {a.city}</Link> : <span className="danger-text">No franchise</span>}</td>
                  <td className="small">{a.phone || '—'}<div className="muted">{a.email || ''}</div></td>
                  <td className="muted small">{a.last_login ? timeAgo(a.last_login) : 'never'}</td>
                  <td>{a.is_active ? '✅' : '⛔'}</td>
                  <td className="nowrap">
                    <button className="btn btn-ghost btn-sm" onClick={() => { const p = prompt(`New password for ${a.username} (8+ characters):`); if (p) patch(a, { password: p }, 'Password changed'); }}>Reset password</button>{' '}
                    <button className="btn btn-ghost btn-sm" onClick={() => patch(a, { is_active: !a.is_active }, a.is_active ? 'Disabled' : 'Enabled')}>{a.is_active ? 'Disable' : 'Enable'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data && !list.data.length && <p className="muted panel-pad">No admins.</p>}
        </div>
      </section>
      {adding && <AdminForm franchises={franchises.data} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.reload(); }} />}
    </div>
  );
}

// ---------- customers ----------
export function Users() {
  const toast = useToast();
  const franchises = useFranchises();
  const [fr, setFr] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const list = useLoad(() => api(`/super/users?${new URLSearchParams({ ...(search && { q: search }), ...(fr && { franchise: fr }) })}`), [search, fr]);
  const toggle = async (u) => {
    if (!confirm(`${u.is_active ? 'Block' : 'Unblock'} ${u.full_name || u.username}?`)) return;
    try {
      await api(`/super/users/${u.id}/active`, { method: 'PATCH', body: { is_active: !u.is_active } });
      toast(u.is_active ? 'Blocked — they cannot log in' : 'Unblocked');
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <div className="stack">
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
        <input className="toolbar-search" type="search" placeholder="Search name, username, phone, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <FranchiseSelect value={fr} onChange={setFr} list={franchises.data} all="All cities" />
        <button className="btn btn-ghost">Search</button>
      </form>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Customer</th><th>Contact</th><th>City (last order)</th><th>Orders</th><th>Spent</th><th>Joined</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {(list.data || []).map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'row-muted'}>
                  <td><b>{u.full_name || u.username}</b><div className="muted small">@{u.username}</div></td>
                  <td className="small">{u.phone || '—'}<div className="muted">{u.email || ''}</div></td>
                  <td>{u.city || <span className="muted">—</span>}</td>
                  <td>{u.orders}</td>
                  <td className="nowrap">{rupees(u.spent)}</td>
                  <td className="muted small">{timeAgo(u.created_at)}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => toggle(u)}>{u.is_active ? 'Block' : 'Unblock'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data && !list.data.length && <p className="muted panel-pad">No customers found.</p>}
          {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}
        </div>
      </section>
    </div>
  );
}

// ---------- payments & commission (all franchises) ----------
export function Payments() {
  const franchises = useFranchises();
  const [fr, setFr] = useState('');
  const list = useLoad(() => api(`/super/ledger${fr ? `?franchise=${fr}` : ''}`), [fr]);
  const t = list.data?.totals;
  return (
    <div className="stack">
      <div className="toolbar">
        <FranchiseSelect value={fr} onChange={setFr} list={franchises.data} />
        <p className="muted toolbar-note">Commission and payments are entered by hand on each franchise's page (Payments tab).</p>
      </div>
      {t && (
        <div className="kpi-grid compact">
          <div className="kpi"><span className="kpi-label">🧾 Commission</span><span className="kpi-value">{rupees(t.commission)}</span></div>
          <div className="kpi"><span className="kpi-label">✅ Received</span><span className="kpi-value">{rupees(t.paid)}</span></div>
          <div className="kpi"><span className="kpi-label">⏳ Pending</span><span className={`kpi-value ${t.pending > 0 ? 'text-warn' : ''}`}>{rupees(t.pending)}</span></div>
          <div className="kpi"><span className="kpi-label">📉 Expenses noted</span><span className="kpi-value">{rupees(t.expenses)}</span></div>
        </div>
      )}
      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Date</th><th>Franchise</th><th>Type</th><th>Amount</th><th>Reference / note</th><th>By</th></tr></thead>
            <tbody>
              {(list.data?.entries || []).map((l) => (
                <tr key={l.id}>
                  <td className="small nowrap">{new Date(l.entry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td><Link className="link" to={`/super/franchises/${l.franchise_id}?tab=payments`} onClick={() => setScope(l.franchise_id)}>{l.franchise_code}</Link> <span className="muted small">{l.franchise_name}</span></td>
                  <td className="cap">{l.type}</td>
                  <td className="nowrap"><b>{rupees(l.amount)}</b></td>
                  <td className="small">{l.reference && <b>{l.reference} </b>}{l.note}</td>
                  <td className="muted small">{l.created_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data && !list.data.entries.length && <p className="muted panel-pad">No entries yet.</p>}
        </div>
      </section>
    </div>
  );
}
