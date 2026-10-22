import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { usePoll } from '../orderStatus.jsx';
import { setScope, useScope } from '../scope.js';
import { ToastProvider } from './ui.jsx';

// One layout for both staff apps:
//   Franchise admin (/admin)  — runs one franchise (city): orders, agents, reports… of that franchise only.
//   Super Admin (/super, HQ)  — every franchise, the master catalog and the platform; the franchise chooser at the top
//                               limits the day-to-day pages to one dealer.
const FRANCHISE_NAV = [
  { group: 'Daily work' },
  { to: '/admin', label: 'My franchise', icon: '🏠', end: true },
  { to: '/admin/orders', label: 'Orders & bookings', icon: '📦', badge: 'waiting', alert: 'overdue' },
  { to: '/admin/agents', label: 'Agents', icon: '🛵', badge: 'pending_applications' },
  { to: '/admin/live', label: 'Live map', icon: '📍' },
  { to: '/admin/complaints', label: 'Complaints', icon: '🙋', badge: 'open_complaints' },
  { to: '/admin/ratings', label: 'Ratings & reviews', icon: '⭐', badge: 'low_ratings' },
  { to: '/admin/subscriptions', label: 'Subscriptions', icon: '💳', badge: 'pending_subscriptions' },
  { to: '/admin/share-ride', label: 'Share Ride', icon: '🚗', badge: 'pending_cars' },
  { to: '/admin/workers', label: 'Daily Workers', icon: '👷', badge: 'worker_reports' },
  { group: 'My city' },
  { to: '/admin/my-services', label: 'My services', icon: '🧰' },
  { to: '/admin/requests', label: 'Requests to HQ', icon: '📝', badge: 'pending_requests' },
  { to: '/admin/areas', label: 'Service areas & villages', icon: '🗺️' },
  { to: '/admin/shops', label: 'Shops', icon: '🏪' },
  { to: '/admin/popular', label: 'Popular on home', icon: '⭐' },
  { to: '/admin/messages', label: 'Notifications', icon: '📣' },
  { group: 'Reports' },
  { to: '/admin/reports', label: 'Reports', icon: '📈' },
  { to: '/admin/service-types', label: 'Agent types', icon: '🧩' },
  { to: '/admin/activity', label: 'Activity log', icon: '🕘' },
];

// HQ runs franchises, the catalog, approvals, money and settings — and WATCHES every city's daily work (view only).
const SUPER_NAV = [
  { group: 'Overview' },
  { to: '/super', label: 'Dashboard', icon: '📊', end: true },
  { to: '/super/reports', label: 'Report Center', icon: '📈' },
  { group: 'Franchises' },
  { to: '/super/franchises', label: 'All franchises', icon: '🏢', end: true },
  { to: '/super/franchises/new', label: 'New franchise', icon: '➕' },
  { to: '/super/requests', label: 'Service & product approvals', icon: '✅', badge: 'pending_requests' },
  { to: '/super/payments', label: 'Payments & commission', icon: '💰' },
  { to: '/super/digital', label: 'Digital Services requests', icon: '💡', badge: 'new_digital' },
  { group: 'Catalog (all franchises)' },
  { to: '/super/categories', label: 'Categories', icon: '🗂️' },
  { to: '/super/services', label: 'Master services', icon: '🧰' },
  { to: '/super/products', label: 'Master products', icon: '🛍️' },
  { to: '/super/pricing', label: 'Prices & items', icon: '₹' },
  { to: '/super/service-types', label: 'Agent types', icon: '🧩' },
  { to: '/super/delivery-charges', label: 'Delivery charges', icon: '🚚' },
  { to: '/super/popular', label: 'Popular on home', icon: '⭐' },
  { to: '/super/promotions', label: 'Offers & promotions', icon: '📢' },
  { group: 'Watch cities · view only (city chosen above)' },
  { to: '/super/orders', label: 'Orders & bookings', icon: '📦', badge: 'waiting', alert: 'overdue' },
  { to: '/super/agents', label: 'Agents', icon: '🛵', badge: 'pending_applications' },
  { to: '/super/live', label: 'Live map', icon: '📍' },
  { to: '/super/complaints', label: 'Complaints', icon: '🙋', badge: 'open_complaints' },
  { to: '/super/ratings', label: 'Reviews & ratings', icon: '⭐', badge: 'low_ratings' },
  { to: '/super/subscriptions', label: 'Subscriptions', icon: '💳', badge: 'pending_subscriptions' },
  { to: '/super/share-ride', label: 'Share Ride', icon: '🚗', badge: 'pending_cars' },
  { to: '/super/workers', label: 'Daily Workers', icon: '👷', badge: 'worker_reports' },
  { to: '/super/areas', label: 'Locations, areas & villages', icon: '🗺️' },
  { to: '/super/shops', label: 'Shops', icon: '🏪' },
  { group: 'People' },
  { to: '/super/users', label: 'Users (customers)', icon: '👥' },
  { to: '/super/admins', label: 'Franchise admins', icon: '🛡️' },
  { group: 'System' },
  { to: '/super/notifications', label: 'Notifications', icon: '📣' },
  { to: '/super/activity', label: 'Audit log', icon: '🕘' },
  { to: '/super/settings', label: 'System settings', icon: '⚙️' },
];

// HQ: which franchise the operations pages show.
function FranchisePicker() {
  const scope = useScope();
  const [list, setList] = useState(null);
  // (re)load when a franchise we don't know yet is chosen — e.g. one just created
  const known = !scope || (list || []).some((f) => String(f.id) === scope);
  useEffect(() => {
    if (list === null || !known) api('/super/franchise-options').then(setList).catch(() => setList([]));
  }, [known]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="franchise-picker" title="Show one franchise, or all">
      <span aria-hidden="true">🏢</span>
      <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Franchise">
        <option value="">All franchises</option>
        {(list || []).map((f) => <option key={f.id} value={f.id}>{f.code} · {f.city}{f.status !== 'active' ? ` (${f.status})` : ''}</option>)}
      </select>
    </label>
  );
}

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const isSuper = user.role === 'superadmin';
  const NAV = isSuper ? SUPER_NAV : FRANCHISE_NAV;
  const base = isSuper ? '/super' : '/admin';
  const scope = useScope();
  const [open, setOpen] = useState(false);
  const [franchise, setFranchise] = useState(null);
  const { pathname } = useLocation();
  // Sidebar badges: orders waiting, agent applications, requests, complaints… (for the chosen franchise)
  const [counts, setCounts] = useState({});
  const loadCounts = () => api('/admin/orders-stats').then(setCounts).catch(() => {});
  useEffect(() => {
    loadCounts();
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  usePoll(loadCounts, 20000);
  useEffect(() => {
    if (!isSuper) api('/franchise/me').then((d) => setFranchise(d.franchise)).catch(() => {});
  }, [isSuper]);

  const links = NAV.filter((n) => n.to);
  const current = links.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));

  return (
    <ToastProvider>
      {/* staff tools stay in English */}
      <div className={`admin ${isSuper ? 'is-super' : ''} ${open ? 'nav-open' : ''}`} translate="no">
        <aside className="admin-sidebar">
          <Link to={base} className="brand admin-brand">
            <span className="brand-logo" translate="no" aria-hidden="true">A<span>S</span></span>
            <span className="brand-name" translate="no">All <em>Services</em> <small>{isSuper ? 'Super Admin · HQ' : franchise ? `${franchise.city} franchise` : 'Franchise admin'}</small></span>
          </Link>
          <nav onClick={() => setOpen(false)}>
            {NAV.map((n, i) => (n.group ? (
              <div key={`g${i}`} className="admin-nav-group">{n.group}</div>
            ) : (
              <NavLink key={n.to} to={n.to} end={n.end} className="admin-nav-link">
                <span className="admin-nav-icon">{n.icon}</span> {n.label}
                {n.badge && counts[n.badge] > 0 && <span className="nav-badge">{counts[n.badge]}</span>}
                {n.alert && counts[n.alert] > 0 && <span className="nav-badge nav-badge-alert" title={`${counts[n.alert]} overdue`}>⏰{counts[n.alert]}</span>}
              </NavLink>
            )))}
          </nav>
        </aside>
        <div className="admin-scrim" onClick={() => setOpen(false)} />

        <div className="admin-main">
          <header className="admin-topbar">
            <button className="icon-btn admin-menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
            <h2>{current?.label || (pathname.startsWith('/super/franchises/') ? 'Franchise' : isSuper ? 'Super Admin' : 'Admin')}</h2>
            <div className="nav-right">
              {isSuper && <FranchisePicker />}
              {!isSuper && franchise && <span className="franchise-chip" title={franchise.name}>🏢 {franchise.code} · {franchise.city}</span>}
              <span className="nav-user">{isSuper ? '👑' : '🛡️'} <b>{user.fullName || user.username}</b></span>
              <button className="btn btn-ghost btn-sm" onClick={logout}>Logout</button>
            </div>
          </header>
          {!isSuper && franchise && franchise.status !== 'active' && (
            <div className="franchise-status-bar">
              ⚠️ Your franchise is <b>{franchise.status}</b>{franchise.status_reason ? `: ${franchise.status_reason}` : ''}. Customers can't order until HQ activates it.
            </div>
          )}
          <div className="admin-content">
            {/* a new franchise chosen at the top reloads the page for it */}
            <div key={`${pathname}|${scope}`} className="route-in"><Outlet /></div>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
