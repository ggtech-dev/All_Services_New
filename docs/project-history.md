# All Services — project history and decisions

Why things are the way they are. Read with [CLAUDE.md](../CLAUDE.md) (rules and how the system works) and the
[README](../README.md) (setup and deploy). Dates are 2026. No passwords or customer data belong in this file.

## Owner's decisions (keep them)

- **Launch towns:** Siddipet first ("after success, next locations"), then Armoor. Hyderabad areas were switched
  off; don't bring Hyderabad defaults back.
- **Franchise model:** one franchise (dealer) per town, run by its franchise admin; HQ (Super Admin) runs the platform
  and is mostly view-only in towns. Commission with franchises is entered by hand in HQ's ledger (no automatic
  calculation). Subscriptions for partners are run by each franchise admin with per-town terms.
- **No product prices:** we charge only delivery; the customer pays the real shop bill ("Market price"). The only
  fixed prices: water can ₹25 (delivery included), delivery charges, cook per hour, meal plates, village charges.
- **Delivery charge per service**, paid to the company UPI or in cash at the door; the partner marks which before
  "Delivered". First delivery free per mobile number. Distance-based charges: later, when the app grows.
- **Own photos only:** the owner makes AI photos from prompts. Wikimedia / Openverse / retailer photos were all
  replaced (Oct 25); a Credits page is no longer needed. Remove the small "AI" corner badge before using a photo.
- **Login:** phone first. Customers: Sign in = mobile + password (OTP link as an option), Sign up = mobile → OTP →
  name + password, forgot password by OTP. Partners: mobile OTP or password. Admins: password only. Email login was
  removed. Firebase phone auth was tried and **removed at the owner's request** — don't suggest it again.
- **SMS:** our own OTP codes sent through 2Factor.in. Until the DLT template (header GGTECH) is approved, OTPs arrive
  as a voice call; then set the template in `.env`. Keep the password login until then.
- **Four separate apps** (user, agent, admin, superadmin), each its own folder, build and address — chosen over one
  shared app. Shared-file fixes must be copied to each.
- **Keep it free** where possible (Leaflet + OpenStreetMap maps, Web Push alerts) unless the owner agrees to pay.
- **Health** services stay off until a later release (Play Store review). Goods Transportation is the last category
  (17 in the system).
- Digital Services show no company name ("until the app grows"). Help buttons show no phone number text.

## Timeline

| When | What |
|---|---|
| Sep 28 | Start: login, categories and services, orders with COD and OTP, delivery agents (apply with Aadhaar / PAN / licence → approval), agent types and routing by `skill_code` |
| Sep 29–30 | Home services merged into one type, live GPS tracking, email OTP (later removed), Siddipet-only launch, delivery charge per service, Daily Fresh (vegetables, meat, milk) |
| Oct 1 | Kirana with own list / list photo / preferred shop, Pooja Store, subscription-only services, Web Push alerts, ratings |
| Oct 2 | Instant Delivery (other shops' items, instant partners), franchise model (HQ + towns), four apps |
| Oct 2–3 | Events, Car Booking, Health (later hidden) |
| Oct 4 | Mobile OTP login with 2Factor; Play Store plan (privacy policy, terms, account deletion, TWA) |
| Oct 16 | New repo All_Services_New, Docker deploy, domain **allservicesapp.in** (+ partner., admin., hq.), **live** on a Vultr VM in Mumbai |
| Oct 17 | Phone-first login, services cleanup (water can = our own staff), Everyday Home Services "price on discussion" |
| Oct 19–20 | Village Needs (villages, next-day slots, near/far charge), Share Ride (car owners, seat maps, PDF tickets), Shop For Me, Daily Workers, Digital Services |
| Oct 22 | New home page, "Deliver to" location bar, new AS logo, HQ Report Center, location-based routing |
| Oct 23–26 | Saved addresses, Notify me waitlist, Telugu search, Book Your Cook, Tomorrow's food, out-of-stock per town, own photos for every shop, Offers Near You, Goods Transportation, Armoor franchise, pack sizes, Car Rental by model |
| Oct 27–28 | Demand report (what customers search for), more vegetables, Kirana brands, 25 kg rice, cold drinks, Sweet Shop |
| Oct 30 | **Pre-launch load test** (1,226 orders, both towns, every service): found and fixed the free-delivery race (3 quick taps → 3 free deliveries), rush tuning (20 DB connections, faster partner order list), fair queue; added honest waiting ("all partners busy", place in line) |
| Nov 2 | Complete guides (English + Telugu), franchise presentations (English + Telugu) with real screenshots |
| Nov 3 | Instant Delivery tested end to end, Telugu notification hint, 5 more products, CLAUDE.md, this history, tests/ in the repo |

## Incidents and lessons

- **Oct 1:** a browser test clicked the first order card and accepted two real orders; the clean-up then deleted
  them (restored from backup). Since then tests act only on their own order ids, and clean-up deletes only orders
  whose **customer** is a `zt_` user. Real orders can be waiting at any time — never assume an empty queue.
- **Oct 20 / 22:** the live database was replaced with the PC copy on the owner's request (no real customers yet).
  From Oct 16 the **server database is the live one**; the PC copy is for testing.
- **Oct 30:** load testing found the two real bugs above; both fixed and retested. Old tests that failed afterwards
  were out of date (app features had changed), not app bugs.
- Scripted file edits can eat backslashes (`\b`, `\d`) and `$$`/`$'` in replacements — use the Edit tool, `[0-9]`,
  `[.]`, or split/join.
- Windows Smart App Control blocks rollup's native module (apps use `@rollup/wasm-node`); long-running servers are
  started with PowerShell `Start-Process`; `node --watch` restarted the API by itself, so tests use `npm start`.
- Chrome refuses Web Push in private browser contexts — push tests use the default context.

## Open items (as of Nov 3)

- 2Factor DLT template approval → real SMS OTPs (then the password login can be reviewed).
- Comb photo for Kirana (file was missing); Events photos could be redone at higher resolution.
- Play Store release (TWA wrapper, store listing).
- Change franchise admin passwords before real customers; consider making the GitHub repo private.
