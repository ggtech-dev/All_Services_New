import { Link, useLocation, useNavigate } from 'react-router-dom';

// "← Back" at the top of a page: goes back to wherever the customer came from (the shop, the service, the category…);
// opened directly (a shared link, a refresh), it goes to `to` instead.
export default function BackLink({ to = '/', children = 'Back' }) {
  const navigate = useNavigate();
  const { key } = useLocation();
  const cameFromApp = key !== 'default';
  return (
    <Link to={to} className="back-link" onClick={(e) => { if (cameFromApp) { e.preventDefault(); navigate(-1); } }}>
      ← {children}
    </Link>
  );
}
