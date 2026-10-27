import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck, ChevronRight, Droplets, RotateCcw, Search, Truck, Wallet, Zap } from 'lucide-react';
import { api } from '../api.js';
import Promotions from '../components/Promotions.jsx';
import SmartImage from '../components/SmartImage.jsx';
import { InstallBanner } from '../components/InstallApp.jsx';
import { useCart } from '../cart.jsx';
import { useAuth } from '../auth.jsx';
import { askConfirm } from '../components/ConfirmDialog.jsx';
import { CategoryIcon } from '../components/icons.jsx';
import { STATUS, statusLabel, usePoll } from '../orderStatus.jsx';

// Short names for the category tiles (the full name stays on the category page).
const SHORT = {
  'food-daily': 'Food & Daily', 'home-services': 'Home Services', 'shop-for-me': 'Shop For Me', 'village-needs': 'Village Needs',
  vehicle: 'Vehicle Services', 'daily-workers': 'Daily Workers', personal: 'Personal Care', events: 'Events',
  'vehicle-rental': 'Car Rental', 'share-ride': 'Share Ride', 'digital-services': 'Digital Services', health: 'Health',
  'book-your-cook': 'Book Your Cook', 'tomorrow-food': 'Order Food for Tomorrow', offers: 'Offers Near You', 'goods-transport': 'Goods Transport',
};
// India time: Good Morning / Afternoon / Evening
const greeting = () => {
  const h = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000).getHours();
  return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
};
// The first name with a capital first letter: "goutham" / "GOUTHAM" → "Goutham"; a name typed in mixed case ("McRae") stays.
const niceName = (full) => {
  const w = (full || '').trim().split(/\s+/)[0];
  if (!w) return '';
  return w === w.toLowerCase() || w === w.toUpperCase() ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w;
};

// Home, top to bottom: greeting + search · 🛵 live order card (while an order is on the way) · free-delivery banner
// (while it applies) · 💧 water + ⚡ instant side by side (our two everyday actions, always in view — not in a slider) ·
// ⭐ our most popular services (photo cards set by HQ) + trust line · 🔁 order again (returning customers) · categories ·
// offers · install note · help footer. Each thing once.
export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [instant, setInstant] = useState([]);
  const [cards, setCards] = useState([]);
  const [popular, setPopular] = useState([]);
  const [settings, setSettings] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [freeLeft, setFreeLeft] = useState(null); // 🎉 free deliveries this mobile number still has
  const [mine, setMine] = useState({ active: [], again: [] }); // 🛵 orders on the way · 🔁 recent orders to repeat

  const loadMine = () => api('/orders/home').then(setMine).catch(() => {});
  useEffect(() => {
    if (!user) return setMine({ active: [], again: [] });
    api('/orders/offer').then((d) => setFreeLeft(d.free_left)).catch(() => {});
    loadMine();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  usePoll(loadMine, 15000, mine.active.length > 0); // the live card follows the order until it is delivered
  useEffect(() => {
    api('/instant-services').then(setInstant).catch(() => {});
    api('/home-cards').then(setCards).catch(() => {});
    api('/home-popular').then(setPopular).catch(() => {});
    Promise.all([api('/categories'), api('/settings')])
      .then(([cats, s]) => {
        setCategories(cats);
        setSettings(s);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const first = niceName(user?.fullName);
  // the free-delivery offer banner is for people who can still use it: hidden once this mobile number had it
  const offerText = /free delivery/i.test(settings.announcement || '');
  const showAnnouncement = settings.announcement && (!offerText || !user || freeLeft > 0);
  const search = (e) => {
    e.preventDefault();
    if (q.trim().length >= 2) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  const water = cards[0];
  const fast = instant[0];

  return (
    <div className="home">
      <section className="home-head">
        <div className="home-hello">
          <h1>{greeting()}{first ? `, ${first}` : ''} 👋</h1>
          <p>{settings.banner_title || 'What do you need today?'}</p>
        </div>
        <form className="home-search" onSubmit={search} role="search">
          <Search size={18} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search water, kirana, plumber, cars…" aria-label="Search" enterKeyHint="search" />
        </form>
      </section>

      {mine.active.length > 0 && <LiveOrders orders={mine.active} />}

      {showAnnouncement && <div className="announcement">{settings.announcement}</div>}

      {(water || fast) && (
        <div className={`quick-actions ${water && fast ? '' : 'single'}`}>
          {water && <WaterCard service={water} />}
          {fast && <InstantCard service={fast} />}
        </div>
      )}

      {popular.length > 0 && <PopularServices cards={popular} />}
      <TrustLine />
      {mine.again.length > 0 && <OrderAgain orders={mine.again} />}

      <section className="home-section">
        <div className="section-head"><h2>Categories</h2></div>
        {error && <div className="alert">{error}</div>}
        {loading ? (
          <div className="cat-grid" aria-busy="true" aria-label="Loading">
            {Array.from({ length: 8 }, (_, i) => <span key={i} className="cat-tile"><span className="cat-icon sk-pulse" style={{ width: 56, height: 56, background: '#e2e8f0' }} /><span className="sk-line" /></span>)}
          </div>
        ) : (
          <div className="cat-grid">
            {categories.map((c) => (
              <Link key={c.id} to={`/category/${c.slug}`} className="cat-tile" title={c.name}>
                <CategoryIcon slug={c.slug} />
                <span>{SHORT[c.slug] || c.name}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Promotions hideFreeDelivery={!!user && !(freeLeft > 0)} />
      <InstallBanner />
      <footer className="home-footer">
        <nav className="home-footer-links" aria-label="About All Services">
          <Link to="/about">About us</Link>
          <Link to="/about#privacy">Privacy</Link>
          <Link to="/about#terms">Terms</Link>
        </nav>
        <small translate="no">© {new Date().getFullYear()} All Services by GGTech</small>
      </footer>
    </div>
  );
}

// The short name of an order ("Water Can (20L)") and what was in it — left out when it only repeats the name
// (a booking's one item is the service itself).
const orderName = (o) => (o.via_name || o.service_name || o.skill_name || '').replace(/^Drinking\s+/i, '');
const orderDetail = (o) => (o.summary && !o.summary.startsWith(o.service_name || '\u0000') ? o.summary : '');

// 🛵 Orders on the way: one slim card each, right under the greeting, until delivered.
function LiveOrders({ orders }) {
  return (
    <section className="live-orders" aria-label="Your orders on the way">
      {orders.map((o) => (
        <Link key={o.id} to={`/orders/${o.id}`} className="live-order" style={{ '--st': STATUS[o.status]?.color || '#4f46e5' }}>
          <span className="live-dot" aria-hidden="true" />
          <span className="live-text">
            <b>{statusLabel(o.status, o.kind)}</b>
            <small>{orderName(o)}{orderDetail(o) && <span translate="no">{` · ${orderDetail(o)}`}</span>}</small>
          </span>
          <span className="live-go">Track <ChevronRight size={16} aria-hidden="true" /></span>
        </Link>
      ))}
    </section>
  );
}

// ✓ Why people can trust us: one quiet line.
function TrustLine() {
  return (
    <ul className="trust-line" aria-label="Why All Services">
      <li><BadgeCheck size={17} aria-hidden="true" /> <span>Verified local providers</span></li>
      <li><Truck size={17} aria-hidden="true" /> <span>Our own local delivery team</span></li>
      <li><Wallet size={17} aria-hidden="true" /> <span>Pay by cash or UPI</span></li>
    </ul>
  );
}

// 🔁 Order again: the last 3 different delivered orders. Shop orders refill the cart (today's prices, only items still
// on sale) and open checkout; bookings and written lists open the same service again.
function OrderAgain({ orders }) {
  const cart = useCart();
  const navigate = useNavigate();
  const repeat = async (o) => {
    if (!o.items?.length) return navigate(`/service/${o.via_slug || o.service_slug}`);
    if (cart.hasContent && !(await askConfirm('Your cart will be replaced with this order.\n\nContinue?', { okText: 'Replace my cart', cancelText: 'Keep my cart' }))) return undefined;
    cart.replaceWith(o.items, o.via_service_id ? { id: o.via_service_id, name: o.via_name, slug: o.via_slug, is_village: o.via_village } : null);
    return navigate('/checkout');
  };
  return (
    <section className="home-section" aria-labelledby="again-title">
      <div className="section-head">
        <h2 id="again-title">Order again</h2>
        <Link to="/orders" className="section-link">All orders <ChevronRight size={15} aria-hidden="true" /></Link>
      </div>
      <div className="again-row">
        {orders.map((o) => (
          <div key={o.id} className="again-card">
            <span className="again-icon" aria-hidden="true">{o.icon || o.skill_icon || '🛍️'}</span>
            <span className="again-text">
              <b>{orderName(o)}</b>
              {orderDetail(o) ? <small translate="no">{orderDetail(o)}</small> : <small>{o.skill_name}</small>}
            </span>
            <button type="button" className="again-btn" onClick={() => repeat(o)}>
              <RotateCcw size={15} aria-hidden="true" /> <span>Order again</span>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// ⭐ Our most popular services: compact photo cards (all in one row on laptop; 2 per row on phones, an odd last card
// wide) — a photo strip with the title
// and short line on white below — that open the shop / service / category.
function PopularServices({ cards }) {
  return (
    <section className="home-section" aria-labelledby="popular-title">
      <div className="section-head"><h2 id="popular-title">Our most popular services</h2></div>
      <div className="pop-grid" style={{ '--pop-n': Math.min(cards.length, 6), '--pop-tab': cards.length > 4 ? 3 : cards.length }}>
        {cards.map((c) => (
          <Link key={c.id} to={c.href} className="pop-card">
            <span className="pop-img"><SmartImage src={c.image_url} alt={c.title} fallbackIcon={c.icon} color={c.color} /></span>
            <span className="pop-body">
              <b>{c.title}</b>
              {c.subtitle && <small>{c.subtitle}</small>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// 💧 Drinking water cans: ordered right here (Add → how many → Order now). Delivered by our own team, as an order
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
  const price = Number(p.price).toLocaleString('en-IN');
  return (
    <section className={`qa-card qa-water ${qty > 0 ? 'has-qty' : ''}`} aria-label={service.name}>
      <div className="qa-top">
        <span className="qa-icon" aria-hidden="true"><Droplets size={22} strokeWidth={2.2} /></span>
        <span className="qa-tag">Our own delivery team</span>
      </div>
      {/* "Drinking Water Can (20L)" → "Water Can (20L)": one line on phones */}
      <h2 className="qa-title">{service.name.replace(/^Drinking\s+/i, '')}</h2>
      <p className="qa-sub"><b>₹{price}</b> <span>per can</span> · <span>delivery included</span></p>
      <div className="qa-actions">
        {qty > 0 ? (
          <>
            <div className="qa-stepper">
              <button type="button" onClick={() => cart.less(p.id)} aria-label="One can less">−</button>
              <span>{qty} {qty === 1 ? 'can' : 'cans'}</span>
              <button type="button" onClick={more} aria-label="One can more">+</button>
            </div>
            <button type="button" className="qa-btn qa-btn-solid" onClick={() => navigate('/checkout')}>
              <span>Order now</span> · ₹{(Number(p.price) * qty).toLocaleString('en-IN')} <ChevronRight size={16} aria-hidden="true" />
            </button>
          </>
        ) : (
          <button type="button" className="qa-btn qa-btn-solid" onClick={more} aria-label="Add water can">Add water can</button>
        )}
      </div>
      <span className="qa-art" aria-hidden="true"><Droplets size={110} strokeWidth={1.3} /></span>
    </section>
  );
}

// ⚡ Instant Delivery: shop the shops, or just write what you need (the write button shows when there is room).
function InstantCard({ service }) {
  const eta = service.eta_minutes || 10;
  return (
    <section className="qa-card qa-instant" aria-label={service.name}>
      <div className="qa-top">
        <span className="qa-icon" aria-hidden="true"><Zap size={22} strokeWidth={2.2} /></span>
        <span className="qa-tag">{eta} MIN</span>
      </div>
      <h2 className="qa-title">{service.name}</h2>
      <p className="qa-sub"><span>Anything you need at your door in about</span> {eta} min</p>
      <div className="qa-actions">
        <Link to={`/service/${service.slug}`} className="qa-btn qa-btn-solid">Shop now</Link>
        <Link to={`/service/${service.slug}?tab=others`} className="qa-btn qa-btn-ghost qa-wide-only">Write what you need</Link>
      </div>
      <span className="qa-art" aria-hidden="true"><Zap size={110} strokeWidth={1.3} /></span>
    </section>
  );
}
