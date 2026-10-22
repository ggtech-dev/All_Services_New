import { Link, NavLink, useLocation } from 'react-router-dom';
import { LogOut, Package, ShoppingCart, UserRound } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { useCart } from '../cart.jsx';
import LocationBar from './LocationBar.jsx';
import LangToggle from './LangToggle.jsx';
import { has } from '../appKind.js';

export default function Navbar() {
  const { user, logout } = useAuth();
  const cart = useCart();
  const location = useLocation();
  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <Link to="/" className="brand">
          {/* the logo stays in English in every language (a brand name is not translated) */}
          <span className="brand-logo" translate="no" aria-hidden="true">A<span>S</span></span>
          <span className="brand-name" translate="no">All <em>Services</em></span>
        </Link>
        <LocationBar />
        <div className="nav-right">
          {/* language switch in the top bar on every screen ("Install app": home page and Profile) */}
          <LangToggle className="nav-lang" />
          {!user ? (
            <>
              <NavLink to="/checkout" className="btn btn-ghost cart-link" aria-label={`Cart, ${cart.count} items`}>
                <ShoppingCart size={18} /> <span className="hide-sm">Cart</span>
                {cart.count > 0 && <span className="cart-count">{cart.count}</span>}
              </NavLink>
              <Link to="/login" state={{ from: location.pathname + location.search }} className="btn btn-primary btn-sm nav-login">Log in</Link>
            </>
          ) : (<>
          <span className="nav-user hide-phone">
            Hi, <b>{user.fullName || user.username}</b>
            {user.role !== 'customer' && <span className="role-badge">{user.role}</span>}
          </span>
          {user.role === 'admin' && has('admin') && <Link to="/admin" className="btn btn-ghost">🛡️ <span className="hide-sm">Admin panel</span></Link>}
          {user.role === 'superadmin' && has('super') && <Link to="/super" className="btn btn-ghost">👑 <span className="hide-sm">HQ</span></Link>}
          {/* on phones Orders and Profile are in the bottom tabs; Log out is in Profile */}
          <NavLink to="/orders" className="btn btn-ghost hide-phone"><Package size={18} /> <span className="hide-sm">My orders</span></NavLink>
          <NavLink to="/account" className="btn btn-ghost hide-phone" title="My account"><UserRound size={18} /> <span className="hide-sm">Account</span></NavLink>
          <NavLink to="/checkout" className="btn btn-ghost cart-link" aria-label={`Cart, ${cart.count} items`}>
            <ShoppingCart size={18} /> <span className="hide-sm">Cart</span>
            {cart.count > 0 && <span className="cart-count">{cart.count}</span>}
          </NavLink>
          <button className="btn btn-ghost hide-phone" onClick={logout} title="Logout" aria-label="Logout"><LogOut size={18} /> <span className="hide-sm">Logout</span></button>
          </>)}
        </div>
      </div>
    </header>
  );
}
