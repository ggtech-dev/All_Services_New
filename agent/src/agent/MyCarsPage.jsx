import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../admin/ui.jsx';
import { MyCars } from './ShareRideOwner.jsx';

// 🚙 Car Rental partners: my cars. A customer who chooses a car model (Ertiga, Dzire…) is shown only to partners with
// an approved car of that model — the first to accept takes it. "Any car" bookings come to every car partner.
export default function MyCarsPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api('/cars').then(setData).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="alert">{error}</div>;
  if (!data) return <div className="center-block"><div className="spinner" /></div>;
  const approved = [...new Set(data.cars.filter((c) => c.status === 'approved').map((c) => c.model.replace(/\s*\(.*\)$/, '')))];
  return (
    <div className="stack">
      <h2>🚗 My cars</h2>
      <p className="muted small">
        {approved.length
          ? <>You get Car Rental bookings for <b>{approved.join(', ')}</b> (and for customers who choose “Any car”). The first partner to accept takes the booking — then call the customer and agree the price.</>
          : 'Add your car below. Your franchise admin checks the papers; once approved, you get bookings from customers who choose your car model.'}
      </p>
      <MyCars data={data} reload={load} toast={toast} />
    </div>
  );
}
