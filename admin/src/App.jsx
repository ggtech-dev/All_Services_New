import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { HOME_OF } from './appKind.js';
import Login from './pages/Login.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';

// 🛡️ All Services Franchise Admin — one city: orders, agents, areas, subscriptions, reports. Pages load on demand.
const AdminLayout = lazy(() => import('./admin/AdminLayout.jsx'));
const FranchiseHome = lazy(() => import('./admin/FranchiseHome.jsx'));
const MyServices = lazy(() => import('./admin/MyServices.jsx'));
const CatalogRequests = lazy(() => import('./admin/CatalogRequests.jsx'));
const Notifications = lazy(() => import('./admin/Notifications.jsx'));
const Orders = lazy(() => import('./admin/Orders.jsx'));
const Agents = lazy(() => import('./admin/Agents.jsx'));
const ServiceTypes = lazy(() => import('./admin/ServiceTypes.jsx'));
const LiveMap = lazy(() => import('./admin/LiveMap.jsx'));
const Reports = lazy(() => import('./admin/Reports.jsx'));
const Activity = lazy(() => import('./admin/Activity.jsx'));
const Areas = lazy(() => import('./admin/Areas.jsx'));
const Shops = lazy(() => import('./admin/Shops.jsx'));
const Subscriptions = lazy(() => import('./admin/Subscriptions.jsx'));
const ShareRideAdmin = lazy(() => import('./admin/ShareRideAdmin.jsx'));
const WorkersAdmin = lazy(() => import('./admin/WorkersAdmin.jsx'));
const Ratings = lazy(() => import('./admin/Ratings.jsx'));
const Complaints = lazy(() => import('./admin/Complaints.jsx'));

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

// The day-to-day staff pages: the same for a franchise admin (/admin, own city) and the Super Admin (/super, chosen city).
const operationsRoutes = (
  <>
    <Route path="orders" element={<Orders />} />
    <Route path="agents" element={<Agents />} />
    <Route path="live" element={<LiveMap />} />
    <Route path="reports" element={<Reports />} />
    <Route path="ratings" element={<Ratings />} />
    <Route path="complaints" element={<Complaints />} />
    <Route path="subscriptions" element={<Subscriptions />} />
    <Route path="share-ride" element={<ShareRideAdmin />} />
    <Route path="workers" element={<WorkersAdmin />} />
    <Route path="areas" element={<Areas />} />
    <Route path="shops" element={<Shops />} />
    <Route path="service-types" element={<ServiceTypes />} />
    <Route path="activity" element={<Activity />} />
  </>
);

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/admin" element={<RoleOnly role="admin"><AdminLayout /></RoleOnly>}>
          <Route index element={<FranchiseHome />} />
          {operationsRoutes}
          <Route path="my-services" element={<MyServices />} />
          <Route path="requests" element={<CatalogRequests />} />
          <Route path="messages" element={<Notifications />} />
          <Route path="franchise" element={<FranchiseHome />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Suspense>
  );
}
