import express from 'express';
import { sql, getAuth } from '../lib/db.js';
import { rateLimit } from '../lib/limit.js';

const router = express.Router();
router.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));
router.use((req, res, next) => {
  try { req.user = getAuth(req); next(); }
  catch { res.status(401).json({ error: 'unauthorized' }); }
});

const CATS = new Set(['question', 'bug', 'suggestion', 'account', 'other']);
const clean = (s, max) => String(s == null ? '' : s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '')
  .replace(/\r\n/g, '\n').trim().slice(0, max);
const sec = (d) => (d ? Math.floor(new Date(d).getTime() / 1000) : 0);

// ---------- donation methods chosen by the admin ----------
router.get('/donate', async (req, res) => {
  try {
    const m = await sql`SELECT id, kind, title, value, extra FROM donate_methods WHERE enabled = TRUE ORDER BY sort_order, id`;
    const i = await sql`SELECT v FROM site_settings WHERE k = 'donate_intro'`;
    res.json({ intro: i.length ? i[0].v || '' : '', methods: m.map((x) => ({ id: x.id, kind: x.kind, title: x.title, value: x.value, extra: x.extra || '' })) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// ---------- tickets (a user only ever sees their own) ----------
router.get('/tickets', async (req, res) => {
  try {
    const uid = req.user.uid;
    const rows = await sql`
      SELECT t.id, t.subject, t.category, t.status, t.created_at, t.updated_at,
        (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.from_admin = TRUE AND m.created_at > COALESCE(t.user_seen_at, t.created_at))::int AS unread
      FROM tickets t WHERE t.user_id = ${uid} ORDER BY t.updated_at DESC, t.id DESC LIMIT 50`;
    res.json({
      unread: rows.reduce((a, r) => a + (r.unread > 0 ? 1 : 0), 0),
      tickets: rows.map((r) => ({ id: r.id, subject: r.subject, category: r.category, status: r.status, created_at: sec(r.created_at), updated_at: sec(r.updated_at), unread: r.unread > 0 }))
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.post('/tickets', rateLimit({ windowMs: 60 * 60 * 1000, max: 6, key: (r) => 'tk' + (r.user && r.user.uid) }), async (req, res) => {
  const b = req.body || {};
  const uid = req.user.uid;
  const subject = clean(b.subject, 80);
  const body = clean(b.body, 1500);
  const category = CATS.has(b.category) ? b.category : 'other';
  if (!subject || !body) return res.status(400).json({ error: 'missing' });
  try {
    const [c] = await sql`SELECT COUNT(*)::int AS n FROM tickets WHERE user_id = ${uid} AND status <> 'closed'`;
    if (c.n >= 5) return res.status(429).json({ error: 'too_many_open' });
    const [t] = await sql`INSERT INTO tickets (user_id, subject, category, user_seen_at) VALUES (${uid}, ${subject}, ${category}, NOW()) RETURNING id`;
    await sql`INSERT INTO ticket_messages (ticket_id, from_admin, body) VALUES (${t.id}, FALSE, ${body})`;
    res.json({ id: t.id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

function tid(req) { const id = parseInt(req.params.id, 10); return Number.isInteger(id) ? id : null; }
async function own(id, uid) { const r = await sql`SELECT id, subject, category, status FROM tickets WHERE id = ${id} AND user_id = ${uid}`; return r[0] || null; }

router.get('/tickets/:id', async (req, res) => {
  const id = tid(req); if (!id) return res.status(400).json({ error: 'bad_id' });
  try {
    const t = await own(id, req.user.uid);
    if (!t) return res.status(404).json({ error: 'not_found' });
    const m = await sql`SELECT id, from_admin, body, created_at FROM ticket_messages WHERE ticket_id = ${id} ORDER BY id ASC LIMIT 200`;
    await sql`UPDATE tickets SET user_seen_at = NOW() WHERE id = ${id}`;
    res.json({ ticket: { id: t.id, subject: t.subject, category: t.category, status: t.status }, messages: m.map((x) => ({ id: x.id, from_admin: !!x.from_admin, body: x.body, created_at: sec(x.created_at) })) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.post('/tickets/:id/reply', rateLimit({ windowMs: 60 * 1000, max: 12, key: (r) => 'tkr' + (r.user && r.user.uid) }), async (req, res) => {
  const id = tid(req); if (!id) return res.status(400).json({ error: 'bad_id' });
  const body = clean((req.body || {}).body, 1500);
  if (!body) return res.status(400).json({ error: 'missing' });
  try {
    const t = await own(id, req.user.uid);
    if (!t) return res.status(404).json({ error: 'not_found' });
    if (t.status === 'closed') return res.status(409).json({ error: 'closed' });
    const [c] = await sql`SELECT COUNT(*)::int AS n FROM ticket_messages WHERE ticket_id = ${id}`;
    if (c.n >= 100) return res.status(429).json({ error: 'too_long' });
    await sql`INSERT INTO ticket_messages (ticket_id, from_admin, body) VALUES (${id}, FALSE, ${body})`;
    await sql`UPDATE tickets SET status = 'open', updated_at = NOW(), user_seen_at = NOW() WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.post('/tickets/:id/close', async (req, res) => {
  const id = tid(req); if (!id) return res.status(400).json({ error: 'bad_id' });
  try {
    const t = await own(id, req.user.uid);
    if (!t) return res.status(404).json({ error: 'not_found' });
    await sql`UPDATE tickets SET status = 'closed', updated_at = NOW() WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

export default router;
