import { useState } from 'react';

// 🤝 For "price on discussion" services (plumber, electrician, mechanic, salon, tuition, events, cars…): we only connect
// the customer to an independent local service provider. The service charge is agreed between them directly.
// One short line by default; "Know more" opens the full explanation (and the legal line).
// (each sentence is one text, so the Telugu / Hindi dictionary can translate it whole)
export default function PartnerNote({ compact = false }) {
  const [more, setMore] = useState(compact); // checkout (compact): open — the customer is about to book
  return (
    <div className={`partner-note ${compact ? 'compact' : ''} ${more ? 'open' : ''}`} role="note">
      <p className="partner-note-line">
        <span aria-hidden="true">🤝 </span>
        <b>We connect you to local service providers.</b>{' '}
        <span className="partner-note-key">Service charges are agreed directly with them.</span>{' '}
        <button type="button" className="partner-note-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? 'Show less' : 'Know more'}
        </button>
      </p>
      {more && (
        <>
          <p>
            After a nearby service provider (plumber, electrician, mechanic…) accepts your booking, you see their phone number. Talk to them directly, agree the service charge and the work, and pay them directly.
          </p>
          {!compact && (
            <p className="partner-note-legal">
              All Services (GG Tech Software Solutions) only connects you to the provider. We do not set, collect or guarantee service charges, and are not responsible for rates, bargaining or the work done by providers.
            </p>
          )}
        </>
      )}
    </div>
  );
}
