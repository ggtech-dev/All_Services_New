import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Navbar from './components/Navbar.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Home from './pages/Home.jsx';
import Category from './pages/Category.jsx';
import ServiceShop from './pages/ServiceShop.jsx';
import CareTypes from './pages/CareTypes.jsx';
import Checkout from './pages/Checkout.jsx';
import MyOrders from './pages/MyOrders.jsx';
import Account from './pages/Account.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import OrderTrack from './pages/OrderTrack.jsx';
import Credits from './pages/Credits.jsx';

// 👤 All Services — customer app: shop, book services, track orders.
const Loading = () => <div className="center-screen"><div className="spinner" /></div>;

// Pages that need a logged-in customer.
function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return (
    <>
      <Navbar />
      <main className="container">{children}</main>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<Protected><Home /></Protected>} />
      <Route path="/category/:slug" element={<Protected><Category /></Protected>} />
      <Route path="/service/:slug" element={<Protected><ServiceShop /></Protected>} />
      <Route path="/care/:slug" element={<Protected><CareTypes /></Protected>} />
      <Route path="/checkout" element={<Protected><Checkout /></Protected>} />
      <Route path="/orders" element={<Protected><MyOrders /></Protected>} />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      <Route path="/orders/:id" element={<Protected><OrderTrack /></Protected>} />
      <Route path="/credits" element={<Protected><Credits /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
