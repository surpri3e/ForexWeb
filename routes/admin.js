import express from 'express';
import crypto from 'crypto';
import { sql } from '../lib/db.js';

if (process.env.ADMIN_KEY && process.env.ADMIN_KEY.length < 24) console.warn('ADMIN_KEY is short; use 32+ random characters');
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
  if (blocked(ip)) return res.status(429).json({ error: 'rate_limited' });

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

// ---------- messages to users ----------
const KINDS = new Set(['info', 'warn', 'promo']);
const AUDS = new Set(['all', 'user', 'active7', 'nobackup']);
const sec = (d) => (d ? Math.floor(new Date(d).getTime() / 1000) : 0);

router.get('/messages', async (req, res) => {
  try {
    const rows = await sql`
      SELECT m.id, m.title, m.body, m.kind, m.audience, m.target_email, m.popup, m.created_at, m.expires_at,
             COUNT(r.user_id)::int AS total, COUNT(r.read_at)::int AS reads
      FROM messages m LEFT JOIN message_recipients r ON r.message_id = m.id
      GROUP BY m.id ORDER BY m.id DESC LIMIT 50`;
    res.json({ messages: rows.map((m) => ({ id: m.id, title: m.title || '', body: m.body, kind: m.kind, audience: m.audience, target: m.target_email || '', popup: !!m.popup, created_at: sec(m.created_at), expires_at: sec(m.expires_at), total: m.total, reads: m.reads })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

router.post('/messages', async (req, res) => {
  const b = req.body || {};
  const body = String(b.body || '').trim();
  const title = String(b.title || '').trim().slice(0, 80);
  const kind = KINDS.has(b.kind) ? b.kind : 'info';
  if (!AUDS.has(b.audience)) return res.status(400).json({ error: 'bad_audience' });
  const audience = b.audience;
  const popup = !!b.popup;
  const hours = Math.min(24 * 365, Math.max(0, parseInt(b.expiresHours, 10) || 0));
  if (!body || body.length > 600) return res.status(400).json({ error: 'bad_body' });

  try {
    let email = null;
    if (audience === 'user') {
      email = String(b.email || '').trim().toLowerCase();
      const u = await sql`SELECT id FROM users WHERE LOWER(email) = ${email} LIMIT 1`;
      if (!u.length) return res.status(404).json({ error: 'no_user' });
    }
    const [m] = await sql`
      INSERT INTO messages (title, body, kind, audience, target_email, popup, expires_at)
      VALUES (${title || null}, ${body}, ${kind}, ${audience}, ${email}, ${popup},
              ${hours ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : null})
      RETURNING id`;
    const id = m.id;
    if (audience === 'user') await sql`INSERT INTO message_recipients (message_id, user_id) SELECT ${id}, id FROM users WHERE LOWER(email) = ${email}`;
    else if (audience === 'active7') await sql`INSERT INTO message_recipients (message_id, user_id) SELECT ${id}, id FROM users WHERE last_login > NOW() - INTERVAL '7 days'`;
    else if (audience === 'nobackup') await sql`INSERT INTO message_recipients (message_id, user_id) SELECT ${id}, u.id FROM users u WHERE NOT EXISTS (SELECT 1 FROM backups k WHERE k.user_id = u.id)`;
    else await sql`INSERT INTO message_recipients (message_id, user_id) SELECT ${id}, id FROM users`;
    const [c] = await sql`SELECT COUNT(*)::int AS n FROM message_recipients WHERE message_id = ${id}`;
    if (!c.n) { await sql`DELETE FROM messages WHERE id = ${id}`; return res.status(400).json({ error: 'no_recipients' }); }
    res.json({ id, recipients: c.n });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

router.delete('/messages/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  try {
    await sql`DELETE FROM messages WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

export default router;
