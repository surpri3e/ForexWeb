import express from 'express';
import { rateLimit } from '../lib/limit.js';
import { getRates, hasAnyRates, faStamp } from '../lib/rates.js';
import { badgeSvg } from '../lib/flags.js';

const router = express.Router();
// عمومی و فقط‌خواندنی؛ پاسخ از کش سرور می‌آد، پس فشاری روی منبع قیمت نمی‌ره
router.get('/', rateLimit({ windowMs: 60 * 1000, max: 40 }), async (req, res) => {
  try {
    const d = await getRates();
    if (!hasAnyRates(d)) return res.status(503).json({ error: 'unavailable' });
    res.set('Cache-Control', 'public, max-age=30');
    res.json(Object.assign({}, d, { stamp: faStamp(d.at) }));
  } catch (e) { console.error('rates:', e && e.message); res.status(503).json({ error: 'unavailable' }); }
});
// پرچم و نشان گرد هر ارز (SVG ثابت؛ مرورگر یک روز کش می‌کنه)
router.get('/flag/:code', rateLimit({ windowMs: 60 * 1000, max: 400 }), (req, res) => {
  const code = String(req.params.code || '').toUpperCase().replace(/\.SVG$/, '');
  if (!/^[A-Z0-9]{2,8}$/.test(code)) return res.status(404).end();
  const k = ['gold', 'crypto'].includes(req.query.k) ? req.query.k : 'fiat';
  res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  res.send(badgeSvg(k, code));
});
export default router;
