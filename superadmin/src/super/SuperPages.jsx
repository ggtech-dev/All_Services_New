import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { rupees } from '../orderStatus.jsx';
import { setScope } from '../scope.js';
import { timeAgo, useLoad, useToast } from '../admin/ui.jsx';
import { AdminForm, FrBadge } from './Franchises.jsx';

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

// ---------- platform reports ----------
const ist = (d) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
export function PlatformReports() {
  const franchises = useFranchises();
  const now = new Date();
  const [range, setRange] = useState({ from: ist(new Date(now.getFullYear(), now.getMonth(), 1, 12)), to: ist(now), franchise: '' });
  const rep = useLoad(() => api(`/super/reports?${new URLSearchParams({ from: range.from, to: range.to, ...(range.franchise && { franchise: range.franchise }) })}`), [range.from, range.to, range.franchise]);
  const d = rep.data;
  const preset = (days) => setRange({ ...range, from: ist(new Date(Date.now() - (days - 1) * 86400e3)), to: ist(new Date()) });

  const csv = () => {
    const cols = ['code', 'name', 'city', 'status', 'users', 'agents', 'orders', 'bookings', 'completed', 'cancelled', 'pending', 'revenue', 'delivery_charges'];
    const money = ['commission', 'paid', 'pending', 'expenses'];
    const head = [...cols, ...money.map((m) => `money_${m}`)];
    const rows = d.franchises.map((f) => [...cols.map((c) => f[c]), ...money.map((m) => f.money[m])]);
    const text = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }));
    a.download = `franchises_${range.from}_to_${range.to}.csv`;
    a.click();
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <FranchiseSelect value={range.franchise} onChange={(v) => setRange({ ...range, franchise: v })} list={franchises.data} />
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span className="muted">to</span>
        <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <div className="tabs">
          <button onClick={() => preset(1)}>Today</button>
          <button onClick={() => preset(7)}>7 days</button>
          <button onClick={() => preset(30)}>30 days</button>
        </div>
        {d && <button className="btn btn-ghost btn-sm" onClick={csv}>⬇️ CSV</button>}
      </div>
      {rep.error && <div className="alert">{rep.error}</div>}
      {!d && rep.loading && <div className="center-block"><div className="spinner" /></div>}
      {d && (
        <>
          <div className="kpi-grid">
            <div className="kpi"><span className="kpi-label">📦 Orders</span><span className="kpi-value">{d.totals.orders}</span></div>
            <div className="kpi"><span className="kpi-label">🗓️ Bookings</span><span className="kpi-value">{d.totals.bookings}</span></div>
            <div className="kpi"><span className="kpi-label">✅ Completed</span><span className="kpi-value">{d.totals.completed}</span></div>
            <div className="kpi"><span className="kpi-label">❌ Cancelled</span><span className="kpi-value">{d.totals.cancelled}</span></div>
            <div className="kpi"><span className="kpi-label">⏳ Pending</span><span className="kpi-value">{d.totals.pending}</span></div>
            <div className="kpi"><span className="kpi-label">💰 Revenue</span><span className="kpi-value">{rupees(d.totals.revenue)}</span></div>
            <div className="kpi"><span className="kpi-label">🚚 Delivery charges</span><span className="kpi-value">{rupees(d.totals.delivery_charges)}</span></div>
            <div className="kpi"><span className="kpi-label">👥 Customers</span><span className="kpi-value">{d.totals.users}</span></div>
          </div>
          <section className="panel table-panel">
            <div className="panel-pad"><h3>Dealer report</h3><p className="muted small">Orders and revenue are for the dates chosen; commission and payments are the running totals.</p></div>
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>Dealer</th><th>Status</th><th>Users</th><th>Agents</th><th>Orders</th><th>Bookings</th><th>Revenue</th><th>Commission</th><th>Expenses</th><th>Pending payment</th><th>Completed</th><th>Cancelled</th><th aria-label="Open" /></tr></thead>
                <tbody>
                  {d.franchises.map((f) => (
                    <tr key={f.id}>
                      <td><b>{f.code}</b> · {f.city}<div className="muted small">{f.name}</div></td>
                      <td><FrBadge status={f.status} /></td>
                      <td>{f.users}</td>
                      <td>{f.agents}</td>
                      <td>{f.orders}</td>
                      <td>{f.bookings}</td>
                      <td className="nowrap">{rupees(f.revenue)}</td>
                      <td className="nowrap">{rupees(f.money.commission)}</td>
                      <td className="nowrap">{rupees(f.money.expenses)}</td>
                      <td className={`nowrap ${f.money.pending > 0 ? 'text-warn' : ''}`}>{rupees(f.money.pending)}</td>
                      <td>{f.completed}</td>
                      <td>{f.cancelled}</td>
                      <td><Link className="btn btn-ghost btn-sm" to={`/super/franchises/${f.id}?tab=reports`} onClick={() => setScope(f.id)}>Full report</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="report-grid">
            <section className="panel table-panel">
              <div className="panel-pad"><h3>Service report</h3></div>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>Service</th><th>City</th><th>Orders</th><th>Delivered</th></tr></thead>
                  <tbody>
                    {d.services.map((s, i) => (
                      <tr key={i}><td>{s.icon} {s.service}</td><td>{s.city}</td><td>{s.orders}</td><td>{s.delivered}</td></tr>
                    ))}
                  </tbody>
                </table>
                {!d.services.length && <p className="muted panel-pad">No orders in these dates.</p>}
              </div>
            </section>
            <section className="panel table-panel">
              <div className="panel-pad"><h3>Product report (top items)</h3></div>
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>Item</th><th>Qty</th><th>Orders</th></tr></thead>
                  <tbody>
                    {(d.report.top_items || []).map((x, i) => (
                      <tr key={i}><td>{x.name} <span className="muted small">{x.unit}</span></td><td>{Number(x.qty)}</td><td>{x.orders}</td></tr>
                    ))}
                  </tbody>
                </table>
                {!(d.report.top_items || []).length && <p className="muted panel-pad">No items in these dates.</p>}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
