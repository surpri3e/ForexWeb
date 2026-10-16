import express from 'express';
import crypto from 'crypto';
import { sql } from '../lib/db.js';

const router = express.Router();

// --- Admin key check (server-side only, key lives in process.env.ADMIN_KEY) ---
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

// Simple in-memory brute-force limiter: 10 failed attempts / 15 min / IP
const fails = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX_FAILS = 10;

function blocked(ip) {
  const r = fails.get(ip);
  if (!r) return false;
  if (Date.now() - r.t > WINDOW) { fails.delete(ip); return false; }
  return r.n >= MAX_FAILS;
}
function addFail(ip) {
  const r = fails.get(ip);
  if (!r || Date.now() - r.t > WINDOW) fails.set(ip, { n: 1, t: Date.now() });
  else r.n++;
}

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_KEY;
  if (!expected) return res.status(503).json({ error: 'admin_disabled' });

  const ip = req.ip || 'unknown';
  if (blocked(ip)) return res.status(429).json({ error: 'too_many' });

  const given = req.get('X-Admin-Key') || '';
  const ok = crypto.timingSafeEqual(sha(given), sha(expected));
  if (!ok) {
    addFail(ip);
    return res.status(403).json({ error: 'forbidden' });
  }
  fails.delete(ip);
  next();
}

router.use(requireAdmin);

router.get('/stats', async (req, res) => {
  try {
    const [r] = await sql`
      SELECT
        (SELECT COUNT(*) FROM users)::int AS users,
        (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '24 hours')::int AS new24h,
        (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '7 days')::int AS new7d,
        (SELECT COUNT(*) FROM users WHERE last_login > NOW() - INTERVAL '7 days')::int AS active7d,
        (SELECT COUNT(*) FROM backups)::int AS "withBackup"`;
    res.json(r);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

router.get('/users', async (req, res) => {
  try {
    // password_hash is never selected
    const rows = await sql`
      SELECT email, created_at, last_login
      FROM users
      ORDER BY created_at DESC
      LIMIT 500`;
    const sec = (d) => (d ? Math.floor(new Date(d).getTime() / 1000) : 0);
    res.json({
      users: rows.map((u) => ({
        email: u.email,
        created_at: sec(u.created_at),
        last_login: sec(u.last_login)
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

export default router;
