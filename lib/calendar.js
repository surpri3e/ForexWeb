// تقویم شمسی (با تعطیلات و مناسبت‌ها به ترتیب ماه) و تقویم میلادی (مناسبت‌های جهانی + تعطیلی بازار آمریکا).
// تعطیلات رسمی ۱۴۰۵ از تقویم رسمی کشور گرفته شده؛ تعطیلات قمری سال‌های دیگه با تقویم قمری محاسبه می‌شن و چون به رؤیت هلال بستگی دارن «تقریبی» (±۱ روز) علامت می‌خورن.

const div = (a, b) => ~~(a / b), mod = (a, b) => a - ~~(a / b) * b;
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
function jalCal(jy, withoutLeap) {
  const bl = BREAKS.length; let gy = jy + 621, leapJ = -14, jp = BREAKS[0], jm, jump = 0, leap, n;
  for (let i = 1; i < bl; i++) { jm = BREAKS[i]; jump = jm - jp; if (jy < jm) break; leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4); jp = jm; }
  n = jy - jp; leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150, march = 20 + leapJ - leapG;
  if (withoutLeap) return { gy, march };
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  leap = mod(mod(n + 1, 33) - 1, 4); if (leap === -1) leap = 4;
  return { leap, gy, march };
}
const g2d = (gy, gm, gd) => { let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408; d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752; return d; };
const d2g = (jdn) => { let j = 4 * jdn + 139361631; j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908; const i = div(mod(j, 1461), 4) * 5 + 308; const gd = div(mod(i, 153), 5) + 1, gm = mod(div(i, 153), 12) + 1, gy = div(j, 1461) - 100100 + div(8 - gm, 6); return { gy, gm, gd }; };
const j2d = (jy, jm, jd) => { const r = jalCal(jy, true); return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1; };
export function toJalali(gy, gm, gd) {
  const jdn = g2d(gy, gm, gd); let jy = d2g(jdn).gy - 621; const r = jalCal(jy, false), jdn1f = g2d(r.gy, 3, r.march); let k = jdn - jdn1f, jm, jd;
  if (k >= 0) { if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 }; k -= 186; } else { jy -= 1; k += 179; if (r.leap === 1) k += 1; }
  jm = 7 + div(k, 30); jd = mod(k, 30) + 1; return { jy, jm, jd };
}
export function toGregorian(jy, jm, jd) { return d2g(j2d(jy, jm, jd)); }
export const jMonthDays = (jy, jm) => (jm <= 6 ? 31 : jm <= 11 ? 30 : (j2d(jy + 1, 1, 1) - j2d(jy, 12, 1)));
// روز هفته: ۰=شنبه … ۶=جمعه
export const jWeekday = (jy, jm, jd) => { const g = toGregorian(jy, jm, jd); return (new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).getUTCDay() + 1) % 7; };

export const J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
export const G_MONTHS = ['ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن', 'ژوئیه', 'آگوست', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'];
export const WD_FA = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
export const faNum = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

// ---------- شمسی: مناسبت‌های ثابت ----------
// [ماه, روز, عنوان, تعطیل؟]
const SOLAR = [
  [1, 1, 'جشن نوروز', 1], [1, 2, 'تعطیلات نوروز', 1], [1, 3, 'تعطیلات نوروز', 1], [1, 4, 'تعطیلات نوروز', 1],
  [1, 12, 'روز جمهوری اسلامی ایران', 1], [1, 13, 'روز طبیعت (سیزده‌به‌در)', 1], [1, 20, 'روز ملی فناوری هسته‌ای', 0], [1, 25, 'روز بزرگداشت عطار نیشابوری', 0], [1, 29, 'روز ارتش جمهوری اسلامی', 0],
  [2, 1, 'روز بزرگداشت سعدی', 0], [2, 10, 'روز ملی خلیج فارس', 0], [2, 12, 'روز معلم', 0], [2, 25, 'روز بزرگداشت فردوسی', 0], [2, 28, 'روز بزرگداشت حکیم عمر خیام', 0],
  [3, 3, 'آزادسازی خرمشهر', 0], [3, 14, 'رحلت امام خمینی (ره)', 1], [3, 15, 'قیام ۱۵ خرداد', 1],
  [4, 7, 'روز قوه قضاییه', 0],
  [5, 14, 'روز مشروطیت', 0],
  [6, 17, 'قیام ۱۷ شهریور', 0],
  [7, 7, 'روز آتش‌نشانی و ایمنی', 0],
  [8, 13, 'روز دانش‌آموز', 0],
  [9, 16, 'روز دانشجو', 0], [9, 30, 'شب یلدا', 0],
  [11, 12, 'بازگشت امام خمینی (ره) به ایران', 0], [11, 22, 'پیروزی انقلاب اسلامی', 1],
  [12, 15, 'روز درختکاری', 0], [12, 29, 'ملی شدن صنعت نفت ایران', 1]
];
// ---------- قمری: تعطیلات رسمی [ماه قمری, روز, عنوان] ----------
const LUNAR = [
  [10, 1, 'عید سعید فطر'], [10, 2, 'تعطیل به مناسبت عید فطر'], [10, 25, 'شهادت امام جعفر صادق (ع)'],
  [12, 7, 'شهادت امام محمد باقر (ع)'], [12, 10, 'عید سعید قربان'], [12, 18, 'عید سعید غدیر خم'],
  [1, 9, 'تاسوعای حسینی'], [1, 10, 'عاشورای حسینی'], [2, 20, 'اربعین حسینی'], [2, 28, 'رحلت پیامبر اکرم (ص) و شهادت امام حسن مجتبی (ع)'],
  [2, 30, 'شهادت امام رضا (ع)'], [3, 8, 'شهادت امام حسن عسکری (ع)'], [3, 17, 'میلاد پیامبر اکرم (ص) و امام جعفر صادق (ع)'],
  [6, 3, 'شهادت حضرت فاطمه زهرا (س)'], [7, 13, 'ولادت امام علی (ع) و روز پدر'], [7, 27, 'مبعث پیامبر اکرم (ص)'],
  [8, 15, 'ولادت حضرت قائم (عج) و جشن نیمه شعبان'], [9, 21, 'شهادت امام علی (ع)']
];
// تقویم رسمی ۱۴۰۵ (تأییدشده): [ماه, روز, عنوان]
const OFFICIAL_1405 = [
  [1, 1, 'عید سعید فطر'], [1, 24, 'شهادت امام جعفر صادق (ع)'], [3, 3, 'شهادت امام محمد باقر (ع)'], [3, 6, 'عید سعید قربان'], [3, 14, 'عید سعید غدیر خم'],
  [4, 3, 'تاسوعای حسینی'], [4, 4, 'عاشورای حسینی'], [5, 13, 'اربعین حسینی'], [5, 21, 'رحلت پیامبر اکرم (ص) و شهادت امام حسن مجتبی (ع)'], [5, 22, 'شهادت امام رضا (ع)'],
  [5, 30, 'شهادت امام حسن عسکری (ع)'], [6, 8, 'میلاد پیامبر اکرم (ص) و امام جعفر صادق (ع)'], [8, 22, 'شهادت حضرت فاطمه زهرا (س)'], [10, 2, 'ولادت امام علی (ع) و روز پدر'],
  [10, 16, 'مبعث پیامبر اکرم (ص)'], [11, 4, 'ولادت حضرت قائم (عج) و جشن نیمه شعبان'], [12, 9, 'شهادت امام علی (ع)'], [12, 19, 'عید سعید فطر'], [12, 20, 'تعطیل به مناسبت عید فطر']
];
const VERIFIED = { 1405: OFFICIAL_1405 };

const hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const hijriOf = (gy, gm, gd) => { const o = {}; hijriFmt.formatToParts(new Date(Date.UTC(gy, gm - 1, gd))).forEach((p) => { o[p.type] = +p.value; }); return { m: o.month, d: o.day }; };
// مناسبت‌های قمری یک سال شمسی (برای سال‌های تأییدنشده: محاسبه‌ای و تقریبی)
const lunarCache = new Map();
function lunarOf(jy) {
  if (lunarCache.has(jy)) return lunarCache.get(jy);
  const out = [];
  if (VERIFIED[jy]) VERIFIED[jy].forEach(([m, d, t]) => out.push({ m, d, t, h: 1, approx: false }));
  else {
    const days = jMonthDays(jy, 1) + 0; void days;
    const start = j2d(jy, 1, 1), end = j2d(jy + 1, 1, 1);
    for (let j = start; j < end; j++) {
      const g = d2g(j), hh = hijriOf(g.gy, g.gm, g.gd);
      // رؤیت هلال در ایران معمولاً یک روز دیرتر/زودتر از ام‌القری می‌شه؛ پس «تقریبی»
      for (const [lm, ld, t] of LUNAR) if (hh.m === lm && hh.d === ld) { const jj = toJalali(g.gy, g.gm, g.gd); out.push({ m: jj.jm, d: jj.jd, t, h: 1, approx: true }); }
    }
  }
  lunarCache.set(jy, out); return out;
}
export function persianMonth(jy, jm) {
  const n = jMonthDays(jy, jm), days = [];
  for (let d = 1; d <= n; d++) days.push({ d, wd: jWeekday(jy, jm, d), items: [], holiday: false, approx: false });
  for (const [m, d, t, h] of SOLAR) if (m === jm && d <= n) { const x = days[d - 1]; x.items.push({ t, h: !!h }); if (h) x.holiday = true; }
  for (const e of lunarOf(jy)) if (e.m === jm && e.d <= n) { const x = days[e.d - 1]; if (!x.items.some((i) => i.t === e.t)) x.items.push({ t: e.t, h: true, approx: e.approx }); x.holiday = true; if (e.approx) x.approx = true; }
  // «عید فطر» و «نوروز» توی یک روز هم‌پوشانی دارن؛ تعطیلات نوروز با عنوان تکراری یکی بشه
  for (const x of days) { const seen = new Set(); x.items = x.items.filter((i) => (seen.has(i.t) ? false : (seen.add(i.t), true))); }
  return { jy, jm, name: J_MONTHS[jm - 1], days, firstWd: days[0].wd, verified: !!VERIFIED[jy], holidays: days.filter((x) => x.holiday).length };
}
// ---------- میلادی ----------
const nthWd = (y, m, wd, n) => { let c = 0; for (let d = 1; d <= 31; d++) { const dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCMonth() !== m - 1) break; if (dt.getUTCDay() === wd && ++c === n) return d; } return 0; };
const lastWd = (y, m, wd) => { for (let d = 31; d >= 1; d--) { const dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCMonth() === m - 1 && dt.getUTCDay() === wd) return d; } return 0; };
export function easter(y) { const a = y % 19, b = div(y, 100), c = y % 100, d = div(b, 4), e = b % 4, f = div(b + 8, 25), g = div(b - f + 1, 3), h = (19 * a + b - d - g + 15) % 30, i = div(c, 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = div(a + 11 * h + 22 * l, 451), mo = div(h + l - 7 * m + 114, 31), da = ((h + l - 7 * m + 114) % 31) + 1; return { m: mo, d: da }; }
// [ماه, روز, عنوان, بازار آمریکا بسته؟]
const GLOBAL = [
  [1, 1, 'سال نو میلادی', 1], [1, 24, 'روز جهانی آموزش'], [2, 4, 'روز جهانی مبارزه با سرطان'], [2, 11, 'روز جهانی زنان و دختران در علم'], [2, 14, 'روز ولنتاین'], [2, 21, 'روز جهانی زبان مادری'],
  [3, 8, 'روز جهانی زن'], [3, 14, 'روز عدد پی (π)'], [3, 20, 'روز جهانی شادی'], [3, 21, 'روز جهانی نوروز و شعر'], [3, 22, 'روز جهانی آب'],
  [4, 1, 'روز شوخی (April Fools)'], [4, 7, 'روز جهانی بهداشت'], [4, 22, 'روز جهانی زمین'], [4, 23, 'روز جهانی کتاب'],
  [5, 1, 'روز جهانی کارگر'], [5, 3, 'روز جهانی آزادی مطبوعات'], [5, 12, 'روز جهانی پرستار'], [5, 31, 'روز جهانی بدون دخانیات'],
  [6, 1, 'روز جهانی کودک'], [6, 5, 'روز جهانی محیط زیست'], [6, 19, 'جونتینث (Juneteenth)', 1], [6, 21, 'روز جهانی یوگا'],
  [7, 4, 'روز استقلال آمریکا', 1], [7, 11, 'روز جهانی جمعیت'],
  [8, 12, 'روز جهانی جوانان'], [8, 19, 'روز جهانی عکاسی'],
  [9, 8, 'روز جهانی سوادآموزی'], [9, 21, 'روز جهانی صلح'], [9, 27, 'روز جهانی گردشگری'],
  [10, 1, 'روز جهانی سالمندان'], [10, 5, 'روز جهانی معلم'], [10, 10, 'روز جهانی سلامت روان'], [10, 16, 'روز جهانی غذا'], [10, 31, 'هالووین'],
  [11, 14, 'روز جهانی دیابت'], [11, 16, 'روز جهانی مدارا'], [11, 20, 'روز جهانی کودک (سازمان ملل)'],
  [12, 1, 'روز جهانی ایدز'], [12, 3, 'روز جهانی افراد دارای معلولیت'], [12, 10, 'روز جهانی حقوق بشر'], [12, 25, 'کریسمس', 1], [12, 31, 'شب سال نو میلادی']
];
export function gregorianMonth(gy, gm) {
  const n = new Date(Date.UTC(gy, gm, 0)).getUTCDate(), days = [];
  for (let d = 1; d <= n; d++) days.push({ d, wd: (new Date(Date.UTC(gy, gm - 1, d)).getUTCDay() + 1) % 7, items: [], closed: false });
  const add = (m, d, t, closed) => { if (m === gm && d >= 1 && d <= n) { const x = days[d - 1]; if (!x.items.some((i) => i.t === t)) x.items.push({ t, closed: !!closed }); if (closed) x.closed = true; } };
  for (const [m, d, t, c] of GLOBAL) add(m, d, t, c);
  const es = easter(gy); const ed = new Date(Date.UTC(gy, es.m - 1, es.d));
  const rel = (off) => { const x = new Date(ed.getTime() + off * 86400000); return { m: x.getUTCMonth() + 1, d: x.getUTCDate() }; };
  const gf = rel(-2); add(gf.m, gf.d, 'جمعهٔ مقدس (Good Friday)', 1); add(es.m, es.d, 'عید پاک (Easter)', 0); const em = rel(1); add(em.m, em.d, 'دوشنبهٔ عید پاک', 0);
  add(1, nthWd(gy, 1, 1, 3), 'روز مارتین لوتر کینگ', 1); add(2, nthWd(gy, 2, 1, 3), 'روز روسای‌جمهور', 1);
  add(5, nthWd(gy, 5, 0, 2), 'روز مادر (آمریکا)', 0); add(5, lastWd(gy, 5, 1), 'روز یادبود (Memorial Day)', 1);
  add(6, nthWd(gy, 6, 0, 3), 'روز پدر (آمریکا)', 0); add(9, nthWd(gy, 9, 1, 1), 'روز کارگر (آمریکا)', 1);
  const tg = nthWd(gy, 11, 4, 4); add(11, tg, 'شکرگزاری (Thanksgiving)', 1); add(11, tg + 1, 'بلک‌فرایدی (بازار آمریکا نیم‌روزه)', 0);
  // تعطیل آخر هفته: اگه تعطیلی روی شنبه/یکشنبه افتاد، بازار آمریکا یک روز قبل/بعد بسته می‌شه؛ برای سادگی همون روز نمایش داده می‌شه
  return { gy, gm, name: G_MONTHS[gm - 1], days, firstWd: days[0].wd, closures: days.filter((x) => x.closed).length };
}
// ---------- متن تلگرام (HTML) ----------
const ex = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function persianText(jy, jm, todayJ = null) {
  const m = persianMonth(jy, jm), g1 = toGregorian(jy, jm, 1), g2 = toGregorian(jy, jm, m.days.length);
  let t = '<b>📅 تقویم ' + m.name + ' ' + faNum(jy) + '</b>\n<i>' + faNum(g1.gd) + ' ' + G_MONTHS[g1.gm - 1] + ' تا ' + faNum(g2.gd) + ' ' + G_MONTHS[g2.gm - 1] + ' ' + faNum(g2.gy) + '</i>\n';
  const shown = m.days.filter((x) => x.items.length);
  if (!shown.length) t += '\nمناسبت یا تعطیلی ثبت‌شده‌ای نیست.\n';
  for (const x of shown) {
    const isToday = todayJ && todayJ.jy === jy && todayJ.jm === jm && todayJ.jd === x.d;
    t += '\n<b>' + faNum(x.d) + ' ' + m.name + '</b>  ·  ' + WD_FA[x.wd] + (x.holiday ? '  🔴 تعطیل' : '') + (isToday ? '  ◀️ امروز' : '') + '\n';
    for (const i of x.items) t += '   ▫️ ' + ex(i.t) + (i.approx ? ' <i>(تقریبی)</i>' : '') + '\n';
  }
  t += '\n<b>' + faNum(m.holidays) + '</b> روز تعطیل رسمی در این ماه';
  if (m.days.some((x) => x.approx)) t += '\n<i>تاریخ مناسبت‌های قمری تقریبی است و ممکن است یک روز جابه‌جا شود؛ تقویم رسمی همان سال ملاک است.</i>';
  else if (m.verified) t += '\n<i>منبع: تقویم رسمی کشور</i>';
  return t;
}
export function gregorianText(gy, gm, todayG = null) {
  const m = gregorianMonth(gy, gm); const j1 = toJalali(gy, gm, 1);
  let t = '<b>🌍 تقویم میلادی ' + m.name + ' ' + faNum(gy) + '</b>\n<i>معادل ' + J_MONTHS[j1.jm - 1] + ' ' + faNum(j1.jy) + '</i>\n';
  for (const x of m.days) {
    if (!x.items.length) continue;
    const j = toJalali(gy, gm, x.d), isToday = todayG && todayG.y === gy && todayG.m === gm && todayG.d === x.d;
    t += '\n<b>' + faNum(x.d) + ' ' + m.name + '</b>  ·  ' + WD_FA[x.wd] + '  <i>(' + faNum(j.jd) + ' ' + J_MONTHS[j.jm - 1] + ')</i>' + (isToday ? '  ◀️ امروز' : '') + '\n';
    for (const i of x.items) t += '   ▫️ ' + ex(i.t) + (i.closed ? '  🏦 <i>تعطیلی بازار آمریکا</i>' : '') + '\n';
  }
  t += '\n🏦 = روزهایی که بورس و بازار اوراق آمریکا بسته است؛ نقدینگی فارکس و طلا در این روزها معمولاً کم می‌شود.';
  return t;
}

// ---------- نمای آمادهٔ تلگرام (متن + دکمه‌های ماه قبل/بعد/امروز/تغییر تقویم) ----------
export function todayParts(nowMs = Date.now()) {
  const d = new Date(nowMs + 12600000), g = { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  const j = toJalali(g.y, g.m, g.d);
  return { g, j: { jy: j.jy, jm: j.jm, jd: j.jd } };
}
// kind: 's' شمسی | 'g' میلادی؛ prefix مثل 'cal:' یا 'gc:' (داده‌ی دکمه: prefix + kind + ':' + سال + ':' + ماه)
export function calendarView({ kind = 's', y, m, nowMs = Date.now(), prefix = 'cal:' }) {
  const tp = todayParts(nowMs);
  if (kind !== 'g') kind = 's';
  if (!y || !m) { if (kind === 's') { y = tp.j.jy; m = tp.j.jm; } else { y = tp.g.y; m = tp.g.m; } }
  m = Math.min(12, Math.max(1, +m)); y = +y;
  const step = (dir) => { let yy = y, mm = m + dir; if (mm > 12) { mm = 1; yy++; } if (mm < 1) { mm = 12; yy--; } return [yy, mm]; };
  const [py, pm] = step(-1), [ny, nm] = step(1);
  const text = kind === 's' ? persianText(y, m, tp.j) : gregorianText(y, m, tp.g);
  const cb = (k, yy, mm) => prefix + k + ':' + yy + ':' + mm;
  const other = kind === 's' ? ['🌍 تقویم میلادی', cb('g', tp.g.y, tp.g.m)] : ['📅 تقویم شمسی', cb('s', tp.j.jy, tp.j.jm)];
  const label = (yy, mm) => (kind === 's' ? J_MONTHS[mm - 1] : G_MONTHS[mm - 1]) + ' ' + faNum(yy);
  const kb = [[{ text: '‹ ' + label(py, pm), callback_data: cb(kind, py, pm) }, { text: label(ny, nm) + ' ›', callback_data: cb(kind, ny, nm) }],
    [{ text: 'امروز', callback_data: cb(kind, kind === 's' ? tp.j.jy : tp.g.y, kind === 's' ? tp.j.jm : tp.g.m) }, { text: other[0], callback_data: other[1] }]];
  return { text, kb };
}

// END-OF-FILE lib/calendar.js
