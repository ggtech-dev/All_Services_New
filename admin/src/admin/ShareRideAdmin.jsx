import { useState } from 'react';
import { api, apiFile } from '../api.js';
import { Modal, Switch, useLoad, useToast } from './ui.jsx';
import SeatMap from '../components/SeatMap.jsx';
import { useAskReason } from '../components/AskReason.jsx';
import { askConfirm } from '../components/ConfirmDialog.jsx';

// 🚗 Share Ride — run by each franchise admin: approve car owners' cars (papers: RC, permit, insurance — commercial
// yellow-board cars only), watch journeys and bookings, keep the car models (seat layouts) and towns list.
// The owner's subscription is on the Subscriptions page. HQ sees every city here but does not change cars or journeys.
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const IST = { timeZone: 'Asia/Kolkata' };
const when = (d) => new Date(d).toLocaleString('en-IN', { ...IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const CAR = { pending: ['⏳ Pending', 'warn'], approved: ['✅ Approved', 'ok'], rejected: ['❌ Rejected', 'bad'], removed: ['Removed', 'bad'] };
const BOOK = { held: ['Waiting for payment', 'warn'], paid: ['Owner to confirm', 'warn'], confirmed: ['Confirmed', 'ok'], expired: ['Expired', ''],
  left: ['Left', ''], rejected: ['Payment not received', 'bad'], cancelled: ['Cancelled', 'bad'] };
const DOCS = [['rc_doc', 'RC', 'has_rc'], ['permit_doc', 'Permit', 'has_permit'], ['insurance_doc', 'Insurance', 'has_insurance'], ['car_photo', 'Photo', 'has_photo']];

export default function ShareRideAdmin() {
  const toast = useToast();
  const data = useLoad(() => api('/share-ride/admin'));
  const [tab, setTab] = useState('cars');
  const [askReason, reasonBox] = useAskReason();
  const [model, setModel] = useState(null);
  const d = data.data;
  if (!d) return data.error ? <div className="alert">{data.error}</div> : <div className="center-block"><div className="spinner" /></div>;
  const canEdit = d.can_edit;

  const act = async (fn, msg) => {
    try {
      await fn();
      toast(msg);
      data.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const review = async (c, action) => {
    let reason = '';
    if (action === 'approve') {
      if (!(await askConfirm(`Approve ${c.reg_number} (${c.model})?${c.owner_status === 'pending' ? `\n\nThis also approves the owner ${c.owner_name}.` : ''}\n\nCheck: yellow number plate, valid permit and insurance.`, { okText: 'Approve' }))) return;
    } else {
      reason = await askReason({ title: `${action === 'reject' ? 'Reject' : 'Remove'} ${c.reg_number}?`, text: 'The car owner sees this reason.', required: true, okText: action === 'reject' ? 'Reject car' : 'Remove car' });
      if (!reason) return;
    }
    act(() => api(`/share-ride/admin/cars/${c.id}/review`, { method: 'POST', body: { action, reason } }), `Car ${c.reg_number}: ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'removed'}`);
  };
  const openDoc = async (c, field) => {
    try {
      const f = await apiFile(`/share-ride/admin/cars/${c.id}/docs/${field}`);
      window.open(f.url, '_blank', 'noopener');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const cancelRide = async (r) => {
    const reason = await askReason({ title: `Cancel ${r.from_place} → ${r.to_place}, ${when(r.depart_at)}?`, text: 'All passengers are told. The car owner must return any money taken.', required: true, okText: 'Cancel journey' });
    if (reason) act(() => api(`/share-ride/admin/rides/${r.id}/cancel`, { method: 'POST', body: { reason } }), 'Journey cancelled');
  };

  const pending = d.cars.filter((c) => c.status === 'pending').length;
  return (
    <div className="stack share-admin">
      {reasonBox}
      <section className="panel how-it-works">
        <b>🚗 How Share Ride works</b>
        <p className="small muted">
          1. A car owner applies (agent type <b>Share Ride car owners</b>) with the car’s RC, permit and insurance — <b>commercial yellow-board cars only</b>.
          2. You approve the car here (this also approves a new owner). 3. You switch on the owner’s <b>subscription</b> on the Subscriptions page.
          4. The owner lists journeys with their own seat prices; customers book seats and pay the owner directly. No cancellation by customers after payment; if an owner cancels, the owner refunds.
        </p>
        {!canEdit && <p className="small">👀 HQ view — cars and journeys are managed by each city’s franchise admin.</p>}
      </section>

      <div className="tabs scroll-tabs" role="tablist">
        {[['cars', `🚗 Cars`, pending], ['rides', '🗓️ Journeys'], ['bookings', '🎫 Bookings'], ['models', '🚘 Car models'], ['places', '📍 Towns']].map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {l} {n > 0 && <span className="count alert-count">{n}</span>}
          </button>
        ))}
      </div>

      {tab === 'cars' && (
        <section className="panel table-panel">
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Car</th><th>Owner</th><th>Papers</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {d.cars.map((c) => {
                  const [label, tone] = CAR[c.status] || [c.status, ''];
                  return (
                    <tr key={c.id}>
                      <td><b>{c.reg_number}</b><div className="small muted">{c.model}{c.color ? ` · ${c.color}` : ''}{c.city ? ` · ${c.city}` : ''}</div></td>
                      <td>{c.owner_name}<div className="small muted">+91 {c.owner_phone} · agent {c.owner_status}</div></td>
                      <td className="doc-btns">{DOCS.map(([f, l, has]) => c[has] && <button key={f} className="btn btn-ghost btn-sm" onClick={() => openDoc(c, f)}>📄 {l}</button>)}</td>
                      <td>
                        <span className={`ride-status ${tone}`}>{label}</span>
                        {c.status_reason && <div className="small muted">{c.status_reason}</div>}
                        {c.status === 'approved' && c.hidden_reason && <div className="small warn-text">⚪ Hidden: {c.hidden_reason}</div>}
                      </td>
                      <td className="row-actions">
                        {canEdit && c.status !== 'approved' && <button className="btn btn-primary btn-sm btn-success" onClick={() => review(c, 'approve')}>✅ Approve</button>}
                        {canEdit && c.status === 'pending' && <button className="btn btn-ghost btn-sm danger-text" onClick={() => review(c, 'reject')}>Reject</button>}
                        {canEdit && c.status === 'approved' && <button className="btn btn-ghost btn-sm danger-text" onClick={() => review(c, 'remove')}>Remove</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!d.cars.length && <p className="muted center-block">No cars yet. Share the agent application link with car owners — they choose “Share Ride car owner”.</p>}
          </div>
        </section>
      )}

      {tab === 'rides' && (
        <section className="panel table-panel">
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>When</th><th>Route</th><th>Car</th><th>Owner</th><th>Seats</th><th>Status</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {d.rides.map((r) => (
                  <tr key={r.id} className={r.status === 'cancelled' ? 'row-muted' : ''}>
                    <td>{when(r.depart_at)}</td>
                    <td><b>{r.from_place} → {r.to_place}</b></td>
                    <td className="small">{r.reg_number}<div className="muted">{r.model}</div></td>
                    <td className="small">{r.owner_name}<div className="muted">+91 {r.owner_phone}</div></td>
                    <td>{r.booked}/{r.seats}{r.waiting > 0 && <div className="small warn-text">{r.waiting} to confirm</div>}</td>
                    <td>{r.status === 'cancelled' ? <span className="ride-status bad" title={r.cancel_reason}>Cancelled</span> : new Date(r.depart_at) < new Date() ? 'Departed' : <span className="ride-status ok">Open</span>}</td>
                    <td>{canEdit && r.status === 'open' && new Date(r.depart_at) > new Date() && <button className="btn btn-ghost btn-sm danger-text" onClick={() => cancelRide(r)}>Cancel</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!d.rides.length && <p className="muted center-block">No journeys in the last 7 days.</p>}
          </div>
        </section>
      )}

      {tab === 'bookings' && (
        <section className="panel table-panel">
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Ticket</th><th>Journey</th><th>Customer</th><th>Seats</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {d.bookings.map((b) => {
                  const [label, tone] = BOOK[b.status] || [b.status, ''];
                  return (
                    <tr key={b.id}>
                      <td><b>{b.code}</b><div className="small muted">{when(b.created_at)}</div></td>
                      <td className="small">{b.from_place} → {b.to_place}<div className="muted">{when(b.depart_at)} · {b.owner_name}</div></td>
                      <td className="small">{b.customer_name}<div className="muted">+91 {b.contact_phone}</div></td>
                      <td>{b.seats.length}</td>
                      <td>{rupees(b.amount)}<div className="small muted">{b.pay_mode === 'cash' ? 'cash at pickup' : `UPI${b.utr ? ` · ${b.utr}` : ''}`}</div></td>
                      <td><span className={`ride-status ${tone}`}>{label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!d.bookings.length && <p className="muted center-block">No bookings in the last 30 days.</p>}
          </div>
        </section>
      )}

      {tab === 'models' && (
        <section className="panel">
          <div className="panel-head">
            <h3>🚘 Car models ({d.models.length})</h3>
            <button className="btn btn-primary btn-sm" onClick={() => setModel({ name: '', layout: [{ name: 'Front', cells: 'S_D' }, { name: 'Back', cells: 'SSS' }], is_active: true })}>➕ Add model</button>
          </div>
          <p className="small muted">Each model has its real seat layout — customers see exactly this seat map. Journeys already listed keep their own copy.</p>
          <div className="model-grid">
            {d.models.map((m) => (
              <button key={m.id} type="button" className={`model-card ${m.is_active ? '' : 'row-muted'}`} onClick={() => setModel(m)}>
                <b>{m.name}</b>
                <small>{m.layout.map((r) => `${r.name}: ${[...r.cells].filter((x) => x === 'S').length}`).join(' · ')}{m.is_active ? '' : ' · off'}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {tab === 'places' && <Places places={d.places} reload={data.reload} toast={toast} />}

      {model && <ModelForm model={model} onClose={() => setModel(null)} onSaved={() => { setModel(null); data.reload(); toast('Car model saved'); }} />}
    </div>
  );
}

function ModelForm({ model, onClose, onSaved }) {
  const [f, setF] = useState({ name: model.name, layout: model.layout.map((r) => ({ ...r })), is_active: model.is_active !== false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setRow = (i, k, v) => setF({ ...f, layout: f.layout.map((r, j) => (j === i ? { ...r, [k]: k === 'cells' ? v.toUpperCase().replace(/[^SD_]/g, '').slice(0, 5) : v.slice(0, 20) } : r)) });
  const seats = f.layout.reduce((n, r) => n + [...r.cells].filter((x) => x === 'S').length, 0);
  const save = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api(model.id ? `/share-ride/admin/models/${model.id}` : '/share-ride/admin/models', { method: model.id ? 'PUT' : 'POST', body: f });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={model.id ? `Edit ${model.name}` : 'Add car model'} onClose={onClose} wide
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="model-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="model-form" className="model-form" onSubmit={save}>
        <div className="stack-sm">
          <label>Model name *<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.slice(0, 60) })} placeholder="e.g. Maruti Ertiga (6 passengers)" required /></label>
          <p className="small muted">Rows from front to back. In each row type <b>S</b> = seat, <b>D</b> = driver (once, first row), <b>_</b> = gap / aisle. Up to 5 places in a row.</p>
          {f.layout.map((r, i) => (
            <div key={i} className="model-row">
              <input value={r.name} onChange={(e) => setRow(i, 'name', e.target.value)} placeholder="Row name" aria-label={`Row ${i + 1} name`} />
              <input value={r.cells} onChange={(e) => setRow(i, 'cells', e.target.value)} placeholder="S_D" aria-label={`Row ${i + 1} seats`} className="mono" />
              <button type="button" className="btn btn-ghost btn-sm" disabled={f.layout.length <= 2} onClick={() => setF({ ...f, layout: f.layout.filter((_, j) => j !== i) })} aria-label="Remove row">✖</button>
            </div>
          ))}
          {f.layout.length < 8 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, layout: [...f.layout, { name: `Row ${f.layout.length + 1}`, cells: 'SSS' }] })}>➕ Add row</button>}
          <Switch checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Owners can choose this model" />
          {error && <div className="alert">{error}</div>}
        </div>
        <div>
          <p className="small"><b>{seats}</b> passenger seats — preview:</p>
          <SeatMap layout={f.layout} />
        </div>
      </form>
    </Modal>
  );
}

function Places({ places, reload, toast }) {
  const [name, setName] = useState('');
  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/share-ride/admin/places', { method: 'POST', body: { name } });
      setName('');
      toast('Town added');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const toggle = async (p) => {
    try {
      await api(`/share-ride/admin/places/${p.id}`, { method: 'PUT', body: { is_active: !p.is_active } });
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <section className="panel">
      <h3>📍 Towns for journeys</h3>
      <p className="small muted">Car owners choose From / To from this list, and customers search with it. One list for all cities.</p>
      <form className="toolbar" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="Town name, e.g. Vemulawada" required />
        <button className="btn btn-primary btn-sm">➕ Add town</button>
      </form>
      <div className="place-list">
        {places.map((p) => (
          <span key={p.id} className={`place-chip ${p.is_active ? '' : 'off'}`}>
            {p.name} <Switch checked={p.is_active} onChange={() => toggle(p)} label="" />
          </span>
        ))}
      </div>
    </section>
  );
}
