// دستیار هوش مصنوعی (Groq یا Gemini) برای سایت، پیوی ربات و گروه‌ها: تنظیمات مرکزی، سقف‌ها و فراخوانی.
// کلید فقط از متغیر محیطی GROQ_API_KEY یا GEMINI_API_KEY خونده می‌شه (روی Render)؛ هیچ‌جا توی دیتابیس یا لاگ نوشته نمی‌شه.
import { sql } from './db.js';
import { extraProviders, callExtra, noteExtra, extraInfo } from './models.js';
import { calcSafe } from './calc.js';
import { MEMORY_PROMPT, parseMemOps } from './memory.js';
import { SKILL_IDS, detectSkills, planFor, CALC_PROMPT, REVIEW_PROMPT } from './skills.js';

export const AI_NAME = 'مایکی';
export const BASE_PROMPT = `تو «مایکی» هستی؛ یه دستیار هوشمند همه‌فن‌حریف و جامع، باهوش، خوش‌برخورد و دقیق که فارسی صحبت می‌کنه.
تو فقط یه دستیار مالی یا ترید نیستی: دربارهٔ هر موضوعی (علم، فناوری، برنامه‌نویسی، پزشکی و سلامت عمومی، حقوق و زندگی روزمره، آموزش و درس، سفر، آشپزی، سرگرمی، متن‌نویسی، ترجمه، تحلیل فایل و عکس، ریاضی، هنر و…) راحت و کامل جواب می‌دی و بازار و ترید (فارکس، کریپتو، طلا، شاخص، ریسک) فقط یکی از بلدی‌هاته. هیچ موضوعی رو به‌خاطر ربط نداشتن به ترید رد نکن.
معرفی خودت: وقتی ازت می‌پرسن کی هستی یا چی کار می‌کنی، خیلی کوتاه و خودمونی بگو «مایکی‌ام، یه دستیار هوشمند همه‌کاره» و چندتا نمونهٔ متنوع از کارهات (جواب به هر سؤال، تحقیق با جستجوی وب، نوشتن و ترجمه، کدنویسی، تحلیل فایل و عکس، بازار و ترید…) بگو؛ هیچ‌وقت خودت رو «دستیار مالی» یا «دستیار ترید» معرفی نکن و ترید رو توی جواب‌های نامربوط یا معرفی تکرار نکن.
قوانین نوشتن:
- فقط جواب بده. سؤال رو تکرار نکن، مقدمه و «حتماً»، «البته» و جملهٔ آخر تعارفی ننویس.
- لحن گرم و طبیعی و محاوره‌ای-محترمانه؛ نه رباتی و نه رسمی. اصطلاحات تخصصی (TP, SL, RR, Drawdown, ETF …) رو انگلیسی بنویس.
- خوانا و تمیز بنویس: یه تیتر کوتاه بولد (با **دو ستاره**) همراه یه ایموجی مرتبط، بعد چند بخش کوتاه یا بولت با «•»؛ بین بخش‌ها یه خط خالی. ایموجی کم و بجا (۳ تا ۶ تا در کل)، نه روی هر خط. جدول و متن‌های دیوار‌مانند ننویس.
- کلمه‌های کلیدی و عددهای مهم رو هم بولد کن. هیچ تگ HTML ننویس. جواب ساده و کوتاه، کوتاه باشه؛ جواب پیچیده، منظم و کامل ولی بدون حاشیه.
- اعداد و قیمت‌ها رو هیچ‌وقت از حافظه نگو. اگه «اطلاعات زندهٔ سایت» پایین پیام اومده، قیمت و اخبار رو فقط از همون بگو؛ برای چیزهای دیگهٔ روز (اخبار، رویدادها، آمار) از جستجو استفاده کن و اگه مطمئن نیستی صادقانه بگو.
- سیگنال قطعی نده و سود تضمین نکن، ولی تحلیل و نظر کارشناسی‌ات رو راحت و شفاف بگو.
- هیچ‌وقت هشدار یا سلب مسئولیت اضافه نکن: نه «توصیه مالی نیست»، نه «فقط برای اطلاع‌رسانی است»، نه «با مشاور مالی مشورت کن»، نه «ریسک داره، مسئولیتش با خودته»؛ کاربر بزرگسال و آگاهه و این جمله‌ها فقط ربات رو بی‌ارزش نشون می‌دن.
- قبل از جواب خوب فکر کن؛ ریاضی، منطق و تاریخ‌ها رو قدم‌به‌قدم و دقیق چک کن و اگه جوابت با چک دوم نمی‌خونه، اصلاحش کن.
- مثل یه متخصص ارشد فکر کن: هدف واقعی کاربر رو از پشت جملهٔ کوتاه یا غلط‌دار یا محاوره‌ای بفهم، به‌جای سؤال اضافه بهترین برداشت رو انتخاب کن و جواب کامل بده. فقط وقتی واقعاً دو معنی کاملاً متفاوت داره و اشتباه گرفتنش گرون تموم می‌شه، یه سؤال کوتاه بپرس.
- زمینهٔ گفتگو (پیام‌های قبلی، پیام ریپلای‌شده، «محیط»ی که پایین پیام اومده، ژورنال و اطلاعات زنده) رو حتماً استفاده کن؛ اگه کاربر می‌گه «این»، «اون»، «همونو» یعنی از زمینه بفهم.
- کاربر عکس فرستاده؟ عکس رو دقیق نگاه کن: متنش رو بخون (OCR)، اگه خواست ترجمه کن، اگه چارت/نمودار بود تحلیل فنی کن (روند، سطوح، الگو)، اگه چیز دیگه‌ایه توضیح بده.
- جواب رو با عمق متناسب بده: سؤال ساده کوتاه، سؤال سخت با استدلال و مثال و مرحله؛ پیشنهاد عملی و قدم بعدی بده.
- جواب مرتب و یکپارچه: اول مستقیم به همون چیزی که پرسیده جواب بده (یک تا دو جمله)، بعد توضیح رو منظم و با ترتیب منطقی بیار. هر بولت یا بخش فقط یک نکته داره؛ تکرار، پرش بین موضوع‌ها و نکتهٔ بی‌ربط نیار. جمله‌ها کامل و روان باشن (نه تکه‌تکه و بریده)؛ فارسی و انگلیسی رو توی یک جمله قاطی نکن مگه اسم و اصطلاح تخصصی باشه. اگه چند حالت یا گزینه هست، دسته‌بندی‌شون کن و تفاوتشون رو روشن بگو.
- قبل از فرستادن، یک بار جوابت رو مثل خواننده بخون: اگه پراکنده، تکراری یا ناقص بود مرتبش کن؛ فقط نسخهٔ نهایی و تمیز رو بنویس، نه پیش‌نویس.
- اگه کاربر چند سؤال توی یک پیام پرسیده، به همه جواب بده و به ترتیب خودش شماره‌گذاری کن.
- شخصیت: صادق و مستقیم باش، چاپلوسی و تعریف الکی نکن؛ اگه کاربر اشتباه می‌کنه مودبانه و با دلیل بگو. میزان اطمینانت رو وقتی مهمه توی یک جمله بگو (مثلاً «حدود ۷۰٪ مطمئنم چون…»). چیزی که نمی‌دونی رو نساز؛ بگو نمی‌دونم و بهترین راه پیدا کردنش رو بگو. اگه خودت اشتباه کردی رک بگو و درستش کن. سؤال روشن‌کننده فقط وقتی بپرس که بدون جوابش جواب درست ممکن نیست.
- اگه موضوع احتمال اشتباه یا خطر واقعی داره (مثل حجم معامله‌ی خیلی بزرگ نسبت به بالانس) نظر صادقانه‌ات رو یک بار و مختصر بگو؛ بدون موعظه و بدون هشدارهای تکراری.`;
const GROUP_PROMPT = '\n\nاین جواب توی یه گروه تلگرام فرستاده می‌شه: جمع‌وجور بنویس (حداکثر حدود ۱۵۰ کلمه)، بدون جدول.';
const PRIVATE_PROMPT = '\n\nاین جواب توی چت تلگرام فرستاده می‌شه: حداکثر حدود ۲۵۰ کلمه (مگر اینکه کاربر تفصیل خواسته)، بدون جدول.';

// اطلاعات زندهٔ سایت/ربات (قیمت‌ها، اخبار، سشن‌ها) که از بیرون تزریق می‌شه
let ctxProvider = null, ctxCache = { at: 0, text: '' };
export function setContextProvider(fn) { ctxProvider = typeof fn === 'function' ? fn : null; ctxCache = { at: 0, text: '' }; }
export async function liveContext() {
  if (!ctxProvider) return '';
  if (Date.now() - ctxCache.at < 60000) return ctxCache.text;
  try { const t = String(await ctxProvider() || '').slice(0, 3500); ctxCache = { at: Date.now(), text: t }; return t; }
  catch (e) { console.error('ai ctx:', e && e.message); return ctxCache.text; }
}
const SEARCH_RE = /امروز|الان|اکنون|اخیر|آخرین|جدید|فعلی|همین|هفته|ماه|سال|۲۰۲|202\d|قیمت|نرخ|خبر|چه ?خبر|چخبر|وضعیت|رئیس|نتیجه|فینال|بازی|لیگ|انتخابات|جنگ|تحریم|دلار|یورو|طلا|سکه|بیتکوین|بیت ?کوین|اتریوم|کریپتو|بورس|سهام|latest|news|price|today|current|now|who is|release|update/i;
// حذف جمله‌های هشدار/سلب مسئولیت که مدل با وجود دستور پرامپت گاهی اضافه می‌کنه
const DISC_RE = /توصیه[\s\u200c]*(ی\s*)?(مالی|سرمایه|معاملاتی)|(فقط|صرفاً|تنها)\s*(برای|جهت)\s*(اطلاع|آگاهی|آشنایی)|اطلاع[\s\u200c]*رسانی\s*(است|می[\s\u200c]*باشد)|سلب\s*مسئولیت|مسئولیت\s*(معاملات|ضرر|سود|تصمیم|هرگونه)[^.\n]*(با\s*(خودتان|خودت|شما|خود)|بر\s*عهد)|مشاور\s*(مالی|سرمایه)|not\s+(a\s+)?financial\s+advice|\bNFA\b|\bDYOR\b/i;
export function stripDisclaimers(text) {
  let t = String(text == null ? '' : text);
  t = t.replace(/[(（\[«][^()（）\[\]«»\n]*[)）\]»]/g, (m) => (DISC_RE.test(m) ? '' : m));
  const lines = t.split('\n').map((ln) => {
    if (!DISC_RE.test(ln)) return ln;
    const parts = ln.split(/(?<=[.!؟?؛])\s+/).filter((x) => !DISC_RE.test(x));
    return parts.join(' ');
  });
  return lines.join('\n').replace(/[ \t]{2,}/g, ' ')
    .replace(/(^|\n)[\s*_\p{Extended_Pictographic}\u200d\ufe0f—–-]+(?=\n|$)/gu, (m, a) => (/\p{L}|\p{N}/u.test(m) ? m : a)).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// ترجیح هر کاربر برای جستجو و عمق تفکر مایکی (ذخیره در bot_settings)؛ '' یعنی تنظیم کلی ادمین
const prefCache = new Map();
const cleanPref = (p) => ({ search: ['auto', 'always', 'off'].includes(p && p.search) ? p.search : '', think: ['auto', 'low', 'medium', 'high'].includes(p && p.think) ? p.think : '' });
export async function getAiPref(uid, db = sql) {
  const k = String(uid), c = prefCache.get(k);
  if (c && Date.now() - c.at < 600000) return c.v;
  let v = cleanPref({});
  try { const r = await db`SELECT v FROM bot_settings WHERE k = ${'aipref:' + k}`; if (r[0] && r[0].v) v = cleanPref(JSON.parse(r[0].v)); } catch (e) { /* ignore */ }
  prefCache.set(k, { v, at: Date.now() }); return v;
}
export async function setAiPref(uid, patch, db = sql) {
  const k = String(uid), cur = await getAiPref(k, db), v = cleanPref(Object.assign({}, cur, patch || {}));
  prefCache.set(k, { v, at: Date.now() });
  try { await db`INSERT INTO bot_settings (k, v) VALUES (${'aipref:' + k}, ${JSON.stringify(v)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`; } catch (e) { console.error('ai pref save:', e && e.message); }
  return v;
}
// عمق تفکر خودکار: سلام و سؤال کوتاه سریع، تحلیل/محاسبه/کد/مقایسه عمیق
const DEEP_RE = /تحلیل|محاسبه|حساب کن|چرا|مقایسه|استراتژی|برنامه|کد|اسکریپت|اثبات|بهینه|ریسک|بک ?تست|پیش ?بینی|سناریو|توضیح بده|فرق|بررسی|ترجمه|analy|compar|code|prove|explain|strategy|optimi|why/i;
export function resolveThink(v, q, nImgs = 0) {
  if (['low', 'medium', 'high'].includes(v)) return v;
  const t = String(q || '').trim();
  if (nImgs) return 'medium';
  if (t.length <= 18 && !DEEP_RE.test(t)) return 'low';
  if (t.length > 260 || (DEEP_RE.test(t) && t.length > 40) || /[0-9۰-۹]+\s*[-+*/×÷^%]\s*[0-9۰-۹]+/.test(t)) return 'high';
  return 'medium';
}
// «جستجوی عمیق»: توی حالت خودکار تقریباً هر سؤال واقعی/دانشی جستجو می‌شه؛ فقط سلام و تشکر، ترجمه، کد، محاسبه، نوشتن خلاق، بازی و دستورهای ربات (یادآوری/حافظه) بدون جستجو جواب داده می‌شن.
const CHAT_RE = /^(سلام|درود|هی|های|hi|hello|hey|مرسی|ممنون|تشکر|خوبی|چطوری|خداحافظ|باشه|اوکی|ok|okay|آره|نه|بله|خب|عالی|دمت گرم|قربونت|دستت درد نکنه|مچکر|فدات)(\s|[!.؟?،,…]|$)/i;
const SKIP_RE = /ترجمه|translate|ویرایش|بازنویسی|rewrite|```|اسکریپت|(کد|برنامه|تابع|اندیکاتور|اکسپرت)\s*(بنویس|بزن|بساز)|معما|چیستان|بیا بازی|بازی کنیم|حساب کن|محاسبه کن|لات (چند|چقدر)|[0-9۰-۹]+\s*[-+*/×÷^%]\s*[0-9۰-۹]+|یادم بنداز|یادآوری|یادت باشه|فراموش کن|شعر بگو|داستان بنویس|جوک|لطیفه|ایده (بده|بزن)|اسم (بذار|پیشنهاد)|خودت رو معرفی|تو کی هستی|تو کی‌?ای|اسمت چیه|خلاصه ?(کن|ش کن)|ژورنال/i;
const ASKY_RE = /[؟?]|چیست|چیه|چرا|چطور|چگونه|چه ?(کسی|جوری|زمانی|وقت)|کی\b|کجا|کدوم|چند|آیا|معنی|فرق|تفاوت|بهترین|مقایسه|توضیح|درباره|دربارهٔ|راجع|تاریخچه|معرفی|پیشنهاد|بررسی|راهنما|روش|مزایا|معایب|\b(who|what|why|how|when|where|which|best|vs|compare|review)\b/i;
export function needsSearch(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (SEARCH_RE.test(t)) return !(SKIP_RE.test(t) && !/خبر|قیمت|نرخ/.test(t));
  if (t.length < 18 || CHAT_RE.test(t) || SKIP_RE.test(t)) return false;
  return ASKY_RE.test(t) || t.length > 60;
}
export const DEEP_SEARCH_PROMPT = `

--- جستجوی عمیق (برای این پیام فعاله) ---
برای این سؤال حتماً از جستجوی وب استفاده کن و از حافظهٔ خودت جواب نده؛ دانسته‌های خودت فقط برای فهمیدن سؤال و چیدن نتایج به کار می‌ره. چند جستجوی مختلف انجام بده (کلیدواژه‌های فارسی و انگلیسی، زاویه‌های متفاوت)، حداقل ۲ تا ۳ منبع مستقل رو بخون و با هم مقایسه کن. اگه منابع با هم تناقض داشتن، بگو و معتبرترش (رسمی، تازه‌تر، تخصصی) رو انتخاب کن؛ تاریخ منبع رو در نظر بگیر. جواب نهایی رو یکپارچه و مرتب با زبان خودت بنویس (نه کپی تکه‌تکهٔ منابع) و آخرش یک خط «منابع: …» با اسم سایت‌ها (و لینک اگه داری) بذار. اگه جستجو چیزی پیدا نکرد یا مطمئن نیستی، صادقانه بگو و حدس رو حقیقت جلوه نده.`;
const DEFAULTS = {
  site: true, private: true, group: true, memory: true, // کجا فعاله؛ حافظهٔ شخصی مایکی
  siteDaily: 60, privateDaily: 40,                // سقف روزانهٔ هر کاربر
  groupUserDaily: 10, groupDaily: 60,             // گروه: هر کاربر در روز و کل گروه در روز
  groupCooldown: 20, privateCooldown: 3,          // ثانیه بین دو سؤال پشت‌سرهم
  groupTrigger: 'mention',                        // cmd = فقط /ai ، mention = /ai و منشن و ریپلای به ربات
  search: 'auto', think: 'auto',               // جستجوی وب: auto|always|off ، عمق تفکر: low|medium|high
  model: '', prompt: '',
  skillsOff: [], review: 'auto'                   // اسکیل‌های خاموش‌شده ؛ بازبینی پاسخ توسط مدل دوم: auto|off
};
const LIMITS = { siteDaily: [1, 1000], privateDaily: [1, 1000], groupUserDaily: [1, 200], groupDaily: [1, 2000], groupCooldown: [0, 3600], privateCooldown: [0, 600] };
let cfg = Object.assign({}, DEFAULTS);

export const getAiConfig = () => Object.assign({}, cfg);
export function cleanAiConfig(p) {
  const o = {};
  for (const k of ['site', 'private', 'group', 'memory']) if (p[k] != null) o[k] = !!p[k];
  for (const k of Object.keys(LIMITS)) if (p[k] != null) { const n = Math.round(Number(p[k])); if (Number.isFinite(n)) o[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], n)); }
  if (p.groupTrigger != null && ['cmd', 'mention'].includes(p.groupTrigger)) o.groupTrigger = p.groupTrigger;
  if (p.search != null && ['auto', 'always', 'off'].includes(p.search)) o.search = p.search;
  if (p.think != null && ['auto', 'low', 'medium', 'high'].includes(p.think)) o.think = p.think;
  if (Array.isArray(p.skillsOff)) o.skillsOff = p.skillsOff.filter((x) => SKILL_IDS.includes(x));
  if (p.review != null && ['auto', 'off'].includes(p.review)) o.review = p.review;
  if (p.model != null) { const m = String(p.model).trim(); if (m === '' || /^[A-Za-z0-9._\/:-]{3,60}$/.test(m)) o.model = m; }
  if (p.prompt != null) o.prompt = String(p.prompt).slice(0, 500);
  return o;
}
export async function loadAiConfig(db = sql) {
  try {
    const r = await db`SELECT v FROM bot_settings WHERE k = 'ai_cfg'`;
    if (r[0] && r[0].v) cfg = Object.assign({}, DEFAULTS, cleanAiConfig(JSON.parse(r[0].v)));
  } catch (e) { console.error('ai cfg load:', e && e.message); }
  return getAiConfig();
}
export async function setAiConfig(patch, db = sql) {
  if (patch && patch.model != null) autoModel = ''; // مدل دستی عوض شد: انتخاب خودکار قبلی کنار می‌ره
  cfg = Object.assign({}, cfg, cleanAiConfig(patch || {}));
  try { await db`INSERT INTO bot_settings (k, v) VALUES ('ai_cfg', ${JSON.stringify(cfg)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`; }
  catch (e) { console.error('ai cfg save:', e && e.message); }
  return getAiConfig();
}

const isGsk = (k) => /^gsk_/.test(String(k || '').trim());
// اگه کلید Groq (gsk_...) اشتباهی توی متغیر GEMINI_API_KEY گذاشته شده باشه هم، به‌عنوان Groq شناخته می‌شه
const keyOf = () => { const k = String(process.env.GEMINI_API_KEY || '').trim(); return isGsk(k) ? '' : k; }; // کلید Gemini
// استخر کلیدهای Groq: کلید اصلی + کلیدهای اضافه (GROQ_API_KEYS، جدا شده با ویرگول). هر کلید از یک حساب جداست و سهمیهٔ خودش رو داره.
export const groqKeys = () => {
  const out = [], add = (k) => { k = String(k || '').trim(); if (/^gsk_[A-Za-z0-9_-]{16,}$/.test(k) && !out.includes(k)) out.push(k); };
  add(process.env.GROQ_API_KEY);
  const g = String(process.env.GEMINI_API_KEY || '').trim(); if (isGsk(g)) add(g);
  String(process.env.GROQ_API_KEYS || '').split(/[\s,،;]+/).forEach(add);
  return out;
};
const groqKey = () => groqKeys()[0] || ''; // کلید Groq (اگه باشه اولویت داره)
export const groqExtraKeys = () => { const out = []; String(process.env.GROQ_API_KEYS || '').split(/[\s,،;]+/).forEach((k) => { k = k.trim(); if (/^gsk_[A-Za-z0-9_-]{16,}$/.test(k) && !out.includes(k)) out.push(k); }); return out; };
export const maskKey = (k) => 'gsk_…' + String(k || '').slice(-4);
const kst = new Map(); // key -> { ok, busy, bad, badUntil }
const kstat = (k) => { let s = kst.get(k); if (!s) { s = { ok: 0, busy: 0, bad: 0, badUntil: 0 }; kst.set(k, s); } return s; };
const cool = new Map(); // key|model -> زمان آزاد شدن بعد از ۴۲۹
let rr = 0;
export function groqPoolInfo() { const t = Date.now(); return groqKeys().map((k, i) => { const s = kstat(k); return { i, tail: maskKey(k), ok: s.ok, busy: s.busy, bad: s.bad, disabled: s.badUntil > t }; }); }
export const _resetPool = () => { kst.clear(); cool.clear(); rr = 0; };
export const hasKey = () => !!(groqKey() || keyOf() || extraProviders().length);
export const activeProvider = () => (groqKey() ? 'groq' : keyOf() ? 'gemini' : (extraProviders()[0] || {}).id || '');
export const keyKind = (k) => (/^gsk_/.test(String(k || '').trim()) ? 'groq' : 'gemini');
export const envNameFor = (kind) => (kind === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY');
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_DEFAULT = 'openai/gpt-oss-120b';
const groqModel = () => (cfg.model && !/^gemini/i.test(cfg.model) ? cfg.model : '') || process.env.GROQ_MODEL || GROQ_DEFAULT;
let autoModel = ''; // اگه مدل پیش‌فرض وجود نداشت، خودکار از فهرست خود گوگل انتخاب می‌شه
const geminiModel = () => autoModel || (cfg.model && (/^gemini/i.test(cfg.model) || !groqKey()) ? cfg.model : '') || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
export const geminiModelName = () => geminiModel();
export const groqModelName = () => groqModel();
export const currentModel = () => (groqKey() ? groqModel() : keyOf() ? geminiModel() : (extraProviders()[0] || {}).model || '');
const endpoint = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
export function aiStatus() {
  return { keys: groqKeys().length, key: hasKey(), providers: providerIds(), extras: extraInfo(), pdf: providerList().some((p) => p.pdf), review: cfg.review, provider: activeProvider(), model: currentModel(), site: !!cfg.site, private: !!cfg.private, group: !!cfg.group, on: { site: hasKey() && cfg.site, private: hasKey() && cfg.private, group: hasKey() && cfg.group } };
}

// ---------- سقف‌ها (توی حافظه؛ با ری‌استارت سرور صفر می‌شن) ----------
const tehDay = (ms = Date.now()) => new Date(ms + 12600000).toISOString().slice(0, 10);
const counts = new Map(), lastAt = new Map(), warned = new Set();
setInterval(() => { const d = tehDay(); for (const k of [...counts.keys()]) if (!k.endsWith('|' + d)) counts.delete(k); for (const k of [...warned]) if (!k.endsWith('|' + d)) warned.delete(k); const t = Date.now() - 3600e3; for (const [k, v] of lastAt) if (v < t) lastAt.delete(k); }, 3600e3).unref();
const ck = (scope, id) => scope + ':' + id + '|' + tehDay();
const n0 = (k) => counts.get(k) || 0;
// scope: site | private | group؛ uid: شناسهٔ کاربر؛ chatId: فقط برای گروه
export function checkAi(scope, uid, chatId, unlimited = false) {
  if (!hasKey()) return { ok: false, reason: 'off' };
  if (!cfg[scope]) return { ok: false, reason: 'disabled' };
  if (unlimited) return { ok: true, unlimited: true }; // ادمین: بدون سقف و بدون فاصله
  const now = Date.now();
  if (scope === 'group') {
    if (n0(ck('g', chatId)) >= cfg.groupDaily) return { ok: false, reason: 'group_daily' };
    if (n0(ck('gu', chatId + ':' + uid)) >= cfg.groupUserDaily) return { ok: false, reason: 'daily' };
    if (now - (lastAt.get('g:' + chatId + ':' + uid) || 0) < cfg.groupCooldown * 1000) return { ok: false, reason: 'cooldown' };
  } else if (scope === 'private') {
    if (n0(ck('p', uid)) >= cfg.privateDaily) return { ok: false, reason: 'daily' };
    if (now - (lastAt.get('p:' + uid) || 0) < cfg.privateCooldown * 1000) return { ok: false, reason: 'cooldown' };
  } else if (n0(ck('s', uid)) >= cfg.siteDaily) return { ok: false, reason: 'daily' };
  return { ok: true };
}
// شمارنده‌ها توی دیتابیس هم نوشته می‌شن تا با ری‌استارت سرور (Render) صفر نشن
const saveCount = (k, db = sql) => { const day = k.split('|')[1]; Promise.resolve(db`INSERT INTO ai_usage (k, n, day) VALUES (${k}, ${n0(k)}, ${day}) ON CONFLICT (k) DO UPDATE SET n = EXCLUDED.n`).catch((e) => console.error('ai usage save:', e && e.message)); };
export async function loadAiUsage(db = sql) {
  try {
    const day = tehDay();
    const rows = await db`SELECT k, n FROM ai_usage WHERE day = ${day}`;
    for (const r of rows) counts.set(r.k, Math.max(n0(r.k), Number(r.n) || 0));
    await db`DELETE FROM ai_usage WHERE day < ${day}`;
  } catch (e) { console.error('ai usage load:', e && e.message); }
}
function bump(scope, uid, chatId, unlimited = false) {
  if (unlimited) return;
  const inc = (k) => { counts.set(k, n0(k) + 1); saveCount(k); };
  if (scope === 'group') { inc(ck('g', chatId)); inc(ck('gu', chatId + ':' + uid)); lastAt.set('g:' + chatId + ':' + uid, Date.now()); }
  else if (scope === 'private') { inc(ck('p', uid)); lastAt.set('p:' + uid, Date.now()); }
  else inc(ck('s', uid));
}
// جمع مصرف امروز (برای پنل ادمین)
export function aiTotals() {
  const d = tehDay(); let site = 0, priv = 0, grp = 0;
  for (const [k, n] of counts) { if (!k.endsWith('|' + d)) continue; if (k.startsWith('s:')) site += n; else if (k.startsWith('p:')) priv += n; else if (k.startsWith('g:')) grp += n; }
  return { site, private: priv, group: grp, total: site + priv + grp };
}
export function leftAi(scope, uid, chatId, unlimited = false) {
  if (unlimited) return null;
  if (scope === 'group') return Math.max(0, cfg.groupUserDaily - n0(ck('gu', chatId + ':' + uid)));
  if (scope === 'private') return Math.max(0, cfg.privateDaily - n0(ck('p', uid)));
  return Math.max(0, cfg.siteDaily - n0(ck('s', uid)));
}
// پیام «سقفت پر شد» رو فقط یک بار در روز برای هر نفر بفرست
export function shouldWarn(scope, uid, chatId) { const k = 'w:' + scope + ':' + chatId + ':' + uid + '|' + tehDay(); if (warned.has(k)) return false; warned.add(k); return true; }

// ---------- فراخوانی Gemini ----------
// علت خطای گوگل رو به یک کد قابل‌فهم تبدیل می‌کنه (تا ادمین بدونه کلید مشکل داره یا مدل یا منطقه)
function classify(status, txt) {
  const s = String(txt || '');
  if (status === 429) return 'ai_busy';
  if (status === 404) return 'ai_model';
  if (status === 401 || status === 403 || (status === 400 && /API[_ ]?KEY|api key not valid/i.test(s))) return /location|region|not supported/i.test(s) ? 'ai_region' : 'ai_key';
  return 'ai_failed';
}
// بهترین مدل flash پایدار از فهرست گوگل (فقط وقتی مدل فعلی پیدا نشد)
async function pickModel() {
  const v = await verifyKey(keyOf());
  if (!v.ok || !v.models || !v.models.length) return '';
  const ok = v.models.filter((m) => /flash/.test(m) && !/(lite|image|tts|live|audio|thinking|exp|embedding|robotics|computer)/.test(m));
  const ver = (m) => { const x = /gemini-(\d+(?:\.\d+)?)/.exec(m); return x ? parseFloat(x[1]) : 0; };
  ok.sort((a, b) => (/preview/.test(a) ? 1 : 0) - (/preview/.test(b) ? 1 : 0) || ver(b) - ver(a));
  return ok[0] || '';
}
const THINK_G = { low: 'low', medium: 'medium', high: 'high' };
async function callOnce({ system, contents, maxTokens = 1500, temperature = 0.7, timeoutMs = 45000, _model, search = false, think = 'low' }) {
  const key = keyOf();
  if (!key) { const e = new Error('ai_off'); e.code = 'ai_off'; throw e; }
  const payload = (thinking, srch) => Object.assign({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: Object.assign({ temperature, maxOutputTokens: maxTokens + (thinking ? 1500 : 0) }, thinking ? { thinkingConfig: { thinkingLevel: THINK_G[think] || 'low' } } : {}) }, srch ? { tools: [{ google_search: {} }] } : {});
  const call = async (thinking, srch) => {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeoutMs);
    try { return await fetch(endpoint(_model || geminiModel()), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload(thinking, srch)), signal: ac.signal }); }
    finally { clearTimeout(to); }
  };
  let r;
  try { r = await call(true, search); if (r.status === 400) r = await call(false, search); if (r.status === 400 && search) r = await call(false, false); }
  catch (e) { const er = new Error('ai_timeout'); er.code = 'ai_timeout'; throw er; }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('gemini error', r.status, geminiModel(), String(t).split(key).join('[KEY]').slice(0, 300));
    const code = classify(r.status, t);
    const er = new Error(code); er.code = code; er.status = r.status; throw er;
  }
  const j = await r.json();
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const reply = parts.filter((p) => p && typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
  if (!reply) { const er = new Error('ai_empty'); er.code = 'ai_empty'; throw er; }
  return reply;
}
const GEMINI_CANDIDATES = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
export async function callGemini(opts) {
  try { return await callOnce(opts); }
  catch (e) {
    if (e.code !== 'ai_model' || opts._retried) throw e;
    const before = geminiModel();
    // اول از فهرست خود گوگل، بعد چند اسم رایج امتحان می‌شه تا یکی جواب بده
    const tries = [];
    try { const m = await pickModel(); if (m) tries.push(m); } catch (x) { /* ignore */ }
    for (const m of GEMINI_CANDIDATES) if (!tries.includes(m)) tries.push(m);
    for (const m of tries) {
      if (m === before) continue;
      try { const r = await callOnce(Object.assign({}, opts, { _model: m })); autoModel = m; console.error('gemini model fallback:', before, '->', m); return r; }
      catch (e2) { if (e2.code !== 'ai_model') throw e2; }
    }
    throw e;
  }
}
// ---------- فراخوانی Groq (قالب OpenAI) ----------
function classifyGroq(status, txt) {
  const s = String(txt || '');
  if (status === 429) return 'ai_busy';
  if (status === 401 || status === 403) return 'ai_key';
  if (status === 404 || (status === 400 && /model_not_found|decommissioned|does not exist|not supported/i.test(s))) return 'ai_model';
  return 'ai_failed';
}
const isGptOss = (m) => /gpt-oss/i.test(m);
// مدل بینایی Groq (برای تحلیل و ترجمهٔ عکس)؛ با GROQ_VISION_MODEL می‌شه عوضش کرد
export const groqVisionModel = () => String(process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct').trim();
const GROQ_FALLBACKS = ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile'];
async function groqRequest(model, { system, contents, maxTokens, temperature, timeoutMs }, { effort, search }, key) {
  const messages = [{ role: 'system', content: system }].concat((contents || []).map((c) => {
    const txt = (c.parts || []).map((p) => p.text || '').join(''), imgs = (c.parts || []).filter((p) => p.inlineData);
    if (!imgs.length) return { role: c.role === 'model' ? 'assistant' : 'user', content: txt };
    return { role: 'user', content: [{ type: 'text', text: txt || 'این عکس رو بررسی کن.' }].concat(imgs.map((p) => ({ type: 'image_url', image_url: { url: 'data:' + p.inlineData.mimeType + ';base64,' + p.inlineData.data } }))) };
  }));
  const body = { model, messages, temperature, max_completion_tokens: maxTokens + (effort ? (effort === 'high' ? 2500 : effort === 'medium' ? 1200 : 600) : 0) };
  if (effort) body.reasoning_effort = effort;
  if (search) body.tools = [{ type: 'browser_search' }];
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeoutMs + (search ? 25000 : 0));
  let r;
  try { r = await fetch(GROQ_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal: ac.signal }); }
  catch (e) { const er = new Error('ai_timeout'); er.code = 'ai_timeout'; throw er; }
  finally { clearTimeout(to); }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('groq error', r.status, model, String(t).split(key).join('[KEY]').slice(0, 300));
    const er = new Error(classifyGroq(r.status, t)); er.code = er.message; er.status = r.status; er.body = t; throw er;
  }
  const j = await r.json();
  const reply = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
  if (!reply) { const er = new Error('ai_empty'); er.code = 'ai_empty'; throw er; }
  return reply;
}
// یک مدل: با جستجو/تفکر امتحان می‌کنه و اگه مدل قابلیت رو پشتیبانی نکرد بدون اون دوباره می‌فرسته
async function groqModelCall(model, o, want, key) {
  const oss = isGptOss(model);
  const tries = [];
  if (oss) { if (want.search) tries.push({ effort: want.think, search: true }); tries.push({ effort: want.think, search: false }); tries.push({ effort: '', search: false }); }
  else tries.push({ effort: '', search: false });
  let last;
  for (const t of tries) {
    try { return await groqRequest(model, o, t, key); }
    catch (e) { last = e; if (e.code === 'ai_empty' || e.status === 400 || e.code === 'ai_timeout' && t.search) continue; throw e; }
  }
  throw last;
}
export async function callGroq(opts = {}) {
  const keys = groqKeys();
  if (!keys.length) { const e = new Error('ai_off'); e.code = 'ai_off'; throw e; }
  const o = { system: opts.system, contents: opts.contents, maxTokens: opts.maxTokens || 1500, temperature: opts.temperature == null ? 0.7 : opts.temperature, timeoutMs: opts.timeoutMs || 45000 };
  const want = { search: !!opts.search, think: opts.think || 'low' };
  const hasImg = (opts.contents || []).some((c) => (c.parts || []).some((p) => p.inlineData));
  const main = hasImg ? groqVisionModel() : groqModel();
  const chain = hasImg ? [main] : [main].concat(GROQ_FALLBACKS.filter((m) => m !== main));
  if (hasImg) want.search = false;
  let last = null, anyKeyBad = false;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i], t = Date.now();
    // کلیدها به‌نوبت (round-robin)؛ کلیدی که الان ۴۲۹ خورده یا خراب بوده کنار می‌ره
    const start = rr++ % keys.length;
    const order = keys.slice(start).concat(keys.slice(0, start)).filter((k) => kstat(k).badUntil <= t && (cool.get(k + '|' + model) || 0) <= t);
    let modelGone = false;
    for (const key of order) {
      try { const r = await groqModelCall(model, o, want, key); kstat(key).ok++; return r; }
      catch (e) {
        last = e;
        if (e.code === 'ai_key') { const s = kstat(key); s.bad++; if (keys.length > 1) s.badUntil = Date.now() + 10 * 60e3; anyKeyBad = true; console.error('groq key rejected:', maskKey(key)); continue; }
        if (e.code === 'ai_busy') { kstat(key).busy++; if (keys.length > 1) cool.set(key + '|' + model, Date.now() + 30e3); continue; }
        if (e.code === 'ai_model') { modelGone = true; break; }
        if (e.code === 'ai_empty') continue;
        throw e; // timeout و خطاهای دیگه: بی‌فایده است کلید یا مدل عوض بشه
      }
    }
    if (i < chain.length - 1 && (modelGone || !order.length || (last && (last.code === 'ai_busy' || last.code === 'ai_empty')))) { console.error('groq model fallback:', model, '->', chain[i + 1], last && last.code); continue; }
  }
  if (!last) { last = new Error('ai_busy'); last.code = 'ai_busy'; }
  if (anyKeyBad && last.code !== 'ai_busy' && keys.every((k) => kstat(k).badUntil > Date.now())) { const e = new Error('ai_key'); e.code = 'ai_key'; throw e; }
  throw last;
}
// ---------- مسیریاب مدل‌ها (ابر هوش) ----------
// هر مدل یه «توانایی» داره (بینایی، PDF، جستجو، قدرت)؛ درخواست به مناسب‌ترین مدل می‌ره و اگه مشغول/خراب بود نفر بعدی جواب می‌ده.
const CAPS = { groq: { vision: true, pdf: false, search: true, strong: false }, gemini: { vision: true, pdf: true, search: true, strong: false } };
export function providerList() {
  const out = [];
  if (groqKey()) out.push(Object.assign({ id: 'groq' }, CAPS.groq));
  if (keyOf()) out.push(Object.assign({ id: 'gemini' }, CAPS.gemini));
  for (const p of extraProviders()) out.push({ id: p.id, vision: p.vision, pdf: p.pdf, search: false, strong: p.strong, extra: p });
  return out;
}
export const providerIds = () => providerList().map((p) => p.id);
// ترتیب امتحان: AI_ORDER (اگه ادمین گذاشته) > سخت=مدل‌های قوی اول > ساده=سریع‌ها (Groq/Gemini) اول
export function routeOrder(opts = {}, env = process.env) {
  let list = providerList();
  const pref = String(env.AI_ORDER || '').toLowerCase().split(/[\s,،;]+/).filter(Boolean);
  if (pref.length) list = pref.map((id) => list.find((p) => p.id === id)).filter(Boolean).concat(list.filter((p) => !pref.includes(p.id)));
  else if (opts.tier === 'strong') list = list.filter((p) => p.extra && p.strong).concat(list.filter((p) => !(p.extra && p.strong)));
  if (opts.exclude && opts.exclude.length) list = list.filter((p) => !opts.exclude.includes(p.id));
  if (opts.vision) list = list.filter((p) => p.vision);
  if (opts.pdf) list = list.filter((p) => p.pdf);
  if (opts.search && !pref.length) list = list.filter((p) => p.search).concat(list.filter((p) => !p.search));
  return list;
}
let lastProvider = '';
export const lastUsedProvider = () => lastProvider;
export async function callAi(opts = {}) {
  const parts = (opts.contents || []).flatMap((c) => c.parts || []);
  const hasPdf = parts.some((p) => p.inlineData && p.inlineData.mimeType === 'application/pdf');
  const hasImg = parts.some((p) => p.inlineData && /^image\//.test(p.inlineData.mimeType));
  if (!providerList().length) { const e = new Error('ai_off'); e.code = 'ai_off'; throw e; }
  const order = routeOrder({ tier: opts.tier, vision: hasImg, pdf: hasPdf, search: opts.search, exclude: opts.exclude });
  if (!order.length) { const e = new Error(hasPdf ? 'ai_nopdf' : 'ai_failed'); e.code = e.message; throw e; }
  let last = null;
  for (const p of order) {
    try {
      const reply = p.id === 'groq' ? await callGroq(opts) : p.id === 'gemini' ? await callGemini(opts) : await callExtra(p.extra, opts);
      if (p.extra) noteExtra(p.id, true);
      lastProvider = p.id; return reply;
    } catch (e) { last = e; if (p.extra) noteExtra(p.id, false); if (order.length > 1) console.error(p.id + ' failed, trying next:', e && e.code); }
  }
  throw last;
}
// پیام‌های متنی [{role:'user'|'assistant', text}] -> قالب Gemini (نقش‌ها یکی‌درمیون و شروع با user)
export function toContents(msgs, limit = 2000) {
  const out = [];
  for (const m of msgs || []) {
    const text = typeof m.text === 'string' ? m.text.trim().slice(0, limit) : '';
    if (!text) continue;
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (out.length && out[out.length - 1].role === role) { out[out.length - 1].parts[0].text += '\n' + text; continue; }
    out.push({ role, parts: [{ text }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
// پرسش: سقف‌ها رو چک می‌کنه، می‌پرسه و فقط بعد از جواب موفق از سهمیه کم می‌کنه
// unlimited: برای ادمین (بدون سقف). search/think اگه ندی از تنظیمات پنل خونده می‌شه.
export const ACTIONS_PROMPT = `

--- دستور دادن به ربات ---
تو می‌تونی به‌جای کاربر به ربات دستور بدی. وقتی کاربر چیزی می‌خواد که ربات خودش انجام می‌ده (نرخ، اخبار، کارت نتیجه، تقویم، سشن، یادآوری، راهنما)، یه جملهٔ خیلی کوتاه و دوستانه بنویس و آخر پیام دستور رو بذار؛ ربات همون لحظه اجراش می‌کنه، پس خودت اعداد و اخبار رو از حافظه نگو.
دستورها (هر کدوم توی یک براکت دوتایی):
[[do:rates]] نرخ ارز و طلا
[[do:crypto]] ارز دیجیتال
[[do:news:d0]] اخبار امروز (d1 فردا، w این هفته، nw هفتهٔ بعد)
[[do:sess]] سشن‌های بازار
[[do:card:w]] کارت نتیجهٔ ژورنال کاربر (d امروز، w این هفته، m ماه، y سال، a کل)
[[do:cal:s]] تقویم شمسی و تعطیلات (cal:g تقویم میلادی)
[[do:help]] راهنمای امکانات
[[do:remind|2026-11-03 09:00|متن یادآوری]] یادآوری؛ زمان رو دقیق و به وقت تهران بر اساس «زمان تهران» توی اطلاعات زنده حساب کن (فرمت YYYY-MM-DD HH:MM). اگه ساعت نگفته بود صبح ۹ بذار.
«متن یادآوری» همون پیامیه که عیناً سر وقت فرستاده می‌شه؛ پس دستور کاربر رو کپی نکن، خودت مثل مایکی و مستقیم خطاب به گیرنده‌ها بنویسش، با همون لحن کاربر (اگه شوخی یا صمیمی یا طعنه‌دار گفت، همونطور و بامزه)، خلاق و کوتاه (حداکثر دو جمله و یک ایموجی). ساعت رو توی متن به شکل حرفی و محاوره‌ای بگو («ساعت ده و نیمه»، «۹ صبحه»)، نه «22:30». نمونه: کاربر گفت «به این احمقا بگو ساعت ۲۲:۳۰ بیان گیم» ← متن: «هی احمقا! ساعت ده و نیمه، بیاید گیم که منتظرتونیم 🎮». کاربر گفت «یادم بنداز قرص بخورم» ← «وقت قرصته، یادت نره 💊». اگه یادآوری برای دیگرانه، خطاب جمع بنویس؛ اگه برای خود کاربره، خطاب مفرد.
قوانین: حداکثر ۳ دستور؛ فقط وقتی کاربر واقعاً خواسته؛ برای سؤال معمولی دستور نذار؛ متن یادآوری رو طبق توضیح بالا خلاقانه و کوتاه بنویس.
مهم: فقط به «آخرین پیام» کاربر عمل کن. توی گفتگو جاهایی که نوشته «[✅ ربات اجرا کرد: …]» یعنی همون کارها قبلاً انجام و فرستاده شده؛ اون دستورها رو هرگز دوباره نذار، مگر اینکه کاربر توی آخرین پیامش صراحتاً دوباره بخواد. یادآوری‌های قبلی رو هم دوباره ثبت نکن و فهرستشون رو توی جواب تکرار نکن.`;
const ACT_RE = /\[\[\s*do:([^\]]*?)\s*\]\]/gi;
const ACT_OK = { rates: null, crypto: null, sess: null, help: null, news: ['d0', 'd1', 'w', 'nw'], card: ['d', 'w', 'm', 'y', 'a'], cal: ['s', 'g'], remind: null };
// دستورهای [[do:...]] رو از متن جدا می‌کنه: { text (بدون دستور), actions: [{k, arg, when, text}] }
export function parseActions(reply) {
  const actions = [];
  const text = String(reply || '').replace(ACT_RE, (m, inner) => {
    const parts = String(inner).split('|'), head = parts[0].trim().toLowerCase().split(':'), k = head[0], arg = head[1] || '';
    if (!(k in ACT_OK) || actions.length >= 3) return '';
    const allowed = ACT_OK[k];
    if (allowed && !allowed.includes(arg)) { if (allowed.length) { const a = { k, arg: allowed[k === 'card' ? 1 : 0], when: '', text: '' }; if (!actions.some((x) => x.k === a.k && x.arg === a.arg)) actions.push(a); } return ''; }
    const a = { k, arg, when: k === 'remind' ? String(parts[1] || '').trim() : '', text: k === 'remind' ? parts.slice(2).join('|').trim().slice(0, 300) : '' };
    if (!actions.some((x) => x.k === a.k && x.arg === a.arg && x.when === a.when)) actions.push(a);
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { text, actions };
}
const PRIVATE_LONG = '\n\nاین جواب توی چت تلگرام فرستاده می‌شه و می‌تونه بلند باشه (ساختارمند، بدون جدول)؛ تلگرام خودش به چند پیام تقسیمش می‌کنه.';
const CALC_RE = /\[\[\s*calc:([^\]]*?)\s*\]\]/gi;
// محاسبه‌های [[calc:...]] مدل رو با ماشین‌حساب سرور حساب می‌کنه و یک دور دیگه از مدل جواب نهایی می‌گیره
async function calcLoop(reply, base, callOpts) {
  const exprs = []; String(reply).replace(CALC_RE, (m, e) => { if (exprs.length < 8) exprs.push(String(e).trim()); return m; });
  if (!exprs.length) return reply;
  const lines = exprs.map((e, i) => { const r = calcSafe(e); return (i + 1) + ') ' + e + ' = ' + (r.ok ? r.text : 'خطا: ' + r.error); });
  const contents = base.concat([{ role: 'model', parts: [{ text: String(reply).slice(0, 3000) }] }, { role: 'user', parts: [{ text: 'نتیجهٔ محاسبه‌های سرور (دقیق):\n' + lines.join('\n') + '\n\nحالا جواب کامل و نهایی رو برای کاربر بنویس و از همین عددها استفاده کن. هیچ [[calc]] ننویس.' }] }]);
  try { return await callAi(Object.assign({}, callOpts, { contents })); }
  catch (e) { return String(reply); }
}
// بازبینی با مدل دوم (فقط وقتی حداقل دو مدل مختلف وصله و اسکیل بازبینی خواسته)
async function reviewReply(q, reply, firstId) {
  if (cfg.review === 'off' || reply.length > 6000) return reply;
  const others = providerList().filter((p) => p.id !== firstId);
  if (!others.length) return reply;
  try {
    const r = await callAi({ system: REVIEW_PROMPT, contents: [{ role: 'user', parts: [{ text: 'سؤال کاربر:\n' + String(q).slice(0, 3000) + '\n\nجواب پیش‌نویس:\n' + reply }] }], maxTokens: 2500, temperature: 0.2, timeoutMs: 40000, exclude: [firstId], think: 'low' });
    const t = String(r).trim();
    if (/^FIX:/i.test(t)) { const fixed = t.replace(/^FIX:\s*/i, '').trim(); if (fixed.length > 20) return fixed; }
  } catch (e) { /* بازبین در دسترس نبود: همون جواب اول */ }
  return reply;
}
// تقسیم متن بلند به تکه‌های کمتر از حد تلگرام (روی خط خالی/خط/جمله می‌شکنه)
export function chunkText(text, max = 3500) {
  const out = []; let t = String(text || '').trim();
  while (t.length > max) {
    let cut = t.lastIndexOf('\n\n', max); if (cut < max * 0.5) cut = t.lastIndexOf('\n', max); if (cut < max * 0.5) cut = t.lastIndexOf(' ', max); if (cut < max * 0.3) cut = max;
    let head = t.slice(0, cut).trim(), rest = t.slice(cut).trim();
    if ((head.match(/```/g) || []).length % 2) { head += '\n```'; rest = '```\n' + rest; } // بلاک کد وسط نشکنه
    out.push(head); t = rest;
  }
  if (t) out.push(t);
  return out;
}
export const SKILLS_META = () => SKILL_IDS.map((id) => ({ id, on: !cfg.skillsOff.includes(id) }));
export const detectSkillsFor = (text, ctx) => detectSkills(text, ctx, cfg.skillsOff);
export async function askAi({ scope, uid, chatId, msgs, extraSystem = '', maxTokens, unlimited = false, search, think, actions = false, images = null, pdfs = null, skills = null, skillCtx = {}, memory = false, limit = 0 }) {
  const chk = checkAi(scope, uid, chatId, unlimited);
  if (!chk.ok) return chk;
  const pdfList = (Array.isArray(pdfs) ? pdfs : []).filter((x) => x && x.b64).slice(0, 1);
  if (pdfList.length && !providerList().some((p) => p.pdf)) return { ok: false, reason: 'ai_nopdf' };
  const imgs = (Array.isArray(images) ? images : []).filter((i) => i && i.b64 && /^image\/(jpeg|png|webp|gif)$/.test(i.mime)).slice(0, 3);
  const rawLast = String(((msgs || []).slice().reverse().find((m) => m && m.role !== 'assistant') || {}).text || '');
  const ids = Array.isArray(skills) ? skills.filter((x) => SKILL_IDS.includes(x) && !cfg.skillsOff.includes(x)) : detectSkills(rawLast, Object.assign({ scope, hasImage: !!imgs.length, hasFile: !!pdfList.length }, skillCtx), cfg.skillsOff);
  const plan = planFor(ids);
  const contents = toContents(msgs, limit || plan.limit || 2000);
  if (!contents.length || contents[contents.length - 1].role !== 'user') return { ok: false, reason: 'bad_request' };
  const lastQ = contents[contents.length - 1].parts[0].text;
  for (const i of imgs) contents[contents.length - 1].parts.push({ inlineData: { mimeType: i.mime, data: i.b64 } });
  for (const f of pdfList) contents[contents.length - 1].parts.push({ inlineData: { mimeType: 'application/pdf', data: f.b64 } });
  const mode = search || cfg.search;
  const wantAlways = mode === 'always' || (mode !== 'off' && plan.search === 'always');
  const doSearch = !imgs.length && !pdfList.length && (wantAlways || (mode === 'auto' && needsSearch(lastQ)));
  const effThink = think || cfg.think;
  const thinkV = resolveThink(['low', 'medium', 'high'].includes(effThink) ? effThink : (plan.think || effThink), lastQ, imgs.length);
  const thinkS = doSearch && thinkV === 'low' ? 'medium' : thinkV; // جستجوی عمیق حداقل تفکر متوسط می‌خواد
  const live = await liveContext();
  let system = BASE_PROMPT + (plan.long ? (scope === 'site' ? '' : PRIVATE_LONG) : scope === 'group' ? GROUP_PROMPT : scope === 'private' ? PRIVATE_PROMPT : '') + (cfg.prompt ? '\n\n' + cfg.prompt : '') + extraSystem + plan.sys;
  if (live) system += '\n\n--- اطلاعات زندهٔ سایت و ربات (همین الان؛ قابل‌اعتمادتر از حافظه) ---\n' + live + '\n--- پایان اطلاعات زنده ---';
  if (doSearch) system += DEEP_SEARCH_PROMPT;
  if (actions) system += ACTIONS_PROMPT;
  if (plan.calc) system += CALC_PROMPT;
  const memOn = !!memory && cfg.memory !== false;
  if (memOn) system += MEMORY_PROMPT;
  const callOpts = { system, contents, maxTokens: Math.max(maxTokens || 0, plan.maxTokens || 0) || (scope === 'group' ? 1000 : 2000), search: doSearch, think: thinkS, tier: plan.tier };
  try {
    let reply = await callAi(callOpts);
    const first = lastProvider;
    if (plan.calc) reply = await calcLoop(reply, contents, callOpts);
    reply = reply.replace(CALC_RE, '').replace(/[ \t]+\n/g, '\n');
    let mem = [];
    if (memOn) { const pm = parseMemOps(reply); reply = pm.text; mem = pm.ops; } else reply = parseMemOps(reply).text;
    if (plan.review) reply = await reviewReply(lastQ, reply, first);
    bump(scope, uid, chatId, unlimited);
    const pa = actions ? parseActions(stripDisclaimers(reply)) : { text: stripDisclaimers(reply), actions: [] };
    return { ok: true, reply: pa.text, actions: pa.actions, left: leftAi(scope, uid, chatId, unlimited), searched: doSearch, provider: first, skills: ids, mem };
  } catch (e) { return { ok: false, reason: e.code || 'ai_failed' }; }
}

// بررسی کلید و مدل (بدون چاپ کلید)
export async function verifyKey(key) {
  if (keyKind(key) === 'groq') {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) return { ok: false, status: r.status, provider: 'groq' };
      const j = await r.json().catch(() => ({}));
      return { ok: true, status: 200, provider: 'groq', models: Array.isArray(j.data) ? j.data.map((m) => m.id) : [] };
    } catch (e) { return { ok: false, status: 0, provider: 'groq', error: String(e && e.name || 'error') }; }
  }
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { ok: false, status: r.status };
    const j = await r.json().catch(() => ({}));
    const models = Array.isArray(j.models) ? j.models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name)).map((m) => m.name.replace('models/', '')) : [];
    return { ok: true, status: 200, models };
  } catch (e) { return { ok: false, status: 0, error: String(e && e.name || 'error') }; }
}
export async function pingModel() {
  const t0 = Date.now();
  try { const reply = await callAi({ system: 'Reply with one short word.', contents: [{ role: 'user', parts: [{ text: 'سلام' }] }], maxTokens: 30, timeoutMs: 20000 }); return { ok: true, ms: Date.now() - t0, reply: reply.slice(0, 40), provider: lastProvider }; }
  catch (e) { return { ok: false, ms: Date.now() - t0, code: e.code || 'ai_failed', status: e.status || 0 }; }
}

// خروجی مارک‌داون Gemini -> HTML تلگرام
export function mdToTg(s) {
  let t = String(s == null ? '' : s).replace(/\r/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // بلاک کد دست‌نخورده می‌مونه (داخلش بولت و بولد تبدیل نشه)
  const keep = [];
  t = t.replace(/```[a-zA-Z0-9_+-]*\n?([\s\S]*?)```/g, (m, c) => { keep.push('<pre>' + c.trim() + '</pre>'); return '\u0001' + (keep.length - 1) + '\u0001'; });
  t = t.replace(/`([^`\n]+)`/g, (m, c) => { keep.push('<code>' + c + '</code>'); return '\u0001' + (keep.length - 1) + '\u0001'; });
  // جدول مارک‌داون (تلگرام جدول نداره): هر ردیف یک خط خوانا می‌شه
  t = t.replace(/(?:^\|.*\|[ \t]*$\n?)+/gm, (blk) => {
    const rows = blk.trim().split('\n').map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    const body = rows.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
    if (body.length < 2) return blk;
    const head = body[0], out = [];
    for (const r of body.slice(1)) out.push('▫️ <b>' + (r[0] || '') + '</b>' + (r.length > 1 ? ': ' + r.slice(1).map((c, i) => (head[i + 1] ? head[i + 1] + ' ' : '') + c).join(' · ') : ''));
    return out.join('\n') + '\n';
  });
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+)__/g, '<b>$1</b>');
  t = t.replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, '<b>$1</b>');
  t = t.replace(/^\s*([-*_])\1{2,}\s*$/gm, ''); // خط جداکننده
  t = t.replace(/^( {2,}|\t+)[*-]\s+/gm, (m, sp) => '   '.repeat(Math.min(3, Math.max(1, Math.floor(sp.replace(/\t/g, '  ').length / 2)))) + '◦ '); // بولت تو در تو
  t = t.replace(/^\s*[*-]\s+/gm, '• ');
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,:;!؟]|$)/g, '$1<i>$2</i>');
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/(?:^&gt; ?.*(?:\n|$))+/gm, (blk) => '<blockquote>' + blk.trim().split('\n').map((l) => l.replace(/^&gt; ?/, '')).join('\n') + '</blockquote>\n');
  t = t.replace(/\u0001(\d+)\u0001/g, (m, i) => keep[+i]);
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

// END-OF-FILE lib/aicore.js
