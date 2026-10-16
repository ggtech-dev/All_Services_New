import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// Admins and the Super Admin. Sets req.scope = the franchise this request works on:
//   franchise admin → always their own franchise · Super Admin → the one chosen in the app (X-Franchise header), or null = all.
export async function requireStaff(req, res, next) {
  try {
    const { query } = await import('../db.js');
    const { rows } = await query(
      `SELECT u.role, u.franchise_id, u.is_active, f.status AS franchise_status FROM users u
         LEFT JOIN franchises f ON f.id = u.franchise_id WHERE u.id = $1`,
      [req.user?.id]
    );
    const u = rows[0];
    if (!u || !u.is_active || !['admin', 'superadmin'].includes(u.role)) return res.status(403).json({ error: 'Forbidden' });
    if (u.role === 'admin') {
      if (!u.franchise_id) return res.status(403).json({ error: 'This admin account is not linked to a franchise' });
      if (u.franchise_status === 'suspended') return res.status(403).json({ error: 'Your franchise is suspended. Please contact the Super Admin.' });
      req.scope = u.franchise_id;
    } else {
      const h = String(req.get('x-franchise') || '');
      req.scope = /^\d{1,9}$/.test(h) ? Number(h) : null;
    }
    req.isSuper = u.role === 'superadmin';
    next();
  } catch (err) {
    next(err);
  }
}

// Only the Super Admin (after requireStaff).
export function requireSuper(req, res, next) {
  if (!req.isSuper) return res.status(403).json({ error: 'Only the Super Admin can do this' });
  next();
}
