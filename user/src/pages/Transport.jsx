import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Bus, Caravan, Car, Tractor, Truck } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useCity } from '../scope.js';
import BackLink from '../components/BackLink.jsx';
import Skeleton from '../components/Skeleton.jsx';

// 🚚 Goods Transportation (transport.sql): goods vehicles of the city — Tata Ace, Bolero pickup, goods auto, DCM,
// tractor, lorry… — added by the franchise admin with the owner's permission. Customers see 2–3 photos of each vehicle
// and call / WhatsApp the owner directly (the number after a free login). We only connect them: the rate and the trip
// are agreed with the owner. A vehicle without photos shows a clean tile of its type.
export const VEHICLE_TYPES = [
  ['ace', 'Tata Ace', Truck, '#0ea5e9'], ['pickup', 'Bolero / Pickup', Truck, '#6366f1'], ['auto', 'Goods Auto', Car, '#f59e0b'],
  ['dcm', 'DCM / Mini Truck', Truck, '#10b981'], ['tempo', 'Tempo / Eicher', Bus, '#8b5cf6'], ['tractor', 'Tractor Trolley', Tractor, '#65a30d'],
  ['lorry', 'Lorry', Truck, '#ef4444'], ['other', 'Other', Caravan, '#64748b'],
];
const typeOf = (k) => VEHICLE_TYPES.find((t) => t[0] === k) || VEHICLE_TYPES[VEHICLE_TYPES.length - 1];
const BODY = { open: 'Open body', closed: 'Closed body', trolley: 'Trolley' };
const REASONS = [['wrong_number', 'Wrong number'], ['not_answering', 'Not answering'], ['bad_experience', 'Bad experience'], ['other', 'Something else']];

export default function Transport() {
  const { user } = useAuth();
  const city = useCity();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const type = params.get('type') || '';
  const [data, setData] = useState(null);
  const [reporting, setReporting] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let live = true;
    setData(null);
    api(`/transport${type ? `?type=${type}` : ''}`).then((d) => live && setData(d)).catch((e) => live && setData({ vehicles: [], counts: {}, error: e.message }));
    return () => { live = false; };
  }, [type, city, user?.id]);

  const contact = async (v, how) => {
    if (!user) return navigate('/login', { state: { from: location.pathname + location.search } });
    const r = await api(`/transport/${v.id}/contact`, { method: 'POST', body: { kind: how } }).catch(() => ({ phone: v.phone }));
    const phone = r.phone || v.phone;
    window.location.href = how === 'call' ? `tel:+91${phone}`
      : `https://wa.me/91${phone}?text=${encodeURIComponent(`Hello ${v.owner_name}, I found your ${v.model} on All Services. I need a goods vehicle.`)}`;
  };
  const counts = data?.counts || {};
  const total = Object.values(counts).reduce((a, b) => a + Number(b), 0);

  return (
    <div className="transport-page">
      <BackLink to="/">Back</BackLink>
      <section className="transport-hero">
        <h1>🚚 Goods Transportation</h1>
        <p>Tata Ace, Bolero pickup, goods auto, DCM, tractor and lorry owners near you — call them directly.</p>
      </section>
      <div className="partner-note transport-note" role="note">
        <b>🤝 We connect you with each other</b>
        <p>All Services connects you with vehicle owners in your city. Talk to the owner directly and agree the rate and the trip with them.</p>
        <p className="partner-note-legal">All Services does not own these vehicles and is not part of the deal. Please check the vehicle and its documents before you load goods.</p>
      </div>

      <div className="offer-types transport-types" role="tablist" aria-label="Vehicle type">
        <button type="button" role="tab" aria-selected={!type} className={!type ? 'active' : ''} onClick={() => setParams({}, { replace: true })}>All{total ? ` · ${total}` : ''}</button>
        {VEHICLE_TYPES.filter(([k]) => counts[k] || k === type).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={type === k} className={type === k ? 'active' : ''} onClick={() => setParams({ type: k }, { replace: true })}>
            {label} · {counts[k] || 0}
          </button>
        ))}
      </div>
      {!user && (
        <div className="workers-login">
          🔒 <span><Link to="/login" state={{ from: location.pathname + location.search }}>Log in free with your mobile number</Link> to see the owners' numbers.</span>
        </div>
      )}
      {msg && <div className="ok-msg">{msg}</div>}

      {!data ? <Skeleton variant="list" /> : data.vehicles.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🚚</div><h3>No vehicles listed here yet</h3><p className="muted">Please check another type, or come back soon.</p></div>
      ) : (
        <div className="vehicle-list">
          {data.vehicles.map((v) => <VehicleCard key={v.id} v={v} user={user} onContact={contact} onReport={() => { setMsg(''); setReporting(v); }} />)}
        </div>
      )}
      {reporting && <ReportBox vehicle={reporting} onClose={() => setReporting(null)} onDone={() => { setReporting(null); setMsg('Thank you — the admin will check it.'); }} />}
    </div>
  );
}

function VehicleCard({ v, user, onContact, onReport }) {
  const [, label, Icon, color] = typeOf(v.vehicle_type);
  const [at, setAt] = useState(0);
  const photos = v.photos || [];
  return (
    <article className={`vehicle-card ${v.is_available ? '' : 'busy'}`}>
      <div className="vehicle-photos" onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
        {photos.length ? photos.map((src, i) => <img key={src} src={src} alt={`${v.model} — photo ${i + 1}`} loading="lazy" />) : (
          <div className="vehicle-tile" style={{ '--c': color }}>
            <Icon size={64} strokeWidth={1.6} aria-hidden="true" />
            <b>{label}</b>
          </div>
        )}
      </div>
      {photos.length > 1 && <div className="vehicle-dots" aria-hidden="true">{photos.map((p, i) => <span key={p} className={i === at ? 'on' : ''} />)}</div>}
      <div className="vehicle-body">
        <div className="vehicle-title">
          <b>{v.model}</b>
          <span className="vehicle-type" style={{ '--c': color }}>{label}</span>
        </div>
        <span className="vehicle-meta">⚖️ {v.capacity} · {BODY[v.body] || v.body}</span>
        <span className="vehicle-meta">👤 {v.owner_name} · 📍 {v.area}</span>
        {v.rate_note && <span className="vehicle-rate">💰 {v.rate_note}</span>}
        <div className="worker-tags">
          {v.verified && <span className="worker-tag ok">✔ Verified</span>}
          {!v.is_available && <span className="worker-tag">⏸ Busy today</span>}
          <span className="worker-tag plate">{v.vehicle_number}</span>
        </div>
        {v.phone && <small className="worker-phone">📱 +91 {v.phone}</small>}
        <div className="vehicle-actions">
          <button type="button" className="btn btn-primary" onClick={() => onContact(v, 'call')}>📞 Call owner</button>
          <button type="button" className="btn btn-ghost wa" onClick={() => onContact(v, 'whatsapp')}>💬 WhatsApp</button>
        </div>
        {user && <button type="button" className="link-btn small vehicle-report" onClick={onReport}>Report a problem</button>}
      </div>
    </article>
  );
}

function ReportBox({ vehicle, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const send = async (e) => {
    e.preventDefault();
    try {
      await api(`/transport/${vehicle.id}/report`, { method: 'POST', body: { reason, note } });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal panel form" onClick={(e) => e.stopPropagation()} onSubmit={send}>
        <h3>Report a problem — {vehicle.model}</h3>
        {REASONS.map(([k, l]) => (
          <label key={k} className="check-line"><input type="radio" name="reason" checked={reason === k} onChange={() => setReason(k)} /> <span>{l}</span></label>
        ))}
        <label>More details (optional)<textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {error && <div className="alert">{error}</div>}
        <div className="form-row">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!reason}>Send</button>
        </div>
      </form>
    </div>
  );
}
