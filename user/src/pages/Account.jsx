import { Link } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import AccountSecurity from '../components/AccountSecurity.jsx';
import { InstallButton, ShareApp } from '../components/InstallApp.jsx';
import AlertsCard from '../components/AlertsCard.jsx';
import SupportLinks from '../components/SupportLinks.jsx';
import { MyComplaints } from '../components/CustomerComplaints.jsx';

// Customer "My account": profile summary, mobile number and password.
export default function Account() {
  const { user, logout } = useAuth();
  return (
    <div className="stack">
      <Link to="/" className="back-link">← Home</Link>
      <h1 className="page-title">My account</h1>
      <section className="panel profile-card">
        <div className="agent-avatar">{(user.fullName || user.username)[0].toUpperCase()}</div>
        <h2>{user.fullName || user.username}</h2>
        {/* accounts made by mobile OTP have a made-up username (m + number): show only the number */}
        <p className="muted">{user.phone && `📱 +91 ${user.phone}`}{!/^m\d{10}(_\d+)?$/.test(user.username) && ` · @${user.username}`}</p>
      </section>
      <AlertsCard who="customer" />
      <Link to="/share-ride/tickets" className="panel account-link">🎫 My Share Ride tickets <span>›</span></Link>
      <Link to="/my-offers" className="panel account-link">📢 My shop offers <span>›</span></Link>
      <Link to="/advertise" className="panel account-link">📣 Advertise your shop <span>›</span></Link>
      <MyComplaints />
      <AccountSecurity />
      <InstallButton />
      <ShareApp />
      <SupportLinks className="panel center-links" />
      <button type="button" className="btn btn-ghost btn-block logout-btn" onClick={logout}><LogOut size={18} /> Log out</button>
      <p className="muted small center"><Link to="/credits" className="link">📷 Photo credits</Link></p>
    </div>
  );
}
