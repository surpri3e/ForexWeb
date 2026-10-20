import express from 'express';
import crypto from 'crypto';
import { sql, getAuth } from '../lib/db.js';
import { rateLimit } from '../lib/limit.js';

const router = express.Router();

const DAILY_LIMIT = 3;
const RETENTION_DAYS = Math.max(1, parseInt(process.env.GLOBAL_RETENTION_DAYS || '7', 10));
const MAX_POSTS = Math.max(100, parseInt(process.env.GLOBAL_MAX_POSTS || '1500', 10));
const RESERVED = new Set(['admin', 'administrator', 'root', 'support', 'system', 'moderator', 'mod', 'staff', 'official', 'surpri3efx', 'surprisefx', 'null', 'undefined', 'api', '__proto__', 'constructor', 'prototype', 'tostring', 'hasownproperty']);
const BIASES = new Set(['buy', 'sell', 'neutral']);

// ---------- helpers ----------
const clean = (s, max) => String(s == null ? '' : s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '') // control, zero-width and bidi-override characters
  .replace(/\r\n/g, '\n').trim().slice(0, max);
const isoSec = (d) => (d ? Math.floor(new Date(d).getTime() / 1000) : 0);

// Tehran has no DST: the "day" for the 3-posts limit starts at 00:00 Asia/Tehran (UTC+3:30)
function tehranDayStart() {
  const off = 3.5 * 3600 * 1000;
  const t = Date.now() + off;
  return new Date(Math.floor(t / 86400000) * 86400000 - off);
}

// strict JPEG data-URL parsing: only baseline/progressive JPEG, size and dimensions bounded
function parseJpeg(dataUrl, maxBytes, maxDim) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 200 || buf.length > maxBytes) return null;
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return null;
  let i = 2, w = 0, h = 0;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const mk = buf[i + 1];
    if (mk === 0xff) { i++; continue; }
    if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if ((mk >= 0xc0 && mk <= 0xc3) || (mk >= 0xc5 && mk <= 0xc7) || (mk >= 0xc9 && mk <= 0xcb) || (mk >= 0xcd && mk <= 0xcf)) {
      h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break;
    }
    i += 2 + len;
  }
  if (!w || !h || w > maxDim || h > maxDim) return null;
  return { buf, b64: m[1] };
}

function auth(req, res, next) {
  try { req.user = getAuth(req); next(); }
  catch { res.status(401).json({ error: 'unauthorized' }); }
}
async function myProfile(uid) {
  const r = await sql`SELECT user_id, username, display_name, bio, avatar_v, banned FROM profiles WHERE user_id = ${uid} LIMIT 1`;
  return r[0] || null;
}
const pubProfile = (p) => p && { username: p.username, display_name: p.display_name || '', bio: p.bio || '', avatar_v: p.avatar_v || 0, user_id: p.user_id };

// ---------- public media (no auth: used by <img>) ----------
const mediaLimit = rateLimit({ windowMs: 60 * 1000, max: 600 });
router.get('/img/:id', mediaLimit, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(404).end();
  try {
    const r = await sql`SELECT p.img_b64 FROM posts p JOIN profiles pr ON pr.user_id = p.user_id WHERE p.id = ${id} AND p.hidden = FALSE AND pr.banned = FALSE LIMIT 1`;
    if (!r.length) return res.status(404).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Disposition': 'inline' });
    res.end(Buffer.from(r[0].img_b64, 'base64'));
  } catch (e) { console.error(e); res.status(500).end(); }
});
router.get('/avatar/:uid', mediaLimit, async (req, res) => {
  const uid = parseInt(req.params.uid, 10);
  if (!Number.isInteger(uid)) return res.status(404).end();
  try {
    const r = await sql`SELECT avatar_b64 FROM profiles WHERE user_id = ${uid} AND banned = FALSE LIMIT 1`;
    if (!r.length || !r[0].avatar_b64) return res.status(404).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Disposition': 'inline' });
    res.end(Buffer.from(r[0].avatar_b64, 'base64'));
  } catch (e) { console.error(e); res.status(500).end(); }
});

// ---------- everything below needs a logged-in user ----------
router.use(rateLimit({ windowMs: 60 * 1000, max: 240 }));
router.use(auth);

router.get('/me', async (req, res) => {
  try {
    const uid = req.user.uid;
    const p = await myProfile(uid);
    const [c] = await sql`SELECT COUNT(*)::int AS n FROM posts WHERE user_id = ${uid} AND created_at >= ${tehranDayStart().toISOString()}`;
    const [f1] = await sql`SELECT COUNT(*)::int AS n FROM follows WHERE followee_id = ${uid}`;
    const [f2] = await sql`SELECT COUNT(*)::int AS n FROM follows WHERE follower_id = ${uid}`;
    res.json({ profile: p ? { ...pubProfile(p), banned: !!p.banned } : null, today: { used: c.n, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - c.n) }, followers: f1.n, following: f2.n });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.get('/username/:u', async (req, res) => {
  const u = String(req.params.u || '').toLowerCase();
  if (!/^[a-z0-9_.]{3,20}$/.test(u) || u.includes('..') || RESERVED.has(u)) return res.json({ available: false, reason: 'invalid' });
  try {
    const r = await sql`SELECT user_id FROM profiles WHERE username = ${u} LIMIT 1`;
    res.json({ available: !r.length || r[0].user_id === req.user.uid });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.put('/profile', rateLimit({ windowMs: 10 * 60 * 1000, max: 20, key: (r) => 'prof' + (r.user && r.user.uid) }), async (req, res) => {
  const b = req.body || {};
  const uid = req.user.uid;
  try {
    const cur = await myProfile(uid);
    let username = cur ? cur.username : null;
    if (b.username !== undefined || !cur) {
      const u = String(b.username || '').trim().toLowerCase();
      if (!/^[a-z0-9_.]{3,20}$/.test(u) || u.includes('..') || u.startsWith('.') || u.endsWith('.')) return res.status(400).json({ error: 'bad_username' });
      if (RESERVED.has(u)) return res.status(400).json({ error: 'reserved' });
      username = u;
    }
    const display = b.displayName !== undefined ? clean(b.displayName, 40) : (cur ? cur.display_name : '');
    const bio = b.bio !== undefined ? clean(b.bio, 160) : (cur ? cur.bio : '');
    if (b.displayName !== undefined && !display) return res.status(400).json({ error: 'bad_name' });
    let av; // undefined = keep, null = remove, object = new
    if (b.avatar === null) av = null;
    else if (b.avatar !== undefined) { av = parseJpeg(b.avatar, 60 * 1024, 512); if (!av) return res.status(400).json({ error: 'bad_image' }); }

    if (!cur) {
      await sql`INSERT INTO profiles (user_id, username, display_name, bio, avatar_b64, avatar_v) VALUES (${uid}, ${username}, ${display || username}, ${bio || ''}, ${av ? av.b64 : null}, ${av ? 1 : 0})`;
    } else {
      await sql`UPDATE profiles SET username = ${username}, display_name = ${display}, bio = ${bio}, updated_at = NOW() WHERE user_id = ${uid}`;
      if (av === null) await sql`UPDATE profiles SET avatar_b64 = NULL, avatar_v = avatar_v + 1 WHERE user_id = ${uid}`;
      else if (av) await sql`UPDATE profiles SET avatar_b64 = ${av.b64}, avatar_v = avatar_v + 1 WHERE user_id = ${uid}`;
    }
    const p = await myProfile(uid);
    res.json({ profile: pubProfile(p) });
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: 'username_taken' });
    console.error(e); res.status(500).json({ error: 'server' });
  }
});

router.get('/feed', async (req, res) => {
  const uid = req.user.uid;
  const tab = ['new', 'top', 'following'].includes(req.query && req.query.tab) ? req.query.tab : 'new';
  const sym = req.query && req.query.symbol ? String(req.query.symbol).toUpperCase().replace(/[^A-Z0-9.#_\-/]/g, '').slice(0, 14) || null : null;
  const author = req.query && req.query.author ? String(req.query.author).toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20) || null : null;
  const before = req.query && /^\d+$/.test(req.query.before || '') ? parseInt(req.query.before, 10) : null;
  const limit = Math.min(30, Math.max(1, parseInt((req.query && req.query.limit) || '20', 10) || 20));
  const since = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
  try {
    const rows = tab === 'top'
      ? await sql`
        SELECT p.id, p.symbol, p.bias, p.body, p.created_at, p.user_id, pr.username, pr.display_name, pr.avatar_v,
          (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id)::int AS likes,
          EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ${uid}) AS liked,
          EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${uid} AND f.followee_id = p.user_id) AS following
        FROM posts p JOIN profiles pr ON pr.user_id = p.user_id
        WHERE p.hidden = FALSE AND pr.banned = FALSE AND p.created_at >= ${since}
          AND (${sym}::text IS NULL OR p.symbol = ${sym}) AND (${author}::text IS NULL OR pr.username = ${author})
        ORDER BY likes DESC, p.id DESC LIMIT ${limit}`
      : await sql`
        SELECT p.id, p.symbol, p.bias, p.body, p.created_at, p.user_id, pr.username, pr.display_name, pr.avatar_v,
          (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id)::int AS likes,
          EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ${uid}) AS liked,
          EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${uid} AND f.followee_id = p.user_id) AS following
        FROM posts p JOIN profiles pr ON pr.user_id = p.user_id
        WHERE p.hidden = FALSE AND pr.banned = FALSE
          AND (${sym}::text IS NULL OR p.symbol = ${sym}) AND (${author}::text IS NULL OR pr.username = ${author})
          AND (${before}::int IS NULL OR p.id < ${before})
          AND (${tab}::text <> 'following' OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ${uid}))
        ORDER BY p.id DESC LIMIT ${limit}`;
    res.json({
      items: rows.map((r) => ({ id: r.id, symbol: r.symbol, bias: r.bias || '', body: r.body || '', created_at: isoSec(r.created_at), user_id: r.user_id, username: r.username, display_name: r.display_name || r.username, avatar_v: r.avatar_v || 0, likes: r.likes, liked: !!r.liked, following: !!r.following, mine: r.user_id === uid })),
      next: rows.length === limit && tab !== 'top' ? rows[rows.length - 1].id : null
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.get('/u/:username', async (req, res) => {
  const u = String(req.params.username || '').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20);
  const uid = req.user.uid;
  try {
    const r = await sql`SELECT user_id, username, display_name, bio, avatar_v, banned FROM profiles WHERE username = ${u} LIMIT 1`;
    if (!r.length || r[0].banned) return res.status(404).json({ error: 'not_found' });
    const p = r[0];
    const [n] = await sql`SELECT COUNT(*)::int AS n FROM posts WHERE user_id = ${p.user_id} AND hidden = FALSE`;
    const [f1] = await sql`SELECT COUNT(*)::int AS n FROM follows WHERE followee_id = ${p.user_id}`;
    const [f2] = await sql`SELECT COUNT(*)::int AS n FROM follows WHERE follower_id = ${p.user_id}`;
    const fl = await sql`SELECT 1 AS x FROM follows WHERE follower_id = ${uid} AND followee_id = ${p.user_id} LIMIT 1`;
    res.json({ profile: { ...pubProfile(p), posts: n.n, followers: f1.n, following: f2.n, is_following: fl.length > 0, is_me: p.user_id === uid } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.post('/posts', rateLimit({ windowMs: 60 * 1000, max: 10, key: (r) => 'post' + (r.user && r.user.uid) }), async (req, res) => {
  const b = req.body || {};
  const uid = req.user.uid;
  try {
    const p = await myProfile(uid);
    if (!p) return res.status(403).json({ error: 'no_profile' });
    if (p.banned) return res.status(403).json({ error: 'banned' });
    const symbol = String(b.symbol || '').toUpperCase().trim();
    if (!/^[A-Z0-9.#_\-/]{2,14}$/.test(symbol)) return res.status(400).json({ error: 'bad_symbol' });
    const bias = b.bias ? String(b.bias) : null;
    if (bias && !BIASES.has(bias)) return res.status(400).json({ error: 'bad_bias' });
    const body = clean(b.body, 500);
    const img = parseJpeg(b.image, 220 * 1024, 2400);
    if (!img) return res.status(400).json({ error: 'bad_image' });
    const [c] = await sql`SELECT COUNT(*)::int AS n FROM posts WHERE user_id = ${uid} AND created_at >= ${tehranDayStart().toISOString()}`;
    if (c.n >= DAILY_LIMIT) return res.status(429).json({ error: 'daily_limit', limit: DAILY_LIMIT });
    const [row] = await sql`INSERT INTO posts (user_id, symbol, bias, body, img_b64) VALUES (${uid}, ${symbol}, ${bias}, ${body}, ${img.b64}) RETURNING id`;
    res.json({ id: row.id, remaining: Math.max(0, DAILY_LIMIT - c.n - 1) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

function pid(req) { const id = parseInt(req.params.id, 10); return Number.isInteger(id) ? id : null; }

router.delete('/posts/:id', async (req, res) => {
  const id = pid(req); if (!id) return res.status(400).json({ error: 'bad_id' });
  try {
    await sql`DELETE FROM posts WHERE id = ${id} AND user_id = ${req.user.uid}`;
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.post('/posts/:id/like', async (req, res) => {
  const id = pid(req); if (!id) return res.status(400).json({ error: 'bad_id' });
  const uid = req.user.uid;
  try {
    const p = await sql`SELECT p.id FROM posts p JOIN profiles pr ON pr.user_id = p.user_id WHERE p.id = ${id} AND p.hidden = FALSE AND pr.banned = FALSE`;
    if (!p.length) return res.status(404).json({ error: 'not_found' });
    const ex = await sql`SELECT 1 AS x FROM post_likes WHERE post_id = ${id} AND user_id = ${uid}`;
    let liked;
    if (ex.length) { await sql`DELETE FROM post_likes WHERE post_id = ${id} AND user_id = ${uid}`; liked = false; }
    else { try { await sql`INSERT INTO post_likes (post_id, user_id) VALUES (${id}, ${uid})`; } catch (e) { if (!(e && e.code === '23505')) throw e; } liked = true; }
    const [c] = await sql`SELECT COUNT(*)::int AS n FROM post_likes WHERE post_id = ${id}`;
    res.json({ liked, likes: c.n });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.post('/posts/:id/report', rateLimit({ windowMs: 60 * 60 * 1000, max: 30, key: (r) => 'rep' + (r.user && r.user.uid) }), async (req, res) => {
  const id = pid(req); if (!id) return res.status(400).json({ error: 'bad_id' });
  const uid = req.user.uid;
  try {
    const p = await sql`SELECT id, user_id FROM posts WHERE id = ${id}`;
    if (!p.length) return res.status(404).json({ error: 'not_found' });
    if (p[0].user_id === uid) return res.status(400).json({ error: 'own_post' });
    try { await sql`INSERT INTO post_reports (post_id, user_id, reason) VALUES (${id}, ${uid}, ${clean((req.body || {}).reason, 120)})`; } catch (e) { if (!(e && e.code === '23505')) throw e; }
    const [c] = await sql`SELECT COUNT(*)::int AS n FROM post_reports WHERE post_id = ${id}`;
    if (c.n >= 3) await sql`UPDATE posts SET hidden = TRUE WHERE id = ${id}`; // auto-hide until the admin reviews it
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.post('/follow/:uid', async (req, res) => {
  const target = parseInt(req.params.uid, 10);
  const uid = req.user.uid;
  if (!Number.isInteger(target) || target === uid) return res.status(400).json({ error: 'bad_id' });
  try {
    const t = await sql`SELECT user_id FROM profiles WHERE user_id = ${target} AND banned = FALSE`;
    if (!t.length) return res.status(404).json({ error: 'not_found' });
    const ex = await sql`SELECT 1 AS x FROM follows WHERE follower_id = ${uid} AND followee_id = ${target}`;
    let following;
    if (ex.length) { await sql`DELETE FROM follows WHERE follower_id = ${uid} AND followee_id = ${target}`; following = false; }
    else { try { await sql`INSERT INTO follows (follower_id, followee_id) VALUES (${uid}, ${target})`; } catch (e) { if (!(e && e.code === '23505')) throw e; } following = true; }
    const [c] = await sql`SELECT COUNT(*)::int AS n FROM follows WHERE followee_id = ${target}`;
    res.json({ following, followers: c.n });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// ---------- housekeeping: keep the free database small ----------
export async function pruneGlobal() {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
    await sql`DELETE FROM posts WHERE created_at < ${cutoff}`;
    await sql`DELETE FROM posts WHERE id <= (SELECT id FROM posts ORDER BY id DESC LIMIT 1 OFFSET ${MAX_POSTS})`;
  } catch (e) { console.error('prune failed:', e.message); }
}
export function startGlobalHousekeeping() { pruneGlobal(); setInterval(pruneGlobal, 6 * 3600 * 1000).unref(); }

export default router;
