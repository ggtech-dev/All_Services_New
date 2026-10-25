import { useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, PriceCell, Switch, timeAgo, useLoad, useStaff, useToast } from './ui.jsx';

// 📢 Shop offers (server: db/offers.sql, routes/offers.js) — local shops advertising in the customer app.
//   HQ: shops' requests come here; HQ calls the shop, then approves with the payment (or rejects with a reason);
//       HQ can also create an ad for any city, stop a live one, and set the plan prices per city.
//   Franchise admin: their city's offers and how many people saw / called — read only.
const TYPES = { mobiles: '📱 Mobiles', jewellery: '💍 Jewellery', clothing: '👗 Clothing', food: '🍛 Food & Grocery', electronics: '📺 Electronics', beauty: '💄 Beauty', others: '🏪 Others' };
const day = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function OffersAdmin() {
  const { hq } = useStaff();
  const tabs = hq
    ? [['requests', '📞 Requests'], ['live', '🟢 Live'], ['upcoming', '🗓️ Upcoming'], ['ended', 'Ended'], ['closed', 'Rejected / stopped'], ['plans', '💰 Plans & prices']]
    : [['live', '🟢 Live'], ['upcoming', '🗓️ Upcoming'], ['ended', 'Ended']];
  const [tab, setTab] = useState(tabs[0][0]);
  const data = useLoad(() => (tab === 'plans' ? Promise.resolve(null) : api(`/offers/admin/list?tab=${tab}`)), [tab]);
  const [making, setMaking] = useState(false);
  const d = data.data;

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted toolbar-note">
          {hq ? 'Shops ask to advertise in the app. Call the shop, take the payment and approve — it shows only in that city, from the start date, and ends by itself.'
            : 'Offers of shops in your city (HQ approves them). Customers see them in the "Offers Near You" category.'}
        </p>
        {hq && <button className="btn btn-primary" onClick={() => setMaking(true)}>➕ Create an ad</button>}
      </div>
      <div className="tabs scroll-tabs" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {l}{d?.counts?.[k] ? <span className="count">{d.counts[k]}</span> : ''}
          </button>
        ))}
      </div>
      {hq && d && tab !== 'plans' && <p className="muted small" style={{ margin: 0 }}>💰 Offers income this month: <b>{money(d.income_month)}</b></p>}
      {tab === 'plans' ? <Plans /> : (
        <>
          {data.error && <div className="alert">{data.error}</div>}
          {!d && !data.error && <div className="center-block"><div className="spinner" /></div>}
          {d && !d.offers.length && <p className="muted">Nothing here.</p>}
          <div className="offer-admin-list">
            {d?.offers.map((o) => <OfferRow key={o.id} o={o} tab={tab} hq={hq} onDone={() => data.reload()} />)}
          </div>
        </>
      )}
      {making && <CreateAd onClose={() => setMaking(false)} onDone={() => { setMaking(false); setTab('live'); data.reload(); }} />}
    </div>
  );
}

function OfferRow({ o, tab, hq, onDone }) {
  const toast = useToast();
  const [act, setAct] = useState(null); // approve | reject | stop
  const s = o.stats;
  return (
    <section className={`panel offer-admin ${o.is_top ? 'top' : ''}`}>
      <a href={o.image_url} target="_blank" rel="noreferrer" className="offer-admin-img"><img src={o.image_url} alt="" loading="lazy" /></a>
      <div className="offer-admin-body">
        <div className="offer-admin-title">
          <b>{o.title}</b>
          {o.is_top && <span className="mini-tag">⭐ top</span>}
          {o.is_sample && <span className="mini-tag">sample</span>}
        </div>
        <div className="small"><b>{o.shop_name}</b> · {TYPES[o.category] || o.category}{hq && <> · {o.city}</>}</div>
        <div className="small muted">📍 {o.address}</div>
        <div className="small">
          📞 <a href={`tel:+91${o.phone}`}>{o.phone}</a>{o.owner_name && ` · ${o.owner_name}`}
          {hq && o.from_shop && <span className="muted"> · asked in the app {timeAgo(o.created_at)}</span>}
        </div>
        <div className="small">
          {o.plan_name} · {o.free_launch ? '🎁 free first offer' : money(o.price)}
          {o.state === 'requested' ? ` · wants from ${day(o.starts_on)}` : ` · ${day(o.starts_on)} – ${day(o.ends_on)}`}
          {o.payment_mode && <> · paid {o.payment_mode === 'free' ? 'free' : `${money(o.paid_amount)} by ${o.payment_mode.toUpperCase()}`}</>}
        </div>
        {o.details && <p className="small offer-admin-details">{o.details}</p>}
        {o.reason && <p className="small danger-text">Reason: {o.reason}</p>}
        {o.note && hq && <p className="small muted">Note: {o.note}</p>}
        {['live', 'ended'].includes(tab) && (
          <div className="offer-admin-stats">
            <span><b>{s.seen}</b> seen</span><span><b>{s.opens}</b> opened</span><span><b>{s.calls}</b> calls</span>
            <span><b>{s.whatsapp}</b> WhatsApp</span><span><b>{s.directions}</b> directions</span>
          </div>
        )}
      </div>
      {hq && (
        <div className="offer-admin-acts">
          {tab === 'requests' && <>
            <a className="btn btn-ghost btn-sm" href={`tel:+91${o.phone}`}>📞 Call shop</a>
            <button className="btn btn-primary btn-sm" onClick={() => setAct('approve')}>✓ Approve</button>
            <button className="btn btn-ghost btn-sm danger-text" onClick={() => setAct('reject')}>Reject</button>
          </>}
          {['live', 'upcoming'].includes(tab) && <button className="btn btn-ghost btn-sm danger-text" onClick={() => setAct('stop')}>Stop</button>}
        </div>
      )}
      {act && <Decide o={o} act={act} onClose={() => setAct(null)} onDone={(msg) => { setAct(null); toast(msg); onDone(); }} />}
    </section>
  );
}

function Decide({ o, act, onClose, onDone }) {
  const [mode, setMode] = useState('cash');
  const [amount, setAmount] = useState(String(Number(o.price)));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      if (act === 'approve') {
        await api(`/offers/admin/${o.id}/decide`, { method: 'POST', body: { approve: true, payment_mode: o.free_launch ? null : mode, paid_amount: o.free_launch ? null : amount, note: text } });
        onDone(`Approved — "${o.title}" shows in ${o.city}`);
      } else if (act === 'reject') {
        await api(`/offers/admin/${o.id}/decide`, { method: 'POST', body: { approve: false, reason: text } });
        onDone('Rejected — the shop sees the reason');
      } else {
        await api(`/offers/admin/${o.id}/cancel`, { method: 'POST', body: { reason: text } });
        onDone('Stopped — gone from the app');
      }
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const title = act === 'approve' ? `✓ Approve “${o.title}”` : act === 'reject' ? 'Reject this offer' : 'Stop this offer';
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className={`btn ${act === 'approve' ? 'btn-primary' : 'btn-danger'}`} onClick={go} disabled={busy || (act === 'reject' && text.trim().length < 3)}>
        {act === 'approve' ? 'Approve' : act === 'reject' ? 'Reject' : 'Stop offer'}
      </button>
    </>}>
      <div className="form" style={{ marginTop: 0 }}>
        {error && <div className="alert">{error}</div>}
        {act === 'approve' && (o.free_launch
          ? <p className="ok-msg">🎁 The shop's first offer — free. It goes live in {o.city} from {day(o.starts_on) === '—' ? 'today' : day(o.starts_on)} for {o.days} days.</p>
          : <>
            <p className="small muted" style={{ margin: 0 }}>{o.plan_name} in {o.city}: {money(o.price)}. Record how the shop paid.</p>
            <div className="seg">
              {[['cash', '💵 Cash'], ['upi', '📲 UPI']].map(([k, l]) => <button key={k} type="button" className={mode === k ? 'active' : ''} onClick={() => setMode(k)}>{l}</button>)}
            </div>
            <label>Amount paid (₹)<input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          </>)}
        <label>{act === 'approve' ? 'Note (optional)' : act === 'reject' ? 'Why? (the shop sees this) *' : 'Why? (optional)'}
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={300}
            placeholder={act === 'approve' ? 'e.g. Called Ravi, paid at the shop' : act === 'reject' ? 'e.g. The poster is not clear — please send a better photo' : 'e.g. The shop asked to stop'} />
        </label>
      </div>
    </Modal>
  );
}

// HQ makes an ad for a shop it spoke to (live at once from the start date).
function CreateAd({ onClose, onDone }) {
  const toast = useToast();
  const cities = useLoad(() => api('/offers/admin/prices'));
  const fileRef = useRef(null);
  const [f, setF] = useState({ franchise_id: '', shop_name: '', owner_name: '', phone: '', category: 'mobiles', title: '', details: '', address: '', plan: 'month', starts_on: '', payment_mode: 'cash', paid_amount: '', note: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const list = cities.data?.cities || [];
  const plans = list.find((c) => String(c.franchise_id) === String(f.franchise_id))?.plans || list[0]?.plans || [];
  const plan = plans.find((p) => p.code === f.plan);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (!file) throw new Error('Add the poster');
      const fd = new FormData();
      for (const [k, v] of Object.entries({ ...f, paid_amount: f.paid_amount || plan?.price || '' })) fd.append(k, v);
      fd.append('image', file);
      const o = await api('/offers/admin', { method: 'POST', body: fd });
      toast(`Ad created — live in the app${o.free_launch ? ' (free first offer)' : ''}`);
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="➕ Create an ad for a shop" onClose={onClose} wide footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save} disabled={busy || !f.franchise_id}>Create — live from the start date</button>
    </>}>
      <div className="form" style={{ marginTop: 0 }}>
        {error && <div className="alert">{error}</div>}
        <label>City *
          <select value={f.franchise_id} onChange={set('franchise_id')}>
            <option value="">Choose the city…</option>
            {list.map((c) => <option key={c.franchise_id} value={c.franchise_id}>{c.city}</option>)}
          </select>
        </label>
        <div className="form-row">
          <label>Shop name *<input value={f.shop_name} onChange={set('shop_name')} maxLength={80} /></label>
          <label>Shop mobile *<input value={f.phone} onChange={set('phone')} maxLength={10} inputMode="numeric" /></label>
        </div>
        <div className="form-row">
          <label>Owner<input value={f.owner_name} onChange={set('owner_name')} maxLength={80} /></label>
          <label>Type
            <select value={f.category} onChange={set('category')}>{Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
        </div>
        <label>Address *<input value={f.address} onChange={set('address')} maxLength={200} /></label>
        <label>Offer in a few words *<input value={f.title} onChange={set('title')} maxLength={80} placeholder="e.g. 20% off on all smartphones" /></label>
        <label>Details<textarea rows={2} value={f.details} onChange={set('details')} maxLength={600} /></label>
        <div className="toolbar">
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>{file ? `✅ ${file.name}` : '⬆️ Poster (landscape 1920 × 1080 is best)'}</button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <div className="form-row">
          <label>Plan
            <select value={f.plan} onChange={set('plan')}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name} — ₹{Number(p.price)}</option>)}</select>
          </label>
          <label>Start<input type="date" value={f.starts_on} onChange={set('starts_on')} /></label>
        </div>
        <div className="form-row">
          <label>Paid by
            <select value={f.payment_mode} onChange={set('payment_mode')}><option value="cash">💵 Cash</option><option value="upi">📲 UPI</option></select>
          </label>
          <label>Amount (₹)<input type="number" min="0" value={f.paid_amount} placeholder={plan ? String(Number(plan.price)) : ''} onChange={set('paid_amount')} /></label>
        </div>
        <label>Note<input value={f.note} onChange={set('note')} maxLength={300} placeholder="e.g. Called the owner, paid at the shop" /></label>
        <p className="muted small" style={{ margin: 0 }}>A shop's first offer in a city is free while the launch offer is on (then no payment is recorded).</p>
      </div>
    </Modal>
  );
}

// 💰 HQ: plan prices for each city (click a price to change it) + the free-first-offer switch.
function Plans() {
  const toast = useToast();
  const data = useLoad(() => api('/offers/admin/prices'));
  const d = data.data;
  if (!d) return data.error ? <div className="alert">{data.error}</div> : <div className="center-block"><div className="spinner" /></div>;
  const plans = d.cities[0]?.plans || [];
  const save = async (city, code, price, msg) => {
    await api(`/offers/admin/prices/${city.franchise_id}`, { method: 'PUT', body: { code, price } });
    toast(msg);
    data.reload();
  };
  const free = async (on) => {
    try {
      await api('/offers/admin/free-first', { method: 'PUT', body: { on } });
      toast(on ? 'First offer free: ON' : 'First offer free: OFF');
      data.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <div className="stack">
      <div className="panel">
        <Switch checked={d.free_first} onChange={free} label="🎁 Launch offer: a shop's first offer in a city is free" />
      </div>
      <div className="panel panel-pad">
        <div className="table-scroll">
          <table className="table food-prices">
            <thead><tr><th>City</th>{plans.map((p) => <th key={p.code}>{p.name}<br /><small className="muted">{p.days} days</small></th>)}</tr></thead>
            <tbody>
              {d.cities.map((c) => (
                <tr key={c.franchise_id}>
                  <td><b>{c.city}</b></td>
                  {c.plans.map((p) => (
                    <td key={p.code} className={p.own ? 'own' : ''}>
                      <PriceCell value={p.price} onSave={(v) => save(c, p.code, v, `${p.name} in ${c.city}: ₹${Number(v)}`)} />
                      {p.own && Number(p.price) !== Number(p.default) && (
                        <button className="link-btn small" onClick={() => save(c, p.code, null, `${p.name} in ${c.city}: back to ₹${Number(p.default)}`)}>reset to ₹{Number(p.default)}</button>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted small">Prices in <span className="own">blue</span> are the city's own; the others are the HQ price.</p>
    </div>
  );
}
