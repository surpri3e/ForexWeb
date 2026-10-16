import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sql, getAuth } from '../lib/db.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'bad_email' });
  if (password.length < 8) return res.status(400).json({ error: 'weak_password' });

  try {
    const exists = await sql`SELECT id FROM users WHERE email=${email}`;
    if (exists.length) return res.status(409).json({ error: 'exists' });

    const hash = await bcrypt.hash(password, 10);
    const [u] = await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${email}, ${hash})
      RETURNING id, email`;

    const token = jwt.sign({ uid: u.id }, process.env.JWT_SECRET, { expiresIn: '90d' });
    res.json({ token, email: u.email });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'missing' });

  try {
    const [u] = await sql`SELECT * FROM users WHERE email=${email}`;
    if (!u) return res.status(401).json({ error: 'invalid' });

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid' });

    await sql`UPDATE users SET last_login=NOW() WHERE id=${u.id}`;
    const token = jwt.sign({ uid: u.id }, process.env.JWT_SECRET, { expiresIn: '90d' });
    res.json({ token, email: u.email });
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
  if (!password) return res.status(400).json({ error: 'missing' });

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
