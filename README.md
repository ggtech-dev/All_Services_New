# All Services by GGTech

A local services app for Telangana, launching in **Siddipet**. Customers order daily essentials (vegetables, milk, meat, kirana, pooja items), book services (plumber, electrician, AC, cleaning, vehicle, beauty, events, car booking) and track them live. Partners (agents) take the orders, each city is run by a **franchise admin**, and **HQ (Super Admin)** runs the platform.

**Stack:** React (Vite) PWA apps · Node.js (Express) API · PostgreSQL (business rules in SQL functions)

## Repository layout

Four **fully separate apps** — each has its own code, build and Docker image, and is hosted on its own address — plus one API and one database that all four use.

```
All_Services_New/
├── user/         👤 Customer app        (Play Store app)        dev :5173 · allservicesggtech.com
├── agent/        🛵 Agent / partner app                         dev :5174 · partner.allservicesggtech.com
├── admin/        🛡️ Franchise admin app (one city)              dev :5175 · admin.allservicesggtech.com
├── superadmin/   👑 Super Admin (HQ) app (all cities)           dev :5176 · hq.allservicesggtech.com
├── server/       API (Express) + database setup (db/*.sql)      :5000
└── deploy/       docker-compose.yml, Nginx for the domains, daily backup script
```

Each app folder: `src/` (only the pages and parts that app uses), `public/` (icons, push worker), `vite.config.js`,
`Dockerfile` + `nginx.conf` (serves the built app and forwards `/api` and `/uploads` to the API).

> The four apps started as one code base, so they share the same building blocks (login, API calls, Telugu,
> order cards). A fix in one of those files must be copied to the other app folders that have the same file.

## Run on a computer (development)

Needs **Node.js 22+** and **PostgreSQL 16+**.

1. **Database** (once):
   ```sql
   CREATE DATABASE all_services;
   CREATE USER all_services_user WITH PASSWORD '<password>';
   GRANT ALL ON DATABASE all_services TO all_services_user;
   ```
2. **API**
   ```bash
   cd server
   npm ci
   cp .env.example .env        # fill in PGPASSWORD, JWT_SECRET (and email / SMS keys when you have them)
   npm run db:setup            # tables, functions, catalog, staff accounts — safe to run again after updates
   npm start                   # http://localhost:5000
   ```
3. **Apps** — each in its own terminal, as needed:
   ```bash
   cd user && npm ci && npm run dev          # http://localhost:5173
   cd agent && npm ci && npm run dev         # http://localhost:5174
   cd admin && npm ci && npm run dev         # http://localhost:5175
   cd superadmin && npm ci && npm run dev    # http://localhost:5176
   ```
   The dev servers forward `/api` and `/uploads` to the API on :5000.

   **Or production-like on one machine:** run `npm run build` in each app folder; then `npm start` in `server/`
   serves the four built apps itself on **5000 (user) · 5001 (agent) · 5002 (admin) · 5003 (HQ)**.

## Deploy on a new machine (Docker)

On an Ubuntu server with Docker, Docker Compose and Nginx installed:

```bash
git clone https://github.com/ggtech-dev/All_Services_New.git
cd All_Services_New/deploy
cp .env.example .env                      # fill EVERY value (strong passwords, JWT secret, SMTP, 2Factor)
docker compose up -d --build              # PostgreSQL + API + the four apps
docker compose exec server npm run db:setup   # first time only (and after updates that change db/*.sql)
```

The four apps now answer on `127.0.0.1:8081` (user) · `8082` (agent) · `8083` (admin) · `8084` (HQ).
Point the domains at the server's IP (DNS **A** records), then put the machine's Nginx in front with HTTPS:

```bash
sudo cp nginx-host.conf /etc/nginx/sites-available/allservices
sudo ln -s /etc/nginx/sites-available/allservices /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d allservicesggtech.com -d partner.allservicesggtech.com -d admin.allservicesggtech.com -d hq.allservicesggtech.com
```

**Updates later:** `git pull && cd deploy && docker compose up -d --build && docker compose exec server npm run db:setup`

**Backups:** `deploy/backup.sh` saves the database and uploaded files every night (add it to cron) and keeps 14 days —
also copy them off the machine.

### Moving the current data (orders, customers, agents, catalog) to the new machine

On the current computer:
```bash
pg_dump -h localhost -U all_services_user -d all_services -Fc -f all_services.dump
```
Copy `all_services.dump` and the `server/uploads` and `server/private_uploads` folders to the new machine, then:
```bash
cd All_Services_New/deploy
docker compose up -d db
docker compose cp ../all_services.dump db:/tmp/all_services.dump
docker compose exec db pg_restore -U all_services_user -d all_services --no-owner --role=all_services_user /tmp/all_services.dump
docker compose up -d --build
docker compose cp ../uploads/. server:/app/uploads/
docker compose cp ../private_uploads/. server:/app/private_uploads/
```
Database dumps and uploads contain customer data — never put them in git.

## Settings (`server/.env`, or `deploy/.env` with Docker)

| Setting | What it is |
|---|---|
| `PGHOST` `PGPORT` `PGDATABASE` `PGUSER` `PGPASSWORD` `DB_SCHEMA` | Database connection (tables live in schema `all_services`) |
| `JWT_SECRET` | Long random string that signs logins |
| `NODE_ENV=production` | On live servers: test codes are never shown on screen |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | Email for sign-up / email login / forgot password codes (empty = test mode) |
| `SMS_2FACTOR_API_KEY` `SMS_2FACTOR_TEMPLATE` | Mobile OTP SMS via 2Factor.in (empty key = test mode); template = approved DLT template |
| `ADMIN_PASSWORD` `SUPERADMIN_PASSWORD` | Only for the first `db:setup` that creates the staff accounts |

**Never commit `.env` files, database dumps or the uploads folders** — `.gitignore` keeps them out.

## Who uses what

| App | Who | Main pages |
|---|---|---|
| user | Customers | Home, categories, shops (pick items / write your list / photo), booking forms (events, car, …), checkout, live order tracking, ratings, complaints, account, Telugu |
| agent | Delivery partners & service partners | Go online, orders near you, accept, shop bill, pick up, collect charge, deliver, wallet, subscriptions, apply to join |
| admin | Franchise admin (one city) | Orders & bookings, agents (approve, types), live map, complaints, ratings, subscriptions (fees, members), services in the city, requests to HQ, areas, shops, notifications, reports, activity |
| superadmin | HQ | Dashboard, franchises (add, status, ledger, documents), platform reports, master catalog (categories, services, products, prices, delivery charges, promotions), requests from franchises, users, admins, settings; every city's operations (view) |

Mobile number login uses our own OTP codes (`server/db/phone_otp.sql`) sent by 2Factor; email codes and passwords also work.
