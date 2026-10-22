import { useState } from 'react';
import { api } from '../api.js';
import { useAskReason } from '../components/AskReason.jsx';
import { askConfirm } from '../components/ConfirmDialog.jsx';
import { ImagePicker, Modal, Switch, useLoad, useStaff, useToast } from './ui.jsx';

// ⭐ "Our most popular services" — the photo cards on the customer home page (server: db/popular.sql).
//   HQ: the all-cities list (no city chosen at the top) or a city's own list; add, edit, reorder, switch off, delete.
//   Franchise admin: sees their city's cards and asks HQ to add a service or take a card off (Requests to HQ).
export default function PopularAdmin() {
  const toast = useToast();
  const { hq } = useStaff();
  const data = useLoad(() => api('/admin/popular'));
  const services = useLoad(() => (hq ? api('/admin/services') : api('/franchise/services')));
  const categories = useLoad(() => (hq ? api('/admin/categories') : Promise.resolve([])));
  const [editing, setEditing] = useState(null);
  const [asking, setAsking] = useState(false);
  const [askReason, reasonBox] = useAskReason();
  const d = data.data;
  const cards = d?.cards || [];

  const run = async (fn, msg) => {
    try {
      await fn();
      if (msg) toast(msg);
      data.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const move = (c, dir) => run(() => api(`/admin/popular/${c.id}/move`, { method: 'POST', body: { dir } }));
  const toggle = (c) => run(() => api(`/admin/popular/${c.id}`, { method: 'PUT', body: { ...bodyOf(c), is_active: !c.is_active } }), c.is_active ? `${c.title} hidden` : `${c.title} shown`);
  const remove = async (c) => (await askConfirm(`Delete the "${c.title}" card?`, { okText: 'Delete', cancelText: 'Keep' }))
    && run(() => api(`/admin/popular/${c.id}`, { method: 'DELETE' }), 'Card deleted');
  const ownList = () => run(() => api('/admin/popular-own', { method: 'POST' }), 'This city now has its own list — change it freely');
  const dropOwn = async () => (await askConfirm('Delete this city\'s own list? The city shows the all-cities list again.', { okText: 'Yes, use the all-cities list', cancelText: 'Keep' }))
    && run(() => api('/admin/popular-own', { method: 'DELETE' }), 'Back to the all-cities list');
  const askOff = async (c) => {
    const details = await askReason({ title: `Ask HQ to take "${c.title}" off?`, text: 'HQ decides; the card goes off your city\'s home page when approved.', okText: 'Send to HQ', placeholder: 'Why? (optional)' });
    if (details === null || details === undefined) return;
    run(() => api('/franchise/requests', { method: 'POST', body: { kind: 'popular_off', popular_id: c.id, details } }), 'Sent to HQ — see Requests to HQ');
  };

  if (data.error) return <div className="alert">{data.error}</div>;
  if (!d) return <div className="center-block"><div className="spinner" /></div>;
  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted toolbar-note">
          Big photo cards under water &amp; instant on the customer home page (4 look best; up to 8 show).
          {hq ? ' Choose a city at the top to make a list just for that city.' : ' Set by HQ — ask HQ to add a service or take one off.'}
        </p>
        {hq && d.can_edit && <button className="btn btn-primary" onClick={() => setEditing({})}>➕ Add card</button>}
        {!hq && <button className="btn btn-primary" onClick={() => setAsking(true)}>📝 Ask HQ to add a service</button>}
      </div>

      {hq && (
        <div className={`popular-scope ${d.city == null ? '' : d.own_list ? 'own' : 'shared'}`}>
          {d.city == null ? <>🌐 <b>All cities</b> — every city shows this list unless HQ made one just for it.</>
            : d.own_list ? <>🏢 <b>This city's own list</b> — only this city sees it. <button className="link-btn" onClick={dropOwn}>Use the all-cities list again</button></>
            : <>🌐 This city shows the <b>all-cities list</b> below. <button className="btn btn-primary btn-sm" onClick={ownList}>Make a list just for this city</button></>}
        </div>
      )}

      <section className="panel">
        <h3>👀 Preview</h3>
        <div className="pop-preview">
          {cards.filter((c) => c.is_active).slice(0, 8).map((c) => (
            <div key={c.id} className="pop-preview-card" style={{ backgroundImage: c.photo ? `url("${c.photo}")` : undefined }}>
              <span><b>{c.title}</b>{c.subtitle && <small>{c.subtitle}</small>}</span>
            </div>
          ))}
          {!cards.some((c) => c.is_active) && <p className="muted">No cards shown — the home page hides this row.</p>}
        </div>
      </section>

      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Card</th><th>Opens</th><th>Shown</th><th aria-label="Order" /><th aria-label="Actions" /></tr></thead>
            <tbody>
              {cards.map((c, i) => (
                <tr key={c.id} className={c.is_active ? '' : 'row-muted'}>
                  <td>
                    <div className="cell-service">
                      <span className="pop-thumb" style={{ backgroundImage: c.photo ? `url("${c.photo}")` : undefined }} />
                      <div><b>{c.title}</b><div className="muted small">{c.subtitle || '—'}</div></div>
                    </div>
                  </td>
                  <td className="small">{c.service_name ? <>🧰 {c.service_name}</> : <>🗂️ {c.category_name} <span className="muted">(category)</span></>}</td>
                  <td>{d.can_edit ? <Switch checked={c.is_active} onChange={() => toggle(c)} label="" /> : c.is_active ? '✅' : <span className="muted">off</span>}</td>
                  <td className="nowrap">
                    {d.can_edit && <>
                      <button className="icon-btn" disabled={i === 0} onClick={() => move(c, -1)} aria-label="Move up">↑</button>
                      <button className="icon-btn" disabled={i === cards.length - 1} onClick={() => move(c, 1)} aria-label="Move down">↓</button>
                    </>}
                  </td>
                  <td className="nowrap">
                    {d.can_edit && <>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(c)}>Edit</button>{' '}
                      <button className="btn btn-ghost btn-sm danger-text" onClick={() => remove(c)}>Delete</button>
                    </>}
                    {!hq && c.is_active && <button className="btn btn-ghost btn-sm" onClick={() => askOff(c)}>Ask to remove</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!cards.length && <p className="empty">No cards yet.{d.can_edit && ' Add the services customers use most.'}</p>}
        </div>
      </section>
      {reasonBox}

      {editing && (
        <CardForm card={editing} services={services.data || []} categories={categories.data || []}
          onClose={() => setEditing(null)} onSaved={(isNew) => { setEditing(null); data.reload(); toast(isNew ? 'Card added' : 'Card saved'); }} />
      )}
      {asking && (
        <AskAdd services={(services.data || []).filter((s) => s.enabled && s.is_active)} onClose={() => setAsking(false)}
          onSent={() => { setAsking(false); toast('Sent to HQ — see Requests to HQ'); }} />
      )}
    </div>
  );
}

const bodyOf = (c) => ({ service_id: c.service_id ?? null, category_id: c.category_id ?? null, title: c.title, subtitle: c.subtitle || '',
  image_url: c.image_url || '', image_credit: c.image_credit || '', is_active: c.is_active !== false });

// HQ: add / edit one card
function CardForm({ card, services, categories, onClose, onSaved }) {
  const isNew = !card.id;
  const [form, setForm] = useState(() => ({ ...bodyOf(card), opens: card.category_id ? `c${card.category_id}` : card.service_id ? `s${card.service_id}` : '' }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = form.opens.startsWith('s') ? services.find((s) => `s${s.id}` === form.opens) : categories.find((c) => `c${c.id}` === form.opens);
  const choose = (v) => {
    const s = v.startsWith('s') ? services.find((x) => `s${x.id}` === v) : categories.find((x) => `c${x.id}` === v);
    setForm((f) => ({ ...f, opens: v, title: f.title || (s?.name || '').slice(0, 60) }));
  };
  const save = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = { ...form, service_id: form.opens.startsWith('s') ? Number(form.opens.slice(1)) : null, category_id: form.opens.startsWith('c') ? Number(form.opens.slice(1)) : null };
      await api(isNew ? '/admin/popular' : `/admin/popular/${card.id}`, { method: isNew ? 'POST' : 'PUT', body });
      onSaved(isNew);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const byCat = services.filter((s) => s.is_active && !s.parent_id).reduce((m, s) => ((m[s.category_name] ||= []).push(s), m), {});
  return (
    <Modal title={isNew ? 'Add a popular card' : `Edit: ${card.title}`} onClose={onClose} wide
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="pop-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="pop-form" className="form" onSubmit={save}>
        <label>Opens *
          <select value={form.opens} onChange={(e) => choose(e.target.value)} required>
            <option value="">Choose a service or a category…</option>
            <optgroup label="Categories (opens the category page)">
              {categories.filter((c) => c.is_active).map((c) => <option key={c.id} value={`c${c.id}`}>{c.icon} {c.name}</option>)}
            </optgroup>
            {Object.entries(byCat).map(([cat, list]) => (
              <optgroup key={cat} label={cat}>{list.map((s) => <option key={s.id} value={`s${s.id}`}>{s.name}</option>)}</optgroup>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>Title *<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={60} required placeholder="e.g. Fresh Vegetables" /></label>
          <label>Short line<input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} maxLength={80} placeholder="e.g. From the market to your door" /></label>
        </div>
        <label>Photo <small className="muted">— leave empty to use {chosen ? `the photo of “${chosen.name}”` : 'the service’s own photo'}</small></label>
        <ImagePicker url={form.image_url} credit={form.image_credit} fallbackIcon="⭐"
          onChange={({ image_url, image_credit }) => setForm({ ...form, image_url, image_credit })} />
        <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Show on the home page" />
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}

// Franchise admin: ask HQ to add one of the city's services to the row
function AskAdd({ services, onClose, onSent }) {
  const [serviceId, setServiceId] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/franchise/requests', { method: 'POST', body: { kind: 'popular', service_id: Number(serviceId), details } });
      onSent();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Ask HQ to add a popular card" onClose={onClose}
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="ask-pop" disabled={busy || !serviceId}>{busy ? 'Sending…' : 'Send to HQ'}</button></>}>
      <form id="ask-pop" className="form" onSubmit={send}>
        <label>Service *
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
            <option value="">Choose one of your services…</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.category_icon} {s.category_name} · {s.name}</option>)}
          </select>
        </label>
        <label>Why? (optional)<input value={details} onChange={(e) => setDetails(e.target.value)} maxLength={300} placeholder="e.g. Most orders in our city are for this" /></label>
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>
  );
}
