// دستیار هوش مصنوعی (Gemini) برای سایت. کلید و سقف‌ها از lib/ai.js می‌آن (قابل کنترل از پنل ادمین تلگرام).
import express from 'express';
import { getAuth } from '../lib/db.js';
import { rateLimit } from '../lib/limit.js';
import { askAi, aiStatus, getAiConfig, currentModel } from '../lib/ai.js';

const router = express.Router();
const ENDPOINT = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;

function auth(req, res, next) {
  try { req.user = getAuth(req); next(); }
  catch { res.status(401).json({ error: 'unauthorized' }); }
}

const REASON = { off: [503, 'ai_off'], disabled: [403, 'ai_disabled'], daily: [429, 'daily_limit'], cooldown: [429, 'ai_busy'], ai_busy: [429, 'ai_busy'], bad_request: [400, 'bad_request'], ai_timeout: [504, 'ai_timeout'], ai_empty: [502, 'ai_empty'], ai_failed: [502, 'ai_failed'] };

router.post('/chat', auth,
  rateLimit({ windowMs: 10 * 60 * 1000, max: 25, key: (r) => 'ai' + (r.user && r.user.uid) }),
  async (req, res) => {
    const body = req.body || {};
    const msgs = Array.isArray(body.messages) ? body.messages.slice(-14) : [];
    let extra = '';
    if (body.mode === 'journal' && body.journal && typeof body.journal === 'object') {
      let j = '';
      try { j = JSON.stringify(body.journal); } catch { j = ''; }
      if (j.length > 14000) return res.status(413).json({ error: 'bad_size' });
      extra = `\n\nحالت «تحلیل ژورنال»: این خلاصهٔ آمار ژورنال خود کاربره (JSON). فقط بر اساس همین داده‌ها حرف بزن، عددها رو از همین‌جا نقل کن و چیزی از خودت نساز. اگه داده کمه، صادقانه بگو.\n${j}`;
    }
    const r = await askAi({ scope: 'site', uid: String(req.user.uid), msgs, extraSystem: extra });
    if (!r.ok) { const m = REASON[r.reason] || [502, 'ai_failed']; return res.status(m[0]).json({ error: m[1] }); }
    res.json({ reply: r.reply, left: r.left });
  });


// عیب‌یابی: یه درخواست خیلی کوچیک به Gemini می‌زنه و جواب خام (بدون کلید) رو برمی‌گردونه. فقط برای کاربر واردشده.
router.get('/diag', auth, rateLimit({ windowMs: 10 * 60 * 1000, max: 20, key: (r) => 'aid' + (r.user && r.user.uid) }), async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  const MODEL = currentModel();
  const out = { keySet: !!key, keyLen: key ? key.length : 0, keyLooksValid: !!key && /^[\w.-]{30,}$/.test(key), model: currentModel(), node: process.version };
  if (!key) return res.json(out);
  const redact = (x) => String(x == null ? '' : x).split(key).join('[KEY]').slice(0, 700);
  const hdr = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
  const tiny = (thinking) => JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'فقط بنویس: سلام' }] }], generationConfig: Object.assign({ maxOutputTokens: 40 }, thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) });
  const run = async (thinking) => {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 20000);
    const t0 = Date.now();
    try {
      const r = await fetch(ENDPOINT(currentModel()), { method: 'POST', headers: hdr, body: tiny(thinking), signal: ac.signal });
      const txt = await r.text();
      return { status: r.status, ms: Date.now() - t0, thinking, body: redact(txt) };
    } catch (e) { return { error: e.name || 'Error', message: redact(e.message), cause: redact(e.cause && (e.cause.code || e.cause.message)), ms: Date.now() - t0, thinking }; }
    finally { clearTimeout(to); }
  };
  out.generate = await run(true);
  if (out.generate.status === 400) out.generateNoThinking = await run(false);
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    out.modelsStatus = r.status;
    if (Array.isArray(j.models)) out.models = j.models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name)).map((m) => m.name.replace('models/', ''));
    else out.modelsBody = redact(JSON.stringify(j));
  } catch (e) { out.modelsError = redact(e.name + ': ' + e.message); }
  res.json(out);
});

router.get('/status', auth, (req, res) => { const st = aiStatus(); res.json({ on: st.on.site, enabled: st.site, key: st.key, model: st.model, daily: getAiConfig().siteDaily }); });

export default router;
