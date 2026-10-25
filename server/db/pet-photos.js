// 🐾 Pet Food photos (2026-10-25): the user's own AI photos (F:\pet_ai_generated_product_images — "AI-generated catalog
// photo", 1024 px) → products. Files: <app>/public/products/pet/<file>.jpg.
// Each row: [source file, our file, name, section, unit, existing]
//   existing = the Pet Food product that gets the photo; null = a new product (as per the shop bill, like the rest).

export const PET_SECTIONS = ['Dog Food', 'Cat Food', 'Treats', 'Accessories', 'Health & Care'];
const DF = 'Dog Food', CF = 'Cat Food', TR = 'Treats', AC = 'Accessories', HC = 'Health & Care';
const d = 'Dog Food/', c = 'Cat Food/', t = 'Pet Treats/', a = 'Pet Accessories/', h = 'Pet Health Products/';

export const PET_PHOTOS = [
  // the products we have (Pedigree / Whiskas)
  [`${d}pedigree_adult_dog_food.png`, 'pedigree-adult', 'Adult Dog Food', DF, '3 kg', 'Adult Dog Food'],
  [`${c}whiskas_adult_cat_food.png`, 'whiskas-adult', 'Cat Food', CF, '1.2 kg', 'Cat Food'],
  // Dog Food
  [`${d}pedigree_puppy_food.png`, 'pedigree-puppy', 'Pedigree Puppy Food', DF, '3 kg', null],
  [`${d}drools_adult_dog_food.png`, 'drools-adult', 'Drools Adult Dog Food', DF, '3 kg', null],
  [`${d}drools_puppy_food.png`, 'drools-puppy', 'Drools Puppy Food', DF, '3 kg', null],
  [`${d}purepet_adult_dog_food.png`, 'purepet-adult', 'Purepet Adult Dog Food', DF, '3 kg', null],
  [`${d}royal_canin_maxi_adult.png`, 'royal-canin-maxi-adult', 'Royal Canin Maxi Adult', DF, '4 kg', null],
  [`${d}royal_canin_mini_puppy.png`, 'royal-canin-mini-puppy', 'Royal Canin Mini Puppy', DF, '2 kg', null],
  [`${d}farmina_n_d_dog_food.png`, 'farmina-nd-dog', 'Farmina N&D Dog Food', DF, '2.5 kg', null],
  [`${d}acana_dog_food.png`, 'acana-dog', 'Acana Dog Food', DF, '2 kg', null],
  [`${d}orijen_dog_food.png`, 'orijen-dog', 'Orijen Dog Food', DF, '2 kg', null],
  // Cat Food
  [`${c}whiskas_kitten_food.png`, 'whiskas-kitten', 'Whiskas Kitten Food', CF, '1.1 kg', null],
  [`${c}me_o_cat_food.png`, 'me-o-cat', 'Me-O Cat Food', CF, '1.2 kg', null],
  [`${c}drools_cat_food.png`, 'drools-cat', 'Drools Cat Food', CF, '1.2 kg', null],
  [`${c}purepet_cat_food.png`, 'purepet-cat', 'Purepet Cat Food', CF, '1.2 kg', null],
  [`${c}signature_cat_food.png`, 'signature-cat', 'Signature Cat Food', CF, '1.2 kg', null],
  [`${c}royal_canin_kitten_food.png`, 'royal-canin-kitten', 'Royal Canin Kitten Food', CF, '400 g', null],
  [`${c}royal_canin_persian_cat_food.png`, 'royal-canin-persian', 'Royal Canin Persian Cat Food', CF, '400 g', null],
  [`${c}farmina_cat_food.png`, 'farmina-cat', 'Farmina Cat Food', CF, '1.5 kg', null],
  [`${c}sheba_wet_cat_food.png`, 'sheba-wet-cat', 'Sheba Wet Cat Food', CF, '85 g', null],
  // Treats
  [`${t}pedigree_dentastix.png`, 'pedigree-dentastix', 'Pedigree Dentastix', TR, '7 sticks', null],
  [`${t}drools_treats.png`, 'drools-treats', 'Drools Crunchy Treats', TR, '150 g', null],
  [`${t}chip_chops_chicken_treats.png`, 'chip-chops', 'Chip Chops Chicken Treats', TR, '70 g', null],
  [`${t}jerhigh_chicken_treats.png`, 'jerhigh-chicken', 'JerHigh Chicken Treats', TR, '70 g', null],
  [`${t}biscuits_for_dogs.png`, 'dog-biscuits', 'Biscuits for Dogs', TR, '500 g', null],
  [`${t}chew_sticks.png`, 'chew-sticks', 'Chew Sticks', TR, '1 pack', null],
  [`${t}training_treats.png`, 'training-treats', 'Training Treats', TR, '200 g', null],
  [`${t}cat_creamy_treats.png`, 'cat-creamy-treats', 'Cat Creamy Treats', TR, '4 sticks', null],
  // Accessories
  [`${a}dog_bowl.png`, 'dog-bowl', 'Dog Bowl', AC, '1 pc', null],
  [`${a}feeding_mat.png`, 'feeding-mat', 'Feeding Mat', AC, '1 pc', null],
  [`${a}dog_collar.png`, 'dog-collar', 'Dog Collar', AC, '1 pc', null],
  [`${a}dog_leash.png`, 'dog-leash', 'Dog Leash', AC, '1 pc', null],
  [`${a}pet_bed.png`, 'pet-bed', 'Pet Bed', AC, '1 pc', null],
  [`${a}pet_carrier.png`, 'pet-carrier', 'Pet Carrier', AC, '1 pc', null],
  [`${a}pet_toys.png`, 'pet-toys', 'Pet Toys', AC, '1 set', null],
  [`${a}cat_litter.png`, 'cat-litter', 'Cat Litter', AC, '5 kg', null],
  [`${a}cat_litter_tray.png`, 'cat-litter-tray', 'Cat Litter Tray', AC, '1 pc', null],
  [`${a}pet_shampoo.png`, 'pet-shampoo', 'Pet Shampoo', AC, '200 ml', null],
  // Health & Care
  [`${h}tick_flea_shampoo.png`, 'tick-flea-shampoo', 'Tick & Flea Shampoo', HC, '200 ml', null],
  [`${h}deworming_tablets.png`, 'deworming-tablets', 'Deworming Tablets', HC, '1 strip', null],
  [`${h}pet_multivitamins.png`, 'pet-multivitamins', 'Pet Multivitamins', HC, '1 jar', null],
  [`${h}calcium_supplements.png`, 'pet-calcium', 'Calcium Supplements', HC, '1 bottle', null],
  [`${h}ear_cleaning_solution.png`, 'ear-cleaner', 'Ear Cleaning Solution', HC, '100 ml', null],
  [`${h}dental_care_treats.png`, 'dental-care-treats', 'Dental Care Treats', HC, '1 pack', null],
];
