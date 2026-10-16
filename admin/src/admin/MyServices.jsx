import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Modal, Switch, useLoad, useToast } from './ui.jsx';

// The services (and their products) a franchise offers.
//   Franchise admin: sees what is on; asks HQ for anything else (they cannot switch things on/off themselves).
//   Super Admin: <FranchiseServices franchiseId=…> switches services and single products on/off for one franchise.
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
      {products && <ProductsOf service={products} franchiseId={franchiseId} onClose={() => setProducts(null)} onAsk={() => { setAsking({ kind: 'product', service: products }); setProducts(null); }} />}
      {asking && <RequestForm initial={asking} services={(list.data || []).filter((s) => s.is_active)} onClose={() => setAsking(null)} />}
    </div>
  );
}

// Products of one service in this franchise. HQ can switch single products on/off here.
function ProductsOf({ service, franchiseId, onClose, onAsk }) {
  const toast = useToast();
  const hq = !!franchiseId;
  const list = useLoad(() => api(hq ? `/super/franchises/${franchiseId}/services/${service.id}/products` : `/franchise/services/${service.id}/products`), [service.id]);
  const toggle = async (p, on) => {
    try {
      await api(`/super/franchises/${franchiseId}/products/${p.id}`, { method: 'PATCH', body: { enabled: on } });
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <Modal title={`${service.name} — products`} onClose={onClose} wide
      footer={!hq && <button className="btn btn-primary" onClick={onAsk}>➕ Ask for a product here</button>}>
      <div className="table-scroll preview-scroll">
        <table className="table">
          <thead><tr><th>Product</th><th>Pack</th><th>{hq ? 'Shown here' : 'Status'}</th></tr></thead>
          <tbody>
            {(list.data || []).filter((p) => p.is_active).map((p) => (
              <tr key={p.id} className={p.enabled ? '' : 'row-muted'}>
                <td>{p.icon} <b>{p.name}</b>{p.brand && <span className="muted small"> · {p.brand}</span>}{p.only_assigned && <span className="tag-pill">only some cities</span>}</td>
                <td className="small">{p.unit}</td>
                <td>{hq ? <Switch checked={p.enabled} onChange={(on) => toggle(p, on)} label="" /> : p.enabled ? '✓' : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}
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
