// تحلیل استیتمنت از روی عکس: عکس هیستوری متاتریدر -> خواندن با هوش مصنوعی -> آمار حساب
import express from 'express';
import { getAuth } from '../lib/db.js';
import { rateLimit } from '../lib/limit.js';
import { callAi, aiStatus } from '../lib/aicore.js';
import { STATEMENT_SYSTEM, parseModelJson, analyze, smartMerge, checkTotals } from '../lib/statement.js';

const router = express.Router();
function auth(req, res, next) {
  try { req.user = getAuth(req); next(); } catch { res.status(401).json({ error: 'unauthorized' }); }
}
const ERR = { ai_off: [503, 'ai_off'], ai_busy: [429, 'ai_busy'], ai_timeout: [504, 'ai_timeout'], ai_key: [503, 'ai_key'], ai_model: [503, 'ai_model'], ai_empty: [502, 'unreadable'] };

// یک عکس در هر درخواست (دقت خواندن بیشتر؛ کلاینت به‌نوبت می‌فرسته)
router.post('/parse', auth, rateLimit({ windowMs: 10 * 60 * 1000, max: 120, key: (r) => 'stp' + (r.user && r.user.uid) }), async (req, res) => {
  const st = aiStatus();
  if (!st.key) return res.status(503).json({ error: 'ai_off' });
  if (!st.site) return res.status(403).json({ error: 'ai_disabled' });
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body && req.body.image) || ''));
  if (!m) return res.status(400).json({ error: 'bad_image' });
  if (m[2].length > 2.2e6) return res.status(413).json({ error: 'bad_size' });
  try {
    const reply = await callAi({
      system: STATEMENT_SYSTEM, maxTokens: 4000, temperature: 0.05, timeoutMs: 70000,
      contents: [{ role: 'user', parts: [{ text: 'این اسکرین‌شات تاریخچهٔ معاملات است. طبق قوانین فقط JSON را برگردان.' }, { inlineData: { mimeType: m[1], data: m[2] } }] }],
    });
    const out = parseModelJson(reply);
    if (!out) return res.status(422).json({ error: 'unreadable' });
    res.json(out);
  } catch (e) {
    const c = ERR[e && e.code] || [502, 'ai_failed'];
    res.status(c[0]).json({ error: c[1] });
  }
});

// ادغام نتیجهٔ چند عکس/برش: تشخیص تکراری‌های ناشی از هم‌پوشانی + صحت‌سنجی با جمع بالای صفحه
router.post('/merge', auth, rateLimit({ windowMs: 10 * 60 * 1000, max: 60, key: (r) => 'stm' + (r.user && r.user.uid) }), (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.batches) || b.batches.length > 60 || b.batches.some((x) => !Array.isArray(x) || x.length > 400)) return res.status(400).json({ error: 'bad_request' });
  const m = smartMerge(b.batches);
  res.json({ rows: m.rows, dups: m.dups, check: checkTotals(m.rows, Array.isArray(b.totals) ? b.totals.slice(0, 60) : []) });
});

router.post('/analyze', auth, rateLimit({ windowMs: 10 * 60 * 1000, max: 120, key: (r) => 'sta' + (r.user && r.user.uid) }), (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.rows) || b.rows.length > 600) return res.status(400).json({ error: 'bad_request' });
  res.json(analyze(b.rows, { startBalance: b.startBalance, balance: b.balance }));
});

export default router;
// END-OF-FILE routes/statement.js
