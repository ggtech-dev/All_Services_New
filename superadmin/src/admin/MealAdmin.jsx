import { useRef, useState } from 'react';
import { api } from '../api.js';
import { askConfirm } from '../components/ConfirmDialog.jsx';
import { Modal, useLoad, useStaff, useToast } from './ui.jsx';

// 🍱 Order Your Food for Tomorrow — the city's daily menu (server: db/homefood.sql, routes/adminOps.js /meal-menu).
//   Each day: the curries and charus for lunch and dinner (a fixed menu, like a hotel — customers don't choose), and a photo of the menu card. Customers order until
//   the cut-off hour for the next day. The kitchen count shows how many plates of each meal to cook that day.
//   Prices are set by HQ for each city; a franchise asks HQ for a change (Requests to HQ).
const MEALS = [['lunch', '☀️ Lunch'], ['dinner', '🌙 Dinner']];
const KITCHEN = [['lunch', '☀️ Lunch', 'plates'], ['dinner', '🌙 Dinner', 'plates'], ['snacks', '🥨 Snacks', 'packs']];
const KINDS = [['curry', 'Curries', '2 in the veg meal'], ['charu', 'Charus', '1 in the veg meal']];
const PRICE_NAMES = {
  veg: 'Veg meal (2 curries + 1 charu)', chicken: 'Chicken meal', mutton: 'Mutton meal', fish: 'Fish meal',
  cook_hour: '👩‍🍳 Cook — per hour', cook_half: '👩‍🍳 Cook — each extra half hour',
};
const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const shiftDay = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

export default function MealAdmin() {
  const toast = useToast();
  const { hq } = useStaff();
  const [date, setDate] = useState('');
  const data = useLoad(() => api(`/admin/meal-menu${date ? `?date=${date}` : ''}`), [date]);
  const [asking, setAsking] = useState(false);
  const d = data.data;

  const run = async (fn, msg) => {
    try {
      await fn();
      if (msg) toast(msg);
      data.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  if (data.error) return <div className="alert">{data.error}</div>;
  if (!d) return <div className="center-block"><div className="spinner" /></div>;
  const day = d.date;
  const isNext = day === d.ordering_for;
  const remove = (it) => run(() => api(`/admin/meal-menu/${it.id}`, { method: 'DELETE' }));
  const copyFrom = async () => {
    const from = shiftDay(day, -1);
    run(async () => {
      const r = await api('/admin/meal-menu/copy', { method: 'POST', body: { from, to: day } });
      toast(r.copied ? `Copied ${r.copied} dishes from ${dayLabel(from)}` : `Nothing new to copy from ${dayLabel(from)}`);
    });
  };
  const dropPhoto = async () => (await askConfirm('Remove the menu-card photo of this day?', { okText: 'Remove', cancelText: 'Keep' }))
    && run(() => api(`/admin/meal-menu/photo?date=${day}`, { method: 'DELETE' }), 'Photo removed');
  const k = d.kitchen;

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted toolbar-note">
          Put the menu for each day. Customers order until <b>{fmtHour(d.cutoff_hour)}</b> for the next day and pay cash on delivery.
          Orders go to agents of the type <b>Tomorrow's meals</b>.
        </p>
      </div>

      <div className="panel">
        <div className="panel-head meal-day">
          <div>
            <h3>📅 {dayLabel(day)} {isNext && <span className="meal-now-tag">customers are ordering for this day now</span>}</h3>
            <p className="muted small" style={{ margin: 0 }}>Change the day to plan ahead or see past days.</p>
          </div>
          <div className="toolbar">
            <button className="btn btn-ghost" onClick={() => setDate(shiftDay(day, -1))} aria-label="Day before">‹</button>
            <input type="date" value={day} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Menu day" />
            <button className="btn btn-ghost" onClick={() => setDate(shiftDay(day, 1))} aria-label="Next day">›</button>
            {!isNext && <button className="btn btn-ghost" onClick={() => setDate(d.ordering_for)}>Ordering day</button>}
            <button className="btn btn-ghost" onClick={copyFrom}>📋 Copy from the day before</button>
          </div>
        </div>

        <div className="meal-admin-grid">
          {MEALS.map(([meal, title]) => (
            <div key={meal} className="meal-admin-col">
              <h4>{title}</h4>
              {KINDS.map(([kind, label, hint]) => (
                <DishList key={kind} label={label} hint={hint} items={d.items.filter((i) => i.meal === meal && i.kind === kind)} onRemove={remove}
                  onAdd={(name) => run(() => api('/admin/meal-menu', { method: 'POST', body: { date: day, meal, kind, name } }))} />
              ))}
            </div>
          ))}
        </div>
        <p className="muted small">Customers see these dishes on the meal page; everyone gets the same menu. {!d.items.length && 'No dishes yet for this day.'}</p>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>🖼️ Menu card photo</h3></div>
        <MenuPhoto url={d.photo} date={day} onDone={(msg) => { toast(msg); data.reload(); }} onError={(m) => toast(m, 'error')} onRemove={dropPhoto} />
      </div>

      <div className="panel">
        <div className="panel-head"><h3>🍳 Kitchen — what to cook on {dayLabel(day)}</h3><span className="muted small">{k.orders} orders</span></div>
        {!k.plates.length ? <p className="muted">No orders for this day yet.</p> : (
          <div className="meal-admin-grid">
            {KITCHEN.map(([meal, title, unit]) => {
              const plates = k.plates.filter((p) => p.meal === meal);
              return (
                <div key={meal} className="meal-admin-col">
                  <h4>{title} · {plates.reduce((s, p) => s + Number(p.plates), 0)} {unit}</h4>
                  {!plates.length ? <p className="muted small">No orders.</p> : (
                    <table className="table"><tbody>
                      {plates.map((p) => <tr key={p.name}><td>{p.name}</td><td className="num"><b>{Number(p.plates)}</b> {unit}</td></tr>)}
                    </tbody></table>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="muted small">Each order, the customer's address and the time are in Orders &amp; bookings. Snack prices and photos: Master products (HQ).</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>💰 Prices in this city</h3>
          {hq ? <span className="muted small">Change them on the “Food &amp; cook prices” page</span>
            : <button className="btn btn-ghost" onClick={() => setAsking(true)}>📝 Ask HQ for a price change</button>}
        </div>
        <table className="table"><tbody>
          {d.plates.map((p) => <tr key={p.item}><td>{PRICE_NAMES[p.item]}</td><td className="num"><b>₹{Number(p.price)}</b></td></tr>)}
        </tbody></table>
        {!hq && <p className="muted small">HQ sets these prices. Ask for a change — HQ approves it in Requests to HQ.</p>}
      </div>

      {asking && <PriceRequest prices={d.plates} onClose={() => setAsking(false)} onSent={() => { setAsking(false); toast('Sent to HQ — see Requests to HQ'); }} />}
    </div>
  );
}

const fmtHour = (h) => (h === 12 ? '12 noon' : h > 12 ? `${h - 12} PM` : `${h} AM`);

function DishList({ label, hint, items, onAdd, onRemove }) {
  const [name, setName] = useState('');
  const add = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return;
    await onAdd(name.trim());
    setName('');
  };
  return (
    <div className="dish-list">
      <div className="small"><b>{label}</b> <span className="muted">· {hint}</span></div>
      <div className="chip-row">
        {items.map((it) => (
          <span key={it.id} className="dish-chip">{it.name}<button type="button" onClick={() => onRemove(it)} aria-label={`Remove ${it.name}`}>×</button></span>
        ))}
        {!items.length && <span className="muted small">none yet</span>}
      </div>
      <form className="dish-add" onSubmit={add}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Add a ${label === 'Curries' ? 'curry' : 'charu'} (e.g. ${label === 'Curries' ? 'Tomato Pappu' : 'Sambar'})`} maxLength={60} />
        <button className="btn btn-primary" disabled={name.trim().length < 2}>Add</button>
      </form>
    </div>
  );
}

function MenuPhoto({ url, date, onDone, onError, onRemove }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('date', date);
      fd.append('image', file);
      await api('/admin/meal-menu/photo', { method: 'POST', body: fd });
      onDone('Menu photo saved — customers see it on the meal page');
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="menu-photo-admin">
      <div className="menu-photo-box">
        {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Menu card" /></a> : <span>🍱</span>}
        {busy && <div className="image-busy"><div className="spinner" /></div>}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <p className="muted small" style={{ margin: 0 }}>A clear photo of the day's menu card with prices (JPG, PNG or WEBP, up to 5 MB). Customers can zoom it.</p>
        <div className="toolbar">
          <button className="btn btn-primary" onClick={() => ref.current?.click()} disabled={busy}>{url ? '🔁 Change photo' : '⬆️ Upload photo'}</button>
          {url && <button className="btn btn-ghost danger-text" onClick={onRemove}>Remove</button>}
        </div>
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick} />
      </div>
    </div>
  );
}

function PriceRequest({ prices, onClose, onSent }) {
  const [item, setItem] = useState('veg');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const now = prices.find((p) => p.item === item)?.price;
  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/admin/meal-menu/price-request', { method: 'POST', body: { item, price, note } });
      onSent();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="📝 Ask HQ for a price change" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={send} disabled={busy || !(Number(price) >= 0) || price === ''}>Send to HQ</button>
    </>}>
      <div className="form" style={{ marginTop: 0 }}>
        {error && <div className="alert">{error}</div>}
        <label>What
          <select value={item} onChange={(e) => setItem(e.target.value)}>
            {prices.map((p) => <option key={p.item} value={p.item}>{PRICE_NAMES[p.item]}</option>)}
          </select>
        </label>
        <p className="muted small" style={{ margin: 0 }}>Now ₹{Number(now)}</p>
        <label>New price (₹)
          <input type="number" min="0" max="5000" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label>Why? (optional)
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. chicken is costlier here" />
        </label>
      </div>
    </Modal>
  );
}
