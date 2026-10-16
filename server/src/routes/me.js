import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

// The logged-in customer's own things: complaints ("Report a problem").
const router = Router();
router.use(requireAuth);
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.get('/complaints', h(async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.order_id, c.subject, c.message, c.status, c.reply, c.created_at, c.replied_at
       FROM complaints c WHERE c.customer_id = $1 ORDER BY c.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json(rows);
}));

// body: { order_id?, subject, message }
router.post('/complaints', h(async (req, res) => {
  const b = req.body || {};
  const orderId = /^\d{1,9}$/.test(String(b.order_id ?? '')) ? Number(b.order_id) : null;
  const { rows } = await query('SELECT * FROM fn_create_complaint($1,$2,$3,$4)', [
    req.user.id, orderId, typeof b.subject === 'string' ? b.subject : null, typeof b.message === 'string' ? b.message : null,
  ]);
  res.status(201).json(rows[0]);
}));

export default router;
