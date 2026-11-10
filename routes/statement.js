// تحلیل استیتمنت از روی عکس: عکس هیستوری متاتریدر -> خواندن با هوش مصنوعی -> آمار حساب
import express from 'express';
import crypto from 'crypto';
import { getAuth, sql } from '../lib/db.js';
import { rateLimit } from '../lib/limit.js';
import { callAi, aiStatus } from '../lib/aicore.js';
import { statementPrompt, parseModelJson, analyze, smartMerge, checkTotals, applyHeaderCosts } from '../lib/statement.js';

const router = express.Router();
function auth(req, res, next) {
  try { req.user = getAuth(req); next(); } catch { res.status(401).json({ error: 'unauthorized' }); }
}
const ERR = { ai_off: [503, 'ai_off'], ai_busy: [429, 'ai_busy'], ai_timeout: [504, 'ai_timeout'], ai_key: [503, 'ai_key'], ai_model: [503, 'ai_model'], ai_empty: [502, 'unreadable'] };

// یک عکس در هر درخواست (دقت خواندن بیشتر؛ کلاینت به‌نوبت می‌فرسته)
const tradeCount = (o) => (o && Array.isArray(o.rows) ? o.rows.filter((r) => r.type === 'buy' || r.type === 'sell').length : 0);
async function readImage(m, lang, extra, temperature, small) {
  const reply = await callAi({
    system: statementPrompt(lang), maxTokens: small || 6500, temperature, timeoutMs: small ? 45000 : 80000,
    contents: [{ role: 'user', parts: [{ text: 'این اسکرین‌شات تاریخچهٔ معاملات است. طبق قوانین فقط JSON را برگردان.' + (extra || '') }, { inlineData: { mimeType: m[1], data: m[2] } }] }],
  });
  return parseModelJson(reply);
}
const rowsNote = (n) => '\nتوجه: این تصویر برشی از ردیف‌های لیست است و دقیقاً ' + n + ' ردیف دارد (هر ردیف یک معامله یا یک ردیف بالانس/واریز). دقیقاً ' + n + ' آیتم در rows بیاور، از بالا به پایین؛ نه کمتر نه بیشتر. هیچ ردیفی را نساز و هیچ ردیفی را جا نینداز. تاریخ هر ردیف معمولاً به شکل «سال.ماه.روز ساعت:دقیقه:ثانیه» است و اگر ارقامش فارسی است (مثلاً ۲۰۲۶.۱۱.۰۲ ۰۷:۳۵:۱۹ یعنی 2026-11-02 07:35:19) سال میلادی است؛ ماه بین ۱ تا ۱۲ و روز بین ۱ تا ۳۱ است. تاریخ و ساعت را رقم‌به‌رقم و با دقت بخوان (۳ و ۲ یا ۹ و ۱ را با هم اشتباه نگیر) و ردیف‌ها معمولاً به ترتیب زمان‌اند. مقدار count را ' + n + ' بگذار.';
const HEADER_NOTE = '\nتوجه: این تصویر فقط خلاصهٔ بالای صفحه است (جمع سود، سپرده، سواپ، کمیسیون، بالانس) و ردیف معامله ندارد. rows را خالی بگذار و فقط totals و balance را از برچسب کنار هر عدد بخوان.';
router.post('/parse', auth, rateLimit({ windowMs: 10 * 60 * 1000, max: 240, key: (r) => 'stp' + (r.user && r.user.uid) }), async (req, res) => {
  const st = aiStatus();
  if (!st.key) return res.status(503).json({ error: 'ai_off' });
  if (!st.site) return res.status(403).json({ error: 'ai_disabled' });
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body && req.body.image) || ''));
  if (!m) return res.status(400).json({ error: 'bad_image' });
  if (m[2].length > 2.2e6) return res.status(413).json({ error: 'bad_size' });
  const lang = ['fa', 'en'].includes(req.body.lang) ? req.body.lang : '';
  // کلاینت عکس را با خط‌های جداکننده به ردیف‌ها بریده: تعداد ردیف‌های این برش (expect) از قبل معلوم است، یا فقط خلاصهٔ بالای صفحه است (header)
  const kind = req.body.kind === 'header' ? 'header' : 'rows';
  const expect = kind === 'rows' && Number.isInteger(req.body.expect) && req.body.expect >= 1 && req.body.expect <= 12 ? req.body.expect : null;
  const note = kind === 'header' ? HEADER_NOTE : expect ? rowsNote(expect) : '';
  try {
    const small = kind === 'header' ? 1200 : expect ? Math.min(6500, 800 + expect * 350) : 0;   // برش کوچک = پاسخ کوتاه‌تر = سریع‌تر
    let out = await readImage(m, lang, note, 0.05, small);
    if (out && kind === 'header') out.rows = [];   // در خلاصهٔ بالا ردیف معامله نیست؛ هرچه مدل ساخته دور ریخته می‌شود
    // تعداد ردیف‌ها: یا از کلاینت معلوم است، یا خود مدل می‌شمارد؛ اگر کمتر آورد یا خروجی قطع شد، یک بار دیگر با تذکر می‌خواند و بهترین نتیجه را نگه می‌دارد
    const got = (o) => (expect ? (o && Array.isArray(o.rows) ? o.rows.length : 0) : tradeCount(o));
    const want = expect || (out && out.account && Number.isInteger(out.account.count) ? out.account.count : null);
    if (out && kind === 'rows' && ((want != null && got(out) !== want && (expect || got(out) < want)) || (out.account && out.account.truncated))) {
      try {
        const hint = expect ? '\nتذکر: این تصویر دقیقاً ' + expect + ' ردیف دارد ولی در خوانش قبلی ' + got(out) + ' ردیف آوردی. این بار ردیف‌ها را یکی‌یکی از بالا به پایین بشمار و دقیقاً ' + expect + ' آیتم بیاور.'
          : '\nتذکر: در خوانش قبلی فقط ' + tradeCount(out) + ' معامله آوردی' + (want != null ? ' ولی خودت count=' + want + ' شمردی' : '') + '. این بار همهٔ ردیف‌ها را بیاور.';
        const again = await readImage(m, lang, note + hint, 0.2, small);
        if (again && (expect ? Math.abs(got(again) - expect) < Math.abs(got(out) - expect) : got(again) > got(out))) { out = again; out.account = out.account || {}; out.account.retried = true; }
      } catch { /* همان نتیجهٔ اول */ }
    }
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
  // raw: کلاینت ردیف‌ها را با خط‌های جداکننده شمرده و تکراری‌های بین عکس‌ها را با مقایسهٔ خود تصویر حذف کرده؛ پس دوباره حدس تکراری نمی‌زنیم
  const m = smartMerge(b.raw === true ? [b.batches.flat()] : b.batches);
  const totals = Array.isArray(b.totals) ? b.totals.slice(0, 60) : [];
  const check = checkTotals(m.rows, totals);   // مقایسهٔ سود ردیف‌ها با جمع بالای صفحه (کمیسیون/سواپ جدا حساب می‌شود)
  const h = applyHeaderCosts(m.rows, totals);
  res.json({ rows: h.rows, dups: m.dups, check, costs: h.costs });
});

router.post('/analyze', auth, rateLimit({ windowMs: 10 * 60 * 1000, max: 120, key: (r) => 'sta' + (r.user && r.user.uid) }), (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.rows) || b.rows.length > 600) return res.status(400).json({ error: 'bad_request' });
  res.json(analyze(b.rows, { startBalance: b.startBalance, balance: b.balance }));
});

// ---- ذخیره/اشتراک کارت داخل مینی‌اپ تلگرام ----
// وب‌ویو تلگرام دانلود blob و navigator.share با فایل را پشتیبانی نمی‌کند؛ پس کارت یا به چت ربات فرستاده می‌شود
// یا چند دقیقه روی یک لینک موقت می‌ماند تا Telegram.WebApp.downloadFile / openLink بتواند بگیرد.
const CARDS = new Map(); // id -> { buf, mime, exp }
const CARD_TTL = 15 * 60 * 1000;
function cardsGc() { const now = Date.now(); for (const [k, v] of CARDS) if (v.exp < now) CARDS.delete(k); while (CARDS.size > 40) CARDS.delete(CARDS.keys().next().value); }
function readCard(body) {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String((body && body.image) || ''));
  if (!m || m[2].length > 2.95e6) return null;
  const buf = Buffer.from(m[2], 'base64'); if (buf.length < 100) return null;
  return { buf, mime: m[1] };
}
router.post('/card-link', auth, rateLimit({ windowMs: 10 * 60 * 1000, max: 30, key: (r) => 'stc' + (r.user && r.user.uid) }), (req, res) => {
  const c = readCard(req.body); if (!c) return res.status(400).json({ error: 'bad_image' });
  cardsGc(); const id = crypto.randomBytes(12).toString('hex');
  CARDS.set(id, { buf: c.buf, mime: c.mime, exp: Date.now() + CARD_TTL });
  res.json({ id, path: '/api/statement/card/' + id + (c.mime === 'image/png' ? '.png' : '.jpg'), ttl: CARD_TTL / 1000 });
});
router.get('/card/:file', (req, res) => {
  const m = /^([a-f0-9]{24})\.(png|jpg)$/.exec(String(req.params.file || '')); const v = m && CARDS.get(m[1]);
  if (!v || v.exp < Date.now()) return res.status(404).json({ error: 'gone' });
  res.set('Content-Type', v.mime); res.set('Cache-Control', 'private, max-age=600'); res.set('Content-Disposition', 'inline; filename="surpri3efx-card.' + m[2] + '"');
  res.send(v.buf);
});
router.post('/send-card', auth, rateLimit({ windowMs: 10 * 60 * 1000, max: 15, key: (r) => 'stsc' + (r.user && r.user.uid) }), async (req, res) => {
  const c = readCard(req.body); if (!c) return res.status(400).json({ error: 'bad_image' });
  try {
    const links = await sql`SELECT tg_id FROM tg_links WHERE user_id=${req.user.uid} ORDER BY tg_id LIMIT 1`;
    if (!links.length) return res.status(404).json({ error: 'tg_not_linked' });
    const { tgApi } = await import('./telegram.js');
    const cap = String((req.body && req.body.caption) || '').replace(/[<>&]/g, '').slice(0, 900);
    await tgApi.sendPhoto(links[0].tg_id, c.buf, cap ? '<b>کارت نتیجهٔ استیتمنت</b>\n' + cap : '<b>کارت نتیجهٔ استیتمنت</b>');
    res.json({ ok: true });
  } catch (e) {
    console.error('send-card:', e && e.message);
    res.status(502).json({ error: 'tg_failed' });
  }
});

export default router;
// END-OF-FILE routes/statement.js
