import { DICT } from './i18n-dict.js';

// 🔍 Search in the customer's own words: Telugu / Hindi letters ("కిరాణా", "ప్లంబర్", "दूध") are looked up in the app's
// own dictionary (English name ← Telugu / Hindi name), and everyday Telugu typed in English letters ("paalu",
// "kooragayalu", "kodi") uses the list below. The English words go to the server with the search (?also=…).
const SPOKEN = {
  paalu: 'Milk', palu: 'Milk', paal: 'Milk', doodh: 'Milk', perugu: 'Curd', majjiga: 'Buttermilk', neyyi: 'Ghee',
  neellu: 'Water', neelu: 'Water', nillu: 'Water', manchineellu: 'Water', paani: 'Water', pani: 'Water',
  kooragayalu: 'Vegetables', kuragayalu: 'Vegetables', koragayalu: 'Vegetables', kuralu: 'Vegetables', sabzi: 'Vegetables', sabji: 'Vegetables',
  kodi: 'Chicken', kodikura: 'Chicken', mamsam: 'Meat', maamsam: 'Meat', mamsamu: 'Meat', mutton: 'Mutton', meka: 'Mutton',
  chepalu: 'Fish', chepa: 'Fish', royyalu: 'Prawns', gudlu: 'Egg', guddu: 'Egg', anda: 'Egg', ande: 'Egg',
  pandlu: 'Fruit', pallu: 'Fruit', biyyam: 'Rice', annam: 'Rice', chawal: 'Rice', nune: 'Oil', tel: 'Oil',
  pappu: 'Dal', kandi: 'Dal', atta: 'Atta', godhuma: 'Atta', chakkera: 'Sugar', panchadara: 'Sugar', uppu: 'Salt',
  kirana: 'Kirana', kiranam: 'Kirana', kirani: 'Kirana', saamanlu: 'Kirana', samanlu: 'Kirana', saman: 'Kirana',
  current: 'Electrician', karent: 'Electrician', karentu: 'Electrician', bijli: 'Electrician', light: 'Electrician',
  nalla: 'Plumber', pipe: 'Plumber', tap: 'Plumber', leak: 'Plumber',
  mestri: 'Mason', mesthri: 'Mason', kooli: 'Workers', coolie: 'Workers', kuli: 'Workers', pani_vallu: 'Workers',
  rangulu: 'Painter', painting: 'Painter', vadrangi: 'Carpenter', karpentar: 'Carpenter',
  bandi: 'Vehicle', bike: 'Bike', cycle: 'Bike', car: 'Car', taxi: 'Ride', cab: 'Ride', share: 'Share Ride', hyderabad: 'Share Ride',
  mandulu: 'Medicine', mandu: 'Medicine', dawai: 'Medicine', tablet: 'Medicine', doctor: 'Doctor',
  pooja: 'Pooja', puja: 'Pooja', poolu: 'Flowers', puvvulu: 'Flowers', pelli: 'Wedding', shaadi: 'Wedding', function: 'Events',
  utukulu: 'Laundry', ustri: 'Ironing', istri: 'Ironing', bomma: 'Photo', photo: 'Photographer',
};

// everyday Telugu / Hindi words that are not service names in the dictionary
const SPOKEN_SCRIPT = {
  'నీళ్లు': 'Water', 'నీళ్ళు': 'Water', 'నీరు': 'Water', 'మంచినీళ్లు': 'Water', 'కోడి': 'Chicken', 'చికెన్': 'Chicken', 'మాంసం': 'Meat',
  'మటన్': 'Mutton', 'చేపలు': 'Fish', 'చేప': 'Fish', 'రొయ్యలు': 'Prawns', 'గుడ్లు': 'Egg', 'గుడ్డు': 'Egg', 'పండ్లు': 'Fruit', 'బియ్యం': 'Rice',
  'నూనె': 'Oil', 'పప్పు': 'Dal', 'మందులు': 'Medicine', 'కరెంట్': 'Electrician', 'కరెంటు': 'Electrician', 'నల్లా': 'Plumber', 'మేస్త్రీ': 'Mason',
  'కూలీ': 'Workers', 'కూలి': 'Workers', 'పెళ్లి': 'Wedding', 'బండి': 'Vehicle', 'కారు': 'Car', 'పూలు': 'Flowers', 'పూజ': 'Pooja',
  'पानी': 'Water', 'सब्जी': 'Vegetables', 'सब्ज़ी': 'Vegetables', 'मुर्गा': 'Chicken', 'मछली': 'Fish', 'अंडे': 'Egg', 'दवाई': 'Medicine', 'बिजली': 'Electrician',
};

const OTHER_SCRIPT = /[\u0900-\u097F\u0C00-\u0C7F]/; // Hindi (Devanagari) or Telugu letters
const norm = (t) => t.toLowerCase().replace(/[\s\u200c\u200d.,!?-]+/g, '');

// The English words to search with, besides what the customer typed (at most 6).
export function searchAlso(q) {
  const t = (q || '').trim();
  if (t.length < 2) return [];
  const out = new Map(); // English → score
  if (OTHER_SCRIPT.test(t)) {
    const nq = norm(t);
    for (const [w, en] of Object.entries(SPOKEN_SCRIPT)) if (nq.includes(norm(w))) out.set(en, 5);
    for (const [en, tr] of Object.entries(DICT)) {
      // service / item names only — not screen sentences ("Search water, kirana…")
      if (!Array.isArray(tr) || en.length > 32 || /[{}…?!]|^Search|,/.test(en)) continue;
      for (const v of tr) {
        if (typeof v !== 'string' || !v) continue;
        const nv = norm(v);
        const score = nv === nq ? 4 : nv.startsWith(nq) ? 3 : nv.includes(nq) ? 2 : nv.length >= 3 && nq.includes(nv) ? 1 : 0;
        if (score && score > (out.get(en) || 0)) out.set(en, score);
      }
    }
  } else {
    for (const w of t.toLowerCase().split(/[\s,]+/)) {
      const en = SPOKEN[w] || SPOKEN[w.replace(/u$/, '')];
      if (en) out.set(en, 4);
    }
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).slice(0, 6).map(([en]) => en);
}
