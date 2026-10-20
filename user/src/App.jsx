import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Navbar from './components/Navbar.jsx';
import Login from './pages/Login.jsx';
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
import { MyTickets, RideBooking, RideSeats, ShareRideSearch } from './pages/ShareRide.jsx';
import Workers from './pages/Workers.jsx';
import Digital from './pages/Digital.jsx';

// 👤 All Services — customer app: shop, book services, track orders.
const Loading = () => <div className="center-screen"><div className="spinner" /></div>;

// Old "Create an account" links: the login page (keeps where a guest was going).
function ToLogin() {
  const location = useLocation();
  return <Navigate to="/login?mode=signup" replace state={location.state} />;
}

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
      {/* sign-up is the first 📱 Mobile OTP login now; old links land on the login page */}
      <Route path="/register" element={<ToLogin />} />
      <Route path="/" element={<Open><Home /></Open>} />
      <Route path="/category/:slug" element={<Open><Category /></Open>} />
      <Route path="/service/:slug" element={<Open><ServiceShop /></Open>} />
      <Route path="/care/:slug" element={<Open><CareTypes /></Open>} />
      <Route path="/checkout" element={<Protected><Checkout /></Protected>} />
      <Route path="/orders" element={<Protected><MyOrders /></Protected>} />
      <Route path="/account" element={<Protected><Account /></Protected>} />
      <Route path="/orders/:id" element={<Protected><OrderTrack /></Protected>} />
      <Route path="/credits" element={<Open><Credits /></Open>} />
      {/* 🚗 Share Ride: search and seat maps are open to guests; booking, paying and tickets need an account */}
      {/* 👷 free workers list (numbers after login) · 💡 requests to our team (sending needs login) */}
      <Route path="/workers" element={<Open><Workers /></Open>} />
      <Route path="/digital" element={<Open><Digital /></Open>} />
      <Route path="/share-ride" element={<Open><ShareRideSearch /></Open>} />
      <Route path="/share-ride/ride/:id" element={<Open><RideSeats /></Open>} />
      <Route path="/share-ride/booking/:id" element={<Protected><RideBooking /></Protected>} />
      <Route path="/share-ride/tickets" element={<Protected><MyTickets /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
