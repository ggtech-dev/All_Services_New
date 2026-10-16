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

// Pages anyone can open — guests too: home, categories, shops, doctor types, photo credits.
function Open({ children }) {
  const { loading } = useAuth();
  if (loading) return <Loading />;
  return (
    <>
      <Navbar />
      <main className="container">{children}</main>
    </>
  );
}

// Pages that need an account: checkout / booking, my orders, order tracking, account. A guest is asked to sign in
// and comes back to the same page afterwards (the cart is kept).
function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Open>{children}</Open>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<Open><Home /></Open>} />
      <Route path="/category/:slug" element={<Open><Category /></Open>} />
      <Route path="/service/:slug" element={<Open><ServiceShop /></Open>} />
      <Route path="/care/:slug" element={<Open><CareTypes /></Open>} />
      <Route path="/checkout" element={<Protected><Checkout /></Protected>} />
      <Route path="/orders" element={<Protected><MyOrders /></Protected>} />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      <Route path="/orders/:id" element={<Protected><OrderTrack /></Protected>} />
      <Route path="/credits" element={<Open><Credits /></Open>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
