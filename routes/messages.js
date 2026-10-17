import express from 'express';
import { sql, getAuth } from '../lib/db.js';
import { rateLimit } from '../lib/limit.js';

const router = express.Router();
router.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

function auth(req, res, next) {
  try { req.user = getAuth(req); next(); }
  catch { res.status(401).json({ error: 'unauthorized' }); }
}
router.use(auth);

const sec = (d) => (d ? Math.floor(new Date(d).getTime() / 1000) : 0);

// Inbox of the logged-in user (unread count is exact, the list is the latest 50)
router.get('/', async (req, res) => {
  try {
    const uid = req.user.uid;
    const rows = await sql`
      SELECT m.id, m.title, m.body, m.kind, m.popup, m.created_at, r.read_at
      FROM message_recipients r JOIN messages m ON m.id = r.message_id
      WHERE r.user_id = ${uid} AND (m.expires_at IS NULL OR m.expires_at > NOW())
      ORDER BY m.id DESC LIMIT 50`;
    const [c] = await sql`
      SELECT COUNT(*)::int AS n
      FROM message_recipients r JOIN messages m ON m.id = r.message_id
      WHERE r.user_id = ${uid} AND r.read_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > NOW())`;
    res.json({
      unread: c.n,
      items: rows.map((m) => ({ id: m.id, title: m.title || '', body: m.body, kind: m.kind, popup: !!m.popup, created_at: sec(m.created_at), read: !!m.read_at }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

router.post('/read-all', async (req, res) => {
  try {
    await sql`UPDATE message_recipients SET read_at = NOW() WHERE user_id = ${req.user.uid} AND read_at IS NULL`;
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

router.post('/:id/read', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  try {
    await sql`UPDATE message_recipients SET read_at = NOW() WHERE message_id = ${id} AND user_id = ${req.user.uid} AND read_at IS NULL`;
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

export default router;
