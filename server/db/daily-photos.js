// 🥛🍗🍱 Priority-1 daily sellers (2026-10-25): the user's own AI photos (F:\70images\priority-1-daily-sellers, ChatGPT,
// 1254 px) → products in milk, eggs, meat & fish, fruits, coconut, water, tomorrow's meals and snacks.
// Files: <app>/public/products/daily/<file>.jpg. Each row: [file, service slug, product name].
// A product gets the photo only if it has none or a web (licensed) one — our own photos (e.g. bakery) are kept.

const MEAT = 'food-daily-daily-fresh-meat-fish', MEAL = 'home-food-tomorrows-meal', FRUIT = 'food-daily-fruit-delivery';
const MILK = 'food-daily-fresh-milk', EGG = 'food-daily-egg-delivery', COCO = 'food-daily-fresh-coconut-delivery';

export const DAILY_PHOTOS = [
  // 🍗 meat & fish
  ['boneless-chicken', MEAT, 'Boneless Chicken'],
  ['boneless-chicken', 'food-daily-meat-chicken-delivery', 'Boneless Chicken'],
  ['chicken-skinless', MEAT, 'Chicken – Skinless'],
  ['chicken-with-skin', MEAT, 'Chicken – With Skin'],
  ['country-chicken', MEAT, 'Country Chicken (Natu Kodi)'],
  ['chicken-liver', MEAT, 'Chicken Liver'],
  ['mutton', MEAT, 'Mutton (Goat)'],
  ['mutton', 'food-daily-meat-chicken-delivery', 'Mutton Curry Cut'],
  ['mutton-keema', MEAT, 'Mutton Keema'],
  ['prawns', MEAT, 'Prawns (Royyalu)'],
  ['rohu-fish', MEAT, 'Rohu Fish (Bocha)'],
  ['katla-fish', MEAT, 'Katla Fish'],
  ['murrel-fish', MEAT, 'Murrel Fish (Korameenu)'],
  ['seer-fish', MEAT, 'Seer Fish (Vanjaram)'],
  ['tilapia-fish', MEAT, 'Tilapia Fish'],
  // 🥛 milk
  ['vijaya-full-cream-milk', MILK, 'Vijaya Full Cream Milk (packet)'],
  ['heritage-full-cream-milk', MILK, 'Heritage Full Cream Milk'],
  ['organic-cow-milk', MILK, 'Fresh Organic Cow Milk'],
  ['organic-buffalo-milk', MILK, 'Fresh Organic Buffalo Milk'],
  ['jersey-curd', MILK, 'Jersey Curd'],
  ['buttermilk', MILK, 'Buttermilk (Majjiga)'],
  ['fresh-paneer', MILK, 'Fresh Paneer'],
  ['vijaya-ghee', MILK, 'Vijaya Ghee'],
  // 🥚 eggs
  ['farm-eggs-6', EGG, 'Farm Eggs'],
  ['farm-eggs-tray-30', EGG, 'Farm Eggs Tray'],
  ['country-eggs', EGG, 'Country Eggs (Natu Kodi)'],
  // 🍎 fruits
  ['banana-robusta', FRUIT, 'Banana (Robusta)'],
  ['shimla-apple', FRUIT, 'Shimla Apple'],
  ['pomegranate', FRUIT, 'Pomegranate'],
  ['papaya', FRUIT, 'Papaya'],
  ['guava', FRUIT, 'Guava (Jama)'],
  ['mosambi', FRUIT, 'Sweet Lime (Mosambi)'],
  // 🥥 coconut · 💧 water
  ['tender-coconut', COCO, 'Tender Coconut'],
  ['cooking-coconut', COCO, 'Cooking Coconut'],
  ['water-can-20l', 'home-services-drinking-water-delivery-20l-cans-bottles', '20L Drinking Water Can'],
  // 🍱 tomorrow's meals (lunch and dinner use the same plate photo)
  ['veg-meal', MEAL, 'Veg Meal — Lunch'],
  ['veg-meal', MEAL, 'Veg Meal — Dinner'],
  ['chicken-meal', MEAL, 'Chicken Meal — Lunch'],
  ['chicken-meal', MEAL, 'Chicken Meal — Dinner'],
  ['mutton-meal', MEAL, 'Mutton Meal — Lunch'],
  ['mutton-meal', MEAL, 'Mutton Meal — Dinner'],
  ['fish-meal', MEAL, 'Fish Meal — Lunch'],
  ['fish-meal', MEAL, 'Fish Meal — Dinner'],
  // 🥨 snacks for tomorrow
  ['murukulu', MEAL, 'Murukulu'],
  ['chegodilu', MEAL, 'Chegodilu'],
  ['sakinalu', MEAL, 'Sakinalu'],
  ['karapusa', MEAL, 'Karapusa'],
  ['kara-boondi', MEAL, 'Kara Boondi'],
  ['mixture', MEAL, 'Mixture'],
  ['pappu-chekkalu', MEAL, 'Pappu Chekkalu'],
  ['appalu', MEAL, 'Appalu'],
  ['ariselu', MEAL, 'Ariselu'],
  ['bellam-gavvalu', MEAL, 'Bellam Gavvalu'],
  ['kajjikayalu', MEAL, 'Kajjikayalu'],
  ['sunnundalu', MEAL, 'Sunnundalu'],
];
