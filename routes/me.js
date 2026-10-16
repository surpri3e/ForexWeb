import express from 'express';
import { sql, getAuth } from '../lib/db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  let user;
  try { user = getAuth(req); }
  catch { return res.status(401).json({ error: 'unauthorized' }); }

  try {
    const [u] = await sql`SELECT id, email, created_at FROM users WHERE id=${user.uid}`;
    if (!u) return res.status(401).json({ error: 'unauthorized' });

    const [b] = await sql`SELECT updated_at FROM backups WHERE user_id=${u.id}`;
    const backupAt = b ? Math.floor(new Date(b.updated_at).getTime() / 1000) : 0;

    res.json({ id: u.id, email: u.email, backupAt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

export default router;
