import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { setCity, useCity } from '../scope.js';
import { useCart } from '../cart.jsx';
import { askConfirm } from './ConfirmDialog.jsx';

// Customers choose their city (each city is run by one franchise). With only one city there is nothing to choose:
// it is picked automatically and the chooser stays hidden.
let cache = null;
export function useCities() {
  const [list, setList] = useState(cache || []);
  useEffect(() => {
    if (!cache) api('/franchises').then((l) => setList((cache = l))).catch(() => {});
  }, []);
  return list;
}

// 📍 GPS → the nearest city of ours whose range covers you (server: /locate)
function LocateButton({ onCity }) {
  const [msg, setMsg] = useState('');
  const locate = () => {
    if (!navigator.geolocation) return setMsg('Location is not available on this device — choose your city below');
    setMsg('Finding you…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const z = await api(`/locate?lat=${pos.coords.latitude.toFixed(6)}&lng=${pos.coords.longitude.toFixed(6)}`);
          if (z.franchise) onCity(z.franchise.id);
          else setMsg('Sorry, we are not in your area yet. You can still look around a city below.');
        } catch (e) {
          setMsg(e.message);
        }
      },
      () => setMsg('Location is blocked — choose your city below'),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };
  return (
    <div className="locate-row">
      <button type="button" className="btn btn-primary" onClick={locate}>📍 Use my location</button>
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
}

export default function CityPicker({ compact = false }) {
  const cities = useCities();
  const city = useCity();
  const cart = useCart();
  const current = cities.find((c) => String(c.id) === city);
  // one city: choose it silently · chosen city no longer open: forget it
  useEffect(() => {
    if (cities.length === 1 && city !== String(cities[0].id)) setCity(cities[0].id);
    if (cities.length > 1 && city && !current) setCity('');
  }, [cities, city, current]);

  if (cities.length < 2) return null;
  const choose = async (id) => {
    if (id === city) return;
    if (cart.count > 0 && !(await askConfirm('Changing your city clears your cart (shops and prices are different in each city). Continue?', { okText: 'Change city' }))) return;
    cart.clear();
    setCity(id);
  };
  if (!current) {
    // first visit: ask before showing anything — the phone's location picks the city that serves it
    return (
      <div className="city-gate" role="dialog" aria-modal="true" aria-label="Choose your city">
        <div className="city-gate-card">
          <h2>📍 Where are you?</h2>
          <p className="muted">Use your location, or choose your city to see the services available there.</p>
          <LocateButton onCity={(id) => choose(String(id))} />
          <div className="city-grid">
            {cities.map((c) => (
              <button key={c.id} type="button" className="city-btn" onClick={() => choose(String(c.id))}>
                <b>{c.city}</b><small>{c.state}</small>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }
  return (
    <label className={`city-picker ${compact ? 'compact' : ''}`} title="Your city">
      <span aria-hidden="true">📍</span>
      <select value={city} onChange={(e) => choose(e.target.value)} aria-label="Your city">
        {cities.map((c) => <option key={c.id} value={c.id}>{c.city}</option>)}
      </select>
    </label>
  );
}
