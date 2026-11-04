// کلمه‌های فعال‌ساز امکانات ربات (قابل تنظیم از پنل ادمین): هر امکان یک فهرست کلمه داره.
// تشخیص: کل پیام = کلمه، یا پیام با کلمه شروع می‌شه (حداکثر ۶ کلمه)، یا (فقط پیوی) کلمه وسط یک پیام کوتاه باشه.
import { sql } from './db.js';
import { matchRatesWord, getRatesConfig } from './rates.js';

export const FEATURES = [
  { k: 'rates', fa: 'نرخ ارز و طلا', icon: '💱', words: ['نرخ', 'نرخ ارز', 'نرخ ارز و طلا', 'نرخ دلار', 'قیمت', 'قیمت ارز', 'قیمت دلار', 'قیمت طلا', 'نرخ طلا'] },
  { k: 'crypto', fa: 'ارز دیجیتال', icon: '🪙', words: ['ارز دیجیتال', 'کریپتو', 'نرخ ارز دیجیتال', 'قیمت ارز دیجیتال', 'نرخ کریپتو', 'قیمت کریپتو'] },
  { k: 'news', fa: 'اخبار اقتصادی (با «فردا»، «هفته»، «هفته بعد» هم کار می‌کنه)', short: 'اخبار اقتصادی', icon: '📰', words: ['اخبار', 'خبر', 'تقویم اقتصادی'] },
  { k: 'cal', fa: 'تقویم شمسی و میلادی (با «میلادی» هم کار می‌کنه)', short: 'تقویم و مناسبت‌ها', icon: '🗓', words: ['تقویم', 'مناسبت', 'مناسبت ها', 'تعطیلات', 'تقویم شمسی', 'تقویم میلادی'] },
  { k: 'sess', fa: 'سشن‌های بازار', icon: '🕒', words: ['سشن', 'سشن ها', 'سشن بازار', 'سشن های بازار', 'ساعت بازار'] },
  { k: 'card', fa: 'کارت نتیجهٔ ژورنال (با «امروز»، «هفته»، «ماه»، «کل» هم کار می‌کنه)', short: 'کارت نتیجهٔ ژورنال', icon: '📊', words: ['کارت', 'کارت نتیجه', 'نتیجه'] },
  { k: 'remind', fa: 'یادآوری', icon: '⏰', words: ['یادآوری', 'یاد آوری', 'یادم بنداز'] },
  { k: 'help', fa: 'راهنما', icon: '📖', words: ['راهنما', 'کمک', 'help'] },
  { k: 'settings', fa: 'تنظیمات گروه (فقط ادمین‌های گروه)', short: 'تنظیمات گروه', icon: '⚙️', words: ['تنظیمات', 'تنظیمات ربات'] },
  { k: 'ai', fa: 'نام دستیار هوش مصنوعی', short: 'دستیار هوش مصنوعی', icon: '🤖', words: ['مایکی'] }
];
export const FEATURE_KEYS = FEATURES.map((f) => f.k);
const DEFAULTS = Object.fromEntries(FEATURES.map((f) => [f.k, f.words.slice()]));
let cfg = JSON.parse(JSON.stringify(DEFAULTS));

export const normText = (s) => String(s == null ? '' : s).toLowerCase()
  .replace(/[‌‏‎]/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[ًٌٍَُِّْ]/g, '')
  .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
  .replace(/\s+/g, ' ').trim();

export function cleanWords(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const w of list) { const x = String(w == null ? '' : w).replace(/[<>&]/g, '').replace(/\s+/g, ' ').trim().slice(0, 25); if (x.length >= 2 && !out.some((y) => normText(y) === normText(x))) out.push(x); }
  return out.slice(0, 12);
}
export const getWords = () => JSON.parse(JSON.stringify(cfg));
export const defaultWords = (k) => (DEFAULTS[k] || []).slice();
export function setWordsLocal(patch) {
  for (const k of FEATURE_KEYS) if (patch && patch[k] != null) { const l = cleanWords(patch[k]); if (l && l.length) cfg[k] = l; }
  return getWords();
}
export async function loadWords(db = sql) {
  try { const r = await db`SELECT v FROM bot_settings WHERE k = 'words_cfg'`; if (r[0] && r[0].v) { cfg = JSON.parse(JSON.stringify(DEFAULTS)); setWordsLocal(JSON.parse(r[0].v)); } }
  catch (e) { console.error('words load:', e && e.message); }
  return getWords();
}
export async function saveWords(patch, db = sql) {
  const c = setWordsLocal(patch);
  try { await db`INSERT INTO bot_settings (k, v) VALUES ('words_cfg', ${JSON.stringify(c)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`; } catch (e) { console.error('words save:', e && e.message); }
  return c;
}
export async function resetWords(k, db = sql) { cfg[k] = defaultWords(k); return saveWords({}, db); }

const POLITE = /^(?:(?:لطفا|لطفاً|سلام|ببخشید|خب|هی|آقا|ربات|بات|مایکی|الان|ممکنه|میشه|می ?شه|میتونی|می ?تونی|بگو|بده|بفرست|یه|یک|ی|اگه|اگر|خواهشا|خواهشاً|ممنون)[\s،,:!]+)+/;
// کلمه‌های پرکننده که بعد از کلمهٔ فعال‌ساز می‌تونن بیان و معنی رو عوض نمی‌کنن («نرخ دلار رو بده لطفا»)
const FILLER = new Set('ها های رو را بده بدی بدید بفرست بفرستی بگو بگی بدین لطفا لطفاً الان الآن امروز اکنون چنده چقدره چیه چقدر قیمتش نرخش میشه می‌شه میخوام می‌خوام میخام می‌خام ببینم ببینیم نشون نشونم نشونم بده؟ هم هست هستش داری دارید ممنون مرسی خواهشا ازت من ما برام برامون یه یک ی کن کنید کنی بزن بزنی'.split(' ').map(normText));
// کلمه‌های بازه که فقط برای بعضی امکانات مجازن
const MODEW = {
  news: ['امروز', 'فردا', 'هفته', 'این', 'بعد', 'بعدی', 'آینده', 'ی', 'پس', 'فردا'],
  card: ['امروز', 'هفته', 'این', 'ماه', 'سال', 'امسال', 'کل', 'همه', 'نتیجه', 'نتایج', 'من', 'ام', 'هفتگی', 'ماهانه', 'روز', 'روزانه', 'گروه'],
  rates: ['ارز', 'دلار', 'طلا', 'سکه', 'ها', 'و', 'تتر', 'یورو', 'بازار', 'آزاد'],
  crypto: ['ارز', 'دیجیتال', 'کریپتو', 'ها', 'و', 'بازار', 'بیتکوین'],
  cal: ['شمسی', 'میلادی', 'امروز', 'ماه', 'این', 'بعد', 'بعدی', 'قبل', 'قبلی', 'جاری', 'آینده', 'سال', 'امسال', 'تعطیل', 'رسمی', 'ایران', 'جهانی']
};
const clean = (arr, ok) => arr.filter((x) => x && !FILLER.has(x) && !(ok || []).includes(x));
// خروجی: { k: ویژگی, arg: باقی متن, pos: 'start'|'any'|'exact' } یا null
export function detect(text, o = {}) {
  const r = detectCore(text, o);
  if (r) return r;
  // «اخبار امروزو بده» / «نرخو بده»: «و» چسبیده به آخر کلمه (مخفف «رو») جدا می‌شه
  const t2 = String(text == null ? '' : text).split(/(\s+)/).map((x) => (/^[^\s]{3,}و$/.test(x) ? x.slice(0, -1) : x)).join('');
  return t2 !== String(text) ? detectCore(t2, o) : null;
}
function detectCore(text, { me = '', loose = false } = {}) {
  let t = normText(text);
  if (!t) return null;
  if (me) t = t.replace(new RegExp('@' + String(me).toLowerCase() + '\\b', 'g'), ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/[؟?!.،,]+$/g, '').trim();
  if (!t) return null;
  const stripped = t.replace(POLITE, '').trim() || t;
  const names = cfg.ai.map(normText);
  let best = null;
  for (const f of FEATURES) {
    if (f.k === 'ai') continue;
    const list = (cfg[f.k] || []).concat(f.k === 'rates' ? (getRatesConfig().words || []) : []);
    for (const w0 of list) {
      const w = normText(w0); if (!w) continue;
      let score = 0, arg = '', pos = 'exact';
      if (stripped === w) score = 1000 + w.length;
      else if (stripped.startsWith(w + ' ')) { score = 500 + w.length; arg = stripped.slice(w.length).trim(); pos = 'start'; }
      else if ((f.k === 'remind' || loose) && (' ' + stripped + ' ').includes(' ' + w + ' ')) { score = 100 + w.length; arg = stripped.replace(w, ' ').replace(/\s+/g, ' ').trim(); pos = 'any'; }
      if (!score) continue;
      // امکان‌هایی که ورودی آزاد ندارن: بعد از کلمه فقط پرکننده یا کلمهٔ بازه مجازه (تا «قیمت خونه چنده؟» نرخ ندیم)
      if (f.k !== 'remind' && f.k !== 'ai') {
        if (pos === 'any' && stripped.split(' ').length > 6) continue;
        if (pos !== 'exact' && stripped.split(' ').length > 8) continue;
        const rest = clean(arg.split(' '), MODEW[f.k] || []);
        if (rest.length) continue;
      }
      if (!best || score > best.score) best = { k: f.k, score, arg, rest: stripped, pos };
    }
  }
  if (best) return best;
  // نام دستیار هرجای پیام بیاد (به‌صورت کلمهٔ جدا)
  for (const n of names) { if (n && ((' ' + t + ' ').includes(' ' + n + ' ') || t.startsWith(n))) { const q = (' ' + t + ' ').replace(' ' + n + ' ', ' ').replace(new RegExp('^' + n + '[\\s،,:]*'), '').trim(); return { k: 'ai', score: 1, arg: q || '', rest: t, pos: 'name' }; } }
  return null;
}
export const newsMode = (arg) => { const a = normText(arg); return /فردا/.test(a) ? 'd1' : /بعد|آینده/.test(a) ? 'nw' : /هفته/.test(a) ? 'w' : 'd0'; };
export const aiName = () => (cfg.ai[0] || 'مایکی');
export function isAiNameOnly(text) { const t = normText(text).replace(/[؟?!.،,\s]+$/g, ''); return cfg.ai.some((n) => normText(n) === t); }

// متن راهنما: همیشه با کلمه‌های فعلی ساخته می‌شه
export function guideText({ botUser = '', flags = null, intro = true } = {}) {
  const on = (k) => !flags || flags[k] !== false;
  const lines = [];
  if (intro) lines.push('<b>🤖 راهنمای ربات Surpri3eFX</b>\nدستیار ترید، نرخ‌ها، اخبار و ژورنال. فقط کافیه کلمه‌های زیر رو توی گروه یا پیوی بنویسی:\n');
  const show = (f, words) => '• ' + f.icon + ' <b>' + f.short_ + '</b>: ' + words.slice(0, 4).map((w) => '«' + w + '»').join(' یا ');
  for (const f of FEATURES) {
    if (f.k === 'ai') continue;
    if (['rates', 'crypto'].includes(f.k) && flags && flags.rates === false) continue;
    if (f.k === 'news' && !on('news')) continue;
    if (f.k === 'sess' && !on('sess')) continue;
    lines.push(show(Object.assign({}, f, { short_: f.short || f.fa }), cfg[f.k]));
  }
  if (on('ai')) lines.push('• 🤖 <b>مایکی (دستیار هوش مصنوعی)</b>: اسم «' + cfg.ai[0] + '» رو بنویس و سؤالت رو بپرس، یا روی پیام‌هام ریپلای بزن. دربارهٔ هر موضوعی جواب می‌دم و به قیمت‌ها و اخبار سایت دسترسی دارم.');
  lines.push('\n💡 <b>نکته</b>: ربات رو <b>ادمین گروه</b> کن (دسترسی ارسال پیام و حذف پیام) تا همه‌چیز درست و بدون مشکل کار کنه.');
  if (botUser) lines.push('✉️ برای ثبت معامله و ژورنال شخصی، به @' + String(botUser).replace(/^@/, '') + ' پیام بده.');
  return lines.join('\n');
}
export { matchRatesWord };

// END-OF-FILE lib/words.js
