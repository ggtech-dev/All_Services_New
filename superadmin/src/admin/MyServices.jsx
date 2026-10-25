import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { askConfirm } from '../components/ConfirmDialog.jsx';
import { Modal, Switch, timeAgo, useLoad, useToast } from './ui.jsx';

// The services (and their products) a franchise offers.
//   Franchise admin: sees what is on; asks HQ for anything else (they cannot switch things on/off themselves).
//     🚫 They do mark products in / out of stock in their own city (stock.sql) — Products of a service, or the
//     "Out of stock" panel on top with "All back in stock".
//   Super Admin: <FranchiseServices franchiseId=…> switches services and single products on/off for one franchise,
//     and can do the city's stock the same way.
export default function MyServices() {
  return <FranchiseServices />;
}

export function FranchiseServices({ franchiseId }) {
  const toast = useToast();
  const hq = !!franchiseId;
  const list = useLoad(() => api(hq ? `/super/franchises/${franchiseId}/services` : '/franchise/services'), [franchiseId]);
  const [q, setQ] = useState('');
  const [show, setShow] = useState(hq ? 'all' : 'on');
  const [products, setProducts] = useState(null); // the service whose products are open
  const [asking, setAsking] = useState(null);

  const groups = useMemo(() => {
    const rows = (list.data || []).filter((s) => s.is_active || s.enabled)
      .filter((s) => (show === 'on' ? s.enabled : show === 'off' ? !s.enabled : true))
      .filter((s) => `${s.name} ${s.category_name}`.toLowerCase().includes(q.toLowerCase()));
    const out = [];
    for (const s of rows) {
      let g = out.find((x) => x.name === s.category_name);
      if (!g) out.push((g = { name: s.category_name, icon: s.category_icon, items: [] }));
      g.items.push(s);
    }
    return out;
  }, [list.data, q, show]);
  const onCount = (list.data || []).filter((s) => s.enabled).length;
  const base = hq ? `/super/franchises/${franchiseId}` : '/franchise';
  const out = useLoad(() => api(`${base}/out-of-stock`), [franchiseId]);

  const toggle = async (s, on) => {
    try {
      await api(`/super/franchises/${franchiseId}/services/${s.id}`, { method: 'PATCH', body: { enabled: on } });
      toast(`${s.name} ${on ? 'switched on' : 'switched off'} for this franchise`);
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <input className="toolbar-search" type="search" placeholder="Search services…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="tabs">
          {[['on', `On (${onCount})`], ['off', 'Not offered'], ['all', 'All']].map(([k, l]) => (
            <button key={k} className={show === k ? 'active' : ''} onClick={() => setShow(k)}>{l}</button>
          ))}
        </div>
        {!hq && <button className="btn btn-primary" onClick={() => setAsking({ kind: 'service' })}>➕ Ask for a new service</button>}
      </div>
      {!hq && <p className="muted small">Services and products are managed by HQ. To offer something new in your city, ask here — HQ reviews and switches it on.</p>}
      <OutOfStock list={out} base={base} onChange={() => out.reload()} />
      {list.error && <div className="alert">{list.error}</div>}
      {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}
      {groups.map((g) => (
        <section key={g.name} className="panel table-panel">
          <div className="panel-pad"><h3>{g.icon} {g.name}</h3></div>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Service</th><th>Products</th><th>Orders here</th><th>{hq ? 'Offered here' : 'Status'}</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {g.items.map((s) => (
                  <tr key={s.id} className={s.enabled ? '' : 'row-muted'}>
                    <td><b>{s.name}</b>{!s.is_active && <div className="small danger-text">Switched off by HQ everywhere</div>}</td>
                    <td>{s.products}</td>
                    <td>{s.orders}</td>
                    <td>{hq ? <Switch checked={s.enabled} onChange={(on) => toggle(s, on)} label="" />
                      : s.enabled ? <span className="status-badge" style={{ '--c': '#16a34a' }}>On</span> : <span className="muted small">Not offered</span>}</td>
                    <td className="nowrap">
                      {s.products > 0 && s.enabled && <button className="btn btn-ghost btn-sm" onClick={() => setProducts(s)}>Products</button>}{' '}
                      {!hq && !s.enabled && <button className="btn btn-ghost btn-sm" onClick={() => setAsking({ kind: 'service', service: s })}>Request</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {list.data && !groups.length && <p className="muted">Nothing here.</p>}
      {products && <ProductsOf service={products} franchiseId={franchiseId} onStock={() => out.reload()} onClose={() => setProducts(null)} onAsk={() => { setAsking({ kind: 'product', service: products }); setProducts(null); }} />}
      {asking && <RequestForm initial={asking} services={(list.data || []).filter((s) => s.is_active)} onClose={() => setAsking(null)} />}
    </div>
  );
}

// 🚫 What this city has out of stock right now, with "back in stock" for each and for all.
function OutOfStock({ list, base, onChange }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const items = list.data || [];
  if (!items.length) return null;
  const run = async (fn, msg) => {
    try {
      const r = await fn();
      toast(typeof msg === 'function' ? msg(r) : msg);
      onChange();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const back = (p) => run(() => api(`${base}/products/${p.id}/stock`, { method: 'PATCH', body: { in_stock: true } }), `${p.name} is back in stock`);
  const all = async () => (await askConfirm(`Put all ${items.length} items back in stock?`, { okText: 'Yes, all back in stock', cancelText: 'Cancel' }))
    && run(() => api(`${base}/restock`, { method: 'POST' }), (r) => `${r.restocked} items back in stock`);
  return (
    <section className="panel stock-panel">
      <div className="panel-head">
        <h3>🚫 Out of stock in your city · {items.length}</h3>
        <div className="toolbar">
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button>
          <button className="btn btn-primary btn-sm" onClick={all}>✅ All back in stock</button>
        </div>
      </div>
      {open ? (
        <div className="stock-list">
          {items.map((p) => (
            <div key={p.id} className="stock-item">
              <Thumb p={p} />
              <div><b>{p.brand ? `${p.brand} ` : ''}{p.name}</b><div className="muted small">{p.service_name} · {p.unit}{p.since ? ` · since ${timeAgo(p.since)}` : ''}</div></div>
              <button className="btn btn-ghost btn-sm" onClick={() => back(p)}>Back in stock</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>Customers see these greyed out and can't order them: {items.slice(0, 4).map((p) => p.name).join(', ')}{items.length > 4 ? '…' : ''}</p>
      )}
    </section>
  );
}

const Thumb = ({ p }) => (p.image_url ? <img className="stock-thumb" src={p.image_url} alt="" loading="lazy" /> : <span className="stock-thumb">{p.icon || '📦'}</span>);

// Products of one service in this franchise: the city's stock (franchise admin & HQ) and, for HQ, shown here or not.
function ProductsOf({ service, franchiseId, onClose, onAsk, onStock }) {
  const toast = useToast();
  const hq = !!franchiseId;
  const base = hq ? `/super/franchises/${franchiseId}` : '/franchise';
  const list = useLoad(() => api(`${base}/services/${service.id}/products`), [service.id]);
  const [q, setQ] = useState('');
  const [onlyOut, setOnlyOut] = useState(false);
  const [busy, setBusy] = useState(null);
  const all = (list.data || []).filter((p) => p.is_active);
  const outCount = all.filter((p) => p.enabled && !p.in_stock).length;
  const rows = all
    .filter((p) => !onlyOut || (p.enabled && !p.in_stock))
    .filter((p) => `${p.name} ${p.brand || ''} ${p.section || ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = async (p, on) => {
    try {
      await api(`/super/franchises/${franchiseId}/products/${p.id}`, { method: 'PATCH', body: { enabled: on } });
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const stock = async (p, inStock) => {
    setBusy(p.id);
    try {
      await api(`${base}/products/${p.id}/stock`, { method: 'PATCH', body: { in_stock: inStock } });
      toast(inStock ? `${p.name}: back in stock` : `${p.name}: out of stock — customers can't order it`);
      list.reload();
      onStock?.();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const restock = async () => {
    if (!(await askConfirm(`Put all ${outCount} out-of-stock items of ${service.name} back in stock?`, { okText: 'Yes, all back in stock', cancelText: 'Cancel' }))) return;
    try {
      const r = await api(`${base}/restock?service=${service.id}`, { method: 'POST' });
      toast(`${r.restocked} items back in stock`);
      setOnlyOut(false);
      list.reload();
      onStock?.();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <Modal title={`${service.name} — products`} onClose={onClose} wide
      footer={!hq && <button className="btn btn-primary" onClick={onAsk}>➕ Ask for a product here</button>}>
      <div className="stack">
        <div className="toolbar">
          <input className="toolbar-search" type="search" placeholder={`Search ${all.length} products…`} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="tabs">
            <button className={onlyOut ? '' : 'active'} onClick={() => setOnlyOut(false)}>All</button>
            <button className={onlyOut ? 'active' : ''} onClick={() => setOnlyOut(true)}>Out of stock{outCount ? <span className="count">{outCount}</span> : ''}</button>
          </div>
          {outCount > 0 && <button className="btn btn-ghost btn-sm" onClick={restock}>✅ All back in stock</button>}
        </div>
        <p className="muted small" style={{ margin: 0 }}>Not available today? Switch it to <b>Out of stock</b> — only in your city. Customers see it greyed out and can't order it until you switch it back.</p>
        <div className="table-scroll preview-scroll">
          <table className="table stock-table">
            <thead><tr><th>Product</th><th>Pack</th>{hq && <th>Shown here</th>}<th>Stock in this city</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={!p.enabled ? 'row-muted' : p.in_stock && p.in_stock_all ? '' : 'row-out'}>
                  <td><div className="stock-name"><Thumb p={p} /><span><b>{p.name}</b>{p.brand && <span className="muted small"> · {p.brand}</span>}{p.only_assigned && <span className="tag-pill">only some cities</span>}<span className="stock-unit muted small">{p.unit}</span></span></div></td>
                  <td className="small">{p.unit}</td>
                  {hq && <td><Switch checked={p.enabled} onChange={(on) => toggle(p, on)} label="" /></td>}
                  <td>
                    {!p.enabled ? <span className="muted small">Not offered here</span>
                      : !p.in_stock_all ? <span className="muted small">Out everywhere (HQ)</span>
                        : (
                          <button type="button" className={`stock-toggle ${p.in_stock ? 'in' : 'out'}`} disabled={busy === p.id}
                            onClick={() => stock(p, !p.in_stock)} aria-pressed={!p.in_stock} title={p.in_stock ? 'Mark out of stock' : 'Mark back in stock'}>
                            <span className="dot" />{p.in_stock ? 'In stock' : 'Out of stock'}
                          </button>
                        )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && list.data && <p className="muted">{onlyOut ? 'Nothing is out of stock. 👍' : 'No products match.'}</p>}
          {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}
        </div>
      </div>
    </Modal>
  );
}

// Franchise → HQ: a service (existing or new) or a product (existing or new).
export function RequestForm({ initial, services, onClose, onDone }) {
  const toast = useToast();
  const cats = useLoad(() => api('/franchise/categories'));
  const [kind, setKind] = useState(initial.kind || 'service');
  const [mode, setMode] = useState(initial.service && initial.kind === 'service' ? 'existing' : 'new');
  const [form, setForm] = useState({ service_id: initial.service?.id ?? '', name: '', category_id: '', unit: '', details: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const offered = services.filter((s) => s.enabled);
  const notOffered = services.filter((s) => !s.enabled);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = kind === 'service'
        ? (mode === 'existing' ? { kind, service_id: form.service_id, details: form.details } : { kind, name: form.name, category_id: form.category_id, details: form.details })
        : { kind, service_id: form.service_id, name: form.name, unit: form.unit, details: form.details };
      await api('/franchise/requests', { method: 'POST', body });
      toast('Sent to HQ for approval');
      onDone?.();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };

  return (
    <Modal title="Ask HQ" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="req-form" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button></>}>
      <form id="req-form" className="stack" onSubmit={send}>
        <div className="tabs">
          <button type="button" className={kind === 'service' ? 'active' : ''} onClick={() => setKind('service')}>🧰 A service</button>
          <button type="button" className={kind === 'product' ? 'active' : ''} onClick={() => setKind('product')}>🛍️ A product</button>
        </div>
        {kind === 'service' ? (
          <>
            <div className="tabs">
              <button type="button" className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>From the app's list</button>
              <button type="button" className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>Something new</button>
            </div>
            {mode === 'existing' ? (
              <label>Service
                <select value={form.service_id} onChange={set('service_id')} required>
                  <option value="">Choose…</option>
                  {notOffered.map((s) => <option key={s.id} value={s.id}>{s.category_name} → {s.name}</option>)}
                </select>
              </label>
            ) : (
              <>
                <label>Service name<input value={form.name} onChange={set('name')} maxLength={120} placeholder="e.g. Borewell repair" required /></label>
                <label>Category
                  <select value={form.category_id} onChange={set('category_id')} required>
                    <option value="">Choose…</option>
                    {(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                  </select>
                </label>
              </>
            )}
          </>
        ) : (
          <>
            <label>In which service
              <select value={form.service_id} onChange={set('service_id')} required>
                <option value="">Choose…</option>
                {offered.map((s) => <option key={s.id} value={s.id}>{s.category_name} → {s.name}</option>)}
              </select>
            </label>
            <div className="form-row">
              <label>Product name<input value={form.name} onChange={set('name')} maxLength={120} placeholder="e.g. Avakaya pickle" required /></label>
              <label>Pack size<input value={form.unit} onChange={set('unit')} maxLength={30} placeholder="e.g. 500 g" /></label>
            </div>
          </>
        )}
        <label>Why / details (optional)<textarea rows={3} maxLength={500} value={form.details} onChange={set('details')} placeholder="e.g. Many customers in our city ask for this" /></label>
        <p className="muted small">HQ will review it. You'll see the answer in <Link to="/admin/requests" onClick={onClose}>Requests to HQ</Link>.</p>
      </form>
    </Modal>
  );
}
