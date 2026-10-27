import { useState } from 'react';
import { api } from '../api.js';

const seatLabel = (s) => (s <= 4 ? '4-seater' : s <= 8 ? '6–7 seater' : '12-seater');

// 🚗 Car rental booking: the car that is coming (model, number, colour — once a partner accepted), or, while nobody has
// taken a booking for one model for 10 minutes, "No Ertiga free? Ask all 6–7 seater cars".
export default function TripCar({ order, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = order.trip_details;
  if (!t) return null;
  const car = order.trip_car;
  if (car && order.status !== 'placed' && order.status !== 'cancelled') {
    return (
      <section className="panel trip-car">
        <div className="trip-car-img">{car.image_url ? <img src={car.image_url} alt="" /> : <span aria-hidden="true">🚗</span>}</div>
        <div>
          <small className="muted">🚗 Your car</small>
          <div><b>{car.model}</b>{car.seats ? <span className="muted"> · {car.seats} seats</span> : null}{car.color ? <span className="muted"> · {car.color}</span> : null}</div>
          <span className="plate" translate="no">{car.reg_number}</span>
        </div>
      </section>
    );
  }
  const waited = (Date.now() - new Date(order.created_at).getTime()) / 60000;
  if (order.status !== 'placed' || !t.car_model_id || t.any_size || waited < 10) return null;
  const ask = async () => {
    setError('');
    setBusy(true);
    try {
      onChanged(await api(`/orders/${order.id}/any-car`, { method: 'POST' }));
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <p style={{ margin: 0 }}>No <b>{t.car_type}</b> partner has accepted yet.</p>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={ask} style={{ marginTop: 8 }}>
        🚗 Ask all {seatLabel(Number(t.car_seats) || 4)} cars
      </button>
      {error && <div className="alert">{error}</div>}
    </section>
  );
}
