import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { rupees } from '../orderStatus.jsx';
import { useLoad } from './ui.jsx';

// Franchise admin home: their franchise, today's numbers and shortcuts.
export default function FranchiseHome() {
  const me = useLoad(() => api('/franchise/me'));
  const stats = useLoad(() => api('/admin/orders-stats'));
  if (me.error) return <div className="alert">{me.error}</div>;
  if (!me.data) return <div className="center-block"><div className="spinner" /></div>;
  const { franchise: f, stats: s } = me.data;
  const t = stats.data || {};
  const tiles = [
    ['📦', 'Waiting for an agent', t.waiting ?? '…', '/admin/orders?status=placed', t.waiting > 0],
    ['⏰', 'Overdue orders', t.overdue ?? '…', '/admin/orders?status=overdue', t.overdue > 0],
    ['🚚', 'In progress', t.in_progress ?? '…', '/admin/orders?status=active'],
    ['✅', 'Delivered today', t.delivered_today ?? '…', '/admin/orders?status=delivered'],
    ['🛵', 'Agents free now', t.agents_free ?? '…', '/admin/agents'],
    ['🙋', 'Open complaints', s.complaints_open, '/admin/complaints', s.complaints_open > 0],
    ['📝', 'Requests waiting at HQ', t.pending_requests ?? 0, '/admin/requests'],
  ];
  return (
    <div className="stack">
      <section className="panel franchise-hero">
        <div>
          <small className="muted">{f.code} · since {new Date(f.registered_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</small>
          <h1>{f.name}</h1>
          <p className="muted">📍 {f.city}, {f.state}{f.owner_name ? ` · Owner: ${f.owner_name}` : ''}</p>
        </div>
        <span className="status-badge cap" style={{ '--c': { active: '#16a34a', pending: '#f59e0b', disabled: '#64748b', suspended: '#dc2626' }[f.status] }}>{f.status}</span>
      </section>

      <div className="kpi-grid">
        {tiles.map(([icon, label, value, to, alert]) => (
          <Link key={label} to={to} className={`kpi kpi-link ${alert ? 'kpi-alert' : ''}`}>
            <span className="kpi-label">{icon} {label}</span>
            <span className="kpi-value">{value}</span>
          </Link>
        ))}
      </div>

      <section className="panel">
        <h3>All time</h3>
        <div className="kpi-grid compact">
          <div className="kpi"><span className="kpi-label">Customers</span><span className="kpi-value">{s.users}</span></div>
          <div className="kpi"><span className="kpi-label">Active agents</span><span className="kpi-value">{s.agents}</span></div>
          <div className="kpi"><span className="kpi-label">Orders</span><span className="kpi-value">{s.orders}</span></div>
          <div className="kpi"><span className="kpi-label">Bookings</span><span className="kpi-value">{s.bookings}</span></div>
          <div className="kpi"><span className="kpi-label">Completed</span><span className="kpi-value">{s.completed}</span></div>
          <div className="kpi"><span className="kpi-label">Revenue</span><span className="kpi-value">{rupees(s.revenue)}</span></div>
          <div className="kpi"><span className="kpi-label">This month</span><span className="kpi-value">{rupees(s.revenue_month)}</span></div>
          <div className="kpi"><span className="kpi-label">Rating</span><span className="kpi-value">{s.rating ? `★ ${s.rating}` : '—'}</span></div>
        </div>
      </section>

      <section className="panel">
        <h3>💰 With HQ</h3>
        <div className="kpi-grid compact">
          <div className="kpi"><span className="kpi-label">Commission</span><span className="kpi-value">{rupees(s.money.commission)}</span></div>
          <div className="kpi"><span className="kpi-label">Paid</span><span className="kpi-value">{rupees(s.money.paid)}</span></div>
          <div className="kpi"><span className="kpi-label">Pending</span><span className={`kpi-value ${s.money.pending > 0 ? 'text-warn' : ''}`}>{rupees(s.money.pending)}</span></div>
        </div>
        <p className="muted small">Entered by HQ. Questions? Contact the Super Admin.</p>
      </section>

      <div className="quick-grid">
        <Link to="/admin/my-services" className="quick">🧰 My services ({s.services})</Link>
        <Link to="/admin/requests" className="quick">📝 Ask HQ for a new service or product</Link>
        <Link to="/admin/areas" className="quick">🗺️ Service areas ({s.areas})</Link>
        <Link to="/admin/messages" className="quick">📣 Send a notification</Link>
      </div>
    </div>
  );
}
