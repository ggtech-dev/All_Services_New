import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, formatEta } from '../api.js';
import SmartImage from '../components/SmartImage.jsx';
import { useCart } from '../cart.jsx';
import { qtyLabel, windowLabel } from '../qty.js';
import PhotoPicker from '../components/PhotoPicker.jsx';
import ScrollRow from '../components/ScrollRow.jsx';
import Skeleton from '../components/Skeleton.jsx';

const rupees = (v) => `₹${Number(v).toLocaleString('en-IN')}`;
const SOURCE_ICON = { 'Kirana Delivery': '🛒', 'Fresh Vegetables': '🥬', 'Daily Fresh Meat & Fish': '🍗' };
const tabName = (s) => s.name.replace(/ Delivery$/, '').replace(/^Fresh /, '').replace(/^Daily Fresh /, '');

// Customer page listing the products inside one service (e.g. Milk Delivery, Fresh Vegetables).
// ⚡ Instant Delivery (a service with source shops) shows one tab per source shop + an "Others" write-anything tab.
export default function ServiceShop() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState(params.get('tab') === 'others' ? 'others' : '');
  const [section, setSection] = useState('');
  const cart = useCart();

  useEffect(() => {
    setData(null);
    setError('');
    api(`/services/${slug}`).then(setData).catch((e) => setError(e.message));
  }, [slug]);

  const sources = data?.sources || [];
  const isInstant = sources.length > 0; // ⚡ Instant or 🏡 Village Needs (both show other shops + "Others")
  const village = !!data?.service?.is_village;
  // instant: the source shop whose products are shown ('' = the first one); normal shops: 'pick' or 'list'
  const sourceTab = isInstant && tab !== 'others' ? (sources.find((s) => String(s.id) === tab) || sources[0]) : null;

  const products = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.products || [])
      .filter((p) => !sourceTab || p.source_service_id === sourceTab.id)
      .filter((p) => `${p.name} ${p.brand || ''} ${p.section || ''}`.toLowerCase().includes(q));
  }, [data, search, sourceTab]);
  // sections (kirana: Rice & Grains, Dals & Pulses…) in catalog order, shown as chips and headings
  const sections = useMemo(
    () => [...new Set((data?.products || []).filter((p) => !sourceTab || p.source_service_id === sourceTab.id).map((p) => p.section).filter(Boolean))],
    [data, sourceTab]
  );
  const groups = useMemo(() => {
    const shown = section ? products.filter((p) => p.section === section) : products;
    const out = [];
    for (const p of shown) {
      const name = p.section || '';
      let g = out.find((x) => x.name === name);
      if (!g) out.push((g = { name, items: [] }));
      g.items.push(p);
    }
    return out;
  }, [products, section]);

  if (error) return <div className="alert">{error} — <Link to="/">back home</Link></div>;
  if (!data) return <Skeleton variant="shop" />;

  const { service } = data;
  // the shop a product really comes from (instant: Kirana / Vegetables), for "market price" and the cart
  const shopOf = (p) => {
    const src = isInstant ? sources.find((s) => s.id === p.source_service_id) : null;
    return src ? { ...service, ...src, category_icon: service.category_icon } : service;
  };
  const mode = isInstant ? service : null; // cart mode for anything added on this page
  const add = (p) => cart.withClaim(mode, () => cart.add(p, shopOf(p)));
  const pickTab = (t) => {
    setTab(t);
    setSection('');
  };

  const card = (p) => {
    const onBill = shopOf(p).price_on_bill;
    const off = !onBill && p.mrp && Number(p.mrp) > Number(p.price) ? Math.round((1 - p.price / p.mrp) * 100) : 0;
    const item = cart.itemOf(p.id);
    return (
      <article key={p.id} className={`product-card ${p.in_stock ? '' : 'sold-out'}`}>
        <div className="product-img">
          <SmartImage src={p.image_url} alt={p.name} credit={p.image_credit} fallbackIcon={p.icon || service.category_icon} color={service.category_color} />
          {off > 0 && <span className="off-badge">{off}% OFF</span>}
          {!p.in_stock && <span className="stock-badge">Out of stock</span>}
        </div>
        <div className="product-body">
          {p.brand && <span className="product-brand">{p.brand}</span>}
          <h3>{p.name}</h3>
          <span className="product-unit">{p.unit}</span>
          <div className="product-foot">
            <div>
              {onBill ? (
                <span className="market-price">Market price</span>
              ) : (
                <>
                  <b className="product-price">{rupees(p.price)}</b>
                  {off > 0 && <s className="product-mrp">{rupees(p.mrp)}</s>}
                </>
              )}
            </div>
            {item ? (
              <div className={`stepper ${p.sell_by === 'kg' || p.sell_by === 'litre' ? 'stepper-wide' : ''}`}>
                <button onClick={() => cart.less(p.id)} aria-label={`Less ${p.name}`}>−</button>
                <span>{p.sell_by === 'pack' ? item.qty : qtyLabel(item.qty, p.sell_by)}</span>
                <button onClick={() => cart.more(p.id)} aria-label={`More ${p.name}`}>+</button>
              </div>
            ) : (
              <button className="btn btn-sm add-btn" disabled={!p.in_stock} onClick={() => add(p)}>
                {p.in_stock ? 'ADD' : 'Sold out'}
              </button>
            )}
          </div>
          {item && p.note_options?.length > 0 && <CutChooser product={p} item={item} cart={cart} />}
        </div>
      </article>
    );
  };

  const listCount = cart.lines.filter((l) => l.service_id === service.id && l.name.trim()).length;
  const listOnly = !isInstant && service.allows_list && !(data.products || []).length; // e.g. Medicine Delivery
  const medicine = service.category_slug === 'health';
  const showList = listOnly || (isInstant ? tab === 'others' : tab === 'list' && service.allows_list);

  return (
    <>
      <Link to={`/category/${service.category_slug}`} className="back-link">← {service.category_name}</Link>
      <section className={`shop-header ${isInstant ? (village ? 'village-header' : 'instant-header') : ''}`} style={{ '--accent': service.category_color }}>
        <div className="shop-header-img">
          {isInstant ? <div className="instant-bolt" aria-hidden="true">{village ? '🏡' : '⚡'}</div>
            : <SmartImage src={service.image_url} alt={service.name} fallbackIcon={service.category_icon} color={service.category_color} />}
        </div>
        <div className="shop-header-body">
          <h1>{isInstant && (village ? '🏡 ' : '⚡ ')}{service.name}</h1>
          <p>{service.description || `${data.products.length} items · delivered in about ${formatEta(service.eta_minutes)}`}</p>
          {(isInstant || service.window_from != null || service.price_on_bill) && (
            <div className="shop-facts">
              {isInstant && !village && <span className="fact-chip">⏱️ At your door in about {service.eta_minutes || 15} min</span>}
              {village && <span className="fact-chip">📅 Next-day delivery — choose the day & time at checkout</span>}
              {village && <span className="fact-chip">🚚 Delivered by our own team</span>}
              {!isInstant && service.window_from != null && <span className="fact-chip">🕕 Delivery {windowLabel(service.window_from, service.window_to)}</span>}
              {service.price_on_bill && <span className="fact-chip">🧾 Pay as per the shop bill</span>}
            </div>
          )}
        </div>
        {!showList && !listOnly && <input className="search" placeholder={sourceTab ? `Search ${tabName(sourceTab)}…` : 'Search items…'} value={search} onChange={(e) => setSearch(e.target.value)} />}
      </section>

      {village && <VillageCheck />}

      {listOnly && service.max_items ? (
        <p className="market-note">
          🛠️ Write up to <b>{service.max_items} items</b> (or send a photo). Your delivery partner buys them at a town shop and shares a photo of the
          <b> shop bill</b> — you pay exactly that + {rupees(service.delivery_fee)} delivery. Bills above ₹{Number(service.bill_cash_limit || 1000).toLocaleString('en-IN')} are paid by you
          directly to the shop by UPI. Small things that fit on a bike only. You can choose the shop at checkout.
        </p>
      ) : listOnly && medicine ? (
        <p className="market-note">
          {"Write the medicines or upload a photo of the doctor's prescription. Your partner buys them at a medical shop, shares a photo of the bill in your order, and you pay the shop exactly that amount."}
        </p>
      ) : service.price_on_bill && !isInstant && (
        <p className="market-note">
          Prices change every day at the market, so there are no fixed prices here. Choose what you need — your delivery partner
          buys it fresh, shares a <b>photo of the shop bill</b> in your order, and you pay exactly that.
        </p>
      )}

      {isInstant ? (
        <div className="shop-tabs instant-tabs" role="tablist" style={{ '--accent': service.category_color }}>
          {sources.map((s) => (
            <button type="button" role="tab" key={s.id} aria-selected={sourceTab?.id === s.id} className={sourceTab?.id === s.id ? 'active' : ''} onClick={() => pickTab(String(s.id))}>
              {SOURCE_ICON[s.name] || s.category_icon} {tabName(s)}
            </button>
          ))}
          <button type="button" role="tab" aria-selected={tab === 'others'} className={tab === 'others' ? 'active' : ''} onClick={() => pickTab('others')}>
            {village ? '📦 Other things' : '✍️ Others'}{listCount > 0 && ` (${listCount})`}
          </button>
        </div>
      ) : service.allows_list && !listOnly && (
        <div className="shop-tabs" role="tablist" style={{ '--accent': service.category_color }}>
          <button type="button" role="tab" aria-selected={tab !== 'list'} className={tab !== 'list' ? 'active' : ''} onClick={() => setTab('pick')}>
            🛒 Pick items
          </button>
          <button type="button" role="tab" aria-selected={tab === 'list'} className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
            ✍️ Write your list{listCount > 0 && ` (${listCount})`}
          </button>
        </div>
      )}

      {showList ? (
        <OwnList service={service} cart={cart} mode={mode} instant={isInstant} medicine={medicine} village={village} />
      ) : (
      <>
        {sections.length > 1 && (
          <ScrollRow className="section-chips" label="Sections" activeKey={section} style={{ '--accent': service.category_color }}>
            <button type="button" className={!section ? 'active' : ''} aria-pressed={!section} onClick={() => setSection('')}>All</button>
            {sections.map((name) => (
              <button type="button" key={name} className={section === name ? 'active' : ''} aria-pressed={section === name} onClick={() => setSection(section === name ? '' : name)}>{name}</button>
            ))}
          </ScrollRow>
        )}
        {groups.map((g) => (
          <section key={g.name || 'all'} className="shop-section">
            {g.name && sections.length > 1 && <h2 className="shop-section-title">{g.name} <span className="muted">{g.items.length}</span></h2>}
            <div className="product-grid" style={{ '--accent': service.category_color }}>
              {g.items.map(card)}
            </div>
          </section>
        ))}
        {!products.length && <p className="muted">{search ? `No items match “${search}”.` : 'No items here yet.'}</p>}
        {isInstant && (
          <button type="button" className="instant-write-hint" onClick={() => pickTab('others')}>
            ✍️ Can’t find it? <b>Write anything you need</b> in {village ? 'Other things' : 'Others'} ›
          </button>
        )}
      </>
      )}

      {cart.count > 0 && <div className="cart-bar-space" aria-hidden="true" />}
      {cart.count > 0 && (
        <Link to="/checkout" className={`cart-bar ${cart.via ? (cart.via.village ? 'cart-bar-village' : 'cart-bar-instant') : ''}`} style={{ '--accent': service.category_color }}>
          <span>
            {cart.via ? (cart.via.village ? '🏡' : '⚡') : '🛒'} {cart.count} item{cart.count > 1 ? 's' : ''} ·{' '}
            {cart.subtotal > 0 && <b>₹{cart.subtotal.toLocaleString('en-IN')}</b>}
            {cart.hasBillItems && <>{cart.subtotal > 0 ? ' + ' : ''}<b>shop bill</b></>}
          </span>
          <span>{cart.via ? (cart.via.village ? 'Village order →' : 'Instant order →') : 'View cart →'}</span>
        </Link>
      )}
    </>
  );
}

// "How should we cut it?" — tap one or more choices, or type your own.
function CutChooser({ product, item, cart }) {
  return (
    <div className="cut-chooser">
      <small>✂️ How should we cut it?</small>
      <div className="cut-chips">
        {product.note_options.map((c) => (
          <button key={c} type="button" className={item.cuts?.includes(c) ? 'active' : ''} aria-pressed={!!item.cuts?.includes(c)} onClick={() => cart.toggleCut(product.id, c)}>
            {c}
          </button>
        ))}
      </div>
      <input value={item.extra || ''} onChange={(e) => cart.setExtra(product.id, e.target.value)} placeholder="Other instructions (optional)" maxLength={120} />
    </div>
  );
}

// "Write your list": item + quantity lines, and/or a photo of a handwritten list. Priced by the shop bill.
// Instant "Others": write anything you need (the quantity is optional).
function OwnList({ service, cart, mode, instant, medicine, village }) {
  const [photoError, setPhotoError] = useState('');
  const mine = cart.lines.filter((l) => l.service_id === service.id);
  const photo = cart.photo?.service_id === service.id ? cart.photo.file : null;
  // always one empty line to type into
  useEffect(() => {
    if (!mine.length) cart.ensureLine(service);
  }, [mine.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // writing something puts the cart in this page's mode (instant or normal) — asks first if it holds the other kind
  const edit = (key, change) => cart.withClaim(mode, () => cart.updateLine(key, change));
  return (
    <section className="own-list panel" style={{ '--accent': service.category_color }}>
      <p className="muted small">
        {medicine
          ? 'Write the medicine names and how many, or just upload the prescription photo below.'
          : village
          ? 'Anything that is not in the shop tabs — bike parts, medicines, stationery, a mobile charger… Write it, or send a photo of your list. Our team buys it in town, shares the bill and brings it to your village.'
          : instant
          ? 'Write anything you need — medicines, stationery, snacks, a forgotten item from home… The quantity is optional. Your instant delivery partner gets it and shares the bill.'
          : 'Write what you need, like you would on paper. Your delivery partner buys it and shares the shop bill.'}
      </p>
      <div className="own-lines">
        {mine.map((l, i) => (
          <div className="own-line" key={l.key}>
            <span className="own-no">{i + 1}.</span>
            <input value={l.name} onChange={(e) => edit(l.key, { name: e.target.value.slice(0, 80) })} placeholder={i === 0 ? (medicine ? 'Medicine, e.g. Dolo 650' : village ? 'e.g. Splendor bike clutch cable' : instant ? 'What do you need? e.g. Dolo 650 tablets' : 'Item, e.g. Sugar') : medicine ? 'Medicine' : 'Item'} aria-label={`Item ${i + 1}`} />
            <input className="own-qty" value={l.qty_text} onChange={(e) => edit(l.key, { qty_text: e.target.value.slice(0, 30) })} placeholder={instant ? 'Qty' : i === 0 ? (medicine ? 'e.g. 10 tablets' : 'e.g. 2 kg') : 'Qty'} aria-label={`Quantity of item ${i + 1}`} />
            <button type="button" className="own-remove" onClick={() => cart.removeLine(l.key)} aria-label={`Remove item ${i + 1}`}>✕</button>
          </div>
        ))}
      </div>
      {/* 🛠️ Shop For Me: up to service.max_items items per order */}
      <button type="button" className="btn btn-ghost btn-sm own-add" onClick={() => cart.addLine(service)} disabled={mine.length >= (service.max_items || 40)}>
        {service.max_items && mine.length >= service.max_items ? `Up to ${service.max_items} items per order` : '➕ Add another item'}
      </button>
      <div className="own-photo">
        <PhotoPicker label={medicine ? "📷 Upload the doctor's prescription" : '📷 Or send a photo of your list'} file={photo} onFile={(f) => cart.withClaim(mode, () => cart.setPhoto(f, service).catch((e) => setPhotoError(e.message)))} cameraFirst={false} />
        {photoError && <small className="danger-text">{photoError}</small>}
        {photo && <small className="muted">✓ Your {medicine ? 'partner' : 'delivery partner'} will see this photo with your order.</small>}
      </div>
    </section>
  );
}

// 🏡 "Is my village covered?" — the villages the franchise admin added, with their delivery charge.
function VillageCheck() {
  const [villages, setVillages] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    api('/localities').then((list) => setVillages(list.filter((l) => l.is_village))).catch(() => setVillages([]));
  }, []);
  const term = q.trim().toLowerCase();
  const hit = term ? (villages || []).filter((v) => v.name.toLowerCase().includes(term)) : [];
  return (
    <section className="village-check">
      <label>
        🔎 Check your village
        <input value={q} onChange={(e) => setQ(e.target.value.slice(0, 40))} placeholder="Type your village name" />
      </label>
      {term.length >= 2 && villages && (hit.length ? (
        <ul>{hit.slice(0, 5).map((v) => <li key={v.id}>✅ We deliver to <b>{v.name}</b> — delivery charge <b>{rupees(v.village_fee)}</b></li>)}</ul>
      ) : (
        <p className="village-no">❌ Sorry, this service is not available for “{q.trim()}” yet.</p>
      ))}
      {villages && <small className="muted">{villages.length} villages · within 15 km of town · delivery charge {[...new Set(villages.map((v) => rupees(v.village_fee)))].join(' / ') || '—'}</small>}
    </section>
  );
}
