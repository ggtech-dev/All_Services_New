import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../admin/ui.jsx';
import { rupees, statusLabel, time, usePoll } from '../orderStatus.jsx';
import { AgentShopBill } from '../components/ShopBill.jsx';
import OrderExtras from '../components/OrderExtras.jsx';
import { AgentDoorPayment, feeLabel } from '../components/DeliveryCharge.jsx';
import { InstallBanner } from '../components/InstallApp.jsx';
import { SubscriptionReminder } from './AgentPages.jsx';
import AlertsCard from '../components/AlertsCard.jsx';
import { cityOf, useSettings } from '../settings.js';
import { qtyLabel } from '../qty.js';
import EventInfo from '../components/EventInfo.jsx';
import TripInfo from '../components/TripInfo.jsx';
import { useAskReason } from '../components/AskReason.jsx';
import { askConfirm } from '../components/ConfirmDialog.jsx';
import VisitInfo from '../components/VisitInfo.jsx';

// Event, car and home-visit bookings: no pay per order, price agreed on the phone, cancel needs a reason.
const ahead = (o) => !!(o.event_details || o.trip_details || o.visit_details);
// "Price on discussion" bookings (plumber, electrician, cleaning…): the partner agrees the price with the customer.
const talk = (o) => ahead(o) || (o.kind === 'service' && !(Number(o.total) > 0));

const nearest = (list, lat, lng) =>
  list.reduce((best, l) => {
    const d = (l.lat - lat) ** 2 + (l.lng - lng) ** 2;
    return !best || d < best.d ? { ...l, d } : best;
  }, null);

export default function AgentHome() {
  const { me, reload, location } = useOutletContext();
  const toast = useToast();
  const [localities, setLocalities] = useState([]);
  const [active, setActive] = useState([]);
  const [available, setAvailable] = useState([]);
  const [busy, setBusy] = useState(false);
  const seen = useRef(null);
  const online = me.agent.is_online;

  const load = useCallback(async () => {
    const act = await api('/agent/orders?scope=active');
    setActive(await Promise.all(act.map((o) => api(`/agent/orders/${o.id}`))));
    if (online) {
      const list = await api('/agent/available');
      // Tell the agent when new orders appear while they are looking at the screen.
      if (seen.current) {
        const fresh = list.filter((o) => !seen.current.has(o.id));
        if (fresh.length) toast(`🔔 ${fresh.length} new order${fresh.length > 1 ? 's' : ''} near you`);
      }
      seen.current = new Set(list.map((o) => o.id));
      setAvailable(list);
    } else {
      setAvailable([]);
      seen.current = null;
    }
  }, [online, toast]);

  useEffect(() => {
    api('/localities').then(setLocalities).catch(() => {});
  }, []);
  useEffect(() => {
    load().catch((e) => toast(e.message, 'error'));
  }, [load, toast]);
  usePoll(() => load().catch(() => {}), 8000, online || active.length > 0);
  // 📍 inside / outside the franchise's service range follows the agent's GPS: refresh it while online
  usePoll(() => reload().catch?.(() => {}), 30000, online);
  // First GPS fix just reached the server: refresh so distances use the real position right away.
  const gpsOn = location.status === 'on';
  useEffect(() => {
    if (gpsOn) load().catch(() => {});
  }, [gpsOn, load]);

  const run = async (fn, okMessage) => {
    setBusy(true);
    try {
      await fn();
      if (okMessage) toast(okMessage);
      await Promise.all([reload(), load()]);
    } catch (e) {
      toast(e.message, 'error');
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const setOnline = (value, localityId) =>
    run(() => api('/agent/status', { method: 'PATCH', body: { online: value, locality_id: localityId ?? me.agent.locality_id } }),
      value ? "You're online. New orders near you will appear here." : "You're offline.");

  const useMyLocation = () => {
    if (!navigator.geolocation) return toast('Location is not available on this device', 'error');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const l = nearest(localities, pos.coords.latitude, pos.coords.longitude);
        if (l) setOnline(true, l.id);
      },
      () => toast('Please allow location access, or choose your area', 'error'),
      { timeout: 10000 }
    );
  };

  const s = me.stats;
  return (
    <div className="agent-stack">
      <InstallBanner who="agent" />
      <SubscriptionReminder />
      <AlertsCard compact />
      <section className={`online-card ${online ? 'is-online' : ''}`}>
        <div>
          <b>{online ? "You're online" : "You're offline"}</b>
          <small>{online ? `Receiving orders around ${me.agent.locality_name || 'your area'}` : 'Go online to start receiving orders'}</small>
        </div>
        <button className={`online-toggle ${online ? 'on' : ''}`} disabled={busy} onClick={() => setOnline(!online)} aria-pressed={online}>
          <span />
        </button>
      </section>

      {online && <LocationStatus location={location} />}
      {online && me.zone && !me.zone.inside && (
        <div className="zone-out" role="alert">
          📍 <b>You are outside the {me.zone.city} service zone</b>
          {me.zone.km != null && ` — ${Number(me.zone.km)} km from the centre`}. Come within {Number(me.zone.radius_km)} km to get orders.
        </div>
      )}

      <div className="area-row">
        <label>
          📍 My area
          <select value={me.agent.locality_id || ''} onChange={(e) => setOnline(online, Number(e.target.value))} disabled={busy}>
            <option value="" disabled>Choose area…</option>
            {localities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <button className="btn btn-ghost btn-sm" onClick={useMyLocation} disabled={busy}>🎯 Use my location</button>
      </div>

      <div className="my-skills">
        <small className="muted">You get orders for:</small>
        {(me.agent.skill_list || []).map((s) => <span key={s.code} className="skill-chip">{s.icon} {s.name}</span>)}
      </div>

      <div className="agent-stats">
        <div><small>Today</small><b>{s.today_deliveries}</b><small>deliveries</small></div>
        <div><small>Today</small><b>{rupees(s.today_earnings)}</b><small>earned</small></div>
        <div><small>Wallet</small><b>{rupees(s.wallet_balance)}</b><small>balance</small></div>
        <div className={Number(s.cash_in_hand) > 0 ? 'warn' : ''}><small>Cash</small><b>{rupees(s.cash_in_hand)}</b><small>to deposit</small></div>
      </div>

      {active.map((o) => <ActiveOrder key={o.id} order={o} busy={busy} run={run} />)}

      {online && (
        <section>
          <h3 className="agent-h3">Orders near you <span className="muted">({available.length})</span></h3>
          {!available.length && (
            <div className="agent-empty">
              {me.zone && !me.zone.inside
                ? `📍 Orders show up here again when you are back within ${Number(me.zone.radius_km)} km of ${me.zone.city}.`
                : `🕐 No open ${(me.agent.skill_list || []).map((s) => s.name).join(' / ')} orders right now. New orders show up here automatically.`}
            </div>
          )}
          {available.map((o) => (
            <article key={o.id} className="avail-card">
              <div className="avail-top">
                <span className="distance">{o.distance_km != null ? `${o.distance_km} km` : '—'}</span>
                <div className="avail-where">
                  <b>{o.locality_name}{o.pincode && ` · ${o.pincode}`}</b>
                  <small className="muted">#{o.id} · {o.kind === 'service' ? 'Service visit' : `${o.item_count} item${o.item_count > 1 ? 's' : ''}`} · {time(o.created_at)}</small>
                  <span className="skill-chip small">{o.skill_icon} {o.skill_name}</span>
                  {o.instant && <span className="instant-chip">⏱️ Deliver {(o.slot || "within 10 min").replace(/^Now — /, "")}</span>}
                  {o.deliver_on && <span className="instant-chip village-chip">🏡 Village · deliver {o.slot}</span>}
                </div>
                {!talk(o) && o.skill_code !== 'our_service_employees' && <span className="earn">+{rupees(s.pay_per_order)}</span>}
              </div>
              {o.event_details ? <EventInfo event={o.event_details} notes={o.notes} compact />
                : o.trip_details ? <TripInfo trip={o.trip_details} notes={o.notes} pickup={o.locality_name} compact />
                : o.visit_details ? <VisitInfo visit={o.visit_details} type={o.summary} notes={o.notes} compact />
                : <p className="avail-summary">{o.summary}</p>}
              {(o.preferred_shop || o.has_list_photo) && (
                <p className="avail-extras">
                  {o.preferred_shop && <span>🏪 {o.preferred_shop}</span>}
                  {o.has_list_photo && <span>📷 List photo</span>}
                </p>
              )}
              <div className="avail-foot">
                {talk(o)
                  ? <small className="muted">💬 Call the customer after accepting to agree the price</small>
                  : <small className="muted">{o.slot || 'ASAP'} · Collect {o.on_bill ? (Number(o.total) > 0 ? `shop bill + ${rupees(o.total)}` : 'as per shop bill') : rupees(o.total)}</small>}
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy || (s.active_orders > 0 && !ahead(o))}
                  title={s.active_orders > 0 && !ahead(o) ? 'Finish your current order first' : ''}
                  onClick={() => run(() => api(`/agent/orders/${o.id}/accept`, { method: 'POST' }), ahead(o) ? `Booking #${o.id} is yours — call the customer now` : `Order #${o.id} is yours. Head to the pickup!`)}
                >
                  Accept
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function LocationStatus({ location }) {
  if (location.status === 'on') {
    return <div className="gps-status gps-on">📍 Live location on{location.accuracy ? ` · ±${location.accuracy} m` : ''} — customers and admin can see you on the map</div>;
  }
  if (location.status === 'waiting') return <div className="gps-status">📡 Getting your GPS location… please allow location access.</div>;
  if (location.status === 'denied') {
    return (
      <div className="gps-status gps-off">
        ⚠️ Location is blocked. Allow location for this site in your browser settings — customers can't see you coming and you won't get the nearest orders.
      </div>
    );
  }
  if (location.status === 'unavailable') return <div className="gps-status gps-off">⚠️ GPS is not available. Turn on location on your phone.</div>;
  return null;
}

function ActiveOrder({ order, busy, run }) {
  const [askReason, reasonBox] = useAskReason();
  const [otp, setOtp] = useState('');
  const settings = useSettings();
  const isService = order.kind === 'service';
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${order.address_line}, ${order.landmark || ''}, ${order.locality_name}, ${cityOf(settings)} ${order.pincode || ''}`
  )}`;
  // The delivery/visit charge must be confirmed (company UPI or cash) before finishing.
  const feePending = Number(order.delivery_fee) > 0 && !order.fee_paid_at;
  // vegetables / meat are priced by the shop: the bill must be added before leaving the shop
  const needsBill = order.items.some((i) => i.on_bill) && !order.bill_uploaded_at;

  return (
    <section className="active-card">
      {reasonBox}
      <div className="active-head">
        <span className="active-tag">{statusLabel(order.status, order.kind)}</span>
        <b>#{order.id}</b>
      </div>

      <div className="active-customer">
        <div>
          <b>{order.contact_name}</b>
          <p>{order.address_line}{order.landmark && `, ${order.landmark}`}<br />{order.locality_name}{order.pincode && ` – ${order.pincode}`}</p>
        </div>
        <div className="active-actions">
          <a className="btn btn-ghost btn-sm" href={`tel:${order.contact_phone}`}>📞 Call</a>
          <a className="btn btn-ghost btn-sm" href={mapUrl} target="_blank" rel="noreferrer">🗺️ Map</a>
        </div>
      </div>

      <EventInfo event={order.event_details} notes={order.notes} />
      <TripInfo trip={order.trip_details} notes={order.notes} />
      <VisitInfo visit={order.visit_details} notes={order.notes} />
      <OrderExtras order={order} filesBase={`/agent/orders/${order.id}/files`} who="agent" />
      <ul className="active-items">
        {order.items.map((i) => (
          <li key={i.id}>
            <span>
              {i.icon || '•'} {i.name} <small className="muted">{i.sell_by === 'pack' ? i.unit : ''}</small>
              {i.note && <small className="item-note">✂️ {i.note}</small>}
            </span>
            <b>{i.sell_by === 'pack' ? `× ${Number(i.qty)}` : (i.sell_by === 'custom' ? i.unit : qtyLabel(i.qty, i.sell_by))}</b>
          </li>
        ))}
      </ul>
      {order.notes && <p className="active-note">📝 {order.notes}</p>}
      {order.slot && <p className="muted small">🕒 {order.slot}</p>}
      {order.kind === 'products' && (order.status === 'assigned' || order.bill_uploaded_at) && (
        <AgentShopBill order={order} busy={busy} run={run} />
      )}
      <AgentDoorPayment order={order} busy={busy} run={run} />

      {order.status === 'assigned' && (
        <div className="active-buttons">
          {needsBill && <small className="muted">These items are priced by the shop — add the shop bill above, then pick up.</small>}
          {order.bill_payment_mode === 'customer_upi' && !order.payment_confirmed_at && (
            <small className="muted">Pick-up unlocks once the shop confirms the customer's UPI payment.</small>
          )}
          <button className="btn btn-primary btn-block" disabled={busy || needsBill || (order.bill_payment_mode === 'customer_upi' && !order.payment_confirmed_at)}
            onClick={() => run(() => api(`/agent/orders/${order.id}/status`, { method: 'POST', body: { status: 'picked_up' } }), isService ? 'On your way!' : 'Picked up. Deliver safely!')}>
            {isService ? '🚀 Start — I\'m on the way' : '📦 Picked up — start delivery'}
          </button>
          <button className="link-btn danger-text" disabled={busy}
            onClick={async () => {
              // event / car / visit bookings: the reason is required — the customer sees it and the booking goes to the next partner
              const reason = await askReason(ahead(order)
                ? { title: `Cancel booking #${order.id}?`, text: 'Tell the customer why. The booking goes to the next partner.', required: true, okText: 'Cancel booking', cancelText: 'Go back' }
                : { title: `Can't do order #${order.id}?`, text: 'Tell us why. It goes back to other agents.', okText: 'Give it back', cancelText: 'Go back' });
              if (reason !== null) run(() => api(`/agent/orders/${order.id}/release`, { method: 'POST', body: { reason } }), ahead(order) ? 'Booking cancelled — it goes to the next partner' : 'Order released');
            }}>
            {ahead(order) ? '✖ Cancel this booking' : "Can't do this order"}
          </button>
        </div>
      )}

      {order.status === 'picked_up' && feePending && (
        <small className="muted center">“Mark {isService ? 'completed' : 'delivered'}” unlocks after the {feeLabel(order).toLowerCase()} is received.</small>
      )}
      {order.status === 'picked_up' && !order.otp_required && (
        <button className="btn btn-primary btn-block btn-success" disabled={busy || feePending}
          onClick={async () => (await askConfirm(`Mark order #${order.id} as ${isService ? 'completed' : 'delivered'}?`, { okText: `Yes, ${isService ? 'completed' : 'delivered'}` })) &&
            run(() => api(`/agent/orders/${order.id}/status`, { method: 'POST', body: { status: 'delivered' } }), '🎉 Delivered! You are free for the next order.')}>
          ✅ Mark {isService ? 'completed' : 'delivered'}
        </button>
      )}

      {order.status === 'picked_up' && order.otp_required && (
        <form className="otp-form" onSubmit={(e) => {
          e.preventDefault();
          run(() => api(`/agent/orders/${order.id}/status`, { method: 'POST', body: { status: 'delivered', otp } }), '🎉 Delivered! You are free for the next order.');
        }}>
          <label>
            Ask the customer for their 4-digit OTP
            <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="• • • •" required pattern="\d{4}" autoComplete="one-time-code" />
          </label>
          <button className="btn btn-primary btn-block btn-success" disabled={busy || otp.length !== 4 || feePending}>
            ✅ Mark {isService ? 'completed' : 'delivered'}
          </button>
        </form>
      )}
    </section>
  );
}
