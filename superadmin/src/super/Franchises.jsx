import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { rupees } from '../orderStatus.jsx';
import { setScope } from '../scope.js';
import { Modal, useLoad, useToast } from '../admin/ui.jsx';
import MapView from '../components/LazyMap.jsx';

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

// Change a franchise's status. HQ does not run a city's orders, so before switching a city off it shows what is still
// open there (orders, agents on the way, Share Ride seats) — safest: Disable first, let them finish, then Suspend.
const STATUS_WORDS = {
  active: ['Activate', 'Customers in this city can order again.'],
  disabled: ['Disable', 'New orders stop: customers in this city cannot order. Its admin can still log in and agents finish the orders they have.'],
  suspended: ['Suspend', 'New orders stop AND the franchise admins are locked out. Nobody can handle the city\'s open orders after this.'],
  pending: ['Set back to pending', 'The franchise is not live; customers cannot order.'],
};
function StatusDialog({ f, status, onClose, onDone }) {
  const toast = useToast();
  const [verb, effect] = STATUS_WORDS[status];
  const off = status === 'disabled' || status === 'suspended';
  const work = useLoad(() => (off ? api(`/super/franchises/${f.id}/open-work`) : Promise.resolve(null)));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const w = work.data;
  const open = w && (w.waiting + w.on_the_way + w.ride_bookings > 0);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/super/franchises/${f.id}/status`, { method: 'PATCH', body: { status, reason } });
      toast(`${f.name}: ${FR_STATUS[status][0]}`);
      onDone();
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title={`${verb} ${f.code} · ${f.city}?`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className={`btn ${off ? 'btn-danger' : 'btn-primary'}`} onClick={save} disabled={busy || (off && !w)}>{busy ? 'Saving…' : `Yes, ${verb.toLowerCase()}`}</button>
      </>}>
      <div className="stack status-dialog">
        <p>{effect}</p>
        {off && !w && <div className="center-block"><div className="spinner" /></div>}
        {off && w && (open ? (
          <div className="open-work-warn">
            ⚠️ <b>{f.city} still has open work:</b>
            <ul>
              {w.waiting > 0 && <li><b>{w.waiting}</b> order{w.waiting > 1 ? 's' : ''} waiting for an agent</li>}
              {w.on_the_way > 0 && <li><b>{w.on_the_way}</b> order{w.on_the_way > 1 ? 's' : ''} on the way ({w.agents_busy} agent{w.agents_busy === 1 ? '' : 's'} on delivery)</li>}
              {w.ride_bookings > 0 && <li><b>{w.ride_bookings}</b> Share Ride seat booking{w.ride_bookings > 1 ? 's' : ''} for coming journeys</li>}
            </ul>
            {status === 'suspended'
              ? <p className="small">Safest: <b>Disable</b> first, let these finish, then Suspend.</p>
              : <p className="small">Agents can still finish what they have; ask the city's admin to handle the waiting orders.</p>}
          </div>
        ) : <p className="ok-text">✅ Nothing open in {f.city} right now ({w.agents_online} agent{w.agents_online === 1 ? '' : 's'} online).</p>)}
        {off && (
          <label>Reason (the franchise admin sees it)
            <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Agreement under review" />
          </label>
        )}
      </div>
    </Modal>
  );
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
        {tile('💵', "Today's revenue", rupees(s.revenue_today), '/super/reports?r=money')}
        {tile('📅', 'This month', rupees(s.revenue_month), '/super/reports?r=money')}
        {tile('💰', 'Total revenue', rupees(s.revenue), '/super/reports?r=money')}
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

export function StatusMenu({ f, done }) {
  const [next, setNext] = useState(null);
  const options = {
    pending: [['active', '✓ Activate'], ['disabled', 'Disable']],
    active: [['disabled', 'Disable'], ['suspended', 'Suspend']],
    disabled: [['active', '✓ Enable'], ['suspended', 'Suspend']],
    suspended: [['active', '✓ Activate'], ['disabled', 'Disable']],
  }[f.status] || [];
  return (
    <>
      <select className="status-select" value="" onChange={(e) => e.target.value && setNext(e.target.value)} aria-label={`Change status of ${f.name}`}>
        <option value="">Status…</option>
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {next && <StatusDialog f={f} status={next} onClose={() => setNext(null)} onDone={() => { setNext(null); done(); }} />}
    </>
  );
}

// ---------- new / edit franchise ----------
const EMPTY = { name: '', owner_name: '', phone: '', email: '', address: '', city: '', state: 'Telangana', pincode: '', gst_number: '', notes: '' };
// 📍 where the franchise serves (server: geo.sql) — the centre is tapped on the map; orders within the range go to it
const ZONE = { center_lat: null, center_lng: null, radius_km: '25', village_fee_near: '150', village_fee_far: '200' };
const kmBetween = (a, b) => {
  const rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(12742 * Math.asin(Math.sqrt(h)) * 10) / 10;
};
const newArea = () => ({ key: Math.random(), name: '', pincode: '', lat: null, lng: null, type: 'town' });

export function FranchiseForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const existing = useLoad(() => (isNew ? Promise.resolve(null) : api(`/super/franchises/${id}`)), [id]);
  const [form, setForm] = useState(null);
  const [admin, setAdmin] = useState({ admin_username: '', admin_password: '', admin_name: '', admin_phone: '', admin_email: '' });
  const [zone, setZone] = useState(null);
  const [areas, setAreas] = useState(() => [newArea()]); // new franchise: its first areas and villages
  const [pinFor, setPinFor] = useState('center'); // what the next map tap sets: 'center' or an area's key
  const [activate, setActivate] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!form) {
    if (isNew) {
      setForm(EMPTY);
      setZone(ZONE);
    } else if (existing.data) {
      const fr = existing.data.franchise;
      setForm(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, fr[k] ?? ''])));
      setZone({ center_lat: fr.center_lat == null ? null : Number(fr.center_lat), center_lng: fr.center_lng == null ? null : Number(fr.center_lng),
        radius_km: String(Number(fr.radius_km ?? 25)), village_fee_near: String(Number(fr.village_fee_near)), village_fee_far: String(Number(fr.village_fee_far)) });
    }
    return existing.error ? <div className="alert">{existing.error}</div> : <div className="center-block"><div className="spinner" /></div>;
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setA = (k) => (e) => setAdmin({ ...admin, [k]: e.target.value });
  const setZ = (k) => (e) => setZone({ ...zone, [k]: e.target.value });
  const center = zone.center_lat != null ? { lat: zone.center_lat, lng: zone.center_lng } : null;
  const radius = Number(zone.radius_km) || 25;
  const setArea = (key, change) => setAreas((list) => list.map((a) => (a.key === key ? { ...a, ...change } : a)));
  const tapMap = ({ lat, lng }) => {
    const p = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
    if (pinFor === 'center') setZone((z) => ({ ...z, center_lat: p.lat, center_lng: p.lng }));
    else setArea(pinFor, p);
  };
  const filled = areas.filter((a) => a.name.trim() || a.lat != null);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (!center) throw new Error('Tap "📍 Set centre", then tap the middle of the city on the map');
      for (const a of filled) {
        if (!a.name.trim()) throw new Error('Write the name of every area (or remove the empty row)');
        if (a.lat == null) throw new Error(`Put ${a.name.trim()} on the map: tap "📍 Pin" on its row, then tap the map`);
      }
      const body = {
        ...form, ...(isNew && admin.admin_username && admin),
        center_lat: zone.center_lat, center_lng: zone.center_lng, radius_km: radius, village_fee_near: zone.village_fee_near, village_fee_far: zone.village_fee_far,
        ...(isNew && { areas: filled.map((a) => ({ name: a.name.trim(), pincode: a.pincode.trim(), lat: a.lat, lng: a.lng,
          is_village: a.type !== 'town', village_band: a.type === 'village1' ? 1 : a.type === 'village2' ? 2 : null })) }),
      };
      const f = await api(isNew ? '/super/franchises' : `/super/franchises/${id}`, { method: isNew ? 'POST' : 'PUT', body });
      let live = false;
      if (isNew && activate) {
        try {
          await api(`/super/franchises/${f.id}/status`, { method: 'PATCH', body: { status: 'active' } });
          live = true;
        } catch (err) {
          toast(`${f.code} created, but not activated: ${err.message}`, 'error');
        }
      }
      toast(isNew ? (live ? `${f.code} · ${f.city} is live 🎉` : `${f.code} created — activate it when ready`) : 'Saved');
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
      <section className="panel form">
        <h3>📍 Service zone</h3>
        <p className="muted small">Customers within the range get this franchise; its agents get orders only inside it. Tap <b>📍 Set centre</b>, then tap the middle of the city on the map.</p>
        <div className="form-row">
          <label>Range (km) *<input type="number" min="1" max="100" step="0.5" value={zone.radius_km} onChange={setZ('radius_km')} required /></label>
          <label>Village charge up to 10 km ₹<input type="number" min="0" max="2000" value={zone.village_fee_near} onChange={setZ('village_fee_near')} /></label>
          <label>Village charge 10–15 km ₹<input type="number" min="0" max="2000" value={zone.village_fee_far} onChange={setZ('village_fee_far')} /></label>
        </div>
        <div className="area-pin-row">
          <button type="button" className={`btn btn-sm ${pinFor === 'center' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPinFor('center')}>📍 Set centre</button>
          <span className={center ? 'success-text' : 'muted'}>{center ? `Centre: ${center.lat}, ${center.lng} · ${radius} km range` : 'No centre yet'}</span>
          {pinFor !== 'center' && <span className="pin-target">👆 Tap the map for: <b>{areas.find((a) => a.key === pinFor)?.name || 'this area'}</b></span>}
        </div>
        <MapView
          height={360}
          fitKey={center ? `c${Math.round(radius)}` : 'none'}
          markers={[
            ...(center ? [{ id: 'center', lat: center.lat, lng: center.lng, emoji: '🏢', color: '#4f46e5', accuracy_m: radius * 1000, label: `Centre · ${radius} km` }] : []),
            ...areas.filter((a) => a.lat != null).map((a) => ({ id: `a${a.key}`, lat: a.lat, lng: a.lng, emoji: a.type === 'town' ? '📍' : '🏡', color: a.type === 'town' ? '#0ea5e9' : '#65a30d', label: a.name || 'area' })),
          ]}
          onMapClick={tapMap}
        />
      </section>
      {isNew && (
        <section className="panel form">
          <h3>🗺️ Areas &amp; villages <small className="muted">(customers choose one at checkout — more can be added later)</small></h3>
          {areas.map((a) => {
            const km = center && a.lat != null ? kmBetween(center, a) : null;
            return (
              <div key={a.key} className="setup-area-row">
                <input value={a.name} onChange={(e) => setArea(a.key, { name: e.target.value })} placeholder="Area / village name" maxLength={80} aria-label="Area name" />
                <select value={a.type} onChange={(e) => setArea(a.key, { type: e.target.value })} aria-label="Type">
                  <option value="town">🏙️ Town area</option>
                  <option value="village1">🏡 Village · up to 10 km</option>
                  <option value="village2">🏡 Village · 10–15 km</option>
                </select>
                <input value={a.pincode} onChange={(e) => setArea(a.key, { pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} placeholder="PIN" inputMode="numeric" aria-label="PIN code" />
                <button type="button" className={`btn btn-sm ${pinFor === a.key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPinFor(a.key)}>📍 {a.lat != null ? 'Move' : 'Pin'}</button>
                <small className={km != null && km > radius ? 'danger-text' : 'muted'}>{a.lat == null ? 'not on map' : km != null ? `${km} km${km > radius ? ' — outside range!' : ''}` : 'pinned'}</small>
                <button type="button" className="icon-btn" onClick={() => setAreas((l) => (l.length > 1 ? l.filter((x) => x.key !== a.key) : [newArea()]))} aria-label="Remove row">✕</button>
              </div>
            );
          })}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const n = newArea(); setAreas((l) => [...l, n]); setPinFor(n.key); }}>➕ Add another area / village</button>
        </section>
      )}
      {isNew && (
        <section className="panel form">
          <h3>🛡️ Franchise admin login <small className="muted">(optional — you can add admins later)</small></h3>
          <div className="form-row">
            <label>Username<input value={admin.admin_username} onChange={setA('admin_username')} placeholder="e.g. kukatpally_admin" autoComplete="off" /></label>
            {/* a username needs its password and name (the server checks them too) */}
            <label>Password{admin.admin_username && ' *'}<input value={admin.admin_password} onChange={setA('admin_password')} placeholder="at least 8 characters" autoComplete="new-password" required={!!admin.admin_username} minLength={8} /></label>
          </div>
          <div className="form-row">
            <label>Admin name{admin.admin_username && ' *'}<input value={admin.admin_name} onChange={setA('admin_name')} required={!!admin.admin_username} /></label>
            <label>Admin phone<input value={admin.admin_phone} onChange={setA('admin_phone')} inputMode="tel" /></label>
          </div>
        </section>
      )}
      {isNew && (
        <label className="check-row">
          <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
          <span><b>Activate now</b> — customers in the range can order straight away (needs at least one area). Otherwise it stays <b>Pending</b> until you activate it.</span>
        </label>
      )}
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
