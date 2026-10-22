import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiFile } from '../api.js';
import { rupees, when } from '../orderStatus.jsx';
import { setScope, useScope } from '../scope.js';
import { useLoad } from '../admin/ui.jsx';
import { AgentTable, BarChart, BreakdownTable, ChartPanel, Kpis, PRESETS, addDays, downloadCsv, iso, shortDay } from '../admin/Reports.jsx';
import { FrBadge } from './Franchises.jsx';

// 📈 HQ Report Center: choose a city (or all), a period, then one report from the numbered list. Every report has a
// CSV download. HQ only watches here — the city's franchise admin runs the day-to-day work.
const REPORTS = [
  { group: 'Overview' },
  { id: 'summary', icon: '📊', title: 'Summary', about: 'Headline numbers for the period, compared with the period before.' },
  { id: 'cities', icon: '🏢', title: 'City comparison', about: 'Every franchise side by side: orders, revenue, commission, payments.' },
  { group: 'Sales' },
  { id: 'daily', icon: '📅', title: 'Sales by day', about: 'Orders and revenue for each day.' },
  { id: 'hours', icon: '🕒', title: 'Busy hours', about: 'When customers order — plan agents for the busy hours.' },
  { id: 'categories', icon: '🗂️', title: 'Sales by category', about: 'Each order once, under its main category. Categories + delivery charges = revenue.' },
  { id: 'services', icon: '🧰', title: 'Sales by service', about: 'Which services get orders, per city.' },
  { id: 'items', icon: '🛒', title: 'Top items', about: 'Most sold items (shop-bill items show quantity; their price is in the bill).' },
  { group: 'Operations' },
  { id: 'types', icon: '🧩', title: 'Orders by agent type', about: 'Orders, deliveries and revenue for each type of agent.' },
  { id: 'agents', icon: '🛵', title: 'Agent performance', about: 'Deliveries, give-backs, earnings and cash each agent holds.' },
  { id: 'overdue', icon: '⏰', title: 'Overdue orders', about: 'Open orders nobody took (or finished) in time — right now, any date.' },
  { id: 'cancels', icon: '❌', title: 'Cancellations', about: 'Why orders were cancelled.' },
  { group: 'Customers' },
  { id: 'customers', icon: '👥', title: 'Top customers', about: 'Customers who spent the most.' },
  { id: 'areas', icon: '🗺️', title: 'Areas', about: 'Orders and revenue for each area and village.' },
  { id: 'ratings', icon: '⭐', title: 'Ratings & reviews', about: 'Latest customer ratings — 2 stars or less are marked.' },
  { group: 'Money' },
  { id: 'money', icon: '💰', title: 'Money & commission', about: 'Revenue, delivery charges, agent pay, commission due and paid, cash with agents.' },
];
const LIST = REPORTS.filter((r) => r.id);
const num = (id) => LIST.findIndex((r) => r.id === id) + 1;
const n = (v) => Number(v || 0).toLocaleString('en-IN');

export default function ReportCenter() {
  const [params, setParams] = useSearchParams();
  const current = LIST.find((r) => r.id === params.get('r')) || LIST[0];
  const pick = (id) => setParams({ r: id }, { replace: true });
  const scope = useScope();
  const cities = useLoad(() => api('/super/franchise-options'));
  const [preset, setPreset] = useState('d7');
  const [custom, setCustom] = useState(() => ({ from: iso(addDays(new Date(), -6)), to: iso(new Date()) }));
  const [from, to] = preset === 'custom' ? [custom.from, custom.to] : PRESETS[preset].range().map(iso);
  const q = new URLSearchParams({ from, to, ...(scope && { franchise: scope }) });
  const main = useLoad(() => api(`/super/reports?${q}`), [q.toString()]);
  const d = main.data;
  const r = d?.report;
  const tag = `${scope ? (cities.data || []).find((c) => String(c.id) === scope)?.code || scope : 'all'}_${from}_to_${to}`;
  const cityName = scope ? (cities.data || []).find((c) => String(c.id) === scope)?.city || 'this city' : 'all cities';

  useEffect(() => {
    window.scrollTo?.({ top: 0 }); // (newer browsers return a Promise here — never return it to React)
    // phones: bring the open report's chip into view in the swipe row
    document.querySelector('.rc-item.active')?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
  }, [current.id]);

  const downloadOrders = async () => {
    const f = await apiFile(`/admin/reports/orders.csv?from=${from}&to=${to}`);
    Object.assign(document.createElement('a'), { href: f.url, download: `orders_${tag}.csv` }).click();
    URL.revokeObjectURL(f.url);
  };

  return (
    <div className="rc">
      <section className="panel rc-top">
        <label className="rc-city">
          <span>🏢 City</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="City">
            <option value="">All cities</option>
            {(cities.data || []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.city}{c.status !== 'active' ? ` (${c.status})` : ''}</option>)}
          </select>
        </label>
        <div className="tabs scroll-tabs" role="tablist" aria-label="Period">
          {Object.entries(PRESETS).map(([k, p]) => (
            <button key={k} role="tab" aria-selected={preset === k} className={preset === k ? 'active' : ''} onClick={() => setPreset(k)}>{p.label}</button>
          ))}
          <button role="tab" aria-selected={preset === 'custom'} className={preset === 'custom' ? 'active' : ''} onClick={() => setPreset('custom')}>Custom</button>
        </div>
        {preset === 'custom' && (
          <div className="custom-range">
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" />
            <span>to</span>
            <input type="date" value={custom.to} min={custom.from} max={iso(new Date())} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" />
          </div>
        )}
        <button className="btn btn-ghost btn-sm" onClick={downloadOrders}>⬇ All orders (CSV)</button>
      </section>

      <div className="rc-body">
        <nav className="rc-list" aria-label="Reports">
          {REPORTS.map((x, i) => (x.group ? <div key={`g${i}`} className="rc-group">{x.group}</div> : (
            <button key={x.id} className={`rc-item ${current.id === x.id ? 'active' : ''}`} onClick={() => pick(x.id)} aria-current={current.id === x.id ? 'page' : undefined}>
              <span className="rc-num">{num(x.id)}</span><span className="rc-icon">{x.icon}</span><span>{x.title}</span>
            </button>
          )))}
        </nav>

        <section className="rc-view">
          <header className="rc-head">
            <h2><span className="rc-num big">{num(current.id)}</span> {current.icon} {current.title}</h2>
            <p className="muted small">{current.about} · <b>{cityName}</b>{current.id !== 'overdue' && current.id !== 'ratings' && r ? ` · ${shortDay(r.from)}${r.from !== r.to ? ` – ${shortDay(r.to)}` : ''}` : ''}</p>
          </header>
          {main.error && <div className="alert">{main.error}</div>}
          {!d ? <div className="center-block"><div className="spinner" /></div> : <Report id={current.id} d={d} r={r} tag={tag} scope={scope} />}
        </section>
      </div>
    </div>
  );
}

function Report({ id, d, r, tag, scope }) {
  switch (id) {
    case 'summary':
      return (
        <>
          <Kpis k={r.kpis} prev={r.previous} />
          <div className="chart-grid">
            <ChartPanel title="Orders per day" subtitle="all orders placed"><DayChart r={r} field="orders" /></ChartPanel>
            <ChartPanel title="Revenue per day" subtitle="delivered orders, ₹"><DayChart r={r} field="revenue" /></ChartPanel>
          </div>
        </>
      );
    case 'cities': return <Cities d={d} tag={tag} />;
    case 'daily':
      return (
        <>
          <div className="chart-grid">
            <ChartPanel title="Orders per day" subtitle="all orders placed"><DayChart r={r} field="orders" /></ChartPanel>
            <ChartPanel title="Revenue per day" subtitle="delivered orders, ₹"><DayChart r={r} field="revenue" /></ChartPanel>
          </div>
          <BreakdownTable title="Day by day" rows={[...r.by_day].reverse()} file={`by_day_${tag}.csv`}
            columns={[{ key: 'day', label: 'Day', render: (x) => shortDay(x.day) }, { key: 'orders', label: 'Orders', num: true, bar: true },
              { key: 'delivered', label: 'Delivered', num: true }, { key: 'cancelled', label: 'Cancelled', num: true }, { key: 'revenue', label: 'Revenue', num: true, money: true }]} />
        </>
      );
    case 'hours':
      return (
        <ChartPanel title="Orders by hour of day" subtitle="India time">
          <BarChart data={r.by_hour.map((h) => ({ label: `${h.hour}`, value: h.orders, tip: [`${h.hour}:00 – ${h.hour}:59`, `${h.orders} orders`] }))} labelEvery={3} />
        </ChartPanel>
      );
    case 'categories':
      return <BreakdownTable title="Sales by category" rows={r.by_category} file={`by_category_${tag}.csv`}
        columns={[{ key: 'name', label: 'Category', render: (x) => `${x.icon} ${x.name}` }, { key: 'orders', label: 'Orders', num: true, bar: true }, { key: 'revenue', label: 'Revenue', num: true, money: true }]} />;
    case 'services':
      return <BreakdownTable title="Sales by service" rows={d.services} file={`by_service_${tag}.csv`}
        columns={[{ key: 'service', label: 'Service', render: (x) => `${x.icon} ${x.service}` }, ...(scope ? [] : [{ key: 'city', label: 'City' }]),
          { key: 'orders', label: 'Orders', num: true, bar: true }, { key: 'delivered', label: 'Delivered', num: true }]} />;
    case 'items':
      return <BreakdownTable title="Top items" rows={r.top_items} file={`top_items_${tag}.csv`}
        columns={[{ key: 'name', label: 'Item', render: (x) => <>{x.name} <small className="muted">{x.unit}</small></> }, { key: 'qty', label: 'Qty sold', num: true, bar: true },
          { key: 'orders', label: 'Orders', num: true }, { key: 'revenue', label: 'Sales', num: true, money: true }]} />;
    case 'types':
      return <BreakdownTable title="Orders by agent type" rows={r.by_type} file={`by_type_${tag}.csv`}
        columns={[{ key: 'name', label: 'Type', render: (x) => `${x.icon} ${x.name}` }, { key: 'orders', label: 'Orders', num: true, bar: true },
          { key: 'delivered', label: 'Delivered', num: true }, { key: 'revenue', label: 'Revenue', num: true, money: true }]} />;
    case 'agents': return <AgentTable rows={r.agents} tag={tag} />;
    case 'overdue': return <Overdue tag={tag} />;
    case 'cancels':
      return <BreakdownTable title="Why orders were cancelled" rows={r.cancel_reasons} file={`cancellations_${tag}.csv`} empty="No cancellations in this period 🎉"
        columns={[{ key: 'reason', label: 'Reason' }, { key: 'n', label: 'Orders', num: true, bar: true }]} />;
    case 'customers':
      return <BreakdownTable title="Top customers" rows={r.top_customers} file={`top_customers_${tag}.csv`}
        columns={[{ key: 'name', label: 'Customer' }, { key: 'phone', label: 'Phone' }, { key: 'orders', label: 'Orders', num: true },
          { key: 'delivered', label: 'Delivered', num: true }, { key: 'spent', label: 'Spent', num: true, money: true, bar: true }]} />;
    case 'areas':
      return <BreakdownTable title="Areas" rows={r.by_area} file={`by_area_${tag}.csv`}
        columns={[{ key: 'name', label: 'Area' }, { key: 'orders', label: 'Orders', num: true, bar: true }, { key: 'delivered', label: 'Delivered', num: true }, { key: 'revenue', label: 'Revenue', num: true, money: true }]} />;
    case 'ratings': return <Ratings tag={tag} />;
    case 'money': return <Money d={d} r={r} tag={tag} />;
    default: return null;
  }
}

function DayChart({ r, field }) {
  const money = field === 'revenue';
  return (
    <BarChart
      data={r.by_day.map((x) => ({ label: shortDay(x.day), value: Number(x[field]), tip: [shortDay(x.day), money ? rupees(x.revenue) : `${x.orders} orders`, `${x.delivered} delivered · ${x.cancelled} cancelled`] }))}
      format={money ? (v) => `₹${v >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v)}` : undefined}
    />
  );
}

const CITY_COLS = [
  { key: 'code', label: 'Franchise', csv: (f) => `${f.code} ${f.city}` },
  { key: 'status', label: 'Status' },
  { key: 'orders', label: 'Orders' }, { key: 'bookings', label: 'Bookings' }, { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' }, { key: 'pending', label: 'Open now' }, { key: 'revenue', label: 'Revenue ₹' },
  { key: 'users', label: 'Customers' }, { key: 'agents', label: 'Agents' },
];
function Cities({ d, tag }) {
  const max = Math.max(1, ...d.franchises.map((f) => Number(f.revenue)));
  return (
    <section className="panel table-panel">
      <div className="panel-head">
        <h3>🏢 {d.franchises.length} cities</h3>
        <button className="link-btn" onClick={() => downloadCsv(`cities_${tag}.csv`, CITY_COLS, d.franchises)}>⬇ CSV</button>
      </div>
      <div className="table-scroll">
        <table className="table compact">
          <thead><tr><th>Franchise</th><th>Status</th><th className="num">Orders</th><th className="num">Bookings</th><th className="num">Completed</th><th className="num">Cancelled</th><th className="num">Open now</th><th className="num">Revenue</th><th className="num">Customers</th><th className="num">Agents</th><th aria-label="Open" /></tr></thead>
          <tbody>
            {d.franchises.map((f) => (
              <tr key={f.id}>
                <td><b>{f.code}</b> · {f.city}<div className="muted small">{f.name}</div></td>
                <td><FrBadge status={f.status} /></td>
                <td className="num">{n(f.orders)}</td>
                <td className="num">{n(f.bookings)}</td>
                <td className="num">{n(f.completed)}</td>
                <td className="num">{n(f.cancelled)}</td>
                <td className="num">{n(f.pending)}</td>
                <td className="num"><div className="cell-bar"><span className="cell-bar-fill" style={{ width: `${(Number(f.revenue) / max) * 100}%` }} /><span>{rupees(f.revenue)}</span></div></td>
                <td className="num">{n(f.users)}</td>
                <td className="num">{n(f.agents)}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => setScope(f.id)}>Only this city</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const OVERDUE_COLS = [
  { key: 'id', label: 'Order' }, { key: 'franchise_city', label: 'City' }, { key: 'contact_name', label: 'Customer' }, { key: 'contact_phone', label: 'Phone' },
  { key: 'locality_name', label: 'Area' }, { key: 'skill_name', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'overdue', label: 'Overdue' },
  { key: 'due_at', label: 'Was due' }, { key: 'agent_name', label: 'Agent' }, { key: 'total', label: 'Total ₹' },
];
function Overdue({ tag }) {
  const list = useLoad(() => api('/admin/orders?status=overdue'));
  const rows = list.data || [];
  if (!list.data) return list.error ? <div className="alert">{list.error}</div> : <div className="center-block"><div className="spinner" /></div>;
  return (
    <section className="panel table-panel">
      <div className="panel-head">
        <h3>⏰ {rows.length} overdue</h3>
        {rows.length > 0 && <button className="link-btn" onClick={() => downloadCsv(`overdue_${tag}.csv`, OVERDUE_COLS, rows)}>⬇ CSV</button>}
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table className="table compact">
            <thead><tr><th>Order</th><th>City</th><th>Customer</th><th>Type</th><th>Problem</th><th>Was due</th><th>Agent</th><th className="num">Total</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="row-overdue">
                  <td className="nowrap"><Link className="link" to={`/super/orders?open=${o.id}`}>#{o.id}</Link><div className="muted small">{when(o.created_at)}</div></td>
                  <td>{o.franchise_city || '—'}</td>
                  <td>{o.contact_name}<div className="muted small">{o.contact_phone} · {o.locality_name}</div></td>
                  <td className="nowrap">{o.skill_icon} {o.skill_name}</td>
                  <td><span className="overdue-badge">{o.overdue === 'not_taken' ? '⏰ No agent took it' : '⏰ Not finished'}</span></td>
                  <td className="nowrap small">{when(o.due_at)}</td>
                  <td>{o.agent_name || <span className="muted">—</span>}</td>
                  <td className="num">{rupees(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="empty">No overdue orders 🎉 Every city is on time.</p>}
      <p className="muted small panel-pad">The city's franchise admin calls the customer, then assigns an agent or cancels. Agents stop seeing an order 24 hours after it was due.</p>
    </section>
  );
}

const RATING_COLS = [
  { key: 'order_id', label: 'Order' }, { key: 'franchise_city', label: 'City' }, { key: 'stars', label: 'Stars' }, { key: 'comment', label: 'Comment' },
  { key: 'tags', label: 'Tags', csv: (x) => (x.tags || []).join(' | ') }, { key: 'agent_name', label: 'Agent' }, { key: 'customer_name', label: 'Customer' }, { key: 'created_at', label: 'When' },
];
function Ratings({ tag }) {
  const res = useLoad(() => api('/admin/ratings'));
  const d = res.data;
  if (!d) return res.error ? <div className="alert">{res.error}</div> : <div className="center-block"><div className="spinner" /></div>;
  const s = d.summary;
  return (
    <>
      <div className="kpi-grid">
        <div className="kpi"><span className="kpi-label">⭐ Average</span><b className="kpi-value">{s.avg ?? '—'}</b><small className="muted">{n(s.count)} ratings</small></div>
        <div className="kpi"><span className="kpi-label">📝 Rated orders</span><b className="kpi-value">{s.delivered ? `${Math.round((s.count / s.delivered) * 100)}%` : '—'}</b><small className="muted">of {n(s.delivered)} delivered</small></div>
        <div className="kpi"><span className="kpi-label">⚠️ Low (≤2★) last 7 days</span><b className="kpi-value">{n(s.low_7d)}</b><small className="muted">of {n(s.count_7d)} this week</small></div>
      </div>
      <section className="panel table-panel">
        <div className="panel-head">
          <h3>Latest ratings</h3>
          {d.ratings.length > 0 && <button className="link-btn" onClick={() => downloadCsv(`ratings_${tag}.csv`, RATING_COLS, d.ratings)}>⬇ CSV</button>}
        </div>
        <div className="table-scroll">
          <table className="table compact">
            <thead><tr><th>Order</th><th>City</th><th>Stars</th><th>What they said</th><th>Agent</th><th>Customer</th><th>When</th></tr></thead>
            <tbody>
              {d.ratings.map((x) => (
                <tr key={x.order_id} className={x.stars <= 2 ? 'row-bad' : ''}>
                  <td><Link className="link" to={`/super/orders?open=${x.order_id}`}>#{x.order_id}</Link></td>
                  <td>{x.franchise_city || '—'}</td>
                  <td className="nowrap">{'★'.repeat(x.stars)}<span className="muted">{'★'.repeat(5 - x.stars)}</span></td>
                  <td className="small">{[...(x.tags || []), x.comment].filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
                  <td>{x.agent_name || '—'}</td>
                  <td>{x.customer_name}</td>
                  <td className="small nowrap">{when(x.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!d.ratings.length && <p className="empty">No ratings yet.</p>}
        </div>
      </section>
    </>
  );
}

const MONEY_COLS = [
  { key: 'code', label: 'Franchise', csv: (f) => `${f.code} ${f.city}` }, { key: 'revenue', label: 'Revenue ₹' }, { key: 'delivery_charges', label: 'Delivery charges ₹' },
  { key: 'commission', label: 'Commission ₹', csv: (f) => f.money?.commission }, { key: 'paid', label: 'Paid to HQ ₹', csv: (f) => f.money?.paid },
  { key: 'pending', label: 'Commission due ₹', csv: (f) => f.money?.pending }, { key: 'expenses', label: 'Expenses ₹', csv: (f) => f.money?.expenses },
];
function Money({ d, r, tag }) {
  const ops = useLoad(() => api('/admin/orders-stats'));
  const k = r.kpis;
  const sum = (key) => d.franchises.reduce((t, f) => t + Number(f.money?.[key] || 0), 0);
  return (
    <>
      <div className="kpi-grid">
        <div className="kpi"><span className="kpi-label">💰 Revenue</span><b className="kpi-value">{rupees(k.revenue)}</b><small className="muted">delivered orders in the period</small></div>
        <div className="kpi"><span className="kpi-label">🚚 Delivery charges</span><b className="kpi-value">{rupees(k.delivery_fees)}</b><small className="muted">inside revenue</small></div>
        <div className="kpi"><span className="kpi-label">🛵 Agent pay</span><b className="kpi-value">{rupees(k.agent_pay)}</b><small className="muted">{n(k.active_agents)} agents delivered</small></div>
        <div className="kpi"><span className="kpi-label">💵 Cash with agents</span><b className="kpi-value">{ops.data ? rupees(ops.data.cash_with_agents) : '…'}</b><small className="muted">right now, to be deposited</small></div>
        <div className="kpi"><span className="kpi-label">🏢 Commission (all time)</span><b className="kpi-value">{rupees(sum('commission'))}</b><small className="muted">{rupees(sum('paid'))} paid</small></div>
        <div className="kpi"><span className="kpi-label">⏳ Commission due</span><b className={`kpi-value ${sum('pending') > 0 ? 'text-warn' : ''}`}>{rupees(sum('pending'))}</b><small className="muted">running total</small></div>
      </div>
      <section className="panel table-panel">
        <div className="panel-head">
          <h3>Per city</h3>
          <button className="link-btn" onClick={() => downloadCsv(`money_${tag}.csv`, MONEY_COLS, d.franchises)}>⬇ CSV</button>
        </div>
        <div className="table-scroll">
          <table className="table compact">
            <thead><tr><th>Franchise</th><th className="num">Revenue</th><th className="num">Delivery charges</th><th className="num">Commission</th><th className="num">Paid</th><th className="num">Due</th><th className="num">Expenses</th><th aria-label="Open" /></tr></thead>
            <tbody>
              {d.franchises.map((f) => (
                <tr key={f.id}>
                  <td><b>{f.code}</b> · {f.city}</td>
                  <td className="num">{rupees(f.revenue)}</td>
                  <td className="num">{rupees(f.delivery_charges)}</td>
                  <td className="num">{rupees(f.money?.commission)}</td>
                  <td className="num">{rupees(f.money?.paid)}</td>
                  <td className={`num ${Number(f.money?.pending) > 0 ? 'text-warn' : ''}`}>{rupees(f.money?.pending)}</td>
                  <td className="num">{rupees(f.money?.expenses)}</td>
                  <td><Link className="btn btn-ghost btn-sm" to="/super/payments">Payments</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small panel-pad">Revenue and delivery charges are for the period chosen; commission, payments and expenses are running totals.</p>
      </section>
    </>
  );
}
