import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { api, formatEta, formatPrice, priceTalk } from '../api.js';
import PartnerNote from '../components/PartnerNote.jsx';
import SmartImage from '../components/SmartImage.jsx';
import { windowLabel } from '../qty.js';
import Skeleton from '../components/Skeleton.jsx';

export default function Category() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api(`/categories/${slug}`).then(setData).catch((e) => setError(e.message));
  }, [slug]);

  const services = useMemo(
    () => (data?.services || []).filter((s) => s.name.toLowerCase().includes(search.toLowerCase())),
    [data, search]
  );

  if (slug === 'share-ride') return <Navigate to="/share-ride" replace />; // 🚗 search + seat booking page
  if (slug === 'daily-workers') return <Navigate to="/workers" replace />; // 👷 free workers list
  if (slug === 'digital-services') return <Navigate to="/digital" replace />; // 💡 requests to our team
  if (error) return <div className="alert">{error} — <Link to="/">back home</Link></div>;
  if (!data) return <Skeleton variant="grid" />;
  // a category with just one shop (🏡 Village Needs) opens that shop straight away
  const only = data.services.length === 1 ? data.services[0] : null;
  if (only && (only.product_count > 0 || only.allows_list) && !only.type_count) return <Navigate to={`/service/${only.slug}`} replace />;

  const { category } = data;
  return (
    <>
      <Link to="/" className="back-link">← All categories</Link>
      <section className="category-header" style={{ '--accent': category.color }}>
        <span className="category-header-icon">{category.icon}</span>
        <div>
          <h1>{category.name}</h1>
          <p>{category.description}</p>
        </div>
        <input className="search" placeholder="Search services…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </section>
      {data.services.some(priceTalk) && <PartnerNote />}
      {category.slug === 'shop-for-me' && (
        <p className="market-note">🛠️ Small things from town shops. Write what you need (or send a photo) — a delivery partner buys it and brings it. <b>Up to 3 items per order · ₹50 delivery</b> · you pay as per the shop bill.</p>
      )}

      <div className="service-grid">
        {services.map((s) => (
          <article key={s.id} className={`service-card ${s.is_featured ? 'service-featured' : ''}`} style={{ '--accent': category.color }}>
            <div className="service-img">
              <SmartImage src={s.image_url} alt={s.name} credit={s.image_credit} fallbackIcon={category.icon} color={category.color} />
              {s.requires_license && <span className="tag">Licensed partner</span>}
              {s.is_featured && <span className="tag tag-featured">⭐ Daily fresh</span>}
            </div>
            <div className="service-body">
              <h3>{s.name}</h3>
              <div className="service-meta">
                <span className="price">{priceTalk(s) ? '💬 Service charge: talk to provider' : s.price_on_bill ? (s.product_count > 0 ? 'Market price' : 'As per shop bill') : formatPrice(s.base_price, s.price_unit)}</span>
                <span className="eta">{s.window_from != null ? `🕕 ${windowLabel(s.window_from, s.window_to)}` : `⏱ ${formatEta(s.eta_minutes)}`}</span>
              </div>
              {s.type_count > 0 ? (
                <Link to={`/care/${s.slug}`} className="btn btn-primary btn-sm btn-center" style={{ '--accent': category.color }}>
                  {`Choose from ${s.type_count} →`}
                </Link>
              ) : s.allows_list && !s.product_count ? (
                <Link to={`/service/${s.slug}`} className="btn btn-primary btn-sm btn-center" style={{ '--accent': category.color }}>
                  {category.slug === 'health' ? '📷 Order with prescription' : 'Write your list →'}
                </Link>
              ) : s.product_count > 0 ? (
                <Link to={`/service/${s.slug}`} className="btn btn-primary btn-sm btn-center" style={{ '--accent': category.color }}>
                  Shop {s.product_count} items →
                </Link>
              ) : (
                <Link to={`/checkout?service=${s.slug}`} className="btn btn-primary btn-sm btn-center" style={{ '--accent': category.color }}>
                  Book now
                </Link>
              )}
            </div>
          </article>
        ))}
        {!services.length && <p className="muted">No services match “{search}”.</p>}
      </div>
    </>
  );
}
