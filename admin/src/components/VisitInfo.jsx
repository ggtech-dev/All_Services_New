// 🏠 A Home Doctor Visit booking: the type and when (now / date & time) (+ the patient details the customer wrote).
// Shown to doctor partners before they accept, and on the order page for everyone.
export default function VisitInfo({ visit, type, notes, compact = false }) {
  if (!visit) return null;
  return (
    <div className={`event-info visit-info ${compact ? 'compact' : ''}`}>
      {type && <div className="event-info-row"><span>🩺</span><b>{type}</b></div>}
      <div className="event-info-row">
        <span>{visit.mode === 'now' ? '⚡' : '📅'}</span>
        {visit.mode === 'now' ? <b className="visit-now">{visit.label}</b> : <span>{visit.label}</span>}
      </div>
      {notes && <div className="event-info-row"><span>📝</span><span>{notes}</span></div>}
    </div>
  );
}
