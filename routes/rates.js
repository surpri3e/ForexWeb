import express from 'express';
import { rateLimit } from '../lib/limit.js';
import { getRates, hasAnyRates, faStamp } from '../lib/rates.js';

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
export default router;
