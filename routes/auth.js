import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sql, getAuth } from '../lib/db.js';
import { rateLimit } from '../lib/limit.js';

const router = express.Router();
const DUMMY_HASH = bcrypt.hashSync('timing-dummy', 10); // equalizes timing when the email does not exist
const sign = (uid) => jwt.sign({ uid }, process.env.JWT_SECRET, { expiresIn: '30d', algorithm: 'HS256' });
const normEmail = (e) => String(e ?? '').trim().toLowerCase();

// 10 attempts / 15 min per IP+email (per-IP only would punish shared mobile/ISP addresses)
const perEmail = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: (req) => req.ip + ':' + normEmail(req.body && req.body.email)
});

router.post('/register', perEmail, async (req, res) => {
  const email = normEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  if (!email || typeof password !== 'string' || !password) return res.status(400).json({ error: 'missing' });
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'bad_email' });
  // bcrypt only uses the first 72 bytes, so longer passwords are rejected instead of silently truncated
  if (password.length < 8 || Buffer.byteLength(password) > 72)
    return res.status(400).json({ error: 'weak_password' });

  try {
    const exists = await sql`SELECT id FROM users WHERE LOWER(email)=${email} LIMIT 1`;
    if (exists.length) return res.status(409).json({ error: 'exists' });

    const hash = await bcrypt.hash(password, 10);
    const [u] = await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${email}, ${hash})
      RETURNING id, email`;

    res.json({ token: sign(u.id), email: u.email });
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: 'exists' }); // simultaneous register
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

router.post('/login', perEmail, async (req, res) => {
  const email = normEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  if (!email || typeof password !== 'string' || !password) return res.status(400).json({ error: 'missing' });
  if (Buffer.byteLength(password) > 1024) return res.status(401).json({ error: 'invalid' });

  try {
    // LOWER() keeps older accounts that were saved with capital letters working
    const [u] = await sql`SELECT * FROM users WHERE LOWER(email)=${email} ORDER BY id LIMIT 1`;
    const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
    if (!u || !ok) return res.status(401).json({ error: 'invalid' });

    await sql`UPDATE users SET last_login=NOW() WHERE id=${u.id}`;
    res.json({ token: sign(u.id), email: u.email });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

router.post('/logout', (req, res) => res.json({ ok: true }));

// Delete own account (frontend: POST /api/auth/delete {password}); backups cascade
router.post('/delete', async (req, res) => {
  let user;
  try { user = getAuth(req); }
  catch { return res.status(401).json({ error: 'unauthorized' }); }

  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'missing' });

  try {
    const [u] = await sql`SELECT id, password_hash FROM users WHERE id=${user.uid}`;
    if (!u) return res.status(401).json({ error: 'unauthorized' });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid' });
    await sql`DELETE FROM users WHERE id=${u.id}`;
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

export default router;
