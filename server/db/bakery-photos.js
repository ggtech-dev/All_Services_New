// 🍞 Bread / Bakery photos (2026-10-26): the user's own AI photos (F:\telangana_bakery_ai_product_images —
// "photorealistic AI-generated, unbranded", 1024 px) → products. Files: <app>/public/products/bakery/<file>.jpg.
// Each row: [source file, our file, name, section, unit, existing]
//   existing = the Bread / Bakery product that gets the photo; null = a new product (as per the shop bill, like the rest).

export const BAKERY_SECTIONS = ['Bread & Buns', 'Biscuits, Cookies & Rusks', 'Cakes', 'Pastries & Desserts', 'Puffs & Snacks'];
const BR = 'Bread & Buns', BI = 'Biscuits, Cookies & Rusks', CA = 'Cakes', PA = 'Pastries & Desserts', PU = 'Puffs & Snacks';
const b = 'Bread & Buns/', c = 'Biscuits Cookies & Rusks/', k = 'Cakes/', p = 'Pastries & Desserts/', s = 'Puffs & Savoury Snacks/';

export const BAKERY_PHOTOS = [
  // the products we have
  [`${b}milk_bread.png`, 'milk-bread', 'Milk Bread', BR, '400 g', 'Milk Bread'],
  [`${b}brown_bread.png`, 'brown-bread', 'Brown Bread', BR, '400 g', 'Brown Bread'],
  [`${c}osmania_biscuits.png`, 'osmania-biscuits', 'Osmania Biscuits', BI, '250 g', 'Osmania Biscuits'],
  [`${c}milk_rusk.png`, 'rusk', 'Rusk', BI, '300 g', 'Rusk'],
  [`${k}plum_cake.png`, 'fruit-cake', 'Fruit Cake', CA, '250 g', 'Fruit Cake'],
  // Bread & Buns
  [`${b}white_bread.png`, 'white-bread', 'White Bread', BR, '400 g', null],
  [`${b}sandwich_bread.png`, 'sandwich-bread', 'Sandwich Bread', BR, '400 g', null],
  [`${b}multigrain_bread.png`, 'multigrain-bread', 'Multigrain Bread', BR, '400 g', null],
  [`${b}pav_buns.png`, 'pav-buns', 'Pav Buns', BR, '6 pcs', null],
  [`${b}burger_buns.png`, 'burger-buns', 'Burger Buns', BR, '4 pcs', null],
  [`${b}hot_dog_buns.png`, 'hot-dog-buns', 'Hot Dog Buns', BR, '4 pcs', null],
  [`${b}sweet_buns.png`, 'sweet-bun', 'Sweet Bun', BR, '1 pc', null],
  [`${b}cream_buns.png`, 'cream-bun', 'Cream Bun', BR, '1 pc', null],
  [`${b}dilkhush.png`, 'dilkhush', 'Dilkhush', BR, '1 pc', null],
  // Biscuits, Cookies & Rusks
  [`${c}butter_biscuits.png`, 'butter-biscuits', 'Butter Biscuits', BI, '250 g', null],
  [`${c}salt_biscuits.png`, 'salt-biscuits', 'Salt Biscuits', BI, '250 g', null],
  [`${c}khara_biscuits.png`, 'khara-biscuits', 'Khara Biscuits', BI, '250 g', null],
  [`${c}coconut_biscuits.png`, 'coconut-biscuits', 'Coconut Biscuits', BI, '250 g', null],
  [`${c}jeera_biscuits.png`, 'jeera-biscuits', 'Jeera Biscuits', BI, '250 g', null],
  [`${c}nankhatai.png`, 'nankhatai', 'Nankhatai', BI, '250 g', null],
  [`${c}chocolate_cookies.png`, 'chocolate-cookies', 'Chocolate Cookies', BI, '250 g', null],
  [`${c}choco_chip_cookies.png`, 'choco-chip-cookies', 'Choco-Chip Cookies', BI, '250 g', null],
  [`${c}almond_cookies.png`, 'almond-cookies', 'Almond Cookies', BI, '250 g', null],
  [`${c}elaichi_rusk.png`, 'elaichi-rusk', 'Elaichi Rusk', BI, '300 g', null],
  [`${p}cake_rusk.png`, 'cake-rusk', 'Cake Rusk', BI, '200 g', null],
  [`${c}toast.png`, 'toast', 'Toast', BI, '200 g', null],
  // Cakes
  [`${k}birthday_cake.png`, 'birthday-cake', 'Birthday Cake', CA, '½ kg', null],
  [`${k}photo_cake.png`, 'photo-cake', 'Photo Cake', CA, '1 kg', null],
  [`${k}chocolate_cake.png`, 'chocolate-cake', 'Chocolate Cake', CA, '½ kg', null],
  [`${k}black_forest_cake.png`, 'black-forest-cake', 'Black Forest Cake', CA, '½ kg', null],
  [`${k}white_forest_cake.png`, 'white-forest-cake', 'White Forest Cake', CA, '½ kg', null],
  [`${k}butterscotch_cake.png`, 'butterscotch-cake', 'Butterscotch Cake', CA, '½ kg', null],
  [`${k}pineapple_cake.png`, 'pineapple-cake', 'Pineapple Cake', CA, '½ kg', null],
  [`${k}vanilla_cake.png`, 'vanilla-cake', 'Vanilla Cake', CA, '½ kg', null],
  [`${k}red_velvet_cake.png`, 'red-velvet-cake', 'Red Velvet Cake', CA, '½ kg', null],
  [`${k}eggless_cake.png`, 'eggless-cake', 'Eggless Fruit Cake', CA, '½ kg', null],
  [`${k}tea_cake.png`, 'tea-cake', 'Tea Cake', CA, '1 loaf', null],
  [`${k}cupcakes.png`, 'cupcakes', 'Cupcakes', CA, '4 pcs', null],
  // Pastries & Desserts
  [`${p}chocolate_pastry.png`, 'chocolate-pastry', 'Chocolate Pastry', PA, '1 pc', null],
  [`${p}black_forest_pastry.png`, 'black-forest-pastry', 'Black Forest Pastry', PA, '1 pc', null],
  [`${p}pineapple_pastry.png`, 'pineapple-pastry', 'Pineapple Pastry', PA, '1 pc', null],
  [`${p}butterscotch_pastry.png`, 'butterscotch-pastry', 'Butterscotch Pastry', PA, '1 pc', null],
  [`${p}red_velvet_pastry.png`, 'red-velvet-pastry', 'Red Velvet Pastry', PA, '1 pc', null],
  [`${p}brownie.png`, 'brownie', 'Brownie', PA, '1 pc', null],
  [`${p}chocolate_donut.png`, 'chocolate-donut', 'Chocolate Donut', PA, '1 pc', null],
  [`${p}glazed_donut.png`, 'glazed-donut', 'Glazed Donut', PA, '1 pc', null],
  [`${p}muffin.png`, 'muffin', 'Muffin', PA, '1 pc', null],
  // Puffs & Snacks
  [`${s}veg_puff.png`, 'veg-puff', 'Veg Puff', PU, '1 pc', null],
  [`${s}egg_puff.png`, 'egg-puff', 'Egg Puff', PU, '1 pc', null],
  [`${s}chicken_puff.png`, 'chicken-puff', 'Chicken Puff', PU, '1 pc', null],
  [`${s}paneer_puff.png`, 'paneer-puff', 'Paneer Puff', PU, '1 pc', null],
  [`${s}veg_samosa.png`, 'veg-samosa', 'Veg Samosa', PU, '2 pcs', null],
  [`${s}khara_bun.png`, 'khara-bun', 'Khara Bun', PU, '1 pc', null],
  [`${s}veg_roll.png`, 'veg-roll', 'Veg Roll', PU, '1 pc', null],
  [`${s}chicken_roll.png`, 'chicken-roll', 'Chicken Roll', PU, '1 pc', null],
  [`${s}veg_sandwich.png`, 'veg-sandwich', 'Veg Sandwich', PU, '1 pc', null],
  [`${s}cheese_sandwich.png`, 'cheese-sandwich', 'Cheese Sandwich', PU, '1 pc', null],
  [`${s}chicken_sandwich.png`, 'chicken-sandwich', 'Chicken Sandwich', PU, '1 pc', null],
  [`${s}garlic_bread.png`, 'garlic-bread', 'Garlic Bread', PU, '1 portion', null],
  [`${s}pizza_slice.png`, 'pizza-slice', 'Pizza Slice', PU, '1 slice', null],
  [`${s}veg_pizza.png`, 'veg-pizza', 'Veg Pizza', PU, 'regular', null],
  [`${s}chicken_pizza.png`, 'chicken-pizza', 'Chicken Pizza', PU, 'regular', null],
];
