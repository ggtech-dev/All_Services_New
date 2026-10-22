import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Modal, timeAgo, useLoad, useToast } from './ui.jsx';
import { RequestForm } from './MyServices.jsx';
import MapView from '../components/LazyMap.jsx';

// Requests for services/products, and 🗺️ areas / villages (new one, or switch one off — asked from the Areas page).
//   Franchise admin: their requests to HQ (+ ask for a new one, cancel a waiting one).
//   Super Admin: every franchise's requests → review, approve (switches it on / creates it) or reject.
const STATUS = { pending: ['Waiting', '#f59e0b'], approved: ['Approved', '#16a34a'], rejected: ['Rejected', '#dc2626'], cancelled: ['Cancelled', '#94a3b8'] };
const TABS = [['pending', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']];

export default function CatalogRequests() {
  const toast = useToast();
  const { user } = useAuth();
  const hq = user.role === 'superadmin';
  const [tab, setTab] = useState('pending');
  const list = useLoad(() => api(`${hq ? '/super' : '/franchise'}/requests${tab ? `?status=${tab}` : ''}`), [tab]);
  const services = useLoad(() => (hq ? Promise.resolve([]) : api('/franchise/services')));
  const [asking, setAsking] = useState(false);
  const [deciding, setDeciding] = useState(null);
  const rows = list.data || [];

  const cancel = async (r) => {
    if (!confirm('Cancel this request?')) return;
    try {
      await api(`/franchise/requests/${r.id}/cancel`, { method: 'POST' });
      list.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted toolbar-note">
          {hq ? 'Franchises ask for services, products and new areas / villages for their city. Approve to switch it on for that franchise (a brand-new service or product is created for them only — give it to others from the franchise page).'
            : 'Ask HQ to switch on a service or product in your city, or to add a new one. New areas and villages: ask from Service areas & villages.'}
        </p>
        {!hq && <button className="btn btn-primary" onClick={() => setAsking(true)}>➕ New request</button>}
      </div>
      <div className="tabs scroll-tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Request</th>{hq && <th>Franchise</th>}<th>Details</th><th>Status</th><th>When</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const [label, color] = STATUS[r.status];
                const what = r.kind === 'area' ? <>{r.village_band ? '🏡 New village' : '🗺️ New area'}: <b>{r.name}</b>{r.km_from_center != null && <span className="muted small"> · {Number(r.km_from_center)} km from centre</span>}</>
                  : r.kind === 'area_off' ? <>🚫 Switch off area: <b>{r.locality_name || r.name}</b></>
                  : r.kind === 'popular' ? <>⭐ Add to popular on home: <b>{r.name}</b></>
                  : r.kind === 'popular_off' ? <>⭐ Take off popular on home: <b>{r.name}</b></>
                  : r.kind === 'service'
                  ? (r.is_new ? <>🧰 New service: <b>{r.name}</b> <span className="muted small">in {r.category_name}</span></> : <>🧰 Switch on: <b>{r.service_name}</b></>)
                  : (r.is_new ? <>🛍️ New product: <b>{r.name}</b>{r.unit && ` (${r.unit})`} <span className="muted small">in {r.service_name}</span></> : <>🛍️ Product: <b>{r.product_name}</b></>);
                return (
                  <tr key={r.id}>
                    <td>{what}</td>
                    {hq && <td className="small"><b>{r.franchise_code}</b> · {r.city}</td>}
                    <td className="small">{r.details || <span className="muted">—</span>}{r.admin_note && <div className="muted">HQ: {r.admin_note}</div>}</td>
                    <td><span className="status-badge" style={{ '--c': color }}>{label}</span></td>
                    <td className="muted small nowrap">{timeAgo(r.created_at)}{r.requested_by && ` · ${r.requested_by}`}</td>
                    <td className="nowrap">
                      {hq && r.status === 'pending' && <button className="btn btn-primary btn-sm" onClick={() => setDeciding(r)}>Review</button>}
                      {!hq && r.status === 'pending' && <button className="btn btn-ghost btn-sm" onClick={() => cancel(r)}>Cancel</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.data && !rows.length && <p className="muted panel-pad">{tab === 'pending' ? 'Nothing waiting.' : 'Nothing here.'}</p>}
          {list.loading && !list.data && <div className="center-block"><div className="spinner" /></div>}
          {list.error && <div className="alert">{list.error}</div>}
        </div>
      </section>
      {asking && <RequestForm initial={{ kind: 'service' }} services={services.data || []} onClose={() => setAsking(false)} onDone={list.reload} />}
      {deciding && <Decide request={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); list.reload(); }} />}
    </div>
  );
}

function Decide({ request: r, onClose, onDone }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (kind) => {
    setBusy(true);
    try {
      await api(`/super/requests/${r.id}/${kind}`, { method: 'POST', body: { note } });
      toast(kind === 'approve' ? (r.kind === 'area_off' ? `Approved — switched off in ${r.city}` : `Approved — now visible in ${r.city}`) : 'Rejected');
      onDone();
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title={`Request from ${r.franchise_code} · ${r.city}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost danger-text" onClick={() => act('reject')} disabled={busy}>Reject</button>
        <button className="btn btn-primary" onClick={() => act('approve')} disabled={busy}>✓ Approve</button>
      </>}>
      <div className="stack">
        {r.kind === 'area' ? (
          <>
            <p>{r.village_band ? '🏡 New village' : '🗺️ New town area'}: <b>{r.name}</b>{r.area_pincode && ` · ${r.area_pincode}`}
              {r.village_band && <span className="muted"> · {r.village_band === 1 ? 'up to 10 km' : '10–15 km'} (village charge)</span>}</p>
            {r.km_from_center != null && <p className="muted small">📏 {Number(r.km_from_center)} km from the centre of {r.city}.</p>}
            <MapView height={220} fitKey={`req-${r.id}`} markers={[{ id: 'a', lat: Number(r.area_lat), lng: Number(r.area_lng), emoji: r.village_band ? '🏡' : '📍', color: '#4f46e5', label: r.name }]} />
            <p className="muted small">Approving adds it to {r.city}: customers can choose it at once. You can still edit it in Locations, areas & villages.</p>
          </>
        ) : r.kind === 'area_off' ? (
          <p>🚫 Switch off <b>{r.locality_name || r.name}</b> in {r.city}. Customers can no longer choose it; old orders keep it.</p>
        ) : r.kind === 'popular' || r.kind === 'popular_off' ? (
          <p>⭐ {r.kind === 'popular' ? 'Add' : 'Take off'} <b>{r.name}</b> {r.kind === 'popular' ? 'to' : 'from'} the “Our most popular services” cards in {r.city}. {r.kind === 'popular' ? 'It goes at the end; you can reorder and change the photo in Popular on home.' : ''} (If {r.city} still uses the all-cities list, it gets its own list — other cities don’t change.)</p>
        ) : (
          <p>
            {r.kind === 'service' ? '🧰 Service' : '🛍️ Product'}: <b>{r.is_new ? r.name : r.service_name || r.product_name}</b>
            {r.is_new && <span className="tag-pill">new</span>}
          </p>
        )}
        {r.is_new && r.kind === 'service' && <p className="muted small">Will be created in “{r.category_name}”, switched on only for {r.city}. You can add a photo, description and agent type later in Master services.</p>}
        {r.is_new && r.kind === 'product' && <p className="muted small">Will be added to “{r.service_name}”{r.unit ? ` (${r.unit})` : ''}, shown only in {r.city}. Add a photo later in Master products.</p>}
        {r.details && <p className="complaint-msg">“{r.details}”</p>}
        <label>Note to the franchise (optional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Approved — add 3 plumbers before launch" /></label>
      </div>
    </Modal>
  );
}
