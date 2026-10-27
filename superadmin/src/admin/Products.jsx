import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { ImagePicker, Modal, PriceCell, RowImage, Switch, TextCell, useLoad, useToast } from './ui.jsx';
import { matchesFilter } from './Services.jsx';

export const EMPTY_PRODUCT = {
  service_id: '', name: '', brand: '', description: '', icon: '', image_url: '', image_credit: '',
  unit: '', price: '', mrp: '', in_stock: true, is_active: true,
};

const discount = (p) =>
  p.mrp && Number(p.mrp) > Number(p.price) ? Math.round((1 - Number(p.price) / Number(p.mrp)) * 100) : 0;

export default function Products() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState({ category: '', service: params.get('service') || '', q: '', status: 'all' });
  const [editing, setEditing] = useState(null);
  const cats = useLoad(() => api('/admin/categories'));
  const services = useLoad(() => api('/admin/services'));
  const list = useLoad(() => api('/admin/products'));

  useEffect(() => {
    if (params.get('new')) {
      setEditing({ ...EMPTY_PRODUCT, service_id: params.get('service') || '' });
      setParams(params.get('service') ? { service: params.get('service') } : {}, { replace: true });
    }
  }, [params, setParams]);

  const serviceOptions = (services.data || []).filter((s) => !filter.category || s.category_id === Number(filter.category));
  const rows = useMemo(
    () =>
      (list.data || []).filter(
        (p) =>
          matchesFilter(p, { ...filter, status: filter.status === 'out' ? 'all' : filter.status }) &&
          (!filter.service || p.service_id === Number(filter.service)) &&
          (filter.status !== 'out' || !p.in_stock)
      ),
    [list.data, filter]
  );

  return (
    <div className="stack">
      <div className="toolbar">
        <input className="toolbar-search" placeholder="🔍 Search products or brands…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value, service: '' })}>
          <option value="">All categories</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
        <select value={filter.service} onChange={(e) => setFilter({ ...filter, service: e.target.value })}>
          <option value="">All services</option>
          {serviceOptions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.product_count ? ` (${s.product_count})` : ''}</option>)}
        </select>
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="all">All</option>
          <option value="live">Live only</option>
          <option value="hidden">Hidden only</option>
          <option value="out">Out of stock</option>
        </select>
        <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY_PRODUCT, service_id: filter.service })}>➕ Add product</button>
      </div>

      {list.error && <div className="alert">{list.error}</div>}
      <ProductsTable rows={rows} all={list.data} total={list.data?.length} loading={list.loading && !list.data} reload={list.reload} onEdit={setEditing} />

      {editing && (
        <ProductForm
          product={editing}
          services={services.data || []}
          onClose={() => setEditing(null)}
          onSaved={(saved, isNew) => {
            setEditing(null);
            list.reload();
            services.reload();
            toast(isNew ? `Added ${saved.name}` : `Saved ${saved.name}`);
          }}
        />
      )}
    </div>
  );
}

export function ProductsTable({ rows, all = rows, total, loading, reload, onEdit }) {
  const toast = useToast();
  const [sizesOf, setSizesOf] = useState(null); // 📦 the product whose pack sizes are open
  // every size of a product (they share pack_group), small → big as the app sorts them
  const sizes = (p) => (p.pack_group ? (all || []).filter((x) => x.pack_group === p.pack_group || x.id === p.pack_group) : [p]);

  const setPrice = async (p, field, value) => {
    await api(`/admin/products/${p.id}/price`, { method: 'PATCH', body: { field, value } });
    const old = field === 'price' ? p.price : p.mrp;
    const fmt = (v) => (v === '' || v == null ? 'none' : `₹${Number(v)}`);
    toast(`${p.name} ${field === 'mrp' ? 'MRP' : 'price'}: ${fmt(old)} → ${fmt(value)}`);
    reload();
  };

  const setUnit = async (p, unit) => {
    await api(`/admin/products/${p.id}/unit`, { method: 'PATCH', body: { unit } });
    toast(`${p.name}: quantity set to ${unit || 'none'}`);
    reload();
  };

  const setFlag = async (p, flag, value) => {
    try {
      await api(`/admin/products/${p.id}/flag`, { method: 'PATCH', body: { flag, value } });
      toast(flag === 'in_stock' ? `${p.name}: ${value ? 'back in stock' : 'marked out of stock'}` : `${p.name} is now ${value ? 'visible' : 'hidden'}`);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const remove = async (p) => {
    if (!confirm(`Delete "${p.name}" permanently?\n\nTip: use the Live switch to hide it instead.`)) return;
    try {
      await api(`/admin/products/${p.id}`, { method: 'DELETE' });
      toast(`Deleted ${p.name}`);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <section className="panel table-panel">
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Product <small className="th-hint">· click photo to change</small></th>
              <th>Service</th>
              <th>Price <small className="th-hint">· click to edit</small></th>
              <th>MRP</th>
              <th>In stock</th>
              <th>Live</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={p.is_active ? '' : 'row-muted'}>
                <td>
                  <div className="cell-service">
                    <RowImage entity="products" id={p.id} url={p.image_url} icon={p.icon || p.category_icon} onChanged={reload} />
                    <div>
                      <b>{p.name}</b>
                      <div className="muted small">
                        {p.brand && `${p.brand} · `}
                        <TextCell value={p.unit} placeholder="add quantity" onSave={(v) => setUnit(p, v)} />
                      </div>
                    </div>
                  </div>
                </td>
                <td><span className="cat-pill" style={{ '--c': p.category_color }}>{p.category_icon} {p.service_name}</span></td>
                <td>
                  <PriceCell value={p.price} onSave={(v) => setPrice(p, 'price', v)} />
                  {discount(p) > 0 && <span className="off-tag">{discount(p)}% off</span>}
                </td>
                <td><PriceCell value={p.mrp} allowEmpty emptyLabel="—" strike onSave={(v) => setPrice(p, 'mrp', v)} /></td>
                <td><Switch checked={p.in_stock} onChange={(v) => setFlag(p, 'in_stock', v)} /></td>
                <td><Switch checked={p.is_active} onChange={(v) => setFlag(p, 'is_active', v)} /></td>
                <td className="nowrap actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => onEdit(p)}>Edit</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSizesOf(p)} title="Pack sizes customers can choose">
                    📦 {sizes(p).length > 1 ? `${sizes(p).length} sizes` : 'Sizes'}
                  </button>
                  <button className="icon-btn danger" onClick={() => remove(p)} title="Delete">🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="center-block"><div className="spinner" /></div>}
        {!loading && !rows.length && <p className="empty">No products here yet. Use “Add product” to create one.</p>}
      </div>
      {total != null && <div className="table-foot muted">Showing {rows.length} of {total} products</div>}
      {sizesOf && <PackSizes product={sizesOf} sizes={sizes(sizesOf)} onClose={() => setSizesOf(null)} onChanged={reload} setFlag={setFlag} />}
    </section>
  );
}

// 📦 Pack sizes of one product (one card for customers, who pick the size). Each size has its own stock and Live
// switch; a new size copies the name, photo and section — no price (customers pay the shop bill).
function PackSizes({ product, sizes, onClose, onChanged, setFlag }) {
  const toast = useToast();
  const [unit, setUnit] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const row = await api(`/admin/products/${product.id}/pack-sizes`, { method: 'POST', body: { unit } });
      toast(`${product.name}: ${row.unit} added`);
      setUnit('');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`📦 Pack sizes — ${product.brand ? `${product.brand} ` : ''}${product.name}`} onClose={onClose}>
      <p className="muted small">Customers see one card and tap the size they want. The partner buys that size and the customer pays the shop bill — no prices here.</p>
      <ul className="pack-size-list">
        {[...sizes].sort((a, b) => Number(a.pack_qty ?? 0) - Number(b.pack_qty ?? 0)).map((s) => ( /* pack_qty: fn_pack_qty in SQL */
          <li key={s.id} className={s.is_active ? '' : 'row-muted'}>
            <b>{s.unit || '—'}</b>
            <Switch checked={s.is_active} onChange={(v) => setFlag(s, 'is_active', v)} label={s.is_active ? 'Live' : 'Hidden'} />
          </li>
        ))}
      </ul>
      <form className="form pack-size-add" onSubmit={add}>
        <label>
          Add a size
          <input value={unit} onChange={(e) => setUnit(e.target.value.slice(0, 30))} placeholder="e.g. 250 g, 2 L, 4 × 100 g" required />
        </label>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : '➕ Add size'}</button>
      </form>
      {error && <div className="alert">{error}</div>}
    </Modal>
  );
}

export function ProductForm({ product, services, onClose, onSaved }) {
  const isNew = !product.id;
  const [form, setForm] = useState(() => ({
    ...EMPTY_PRODUCT,
    ...product,
    price: product.price === '' ? '' : Number(product.price),
    mrp: product.mrp == null || product.mrp === '' ? '' : Number(product.mrp),
    brand: product.brand || '',
    description: product.description || '',
    icon: product.icon || '',
    image_url: product.image_url || '',
    image_credit: product.image_credit || '',
    unit: product.unit || '',
    sell_by: product.sell_by || 'pack',
    note_options: product.note_options || [],
  }));
  const [cuts, setCuts] = useState(() => (product.note_options || []).join(', '));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // Services grouped by category for the dropdown.
  const groups = services.reduce((acc, s) => {
    (acc[s.category_name] ||= { icon: s.category_icon, items: [] }).items.push(s);
    return acc;
  }, {});
  const off = form.mrp && Number(form.mrp) > Number(form.price) ? Math.round((1 - form.price / form.mrp) * 100) : 0;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const saved = await api(isNew ? '/admin/products' : `/admin/products/${product.id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: { ...form, note_options: cuts.split(',').map((c) => c.trim()).filter(Boolean) },
      });
      onSaved(saved, isNew);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Add a new product' : `Edit: ${product.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="product-form" disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Add product' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="product-form" className="form admin-form" onSubmit={submit}>
        <ImagePicker url={form.image_url} credit={form.image_credit} fallbackIcon={form.icon || '📦'} onChange={(img) => setForm((f) => ({ ...f, ...img }))} />
        <div className="form-row">
          <label>
            Product name *
            <input value={form.name} onChange={set('name')} placeholder="e.g. Vijaya Toned Milk" required autoFocus={isNew} />
          </label>
          <label>
            Sold under service *
            <select value={form.service_id} onChange={set('service_id')} required>
              <option value="">Choose…</option>
              {Object.entries(groups).map(([name, g]) => (
                <optgroup key={name} label={`${g.icon} ${name}`}>
                  {g.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>Brand<input value={form.brand} onChange={set('brand')} placeholder="e.g. Vijaya, Heritage (optional)" /></label>
          <label>Pack size / unit<input value={form.unit} onChange={set('unit')} placeholder="500 ml, 1 kg, 6 pcs…" /></label>
          <label>Emoji<input value={form.icon} onChange={set('icon')} placeholder="🥛" /></label>
        </div>
        <div className="form-row">
          <label>
            Selling price (₹) *
            <input type="number" min="0" step="any" value={form.price} onChange={set('price')} required />
          </label>
          <label>
            MRP (₹)
            <input type="number" min="0" step="any" value={form.mrp} onChange={set('mrp')} placeholder="optional" />
            <small className={off ? 'success-text' : 'muted'}>{off ? `Customers see ${off}% off` : 'Selling price can’t be above MRP'}</small>
          </label>
        </div>
        <label>
          Description
          <textarea rows={2} value={form.description} onChange={set('description')} placeholder="Optional details shown to customers" />
        </label>
        <div className="form-row">
          <label>
            Customer chooses
            <select value={form.sell_by} onChange={set('sell_by')}>
              <option value="pack">Number of packs (1, 2, 3…)</option>
              <option value="kg">Weight in kg (250 g steps)</option>
              <option value="litre">Litres (500 ml steps)</option>
              <option value="bunch">Bunches</option>
              <option value="piece">Pieces</option>
            </select>
          </label>
          <label>
            Cutting options
            <input value={cuts} onChange={(e) => setCuts(e.target.value)} placeholder="e.g. Curry cut, Boneless, Fry pieces" />
            <small className="muted">Comma separated. Customers tap one or more (meat / fish). Leave empty if not needed.</small>
          </label>
        </div>
        <div className="form-row switches">
          <Switch checked={form.in_stock} onChange={(v) => setForm({ ...form, in_stock: v })} label="In stock" />
          <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Live (visible to customers)" />
        </div>
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}
