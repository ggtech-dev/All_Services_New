import {
  BadgePercent, Bike, CarFront, Truck, CarTaxiFront, ChefHat, HardHat, HeartPulse, LayoutGrid, MonitorSmartphone, PartyPopper, ShoppingBasket, Sparkles, Store,
  Soup, Tractor, Wrench,
} from 'lucide-react';

// One icon style for the whole customer app (Lucide line icons, free for business use): the same look on every phone,
// unlike emojis, which change from Samsung to iPhone. Each category has its own strong colour (light → dark gradient)
// with a white icon, so people recognise it at a glance — fixed colour pairs, so older phones show the same thing.
export const CATEGORY_ICONS = {
  'food-daily': [ShoppingBasket, '#22c55e', '#15803d'],
  'home-services': [Wrench, '#3b82f6', '#1d4ed8'],
  'shop-for-me': [Store, '#14b8a6', '#0f766e'],
  'village-needs': [Tractor, '#84cc16', '#4d7c0f'],
  vehicle: [Bike, '#fb923c', '#c2410c'],
  'daily-workers': [HardHat, '#f59e0b', '#b45309'],
  personal: [Sparkles, '#f472b6', '#be185d'],
  events: [PartyPopper, '#d946ef', '#a21caf'],
  'vehicle-rental': [CarFront, '#22d3ee', '#0e7490'],
  'share-ride': [CarTaxiFront, '#a78bfa', '#6d28d9'],
  'digital-services': [MonitorSmartphone, '#818cf8', '#4338ca'],
  health: [HeartPulse, '#f87171', '#b91c1c'],
  'book-your-cook': [ChefHat, '#fb923c', '#c2410c'],
  'tomorrow-food': [Soup, '#fb7185', '#be123c'],
  offers: [BadgePercent, '#fb923c', '#ea580c'],
  'goods-transport': [Truck, '#38bdf8', '#0369a1'],
};
const glow = (hex) => `0 8px 18px -8px ${hex}cc`; // soft shadow in the category's own colour

// A category icon: a rounded square in the category's colour with a white icon (size = width in px).
// soft: the calm home-page look — a pale tint of the colour with the icon in the colour, no glow.
export function CategoryIcon({ slug, size = 56, soft = false }) {
  const [Icon, light, dark] = CATEGORY_ICONS[slug] || [LayoutGrid, '#818cf8', '#4338ca'];
  const look = soft
    ? { color: dark, backgroundColor: `${dark}14`, border: `1px solid ${dark}22` }
    : { color: '#fff', backgroundColor: dark, backgroundImage: `linear-gradient(145deg, ${light}, ${dark})`, boxShadow: glow(dark) };
  return (
    <span
      className={`cat-icon${soft ? ' soft' : ''}`}
      style={{ width: size, height: size, ...look }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.48)} strokeWidth={2} />
    </span>
  );
}
