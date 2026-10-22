import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

// First screen for a new visitor: Siddipet at night (Komati Cheruvu cable bridge), what the app does, and
// "Get started" (sign up) or "Login". Shown once — "Explore first" goes to the home page as a guest.
export const WELCOME_KEY = 'as_welcome_seen';
export const markWelcomeSeen = () => {
  try {
    localStorage.setItem(WELCOME_KEY, '1');
  } catch {
    /* storage blocked: the welcome screen may show again, that is all */
  }
};
export const welcomeSeen = () => {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return true;
  }
};

export default function Welcome() {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return (
    <div className="welcome">
      <div className="welcome-photo" role="img" aria-label="Komati Cheruvu cable bridge, Siddipet, at night" />
      <div className="welcome-top">
        <img src="/icons/icon-192.png" alt="" className="welcome-logo" />
        <h1>All Services<br />in One App</h1>
        <p>Water cans, kirana, vegetables, plumbers, electricians, Share Ride and more — in Siddipet.</p>
      </div>
      <div className="welcome-actions">
        <Link to="/login?mode=signup" className="btn btn-primary btn-block welcome-start" onClick={markWelcomeSeen}>Get Started</Link>
        <Link to="/login" className="btn btn-block welcome-login" onClick={markWelcomeSeen}>Login</Link>
        <Link to="/" className="welcome-explore" onClick={markWelcomeSeen}>Explore first →</Link>
        <p className="welcome-tags">Fast · Safe · Local</p>
      </div>
    </div>
  );
}
