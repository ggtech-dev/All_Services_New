import { useState } from 'react';

// 🤝 For "price on discussion" services (plumber, electrician, mechanic, salon, tuition, events, cars…): we only connect
// the customer to an independent local service provider. The service charge is agreed between them directly.
// One short line by default; "Know more" opens the full explanation (and the legal line).
// kind 'car' (🚗 Vehicle Rental): the same, said for car owners — and that the car photos are examples of each model.
// (each sentence is one text, so the Telugu / Hindi dictionary can translate it whole)
export default function PartnerNote({ compact = false, kind = 'service' }) {
  const [more, setMore] = useState(compact); // checkout (compact): open — the customer is about to book
  const car = kind === 'car';
  return (
    <div className={`partner-note ${compact ? 'compact' : ''} ${more ? 'open' : ''}`} role="note">
      <p className="partner-note-line">
        <span aria-hidden="true">🤝 </span>
        <b>{car ? 'We connect you with local car owners.' : 'We connect you to local service providers.'}</b>{' '}
        <span className="partner-note-key">{car ? 'Price, timing and conditions are agreed directly with them.' : 'Service charges are agreed directly with them.'}</span>{' '}
        <button type="button" className="partner-note-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? 'Show less' : 'Know more'}
        </button>
      </p>
      {more && (
        <>
          {car ? (
            <>
              <p>The car photos are examples of each model — the owner's own car may differ in colour or year.</p>
              <p>After a car owner accepts your booking, you see their car's number and their phone number. Talk to them directly, agree the price, timing and all conditions, and pay them directly.</p>
            </>
          ) : (
            <p>
              After a nearby service provider (plumber, electrician, mechanic…) accepts your booking, you see their phone number. Talk to them directly, agree the service charge and the work, and pay them directly.
            </p>
          )}
          {!compact && (
            <p className="partner-note-legal">
              {car
                ? 'All Services (GG Tech Software Solutions) only connects you with the car owner. We do not set, collect or guarantee the price, and are not responsible for the trip, the car or the agreement between you.'
                : 'All Services (GG Tech Software Solutions) only connects you to the provider. We do not set, collect or guarantee service charges, and are not responsible for rates, bargaining or the work done by providers.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
