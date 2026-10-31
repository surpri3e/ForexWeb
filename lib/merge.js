// ادغام سه‌طرفه (base / local / remote) برای همگام‌سازی سایت و ربات تلگرام.
// این فایل بدون وابستگیه و عیناً داخل سایت هم استفاده می‌شه (هر دو طرف یک منطق).
// ساختار سند: { v:3, act, actAt, list:[{id,name,color,kind}], j:{ [id]: ژورنال } }

// JSON با ترتیب ثابت کلیدها (دیتابیس ترتیب کلیدها رو عوض می‌کنه)
export function canon(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x === undefined ? null : x);
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  return '{' + Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
}
const J = canon;
// کلید مقایسهٔ دو سند: وضعیت جمع‌شدن هفته‌ها، متای دستگاه و زمان ویرایش روزها حساب نمی‌شن
export function docKey(doc) {
  if (!doc) return '';
  const j = {};
  for (const id of Object.keys(doc.j || {})) {
    const x = doc.j[id];
    j[id] = Object.assign({}, x, { meta: undefined, weeks: (x.weeks || []).map((w) => ({ id: w.id, month: w.month, year: w.year, n: w.n, rv: w.rv || null, d: w.d.map((d) => [d.tp, d.sl, d.be, d.date, d.note, d.m, d.v, d.t, d.rk == null ? null : d.rk, d.rw == null ? null : d.rw, d.dw == null ? null : d.dw, d.dl == null ? null : d.dl]) })) });
  }
  return canon({ list: doc.list, j, del: Object.keys(doc.del || {}).length ? doc.del : undefined });
}
const same = (a, b) => J(a) === J(b);
const emptyDay = () => ({ tp: 0, sl: 0, be: 0, date: '', note: '', m: 'a', v: '', t: [], u: 0 });
const dayCore = (d) => J([d.tp, d.sl, d.be, d.date, d.note, d.m, d.v, d.t, d.rk == null ? null : d.rk, d.rw == null ? null : d.rw, d.dw == null ? null : d.dw, d.dl == null ? null : d.dl]);
const dEq = (a, b) => dayCore(a) === dayCore(b);
const weekCore = (w) => J([w.month, w.year, w.n, w.rv || null, (w.d || []).map(dayCore)]);

function mergeDay(b, l, r) {
  const E = emptyDay();
  l = l || E; r = r || E;
  if (dEq(l, r)) return Object.assign({}, r, { u: Math.max(l.u || 0, r.u || 0) });
  if (b) { if (dEq(l, b)) return r; if (dEq(r, b)) return l; }
  else { if (dEq(l, E)) return r; if (dEq(r, E)) return l; }
  return (l.u || 0) >= (r.u || 0) ? l : r;
}

function pickField(bv, lv, rv) {
  if (same(lv, rv)) return lv;
  if (same(lv, bv)) return rv;
  if (same(rv, bv)) return lv;
  return lv; // هر دو عوض شده: نسخهٔ این دستگاه
}

function mergeWeek(b, l, r) {
  const out = { id: l.id };
  for (const k of ['month', 'year', 'rv']) {
    const v = pickField(b ? b[k] : undefined, l[k], r[k]);
    if (v !== undefined) out[k] = v;
  }
  out.c = !!l.c;
  const n = Math.max(l.d.length, r.d.length, b ? b.d.length : 0);
  out.n = n >= 7 ? 7 : 5;
  out.d = [];
  for (let i = 0; i < out.n; i++) out.d.push(mergeDay(b && b.d[i], l.d[i], r.d[i]));
  return out;
}

function mergeWeeks(B, L, R) {
  const idx = (a) => { const m = {}; a.forEach((w) => { m[w.id] = w; }); return m; };
  const bm = idx(B), lm = idx(L), rm = idx(R);
  const order = R.map((w) => w.id);
  // هفته‌هایی که فقط این دستگاه دارد: بعد از هفتهٔ قبلی خودش در ترتیب محلی جا می‌گیرد
  L.forEach((w, i) => {
    if (rm[w.id]) return;
    let at = 0;
    for (let k = i - 1; k >= 0; k--) { const p = order.indexOf(L[k].id); if (p >= 0) { at = p + 1; break; } }
    order.splice(at, 0, w.id);
  });
  const out = [];
  for (const id of order) {
    const b = bm[id], l = lm[id], r = rm[id];
    if (l && r) out.push(mergeWeek(b, l, r));
    else if (l) { if (!(b && weekCore(l) === weekCore(b))) out.push(Object.assign({}, l)); }
    else if (r) { if (!(b && weekCore(r) === weekCore(b))) out.push(Object.assign({}, r)); }
  }
  return out;
}

const SKIP = { weeks: 1, meta: 1 };
export function mergeJournal(b, l, r) {
  b = b || {};
  const out = {};
  const keys = {};
  Object.keys(l).forEach((k) => { keys[k] = 1; });
  Object.keys(r).forEach((k) => { keys[k] = 1; });
  for (const k of Object.keys(keys)) {
    if (SKIP[k]) continue;
    const v = pickField(b[k], l[k], r[k]);
    if (v !== undefined) out[k] = v;
  }
  out.meta = l.meta || r.meta || {};
  out.weeks = mergeWeeks(b.weeks || [], l.weeks || [], r.weeks || []);
  if (!out.weeks.length) out.weeks = (l.weeks && l.weeks.length ? l.weeks : r.weeks) || [];
  return out;
}

export function mergeDocs(base, local, remote) {
  base = base || { list: [], j: {} };
  const bl = {}, ll = {}, rl = {};
  (base.list || []).forEach((x) => { bl[x.id] = x; });
  (local.list || []).forEach((x) => { ll[x.id] = x; });
  (remote.list || []).forEach((x) => { rl[x.id] = x; });
  const order = (remote.list || []).map((x) => x.id);
  (local.list || []).forEach((x, i) => {
    if (rl[x.id]) return;
    let at = 0;
    for (let k = i - 1; k >= 0; k--) { const p = order.indexOf(local.list[k].id); if (p >= 0) { at = p + 1; break; } }
    order.splice(at, 0, x.id);
  });
  // سنگ قبر حساب‌های پاک‌شده: هر دو طرف ادغام می‌شن تا حساب پاک‌شده از طرف دیگه برنگرده
  const del = {}, cut = Date.now() - 90 * 864e5;
  for (const m of [base.del, local.del, remote.del]) {
    Object.keys(m || {}).forEach((k) => { const t = Math.floor(+m[k]) || 0; if (t > cut || t === 0) del[k] = Math.max(del[k] || 0, t); });
  }
  const list = [], j = {};
  for (const id of order) {
    if (Object.prototype.hasOwnProperty.call(del, id)) continue;
    const b = bl[id], l = ll[id], r = rl[id];
    const bj = (base.j || {})[id], lj = (local.j || {})[id], rj = (remote.j || {})[id];
    if (l && r) {
      list.push(Object.assign({}, r, { id }, pickFieldsOf(b, l, r)));
      if (lj && rj) j[id] = mergeJournal(bj, lj, rj); else j[id] = lj || rj;
    } else if (l) {
      if (b && same(l, b) && same(lj, bj)) continue; // طرف مقابل حذفش کرده و اینجا دست‌نخورده بوده
      list.push(l); if (lj) j[id] = lj;
    } else if (r) {
      if (b && same(r, b) && same(rj, bj)) continue;
      list.push(r); if (rj) j[id] = rj;
    }
  }
  const act = (local.actAt || 0) > (remote.actAt || 0) ? local : remote;
  let a = act.act;
  if (!list.some((x) => x.id === a)) a = list[0] ? list[0].id : undefined;
  const out = { v: 3, act: a, actAt: Math.max(local.actAt || 0, remote.actAt || 0), list, j };
  if (Object.keys(del).length) out.del = del;
  return out;
}
function pickFieldsOf(b, l, r) {
  const o = {};
  for (const k of ['name', 'color', 'kind']) o[k] = pickField(b ? b[k] : undefined, l[k], r[k]);
  return o;
}
