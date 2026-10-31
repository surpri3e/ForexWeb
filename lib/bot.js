# lib/bot.js

قسمت 1 از 4 فایل `lib/bot.js`. اول این قسمت رو توی ویرایشگر خالی پیست کن (همهٔ متن قبلی فایل رو پاک کن).

````js
// منطق ربات تلگرام Surpri3eFX. همهٔ کارهای ژورنال بدون باز کردن مینی‌اپ.
// به دیتابیس و تلگرام مستقیم وصل نیست؛ store و tg تزریق می‌شن (برای تست و تعویض آسان).
import * as J from './journal.js';
import { faStamp, fmtInt, fmtUsd, hasAnyRates, composeRates, matchRatesWord, cryptoRows, coinText, getRatesConfig, setRatesConfig, ratesStatus, CATALOG, FIAT_LIST, GOLD_LIST, CRYPTO_SOURCES, TETHER_SOURCES, TETHER_POS } from './rates.js';
import * as AIM from './aicore.js';
import * as ENVS from './envsync.js';
import { parseTimes } from './groups.js';
import { pickNews, sessionWindows, partsIn, dateEn, MODE_TITLE, IMPACT_LABEL, outlookFor } from './render.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const b = (text, data) => ({ text, callback_data: data });
// دکمهٔ رنگی (primary آبی | success سبز | danger قرمز)؛ کلاینت‌های قدیمی‌تر خودشون نادیده می‌گیرن
const bs = (text, data, style) => ({ text, callback_data: data, style });
// رنگ خودکار دکمه‌ها: مسیرها آبی، ثبت و تأیید سبز، حذف و ریست قرمز؛ «منو» و بقیه خنثی می‌مونن
const PRIMARY = /^(d|w|s|r|nx|rt|mo|ac|su|bt|lot|csv|st|nw|mk|tz|n|bd|dp|t:(rr|y|p|ask))(:|$)/;
const GREEN = /^(t:save|t:r:TP|bt:go|nw:go|ac:new|su:add|b:[^:]+:tp:1)(:|$)/;
const RED = /^(t:r:SL|.*:del.*|.*:reset.*|rs.*|ac:rm.*|b:[^:]+:sl:1)(:|$)/;
function paintKb(kb) {
  return (kb || []).map((row) => row.map((btn) => {
    if (!btn || btn.style) return btn;
    const d = btn.callback_data || '';
    if (btn.web_app) return Object.assign({}, btn, { style: 'primary' });
    if (d === 'm' || d === 't:noop' || d === 'x') return btn;
    if (GREEN.test(d)) return Object.assign({}, btn, { style: 'success' });
    if (RED.test(d)) return Object.assign({}, btn, { style: 'danger' });
    if (PRIMARY.test(d)) return Object.assign({}, btn, { style: 'primary' });
    return btn;
  }));
}
const num = (s) => {
  const v = parseFloat(String(s).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 1776).replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 1632).replace(/[٫,،]/g, '.'));
  return Number.isFinite(v) ? v : NaN;
};
// «سود 120 ضرر 45» یا «120 45» یا «+75» یا «-30» -> { w, l } (دلار)
export function parsePL(s) {
  const x = String(s || '').replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 1776).replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 1632).replace(/[٫,،]/g, '.').replace(/[−–—]/g, '-').replace(/\$/g, ' ').trim();
  const N = '(\\d+(?:\\.\\d+)?)';
  const mw = new RegExp('(?:سود|profit|win|p)\\s*[:=]?\\s*\\+?' + N, 'i').exec(x), ml = new RegExp('(?:ضرر|زیان|loss|lose|l)\\s*[:=]?\\s*-?' + N, 'i').exec(x);
  if (mw || ml) return { w: mw ? +mw[1] : 0, l: ml ? +ml[1] : 0 };
  const nums = (x.match(/[-+]?\d+(?:\.\d+)?/g) || []).map(Number);
  if (nums.length === 1) return nums[0] < 0 || /^\s*-/.test(x) ? { w: 0, l: Math.abs(nums[0]) } : { w: nums[0], l: 0 };
  if (nums.length === 2 && nums.every((n) => n >= 0)) return { w: nums[0], l: nums[1] };
  return null;
}
const d8 = (t) => String(t.y) + String(t.m + 1).padStart(2, '0') + String(t.d).padStart(2, '0');
const fromD8 = (s) => /^\d{8}$/.test(s) ? { y: +s.slice(0, 4), m: +s.slice(4, 6) - 1, d: +s.slice(6, 8) } : null;
const addDays = (t, n) => J.dayToYmd(J.ymdToDay(t.y, t.m, t.d) + n);
const TZS = { teh: ['Asia/Tehran', 'تهران'], utc: ['UTC', 'UTC'], dub: ['Asia/Dubai', 'دبی'], ist: ['Europe/Istanbul', 'استانبول'], lon: ['Europe/London', 'لندن'] };
const PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'BTCUSD'];
const KINDS = { live: 'ریل', demo: 'دمو', bt: 'بکتست', prop: 'پراپ' };
const COLORS = ['#1F7A4D', '#3AB8FF', '#FFB534', '#FF5A64', '#B574FF', '#FF6FB5'];

const emptyDoc = (now) => ({ v: 3, act: 'a1', actAt: 0, list: [{ id: 'a1', name: 'حساب اصلی', color: '#1F7A4D', kind: 'live' }], j: { a1: J.defaultJournal(now) } });
const actId = (doc) => (doc.list.some((x) => x.id === doc.act) ? doc.act : doc.list[0].id);

export function createBot({ store, tg, appUrl, now = () => new Date(), botName = '', admin = null, news = null, render = null, rates = null, groups = null, ai = null, envsync = null }) {
  const AI = Object.assign({ cfg: AIM.getAiConfig, set: AIM.setAiConfig, status: AIM.aiStatus, ask: AIM.askAi, verifyKey: AIM.verifyKey, ping: AIM.pingModel, model: AIM.currentModel, md: AIM.mdToTg }, ai || {});
  const ENV = Object.assign({ set: ENVS.setEnv, render: ENVS.renderConfigured }, envsync || {});
  const aiHist = new Map();
  const RT = Object.assign({ cfg: getRatesConfig, set: async (p) => setRatesConfig(p), status: ratesStatus, setUsd: async () => null }, rates || {}); // tgId -> { at, msgs }
  /* ---------- دسترسی به سند ---------- */
  async function mutate(uid, tz, fn) {
    for (let i = 0; i < 6; i++) {
      const cur = await store.loadDoc(uid);
      const doc = cur.doc ? JSON.parse(JSON.stringify(cur.doc)) : emptyDoc(J.nowInTz(tz, now()));
      const aid = actId(doc);
      const c = doc.j[aid] = J.normalizeJournal(doc.j[aid], J.nowInTz(tz, now()));
      const out = await fn(c, doc, aid);
      if (out && out.abort) return out;
      const r = await store.saveDoc(uid, doc, cur.rev);
      if (r.ok) return out;
    }
    throw new Error('conflict');
  }
  async function view(uid, tz) {
    const cur = await store.loadDoc(uid);
    const doc = cur.doc || emptyDoc(J.nowInTz(tz, now()));
    const aid = actId(doc);
    const c = J.normalizeJournal(doc.j[aid], J.nowInTz(tz, now()));
    return { doc, aid, c, acct: doc.list.find((x) => x.id === aid), a: J.compute(c) };
  }

  /* ---------- نمایش ---------- */
  const lab = (c, t, short) => J.dateLabel(t, c.cal, short);
  function tradeLine(t, pnl, i) {
    const bits = [t.r, t.p || '-'];
    if (t.rr !== '') bits.push('RR ' + t.rr);
    if (t.y) bits.push(t.y);
    if (t.h) bits.push(t.h);
    if (t.g) bits.push('#' + t.g);
    if (t.i) bits.push('[عکس]');
    return (i + 1) + '. ' + esc(bits.join(' | ')) + '  <code>' + J.money(pnl, 1) + '</code>';
  }
  function dayView(V, ymd, today) {
    const { c, a } = V;
    const hit = J.findDay(c, ymd);
    const isToday = J.sameYmd(ymd, today);
    const wd = J.weekdayOf(J.ymdToDay(ymd.y, ymd.m, ymd.d));
    let head = '<b>' + J.DN[wd] + ' · ' + lab(c, ymd) + '</b>' + (isToday ? '  (امروز)' : '');
    let body = '';
    if (!hit) body = '\nبرای این روز هنوز هفته‌ای ساخته نشده؛ با اولین ثبت ساخته می‌شه.';
    else {
      const dd = a.days.find((x) => x.wi === hit.wi && x.di === hit.di), dr = c.weeks[hit.wi].d[hit.di];
      const p = dd.before > 0 ? dd.pnl / dd.before * 100 : 0;
      body = '\nنتیجه: <code>' + (dd.traded ? J.money(dd.pnl, 1) + ' (' + J.pct(p, 2) + ')' : '-') + '</code>\nTP <b>' + dd.tp + '</b>  |  SL <b>' + dd.sl + '</b>  |  BE <b>' + dd.be + '</b>';
      if (dr.m && dr.m !== 'a') body += '\nنتیجهٔ این روز دستی ثبت شده' + (dr.m === 'b' ? ' (بالانس پایان روز: ' + J.money(+dr.v) + ')' : dr.m === 'd' ? ' (سود ' + J.money(+dr.dw || 0) + ' | زیان ' + J.money(+dr.dl || 0) + ')' : ' (' + dr.v + '٪)') + '؛ با «ثبت بالانس روز» یا «ثبت سود/زیان دلار» عوضش کن.';
      if (dd.lim === 2) body += '\nحد ضرر روزانه رسید.'; else if (dd.lim === 1) body += '\nنزدیک حد ضرر روزانه.';
      const rows = a.trades.filter((x) => x.wi === hit.wi && x.di === hit.di);
      if (rows.length) body += '\n\n' + rows.map((x, i) => tradeLine(x.t, x.pnl, i)).join('\n');
      if (dr.note) body += '\n\nیادداشت: ' + esc(dr.note.slice(0, 300));
    }
    const k = d8(ymd);
    const kb = [
      [b('+ TP', `b:${k}:tp:1`), b('+ SL', `b:${k}:sl:1`), b('+ BE', `b:${k}:be:1`)],
      [b('- TP', `b:${k}:tp:-1`), b('- SL', `b:${k}:sl:-1`), b('- BE', `b:${k}:be:-1`)],
      [b('ثبت با جزئیات', `t:new:${k}`), b('یادداشت روز', `n:${k}`)],
      [b('ثبت بالانس روز', `bd:${k}`), b('ثبت سود/زیان دلار', `dp:${k}`)],
      [b('روز قبل', `d:${d8(addDays(ymd, -1))}`), b('منو', 'm'), b('روز بعد', `d:${d8(addDays(ymd, 1))}`)]
    ];
    return { text: head + body, kb };
  }
  function weekView(V, ymd, today) {
    const { c, a } = V;
    let hit = J.findDay(c, ymd);
    if (!hit) return { text: 'برای این تاریخ هفته‌ای نیست.', kb: [[b('ساخت هفته', `d:${d8(ymd)}`), b('منو', 'm')]] };
    const wi = hit.wi, w = c.weeks[wi], W = a.weeks[wi];
    const start = J.dayDate(w, 0), end = J.dayDate(w, w.d.length - 1);
    let t = '<b>هفته ' + (wi + 1) + '</b>  ' + lab(c, start, true) + ' تا ' + lab(c, end, true) + '\n';
    t += 'سود هفته: <code>' + J.pct(W.start > 0 ? W.pnl / W.start * 100 : 0, 2) + ' (' + J.money(W.pnl, 1) + ')</code>   TP ' + W.tp + ' | SL ' + W.sl + ' | BE ' + W.be + '\n\n';
    const kb = [];
    let row = [];
    w.d.forEach((_, di) => {
      const dd = a.days.find((x) => x.wi === wi && x.di === di), dt = dd.dt;
      const p = dd.before > 0 ? dd.pnl / dd.before * 100 : 0;
      t += J.dnAt(c, di).padEnd(8, ' ') + ' ' + lab(c, dt, true) + '   ' + (dd.traded ? J.pct(p, 2) + '  (' + dd.tp + '/' + dd.sl + '/' + dd.be + ')' : '-') + '\n';
      row.push(b(J.dnAt(c, di), `d:${d8(dt)}`));
      if (row.length === 4) { kb.push(row); row = []; }
    });
    if (row.length) kb.push(row);
    const sd = J.dayToYmd(J.weekStartDay(w));
    const nav = [b('هفتهٔ قبل', `w:${d8(addDays(sd, -7))}`), b('هفتهٔ بعد', `w:${d8(addDays(sd, 7))}`)];
    kb.push(nav);
    kb.push(c.mk === 'cr' ? [b('مرور هفته', `r:${d8(sd)}`)] : [b('مرور هفته', `r:${d8(sd)}`), w.n === 7 ? b('هفته ۵ روزه', `wk:${d8(sd)}:5`) : b('افزودن شنبه و یکشنبه', `wk:${d8(sd)}:7`)]);
    kb.push([b('هفتهٔ جدید', 'nw'), b('منو', 'm')]);
    return { text: t, kb };
  }
  function statsView(V, per, today) {
    const { c, a, acct } = V;
    const days = J.periodDays(c, a, per, today), g = J.aggregate(c, a, days);
    const pl = { d: 'امروز', w: 'این هفته', m: 'این ماه', y: 'امسال', a: 'همه' };
    let t = '<b>آمار · ' + pl[per] + '</b>  (' + esc(acct.name) + ')\n';
    if (!g.count && !g.traded.length) t += '\nبرای این بازه هنوز داده‌ای نیست.';
    else {
      const netp = g.start > 0 ? g.net / g.start * 100 : 0;
      t += '\nسود خالص: <code>' + J.money(g.net, 1) + ' (' + J.pct(netp, 2) + ')</code>';
      t += '\nمعامله: ' + g.count + '   TP ' + g.tp + ' | SL ' + g.sl + ' | BE ' + g.be;
      t += '\nوین‌ریت: <code>' + (g.tp + g.sl ? Math.round(g.wr * 100) + '%' : '-') + '</code>   پرافیت فکتور: <code>' + (g.gl > 0 ? g.pf.toFixed(2) : (g.gp > 0 ? '∞' : '-')) + '</code>';
      t += '\nمیانگین RR: <code>1:' + (g.avgRR ? g.avgRR.toFixed(1) : '-') + '</code>   امید ریاضی: <code>' + (g.exp >= 0 ? '+' : '') + g.exp.toFixed(2) + 'R</code>';
      t += '\nحداکثر دراودان: <code>' + (g.dd ? g.dd.toFixed(1) + '%' : '0%') + '</code>';
      const tr = g.traded.slice().sort((x, y) => y.pnl - x.pnl), best = tr[0], worst = tr[tr.length - 1];
      if (best && best.pnl > 0) t += '\nبهترین روز: ' + J.dnAt(c, best.di) + ' ' + lab(c, best.dt, true) + ' <code>' + J.money(best.pnl, 1) + '</code>';
      if (worst && worst.pnl < 0) t += '\nبدترین روز: ' + J.dnAt(c, worst.di) + ' ' + lab(c, worst.dt, true) + ' <code>' + J.money(worst.pnl, 1) + '</code>';
      const su = J.groupBy(a, g.trades, (x) => x.t.y).slice(0, 4);
      if (su.length) t += '\n\n<b>استراتژی‌ها</b>\n' + su.map((x) => esc(x.k) + ': ' + x.n + ' معامله، وین‌ریت ' + Math.round(x.wr * 100) + '%، <code>' + J.money(x.net, 1) + '</code>').join('\n');
      const sy = J.groupBy(a, g.trades, (x) => x.t.p).slice(0, 4);
      if (sy.length) t += '\n\n<b>نمادها</b>\n' + sy.map((x) => esc(x.k) + ': ' + x.n + ' معامله، <code>' + J.money(x.net, 1) + '</code>').join('\n');
      const wdm = {};
      g.traded.forEach((d) => { wdm[d.di] = (wdm[d.di] || 0) + d.pnl; });
      const wk = Object.keys(wdm).map((k) => J.dnAt(c, +k) + ' ' + J.money(wdm[k], 1));
      if (wk.length > 1) t += '\n\n<b>بر اساس روز هفته</b>\n' + wk.join('\n');
    }
    const pk = (k, lbl) => (per === k ? bs(lbl, 's:' + k, 'primary') : b(lbl, 's:' + k));
    const kb = [[pk('d', 'امروز'), pk('w', 'هفته'), pk('m', 'ماه'), pk('a', 'کل')], [b('منو', 'm')]];
    return { text: t, kb };
  }
  function reviewView(V, ymd) {
    const { c, a } = V;
    const hit = J.findDay(c, ymd);
    if (!hit) return { text: 'هفته پیدا نشد.', kb: [[b('منو', 'm')]] };
    const R = J.weekReview(c, a, hit.wi), w = c.weeks[hit.wi], g = R.g;
    const sd = J.dayToYmd(J.weekStartDay(w)), k = d8(sd);
    let t = '<b>مرور هفتهٔ ' + (hit.wi + 1) + '</b>\n';
    t += '\nسود هفته: <code>' + J.pct(R.pnlPct, 2) + ' (' + J.money(R.pnl, 1) + ')</code>\nمعامله: ' + g.count + '   TP ' + g.tp + ' | SL ' + g.sl + ' | BE ' + g.be;
    t += '\nوین‌ریت: <code>' + (g.tp + g.sl ? Math.round(g.wr * 100) + '%' : '-') + '</code>';
    t += '\nبهترین روز: ' + (R.best ? J.dnAt(c, R.best.di) + ' <code>' + J.money(R.best.pnl, 1) + '</code>' : '-');
    t += '\nبدترین روز: ' + (R.worst ? J.dnAt(c, R.worst.di) + ' <code>' + J.money(R.worst.pnl, 1) + '</code>' : '-');
    if (R.setups.length) t += '\n\nبهترین استراتژی: ' + esc(R.setups[0].k) + ' <code>' + J.money(R.setups[0].net, 1) + '</code>' + (R.setups.length > 1 && R.setups[R.setups.length - 1].net < 0 ? '\nضعیف‌ترین: ' + esc(R.setups[R.setups.length - 1].k) + ' <code>' + J.money(R.setups[R.setups.length - 1].net, 1) + '</code>' : '');
    if (R.tags.length) { const bad = R.tags.slice().sort((x, y) => x.net - y.net)[0]; if (bad.net < 0) t += '\nپرهزینه‌ترین رفتار: ' + esc(bad.k) + ' <code>' + J.money(bad.net, 1) + '</code>'; }
    const kb = [];
    if (c.rules.length) {
      t += '\n\n<b>کدوم قانون‌ها رو شکستی؟</b> (لمس کن)';
      c.rules.forEach((r, i) => { const on = R.rv.b.includes(r); kb.push([b((on ? '[x] ' : '[ ] ') + r, `rv:${k}:${i}`)]); });
    } else t += '\n\nقانونی تعریف نشده؛ از «ستاپ‌ها و قوانین» اضافه کن تا اینجا چک‌لیست بشه.';
    if (R.rv.t) t += '\n\nیادداشت مرور: ' + esc(R.rv.t.slice(0, 400));
    kb.push([b('نوشتن یادداشت مرور', `rn:${k}`)]);
    kb.push([b('هفته', `w:${k}`), b('منو', 'm')]);
    return { text: t, kb };
  }
  function menuView(V, today, isAdm) {
    const { c, a, acct } = V;
    const hit = J.findDay(c, today);
    const wk = hit ? a.weeks[hit.wi] : a.weeks[a.weeks.length - 1];
    const dd = hit ? a.days.find((x) => x.wi === hit.wi && x.di === hit.di) : null;
    const todayP = dd && dd.traded ? J.pct(dd.before > 0 ? dd.pnl / dd.before * 100 : 0, 2) : '—';
    const weekP = J.pct(wk && wk.start > 0 ? wk.pnl / wk.start * 100 : 0, 2);
    const t = '<b>Surpri3eFX</b>\n' +
      'حساب   <b>' + esc(acct.name) + '</b>  ·  ' + (J.MARKETS[c.mk] || J.MARKETS.fx) + '\n' +
      'بالانس   <code>' + J.money(a.bal) + '</code>\n' +
      'امروز   <code>' + todayP + '</code>\n' +
      'هفته   <code>' + weekP + '</code>';
    const kb = [
      [bs('ثبت معامله', `t:new:${d8(today)}`, 'success'), b('امروز', `d:${d8(today)}`)],
      [b('هفته', `w:${d8(today)}`), b('آمار', 's:w'), b('اخبار', 'nx')],
      [b('نرخ ارز', 'rt'), b('بیشتر', 'mo'), { text: 'اپ', web_app: { url: appUrl } }],
      ...(AI.status().on.private ? [[b('دستیار هوش مصنوعی', 'ai')]] : [])
    ];
    return { text: t, kb };
  }
  function moreView(V) {
    const kb = [
      [b('مرور هفته', `r:${d8(J.nowInTz(V.tz || 'Asia/Tehran', now()))}`), b('هفتهٔ جدید', 'nw')],
      [b('بکتست', 'bt'), b('محاسبهٔ لات', 'lot')],
      [b('حساب‌ها', 'ac'), b('استراتژی‌ها', 'su')],
      [b('نوع بازار', 'mk')],
      [b('خروجی CSV', 'csv'), b('تنظیمات', 'st')],
      [b('منو', 'm')]
    ];
    return { text: '<b>بیشتر</b>', kb };
  }
  function marketView(first, cur, back) {
    const t = '<b>' + (first ? 'بازارت کدومه؟' : 'نوع بازار') + '</b>\n' + (first ? 'قبل از شروع یکی رو انتخاب کن تا هفته‌ها درست ساخته بشن؛ بعداً از تنظیمات عوضش می‌کنی.' : 'با عوض کردن بازار، روزهای ثبت‌شده بر اساس تاریخ توی هفته‌های تازه می‌شینن و چیزی پاک نمی‌شه.') +
      '\n\nفارکس: هفته از دوشنبه تا جمعه\nکریپتو: کل هفته، از شنبه تا جمعه (۷ روز)';
    const kb = [[b((cur === 'fx' ? '[فارکس]' : 'فارکس') + '  دوشنبه تا جمعه', (back || 'mk:') + 'fx')], [b((cur === 'cr' ? '[کریپتو]' : 'کریپتو') + '  شنبه تا جمعه', (back || 'mk:') + 'cr')]];
    if (!first) kb.push([b('بازگشت', 'st')]);
    return { text: t, kb };
  }

  function btLenPanel(n, c) {
    const cr = c.mk === 'cr';
    return { text: n + ' هفته ' + (cr ? '(۷ روزه، شنبه تا جمعه)' : '(۵ روزه، دوشنبه تا جمعه)') + ' ساخته بشه؟', kb: [[b('ساخت هفته‌ها', 'bt:go:' + (cr ? 7 : 5))], [b('انصراف', 'x')]] };
  }
  /* ---------- ارسال/ویرایش: همیشه یک پنل ثابت ---------- */
  // کادر نقل‌قول (blockquote) توی بعضی کلاینت‌ها با متن راست‌به‌چپ قاطی می‌شد و متن بیرون کادر می‌زد؛ پس همه‌جا حذف می‌شه
  function glassify(panel) {
    const t = String(panel.text == null ? '' : panel.text);
    return t.replace(/<\/?blockquote>/g, '').replace(/\n{3,}/g, '\n\n');
  }
  async function remember(ctx, id) {
    if (!id) return;
    const old = ctx.panel;
    ctx.msgId = id;
    if (old && old !== id) { try { await tg.del(ctx.chat, old); } catch (e) { /* ignore */ } }
    if (old !== id) { ctx.panel = id; if (store.setPanel) { try { await store.setPanel(ctx.tgId, id); } catch (e) { /* ignore */ } } }
  }
  async function show(ctx, panel) {
    const text = glassify(panel);
    const kb = { inline_keyboard: paintKb(panel.kb) };
    const target = ctx.msgId || ctx.panel || null;
    if (panel.photo) {
      if (target) { try { await tg.del(ctx.chat, target); } catch (e) { /* ignore */ } if (target === ctx.panel) ctx.panel = null; }
      const m = await tg.sendPhoto(ctx.chat, panel.photo, text, kb);
      ctx.msgId = null;
      await remember(ctx, m && m.message_id);
      return m && m.message_id;
    }
    let id = null;
    if (target && !ctx.fresh) {
      try { await tg.edit(ctx.chat, target, text, kb); id = target; }
      catch (e) {
        if (/not modified/i.test(String(e.message))) id = target;
        else { try { await tg.del(ctx.chat, target); } catch (e2) { /* ignore */ } }
      }
    } else if (target) { try { await tg.del(ctx.chat, target); } catch (e) { /* ignore */ } }
    if (!id) { const m = await tg.send(ctx.chat, text, kb); id = m && m.message_id; ctx.msgId = null; if (target && target === ctx.panel) ctx.panel = null; }
    await remember(ctx, id);
    return id;
  }
  const note = (text) => ({ text, kb: [[b('منو', 'm')]] });
  // پیام کوتاه و گذرا (خطای ورودی) که خودش پاک می‌شه تا چت شلوغ نشه
  async function flash(ctx, text) {
    try {
      const r = await tg.send(ctx.chat, text);
      const t = setTimeout(() => { Promise.resolve(tg.del(ctx.chat, r && r.message_id)).catch(() => {}); }, 6000);
      if (t.unref) t.unref();
    } catch (e) { /* ignore */ }
  }
  // say: اگه دکمه داشته باشه پنل می‌شه؛ وگرنه پیام گذرا
  const say = (ctx, text, kbObj) => (kbObj && kbObj.inline_keyboard ? show(ctx, { text, kb: kbObj.inline_keyboard }) : flash(ctx, text));

  /* ---------- گفتگو (ورودی متنی) ---------- */
  const setState = (ctx, st) => store.setState(ctx.tgId, st);
  async function askText(ctx, st, prompt, kb) {
    await setState(ctx, Object.assign({}, st, { chat: ctx.chat }));
    await show(ctx, { text: prompt, kb: kb || [[b('انصراف', 'x')]] });
  }

  /* ---------- ویزارد ثبت معامله ---------- */
  function wizView(V, st) {
    const { c } = V;
    const ymd = fromD8(st.date), defRR = c.risk > 0 ? Math.round(c.tpPct / c.risk * 100) / 100 : '';
    let t = '<b>ثبت معامله</b>  ' + J.DN[J.weekdayOf(J.ymdToDay(ymd.y, ymd.m, ymd.d))] + ' ' + lab(c, ymd, true) + '\n\n';
    t += 'نتیجه: <b>' + (st.r || '-') + '</b>\nنماد: <b>' + esc(st.p || '-') + '</b>\n';
    if (st.r === 'TP') t += 'RR: <b>' + (st.rr !== '' && st.rr != null ? st.rr : (defRR ? 'پیش‌فرض (' + defRR + ')' : '-')) + '</b>\n';
    t += 'استراتژی: <b>' + esc(st.y || '-') + '</b>\n';
    if (st.g) t += 'برچسب رفتاری: <b>' + esc(st.g) + '</b>\n';
    if (st.f !== '' && st.f != null) t += 'کارمزد: <b>' + st.f + '</b>\n';
    if (st.z !== '' && st.z != null) t += 'لات: <b>' + st.z + '</b>\n';
    t += 'ساعت: <b>' + (st.h || '-') + '</b>' + (st.s ? '  سشن: <b>' + J.SES[st.s] + '</b>' : '') + '\n';
    if (st.i) t += 'عکس چارت: <b>پیوست شد</b>\n';
    if (st.bal !== '' && st.bal != null) t += 'بالانس پایان روز: <b>' + J.money(+st.bal) + '</b>\n';
    const kb = [];
    if (!st.r) { kb.push([b('TP', 't:r:TP'), b('SL', 't:r:SL'), b('BE', 't:r:BE')]); }
    else {
      kb.push([b(st.r === 'TP' ? '[TP]' : 'TP', 't:r:TP'), b(st.r === 'SL' ? '[SL]' : 'SL', 't:r:SL'), b(st.r === 'BE' ? '[BE]' : 'BE', 't:r:BE')]);
      const pairs = (st.pairs && st.pairs.length ? st.pairs : PAIRS).slice(0, 8);
      for (let i = 0; i < pairs.length; i += 4) kb.push(pairs.slice(i, i + 4).map((p) => b(st.p === p ? '[' + p + ']' : p, 't:p:' + p)));
      kb.push([b('نماد دیگر', 't:ask:p')]);
      if (st.r === 'TP') kb.push([b('RR 1', 't:rr:1'), b('1.5', 't:rr:1.5'), b('2', 't:rr:2'), b('3', 't:rr:3'), b('RR دیگر', 't:ask:rr')]);
      const su = (c.setups || []).slice(0, 8);
      if (su.length) for (let i = 0; i < su.length; i += 3) kb.push(su.slice(i, i + 3).map((s, k) => b(st.y === s ? '[' + s + ']' : s, 't:y:' + (i + k))));
      kb.push([b('استراتژی جدید', 't:ask:y'), b('برچسب رفتاری', 't:ask:g')]);
      kb.push([b('کارمزد', 't:ask:f'), b('لات', 't:ask:z'), b('ساعت', 't:ask:h')]);
      kb.push([b('عکس چارت: عکس رو همین‌جا بفرست', 't:noop')]);
    }
    kb.push([b(st.bal !== '' && st.bal != null ? '[بالانس روز]' : 'ثبت بالانس روز', 't:ask:bal')]);
    kb.push([b('ذخیره معامله', 't:save'), b('انصراف', 'x')]);
    return { text: t, kb };
  }
  async function startWizard(ctx, V, dateStr, init) {
    const c = V.c, tz = ctx.prefs.tz, n = J.nowInTz(tz, now());
    const cnt = {};
    c.weeks.forEach((w) => w.d.forEach((d) => d.t.forEach((t) => { if (t.p) cnt[t.p] = (cnt[t.p] || 0) + 1; })));
    const pairs = Object.keys(cnt).sort((x, y) => cnt[y] - cnt[x]);
    PAIRS.forEach((p) => { if (!pairs.includes(p)) pairs.push(p); });
    const utcH = now().getUTCHours();
    const st = Object.assign({ k: 'trade', date: dateStr, r: '', p: '', rr: '', y: '', g: '', f: '', z: '', i: '', bal: '', h: J.hm(n), s: utcH < 7 ? 'a' : utcH < 12 ? 'l' : utcH < 21 ? 'n' : '', pairs: pairs.slice(0, 8), chat: ctx.chat }, init || {});
    const mid = await show(ctx, wizView(V, st));
    st.msg = mid;
    await setState(ctx, st);
  }
  async function saveWizard(ctx, st) {
    const ymd = fromD8(st.date);
    let res = null;
    const out = await mutate(ctx.uid, ctx.prefs.tz, (c) => {
      const hit = J.ensureDay(c, ymd);
      if (!hit) return { abort: true, why: 'noweek' };
      const tr = { r: st.r || 'TP', p: st.p, s: st.s, rr: st.r === 'TP' ? st.rr : '', f: st.f, h: st.h, g: st.g, y: st.y, i: st.i, z: st.z };
      if (st.y && !c.setups.includes(st.y) && c.setups.length < 16) c.setups.push(st.y);
      J.addTrade(c, hit.wi, hit.di, tr);
      if (st.bal !== '' && st.bal != null && +st.bal > 0) { const dr = c.weeks[hit.wi].d[hit.di]; dr.m = 'b'; dr.v = +st.bal; J.touchDay(c, hit.wi, hit.di); }
      res = hit;
      return { ok: true };
    });
    if (out && out.abort) return false;
    await store.clearState(ctx.tgId);
    return true;
  }
  /* ---------- قفل لات ---------- */
  function lotView(V, st) {
    const { c, a } = V;
````
