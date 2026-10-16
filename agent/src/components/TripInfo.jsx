// 🚗 A car booking's details: trip type, where to, date & time, return, car, passengers (+ the customer's notes).
// Shown to car partners before they accept, and on the order page for everyone.
export default function TripInfo({ trip, notes, pickup, compact = false }) {
  if (!trip) return null;
  return (
    <div className={`event-info trip-info ${compact ? 'compact' : ''}`}>
      <div className="event-info-row"><span>🚗</span><b>{trip.trip_type}</b></div>
      {pickup && <div className="event-info-row"><span>🟢</span><span><span>From</span>: {pickup}</span></div>}
      <div className="event-info-row"><span>📍</span><span><span>To</span>: {trip.drop}</span></div>
      <div className="event-info-row"><span>📅</span><span>{trip.label}</span></div>
      {trip.return_label && <div className="event-info-row"><span>↩️</span><span><span>Return</span>: {trip.return_label}</span></div>}
      <div className="event-info-row"><span>🚘</span><span>{trip.car_type}{trip.passengers ? <> · {trip.passengers} <span>passengers</span></> : null}</span></div>
      {trip.details && <div className="event-info-row"><span>📝</span><span>{trip.details}</span></div>}
      {notes && notes !== trip.details && <div className="event-info-row"><span>💬</span><span>{notes}</span></div>}
    </div>
  );
}
