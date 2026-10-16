import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { rupees } from '../orderStatus.jsx';
import { setScope } from '../scope.js';
import { Modal, useLoad, useToast } from '../admin/ui.jsx';

// HQ: platform dashboard, the franchise list (Dealer Management) and the add / edit form.
export const FR_STATUS = {
  pending: ['Pending', '#f59e0b'],
  active: ['Active', '#16a34a'],
  disabled: ['Disabled', '#64748b'],
  suspended: ['Suspended', '#dc2626'],
};
export const FrBadge = ({ status }) => {
  const [label, color] = FR_STATUS[status] || [status, '#64748b'];
  return <span className="status-badge" style={{ '--c': color }}>{label}</span>;
};
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// Change a franchise's status (asks for a reason when switching off).
export async function changeStatus(f, status, toast, done) {
  const words = { active: 'Activate', disabled: 'Disable', suspended: 'Suspend', pending: 'Set back to pending' };
  let reason = '';
  if (status === 'disabled' || status === 'suspended') {
    reason = prompt(`${words[status]} ${f.name}?\n${status === 'suspended' ? 'Its admins are locked out and customers cannot order.' : 'Customers cannot order until it is activated again.'}\n\nReason (optional):`);
    if (reason === null) return;
  } else if (!confirm(`${words[status]} ${f.name}?`)) return;
  try {
    await api(`/super/franchises/${f.id}/status`, { method: 'PATCH', body: { status, reason } });
    toast(`${f.name}: ${FR_STATUS[status][0]}`);
    done();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ---------- dashboard ----------
export function SuperDashboard() {
  const d = useLoad(() => api('/super/dashboard'));
  const navigate = useNavigate();
  if (d.error) return <div className="alert">{d.error}</div>;
  if (!d.data) return <div className="center-block"><div className="spinner" /></div>;
  const s = d.data;
  const tile = (icon, label, value, to, sub) => (
    <Link key={label} to={to || '#'} className="kpi kpi-link">
      <span className="kpi-label">{icon} {label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <small className="muted">{sub}</small>}
    </Link>
  );
  const open = (f, to) => {
    setScope(f.id);
    navigate(to);
  };
  return (
    <div className="stack">
      <div className="kpi-grid">
        {tile('🏢', 'Franchises', s.franchises, '/super/franchises', `${s.franchises_active} active · ${s.franchises_pending} pending`)}
        {tile('👥', 'Users', s.users_total, '/super/users', `${s.users} ordered`)}
        {tile('🛵', 'Agents', s.agents, '/super/agents', s.agents_pending ? `${s.agents_pending} waiting for approval` : '')}
        {tile('🛡️', 'Franchise admins', s.admins, '/super/admins')}
        {tile('🧰', 'Services', s.services_total, '/super/services')}
        {tile('🛍️', 'Products', s.products_total, '/super/products')}
        {tile('📦', 'Orders', s.orders, '/super/orders')}
        {tile('🗓️', 'Bookings', s.bookings, '/super/orders')}
      </div>
      <div className="kpi-grid">
        {tile('💵', "Today's revenue", rupees(s.revenue_today), '/super/platform-reports')}
        {tile('📅', 'This month', rupees(s.revenue_month), '/super/platform-reports')}
        {tile('💰', 'Total revenue', rupees(s.revenue), '/super/platform-reports')}
        {tile('⏳', 'Pending orders', s.pending, '/super/orders?status=active')}
        {tile('✅', 'Completed', s.completed, '/super/orders?status=delivered')}
        {tile('❌', 'Cancelled', s.cancelled, '/super/orders?status=cancelled')}
        {tile('✍️', 'Approvals waiting', s.requests_pending, '/super/requests')}
        {tile('🙋', 'Open complaints', s.complaints_open, '/super/complaints')}
      </div>
      <section className="panel table-panel">
        <div className="panel-pad panel-head"><h3>Franchises at a glance</h3><Link className="link" to="/super/franchises">Manage →</Link></div>
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Franchise</th><th>Status</th><th>Orders</th><th>Pending</th><th>Agents</th><th>Revenue</th><th>Month</th><th>Commission due</th><th aria-label="Open" /></tr></thead>
            <tbody>
              {s.by_franchise.map((f) => (
                <tr key={f.id}>
                  <td><b>{f.code}</b> · {f.city}<div className="muted small">{f.name}</div></td>
                  <td><FrBadge status={f.status} /></td>
                  <td>{f.orders + f.bookings}</td>
                  <td>{f.pending > 0 ? <button className="link-btn" onClick={() => open(f, '/super/orders?status=active')}>{f.pending}</button> : 0}</td>
                  <td>{f.agents}</td>
                  <td className="nowrap">{rupees(f.revenue)}</td>
                  <td className="nowrap">{rupees(f.revenue_month)}</td>
                  <td className={`nowrap ${f.money.pending > 0 ? 'text-warn' : ''}`}>{rupees(f.money.pending)}</td>
                  <td><Link className="btn btn-ghost btn-sm" to={`/super/franchises/${f.id}`} onClick={() => setScope(f.id)}>Dashboard</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------- Dealer / Franchise Management ----------
export function Franchises() {
  const toast = useToast();
  const list = useLoad(() => api('/super/franchises'));
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const rows = (list.data || []).filter((f) => (!status || f.status === status)
    && `${f.code} ${f.name} ${f.owner_name || ''} ${f.city} ${f.phone || ''} ${f.email || ''}`.toLowerCase().includes(q.toLowerCase()));
  const count = (st) => (list.data || []).filter((f) => !st || f.status === st).length;

  return (
    <div className="stack">
      <div className="toolbar">
        <input className="toolbar-search" type="search" placeholder="Search dealer ID, name, owner, city, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Link className="btn btn-primary" to="/super/franchises/new">➕ New franchise</Link>
      </div>
      <div className="tabs scroll-tabs" role="tablist">
        {[['', 'All'], ['active', 'Active'], ['pending', 'Pending approval'], ['disabled', 'Disabled'], ['suspended', 'Suspended']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={status === k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>
            {l} <span className={`count ${k === 'pending' && count('pending') ? 'alert-count' : ''}`}>{count(k)}</span>
          </button>
        ))}
      </div>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="table franchise-table">
            <thead>
              <tr>
                <th>Dealer ID</th><th>Dealer / owner</th><th>Contact</th><th>Address</th><th>Status</th><th>Registered</th>
                <th>Services</th><th>Products</th><th>Users</th><th>Agents</th><th>Orders</th><th>Bookings</th>
                <th>Revenue</th><th>Commission</th><th>Pending</th><th>Completed amt</th><th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const s = f.stats;
                return (
                  <tr key={f.id} className={f.status === 'suspended' ? 'row-bad' : f.status === 'disabled' ? 'row-muted' : ''}>
                    <td className="nowrap"><Link className="link" to={`/super/franchises/${f.id}`} onClick={() => setScope(f.id)}><b>{f.code}</b></Link></td>
                    <td><b>{f.name}</b><div className="muted small">{f.owner_name || 'Owner not set'}</div></td>
                    <td className="small">{f.phone ? <a className="link" href={`tel:${f.phone}`}>{f.phone}</a> : '—'}<div className="muted">{f.email || ''}</div></td>
                    <td className="small">{f.address || ''}<div><b>{f.city}</b>, {f.state} {f.pincode || ''}</div></td>
                    <td><FrBadge status={f.status} />{f.status_reason && <div className="muted small">{f.status_reason}</div>}</td>
                    <td className="small nowrap">{day(f.registered_at)}</td>
                    <td>{s.services}</td>
                    <td>{s.products}</td>
                    <td>{s.users}</td>
                    <td>{s.agents}{s.agents_pending > 0 && <div className="small text-warn">+{s.agents_pending} waiting</div>}</td>
                    <td>{s.orders}</td>
                    <td>{s.bookings}</td>
                    <td className="nowrap">{rupees(s.revenue)}</td>
                    <td className="nowrap">{rupees(s.money.commission)}</td>
                    <td className={`nowrap ${s.money.pending > 0 ? 'text-warn' : ''}`}>{rupees(s.money.pending)}</td>
                    <td className="nowrap">{rupees(s.money.paid)}</td>
                    <td className="nowrap">
                      <Link className="btn btn-primary btn-sm" to={`/super/franchises/${f.id}`} onClick={() => setScope(f.id)}>View</Link>{' '}
                      <Link className="btn btn-ghost btn-sm" to={`/super/franchises/${f.id}/edit`}>Edit</Link>{' '}
                      <StatusMenu f={f} toast={toast} done={list.reload} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.data && !rows.length && <p className="muted panel-pad">No franchises here.</p>}
          {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}
          {list.error && <div className="alert">{list.error}</div>}
        </div>
      </section>
    </div>
  );
}

export function StatusMenu({ f, toast, done }) {
  const options = {
    pending: [['active', '✓ Activate'], ['disabled', 'Disable']],
    active: [['disabled', 'Disable'], ['suspended', 'Suspend']],
    disabled: [['active', '✓ Enable'], ['suspended', 'Suspend']],
    suspended: [['active', '✓ Activate'], ['disabled', 'Disable']],
  }[f.status] || [];
  return (
    <select className="status-select" value="" onChange={(e) => e.target.value && changeStatus(f, e.target.value, toast, done)} aria-label={`Change status of ${f.name}`}>
      <option value="">Status…</option>
      {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}

// ---------- new / edit franchise ----------
const EMPTY = { name: '', owner_name: '', phone: '', email: '', address: '', city: '', state: 'Telangana', pincode: '', gst_number: '', notes: '' };

export function FranchiseForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const existing = useLoad(() => (isNew ? Promise.resolve(null) : api(`/super/franchises/${id}`)), [id]);
  const [form, setForm] = useState(null);
  const [admin, setAdmin] = useState({ admin_username: '', admin_password: '', admin_name: '', admin_phone: '', admin_email: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!form) {
    if (isNew) setForm(EMPTY);
    else if (existing.data) setForm(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, existing.data.franchise[k] ?? ''])));
    return existing.error ? <div className="alert">{existing.error}</div> : <div className="center-block"><div className="spinner" /></div>;
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setA = (k) => (e) => setAdmin({ ...admin, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = isNew && admin.admin_username ? { ...form, ...admin } : form;
      const f = await api(isNew ? '/super/franchises' : `/super/franchises/${id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast(isNew ? `${f.code} created — add its service areas, then activate it` : 'Saved');
      setScope(f.id);
      navigate(`/super/franchises/${f.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="stack franchise-form" onSubmit={save}>
      <section className="panel form">
        <h3>🏢 Dealer details</h3>
        <div className="form-row">
          <label>Franchise name *<input value={form.name} onChange={set('name')} placeholder="e.g. Kukatpally Franchise" required /></label>
          <label>Owner name<input value={form.owner_name} onChange={set('owner_name')} placeholder="Dealer's full name" /></label>
        </div>
        <div className="form-row">
          <label>Phone<input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="10-digit mobile" /></label>
          <label>Email<input type="email" value={form.email} onChange={set('email')} placeholder="dealer@example.com" /></label>
        </div>
        <label>Address<textarea rows={2} value={form.address} onChange={set('address')} placeholder="Office address" /></label>
        <div className="form-row">
          <label>City * <small className="muted">(one franchise per city)</small><input value={form.city} onChange={set('city')} placeholder="e.g. Kukatpally" required /></label>
          <label>State<input value={form.state} onChange={set('state')} /></label>
          <label>PIN code<input value={form.pincode} onChange={set('pincode')} inputMode="numeric" maxLength={6} /></label>
        </div>
        <div className="form-row">
          <label>GST number<input value={form.gst_number} onChange={set('gst_number')} placeholder="optional" /></label>
          <label>Notes<input value={form.notes} onChange={set('notes')} placeholder="optional" /></label>
        </div>
      </section>
      {isNew && (
        <section className="panel form">
          <h3>🛡️ Franchise admin login <small className="muted">(optional — you can add admins later)</small></h3>
          <div className="form-row">
            <label>Username<input value={admin.admin_username} onChange={setA('admin_username')} placeholder="e.g. kukatpally_admin" autoComplete="off" /></label>
            <label>Password<input value={admin.admin_password} onChange={setA('admin_password')} placeholder="at least 8 characters" autoComplete="new-password" /></label>
          </div>
          <div className="form-row">
            <label>Admin name<input value={admin.admin_name} onChange={setA('admin_name')} /></label>
            <label>Admin phone<input value={admin.admin_phone} onChange={setA('admin_phone')} inputMode="tel" /></label>
          </div>
        </section>
      )}
      {isNew && <p className="muted small">A new franchise starts as <b>Pending</b> with every service switched on. Add its service areas, then activate it to go live.</p>}
      {error && <div className="alert">{error}</div>}
      <div className="toolbar">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create franchise' : 'Save changes'}</button>
        <Link className="btn btn-ghost" to={isNew ? '/super/franchises' : `/super/franchises/${id}`}>Cancel</Link>
      </div>
    </form>
  );
}

// ---------- add a franchise admin (used on the franchise page and the Admins page) ----------
export function AdminForm({ franchiseId, franchises, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ franchise_id: franchiseId || '', username: '', password: '', full_name: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/super/admins', { method: 'POST', body: form });
      toast(`Admin ${form.username} created — give them the username and password`);
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title="New franchise admin" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="adm-form" disabled={busy}>Create</button></>}>
      <form id="adm-form" className="stack" onSubmit={save}>
        {!franchiseId && (
          <label>Franchise
            <select value={form.franchise_id} onChange={set('franchise_id')} required>
              <option value="">Choose…</option>
              {(franchises || []).map((f) => <option key={f.id} value={f.id}>{f.code} · {f.city}</option>)}
            </select>
          </label>
        )}
        <div className="form-row">
          <label>Username<input value={form.username} onChange={set('username')} required autoComplete="off" /></label>
          <label>Password<input value={form.password} onChange={set('password')} required minLength={8} autoComplete="new-password" placeholder="at least 8 characters" /></label>
        </div>
        <label>Full name<input value={form.full_name} onChange={set('full_name')} required /></label>
        <div className="form-row">
          <label>Phone<input value={form.phone} onChange={set('phone')} inputMode="tel" /></label>
          <label>Email<input type="email" value={form.email} onChange={set('email')} /></label>
        </div>
      </form>
    </Modal>
  );
}
