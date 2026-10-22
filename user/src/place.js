import { useEffect, useState } from 'react';
import { setCity } from './scope.js';

// 📍 Where the customer wants things delivered, chosen in the top bar ("Detect my location" or an area / village
// from our list). Kept on this device. It also picks the city (franchise) that serves the spot.
//   { area, locality_id, city, franchise_id, lat?, lng?, accuracy?, gps: true when it came from the phone's GPS }
// Checkout uses it to fill the area, and a GPS spot as the delivery pin.
const KEY = 'as_place';
const ASKED = 'as_place_asked'; // the location box opened once on its own
const listeners = new Set();

export const getPlace = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
};
export function setPlace(place) {
  try {
    place ? localStorage.setItem(KEY, JSON.stringify(place)) : localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  if (place?.franchise_id) setCity(place.franchise_id);
  listeners.forEach((fn) => fn());
}
export const placeAsked = () => {
  try {
    return localStorage.getItem(ASKED) === '1';
  } catch {
    return true; // no storage: never pop up on its own
  }
};
export const markPlaceAsked = () => {
  try {
    localStorage.setItem(ASKED, '1');
  } catch {
    /* storage unavailable */
  }
};

export function usePlace() {
  const [place, set] = useState(getPlace);
  useEffect(() => {
    const fn = () => set(getPlace());
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return place;
}
