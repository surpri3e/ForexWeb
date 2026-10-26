// ساخت تصویر اخبار و سشن‌ها برای ربات تلگرام (سمت سرور).
// اول یک SVG ساخته می‌شه و بعد با @resvg/resvg-js به PNG تبدیل می‌شه. اگه اون پکیج نصب نباشه،
// تابع‌ها null برمی‌گردونن و ربات خودش نسخهٔ متنی رو نشون می‌ده؛ پس هیچ چیز خراب نمی‌شه.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const FONTS = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'].map((f) => path.join(FONT_DIR, f)).filter((f) => fs.existsSync(f));

let ResvgCls;
async function loadResvg() {
  if (ResvgCls !== undefined) return ResvgCls;
  try { ResvgCls = (await import('@resvg/resvg-js')).Resvg; } catch { ResvgCls = null; }
  return ResvgCls;
}
export async function svgToPng(svg, width = 1080) {
  const R = await loadResvg();
  if (!R) return null;
  try {
    const r = new R(svg, { fitTo: { mode: 'width', value: width }, font: { fontFiles: FONTS, loadSystemFonts: FONTS.length === 0, defaultFontFamily: 'DejaVu Sans' } });
    return Buffer.from(r.render().asPng());
  } catch (e) { console.error('png render failed:', e && e.message); return null; }
}

/* ---------- زمان در منطقهٔ زمانی ---------- */
const WD_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']; // 0 = Sunday
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');
export function partsIn(ms, tz) {
  let f;
  try { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }); }
  catch { f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }); }
  const o = {};
  f.formatToParts(new Date(ms)).forEach((x) => { o[x.type] = x.value; });
  const wd = WD_EN.indexOf(o.weekday);
  return { y: +o.year, m: +o.month - 1, d: +o.day, hh: +o.hour, mm: +o.minute, wd: wd < 0 ? 0 : wd };
}
const dayNum = (p) => Math.floor(Date.UTC(p.y, p.m, p.d) / 864e5);
export const dateEn = (p) => WD_EN[p.wd] + ' ' + p.d + ' ' + MON_EN[p.m] + ' ' + p.y;
const hmOf = (p) => p2(p.hh) + ':' + p2(p.mm);

/* ---------- انتخاب خبرها ---------- */
export const IMPACT_LABEL = { H: 'فقط مهم‌ها', M: 'مهم و متوسط', L: 'همهٔ سطح‌ها' };
function impactOk(ev, f) {
  if (f === 'H') return ev.i === 'High';
  if (f === 'M') return ev.i === 'High' || ev.i === 'Medium' || ev.i === 'Holiday';
  return true;
}
// mode: d0 امروز | d1 فردا | w این هفته (دوشنبه تا یکشنبه) | nw هفتهٔ بعد
export function pickNews(events, { tz, mode, impact, nowMs }) {
  const now = partsIn(nowMs, tz), today = dayNum(now);
  const mon = today - ((now.wd + 6) % 7);
  let from, to;
  if (mode === 'd0') { from = today; to = today; }
  else if (mode === 'd1') { from = today + 1; to = today + 1; }
  else if (mode === 'nw') { from = mon + 7; to = mon + 13; }
  else { from = mon; to = mon + 6; }
  const rows = [];
  for (const ev of events) {
    const p = partsIn(ev.d, tz), dn = dayNum(p);
    if (dn < from || dn > to || !impactOk(ev, impact)) continue;
    rows.push({ ev, p, dn });
  }
  rows.sort((a, b) => a.ev.d - b.ev.d);
  return { rows, from, to, now };
}
export const MODE_TITLE = { d0: 'اخبار امروز', d1: 'اخبار فردا', w: 'اخبار این هفته', nw: 'اخبار هفتهٔ بعد' };

/* ---------- SVG ---------- */
const X = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const IMP = { High: ['#FF5A64', 'HIGH'], Medium: ['#FFB534', 'MED'], Low: ['#F2E15C', 'LOW'], Holiday: ['#9AA7A0', 'HOL'] };
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const FF = 'DejaVu Sans, sans-serif';
const txt = (x, y, s, size, o = {}) => `<text x="${x}" y="${y}" font-family="${FF}" font-size="${size}"${o.bold ? ' font-weight="700"' : ''} fill="${o.fill || '#F4FFF8'}"${o.op != null ? ` fill-opacity="${o.op}"` : ''} text-anchor="${o.anchor || 'start'}">${X(s)}</text>`;
function frame(W, H, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A3B2C"/><stop offset=".55" stop-color="#0C2F3A"/><stop offset="1" stop-color="#101A33"/></linearGradient>
<radialGradient id="g1" cx=".15" cy=".05" r=".6"><stop offset="0" stop-color="#3AE08A" stop-opacity=".38"/><stop offset="1" stop-color="#3AE08A" stop-opacity="0"/></radialGradient>
<radialGradient id="g2" cx=".95" cy=".9" r=".6"><stop offset="0" stop-color="#4AA8FF" stop-opacity=".32"/><stop offset="1" stop-color="#4AA8FF" stop-opacity="0"/></radialGradient>
<linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".16"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".05"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#g1)"/><rect width="${W}" height="${H}" fill="url(#g2)"/>
${inner}
</svg>`;
}
const glass = (x, y, w, h, r = 28) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#gl)" stroke="#FFFFFF" stroke-opacity=".20" stroke-width="1.5"/>`;
function header(W, title, sub) {
  return glass(30, 30, W - 60, 150, 34) +
    txt(W - 70, 100, title, 54, { bold: true, anchor: 'end', rtl: true }) +
    txt(W - 70, 148, sub, 26, { anchor: 'end', op: 0.72 }) +
    txt(70, 100, 'Surpri3eFX', 30, { bold: true, fill: '#6CF0A8' }) +
    txt(70, 148, 'trading journal', 22, { op: 0.55 });
}
function footer(W, y, note) {
  return txt(W / 2, y, note, 22, { anchor: 'middle', op: 0.5 });
}

function eventRow(x, y, w, r, tzTag) {
  const ev = r.ev, im = IMP[ev.i] || IMP.Low;
  let s = glass(x, y, w, 96, 22);
  s += `<rect x="${x + 16}" y="${y + 20}" width="8" height="56" rx="4" fill="${im[0]}"/>`;
  s += txt(x + 44, y + 58, hmOf(r.p), 34, { bold: true });
  s += `<rect x="${x + 180}" y="${y + 30}" width="84" height="36" rx="18" fill="${im[0]}" fill-opacity=".22" stroke="${im[0]}" stroke-opacity=".7"/>`;
  s += txt(x + 222, y + 56, im[1], 20, { bold: true, anchor: 'middle', fill: im[0] });
  s += txt(x + 290, y + 58, clip(ev.c, 4), 30, { bold: true, fill: '#6CF0A8' });
  s += txt(x + 392, y + 42, clip(ev.t, 36), 28, { bold: false });
  const fp = (ev.f ? 'F ' + clip(ev.f, 10) : '') + (ev.f && ev.p ? '    ' : '') + (ev.p ? 'P ' + clip(ev.p, 10) : '');
  if (fp) s += txt(x + 392, y + 78, fp, 22, { op: 0.62 });
  return s;
}

/* ---------- برداشت سناریویی برای خبرهای مهم ---------- */
const num = (v) => { const m = /^(-?\d+(?:\.\d+)?)\s*([KMBT%]?)/i.exec(String(v == null ? '' : v).replace(/,/g, '').trim()); if (!m) return null; const k = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2].toUpperCase()] || 1; return +m[1] * k; };
// نوع رویداد: rates | infl | jobs | jobsInv | growth | speech | other
const KINDS = [
  [/unemployment rate|jobless claims|unemployment claims/i, 'jobsInv', null],
  [/non-?farm|nfp|payrolls|employment change|employment|adp|jolts|average hourly/i, 'jobs', 'آمار اشتغال'],
  [/\bcpi\b|consumer price|inflation/i, 'infl', 'تورم مصرف‌کننده'],
  [/\bppi\b|producer price|\bpce\b|core price/i, 'infl', 'تورم تولیدکننده / PCE'],
  [/interest rate|rate statement|rate decision|cash rate|bank rate|monetary policy|fomc statement|policy rate|rate announcement/i, 'rates', 'تصمیم نرخ بهره'],
  [/speaks|testifies|press conference|minutes|meeting|statement/i, 'speech', 'سخنرانی یا صورت‌جلسهٔ بانک مرکزی'],
  [/retail sales/i, 'growth', 'خرده‌فروشی'],
  [/gdp/i, 'growth', 'رشد اقتصادی (GDP)'],
  [/pmi|ism|manufacturing|services|industrial|factory|durable|orders/i, 'growth', 'شاخص فعالیت اقتصادی'],
  [/retail sales|consumer spending|consumer confidence|sentiment|confidence|trade balance|housing|home sales|building permits|permits/i, 'growth', 'آمار مصرف و فعالیت']
];
const FXMAP = {
  USD: ['دلار قوی‌تر: طلا و EURUSD معمولاً پایین، USDJPY بالا', 'دلار ضعیف‌تر: طلا و EURUSD معمولاً بالا، USDJPY پایین'],
  EUR: ['یورو قوی‌تر: EURUSD معمولاً بالا', 'یورو ضعیف‌تر: EURUSD معمولاً پایین'],
  GBP: ['پوند قوی‌تر: GBPUSD معمولاً بالا', 'پوند ضعیف‌تر: GBPUSD معمولاً پایین'],
  AUD: ['دلار استرالیا قوی‌تر: AUDUSD معمولاً بالا', 'دلار استرالیا ضعیف‌تر: AUDUSD معمولاً پایین'],
  NZD: ['دلار نیوزیلند قوی‌تر: NZDUSD معمولاً بالا', 'دلار نیوزیلند ضعیف‌تر: NZDUSD معمولاً پایین'],
  CAD: ['دلار کانادا قوی‌تر: USDCAD معمولاً پایین', 'دلار کانادا ضعیف‌تر: USDCAD معمولاً بالا'],
  CHF: ['فرانک قوی‌تر: USDCHF معمولاً پایین', 'فرانک ضعیف‌تر: USDCHF معمولاً بالا'],
  JPY: ['ین قوی‌تر: USDJPY و نیکی معمولاً پایین', 'ین ضعیف‌تر: USDJPY معمولاً بالا']
};
export function outlookFor(ev) {
  let kind = 'other', label = 'داده‌ٔ اقتصادی';
  for (const [re, k, l] of KINDS) if (re.test(ev.t)) { kind = k; label = l || (k === 'jobsInv' ? (/claims/i.test(ev.t) ? 'مدعیان بیمهٔ بیکاری' : 'نرخ بیکاری') : label); break; }
  const fx = FXMAP[ev.c] || [ev.c + ' قوی‌تر در برابر ارزهای مقابل', ev.c + ' ضعیف‌تر در برابر ارزهای مقابل'];
  const f = num(ev.f), pv = num(ev.p);
  let lean = '';
  if (f != null && pv != null && f !== pv) {
    const up = f > pv, inv = kind === 'jobsInv';
    lean = 'پیش‌بینی ' + ev.f + ' از قبلی ' + ev.p + ' ' + (up ? 'بیشتره' : 'کمتره') + (inv ? (up ? '؛ برای ارز نگران‌کننده‌ست' : '؛ برای ارز مثبته') : (kind === 'growth' || kind === 'jobs' || kind === 'infl' ? (up ? '؛ انتظار بهتر شدن' : '؛ انتظار ضعیف‌تر شدن') : ''));
  } else if (f != null || ev.f) lean = 'پیش‌بینی ' + ev.f + (ev.p ? '  |  قبلی ' + ev.p : '');
  let strongIf, weakIf;
  if (kind === 'rates' || kind === 'speech') { strongIf = 'اگر لحن یا تصمیم سخت‌گیرانه‌تر از انتظار باشه'; weakIf = 'اگر نرم‌تر از انتظار باشه'; }
  else if (kind === 'jobsInv') { strongIf = 'اگر عدد واقعی پایین‌تر از پیش‌بینی بیاد'; weakIf = 'اگر بالاتر از پیش‌بینی بیاد'; }
  else { strongIf = 'اگر عدد واقعی بالاتر از پیش‌بینی بیاد'; weakIf = 'اگر پایین‌تر از پیش‌بینی بیاد'; }
  return { label, lean, pairs: [[strongIf, fx[0]], [weakIf, fx[1]]] };
}
// توکن‌های لاتین و عددی توی متن فارسی جدا (ایزوله) می‌شن تا ترتیب نمایش به‌هم نریزه
const iso = (s) => String(s).replace(/([A-Za-z][A-Za-z0-9\/%.\-]*|\d[\d.,]*[%KMBT]?)/g, '\u2066$1\u2069');
const wrapFa = (s, n) => { const out = []; let cur = ''; for (const w of String(s).split(' ')) { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); return out; };
const RANK = { High: 3, Medium: 2, Holiday: 2, Low: 1 };

export function newsSvg({ events, tz, mode, impact, nowMs }) {
  const W = 1080, sel = pickNews(events, { tz, mode, impact, nowMs });
  const weekly = mode === 'w' || mode === 'nw';
  // همیشه یک تصویر: اگه خبرها زیاد بود مهم‌ترها می‌مونن و بقیه کوتاه می‌شن
  const MAXR = weekly ? 14 : 8;
  let rows = sel.rows;
  if (rows.length > MAXR) {
    const keep = new Set(rows.map((r, i) => [r, i]).sort((a, b) => (RANK[b[0].ev.i] || 0) - (RANK[a[0].ev.i] || 0) || a[1] - b[1]).slice(0, MAXR).map((x) => x[1]));
    rows = rows.filter((r, i) => keep.has(i));
  }
  const cut = sel.rows.length - rows.length;
  let y = 220, body = '';
  if (!rows.length) {
    body += glass(30, y, W - 60, 220, 30) + txt(W / 2, y + 120, 'خبری با این فیلتر پیدا نشد', 42, { anchor: 'middle', rtl: true, op: 0.85 });
    y += 250;
  } else if (!weekly) {
    rows.forEach((r) => { body += eventRow(30, y, W - 60, r, tz); y += 110; });
  } else {
    let cur = -1;
    rows.forEach((r) => {
      if (r.dn !== cur) {
        cur = r.dn;
        y += cur === rows[0].dn ? 0 : 14;
        body += txt(W - 64, y + 44, WD_FA[r.p.wd], 40, { bold: true, anchor: 'end', rtl: true, fill: '#6CF0A8' });
        body += txt(64, y + 44, r.p.d + ' ' + MON_EN[r.p.m], 32, { bold: true, op: 0.8 });
        y += 66;
      }
      body += eventRow(30, y, W - 60, r, tz); y += 110;
    });
  }
  if (cut > 0) { body += txt(W / 2, y + 24, '+' + cut + ' more (low priority hidden)', 24, { anchor: 'middle', op: 0.6 }); y += 50; }
  // برداشت سناریویی: حداکثر ۳ خبر مهم
  const key = rows.filter((r) => r.ev.i === 'High' && r.ev.d >= nowMs - 36e5).concat(rows.filter((r) => r.ev.i === 'High' && r.ev.d < nowMs - 36e5));
  const seen = new Set(), picks = [];
  for (const r of key) { const k = r.ev.c + '|' + r.ev.t; if (seen.has(k)) continue; seen.add(k); picks.push(r); if (picks.length >= 3) break; }
  if (picks.length) {
    y += 18;
    body += txt(W - 64, y + 40, 'برداشت سناریویی خبرهای مهم', 34, { bold: true, anchor: 'end', rtl: true, fill: '#6CF0A8' });
    y += 62;
    for (const r of picks) {
      const o = outlookFor(r.ev);
      const h = 76 + (o.lean ? 36 : 0) + o.pairs.length * 78 + 14;
      body += glass(30, y, W - 60, h, 24);
      body += `<rect x="${W - 54}" y="${y + 18}" width="8" height="${h - 36}" rx="4" fill="#FF5A64"/>`;
      body += txt(W - 74, y + 52, o.label + '  ' + iso(r.ev.c) + '  ' + iso(hmOf(r.p)), 30, { bold: true, anchor: 'end', rtl: true });
      let yy = y + 52;
      if (o.lean) { yy += 36; body += txt(W - 74, yy, iso(o.lean), 24, { anchor: 'end', rtl: true, op: 0.65 }); }
      o.pairs.forEach((pr, k) => {
        const col = k === 0 ? '#8DF5B8' : '#FFB3B8';
        yy += 38; body += txt(W - 74, yy, iso(pr[0]), 25, { anchor: 'end', rtl: true, op: 0.7 });
        yy += 38; body += txt(W - 74, yy, iso(pr[1]), 27, { bold: true, anchor: 'end', rtl: true, fill: col });
      });
      y += h + 14;
    }
    body += txt(W - 64, y + 28, 'این برداشت فقط یک سناریوی احتمالیه و توصیهٔ معاملاتی نیست', 22, { anchor: 'end', rtl: true, op: 0.5 });
    y += 44;
  }
  const H = y + 80;
  const dstr = (dn) => dateEn(partsIn(dn * 864e5 + 12 * 36e5, 'UTC'));
  const subRange = weekly ? dstr(sel.from).replace(/^\w+ /, '') + '  -  ' + dstr(sel.to).replace(/^\w+ /, '') : dstr(sel.from);
  const hd = header(W, MODE_TITLE[mode] || 'اخبار', subRange + '   |   ' + tz);
  const ft = footer(W, H - 34, 'Times in ' + tz + '   |   ' + (impact === 'H' ? 'High impact only' : impact === 'M' ? 'High + Medium' : 'All impacts') + '   |   F forecast, P previous');
  return frame(W, H, hd + body + ft);
}

/* ---------- سشن‌ها ---------- */
export const SESSIONS = [
  { fa: 'سیدنی', en: 'Sydney', tz: 'Australia/Sydney', o: 8, c: 17, col: '#5AB0FF' },
  { fa: 'توکیو', en: 'Tokyo', tz: 'Asia/Tokyo', o: 9, c: 18, col: '#FF7A90' },
  { fa: 'لندن', en: 'London', tz: 'Europe/London', o: 8, c: 17, col: '#FFCB4D' },
  { fa: 'نیویورک', en: 'New York', tz: 'America/New_York', o: 8, c: 17, col: '#4DF08A' }
];
function tzOffsetMin(ms, tz) {
  const p = partsIn(ms, tz);
  return Math.round((Date.UTC(p.y, p.m, p.d, p.hh, p.mm) - Math.floor(ms / 6e4) * 6e4) / 6e4);
}
// بازهٔ باز بودن هر سشن به‌صورت دقیقه‌های UTC (امروزِ همان شهر)
export function sessionWindows(nowMs) {
  return SESSIONS.map((s) => {
    const off = tzOffsetMin(nowMs, s.tz), loc = partsIn(nowMs, s.tz);
    const base = Date.UTC(loc.y, loc.m, loc.d) / 6e4;
    let o = base + s.o * 60 - off, c = base + s.c * 60 - off;
    const nowMin = Math.floor(nowMs / 6e4);
    if (c < nowMin) { o += 1440; c += 1440; } // امروز تموم شده؛ فردا
    if (loc.wd === 6 || loc.wd === 0) { /* آخر هفته: بازار بسته‌ست */ }
    return Object.assign({}, s, { open: o, close: c, isOpen: nowMin >= o && nowMin < c && loc.wd !== 6 && loc.wd !== 0 });
  });
}
export function sessionsSvg({ tz, nowMs }) {
  const W = 1080, now = partsIn(nowMs, tz), nowMin = Math.floor(nowMs / 6e4);
  const midnight = nowMin - (now.hh * 60 + now.mm); // دقیقهٔ UTC نیمه‌شب محلی کاربر
  const win = sessionWindows(nowMs);
  const X0 = 90, X1 = W - 60, PH = (X1 - X0) / 24;
  const toX = (min) => X0 + ((min - midnight) / 60) * PH;
  let body = '', y = 220;
  const top = y;
  const rowH = 128, bodyH = 80 + rowH * win.length;
  body += glass(30, y, W - 60, bodyH, 34);
  // خط‌های ساعت
  for (let h = 0; h <= 24; h += 2) {
    const x = X0 + h * PH;
    body += `<line x1="${x}" y1="${y + 64}" x2="${x}" y2="${y + bodyH - 20}" stroke="#FFFFFF" stroke-opacity="${h % 6 === 0 ? 0.16 : 0.07}" stroke-width="1.5"/>`;
    body += txt(x, y + 50, p2(h % 24), 22, { anchor: 'middle', op: 0.6 });
  }
  // همپوشانی لندن/نیویورک
  const L = win[2], N = win[3];
  const segs = (w) => [[w.open - 1440, w.close - 1440], [w.open, w.close], [w.open + 1440, w.close + 1440]].filter((s) => s[1] > midnight && s[0] < midnight + 1440).map((s) => [Math.max(s[0], midnight), Math.min(s[1], midnight + 1440)]);
  const ov = [];
  segs(L).forEach((a) => segs(N).forEach((b) => { const s = Math.max(a[0], b[0]), e = Math.min(a[1], b[1]); if (e > s) ov.push([s, e]); }));
  ov.forEach((o) => { body += `<rect x="${toX(o[0])}" y="${y + 62}" width="${toX(o[1]) - toX(o[0])}" height="${bodyH - 80}" rx="14" fill="#FFFFFF" fill-opacity=".09" stroke="#FFFFFF" stroke-opacity=".28" stroke-dasharray="8 8"/>`; });
  // نوارها
  win.forEach((w, i) => {
    const ry = y + 76 + i * rowH;
    body += txt(X0, ry + 14, w.en + '  ' + (w.isOpen ? 'OPEN' : 'CLOSED'), 26, { bold: true, fill: w.col });
    body += txt(W - 80, ry + 14, w.fa, 30, { bold: true, anchor: 'end', rtl: true });
    segs(w).forEach((s) => {
      const x = toX(s[0]), ww = Math.max(6, toX(s[1]) - x);
      body += `<rect x="${x}" y="${ry + 28}" width="${ww}" height="52" rx="26" fill="${w.col}" fill-opacity="${w.isOpen ? 0.9 : 0.42}"/>`;
      if (ww > 190) {
        const oh = partsIn(Math.max(s[0], w.open) * 6e4, tz), ch = partsIn(Math.min(s[1], w.close) * 6e4, tz);
        body += txt(x + ww / 2, ry + 63, hmOf(oh) + ' - ' + hmOf(ch), 24, { bold: true, anchor: 'middle', fill: '#08221A' });
      }
    });
  });
  // خط «الان»
  const nx = X0 + ((nowMin - midnight) / 60) * PH;
  body += `<line x1="${nx}" y1="${y + 58}" x2="${nx}" y2="${y + bodyH - 14}" stroke="#FF5A64" stroke-width="3"/>`;
  body += `<rect x="${nx - 44}" y="${y + bodyH - 14}" width="88" height="34" rx="17" fill="#FF5A64"/>` + txt(nx, y + bodyH + 10, hmOf(now), 22, { bold: true, anchor: 'middle', fill: '#fff' });
  y += bodyH + 70;
  // توضیح همپوشانی
  if (ov.length) {
    const o = ov[0];
    body += glass(30, y, W - 60, 110, 28);
    body += txt(W - 70, y + 48, 'همپوشانی لندن و نیویورک: پرنوسان‌ترین ساعت‌های روز', 30, { bold: true, anchor: 'end', rtl: true });
    body += txt(W - 70, y + 90, hmOf(partsIn(o[0] * 6e4, tz)) + '  -  ' + hmOf(partsIn(o[1] * 6e4, tz)) + '   (' + tz + ')', 26, { anchor: 'end', op: 0.8 });
    y += 140;
  }
  const H = y + 70;
  const hd = header(W, 'سشن‌های بازار', dateEn(now) + '   |   ' + tz);
  return frame(W, H, hd + body + footer(W, H - 30, 'Session hours follow each city local time (DST included)'));
}

/* ---------- API ---------- */
export async function renderNews(opts) { return svgToPng(newsSvg(opts)); }
export async function renderSessions(opts) { return svgToPng(sessionsSvg(opts)); }
