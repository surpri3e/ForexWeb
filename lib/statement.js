// تحلیل استیتمنت: پاک‌سازی خروجی هوش مصنوعی (خواندن عکس هیستوری متاتریدر) و محاسبهٔ آمار حساب.
// هیچ وابستگی بیرونی نداره تا هم سرور و هم تست‌ها ازش استفاده کنن.

const BASE = `تو یک ابزار دقیق خواندن (OCR) برای اسکرین‌شات «تاریخچهٔ معاملات» متاتریدر ۴ و ۵ (موبایل و دسکتاپ) و پلتفرم‌های مشابه، چه با رابط انگلیسی و چه فارسی هستی.
فقط و فقط یک JSON معتبر برگردان؛ بدون متن اضافه، توضیح یا بلاک کد. ساختار:
{"platform":"mt4|mt5|other","view":"positions|deals|orders|other","currency":"USD","balance":عدد یا null,"equity":عدد یا null,
"totals":{"profit":عدد یا null,"deposit":عدد یا null,"withdrawal":عدد یا null,"commission":عدد یا null,"swap":عدد یا null},
"rows":[{"ticket":"رشته یا null","symbol":"EURUSD","type":"buy|sell|deposit|withdrawal","lots":عدد یا null,"open":"YYYY-MM-DD HH:MM یا null","close":"YYYY-MM-DD HH:MM یا null","profit":عدد,"commission":عدد,"swap":عدد,"unsure":true|false}]}

شکل معمول صفحه‌ها:
- MT5 موبایل (تب History/Positions): هر معامله دو خط است: «EURUSD, buy 0.10» با سود در سمت راست؛ خط بعد «قیمت ورود → قیمت خروج» و تاریخ و ساعت بسته‌شدن. معمولاً فقط زمان بسته‌شدن دیده می‌شود: close را پر کن و open را null بگذار.
- MT4 موبایل: «EURUSD, buy 0.10» + قیمت‌ها + تاریخ و ساعت + سود. ردیف «Balance» یعنی واریز یا برداشت.
- تب Deals در MT5: هر معامله دو ردیف ورود (in) و خروج (out) دارد. فقط ردیف‌های خروج که سود دارند را بیاور و ردیف‌های in را کامل نادیده بگیر.
- اگر بالای صفحه خلاصه‌ای مثل Profit / Deposit / Withdrawal / Swap / Commission / Balance (یا سود / واریز / برداشت / سواپ / کمیسیون / تراز) دیده می‌شود، همان اعداد را در totals و balance بیاور؛ این اعداد برای صحت‌سنجی استفاده می‌شوند.

قوانین سخت:
- هر ردیفِ معاملهٔ بسته‌شده یک آیتم. سفارش باز، پندینگ، لغوشده و ردیف‌هایی که در لبهٔ بالا یا پایین عکس بریده شده‌اند را نیاور.
- سود/زیان با علامت: عدد قرمز یا داخل پرانتز یا با منفی = منفی. جداکنندهٔ هزارگان را حذف کن و اعشار را با نقطه بنویس. رقم‌ها را با دقت بخوان (۳/۸، ۱/۷، ۵/۶ را اشتباه نگیر).
- تاریخ‌ها را به YYYY-MM-DD HH:MM تبدیل کن (2026.11.03 14:22:10 ← 2026-11-03 14:22). اگر سال دیده نمی‌شود یا خوانا نیست null بگذار.
- اگر کمیسیون یا سواپ دیده نمی‌شود 0 بگذار.
- اگر رقم یا تاریخی تار، ناقص یا مبهم است unsure را true بگذار؛ حدس نزن. اگر خود سود خوانا نیست آن ردیف را نیاور.
- واریز و برداشت را با type مناسب و profit با علامت بیاور.
- ترتیب ردیف‌ها همان ترتیب عکس باشد. هیچ ردیفی را تکرار یا اختراع نکن.`;

const FA_SHORT = `
اگر رابط عکس فارسی است: خرید=buy، فروش=sell، واریز=deposit، برداشت=withdrawal؛ ارقام فارسی (۰-۹) را به لاتین بنویس؛ تاریخ شمسی (سال ۱۳xx یا ۱۴xx) را بدون تبدیل و همان‌طور که دیده می‌شود بنویس تا سیستم تبدیل کند.`;

const FA_FULL = `

این عکس رابط فارسی (راست‌به‌چپ) دارد. نکته‌های ویژه:
- برچسب‌ها: خرید=buy، فروش=sell، سود=profit، حجم=lots، نماد=symbol، تراز یا بالانس=balance، سرمایه یا اکوییتی=equity، کمیسیون=commission، سواپ=swap، واریز یا سپرده=deposit، برداشت=withdrawal، تاریخچه=History، موقعیت‌ها=Positions، معاملات=Deals، سفارش‌ها=Orders.
- چیدمان ممکن است آینه‌ای باشد (نماد و نوع معامله سمت راست و سود سمت چپ یا برعکس). ستون‌ها را از روی برچسب و محتوایشان تشخیص بده، نه از روی ترتیبی که از قبل فرض کرده‌ای.
- ارقام فارسی (۰۱۲۳۴۵۶۷۸۹) و عربی (٠١٢٣٤٥٦٧٨٩) را به ارقام لاتین بنویس. جداکنندهٔ اعشار «٫» و هزارگان «٬» یا «،» است. ۰ (صفر فارسی) فقط یک نقطهٔ کوچک است؛ ۴، ۳، ۶، ۷، ۲، ۵ را با دقت از هم جدا کن.
- منفی ممکن است قبل یا بعد از عدد بیاید (۱۲٫۵۰- یا -۱۲٫۵۰) یا عدد قرمز باشد؛ هر سه منفی‌اند.
- تاریخ ممکن است شمسی باشد (۱۴۰۵/۰۸/۱۷ ۱۴:۲۲): آن را بدون هیچ تبدیلی به شکل 1405-08-17 14:22 بنویس؛ تبدیل به میلادی را سیستم انجام می‌دهد، خودت تبدیل نکن. اگر ماه به نام آمده (فروردین … اسفند) شمارهٔ ماه را بنویس.
- نماد معمولاً لاتین است (EURUSD، XAUUSD). فقط اگر نام لاتین اصلاً دیده نمی‌شود: طلا=XAUUSD، نقره=XAGUSD.`;

export const STATEMENT_SYSTEM = BASE + FA_SHORT;
// lang: 'fa' (رابط فارسی)، 'en' (انگلیسی) یا خودکار
export function statementPrompt(lang) {
  if (lang === 'fa') return BASE + FA_FULL;
  if (lang === 'en') return BASE;
  return BASE + FA_SHORT;
}

const BIDI = /[​-‏‪-‮⁦-⁩﻿]/g;
const fixDigits = (v) => String(v).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 1776).replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 1632);
const num = (v, lim = 1e9) => {
  if (v == null || v === '') return null;
  let n;
  if (typeof v === 'number') n = v;
  else {
    const raw = fixDigits(v).replace(BIDI, '');
    const paren = /^\s*[(（].*[)）]\s*$/.test(raw);
    let t = raw.replace(/[−‒-―‐‑﹣－]/g, '-').replace(/٫/g, '.').replace(/[٬،]/g, ',').replace(/[^\d.,\-+]/g, '');
    const trailing = /\d-$/.test(t);              // «۱۲٫۵۰-» در متن راست‌به‌چپ یعنی منفی
    t = t.replace(/(?!^)[-+]/g, (c, i) => '');   // علامت فقط اول عدد معتبر است
    if (trailing) t = '-' + t;
    const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) t = lc > ld ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''); // آخرین جداکننده اعشار است
    else if (lc >= 0) t = /,\d{1,2}$/.test(t) && t.indexOf(',') === lc ? t.replace(',', '.') : t.replace(/,/g, '');
    else if (ld >= 0 && t.indexOf('.') !== ld) t = t.replace(/\./g, '');   // «1.234.567» = هزارگان
    n = parseFloat(t);
    if (paren && n > 0) n = -n; // (40.00) یعنی منفی
  }
  return Number.isFinite(n) && Math.abs(n) <= lim ? n : null;
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const p2 = (n) => String(n).padStart(2, '0');

// شمسی -> میلادی (الگوریتم استاندارد jdf)
export function jalaliToGregorian(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097); days %= 146097;
  if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const sal = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0; while (gm < 13 && gd > sal[gm]) { gd -= sal[gm]; gm++; }
  return [gy, gm, gd];
}
const JMON = { 'فروردین': 1, 'اردیبهشت': 2, 'خرداد': 3, 'تیر': 4, 'مرداد': 5, 'شهریور': 6, 'مهر': 7, 'آبان': 8, 'آذر': 9, 'دی': 10, 'بهمن': 11, 'اسفند': 12 };
const GMON = { 'ژانویه': 1, 'ژانویِ': 1, 'فوریه': 2, 'مارس': 3, 'آوریل': 4, 'اپریل': 4, 'مه': 5, 'می': 5, 'ژوئن': 6, 'جون': 6, 'ژوئیه': 7, 'جولای': 7, 'اوت': 8, 'آگوست': 8, 'سپتامبر': 9, 'اکتبر': 10, 'نوامبر': 11, 'دسامبر': 12 };
const ENMON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function timePart(t) { const m = /(\d{1,2})[:٫.](\d{2})/.exec(t); return m ? [+m[1], +m[2]] : [null, null]; }
function build(y, mo, d, hh, mm) {
  if (y >= 1300 && y <= 1500) { if (mo < 1 || mo > 12 || d < 1 || d > 31 || (mo > 6 && d > 30)) return ''; const g = jalaliToGregorian(y, mo, d); y = g[0]; mo = g[1]; d = g[2]; }
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCMonth() !== mo - 1) return '';
  return y + '-' + p2(mo) + '-' + p2(d) + (hh != null && hh < 24 && mm < 60 ? ' ' + p2(hh) + ':' + p2(mm) : '');
}
export function normDate(s) {
  if (s == null) return '';
  const t = fixDigits(s).replace(BIDI, '').replace(/٫/g, ':').trim();
  let m = /(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)(?:[ T,،]+(\d{1,2}):(\d{2}))?/.exec(t);          // سال اول (میلادی یا شمسی)
  if (m) return build(+m[1], +m[2], +m[3], m[4] != null ? +m[4] : null, m[5] != null ? +m[5] : null);
  m = /(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{4})(?!\d)(?:[ T,،]+(\d{1,2}):(\d{2}))?/.exec(t);               // سال آخر
  if (m) { const a = +m[1], b = +m[2], y = +m[3], hh = m[4] != null ? +m[4] : null, mm = m[5] != null ? +m[5] : null;
    if (y >= 1300 && y <= 1500) return build(y, b, a, hh, mm);     // روز/ماه/سال شمسی
    if (a > 12 && b <= 12) return build(y, b, a, hh, mm);          // روز/ماه/سال میلادی بی‌ابهام
    if (b > 12 && a <= 12) return build(y, a, b, hh, mm);          // ماه/روز/سال میلادی بی‌ابهام
    return ''; }
  m = /(\d{1,2})\s+([^\s\d]+)\s+(\d{4})(?!\d)/.exec(t);                                                             // «۱۷ آبان ۱۴۰۵»
  if (m) { const name = m[2].replace(/[ًٌٍَُِّْ‌]/g, ''); const y = +m[3]; const mo = (y >= 1300 && y <= 1500) ? JMON[name] : (GMON[name] || ENMON[name.slice(0, 3).toLowerCase()]); if (mo) { const [hh, mm] = timePart(t.slice(m.index + m[0].length)); return build(y, mo, +m[1], hh, mm); } }
  return '';
}

// متن/JSON خام مدل -> { rows, account }
export function parseModelJson(text) {
  let s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let j; try { j = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  return sanitize(j);
}

// نوع معامله: انگلیسی یا فارسی -> buy|sell|deposit|withdrawal (یا '' برای ردیف نامعتبر مثل سفارش پندینگ)
export function normType(v, profit) {
  const t = String(v == null ? '' : v).replace(BIDI, '').replace(/[ًٌٍَُِّْ‌]/g, '').trim().toLowerCase();
  if (!t) return '';
  if (/limit|stop|pending|لیمیت|استاپ|پندینگ|در انتظار/.test(t)) return '';
  if (/^(buy|long)$|^خرید$|^بای$|^لانگ$/.test(t)) return 'buy';
  if (/^(sell|short)$|^فروش$|^سل$|^شورت$/.test(t)) return 'sell';
  if (/deposit|واریز|سپرده|شارژ/.test(t)) return 'deposit';
  if (/withdraw|برداشت|خروج وجه/.test(t)) return 'withdrawal';
  if (/^(balance|credit)$|بالانس|تراز|اعتبار|موجودی/.test(t)) return Number(profit) < 0 ? 'withdrawal' : 'deposit';
  return '';
}
const FA_SYM = [[/طلا|اونس/, 'XAUUSD'], [/نقره/, 'XAGUSD'], [/نفت/, 'USOIL'], [/بیت.?کوین/, 'BTCUSD'], [/اتریوم/, 'ETHUSD']];
export function normSymbol(v) {
  const raw = String(v == null ? '' : v).replace(BIDI, '');
  const latin = raw.toUpperCase().replace(/[^A-Z0-9._#-]/g, '').slice(0, 14);
  if (latin) return latin;
  const hit = FA_SYM.find((x) => x[0].test(raw));
  return hit ? hit[1] : '';
}

export function sanitize(j) {
  const rows = [];
  for (const x of (j && Array.isArray(j.rows) ? j.rows : []).slice(0, 400)) {
    if (!x || typeof x !== 'object') continue;
    const profit = num(x.profit); if (profit == null) continue;
    const type = normType(x.type, profit);
    if (!type) continue;
    if (String(x.dir || x.entry || '').trim().toLowerCase() === 'in') continue;
    rows.push({
      ticket: x.ticket == null ? '' : fixDigits(x.ticket).replace(BIDI, '').replace(/[^\w#-]/g, '').slice(0, 20),
      symbol: normSymbol(x.symbol),
      type, lots: type === 'buy' || type === 'sell' ? (num(x.lots, 1e4) == null ? null : Math.abs(num(x.lots, 1e4))) : null,
      open: normDate(x.open), close: normDate(x.close), profit: r2(profit),
      comm: r2(num(x.commission != null ? x.commission : x.comm, 1e7) || 0), swap: r2(num(x.swap, 1e7) || 0),
      unsure: x.unsure === true || x.unsure === 'true',
    });
  }
  const tt = (j && j.totals && typeof j.totals === 'object') ? j.totals : {};
  const totals = { profit: num(tt.profit), deposit: num(tt.deposit), withdrawal: num(tt.withdrawal), commission: num(tt.commission), swap: num(tt.swap) };
  const acc = { platform: ['mt4', 'mt5'].includes(String(j && j.platform).toLowerCase()) ? String(j.platform).toLowerCase() : 'other', currency: String((j && j.currency) || 'USD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'USD', balance: num(j && j.balance), equity: num(j && j.equity), totals: Object.values(totals).some((v) => v != null) ? totals : null };
  return { rows, account: acc };
}

// حذف قطعی: فقط وقتی تیکت یکسان باشد. ردیف‌های بدون تیکت را اینجا هرگز حذف نمی‌کنیم (معامله‌های واقعاً مشابه ممکنه وجود داشته باشه).
export function dedupe(rows) {
  const seen = new Set(), out = [];
  for (const r of rows) {
    if (r.ticket) { const k = 't' + r.ticket; if (seen.has(k)) continue; seen.add(k); }
    out.push(r);
  }
  return out;
}

// ادغام هوشمند چند عکس/برش: ردیف تکراریِ ناشی از هم‌پوشانی را پیدا می‌کنه.
// قانون: فقط بین دسته‌های مختلف (عکس‌های مختلف) تکرار حساب می‌شه، و هر ردیف فقط با یک ردیف دسته‌های قبلی جفت می‌شه؛
// پس دو معامله‌ی واقعاً مشابه داخل یک عکس حفظ می‌شن.
const minuteOf = (d) => (d && d.length >= 16 ? Math.floor(ms(d) / 60000) : null);
function sameTrade(a, b) {
  if (a.type !== b.type) return false;
  if (a.ticket && b.ticket) return a.ticket === b.ticket;
  if (a.symbol && b.symbol && a.symbol !== b.symbol) return false;
  if (a.lots != null && b.lots != null && Math.abs(a.lots - b.lots) > 1e-6) return false;
  if (Math.abs(a.profit - b.profit) > 0.011) return false;
  // زمان: اگر هر دو داریم باید یکی باشه (با ۱ دقیقه تلورانس)، اگر یکی نداره مشکلی نیست
  for (const k of ['close', 'open']) {
    const x = minuteOf(a[k]), y = minuteOf(b[k]);
    if (x != null && y != null && Math.abs(x - y) > 1) return false;
    const dx = a[k] && a[k].slice(0, 10), dy = b[k] && b[k].slice(0, 10);
    if (dx && dy && dx !== dy) return false;
  }
  // اگر هیچ زمانی برای مقایسه نیست، باید حداقل نماد یا لات هم‌خوان و معلوم باشه
  const anyTime = ['close', 'open'].some((k) => a[k] && b[k]);
  if (!anyTime && !(a.symbol && b.symbol) && !(a.lots != null && b.lots != null)) return false;
  return true;
}
const richness = (r) => (r.ticket ? 4 : 0) + (r.open ? 2 : 0) + (r.close ? 2 : 0) + (r.symbol ? 1 : 0) + (r.lots != null ? 1 : 0) + (r.unsure ? -3 : 0) + (r.comm || r.swap ? 1 : 0);
function mergeInto(keep, other) {
  for (const k of ['ticket', 'symbol', 'open', 'close']) if (!keep[k] && other[k]) keep[k] = other[k];
  if (keep.lots == null && other.lots != null) keep.lots = other.lots;
  if (!keep.comm && other.comm) keep.comm = other.comm;
  if (!keep.swap && other.swap) keep.swap = other.swap;
  if (keep.unsure && !other.unsure) keep.unsure = false; // یک بار واضح خونده شده
}
export function smartMerge(batches) {
  const kept = [], dups = [];
  (batches || []).forEach((rows, bi) => {
    const used = new Set();
    for (const r0 of Array.isArray(rows) ? rows : []) {
      if (!r0 || typeof r0 !== 'object') continue;
      const r = Object.assign({ ticket: '', symbol: '', lots: null, open: '', close: '', comm: 0, swap: 0, unsure: false }, r0, { _b: bi });
      let hit = -1;
      for (let i = 0; i < kept.length; i++) { const c = kept[i]; if (c._b < bi && !used.has(i) && sameTrade(r, c)) { hit = i; break; } }
      if (hit < 0 && r.ticket) hit = kept.findIndex((c) => c.ticket && c.ticket === r.ticket && c._b !== bi); // تیکت یکسان در دسته‌های دیگه
      if (hit >= 0) {
        used.add(hit); const c = kept[hit];
        if (richness(r) > richness(c)) { // ردیف تازه کامل‌تره: اون رو نگه می‌داریم و قبلی می‌شه تکراری
          const old = Object.assign({}, c); for (const k of Object.keys(c)) delete c[k];
          Object.assign(c, r, { _b: old._b }); mergeInto(c, old); dups.push(old);
        } else { mergeInto(c, r); dups.push(r); }
      } else kept.push(r);
    }
  });
  const clean = (r) => { const o = Object.assign({}, r); delete o._b; return o; };
  return { rows: kept.map(clean), dups: dups.map(clean) };
}

const fin = (v, lim) => { const n = typeof v === 'number' ? v : num(v, lim); return Number.isFinite(n) && Math.abs(n) <= lim ? n : 0; };
const when = (r) => r.close || r.open || '';
const ms = (d) => (d && d.length >= 16 ? Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), +d.slice(11, 13), +d.slice(14, 16)) : null);
const holdOf = (r) => { const a = ms(r.open), b = ms(r.close); return a != null && b != null && b >= a ? Math.round((b - a) / 60000) : null; };
const wdOf = (d) => { const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)); return (((Math.floor(t / 864e5) + 3) % 7) + 7) % 7; }; // 0=دوشنبه ... 6=یکشنبه
export function analyze(inRows, opts = {}) {
  const rows = dedupe((inRows || []).filter((r) => r && typeof r === 'object').map((r) => ({
    ticket: String(r.ticket || '').slice(0, 20), symbol: String(r.symbol || '').toUpperCase().replace(/[^A-Z0-9._#-]/g, '').slice(0, 14) || normSymbol(r.symbol), type: r.type, lots: Number.isFinite(+r.lots) && r.lots != null && r.lots !== '' && Math.abs(+r.lots) <= 1e4 ? Math.abs(+r.lots) : null,
    open: normDate(r.open), close: normDate(r.close), profit: fin(r.profit, 1e9), comm: fin(r.comm, 1e7), swap: fin(r.swap, 1e7),
  })).filter((r) => ['buy', 'sell', 'deposit', 'withdrawal'].includes(r.type)));
  const flows = rows.filter((r) => r.type === 'deposit' || r.type === 'withdrawal');
  const flowSum = flows.reduce((a, r) => a + r.profit, 0);
  const tr = rows.filter((r) => r.type === 'buy' || r.type === 'sell').map((r, i) => Object.assign({ i, net: r.profit + r.comm + r.swap }, r));
  tr.sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : a.i - b.i));
  const n = tr.length;
  const wins = tr.filter((t) => t.net > 0), loss = tr.filter((t) => t.net < 0);
  const gp = wins.reduce((a, t) => a + t.net, 0), gl = -loss.reduce((a, t) => a + t.net, 0);
  const net = tr.reduce((a, t) => a + t.net, 0);
  const avgW = wins.length ? gp / wins.length : 0, avgL = loss.length ? gl / loss.length : 0;
  // روزها
  const dm = new Map();
  for (const t of tr) { const k = when(t).slice(0, 10) || '—'; const d = dm.get(k) || { date: k, n: 0, w: 0, l: 0, pnl: 0 }; d.n++; d.pnl += t.net; if (t.net > 0) d.w++; else if (t.net < 0) d.l++; dm.set(k, d); }
  const days = [...dm.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => ({ date: d.date, n: d.n, w: d.w, l: d.l, pnl: r2(d.pnl) }));
  // نمادها
  const sm = new Map();
  for (const t of tr) { const k = t.symbol || '—'; const s = sm.get(k) || { symbol: k, n: 0, w: 0, pnl: 0 }; s.n++; s.pnl += t.net; if (t.net > 0) s.w++; sm.set(k, s); }
  const symbols = [...sm.values()].sort((a, b) => b.pnl - a.pnl).map((s) => ({ symbol: s.symbol, n: s.n, winRate: r2(s.w / s.n * 100), pnl: r2(s.pnl) }));
  // بیشترین برد/باخت پشت‌سرهم
  let cw = 0, cl = 0, mw = 0, ml = 0;
  for (const t of tr) { if (t.net > 0) { cw++; cl = 0; } else if (t.net < 0) { cl++; cw = 0; } else { cw = 0; cl = 0; } mw = Math.max(mw, cw); ml = Math.max(ml, cl); }
  // بالانس و دراودان
  let start = +opts.startBalance > 0 ? +opts.startBalance : null, startEst = false;
  const bal = +opts.balance > 0 ? +opts.balance : null;
  if (start == null && bal != null) { start = bal - net - flowSum; if (start > 0) startEst = true; else start = null; }
  let cum = start == null ? 0 : start, peak = cum, mdd = 0, mddPct = null;
  const curve = [r2(cum)];
  for (const t of tr) { cum += t.net; curve.push(r2(cum)); if (cum > peak) peak = cum; const dd = peak - cum; if (dd > mdd) { mdd = dd; mddPct = start != null && peak > 0 ? dd / peak * 100 : null; } }
  const byType = (ty) => { const a = tr.filter((t) => t.type === ty); return { n: a.length, pnl: r2(a.reduce((s, t) => s + t.net, 0)), winRate: a.length ? r2(a.filter((t) => t.net > 0).length / a.length * 100) : 0 }; };
  const lotsList = tr.filter((t) => t.lots != null);
  const times = tr.map(when).filter(Boolean);
  const wd = Array.from({ length: 7 }, () => ({ n: 0, w: 0, pnl: 0 })), hr = Array.from({ length: 24 }, () => ({ n: 0, w: 0, pnl: 0 }));
  let holdAll = [], holdW = [], holdL = [];
  for (const t of tr) {
    const c = when(t); if (c.length >= 10) { const k = wd[wdOf(c)]; k.n++; k.pnl += t.net; if (t.net > 0) k.w++; }
    if (t.close.length >= 16) { const k = hr[+t.close.slice(11, 13)]; k.n++; k.pnl += t.net; if (t.net > 0) k.w++; }
    const h = holdOf(t); if (h != null) { holdAll.push(h); (t.net > 0 ? holdW : t.net < 0 ? holdL : []).push(h); }
  }
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const fixB = (a) => a.map((k) => ({ n: k.n, w: k.w, pnl: r2(k.pnl) }));
  const lv = lotsList.map((t) => t.lots), lm = lv.length ? lv.reduce((x, y) => x + y, 0) / lv.length : 0;
  const lotsCV = lv.length >= 3 && lm > 0 ? Math.sqrt(lv.reduce((x, y) => x + (y - lm) * (y - lm), 0) / lv.length) / lm : 0;
  const out = {
    trades: n, wins: wins.length, losses: loss.length, even: n - wins.length - loss.length,
    winRate: n ? r2(wins.length / n * 100) : 0, net: r2(net), grossProfit: r2(gp), grossLoss: r2(gl),
    profitFactor: gl > 0 ? r2(gp / gl) : (gp > 0 ? null : 0), avgWin: r2(avgW), avgLoss: r2(avgL), payoff: avgL > 0 ? r2(avgW / avgL) : null,
    expectancy: n ? r2(net / n) : 0, best: n ? r2(Math.max(...tr.map((t) => t.net))) : 0, worst: n ? r2(Math.min(...tr.map((t) => t.net))) : 0,
    maxWinStreak: mw, maxLossStreak: ml, avgLots: lotsList.length ? r2(lotsList.reduce((a, t) => a + t.lots, 0) / lotsList.length) : null,
    commissions: r2(tr.reduce((a, t) => a + t.comm, 0)), swaps: r2(tr.reduce((a, t) => a + t.swap, 0)),
    deposits: r2(flows.filter((f) => f.profit > 0).reduce((a, f) => a + f.profit, 0)), withdrawals: r2(-flows.filter((f) => f.profit < 0).reduce((a, f) => a + f.profit, 0)),
    startBalance: start == null ? null : r2(start), startEstimated: startEst, endBalance: start == null ? null : r2(start + net + flowSum),
    returnPct: start ? r2(net / start * 100) : null, maxDD: r2(mdd), maxDDPct: mddPct == null ? null : r2(mddPct),
    days: days.length, bestDay: days.length ? days.reduce((a, d) => (d.pnl > a.pnl ? d : a)) : null, worstDay: days.length ? days.reduce((a, d) => (d.pnl < a.pnl ? d : a)) : null,
    greenDays: days.filter((d) => d.pnl > 0).length, redDays: days.filter((d) => d.pnl < 0).length,
    from: times.length ? times[0].slice(0, 10) : '', to: times.length ? times[times.length - 1].slice(0, 10) : '',
    buy: byType('buy'), sell: byType('sell'), byDay: days, bySymbol: symbols.slice(0, 12), curve: curve.length > 160 ? curve.filter((_, i) => i % Math.ceil(curve.length / 160) === 0 || i === curve.length - 1) : curve,
    rows: rows.length,
    byWeekday: fixB(wd), byHour: hr.some((k) => k.n) ? fixB(hr) : null,
    avgHold: avg(holdAll), avgHoldWin: avg(holdW), avgHoldLoss: avg(holdL),
    recovery: mdd > 0 ? r2(net / mdd) : null, avgDay: days.length ? r2(net / days.length) : 0,
    bestDayShare: gp > 0 && days.length ? r2(Math.max(...days.map((d) => d.pnl)) / gp * 100) : null,
    list: tr.slice(-300).reverse().map((t) => ({ s: t.symbol, t: t.type, l: t.lots, c: when(t), n: r2(t.net), h: holdOf(t) })),
  };
  out.score = scorecard(out, lotsCV);
  return out;
}
// مقایسهٔ جمع سود ردیف‌ها با جمع Profit که بالای صفحهٔ متاتریدر دیده شده (اگر بوده)
export function checkTotals(rows, totalsList) {
  const exp = (totalsList || []).map((t) => (t && typeof t.profit === 'number' ? t.profit : null)).filter((v) => v != null);
  if (!exp.length) return null;
  const expected = r2(exp.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)));
  const got = r2((rows || []).filter((r) => r.type === 'buy' || r.type === 'sell').reduce((a, r) => a + (+r.profit || 0), 0));
  const diff = r2(got - expected);
  return { expected, got, diff, ok: Math.abs(diff) <= Math.max(1, Math.abs(expected) * 0.005) };
}

// ---------- مدل امتیازدهی معامله‌گر ----------
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const GRADES = [[90, 'S', 'حرفه‌ای'], [80, 'A', 'عالی'], [68, 'B', 'خوب'], [55, 'C', 'متوسط'], [40, 'D', 'ضعیف'], [0, 'E', 'پرخطر']];
const TXT = {
  profit: ['بازدهی مثبت و قابل‌توجه در این دوره', 'حساب در این دوره سود خالص نداشته'],
  edge: ['پروفیت‌فاکتور قوی؛ ورودها لبهٔ آماری دارند', 'پروفیت‌فاکتور پایین؛ ضررها سودها را می‌خورند'],
  risk: ['کنترل ریسک و دراودان عالی', 'دراودان بالا نسبت به سود و بالانس'],
  consistency: ['سود از روزهای متعدد می‌آید، نه از یک شانس', 'نتیجه به چند روز خاص وابسته است'],
  discipline: ['اندازهٔ لات و رفتار بعد از ضرر منظم است', 'لات نامنظم یا باخت‌های پشت‌سرهم زیاد'],
};
export function scorecard(a, lotsCV = 0) {
  const pf = a.profitFactor == null ? 3 : a.profitFactor;
  let profit;
  if (a.returnPct != null) profit = clamp(50 + a.returnPct * 3.3);
  else { const t = a.grossProfit + a.grossLoss; profit = t > 0 ? clamp(50 + 50 * a.net / t) : 50; }
  const edge = clamp((pf - 0.6) / 1.8 * 100);
  let risk;
  if (a.maxDDPct != null) risk = clamp(100 - (a.maxDDPct - 3) / 37 * 100);
  else { const r = a.grossProfit > 0 ? a.maxDD / a.grossProfit : (a.maxDD > 0 ? 2 : 0); risk = clamp(100 - (r - 0.15) / 1.35 * 100); }
  if (a.avgLoss > 0 && Math.abs(a.worst) > 3 * a.avgLoss) risk = clamp(risk - 15);
  let consistency = 50;
  if (a.days >= 3) consistency = clamp(a.greenDays / a.days * 60 + (100 - Math.min(100, a.bestDayShare == null ? 100 : a.bestDayShare)) * 0.4);
  const discipline = clamp(72 - 7 * Math.max(0, a.maxLossStreak - 2) - 28 * Math.min(1, lotsCV) + (a.avgLoss > 0 && a.avgLoss <= a.avgWin * 1.25 ? 10 : 0) + (a.payoff != null && a.payoff >= 1 ? 6 : 0));
  const parts = { profit, edge, risk, consistency, discipline };
  const total0 = a.trades ? Math.round(profit * 0.25 + edge * 0.25 + risk * 0.2 + consistency * 0.15 + discipline * 0.15) : 0;
  let total = Number.isFinite(total0) ? clamp(total0) : 0;
  if (a.trades && a.trades < 5) total = Math.min(total, 50 + a.trades * 2);   // نمونهٔ خیلی کم: امتیاز بالا گمراه‌کننده است
  const g = GRADES.find((x) => total >= x[0]) || GRADES[GRADES.length - 1];
  const hold = a.avgHold;
  let style;
  if (hold != null) style = hold < 10 ? 'اسکالپر' : hold < 240 ? 'دی‌تریدر' : hold < 4320 ? 'سوینگ‌تریدر' : 'پوزیشن‌تریدر';
  else if (a.days > 0) { const per = a.trades / a.days; style = per >= 8 ? 'اسکالپر' : per >= 2 ? 'دی‌تریدر' : 'سوینگ‌تریدر'; } else style = 'نامشخص';
  const order = Object.keys(parts).sort((x, y) => parts[y] - parts[x]);
  const strengths = order.filter((k) => parts[k] >= 68).slice(0, 2).map((k) => TXT[k][0]);
  const weaknesses = order.slice().reverse().filter((k) => parts[k] < 50).slice(0, 2).map((k) => TXT[k][1]);
  const rp = {}; for (const k of Object.keys(parts)) rp[k] = Number.isFinite(parts[k]) ? Math.round(parts[k]) : 0;
  return { total, grade: g[1], gradeFa: g[2], style, parts: rp, strengths, weaknesses, lowSample: a.trades < 5 };
}
// END-OF-FILE lib/statement.js
