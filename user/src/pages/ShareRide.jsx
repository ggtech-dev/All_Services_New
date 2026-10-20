import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, apiFile } from '../api.js';
import { useAuth } from '../auth.jsx';
import SeatMap from '../components/SeatMap.jsx';
import Skeleton from '../components/Skeleton.jsx';

// 🚗 Share Ride for customers: search journeys → pick seats → pay the car owner (UPI) or cash at pickup → e-ticket.
// All Services only lists the journeys; the money goes straight to the car owner.

const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const IST = { timeZone: 'Asia/Kolkata' };
const dayTime = (d) => new Date(d).toLocaleString('en-IN', { ...IST, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const timeOnly = (d) => new Date(d).toLocaleTimeString('en-IN', { ...IST, hour: 'numeric', minute: '2-digit', hour12: true });
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const SIZES = [['', 'Any car'], ['4', '4+ seats (sedan)'], ['6', '6+ seats (Ertiga, Innova)'], ['7', '7+ seats'], ['12', '12+ seats (Tempo Traveller)']];

export const POLICY = 'No cancellation and no refund after your payment is confirmed. If the car owner cancels the journey, the owner returns your full amount. All Services only lists the journey — you pay the car owner directly.';

export function PolicyNote() {
  return (
    <div className="partner-note ride-policy" role="note">
      <b>🚫 No cancellation, no refund</b>
      <p>{POLICY}</p>
    </div>
  );
}

// ---------- search ----------
export function ShareRideSearch() {
  const [places, setPlaces] = useState([]);
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem('as_ride_search')) || {};
    } catch {
      return {};
    }
  })();
  const [f, setF] = useState({ from: saved.from || 'Siddipet', to: saved.to || 'Hyderabad', date: todayIST(), passengers: saved.passengers || '1', size: '', max_price: '' });
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    api('/share-ride/places').then(setPlaces).catch(() => {});
  }, []);

  const search = async (e) => {
    e?.preventDefault();
    setError('');
    if (f.from === f.to) return setError('From and To must be different');
    setBusy(true);
    try {
      const q = new URLSearchParams({ from: f.from, to: f.to, date: f.date, passengers: f.passengers, ...(f.size && { size: f.size }), ...(f.max_price && { max_price: f.max_price }) });
      setResults(await api(`/share-ride/search?${q}`));
      try {
        localStorage.setItem('as_ride_search', JSON.stringify({ from: f.from, to: f.to, passengers: f.passengers }));
      } catch {
        /* storage unavailable */
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (places.length) search();
  }, [places.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ride-page">
      <Link to="/" className="back-link">← All categories</Link>
      <section className="ride-hero">
        <div>
          <h1>🚗 Share Ride</h1>
          <p>Book a seat in a car going your way. Choose your seat on the car’s seat map and pay the car owner directly.</p>
        </div>
        <Link to="/share-ride/tickets" className="btn btn-ghost btn-sm ride-tickets-link">🎫 My tickets</Link>
      </section>

      <form className="panel form ride-search" onSubmit={search}>
        <div className="ride-route">
          <label>From
            <select value={f.from} onChange={set('from')}>{places.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
          <button type="button" className="ride-swap" aria-label="Swap From and To" onClick={() => setF({ ...f, from: f.to, to: f.from })}>⇅</button>
          <label>To
            <select value={f.to} onChange={set('to')}>{places.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
        </div>
        <div className="form-row">
          <label>Date<input type="date" min={todayIST()} value={f.date} onChange={set('date')} required /></label>
          <label>Passengers
            <select value={f.passengers} onChange={set('passengers')}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select>
          </label>
        </div>
        <div className="form-row">
          <label>Car type
            <select value={f.size} onChange={set('size')}>{SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label>Max price per seat (optional)<input type="number" min="1" inputMode="numeric" value={f.max_price} onChange={set('max_price')} placeholder="e.g. 400" /></label>
        </div>
        {error && <div className="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Searching…' : '🔍 Search cars'}</button>
      </form>

      {results === null ? <Skeleton variant="list" /> : results.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🚗</div>
          <h2>No cars on this route for that day yet</h2>
          <p className="muted">Try another date, or check again later — car owners add journeys every day.</p>
        </div>
      ) : (
        <div className="ride-results">
          <p className="muted small">{results.length} car{results.length > 1 ? 's' : ''} · {f.from} → {f.to}</p>
          {results.map((r) => (
            <Link key={r.id} to={`/share-ride/ride/${r.id}?n=${f.passengers}`} className="ride-card">
              <div className="ride-time">
                <b>{timeOnly(r.depart_at)}</b>
                <small>{new Date(r.depart_at).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'short' })}</small>
              </div>
              <div className="ride-info">
                <b>{r.model.replace(/\s*\(.*\)$/, '')}{r.color ? ` · ${r.color}` : ''}</b>
                <small className="muted">Pickup: {r.pickup_points.join(', ')}</small>
                <small className="muted">Drop: {r.drop_points.join(', ')}</small>
                <div className="ride-chips">
                  <span className={`ride-chip ${r.seats_left <= 2 ? 'warn' : ''}`}>💺 {r.seats_left} seat{r.seats_left > 1 ? 's' : ''} left</span>
                  {r.allow_cash && <span className="ride-chip">💵 Cash OK</span>}
                  <span className="ride-chip">👤 {r.owner_name}</span>
                </div>
              </div>
              <div className="ride-price">
                <b>{Number(r.min_price) === Number(r.max_price) ? rupees(r.min_price) : `${rupees(r.min_price)}–${rupees(r.max_price)}`}</b>
                <small>per seat</small>
              </div>
            </Link>
          ))}
        </div>
      )}
      <PolicyNote />
    </div>
  );
}

// ---------- pick seats and book ----------
export function RideSeats() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [ride, setRide] = useState(null);
  const [error, setError] = useState('');
  const [seats, setSeats] = useState([]);
  const [names, setNames] = useState({});
  const [form, setForm] = useState({ phone: user?.phone || '', pickup: '', drop: '', pay_mode: '', agree: false });
  const [busy, setBusy] = useState(false);
  const want = Math.min(6, Math.max(1, Number(params.get('n')) || 1));

  const load = () => api(`/share-ride/rides/${id}`).then((r) => {
    setRide(r);
    setForm((f) => ({ ...f, pickup: f.pickup || r.pickup_points[0], drop: f.drop || r.drop_points[r.drop_points.length - 1], pay_mode: f.pay_mode || (r.upi ? 'upi' : 'cash') }));
    setSeats((s) => s.filter((c) => !r.taken.includes(c)));
  }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const byCode = useMemo(() => Object.fromEntries((ride?.seats || []).map((s) => [s.code, s])), [ride]);
  if (error) return <div className="alert">{error} — <Link to="/share-ride">back to search</Link></div>;
  if (!ride) return <Skeleton variant="shop" />;

  const toggle = (code) => {
    setError('');
    if (seats.includes(code)) return setSeats(seats.filter((c) => c !== code));
    if (seats.length >= 6) return setError('You can book up to 6 seats at a time');
    setSeats([...seats, code]);
    if (!names[code]) setNames({ ...names, [code]: seats.length === 0 ? user?.fullName || '' : '' });
  };
  const total = seats.reduce((n, c) => n + Number(byCode[c]?.price || 0), 0);

  const book = async (e) => {
    e.preventDefault();
    setError('');
    if (!user) return navigate('/login', { state: { from: location.pathname + location.search } });
    if (!seats.length) return setError('Tap the seats you want on the seat map');
    if (!form.agree) return setError('Please accept: no cancellation and no refund after payment');
    setBusy(true);
    try {
      const b = await api(`/share-ride/rides/${id}/book`, { method: 'POST', body: {
        passengers: seats.map((s) => ({ seat: s, name: (names[s] || '').trim() })), phone: form.phone, pickup: form.pickup, drop: form.drop,
        pay_mode: form.pay_mode, agree: form.agree,
      } });
      navigate(`/share-ride/booking/${b.id}`, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
      load(); // someone may have taken a seat
    }
  };

  return (
    <form className="ride-page" onSubmit={book}>
      <Link to="/share-ride" className="back-link">← Search</Link>
      <section className="panel ride-head">
        <h1>{ride.from_place} → {ride.to_place}</h1>
        <p><b>{dayTime(ride.depart_at)}</b></p>
        <p className="muted">{ride.model}{ride.color ? ` · ${ride.color}` : ''} · car owner {ride.owner_name}</p>
        {ride.notes && <p className="muted small">📝 {ride.notes}</p>}
      </section>
      {!ride.live ? (
        <div className="alert">{ride.status === 'cancelled' ? `This journey was cancelled by the car owner${ride.cancel_reason ? `: ${ride.cancel_reason}` : ''}.` : 'This journey is not open for booking any more.'}</div>
      ) : (
        <>
          <section className="panel">
            <h3>💺 Choose {want > 1 ? `${want} seats` : 'your seat'}</h3>
            <SeatMap layout={ride.layout} prices={ride.row_prices} taken={ride.taken} blocked={ride.blocked} selected={seats} onToggle={toggle} />
          </section>

          {seats.length > 0 && (
            <section className="panel form">
              <h3>🧑 Passengers</h3>
              {seats.map((s) => (
                <label key={s}>{byCode[s]?.label} · {rupees(byCode[s]?.price)}
                  <input value={names[s] || ''} onChange={(e) => setNames({ ...names, [s]: e.target.value.slice(0, 50) })} placeholder="Passenger name" required />
                </label>
              ))}
              <label>Mobile number<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" required placeholder="10-digit mobile" /></label>
              <div className="form-row">
                <label>Pickup point
                  <select value={form.pickup} onChange={(e) => setForm({ ...form, pickup: e.target.value })}>{ride.pickup_points.map((p) => <option key={p}>{p}</option>)}</select>
                </label>
                <label>Drop point
                  <select value={form.drop} onChange={(e) => setForm({ ...form, drop: e.target.value })}>{ride.drop_points.map((p) => <option key={p}>{p}</option>)}</select>
                </label>
              </div>
              <div className="pay-choice">
                {ride.upi && (
                  <label className="pay-option"><input type="radio" checked={form.pay_mode === 'upi'} onChange={() => setForm({ ...form, pay_mode: 'upi' })} />
                    <b>Pay the car owner by UPI now</b> <span className="muted">— seats are held 15 minutes for you</span></label>
                )}
                {ride.allow_cash && (
                  <label className="pay-option"><input type="radio" checked={form.pay_mode === 'cash'} onChange={() => setForm({ ...form, pay_mode: 'cash' })} />
                    <b>Cash at pickup</b> <span className="muted">— the car owner allows it</span></label>
                )}
              </div>
              <PolicyNote />
              <label className="agree">
                <input type="checkbox" checked={form.agree} onChange={(e) => setForm({ ...form, agree: e.target.checked })} />
                <span>I understand: <b>no cancellation and no refund</b> after payment.</span>
              </label>
            </section>
          )}
          {error && <div className="alert">{error}</div>}
          <div className="ride-book-bar">
            <span>{seats.length ? <><b>{rupees(total)}</b> · {seats.length} seat{seats.length > 1 ? 's' : ''}</> : 'Tap seats to choose'}</span>
            <button className="btn btn-primary" disabled={busy || !seats.length}>{busy ? 'Booking…' : user ? 'Book seats' : 'Log in to book'}</button>
          </div>
        </>
      )}
    </form>
  );
}

// ---------- pay / wait / ticket ----------
const STATUS = {
  held: ['⏳ Waiting for your payment', 'warn'],
  paid: ['🕐 Waiting for the car owner to confirm', 'warn'],
  confirmed: ['✅ Confirmed', 'ok'],
  expired: ['⌛ Seats released — not paid in 15 minutes', 'bad'],
  left: ['Left before paying', 'bad'],
  rejected: ['⚠️ Car owner did not receive the payment', 'bad'],
  cancelled: ['❌ Journey cancelled by the car owner', 'bad'],
};

export function RideBooking() {
  const { id } = useParams();
  const [b, setB] = useState(null);
  const [error, setError] = useState('');
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const load = () => api(`/share-ride/bookings/${id}`).then(setB).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // keep it fresh while waiting (owner confirming, countdown)
  useEffect(() => {
    if (!b || !['held', 'paid'].includes(b.status)) return undefined;
    const t = setInterval(() => (b.status === 'held' ? tick((n) => n + 1) : load()), b.status === 'held' ? 1000 : 10000);
    const t2 = b.status === 'held' ? setInterval(load, 15000) : null;
    return () => {
      clearInterval(t);
      if (t2) clearInterval(t2);
    };
  }, [b?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !b) return <div className="alert">{error}</div>;
  if (!b) return <Skeleton variant="shop" />;
  const [label, tone] = STATUS[b.status] || [b.status, ''];
  const left = b.hold_until ? Math.max(0, Math.floor((new Date(b.hold_until) - Date.now()) / 1000)) : 0;

  const act = async (fn) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const download = () => act(async () => {
    const f = await apiFile(`/share-ride/bookings/${b.id}/ticket.pdf`);
    const a = document.createElement('a');
    a.href = f.url;
    a.download = `${b.code}.pdf`;
    a.click();
  });
  const share = `https://wa.me/?text=${encodeURIComponent(`🚗 Share Ride ticket ${b.code}\n${b.ride.from_place} → ${b.ride.to_place}\n${dayTime(b.ride.depart_at)}\nSeats: ${b.passengers.map((p) => `${p.label} (${p.name})`).join(', ')}\nPickup: ${b.pickup_point}\nCar: ${b.car.model} ${b.car.reg_number}`)}`;

  return (
    <div className="ride-page">
      <Link to="/share-ride/tickets" className="back-link">← My tickets</Link>
      <section className={`panel ride-ticket tone-${tone}`}>
        <div className="ride-ticket-top">
          <span className="ride-code">{b.code}</span>
          <span className={`ride-status ${tone}`}>{label}</span>
        </div>
        <h1>{b.ride.from_place} → {b.ride.to_place}</h1>
        <p><b>{dayTime(b.ride.depart_at)}</b></p>
        <dl className="kv">
          <dt>Seats</dt><dd>{b.passengers.map((p) => `${p.label} — ${p.name}`).join(', ')}</dd>
          <dt>Pickup</dt><dd>{b.pickup_point}</dd>
          <dt>Drop</dt><dd>{b.drop_point}</dd>
          <dt>Car</dt><dd>{b.car.model}{b.status === 'confirmed' ? ` · ${b.car.reg_number}` : ''}</dd>
          <dt>Amount</dt><dd><b>{rupees(b.amount)}</b> · {b.pay_mode === 'cash' ? 'cash at pickup' : 'UPI to the car owner'}</dd>
          {b.owner_phone && <><dt>Car owner</dt><dd>{b.owner_name} · <a href={`tel:+91${b.owner_phone}`}>📞 +91 {b.owner_phone}</a></dd></>}
        </dl>
        {b.status_reason && !['confirmed'].includes(b.status) && <p className="alert">{b.status_reason}</p>}
      </section>

      {b.status === 'held' && b.pay_mode === 'upi' && (
        <section className="panel form ride-pay">
          <h3>💳 Pay {rupees(b.amount)} to the car owner</h3>
          <p className="ride-countdown">Seats held for you: <b>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b></p>
          <p className="muted small">UPI ID: <b>{b.ride.upi_id}</b> · write <b>{b.code}</b> in the note.</p>
          {b.upi_link && <a className="btn btn-primary btn-block" href={b.upi_link}>Pay {rupees(b.amount)} with UPI app</a>}
          {b.upi_qr && <div className="ride-qr" dangerouslySetInnerHTML={{ __html: b.upi_qr }} />}
          <label>After paying, type the UPI reference number (UTR, 12 digits)
            <input value={utr} onChange={(e) => setUtr(e.target.value.slice(0, 30))} inputMode="numeric" placeholder="e.g. 432198765432" />
          </label>
          {error && <div className="alert">{error}</div>}
          <button type="button" className="btn btn-primary" disabled={busy || utr.trim().length < 6}
            onClick={() => act(() => api(`/share-ride/bookings/${b.id}/paid`, { method: 'POST', body: { utr } }))}>✅ I have paid</button>
          <button type="button" className="link-btn danger-text" disabled={busy}
            onClick={() => act(() => api(`/share-ride/bookings/${b.id}/leave`, { method: 'POST' }))}>Not now — free these seats</button>
        </section>
      )}
      {b.status === 'paid' && (
        <section className="panel">
          <p>You paid with UPI reference <b>{b.utr}</b>. The car owner checks it and confirms — usually within a few minutes. You get a notification, and your ticket appears here.</p>
          <PolicyNote />
        </section>
      )}
      {b.status === 'confirmed' && (
        <section className="panel ride-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={download}>⬇️ Download ticket (PDF)</button>
          <a className="btn btn-ghost" href={share} target="_blank" rel="noreferrer">💬 Share on WhatsApp</a>
          {error && <div className="alert">{error}</div>}
          <p className="muted small">Reach <b>{b.pickup_point}</b> 10 minutes before departure and show this ticket.</p>
          <PolicyNote />
        </section>
      )}
      {['expired', 'left', 'rejected'].includes(b.status) && <Link to="/share-ride" className="btn btn-primary">🔍 Search again</Link>}
    </div>
  );
}

// ---------- my tickets ----------
export function MyTickets() {
  const [list, setList] = useState(null);
  useEffect(() => {
    api('/share-ride/bookings').then(setList).catch(() => setList([]));
  }, []);
  if (!list) return <Skeleton variant="list" />;
  return (
    <div className="ride-page">
      <Link to="/share-ride" className="back-link">← Share Ride</Link>
      <h1 className="page-title">🎫 My tickets</h1>
      {!list.length ? (
        <div className="empty-state"><div className="empty-icon">🎫</div><h2>No tickets yet</h2><Link to="/share-ride" className="btn btn-primary">Find a car</Link></div>
      ) : list.map((b) => {
        const [label, tone] = STATUS[b.status] || [b.status, ''];
        return (
          <Link key={b.id} to={`/share-ride/booking/${b.id}`} className="ride-card">
            <div className="ride-time"><b>{timeOnly(b.ride.depart_at)}</b><small>{new Date(b.ride.depart_at).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'short' })}</small></div>
            <div className="ride-info">
              <b>{b.ride.from_place} → {b.ride.to_place}</b>
              <small className="muted">{b.code} · {b.passengers.length} seat{b.passengers.length > 1 ? 's' : ''} · {rupees(b.amount)}</small>
              <span className={`ride-status ${tone}`}>{label}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
