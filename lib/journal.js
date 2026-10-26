// منطق ژورنال روی سرور؛ نسخهٔ هم‌ارز موتور داخل index.html (نرمال‌سازی، محاسبهٔ سود، تاریخ‌ها، CSV).
// هیچ وابستگی بیرونی نداره تا هم ربات تلگرام و هم تست‌ها ازش استفاده کنن.

export const DN = ['دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه', 'یکشنبه'];
export const DN_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const dnAt = (c, i) => DN[(i + (c && c.mk === 'cr' ? 5 : 0)) % 7];
export const dnEnAt = (c, i) => DN_EN[(i + (c && c.mk === 'cr' ? 5 : 0)) % 7];
export const SES = { a: 'آسیا', l: 'لندن', n: 'نیویورک' };
export const SES_EN = { a: 'Asia', l: 'London', n: 'New York' };
export const MONTHS_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

const D = (e) => Math.round((e + Number.EPSILON) * 100) / 100;
export const round2 = D;
const Sa = (e) => { e = Math.floor(+e); return Number.isFinite(e) && e > 0 ? e : 0; };
const Nt = (e) => Math.min(99, Sa(e));
const pad2 = (n) => String(n).padStart(2, '0');

/* ---------- تاریخ (بدون وابستگی به منطقهٔ زمانی سرور) ---------- */
export const ymdToDay = (y, m, d) => Math.floor(Date.UTC(y, m, d) / 864e5);
export function dayToYmd(n) { const t = new Date(n * 864e5); return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() }; }
export const weekdayOf = (n) => (((n + 3) % 7) + 7) % 7; // 0=دوشنبه ... 6=یکشنبه
// نوع بازار: 'fx' فارکس (هفته از دوشنبه، ۵ روزه)  |  'cr' کریپتو (هفتهٔ کامل شنبه تا جمعه، ۷ روزه)
export const MARKETS = { fx: 'فارکس', cr: 'کریپتو' };
export const anchorOf = (c) => (c && c.mk === 'cr' ? 5 : 0); // روز شروع هفته: ۰=دوشنبه ... ۵=شنبه
export const weekStartOfDay = (dn, c) => dn - ((((weekdayOf(dn) - anchorOf(c)) % 7) + 7) % 7);
export const sameYmd = (a, b) => !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d;
export const isoOf = (t) => t.y + '-' + pad2(t.m + 1) + '-' + pad2(t.d);

// گرگوری به جلالی (همان الگوریتم سایت)
export function gToJ(e, a, n) {
  const s = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const o = a > 2 ? e + 1 : e;
  let l = 355666 + 365 * e + Math.floor((o + 3) / 4) - Math.floor((o + 99) / 100) + Math.floor((o + 399) / 400) + n + s[a - 1];
  let d = -1595 + 33 * Math.floor(l / 12053);
  l %= 12053; d += 4 * Math.floor(l / 1461); l %= 1461;
  if (l > 365) { d += Math.floor((l - 1) / 365); l = (l - 1) % 365; }
  const u = l < 186 ? 1 + Math.floor(l / 31) : 7 + Math.floor((l - 186) / 30);
  const g = 1 + (l < 186 ? l % 31 : (l - 186) % 30);
  return [d, u, g];
}
// جلالی به گرگوری
export function jToG(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097); days %= 146097;
  if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const sal = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0; while (gm < 13 && gd > sal[gm]) { gd -= sal[gm]; gm++; }
  return { y: gy, m: gm - 1, d: gd };
}
const toFaDigits = (s) => String(s).replace(/\d/g, (a) => '۰۱۲۳۴۵۶۷۸۹'[a]);
export const faNum = toFaDigits;
export function dateLabel(t, cal, short) {
  if (!t) return '';
  if (cal === 'j') { const j = gToJ(t.y, t.m + 1, t.d); return toFaDigits(j[2]) + ' ' + MONTHS_FA[j[1] - 1] + (short ? '' : ' ' + toFaDigits(j[0])); }
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return t.d + ' ' + M[t.m] + (short ? '' : ' ' + t.y);
}
// ورودی کاربر: 2026-10-24 یا 1405/08/02 (ارقام فارسی هم قبوله)
export function parseDateInput(str, now) {
  let s = String(str || '').trim().replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 1776).replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 1632);
  s = s.replace(/[.\-\\]/g, '/');
  const lw = s.toLowerCase();
  if (now) {
    const t = ymdToDay(now.y, now.m, now.d);
    if (/^(امروز|today)$/.test(lw)) return dayToYmd(t);
    if (/^(دیروز|yesterday)$/.test(lw)) return dayToYmd(t - 1);
  }
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (!m) return null;
  let y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (y < 1700) { const g = jToG(y, mo, d); y = g.y; mo = g.m + 1; d = g.d; }
  const t = ymdToDay(y, mo - 1, d), back = dayToYmd(t);
  if (back.m !== mo - 1 || back.d !== d) return null;
  return back;
}
// الان در منطقهٔ زمانی کاربر
export function nowInTz(tz, date) {
  const dt = date || new Date();
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(dt);
    const g = (k) => +p.find((x) => x.type === k).value;
    return { y: g('year'), m: g('month') - 1, d: g('day'), hh: g('hour'), mm: g('minute') };
  } catch { return nowInTz('Asia/Tehran', dt); }
}
export const hm = (n) => pad2(n.hh) + ':' + pad2(n.mm);

/* ---------- ساخت و نرمال‌سازی ---------- */
export const newTrade = (r) => ({ r, p: '', s: '', h: '', rr: '', f: '', g: '', y: '', i: '', z: '' });
export const newDay = (date) => ({ tp: 0, sl: 0, be: 0, date, note: '', m: 'a', v: '', t: [], u: 0 });
export function weekId(w) {
  const a = +w.d[0].date;
  return a >= 1 && a <= 31 ? 'w' + w.year + pad2(w.month + 1) + pad2(a) : 'r' + Math.random().toString(36).slice(2, 9);
}
// هفته‌ای که روز اولش ymd باشه (n = ۵ یا ۷ روز)
export function makeWeek(ymd, n) {
  n = n === 7 ? 7 : 5;
  const base = ymdToDay(ymd.y, ymd.m, ymd.d);
  const w = { month: ymd.m, year: ymd.y, c: false, n, d: [] };
  for (let i = 0; i < n; i++) w.d.push(newDay(dayToYmd(base + i).d));
  w.id = weekId(w);
  return w;
}
export function defaultJournal(now, mk) {
  const t = now || nowInTz('Asia/Tehran');
  mk = mk === 'cr' ? 'cr' : 'fx';
  const dn0 = ymdToDay(t.y, t.m, t.d), wd = weekdayOf(dn0);
  let mon;
  if (mk === 'cr') mon = weekStartOfDay(dn0, { mk }); // هفتهٔ شنبه تا جمعه که امروز توشه
  else { mon = dn0 - wd; if (wd >= 5) mon += 7; } // مثل سایت: شنبه و یکشنبه یعنی هفتهٔ بعد
  return {
    balance: 1000, risk: 1, tpPct: 2, target: 0, dd: 0, ddType: 's', ddDay: 0, mode: 'fixed', cal: 'g', lite: false, cardMoney: false,
    setups: [], rules: [], wk7: false, mk, weeks: [makeWeek(dayToYmd(mon), mk === 'cr' ? 7 : 5)],
    meta: { lastBackup: 0, firstUse: Date.now(), lastEdit: 0, dismissDay: 0, seenGuide: false, viewYear: 0, usedSec: 0, loginAsked: false, mkAsked: false }
  };
}
function normTrade(e) {
  e = e || {};
  const a = +e.rr, n = e.f === '' || e.f == null ? NaN : +e.f;
  return {
    r: e.r === 'SL' || e.r === 'BE' ? e.r : 'TP',
    p: String(e.p || '').toUpperCase().slice(0, 12),
    s: SES[e.s] ? e.s : '',
    rr: Number.isFinite(a) && a > 0 ? Math.min(100, a) : '',
    f: Number.isFinite(n) && n >= 0 ? Math.min(1e6, n) : '',
    h: /^\d{1,2}:\d{2}$/.test(String(e.h || '')) ? String(e.h) : '',
    g: String(e.g || '').slice(0, 20),
    y: String(e.y || '').slice(0, 24),
    i: /^[A-Za-z0-9_-]{6,40}$/.test(String(e.i || '')) ? String(e.i) : '',
    z: Number.isFinite(+e.z) && +e.z > 0 ? Math.min(1e4, +e.z) : ''
  };
}
function normDay(e) {
  if (Array.isArray(e)) return Object.assign(newDay(''), { tp: Nt(e[0]), sl: Nt(e[1]) });
  e = e || {};
  const a = Math.floor(+e.date), n = e.v === '' || e.v == null || !Number.isFinite(+e.v) ? '' : +e.v;
  return {
    tp: Nt(e.tp), sl: Nt(e.sl), be: Nt(e.be), date: a >= 1 && a <= 31 ? a : '', note: String(e.note || ''),
    m: e.m === 'p' || e.m === 'b' ? e.m : 'a', v: n, t: (Array.isArray(e.t) ? e.t.slice(0, 30) : []).map(normTrade),
    u: Math.max(0, Math.floor(+e.u) || 0)
  };
}
const cleanList = (a, m, k) => (Array.isArray(a) ? a : []).map((x) => String(x || '').trim().slice(0, k)).filter((x, i, r) => x && r.indexOf(x) === i).slice(0, m);
export function normalizeJournal(e, now) {
  const base = defaultJournal(now, e && e.mk);
  const s = Object.assign(base, e || {});
  s.mk = s.mk === 'cr' ? 'cr' : 'fx';
  if (e && e.tpPct == null && e.rr != null) s.tpPct = D(Math.max(0, +e.risk || 0) * Math.max(0, +e.rr || 0));
  delete s.rr;
  const o = (l, d) => Math.max(0, Math.min(d, +l || 0));
  s.balance = o(s.balance, 1e9); s.risk = o(s.risk, 100); s.tpPct = o(s.tpPct, 1e3); s.target = o(s.target, 1e3); s.dd = o(s.dd, 100); s.ddDay = o(s.ddDay, 100);
  s.ddType = s.ddType === 't' ? 't' : 's';
  if (s.mode !== 'compound') s.mode = 'fixed';
  s.cal = s.cal === 'j' ? 'j' : 'g';
  s.lite = !!s.lite; s.cardMoney = !!s.cardMoney;
  s.setups = cleanList(s.setups, 16, 24); s.rules = cleanList(s.rules, 16, 40); s.wk7 = !!s.wk7;
  s.meta = Object.assign({ lastBackup: 0, firstUse: Date.now(), lastEdit: 0, dismissDay: 0, seenGuide: false, viewYear: 0, usedSec: 0, loginAsked: false, mkAsked: false }, s.meta);
  const nowD = new Date();
  if (!Array.isArray(s.weeks) || !s.weeks.length) s.weeks = defaultJournal(now, s.mk).weeks;
  s.weeks = s.weeks.slice(0, 2600).map((l) => {
    const nn = s.mk === 'cr' || l.n === 7 || (Array.isArray(l.d) && l.d.length > 5) ? 7 : 5;
    let d = Array.isArray(l.d) ? l.d.slice(0, nn) : [];
    while (d.length < nn) d.push(newDay(''));
    const w = {
      month: Number.isInteger(+l.month) && +l.month >= 0 && +l.month <= 11 ? +l.month : nowD.getMonth(),
      year: Math.floor(+l.year) || nowD.getFullYear(), c: !!l.c, n: nn, d: d.map(normDay)
    };
    if (typeof l.id === 'string' && /^[\w-]{3,24}$/.test(l.id)) w.id = l.id;
    if (l.rv && typeof l.rv === 'object') w.rv = { t: String(l.rv.t || '').slice(0, 1000), b: cleanList(l.rv.b, 16, 40) };
    return w;
  });
  const sn = {};
  s.weeks.forEach((w, i) => { let k = w.id || weekId(w); if (sn[k]) k = k + '-' + i; sn[k] = 1; w.id = k; });
  return s;
}

/* ---------- تاریخ روزها ---------- */
export function dayDate(w, a) {
  const n = +w.d[a].date;
  if (!(n >= 1)) return null;
  const s = +w.d[0].date;
  let o = w.year, l = w.month;
  if (a > 0 && s >= 1 && n < s) { l++; if (l > 11) { l = 0; o++; } }
  return { y: o, m: l, d: n };
}
export const weekStartDay = (w) => { const t = dayDate(w, 0); return t ? ymdToDay(t.y, t.m, t.d) : null; };
export function findDay(c, ymd) {
  for (let wi = c.weeks.length - 1; wi >= 0; wi--) {
    const w = c.weeks[wi];
    for (let di = 0; di < w.d.length; di++) if (sameYmd(dayDate(w, di), ymd)) return { wi, di };
  }
  return null;
}
function insertWeekSorted(c, w) {
  const k = weekStartDay(w);
  let at = c.weeks.length;
  if (k != null) for (let i = 0; i < c.weeks.length; i++) { const x = weekStartDay(c.weeks[i]); if (x != null && x > k) { at = i; break; } }
  c.weeks.splice(at, 0, w);
  return at;
}
function expandWeek(w) {
  if (w.n === 7) return;
  const s = dayDate(w, 0); if (!s) return;
  const b = ymdToDay(s.y, s.m, s.d);
  while (w.d.length < 7) w.d.push(newDay(dayToYmd(b + w.d.length).d));
  w.n = 7;
}
// جای روز مورد نظر رو پیدا می‌کنه؛ اگه هفته‌ش نبود می‌سازه (شنبه/یکشنبه هفته رو ۷ روزه می‌کنه)
export function ensureDay(c, ymd) {
  let hit = findDay(c, ymd);
  if (hit) return hit;
  const dn = ymdToDay(ymd.y, ymd.m, ymd.d), wd = weekdayOf(dn), cr = c.mk === 'cr', mon = weekStartOfDay(dn, c);
  let wi = c.weeks.findIndex((w) => weekStartDay(w) === mon);
  if (wi >= 0) { if (wd >= 5 || cr) expandWeek(c.weeks[wi]); }
  else {
    if (c.weeks.length >= 2600) return null;
    wi = insertWeekSorted(c, makeWeek(dayToYmd(mon), cr || wd >= 5 || c.wk7 ? 7 : 5));
  }
  return findDay(c, ymd);
}
// چند هفتهٔ پشت‌سرهم (بکتست)
export function addWeeksRange(c, startYmd, count, n7) {
  const dn = ymdToDay(startYmd.y, startYmd.m, startYmd.d), mon = weekStartOfDay(dn, c);
  let added = 0;
  if (c.mk === 'cr') n7 = true;
  count = Math.max(1, Math.min(104, Math.floor(count) || 1));
  for (let i = 0; i < count; i++) {
    if (c.weeks.length >= 2600) break;
    const m = mon + i * 7;
    const wi = c.weeks.findIndex((w) => weekStartDay(w) === m);
    if (wi >= 0) { if (n7) expandWeek(c.weeks[wi]); continue; }
    insertWeekSorted(c, makeWeek(dayToYmd(m), n7 ? 7 : 5));
    added++;
  }
  return added;
}
export const dayHasData = (d) => !!(d.tp || d.sl || d.be || d.t.length || d.note || (d.m && d.m !== 'a'));
// نوع بازار رو عوض می‌کنه و روزها رو بر اساس تاریخ توی هفته‌های جدید (دوشنبه‌ای / شنبه‌ای) می‌چینه
export function setMarket(c, mk) {
  mk = mk === 'cr' ? 'cr' : 'fx';
  if (c.mk === mk && c.weeks.every((w) => mk !== 'cr' || w.n === 7)) { c.mk = mk; return c; }
  const old = c.weeks;
  c.mk = mk;
  c.weeks = [];
  const reviews = [];
  old.forEach((w) => {
    const first = dayDate(w, 0);
    for (let di = 0; di < w.d.length; di++) {
      const d = w.d[di], dt = dayDate(w, di);
      if (!dt) continue;
      const wk = weekdayOf(ymdToDay(dt.y, dt.m, dt.d)), data = dayHasData(d);
      if (!data && mk === 'fx' && wk >= 5) continue; // آخر هفته خالی فارکس لازم نیست
      const hit = ensureDay(c, dt); if (!hit) continue;
      if (data) { c.weeks[hit.wi].d[hit.di] = JSON.parse(JSON.stringify(d)); }
    }
    if (w.rv && first) { const hit = ensureDay(c, first); if (hit) reviews.push([c.weeks[hit.wi].id, w.rv]); }
  });
  reviews.forEach(([id, rv]) => { const x = c.weeks.find((q) => q.id === id); if (x && (!x.rv || (!x.rv.t && !x.rv.b.length))) x.rv = rv; });
  if (!c.weeks.length) c.weeks = defaultJournal(null, mk).weeks;
  c.weeks.forEach((w, i) => { w.c = i < c.weeks.length - 1; });
  return c;
}
export function addNextWeek(c) {
  const last = c.weeks[c.weeks.length - 1];
  const s = weekStartDay(last);
  const n = last.n === 7 || c.wk7 || c.mk === 'cr' ? 7 : 5;
  if (s == null) { const t = new Date(); return insertWeekSorted(c, makeWeek({ y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }, n)); }
  c.weeks.push(makeWeek(dayToYmd(s + 7), n));
  return c.weeks.length - 1;
}

/* ---------- محاسبه (هم‌ارز we() سایت) ---------- */
const counts = (e) => {
  if (e.t.length) { let a = 0, n = 0, s = 0; for (const o of e.t) o.r === 'TP' ? a++ : o.r === 'SL' ? n++ : s++; return { tp: a, sl: n, be: s }; }
  return { tp: e.tp, sl: e.sl, be: e.be };
};
export function compute(c) {
  const e = c.balance, a = c.risk, n = c.tpPct, s = c.ddDay > 0 && e > 0 ? D(e * c.ddDay / 100) : 0;
  let o = D(e), l = 0, d = 0, u = 0, g = 0, x = 0;
  const k = [], N = [], W = [], wo = [];
  c.weeks.forEach((M, z) => {
    wo[z] = k.length;
    const U = { tp: 0, sl: 0, be: 0, pnl: 0, start: o };
    M.d.forEach((h, y) => {
      const T = o, w = counts(h), R = c.mode === 'fixed' ? e : Math.max(0, o), v = h.m || 'a', b = v !== 'a' && h.v !== '', $ = D(R * a / 100), C = D(R * n / 100);
      let r = 0, F = 0;
      if (h.t.length) {
        for (const K of h.t) {
          const P = K.r === 'TP' ? (K.rr !== '' ? D($ * K.rr) : C) : K.r === 'SL' ? -$ : 0, nt = K.f === '' ? 0 : K.f;
          W.push({ t: K, wi: z, di: y, pnl: D(P - nt) });
          if (P > 0) r = D(r + P); else if (P < 0) F = D(F - P);
          F = D(F + nt);
        }
      } else { r = D(w.tp * C); F = D(w.sl * $); }
      let Y = D(r - F);
      if (b) { Y = D(v === 'p' ? R * Math.max(-100, Math.min(1e3, h.v)) / 100 : Math.max(0, h.v) - o); r = Math.max(Y, 0); F = Math.max(-Y, 0); }
      o = D(o + Y); g = D(g + r); x = D(x + F);
      const V = w.tp + w.sl + w.be > 0 || b;
      l += w.tp; d += w.sl; u += w.be; U.tp += w.tp; U.sl += w.sl; U.be += w.be; U.pnl = D(U.pnl + Y);
      const S = s > 0 && Y < 0 ? (-Y >= s ? 2 : -Y >= s * 0.8 ? 1 : 0) : 0;
      k.push({ wi: z, di: y, pnl: Y, profit: r, loss: F, before: T, bal: o, traded: V, manual: b, tp: w.tp, sl: w.sl, be: w.be, lim: S, dt: dayDate(M, y) || { y: M.year, m: M.month, d: 1 } });
    });
    U.end = o; N.push(U);
  });
  return { tp: l, sl: d, be: u, gp: g, gl: x, bal: o, bal0: e, days: k, weeks: N, trades: W, dayLimit: s, net: D(o - e), wo };
}

/* ---------- ثبت: عملیات روی ژورنال ---------- */
export function bumpDay(c, wi, di, k, dir, timeHM) {
  const w = c.weeks[wi]; if (!w) return { ok: false, why: 'week' };
  const dr = w.d[di]; if (!dr) return { ok: false, why: 'day' };
  if (dr.m && dr.m !== 'a') return { ok: false, why: 'manual' };
  const K = k.toUpperCase();
  if (dr.t.length) {
    if (dir > 0) { const t = newTrade(K); t.h = timeHM || ''; dr.t.push(t); }
    else {
      let ix = -1;
      for (let i = dr.t.length - 1; i >= 0; i--) if (dr.t[i].r === K && !dr.t[i].p && !dr.t[i].g && !dr.t[i].y) { ix = i; break; }
      if (ix < 0) for (let j = dr.t.length - 1; j >= 0; j--) if (dr.t[j].r === K) { ix = j; break; }
      if (ix < 0) return { ok: false, why: 'none' };
      dr.t.splice(ix, 1);
    }
  } else {
    const key = k.toLowerCase(), v = (+dr[key] || 0) + dir;
    if (v < 0) return { ok: false, why: 'none' };
    dr[key] = Math.min(99, v);
  }
  dr.u = Date.now();
  return { ok: true };
}
export function addTrade(c, wi, di, tr) {
  const w = c.weeks[wi]; if (!w) return false;
  const d = w.d[di]; if (!d) return false;
  if (d.m && d.m !== 'a') { d.m = 'a'; d.v = ''; }
  const t = normTrade(tr);
  d.t.push(t);
  if (d.t.length === 1) { d.tp = 0; d.sl = 0; d.be = 0; }
  d.u = Date.now();
  return true;
}
export function touchDay(c, wi, di) { c.weeks[wi].d[di].u = Date.now(); }

/* ---------- آمار ---------- */
export function periodDays(c, a, per, now) {
  return a.days.filter((d) => {
    if (!d.dt) return per === 'a';
    if (per === 'd') return sameYmd(d.dt, now);
    if (per === 'w') {
      const dn = ymdToDay(now.y, now.m, now.d), mon = weekStartOfDay(dn, c), t = ymdToDay(d.dt.y, d.dt.m, d.dt.d);
      return t >= mon && t <= mon + 6;
    }
    if (per === 'm') return d.dt.y === now.y && d.dt.m === now.m;
    if (per === 'y') return d.dt.y === now.y;
    return true;
  });
}
export function aggregate(c, a, days) {
  const sel = {}; days.forEach((d) => { sel[d.wi + '_' + d.di] = 1; });
  const r = { tp: 0, sl: 0, be: 0, gp: 0, gl: 0, net: 0, start: days.length ? days[0].before : a.bal, end: days.length ? days[days.length - 1].bal : a.bal, days, traded: days.filter((d) => d.traded) };
  days.forEach((d) => { r.tp += d.tp; r.sl += d.sl; r.be += d.be; r.gp += d.profit; r.gl += d.loss; r.net += d.pnl; });
  r.trades = a.trades.filter((x) => sel[x.wi + '_' + x.di]);
  let peak = r.start, dd = 0;
  r.traded.forEach((d) => { if (d.bal > peak) peak = d.bal; const x = peak > 0 ? (d.bal - peak) / peak * 100 : 0; if (x < dd) dd = x; });
  r.dd = dd;
  const wins = r.trades.filter((x) => x.t.r === 'TP' && x.t.rr !== '');
  r.avgRR = wins.length ? wins.reduce((s, x) => s + x.t.rr, 0) / wins.length : (c.risk > 0 ? c.tpPct / c.risk : 0);
  const dec = r.tp + r.sl;
  r.wr = dec ? r.tp / dec : 0;
  r.pf = r.gl > 0 ? r.gp / r.gl : (r.gp > 0 ? Infinity : 0);
  r.exp = dec ? (r.wr * r.avgRR - (1 - r.wr)) : 0;
  r.count = r.tp + r.sl + r.be;
  return r;
}
export function groupBy(a, trades, keyFn) {
  const m = {};
  trades.forEach((x) => {
    const k = keyFn(x); if (!k) return;
    const q = m[k] = m[k] || { n: 0, tp: 0, sl: 0, be: 0, net: 0, rrs: [] };
    q.n++; q.net += x.pnl;
    if (x.t.r === 'TP') { q.tp++; if (x.t.rr !== '') q.rrs.push(x.t.rr); } else if (x.t.r === 'SL') q.sl++; else q.be++;
  });
  return Object.keys(m).map((k) => ({ k, ...m[k], wr: m[k].tp + m[k].sl ? m[k].tp / (m[k].tp + m[k].sl) : 0 })).sort((x, y) => y.net - x.net);
}
// مرور پایان هفته
export function weekReview(c, a, wi) {
  const w = c.weeks[wi]; if (!w) return null;
  const days = a.days.filter((d) => d.wi === wi);
  const g = aggregate(c, a, days);
  const traded = g.traded.slice();
  const sorted = traded.slice().sort((x, y) => y.pnl - x.pnl);
  const best = sorted[0] && sorted[0].pnl > 0 ? sorted[0] : null;
  const worst = sorted.length && sorted[sorted.length - 1].pnl < 0 ? sorted[sorted.length - 1] : null;
  const setups = groupBy(a, g.trades, (x) => x.t.y);
  const tags = groupBy(a, g.trades, (x) => x.t.g);
  const w0 = a.weeks[wi];
  return { wi, g, best, worst, setups, tags, pnlPct: w0.start > 0 ? w0.pnl / w0.start * 100 : 0, pnl: w0.pnl, rv: w.rv || { t: '', b: [] }, rules: c.rules };
}

/* ---------- CSV ---------- */
export function csvText(c, acctName) {
  const e = compute(c);
  const q = (a) => '"' + String(a == null ? '' : a).replace(/"/g, '""') + '"';
  const rows = [['Account', 'Week', 'Date', 'Date (Jalali)', 'Weekday', 'Type', 'Result', 'Symbol', 'RR', 'Fee', 'Lot', 'Session', 'Time', 'Setup', 'Tag', 'Trade PnL', 'TP', 'SL', 'BE', 'Day PnL', 'Balance after day', 'Note', 'Image']];
  c.weeks.forEach((w, wi) => w.d.forEach((d, di) => {
    const u = e.days[e.wo[wi] + di], dt = u.dt, iso = isoOf(dt), j = gToJ(dt.y, dt.m + 1, dt.d), jd = j[0] + '/' + pad2(j[1]) + '/' + pad2(j[2]);
    if (d.t.length) {
      const tr = e.trades.filter((x) => x.wi === wi && x.di === di);
      d.t.forEach((g, k) => rows.push([acctName || '', wi + 1, iso, jd, dnEnAt(c, di), 'TRADE', g.r, g.p, g.rr, g.f, g.z, g.s ? SES_EN[g.s] : '', g.h, g.y, g.g, tr[k] ? tr[k].pnl.toFixed(2) : '', '', '', '', '', '', k === 0 ? d.note : '', g.i ? 'yes' : '']));
      const last = rows[rows.length - 1]; last[19] = u.pnl.toFixed(2); last[20] = u.bal.toFixed(2);
    } else if (u.traded || d.note.trim()) {
      rows.push([acctName || '', wi + 1, iso, jd, dnEnAt(c, di), 'DAY', d.m && d.m !== 'a' ? 'MANUAL' : '', '', '', '', '', '', '', '', '', '', u.tp, u.sl, u.be, u.pnl.toFixed(2), u.bal.toFixed(2), d.note, '']);
    }
  }));
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
}

/* ---------- محاسبهٔ لات ---------- */
export const LOT_PRESETS = {
  fx: { name: 'فارکس (جفت‌ارز با USD)', unit: 'پیپ', perUnit: 10 },
  jpy: { name: 'جفت‌ارز ین (USDJPY و ...)', unit: 'پیپ', perUnit: null },
  xau: { name: 'طلا (XAUUSD)', unit: 'دلار', perUnit: 100 },
  btc: { name: 'بیت‌کوین (BTCUSD)', unit: 'دلار', perUnit: 1 },
  idx: { name: 'شاخص (US30/NAS100)', unit: 'پوینت', perUnit: 1 }
};
export function lotSize({ balance, riskPct, sl, perUnit }) {
  const riskUsd = D(balance * riskPct / 100);
  if (!(sl > 0) || !(perUnit > 0) || !(riskUsd > 0)) return null;
  const raw = riskUsd / (sl * perUnit);
  const lot = Math.floor(raw * 100) / 100;
  return { riskUsd, lot, raw, realRisk: D(lot * sl * perUnit) };
}

/* ---------- قالب‌بندی متن ---------- */
export const money = (n, sign) => { n = +n || 0; const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < 0 ? '-' : (sign && n > 0 ? '+' : '')) + '$' + s; };
export const pct = (n, d) => { n = +n || 0; return (n > 0 ? '+' : '') + n.toFixed(d == null ? 1 : d) + '%'; };
