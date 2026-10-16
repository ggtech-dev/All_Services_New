import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Skeleton from '../components/Skeleton.jsx';

// 🏠 Home Doctor Visit: the customer picks the type (RMP, General Physician, Nurse, BP check…). Each type shows how many
// partners in the customer's city can take it; a type nobody offers yet can't be booked.
export default function CareTypes() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    api(`/services/${slug}/types`).then(setData).catch((e) => setError(e.message));
  }, [slug]);

  if (error) return <div className="alert">{error} — <Link to="/">back home</Link></div>;
  if (!data) return <Skeleton variant="list" />;

  return (
    <div className="care-page" style={{ '--accent': data.category_color }}>
      <Link to={`/category/${data.category_slug}`} className="back-link">← {data.category_name}</Link>
      <section className="panel care-head">
        <h1>🏠 {data.name}</h1>
        <p className="muted">Choose who you need. Only partners for that type get your booking — they call you, and you agree the fee directly with them.</p>
      </section>
      <div className="emergency-note">🚨 <span>{'In a life-threatening emergency, call 108 first.'}</span> <a className="btn btn-sm emergency-call" href="tel:108">📞 108</a></div>

      <div className="care-list">
        {data.types.map((t) => {
          const n = Number(t.available);
          return (
            <article key={t.id} className={`care-card ${n ? '' : 'care-off'}`}>
              <span className="care-icon" aria-hidden="true">{t.icon || data.category_icon}</span>
              <div className="care-body">
                <h3>{t.name}</h3>
                {t.description && <p className="muted small">{t.description}</p>}
                <small className={n ? 'success-text' : 'muted'}>{n ? `✓ ${n} available near you` : 'No partner in your city yet'}</small>
              </div>
              {n ? (
                <Link to={`/checkout?service=${t.slug}`} className="btn btn-primary btn-sm">Book</Link>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" disabled>Book</button>
              )}
            </article>
          );
        })}
        {!data.types.length && <p className="muted">Nothing here in your city yet.</p>}
      </div>
    </div>
  );
}
