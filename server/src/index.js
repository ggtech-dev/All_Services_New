import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pool } from './db.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import adminRoutes, { UPLOAD_DIR } from './routes/admin.js';
import adminOpsRoutes from './routes/adminOps.js';
import orderRoutes from './routes/orders.js';
import promotionRoutes from './routes/promotions.js';
import agentRoutes, { applyRouter } from './routes/agent.js';
import { pushRouter } from './push.js';
import superRoutes from './routes/super.js';
import shareRideRoutes, { carsRouter } from './routes/shareRide.js';
import offerRoutes from './routes/offers.js';
import transportRoutes from './routes/transport.js';
import { digital as digitalRoutes, workers as workerRoutes } from './routes/moreServices.js';
import franchiseRoutes from './routes/franchise.js';
import meRoutes from './routes/me.js';

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch {
    res.status(500).json({ ok: false, db: 'down' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminOpsRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/promotions', promotionRoutes);
app.use('/api/agents', applyRouter);
app.use('/api/agent', agentRoutes);
app.use('/api/push', pushRouter);
app.use('/api/super', superRoutes); // Super Admin (HQ)
app.use('/api/franchise', franchiseRoutes); // franchise admin pages
app.use('/api/me', meRoutes); // customer: complaints
app.use('/api/workers', workerRoutes); // 👷 Daily Workers directory (+ /admin)
app.use('/api/digital', digitalRoutes); // 💡 Digital Services requests (+ /admin: HQ only)
app.use('/api/share-ride', shareRideRoutes); // 🚗 Share Ride: search, seats, tickets · /owner · /admin
app.use('/api/cars', carsRouter); // 🚗 my cars: Share Ride owners and Car Rental partners (approved by the franchise admin)
app.use('/api/offers', offerRoutes); // 📢 Offers near you: local shops' offers (shop asks · franchise checks · HQ approves)
app.use('/api/transport', transportRoutes); // 🚚 Goods Transportation: goods vehicles, customers call the owner
app.use('/api', catalogRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- the websites ----------
// Four separate apps (folders user/, agent/, admin/, superadmin/ — each: npm run build → dist/), all using this one API.
// If their builds are found next to this server, it serves them too (handy on one machine and for testing):
//   user → PORT (5000) · agent → PORT+1 · franchise admin → PORT+2 · Super Admin (HQ) → PORT+3
// In production Nginx serves each app's dist/ on its own domain and forwards /api and /uploads here (deploy/).
// With no builds found, only the API runs on PORT.
// Hashed files are cached for a year; index.html, the service worker and the manifest are always re-checked so a
// new version reaches everyone on their next visit.
const APPS_DIR = path.resolve(import.meta.dirname, '../..'); // the repository root: user/, agent/, admin/, superadmin/
const SITES = [['user', 0], ['agent', 1], ['admin', 2], ['superadmin', 3]];

// PostgreSQL errors raised by our functions/procedures carry user-facing messages.
const PG_STATUS = { '22023': 400, '22P02': 400, '22007': 400, '22008': 400, P0002: 404, '55000': 409, '23505': 409, '23503': 409 };

function website(dir) {
  const site = express();
  site.disable('x-powered-by');
  site.use(app); // the API and uploaded photos
  if (dir) {
    site.use(express.static(dir, {
      index: false,
      setHeaders: (res, file) => {
        if (/[\\/]assets[\\/]/.test(file)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
        else res.set('Cache-Control', 'no-cache');
      },
    }));
    // any other page (/orders/12, /agent…) is the single-page app — but not file addresses (anything with a dot,
    // e.g. /private_uploads/x.jpg or a missing script): those get a plain 404
    site.get(/^\/(?!api\/|uploads\/|private_uploads)[^.]*$/, (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(dir, 'index.html'));
    });
  }
  site.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  site.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Each file must be 5 MB or smaller' });
    if (err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Unexpected file field' });
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (PG_STATUS[err.code]) {
      const messages = {
        '22P02': 'Invalid value',
        '22007': 'Invalid date',
        '22008': 'Invalid date',
        '23505': 'That name is already in use',
        '23503': 'This item is in use and cannot be deleted',
      };
      return res.status(PG_STATUS[err.code]).json({ error: messages[err.code] || err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return site;
}

const port = Number(process.env.PORT || 5000);
const built = SITES.filter(([name]) => existsSync(path.join(APPS_DIR, name, 'dist', 'index.html')));
if (built.length) {
  for (const [name, offset] of built) {
    website(path.join(APPS_DIR, name, 'dist')).listen(port + offset, () =>
      console.log(`All Services ${name.padEnd(10)} app → http://localhost:${port + offset}`));
  }
} else {
  website(null).listen(port, () => console.log(`All Services API running on http://localhost:${port}`));
}
