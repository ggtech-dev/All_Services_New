import { useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, Switch, timeAgo, useLoad, useStaff, useToast } from './ui.jsx';

// 🚚 Goods Transportation (server: db/transport.sql, routes/transport.js) — goods vehicles of the city.
//   Franchise admin: adds the vehicles (2–3 photos the owner sent, with the owner's permission), marks them verified
//   after seeing the RC and licence, busy / switched off; sees calls and customers' reports.
//   HQ: every city, read only. Customers call / WhatsApp the owner directly — we only connect them.
const TYPES = [['ace', 'Tata Ace'], ['pickup', 'Bolero / Pickup'], ['auto', 'Goods Auto'], ['dcm', 'DCM / Mini Truck'], ['tempo', 'Tempo / Eicher'],
  ['tractor', 'Tractor Trolley'], ['lorry', 'Lorry'], ['other', 'Other']];
const typeName = (k) => TYPES.find((t) => t[0] === k)?.[1] || k;
const REASONS = { wrong_number: 'Wrong number', not_answering: 'Not answering', bad_experience: 'Bad experience', other: 'Something else' };

export default function TransportAdmin() {
  const { hq } = useStaff();
  const toast = useToast();
  const data = useLoad(() => api('/transport/admin'));
  const [editing, setEditing] = useState(null);
  const [type, setType] = useState('');
  const d = data.data;
  const canEdit = !!d?.can_edit;
  const list = (d?.vehicles || []).filter((v) => !type || v.vehicle_type === type);
  const openReports = (d?.reports || []).filter((r) => r.status === 'open');
  const close = async (r) => {
    try {
      await api(`/transport/admin/reports/${r.id}/close`, { method: 'POST' });
      toast('Report closed');
      data.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  if (data.error) return <div className="alert">{data.error}</div>;
  if (!d) return <div className="center-block"><div className="spinner" /></div>;
  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted toolbar-note">
          Goods vehicles of {hq ? 'every city' : 'your city'} — customers call or WhatsApp the owner directly; we only connect them.
          {canEdit && ' Add a vehicle only after the owner agrees, with 2–3 photos they sent.'}
        </p>
        {canEdit && <button className="btn btn-primary" onClick={() => setEditing({})}>➕ Add a vehicle</button>}
      </div>
      {openReports.length > 0 && (
        <section className="panel stock-panel">
          <div className="panel-head"><h3>⚠️ Customers' reports · {openReports.length}</h3></div>
          <div className="stock-list">
            {openReports.map((r) => (
              <div key={r.id} className="stock-item" style={{ gridTemplateColumns: '1fr auto' }}>
                <div>
                  <b>{r.model} · {r.vehicle_number}</b> <span className="muted small">({r.owner_name}, {r.owner_phone})</span>
                  <div className="small">{REASONS[r.reason]}{r.note ? ` — “${r.note}”` : ''}</div>
                  <div className="muted small">by {r.customer_name || 'a customer'} {r.customer_phone && `· ${r.customer_phone}`} · {timeAgo(r.created_at)}</div>
                </div>
                {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => close(r)}>Checked — close</button>}
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="tabs scroll-tabs" role="tablist">
        <button className={!type ? 'active' : ''} onClick={() => setType('')}>All<span className="count">{d.vehicles.length}</span></button>
        {TYPES.filter(([k]) => d.vehicles.some((v) => v.vehicle_type === k)).map(([k, l]) => (
          <button key={k} className={type === k ? 'active' : ''} onClick={() => setType(k)}>{l}<span className="count">{d.vehicles.filter((v) => v.vehicle_type === k).length}</span></button>
        ))}
      </div>
      {!list.length && <p className="muted">No vehicles yet.{canEdit && ' Add the goods vehicles of your city — Tata Ace, Bolero pickup, goods auto, DCM, tractor, lorry.'}</p>}
      <div className="offer-admin-list">
        {list.map((v) => (
          <section key={v.id} className={`panel offer-admin ${v.is_active ? '' : 'row-muted'}`}>
            <div className="vehicle-admin-photos">
              {v.photos.length ? v.photos.map((p) => <a key={p} href={p} target="_blank" rel="noreferrer"><img src={p} alt="" loading="lazy" /></a>)
                : <span className="vehicle-admin-none">🚚 no photo yet</span>}
            </div>
            <div className="offer-admin-body">
              <div className="offer-admin-title">
                <b>{v.model}</b><span className="mini-tag kind">{typeName(v.vehicle_type)}</span>
                {v.verified && <span className="mini-tag" style={{ background: '#dcfce7', color: '#166534' }}>✔ verified</span>}
                {!v.is_available && <span className="mini-tag">busy</span>}
                {!v.is_active && <span className="mini-tag">switched off</span>}
                {v.is_sample && <span className="mini-tag">sample</span>}
              </div>
              <div className="small">⚖️ {v.capacity} · {v.body} body · <b>{v.vehicle_number}</b>{hq && <> · {v.city}</>}</div>
              <div className="small">👤 {v.owner_name} · 📞 <a href={`tel:+91${v.phone}`}>{v.phone}</a> · 📍 {v.area}</div>
              {v.rate_note && <div className="small">💰 {v.rate_note}</div>}
              <div className="offer-admin-stats">
                <span><b>{v.call_count}</b> calls</span><span><b>{v.whatsapp_count}</b> WhatsApp</span>
                {v.open_reports > 0 && <span style={{ background: '#fee2e2', color: '#991b1b' }}><b>{v.open_reports}</b> reports</span>}
              </div>
            </div>
            {canEdit && <div className="offer-admin-acts"><button className="btn btn-ghost btn-sm" onClick={() => setEditing(v)}>✎ Edit</button></div>}
          </section>
        ))}
      </div>
      {editing && <VehicleForm v={editing} onClose={() => setEditing(null)} onDone={(msg) => { setEditing(null); toast(msg); data.reload(); }} />}
    </div>
  );
}

function VehicleForm({ v, onClose, onDone }) {
  const isNew = !v.id;
  const fileRef = useRef(null);
  const [f, setF] = useState({
    vehicle_type: v.vehicle_type || 'ace', model: v.model || '', capacity: v.capacity || '', body: v.body || 'open', owner_name: v.owner_name || '',
    phone: v.phone || '', vehicle_number: v.vehicle_number || '', area: v.area || '', rate_note: v.rate_note || '',
    verified: !!v.verified, consent_recorded: !!v.consent_recorded, is_available: v.is_available ?? true, is_active: v.is_active ?? true,
  });
  const [keep, setKeep] = useState(v.photos || []);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const room = 3 - keep.length - files.length;
  const pick = (e) => {
    const picked = [...(e.target.files || [])].slice(0, room);
    e.target.value = '';
    setFiles([...files, ...picked]);
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      for (const [k, val] of Object.entries(f)) fd.append(k, String(val));
      fd.append('keep', JSON.stringify(keep));
      for (const file of files) fd.append('photos', file);
      await api(isNew ? '/transport/admin' : `/transport/admin/${v.id}`, { method: isNew ? 'POST' : 'PUT', body: fd });
      onDone(isNew ? `${f.model} added — customers can call the owner now` : `${f.model} saved`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={isNew ? '➕ Add a goods vehicle' : `✎ ${v.model}`} onClose={onClose} wide footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={busy}>{isNew ? 'Add vehicle' : 'Save'}</button>
    </>}>
      <div className="form" style={{ marginTop: 0 }}>
        {error && <div className="alert">{error}</div>}
        <div className="form-row">
          <label>Type *
            <select value={f.vehicle_type} onChange={set('vehicle_type')}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label>Vehicle *<input value={f.model} onChange={set('model')} maxLength={60} placeholder="e.g. Tata Ace Gold" /></label>
        </div>
        <div className="form-row">
          <label>Carries *<input value={f.capacity} onChange={set('capacity')} maxLength={40} placeholder="e.g. 750 kg, 1.5 ton" /></label>
          <label>Body
            <select value={f.body} onChange={set('body')}><option value="open">Open</option><option value="closed">Closed</option><option value="trolley">Trolley</option></select>
          </label>
          <label>Vehicle number *<input value={f.vehicle_number} onChange={set('vehicle_number')} maxLength={15} placeholder="TS 36 AB 1234" /></label>
        </div>
        <div className="form-row">
          <label>Owner name *<input value={f.owner_name} onChange={set('owner_name')} maxLength={60} /></label>
          <label>Owner mobile *<input value={f.phone} onChange={set('phone')} maxLength={10} inputMode="numeric" /></label>
        </div>
        <div className="form-row">
          <label>Area / village *<input value={f.area} onChange={set('area')} maxLength={80} placeholder="e.g. Old Bus Stand, Siddipet" /></label>
          <label>Rate hint (optional)<input value={f.rate_note} onChange={set('rate_note')} maxLength={100} placeholder="e.g. ₹400 a trip in town" /></label>
        </div>
        <div>
          <span className="small"><b>Photos</b> — 2 or 3 the owner sent (front, side, loading area)</span>
          <div className="vehicle-admin-photos edit">
            {keep.map((p) => (
              <span key={p} className="vehicle-photo-chip"><img src={p} alt="" /><button type="button" aria-label="Remove photo" onClick={() => setKeep(keep.filter((x) => x !== p))}>×</button></span>
            ))}
            {files.map((file, i) => (
              <span key={file.name + i} className="vehicle-photo-chip"><img src={URL.createObjectURL(file)} alt="" /><button type="button" aria-label="Remove photo" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></span>
            ))}
            {room > 0 && <button type="button" className="vehicle-photo-add" onClick={() => fileRef.current?.click()}>➕<small>Add photo</small></button>}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={pick} />
        </div>
        <Switch checked={f.consent_recorded} onChange={(on) => setF({ ...f, consent_recorded: on })} label="Owner's permission recorded (to show the photos and number) *" />
        <Switch checked={f.verified} onChange={(on) => setF({ ...f, verified: on })} label="✔ Verified — I saw the RC and the driving licence" />
        <Switch checked={f.is_available} onChange={(on) => setF({ ...f, is_available: on })} label="Available (off = shown as busy today)" />
        {!isNew && <Switch checked={f.is_active} onChange={(on) => setF({ ...f, is_active: on })} label="Shown to customers (off = sold / stopped)" />}
      </div>
    </Modal>
  );
}
