// 🪔 Pooja Store photos (2026-10-26): the user's own AI photos (F:\pooja_items_telangana_ai_generated, unbranded studio
// shots, 768 px) → products. Photos are 512 px square JPEGs in <app>/public/products/pooja/<file>.jpg.
// Some source files were saved under another item's name (e.g. calendars.png shows a Ganesha idol): each row uses the
// file that SHOWS the item. Crackers are left out (selling them needs a licence).
// Each row: [source file, our file, name, section, unit, existing]
//   existing = the Pooja Store product that gets the photo; null = a new product (as per shop bill, like the rest).

// the order of the sections on the Pooja Store page
export const POOJA_SECTIONS = [
  'Lamps & Oil', 'Incense', 'Kumkum, Pasupu & Gandham', 'Flowers & Fresh Items', 'Coconut & Kalasam',
  'Naivedyam & Grains', 'Pooja Utensils', 'God Idols & Photos', 'Malas & Yantras', 'Sumangali Items', 'Homa & Havan',
  'Festival Items', 'Pooja Kits', 'Books & Calendars', 'Other Pooja Items',
];

const L = 'Lamps & Oil', I = 'Incense', K = 'Kumkum, Pasupu & Gandham', F = 'Flowers & Fresh Items', C = 'Coconut & Kalasam',
  N = 'Naivedyam & Grains', U = 'Pooja Utensils', G = 'God Idols & Photos', M = 'Malas & Yantras', S = 'Sumangali Items',
  H = 'Homa & Havan', FE = 'Festival Items', KT = 'Pooja Kits', BK = 'Books & Calendars', O = 'Other Pooja Items';
const D = 'Daily Pooja Items/', CK = 'Coconut Kalasam Items/', FD = 'Flowers Decoration/', GI = 'God Idols Photos/',
  GR = 'Grains Naivedyam Items/', HH = 'Homa Havan Materials/', LD = 'Lamps Deepam Items/', PU = 'Pooja Utensils/',
  SP = 'Spiritual Items/', SU = 'Sumangali Items/', VK = 'Vratham Kits/', B = 'Books/';

export const POOJA_PHOTOS = [
  // ---------- the products we have ----------
  [`${'Festival Diwali/'}diyas.png`, 'clay-diyas', 'Clay Diyas (Pramidalu)', L, '12 pcs', 'Clay Diyas (Pramidalu)'],
  [`${D}sesame_oil.png`, 'deepam-oil', 'Deepam Oil', L, '1 L', 'Deepam Oil'],
  [`${D}ghee.png`, 'cow-ghee-deepam', 'Cow Ghee for Deepam', L, '200 ml', 'Cow Ghee for Deepam'],
  [`${D}cotton_wicks.png`, 'cotton-wicks', 'Cotton Wicks (Vattulu)', L, '1 pack', 'Cotton Wicks (Vattulu)'],
  [`${D}camphor.png`, 'camphor', 'Camphor (Karpooram)', L, '50 g', 'Camphor (Karpooram)'],
  [`${D}incense_sticks.png`, 'agarbatti', 'Agarbatti (Incense Sticks)', I, '1 pack', 'Agarbatti (Incense Sticks)'],
  [`${D}sambrani.png`, 'sambrani', 'Sambrani Cups', I, '12 pcs', 'Sambrani Cups'],
  [`${D}dhoop_sticks.png`, 'dhoop-sticks', 'Dhoop Sticks', I, '1 pack', 'Dhoop Sticks'],
  [`${D}kumkum.png`, 'kumkum', 'Kumkum', K, '50 g', 'Kumkum'],
  [`${D}pasupu_turmeric.png`, 'pasupu', 'Pasupu (Turmeric for Pooja)', K, '100 g', 'Pasupu (Turmeric for Pooja)'],
  [`${D}sandalwood_powder.png`, 'gandham', 'Gandham (Sandalwood Powder)', K, '50 g', 'Gandham (Sandalwood Powder)'],
  [`${D}akshatalu.png`, 'akshintalu', 'Akshintalu (Turmeric Rice)', K, '100 g', 'Akshintalu (Turmeric Rice)'],
  [`${D}vibhuti.png`, 'vibhuti', 'Vibhuti (Holy Ash)', K, '50 g', 'Vibhuti (Holy Ash)'],
  [`${FD}garlands.png`, 'marigold-garland', 'Marigold Garland (Banti Dandalu)', F, '1 garland', 'Marigold Garland (Banti Dandalu)'],
  [`${FD}flower_baskets.png`, 'loose-flowers', 'Loose Flowers for Pooja', F, '250 g', 'Loose Flowers for Pooja'],
  [`${CK}betel_leaves.png`, 'betel-leaves', 'Betel Leaves (Tamalapakulu)', F, '20 leaves', 'Betel Leaves (Tamalapakulu)'],
  [`${CK}banana_leaves.png`, 'betel-nuts', 'Betel Nuts (Vakkalu)', F, '100 g', 'Betel Nuts (Vakkalu)'], // the file shows betel nuts
  [`${D}rose_water.png`, 'pooja-coconut', 'Pooja Coconut', C, '1 pc', 'Pooja Coconut'], // the file shows a coconut
  [`${CK}coconuts.png`, 'rose-water', 'Rose Water', O, '100 ml', 'Rose Water'], // the file shows rose water
  [`${GR}navadhanyalu.png`, 'navadhanyalu', 'Navadhanyalu (Nine Grains)', N, '1 pack', 'Navadhanyalu (Nine Grains)'],
  [`${D}match_boxes.png`, 'matchbox', 'Matchbox', O, '10 boxes', 'Matchbox'],
  // ---------- Lamps & Oil ----------
  [`${D}ghee_wicks.png`, 'ghee-wicks', 'Ghee Wicks (Neyyi Vattulu)', L, '1 box', null],
  [`${D}coconut_oil.png`, 'coconut-oil-deepam', 'Coconut Oil for Deepam', L, '500 ml', null],
  [`${LD}brass_lamps.png`, 'brass-lamp', 'Brass Lamp (Kundulu)', L, '1 pc', null],
  [`${LD}akhanda_deepam.png`, 'akhanda-deepam', 'Akhanda Deepam', L, '1 pc', null],
  [`${LD}deepam_stands.png`, 'deepam-stand', 'Deepam Stand (Samayi)', L, '1 pc', null],
  [`${LD}pancharti_lamps.png`, 'pancharti-lamp', 'Pancharti Lamp', L, '1 pc', null],
  [`${LD}kuber_deepam.png`, 'kuber-deepam', 'Kuber Deepam', L, '1 pc', null],
  [`${LD}silver_lamps.png`, 'silver-lamp', 'Silver-coated Lamp', L, '1 pc', null],
  // ---------- Incense ----------
  [`${PU}agarbatti_stands.png`, 'dhoop-burner', 'Brass Dhoop Burner', I, '1 pc', null],
  // ---------- Kumkum, Pasupu & Gandham ----------
  [`${D}sandal_paste.png`, 'sandal-paste', 'Sandal Paste (Chandanam)', K, '50 g', null],
  [`${SU}kumkum_packets.png`, 'kumkum-packet', 'Kumkum Packet', K, '100 g', null],
  [`${SU}turmeric_packets.png`, 'turmeric-packet', 'Pasupu Packet', K, '100 g', null],
  // ---------- Flowers & Fresh Items ----------
  [`${FD}marigold_flowers.png`, 'marigold-flowers', 'Marigold Flowers (Banti Puvvulu)', F, '250 g', null],
  [`${FD}jasmine_flowers.png`, 'rose-flowers', 'Rose Flowers (Gulabi)', F, '250 g', null], // the file shows roses
  [`${CK}betel_nuts.png`, 'jasmine-flowers', 'Jasmine Flowers (Malle Puvvulu)', F, '1 mura', null], // the file shows jasmine
  [`${FD}chrysanthemums.png`, 'chrysanthemums', 'Chrysanthemums (Chamanti)', F, '250 g', null],
  [`${FD}lotus_flowers.png`, 'lotus-flowers', 'Lotus Flowers (Kaluva)', F, '2 pcs', null],
  [`${FD}tulasi_leaves.png`, 'tulasi-leaves', 'Tulasi Leaves', F, '1 bunch', null],
  [`${FD}bilva_leaves.png`, 'bilva-leaves', 'Bilva Leaves (Maredu Dalam)', F, '1 bunch', null],
  [`${CK}mango_leaves.png`, 'mango-leaves', 'Mango Leaves (Mamidi Akulu)', F, '1 bunch', null],
  [`${FD}rose_flowers.png`, 'banana-leaves', 'Banana Leaves (Arati Akulu)', F, '5 leaves', null], // the file shows banana leaves
  [`${FD}door_torans.png`, 'mango-leaf-toran', 'Mango Leaf Toran', F, '1 pc', null],
  [`${FD}mango_leaf_torans.png`, 'flower-toran', 'Marigold & Mango Leaf Toran', F, '1 pc', null],
  // ---------- Coconut & Kalasam ----------
  [`${CK}dry_coconuts.png`, 'dry-coconut', 'Dry Coconut (Kobbari Chippa)', C, '1 pc', null],
  [`${CK}kalash_pots.png`, 'kalasam-with-coconut', 'Kalasam with Coconut', C, '1 set', null],
  [`${CK}copper_kalash.png`, 'brass-kalasam', 'Brass Kalasam', C, '1 pc', null], // the file shows brass
  [`${CK}brass_kalash.png`, 'copper-kalasam', 'Copper Kalasam', C, '1 pc', null], // the file shows copper
  [`${CK}silver_coated_kalash.png`, 'silver-kalasam', 'Silver-coated Kalasam', C, '1 pc', null],
  [`Gruhapravesam Items/kalasam_set.png`, 'kalasam-set', 'Kalasam Pooja Set', C, '1 set', null],
  // ---------- Naivedyam & Grains ----------
  [`${GR}rice.png`, 'pooja-rice', 'Rice for Pooja', N, '1 kg', null],
  [`${GR}bengal_gram.png`, 'bengal-gram', 'Bengal Gram (Senagalu)', N, '250 g', null],
  [`${GR}green_gram.png`, 'green-gram', 'Green Gram (Pesalu)', N, '250 g', null],
  [`${GR}black_gram.png`, 'black-gram', 'Black Gram (Minumulu)', N, '250 g', null],
  [`${GR}wheat.png`, 'pooja-wheat', 'Wheat (Godhumalu)', N, '250 g', null],
  [`${GR}white_sesame.png`, 'white-sesame', 'White Sesame (Nuvvulu)', N, '100 g', null],
  [`${GR}black_sesame.png`, 'black-sesame', 'Black Sesame (Nalla Nuvvulu)', N, '100 g', null],
  [`${GR}jaggery.png`, 'pooja-jaggery', 'Jaggery (Bellam)', N, '250 g', null],
  [`${GR}sugar.png`, 'pooja-sugar', 'Sugar for Prasadam', N, '250 g', null],
  [`${GR}rock_sugar.png`, 'rock-sugar', 'Rock Sugar (Patika Bellam)', N, '100 g', null],
  [`${GR}dry_fruits.png`, 'dry-fruits-naivedyam', 'Dry Fruits for Naivedyam', N, '100 g', null],
  // ---------- Pooja Utensils ----------
  [`${LD}harathi_plates.png`, 'harathi-plate', 'Harathi Plate', U, '1 pc', null],
  [`${PU}bells.png`, 'pooja-bell', 'Pooja Bell (Ganta)', U, '1 pc', null],
  [`${PU}brass_plates.png`, 'brass-plate', 'Brass Pooja Plate', U, '1 pc', null],
  [`${PU}pooja_trays.png`, 'pooja-tray', 'Pooja Tray Set', U, '1 set', null],
  [`${PU}panchapatra.png`, 'panchapatra', 'Panchapatra & Uddharini', U, '1 set', null],
  [`${PU}uddharani_spoons.png`, 'uddharini', 'Uddharini Spoon', U, '1 pc', null],
  [`${PU}copper_glasses.png`, 'copper-glass', 'Copper Glass', U, '1 pc', null],
  [`${PU}copper_plates.png`, 'copper-plate', 'Copper Plate', U, '1 pc', null],
  [`${PU}conch_shankh.png`, 'conch', 'Conch (Shankham)', U, '1 pc', null],
  [`${PU}coconut_breakers.png`, 'kumkum-box', 'Brass Kumkum Box (Kumkum Bharani)', U, '1 pc', null], // the file shows a kumkum box
  [`${PU}kumkum_boxes.png`, 'coconut-breaker', 'Coconut Breaker', U, '1 pc', null], // the file shows a coconut breaker
  // ---------- God Idols & Photos ----------
  [`${'Festival Vinayaka Chavithi/'}clay_ganesh_idols.png`, 'clay-ganesha', 'Clay Ganesha Idol', G, '1 pc', null],
  [`${B}calendars.png`, 'brass-ganesha', 'Brass Ganesha Idol', G, '1 pc', null], // the file shows a Ganesha idol
  [`${GI}lakshmi_idols.png`, 'lakshmi-idol', 'Lakshmi Idol', G, '1 pc', null],
  [`${GI}god_photo_frames.png`, 'venkateswara-idol', 'Venkateswara Idol', G, '1 pc', null], // the file shows the idol
  [`${GI}venkateswara_idols.png`, 'venkateswara-photo', 'Venkateswara Photo Frame', G, '1 pc', null], // the file shows a frame
  [`${GI}hanuman_idols.png`, 'hanuman-idol', 'Hanuman Idol', G, '1 pc', null],
  [`${GI}shiva_idols.png`, 'shiva-idol', 'Shiva Idol', G, '1 pc', null],
  [`${GI}vishnu_idols.png`, 'vishnu-idol', 'Vishnu Idol', G, '1 pc', null],
  [`${GI}durga_idols.png`, 'durga-idol', 'Durga Idol', G, '1 pc', null],
  [`${GI}saraswati_idols.png`, 'saraswati-idol', 'Saraswati Idol', G, '1 pc', null],
  [`${GI}sai_baba_idols.png`, 'sai-baba-idol', 'Sai Baba Idol', G, '1 pc', null],
  // ---------- Malas & Yantras ----------
  [`${SP}japamalas.png`, 'japa-mala', 'Japa Mala', M, '1 pc', null],
  [`${SP}tulasi_malas.png`, 'rudraksha-mala', 'Rudraksha Mala', M, '1 pc', null], // the file shows rudraksha
  [`${SP}rudraksha_malas.png`, 'tulasi-mala', 'Tulasi Mala', M, '1 pc', null], // the file shows a tulasi mala
  [`${SP}navaratna_malas.png`, 'crystal-mala', 'Crystal (Spatika) Mala', M, '1 pc', null], // the file shows crystal
  [`${SP}crystal_malas.png`, 'navaratna-bracelet', 'Navaratna Bracelet', M, '1 pc', null], // the file shows navaratna
  [`${SP}kavachams.png`, 'hanuman-kavacham', 'Hanuman Kavacham', M, '1 pc', null],
  [`${SP}sri_chakra.png`, 'sri-chakra', 'Sri Chakra', M, '1 pc', null],
  [`${SP}yantras.png`, 'yantra', 'Copper Yantra', M, '1 pc', null],
  // ---------- Sumangali Items ----------
  [`${SU}bangles.png`, 'glass-bangles', 'Glass Bangles (Gajulu)', S, '1 dozen', null],
  [`${SU}combs.png`, 'bindis', 'Bindis (Bottu Billalu)', S, '1 card', null], // the file shows bindis
  [`${SU}mirrors.png`, 'wooden-comb', 'Wooden Comb (Duvvena)', S, '1 pc', null], // the file shows a comb
  [`${SU}bindis.png`, 'hand-mirror', 'Hand Mirror (Addam)', S, '1 pc', null], // the file shows a mirror
  [`${SU}blouse_pieces.png`, 'blouse-piece', 'Blouse Piece', S, '1 pc', null],
  [`${SU}saree_gift_packs.png`, 'saree-gift-pack', 'Saree Gift Pack', S, '1 pack', null],
  // ---------- Homa & Havan ----------
  [`${HH}mango_wood_sticks.png`, 'havan-samagri', 'Havan Samagri Mix', H, '250 g', null], // the file shows the mix
  [`${HH}havan_samagri_mix.png`, 'cow-dung-cakes', 'Dried Cow Dung Cakes (Pidakalu)', H, '10 pcs', null], // shows the cakes
  [`Gruhapravesam Items/mango_sticks.png`, 'homa-kundam', 'Copper Homa Kundam', H, '1 pc', null], // the file shows the kundam
  [`${HH}homa_kundam.png`, 'mango-wood-sticks', 'Mango Wood Sticks (Samidhalu)', H, '1 bundle', null], // shows sticks
  [`${HH}navagraha_samidhas.png`, 'navagraha-samidhas', 'Navagraha Samidhalu', H, '1 set', null],
  // ---------- Festival Items ----------
  [`${'Festival Vinayaka Chavithi/'}modakam_moulds.png`, 'bathukamma-flowers', 'Bathukamma Flowers', FE, '1 set', null], // shows bathukamma
  [`${'Festival Bathukamma/'}bathukamma_flowers.png`, 'modakam-mould', 'Modakam Mould', FE, '1 pc', null], // shows moulds
  [`${'Festival Vinayaka Chavithi/'}patri_leaves_set.png`, 'patri-set', 'Patri Leaves Set (Vinayaka Chavithi)', FE, '1 set', null],
  [`${'Festival Vinayaka Chavithi/'}garika_grass.png`, 'garika', 'Garika Grass', FE, '1 bunch', null],
  [`${'Festival Sankranti/'}gobbemmalu_items.png`, 'gobbemmalu', 'Gobbemmalu Items (Sankranti)', FE, '1 set', null],
  [`${'Festival Sankranti/'}rangoli_colors.png`, 'rangoli-colours', 'Rangoli Colours', FE, '1 set', null],
  [`${'Festival Diwali/'}decorative_lights.png`, 'decorative-lights', 'Decorative Lights', FE, '1 string', null],
  [`${'Festival Dussehra/'}ayudha_pooja_items.png`, 'ayudha-pooja-kit', 'Ayudha Pooja Items (Dussehra)', FE, '1 set', null],
  [`${'Festival Dussehra/'}vehicle_pooja_kits.png`, 'vehicle-pooja-kit', 'Vehicle Pooja Kit', FE, '1 kit', null],
  // ---------- Pooja Kits ----------
  [`${VK}satyanarayana_vratham_kit.png`, 'satyanarayana-kit', 'Satyanarayana Vratham Kit', KT, '1 kit', null],
  [`${VK}varalakshmi_vratham_kit.png`, 'varalakshmi-kit', 'Varalakshmi Vratham Kit', KT, '1 kit', null],
  [`${VK}vinayaka_chavithi_kit.png`, 'vinayaka-chavithi-kit', 'Vinayaka Chavithi Pooja Kit', KT, '1 kit', null],
  [`${VK}gruhapravesam_kit.png`, 'gruhapravesam-kit', 'Gruhapravesam Pooja Kit', KT, '1 kit', null],
  [`${VK}navaratri_kit.png`, 'navaratri-kit', 'Navaratri Pooja Kit', KT, '1 kit', null],
  [`${VK}shivaratri_kit.png`, 'shivaratri-kit', 'Shivaratri Pooja Kit', KT, '1 kit', null],
  [`${VK}upanayanam_kit.png`, 'upanayanam-kit', 'Upanayanam Pooja Kit', KT, '1 kit', null],
  [`${VK}wedding_pooja_kit.png`, 'wedding-kit', 'Wedding Pooja Kit', KT, '1 kit', null],
  [`Gruhapravesam Items/homa_samagri.png`, 'homa-samagri-kit', 'Homa Samagri Kit', KT, '1 kit', null],
  // ---------- Books & Calendars ----------
  [`${GI}ganesha_idols.png`, 'calendar', 'Telugu Calendar', BK, '1 pc', null], // the file shows a calendar
  [`${B}panchangam.png`, 'panchangam', 'Panchangam', BK, '1 pc', null],
  [`${B}bhagavad_gita.png`, 'bhagavad-gita', 'Bhagavad Gita', BK, '1 book', null],
  [`${B}hanuman_chalisa.png`, 'hanuman-chalisa', 'Hanuman Chalisa', BK, '1 book', null],
  [`${B}lalitha_sahasranamam.png`, 'lalitha-sahasranamam', 'Lalitha Sahasranamam', BK, '1 book', null],
  [`${B}vishnu_sahasranamam.png`, 'vishnu-sahasranamam', 'Vishnu Sahasranamam', BK, '1 book', null],
  [`${B}sundarakanda.png`, 'sundarakanda', 'Sundarakanda', BK, '1 book', null],
  [`${B}sai_satcharitra.png`, 'sai-satcharitra', 'Sai Satcharitra', BK, '1 book', null],
  [`${B}pooja_manuals.png`, 'pooja-vidhanam', 'Pooja Vidhanam Book', BK, '1 book', null],
];
