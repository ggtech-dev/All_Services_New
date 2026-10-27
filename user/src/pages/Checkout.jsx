import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, priceTalk } from '../api.js';
import PartnerNote from '../components/PartnerNote.jsx';
import { useAuth } from '../auth.jsx';
import { itemNote, useCart } from '../cart.jsx';
import { qtyLabel, slotLabel } from '../qty.js';
import { rupees } from '../orderStatus.jsx';
import MapView from '../components/LazyMap.jsx';
import { setCity, useCity } from '../scope.js';
import { getPlace, setPlace } from '../place.js';
import BackLink from '../components/BackLink.jsx';

// Delivery / visit times: "As soon as possible", today's 2-hour windows that are still ahead (starting at least
// 30 minutes from now), then tomorrow's. Services with a fixed window (vegetables 6–10 AM) use the server's slots.
const WINDOWS = { products: [[7, 9], [9, 11], [12, 14], [15, 17], [17, 19], [19, 21]], service: [[9, 11], [11, 13], [14, 16], [16, 18], [18, 20]] };
const hr = (h) => ({ n: h % 12 || 12, m: h < 12 ? 'AM' : 'PM' });
const span = ([a, b]) => (hr(a).m === hr(b).m ? `${hr(a).n}–${hr(b).n} ${hr(b).m}` : `${hr(a).n} ${hr(a).m}–${hr(b).n} ${hr(b).m}`);
function buildSlots(kind, now = new Date()) {
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000); // India time
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  const today = WINDOWS[kind].filter(([a]) => a * 60 >= minutes + 30).map((w) => `Today ${span(w)}`);
  const tomorrow = WINDOWS[kind].slice(0, Math.max(2, 5 - today.length)).map((w) => `Tomorrow ${span(w)}`);
  return ['As soon as possible', ...today, ...tomorrow];
}
// 👩‍🍳 the times a cook can start: every half hour 6:00 AM–8:30 PM, finishing by 10 PM; today at least an hour from now
// (the server checks the same: fn_check_cook)
function cookStartTimes(day, hours, now = new Date()) {
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
  const earliest = day === 'today' ? ist.getHours() * 60 + ist.getMinutes() + 60 : 0;
  const out = [];
  for (let m = 6 * 60; m <= 20 * 60 + 30; m += 30) {
    if (m < earliest || m + hours * 60 > 22 * 60) continue;
    const h = Math.floor(m / 60), mm = m % 60;
    out.push([`${String(h).padStart(2, '0')}:${mm ? '30' : '00'}`, `${h % 12 || 12}:${mm ? '30' : '00'} ${h < 12 ? 'AM' : 'PM'}`]);
  }
  return out;
}
const hoursLabel = (h) => (h === 1 ? '1 hour' : `${String(h).replace('.5', '½')} hours`);

// Checkout for the cart (products) or for booking one service (?service=<slug>).
export default function Checkout() {
  const { user } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const serviceSlug = params.get('service');
  const kind = serviceSlug ? 'service' : 'products';
  const instant = kind === 'products' ? cart.via : null; // ⚡ Instant Delivery order: no time slots, instant agents
  const village = !!instant?.village; // 🏡 Village Needs: villages only, the village's charge, next-day slots

  const [service, setService] = useState(null);
  const [localities, setLocalities] = useState([]);
  const [quote, setQuote] = useState({ delivery_fee: 0, free_left: 0 });
  const [shops, setShops] = useState([]);
  const [shopChoice, setShopChoice] = useState(''); // '' = any good shop, a shop id, or 'other'
  const [shopOther, setShopOther] = useState('');
  const [form, setForm] = useState({ name: user.fullName || '', phone: user.phone || '', address_line: '', landmark: '', locality_id: '', pincode: '' });
  const [slotOptions] = useState(() => ({ products: buildSlots('products'), service: buildSlots('service') }));
  const SLOTS = slotOptions;
  const [slot, setSlot] = useState(SLOTS[kind][0]);
  const [notes, setNotes] = useState('');
  // 🎉 Events: when, what and how many — sent to event partners before they accept
  const isEvent = kind === 'service' && service?.category_slug === 'events';
  const [eventTypes, setEventTypes] = useState([]);
  const [event, setEvent] = useState({ event_type: '', event_date: '', event_time: '18:00', guests: '', details: '' });
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  useEffect(() => {
    if (isEvent && !eventTypes.length) api('/event-types').then(setEventTypes).catch(() => {});
  }, [isEvent, eventTypes.length]);
  const setEv = (k) => (e) => setEvent({ ...event, [k]: e.target.value });
  // 🚗 Car bookings: where, when and which car — sent to car partners before they accept
  const isTrip = kind === 'service' && service?.category_slug === 'vehicle-rental';
  // 🏠 a Home Doctor Visit type (RMP, nurse, BP check…): now, or a date & time
  const isVisit = kind === 'service' && service?.parent_id != null;
  const isAmbulance = isVisit && /ambulance/i.test(service?.name || '');
  const [visit, setVisit] = useState({ mode: '', visit_date: '', visit_time: '10:00' });
  // 👩‍🍳 Book Your Cook: today / tomorrow, a start time, 1–8 hours (half hours too) — a fixed price for the city, from
  // the server (homefood.sql), paid to the cook in cash after the work
  const isCook = kind === 'service' && service?.skill_code === 'book_cook';
  const [cook, setCook] = useState({ day: 'today', start: '', hours: 1, woman: false });
  const [cookPrices, setCookPrices] = useState([]);
  useEffect(() => {
    if (isCook && !cookPrices.length) api('/cook-prices').then(setCookPrices).catch(() => {});
  }, [isCook, cookPrices.length]);
  const cookPrice = cookPrices.find((p) => p.hours === cook.hours)?.price ?? null;
  const cookStarts = useMemo(() => cookStartTimes(cook.day, cook.hours), [cook.day, cook.hours]);
  useEffect(() => {
    if (isCook && cook.start && !cookStarts.some(([v]) => v === cook.start)) setCook((c) => ({ ...c, start: '' }));
  }, [isCook, cook.start, cookStarts]);
  const ahead = isEvent || isTrip || isVisit || isCook; // booked ahead: its own date & time, no time slots
  // no price from us (booked ahead, or a "price on discussion" service like plumber / electrician) — the cook has one
  const talk = (ahead && !isCook) || (kind === 'service' && priceTalk(service));
  const [tripOpts, setTripOpts] = useState(null);
  // 🚗 car_model_id: the car the customer chose on the photo cards ('' = Any car) — only partners with that car get it
  const [trip, setTrip] = useState({ trip_type: '', drop: '', trip_date: '', trip_time: '09:00', return_date: '', passengers: '', car_type: 'Any car', car_model_id: '', details: '' });
  useEffect(() => {
    if (isTrip && !tripOpts) api('/trip-options').then(setTripOpts).catch(() => {});
  }, [isTrip, tripOpts]);
  // 🚗 the car tapped on the Vehicle Rental page (?car=5) comes chosen
  const pickedCar = params.get('car');
  useEffect(() => {
    const c = tripOpts?.cars?.find((x) => String(x.id) === pickedCar);
    if (c) setTrip((t) => (t.car_model_id ? t : { ...t, car_model_id: String(c.id), car_type: c.name }));
  }, [tripOpts, pickedCar]);
  const setTr = (k) => (e) => setTrip({ ...trip, [k]: e.target.value });
  // "Book again" after a partner cancelled: the form starts with that booking's details; placing cancels the old one
  const prefilled = useRef(false); // fill the form once, so a late reply never overwrites what the customer typed
  const rebookOf = /^\d+$/.test(params.get('rebook') || '') ? Number(params.get('rebook')) : null;
  // 📍 The delivery location is required: GPS ("Use my current location") or a pin tapped on the map. It decides the
  // city — the nearest franchise whose range covers it (server: geo.sql) — and the nearest area is chosen for you.
  const [pin, setPin] = useState(null); // { lat, lng, accuracy? }
  const [pinMsg, setPinMsg] = useState('');
  const [zone, setZone] = useState(null); // { franchise, areas (nearest first) } for the pin · { franchise: null } = not served
  const [mapPick, setMapPick] = useState(false);
  const city = useCity();

  const applyPin = async (p) => {
    setPin(p);
    setPinMsg('Checking your location…');
    try {
      const z = await api(`/locate?lat=${p.lat}&lng=${p.lng}`);
      setZone(z);
      setPinMsg('');
      if (!z.franchise) return;
      // the nearest area that fits this order (villages only for 🏡 Village Needs, town areas for shop orders)
      const fits = z.areas.filter((l) => (village ? l.is_village : kind === 'service' || !l.is_village));
      setForm((f) => (fits.some((l) => String(l.id) === f.locality_id) ? f
        : { ...f, locality_id: fits[0] ? String(fits[0].id) : '', pincode: fits[0]?.pincode || f.pincode }));
      // 📍 the top bar shows this spot from now on (a saved address on its own pin stays as it is)
      const n = z.nearest;
      const cur = getPlace();
      if (!(cur?.address && cur.lat === p.lat && cur.lng === p.lng)) {
        setPlace({ area: n?.name || '', locality_id: n?.id || null, city: z.franchise.city, franchise_id: z.franchise.id, village: !!n?.is_village,
          lat: p.lat, lng: p.lng, accuracy: p.accuracy, gps: true, at: Date.now() });
      }
    } catch (err) {
      setPinMsg(err.message);
    }
  };
  const pinMyLocation = () => {
    if (!navigator.geolocation) return setPinMsg('Location is not available on this device — tap "Set on map" instead');
    setPinMsg('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (pos) => applyPin({ lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6), accuracy: Math.round(pos.coords.accuracy) }),
      () => { setPinMsg('Location is blocked — allow it, or tap "Set on map" and tap your place'); setMapPick(true); },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };
  // the spot found from the top bar (📍 Detect my location) is the pin to start with; location already allowed on this
  // phone: find it fresh straight away
  useEffect(() => {
    const pl = getPlace();
    if (pl?.gps && pl.lat && pl.lng) applyPin({ lat: pl.lat, lng: pl.lng, accuracy: pl.accuracy });
    // a saved address keeps its own pin (ordering for home from the office) — no fresh GPS over it
    if (pl?.address && pl.lat) return;
    navigator.permissions?.query({ name: 'geolocation' }).then((s) => s.state === 'granted' && pinMyLocation()).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/localities').then(setLocalities).catch(() => {});
    if (rebookOf) {
      api(`/orders/${rebookOf}`).then((o) => {
        if (prefilled.current) return;
        prefilled.current = true;
        setForm({ name: o.contact_name, phone: o.contact_phone, address_line: o.address_line, landmark: o.landmark || '', locality_id: String(o.locality_id), pincode: o.pincode || '' });
        if (o.notes) setNotes(o.notes);
        const e = o.event_details;
        if (e) setEvent({ event_type: e.event_type, event_date: e.event_date, event_time: e.event_time, guests: e.guests ? String(e.guests) : '', details: e.details || '' });
        const v = o.visit_details;
        if (v) setVisit({ mode: v.mode, visit_date: v.visit_date || '', visit_time: v.visit_time || '10:00' });
        const t = o.trip_details;
        if (t) setTrip({ trip_type: t.trip_type, drop: t.drop, trip_date: t.trip_date, trip_time: t.trip_time, return_date: t.return_date || '',
          passengers: t.passengers ? String(t.passengers) : '', car_type: t.car_model_id ? t.car_type : 'Any car',
          car_model_id: t.car_model_id ? String(t.car_model_id) : '', details: t.details || '' });
      }).catch(() => {});
      return;
    }
    // 🏠 a saved address chosen in the top bar comes first; otherwise the last address used
    const saved = getPlace();
    if (saved?.address && saved.locality_id) {
      const a = saved.address;
      setForm({ name: a.contact_name || user.fullName || '', phone: a.contact_phone || user.phone || '', address_line: a.address_line,
        landmark: a.landmark || '', locality_id: String(saved.locality_id), pincode: a.pincode || '' });
      return;
    }
    api('/orders/last-address').then((a) => {
      if (a) setForm({ name: a.contact_name, phone: a.contact_phone, address_line: a.address_line, landmark: a.landmark || '', locality_id: String(a.locality_id), pincode: a.pincode || '' });
      // first order: the area chosen in the top bar
      else if (getPlace()?.locality_id) setForm((f) => (f.locality_id ? f : { ...f, locality_id: String(getPlace().locality_id) }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (serviceSlug) api(`/services/${serviceSlug}`).then((d) => setService(d.service)).catch((e) => setError(e.message));
  }, [serviceSlug]);

  // The customer's own list (kirana…): typed lines with a name, and/or a photo of a handwritten list.
  const ownLines = cart.lines.filter((l) => l.name.trim());
  const listServiceIds = [...new Set([...ownLines.map((l) => l.service_id), ...(cart.photo ? [cart.photo.service_id] : [])])].join(',');

  // Delivery/visit charge for exactly this cart (highest charge among its shops) or this booking.
  const productIds = cart.items.map((i) => i.product_id).join(',');
  useEffect(() => {
    const parts = [productIds && `products=${productIds}`, listServiceIds && `lists=${listServiceIds}`].filter(Boolean).join('&');
    const q = kind === 'service' ? (service ? `service=${service.id}` : null)
      : instant ? `via=${instant.id}${village && form.locality_id ? `&locality=${form.locality_id}` : ''}` : parts || null;
    if (q) api(`/orders/quote?${q}`).then(setQuote).catch(() => {});
  }, [kind, service, productIds, listServiceIds, instant, village, form.locality_id]);

  // Shops the customer may choose (for items bought at a shop: vegetables, meat, kirana…)
  const shopServiceIds = [...new Set([...cart.items.filter((i) => i.on_bill && i.service_id).map((i) => i.service_id), ...(listServiceIds ? listServiceIds.split(',').map(Number) : [])])].join(',');
  useEffect(() => {
    if (kind !== 'products' || !shopServiceIds) return setShops([]);
    api(`/shops?services=${shopServiceIds}`).then(setShops).catch(() => setShops([]));
  }, [kind, shopServiceIds]);

  // Daily services deliver only in their time window: pick one of the slots the server offers.
  const windowSlots = quote.slots || null;
  useEffect(() => {
    if (windowSlots && !windowSlots.includes(slot)) setSlot(windowSlots[0] || '');
    if (!windowSlots && !SLOTS[kind].includes(slot)) setSlot(SLOTS[kind][0]);
  }, [windowSlots, slot, kind]);

  // the areas to choose from: those of the city the location is in (nearest first), until then the app's city
  const areaList = (zone?.franchise ? zone.areas : localities).filter((l) => (village ? l.is_village : kind === 'service' || !l.is_village));
  // A saved address from an area we no longer serve (or of another city): ask for the area again.
  useEffect(() => {
    if (areaList.length && form.locality_id && !areaList.some((l) => String(l.id) === form.locality_id)) {
      setForm((f) => ({ ...f, locality_id: '', pincode: '' }));
    }
  }, [areaList, form.locality_id]);
  // the location is in another of our cities than the one this cart was filled in
  const otherCity = zone?.franchise && city && String(zone.franchise.id) !== city ? zone.franchise : null;
  const moveToCity = () => {
    cart.clear(); // shops and prices are different in each city
    setCity(otherCity.id);
    navigate('/');
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const chooseLocality = (e) => {
    const l = areaList.find((x) => String(x.id) === e.target.value);
    setForm({ ...form, locality_id: e.target.value, pincode: l?.pincode || form.pincode });
  };

  const lines = kind === 'service'
    ? service ? [isCook
      ? { key: 's', icon: service.icon || service.category_icon, name: service.name, unit: hoursLabel(cook.hours), qty: 1, price: cookPrice ?? 0 }
      : { key: 's', icon: service.icon || service.category_icon, name: service.name, unit: service.price_unit, qty: 1, price: Number(service.base_price) }] : []
    : [
        ...cart.items.map((i) => ({
          key: i.product_id, icon: i.icon, name: i.name, unit: i.unit, qty: i.qty, price: i.price, product_id: i.product_id,
          sell_by: i.sell_by || 'pack', on_bill: !!i.on_bill, note: itemNote(i),
        })),
        ...ownLines.map((l) => ({ key: `own-${l.key}`, own: l, icon: '✍️', name: l.name.trim(), unit: l.qty_text.trim() || (instant ? 'as written' : 'how much?'), qty: 1, price: 0, on_bill: true })),
        ...(cart.photo ? [{ key: 'photo', photo: true, icon: '📷', name: /medicine/i.test(cart.photo.service_name || '') ? "Doctor's prescription (photo)" : 'Photo of your list', unit: cart.photo.service_name, qty: 1, price: 0, on_bill: true }] : []),
      ];
  // items priced by the shop bill (vegetables, meat…) are paid as per the bill, not included here
  const subtotal = lines.reduce((n, l) => n + (l.on_bill ? 0 : l.price * l.qty), 0);
  const hasBill = lines.some((l) => l.on_bill);
  const fee = quote.delivery_fee;
  const toPay = !hasBill ? rupees(subtotal + fee) : subtotal + fee > 0 ? `${rupees(subtotal + fee)} + shop bill` : 'As per shop bill';
  const feeName = kind === 'service' ? 'Visit charge' : village ? 'Village delivery charge' : 'Delivery charge';

  if (kind === 'products' && !cart.items.length && !ownLines.length && !cart.photo) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🛒</div>
        <h2>Your cart is empty</h2>
        <p className="muted">Add milk, vegetables, kirana and more from the shops.</p>
        <Link to="/" className="btn btn-primary">Start shopping</Link>
      </div>
    );
  }

  const place = async (e) => {
    e.preventDefault();
    setError('');
    if (!pin) return setError('Please share your delivery location: tap "Use my current location" or "Set on map".');
    if (zone && !zone.franchise) return setError('Sorry, All Services does not deliver to your location yet.');
    setBusy(true);
    try {
      const body = { contact: { ...form, locality_id: Number(form.locality_id), ...(pin && { lat: pin.lat, lng: pin.lng }) }, slot, notes };
      if (kind === 'service') body.service_id = service.id;
      if (isEvent) body.event = event;
      if (isTrip) body.trip = trip;
      if (isVisit) body.visit = visit;
      if (isCook) body.cook = cook;
      if (rebookOf) body.rebook_of = rebookOf;
      if (!ahead) {
        if (instant) body.via_service_id = instant.id;
        body.items = [
          ...lines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id, qty: l.qty, ...(l.note && { note: l.note }) })),
          ...ownLines.map((l) => ({ service_id: l.service_id, name: l.name.trim(), qty_text: l.qty_text.trim() })),
        ];
        // only a photo, nothing typed for that shop: one line points to the photo
        if (cart.photo && !ownLines.some((l) => l.service_id === cart.photo.service_id)) {
          body.items.push({ service_id: cart.photo.service_id, name: 'Items in the photo', qty_text: 'see photo' });
        }
        if (shopChoice === 'other') body.shop_name = shopOther.trim();
        else if (shopChoice) body.shop_id = Number(shopChoice);
      }
      let payload = body;
      if (kind === 'products' && cart.photo) {
        payload = new FormData();
        payload.append('data', JSON.stringify(body));
        payload.append('list_photo', cart.photo.file);
      }
      const order = await api('/orders', { method: 'POST', body: payload });
      if (kind === 'products') cart.clear();
      navigate(`/orders/${order.id}?new=1`, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="checkout" onSubmit={place}>
      <div className="checkout-main">
        {isVisit && service.parent_slug ? <Link to={`/care/${service.parent_slug}`} className="back-link">← {service.parent_name}</Link>
          : <BackLink to={service?.category_slug ? `/category/${service.category_slug}` : '/'}>Back</BackLink>}
        <h1>{kind === 'service' ? 'Book service' : instant ? `${village ? '🏡' : '⚡'} ${instant.name}` : 'Checkout'}</h1>
        {rebookOf && <div className="instant-banner rebook-banner">✏️ <span>{`Booking again — change anything you like. Your earlier booking #${rebookOf} is cancelled when you confirm.`}</span></div>}
        {instant && !village && <div className="instant-banner">⚡ <b>Instant order</b> — your delivery partner starts right away and reaches you in about <b>{quote.eta_minutes || 10} minutes</b>.</div>}
        {village && <div className="instant-banner village-banner">🏡 <span><b>Village delivery</b> — same-day delivery is not possible for villages. Choose <b>tomorrow</b> (or a later day) and a time below. Our own team brings it.</span></div>}

        <section className="panel form">
          <h3>{isCook ? '📍 Your home address' : isEvent ? '📍 Event venue' : isTrip || isAmbulance ? '🟢 Pickup address' : isVisit ? '📍 Patient address' : '📍 Delivery address'}</h3>
          <div className="form-row">
            <label>Name<input value={form.name} onChange={set('name')} required placeholder="Who will receive it" /></label>
            <label>Mobile number<input value={form.phone} onChange={set('phone')} required inputMode="tel" placeholder="10-digit mobile" /></label>
          </div>
          <label>House / flat no., building, street<input value={form.address_line} onChange={set('address_line')} required placeholder="e.g. Flat 202, Sai Residency, Road 5" /></label>
          <div className="form-row">
            <label>
              Area
              <select value={form.locality_id} onChange={chooseLocality} required>
                <option value="">{village ? 'Choose your village…' : 'Choose your area…'}</option>
                {/* villages: only for 🏡 Village Needs (with their charge); shop orders go to town areas */}
                {areaList.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}{l.km != null ? ` · ${Number(l.km)} km` : ''}{village && l.village_fee != null ? ` — delivery ${rupees(l.village_fee)}` : ''}</option>
                ))}
              </select>
            </label>
            <label>Pincode<input value={form.pincode} onChange={set('pincode')} inputMode="numeric" maxLength={6} placeholder="502103" /></label>
          </div>
          <label>Landmark (optional)<input value={form.landmark} onChange={set('landmark')} placeholder="e.g. Near Old Bus Stand" /></label>
          <div className="pin-row">
            <button type="button" className={`btn btn-sm ${pin ? 'btn-ghost' : 'btn-primary'}`} onClick={pinMyLocation}>📍 {pin ? 'Update my location' : 'Use my current location'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMapPick(!mapPick)}>🗺️ {mapPick ? 'Hide map' : 'Set on map'}</button>
            {pinMsg ? <small className="muted">{pinMsg}</small>
              : pin && zone?.franchise ? <small className="success-text">Location pinned ✓{pin.accuracy ? ` (±${pin.accuracy} m)` : ''} — {zone.franchise.city} · the {kind === 'service' ? 'partner' : 'agent'} navigates right to your door</small>
              : !pin && <small className="pin-required">Required: we deliver only where our team is (within {Number(zone?.franchise?.radius_km || 25)} km of our city).</small>}
          </div>
          {zone && !zone.franchise && (
            <div className="alert">📍 Sorry, All Services does not deliver to this location yet. If this pin is wrong, tap <b>Set on map</b> and tap your home.</div>
          )}
          {otherCity && (
            <div className="alert">
              📍 This location is in our <b>{otherCity.city}</b> service area, but your cart is from another city.{' '}
              <button type="button" className="btn btn-primary btn-sm" onClick={moveToCity}>Shop in {otherCity.city}</button>
            </div>
          )}
          {(pin || mapPick) && (
            <>
              {mapPick && <small className="muted">Tap the map at your home / venue to place the pin.</small>}
              <MapView
                markers={[
                  ...(pin ? [{ id: 'pin', lat: pin.lat, lng: pin.lng, emoji: '🏠', color: '#16a34a', accuracy_m: pin.accuracy }] : []),
                  ...(!pin ? localities.slice(0, 40).map((l) => ({ id: `a${l.id}`, lat: l.lat, lng: l.lng, emoji: '📍', color: '#94a3b8', label: l.name })) : []),
                ]}
                fitKey={pin ? `${pin.lat},${pin.lng}` : 'areas'}
                height={mapPick ? 260 : 180}
                onMapClick={mapPick ? (p) => applyPin({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }) : undefined}
              />
            </>
          )}
        </section>

        {isEvent && (
          <section className="panel form event-form">
            <h3>🎉 Event details</h3>
            <p className="muted small">Event partners see these details before they accept. After accepting, they call you to discuss and agree the price.</p>
            <label>Type of event *
              <select value={event.event_type} onChange={setEv('event_type')} required>
                <option value="">Choose…</option>
                {eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <div className="form-row">
              <label>Event date *<input type="date" min={today} value={event.event_date} onChange={setEv('event_date')} required /></label>
              <label>Start time *<input type="time" value={event.event_time} onChange={setEv('event_time')} required /></label>
            </div>
            <label>Number of guests (approx.)<input type="number" min="1" max="100000" inputMode="numeric" value={event.guests} onChange={setEv('guests')} placeholder="e.g. 200" /></label>
            <label>What do you need?<textarea rows={3} maxLength={600} value={event.details} onChange={setEv('details')}
              placeholder="e.g. Candid photos + album for a 2-day wedding, morning and evening" /></label>
          </section>
        )}

        {isTrip && (
          <section className="panel form event-form trip-form">
            <h3>🚗 Trip details</h3>
            <p className="muted small">Car partners see these details before they accept. After accepting, they call you to discuss and agree the price.</p>
            <label>Type of trip *
              <select value={trip.trip_type} onChange={setTr('trip_type')} required>
                <option value="">Choose…</option>
                {(tripOpts?.trip_types || []).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>Where to go? *<input value={trip.drop} onChange={setTr('drop')} required maxLength={200} placeholder="e.g. Hyderabad airport / Yadagirigutta temple" /></label>
            <div className="form-row">
              <label>Travel date *<input type="date" min={today} value={trip.trip_date} onChange={setTr('trip_date')} required /></label>
              <label>Pickup time *<input type="time" value={trip.trip_time} onChange={setTr('trip_time')} required /></label>
            </div>
            {trip.trip_type === 'Round trip' && (
              <label>Return date (optional)<input type="date" min={trip.trip_date || today} value={trip.return_date} onChange={setTr('return_date')} /></label>
            )}
            {/* 🚗 choose the exact car: only partners with that car (approved) get the booking */}
            <div className="car-pick">
              <span className="car-pick-title">Choose your car</span>
              <div className="car-cards" role="radiogroup" aria-label="Car">
                {[{ id: '', name: 'Any car', seats: null }, ...(tripOpts?.cars || [])].map((c) => (
                  <button key={c.id || 'any'} type="button" role="radio" aria-checked={String(trip.car_model_id) === String(c.id)}
                    className={`car-card ${String(trip.car_model_id) === String(c.id) ? 'active' : ''}`}
                    onClick={() => setTrip({ ...trip, car_model_id: String(c.id), car_type: c.name })}>
                    <span className="car-card-img">{c.image_url ? <img src={c.image_url} alt="" loading="lazy" /> : <span aria-hidden="true">{c.id ? '🚗' : '✨'}</span>}</span>
                    <b>{c.name}</b>
                    <small>{c.seats ? `${c.seats} seats` : 'quickest reply'}</small>
                  </button>
                ))}
              </div>
              <small className="muted">{trip.car_model_id ? `Only partners with a ${trip.car_type} get your booking. The first to accept calls you.` : 'Every car partner gets your booking. The first to accept calls you.'}</small>
            </div>
            <div className="form-row">
              <label>Passengers<input type="number" min="1" max="20" inputMode="numeric" value={trip.passengers} onChange={setTr('passengers')} placeholder="e.g. 4" /></label>
            </div>
            <label>Anything else? (optional)<textarea rows={2} maxLength={400} value={trip.details} onChange={setTr('details')}
              placeholder="e.g. 2 big suitcases, need AC, wait 2 hours at the temple" /></label>
          </section>
        )}

        {isCook && (
          <section className="panel form cook-form">
            <h3>👩‍🍳 When should the cook come?</h3>
            <div className="when-choice cook-day" role="radiogroup" aria-label="Day">
              {[['today', 'Today'], ['tomorrow', 'Tomorrow']].map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={cook.day === k} className={cook.day === k ? 'active' : ''}
                  onClick={() => setCook({ ...cook, day: k })}>{label}</button>
              ))}
            </div>
            <label>Start time *
              <select value={cook.start} onChange={(e) => setCook({ ...cook, start: e.target.value })} required>
                <option value="">{cookStarts.length ? 'Choose a time…' : 'No time left today — choose tomorrow'}</option>
                {cookStarts.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
            <div className="cook-hours">
              <span className="cook-hours-label">How long?</span>
              <div className="cook-stepper">
                <button type="button" onClick={() => setCook({ ...cook, hours: Math.max(1, cook.hours - 0.5) })} disabled={cook.hours <= 1} aria-label="Half an hour less">−</button>
                <b>{hoursLabel(cook.hours)}</b>
                <button type="button" onClick={() => setCook({ ...cook, hours: Math.min(8, cook.hours + 0.5) })} disabled={cook.hours >= 8} aria-label="Half an hour more">+</button>
              </div>
              {cookPrice != null && <span className="cook-price">₹{cookPrice}</span>}
            </div>
            <p className="muted small">{cookPrices[0] ? `₹${cookPrices[0].price} an hour · ₹${(cookPrices[1]?.price ?? 0) - cookPrices[0].price} for an extra half hour — book by the hour, no full-day booking.` : ''}</p>
            <label className="check-row">
              <input type="checkbox" checked={cook.woman} onChange={(e) => setCook({ ...cook, woman: e.target.checked })} /> Prefer a woman cook
            </label>
            <label>Anything the cook should know? (optional)
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Groceries are ready in the kitchen · 4 people" />
            </label>
          </section>
        )}

        {isVisit && (
          <section className="panel form visit-form">
            <h3>🕐 When do you need {isAmbulance ? 'the ambulance' : 'the visit'}?</h3>
            <div className="when-choice" role="radiogroup" aria-label="When">
              <button type="button" role="radio" aria-checked={visit.mode === 'now'} className={visit.mode === 'now' ? 'active' : ''}
                onClick={() => setVisit({ ...visit, mode: 'now' })}>
                <b>⚡ Now</b><small>As soon as possible</small>
              </button>
              <button type="button" role="radio" aria-checked={visit.mode === 'schedule'} className={visit.mode === 'schedule' ? 'active' : ''}
                onClick={() => setVisit({ ...visit, mode: 'schedule' })}>
                <b>📅 Choose date & time</b><small>Book for later</small>
              </button>
            </div>
            {visit.mode === 'schedule' && (
              <div className="form-row">
                <label>Date *<input type="date" min={today} value={visit.visit_date} onChange={(e) => setVisit({ ...visit, visit_date: e.target.value })} required /></label>
                <label>Time *<input type="time" value={visit.visit_time} onChange={(e) => setVisit({ ...visit, visit_time: e.target.value })} required /></label>
              </div>
            )}
            <label>{isAmbulance ? 'Patient & where to go (optional)' : 'Patient & problem (optional)'}
              <textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder={isAmbulance ? 'e.g. Father, 70 yrs, to Government Hospital Siddipet' : 'e.g. Mother, 65 yrs, fever since 2 days'} />
            </label>
            <p className="muted small">{`Only ${service.name} partners get this booking. They call you after accepting — you agree the fee directly with them.`}</p>
          </section>
        )}

        {!ahead && <section className="panel form">
          <h3>{kind === 'service' ? '🗓️ Preferred time' : village ? '📅 Delivery day & time' : instant ? '📝 Instructions' : '🕒 Delivery time'}</h3>
          {quote.window_conflict && (
            <div className="alert">Some items in your cart are delivered at different times of the day. Please order them separately.</div>
          )}
          {quote.window && <p className="muted small">🕕 These items are delivered between <b>{quote.window.label}</b>.</p>}
          {(!instant || village) && <div className="slot-grid">
            {(windowSlots || SLOTS[kind]).map((s) => (
              <button type="button" key={s} className={`slot ${slot === s ? 'active' : ''}`} onClick={() => setSlot(s)}>{windowSlots ? slotLabel(s) : s}</button>
            ))}
          </div>}
          <label>Instructions (optional)<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={kind === 'service' ? 'Describe the problem, e.g. kitchen tap leaking' : 'e.g. Ring the bell, leave with security'} /></label>
        </section>}

        {kind === 'products' && hasBill && (
          <section className="panel form">
            <h3>🏪 Shop <span className="muted small">(optional)</span></h3>
            <p className="muted small">Want your items from a particular shop? Choose it — your delivery partner will buy only there.</p>
            <select value={shopChoice} onChange={(e) => setShopChoice(e.target.value)} aria-label="Shop">
              <option value="">Any good shop — let the delivery partner choose</option>
              {shops.map((sh) => <option key={sh.id} value={sh.id}>{sh.name}{sh.locality_name ? ` — ${sh.locality_name}` : ''}</option>)}
              <option value="other">Another shop (type the name)…</option>
            </select>
            {shopChoice === 'other' && (
              <input value={shopOther} onChange={(e) => setShopOther(e.target.value.slice(0, 80))} placeholder="Shop name and area, e.g. Sri Lakshmi Kirana, Bharath Nagar" required />
            )}
          </section>
        )}

        {isCook ? (
          <section className="panel">
            <h3>💵 Price & payment</h3>
            <p className="muted small">{cookPrice != null ? `₹${cookPrice} for ${hoursLabel(cook.hours)}. ` : ''}Pay the cook in cash (or UPI) after the work. The cook comes with no groceries — keep them ready, or order vegetables and kirana in the app.</p>
          </section>
        ) : ahead ? (
          <section className="panel">
            <h3>💬 Price & payment</h3>
            <p className="muted small">{isVisit
              ? 'There is no fixed fee here. The partner calls you after accepting — you agree the fee and pay them directly.'
              : isTrip
              ? 'There is no fixed price for car bookings. The car partner calls you after accepting — you agree the price and payment directly with them.'
              : 'There is no fixed price for events. The event partner calls you after accepting — you agree the price and payment directly with them.'}</p>
          </section>
        ) : <section className="panel">
          <h3>💵 Payment</h3>
          <label className="pay-option">
            <input type="radio" checked readOnly /> <b>Pay on delivery</b> <span className="muted">— pay the {kind === 'service' ? 'expert' : 'agent'} when it arrives</span>
          </label>
          {hasBill && <p className="muted small">🧾 Market-price items (vegetables, meat, kirana…): your delivery partner buys them and shares a photo of the <b>shop bill</b> in your order — you pay exactly that amount.</p>}
          {fee > 0 && <p className="muted small">The {feeName.toLowerCase()} ({rupees(fee)}) is paid by UPI to All Services — scan the QR on the {kind === 'service' ? "expert's" : "agent's"} phone or tap “Pay with UPI app” in your order.</p>}
        </section>}
      </div>

      <aside className="checkout-side panel">
        <h3>Order summary</h3>
        <ul className="summary-lines">
          {lines.map((l) => (
            <li key={l.key}>
              <span className="summary-icon">{l.icon}</span>
              <div className="summary-name">
                <b>{l.name}</b>
                <small className="muted">{l.unit}</small>
                {l.note && <small className="item-note">{/ Meal — /.test(l.name) ? '🍛' : '✂️'} {l.note}</small>}
              </div>
              {l.own || l.photo ? (
                <button type="button" className="link-btn danger-text" onClick={() => (l.photo ? cart.setPhoto(null) : cart.removeLine(l.own.key))} aria-label={`Remove ${l.name}`}>Remove</button>
              ) : kind === 'products' ? (
                <div className="stepper small-stepper">
                  <button type="button" onClick={() => cart.less(l.product_id)} aria-label={`Less ${l.name}`}>−</button>
                  <span>{l.sell_by === 'pack' ? l.qty : qtyLabel(l.qty, l.sell_by)}</span>
                  <button type="button" onClick={() => cart.more(l.product_id)} aria-label={`More ${l.name}`}>+</button>
                </div>
              ) : null}
              <span className="summary-price">{talk ? null : l.on_bill ? <small className="market-price">as per bill</small> : rupees(l.price * l.qty)}</span>
            </li>
          ))}
        </ul>
        {talk ? (
          <div className="totals">
            {isEvent && event.event_date && <div><span>📅 When</span><span>{event.event_date} · {event.event_time}</span></div>}
            {isTrip && trip.trip_date && <div><span>📅 When</span><span>{trip.trip_date} · {trip.trip_time}</span></div>}
            {isVisit && visit.mode === 'now' && <div><span>⚡ When</span><span>Now</span></div>}
            {isVisit && visit.mode === 'schedule' && visit.visit_date && <div><span>📅 When</span><span>{visit.visit_date} · {visit.visit_time}</span></div>}
            <div className="grand"><span>Price</span><span>agreed with the partner</span></div>
            <PartnerNote compact kind={isTrip ? 'car' : 'service'} />
          </div>
        ) : <div className="totals">
          {(subtotal > 0 || !hasBill) && <div><span>{isCook ? `Cook · ${hoursLabel(cook.hours)}` : kind === 'service' ? 'Service charge' : 'Items total'}</span><span>{rupees(subtotal)}</span></div>}
          {hasBill && <div><span>Market-price items</span><span>as per shop bill</span></div>}
          {(kind === 'products' || quote.base_fee > 0) && (
            <div>
              <span>{feeName}</span>
              <span>{fee === 0 ? <b className="free">FREE</b> : rupees(fee)}</span>
            </div>
          )}
          {fee === 0 && quote.base_fee > 0 && quote.free_left > 0 && (
            <small className="success-text">🎉 {quote.free_left} free {quote.free_left === 1 ? 'delivery' : 'deliveries'} left for new customers</small>
          )}
          <div className="grand"><span>To pay</span><span>{toPay}</span></div>
        </div>}
        {error && <div className="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || !lines.length || (village && !quote.village_ok) || quote.window_conflict || (windowSlots && !windowSlots.length) || (isVisit && !visit.mode) || (isCook && (!cook.start || cookPrice == null))}>
          {busy ? 'Placing…' : isCook ? `👩‍🍳 Book cook · ${toPay}` : isEvent ? '🎉 Book event' : isTrip ? '🚗 Book car' : isAmbulance ? '🚑 Book ambulance' : isVisit ? '🩺 Book visit' : kind === 'service' ? (talk ? '📞 Book now' : `Confirm booking · ${toPay}`) : instant ? (village ? '🏡 Place village order' : '⚡ Place instant order') : hasBill ? 'Place order' : `Place order · ${toPay}`}
        </button>
        {!talk && <p className="muted small center">{hasBill ? 'Market-price items are charged exactly as per the shop bill.' : 'Prices are checked again when you place the order.'}</p>}
      </aside>
    </form>
  );
}
