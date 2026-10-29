// ساخت تصویر اخبار و سشن‌ها برای ربات تلگرام (سمت سرور).
// اول یک SVG ساخته می‌شه و بعد با @resvg/resvg-js به PNG تبدیل می‌شه. اگه اون پکیج نصب نباشه،
// تابع‌ها null برمی‌گردونن و ربات خودش نسخهٔ متنی رو نشون می‌ده؛ پس هیچ چیز خراب نمی‌شه.
import fs from 'fs';
import path from 'path';
import { faStamp, fmtInt, fmtUsd, fmtChg } from './rates.js';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const FONTS = ['Vazirmatn-Regular.ttf', 'Vazirmatn-Bold.ttf', 'DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'].map((f) => path.join(FONT_DIR, f)).filter((f) => fs.existsSync(f));

// موتور تبدیل SVG به PNG: اول @resvg/resvg-js (بومی، سریع)، اگه نصب نشد @resvg/resvg-wasm (بدون نیاز به کامپایل).
let engine;      // undefined = هنوز بررسی نشده، null = هیچ‌کدوم کار نکرد
let engineErr = '';
const shortErr = (e) => String((e && (e.message || e.code)) || e).split('\n')[0].slice(0, 160);
async function loadEngine() {
  if (engine !== undefined) return engine;
  const errs = [];
  try {
    const { Resvg } = await import('@resvg/resvg-js');
    engine = { name: 'resvg-js', run: (svg, w) => Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: w }, font: { fontFiles: FONTS, loadSystemFonts: FONTS.length === 0, defaultFontFamily: 'Vazirmatn' } }).render().asPng()) };
    return engine;
  } catch (e) { errs.push('resvg-js: ' + shortErr(e)); }
  try {
    const wasm = await import('@resvg/resvg-wasm');
    const req = createRequire(import.meta.url);
    let wp;
    try { wp = req.resolve('@resvg/resvg-wasm/index_bg.wasm'); } catch { wp = path.join(path.dirname(req.resolve('@resvg/resvg-wasm')), 'index_bg.wasm'); }
    await wasm.initWasm(fs.readFileSync(wp));
    const bufs = FONTS.map((f) => new Uint8Array(fs.readFileSync(f)));
    engine = { name: 'resvg-wasm', run: (svg, w) => Buffer.from(new wasm.Resvg(svg, { fitTo: { mode: 'width', value: w }, font: { fontBuffers: bufs, defaultFontFamily: 'Vazirmatn' } }).render().asPng()) };
    return engine;
  } catch (e) { errs.push('resvg-wasm: ' + shortErr(e)); }
  engine = null; engineErr = errs.join(' | ');
  return engine;
}
export async function engineInfo() { const e = await loadEngine(); return { name: e ? e.name : null, error: e ? '' : engineErr, fonts: FONTS.length }; }
export async function svgToPng(svg, width = 1080) {
  const E = await loadEngine();
  if (!E) return null;
  try { return E.run(svg, width); }
  catch (e) { engineErr = 'render: ' + shortErr(e); console.error('png render failed:', engineErr); return null; }
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

/* ---------- SVG: قالب Obsidian ---------- */
const X = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const C = { bg: '#0A0E0C', card: '#111714', card2: '#18201C', ln: '#243029', tx: '#EAF0EC', mu: '#93A39A', ac: '#34D399', lo: '#FF7A6B', be: '#F5BE50' };
const IMP = { High: [C.lo, 'HIGH'], Medium: [C.be, 'MED'], Low: ['#7C8F86', 'LOW'], Holiday: ['#B39DDB', 'HOL'] };
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const FF = 'Vazirmatn, DejaVu Sans, sans-serif';
const txt = (x, y, s, size, o = {}) => `<text x="${x}" y="${y}" font-family="${FF}" font-size="${size}"${o.bold ? ' font-weight="700"' : ''} fill="${o.fill || C.tx}"${o.op != null ? ` fill-opacity="${o.op}"` : ''} text-anchor="${o.anchor || 'start'}">${X(s)}</text>`;
function frame(W, H, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<radialGradient id="g1" cx="1" cy="0" r="1"><stop offset="0" stop-color="#34D399" stop-opacity=".20"/><stop offset="1" stop-color="#34D399" stop-opacity="0"/></radialGradient>
<linearGradient id="ln" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#34D399" stop-opacity="0"/><stop offset=".5" stop-color="#34D399" stop-opacity=".8"/><stop offset="1" stop-color="#34D399" stop-opacity="0"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="${C.bg}"/><rect width="${W}" height="700" fill="url(#g1)"/>
${inner}
</svg>`;
}
const card = (x, y, w, h, r = 24, fill = C.card) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${C.ln}" stroke-width="2"/>`;
function header(W, title, sub) {
  return `<rect x="46" y="50" width="76" height="76" rx="22" fill="${C.ac}"/>` +
    txt(84, 106, 'S', 52, { bold: true, anchor: 'middle', fill: '#05241A' }) +
    txt(142, 84, 'Surpri3eFX', 34, { bold: true }) +
    txt(142, 118, 'trading journal', 24, { fill: C.mu }) +
    txt(W - 50, 92, title, 60, { bold: true, anchor: 'end' }) +
    txt(W - 50, 140, sub, 28, { anchor: 'end', fill: C.mu }) +
    `<rect x="46" y="170" width="${W - 92}" height="3" rx="1.5" fill="url(#ln)"/>`;
}
function footer(W, y, note) {
  return txt(W / 2, y, note, 24, { anchor: 'middle', fill: C.mu, op: 0.8 });
}
// یک ردیف خبر؛ h ارتفاع ردیف است و اندازهٔ نوشته‌ها بر اساس آن کم/زیاد می‌شود
function eventRow(x, y, w, h, r) {
  const ev = r.ev, im = IMP[ev.i] || IMP.Low, two = h >= 84 && (ev.f || ev.p);
  let s = card(x, y, w, h, 22);
  s += `<rect x="${x + 16}" y="${y + 14}" width="9" height="${h - 28}" rx="4.5" fill="${im[0]}"/>`;
  const base = two ? y + h / 2 - 6 : y + h / 2 + 12;
  s += txt(x + 46, base, hmOf(r.p), 36, { bold: true });
  s += txt(x + 196, base, clip(ev.c, 4), 34, { bold: true, fill: C.ac });
  s += txt(x + 296, base, clip(ev.t, r.n > 1 ? 30 : 33), 31) + (r.n > 1 ? txt(x + w - 26, base, '+' + (r.n - 1), 28, { bold: true, anchor: 'end', fill: im[0] }) : '');
  if (two) {
    const fp = (ev.f ? 'Forecast ' + clip(ev.f, 10) : '') + (ev.f && ev.p ? '    ' : '') + (ev.p ? 'Previous ' + clip(ev.p, 10) : '');
    s += txt(x + 296, y + h / 2 + 30, fp, 25, { fill: C.mu });
  }
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

// ردیف‌هایی که هم‌زمان و برای یک ارز هستند، یکی می‌شن (مهم‌ترینشون نمایش داده می‌شه)
function mergeRows(rows) {
  const out = [], idx = new Map();
  for (const r of rows) {
    const k = r.dn + '|' + hmOf(r.p) + '|' + r.ev.c;
    if (idx.has(k)) { const t = out[idx.get(k)]; t.n++; if ((RANK[r.ev.i] || 0) > (RANK[t.ev.i] || 0)) { t.ev = r.ev; } }
    else { idx.set(k, out.length); out.push(Object.assign({}, r, { n: 1 })); }
  }
  return out;
}
export function newsSvg({ events, tz, mode, impact, nowMs }) {
  const W = 1080, sel = pickNews(events, { tz, mode, impact, nowMs });
  const weekly = mode === 'w' || mode === 'nw';
  const BUDGET = weekly ? 1250 : 1180;           // ارتفاع مجاز بخش خبرها تا همه توی یک عکس بمونن
  const dayHeads = (rs) => (weekly ? new Set(rs.map((r) => r.dn)).size * 84 : 0);
  const fit = (rs) => dayHeads(rs) + rs.length * 76;
  let rows = sel.rows.map((r) => Object.assign({}, r, { n: 1 }));
  let merged = false;
  if (fit(rows) > BUDGET) { rows = mergeRows(rows); merged = true; }
  for (const keepMin of [2, 3]) {                 // اگه هنوز زیاده: اول کم‌اهمیت‌ها حذف می‌شن
    if (fit(rows) <= BUDGET) break;
    const f = rows.filter((r) => (RANK[r.ev.i] || 0) >= keepMin);
    if (f.length) rows = f;
  }
  while (fit(rows) > BUDGET && rows.length > 1) {  // آخرین راه: کم‌اهمیت‌ترین و دورترین
    let k = 0; for (let i = 1; i < rows.length; i++) if ((RANK[rows[i].ev.i] || 0) <= (RANK[rows[k].ev.i] || 0)) k = i;
    rows.splice(k, 1);
  }
  const shown = rows.reduce((n, r) => n + r.n, 0), cut = Math.max(0, sel.rows.length - shown);
  const rowH = rows.length <= 7 ? 100 : rows.length <= 11 ? 88 : 76;
  let y = 206, body = '';
  if (!rows.length) {
    body += card(30, y, W - 60, 220, 30) + txt(W / 2, y + 126, 'خبری با این فیلتر پیدا نشد', 44, { anchor: 'middle', op: 0.9 });
    y += 250;
  } else {
    let cur = -1;
    rows.forEach((r) => {
      if (weekly && r.dn !== cur) {
        cur = r.dn;
        body += txt(W - 50, y + 56, WD_FA[r.p.wd], 42, { bold: true, anchor: 'end', fill: C.ac });
        body += txt(50, y + 56, r.p.d + ' ' + MON_EN[r.p.m], 34, { bold: true, fill: C.mu });
        y += 84;
      }
      body += eventRow(30, y, W - 60, rowH, r); y += rowH + 12;
    });
  }
  if (cut > 0) { body += txt(W / 2, y + 26, '+' + cut + ' more' + (merged ? ' (grouped)' : ' (low impact hidden)'), 26, { anchor: 'middle', fill: C.mu }); y += 54; }
  // برداشت سناریویی: حداکثر ۲ خبر مهم
  const key = rows.filter((r) => r.ev.i === 'High' && r.ev.d >= nowMs - 36e5).concat(rows.filter((r) => r.ev.i === 'High' && r.ev.d < nowMs - 36e5));
  const seen = new Set(), picks = [];
  for (const r of key) { const k = r.ev.c + '|' + r.ev.t; if (seen.has(k)) continue; seen.add(k); picks.push(r); if (picks.length >= 2) break; }
  if (picks.length) {
    y += 22;
    body += txt(W - 50, y + 40, 'برداشت سناریویی', 40, { bold: true, anchor: 'end', fill: C.ac });
    y += 66;
    for (const r of picks) {
      const o = outlookFor(r.ev);
      const h = 80 + (o.lean ? 40 : 0) + o.pairs.length * 82 + 12;
      body += card(30, y, W - 60, h, 26);
      body += `<rect x="${W - 56}" y="${y + 20}" width="9" height="${h - 40}" rx="4.5" fill="${C.lo}"/>`;
      body += txt(W - 80, y + 56, o.label + '  ' + iso(r.ev.c) + '  ' + iso(hmOf(r.p)), 34, { bold: true, anchor: 'end' });
      let yy = y + 56;
      if (o.lean) { yy += 40; body += txt(W - 80, yy, iso(o.lean), 26, { anchor: 'end', fill: C.mu }); }
      o.pairs.forEach((pr, k) => {
        const col = k === 0 ? C.ac : C.lo;
        yy += 42; body += txt(W - 80, yy, iso(pr[0]), 27, { anchor: 'end', fill: C.mu });
        yy += 40; body += txt(W - 80, yy, iso(pr[1]), 30, { bold: true, anchor: 'end', fill: col });
      });
      y += h + 14;
    }
    body += txt(W - 50, y + 30, 'این فقط یک سناریوی احتمالیه و توصیهٔ معاملاتی نیست', 24, { anchor: 'end', fill: C.mu, op: 0.8 });
    y += 52;
  }
  const H = y + 86;
  const dstr = (dn) => dateEn(partsIn(dn * 864e5 + 12 * 36e5, 'UTC'));
  const subRange = weekly ? dstr(sel.from).replace(/^\w+ /, '') + '  -  ' + dstr(sel.to).replace(/^\w+ /, '') : dstr(sel.from);
  const hd = header(W, MODE_TITLE[mode] || 'اخبار', subRange + '   |   ' + tz);
  const ft = footer(W, H - 36, (impact === 'H' ? 'High impact' : impact === 'M' ? 'High + Medium' : 'All impacts') + '   |   Times in ' + tz);
  return frame(W, H, hd + body + ft);
}

/* ---------- سشن‌ها ---------- */
export const SESSIONS = [
  { fa: 'سیدنی', en: 'Sydney', tz: 'Australia/Sydney', o: 8, c: 17, col: '#60A5FA' },
  { fa: 'توکیو', en: 'Tokyo', tz: 'Asia/Tokyo', o: 9, c: 18, col: '#FB7185' },
  { fa: 'لندن', en: 'London', tz: 'Europe/London', o: 8, c: 17, col: '#F5BE50' },
  { fa: 'نیویورک', en: 'New York', tz: 'America/New_York', o: 8, c: 17, col: '#34D399' }
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
  const X0 = 70, X1 = W - 60, PH = (X1 - X0) / 24;
  const toX = (min) => X0 + ((min - midnight) / 60) * PH;
  let body = '', y = 206;
  const rowH = 150, bodyH = 96 + rowH * win.length;
  body += card(30, y, W - 60, bodyH, 32);
  for (let h = 0; h <= 24; h += 2) {
    const x = X0 + h * PH;
    body += `<line x1="${x}" y1="${y + 76}" x2="${x}" y2="${y + bodyH - 24}" stroke="${C.ln}" stroke-width="2"/>`;
    body += txt(x, y + 58, p2(h % 24), 24, { anchor: 'middle', fill: C.mu });
  }
  const L = win[2], N = win[3];
  const segs = (w) => [[w.open - 1440, w.close - 1440], [w.open, w.close], [w.open + 1440, w.close + 1440]].filter((q) => q[1] > midnight && q[0] < midnight + 1440).map((q) => [Math.max(q[0], midnight), Math.min(q[1], midnight + 1440)]);
  const ov = [];
  segs(L).forEach((a1) => segs(N).forEach((b1) => { const s1 = Math.max(a1[0], b1[0]), e1 = Math.min(a1[1], b1[1]); if (e1 > s1) ov.push([s1, e1]); }));
  ov.forEach((o) => { body += `<rect x="${toX(o[0])}" y="${y + 72}" width="${toX(o[1]) - toX(o[0])}" height="${bodyH - 96}" rx="16" fill="${C.ac}" fill-opacity=".08" stroke="${C.ac}" stroke-opacity=".55" stroke-width="2" stroke-dasharray="10 8"/>`; });
  win.forEach((w, i) => {
    const ry = y + 96 + i * rowH;
    body += txt(X0, ry + 16, w.en, 32, { bold: true, fill: w.col });
    body += txt(X0 + 220, ry + 16, w.isOpen ? 'OPEN' : 'CLOSED', 24, { bold: true, fill: w.isOpen ? C.ac : C.mu });
    body += txt(W - 54, ry + 16, w.fa, 36, { bold: true, anchor: 'end' });
    segs(w).forEach((q) => {
      const x = toX(q[0]), ww = Math.max(8, toX(q[1]) - x);
      body += `<rect x="${x}" y="${ry + 34}" width="${ww}" height="62" rx="31" fill="${w.col}" fill-opacity="${w.isOpen ? 1 : 0.4}"/>`;
      if (ww > 200) {
        const oh = partsIn(Math.max(q[0], w.open) * 6e4, tz), ch = partsIn(Math.min(q[1], w.close) * 6e4, tz);
        body += txt(x + ww / 2, ry + 76, hmOf(oh) + ' - ' + hmOf(ch), 28, { bold: true, anchor: 'middle', fill: '#06150F' });
      }
    });
  });
  const nx = X0 + ((nowMin - midnight) / 60) * PH;
  body += `<line x1="${nx}" y1="${y + 70}" x2="${nx}" y2="${y + bodyH - 20}" stroke="${C.lo}" stroke-width="4"/>`;
  body += `<rect x="${nx - 52}" y="${y + bodyH - 22}" width="104" height="42" rx="21" fill="${C.lo}"/>` + txt(nx, y + bodyH + 8, hmOf(now), 26, { bold: true, anchor: 'middle', fill: '#1A0A07' });
  y += bodyH + 78;
  if (ov.length) {
    const o = ov[0];
    body += card(30, y, W - 60, 128, 28);
    body += `<rect x="${W - 56}" y="${y + 22}" width="9" height="84" rx="4.5" fill="${C.ac}"/>`;
    body += txt(W - 80, y + 56, 'همپوشانی لندن و نیویورک', 36, { bold: true, anchor: 'end' });
    body += txt(W - 80, y + 102, 'پرنوسان‌ترین ساعت‌های روز  ' + iso(hmOf(partsIn(o[0] * 6e4, tz)) + ' - ' + hmOf(partsIn(o[1] * 6e4, tz))), 28, { anchor: 'end', fill: C.mu });
    y += 160;
  }
  const H = y + 76;
  const hd = header(W, 'سشن‌های بازار', dateEn(now) + '   |   ' + tz);
  return frame(W, H, hd + body + footer(W, H - 30, 'Session hours follow each city local time (DST included)'));
}

/* ---------- API ---------- */
export async function renderNews(opts) { return svgToPng(newsSvg(opts)); }
export async function renderSessions(opts) { return svgToPng(sessionsSvg(opts)); }

// ---------- نرخ ارز، طلا و ارز دیجیتال ----------
export function ratesSvg({ data, tz }) {
  const W = 1080, d = data || { fiat: [], gold: [], crypto: [], usdt: null };
  const st = faStamp(d.at || Date.now(), tz || 'Asia/Tehran');
  const crypto = [];
  if (d.usdt) crypto.push({ sym: 'USDT', name: 'تتر', price: fmtInt(d.usdt.price), unit: 'تومان', chg: d.usdt.chg });
  (d.crypto || []).forEach((c) => crypto.push({ sym: c.sym, name: c.name, price: fmtUsd(c.usd), unit: 'دلار', chg: c.chg }));
  const fiat = (d.fiat || []).map((f) => ({ sym: f.code, name: f.name, price: fmtInt(f.price), unit: 'تومان', chg: f.chg }));
  const gold = (d.gold || []).map((g) => ({ sym: g.key === 'ons' ? 'XAU' : g.key === 'coin' ? 'COIN' : g.key === 'silver' ? 'XAG' : 'GOLD', name: g.name, price: g.unit === 'دلار' ? fmtUsd(g.price) : fmtInt(g.price), unit: g.unit, chg: g.chg }));
  const ROW = 88, GAP = 24, CW = 470;
  let y = 206, body = '';
  const section = (title, items, cols = 2) => {
    if (!items.length) return;
    const CWd = cols === 1 ? W - 60 - 56 : CW;
    const rows = Math.ceil(items.length / cols), h = 84 + rows * ROW + 8;
    body += card(30, y, W - 60, h, 32);
    body += txt(W - 66, y + 56, title, 34, { bold: true, anchor: 'end' });
    body += `<rect x="${W - 66 - 6}" y="${y + 72}" width="0" height="0"/>`;
    items.forEach((it, i) => {
      const col = i % cols, r = Math.floor(i / cols);
      const cx = col === 0 ? W - 30 - 28 - CWd : 30 + 28, cy = y + 84 + r * ROW;      // ستون اول سمت راست
      const right = cx + CWd;
      if (r > 0) body += `<line x1="${cx}" y1="${cy - 2}" x2="${right}" y2="${cy - 2}" stroke="${C.ln}" stroke-width="2" stroke-opacity=".7"/>`;
      body += `<rect x="${right - 92}" y="${cy + 14}" width="92" height="52" rx="14" fill="${C.card2}" stroke="${C.ln}" stroke-width="2"/>`;
      body += txt(right - 46, cy + 49, it.sym, it.sym.length > 4 ? 22 : 26, { bold: true, anchor: 'middle', fill: C.ac });
      body += txt(right - 108, cy + 48, clip(it.name, 18), 26, { anchor: 'end', fill: C.mu });
      body += txt(cx + 4, cy + 46, '⁦' + it.price + '⁩', 36, { bold: true, anchor: 'start' });
      const chg = fmtChg(it.chg);
      body += txt(cx + 4, cy + 72, it.unit + (chg ? '  ' : ''), 20, { anchor: 'start', fill: C.mu, op: 0.85 });
      if (chg) body += txt(cx + 4 + (it.unit === 'تومان' ? 78 : 60), cy + 72, '⁦' + chg + '⁩', 20, { anchor: 'start', bold: true, fill: it.chg < 0 ? C.lo : C.ac });
    });
    y += h + GAP;
  };
  section('ارز (بازار آزاد)', fiat);
  section('طلا، سکه و نقره', gold, 1);
  section('ارز دیجیتال', crypto);
  if (!fiat.length && !gold.length && !crypto.length) { body += card(30, y, W - 60, 220, 32) + txt(W / 2, y + 120, 'اطلاعاتی در دسترس نیست', 34, { anchor: 'middle', fill: C.mu }); y += 244; }
  const H = y + 80;
  return frame(W, H, header(W, 'نرخ ارز و طلا', '\u202B' + st.date + '\u202C') + body + footer(W, H - 34, '\u202B' + 'به‌روزرسانی ' + st.time + ' · قیمت‌ها تقریبی‌اند؛ برای خرید و فروش به نرخ صرافی نگاه کن' + '\u202C'));
}
export async function renderRates(opts) { return svgToPng(ratesSvg(opts)); }
