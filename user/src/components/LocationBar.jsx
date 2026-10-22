import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, LocateFixed, MapPin, Search, X } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useCart } from '../cart.jsx';
import { getCity, setCity, useCity } from '../scope.js';
import { markPlaceAsked, placeAsked, setPlace, usePlace } from '../place.js';
import { askConfirm } from './ConfirmDialog.jsx';
import { useCities } from './CityPicker.jsx';

// 📍 Top bar, left (like the big delivery apps): "Deliver to" over "Hanuman Nagar, Siddipet ▾" — the place only, no
// delivery time (times differ by service; ⚡ 10 min is on the Instant Delivery card).
// Tapping it opens "Change location": Detect my location (GPS → the nearest of our areas, in a city whose range covers
// the spot) — OR — search our own areas & villages (set up by HQ; no outside map service). Opens once on its own on a
// first visit, never blocks browsing (✕ closes it). Choosing a place in another city clears the cart (after asking).
export default function LocationBar() {
  const { user } = useAuth();
  const place = usePlace();
  const cities = useCities();
  const city = useCity();
  const [open, setOpen] = useState(false);

  // one city: choose it silently · chosen city no longer open: forget it
  const current = cities.find((c) => String(c.id) === city);
  useEffect(() => {
    if (cities.length === 1 && city !== String(cities[0].id)) setCity(cities[0].id);
    if (cities.length > 1 && city && !current) setCity('');
  }, [cities, city, current]);

  // a customer who ordered before: their last delivery area, without asking
  useEffect(() => {
    if (!user || place) return;
    Promise.all([api('/orders/last-address'), api('/localities?all=1')]).then(([a, list]) => {
      const l = a && list.find((x) => x.id === a.locality_id);
      if (l && !getPlaceNow()) setPlace({ area: l.name, locality_id: l.id, city: l.city, franchise_id: l.franchise_id, village: l.is_village });
    }).catch(() => {});
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // first visit: open once by itself (more than one city and none chosen yet: always, so the right shops show)
  useEffect(() => {
    if (place) return;
    if (!placeAsked() || (cities.length > 1 && !getCity())) {
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [place, cities.length]);

  const close = () => {
    markPlaceAsked();
    setOpen(false);
  };
  const where = place ? [place.area, place.city].filter(Boolean).join(', ') : current ? current.city : 'Choose your location';

  return (
    <div className="loc-wrap">
      <button type="button" className="loc-btn" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        {/* only the place: delivery times differ by service (⚡ 10 min is on the Instant Delivery card) */}
        <small className="loc-label"><MapPin size={13} aria-hidden="true" /> Deliver to</small>
        <span className="loc-where"><b className="loc-text">{where}</b><ChevronDown size={16} aria-hidden="true" /></span>
      </button>
      {open && <LocationBox onClose={close} />}
    </div>
  );
}
const getPlaceNow = () => {
  try {
    return localStorage.getItem('as_place');
  } catch {
    return null;
  }
};

function LocationBox({ onClose }) {
  const cart = useCart();
  const city = useCity();
  const [areas, setAreas] = useState(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    api('/localities?all=1').then((l) => setAreas(l.filter((x) => x.franchise_id))).catch(() => setAreas([]));
    const esc = (e) => e.key === 'Escape' && onClose();
    const outside = (e) => box.current && !box.current.contains(e.target) && !e.target.closest('.loc-btn') && onClose();
    document.addEventListener('keydown', esc);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', esc);
      document.removeEventListener('pointerdown', outside);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // another city: its shops and prices are different, so the cart starts again (after asking)
  const choose = async (p) => {
    if (city && String(p.franchise_id) !== city && cart.count > 0
      && !(await askConfirm('This place is served by another city — its shops and prices are different, so your cart will be cleared. Continue?', { okText: 'Change location' }))) return;
    if (city && String(p.franchise_id) !== city) cart.clear();
    setPlace(p);
    onClose();
  };

  const detect = () => {
    if (!navigator.geolocation) return setMsg('Location is not available on this device — search your area instead.');
    setBusy(true);
    setMsg('Finding you…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = +pos.coords.latitude.toFixed(6), lng = +pos.coords.longitude.toFixed(6);
        try {
          const z = await api(`/locate?lat=${lat}&lng=${lng}`);
          if (!z.franchise) {
            setMsg("Sorry, we don't deliver to your location yet. You can still look around.");
            return;
          }
          const n = z.nearest;
          await choose({ area: n?.name || '', locality_id: n?.id || null, city: z.franchise.city, franchise_id: z.franchise.id, village: !!n?.is_village,
            lat, lng, accuracy: Math.round(pos.coords.accuracy), gps: true, at: Date.now() });
        } catch (e) {
          setMsg(e.message);
        } finally {
          setBusy(false);
        }
      },
      () => {
        setBusy(false);
        setMsg('Location is blocked on this phone — allow it, or search your area below.');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!areas || t.length < 1) return [];
    return areas.filter((l) => `${l.name} ${l.pincode || ''} ${l.city}`.toLowerCase().includes(t))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(t)) - Number(!b.name.toLowerCase().startsWith(t)) || a.name.localeCompare(b.name))
      .slice(0, 8);
  }, [areas, q]);

  return (
    <>
      <div className="loc-shade" aria-hidden="true" />
      <div className="loc-box" role="dialog" aria-modal="false" aria-labelledby="loc-title" ref={box}>
        <div className="loc-head">
          <h2 id="loc-title">Change location</h2>
          <button type="button" className="loc-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="loc-row">
          <button type="button" className="loc-detect" onClick={detect} disabled={busy}>
            <LocateFixed size={17} aria-hidden="true" /> <span>Detect my location</span>
          </button>
          <span className="loc-or" aria-hidden="true"><span>OR</span></span>
          <label className="loc-search">
            <Search size={17} aria-hidden="true" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setMsg(''); }} placeholder="Search your area or village" aria-label="Search your area or village" autoComplete="off" />
          </label>
        </div>
        {msg && <p className="loc-msg" role="status">{msg}</p>}
        {q.trim() && (
          <ul className="loc-results">
            {found.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => choose({ area: l.name, locality_id: l.id, city: l.city, franchise_id: l.franchise_id, village: l.is_village })}>
                  <MapPin size={17} aria-hidden="true" />
                  <span>
                    <b>{l.name}</b>
                    <small>{l.is_village ? <><span>Village</span> · </> : null}{l.city}{l.pincode ? ` ${l.pincode}` : ''}</small>
                  </span>
                </button>
              </li>
            ))}
            {areas && !found.length && <li className="loc-none">We don't deliver there yet. Try your town or nearest village name.</li>}
          </ul>
        )}
      </div>
    </>
  );
}
