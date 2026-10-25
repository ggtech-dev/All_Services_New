import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useCity } from '../scope.js';
import { shrinkPhoto, dataUrlToFile } from '../photos.js';
import BackLink from '../components/BackLink.jsx';
import LazyMap from '../components/LazyMap.jsx';
import PhotoPicker from '../components/PhotoPicker.jsx';
import Skeleton from '../components/Skeleton.jsx';
import SmartImage from '../components/SmartImage.jsx';
import { askConfirm } from '../components/ConfirmDialog.jsx';
import OffersStrip, { markSeen, untilLabel } from '../components/OffersStrip.jsx';

// 📢 Offers near you (offers.sql): local shops' offers in the customer's city.
//   /offers           the Offers category: ⭐ top offers moving on top, then all live offers, filter by what the shop sells,
//                     "Advertise your shop" (offers show only here, not on other pages)
//   /offers/:id       the offer: poster, details, address & map, Call · WhatsApp · Directions (each tap is counted)
//   /advertise        a shop asks to show its offer → HQ calls them, takes the payment and puts it live
//   /my-offers        the shop's own offers: waiting / live / ended, with how many people saw and called
export const OFFER_TYPES = [
  ['mobiles', '📱', 'Mobiles'], ['jewellery', '💍', 'Jewellery'], ['clothing', '👗', 'Clothing'], ['food', '🍛', 'Food & Grocery'],
  ['electronics', '📺', 'Electronics'], ['beauty', '💄', 'Beauty'], ['others', '🏪', 'Others'],
];
const typeOf = (k) => OFFER_TYPES.find((t) => t[0] === k) || OFFER_TYPES[OFFER_TYPES.length - 1];
const dayLabel = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const tap = (id, kind) => api(`/offers/${id}/tap`, { method: 'POST', body: { kind } }).catch(() => {});

export function OffersPage() {
  const city = useCity();
  const [params, setParams] = useSearchParams();
  const cat = params.get('type') || '';
  const [offers, setOffers] = useState(null);
  useEffect(() => {
    let live = true;
    setOffers(null);
    api(`/offers${cat ? `?category=${cat}` : ''}`).then((l) => { if (live) { setOffers(l); markSeen(l); } }).catch(() => live && setOffers([]));
    return () => { live = false; };
  }, [cat, city]);

  return (
    <div className="offers-page">
      <BackLink to="/">Back</BackLink>
      <section className="offers-hero">
        <div>
          <h1>📢 Offers near you</h1>
          <p>Deals from shops in your city — call them, chat on WhatsApp or get directions.</p>
        </div>
        <Link to="/advertise" className="btn offers-hero-btn">📣 Advertise your shop</Link>
      </section>
      <div className="offer-types" role="tablist" aria-label="What the shop sells">
        <button type="button" role="tab" aria-selected={!cat} className={!cat ? 'active' : ''} onClick={() => setParams({}, { replace: true })}>All</button>
        {OFFER_TYPES.map(([k, icon, label]) => (
          <button key={k} type="button" role="tab" aria-selected={cat === k} className={cat === k ? 'active' : ''} onClick={() => setParams({ type: k }, { replace: true })}>{icon} {label}</button>
        ))}
      </div>
      {!cat && offers?.length > 0 && <OffersStrip offers={offers.some((o) => o.is_top) ? offers.filter((o) => o.is_top) : offers.slice(0, 6)} title={offers.some((o) => o.is_top) ? '⭐ Top offers' : '🔥 New offers'} />}
      {offers?.length > 0 && <h2 className="offers-all-title">{cat ? typeOf(cat)[1] + ' ' + typeOf(cat)[2] : 'All offers'} · {offers.length}</h2>}
      {!offers ? <Skeleton variant="grid" /> : offers.length ? (
        <div className="offer-grid">
          {offers.map((o) => (
            <Link key={o.id} to={`/offers/${o.id}`} className="offer-card">
              <span className="offer-img">
                <SmartImage src={o.image_url} alt={o.title} fallbackIcon={typeOf(o.category)[1]} color="#f97316" />
                {o.is_top && <span className="offer-top">⭐ Top offer</span>}
              </span>
              <span className="offer-body">
                <b>{o.title}</b>
                <small>{typeOf(o.category)[1]} {o.shop_name} · {untilLabel(o.ends_on)}</small>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="offers-empty">
          <span>🏪</span>
          <b>{cat ? `No ${typeOf(cat)[2].toLowerCase()} offers right now` : 'No offers in your city yet'}</b>
          <p className="muted">Own a shop? Be the first — your offer shows here for everyone in your city.</p>
          <Link to="/advertise" className="btn btn-primary">📣 Advertise your shop</Link>
        </div>
      )}
    </div>
  );
}

export function OfferDetail() {
  const { id } = useParams();
  const [o, setO] = useState(null);
  const [error, setError] = useState('');
  const [big, setBig] = useState(false);
  useEffect(() => {
    api(`/offers/${id}`).then((d) => { setO(d); tap(d.id, 'open'); }).catch((e) => setError(e.message));
  }, [id]);
  if (error) {
    return (
      <div className="offers-page">
        <BackLink to="/offers">All offers</BackLink>
        <div className="offers-empty"><span>⌛</span><b>{error}</b><Link to="/offers" className="btn btn-primary">See other offers</Link></div>
      </div>
    );
  }
  if (!o) return <Skeleton variant="shop" />;
  const hasPin = o.lat != null && o.lng != null;
  const dirUrl = hasPin ? `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.shop_name}, ${o.address}`)}`;
  const waText = encodeURIComponent(`Hi ${o.shop_name}, I saw your offer "${o.title}" on All Services. Is it available?`);
  const share = async () => {
    const data = { title: o.title, text: `${o.title} — ${o.shop_name}`, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else await navigator.clipboard.writeText(data.url);
    } catch { /* closed */ }
  };
  return (
    <div className="offers-page offer-detail">
      <BackLink to="/offers">All offers</BackLink>
      <button type="button" className="offer-poster" onClick={() => setBig(true)} aria-label="Open the poster">
        <SmartImage src={o.image_url} alt={o.title} fallbackIcon={typeOf(o.category)[1]} color="#f97316" />
      </button>
      {big && (
        <div className="meal-photo-big" role="dialog" aria-label="Poster" onClick={() => setBig(false)}>
          <img src={o.image_url} alt={o.title} />
          <button type="button" aria-label="Close">✕</button>
        </div>
      )}
      <section className="panel offer-info">
        <span className="offer-type">{typeOf(o.category)[1]} {typeOf(o.category)[2]}{o.is_top && ' · ⭐ Top offer'}</span>
        <h1>{o.title}</h1>
        <h2>{o.shop_name}</h2>
        {o.details && <p>{o.details}</p>}
        <p className="offer-valid">🗓️ Valid {dayLabel(o.starts_on)} – {dayLabel(o.ends_on)}</p>
        <p className="offer-address">📍 {o.address}</p>
        {hasPin && <LazyMap height={200} fitKey={`offer-${o.id}`} markers={[{ id: 'shop', lat: Number(o.lat), lng: Number(o.lng), emoji: '🏪', color: '#f97316', label: o.shop_name }]} />}
        <button type="button" className="link-btn" onClick={share}>🔗 Share this offer</button>
      </section>
      <p className="muted small offer-note">Offers are given by the shop. Please check the details with the shop before you buy.</p>
      <div className="cart-bar-space" aria-hidden="true" />
      <div className="offer-actions">
        <a href={`tel:+91${o.phone}`} onClick={() => tap(o.id, 'call')} className="offer-act call">📞 Call</a>
        <a href={`https://wa.me/91${o.phone}?text=${waText}`} target="_blank" rel="noreferrer" onClick={() => tap(o.id, 'whatsapp')} className="offer-act wa">💬 WhatsApp</a>
        <a href={dirUrl} target="_blank" rel="noreferrer" onClick={() => tap(o.id, 'directions')} className="offer-act dir">📍 Directions</a>
      </div>
    </div>
  );
}

// ---------- 📣 a shop asks to show its offer ----------
export function AdvertisePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const city = useCity();
  const [plans, setPlans] = useState(null);
  const [form, setForm] = useState({ shop_name: '', owner_name: user?.fullName || '', phone: (user?.phone || '').replace(/\D/g, '').slice(-10), category: '', title: '', details: '', address: '', plan: 'month', starts_on: '' });
  const [photo, setPhoto] = useState(null);
  const [pin, setPin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  useEffect(() => { api('/offers/plans').then(setPlans).catch(() => {}); }, [city]);
  useEffect(() => { if (!user) navigate('/login', { replace: true, state: { from: location.pathname } }); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const locate = () => navigator.geolocation?.getCurrentPosition(
    (p) => setPin({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }),
    () => setError('Could not get your location — the address is enough.'), { enableHighAccuracy: true, timeout: 10000 });

  const send = async (e) => {
    e.preventDefault();
    setError('');
    if (!photo) return setError('Add a photo or poster of your offer');
    if (!form.category) return setError('Choose what your shop sells');
    setBusy(true);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ ...form, starts_on: form.starts_on || today, ...(pin || {}) })) fd.append(k, v);
      const small = await shrinkPhoto(photo, 1920, 0.88).catch(() => null); // full HD is enough for every phone
      fd.append('image', small ? dataUrlToFile(small, 'offer.jpg') : photo);
      const r = await api('/offers/request', { method: 'POST', body: fd });
      setDone(r);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="offers-page">
        <section className="panel offers-done">
          <span>🎉</span>
          <h1>Request sent!</h1>
          <p>Our team will call you on <b>{done.phone}</b> soon to confirm your offer{Number(done.price) > 0 ? ' and the payment' : ''}. After that it shows to customers in your city.</p>
          {done.free_launch && <p className="ok-msg">🎁 Your first offer is FREE.</p>}
          <div className="offers-done-btns">
            <Link to="/my-offers" className="btn btn-primary">My shop offers</Link>
            <Link to="/offers" className="btn btn-ghost">See all offers</Link>
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className="offers-page">
      <BackLink to="/offers">Offers</BackLink>
      <section className="offers-hero advertise">
        <div>
          <h1>📣 Advertise your shop</h1>
          <p>Show your offer to customers in your city in the Offers Near You category.</p>
        </div>
      </section>
      <ol className="advertise-steps">
        <li><b>1</b>Fill in your offer and add a poster or photo</li>
        <li><b>2</b>Our team calls you to confirm and take the payment</li>
        <li><b>3</b>Your offer goes live — see how many people call you</li>
      </ol>
      <form className="panel form advertise-form" onSubmit={send}>
        {error && <div className="alert">{error}</div>}
        <h3>Your shop</h3>
        <label>Shop name *<input value={form.shop_name} onChange={set('shop_name')} maxLength={80} required placeholder="e.g. Sri Lakshmi Mobiles" /></label>
        <div className="form-row">
          <label>Your name<input value={form.owner_name} onChange={set('owner_name')} maxLength={80} /></label>
          <label>Shop mobile number *<input value={form.phone} onChange={set('phone')} inputMode="numeric" maxLength={10} required placeholder="10-digit number" /></label>
        </div>
        <span className="field-label">What does your shop sell? *</span>
        <div className="offer-types pick">
          {OFFER_TYPES.map(([k, icon, label]) => (
            <button key={k} type="button" className={form.category === k ? 'active' : ''} onClick={() => setForm({ ...form, category: k })}>{icon} {label}</button>
          ))}
        </div>
        <label>Shop address *<input value={form.address} onChange={set('address')} maxLength={200} required placeholder="e.g. Main Road, near Old Bus Stand" /></label>
        <button type="button" className="link-btn" onClick={locate}>{pin ? '✅ Shop location added (for directions)' : '📍 I am at the shop — add its location for directions'}</button>

        <h3>Your offer</h3>
        <label>Offer in a few words *<input value={form.title} onChange={set('title')} maxLength={80} required placeholder="e.g. 20% off on all smartphones" /></label>
        <label>Details (optional)<textarea rows={3} value={form.details} onChange={set('details')} maxLength={600} placeholder="Which items, conditions, free gifts…" /></label>
        <PhotoPicker label="Poster or photo of the offer *" file={photo} onFile={setPhoto} cameraFirst={false} />
        <p className="muted small" style={{ margin: 0 }}>Best: a landscape (wide) poster, like a YouTube banner — 1920 × 1080. Big clear text, your shop name and phone.</p>
        <label>Start from<input type="date" min={today} value={form.starts_on || today} onChange={set('starts_on')} /></label>

        <h3>Choose a plan</h3>
        {plans?.free_first && <p className="ok-msg">🎁 Launch offer: your shop's first offer is FREE.</p>}
        <div className="plan-grid">
          {(plans?.plans || []).map((p) => (
            <button key={p.code} type="button" className={`plan-card ${form.plan === p.code ? 'active' : ''} ${p.is_top ? 'top' : ''}`} onClick={() => setForm({ ...form, plan: p.code })}>
              <b>{p.name}</b>
              <span className="plan-price">₹{Number(p.price).toLocaleString('en-IN')}</span>
              <small>{p.is_top ? 'Shown first, in the moving Top offers' : `${p.days} days in Offers near you`}</small>
            </button>
          ))}
        </div>
        <p className="muted small">You pay our team after they call you (cash or UPI). No payment in the app.</p>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : '📣 Send my offer'}</button>
      </form>
    </div>
  );
}

// ---------- the shop's own offers ----------
const STATE = {
  requested: ['📞 Waiting for our call', 'warn'], live: ['🟢 Live', 'ok'], upcoming: ['🗓️ Starts soon', 'ok'],
  ended: ['Ended', ''], rejected: ['Not approved', 'bad'], cancelled: ['Cancelled', ''],
};
export function MyOffers() {
  const [list, setList] = useState(null);
  const load = () => api('/offers/mine').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const cancel = async (o) => {
    if (!(await askConfirm(`Cancel your request "${o.title}"?`, { okText: 'Yes, cancel', cancelText: 'Keep' }))) return;
    await api(`/offers/${o.id}/cancel`, { method: 'POST' }).catch(() => {});
    load();
  };
  if (!list) return <Skeleton variant="grid" />;
  return (
    <div className="offers-page">
      <BackLink to="/account">Account</BackLink>
      <section className="offers-hero">
        <div><h1>📢 My shop offers</h1><p>Your offers and how many people saw and called you.</p></div>
        <Link to="/advertise" className="btn offers-hero-btn">➕ New offer</Link>
      </section>
      {!list.length && (
        <div className="offers-empty"><span>📣</span><b>No offers yet</b><Link to="/advertise" className="btn btn-primary">Advertise your shop</Link></div>
      )}
      <div className="my-offers">
        {list.map((o) => {
          const [label, tone] = STATE[o.state] || [o.state, ''];
          const s = o.stats;
          return (
            <section key={o.id} className="panel my-offer">
              <div className="my-offer-head">
                <img src={o.image_url} alt="" />
                <div>
                  <b>{o.title}</b>
                  <small className="muted">{o.shop_name} · {o.plan_name}{o.free_launch ? ' · 🎁 free' : ` · ₹${Number(o.price)}`}</small>
                  <span className={`ride-status ${tone}`}>{label}{o.state === 'live' || o.state === 'upcoming' ? ` · ${dayLabel(o.starts_on)} – ${dayLabel(o.ends_on)}` : ''}</span>
                </div>
              </div>
              {o.state === 'rejected' && o.reason && <p className="alert small">{o.reason}</p>}
              {['live', 'ended'].includes(o.state) && (
                <div className="offer-stats">
                  <span><b>{s.seen}</b>seen</span><span><b>{s.opens}</b>opened</span><span><b>{s.calls}</b>calls</span>
                  <span><b>{s.whatsapp}</b>WhatsApp</span><span><b>{s.directions}</b>directions</span>
                </div>
              )}
              {o.ends_soon && <p className="ok-msg small">⏰ Ends on {dayLabel(o.ends_on)} — <Link to="/advertise">renew your offer</Link></p>}
              {o.state === 'requested' && <button type="button" className="link-btn danger-text" onClick={() => cancel(o)}>Cancel request</button>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
