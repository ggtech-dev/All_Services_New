import { useState } from 'react';
import { api } from '../api.js';
import { Modal, Switch, useLoad, useToast } from './ui.jsx';
import MapView from '../components/LazyMap.jsx';
import { useAuth } from '../auth.jsx';
import { getScope } from '../scope.js';

// Service areas (localities) customers choose at checkout; also used to find the nearest agent.
// Areas are never deleted — old orders point to them — they are switched off instead.
// 🏡 Villages (within 15 km of town) are areas too: only 🏡 Village Needs delivers there (next day, our own staff), with the
// village charge of their distance band (up to 10 km / 10–15 km), set by the franchise admin at the top of this page.

// straight-line km between two points (a hint — road distance is a bit more)
const kmBetween = (a, b) => {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(12742 * Math.asin(Math.sqrt(h)) * 10) / 10;
};
export default function Areas() {
  const toast = useToast();
  const list = useLoad(() => api('/admin/localities'));
  const { user } = useAuth();
  const hq = user.role === 'superadmin';
  // HQ: which franchise (city) a new area belongs to
  const franchises = useLoad(() => (hq ? api('/super/franchise-options') : Promise.resolve([])));
  const [editing, setEditing] = useState(null);
  const [showOff, setShowOff] = useState(false);

  const areas = list.data || [];
  const towns = areas.filter((a) => a.is_active && !a.is_village);
  const townCenter = towns.length ? { lat: towns.reduce((n, a) => n + Number(a.lat), 0) / towns.length, lng: towns.reduce((n, a) => n + Number(a.lng), 0) / towns.length } : null;
  const shown = areas.filter((a) => showOff || a.is_active);
  const offCount = areas.filter((a) => !a.is_active).length;

  const toggle = async (a) => {
    try {
      await api(`/admin/localities/${a.id}`, { method: 'PUT', body: { name: a.name, pincode: a.pincode || '', lat: a.lat, lng: a.lng, is_active: !a.is_active } });
      toast(`${a.name} ${a.is_active ? 'switched off' : 'switched on'}`);
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted toolbar-note">
          Customers pick one of these areas at checkout. Switched-off areas are hidden from customers (old orders keep them).
          Tap an area's pin on the map to edit it.
        </p>
        <button className="btn btn-primary" onClick={() => setEditing({ name: '', pincode: '', lat: null, lng: null, is_active: true })}>➕ Add area</button>
      </div>

      <VillageFees />

      <section className="panel">
        <MapView
          height={340}
          fitKey={`${list.data ? 'ok' : ''}-${showOff}`}
          markers={shown.map((a) => ({
            id: a.id, lat: Number(a.lat), lng: Number(a.lng), emoji: a.is_village ? '🏡' : '📍', color: !a.is_active ? '#94a3b8' : a.is_village ? '#65a30d' : '#4f46e5',
            label: `${a.name}${a.is_active ? '' : ' (off)'}`, onClick: () => setEditing(a),
          }))}
        />
      </section>

      <section className="panel table-panel">
        <div className="panel-head">
          <h3>🗺️ {areas.filter((a) => a.is_active).length} active areas</h3>
          {offCount > 0 && <Switch checked={showOff} onChange={setShowOff} label={`Show ${offCount} switched-off`} />}
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Area</th><th>Type</th>{hq && <th>Franchise</th>}<th>Pincode</th><th>Orders</th><th>Agents</th><th>On</th><th aria-label="Edit" /></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} className={a.is_active ? '' : 'row-muted'}>
                  <td><b>{a.name}</b></td>
                  <td className="small">{a.is_village
                    ? <span className="village-tag">🏡 Village · {a.village_band === 1 ? 'up to 10 km' : '10–15 km'} · ₹{Number(a.village_fee ?? 0)}{a.km_from_town != null && <span className="muted"> · ~{a.km_from_town} km</span>}</span>
                    : '🏙️ Town'}</td>
                  {hq && <td className="small">{a.franchise_name || <span className="danger-text">none</span>}</td>}
                  <td>{a.pincode || <span className="muted">—</span>}</td>
                  <td>{a.orders}</td>
                  <td>{a.agents}</td>
                  <td><Switch checked={a.is_active} onChange={() => toggle(a)} label="" /></td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => setEditing(a)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}
          {list.error && <div className="alert">{list.error}</div>}
        </div>
      </section>

      {editing && (
        <AreaForm
          area={editing}
          franchises={hq ? franchises.data || [] : null}
          townCenter={townCenter}
          onClose={() => setEditing(null)}
          onSaved={(a, isNew) => {
            setEditing(null);
            list.reload();
            toast(isNew ? `Added ${a.name}` : `Saved ${a.name}`);
          }}
        />
      )}
    </div>
  );
}

function AreaForm({ area, franchises, townCenter, onClose, onSaved }) {
  const isNew = !area.id;
  const [form, setForm] = useState({
    name: area.name, pincode: area.pincode || '', is_active: area.is_active,
    is_village: !!area.is_village, village_band: area.village_band ? String(area.village_band) : '',
    franchise_id: String(area.franchise_id ?? getScope() ?? ''),
    lat: area.lat == null ? null : Number(area.lat), lng: area.lng == null ? null : Number(area.lng),
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [gpsMsg, setGpsMsg] = useState('');
  const hasPin = form.lat != null && form.lng != null;

  const useMyLocation = () => {
    if (!navigator.geolocation) return setGpsMsg('Location is not available on this device');
    setGpsMsg('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm((f) => ({ ...f, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }));
        setGpsMsg('');
      },
      () => setGpsMsg('Allow location access, or tap the map'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    if (!hasPin) return setError('Tap the map to set where this area is');
    setBusy(true);
    try {
      if (form.is_village && !form.village_band) throw new Error('Choose how far the village is: up to 10 km, or 10–15 km');
      const body = { ...form, name: form.name.trim(), pincode: form.pincode.trim(), franchise_id: form.franchise_id || null,
        village_band: form.is_village ? Number(form.village_band) : null };
      const a = await api(isNew ? '/admin/localities' : `/admin/localities/${area.id}`, { method: isNew ? 'POST' : 'PUT', body });
      onSaved(a, isNew);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Add area' : `Edit ${area.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="area-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="area-form" className="stack-sm" onSubmit={save}>
        <div className="form-row">
          <label>
            Area name *
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bharath Nagar" maxLength={80} required autoFocus={isNew} />
          </label>
          <label>
            Pincode
            <input value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" placeholder="502103" />
          </label>
          {franchises && (
            <label>
              Franchise (city) {isNew && '*'}
              <select value={form.franchise_id} onChange={(e) => setForm({ ...form, franchise_id: e.target.value })} required={isNew && franchises.length > 1}>
                <option value="">Choose…</option>
                {franchises.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.city}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="area-kind" role="radiogroup" aria-label="Type of area">
          <button type="button" role="radio" aria-checked={!form.is_village} className={!form.is_village ? 'active' : ''} onClick={() => setForm({ ...form, is_village: false })}>🏙️ Town area</button>
          <button type="button" role="radio" aria-checked={form.is_village} className={form.is_village ? 'active' : ''} onClick={() => setForm({ ...form, is_village: true })}>🏡 Village (within 15 km)</button>
        </div>
        {form.is_village && (
          <div className="village-band">
            <label>How far from town? *
              <select value={form.village_band} onChange={(e) => setForm({ ...form, village_band: e.target.value })} required>
                <option value="">Choose…</option>
                <option value="1">Up to 10 km</option>
                <option value="2">10 – 15 km</option>
              </select>
            </label>
            {hasPin && townCenter && (() => {
              const km = kmBetween(townCenter, form);
              return <small className={km > 15 ? 'danger-text' : 'muted'}>📏 About {km} km from the middle of town (straight line){km > 15 ? ' — more than 15 km: Village Needs is meant for villages within 15 km.' : km > 10 ? ' — suggests 10–15 km.' : ' — suggests up to 10 km.'}</small>;
            })()}
            <small className="muted">Only 🏡 Village Needs delivers to villages (next day, by our own staff). Other shop orders are for town areas.</small>
          </div>
        )}
        <div className="area-pin-row">
          <span className={hasPin ? 'success-text' : 'muted'}>{hasPin ? `📍 ${form.lat}, ${form.lng}` : '👆 Tap the map at the centre of this area'}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={useMyLocation}>📡 Use my location</button>
        </div>
        {gpsMsg && <small className="muted">{gpsMsg}</small>}
        <MapView
          height={300}
          fitKey={hasPin ? 'pin' : 'none'}
          markers={hasPin ? [{ id: 'pin', lat: form.lat, lng: form.lng, emoji: '📍', color: '#4f46e5' }] : []}
          onMapClick={({ lat, lng }) => setForm((f) => ({ ...f, lat, lng }))}
        />
        <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Customers can choose this area" />
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}

// 🏡 The two village delivery charges of this franchise (franchise admin). HQ sees each city's charges.
function VillageFees() {
  const toast = useToast();
  const data = useLoad(() => api('/admin/village-fees'));
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const d = data.data;
  if (!d) return null;
  const mine = d.franchises.length === 1 ? d.franchises[0] : null;
  const f = form || (mine ? { near: String(Number(mine.village_fee_near)), far: String(Number(mine.village_fee_far)) } : null);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/admin/village-fees', { method: 'PUT', body: { near: Number(f.near), far: Number(f.far) } });
      toast('Village delivery charges saved');
      setForm(null);
      data.reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel village-fees">
      <h3>🏡 Village delivery charges</h3>
      <p className="muted small">Customers in villages pay this for each 🏡 Village Needs order (next-day delivery by our own staff).</p>
      {d.can_edit && f ? (
        <form className="form-row" onSubmit={save}>
          <label>Up to 10 km ₹<input type="number" min="0" max="2000" value={f.near} onChange={(e) => setForm({ ...f, near: e.target.value })} required /></label>
          <label>10 – 15 km ₹<input type="number" min="0" max="2000" value={f.far} onChange={(e) => setForm({ ...f, far: e.target.value })} required /></label>
          <button className="btn btn-primary" disabled={busy || !form}>{busy ? 'Saving…' : 'Save'}</button>
        </form>
      ) : (
        <ul className="village-fee-list">
          {d.franchises.map((x) => <li key={x.id}><b>{x.city}</b>: up to 10 km ₹{Number(x.village_fee_near)} · 10–15 km ₹{Number(x.village_fee_far)}</li>)}
          {!d.can_edit && <li className="muted small">Set by each city's franchise admin.</li>}
        </ul>
      )}
    </section>
  );
}
