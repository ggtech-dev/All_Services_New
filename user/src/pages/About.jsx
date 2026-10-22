import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SupportLinks from '../components/SupportLinks.jsx';

// About us · Privacy · Terms, in plain words (linked from the home footer; the Play Store asks for a privacy page).
export default function About() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }, [hash]);
  return (
    <div className="about-page">
      <Link to="/" className="back-link">← Home</Link>

      <section id="about">
        <h1 className="page-title">About All Services</h1>
        <p>
          All Services by GGTech connects people in Siddipet and nearby villages with local shops, delivery agents and service
          providers — water cans, kirana, vegetables, meat, home services, rides and more, in one app.
        </p>
        <p>
          We deliver shop orders with our own local team. For home services, workers and rides we connect you to the provider;
          the service charge is agreed directly between you and them.
        </p>
      </section>

      <section id="privacy">
        <h2>Privacy</h2>
        <ul>
          <li>We keep your name, mobile number, delivery addresses and the location you share, only to deliver your orders and contact you about them.</li>
          <li>Your number and address are shown only to the agent or provider handling your order.</li>
          <li>Photos you add (shopping lists, payment screenshots) are seen only by our team and the agent of that order.</li>
          <li>We do not sell your details or use them for outside advertising.</li>
          <li>You can ask us to delete your account and details at any time using the help buttons below.</li>
        </ul>
      </section>

      <section id="terms">
        <h2>Terms</h2>
        <ul>
          <li>Prices of shop items are as per the shop bill; the delivery charge is shown before you order.</li>
          <li>Service charges for home services, workers and rides are agreed directly with the provider.</li>
          <li>You can cancel an order until an agent picks it up.</li>
          <li>Please give a correct address and location; orders outside our service area cannot be accepted.</li>
          <li>For any problem with an order, raise a complaint in the app or contact us below.</li>
        </ul>
      </section>

      <SupportLinks title="Questions? Talk to us" />
    </div>
  );
}
