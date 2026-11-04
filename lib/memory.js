// حافظهٔ شخصی مایکی: چیزهایی که کاربر صریح گفته «یادت باشه» یا حقیقت‌های پایدار دربارهٔ خودش (اسم، کار، ترجیح‌ها، هدف‌ها).
// یک حافظه برای هر کاربر (توی پیوی و همهٔ گروه‌ها یکیه). حداکثر ۳۰ مورد ۲۰۰ نویسه‌ای. دسته‌های حساس ذخیره نمی‌شن. کاربر هر وقت بخواد می‌بینه و پاک می‌کنه.
export const MAX_ITEMS = 30, MAX_LEN = 200;
// اطلاعات حساس و شناسه‌ها: ذخیره نمی‌شن
const SENSITIVE = /(رمز|پسورد|password|passcode|cvv|شماره ?کارت|کد ?ملی|شماره ?حساب|شبا\b|iban|seed ?phrase|private ?key|کلید ?خصوصی|توکن|token)|\b\d{12,}\b|(بیماری|دیابت|سرطان|افسردگی|اضطراب|روان ?(درمان|پزشک)|داروی|قرص|مذهب|دین ?م|شیعه|سنی|مسیحی|یهودی|بهایی|حزب|رأی ?دادم|دگرجنس|همجنس|مهاجرت|پناهندگی|سابقهٔ? ?(کیفری|جرم)|زندان|خودکشی|خودزنی|قرض‌?ها?م|بدهی|حقوقم|درآمدم)/i;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[.!؟?،,؛;]+$/g, '').trim();
const norm = (s) => clean(s).replace(/\u200c/g, ' ').replace(/\s+/g, ' ');
export function checkMemText(text) {
  const t = clean(text);
  if (t.length < 4) return { ok: false, reason: 'short' };
  if (t.length > MAX_LEN) return { ok: false, reason: 'long' };
  if (SENSITIVE.test(t)) return { ok: false, reason: 'sensitive' };
  return { ok: true, text: t };
}
export function createMemory({ db }) {
  const cache = new Map(); // scope -> { at, items:[{id,text}] }
  const TTL = 5 * 60e3;
  async function list(scope) {
    const c = cache.get(scope); if (c && Date.now() - c.at < TTL) return c.items;
    let items = [];
    try { const r = await db`SELECT id, text FROM mikey_memory WHERE scope = ${scope} ORDER BY id ASC LIMIT 60`; items = r.map((x) => ({ id: Number(x.id), text: String(x.text) })); }
    catch (e) { console.error('memory list:', e && e.message); }
    cache.set(scope, { at: Date.now(), items }); if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return items;
  }
  async function add(scope, text) {
    const c = checkMemText(text); if (!c.ok) return c;
    const items = await list(scope);
    if (items.some((x) => norm(x.text) === norm(c.text))) return { ok: true, dup: true, text: c.text };
    if (items.length >= MAX_ITEMS) return { ok: false, reason: 'full' };
    try { await db`INSERT INTO mikey_memory (scope, text) VALUES (${scope}, ${c.text})`; } catch (e) { console.error('memory add:', e && e.message); return { ok: false, reason: 'db' }; }
    cache.delete(scope); return { ok: true, text: c.text };
  }
  // needle: بخشی از متن یادداشت (یا '*' برای همه)
  async function del(scope, needle) {
    const n = norm(needle); if (!n) return { ok: false, n: 0 };
    try {
      if (n === '*') { await db`DELETE FROM mikey_memory WHERE scope = ${scope}`; const k = (cache.get(scope) || { items: [] }).items.length; cache.delete(scope); return { ok: true, n: k }; }
      const items = await list(scope), hit = items.filter((x) => norm(x.text).includes(n) || n.includes(norm(x.text)));
      for (const x of hit) await db`DELETE FROM mikey_memory WHERE scope = ${scope} AND id = ${x.id}`;
      cache.delete(scope); return { ok: true, n: hit.length };
    } catch (e) { console.error('memory del:', e && e.message); return { ok: false, n: 0 }; }
  }
  // بلوک پرامپت: فقط وقتی چیزی ذخیره شده
  async function block(scope) {
    const items = await list(scope); if (!items.length) return '';
    return '\n\n--- حافظهٔ شخصی دربارهٔ همین کاربر (خودش گفته؛ فقط وقتی به سؤال ربط داره استفاده کن و بی‌دلیل تکرارش نکن؛ توی گروه چیز شخصی رو علنی نگو) ---\n' + items.map((x) => '• ' + x.text).join('\n') + '\n--- پایان حافظه ---';
  }
  return { list, add, del, block };
}
export const MEMORY_PROMPT = `

--- حافظهٔ تو ---
تو حافظهٔ شخصی داری. فقط در این دو حالت یه یادداشت ذخیره کن: ۱) کاربر صریح گفته «یادت باشه / یادداشت کن / فراموش نکن» ۲) کاربر یه حقیقت پایدار و بی‌خطر دربارهٔ خودش گفته (اسم یا لقب، شغل، سبک و بازار معاملاتی، هدف، ترجیح در نحوهٔ جواب دادن). یادداشت رو با [[mem:add|یه جملهٔ کوتاه سوم‌شخص]] آخر پیام بذار و با «یادم موند ✅» تأیید کن. اگه کاربر خواست چیزی فراموش بشه: [[mem:del|بخشی از همون یادداشت]] (یا [[mem:del|*]] برای همه).
هرگز ذخیره نکن: رمز، شماره کارت/حساب، کد ملی، اطلاعات سلامت، دین، سیاست، درآمد و بدهی، مسائل خصوصی دیگران، یا حدس خودت. حرف‌های مقطعی (مثل «امروز خسته‌ام») ذخیره نمی‌شن.`;
const MEM_RE = /\[\[\s*mem:(add|del)\s*\|([^\]]*?)\s*\]\]/gi;
// دستورهای حافظه رو از جواب مدل جدا می‌کنه (حداکثر ۳ تا)
export function parseMemOps(reply) {
  const ops = [];
  const text = String(reply || '').replace(MEM_RE, (m, op, t) => { if (ops.length < 3 && String(t).trim()) ops.push({ op: op.toLowerCase(), text: String(t).trim().slice(0, MAX_LEN + 20) }); return ''; }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, ops };
}
export async function applyMemOps(mem, scope, ops) {
  const out = [];
  for (const o of ops || []) out.push(o.op === 'add' ? Object.assign({ op: 'add' }, await mem.add(scope, o.text)) : Object.assign({ op: 'del', text: o.text }, await mem.del(scope, o.text)));
  return out;
}
// دستورهای صریح (بدون مدل): «چی یادته؟»، «همه رو فراموش کن»
export function memCommand(text) {
  const t = String(text || '').replace(/[‌]/g, ' ').replace(/[؟?!.]+$/g, '').replace(/\s+/g, ' ').trim();
  if (/^(مایکی\s*)?(چی|چه ?چیزی|چه)( از من| ازم| درباره ?(ی)? من)? یادته$/.test(t) || /^(مایکی\s*)?(حافظه|یادداشت)(‌| )?(ها)?(ی)?( من| م| مایکی)?( رو| را)?( نشون بده| ببینم| چیه| ها)?$/.test(t) && /حافظه|یادداشت/.test(t)) return { k: 'list' };
  if (/^(مایکی\s*)?(همه|کل)( چیز)?( رو| را)?( درباره ?(ی)? من)? فراموش کن$/.test(t) || /^(مایکی\s*)?(حافظه|یادداشت)(‌| )?(ها)?(ی)?( من| م)?( رو| را)? (پاک کن|خالی کن|حذف کن)$/.test(t)) return { k: 'clear' };
  return null;
}
export const memListText = (items) => (items.length ? '🧠 این‌ها رو دربارهٔ تو یادمه:\n' + items.map((x, i) => (i + 1) + '. ' + x.text).join('\n') + '\n\nبرای پاک کردن بنویس «فراموش کن …» (یا «همه رو فراموش کن»).' : 'هنوز چیزی دربارهٔ تو یادم نیست. هر وقت خواستی بگو «یادت باشه …».');
export const MEM_ERR = { sensitive: 'این رو نگه نمی‌دارم چون جزو اطلاعات حساسه (رمز، شماره کارت، سلامت، دین، سیاست، مالی شخصی…).', full: 'حافظه‌ات پره (۳۰ مورد). با «فراموش کن …» یکی رو پاک کن.', long: 'برای حافظه خیلی بلنده؛ کوتاه‌ترش کن (حداکثر ۲۰۰ نویسه).', short: 'خیلی کوتاهه.', db: 'الان نتونستم ذخیره کنم.' };

// END-OF-FILE lib/memory.js
