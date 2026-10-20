import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../admin/ui.jsx';
import { usePoll } from '../orderStatus.jsx';
import SeatMap from '../components/SeatMap.jsx';
import { CarFields } from '../pages/AgentApply.jsx';
import { useAskReason } from '../components/AskReason.jsx';
import { askConfirm } from '../components/ConfirmDialog.jsx';

// 🚗 Share Ride for car owners: my cars (approved by the franchise admin), list a journey with my own seat prices,
// check UPI payments ("Payment received"), see passengers, cancel a journey (the owner returns the money).
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const IST = { timeZone: 'Asia/Kolkata' };
const dayTime = (d) => new Date(d).toLocaleString('en-IN', { ...IST, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const CAR_STATUS = { pending: ['⏳ Waiting for approval', 'warn'], approved: ['✅ Approved', 'ok'], rejected: ['❌ Not approved', 'bad'], removed: ['Removed', 'bad'] };
const BOOKING = { held: 'Waiting for passenger to pay', paid: '💰 Check payment', confirmed: '✅ Confirmed', cancelled: 'Cancelled', rejected: 'Not received' };

export default function ShareRideOwner() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('journeys');
  const [askReason, reasonBox] = useAskReason();
  const load = useCallback(() => api('/share-ride/owner').then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);
  usePoll(load, 20000);

  if (error) return <div className="agent-stack"><div className="alert">{error}</div></div>;
  if (!data) return <div className="center-block"><div className="spinner" /></div>;
  const approved = data.cars.filter((c) => c.status === 'approved');
  const waiting = data.bookings.filter((b) => b.status === 'paid');

  const decide = async (b, received) => {
    let reason = '';
    if (!received) {
      reason = await askReason({ title: `Payment not received — ${b.code}?`, text: 'The passenger sees this, and the seats become free again.', required: true, okText: 'Not received' });
      if (!reason) return;
    } else if (!(await askConfirm(`Did you receive ${rupees(b.amount)} with UPI reference ${b.utr}?`, { okText: 'Yes, received', cancelText: 'No' }))) return;
    try {
      await api(`/share-ride/owner/bookings/${b.id}/decide`, { method: 'POST', body: { received, reason } });
      toast(received ? `${b.code} confirmed — ticket sent to the passenger` : `${b.code}: seats released`);
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="agent-stack share-owner">
      {reasonBox}
      <section className={`panel ride-live ${data.hidden_reason ? 'off' : 'on'}`}>
        {data.hidden_reason ? (
          <>
            <b>⚪ Customers cannot see your journeys yet</b>
            <p className="small">{data.hidden_reason}</p>
            {/subscription/i.test(data.hidden_reason) && <Link to="/agent/subscriptions" className="btn btn-sm btn-primary">💳 Subscription</Link>}
          </>
        ) : (
          <>
            <b>🟢 Your journeys are live</b>
            {data.subscription?.paid_until && <p className="small">Subscription active until {new Date(data.subscription.paid_until).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'short', year: 'numeric' })}</p>}
          </>
        )}
      </section>

      {waiting.length > 0 && (
        <section className="panel ride-waiting">
          <h3>💰 Check these payments ({waiting.length})</h3>
          {waiting.map((b) => (
            <div key={b.id} className="ride-pay-row">
              <div>
                <b>{b.code} · {rupees(b.amount)}</b>
                <small>UPI ref <b>{b.utr}</b> · {b.passengers.map((p) => `${p.label} (${p.name})`).join(', ')}</small>
                <small>{b.ride.from_place} → {b.ride.to_place} · {dayTime(b.ride.depart_at)}</small>
              </div>
              <div className="ride-pay-btns">
                <button className="btn btn-sm btn-primary btn-success" onClick={() => decide(b, true)}>✔ Received</button>
                <button className="btn btn-sm btn-ghost danger-text" onClick={() => decide(b, false)}>✖ Not received</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="shop-tabs" role="tablist">
        {[['journeys', '🗓️ Journeys'], ['new', '➕ New'], ['cars', `🚗 Cars (${data.cars.length})`]].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'cars' && <MyCars data={data} reload={load} toast={toast} />}
      {tab === 'new' && (approved.length ? <NewJourney data={data} cars={approved} done={() => { setTab('journeys'); load(); }} toast={toast} />
        : <div className="panel"><p>Your car must be approved by your franchise admin before you can list journeys.</p><button className="btn btn-sm" onClick={() => setTab('cars')}>My cars</button></div>)}
      {tab === 'journeys' && (
        data.rides.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">🗓️</div><h3>No journeys yet</h3>
            <button className="btn btn-primary" onClick={() => setTab('new')}>➕ List a journey</button></div>
        ) : data.rides.map((r) => (
          <Journey key={r.id} ride={r} bookings={data.bookings.filter((b) => b.ride.id === r.id)} decide={decide} askReason={askReason} reload={load} toast={toast} />
        ))
      )}
    </div>
  );
}

function Journey({ ride, bookings, decide, askReason, reload, toast }) {
  const live = bookings.filter((b) => ['held', 'paid', 'confirmed'].includes(b.status));
  const names = Object.fromEntries(live.flatMap((b) => b.passengers.map((p) => [p.seat, p.name])));
  const seatCount = ride.seats.length - ride.blocked.length;
  const booked = live.filter((b) => b.status === 'confirmed').reduce((n, b) => n + b.seats.length, 0);
  const past = new Date(ride.depart_at) < new Date();
  const cancel = async () => {
    const reason = await askReason({ title: 'Cancel this journey?', text: 'Every passenger is told. If they already paid you, you must return their money.', required: true, okText: 'Cancel journey', placeholder: 'e.g. Car breakdown' });
    if (!reason) return;
    try {
      await api(`/share-ride/owner/rides/${ride.id}/cancel`, { method: 'POST', body: { reason } });
      toast('Journey cancelled — passengers are informed');
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <section className={`panel ride-journey ${ride.status === 'cancelled' ? 'cancelled' : ''}`}>
      <div className="ride-journey-head">
        <div>
          <b>{ride.from_place} → {ride.to_place}</b>
          <small>{dayTime(ride.depart_at)} · {ride.model.replace(/\s*\(.*\)$/, '')} {ride.reg_number}</small>
        </div>
        <span className="ride-count">{ride.status === 'cancelled' ? '❌ Cancelled' : `${booked}/${seatCount} booked`}</span>
      </div>
      {ride.status === 'cancelled' && <p className="small muted">Reason: {ride.cancel_reason}</p>}
      <SeatMap layout={ride.layout} prices={ride.row_prices} taken={ride.taken} blocked={ride.blocked} names={names} />
      {live.length > 0 && (
        <ul className="ride-passengers">
          {live.map((b) => (
            <li key={b.id}>
              <div>
                <b>{b.passengers.map((p) => `${p.name} (${p.label})`).join(', ')}</b>
                <small>{b.code} · {rupees(b.amount)} {b.pay_mode === 'cash' ? '· 💵 cash at pickup' : '· UPI'} · pickup {b.pickup_point} → {b.drop_point}</small>
                <small className={`ride-b-${b.status}`}>{BOOKING[b.status]}{b.status === 'paid' ? ` · ref ${b.utr}` : ''}</small>
              </div>
              <div className="ride-pay-btns">
                {b.contact_phone_shown || b.contact_phone ? <a className="btn btn-sm btn-ghost" href={`tel:+91${b.contact_phone}`}>📞</a> : null}
                {b.status === 'paid' && <button className="btn btn-sm btn-primary btn-success" onClick={() => decide(b, true)}>✔</button>}
                {b.status === 'paid' && <button className="btn btn-sm btn-ghost danger-text" onClick={() => decide(b, false)}>✖</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {ride.status === 'open' && !past && <button className="link-btn danger-text" onClick={cancel}>✖ Cancel this journey</button>}
    </section>
  );
}

function NewJourney({ data, cars, done, toast }) {
  const last = data.last || {};
  const [places, setPlaces] = useState([]);
  const tomorrow = new Date(Date.now() + 330 * 60000 + 864e5).toISOString().slice(0, 10);
  const [f, setF] = useState({
    car_id: String(last.car_id && cars.some((c) => c.id === last.car_id) ? last.car_id : cars[0].id),
    from: last.from_place || 'Siddipet', to: last.to_place || 'Hyderabad', date: tomorrow, time: '06:30',
    pickups: (last.pickup_points || []).join('\n'), drops: (last.drop_points || []).join('\n'),
    upi_id: last.upi_id || '', allow_cash: last.allow_cash ?? true, notes: '',
  });
  const car = cars.find((c) => String(c.id) === f.car_id);
  const rows = car?.layout || [];
  const [prices, setPrices] = useState(() => (last.car_id === car?.id && last.row_prices ? last.row_prices.map(String) : rows.map(() => '')));
  const [blocked, setBlocked] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/share-ride/places').then(setPlaces).catch(() => {});
  }, []);
  // another car → its rows and seats
  const carKey = car?.id;
  useEffect(() => {
    setBlocked([]);
    setPrices((p) => rows.map((_, i) => p[i] || ''));
  }, [carKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const seatRows = useMemo(() => rows.map((r, i) => ({ ...r, i, seats: [...r.cells].filter((c) => c === 'S').length })), [rows]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const depart = new Date(`${f.date}T${f.time}:00+05:30`);
    setBusy(true);
    try {
      await api('/share-ride/owner/rides', { method: 'POST', body: {
        car_id: Number(f.car_id), from: f.from, to: f.to, depart_at: depart.toISOString(),
        pickups: f.pickups.split('\n').map((x) => x.trim()).filter(Boolean), drops: f.drops.split('\n').map((x) => x.trim()).filter(Boolean),
        prices: seatRows.map((r) => (r.seats ? Number(prices[r.i]) || null : 0)), blocked, upi_id: f.upi_id.trim(), allow_cash: f.allow_cash, notes: f.notes,
      } });
      toast('Journey listed ✅');
      done();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <h3>➕ List a journey</h3>
      <label>Car
        <select value={f.car_id} onChange={set('car_id')}>{cars.map((c) => <option key={c.id} value={c.id}>{c.model.replace(/\s*\(.*\)$/, '')} · {c.reg_number}</option>)}</select>
      </label>
      <div className="form-row">
        <label>From<select value={f.from} onChange={set('from')}>{places.map((p) => <option key={p}>{p}</option>)}</select></label>
        <label>To<select value={f.to} onChange={set('to')}>{places.map((p) => <option key={p}>{p}</option>)}</select></label>
      </div>
      <div className="form-row">
        <label>Date<input type="date" value={f.date} min={new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)} onChange={set('date')} required /></label>
        <label>Departure time<input type="time" value={f.time} onChange={set('time')} required /></label>
      </div>
      <div className="form-row">
        <label>Pickup points (one per line)<textarea rows={3} value={f.pickups} onChange={set('pickups')} placeholder={'Old bus stand\nPonnala X roads'} required /></label>
        <label>Drop points (one per line)<textarea rows={3} value={f.drops} onChange={set('drops')} placeholder={'JBS\nAmeerpet'} required /></label>
      </div>
      <fieldset>
        <legend>Price per seat (your price)</legend>
        <div className="form-row">
          {seatRows.filter((r) => r.seats).map((r) => (
            <label key={r.i}>{r.name} ({r.seats} seat{r.seats > 1 ? 's' : ''}) ₹
              <input type="number" min="1" max="10000" inputMode="numeric" value={prices[r.i] || ''} required
                onChange={(e) => setPrices(prices.map((p, i) => (i === r.i ? e.target.value : p)))} placeholder="e.g. 300" />
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Seats not for sale (optional)</legend>
        <small className="muted">Tap a seat to keep it for yourself or family. Tap again to sell it.</small>
        <SeatMap layout={rows} prices={prices} selected={blocked} blockMode onToggle={(c) => setBlocked(blocked.includes(c) ? blocked.filter((x) => x !== c) : [...blocked, c])} />
      </fieldset>
      <label>Your UPI ID (passengers pay you directly)<input value={f.upi_id} onChange={set('upi_id')} placeholder="yourname@okaxis" /></label>
      <label className="check-line"><input type="checkbox" checked={f.allow_cash} onChange={set('allow_cash')} /><span>Allow <b>cash at pickup</b> (booking is confirmed at once)</span></label>
      <label>Note for passengers (optional)<input value={f.notes} onChange={set('notes')} maxLength={300} placeholder="e.g. AC car, 1 bag per person" /></label>
      <p className="muted small">🚫 Passengers cannot cancel after paying. If <b>you</b> cancel the journey, you must return their money.</p>
      {error && <div className="alert">{error}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Listing…' : 'List this journey'}</button>
    </form>
  );
}

function MyCars({ data, reload, toast }) {
  const [adding, setAdding] = useState(false);
  const [car, setCar] = useState({ car_model_id: '', reg_number: '', car_color: '', yellow_board: false });
  const [files, setFiles] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const fd = new FormData();
    Object.entries(car).forEach(([k, v]) => fd.append(k, String(v)));
    Object.entries(files).forEach(([k, v]) => v && fd.append(k, v));
    setBusy(true);
    try {
      await api('/share-ride/owner/cars', { method: 'POST', body: fd });
      toast('Car sent for approval');
      setAdding(false);
      setCar({ car_model_id: '', reg_number: '', car_color: '', yellow_board: false });
      setFiles({});
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {data.cars.map((c) => {
        const [label, tone] = CAR_STATUS[c.status] || [c.status, ''];
        return (
          <section key={c.id} className="panel ride-car">
            <div>
              <b>{c.model}</b>
              <small>{c.reg_number}{c.color ? ` · ${c.color}` : ''}</small>
              {c.status_reason && <small className="danger-text">{c.status_reason}</small>}
            </div>
            <span className={`ride-status ${tone}`}>{label}</span>
          </section>
        );
      })}
      {adding ? (
        <form className="panel form agent-form" onSubmit={submit}>
          <CarFields car={car} setCar={setCar} files={files} setFiles={setFiles} legend="Add a car" />
          {error && <div className="alert">{error}</div>}
          <div className="form-row">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send for approval'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      ) : <button className="btn btn-ghost" onClick={() => setAdding(true)}>➕ Add another car</button>}
    </>
  );
}
