import { useEffect, useState } from 'react';

// Which franchise the app is working on — sent to the server as the X-Franchise header.
//   Super Admin: the franchise chosen at the top of the HQ app ('' = all franchises). Kept per browser tab.
//   Customers: the city they chose (one franchise per city). Kept on this device.
// Franchise admins don't choose: the server always uses their own franchise.
const SCOPE_KEY = 'as_scope';
const CITY_KEY = 'as_city';
const listeners = new Set();
const safe = (fn, fallback = '') => {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
};

export const getScope = () => safe(() => sessionStorage.getItem(SCOPE_KEY), '');
export const getCity = () => safe(() => localStorage.getItem(CITY_KEY), '');

export function setScope(id) {
  safe(() => (id ? sessionStorage.setItem(SCOPE_KEY, String(id)) : sessionStorage.removeItem(SCOPE_KEY)));
  listeners.forEach((fn) => fn());
}
export function setCity(id) {
  safe(() => (id ? localStorage.setItem(CITY_KEY, String(id)) : localStorage.removeItem(CITY_KEY)));
  listeners.forEach((fn) => fn());
}

// Re-renders when the scope or city changes.
function useStore(get) {
  const [value, setValue] = useState(get);
  useEffect(() => {
    const fn = () => setValue(get());
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, [get]);
  return value;
}
export const useScope = () => useStore(getScope);
export const useCity = () => useStore(getCity);

// The header value for a request: staff pages use the HQ choice, everything else the customer's city.
export const franchiseHeaderFor = (path) =>
  (/^\/(admin|super|franchise|offers\/admin|transport\/admin)(\/|$)/.test(path) ? getScope() : getCity());
