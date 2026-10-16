// 🎉 An event booking's details: type, date & time, guests, what is needed (+ the customer's notes).
// Shown to event partners before they accept, and on the order page for everyone.
export default function EventInfo({ event, notes, compact = false }) {
  if (!event) return null;
  return (
    <div className={`event-info ${compact ? 'compact' : ''}`}>
      <div className="event-info-row"><span>🎉</span><b>{event.event_type}</b></div>
      <div className="event-info-row"><span>📅</span><span>{event.label}</span></div>
      {event.guests && <div className="event-info-row"><span>👥</span><span>{event.guests} <span>guests</span></span></div>}
      {event.details && <div className="event-info-row"><span>📝</span><span>{event.details}</span></div>}
      {notes && notes !== event.details && <div className="event-info-row"><span>💬</span><span>{notes}</span></div>}
    </div>
  );
}
