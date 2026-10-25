import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie, Minus, Moon, Plus, Sun } from 'lucide-react';
import { api } from '../api.js';
import { useCart } from '../cart.jsx';
import { askConfirm } from '../components/ConfirmDialog.jsx';
import BackLink from '../components/BackLink.jsx';

// 🍱 Order Your Food for Tomorrow (homefood.sql): the menu card photo the franchise admin uploaded, Lunch / Dinner /
// Snacks, then Veg or Chicken / Mutton / Fish plates (or snack packs) → the cart → checkout (the slot is that meal
// tomorrow, cash on delivery). A fixed menu, like a hotel: everyone gets the day's dishes (shown on the veg card);
// customers don't choose them. Each meal is an order of its own: other items in the cart are cleared after asking.
const TABS = [['lunch', Sun, 'Lunch'], ['dinner', Moon, 'Dinner'], ['snacks', Cookie, 'Snacks']];
const MEAL_WORD = { lunch: 'lunch', dinner: 'dinner', snacks: 'snacks' };
export default function MealPage() {
  const cart = useCart();
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState('');
  const [meal, setMeal] = useState('lunch');
  const [bigPhoto, setBigPhoto] = useState(false);

  useEffect(() => {
    api('/meal-menu').then(setMenu).catch((e) => setError(e.message));
  }, []);

  const day = menu?.[meal];
  const plates = useMemo(() => (menu?.products || []).filter((p) => p.meal === meal), [menu, meal]);
  const snacks = meal === 'snacks';
  const veg = snacks ? null : plates.find((p) => /^Veg/.test(p.name));
  const nonVeg = snacks ? [] : plates.filter((p) => !/^Veg/.test(p.name));
  // the meal plates already in the cart (this page's kind only)
  const mealItems = cart.items.filter((i) => (menu?.products || []).some((p) => p.id === i.product_id));
  const plateCount = mealItems.reduce((n, i) => n + i.qty, 0);
  const cartIsSnacks = mealItems.length > 0 && mealItems.every((i) => /^home-food-snack-/.test(i.slug || (menu?.products || []).find((p) => p.id === i.product_id)?.slug || ''));
  const plateTotal = mealItems.reduce((n, i) => n + i.qty * i.price, 0);

  // each meal is its own order (lunch, dinner or snacks): anything else in the cart goes first, after asking.
  // 'kept' = nothing to clear · 'cleared' = the cart was emptied · false = the customer kept their cart
  const makeRoom = async () => {
    const others = cart.items.some((i) => !plates.some((p) => p.id === i.product_id)) || cart.lines.some((l) => l.name.trim()) || !!cart.photo || !!cart.via;
    if (!others) return 'kept';
    const ok = await askConfirm(`Your cart has other items. Food for ${MEAL_WORD[meal]} tomorrow is a separate order.\n\nClear the cart and add ${snacks ? 'these snacks' : 'this meal'}?`,
      { okText: 'Clear cart and add', cancelText: 'Keep my cart' });
    if (!ok) return false;
    cart.clear();
    return 'cleared';
  };
  const addPlates = async (p, n) => {
    const room = await makeRoom();
    if (!room) return;
    const svc = { id: p.service_id, name: p.service_name, category_icon: '🍱', price_on_bill: false };
    const had = room === 'kept' ? cart.itemOf(p.id) : null;
    if (!had) {
      cart.add({ ...p, sell_by: 'pack' }, svc);
      cart.setQty(p.id, n);
    } else {
      cart.setQty(p.id, had.qty + n);
    }
  };

  if (error) return <div className="alert">{error}</div>;
  if (!menu) return <div className="center-block"><div className="spinner" /></div>;
  const todays = snacks ? [] : [...day.curries, ...day.charus];

  return (
    <div className="meal-page">
      <BackLink to="/">Back</BackLink>
      <section className="meal-hero">
        <h1>🍱 Order your food for tomorrow</h1>
        <p>
          Home-style lunch, dinner & snacks for <b>{menu.is_tomorrow ? `tomorrow, ${menu.day_label}` : menu.day_label}</b>.
          {' '}{menu.is_tomorrow ? `Order by ${menu.cutoff_hour > 12 ? menu.cutoff_hour - 12 : menu.cutoff_hour} PM tonight.` : "Tonight's orders have closed — you're ordering for the day after."}
        </p>
        <div className="meal-chips"><span>🏠 Home-style</span><span>🚚 Delivered to your door</span><span>💵 Cash on delivery</span></div>
      </section>

      {menu.photo && (
        <button type="button" className="meal-photo" onClick={() => setBigPhoto(true)} aria-label="Open the menu card">
          <img src={menu.photo} alt={`Menu for ${menu.day_label}`} />
          <span>📋 Menu card · tap to open</span>
        </button>
      )}
      {bigPhoto && (
        <div className="meal-photo-big" role="dialog" aria-label="Menu card" onClick={() => setBigPhoto(false)}>
          <img src={menu.photo} alt={`Menu for ${menu.day_label}`} />
          <button type="button" aria-label="Close">✕</button>
        </div>
      )}

      <div className="meal-tabs" role="tablist" aria-label="Lunch, dinner or snacks">
        {TABS.map(([k, Icon, label]) => (
          <button key={k} type="button" role="tab" aria-selected={meal === k} className={meal === k ? 'active' : ''} onClick={() => setMeal(k)}>
            <Icon size={18} aria-hidden="true" /> <b>{label}</b> <small>{menu[k].slot.split(', ')[1].replace(/^(Lunch|Dinner|Snacks) /, '')}</small>
          </button>
        ))}
      </div>

      {veg && (
        <MealCard p={veg} icon="🥗" onAdd={(n) => addPlates(veg, n)}>
          {todays.length ? <p className="meal-today">🍛 <b>{meal === 'lunch' ? 'Lunch' : 'Dinner'} menu:</b> {todays.join(' · ')} · rice · curd</p>
            : <p className="meal-today muted">🍛 Today's dishes will be shown here — the same home-style menu for everyone.</p>}
        </MealCard>
      )}

      {!snacks && <h2 className="meal-sub">🍗 Non-veg meals</h2>}
      {!snacks && (
        <div className="meal-nonveg">
          {nonVeg.map((p) => <MealCard key={p.id} p={p} onAdd={(n) => addPlates(p, n)} />)}
        </div>
      )}

      {snacks && (
        <>
          <p className="meal-today">{`🥨 Fresh home-made snacks, delivered tomorrow (${menu.snacks.slot.split(', ')[1].replace(/^Snacks /, '')}). Each pack ${plates[0]?.unit || '250 g'}.`}</p>
          {plates.length ? (
            <div className="meal-nonveg meal-snacks">
              {plates.map((p) => <MealCard key={p.id} p={p} word="pack" onAdd={(n) => addPlates(p, n)} />)}
            </div>
          ) : <p className="meal-today muted">Snacks are coming soon.</p>}
        </>
      )}

      {plateCount > 0 && (
        <>
          <div className="cart-bar-space" aria-hidden="true" />
          <Link to="/checkout" className="cart-bar meal-cart-bar">
            <span>{cartIsSnacks ? '🥨' : '🍱'} {plateCount} {cartIsSnacks ? 'pack' : 'plate'}{plateCount > 1 ? 's' : ''} · <b>₹{plateTotal.toLocaleString('en-IN')}</b></span>
            <span>Checkout →</span>
          </Link>
        </>
      )}
    </div>
  );
}

function MealCard({ p, icon, word = 'plate', onAdd, children }) {
  const [n, setN] = useState(1);
  return (
    <section className={`meal-card ${children ? 'meal-veg' : 'meal-nv'}`}>
      <div className="meal-card-head">
        <span className="meal-icon" aria-hidden="true">{p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : icon || p.icon}</span>
        <div>
          <h3>{p.name.replace(/ — .*/, '')}</h3>
          <small>{p.description}{word === 'pack' && p.unit ? ` · ${p.unit}` : ''}</small>
        </div>
        <b className="meal-price">₹{Number(p.price)}</b>
      </div>
      {children}
      <div className="meal-add-row">
        <Stepper value={n} onChange={setN} word={word} />
        <button type="button" className="meal-add" onClick={() => { onAdd(n); setN(1); }}>Add {n} · ₹{Number(p.price) * n}</button>
      </div>
    </section>
  );
}

function Stepper({ value, onChange, word = 'plate' }) {
  return (
    <div className="meal-stepper" aria-label={`${word[0].toUpperCase()}${word.slice(1)}s`}>
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))} aria-label={`One ${word} less`}><Minus size={16} /></button>
      <span>{value} {value === 1 ? word : `${word}s`}</span>
      <button type="button" onClick={() => onChange(Math.min(20, value + 1))} aria-label={`One ${word} more`}><Plus size={16} /></button>
    </div>
  );
}
