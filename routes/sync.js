// ژورنال مشترک سایت و ربات تلگرام + اتصال حساب + عکس چارت.
// سایت با ادغام سه‌طرفه (lib/merge.js) همگام می‌شه؛ سرور فقط نسخه‌ها (rev) رو کنترل می‌کنه.
import express from 'express';
import { getAuth } from '../lib/db.js';
import { rateLimit } from '../lib/limit.js';
import { loadDoc, saveDoc, getRev, makeLinkCode, linkInfo, unlinkAllForUser, saveImage, getImage, deleteImage } from '../lib/store.js';
import { botUsername } from './telegram.js';

const router = express.Router();
const authed = (req, res) => { try { return getAuth(req); } catch { res.status(401).json({ error: 'unauthorized' }); return null; } };
const fail = (res, e) => { console.error(e); res.status(500).json({ error: 'server' }); };

router.get('/', async (req, res) => {
  const u = authed(req, res); if (!u) return;
  try {
    const { doc, rev } = await loadDoc(u.uid);
    res.json({ rev, doc });
  } catch (e) { fail(res, e); }
});
router.get('/rev', async (req, res) => {
  const u = authed(req, res); if (!u) return;
  try { res.json({ rev: await getRev(u.uid) }); } catch (e) { fail(res, e); }
});
router.put('/', express.json({ limit: '5mb' }), async (req, res) => {
  const u = authed(req, res); if (!u) return;
  try {
    const base = Math.max(0, Math.floor(+(req.body && req.body.baseRev)) || 0);
    const r = await saveDoc(u.uid, req.body && req.body.doc, base);
    if (r.error) return res.status(400).json({ error: r.error });
    if (r.conflict) return res.status(409).json({ error: 'conflict', rev: await getRev(u.uid) });
    res.json({ rev: r.rev });
  } catch (e) { fail(res, e); }
});

/* ---------- اتصال ربات تلگرام ---------- */
router.get('/tg', async (req, res) => {
  const u = authed(req, res); if (!u) return;
  try { res.json(Object.assign(await linkInfo(u.uid), { bot: botUsername() || '' })); } catch (e) { fail(res, e); }
});
router.post('/tg/link', rateLimit({ windowMs: 10 * 60 * 1000, max: 20 }), async (req, res) => {
  const u = authed(req, res); if (!u) return;
  try {
    const bot = botUsername();
    if (!bot) return res.status(503).json({ error: 'tg_off' });
    const code = await makeLinkCode(u.uid);
    res.json({ code, bot, url: 'https://t.me/' + bot + '?start=L' + code, minutes: 15 });
  } catch (e) { fail(res, e); }
});
router.post('/tg/unlink', async (req, res) => {
  const u = authed(req, res); if (!u) return;
  try { await unlinkAllForUser(u.uid); res.json({ ok: true }); } catch (e) { fail(res, e); }
});

/* ---------- عکس چارت ---------- */
const imgLimit = rateLimit({ windowMs: 10 * 60 * 1000, max: 60 });
router.post('/image', imgLimit, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '1mb' }), async (req, res) => {
  const u = authed(req, res); if (!u) return;
  try {
    const r = await saveImage(u.uid, String(req.get('content-type') || '').split(';')[0], Buffer.isBuffer(req.body) ? req.body : null);
    if (r.error) return res.status(r.error === 'too_many' ? 429 : 400).json({ error: r.error });
    res.json({ id: r.id });
  } catch (e) { fail(res, e); }
});
// شناسه ۱۲۸ بیتی تصادفیه و حدس‌زدنی نیست؛ برای نمایش داخل <img> بدون هدر لازمه
router.get('/image/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[a-f0-9]{20,40}$/.test(id)) return res.sendStatus(404);
  try {
    const r = await getImage(id);
    if (!r) return res.sendStatus(404);
    res.set({ 'Content-Type': r.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    res.send(r.buf);
  } catch (e) { console.error(e); res.sendStatus(500); }
});
router.delete('/image/:id', async (req, res) => {
  const u = authed(req, res); if (!u) return;
  const id = String(req.params.id || '');
  if (!/^[a-f0-9]{20,40}$/.test(id)) return res.sendStatus(404);
  try { await deleteImage(u.uid, id); res.json({ ok: true }); } catch (e) { fail(res, e); }
});

export default router;
