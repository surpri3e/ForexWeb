// دستیار هوش مصنوعی (Gemini). کلید فقط روی سرور و از متغیر محیطی خونده می‌شه؛ هیچ‌وقت به مرورگر نمی‌رسه.
import express from 'express';
import { getAuth } from '../lib/db.js';
import { rateLimit } from '../lib/limit.js';

const router = express.Router();
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const DAILY = Math.max(1, parseInt(process.env.AI_DAILY_LIMIT || '60', 10) || 60);
const ENDPOINT = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;

const daily = new Map(); // uid -> { day, n }
setInterval(() => { const d = new Date().toISOString().slice(0, 10); for (const [k, v] of daily) if (v.day !== d) daily.delete(k); }, 3600e3).unref();

function auth(req, res, next) {
  try { req.user = getAuth(req); next(); }
  catch { res.status(401).json({ error: 'unauthorized' }); }
}

const BASE_PROMPT = `تو «دستیار Surpri3eFX» هستی؛ یه مربی و همراه ترید برای معامله‌گرهای فارکس/کریپتو/شاخص که فارسی صحبت می‌کنن.
- همیشه فارسی و محاوره‌ای-محترمانه جواب بده؛ اصطلاحات تخصصی (TP, SL, RR, Drawdown, Liquidity و…) رو انگلیسی بنویس.
- کوتاه و کاربردی باش: بیشتر ۱۵۰ تا ۳۰۰ کلمه، با بولت‌پوینت وقتی لازمه.
- سیگنال قطعی نده و سود تضمین نکن. تحلیل‌ها آموزشی‌ان و مسئولیت تصمیم با خود کاربره؛ فقط اگه واقعاً مرتبطه، یه جمله یادآوری کن، نه تو هر پیام.
- روی مدیریت ریسک، روانشناسی و انضباط تمرکز کن.
- اگه سؤال به ترید ربطی نداره، مختصر جواب بده و به موضوع ترید برگرد.`;

router.post('/chat', auth,
  rateLimit({ windowMs: 10 * 60 * 1000, max: 25, key: (r) => 'ai' + (r.user && r.user.uid) }),
  async (req, res) => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(503).json({ error: 'ai_off' });

    const uid = String(req.user.uid);
    const day = new Date().toISOString().slice(0, 10);
    let d = daily.get(uid);
    if (!d || d.day !== day) { d = { day, n: 0 }; daily.set(uid, d); }
    if (d.n >= DAILY) return res.status(429).json({ error: 'daily_limit' });

    const body = req.body || {};
    const msgs = Array.isArray(body.messages) ? body.messages.slice(-14) : [];
    const contents = [];
    for (const m of msgs) {
      const text = typeof m.text === 'string' ? m.text.trim().slice(0, 2000) : '';
      if (!text) continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (contents.length && contents[contents.length - 1].role === role) { contents[contents.length - 1].parts[0].text += '\n' + text; continue; }
      contents.push({ role, parts: [{ text }] });
    }
    while (contents.length && contents[0].role !== 'user') contents.shift();
    if (!contents.length || contents[contents.length - 1].role !== 'user') return res.status(400).json({ error: 'bad_request' });

    let system = BASE_PROMPT;
    if (body.mode === 'journal' && body.journal && typeof body.journal === 'object') {
      let j = '';
      try { j = JSON.stringify(body.journal); } catch { j = ''; }
      if (j.length > 14000) return res.status(413).json({ error: 'bad_size' });
      system += `\n\nحالت «تحلیل ژورنال»: این خلاصهٔ آمار ژورنال خود کاربره (JSON). فقط بر اساس همین داده‌ها حرف بزن، عددها رو از همین‌جا نقل کن و اگه داده کمه صادقانه بگو. الگوهای تکراری، نقاط قوت/ضعف، ریسک و پیشنهادهای مشخص و قابل‌اجرا بده.\n${j}`;
    }

    const payload = (thinking) => ({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: Object.assign({ temperature: 0.7, maxOutputTokens: 1500 }, thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {})
    });
    const call = async (thinking) => {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 45000);
      try {
        return await fetch(ENDPOINT(MODEL), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload(thinking)), signal: ac.signal });
      } finally { clearTimeout(to); }
    };

    try {
      let r = await call(true);
      if (r.status === 400) r = await call(false); // اگه مدل thinkingConfig رو قبول نکرد
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        console.error('gemini error', r.status, t.slice(0, 300));
        return res.status(r.status === 429 ? 429 : 502).json({ error: r.status === 429 ? 'ai_busy' : 'ai_failed' });
      }
      const j = await r.json();
      const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      const reply = parts.filter((p) => p && typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
      if (!reply) return res.status(502).json({ error: 'ai_empty' });
      d.n++;
      res.json({ reply, left: Math.max(0, DAILY - d.n) });
    } catch (e) {
      console.error('gemini fetch failed:', e && e.name);
      res.status(504).json({ error: 'ai_timeout' });
    }
  });

router.get('/status', auth, (req, res) => res.json({ on: !!process.env.GEMINI_API_KEY, model: MODEL, daily: DAILY }));

export default router;
