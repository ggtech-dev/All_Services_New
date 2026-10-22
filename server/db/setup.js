// Creates the app schema, tables, functions/procedures, seeds the service catalog, site settings
// and a default admin. Safe to re-run: existing rows are left alone, so edits made in the admin
// panel are never overwritten.
//
//   npm run db:setup                        -> create/upgrade schema, add missing seed rows
//   npm run db:setup -- --refresh-images    -> also reset seeded categories/services to images.json photos
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { pool, SCHEMA } from '../src/db.js';
import { categories, homeVisitTypes, localities, products, serviceOptions, serviceSkills, serviceTypes } from './catalog.js';

const refreshImages = process.argv.includes('--refresh-images');
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const sql = (file) => readFile(new URL(file, import.meta.url), 'utf8');
// images.json is produced by fetch-images.js; a missing entry leaves the image empty (UI shows an emoji tile).
const images = JSON.parse(await sql('./images.json').catch(() => '{}'));
const image = (keywords) => images[keywords] || {};

const defaultSettings = {
  banner_title: 'What do you need today?',
  banner_subtitle: 'Water cans, plumbers, kirana, medicines, bike repair and more — from trusted local partners near you.',
  announcement: '🎉 Free delivery on your first order in Siddipet!',
  support_phone: '+91 86886 87412', // help links on the login page and home (call)
  support_whatsapp: '+91 86886 87412',
  support_email: 'gouravmacha@gmail.com',
  service_city: 'Siddipet, Telangana',
  delivery_fee: '30', // starting delivery charge for shop services; after that it is set per service (admin → Delivery charges)
  free_delivery_orders: '1',
  agent_pay_per_order: '25',
  agent_max_active_orders: '1',
  require_delivery_otp: '0', // 1 = agent must enter the customer's OTP to mark delivered
};
// Settings still holding an older default are moved to the new one; admin-edited values are kept.
const oldDefaults = { service_city: 'Hyderabad', announcement: '🎉 Free delivery on your first 3 orders!', support_phone: '+91 98765 43210' };

const client = await pool.connect();
try {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(await sql('./schema.sql'));
  await client.query(await sql('./functions.sql'));
  await client.query(await sql('./orders.sql'));
  await client.query(await sql('./auth.sql'));
  await client.query(await sql('./phone_otp.sql')); // 📱 mobile number + OTP login (codes made here, SMS via 2Factor)
  await client.query(await sql('./promotions.sql'));
  await client.query(await sql('./reports.sql'));
  await client.query(await sql('./shop_bill.sql'));
  await client.query(await sql('./daily_fresh.sql')); // before delivery.sql (its quote uses the delivery windows)
  await client.query(await sql('./shopping_list.sql')); // customer's own list, list photo, shops
  await client.query(await sql('./subscriptions.sql')); // subscription-only services (plumbers…) and who may take them
  await client.query(await sql('./ratings.sql')); // ratings after delivery, phone notifications (web push)
  await client.query(await sql('./delivery.sql'));
  await client.query(await sql('./instant.sql')); // ⚡ Instant Delivery: other shops' products, instant agents only
  await client.query(await sql('./franchise.sql')); // franchises (dealers) under the Super Admin — last: uses everything above
  await client.query(await sql('./events.sql')); // 🎉 Events bookings (date, time, venue) for event partners
  await client.query(await sql('./vehicle.sql')); // 🚗 Vehicle Rental: car bookings (pickup, drop, date, time) for car partners
  await client.query(await sql('./health.sql')); // 💊 Home Doctor Visit types (parent services), visit time: now or a date
  await client.query(await sql('./village.sql')); // 🏡 Village Needs: villages, next-day slots, village delivery charge
  await client.query(await sql('./share_ride.sql'));
  await client.query(await sql('./more_services.sql')); // 👷 Daily Workers directory, 💡 Digital Services requests (HQ only) // 🚗 Share Ride: cars, seat layouts, journeys, seat bookings
  await client.query(await sql('./login.sql')); // 📱 phone-first login, agents removed by the franchise admin — after orders.sql
  await client.query(await sql('./overdue.sql')); // ⏰ overdue open orders (red badge for the admin) — last: reads every slot kind
  await client.query(await sql('./geo.sql')); // 📍 franchise centre + range: where orders go, agents' zone, area requests
  await client.query(await sql('./popular.sql')); // ⭐ "Our most popular services" on the home page (HQ list, city lists)

  await client.query('BEGIN');

  // Service types first: services and agents refer to them. Existing names/titles edited by the admin are kept.
  for (const [i, [code, name, title, icon]] of serviceTypes.entries()) {
    await client.query(
      `INSERT INTO service_types (code, name, agent_title, icon, sort_order) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO NOTHING`,
      [code, name, title, icon, i]
    );
  }

  let refreshed = 0;
  for (const [ci, c] of categories.entries()) {
    const img = image(c.image);
    const { rows } = await client.query(
      `INSERT INTO categories (slug, name, icon, description, image_url, image_credit, color, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
       RETURNING id`,
      [c.slug, c.name, c.icon, c.description, img.url, img.credit, c.color, ci]
    );
    if (refreshImages && img.url) {
      await client.query('UPDATE categories SET image_url=$2, image_credit=$3 WHERE id=$1', [rows[0].id, img.url, img.credit]);
      refreshed++;
    }

    for (const [si, [name, kw, price, unit, eta, license = false]] of c.services.entries()) {
      const sImg = image(kw);
      const slug = `${c.slug}-${slugify(name)}`;
      await client.query(
        `INSERT INTO services (category_id, slug, name, image_url, image_credit, base_price, price_unit, eta_minutes, requires_license, sort_order, skill_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (slug) DO NOTHING`,
        [rows[0].id, slug, name, sImg.url, sImg.credit, price, unit, eta, license, si, serviceSkills[name] || 'delivery']
      );
      // Services created before types existed get their type once; later admin changes are kept.
      await client.query('UPDATE services SET skill_code = $2 WHERE slug = $1 AND skill_code IS NULL', [slug, serviceSkills[name] || 'delivery']);
      if (refreshImages && sImg.url) {
        const r = await client.query('UPDATE services SET image_url=$2, image_credit=$3 WHERE slug=$1', [slug, sImg.url, sImg.credit]);
        refreshed += r.rowCount;
      }
    }
  }

  let productCount = 0;
  for (const [key, items] of Object.entries(products)) {
    const catSlug = key.slice(0, key.indexOf('/'));
    const serviceName = key.slice(key.indexOf('/') + 1); // service names can contain "/"
    const svc = await client.query('SELECT id, slug FROM services WHERE slug = $1', [`${catSlug}-${slugify(serviceName)}`]);
    if (!svc.rows[0]) throw new Error(`Seed products: service "${key}" not found`);
    for (const [pi, [name, brand, unit, price, mrp, icon, sellBy = 'pack', imageKw, noteOptions, section]] of items.entries()) {
      const img = imageKw ? image(imageKw) : {};
      const slug = `${svc.rows[0].slug}-${slugify(name)}`;
      const r = await client.query(
        `INSERT INTO products (service_id, slug, name, brand, unit, price, mrp, icon, sort_order, sell_by, image_url, image_credit, note_options, section)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (slug) DO NOTHING`,
        [svc.rows[0].id, slug, name, brand || null, unit, price, mrp, icon, pi, sellBy, img.url, img.credit, noteOptions || null, section || null]
      );
      if (section) await client.query('UPDATE products SET section = $2 WHERE slug = $1 AND section IS NULL', [slug, section]);
      productCount += r.rowCount;
      if (img.url) {
        // a photo fetched later fills an empty one; --refresh-images replaces it (admin-uploaded photos are kept otherwise)
        const u = await client.query(
          `UPDATE products SET image_url = $2, image_credit = $3
            WHERE slug = $1 AND ($4 OR image_url IS NULL) AND image_url IS DISTINCT FROM $2`,
          [slug, img.url, img.credit, refreshImages]
        );
        refreshed += u.rowCount;
      }
    }
  }

  // One-time (2026-09-29): plumbing, electrical, appliance, cleaning, carpentry and painting were merged into
  // one "Home services" type, and "Delivery" was renamed "Regular agents". Guarded so later admin edits stay.
  const merged = await client.query("SELECT 1 FROM site_settings WHERE key = 'migrated_home_service'");
  if (!merged.rowCount) {
    const OLD = ['plumbing', 'electrical', 'appliance', 'cleaning', 'carpentry', 'painting'];
    await client.query('UPDATE services SET skill_code = $1 WHERE skill_code = ANY ($2)', ['home_service', OLD]);
    await client.query('UPDATE orders SET skill_code = $1 WHERE skill_code = ANY ($2) AND status = $3', ['home_service', OLD, 'placed']);
    await client.query(
      `UPDATE agents SET skills = ARRAY(SELECT DISTINCT CASE WHEN x = ANY ($1) THEN 'home_service' ELSE x END FROM unnest(skills) x ORDER BY 1)
        WHERE skills && $1`,
      [OLD]
    );
    await client.query('UPDATE service_types SET is_active = false WHERE code = ANY ($1)', [OLD]);
    await client.query("UPDATE service_types SET name = 'Regular agents' WHERE code = 'delivery' AND name = 'Delivery'");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('migrated_home_service', '2026-09-29')");
    console.log('Merged specialist home types into "Home services"; Delivery renamed to "Regular agents".');
  }

  // Any other service without a type (e.g. added by the admin before types existed) becomes 'general'.
  await client.query("UPDATE services SET skill_code = 'general' WHERE skill_code IS NULL");
  // Old orders get the type of their first item's service.
  await client.query(
    `UPDATE orders o SET skill_code = coalesce((
        SELECT s.skill_code FROM order_items i
          LEFT JOIN products p ON p.id = i.product_id
          JOIN services s ON s.id = coalesce(i.service_id, p.service_id)
         WHERE i.order_id = o.id ORDER BY i.id LIMIT 1), 'delivery')
      WHERE skill_code IS NULL`
  );
  await client.query("ALTER TABLE services ALTER COLUMN skill_code SET DEFAULT 'general', ALTER COLUMN skill_code SET NOT NULL");
  await client.query("ALTER TABLE orders ALTER COLUMN skill_code SET DEFAULT 'delivery', ALTER COLUMN skill_code SET NOT NULL");

  // Sample promotions, added once (if the admin deletes them they stay deleted). Images reuse the service photos.
  const promosSeeded = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_promotions'");
  if (!promosSeeded.rowCount) {
    const samples = [
      // [name, title, subtitle, cta, link_type, link_value, placement, bg, image from service slug]
      ['Free delivery launch offer', 'Free delivery on your first 3 orders 🎉', 'Milk, vegetables, kirana & more — delivered in about 30 minutes across Siddipet', 'Shop now', 'category', 'food-daily', 'carousel', '#16a34a', 'food-daily-vegetable-delivery'],
      ['Plumber in 60 minutes', 'Plumber at your door in 60 minutes', 'Leaking tap? Blocked drain? Verified home service experts near you', 'Book a plumber', 'service', 'home-services-plumber-on-demand', 'carousel', '#1d4ed8', 'home-services-plumber-on-demand'],
      ['Morning milk', 'Fresh Vijaya milk every morning 🥛', 'Toned milk ₹28 · curd · ghee · paneer', 'Order milk', 'service', 'food-daily-milk-delivery', 'carousel', '#b45309', 'food-daily-milk-delivery'],
      ['AC service tile', 'AC service', 'Beat the heat — from ₹499', 'Book', 'service', 'home-services-ac-service', 'tile', '#0e7490', 'home-services-ac-service'],
      ['Scrap pickup tile', 'Sell your scrap', 'We pay you for paper, plastic & metal', 'Schedule pickup', 'category', 'recycling', 'tile', '#15803d', 'recycling-scrap-collection'],
      ['Car wash tile', 'Car wash at home', 'Shiny car without leaving home', 'Book', 'service', 'vehicle-car-wash-at-home', 'tile', '#7c3aed', 'vehicle-car-wash-at-home'],
    ];
    for (const [i, [name, title, subtitle, cta, type, value, placement, bg, imgSlug]] of samples.entries()) {
      await client.query(
        `INSERT INTO promotions (name, title, subtitle, cta_text, link_type, link_value, placement, bg_color, sort_order, image_url, image_credit)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, s.image_url, s.image_credit FROM (SELECT 1) x
           LEFT JOIN services s ON s.slug = $10`,
        [name, title, subtitle, cta, type, value, placement, bg, i, imgSlug]
      );
    }
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_promotions', '2026-09-29')");
    console.log(`Added ${samples.length} sample promotions.`);
  }

  // One time: the daily services (fresh vegetables 6–10 AM, fresh meat & fish, fresh milk 6–9 AM) — price as per
  // shop bill, delivery window, highlighted on the home page, the usual delivery charge, and promotions for them.
  // Later admin changes are kept.
  const dailySeeded = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_daily_fresh'");
  if (!dailySeeded.rowCount) {
    for (const [name, o] of Object.entries(serviceOptions)) {
      const slug = `food-daily-${slugify(name)}`;
      await client.query(
        `UPDATE services SET price_on_bill = $2, window_from = $3, window_to = $4, is_featured = $5,
                description = coalesce(description, $6), delivery_fee = coalesce(fn_setting_num('delivery_fee', 30), 30)
          WHERE slug = $1`,
        [slug, !!o.price_on_bill, o.window?.[0] ?? null, o.window?.[1] ?? null, !!o.featured, o.description]
      );
    }
    const dailyPromos = [
      // [name, title, subtitle, cta, service slug, placement, bg, order]
      ['Fresh vegetables 6–10 AM', '🥬 Fresh vegetables every morning', 'Delivered 6–10 AM · choose in kg · pay as per market price', 'Order vegetables', 'food-daily-fresh-vegetables', 'carousel', '#15803d', -3],
      ['Fresh meat & fish', '🍗 Fresh chicken, mutton, prawns & fish', 'Cut the way you like — curry cut, boneless, fry pieces', 'Order now', 'food-daily-daily-fresh-meat-fish', 'carousel', '#b91c1c', -2],
      ['Fresh milk 6–9 AM', '🥛 Fresh milk at your door', 'Organic & packet milk · every morning 6–9 AM', 'Order milk', 'food-daily-fresh-milk', 'carousel', '#0369a1', -1],
      ['Fresh vegetables tile', 'Fresh vegetables', '6–10 AM · market price', 'Order', 'food-daily-fresh-vegetables', 'tile', '#15803d', -3],
      ['Fresh meat & fish tile', 'Fresh meat & fish', 'Cut the way you like', 'Order', 'food-daily-daily-fresh-meat-fish', 'tile', '#b91c1c', -2],
      ['Fresh milk tile', 'Fresh milk', 'Every morning 6–9 AM', 'Order', 'food-daily-fresh-milk', 'tile', '#0369a1', -1],
    ];
    for (const [name, title, subtitle, cta, slug, placement, bg, order] of dailyPromos) {
      await client.query(
        `INSERT INTO promotions (name, title, subtitle, cta_text, link_type, link_value, placement, bg_color, sort_order, image_url, image_credit)
         SELECT $1, $2, $3, $4, 'service', $5, $6, $7, $8, s.image_url, s.image_credit FROM services s WHERE s.slug = $5`,
        [name, title, subtitle, cta, slug, placement, bg, order]
      );
    }
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_daily_fresh', current_date::text)");
    console.log('Added the daily services (vegetables, meat & fish, milk) and their promotions.');
  }

  // One time (Phase 2): the top services, in this order — Fresh Vegetables, Fresh Meat & Fish, Fresh Milk, Kirana.
  // Kirana: no fixed prices (shop bill), customers may also write their own list or send a photo of it.
  // Food & Daily-Use comes first on the home page. Later admin changes are kept.
  const kiranaDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'migrated_kirana_list'");
  if (!kiranaDone.rowCount) {
    await client.query(`UPDATE services SET sort_order = sort_order + 10
                         WHERE category_id = (SELECT id FROM categories WHERE slug = 'food-daily')`);
    const top = ['food-daily-fresh-vegetables', 'food-daily-daily-fresh-meat-fish', 'food-daily-fresh-milk', 'food-daily-kirana-delivery'];
    for (const [i, slug] of top.entries()) await client.query('UPDATE services SET sort_order = $2 WHERE slug = $1', [slug, i]);
    await client.query(
      `UPDATE services SET price_on_bill = true, allows_list = true, is_featured = true, price_unit = 'as per shop bill',
              description = 'Groceries from your nearby kirana shop. Pick items from our list, write your own list, or send a photo of it — you pay as per the shop bill.'
        WHERE slug = 'food-daily-kirana-delivery'`
    );
    await client.query("UPDATE categories SET sort_order = -1 WHERE slug = 'food-daily'");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('migrated_kirana_list', current_date::text)");
    console.log('Kirana: price as per shop bill + own list; top services ordered.');
  }

  // One time: the full kirana catalog (db/kirana.js) replaces the first short list. Old items that are not in the
  // catalog any more are hidden (not deleted: old orders point to them).
  const kiranaCatalog = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_kirana_catalog'");
  if (!kiranaCatalog.rowCount) {
    const keep = products['food-daily/Kirana Delivery'].map(([name]) => `food-daily-kirana-delivery-${slugify(name)}`);
    const hidden = await client.query(
      `UPDATE products SET is_active = false WHERE service_id = (SELECT id FROM services WHERE slug = 'food-daily-kirana-delivery')
         AND NOT (slug = ANY($1)) AND is_active`,
      [keep]
    );
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_kirana_catalog', current_date::text)");
    console.log(`Kirana catalog: ${keep.length} items (${hidden.rowCount} old items hidden).`);
  }

  // One time: the Pooja Store — like Kirana (price as per shop bill, customers may write their own list or send a
  // photo), right after Kirana, regular agents. The pooja items move out of Kirana (hidden there, not deleted).
  const poojaDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_pooja_store'");
  if (!poojaDone.rowCount) {
    await client.query(
      `UPDATE services SET price_on_bill = true, allows_list = true, skill_code = 'delivery', sort_order = 4,
              price_unit = 'as per shop bill', delivery_fee = coalesce(fn_setting_num('delivery_fee', 30), 30),
              description = 'Everything for your daily pooja — diyas, agarbatti, camphor, kumkum, flowers and more. Pick items, write your own list or send a photo — you pay as per the shop bill.'
        WHERE slug = 'food-daily-pooja-store'`
    );
    await client.query(
      `UPDATE products SET is_active = false
        WHERE service_id = (SELECT id FROM services WHERE slug = 'food-daily-kirana-delivery') AND section = 'Pooja Needs'`
    );
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_pooja_store', current_date::text)");
    console.log('Pooja Store added (pooja items moved out of Kirana).');
  }

  // One time: ⚡ Instant Delivery — anything within 15 minutes. Shows the Fresh Vegetables and Kirana products (live,
  // no copies) plus an "Others" write-anything tab; price as per shop bill; only instant agents get these orders.
  const instantDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_instant_delivery'");
  if (!instantDone.rowCount) {
    await client.query(
      `UPDATE services SET skill_code = 'instant', price_on_bill = true, allows_list = true, is_featured = false,
              sort_order = -1, eta_minutes = 15, price_unit = 'within 15 min', delivery_fee = 40,
              source_service_ids = ARRAY(SELECT id FROM services WHERE slug IN ('food-daily-fresh-vegetables', 'food-daily-kirana-delivery')
                                          ORDER BY array_position(ARRAY['food-daily-kirana-delivery', 'food-daily-fresh-vegetables'], slug::text)),
              description = 'Anything you need, at your door in about 15 minutes — kirana, vegetables or write anything else. Pay as per the shop bill.'
        WHERE slug = 'food-daily-instant-delivery'`
    );
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_instant_delivery', current_date::text)");
    console.log('⚡ Instant Delivery added (instant agents only).');
  }

  // One time: 🎉 Events in (bookings go to event partners only); Waste & Recycling and Local Logistics removed
  // completely (no orders used them). Their agent types are switched off, not deleted.
  const eventsDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_events'");
  if (!eventsDone.rowCount) {
    await client.query(
      `DELETE FROM promotions WHERE (link_type = 'category' AND link_value IN ('recycling', 'logistics'))
          OR (link_type = 'service' AND (link_value LIKE 'recycling-%' OR link_value LIKE 'logistics-%'))`
    );
    await client.query("DELETE FROM services WHERE category_id IN (SELECT id FROM categories WHERE slug IN ('recycling', 'logistics'))");
    await client.query("DELETE FROM categories WHERE slug IN ('recycling', 'logistics')");
    await client.query(
      `UPDATE service_types t SET is_active = false WHERE t.code IN ('recycling', 'moving')
          AND NOT EXISTS (SELECT 1 FROM services s WHERE s.skill_code = t.code)`
    );
    await client.query(
      `INSERT INTO franchise_services (franchise_id, service_id)
       SELECT f.id, s.id FROM franchises f CROSS JOIN services s JOIN categories c ON c.id = s.category_id AND c.slug = 'events'
       ON CONFLICT DO NOTHING`
    );
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_events', current_date::text)");
    console.log('🎉 Events added; Waste & Recycling and Local Logistics removed.');
  }

  // One time (2026-10-17) — services cleanup, part 1:
  //  💧 Drinking water: its own card at the top of the home page, one 20L can ₹25 with delivery included, delivered
  //     only by the company's own staff (type our_service_employees). Other water products switched off (not deleted).
  //  🏠 Everyday Home Services: no prices — we only pass the booking to an independent partner; the customer and
  //     the partner agree the price on the phone. Guarded: later admin edits are kept.
  const homeClean = await client.query("SELECT 1 FROM site_settings WHERE key = 'cleanup_home_services_v1'");
  if (!homeClean.rowCount) {
    const water = 'home-services-drinking-water-delivery-20l-cans-bottles';
    await client.query(
      `UPDATE services SET name = 'Drinking Water Can (20L)', home_card = true, skill_code = 'our_service_employees',
              base_price = 25, price_unit = 'per can', delivery_fee = 0,
              description = '20 litre drinking water can at your door — ₹25 per can, delivery included. Delivered by our own team.'
        WHERE slug = $1`, [water]);
    await client.query(`UPDATE products SET name = '20L Drinking Water Can', brand = NULL, unit = '20 L', price = 25, mrp = NULL, is_active = true
                          WHERE slug = $1`, [`${water}-water-can-refill`]);
    await client.query(`UPDATE products p SET is_active = false FROM services s
                          WHERE s.id = p.service_id AND s.slug = $1 AND p.slug <> $2`, [water, `${water}-water-can-refill`]);
    await client.query(
      `UPDATE services s SET base_price = 0, price_unit = 'price on discussion', delivery_fee = 0
         FROM categories c WHERE c.id = s.category_id AND c.slug = 'home-services' AND s.slug <> $1`, [water]);
    await client.query(`UPDATE categories SET description = 'Plumbers, electricians, cleaning, repairs and laundry — book, then talk to the partner directly.'
                          WHERE slug = 'home-services'`);
    await client.query("INSERT INTO site_settings (key, value) VALUES ('cleanup_home_services_v1', current_date::text)");
    console.log('🧹 Services cleanup 1: 💧 water card ₹25 (our staff); 🏠 home services without prices.');
  }

  // One time (2026-10-17) — services cleanup, part 2: "Empty Water-Can Pickup" removed (switched off, not deleted:
  // old orders keep it).
  const homeClean2 = await client.query("SELECT 1 FROM site_settings WHERE key = 'cleanup_home_services_v2'");
  if (!homeClean2.rowCount) {
    await client.query("UPDATE services SET is_active = false WHERE slug = 'home-services-empty-water-can-pickup'");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('cleanup_home_services_v2', current_date::text)");
    console.log('🧹 Services cleanup 2: Empty Water-Can Pickup removed.');
  }

  // One time (2026-10-17) — services cleanup, part 3: "Water-Tank Cleaning" becomes "Water Tanker Supply" (a tanker
  // of water when the borewell / tap supply is not working). Same service, so old orders keep their history.
  const homeClean3 = await client.query("SELECT 1 FROM site_settings WHERE key = 'cleanup_home_services_v3'");
  if (!homeClean3.rowCount) {
    await client.query(
      `UPDATE services SET name = 'Water Tanker Supply', price_unit = 'price on discussion', eta_minutes = 120,
              description = 'Borewell not working or no tap water? Book a water tanker — the tanker owner calls you to fix the quantity, time and price.'
        WHERE slug = 'home-services-water-tank-cleaning'`);
    await client.query("INSERT INTO site_settings (key, value) VALUES ('cleanup_home_services_v3', current_date::text)");
    console.log('🧹 Services cleanup 3: Water-Tank Cleaning → Water Tanker Supply.');
  }

  // One time (2026-10-19): 🏡 Village Needs — shows Kirana, Fresh Vegetables and Daily Fresh Meat & Fish live (no copies)
  // plus an "Other things" list/photo tab; next-day delivery to villages only; our own staff; price as per shop bill.
  // 🚗 Share Ride — car owners need a subscription (HQ default ₹0 / 30 days; each franchise sets its own).
  const newCats = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_village_share_ride'");
  if (!newCats.rowCount) {
    await client.query(
      `UPDATE services SET skill_code = 'our_service_employees', is_village = true, price_on_bill = true, allows_list = true,
              eta_minutes = 1440, price_unit = 'next-day delivery', delivery_fee = 0,
              source_service_ids = ARRAY(SELECT id FROM services WHERE slug IN ('food-daily-kirana-delivery', 'food-daily-fresh-vegetables', 'food-daily-daily-fresh-meat-fish')
                                          ORDER BY array_position(ARRAY['food-daily-kirana-delivery', 'food-daily-fresh-vegetables', 'food-daily-daily-fresh-meat-fish'], slug::text)),
              description = 'Kirana, vegetables, fresh meat — or write / photo anything else you need (bike parts, medicines…). Delivered to your village next day by our own team. Pay as per the shop bill.'
        WHERE slug = 'village-needs-village-needs'`);
    await client.query(
      `UPDATE services SET skill_code = 'shared_car_agent', subscription_required = true, subscription_fee = 0, subscription_days = 30,
              description = 'Seats in commercial cars going between towns. Pick your seat, pay the car owner, get your ticket.'
        WHERE slug = 'share-ride-share-ride'`);
    await client.query(
      `INSERT INTO franchise_services (franchise_id, service_id)
       SELECT f.id, s.id FROM franchises f CROSS JOIN services s WHERE s.slug IN ('village-needs-village-needs', 'share-ride-share-ride')
       ON CONFLICT DO NOTHING`);
    await client.query("UPDATE categories SET sort_order = 1 WHERE slug = 'village-needs'");
    await client.query("UPDATE categories SET sort_order = 7 WHERE slug = 'share-ride'");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_village_share_ride', current_date::text)");
    console.log('🏡 Village Needs and 🚗 Share Ride added.');
  }

  // One time (2026-10-20): 🛠️ Shop For Me (8 write-your-list shops: up to 3 items, ₹50 delivery, regular agents, bills
  // above ₹1,000 paid by the customer to the shop), 👷 Daily Workers and 💡 Digital Services (pages of their own).
  const moreDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_shop_for_me_v1'");
  if (!moreDone.rowCount) {
    const shopFor = {
      'Plumbing & Sanitary Items': 'Taps, small pipes, fittings, washers, Teflon tape…',
      'Electrical Items': 'Bulbs, switches, wires, holders, extension boards…',
      'Hardware, Tools & Paint': 'Screws, nails, small tools, paint, brushes, putty…',
      'Mobile & Computer Accessories': 'Chargers, cables, earphones, mouse, pen drive…',
      'Household Utility Items': 'Buckets, locks, torch, cells / batteries, mops…',
      'Garden & Plant Supplies': 'Seeds, pots, small sprayers, fertilizer packets…',
      'Stationery & Small Items': 'Books, pens, photocopies, gift items…',
      'Anything Else (small items)': 'Anything small from a town shop — write it or send a photo.',
    };
    for (const [name, what] of Object.entries(shopFor)) {
      await client.query(
        `UPDATE services SET skill_code = 'delivery', allows_list = true, price_on_bill = true, delivery_fee = 50, max_items = 3,
                bill_cash_limit = 1000, price_unit = 'as per shop bill', eta_minutes = 120,
                description = $2 || ' Up to 3 items per order, small things that fit on a bike. You pay as per the shop bill + ₹50 delivery.'
          WHERE slug = $1`, [`shop-for-me-${slugify(name)}`, what]);
    }
    await client.query(
      `INSERT INTO franchise_services (franchise_id, service_id)
       SELECT f.id, s.id FROM franchises f CROSS JOIN services s JOIN categories c ON c.id = s.category_id
        WHERE c.slug IN ('shop-for-me', 'daily-workers', 'digital-services')
       ON CONFLICT DO NOTHING`);
    await client.query("UPDATE categories SET sort_order = 1 WHERE slug = 'shop-for-me'");
    await client.query("UPDATE categories SET sort_order = 2 WHERE slug = 'village-needs'");
    await client.query("UPDATE categories SET sort_order = 3 WHERE slug = 'daily-workers'");
    await client.query("UPDATE categories SET sort_order = 9 WHERE slug = 'digital-services'");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_shop_for_me_v1', current_date::text)");
    console.log('🛠️ Shop For Me, 👷 Daily Workers and 💡 Digital Services added.');
  }

  // One time (2026-10-21): launch offer = free delivery on the FIRST order only, once per mobile number (was "first 3",
  // which the app no longer gave). The announcement says exactly that. Later changes in HQ → Settings are kept.
  const offerDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'offer_first_order_v1'");
  if (!offerDone.rowCount) {
    await client.query("UPDATE site_settings SET value = '1' WHERE key = 'free_delivery_orders'");
    await client.query("UPDATE site_settings SET value = '🎉 Free delivery on your first order in Siddipet!' WHERE key = 'announcement'");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('offer_first_order_v1', current_date::text)");
    console.log('🎉 Offer: free delivery on the first order (once per mobile number).');
  }

  // One time (2026-10-21): orders placed before orders.free_delivery existed — mark the ones whose delivery charge
  // was waived (charge 0 although a service in it has a charge, not a village order), so the offer is not given twice.
  const flagDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'offer_free_flag_v1'");
  if (!flagDone.rowCount) {
    const f = await client.query(`UPDATE orders o SET free_delivery = true
       WHERE o.delivery_fee = 0 AND NOT o.free_delivery
         AND NOT EXISTS (SELECT 1 FROM services v WHERE v.id = o.via_service_id AND v.is_village)
         AND coalesce((SELECT max(s.delivery_fee) FROM services s WHERE s.id = ANY (fn_order_services(o.id))), 0) > 0`);
    await client.query("INSERT INTO site_settings (key, value) VALUES ('offer_free_flag_v1', current_date::text)");
    console.log(`🎉 Offer: ${f.rowCount} earlier orders marked as "free delivery used".`);
  }

  // One time (2026-10-21): 📍 franchises made before centres existed get the middle of their town areas as centre
  // (range 25 km). HQ can move it in Edit franchise.
  const centreDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'franchise_centres_v1'");
  if (!centreDone.rowCount) {
    const c = await client.query(`UPDATE franchises f SET center_lat = round(a.lat, 6), center_lng = round(a.lng, 6)
       FROM (SELECT franchise_id, avg(lat) AS lat, avg(lng) AS lng FROM localities
              WHERE is_active AND NOT is_village AND franchise_id IS NOT NULL GROUP BY franchise_id) a
      WHERE a.franchise_id = f.id AND f.center_lat IS NULL`);
    await client.query("INSERT INTO site_settings (key, value) VALUES ('franchise_centres_v1', current_date::text)");
    console.log(`📍 ${c.rowCount} franchise centre(s) set from their areas (range 25 km).`);
  }

  // One time (2026-10-22): we only connect people — no price tags except the 💧 water can (₹25, our own team) and our
  // delivery charges. Booked services (vehicle, personal care, tuition, pets…): the price is agreed with the partner.
  // Shop items (milk, eggs, fruits, pooja…): as per the shop bill, like kirana and vegetables. Old orders keep theirs.
  const pricesDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'prices_off_v1'");
  if (!pricesDone.rowCount) {
    const talk = await client.query(`UPDATE services s SET base_price = 0, price_unit = 'price on discussion'
       WHERE s.is_active AND NOT s.home_card AND NOT s.allows_list AND NOT s.is_village AND coalesce(cardinality(s.source_service_ids), 0) = 0
         AND NOT EXISTS (SELECT 1 FROM products p WHERE p.service_id = s.id)
         AND s.skill_code NOT IN ('shared_car_agent')
         AND s.category_id NOT IN (SELECT id FROM categories WHERE slug IN ('daily-workers', 'digital-services', 'events', 'vehicle-rental'))
         AND (s.base_price > 0 OR s.price_unit IS NULL OR s.price_unit !~* 'discussion')`);
    const bill = await client.query(`UPDATE services s SET price_on_bill = true, base_price = 0, price_unit = 'as per shop bill'
       WHERE s.is_active AND NOT s.home_card AND NOT s.price_on_bill AND EXISTS (SELECT 1 FROM products p WHERE p.service_id = s.id)`);
    // home page offer cards: no prices; AC service is not an everyday need; car & bike wash together
    await client.query("UPDATE promotions SET is_active = false WHERE name = 'AC service tile'");
    await client.query(`UPDATE promotions SET title = 'Car & bike wash at home', subtitle = 'Car or bike — washed at your door',
                               link_type = 'category', link_value = 'vehicle' WHERE name = 'Car wash tile'`);
    await client.query("UPDATE promotions SET subtitle = 'Toned milk · curd · ghee · paneer' WHERE name = 'Morning milk'");
    await client.query("UPDATE promotions SET title = 'Free delivery on your first order 🎉' WHERE name = 'Free delivery launch offer'");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('prices_off_v1', current_date::text)");
    console.log(`💬 Prices off: ${talk.rowCount} services now "price on discussion", ${bill.rowCount} shops now "as per shop bill".`);
  }

  // One time (2026-10-22): a cleaner home page — the small offer cards that only repeated the sliding banner (fresh
  // vegetables, meat & fish, milk) are switched off; HQ can switch them on again in Offers & promotions.
  const homeDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'home_cleanup_v1'");
  if (!homeDone.rowCount) {
    const t = await client.query("UPDATE promotions SET is_active = false WHERE name IN ('Fresh vegetables tile', 'Fresh meat & fish tile', 'Fresh milk tile')");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('home_cleanup_v1', current_date::text)");
    console.log(`🏠 Home: ${t.rowCount} repeated offer cards switched off.`);
  }

  // One time (2026-10-22): ⭐ the first "Our most popular services" cards, for all cities — HQ changes them in
  // Popular on home. Vegetables, kirana, meat & fish open their shops; car & bike wash opens Vehicle Services.
  const popularDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'home_popular_v1'");
  if (!popularDone.rowCount) {
    const cards = [
      ['food-daily-fresh-vegetables', null, 'Fresh Vegetables', 'From the market to your door', null, null],
      ['food-daily-kirana-delivery', null, 'Kirana', 'Groceries & daily needs', null, null],
      ['food-daily-daily-fresh-meat-fish', null, 'Fresh Meat & Fish', 'Cut the way you like', null, null],
      [null, 'vehicle', 'Car & Bike Wash', 'Washed at your door', 'vehicle-car-wash-at-home', null],
    ];
    let n = 0;
    for (const [i, [svc, cat, title, sub, photoOf]] of cards.entries()) {
      const r = await client.query(
        `INSERT INTO home_popular (franchise_id, service_id, category_id, title, subtitle, image_url, image_credit, sort_order)
         SELECT NULL, (SELECT id FROM services WHERE slug = $1), (SELECT id FROM categories WHERE slug = $2), $3, $4,
                (SELECT image_url FROM services WHERE slug = $5), (SELECT image_credit FROM services WHERE slug = $5), $6
          WHERE EXISTS (SELECT 1 FROM services WHERE slug = $1) OR EXISTS (SELECT 1 FROM categories WHERE slug = $2)`,
        [svc, cat, title, sub, photoOf, i + 1]);
      n += r.rowCount;
    }
    await client.query("INSERT INTO site_settings (key, value) VALUES ('home_popular_v1', current_date::text)");
    console.log(`⭐ Popular on home: ${n} cards for all cities.`);
  }
  // One time (2026-10-22): 🛠️ Shop For Me and 🚗 Share Ride as popular cards 5 and 6 (all cities; HQ edits / removes them
  // like the others), and bright real photos with people on all six: our own in the apps' public/popular/ (no credit),
  // the rest from Wikimedia Commons (licences that allow business use, credited on the Photo credits page) until ours
  // replace them. A picture HQ already changed is kept: only empty ones, the old NonCommercial car-wash photo and the
  // short-lived drawings are replaced.
  const popPhotosDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'home_popular_photos_v2'");
  if (!popPhotosDone.rowCount) {
    for (const [slug, title, sub, sort] of [['shop-for-me', 'Shop For Me', 'Bulbs, taps, chargers — we buy & bring', 6],
      ['share-ride', 'Share Ride', 'Seats to Hyderabad & nearby towns', 7]]) {
      await client.query(
        `INSERT INTO home_popular (franchise_id, category_id, title, subtitle, sort_order)
         SELECT NULL, c.id, $2::text, $3::text, $4::int FROM categories c
          WHERE c.slug = $1::text AND NOT EXISTS (SELECT 1 FROM home_popular WHERE title = $2::text)`,
        [slug, title, sub, sort]);
    }
    const photos = [
      [
        "Fresh Vegetables",
        "/popular/vegetables.jpg",
        null
      ],
      [
        "Kirana",
        "/popular/kirana.jpg",
        null
      ],
      [
        "Fresh Meat & Fish",
        "/popular/meat-fish.jpg",
        null
      ],
      [
        "Car & Bike Wash",
        "/popular/car-wash.jpg",
        null
      ],
      [
        "Shop For Me",
        "/popular/shop-for-me.jpg",
        null
      ],
      [
        "Share Ride",
        "/popular/share-ride.jpg",
        null
      ]
];
    for (const [title, url, credit] of photos) {
      await client.query(
        `UPDATE home_popular SET image_url = $2, image_credit = $3
          WHERE title = $1 AND (image_url IS NULL OR image_url = '' OR image_url LIKE '/art/popular-%'
                OR image_url LIKE 'https://live.staticflickr.com/1003/536026002%' OR image_url LIKE '%Kannanelectrical.jpg%')`,
        [title, url, credit]);
    }
    await client.query("INSERT INTO site_settings (key, value) VALUES ('home_popular_photos_v2', current_date::text)");
    console.log('⭐ Popular on home: 6 cards with real photos.');
  }
  // One time (2026-10-22): the sliding banner shows what customers see nowhere else on the home page — our newer
  // services — instead of repeats (free delivery = the banner on top; vegetables & meat = popular cards; 2 milk slides).
  // The new slides are text-only for now (no photos yet); HQ edits them in Offers & promotions.
  const slidesDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'home_slides_v2'");
  if (!slidesDone.rowCount) {
    await client.query(`UPDATE promotions SET is_active = false
                         WHERE name IN ('Free delivery launch offer', 'Morning milk', 'Fresh vegetables 6–10 AM', 'Fresh meat & fish')`);
    const slides = [
      ['Share Ride slide', '🚗 Share Ride to Hyderabad & nearby towns', 'Book a seat in a shared car — pick your seat, pay the car owner by UPI', 'Find a ride', 'share-ride', '#6d28d9'],
      ['Village Needs slide', '🏡 Village Needs — delivered to your village', 'Kirana, vegetables, meat & more — next-day delivery by our own team', 'Order for your village', 'village-needs', '#4d7c0f'],
      ['Shop For Me slide', '🛠️ Shop For Me', 'Bulbs, taps, chargers… we buy it from a town shop and bring it to you', 'Write your list', 'shop-for-me', '#0f766e'],
      ['Daily Workers slide', '👷 Daily workers near you', 'Masons, painters, helpers and more — call them directly, free', 'See workers', 'daily-workers', '#b45309'],
    ];
    for (const [i, [name, title, sub, cta, slug, bg]] of slides.entries()) {
      await client.query(
        `INSERT INTO promotions (name, title, subtitle, cta_text, link_type, link_value, placement, bg_color, text_color, sort_order, is_active)
         SELECT $1::text, $2::text, $3::text, $4::text, 'category', $5::text, 'carousel', $6::text, '#ffffff', $7::int, true
          WHERE NOT EXISTS (SELECT 1 FROM promotions WHERE name = $1::text)`,
        [name, title, sub, cta, slug, bg, 10 + i]);
    }
    await client.query("INSERT INTO site_settings (key, value) VALUES ('home_slides_v2', current_date::text)");
    console.log('📢 Slides: repeats off; Share Ride, Village Needs, Shop For Me, Daily Workers added.');
  }

  // One time: the "Car & bike wash" offer card repeats the popular card above it → off (HQ can switch it on again).
  const washDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'home_wash_tile_off_v1'");
  if (!washDone.rowCount) {
    await client.query("UPDATE promotions SET is_active = false WHERE name = 'Car wash tile'");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('home_wash_tile_off_v1', current_date::text)");
  }

  // One time (2026-10-22): ⚡ Instant Delivery promise 15 → 10 minutes (shown on the home card, the top bar and
  // checkout; agents see "within 10 min"). Only if still at the old 15, so an admin's own value is kept.
  const tenDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'instant_10min_v1'");
  if (!tenDone.rowCount) {
    await client.query(
      `UPDATE services SET eta_minutes = 10, price_unit = replace(price_unit, '15 min', '10 min'),
              description = replace(description, 'about 15 minutes', 'about 10 minutes')
        WHERE slug = 'food-daily-instant-delivery' AND eta_minutes = 15`
    );
    await client.query("INSERT INTO site_settings (key, value) VALUES ('instant_10min_v1', current_date::text)");
    console.log('⚡ Instant Delivery: within 10 minutes.');
  }

  // One time: 🚗 Vehicle Rental (car bookings) in every franchise. Car bookings go only to car partners with an
  // active subscription (HQ default ₹0 / 30 days; each dealer sets its own fee and period in Subscriptions).
  const carsDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_vehicle_rental'");
  if (!carsDone.rowCount) {
    await client.query(
      `UPDATE services s SET subscription_required = true, subscription_days = 30
         FROM categories c WHERE c.id = s.category_id AND c.slug = 'vehicle-rental'`
    );
    await client.query(
      `INSERT INTO franchise_services (franchise_id, service_id)
       SELECT f.id, s.id FROM franchises f CROSS JOIN services s JOIN categories c ON c.id = s.category_id AND c.slug = 'vehicle-rental'
       ON CONFLICT DO NOTHING`
    );
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_vehicle_rental', current_date::text)");
    console.log('🚗 Vehicle Rental (car bookings) added — subscription only.');
  }

  // 🏠 Home Doctor Visit types sit under the Home Doctor Visit service (only set when missing: admin edits are kept).
  for (const [name, icon, description] of homeVisitTypes) {
    await client.query(
      `UPDATE services s SET parent_id = p.id, icon = coalesce(s.icon, $1), description = coalesce(s.description, $2)
         FROM services p WHERE p.slug = 'health-home-doctor-visit' AND s.slug = $3 AND s.parent_id IS NULL`,
      [icon, description, `health-${slugify(name)}`]
    );
  }

  // One time: 💊 Health becomes two services — Medicine Delivery (kirana-style: prescription photo → medical shop bill)
  // and Home Doctor Visit (9 types for subscribed doctor partners). Old health services are removed; one used by a
  // past order (Prescription Pickup / Drop) is only hidden. Doctor types and Medicine Delivery need a subscription.
  const healthDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_health_v2'");
  if (!healthDone.rowCount) {
    const keep = ['Medicine Delivery', 'Home Doctor Visit', ...homeVisitTypes.map(([n]) => n)];
    const old = `SELECT s.id FROM services s JOIN categories c ON c.id = s.category_id WHERE c.slug = 'health' AND NOT (s.name = ANY ($1))`;
    const used = `EXISTS (SELECT 1 FROM order_items i LEFT JOIN products p ON p.id = i.product_id
                           WHERE i.service_id = s.id OR p.service_id = s.id)`;
    await client.query(`UPDATE services s SET is_active = false WHERE s.id IN (${old}) AND ${used}`, [keep]);
    await client.query(
      `DELETE FROM promotions WHERE link_type = 'service' AND link_value IN (SELECT slug FROM services s WHERE s.id IN (${old}) AND NOT ${used})`,
      [keep]
    );
    await client.query(`DELETE FROM services s WHERE s.id IN (${old}) AND NOT ${used}`, [keep]);
    // Physiotherapy Home Visit already existed with a price: now it is a doctor-partner type like the others
    await client.query(
      `UPDATE services s SET skill_code = 'doctor_type', base_price = 0, eta_minutes = NULL,
              price_unit = CASE WHEN s.base_price > 0 THEN 'fee agreed with the partner' ELSE s.price_unit END,
              subscription_required = true, subscription_fee = 0, subscription_days = 30
         FROM services p WHERE s.parent_id = p.id AND p.slug = 'health-home-doctor-visit'`
    );
    await client.query(
      `UPDATE services SET allows_list = true, price_on_bill = true, price_unit = 'as per medical shop bill', base_price = 0,
              subscription_required = true, subscription_fee = 0, subscription_days = 30
        WHERE slug = 'health-medicine-delivery'`
    );
    await client.query(
      `INSERT INTO franchise_services (franchise_id, service_id)
       SELECT f.id, s.id FROM franchises f CROSS JOIN services s JOIN categories c ON c.id = s.category_id AND c.slug = 'health'
        WHERE s.is_active ON CONFLICT DO NOTHING`
    );
    await client.query(
      `UPDATE service_types t SET is_active = false WHERE t.code = 'health'
          AND NOT EXISTS (SELECT 1 FROM services s WHERE s.skill_code = t.code AND s.is_active)`
    );
    await client.query("UPDATE categories SET description = 'Medicines from your nearby medical shop, and doctors, nurses and care at home.' WHERE slug = 'health'");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_health_v2', current_date::text)");
    console.log('💊 Health: Medicine Delivery + Home Doctor Visit (9 types) — subscription only.');
  }

  // Order numbers start at #1001.
  await client.query(`SELECT setval('orders_id_seq', 1000) WHERE NOT EXISTS (SELECT 1 FROM orders)`);

  for (const [name, pincode, lat, lng] of localities) {
    await client.query(
      'INSERT INTO localities (name, pincode, lat, lng) VALUES ($1,$2,$3,$4) ON CONFLICT (name) DO NOTHING',
      [name, pincode, lat, lng]
    );
  }

  // One time: launch in Siddipet. The old Hyderabad areas are switched off (not deleted: old orders point to them)
  // and "Hyderabad" in the home page texts becomes "Siddipet". Admin edits after this are kept.
  const siddipet = await client.query("SELECT 1 FROM site_settings WHERE key = 'migrated_siddipet'");
  if (!siddipet.rowCount) {
    await client.query('UPDATE localities SET is_active = (name = ANY($1))', [localities.map(([name]) => name)]);
    await client.query("UPDATE site_settings SET value = replace(value, 'Hyderabad', 'Siddipet') WHERE key IN ('announcement', 'banner_subtitle')");
    await client.query("UPDATE promotions SET title = replace(title, 'Hyderabad', 'Siddipet'), subtitle = replace(subtitle, 'Hyderabad', 'Siddipet')");
    await client.query("INSERT INTO site_settings (key, value) VALUES ('migrated_siddipet', current_date::text)");
  }

  // One time: delivery charge per service. Shop services (with products) start at the old single delivery fee,
  // bookings at ₹0. Admin → Delivery charges changes them.
  const perService = await client.query("SELECT 1 FROM site_settings WHERE key = 'migrated_service_fees'");
  if (!perService.rowCount) {
    await client.query(`UPDATE services s SET delivery_fee = coalesce(fn_setting_num('delivery_fee', 30), 30)
                          WHERE EXISTS (SELECT 1 FROM products p WHERE p.service_id = s.id)`);
    await client.query("INSERT INTO site_settings (key, value) VALUES ('migrated_service_fees', current_date::text)");
  }

  for (const [key, value] of Object.entries(defaultSettings)) {
    await client.query('INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
    if (oldDefaults[key]) {
      await client.query('UPDATE site_settings SET value = $2 WHERE key = $1 AND value = $3', [key, value, oldDefaults[key]]);
    }
  }

  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  const admin = await client.query(
    `INSERT INTO users (username, password_hash, full_name, role)
     VALUES ('admin', $1, 'Administrator', 'admin') ON CONFLICT (username) DO NOTHING RETURNING id`,
    [await bcrypt.hash(adminPassword, 10)]
  );

  // One time: franchise model. Everything that exists today (areas, agents, orders, admins) becomes the first
  // dealer franchise — Siddipet (FR-0001) — with every service; the Super Admin (HQ) login is created.
  let superPassword = null;
  const franchiseDone = await client.query("SELECT 1 FROM site_settings WHERE key = 'seeded_franchises'");
  if (!franchiseDone.rowCount) {
    const { rows: fr } = await client.query(
      `INSERT INTO franchises (code, name, city, state, status, notes)
       VALUES ('FR-0001', 'Siddipet Franchise', 'Siddipet', 'Telangana', 'active', 'First franchise. Please fill in the dealer details.')
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`
    );
    const fid = fr[0].id;
    await client.query('UPDATE localities SET franchise_id = $1 WHERE franchise_id IS NULL', [fid]);
    await client.query('UPDATE agents SET franchise_id = $1 WHERE franchise_id IS NULL', [fid]);
    await client.query('UPDATE orders SET franchise_id = $1 WHERE franchise_id IS NULL', [fid]);
    await client.query("UPDATE users SET franchise_id = $1 WHERE role = 'admin' AND franchise_id IS NULL", [fid]);
    await client.query('INSERT INTO franchise_services (franchise_id, service_id) SELECT $1, id FROM services ON CONFLICT DO NOTHING', [fid]);
    await client.query('UPDATE complaints SET franchise_id = $1 WHERE franchise_id IS NULL', [fid]);
    superPassword = process.env.SUPERADMIN_PASSWORD || `HQ-${crypto.randomBytes(6).toString('base64url')}#${crypto.randomInt(10, 99)}`;
    await client.query(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES ('superadmin', $1, 'Super Admin', 'superadmin')
       ON CONFLICT (username) DO NOTHING`,
      [await bcrypt.hash(superPassword, 10)]
    );
    await client.query("INSERT INTO site_settings (key, value) VALUES ('seeded_franchises', current_date::text)");
  }
  await client.query('COMMIT');
  if (superPassword) console.log(`Created Super Admin -> username: superadmin  password: ${superPassword}  (keep it safe)`);

  const counts = await client.query(
    'SELECT (SELECT count(*) FROM categories) c, (SELECT count(*) FROM services) s, (SELECT count(*) FROM products) p'
  );
  const { c, s, p } = counts.rows[0];
  console.log(`Schema "${SCHEMA}" ready: ${c} categories, ${s} services, ${p} products (${productCount} new).`);
  if (refreshImages) console.log(`Refreshed ${refreshed} images from images.json.`);
  if (admin.rowCount) console.log(`Created admin user -> username: admin  password: ${adminPassword}`);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('DB setup failed:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
