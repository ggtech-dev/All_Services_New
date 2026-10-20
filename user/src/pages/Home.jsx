import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import SmartImage from '../components/SmartImage.jsx';
import Promotions from '../components/Promotions.jsx';
import { InstallBanner } from '../components/InstallApp.jsx';
import { windowLabel } from '../qty.js';
import Skeleton from '../components/Skeleton.jsx';
import { useCart } from '../cart.jsx';
import { askConfirm } from '../components/ConfirmDialog.jsx';

export default function Home() {
  const [categories, setCategories] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [instant, setInstant] = useState([]);
  const [cards, setCards] = useState([]);
  const [settings, setSettings] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/instant-services').then(setInstant).catch(() => {});
    api('/home-cards').then(setCards).catch(() => {});
    Promise.all([api('/categories'), api('/settings'), api('/featured-services').catch(() => [])])
      .then(([cats, s, f]) => {
        setCategories(cats);
        setSettings(s);
        setFeatured(f);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      {settings.announcement && <div className="announcement">{settings.announcement}</div>}
      <section className="banner">
        <div>
          <h1>{settings.banner_title || 'What do you need today?'}</h1>
          <p>{settings.banner_subtitle || 'Pick a category to see its services.'}</p>
        </div>
        <div className="banner-meta">
          {settings.service_city && <span>📍 {settings.service_city}</span>}
          {settings.support_phone && <a href={`tel:${settings.support_phone.replace(/\s/g, '')}`}>📞 {settings.support_phone}</a>}
        </div>
      </section>

      {cards.map((s) => <WaterCard key={s.id} service={s} />)}
      {instant.map((s) => <InstantCard key={s.id} service={s} />)}
      <InstallBanner />
      <Promotions />

      {featured.length > 0 && <DailyFresh services={featured} />}

      {error && <div className="alert">{error}</div>}
      {loading ? (
        <Skeleton variant="grid" />
      ) : (
        <div className="category-grid">
          {categories.map((c) => (
            <Link key={c.id} to={`/category/${c.slug}`} className="category-card" style={{ '--accent': c.color }}>
              <div className="category-img">
                <SmartImage src={c.image_url} alt={c.name} credit={c.image_credit} fallbackIcon={c.icon} color={c.color} />
                <span className="category-icon">{c.icon}</span>
              </div>
              <div className="category-body">
                <h3>{c.name}</h3>
                <p>{c.description}</p>
                <span className="category-count">{c.service_count} services →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <p className="home-foot"><Link to="/credits" className="link">📷 Photo credits</Link></p>
    </>
  );
}

// The daily services (fresh vegetables, meat & fish, milk), highlighted above the categories.
function DailyFresh({ services }) {
  return (
    <section className="daily-fresh" aria-labelledby="daily-fresh-title">
      <div className="daily-fresh-head">
        <h2 id="daily-fresh-title">🌅 Daily fresh</h2>
        <span className="muted small">Every morning, from the market to your door</span>
      </div>
      <div className="daily-fresh-grid">
        {services.map((s) => (
          <Link key={s.id} to={s.product_count > 0 ? `/service/${s.slug}` : `/checkout?service=${s.slug}`} className="fresh-card" style={{ '--accent': s.category_color }}>
            <div className="fresh-img">
              <SmartImage src={s.image_url} alt={s.name} credit={s.image_credit} fallbackIcon={s.category_icon} color={s.category_color} />
            </div>
            <div className="fresh-body">
              <h3>{s.name}</h3>
              <div className="fresh-chips">
                {s.window_from != null && <span>🕕 {windowLabel(s.window_from, s.window_to)}</span>}
                {s.price_on_bill ? <span>🧾 Market price</span> : s.price_unit && <span>{s.price_unit}</span>}
              </div>
              <span className="fresh-cta">Order now →</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// 💧 Drinking water cans: ordered right here (choose how many → Order now). Delivered by our own team, as an order
// of its own — so a cart with other items is cleared first (after asking).
function WaterCard({ service }) {
  const cart = useCart();
  const navigate = useNavigate();
  const p = service.products[0];
  const qty = cart.qtyOf(p.id);
  const svc = { id: service.id, name: service.name, category_icon: service.category_icon, price_on_bill: service.price_on_bill };
  const others = cart.items.some((i) => i.service_id !== service.id) || cart.lines.some((l) => l.name.trim()) || !!cart.photo || !!cart.via;
  const more = async () => {
    if (others) {
      const ok = await askConfirm('Water cans are delivered by our own team as a separate order.\n\nClear your cart and order water?', { okText: 'Clear cart and order water', cancelText: 'Keep my cart' });
      if (!ok) return;
      cart.clear();
    }
    cart.add(p, svc);
  };
  return (
    <section className="water-card">
      <div className="water-card-body">
        <span className="water-badge">💧 Our own delivery team</span>
        <h2>{service.name}</h2>
        <p className="water-price"><b>₹{Number(p.price).toLocaleString('en-IN')}</b> per can · <span>delivery included</span></p>
        <div className="water-actions">
          {qty > 0 ? (
            <>
              <div className="stepper water-stepper">
                <button type="button" onClick={() => cart.less(p.id)} aria-label="One can less">−</button>
                <span>{qty} {qty === 1 ? 'can' : 'cans'}</span>
                <button type="button" onClick={more} aria-label="One can more">+</button>
              </div>
              <button type="button" className="btn water-order" onClick={() => navigate('/checkout')}>
                Order now · ₹{(Number(p.price) * qty).toLocaleString('en-IN')} →
              </button>
            </>
          ) : (
            <button type="button" className="btn water-order" onClick={more}>💧 Add water can</button>
          )}
        </div>
      </div>
      <div className="water-card-art" aria-hidden="true">💧</div>
    </section>
  );
}

// ⚡ Instant Delivery: shop the shops, or just write what you need.
function InstantCard({ service }) {
  const sources = (service.source_names || []).map((n) => n.replace(/ Delivery$/, '').replace(/^Fresh /, ''));
  return (
    <section className="instant-card">
      <div className="instant-card-body">
        <span className="instant-badge">⚡ {service.eta_minutes || 15} MIN</span>
        <h2>{service.name}</h2>
        <p>Anything you need at your door in about {service.eta_minutes || 15} minutes{sources.length ? ` — ${sources.join(', ')} or anything else` : ''}.</p>
        <div className="instant-actions">
          <Link to={`/service/${service.slug}`} className="btn instant-shop">🛒 Shop now</Link>
          <Link to={`/service/${service.slug}?tab=others`} className="btn instant-write">✍️ Write what you need</Link>
        </div>
      </div>
      <div className="instant-card-art" aria-hidden="true">⚡</div>
    </section>
  );
}
