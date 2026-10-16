import express from 'express';
import { sql, getAuth } from '../lib/db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  let user;
  try { user = getAuth(req); }
  catch { return res.status(401).json({ error: 'unauthorized' }); }

  try {
    const rows = await sql`SELECT data, updated_at FROM backups WHERE user_id=${user.uid}`;
    if (!rows.length) return res.status(404).json({ error: 'none' });
    res.json({
      data: JSON.stringify(rows[0].data),
      backupAt: Math.floor(new Date(rows[0].updated_at).getTime() / 1000)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

router.put('/', async (req, res) => {
  let user;
  try { user = getAuth(req); }
  catch { return res.status(401).json({ error: 'unauthorized' }); }

  const { data } = req.body || {};
  if (typeof data !== 'string') return res.status(400).json({ error: 'bad_size' });
  if (data.length > 4_500_000) return res.status(400).json({ error: 'bad_size' });

  try {
    const parsed = JSON.parse(data);
    await sql`
      INSERT INTO backups (user_id, data, updated_at)
      VALUES (${user.uid}, ${JSON.stringify(parsed)}::jsonb, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`;
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

export default router;
