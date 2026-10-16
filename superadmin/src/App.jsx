import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { HOME_OF } from './appKind.js';
import Login from './pages/Login.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';

// 👑 All Services HQ — Super Admin: every franchise, the master catalog, platform reports. Pages load on demand.
const AdminLayout = lazy(() => import('./admin/AdminLayout.jsx'));
const Dashboard = lazy(() => import('./admin/Dashboard.jsx'));
const Services = lazy(() => import('./admin/Services.jsx'));
const AdminPromotions = lazy(() => import('./admin/Promotions.jsx'));
const Products = lazy(() => import('./admin/Products.jsx'));
const Categories = lazy(() => import('./admin/Categories.jsx'));
const Pricing = lazy(() => import('./admin/Pricing.jsx'));
const Settings = lazy(() => import('./admin/Settings.jsx'));
const DeliveryCharges = lazy(() => import('./admin/DeliveryCharges.jsx'));
const Notifications = lazy(() => import('./admin/Notifications.jsx'));
const CatalogRequests = lazy(() => import('./admin/CatalogRequests.jsx'));
const Orders = lazy(() => import('./admin/Orders.jsx'));
const Agents = lazy(() => import('./admin/Agents.jsx'));
const ServiceTypes = lazy(() => import('./admin/ServiceTypes.jsx'));
const LiveMap = lazy(() => import('./admin/LiveMap.jsx'));
const Reports = lazy(() => import('./admin/Reports.jsx'));
const Activity = lazy(() => import('./admin/Activity.jsx'));
const Areas = lazy(() => import('./admin/Areas.jsx'));
const Shops = lazy(() => import('./admin/Shops.jsx'));
const Subscriptions = lazy(() => import('./admin/Subscriptions.jsx'));
const Ratings = lazy(() => import('./admin/Ratings.jsx'));
const Complaints = lazy(() => import('./admin/Complaints.jsx'));
const SuperDashboard = lazy(() => import('./super/Franchises.jsx').then((m) => ({ default: m.SuperDashboard })));
const Franchises = lazy(() => import('./super/Franchises.jsx').then((m) => ({ default: m.Franchises })));
const FranchiseForm = lazy(() => import('./super/Franchises.jsx').then((m) => ({ default: m.FranchiseForm })));
const FranchiseDetail = lazy(() => import('./super/FranchiseDetail.jsx'));
const SuperAdmins = lazy(() => import('./super/SuperPages.jsx').then((m) => ({ default: m.Admins })));
const SuperUsers = lazy(() => import('./super/SuperPages.jsx').then((m) => ({ default: m.Users })));
const Payments = lazy(() => import('./super/SuperPages.jsx').then((m) => ({ default: m.Payments })));
const PlatformReports = lazy(() => import('./super/SuperPages.jsx').then((m) => ({ default: m.PlatformReports })));

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
        <Route path="/super" element={<RoleOnly role="superadmin"><AdminLayout /></RoleOnly>}>
          <Route index element={<SuperDashboard />} />
          <Route path="platform-reports" element={<PlatformReports />} />
          <Route path="franchises" element={<Franchises />} />
          <Route path="franchises/new" element={<FranchiseForm />} />
          <Route path="franchises/:id" element={<FranchiseDetail />} />
          <Route path="franchises/:id/edit" element={<FranchiseForm />} />
          <Route path="requests" element={<CatalogRequests />} />
          <Route path="payments" element={<Payments />} />
          <Route path="users" element={<SuperUsers />} />
          <Route path="admins" element={<SuperAdmins />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="categories" element={<Categories />} />
          <Route path="services" element={<Services />} />
          <Route path="products" element={<Products />} />
          <Route path="pricing" element={<Pricing />} />
          <Route path="delivery-charges" element={<DeliveryCharges />} />
          <Route path="promotions" element={<AdminPromotions />} />
          <Route path="settings" element={<Settings />} />
          <Route path="catalog-dashboard" element={<Dashboard />} />
          {operationsRoutes}
          <Route path="*" element={<Navigate to="/super" replace />} />
        </Route>
        {/* links written for the admin pages (/admin/orders…) open the same page under /super */}
        <Route path="/admin/*" element={<RoleOnly role="admin"><></></RoleOnly>} />
        <Route path="*" element={<Navigate to="/super" replace />} />
      </Routes>
    </Suspense>
  );
}
