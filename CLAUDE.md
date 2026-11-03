# CLAUDE.md — All Services (GGTech)

Hyperlocal app for Telangana towns: customers order daily needs and book local services, verified local partners
(agents) do the work, each town is run by a franchise admin, HQ (Super Admin) runs the platform. Live in
**Siddipet (FR-0001)** and **Armoor (FR-0002)**. Setup and deploy steps: [README.md](README.md).

## Owner's rules (always follow)

- **Business logic lives in PostgreSQL** — calculations and rules are `fn_*` / `sp_*` functions in `server/db/*.sql`;
  Express routes only validate input and call them. New rules go in SQL, not in JS.
- **Only the owner's own AI photos** for products, services and slides (owner makes them from prompts). No stock,
  web, Wikimedia or licensed photos; no cartoons. Remove the small "AI" corner badge before using a photo.
- **Honest model:** shop items show "Market price"; the customer pays the real shop bill (photo in the order) plus
  our delivery charge. Never invent product prices. Waiting customers are told the truth (all partners busy /
  none online, place in line).
- **Commit and push only when the owner says "push".** Never commit `.env`, database dumps, `server/uploads/`
  or `server/private_uploads/` (customer data and documents).
- **Never write passwords or API keys** into code, docs, memory or chat. Don't ask the owner for them.
- **Test on the PC, never on the live server.** Test data uses usernames starting `zt_` so it can be removed;
  back up the database before big changes; run the API with SMS in test mode (no real SMS).
- The owner writes short, informal English; reply in simple, plain words. Telugu text must be natural Telugu.

## Layout

| Folder | What | Dev port | Live |
|---|---|---|---|
| `user/` | Customer app (React + Vite PWA) | 5173 | allservicesapp.in |
| `agent/` | Partner app | 5174 | partner.allservicesapp.in |
| `admin/` | Franchise admin app (one town) | 5175 | admin.allservicesapp.in |
| `superadmin/` | HQ app (all towns) | 5176 | hq.allservicesapp.in |
| `server/` | Express API + `db/` (SQL + setup) | 5000 | behind Nginx |
| `deploy/` | docker-compose (project name `allservices`), host Nginx, backup script | | VM, `/opt/allservices` |

The four apps share many files (login, `api.js`, `i18n.js`, `i18n-dict.js`, `AlertsCard.jsx`, order cards).
**A fix in a shared file must be copied to every app that has it** (each app also has its own `i18n-dict.js`).
With built apps (`npm run build` in each), `npm start` in `server/` serves them on 5000–5003.

## How the system works (key ideas)

- **Database setup:** `npm run db:setup` (`server/db/setup.js`) re-applies every `*.sql` file (all idempotent,
  `CREATE OR REPLACE`) and runs **one-time data migrations keyed in `site_settings`** (e.g. `vegetables_v5`,
  `kirana_new_items_v2`, `remain_items_v1`). A new catalog change = a new key; never edit an old migration's data
  in place. Order of SQL files matters (later files redefine earlier functions) — never run a single `.sql` alone
  on a real database, always the whole `db:setup`. Schema is `all_services`.
- **Towns (franchises):** the delivery location picks the franchise; orders, partners, stock and reports stay in
  their town. HQ requests send `X-Franchise`; routes read the scope from `req.scope`.
- **Order routing:** `orders.skill_code` = the agent type. One shop's items → that shop's type (food shops →
  `delivery`); mixed cart → `delivery`; water cans alone and Village Needs → `our_service_employees`; Instant
  Delivery → `instant`; bookings → the service's `skill_code`. `fn_agent_may_take` (same town, subscription, car
  model) and `fn_agent_in_zone` (25 km range) decide who sees an order. One "now" order per partner
  (`agent_max_active_orders`); the queue + honest waiting note is `partner_wait.sql` (`fn_order_wait`).
- **Money:** delivery fee per service; first delivery free per mobile number (`fn_place_order` takes an advisory
  lock per phone so parallel taps can't get two); partner pay `agent_pay_per_order` (₹25) for delivery orders only.
  Reports (`reports.sql`) are computed from orders, so franchise and HQ numbers always agree.
- **Catalog:** product lists with photo files live in `server/db/*-photos.js`, `vegetables.js`, `kirana-photos.js`
  (photos in `<app>/public/products/<folder>/<file>.jpg`, copied to user, admin and superadmin). Pack sizes are
  separate products linked by `pack_group` (`packs.sql`: `fn_add_pack_size`, sync/relink triggers).
- **Translations:** `i18n-dict.js` maps the exact English text node → [Telugu, Hindi]; `PATTERNS` handle text with
  numbers. Text split by `<b>` tags can't be matched — write whole sentences as one string.
- Car Rental by model (`car_rental.sql`), Share Ride seats (`share_ride.sql`), Village Needs (`village.sql`),
  meals and cooks (`homefood.sql`), demand report (`demand.sql`), shop offers (`offers.sql`), goods transport
  (`transport.sql`), stock per town (`stock.sql`), overdue orders (`overdue.sql`).

## Testing (on the PC)

- Start the API with SMS in test mode: run it with `SMS_2FACTOR_API_KEY` set to empty (OTP codes are then
  returned as `devCode` / shown on screen). Restart the API after any server change.
- Tests are Node scripts calling the real API (and puppeteer-core with the installed Chrome for screens).
  Staff test logins are created by the test helper (`zt_admin`, `zt_admin_ar`, `zt_super`); test customers and
  partners use `zt_` usernames; a clean-up script deletes everything owned by `zt_` users afterwards.
- Pre-launch results (Oct–Nov 2026): 1,226 orders delivered across both towns, a 1,000-order burst, all reports
  matched to the rupee; regression suites for every module pass.
- Gotchas: `users.username` is max 30 characters; the Windows PC refuses ~200+ brand-new connections at the same
  instant (a test-machine limit — send bursts through ≤300 open requests); a first-visit guest sees the location box,
  which swallows the first tap; shell `sed`/`node -e` can eat regex backslashes — use `[.]`, `[0-9]` or the Edit tool.

## Deploy (live VM)

```bash
cd /opt/allservices/deploy
docker compose exec -T db pg_dump -U all_services_user -Fc all_services > ~/before_update.dump   # backup first (-T!)
cd /opt/allservices && git pull
cd deploy && docker compose up -d --build
docker compose exec server npm run db:setup        # needed whenever server/db changed
```
