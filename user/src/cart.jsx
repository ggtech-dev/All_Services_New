import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';
import { countOf, nextQty, prevQty } from './qty.js';
import { dataUrlToFile, shrinkPhoto } from './photos.js';
import { askConfirm } from './components/ConfirmDialog.jsx';

// Shopping cart kept in this browser, per logged-in user — or for a guest who is just looking around. At sign-in
// the guest's cart moves into the account. Prices here are only for display: the server recalculates everything
// from the database when the order is placed.
const CartContext = createContext(null);

// At sign-in: the guest's cart, own list, list photo and cart mode (instant or normal) move into the account.
// Same kind of cart on both sides → combined; otherwise the guest's (newest) choice wins. Safe to call often.
function adoptGuestCart(userId) {
  try {
    const get = (k) => JSON.parse(localStorage.getItem(k));
    const gItems = get('as_cart_guest') || [];
    const gLines = (get('as_list_guest') || []).filter((l) => l.name?.trim());
    const gPhoto = get('as_list_guest_photo');
    if (!gItems.length && !gLines.length && !gPhoto) return;
    const gVia = get('as_cart_guest_via');
    const uItems = get(`as_cart_${userId}`) || [];
    const uLines = get(`as_list_${userId}`) || [];
    const uVia = get(`as_cart_${userId}_via`);
    const sameKind = (gVia?.id || null) === (uVia?.id || null);
    const items = sameKind ? [...uItems.filter((u) => !gItems.some((g) => g.product_id === u.product_id)), ...gItems] : gItems;
    const lines = sameKind ? [...uLines.filter((l) => l.name?.trim()), ...gLines] : gLines;
    localStorage.setItem(`as_cart_${userId}`, JSON.stringify(items));
    localStorage.setItem(`as_list_${userId}`, JSON.stringify(lines));
    if (gPhoto) localStorage.setItem(`as_list_${userId}_photo`, JSON.stringify(gPhoto));
    if (gVia) localStorage.setItem(`as_cart_${userId}_via`, JSON.stringify(gVia));
    else if (!sameKind) localStorage.removeItem(`as_cart_${userId}_via`);
    for (const k of ['as_cart_guest', 'as_list_guest', 'as_list_guest_photo', 'as_cart_guest_via']) localStorage.removeItem(k);
  } catch {
    /* storage unavailable: nothing to move */
  }
}

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
};

export function CartProvider({ children }) {
  const { user } = useAuth();
  if (user) adoptGuestCart(user.id);
  const who = user ? user.id : 'guest';
  const key = `as_cart_${who}`;
  // The cart remembers whose it is, so switching users never writes one user's cart into another's.
  const [cart, setCart] = useState(() => ({ key, items: key ? read(key) : [] }));
  if (cart.key !== key) setCart({ key, items: key ? read(key) : [] });
  const items = cart.key === key ? cart.items : [];
  const setItems = (update) => setCart((c) => ({ ...c, items: update(c.items) }));

  useEffect(() => {
    if (!cart.key) return;
    try {
      localStorage.setItem(cart.key, JSON.stringify(cart.items));
    } catch {
      /* storage unavailable: cart just won't survive a reload */
    }
  }, [cart]);

  // The customer's own list (kirana…): typed lines and a (made smaller) photo of a handwritten list are kept
  // like the cart, so a page reload doesn't lose them.
  const listKey = `as_list_${who}`;
  const readPhoto = (k) => {
    try {
      return JSON.parse(localStorage.getItem(`${k}_photo`)) || null;
    } catch {
      return null;
    }
  };
  const [own, setOwn] = useState(() => ({ key: listKey, lines: listKey ? read(listKey) : [], photo: listKey ? readPhoto(listKey) : null }));
  if (own.key !== listKey) setOwn({ key: listKey, lines: listKey ? read(listKey) : [], photo: listKey ? readPhoto(listKey) : null });
  const lines = own.key === listKey ? own.lines : [];
  const photoData = own.key === listKey ? own.photo : null; // { dataUrl, service_id, service_name }
  const photo = useMemo(() => (photoData ? { ...photoData, file: dataUrlToFile(photoData.dataUrl) } : null), [photoData]);
  useEffect(() => {
    if (!own.key) return;
    try {
      localStorage.setItem(own.key, JSON.stringify(own.lines));
      if (own.photo) localStorage.setItem(`${own.key}_photo`, JSON.stringify(own.photo));
      else localStorage.removeItem(`${own.key}_photo`);
    } catch {
      /* storage full or unavailable: the photo just won't survive a reload */
    }
  }, [own]);

  // ⚡ Instant Delivery has its own cart mode: { id, name, slug } while the cart holds an instant order, else null.
  // Instant items and normal items never mix (they go to different agents and have different delivery times).
  const viaKey = `as_cart_${who}_via`;
  const readVia = (k) => {
    try {
      return JSON.parse(localStorage.getItem(k)) || null;
    } catch {
      return null;
    }
  };
  const [viaState, setViaState] = useState(() => ({ key: viaKey, via: viaKey ? readVia(viaKey) : null }));
  if (viaState.key !== viaKey) setViaState({ key: viaKey, via: viaKey ? readVia(viaKey) : null });
  const via = viaState.key === viaKey ? viaState.via : null;
  const setVia = (v) => {
    setViaState((st) => ({ ...st, via: v }));
    try {
      if (viaKey) v ? localStorage.setItem(viaKey, JSON.stringify(v)) : localStorage.removeItem(viaKey);
    } catch {
      /* storage unavailable */
    }
  };

  const value = useMemo(() => {
    const setQty = (productId, qty) =>
      setItems((list) =>
        qty <= 0 ? list.filter((i) => i.product_id !== productId) : list.map((i) => (i.product_id === productId ? { ...i, qty: Math.min(qty, 50) } : i))
      );
    const update = (productId, change) => setItems((list) => list.map((i) => (i.product_id === productId ? { ...i, ...change } : i)));
    const find = (productId) => items.find((i) => i.product_id === productId);
    const setLines = (update) => setOwn((o) => ({ ...o, lines: update(o.lines) }));
    const hasContent = items.length > 0 || lines.some((x) => x.name.trim()) || !!photo;
    return {
      items,
      via,
      // Adds something (fn) after making sure the cart is in the right mode. `target` = the instant service, or null
      // for a normal shop. If the cart holds the other kind of order, the app asks first (in-app box, no browser pop-up)
      // and runs fn only after "Clear cart and continue".
      withClaim: (target, fn) => {
        const want = target ? { id: target.id, name: target.name, slug: target.slug } : null;
        if ((via?.id || null) === (want?.id || null)) return fn();
        const start = () => {
          setItems(() => []);
          setOwn((o) => ({ ...o, lines: [], photo: null }));
          setVia(want);
          return fn();
        };
        if (!hasContent) {
          setVia(want);
          return fn();
        }
        const msg = want
            ? `Your cart has items for a normal delivery. ⚡ ${want.name} is a separate order.

Clear the cart and start an instant order?`
            : `Your cart has a ⚡ ${via.name} order. Normal shop items are a separate order.

Clear the cart and start a new one?`;
        askConfirm(msg, { okText: 'Clear cart and continue', cancelText: 'Keep my cart' }).then((yes) => yes && start());
        return undefined;
      },
      // own list: [{ key, service_id, service_name, name, qty_text }] · photo: { file, service_id, service_name } | null
      lines,
      photo,
      addLine: (service) => setLines((l) => [...l, { key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, service_id: service.id, service_name: service.name, name: '', qty_text: '' }].slice(0, 40)),
      // one empty line to type into (safe to call twice)
      ensureLine: (service) => setLines((l) => (l.some((x) => x.service_id === service.id) ? l : [...l, { key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, service_id: service.id, service_name: service.name, name: '', qty_text: '' }])),
      updateLine: (key, change) => setLines((l) => l.map((x) => (x.key === key ? { ...x, ...change } : x))),
      removeLine: (key) => setLines((l) => l.filter((x) => x.key !== key)),
      setPhoto: async (file, service) => {
        if (!file) return setOwn((o) => ({ ...o, photo: null }));
        const dataUrl = await shrinkPhoto(file).catch(() => null);
        if (!dataUrl) throw new Error('This photo could not be read. Please try another one.');
        setOwn((o) => ({ ...o, photo: { dataUrl, service_id: service.id, service_name: service.name } }));
      },
      // 1.5 kg of tomatoes is one item on the badge; 3 milk packets are three; each own-list line is one
      count: items.reduce((n, i) => n + countOf(i.qty, i.sell_by), 0) + lines.filter((x) => x.name.trim()).length + (photo ? 1 : 0),
      // items priced by the shop bill (vegetables, meat…) are not in the total yet
      subtotal: items.reduce((n, i) => n + (i.on_bill ? 0 : Number(i.price) * i.qty), 0),
      hasBillItems: items.some((i) => i.on_bill) || lines.some((x) => x.name.trim()) || !!photo,
      qtyOf: (productId) => find(productId)?.qty || 0,
      itemOf: find,
      // first tap: 1 kg / 1 L / 1 pack; then the next step (250 g steps for kg)
      add: (product, service) =>
        setItems((list) =>
          list.some((i) => i.product_id === product.id)
            ? list.map((i) => (i.product_id === product.id ? { ...i, qty: nextQty(i.qty, i.sell_by) } : i))
            : [...list, {
                product_id: product.id, name: product.name, brand: product.brand, unit: product.unit,
                price: Number(product.price), mrp: product.mrp ? Number(product.mrp) : null,
                icon: product.icon || service?.category_icon, image_url: product.image_url,
                service_id: service?.id, service_name: service?.name, qty: 1,
                sell_by: product.sell_by || 'pack', on_bill: !!service?.price_on_bill,
                note_options: product.note_options || null, cuts: [], extra: '',
              }]
        ),
      less: (productId) => {
        const i = find(productId);
        if (i) setQty(productId, prevQty(i.qty, i.sell_by));
      },
      more: (productId) => {
        const i = find(productId);
        if (i) setQty(productId, nextQty(i.qty, i.sell_by));
      },
      // cutting instructions: tapped choices + free text → "Curry cut, Skinless, small pieces please"
      toggleCut: (productId, cut) => {
        const i = find(productId);
        if (i) update(productId, { cuts: i.cuts?.includes(cut) ? i.cuts.filter((c) => c !== cut) : [...(i.cuts || []), cut] });
      },
      setExtra: (productId, extra) => update(productId, { extra: extra.slice(0, 120) }),
      setQty,
      remove: (productId) => setQty(productId, 0),
      clear: () => {
        setItems(() => []);
        setOwn((o) => ({ ...o, lines: [], photo: null }));
        setVia(null);
      },
    };
  }, [items, lines, photo, via]); // eslint-disable-line react-hooks/exhaustive-deps

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);

// The note sent with an item: tapped cutting choices + the customer's own words.
export const itemNote = (i) => [...(i.cuts || []), (i.extra || '').trim()].filter(Boolean).join(', ');
