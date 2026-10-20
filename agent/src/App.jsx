import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { HOME_OF } from './appKind.js';
import Login from './pages/Login.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';

// 🛵 All Services Partner — agent app: go online, take orders, wallet, subscriptions. Pages load on demand.
const AgentApply = lazy(() => import('./pages/AgentApply.jsx'));
const AgentLayout = lazy(() => import('./agent/AgentLayout.jsx'));
const AgentHome = lazy(() => import('./agent/AgentHome.jsx'));
const AgentOrders = lazy(() => import('./agent/AgentPages.jsx').then((m) => ({ default: m.AgentOrders })));
const AgentWallet = lazy(() => import('./agent/AgentPages.jsx').then((m) => ({ default: m.AgentWallet })));
const AgentProfile = lazy(() => import('./agent/AgentPages.jsx').then((m) => ({ default: m.AgentProfile })));
const AgentPayQr = lazy(() => import('./agent/AgentPages.jsx').then((m) => ({ default: m.AgentPayQr })));
const AgentSubscriptions = lazy(() => import('./agent/AgentPages.jsx').then((m) => ({ default: m.AgentSubscriptions })));
const ShareRideOwner = lazy(() => import('./agent/ShareRideOwner.jsx'));

const Loading = () => <div className="center-screen"><div className="spinner" /></div>;

// Pages for one kind of account. The Super Admin following an /admin/… link lands on the same page under /super/….
function RoleOnly({ role, children }) {
  const { user, loading } = useAuth();
  const { pathname, search } = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (role === 'admin' && user.role === 'superadmin') return <Navigate to={pathname.replace(/^\/admin/, '/super') + search} replace />;
  if (user.role !== role) return <Navigate to={HOME_OF[user.role] || '/'} replace />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/agent/apply" element={<AgentApply />} />
        <Route path="/agent" element={<RoleOnly role="agent"><AgentLayout /></RoleOnly>}>
          <Route index element={<AgentHome />} />
          <Route path="orders" element={<AgentOrders />} />
          <Route path="wallet" element={<AgentWallet />} />
          <Route path="profile" element={<AgentProfile />} />
          <Route path="pay-qr" element={<AgentPayQr />} />
          <Route path="subscriptions" element={<AgentSubscriptions />} />
          <Route path="share-ride" element={<ShareRideOwner />} />
        </Route>
        <Route path="*" element={<Navigate to="/agent" replace />} />
      </Routes>
    </Suspense>
  );
}
