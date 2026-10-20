import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import AccountSecurity from '../components/AccountSecurity.jsx';
import { InstallButton, ShareApp } from '../components/InstallApp.jsx';
import AlertsCard from '../components/AlertsCard.jsx';
import SupportLinks from '../components/SupportLinks.jsx';
import { MyComplaints } from '../components/CustomerComplaints.jsx';

// Customer "My account": profile summary, mobile number and password.
export default function Account() {
  const { user } = useAuth();
  return (
    <div className="stack">
      <h1 className="page-title">My account</h1>
      <section className="panel profile-card">
        <div className="agent-avatar">{(user.fullName || user.username)[0].toUpperCase()}</div>
        <h2>{user.fullName || user.username}</h2>
        {/* accounts made by mobile OTP have a made-up username (m + number): show only the number */}
        <p className="muted">{user.phone && `📱 +91 ${user.phone}`}{!/^m\d{10}(_\d+)?$/.test(user.username) && ` · @${user.username}`}</p>
      </section>
      <AlertsCard who="customer" />
      <Link to="/share-ride/tickets" className="panel account-link">🎫 My Share Ride tickets <span>›</span></Link>
      <MyComplaints />
      <AccountSecurity />
      <InstallButton />
      <ShareApp />
      <SupportLinks className="panel center-links" />
      <p className="muted small center"><Link to="/credits" className="link">📷 Photo credits</Link></p>
    </div>
  );
}
