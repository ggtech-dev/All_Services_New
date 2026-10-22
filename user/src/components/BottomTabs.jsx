import { NavLink, useLocation } from 'react-router-dom';
import { House, Package, Ticket, UserRound } from 'lucide-react';
import { useAuth } from '../auth.jsx';

// Phone screens: the main places at the bottom, like other delivery apps (Home · Orders · Tickets · Profile).
// Guests are asked to log in for Orders, Tickets and Profile, and come back to the same page afterwards.
const TABS = [
  ['/', 'Home', House, true],
  ['/orders', 'Orders', Package],
  ['/share-ride/tickets', 'Tickets', Ticket],
  ['/account', 'Profile', UserRound],
];

export default function BottomTabs() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  return (
    <nav className="bottom-tabs" aria-label="Main">
      {TABS.map(([to, label, Icon, exact]) => {
        const href = user || exact ? to : '/login';
        const active = exact ? pathname === to : pathname.startsWith(to);
        return (
          <NavLink key={to} to={href} state={!user && !exact ? { from: to } : undefined} className={active ? 'active' : ''} end={exact} aria-current={active ? 'page' : undefined}>
            <Icon size={22} strokeWidth={active ? 2.3 : 1.8} />
            <span>{label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
