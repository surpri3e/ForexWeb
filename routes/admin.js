import express from 'express';
import crypto from 'crypto';
import { sql } from '../lib/db.js';
import { newsStatus, refresh as refreshNews, importFeed } from './news.js';
import { groupsSvc, tgApi } from './telegram.js';
import { getRates, ratesStatus, getManualUsd } from '../lib/rates.js';
import { aiStatus, getAiConfig, setAiConfig, verifyKey, pingModel } from '../lib/aicore.js';
import { setEnv, renderConfigured } from '../lib/envsync.js';

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
        (SELECT COUNT(*) FROM users WHERE GREATEST(COALESCE(last_login,'epoch'::timestamptz),COALESCE(last_seen,'epoch'::timestamptz)) > NOW() - INTERVAL '24 hours')::int AS active24h,
        (SELECT COUNT(*) FROM users WHERE GREATEST(COALESCE(last_login,'epoch'::timestamptz),COALESCE(last_seen,'epoch'::timestamptz)) > NOW() - INTERVAL '7 days')::int AS active7d,
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
      SELECT email, created_at, GREATEST(COALESCE(last_login,'epoch'::timestamptz),COALESCE(last_seen,'epoch'::timestamptz)) AS last_login
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
      SELECT m.id, m.title, m.body, m.kind, m.audience, m.target_email, m.popup, m.created_at, m.expires_at, m.edited_at,
             COUNT(r.user_id)::int AS total, COUNT(r.read_at)::int AS reads
      FROM messages m LEFT JOIN message_recipients r ON r.message_id = m.id
      GROUP BY m.id ORDER BY m.id DESC LIMIT 50`;
    res.json({ messages: rows.map((m) => ({ id: m.id, title: m.title || '', body: m.body, kind: m.kind, audience: m.audience, target: m.target_email || '', popup: !!m.popup, created_at: sec(m.created_at), expires_at: sec(m.expires_at), edited: !!m.edited_at, total: m.total, reads: m.reads })) });
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

// fix a typo: edit the text of a message that was already sent (recipients and read counts are kept)
router.patch('/messages/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  const b = req.body || {};
  const body = String(b.body || '').trim();
  const title = String(b.title || '').trim().slice(0, 80);
  if (!body || body.length > 600) return res.status(400).json({ error: 'bad_body' });
  try {
    const ex = await sql`SELECT id FROM messages WHERE id = ${id}`;
    if (!ex.length) return res.status(404).json({ error: 'not_found' });
    await sql`UPDATE messages SET title = ${title || null}, body = ${body}, edited_at = NOW() WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

// ---------- moderation of the public "Global" feed ----------
router.get('/global/posts', async (req, res) => {
  const reported = (req.query && req.query.filter) !== 'all';
  try {
    const rows = reported
      ? await sql`
        SELECT p.id, p.symbol, p.body, p.hidden, p.created_at, pr.username, pr.banned,
          (SELECT COUNT(*) FROM post_reports r WHERE r.post_id = p.id)::int AS reports
        FROM posts p JOIN profiles pr ON pr.user_id = p.user_id
        WHERE EXISTS (SELECT 1 FROM post_reports r WHERE r.post_id = p.id) OR p.hidden = TRUE
        ORDER BY p.id DESC LIMIT 60`
      : await sql`
        SELECT p.id, p.symbol, p.body, p.hidden, p.created_at, pr.username, pr.banned,
          (SELECT COUNT(*) FROM post_reports r WHERE r.post_id = p.id)::int AS reports
        FROM posts p JOIN profiles pr ON pr.user_id = p.user_id
        ORDER BY p.id DESC LIMIT 60`;
    res.json({ posts: rows.map((r) => ({ id: r.id, symbol: r.symbol, body: r.body || '', hidden: !!r.hidden, created_at: sec(r.created_at), username: r.username, banned: !!r.banned, reports: r.reports })) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.get('/global/img/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(404).end();
  try {
    const r = await sql`SELECT img_b64 FROM posts WHERE id = ${id}`;
    if (!r.length) return res.status(404).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=60' });
    res.end(Buffer.from(r[0].img_b64, 'base64'));
  } catch (e) { console.error(e); res.status(500).end(); }
});

router.delete('/global/posts/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  try { await sql`DELETE FROM posts WHERE id = ${id}`; res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.post('/global/posts/:id/hide', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  const hidden = !!(req.body || {}).hidden;
  try {
    await sql`UPDATE posts SET hidden = ${hidden} WHERE id = ${id}`;
    if (!hidden) await sql`DELETE FROM post_reports WHERE post_id = ${id}`; // restored posts start with a clean report list
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.post('/global/ban', async (req, res) => {
  const u = String((req.body || {}).username || '').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20);
  const banned = !!(req.body || {}).banned;
  if (!u) return res.status(400).json({ error: 'bad_username' });
  try {
    const r = await sql`SELECT user_id FROM profiles WHERE username = ${u}`;
    if (!r.length) return res.status(404).json({ error: 'no_user' });
    await sql`UPDATE profiles SET banned = ${banned} WHERE username = ${u}`;
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// ---------- donation methods (card / wallet / link / text) ----------
const DKINDS = new Set(['card', 'wallet', 'link', 'text']);
const cleanTxt = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').trim().slice(0, max);
function checkDonate(b) {
  const kind = DKINDS.has(b.kind) ? b.kind : null;
  if (!kind) return { error: 'bad_kind' };
  const title = cleanTxt(b.title, 40);
  let value = cleanTxt(b.value, 300);
  const extra = cleanTxt(b.extra, 60);
  if (!title || !value) return { error: 'missing' };
  if (kind === 'card' && !/^[0-9][0-9 -]{10,30}[0-9]$/.test(value)) return { error: 'bad_card' };
  if (kind === 'wallet' && !/^[A-Za-z0-9:._-]{10,128}$/.test(value)) return { error: 'bad_wallet' };
  if (kind === 'link' && !/^https?:\/\/[^\s<>"']{4,280}$/i.test(value)) return { error: 'bad_link' };
  return { kind, title, value, extra };
}
router.get('/donate', async (req, res) => {
  try {
    const m = await sql`SELECT id, kind, title, value, extra, enabled, sort_order FROM donate_methods ORDER BY sort_order, id`;
    const i = await sql`SELECT v FROM site_settings WHERE k = 'donate_intro'`;
    res.json({ intro: i.length ? i[0].v || '' : '', methods: m.map((x) => ({ id: x.id, kind: x.kind, title: x.title, value: x.value, extra: x.extra || '', enabled: !!x.enabled })) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});
router.post('/donate', async (req, res) => {
  const v = checkDonate(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const [c] = await sql`SELECT COUNT(*)::int AS n FROM donate_methods`;
    if (c.n >= 20) return res.status(400).json({ error: 'too_many' });
    const [r] = await sql`INSERT INTO donate_methods (kind, title, value, extra, sort_order) VALUES (${v.kind}, ${v.title}, ${v.value}, ${v.extra}, ${c.n}) RETURNING id`;
    res.json({ id: r.id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});
router.patch('/donate/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  const b = req.body || {};
  try {
    if (b.enabled !== undefined && b.title === undefined) {
      await sql`UPDATE donate_methods SET enabled = ${!!b.enabled} WHERE id = ${id}`;
      return res.json({ ok: true });
    }
    const v = checkDonate(b);
    if (v.error) return res.status(400).json({ error: v.error });
    await sql`UPDATE donate_methods SET kind = ${v.kind}, title = ${v.title}, value = ${v.value}, extra = ${v.extra} WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});
router.delete('/donate/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  try { await sql`DELETE FROM donate_methods WHERE id = ${id}`; res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});
router.put('/donate-intro', async (req, res) => {
  const text = cleanTxt((req.body || {}).text, 400);
  try {
    const ex = await sql`SELECT k FROM site_settings WHERE k = 'donate_intro'`;
    if (ex.length) await sql`UPDATE site_settings SET v = ${text} WHERE k = 'donate_intro'`;
    else await sql`INSERT INTO site_settings (k, v) VALUES ('donate_intro', ${text})`;
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// ---------- support tickets ----------
router.get('/tickets', async (req, res) => {
  const all = (req.query && req.query.status) === 'all';
  try {
    const rows = all
      ? await sql`SELECT t.id, t.subject, t.category, t.status, t.created_at, t.updated_at, u.email FROM tickets t JOIN users u ON u.id = t.user_id ORDER BY t.updated_at DESC, t.id DESC LIMIT 100`
      : await sql`SELECT t.id, t.subject, t.category, t.status, t.created_at, t.updated_at, u.email FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.status = 'open' ORDER BY t.updated_at DESC, t.id DESC LIMIT 100`;
    const [c] = await sql`SELECT COUNT(*)::int AS n FROM tickets WHERE status = 'open'`;
    res.json({ open: c.n, tickets: rows.map((r) => ({ id: r.id, subject: r.subject, category: r.category, status: r.status, email: r.email, created_at: sec(r.created_at), updated_at: sec(r.updated_at) })) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});
router.get('/tickets/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  try {
    const t = await sql`SELECT t.id, t.subject, t.category, t.status, u.email FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ${id}`;
    if (!t.length) return res.status(404).json({ error: 'not_found' });
    const m = await sql`SELECT id, from_admin, body, created_at FROM ticket_messages WHERE ticket_id = ${id} ORDER BY id ASC LIMIT 200`;
    res.json({ ticket: t[0], messages: m.map((x) => ({ id: x.id, from_admin: !!x.from_admin, body: x.body, created_at: sec(x.created_at) })) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});
router.post('/tickets/:id/reply', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = cleanTxt((req.body || {}).body, 1500);
  if (!Number.isInteger(id) || !body) return res.status(400).json({ error: 'missing' });
  try {
    const t = await sql`SELECT id, user_id, subject FROM tickets WHERE id = ${id}`;
    if (!t.length) return res.status(404).json({ error: 'not_found' });
    await sql`INSERT INTO ticket_messages (ticket_id, from_admin, body) VALUES (${id}, TRUE, ${body})`;
    await sql`UPDATE tickets SET status = 'answered', updated_at = NOW() WHERE id = ${id}`;
    // tell the user through the normal message bell
    const [m] = await sql`INSERT INTO messages (title, body, kind, audience) VALUES (${'پاسخ تیکت #' + id}, ${'به تیکتت «' + t[0].subject.slice(0, 40) + '» جواب دادیم؛ از منو ← پشتیبانی ببینش.'}, 'info', 'user') RETURNING id`;
    await sql`INSERT INTO message_recipients (message_id, user_id) VALUES (${m.id}, ${t[0].user_id})`;
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});
router.post('/tickets/:id/status', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const st = (req.body || {}).status;
  if (!Number.isInteger(id) || !['open', 'answered', 'closed'].includes(st)) return res.status(400).json({ error: 'bad_status' });
  try { await sql`UPDATE tickets SET status = ${st}, updated_at = NOW() WHERE id = ${id}`; res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// ---------- economic news: status, manual refresh, manual import ----------
router.get('/news/status', (req, res) => res.json(newsStatus()));
router.post('/news/refresh', async (req, res) => {
  try { await Promise.race([refreshNews(), new Promise((r) => setTimeout(r, 30000))]); } catch { /* status below shows the error */ }
  res.json(newsStatus());
});
router.post('/news/import', async (req, res) => {
  let raw = (req.body || {}).data;
  try {
    if (typeof raw === 'string') raw = JSON.parse(raw);
    const n = await importFeed(raw);
    res.json({ ok: true, count: n, status: newsStatus() });
  } catch (e) {
    res.status(400).json({ error: 'bad_feed', detail: String((e && e.message) || e).slice(0, 80) });
  }
});

// ---------- ربات توی گروه‌ها: لیست، تنظیمات، ارسال دستی ----------
router.get('/bot/groups', async (req, res) => {
  try { res.json({ groups: await groupsSvc.list() }); } catch (e) { res.status(500).json({ error: 'server' }); }
});
router.post('/bot/groups/:id', async (req, res) => {
  try {
    if (!/^-?\d{5,20}$/.test(req.params.id)) return res.status(400).json({ error: 'bad_id' });
    const g = await groupsSvc.update(req.params.id, req.body || {});
    if (!g) return res.status(404).json({ error: 'not_found' });
    res.json({ group: g });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});
router.post('/bot/groups/:id/send', async (req, res) => {
  try {
    if (!/^-?\d{5,20}$/.test(req.params.id)) return res.status(400).json({ error: 'bad_id' });
    await groupsSvc.sendNow(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    const m = String((e && e.message) || e);
    res.status(502).json({ error: /rates_unavailable/.test(m) ? 'rates_unavailable' : 'send_failed', detail: m.slice(0, 120) });
  }
});
router.delete('/bot/groups/:id', async (req, res) => {
  try {
    if (!/^-?\d{5,20}$/.test(req.params.id)) return res.status(400).json({ error: 'bad_id' });
    if (req.query.leave === '1') { try { await tgApi.leave(req.params.id); } catch { /* شاید قبلاً خارج شده */ } }
    await groupsSvc.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});
// وضعیت منابع قیمت + نرخ دستی دلار (فقط وقتی منبع خودکار قطعه استفاده می‌شه)
router.get('/rates/status', async (req, res) => {
  try {
    const d = await getRates({ force: req.query.force === '1' });
    const usd = (d.fiat || []).find((x) => x.code === 'USD') || null;
    res.json({ status: ratesStatus(), usd: usd ? { price: usd.price, manual: !!usd.manual } : null, counts: { fiat: d.fiat.length, gold: d.gold.length, crypto: d.crypto.length, usdt: !!d.usdt }, manual: getManualUsd() });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});
router.post('/rates/manual-usd', async (req, res) => {
  try {
    const v = (req.body || {}).price;
    const m = await groupsSvc.saveManualUsd(v === '' || v == null ? 0 : v);
    res.json({ ok: true, manual: m });
  } catch (e) { res.status(500).json({ error: 'server' }); }
});

// ---------- هوش مصنوعی: وضعیت، سقف‌ها و کلید (همان چیزی که از ربات هم کنترل می‌شه) ----------
const aiView = () => ({ status: aiStatus(), config: getAiConfig(), render: renderConfigured() });
router.get('/ai', (req, res) => res.json(aiView()));
router.post('/ai', async (req, res) => {
  try { await setAiConfig(req.body || {}); res.json(aiView()); } catch (e) { res.status(500).json({ error: 'server' }); }
});
router.post('/ai/key', async (req, res) => {
  try {
    const key = String((req.body || {}).key || '').trim().replace(/\s+/g, '');
    if (!key) { const r = await setEnv('GEMINI_API_KEY', ''); return res.json(Object.assign(aiView(), { persisted: r.persisted })); }
    if (!/^[A-Za-z0-9_-]{20,120}$/.test(key)) return res.status(400).json({ error: 'bad_key' });
    const v = await verifyKey(key);
    if (!v.ok) return res.status(400).json({ error: 'key_rejected', status: v.status || 0 });
    const r = await setEnv('GEMINI_API_KEY', key);
    res.json(Object.assign(aiView(), { persisted: r.persisted, reason: r.reason || '' }));
  } catch (e) { res.status(500).json({ error: 'server' }); }
});
router.post('/ai/test', async (req, res) => {
  try { res.json(await pingModel()); } catch (e) { res.status(500).json({ error: 'server' }); }
});

export default router;
