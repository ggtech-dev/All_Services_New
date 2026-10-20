// 🤝 For "price on discussion" services (plumber, electrician, cleaning, events, cars…): we only pass the booking to an
// independent local partner. The customer and the partner talk and agree the price themselves.
export default function PartnerNote({ compact = false }) {
  return (
    <div className={`partner-note ${compact ? 'compact' : ''}`} role="note">
      <b>🤝 Independent local partners</b>
      <p>
        We only pass your booking to a nearby partner. Once a partner accepts, you see their phone number — call them and
        fix the price and work details directly with them.
      </p>
      {!compact && (
        <p className="partner-note-legal">
          All Services (GG Tech Software Solutions) does not set, collect or guarantee these prices, and is not responsible
          for rates, bargaining or the work done by partners.
        </p>
      )}
    </div>
  );
}
