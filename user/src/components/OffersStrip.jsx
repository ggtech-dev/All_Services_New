import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import SmartImage from './SmartImage.jsx';

// 📢 The moving row of ⭐ top offers at the top of the Offers category page (pages/Offers.jsx): poster cards that move
// on by themselves every few seconds (they wait while someone touches or hovers them) and can be swiped.
// Offers are only inside the Offers category — never on other pages.

// each offer counts as "seen" once per visit (for the shop's numbers)
export function markSeen(list) {
  try {
    const seen = new Set(JSON.parse(sessionStorage.getItem('as_offers_seen') || '[]'));
    for (const o of list) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      api(`/offers/${o.id}/tap`, { method: 'POST', body: { kind: 'seen' } }).catch(() => {});
    }
    sessionStorage.setItem('as_offers_seen', JSON.stringify([...seen]));
  } catch { /* storage blocked: not counted */ }
}

export const untilLabel = (d) => `till ${new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;

export default function OffersStrip({ offers, title = '⭐ Top offers' }) {
  const row = useRef(null);
  const paused = useRef(0);
  // move one card on every 4 s; back to the start after the last one
  useEffect(() => {
    if (offers.length < 2) return undefined;
    const t = setInterval(() => {
      const el = row.current;
      if (!el || Date.now() < paused.current || document.hidden) return;
      const card = el.querySelector('.offer-card');
      const step = (card?.getBoundingClientRect().width || 260) + 12;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      el.scrollTo({ left: atEnd ? 0 : el.scrollLeft + step, behavior: 'smooth' });
    }, 4000);
    return () => clearInterval(t);
  }, [offers.length]);
  const hold = () => { paused.current = Date.now() + 8000; };

  if (!offers.length) return null;
  return (
    <section className="offers-top" aria-label={title}>
      <h2>{title}</h2>
      <div className="offer-strip" ref={row} onTouchStart={hold} onMouseEnter={hold} onWheel={hold}>
        {offers.map((o) => (
          <Link key={o.id} to={`/offers/${o.id}`} className="offer-card">
            <span className="offer-img">
              <SmartImage src={o.image_url} alt={o.title} fallbackIcon="📢" color="#f97316" />
              {o.is_top && <span className="offer-top">⭐ Top offer</span>}
            </span>
            <span className="offer-body">
              <b>{o.title}</b>
              <small>{o.shop_name} · {untilLabel(o.ends_on)}</small>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
