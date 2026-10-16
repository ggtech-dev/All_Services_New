import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, apiFile } from '../api.js';
import { rupees } from '../orderStatus.jsx';
import { getScope, setScope } from '../scope.js';
import { timeAgo, useLoad, useToast } from '../admin/ui.jsx';
import { AdminForm, FrBadge, StatusMenu } from './Franchises.jsx';
import { FranchiseServices } from '../admin/MyServices.jsx';

// One dealer, seen by HQ: everything about it in tabs. Opening it also chooses it at the top of the app, so the
// operations tabs below (orders, agents, reports…) are that franchise's own.
const Orders = lazy(() => import('../admin/Orders.jsx'));
const Agents = lazy(() => import('../admin/Agents.jsx'));
const Ratings = lazy(() => import('../admin/Ratings.jsx'));
const Activity = lazy(() => import('../admin/Activity.jsx'));
const Reports = lazy(() => import('../admin/Reports.jsx'));
const Areas = lazy(() => import('../admin/Areas.jsx'));
const Complaints = lazy(() => import('../admin/Complaints.jsx'));

const TABS = [
  ['overview', '📊 Overview'], ['users', '👥 Users'], ['agents', '🛵 Agents'], ['admins', '🛡️ Admins'],
  ['services', '🧰 Services & products'], ['orders', '📦 Orders & bookings'], ['payments', '💰 Payments & commission'],
  ['reports', '📈 Reports'], ['complaints', '🙋 Complaints'], ['reviews', '⭐ Reviews'], ['areas', '🗺️ Areas'],
  ['documents', '📄 Documents'], ['activity', '🕘 Activity'],
];

export default function FranchiseDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'overview';
  const toast = useToast();
  const data = useLoad(() => api(`/super/franchises/${id}`), [id]);
  // work "inside" this franchise
  useEffect(() => {
    if (getScope() !== String(id)) setScope(id);
  }, [id]);

  if (data.error) return <div className="alert">{data.error} — <Link to="/super/franchises">All franchises</Link></div>;
  if (!data.data) return <div className="center-block"><div className="spinner" /></div>;
  const { franchise: f, stats: s } = data.data;

  return (
    <div className="stack">
      <Link to="/super/franchises" className="back-link">← All franchises</Link>
      <section className="panel franchise-hero">
        <div>
          <small className="muted">{f.code} · registered {new Date(f.registered_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</small>
          <h1>{f.name}</h1>
          <p className="muted">📍 {f.city}, {f.state} {f.pincode || ''} · 👤 {f.owner_name || 'owner not set'}{f.phone && <> · <a className="link" href={`tel:${f.phone}`}>📞 {f.phone}</a></>}{f.email && ` · ✉️ ${f.email}`}</p>
          {f.status_reason && <p className="small text-warn">{f.status_reason}</p>}
        </div>
        <div className="franchise-hero-actions">
          <FrBadge status={f.status} />
          <StatusMenu f={f} toast={toast} done={data.reload} />
          <Link className="btn btn-ghost btn-sm" to={`/super/franchises/${f.id}/edit`}>Edit details</Link>
        </div>
      </section>

      <div className="tabs scroll-tabs franchise-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setParams({ tab: k }, { replace: true })}>{label}</button>
        ))}
      </div>

      <Suspense fallback={<div className="center-block"><div className="spinner" /></div>}>
        {tab === 'overview' && <Overview f={f} s={s} areas={data.data.areas} go={(t) => setParams({ tab: t })} />}
        {tab === 'users' && <FranchiseUsers id={f.id} />}
        {tab === 'agents' && <Agents />}
        {tab === 'admins' && <FranchiseAdmins f={f} admins={data.data.admins} reload={data.reload} />}
        {tab === 'services' && <FranchiseServices franchiseId={f.id} />}
        {tab === 'orders' && <Orders />}
        {tab === 'payments' && <Ledger f={f} entries={data.data.ledger} money={s.money} reload={data.reload} />}
        {tab === 'reports' && <Reports />}
        {tab === 'complaints' && <Complaints />}
        {tab === 'reviews' && <Ratings />}
        {tab === 'areas' && <Areas />}
        {tab === 'documents' && <Documents f={f} docs={data.data.documents} reload={data.reload} />}
        {tab === 'activity' && <Activity />}
      </Suspense>
    </div>
  );
}

function Overview({ f, s, areas, go }) {
  const k = (label, value, tab, cls = '') => (
    <button key={label} type="button" className={`kpi kpi-link ${cls}`} onClick={() => tab && go(tab)}>
      <span className="kpi-label">{label}</span><span className="kpi-value">{value}</span>
    </button>
  );
  return (
    <div className="stack">
      {f.status === 'pending' && (
        <div className="franchise-status-bar">
          ⏳ This franchise is not live yet. Checklist: {areas.length ? '✅' : '⬜'} <button className="link-btn" onClick={() => go('areas')}>service areas</button> ·
          {' '}{s.admins ? '✅' : '⬜'} <button className="link-btn" onClick={() => go('admins')}>an admin login</button> ·
          {' '}{s.services ? '✅' : '⬜'} <button className="link-btn" onClick={() => go('services')}>services</button> → then choose <b>Activate</b> above.
        </div>
      )}
      <div className="kpi-grid">
        {k('👥 Users', s.users, 'users')}
        {k('🛵 Agents', s.agents, 'agents')}
        {k('🛡️ Admins', s.admins, 'admins')}
        {k('🗺️ Areas', s.areas, 'areas')}
        {k('🧰 Services', s.services, 'services')}
        {k('🛍️ Products', s.products, 'services')}
        {k('📦 Orders', s.orders, 'orders')}
        {k('🗓️ Bookings', s.bookings, 'orders')}
        {k('⏳ Pending orders', s.pending, 'orders', s.pending ? 'kpi-alert' : '')}
        {k('✅ Completed', s.completed, 'orders')}
        {k('❌ Cancelled', s.cancelled, 'orders')}
        {k('🙋 Open complaints', s.complaints_open, 'complaints', s.complaints_open ? 'kpi-alert' : '')}
      </div>
      <div className="kpi-grid">
        {k('💵 Revenue today', rupees(s.revenue_today), 'reports')}
        {k('📅 This month', rupees(s.revenue_month), 'reports')}
        {k('💰 Total revenue', rupees(s.revenue), 'reports')}
        {k('🚚 Delivery charges', rupees(s.delivery_charges), 'reports')}
        {k('🧾 Commission', rupees(s.money.commission), 'payments')}
        {k('✅ Paid to HQ', rupees(s.money.paid), 'payments')}
        {k('⏳ Pending payment', rupees(s.money.pending), 'payments', s.money.pending > 0 ? 'kpi-alert' : '')}
        {k('⭐ Rating', s.rating ? `★ ${s.rating}` : '—', 'reviews')}
      </div>
      <section className="panel">
        <h3>Details</h3>
        <dl className="kv">
          <dt>Dealer ID</dt><dd>{f.code}</dd>
          <dt>Address</dt><dd>{f.address || '—'}</dd>
          <dt>GST</dt><dd>{f.gst_number || '—'}</dd>
          <dt>Notes</dt><dd>{f.notes || '—'}</dd>
          <dt>Areas</dt><dd>{areas.map((a) => a.name).join(', ') || '—'}</dd>
        </dl>
      </section>
    </div>
  );
}

function FranchiseUsers({ id }) {
  const list = useLoad(() => api(`/super/franchises/${id}/users`), [id]);
  return (
    <section className="panel table-panel">
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Customer</th><th>Phone / email</th><th>Orders</th><th>Delivered</th><th>Spent</th><th>Last order</th></tr></thead>
          <tbody>
            {(list.data || []).map((u) => (
              <tr key={u.id} className={u.is_active ? '' : 'row-muted'}>
                <td><b>{u.full_name || u.username}</b><div className="muted small">@{u.username}</div></td>
                <td className="small">{u.phone || '—'}<div className="muted">{u.email || ''}</div></td>
                <td><Link className="link" to={`/super/orders?customer=${u.id}`}>{u.orders}</Link></td>
                <td>{u.delivered}</td>
                <td className="nowrap">{rupees(u.spent)}</td>
                <td className="muted small">{u.last_order ? timeAgo(u.last_order) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data && !list.data.length && <p className="muted panel-pad">No customers have ordered here yet.</p>}
      </div>
    </section>
  );
}

function FranchiseAdmins({ f, admins, reload }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const patch = async (a, body, msg) => {
    try {
      await api(`/super/admins/${a.id}`, { method: 'PATCH', body });
      toast(msg);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const reset = (a) => {
    const p = prompt(`New password for ${a.username} (at least 8 characters):`);
    if (p) patch(a, { password: p }, 'Password changed — tell the admin');
  };
  return (
    <section className="panel table-panel">
      <div className="panel-pad panel-head"><h3>Admins of {f.city}</h3><button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>➕ Add admin</button></div>
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Admin</th><th>Contact</th><th>Since</th><th>Login</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id} className={a.is_active ? '' : 'row-muted'}>
                <td><b>{a.full_name}</b><div className="muted small">@{a.username}</div></td>
                <td className="small">{a.phone || '—'}<div className="muted">{a.email || ''}</div></td>
                <td className="small muted">{timeAgo(a.created_at)}</td>
                <td>{a.is_active ? <span className="status-badge" style={{ '--c': '#16a34a' }}>On</span> : <span className="status-badge" style={{ '--c': '#64748b' }}>Off</span>}</td>
                <td className="nowrap">
                  <button className="btn btn-ghost btn-sm" onClick={() => reset(a)}>Reset password</button>{' '}
                  <button className="btn btn-ghost btn-sm" onClick={() => patch(a, { is_active: !a.is_active }, a.is_active ? 'Login switched off' : 'Login switched on')}>{a.is_active ? 'Disable' : 'Enable'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!admins.length && <p className="muted panel-pad">No admin yet — add one so the dealer can log in.</p>}
      </div>
      {adding && <AdminForm franchiseId={f.id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </section>
  );
}

// Commission and payments, entered by hand.
export function Ledger({ f, entries, money, reload }) {
  const toast = useToast();
  const [form, setForm] = useState({ type: 'commission', amount: '', date: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), reference: '', note: '' });
  const [busy, setBusy] = useState(false);
  const TYPES = { commission: '🧾 Commission (dealer owes HQ)', payment: '✅ Payment received from dealer', expense: '📉 Expense (for reports)', adjustment: '✏️ Adjustment (+ owes more / − owes less)' };
  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/super/franchises/${f.id}/ledger`, { method: 'POST', body: form });
      toast('Saved');
      setForm({ ...form, amount: '', reference: '', note: '' });
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (l) => {
    if (!confirm('Delete this entry?')) return;
    await api(`/super/ledger/${l.id}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'error'));
    reload();
  };
  return (
    <div className="stack">
      <div className="kpi-grid compact">
        <div className="kpi"><span className="kpi-label">Commission</span><span className="kpi-value">{rupees(money.commission)}</span></div>
        <div className="kpi"><span className="kpi-label">Paid</span><span className="kpi-value">{rupees(money.paid)}</span></div>
        <div className="kpi"><span className="kpi-label">Pending</span><span className={`kpi-value ${money.pending > 0 ? 'text-warn' : ''}`}>{rupees(money.pending)}</span></div>
        <div className="kpi"><span className="kpi-label">Expenses noted</span><span className="kpi-value">{rupees(money.expenses)}</span></div>
      </div>
      <section className="panel form">
        <h3>Add an entry</h3>
        <form className="ledger-form" onSubmit={add}>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input type="number" step="0.01" placeholder="Amount ₹" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <input placeholder="UPI ref / receipt" value={form.reference} maxLength={60} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          <input placeholder="Note (e.g. October commission)" value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <button className="btn btn-primary" disabled={busy}>Add</button>
        </form>
        <p className="muted small">Commission is decided by you — enter it here; the dealer sees the totals on their home page.</p>
      </section>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Reference / note</th><th>By</th><th aria-label="Delete" /></tr></thead>
            <tbody>
              {entries.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap small">{new Date(l.entry_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td>{TYPES[l.type].split(' (')[0]}</td>
                  <td className="nowrap"><b>{rupees(l.amount)}</b></td>
                  <td className="small">{l.reference && <b>{l.reference} </b>}{l.note}</td>
                  <td className="muted small">{l.created_by_name}</td>
                  <td><button className="link-btn danger-text" onClick={() => remove(l)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && <p className="muted panel-pad">No entries yet.</p>}
        </div>
      </section>
    </div>
  );
}

function Documents({ f, docs, reload }) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const upload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('label', label);
      fd.append('file', file);
      await api(`/super/franchises/${f.id}/documents`, { method: 'POST', body: fd });
      toast('Uploaded');
      setLabel('');
      setFile(null);
      e.target.reset();
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const open = async (d) => {
    try {
      const { url } = await apiFile(`/super/documents/${d.id}`);
      window.open(url, '_blank');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const remove = async (d) => {
    if (!confirm(`Delete "${d.label}"?`)) return;
    await api(`/super/documents/${d.id}`, { method: 'DELETE' }).catch((e) => toast(e.message, 'error'));
    reload();
  };
  return (
    <div className="stack">
      <section className="panel form">
        <h3>Upload a document</h3>
        <form className="ledger-form" onSubmit={upload}>
          <input placeholder="What is it? e.g. Franchise agreement" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} required />
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} required />
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
        </form>
        <p className="muted small">Agreement, GST, PAN, shop licence… PDF or photo, up to 8 MB. Private — only HQ can open them.</p>
      </section>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Document</th><th>Uploaded</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>📄 <b>{d.label}</b></td>
                  <td className="muted small">{timeAgo(d.uploaded_at)}</td>
                  <td className="nowrap"><button className="btn btn-ghost btn-sm" onClick={() => open(d)}>Open</button> <button className="link-btn danger-text" onClick={() => remove(d)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!docs.length && <p className="muted panel-pad">No documents yet.</p>}
        </div>
      </section>
    </div>
  );
}
