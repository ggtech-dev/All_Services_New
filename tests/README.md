# Tests

Node scripts that test All Services through the real API and the real screens. **Run them on a PC against a
local copy of the database, never against the live server.** Every person they create has a username starting
`zt_`, and `cleanup.mjs` removes all of it afterwards (orders, users, test documents).

## Setup (once per laptop)

1. The project runs locally (see the main [README](../README.md)), Google Chrome is installed.
2. `cd tests && npm install`
3. Set these in the terminal before running tests (PowerShell shown; values are never committed):
   ```powershell
   $env:TEST_DATABASE_URL = "postgres://all_services_user:<local db password>@localhost:5432/all_services"
   $env:TEST_STAFF_PW = "<any password for the temporary zt_ staff logins>"
   $env:TEST_USER_PW  = "<password of the local demo customers user1–user20 and test customers>"
   # optional: $env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
   ```
4. Start the API in **SMS test mode** (OTP codes come back on screen, no real SMS):
   `node tests/api_testmode.mjs` (from the project folder). Restart it after any server change.
   Browser tests on ports 5173–5176 need `npm run dev` in each app; tests on 5000–5003 use the built apps.

## Run

```powershell
cd tests
node cleanup.mjs          # start clean
node e2e_api.mjs          # any test file
node cleanup.mjs          # always clean up after
```

## What is here

| File | Tests |
|---|---|
| `load_test.mjs` | Full pre-launch test, both towns: 100 customers + 3 partners of every type per town, every service ordered at once, routing, delivery, every report checked |
| `wave2.mjs` | After `load_test.mjs`: queue + honest waiting, paid fees, cancel, give back, car models, ratings, 1,000-order burst |
| `api_instant.mjs` | Instant Delivery end to end |
| `e2e_api.mjs` | Every module through the API |
| `flow_*.mjs` | Login, Village Needs + Share Ride, Shop For Me / Workers / Digital, water + home services, location rules, popular cards, 4-app order lifecycle (browser), events, guest browsing |
| `api_*.mjs` | Stock per town, home food, shop offers, goods transport, waitlist, car models |
| `city_isolation.mjs`, `armoor_check.mjs` | Each town sees only its own data |
| `pack_sql_test.mjs`, `chk_ist_today.mjs` | Pack-size SQL rules; "today" in India time |
| `ui_*.mjs`, `pwa_check.mjs`, `crawl_all.mjs` | Screens on Android, Samsung, iPhone and laptop; PWA install/offline; every page crawled |
| `deck_shots.mjs`, `names.cjs` | Screenshots for presentations (after `load_test.mjs`; `names.cjs` gives test people local names) |
| `sim_all.mjs`, `sim_reset.mjs`, `share_ride_demo.mjs`, `setup_armoor.mjs` | Local demo data (`share_ride_demo.mjs` needs `$env:DEMO_PW`) |
| `testadmin.mjs`, `test_helpers.mjs`, `geo_browser.mjs`, `sql.cjs`, `api_testmode.mjs` | Shared helpers |
