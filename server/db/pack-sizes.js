// 📦 Common market pack sizes for Kirana items (2026-10-26; checked against what Indian grocery apps sell). Only items
// that are really sold in several sizes are listed — everything else keeps its one size. Each row:
// [product name, brand (null = none), sizes]. The size a product has now stays; the missing ones are added (no price).

const ATTA = ['1 kg', '5 kg', '10 kg'];
const FLOUR = ['500 g', '1 kg'];
const DAL = ['500 g', '1 kg'];
const TOOR = ['500 g', '1 kg', '2 kg'];
const OIL = ['500 ml', '1 L', '5 L'];
const GHEE = ['200 ml', '500 ml', '1 L'];
const SUGAR = ['500 g', '1 kg', '5 kg'];
const POWDER = ['500 g', '1 kg', '2 kg'];
const SOAP100 = ['100 g', '4 × 100 g'];
const SOAP75 = ['75 g', '4 × 75 g'];
const SHAMPOO = ['80 ml', '180 ml', '340 ml'];
const TEA = ['250 g', '500 g', '1 kg'];
const SPICE = ['100 g', '200 g', '500 g'];

export const PACK_SIZES = [
  // 🌾 atta, flours
  ['Whole Wheat Atta', 'Aashirvaad', ATTA], ['Multigrain Atta', 'Aashirvaad', ['1 kg', '5 kg']], ['Chakki Fresh Atta', 'Pillsbury', ATTA],
  ['Fortune Chakki Fresh Atta', 'Fortune', ATTA], ['Patanjali Whole Wheat Atta', 'Patanjali', ATTA], ['Sujata Chakki Atta', 'Sujata', ATTA],
  ['Besan (Senaga Pindi)', 'Aashirvaad', FLOUR], ['Fortune Besan', 'Fortune', FLOUR], ['Tata Sampann Besan', 'Tata Sampann', FLOUR],
  ['Bombay Rava (Upma Rava)', 'Aashirvaad', FLOUR], ['Idli Rava', 'Aashirvaad', FLOUR], ['Maida', 'Aashirvaad', FLOUR],
  ['Rice Flour (Biyyam Pindi)', 'Aashirvaad', FLOUR], ['Ragi Flour', 'Aashirvaad', FLOUR], ['Jowar Flour', 'Aashirvaad', FLOUR],
  // 🍚 rice, wheat
  ['Sona Masoori Rice', null, ['10 kg', '25 kg']], ['Sona Masoori Rice (small bag)', 'Aashirvaad', ['1 kg', '5 kg', '10 kg']],
  ['Basmati Rice', 'India Gate', ['1 kg', '5 kg']], ['Idli Rice', 'Aashirvaad', ['1 kg', '5 kg']], ['Ponni Rice', 'Aashirvaad', ['1 kg', '5 kg', '10 kg']],
  ['Parboiled Rice', 'India Gate', ['1 kg', '5 kg']], ['Wheat (Godhumalu)', null, ['1 kg', '5 kg', '10 kg']],
  // 🫘 dals
  ['Toor Dal', null, TOOR], ['Toor Dal (Kandi Pappu)', 'Tata Sampann', TOOR], ['Fortune Toor Dal', 'Fortune', TOOR],
  ['Rajdhani Toor Dal', 'Rajdhani', TOOR], ['24 Mantra Organic Toor Dal', '24 Mantra', DAL], ['Organic Tattva Toor Dal', 'Organic Tattva', DAL],
  ['Chana Dal (Senaga Pappu)', 'Tata Sampann', DAL], ['Moong Dal (Pesara Pappu)', 'Tata Sampann', DAL], ['Urad Dal (Minapa Pappu)', 'Tata Sampann', DAL],
  ['Masoor Dal', 'Tata Sampann', DAL], ['Kabuli Chana', 'Tata Sampann', DAL], ['Fortune Yellow Moong Dal', 'Fortune', DAL],
  ['Rajdhani Yellow Moong Dal', 'Rajdhani', DAL], ['Groundnuts (Palli)', null, DAL],
  // 🛢️ oils, ghee
  ['Sunflower Oil', 'Freedom', OIL], ['Refined Sunflower Oil', 'Fortune', OIL], ['Gold Winner Sunflower Oil', 'Gold Winner', OIL],
  ['Sundrop Sunflower Oil', 'Sundrop', OIL], ['Saffola Gold Oil', 'Saffola', OIL], ['Groundnut Oil', 'Fortune', OIL],
  ['Palmolein Oil', 'Fortune', ['1 L', '5 L']], ['Mustard Oil', 'Dhara', OIL], ['Patanjali Mustard Oil', 'Patanjali', OIL],
  ['Gingelly (Sesame) Oil', 'Aachi', ['500 ml', '1 L']], ['Coconut Oil', 'Parachute', ['250 ml', '500 ml', '1 L']],
  ['KLF Coconad Coconut Oil', 'KLF Coconad', ['500 ml', '1 L']], ['Vanaspati', 'Dalda', ['500 ml', '1 L']],
  ['Cow Ghee', 'Heritage', GHEE], ['Amul Cow Ghee', 'Amul', GHEE], ['Nandini Pure Ghee', 'Nandini', GHEE], ['GRB Pure Ghee', 'GRB', GHEE],
  // 🧂 sugar, jaggery
  ['Sugar', 'Madhur', SUGAR], ['Dhampure White Sugar', 'Dhampure', SUGAR], ['Trust White Sugar', 'Trust', SUGAR],
  ['Uttam White Sugar', 'Uttam', SUGAR], ['Jaggery (Bellam)', 'Tata Sampann', FLOUR],
  // 🌶️ everyday powders
  ['Guntur Red Chilli Powder', 'Aashirvaad', ['200 g', '500 g', '1 kg']], ['Aashirvaad Red Chilli Powder', 'Aashirvaad', SPICE],
  ['Everest Red Chilli Powder', 'Everest', SPICE], ['Tata Sampann Red Chilli Powder', 'Tata Sampann', SPICE],
  ['Turmeric Powder (Pasupu)', 'Everest', SPICE], ['Aashirvaad Turmeric Powder', 'Aashirvaad', SPICE], ['Catch Turmeric Powder', 'Catch', SPICE],
  ['Coriander Powder (Dhaniyalu)', 'Aachi', SPICE], ['Tamarind (Chintapandu)', null, ['250 g', '500 g', '1 kg']],
  // ☕ tea, coffee, health drinks
  ['Red Label Tea Powder', 'Red Label', TEA], ['3 Roses Tea Powder', '3 Roses', TEA], ['Tata Tea Gold', 'Tata Tea', TEA],
  ['Tata Tea Agni', 'Tata Tea', TEA], ['Wagh Bakri Premium Tea', 'Wagh Bakri', TEA], ['Taj Mahal Tea Powder', 'Taj Mahal', TEA],
  ['Instant Coffee', 'Bru', ['50 g', '100 g', '200 g']], ['Nescafé Classic Coffee', 'Nescafé', ['50 g', '100 g', '200 g']],
  ['Boost', 'Boost', ['200 g', '500 g', '1 kg']], ['Bournvita', 'Cadbury', ['200 g', '500 g', '1 kg']], ['Horlicks', 'Horlicks', ['200 g', '500 g', '1 kg']],
  // 🥣 breakfast, snacks, dry fruits
  ['Oats', 'Saffola', ['500 g', '1 kg']], ['Quaker Oats', 'Quaker', ['500 g', '1 kg']], ['Poha (Atukulu)', 'Tata Sampann', FLOUR],
  ['Parle-G Biscuits', 'Parle', ['100 g', '250 g', '800 g']],
  ['Almonds', 'Happilo', ['100 g', '250 g', '500 g']], ['Cashews', 'Happilo', ['100 g', '250 g', '500 g']],
  ['Honey', 'Dabur', ['250 g', '500 g', '1 kg']], ['Tomato Ketchup', 'Kissan', ['200 g', '500 g', '1 kg']], ['Maggi Tomato Ketchup', 'Maggi', ['200 g', '500 g', '1 kg']],
  // 🧺 cleaning
  ['Surf Excel Easy Wash Detergent Powder', 'Surf Excel Easy Wash', POWDER], ['Tide Detergent Powder', 'Tide', POWDER],
  ['Rin Detergent Powder', 'Rin', POWDER], ['Wheel Detergent Powder', 'Wheel', POWDER], ['Ghadi Detergent Powder', 'Ghadi', POWDER],
  ['Nirma Detergent Powder', 'Nirma', POWDER], ['Ariel Liquid Detergent', 'Ariel', ['500 ml', '1 L', '2 L']],
  ['Dishwash Liquid', 'Vim', ['250 ml', '500 ml', '750 ml']], ['Pril Dishwash Liquid', 'Pril', ['250 ml', '500 ml', '750 ml']],
  ['Floor Cleaner', 'Lizol', ['500 ml', '1 L', '2 L']], ['Toilet Cleaner', 'Harpic', ['500 ml', '1 L']],
  // 🪥 personal care
  ['Toothpaste', 'Colgate', ['100 g', '150 g', '200 g', '300 g']], ['Pepsodent Toothpaste', 'Pepsodent', ['80 g', '150 g', '300 g']],
  ['Closeup Toothpaste', 'Closeup', ['80 g', '150 g']], ['Dabur Red Toothpaste', 'Dabur', ['100 g', '200 g']],
  ['Patanjali Dant Kanti', 'Patanjali', ['100 g', '200 g']], ['Sensodyne Toothpaste', 'Sensodyne', ['70 g', '100 g']],
  ['Lux Soap', 'Lux', SOAP100], ['Dove Soap', 'Dove', SOAP100], ['Dettol Soap', 'Dettol', SOAP100], ['Cinthol Soap', 'Cinthol', SOAP100],
  ['Godrej No.1 Soap', 'Godrej', SOAP100], ['Hamam Soap', 'Hamam', SOAP100], ['Liril Soap', 'Liril', SOAP100], ['Margo Neem Soap', 'Margo', SOAP100],
  ['Medimix Soap', 'Medimix', SOAP100], ['Rexona Soap', 'Rexona', SOAP100], ['Lifebuoy Bath Soap', 'Lifebuoy', SOAP100], ['Santoor Bath Soap', 'Santoor', SOAP100],
  ['Chandrika Soap', 'Chandrika', SOAP75], ['Himalaya Neem Soap', 'Himalaya', SOAP75], ['Mysore Sandal Soap', 'Mysore Sandal', SOAP75],
  ['Pears Soap', 'Pears', SOAP75], ['Patanjali Soap', 'Patanjali', SOAP75],
  ['Dove Shampoo', 'Dove', SHAMPOO], ['Head & Shoulders Shampoo', 'Head & Shoulders', SHAMPOO], ['Pantene Shampoo', 'Pantene', SHAMPOO],
  ['Sunsilk Shampoo', 'Sunsilk', SHAMPOO], ['TRESemmé Shampoo', 'TRESemmé', SHAMPOO], ['Dabur Vatika Shampoo', 'Dabur', SHAMPOO],
  ['Shampoo', 'Clinic Plus', ['80 ml', '175 ml', '340 ml']], ['Hair Oil', 'Parachute', ['100 ml', '200 ml', '500 ml']],
  ['Hand Wash', 'Dettol', ['200 ml', '750 ml']],
  // 💧 water
  ['Bisleri Drinking Water', 'Bisleri', ['500 ml', '1 L', '2 L']],
];
