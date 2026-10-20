import { kiranaProducts } from './kirana.js';
import { poojaProducts } from './pooja.js';

// Seed catalog. Each service: [name, image keywords, starting price (₹), price unit, ETA minutes, needs licensed provider]
// Image keywords are looked up once by fetch-images.js (Openverse, Creative Commons) and cached in images.json.

export const categories = [
  {
    slug: 'home-services', name: 'Everyday Home Services', icon: '🏠', color: '#2563eb',
    description: 'Water, repairs, cleaning and laundry at your doorstep.',
    image: 'house,cleaning',
    services: [
      ['Drinking Water Delivery (20L cans, bottles)', 'water,bottle', 40, 'per can', 30],
      ['Empty Water-Can Pickup', 'water,container', 0, 'free', 60],
      ['Water-Tank Cleaning', 'water,tank', 799, 'per tank', 240],
      ['Water Filter / RO Service', 'water,filter', 349, 'per visit', 180],
      ['Plumber on Demand', 'plumber', 199, 'visit charge', 60],
      ['Electrician on Demand', 'electrician', 199, 'visit charge', 60],
      ['AC Service', 'air,conditioner', 499, 'per unit', 180],
      ['Washing Machine Repair', 'washing,machine', 299, 'visit charge', 180],
      ['Refrigerator Repair', 'refrigerator', 299, 'visit charge', 180],
      ['TV / Electronics Repair', 'television,repair', 299, 'visit charge', 240],
      ['Carpenter', 'carpenter', 249, 'visit charge', 120],
      ['Painter', 'house,painter', 12, 'per sq ft', 1440],
      ['Home Cleaning', 'house,cleaning', 999, 'per visit', 240],
      ['Bathroom / Kitchen Deep Cleaning', 'kitchen,cleaning', 699, 'per room', 240],
      ['Pest Control', 'pest,control', 899, 'per visit', 1440],
      ['Sofa / Carpet Cleaning', 'sofa,carpet', 499, 'per seat', 240],
      ['Laundry Pickup & Delivery', 'laundry', 79, 'per kg', 1440],
      ['Ironing Pickup & Delivery', 'ironing,clothes', 10, 'per piece', 1440],
    ],
  },
  {
    slug: 'food-daily', name: 'Food & Daily-Use Delivery', icon: '🛒', color: '#16a34a',
    description: 'Groceries, fresh produce and daily essentials, delivered fast.',
    image: 'grocery,store',
    services: [
      ['Instant Delivery', 'grocery,store', 0, 'within 15 min', 15],
      ['Fresh Vegetables', 'fresh,vegetables', 0, 'as per market price', 60],
      ['Daily Fresh Meat & Fish', 'fresh,meat', 0, 'as per market price', 60],
      ['Fresh Milk', 'fresh,milk', 0, 'organic & packet milk', 60],
      ['Kirana Delivery', 'grocery', 0, 'free delivery', 30],
      ['Pooja Store', 'pooja,store', 0, 'as per shop bill', 60],
      ['Vegetable Delivery', 'vegetables', 0, 'free delivery', 30],
      ['Fruit Delivery', 'fruits', 0, 'free delivery', 30],
      ['Milk Delivery', 'milk', 30, 'per litre', 30],
      ['Egg Delivery', 'eggs', 7, 'per egg', 30],
      ['Bread / Bakery Delivery', 'bakery,bread', 0, 'free delivery', 30],
      ['Meat / Chicken Delivery', 'chicken,meat', 0, 'free delivery', 45],
      ['Fish Delivery', 'fish,market', 0, 'free delivery', 45],
      ['Fresh Coconut Delivery', 'coconut', 45, 'per coconut', 45],
      ['Cooking Gas Booking', 'gas,cylinder', 0, 'as per agency', 1440, true],
      ['Pet Food Delivery', 'pet,food', 0, 'free delivery', 60],
      ['Monthly Grocery Subscription', 'groceries,basket', 0, 'monthly plan', 1440],
    ],
  },
  {
    slug: 'health', name: 'Health Services', icon: '💊', color: '#dc2626',
    // Two services: Medicine Delivery (like kirana: prescription photo → shop bill) and Home Doctor Visit, a group of
    // types (serviceParents below) for subscribed doctor partners. No prices: agreed with the doctor / per shop bill.
    description: 'Medicines from your nearby medical shop, and doctors, nurses and care at home.',
    image: 'pharmacy',
    services: [
      ['Medicine Delivery', 'pharmacy,medicine', 0, 'as per medical shop bill', 45, true],
      ['Home Doctor Visit', 'doctor,home,visit', 0, 'fee agreed with the doctor', null, true],
      ['RMP / Local Medical Practitioner', 'doctor,village', 0, 'fee agreed with the doctor', null, true],
      ['General Physician', 'doctor,physician', 0, 'fee agreed with the doctor', null, true],
      ['Nurse Home Visit', 'nurse,injection', 0, 'fee agreed with the nurse', null, true],
      ['Blood Sample Collection at Home', 'blood,test', 0, 'fee agreed with the partner', null, true],
      ['BP Check at Home', 'blood,pressure', 0, 'fee agreed with the partner', null, true],
      ['Blood Sugar Check', 'glucose,test', 0, 'fee agreed with the partner', null, true],
      ['Physiotherapy Home Visit', 'physiotherapy', 0, 'fee agreed with the partner', null, true],
      ['Elderly Care / Patient Attendant', 'elderly,care', 0, 'fee agreed with the partner', null],
      ['Ambulance Booking', 'ambulance', 0, 'fare agreed with the driver', null],
    ],
  },
  {
    slug: 'vehicle', name: 'Vehicle Services', icon: '🚗', color: '#ea580c',
    description: 'Punctures, washes, repairs and inspections where you are.',
    image: 'car,mechanic',
    services: [
      ['Bike Puncture Service', 'motorcycle,tire', 99, 'per visit', 30],
      ['Mobile Bike Repair', 'motorcycle,repair', 199, 'visit charge', 60],
      ['Car Puncture Service', 'car,tire', 199, 'per visit', 45],
      ['Car Wash at Home', 'car,wash', 399, 'per wash', 120],
      ['Bike Wash at Home', 'motorcycle,wash', 149, 'per wash', 60],
      ['Car Detailing', 'car,detailing', 1499, 'per car', 240],
      ['Battery Replacement', 'car,battery', 199, 'visit charge', 60],
      ['Towing Service', 'tow,truck', 999, 'per tow', 60],
      ['Vehicle Pickup / Drop for Servicing', 'car,service', 299, 'per trip', 1440],
      ['Used Bike Inspection', 'motorcycle', 499, 'per bike', 1440],
      ['Used Car Inspection', 'used,car', 999, 'per car', 1440],
    ],
  },
  {
    slug: 'personal', name: 'Family & Personal Services', icon: '👨‍👩‍👧', color: '#9333ea',
    description: 'Salon, tailoring, repairs, tuition and pet care at home.',
    image: 'family,home',
    services: [
      ['Barber Home Service', 'barber', 199, 'per visit', 120],
      ['Beauty / Salon at Home', 'beauty,salon', 499, 'per visit', 180],
      ['Tailoring Pickup & Delivery', 'tailor,sewing', 99, 'pickup', 1440],
      ['Shoe Repair Pickup', 'shoe,repair', 99, 'pickup', 1440],
      ['Bag Repair', 'bag,leather', 99, 'pickup', 1440],
      ['Watch Repair Pickup', 'watch,repair', 99, 'pickup', 1440],
      ['Mobile Phone Repair Pickup', 'smartphone,repair', 149, 'pickup', 1440],
      ['Computer / Laptop Repair', 'laptop,repair', 299, 'visit charge', 1440],
      ['Home Tuition', 'tutor,student', 2000, 'per month', 2880],
      ['School Bag / Books / Uniform Delivery', 'school,books', 0, 'free delivery', 1440],
      ['Baby Product Delivery', 'baby,products', 0, 'free delivery', 60],
      ['Pet Grooming', 'dog,grooming', 699, 'per pet', 1440],
      ['Pet Walking', 'dog,walking', 149, 'per walk', 120],
    ],
  },
  {
    // Events: the customer books with the date, time and venue; event partners (events_agent) call them and agree the price.
    slug: 'events', name: 'Events', icon: '🎉', color: '#db2777',
    description: 'Weddings, birthdays and functions — photographers, decorators, caterers and more.',
    image: 'wedding,decoration',
    services: [
      ['Photography', 'event,photographer', 0, 'price on discussion', null],
      ['Videography', 'video,camera,wedding', 0, 'price on discussion', null],
      ['Wedding Planning', 'indian,wedding', 0, 'price on discussion', null],
      ['Decoration', 'wedding,decoration,flowers', 0, 'price on discussion', null],
      ['Tent House & Rentals', 'tent,shamiana', 0, 'price on discussion', null],
      ['Catering', 'catering,buffet', 0, 'price on discussion', null],
      ['Makeup & Beauty', 'bridal,makeup', 0, 'price on discussion', null],
      ['Entertainment', 'dj,music,party', 0, 'price on discussion', null],
      ['Invitations', 'wedding,invitation,card', 0, 'price on discussion', null],
      ['Event Equipment', 'sound,lights,stage', 0, 'price on discussion', null],
      ['Other Event Services', 'event,party', 0, 'price on discussion', null],
    ],
  },
  {
    // Vehicle Rental: cars only for now. The customer books with pickup, drop, date and time; car partners
    // (car_rental_agent, subscribed) call them and agree the price.
    slug: 'vehicle-rental', name: 'Vehicle Rental', icon: '🚗', color: '#0891b2',
    description: 'Book a car with driver — local trips, outstation, airport, weddings and temple tours.',
    image: 'taxi,car',
    services: [
      ['Car Booking', 'car,taxi,driver', 0, 'price on discussion', null],
    ],
  },
  {
    // 🛠️ Shop For Me: small things from town shops — write it or send a photo; a regular agent buys it (shop bill),
    // up to 3 items per order, ₹50 delivery, big bills paid by the customer straight to the shop (setup.js).
    slug: 'shop-for-me', name: 'Shop For Me', icon: '🛠️', color: '#0f766e',
    description: 'Small things from town shops — plumbing, electrical, hardware, mobile accessories and more. Write it, we buy and deliver.',
    image: 'hardware,shop',
    services: [
      ['Plumbing & Sanitary Items', 'plumbing,pipe', 0, 'as per shop bill', 120],
      ['Electrical Items', 'electrical,switch', 0, 'as per shop bill', 120],
      ['Hardware, Tools & Paint', 'hardware,tools', 0, 'as per shop bill', 120],
      ['Mobile & Computer Accessories', 'mobile,charger', 0, 'as per shop bill', 120],
      ['Household Utility Items', 'bucket,household', 0, 'as per shop bill', 120],
      ['Garden & Plant Supplies', 'garden,plants', 0, 'as per shop bill', 120],
      ['Stationery & Small Items', 'stationery,pens', 0, 'as per shop bill', 120],
      ['Anything Else (small items)', 'shopping,bag', 0, 'as per shop bill', 120],
    ],
  },
  {
    // 👷 Daily Workers: a free directory of local workers added by the franchise admin (more_services.sql).
    slug: 'daily-workers', name: 'Daily Workers', icon: '👷', color: '#b45309',
    description: 'Masons, helpers, painters and more near you — see their numbers and call them directly. Free.',
    image: 'construction,worker',
    services: [
      ['Daily Workers', 'construction,worker', 0, 'call directly', null],
    ],
  },
  {
    // 💡 Digital Services: requests for websites, apps, software and video editing — go to HQ only (more_services.sql).
    slug: 'digital-services', name: 'Digital Services', icon: '💡', color: '#2563eb',
    description: 'Your vision, our execution — websites, mobile apps, software and video editing.',
    image: 'laptop,design',
    services: [
      ['Digital Services', 'laptop,design', 0, 'quote on call', null],
    ],
  },
  {
    // 🏡 Village Needs: villages within 15 km — kirana, vegetables, meat and anything else, next-day delivery by our own
    // staff (our_service_employees). Works like Instant Delivery (village.sql).
    slug: 'village-needs', name: 'Village Needs', icon: '🏡', color: '#65a30d',
    description: 'For villages near town — kirana, vegetables, fresh meat and anything else, delivered next day by our own team.',
    image: 'village,india',
    services: [
      ['Village Needs', 'village,shop', 0, 'next-day delivery', 1440],
    ],
  },
  {
    // 🚗 Share Ride: book seats in commercial cars going between towns (share_ride.sql). Car owners: shared_car_agent.
    slug: 'share-ride', name: 'Share Ride', icon: '🚗', color: '#7c3aed',
    description: 'Book a seat in a car going your way — Siddipet to Hyderabad and more. Choose your seat, pay the car owner.',
    image: 'car,road',
    services: [
      ['Share Ride', 'car,road', 0, 'price per seat', null],
    ],
  },
];

// Seed products inside services, keyed by "<category slug>/<service name>".
// Each product: [name, brand, unit, price (₹), MRP (₹) or null, emoji shown until a photo is uploaded]
// Items: [name, brand, unit, price, mrp, emoji, sold by, photo keyword, cutting options]
//  - sold by: 'pack' (default, count), 'kg' (250 g steps), 'litre' (500 ml steps), 'bunch', 'piece'
//  - price 0 in a "price as per shop bill" service: the agent buys at the market and uploads the bill.
export const products = {
  'food-daily/Fresh Vegetables': [
    ['Tomato (Tamata)', '', 'per kg', 0, null, '🍅', 'kg', 'veg:tomato'],
    ['Onion (Ullipaya)', '', 'per kg', 0, null, '🧅', 'kg', 'veg:onion'],
    ['Potato (Bangaladumpa)', '', 'per kg', 0, null, '🥔', 'kg', 'veg:potato'],
    ['Brinjal (Vankaya)', '', 'per kg', 0, null, '🍆', 'kg', 'veg:brinjal'],
    ["Lady's Finger (Bendakaya)", '', 'per kg', 0, null, '🫛', 'kg', 'veg:okra'],
    ['Green Chillies (Pachi Mirchi)', '', 'per kg', 0, null, '🌶️', 'kg', 'veg:green-chilli'],
    ['Carrot', '', 'per kg', 0, null, '🥕', 'kg', 'veg:carrot'],
    ['French Beans', '', 'per kg', 0, null, '🫛', 'kg', 'veg:beans'],
    ['Cabbage (Kosu)', '', 'per kg', 0, null, '🥬', 'kg', 'veg:cabbage'],
    ['Cauliflower (Gobi)', '', 'per kg', 0, null, '🥦', 'kg', 'veg:cauliflower'],
    ['Bottle Gourd (Sorakaya)', '', 'per kg', 0, null, '🥒', 'kg', 'veg:bottle-gourd'],
    ['Ridge Gourd (Beerakaya)', '', 'per kg', 0, null, '🥒', 'kg', 'veg:ridge-gourd'],
    ['Bitter Gourd (Kakarakaya)', '', 'per kg', 0, null, '🥒', 'kg', 'veg:bitter-gourd'],
    ['Drumsticks (Munagakaya)', '', 'per kg', 0, null, '🥢', 'kg', 'veg:drumstick'],
    ['Capsicum', '', 'per kg', 0, null, '🫑', 'kg', 'veg:capsicum'],
    ['Cucumber (Dosakaya)', '', 'per kg', 0, null, '🥒', 'kg', 'veg:cucumber'],
    ['Beetroot', '', 'per kg', 0, null, '🟣', 'kg', 'veg:beetroot'],
    ['Ginger (Allam)', '', 'per kg', 0, null, '🫚', 'kg', 'veg:ginger'],
    ['Garlic (Vellulli)', '', 'per kg', 0, null, '🧄', 'kg', 'veg:garlic'],
    ['Raw Banana (Aratikaya)', '', 'per kg', 0, null, '🍌', 'kg', 'veg:raw-banana'],
    ['Palak (Palakura)', '', 'per bunch', 0, null, '🥬', 'bunch', 'veg:spinach'],
    ['Gongura', '', 'per bunch', 0, null, '🌿', 'bunch', 'veg:gongura'],
    ['Methi (Menthikura)', '', 'per bunch', 0, null, '🌿', 'bunch', 'veg:methi'],
    ['Coriander (Kothimeera)', '', 'per bunch', 0, null, '🌿', 'bunch', 'veg:coriander'],
    ['Curry Leaves (Karivepaku)', '', 'per bunch', 0, null, '🌿', 'bunch', 'veg:curry-leaves'],
    ['Mint (Pudina)', '', 'per bunch', 0, null, '🌿', 'bunch', 'veg:mint'],
  ],
  'food-daily/Daily Fresh Meat & Fish': [
    ['Chicken – Skinless', '', 'per kg', 0, null, '🍗', 'kg', 'meat:chicken', ['Curry cut', 'Biryani cut', 'Small pieces', 'Big pieces', 'Boneless']],
    ['Chicken – With Skin', '', 'per kg', 0, null, '🍗', 'kg', 'meat:chicken-skin', ['Curry cut', 'Biryani cut', 'Small pieces', 'Big pieces', 'Boneless']],
    ['Boneless Chicken', '', 'per kg', 0, null, '🍗', 'kg', 'meat:boneless-chicken', ['Small pieces', 'Big pieces', 'Strips']],
    ['Country Chicken (Natu Kodi)', '', 'per kg', 0, null, '🐓', 'kg', 'meat:country-chicken', ['Curry cut', 'Biryani cut', 'Small pieces', 'Big pieces', 'Boneless']],
    ['Mutton (Goat)', '', 'per kg', 0, null, '🥩', 'kg', 'meat:mutton', ['Curry cut', 'Biryani cut', 'With bones', 'Boneless', 'Keema']],
    ['Mutton Keema', '', 'per kg', 0, null, '🥩', 'kg', 'meat:keema'],
    ['Prawns (Royyalu)', '', 'per kg', 0, null, '🦐', 'kg', 'meat:prawns', ['Cleaned & deveined', 'Shell on', 'Remove head']],
    ['Rohu Fish (Bocha)', '', 'per kg', 0, null, '🐟', 'kg', 'meat:rohu', ['Curry pieces', 'Fry pieces', 'Whole (cleaned)', 'Remove head', 'Keep head']],
    ['Katla Fish', '', 'per kg', 0, null, '🐟', 'kg', 'meat:katla', ['Curry pieces', 'Fry pieces', 'Whole (cleaned)', 'Remove head', 'Keep head']],
    ['Murrel Fish (Korameenu)', '', 'per kg', 0, null, '🐟', 'kg', 'meat:murrel', ['Curry pieces', 'Fry pieces', 'Whole (cleaned)', 'Remove head', 'Keep head']],
    ['Tilapia Fish', '', 'per kg', 0, null, '🐟', 'kg', 'meat:tilapia', ['Curry pieces', 'Fry pieces', 'Whole (cleaned)', 'Remove head', 'Keep head']],
  ],
  'food-daily/Fresh Milk': [
    ['Fresh Organic Cow Milk', '', 'per litre', 80, null, '🥛', 'litre', 'milk:cow'],
    ['Fresh Organic Buffalo Milk', '', 'per litre', 90, null, '🥛', 'litre', 'milk:buffalo'],
    ['Vijaya Toned Milk (packet)', 'Vijaya', '500 ml', 28, 28, '🥛', 'pack', 'milk:packet'],
    ['Vijaya Full Cream Milk (packet)', 'Vijaya', '500 ml', 34, 34, '🥛', 'pack', 'milk:packet'],
    ['Heritage Toned Milk (packet)', 'Heritage', '500 ml', 29, 29, '🥛', 'pack', 'milk:packet'],
  ],
  'home-services/Drinking Water Delivery (20L cans, bottles)': [
    ['Water Can Refill', '', '20 L', 40, null, '💧'],
    ['Bisleri Water Can', 'Bisleri', '20 L', 110, 120, '💧'],
    ['Packaged Drinking Water (case of 12)', 'Kinley', '1 L x 12', 220, 240, '🧴'],
  ],
  'food-daily/Kirana Delivery': kiranaProducts, // db/kirana.js
  'food-daily/Pooja Store': poojaProducts, // db/pooja.js
  'food-daily/Vegetable Delivery': [
    ['Tomato (Tamata)', '', '1 kg', 30, null, '🍅'],
    ['Onion (Ullipaya)', '', '1 kg', 40, null, '🧅'],
    ['Potato (Bangaladumpa)', '', '1 kg', 35, null, '🥔'],
    ['Brinjal (Vankaya)', '', '500 g', 25, null, '🍆'],
    ["Lady's Finger (Bendakaya)", '', '500 g', 30, null, '🫛'],
    ['Green Chillies (Pachi Mirchi)', '', '250 g', 20, null, '🌶️'],
    ['Gongura Leaves', '', '1 bunch', 20, null, '🌿'],
    ['Palak (Palakura)', '', '1 bunch', 15, null, '🥬'],
    ['Coriander & Curry Leaves', '', '1 bunch each', 15, null, '🌿'],
    ['Ridge Gourd (Beerakaya)', '', '500 g', 30, null, '🥒'],
  ],
  'food-daily/Fruit Delivery': [
    ['Banana (Robusta)', '', '1 dozen', 60, null, '🍌'],
    ['Banganapalli Mango', '', '1 kg', 120, null, '🥭'],
    ['Shimla Apple', '', '1 kg', 180, null, '🍎'],
    ['Sweet Lime (Mosambi)', '', '1 kg', 80, null, '🍊'],
    ['Guava (Jama)', '', '1 kg', 70, null, '🍐'],
    ['Pomegranate', '', '1 kg', 200, null, '🔴'],
    ['Papaya', '', '1 pc (~1 kg)', 50, null, '🟠'],
  ],
  'food-daily/Milk Delivery': [
    ['Vijaya Toned Milk', 'Vijaya', '500 ml', 28, 28, '🥛'],
    ['Heritage Full Cream Milk', 'Heritage', '500 ml', 36, 36, '🥛'],
    ['Jersey Curd', 'Jersey', '500 g', 35, 38, '🥣'],
    ['Vijaya Ghee', 'Vijaya', '500 ml', 330, 350, '🧈'],
    ['Fresh Paneer', '', '200 g', 90, 100, '🧀'],
    ['Buttermilk (Majjiga)', 'Heritage', '200 ml', 12, 12, '🥛'],
  ],
  'food-daily/Egg Delivery': [
    ['Farm Eggs', '', '6 pcs', 42, null, '🥚'],
    ['Farm Eggs Tray', '', '30 pcs', 195, 210, '🥚'],
    ['Country Eggs (Natu Kodi)', '', '6 pcs', 72, null, '🥚'],
  ],
  'food-daily/Bread / Bakery Delivery': [
    ['Milk Bread', '', '400 g', 45, 45, '🍞'],
    ['Brown Bread', '', '400 g', 55, 55, '🍞'],
    ['Osmania Biscuits', 'Karachi Bakery', '250 g', 80, 90, '🍪'],
    ['Fruit Cake', '', '250 g', 110, 120, '🍰'],
    ['Rusk', '', '300 g', 60, 65, '🥖'],
  ],
  'food-daily/Meat / Chicken Delivery': [
    ['Chicken Curry Cut (Skinless)', '', '1 kg', 260, null, '🍗'],
    ['Boneless Chicken', '', '500 g', 190, null, '🍗'],
    ['Mutton Curry Cut', '', '1 kg', 900, null, '🥩'],
    ['Chicken Liver', '', '250 g', 60, null, '🍖'],
  ],
  'food-daily/Fish Delivery': [
    ['Rohu (Bocha)', '', '1 kg', 220, null, '🐟'],
    ['Murrel (Korameenu)', '', '1 kg', 550, null, '🐟'],
    ['Tiger Prawns (Royyalu)', '', '500 g', 380, null, '🦐'],
    ['Seer Fish (Vanjaram)', '', '500 g', 450, null, '🐟'],
  ],
  'food-daily/Fresh Coconut Delivery': [
    ['Tender Coconut', '', '1 pc', 45, null, '🥥'],
    ['Cooking Coconut', '', '1 pc', 35, null, '🥥'],
  ],
  'food-daily/Pet Food Delivery': [
    ['Adult Dog Food', 'Pedigree', '3 kg', 780, 850, '🐕'],
    ['Cat Food', 'Whiskas', '1.2 kg', 450, 480, '🐈'],
  ],
  'food-daily/Monthly Grocery Subscription': [
    ['Basic Family Pack (rice, dal, oil, atta, spices)', '', '1 month', 2999, 3400, '🧺'],
    ['Premium Family Pack (+ dry fruits, ghee)', '', '1 month', 4999, 5600, '🧺'],
  ],
};

// Launch city: Siddipet, Telangana. [name, pincode, lat, lng] — used for addresses and to find the nearest agent/order.
// Locations are approximate; the admin can rename, move (tap the map), add or switch off areas in Admin → Service areas.
export const localities = [
  ['Old Bus Stand', '502103', 18.1043, 78.8498],
  ['New Bus Stand', '502103', 18.0985, 78.8551],
  ['Komati Cheruvu', '502103', 18.0957, 78.8466],
  ['Bharath Nagar', '502103', 18.1072, 78.8545],
  ['Prashanth Nagar', '502103', 18.0962, 78.8589],
  ['Hanuman Nagar', '502103', 18.1101, 78.8479],
  ['Shivaji Nagar', '502103', 18.1023, 78.8440],
  ['Gandhi Nagar', '502103', 18.1058, 78.8588],
  ['Vidya Nagar', '502103', 18.0930, 78.8530],
  ['Ambedkar Nagar', '502103', 18.1125, 78.8555],
  ['Nasarpura', '502103', 18.1160, 78.8620],
  ['Rangadhampally', '502103', 18.0890, 78.8650],
  ['Ponnala', '502103', 18.1300, 78.8460],
  ['Medak Road', '502103', 18.1000, 78.8350],
  ['Karimnagar Road', '502103', 18.1200, 78.8700],
  ['Hyderabad Road', '502103', 18.0850, 78.8450],
];

// Types of work. Each service belongs to one type; each agent can do one or more.
// [code, name, what the customer calls the agent, icon]
export const serviceTypes = [
  ['delivery', 'Regular agents', 'Delivery partner', '🛵'],
  ['home_service', 'Home services', 'Home service expert', '🏠'],
  ['beauty', 'Beauty & grooming', 'Beautician', '💇'],
  ['vehicle', 'Vehicle service', 'Mechanic', '🔩'],
  ['health', 'Health & care', 'Care professional', '🩺'],
  ['tech', 'Mobile & laptop repair', 'Tech expert', '💻'],
  ['tutoring', 'Tutoring', 'Tutor', '📚'],
  ['pet', 'Pet care', 'Pet care expert', '🐶'],
  ['general', 'General help', 'Helper', '🧰'],
  ['instant', 'Instant delivery agents', 'Instant delivery partner', '⚡'], // ⚡ Instant Delivery orders only
  ['events_agent', 'Event partners', 'Event partner', '🎉'], // Events bookings only
  ['car_rental_agent', 'Car partners', 'Car partner', '🚗'], // Vehicle Rental (car bookings) only — subscription
  ['doctor_type', 'Doctors & care', 'Doctor partner', '🩺'], // Home Doctor Visit types only — subscription per type
  ['our_service_employees', 'Our service employees', 'Our delivery staff', '🏢'], // company's own staff: 💧 water cans, 🏡 Village Needs
  ['shared_car_agent', 'Share Ride car owners', 'Car owner', '🚗'], // 🚗 Share Ride journeys (commercial cars) — subscription
];

// Which type of agent does each seeded service. Anything not listed goes to regular agents ('delivery').
// Daily services: price as per shop bill, delivery time window (hours, India time), highlighted on the home page.
export const serviceOptions = {
  'Fresh Vegetables': {
    price_on_bill: true, window: [6, 10], featured: true,
    description: 'Farm-fresh vegetables every morning, 6–10 AM. Choose how much you need — your delivery partner buys them fresh at the market and you pay as per the shop bill.',
  },
  'Daily Fresh Meat & Fish': {
    price_on_bill: true, featured: true,
    description: 'Fresh chicken, mutton, prawns and fish, cut the way you like. Tell us the cut for each item — you pay as per the shop bill.',
  },
  'Fresh Milk': {
    window: [6, 9], featured: true,
    description: 'Fresh organic milk and packet milk at your door every morning, 6–9 AM.',
  },
};

export const serviceSkills = {
  'RMP / Local Medical Practitioner': 'doctor_type',
  'General Physician': 'doctor_type',
  'Nurse Home Visit': 'doctor_type',
  'Blood Sample Collection at Home': 'doctor_type',
  'BP Check at Home': 'doctor_type',
  'Blood Sugar Check': 'doctor_type',
  'Physiotherapy Home Visit': 'doctor_type',
  'Elderly Care / Patient Attendant': 'doctor_type',
  'Ambulance Booking': 'doctor_type',
  'Home Doctor Visit': 'doctor_type',
  'Car Booking': 'car_rental_agent',
  'Drinking Water Delivery (20L cans, bottles)': 'our_service_employees',
  'Village Needs': 'our_service_employees',
  'Share Ride': 'shared_car_agent',
  'Photography': 'events_agent',
  'Videography': 'events_agent',
  'Wedding Planning': 'events_agent',
  'Decoration': 'events_agent',
  'Tent House & Rentals': 'events_agent',
  'Catering': 'events_agent',
  'Makeup & Beauty': 'events_agent',
  'Entertainment': 'events_agent',
  'Invitations': 'events_agent',
  'Event Equipment': 'events_agent',
  'Other Event Services': 'events_agent',
  'Instant Delivery': 'instant',
  'Water-Tank Cleaning': 'home_service',
  'Water Filter / RO Service': 'home_service',
  'Plumber on Demand': 'home_service',
  'Electrician on Demand': 'home_service',
  'AC Service': 'home_service',
  'Washing Machine Repair': 'home_service',
  'Refrigerator Repair': 'home_service',
  'TV / Electronics Repair': 'home_service',
  Carpenter: 'home_service',
  Painter: 'home_service',
  'Home Cleaning': 'home_service',
  'Bathroom / Kitchen Deep Cleaning': 'home_service',
  'Pest Control': 'home_service',
  'Sofa / Carpet Cleaning': 'home_service',
  'Bike Puncture Service': 'vehicle',
  'Mobile Bike Repair': 'vehicle',
  'Car Puncture Service': 'vehicle',
  'Car Wash at Home': 'vehicle',
  'Bike Wash at Home': 'vehicle',
  'Car Detailing': 'vehicle',
  'Battery Replacement': 'vehicle',
  'Towing Service': 'vehicle',
  'Vehicle Pickup / Drop for Servicing': 'vehicle',
  'Used Bike Inspection': 'vehicle',
  'Used Car Inspection': 'vehicle',
  'Barber Home Service': 'beauty',
  'Beauty / Salon at Home': 'beauty',
  'Mobile Phone Repair Pickup': 'tech',
  'Computer / Laptop Repair': 'tech',
  'Home Tuition': 'tutoring',
  'Pet Grooming': 'pet',
  'Pet Walking': 'pet',
};

// 🏠 Home Doctor Visit types: [name, icon, description]. Each is a service under Home Doctor Visit (services.parent_id),
// taken only by doctor partners subscribed to that type (setup.js links them).
export const homeVisitTypes = [
  ['RMP / Local Medical Practitioner', '🩺', 'Your local doctor (RMP) comes home for fever, cold, pains and first aid.'],
  ['General Physician', '👨‍⚕️', 'An MBBS doctor visits home for check-ups and illness.'],
  ['Nurse Home Visit', '💉', 'Injections, dressing and basic nursing care — where the nurse is authorized to do it.'],
  ['Blood Sample Collection at Home', '🩸', 'A lab technician collects the blood sample at home.'],
  ['BP Check at Home', '❤️', 'Blood pressure check at home.'],
  ['Blood Sugar Check', '🩸', 'Blood sugar (glucose) check at home.'],
  ['Physiotherapy Home Visit', '🧘', 'A physiotherapist visits for exercises and pain relief.'],
  ['Elderly Care / Patient Attendant', '👴', 'An attendant to care for an elderly person or patient at home.'],
  ['Ambulance Booking', '🚑', 'Book an ambulance. In a life-threatening emergency, call 108 first.'],
];
