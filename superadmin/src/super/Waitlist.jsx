import { useState } from 'react';
import { api } from '../api.js';
import MapView from '../components/MapView.jsx';
import { timeAgo, useLoad, useToast } from '../admin/ui.jsx';

// 📍 Where people want us — "Notify me" requests from places we don't deliver to yet (customer app → location box).
// The map shows our cities and every place people asked from (one pin per ~5 km, with how many people); the list
// below has each person to call when a franchise opens near them. Mark them contacted / started / closed.
const TABS = [['waiting', '🔔 Waiting'], ['contacted', '📞 Contacted'], ['started', '🎉 We started there'], ['closed', 'Closed'], ['all', 'All']];
const mapLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

export default function Waitlist() {
  const [tab, setTab] = useState('waiting');
  const data = useLoad(() => api(`/super/waitlist?status=${tab}`), [tab]);
  const d = data.data;
  if (!d) return data.error ? <div className="alert">{data.error}</div> : <div className="center-block"><div className="spinner" /></div>;
  const markers = [
    ...d.cities.map((c) => ({ id: `c${c.id}`, lat: Number(c.lat), lng: Number(c.lng), emoji: '🏢', color: '#4f46e5', label: `${c.city} — our city (${Number(c.radius_km)} km range)` })),
    ...d.spots.map((s, i) => ({ id: `s${i}`, lat: Number(s.lat), lng: Number(s.lng), emoji: s.people > 9 ? '🔥' : '🔔', color: s.people > 4 ? '#dc2626' : '#ea580c',
      label: `${s.people} ${s.people === 1 ? 'person' : 'people'} · ${Number(s.km)} km from ${s.nearest_city}` })),
  ];
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        People open the app in places we don't deliver to yet and tap <b>Notify me</b>. Each pin is a place (about 5 km);
        the more people, the better that place is for the next franchise.
      </p>
      <div className="stat-row">
        <div className="panel stat"><b>{d.summary.waiting}</b><small>Waiting to hear from us</small></div>
        <div className="panel stat"><b>{d.summary.last_7_days}</b><small>Asked in the last 7 days</small></div>
        <div className="panel stat"><b>{d.summary.places}</b><small>Different places</small></div>
        <div className="panel stat"><b>{d.summary.typed}</b><small>Typed a place name (no GPS)</small></div>
      </div>

      <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <MapView markers={markers} fitKey={`${tab}-${d.spots.length}`} height={380} />
      </section>

      {d.spots.length > 0 && (
        <section className="panel">
          <h3 style={{ marginTop: 0 }}>Top places people asked for</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Place (open in map)</th><th>People</th><th>Times asked</th><th>From our nearest city</th><th>Last asked</th></tr></thead>
              <tbody>
                {d.spots.slice(0, 15).map((s, i) => (
                  <tr key={i}>
                    <td><a href={mapLink(s.lat, s.lng)} target="_blank" rel="noreferrer">📍 {Number(s.lat).toFixed(3)}, {Number(s.lng).toFixed(3)}</a></td>
                    <td><b>{s.people}</b></td>
                    <td>{s.asks}</td>
                    <td>{Number(s.km)} km from {s.nearest_city}</td>
                    <td>{timeAgo(s.last_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="tabs scroll-tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {d.requests.map((r) => <Person key={r.id} r={r} reload={data.reload} />)}
      {!d.requests.length && <p className="muted center-block">No requests here yet.</p>}
    </div>
  );
}

function Person({ r, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const mark = async (status) => {
    setBusy(true);
    try {
      await api(`/super/waitlist/${r.id}`, { method: 'PATCH', body: { status } });
      toast('Saved');
      reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const where = r.lat ? `${Number(r.km_to_nearest)} km from ${r.nearest_city}` : `typed “${r.place_text}”`;
  const wa = `https://wa.me/91${r.phone}?text=${encodeURIComponent(`Hello${r.name ? ` ${r.name}` : ''}, this is All Services. You asked us to let you know when we start near you.`)}`;
  return (
    <section className={`panel waitlist-person status-${r.status}`}>
      <div className="digital-req-head">
        <div>
          <b>{r.name || 'Someone'} · +91 {r.phone}</b>
          <div className="small muted">
            #{r.id} · {where}{r.asked_times > 1 ? ` · asked ${r.asked_times} times` : ''}{r.customer ? ' · has an account' : ''} · {timeAgo(r.updated_at)}
            {r.lat && <> · <a href={mapLink(r.lat, r.lng)} target="_blank" rel="noreferrer">📍 map</a></>}
          </div>
        </div>
        <div className="row-actions">
          <a className="btn btn-primary btn-sm" href={`tel:+91${r.phone}`}>📞 Call</a>
          <a className="btn btn-ghost btn-sm" href={wa} target="_blank" rel="noreferrer">💬 WhatsApp</a>
          <select value={r.status} onChange={(e) => mark(e.target.value)} disabled={busy} aria-label="Status">
            <option value="waiting">🔔 Waiting</option>
            <option value="contacted">📞 Contacted</option>
            <option value="started">🎉 We started there</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>
    </section>
  );
}
