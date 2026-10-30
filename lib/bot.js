// منطق ربات تلگرام Surpri3eFX. همهٔ کارهای ژورنال بدون باز کردن مینی‌اپ.
// به دیتابیس و تلگرام مستقیم وصل نیست؛ store و tg تزریق می‌شن (برای تست و تعویض آسان).
import * as J from './journal.js';
import { faStamp, fmtInt, fmtUsd, hasAnyRates, composeRates, cryptoRows, coinText } from './rates.js';
import * as AIM from './ai.js';
import * as ENVS from './envsync.js';
import { parseTimes } from './groups.js';
import { pickNews, sessionWindows, partsIn, dateEn, MODE_TITLE, IMPACT_LABEL, outlookFor } from './render.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const b = (text, data) => ({ text, callback_data: data });
// دکمهٔ رنگی (primary آبی | success سبز | danger قرمز)؛ کلاینت‌های قدیمی‌تر خودشون نادیده می‌گیرن
const bs = (text, data, style) => ({ text, callback_data: data, style });
// رنگ خودکار دکمه‌ها: مسیرها آبی، ثبت و تأیید سبز، حذف و ریست قرمز؛ «منو» و بقیه خنثی می‌مونن
const PRIMARY = /^(d|w|s|r|nx|rt|mo|ac|su|bt|lot|csv|st|nw|mk|tz|n|bd|t:(rr|y|p|ask))(:|$)/;
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
  const aiHist = new Map(); // tgId -> { at, msgs }
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
      if (dr.m && dr.m !== 'a') body += '\nنتیجهٔ این روز دستی ثبت شده' + (dr.m === 'b' ? ' (بالانس پایان روز: ' + J.money(+dr.v) + ')' : ' (' + dr.v + '٪)') + '؛ با «ثبت بالانس روز» عوضش کن.';
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
      [b('ثبت بالانس روز', `bd:${k}`)],
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
  // ثبت سریع با متن:  tp xauusd rr2 orb @10:30
  function parseQuick(text, c, tz) {
    const toks = String(text).trim().split(/\s+/);
    const r = toks[0].toUpperCase();
    if (!['TP', 'SL', 'BE'].includes(r)) return null;
    const o = { r, p: '', rr: '', y: '', h: '', g: '', f: '', z: '', date: null };
    const sets = c.setups || [];
    for (const raw of toks.slice(1)) {
      const t = raw.trim(); if (!t) continue;
      let m;
      if ((m = /^@(\d{1,2}):(\d{2})$/.exec(t))) { o.h = m[1].padStart(2, '0') + ':' + m[2]; continue; }
      if ((m = /^(?:rr|r)?(\d+(?:[.,]\d+)?)r?$/i.exec(t)) && /^(rr|r)/i.test(t) || /^\d+(?:[.,]\d+)?r$/i.test(t)) { const v = num(t.replace(/[^\d.,٫]/g, '')); if (v > 0) { o.rr = Math.min(100, v); continue; } }
      if ((m = /^(?:lot|l)=?(\d+(?:[.,]\d+)?)$/i.exec(t))) { o.z = num(m[1]); continue; }
      if ((m = /^(?:fee|f)=?(\d+(?:[.,]\d+)?)$/i.exec(t))) { o.f = num(m[1]); continue; }
      if (t[0] === '#') { o.g = t.slice(1, 21); continue; }
      const s = sets.find((x) => x.toLowerCase() === t.toLowerCase());
      if (s) { o.y = s; continue; }
      if (/^[A-Za-z0-9._]{3,12}$/.test(t) && !o.p && !/^\d+(\.\d+)?$/.test(t)) { o.p = t.toUpperCase(); continue; }
      if (/^\d+(?:[.,]\d+)?$/.test(t) && o.rr === '' && r === 'TP') { const v = num(t); if (v > 0 && v <= 100) { o.rr = v; continue; } }
      const dd = J.parseDateInput(t, J.nowInTz(tz, now())); if (dd) { o.date = dd; continue; }
      if (!o.y && sets.length === 0) o.y = t.slice(0, 24);
    }
    return o;
  }

  /* ---------- قفل لات ---------- */
  function lotView(V, st) {
    const { c, a } = V;
    const P = J.LOT_PRESETS;
    let t = '<b>محاسبه لات</b>\nبالانس: <code>' + J.money(st.bal != null ? st.bal : a.bal) + '</code>   ریسک: <code>' + (st.risk != null ? st.risk : c.risk) + '%</code>\n';
    const kb = [];
    if (!st.pre) {
      t += '\nنوع نماد رو انتخاب کن:';
      Object.keys(P).forEach((k) => kb.push([b(P[k].name, 'l:p:' + k)]));
    } else {
      const p = P[st.pre];
      t += 'نماد: <b>' + p.name + '</b>\n';
      if (st.pre === 'jpy') t += 'قیمت فعلی جفت‌ارز: <b>' + (st.rate || '-') + '</b>\n';
      t += 'فاصلهٔ حد ضرر (' + p.unit + '): <b>' + (st.sl || '-') + '</b>\n';
      const perUnit = st.pre === 'jpy' ? (st.rate > 0 ? 1000 / st.rate : null) : p.perUnit;
      const r = J.lotSize({ balance: st.bal != null ? st.bal : a.bal, riskPct: st.risk != null ? st.risk : c.risk, sl: st.sl, perUnit });
      if (r) {
        const rr = c.risk > 0 ? c.tpPct / c.risk : 2;
        t += '\nمبلغ ریسک: <code>' + J.money(r.riskUsd) + '</code>\n<b>لات پیشنهادی: ' + r.lot.toFixed(2) + '</b>\nریسک واقعی با این لات: <code>' + J.money(r.realRisk) + '</code>\nسود هدف با RR ' + rr.toFixed(1) + ': <code>' + J.money(r.realRisk * rr) + '</code>';
      } else t += '\nفاصلهٔ حد ضرر رو بفرست تا لات محاسبه بشه.';
      if (st.pre === 'jpy') kb.push([b('تغییر قیمت', 'l:ask:rate')]);
      kb.push([b('فاصلهٔ حد ضرر', 'l:ask:sl'), b('ریسک %', 'l:ask:risk'), b('بالانس', 'l:ask:bal')]);
      kb.push([b('نوع نماد دیگر', 'l:reset')]);
    }
    kb.push([b('منو', 'm')]);
    return { text: t, kb };
  }

  /* ---------- حساب‌ها ---------- */
  function acctView(V) {
    const { doc, aid } = V;
    let t = '<b>حساب‌های ژورنال</b>\n\n';
    const kb = [];
    doc.list.forEach((x) => {
      const j = J.normalizeJournal(doc.j[x.id]), w = J.compute(j), pc = w.bal0 > 0 ? w.net / w.bal0 * 100 : 0;
      t += (x.id === aid ? '> ' : '') + '<b>' + esc(x.name) + '</b> (' + (KINDS[x.kind] || '') + ')  ' + J.money(w.bal) + '  ' + J.pct(pc, 1) + '\n';
      if (x.id !== aid) kb.push([b('رفتن به ' + x.name, 'a:go:' + x.id)]);
    });
    kb.push([b('حساب جدید', 'a:new'), b('منو', 'm')]);
    return { text: t, kb };
  }

  /* ---------- ستاپ‌ها و قوانین ---------- */
  function setupView(V) {
    const { c } = V;
    let t = '<b>استراتژی‌ها (ستاپ‌ها)</b>\n' + (c.setups.length ? c.setups.map((s, i) => (i + 1) + '. ' + esc(s)).join('\n') : 'هنوز چیزی نداری.') + '\n\n<b>قوانین معاملاتی</b>\n' + (c.rules.length ? c.rules.map((s, i) => (i + 1) + '. ' + esc(s)).join('\n') : 'هنوز چیزی نداری.');
    const kb = [[b('افزودن استراتژی', 'su:add:s'), b('افزودن قانون', 'su:add:r')]];
    c.setups.forEach((s, i) => kb.push([b('حذف: ' + s, 'su:del:s:' + i)]));
    c.rules.forEach((s, i) => kb.push([b('حذف: ' + s, 'su:del:r:' + i)]));
    kb.push([b('منو', 'm')]);
    return { text: t, kb };
  }
  function settingsView(V, prefs) {
    const { c } = V;
    const t = '<b>تنظیمات</b>\nبازار: <b>' + (J.MARKETS[c.mk] || J.MARKETS.fx) + '</b>\nتقویم: <b>' + (c.cal === 'j' ? 'شمسی' : 'میلادی') + '</b>\nمنطقهٔ زمانی ربات: <b>' + esc((Object.values(TZS).find((x) => x[0] === prefs.tz) || [prefs.tz, prefs.tz])[1]) + '</b>\nریسک هر معامله: <b>' + c.risk + '%</b>   TP: <b>' + c.tpPct + '%</b>\nبالانس اولیه: <b>' + J.money(c.balance) + '</b>\nهفته‌های جدید: <b>' + (c.wk7 ? '۷ روزه' : '۵ روزه') + '</b>';
    const kb = [
      [b('تقویم: ' + (c.cal === 'j' ? 'میلادی شود' : 'شمسی شود'), 'st:cal')],
      [b('نوع بازار: ' + (J.MARKETS[c.mk] || J.MARKETS.fx) + '  (تغییر)', 'mk')],
      Object.keys(TZS).map((k) => b(TZS[k][1], 'st:tz:' + k)),
      [b('ریسک %', 'st:ask:risk'), b('TP %', 'st:ask:tpPct'), b('بالانس اولیه', 'st:ask:balance')],
      [b('منو', 'm')]
    ];
    return { text: t, kb };
  }


  /* ---------- اخبار و سشن (دکمهٔ «همه») ---------- */
  const NX_MODES = [['d0', 'امروز'], ['d1', 'فردا'], ['w', 'این هفته'], ['nw', 'هفتهٔ بعد']];
  const human = (min) => (min < 60 ? min + ' دقیقه' : min < 1440 ? Math.floor(min / 60) + ' ساعت و ' + (min % 60) + ' دقیقه' : Math.floor(min / 1440) + ' روز');
  async function newsEvents() {
    if (!news) return [];
    try { if (news.ensure) await news.ensure(); } catch (e) { /* ignore */ }
    return news.events ? news.events() : [];
  }
  const NEXT_F = { H: 'M', M: 'L', L: 'H' };
  const nxFilterBtn = (f, pre) => b('فیلتر: ' + IMPACT_LABEL[f], pre + NEXT_F[f]);
  async function hubView(ctx, f) {
    const kb = [
      [b('امروز', 'nx:i:d0:' + f), b('فردا', 'nx:i:d1:' + f)],
      [b('این هفته', 'nx:i:w:' + f), b('هفتهٔ بعد', 'nx:i:nw:' + f)],
      [b('سشن‌ها', 'nx:s'), nxFilterBtn(f, 'nx:h:')],
      [b('منو', 'm')]
    ];
    return { text: '<b>اخبار و سشن</b>\nیکی رو انتخاب کن', kb };
  }
  const MARK = { High: '●', Medium: '◐', Low: '○', Holiday: '◇' };
  // نسخهٔ متنی (فقط وقتی ساخت عکس ممکن نباشه): کوتاه، مرتب و بدون شلوغی
  function newsText(ev, tz, mode, f, nowMs) {
    const sel = pickNews(ev, { tz, mode, impact: f, nowMs });
    const head = '<b>' + MODE_TITLE[mode] + '</b>  ·  ' + dateEn(partsIn(nowMs, tz)).split(' ').slice(0, 3).join(' ');
    if (!sel.rows.length) return head + '\nخبری با این فیلتر پیدا نشد.';
    const RK = { High: 3, Medium: 2, Holiday: 2, Low: 1 };
    let rows = sel.rows;
    const render = (rs) => {
      let cur = -1, out = '', open = false;
      for (const r of rs) {
        if (r.dn !== cur) {
          if (open) out += '</blockquote>';
          cur = r.dn; open = true;
          out += (mode === 'w' || mode === 'nw' ? '\n<b>' + J.DN[(r.p.wd + 6) % 7] + '  ' + dateEn(r.p).split(' ').slice(1, 3).join(' ') + '</b>' : '') + '\n<blockquote>';
        } else out += '\n';
        const hi = r.ev.i === 'High';
        out += '<b>' + J.hm(r.p) + '</b>  ' + esc(r.ev.c) + '  ' + (MARK[r.ev.i] || '○') + '  ' + (hi ? '<b>' + esc(r.ev.t) + '</b>' : esc(r.ev.t));
        if (r.ev.f || r.ev.p) out += '\n      ' + (r.ev.f ? 'پیش‌بینی ' + esc(r.ev.f) : '') + (r.ev.f && r.ev.p ? '  ·  ' : '') + (r.ev.p ? 'قبلی ' + esc(r.ev.p) : '');
      }
      return out + (open ? '</blockquote>' : '');
    };
    let body = render(rows);
    while (body.length > 3300 && rows.length > 3) {      // طولانی نشه: کم‌اهمیت‌ترین‌ها حذف می‌شن
      let k = 0; for (let i = 1; i < rows.length; i++) if ((RK[rows[i].ev.i] || 0) <= (RK[rows[k].ev.i] || 0)) k = i;
      rows = rows.slice(0, k).concat(rows.slice(k + 1)); body = render(rows);
    }
    let t = head + body;
    const hi = rows.find((r) => r.ev.i === 'High' && r.ev.d >= nowMs - 36e5);
    if (hi) {
      const o = outlookFor(hi.ev);
      t += '\n\n<b>برداشت</b>  ' + esc(hi.ev.c) + '  ' + J.hm(hi.p) + '  ·  ' + esc(o.label) + '\n<blockquote>' + o.pairs.map((pr) => esc(pr[0]) + '\n<b>' + esc(pr[1]) + '</b>').join('\n') + '</blockquote>\n<i>فقط یک سناریوی احتمالی است، توصیه نیست.</i>';
    }
    const cut = sel.rows.length - rows.length;
    if (cut > 0) t += '\n+' + cut + ' خبر کم‌اهمیت‌تر نمایش داده نشد';
    return t;
  }
  function nxImgKb(mode, f) {
    const mk = (k, lbl) => (k === mode ? bs(lbl, 'nx:i:' + k + ':' + f, 'primary') : b(lbl, 'nx:i:' + k + ':' + f));
    return [
      [mk('d0', 'امروز'), mk('d1', 'فردا'), mk('w', 'هفته'), mk('nw', 'بعدی')],
      [nxFilterBtn(f, 'nx:i:' + mode + ':'), b('سشن', 'nx:s'), b('منو', 'm')]
    ];
  }
  function ratesText(d, tz, sections) {
    const r = composeRates(d, sections || ['fiat', 'gold', 'crypto'], tz, 3900);
    return r.caption + (r.extra ? '\n\n' + r.extra : '');
  }
  function sessionsText(tz, nowMs) {
    const nowP = partsIn(nowMs, tz);
    const win = sessionWindows(nowMs);
    let t = '<b>سشن‌های بازار</b>  ·  ' + J.hm(nowP) + '\n<blockquote>' + win.map((w) => (w.isOpen ? '<b>' + w.fa + '</b>  باز' : w.fa + '  بسته') + '   ' + J.hm(partsIn(w.open * 6e4, tz)) + ' تا ' + J.hm(partsIn(w.close * 6e4, tz))).join('\n') + '</blockquote>';
    const L = win[2], N = win[3], s1 = Math.max(L.open, N.open), e1 = Math.min(L.close, N.close);
    if (e1 > s1) t += '\nهمپوشانی لندن و نیویورک: <b>' + J.hm(partsIn(s1 * 6e4, tz)) + ' تا ' + J.hm(partsIn(e1 * 6e4, tz)) + '</b>';
    return t;
  }

  /* ---------- بخش ادمین ---------- */
  const ago = (sec) => { if (!sec) return '-'; const m = Math.max(0, Math.round((now().getTime() / 1000 - sec) / 60)); return m < 1 ? 'همین الان' : m < 60 ? m + ' دقیقه پیش' : m < 1440 ? Math.floor(m / 60) + ' ساعت پیش' : Math.floor(m / 1440) + ' روز پیش'; };
  async function adminHome() {
    if (!admin) return note('بخش ادمین روی این سرور فعال نیست.');
    const st = await admin.stats(), ns = admin.newsStatus ? admin.newsStatus() : null;
    let t = '<b>بخش ادمین</b>\nکاربران: <b>' + st.users + '</b>   فعال ۲۴ ساعت: <b>' + st.active24h + '</b>   فعال ۷ روز: <b>' + st.active7d + '</b>\nعضو جدید ۲۴ ساعت: <b>' + st.new24h + '</b>   ۷ روز: <b>' + st.new7d + '</b>\nکاربران ربات: <b>' + st.tgUsers + '</b>   ژورنال ابری: <b>' + st.journals + '</b>   بکاپ: <b>' + st.withBackup + '</b>\nتیکت باز: <b>' + st.openTickets + '</b>';
    if (ns) t += '\n\nاخبار: <b>' + ns.count + '</b> خبر، منبع ' + esc(ns.source) + (ns.ageMin != null ? '، ' + ns.ageMin + ' دقیقه پیش بروز شده' : '') + (ns.lastError ? '\nآخرین خطا: ' + esc(ns.lastError) : '');
    const kb = [
      [b('فعال‌های ۲۴ ساعت', 'ad:u:a24:0'), b('همهٔ کاربران', 'ad:u:all:0')],
      [b('تیکت‌ها (' + st.openTickets + ')', 'ad:t'), b('پست‌های گلوبال', 'ad:g')],
      [b('پیام همگانی', 'ad:bc'), b('اخبار: بروزرسانی', 'ad:nr')],
      [b('ایمپورت فید اخبار', 'ad:ni'), b('بازخوانی', 'ad')],
      [b('هوش مصنوعی', 'ad:ai'), b('گروه‌ها', 'ad:gr')],
      [b('تست ساخت عکس', 'ad:img')],
      [b('خروج از حالت ادمین', 'ad:out'), b('منو', 'm')]
    ];
    return { text: t, kb };
  }
  async function adminUsers(mode, page) {
    const r = await admin.users(mode, page);
    let t = '<b>' + (mode === 'a24' ? 'فعال در ۲۴ ساعت اخیر' : 'همهٔ کاربران (تازه‌ترین‌ها)') + '</b>   صفحهٔ ' + (page + 1) + '\n';
    t += r.users.length ? r.users.map((u) => esc(u.email) + '\nآخرین فعالیت: ' + ago(u.seen) + '   عضویت: ' + ago(u.created)).join('\n\n') : 'کاربری پیدا نشد.';
    const nav = [];
    if (page > 0) nav.push(b('قبلی', 'ad:u:' + mode + ':' + (page - 1)));
    if (r.more) nav.push(b('بعدی', 'ad:u:' + mode + ':' + (page + 1)));
    return { text: t, kb: [...(nav.length ? [nav] : []), [b('بخش ادمین', 'ad'), b('منو', 'm')]] };
  }
  async function adminTickets(all) {
    const rows = await admin.tickets(all);
    let t = '<b>تیکت‌ها</b>  (' + (all ? 'همه' : 'باز') + ')\n' + (rows.length ? rows.map((x) => '#' + x.id + '  ' + esc(String(x.subject).slice(0, 40)) + '  [' + x.status + ']\n' + esc(x.email)).join('\n\n') : 'تیکتی نیست.');
    const kb = rows.map((x) => [b('#' + x.id + '  ' + String(x.subject).slice(0, 28), 'ad:t:' + x.id)]);
    kb.push([b(all ? 'فقط باز' : 'همه', all ? 'ad:t' : 'ad:t:all'), b('بخش ادمین', 'ad')]);
    return { text: t, kb };
  }
  async function adminTicket(id) {
    const r = await admin.ticket(id);
    if (!r) return note('تیکت پیدا نشد.');
    let t = '<b>تیکت #' + id + '</b>  ' + esc(r.ticket.subject) + '\n' + esc(r.ticket.email) + '   وضعیت: <b>' + r.ticket.status + '</b>\n\n' + r.messages.map((m) => (m.admin ? 'ما: ' : 'کاربر: ') + esc(String(m.body).slice(0, 500))).join('\n\n');
    return { text: t, kb: [[b('پاسخ', 'ad:tr:' + id)], [b('بستن تیکت', 'ad:ts:' + id + ':closed'), b('باز کردن', 'ad:ts:' + id + ':open')], [b('تیکت‌ها', 'ad:t'), b('بخش ادمین', 'ad')]] };
  }
  async function adminPosts(all) {
    const rows = await admin.posts(all);
    let t = '<b>پست‌های گلوبال</b>  (' + (all ? 'تازه‌ترین‌ها' : 'گزارش‌شده یا مخفی') + ')\n';
    t += rows.length ? rows.map((x) => '#' + x.id + '  @' + esc(x.username) + (x.banned ? ' [بن]' : '') + '  ' + esc(x.symbol) + (x.hidden ? '  [مخفی]' : '') + '  گزارش: ' + x.reports + '\n' + esc(String(x.body).slice(0, 160))).join('\n\n') : 'پستی نیست.';
    const kb = [];
    rows.forEach((x) => kb.push([b(x.hidden ? 'نمایش #' + x.id : 'مخفی #' + x.id, 'ad:gh:' + x.id + ':' + (x.hidden ? 0 : 1)), b('حذف #' + x.id, 'ad:gd:' + x.id), b(x.banned ? 'رفع بن' : 'بن', 'ad:gb:' + x.username + ':' + (x.banned ? 0 : 1))]));
    kb.push([b(all ? 'فقط گزارش‌شده‌ها' : 'تازه‌ترین‌ها', all ? 'ad:g' : 'ad:g:all'), b('بخش ادمین', 'ad')]);
    return { text: t, kb };
  }

  /* ---------- دستیار هوش مصنوعی (پیوی) ---------- */
  const AI_ERR = { off: 'کلید هوش مصنوعی هنوز تنظیم نشده.', disabled: 'دستیار هوش مصنوعی الان توسط مدیر غیرفعال شده.', daily: 'سقف سؤال‌های امروزت پر شده؛ فردا دوباره بپرس.', cooldown: 'یک لحظه صبر کن و دوباره بپرس.', ai_busy: 'سرویس الان شلوغه؛ چند لحظه بعد دوباره بپرس.', ai_timeout: 'جواب دیر رسید؛ دوباره امتحان کن.', ai_failed: 'نتونستم جواب بگیرم؛ چند لحظه بعد دوباره امتحان کن.', ai_empty: 'جوابی نیومد؛ سؤال رو یه‌جور دیگه بنویس.', bad_request: 'سؤالت خالی بود.' };
  const aiKb = [[b('گفتگوی تازه', 'ai:n'), b('تحلیل ژورنال من', 'ai:j')], [b('منو', 'm')]];
  async function aiEnter(ctx, fresh) {
    if (fresh) aiHist.delete(ctx.tgId);
    const stt = AI.status();
    if (!stt.on.private) { await store.clearState(ctx.tgId); await show(ctx, { text: '<b>دستیار هوش مصنوعی</b>\n' + (!stt.key ? AI_ERR.off : AI_ERR.disabled), kb: [[b('منو', 'm')]] }); return; }
    await setState(ctx, { k: 'ai', await: 'ai', chat: ctx.chat, at: now().getTime() });
    await show(ctx, { text: '<b>دستیار هوش مصنوعی</b>\nهر سؤالی دربارهٔ تحلیل، ریسک و روانشناسی ترید داری همین‌جا بنویس. جواب‌ها آموزشی‌ان و سیگنال نیستن.\n\nبرای نظر دادن روی آمار خودت، «تحلیل ژورنال من» رو بزن.', kb: aiKb });
  }
  function journalSummaryBot(V) {
    const a = V.a, c = V.c, tr = a.trades || [], days = a.days || [], dec = a.tp + a.sl;
    let peak = a.bal0, mdd = 0; days.forEach((d) => { if (d.bal > peak) peak = d.bal; const dd = peak > 0 ? (peak - d.bal) / peak * 100 : 0; if (dd > mdd) mdd = dd; });
    const sym = {}; tr.forEach((x) => { const k = (x.t && x.t.p) || '?'; sym[k] = sym[k] || { n: 0, w: 0, l: 0, pnl: 0 }; sym[k].n++; if (x.t.r === 'TP') sym[k].w++; else if (x.t.r === 'SL') sym[k].l++; sym[k].pnl = Math.round((sym[k].pnl + x.pnl) * 100) / 100; });
    return { account: V.acct && V.acct.name, market: c.mk, startBalance: a.bal0, balance: Math.round(a.bal * 100) / 100, netPct: a.bal0 ? Math.round((a.bal - a.bal0) / a.bal0 * 1000) / 10 : 0, tp: a.tp, sl: a.sl, be: a.be, winRate: dec ? Math.round(a.tp / dec * 1000) / 10 : null,
      profitFactor: a.gl ? Math.round(a.gp / a.gl * 100) / 100 : null, maxDrawdownPct: Math.round(mdd * 10) / 10, activeDays: days.filter((d) => d.traded).length, riskPct: c.risk, bySymbol: sym,
      last25: tr.slice(-25).map((x) => ({ sym: x.t.p, res: x.t.r, rr: x.t.rr === '' ? null : x.t.rr, pnl: x.pnl })) };
  }
  async function aiTurn(ctx, st, text, extra) {
    const h = aiHist.get(ctx.tgId) || { at: 0, msgs: [] };
    if (now().getTime() - h.at > 30 * 60e3) h.msgs = [];
    const q = String(text || '').trim().slice(0, 1500);
    if (!q) return;
    await show(ctx, { text: '<b>دستیار هوش مصنوعی</b>\n\nدر حال نوشتن جواب…', kb: [[b('خروج', 'x')]] });
    const r = await AI.ask({ scope: 'private', uid: String(ctx.tgId), msgs: h.msgs.concat([{ role: 'user', text: q }]), extraSystem: extra || '' });
    await setState(ctx, { k: 'ai', await: 'ai', chat: ctx.chat, at: now().getTime() });
    if (!r.ok) { await show(ctx, { text: '<b>دستیار هوش مصنوعی</b>\n' + (AI_ERR[r.reason] || AI_ERR.ai_failed), kb: aiKb }); return; }
    h.msgs = h.msgs.concat([{ role: 'user', text: q }, { role: 'assistant', text: r.reply.slice(0, 1500) }]).slice(-10); h.at = now().getTime(); aiHist.set(ctx.tgId, h);
    let ans = AI.md(r.reply.slice(0, 3000));
    await show(ctx, { text: '<b>سؤال</b>\n' + esc(q.slice(0, 300)) + '\n\n' + ans + '\n\n<i>' + r.left + ' سؤال دیگه برای امروز مونده</i>', kb: aiKb });
  }

  /* ---------- پنل ادمین: هوش مصنوعی و کلید ---------- */
  const onoff = (v) => (v ? 'روشن' : 'خاموش');
  const AI_STEP = { siteDaily: [10, 'سایت روزانه'], privateDaily: [10, 'پیوی روزانه'], groupUserDaily: [2, 'گروه: هر کاربر'], groupDaily: [10, 'گروه: کل در روز'], groupCooldown: [5, 'گروه: فاصله (ثانیه)'] };
  function adminAiView() {
    const cfg = AI.cfg(), st = AI.status();
    const t = '<b>هوش مصنوعی</b>\nکلید: <b>' + (st.key ? 'تنظیم شده' : 'تنظیم نشده') + '</b>\nمدل: <code>' + esc(st.model) + '</code>\n\n' +
      'سایت: <b>' + onoff(cfg.site) + '</b>   پیوی ربات: <b>' + onoff(cfg.private) + '</b>   گروه‌ها: <b>' + onoff(cfg.group) + '</b>\n' +
      'سقف روزانهٔ هر کاربر: سایت <b>' + cfg.siteDaily + '</b>  ·  پیوی <b>' + cfg.privateDaily + '</b>\n' +
      'گروه: هر کاربر <b>' + cfg.groupUserDaily + '</b> در روز  ·  کل گروه <b>' + cfg.groupDaily + '</b>  ·  فاصله <b>' + cfg.groupCooldown + '</b> ثانیه\n' +
      'جواب توی گروه: ' + (cfg.groupTrigger === 'mention' ? 'دستور /ai، منشن و ریپلای به ربات' : 'فقط دستور /ai') + '\n' +
      'ذخیرهٔ ماندگار روی Render: <b>' + (ENV.render() ? 'فعال' : 'غیرفعال') + '</b>' + (ENV.render() ? '' : '\nبرای ماندگار شدن، RENDER_API_KEY و RENDER_SERVICE_ID رو توی Render بذار؛ وگرنه کلید تا ری‌استارت بعدی می‌مونه.');
    const kb = [
      [b('سایت: ' + onoff(cfg.site), 'ad:ait:site'), b('پیوی: ' + onoff(cfg.private), 'ad:ait:private'), b('گروه: ' + onoff(cfg.group), 'ad:ait:group')]
    ];
    for (const f of Object.keys(AI_STEP)) kb.push([b('−', 'ad:ain:' + f + ':-'), b(AI_STEP[f][1] + ': ' + cfg[f], 'noop'), b('+', 'ad:ain:' + f + ':+')]);
    kb.push([b('جواب توی گروه: ' + (cfg.groupTrigger === 'mention' ? 'منشن و /ai' : 'فقط /ai'), 'ad:ait:trig')]);
    kb.push([bs('ارسال کلید جدید', 'ad:aik', 'primary'), b('تست اتصال', 'ad:aitest')]);
    kb.push([b('عوض کردن مدل', 'ad:aim'), b('حذف کلید', 'ad:aikd')]);
    kb.push([b('گروه‌ها', 'ad:gr'), b('بخش ادمین', 'ad')]);
    return { text: t, kb };
  }
  async function adminSetKey(ctx, text, m) {
    if (m && m.message_id) { try { await tg.del(ctx.chat, m.message_id); } catch (e) { /* ignore */ } } // کلید فوراً از چت پاک می‌شه
    if (!(await isAdm(ctx))) { await store.clearState(ctx.tgId); return; }
    const key = String(text || '').trim().replace(/\s+/g, '');
    if (!/^[A-Za-z0-9_-]{20,120}$/.test(key)) { await flash(ctx, 'این شبیه کلید Gemini نیست؛ دوباره بفرست یا انصراف بزن.'); return; }
    const v = await AI.verifyKey(key);
    if (!v.ok) { await store.clearState(ctx.tgId); await show(ctx, { text: '<b>کلید قبول نشد</b>\nگوگل کلید رو نپذیرفت (وضعیت ' + (v.status || 'اتصال نشد') + ').\nکلید جایی ذخیره نشد.', kb: [[b('دوباره', 'ad:aik'), b('هوش مصنوعی', 'ad:ai')]] }); return; }
    const r = await ENV.set('GEMINI_API_KEY', key);
    await store.clearState(ctx.tgId);
    const msg = '<b>کلید ثبت شد</b>\nاز همین الان فعاله.\n' + (r.persisted ? 'روی Render هم ذخیره شد و بعد از ری‌استارت هم می‌مونه.' : (r.reason === 'no_render' ? 'توی Render ذخیره نشد چون RENDER_API_KEY و RENDER_SERVICE_ID ست نیستن؛ تا ری‌استارت بعدی فعاله.' : 'ذخیره روی Render انجام نشد (' + esc(r.reason || '') + '). تا ری‌استارت بعدی فعاله؛ دستی توی Render بذارش.')) + '\n\nپیام کلید از چت پاک شد. اگه جای دیگه‌ای هم دیده شده، بهتره کلید رو عوض کنی.';
    await show(ctx, { text: msg, kb: [[b('هوش مصنوعی', 'ad:ai'), b('تست اتصال', 'ad:aitest')]] });
  }
  async function adminSetModel(ctx, text) {
    if (!(await isAdm(ctx))) { await store.clearState(ctx.tgId); return; }
    const mdl = String(text || '').trim();
    if (!/^[A-Za-z0-9._-]{3,60}$/.test(mdl)) { await flash(ctx, 'اسم مدل معتبر نیست؛ مثلاً gemini-2.5-flash'); return; }
    await AI.set({ model: mdl });
    await store.clearState(ctx.tgId);
    const pr = await AI.ping();
    await show(ctx, { text: '<b>مدل: <code>' + esc(mdl) + '</code></b>\nتست: ' + (pr.ok ? 'جواب داد (' + pr.ms + ' میلی‌ثانیه)' : 'نشد (' + esc(pr.code || '') + (pr.status ? ' ' + pr.status : '') + ')، مدل یا کلید رو چک کن'), kb: [[b('هوش مصنوعی', 'ad:ai')]] });
  }
  /* ---------- پنل ادمین: گروه‌ها ---------- */
  const IVS = [30, 60, 120, 180, 360, 720, 1440], ivLabel = (m) => (m < 60 ? m + ' دقیقه' : m === 1440 ? '۱ روز' : (m / 60) + ' ساعت');
  async function adminGroupsView() {
    const list = groups ? await groups.list() : [];
    const t = '<b>گروه‌ها و کانال‌ها</b>\n' + (list.length ? 'یکی رو انتخاب کن تا تنظیماتش باز بشه.' : 'ربات هنوز توی هیچ گروهی نیست. اضافه‌ش کن (برای کانال ادمینش کن)؛ همین‌جا ظاهر می‌شه.');
    const kb = list.slice(0, 20).map((g) => [b((g.active ? '' : '(خارج) ') + (g.title || g.id).slice(0, 26) + (g.mode !== 'off' ? '  ·  خودکار' : ''), 'ad:gr:' + g.id)]);
    kb.push([b('هوش مصنوعی', 'ad:ai'), b('بخش ادمین', 'ad')]);
    return { text: t, kb };
  }
  async function adminGroupView(id) {
    const g = groups ? await groups.get(id) : null;
    if (!g) return { text: 'این گروه توی لیست نیست.', kb: [[b('گروه‌ها', 'ad:gr')]] };
    const KIND = { group: 'گروه', supergroup: 'سوپرگروه', channel: 'کانال' }, SEC = { fiat: 'ارز', gold: 'طلا', crypto: 'ارز دیجیتال' };
    const auto = g.mode === 'off' ? 'خاموش' : g.mode === 'every' ? 'هر ' + ivLabel(g.interval) : 'روزانه ساعت ' + g.times.join('، ') + ' (تهران)';
    const t = '<b>' + esc(g.title || g.id) + '</b>\n' + (KIND[g.kind] || 'گروه') + '  ·  ' + (g.active ? 'ربات عضوه' : 'ربات خارج شده') + '\n\n' +
      'جواب به نرخ ارز: <b>' + onoff(g.enabled) + '</b>\nهوش مصنوعی: <b>' + onoff(g.ai) + '</b>\nارسال خودکار: <b>' + auto + '</b>\nچی فرستاده بشه: <b>' + g.sections.map((k) => SEC[k]).join('، ') + '</b>\nفاصلهٔ ضد اسپم: <b>' + g.cooldown + ' ثانیه</b>\nپاک شدن پیام خودکار قبلی: <b>' + onoff(g.delPrev) + '</b>';
    const kb = [[b('نرخ ارز: ' + onoff(g.enabled), 'ad:grt:' + id + ':en'), b('هوش مصنوعی: ' + onoff(g.ai), 'ad:grt:' + id + ':ai')], [b('ارسال خودکار: ' + (g.mode === 'off' ? 'خاموش' : g.mode === 'every' ? 'فاصله‌ای' : 'ساعت مشخص'), 'ad:grt:' + id + ':mode')]];
    if (g.mode === 'every') kb.push([b('−', 'ad:grt:' + id + ':ivd'), b('هر ' + ivLabel(g.interval), 'noop'), b('+', 'ad:grt:' + id + ':ivu')]);
    if (g.mode === 'daily') kb.push([b('ساعت‌ها: ' + g.times.join('، '), 'ad:grtm:' + id)]);
    kb.push(['fiat', 'gold', 'crypto'].map((k) => b(SEC[k] + ': ' + (g.sections.includes(k) ? 'بله' : 'نه'), 'ad:grt:' + id + ':s:' + k)));
    kb.push([b('ضد اسپم: ' + g.cooldown + ' ثانیه', 'ad:grt:' + id + ':cd'), b('پاک کردن قبلی: ' + onoff(g.delPrev), 'ad:grt:' + id + ':dp')]);
    kb.push([bs('ارسال همین الان', 'ad:grs:' + id, 'primary'), b('خروج ربات از گروه', 'ad:grx:' + id)]);
    kb.push([b('گروه‌ها', 'ad:gr'), b('بخش ادمین', 'ad')]);
    return { text: t, kb };
  }
  async function adminSetTimes(ctx, st, text) {
    if (!(await isAdm(ctx)) || !groups) { await store.clearState(ctx.tgId); return; }
    const times = parseTimes(text);
    if (!times.length) { await flash(ctx, 'ساعت معتبر نبود؛ مثل 09:00, 18:30 بنویس.'); return; }
    await groups.update(st.id, { times });
    await store.clearState(ctx.tgId);
    await show(ctx, await adminGroupView(st.id));
  }

  /* ---------- راهنما ---------- */
  const HELP = '<b>راهنمای ربات</b>\n\n' +
    'دکمه‌های منو همهٔ کارها رو انجام می‌دن؛ لازم نیست اپ رو باز کنی.\n\n' +
    '<b>ثبت سریع با متن</b>\n<code>tp xauusd rr2</code>  ثبت یک TP با RR دو\n<code>sl eurusd</code>  ثبت یک SL\n<code>be gbpusd @10:30</code>  ثبت BE با ساعت\nمی‌تونی اسم استراتژی، <code>#برچسب</code>، <code>lot0.5</code>، <code>fee1.2</code> و تاریخ (<code>2026-10-24</code> یا <code>1405/08/02</code>) هم اضافه کنی.\n\n' +
    '<b>دستورها</b>\n/news اخبار و سشن (فقط تصویر)   /rates نرخ ارز و طلا   /crypto ارز دیجیتال   /menu منو   /today امروز   /week هفته   /stats آمار\n/review مرور هفته   /newweek هفتهٔ جدید   /backtest بکتست\n/lot محاسبه لات   /accounts حساب‌ها   /csv خروجی\n/setups ستاپ‌ها و قوانین   /settings تنظیمات\n/link اتصال به حساب سایت   /unlink جدا کردن\n\n' +
    'عکس چارت: موقع ثبت معامله عکس رو توی همین چت بفرست.';

  /* ---------- هستهٔ به‌روزرسانی ---------- */
  async function handleUpdate(u) {
    if (u.callback_query) return onCallback(u.callback_query);
    if (u.my_chat_member) return groups ? groups.onMember(u.my_chat_member) : undefined;
    if (u.message) return onMessage(u.message);
  }
  async function mkctx(from, chat, msgId) {
    const r = await store.resolveUser(from.id, from);
    const prefs = Object.assign({ tz: 'Asia/Tehran' }, r.prefs || {});
    let panel = null;
    if (store.getPanel) { try { panel = await store.getPanel(from.id); } catch (e) { panel = null; } }
    return { tgId: from.id, chat, msgId, panel, uid: r.uid, prefs };
  }

  const adminFails = new Map();
  const LUMOS = /^\/?(لوموس|lumos)(@\w+)?(?:\s+(\S+))?$/i;
  const isKeyMsg = (t) => { const m = LUMOS.exec(t); return !!(m && m[3]); };
  async function onMessage(m) {
    if (m.chat && m.chat.type !== 'private') return groups ? groups.onMessage(m) : undefined; // گروه: فقط نرخ ارز، بدون هیچ سؤالی
    if (!m.chat || !m.from || m.from.is_bot) return;
    const ctx = await mkctx(m.from, m.chat.id, null);
    ctx.msgId = ctx.panel; // همیشه همون یک پنل ویرایش می‌شه
    const text = (m.text || '').trim();
    if (isKeyMsg(text)) { try { await tg.del(m.chat.id, m.message_id); } catch (e) { /* ignore */ } }
    try { await handleMessage(ctx, m, text); }
    finally { if (m.message_id && !isKeyMsg(text) && !text.startsWith('/')) { try { await tg.del(m.chat.id, m.message_id); } catch (e) { /* ignore */ } } }
  }
  async function isAdm(ctx) { try { return !!(store.isAdmin && await store.isAdmin(ctx.tgId)); } catch (e) { return false; } }
  async function adminEntry(ctx, key) {
    if (await isAdm(ctx)) { await store.clearState(ctx.tgId); return show(ctx, await adminHome()); }
    if (!key) { await store.setState(ctx.tgId, { k: 'lumos', await: 'key' }); return flash(ctx, 'رمز؟'); }
    const f = adminFails.get(ctx.tgId) || { n: 0, t: Date.now() };
    if (Date.now() - f.t > 15 * 60e3) { f.n = 0; f.t = Date.now(); }
    if (f.n >= 5) return flash(ctx, 'تلاش‌ها از حد گذشت؛ بعداً دوباره امتحان کن.');
    if (!admin || !admin.keyOk(key)) { f.n++; adminFails.set(ctx.tgId, f); await store.clearState(ctx.tgId); return flash(ctx, 'رمز درست نیست.'); }
    adminFails.delete(ctx.tgId);
    await store.clearState(ctx.tgId);
    await store.setAdmin(ctx.tgId, true);
    return show(ctx, await adminHome());
  }
  async function handleMessage(ctx, m, text) {
    // اتصال حساب
    let mm;
    if ((mm = /^\/start(?:@\w+)?\s+L([A-Za-z0-9]{6,20})$/.exec(text))) {
      const r = await store.consumeLinkCode(mm[1], m.from.id);
      if (!r.ok) { await say(ctx, 'این لینک اتصال معتبر نیست یا منقضی شده. از داخل سایت دوباره لینک بساز.', { inline_keyboard: [[b('منو', 'm')]] }); return; }
      await say(ctx, 'حساب تلگرامت به حساب سایت (' + esc(r.email) + ') وصل شد. از این به بعد ربات و سایت یک ژورنال مشترک دارن.' + (r.merged ? '\nداده‌هایی که قبلاً از تلگرام ثبت کرده بودی هم به ژورنال سایت اضافه شد.' : ''), { inline_keyboard: [[b('باز کردن منو', 'm')]] });
      return;
    }
    if (/^\/id(@\w+)?$/i.test(text)) return say(ctx, 'شناسهٔ عددی تلگرام تو: <code>' + ctx.tgId + '</code>', { inline_keyboard: [[b('منو', 'm')]] });
    if ((mm = LUMOS.exec(text))) return adminEntry(ctx, mm[3]);
    if (/^\/(rates|nerkh)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'rt'); }
    if (/^\/(ai|ask)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'ai'); }
    { const mq = /^\/(?:ai|ask)(?:@\w+)?\s+([\s\S]+)$/i.exec(text); if (mq && AI.status().on.private) { await store.clearState(ctx.tgId); return aiTurn(ctx, null, mq[1]); } }
    if (/^\/(crypto|coins)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'rt:c'); }
    if (/^\/(news|sessions)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'nx'); }
    if (/^\/(start|menu)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return showMenu(ctx); }
    if (/^\/help(@\w+)?$/i.test(text)) { await say(ctx, HELP, { inline_keyboard: [[b('منو', 'm')]] }); return; }
    if (/^\/(today)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'd'); }
    if (/^\/(week)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'w'); }
    if (/^\/(stats)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 's:w'); }
    if (/^\/(review)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'r'); }
    if (/^\/(newweek)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'nw'); }
    if (/^\/(backtest|bt)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'bt'); }
    if (/^\/(lot)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'lot'); }
    if (/^\/(accounts)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'ac'); }
    if (/^\/(csv|export)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'csv'); }
    if (/^\/(setups|rules)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'su'); }
    if (/^\/(settings)(@\w+)?$/i.test(text)) { await store.clearState(ctx.tgId); return nav(ctx, 'st'); }
    if (/^\/(link)(@\w+)?$/i.test(text)) { await say(ctx, 'برای وصل کردن ربات به حساب سایتت: توی سایت وارد حسابت شو، بخش «بیشتر» و بعد «ربات تلگرام»، و روی دکمهٔ اتصال بزن. همون‌جا لینک مخصوص ساخته می‌شه.\nاگه فقط از تلگرام استفاده می‌کنی، نیازی به اتصال نیست؛ همه‌چیز همین‌جا و داخل مینی‌اپ یکیه.', { inline_keyboard: [[b('منو', 'm')]] }); return; }
    if (/^\/(unlink)(@\w+)?$/i.test(text)) { const r = await store.unlink(ctx.tgId, m.from); await say(ctx, r ? 'اتصال به حساب سایت قطع شد؛ حالا ربات یک ژورنال مستقل مخصوص تلگرام داره.' : 'حساب تلگرامت به حساب سایت وصل نبود.', { inline_keyboard: [[b('منو', 'm')]] }); return; }
    if (text.startsWith('/')) { await flash(ctx, 'این دستور رو نمی‌شناسم. /help رو بزن.'); return; }

    const st = await store.getState(ctx.tgId);
    // عکس
    if (st && st.k === 'adni' && m.document) {
      if (!(await isAdm(ctx)) || !admin) return;
      try {
        const f = await tg.getFile(m.document.file_id);
        if (!f.buf) { await flash(ctx, 'فایل خیلی بزرگه.'); return; }
        const n = await admin.newsImport(f.buf.toString('utf8'));
        await store.clearState(ctx.tgId);
        await flash(ctx, n + ' خبر ایمپورت شد.');
        return show(ctx, await adminHome());
      } catch (e) { await flash(ctx, 'فایل معتبر نبود: ' + String((e && e.message) || e).slice(0, 80)); return; }
    }
    if (m.photo || (m.document && /^image\//.test(m.document.mime_type || ''))) { return onPhoto(ctx, m, st); }
    if (!text) return;
    if (st && st.k === 'ai' && now().getTime() - (st.at || 0) > 20 * 60e3) { await store.clearState(ctx.tgId); }
    else if (st && st.await) return onAnswer(ctx, st, text, m);
    // ثبت سریع
    const V = await view(ctx.uid, ctx.prefs.tz);
    const q = parseQuick(text, V.c, ctx.prefs.tz);
    if (q) {
      const today = J.nowInTz(ctx.prefs.tz, now());
      const ymd = q.date || today;
      const utcH = now().getUTCHours();
      const out = await mutate(ctx.uid, ctx.prefs.tz, (c) => {
        const hit = J.ensureDay(c, ymd); if (!hit) return { abort: true };
        if (q.y && !c.setups.includes(q.y) && c.setups.length < 16) c.setups.push(q.y);
        J.addTrade(c, hit.wi, hit.di, { r: q.r, p: q.p, rr: q.r === 'TP' ? q.rr : '', y: q.y, g: q.g, f: q.f, z: q.z, h: q.h || J.hm(J.nowInTz(ctx.prefs.tz, now())), s: utcH < 7 ? 'a' : utcH < 12 ? 'l' : utcH < 21 ? 'n' : '' });
        return { ok: true };
      });
      if (out && out.abort) { await say(ctx, 'جای این تاریخ توی ژورنال پیدا نشد.'); return; }
      const V2 = await view(ctx.uid, ctx.prefs.tz);
      const p = dayView(V2, ymd, today);
      p.text = 'ثبت شد: ' + q.r + (q.p ? ' ' + q.p : '') + '\n\n' + p.text;
      await show(ctx, p);
      return;
    }
    await flash(ctx, 'متوجه نشدم. برای ثبت سریع مثلاً بنویس: tp xauusd rr2\nیا از منو استفاده کن.');
  }

  async function onPhoto(ctx, m, st) {
    const fid = m.photo ? m.photo[m.photo.length - 1].file_id : m.document.file_id;
    let buf, mime = 'image/jpeg';
    try { const f = await tg.getFile(fid); buf = f.buf; if (f.mime) mime = f.mime; } catch (e) { await say(ctx, 'دریافت عکس ممکن نشد؛ دوباره بفرست.'); return; }
    if (!buf || buf.length > 900e3) { await say(ctx, 'حجم عکس بیشتر از حد مجازه (حداکثر حدود ۹۰۰ کیلوبایت). عکس رو به‌صورت «عکس» (نه فایل) بفرست تا خودِ تلگرام فشرده‌اش کنه.'); return; }
    const id = await store.putImage(ctx.uid, mime, buf);
    if (!id) { await say(ctx, 'سقف تعداد عکس‌های ذخیره‌شده پر شده. از اپ چند عکس قدیمی رو پاک کن.'); return; }
    if (st && st.k === 'trade') {
      st.i = id; await setState(ctx, st);
      const V = await view(ctx.uid, ctx.prefs.tz);
      ctx.msgId = st.msg;
      await show(ctx, wizView(V, st));
      return;
    }
    await setState(ctx, { k: 'photo', i: id, chat: ctx.chat });
    await say(ctx, 'عکس ذخیره شد. به کدوم معامله وصل بشه؟', { inline_keyboard: [[b('آخرین معاملهٔ امروز', 'ph:last')], [b('انصراف', 'x')]] });
  }

  async function onAnswer(ctx, st, text, m) {
    if (st.k === 'lumos') return adminEntry(ctx, text.trim());
    if (st.k === 'ai') return aiTurn(ctx, st, text);
    if (st.k === 'adaik') return adminSetKey(ctx, text, m);
    if (st.k === 'adaim') return adminSetModel(ctx, text);
    if (st.k === 'adgtm') return adminSetTimes(ctx, st, text);
    const a = st.await;
    const back = async (patch) => {
      Object.assign(st, patch || {}); delete st.await; await setState(ctx, st);
      const V = await view(ctx.uid, ctx.prefs.tz);
      ctx.msgId = st.msg || null;
      if (m && m.message_id) { try { await tg.del(ctx.chat, m.message_id); } catch (e) { /* ignore */ } }
      await show(ctx, wizView(V, st));
    };
    if (st.k === 'trade') {
      if (a === 'p') { const p = text.toUpperCase().replace(/[^A-Z0-9._]/g, '').slice(0, 12); if (!p) return say(ctx, 'نماد معتبر نیست؛ مثلاً XAUUSD.'); return back({ p }); }
      if (a === 'rr') { const v = num(text); if (!(v > 0)) return say(ctx, 'یک عدد مثبت بفرست؛ مثلاً 2.5'); return back({ rr: Math.min(100, v) }); }
      if (a === 'y') return back({ y: text.slice(0, 24) });
      if (a === 'g') return back({ g: text.slice(0, 20) });
      if (a === 'f') { const v = num(text); if (!(v >= 0)) return say(ctx, 'یک عدد بفرست؛ مثلاً 1.5'); return back({ f: v }); }
      if (a === 'z') { const v = num(text); if (!(v > 0)) return say(ctx, 'یک عدد مثبت بفرست؛ مثلاً 0.25'); return back({ z: v }); }
      if (a === 'bal') { const v = num(text); if (!(v > 0)) return say(ctx, 'یک عدد مثبت بفرست؛ مثلاً 10250'); return back({ bal: v }); }
      if (a === 'h') { const mm = /^(\d{1,2}):(\d{2})$/.exec(text.replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 1776)); if (!mm || +mm[1] > 23 || +mm[2] > 59) return say(ctx, 'ساعت رو به شکل 14:30 بفرست.'); return back({ h: mm[1].padStart(2, '0') + ':' + mm[2] }); }
    }
    const done = async (panelFn) => { await store.clearState(ctx.tgId); if (m && m.message_id) { try { await tg.del(ctx.chat, m.message_id); } catch (e) { /* ignore */ } } const V = await view(ctx.uid, ctx.prefs.tz); await show(ctx, panelFn(V)); };
    if (st.k === 'note') {
      const ymd = fromD8(st.date);
      await mutate(ctx.uid, ctx.prefs.tz, (c) => { const hit = J.ensureDay(c, ymd); if (!hit) return { abort: true }; const d = c.weeks[hit.wi].d[hit.di]; d.note = text.slice(0, 500); J.touchDay(c, hit.wi, hit.di); });
      return done((V) => dayView(V, ymd, J.nowInTz(ctx.prefs.tz, now())));
    }
    if (st.k === 'dbal') {
      const ymd = fromD8(st.date), tx = text.trim();
      const auto = /^(خودکار|auto|0)$/i.test(tx), v = num(tx);
      if (!auto && !(v > 0)) return say(ctx, 'یک عدد مثبت بفرست؛ مثلاً 10250. برای حالت خودکار بنویس: خودکار');
      await mutate(ctx.uid, ctx.prefs.tz, (c) => { const hit = J.ensureDay(c, ymd); if (!hit) return { abort: true }; const d = c.weeks[hit.wi].d[hit.di]; if (auto) { d.m = 'a'; d.v = ''; } else { d.m = 'b'; d.v = v; } J.touchDay(c, hit.wi, hit.di); });
      return done((V) => dayView(V, ymd, J.nowInTz(ctx.prefs.tz, now())));
    }
    if (st.k === 'rvnote') {
      const ymd = fromD8(st.date);
      await mutate(ctx.uid, ctx.prefs.tz, (c) => { const hit = J.ensureDay(c, ymd); if (!hit) return { abort: true }; const w = c.weeks[hit.wi]; w.rv = w.rv || { t: '', b: [] }; w.rv.t = text.slice(0, 1000); });
      return done((V) => reviewView(V, ymd));
    }
    if (st.k === 'bt') {
      if (a === 'start') {
        const dt = J.parseDateInput(text, J.nowInTz(ctx.prefs.tz, now()));
        if (!dt) return say(ctx, 'تاریخ رو به شکل 2026-01-05 یا 1404/10/15 بفرست.');
        st.start = d8(dt); delete st.await; await setState(ctx, st);
        return show(ctx, { text: 'از ' + lab({ cal: 'g' }, dt) + ' شروع می‌شه. چند هفته اضافه کنم؟ (یک عدد بین ۱ تا ۱۰۴ بفرست یا انتخاب کن)', kb: [[b('4', 'bt:n:4'), b('8', 'bt:n:8'), b('12', 'bt:n:12'), b('26', 'bt:n:26'), b('52', 'bt:n:52')], [b('تا امروز', 'bt:n:today')], [b('انصراف', 'x')]] });
      }
      if (a === 'n') {
        const v = Math.floor(num(text)); if (!(v >= 1 && v <= 104)) return say(ctx, 'عدد بین ۱ تا ۱۰۴ بفرست.');
        st.n = v; delete st.await; await setState(ctx, st);
        return show(ctx, btLenPanel(v, (await view(ctx.uid, ctx.prefs.tz)).c));
      }
    }
    if (st.k === 'lot') {
      const v = num(text); if (!(v > 0)) return say(ctx, 'یک عدد مثبت بفرست.');
      st[a] = v; delete st.await; await setState(ctx, st);
      const V = await view(ctx.uid, ctx.prefs.tz); ctx.msgId = st.msg || null;
      if (m && m.message_id) { try { await tg.del(ctx.chat, m.message_id); } catch (e) { /* ignore */ } }
      return show(ctx, lotView(V, st));
    }
    if (st.k === 'su') {
      const val = text.slice(0, st.t === 's' ? 24 : 40);
      await mutate(ctx.uid, ctx.prefs.tz, (c) => { const arr = st.t === 's' ? c.setups : c.rules; if (!arr.includes(val) && arr.length < 16) arr.push(val); });
      return done((V) => setupView(V));
    }
    if (st.k === 'acct') {
      const name = text.slice(0, 24);
      st.name = name; delete st.await; await setState(ctx, st);
      return show(ctx, { text: 'نوع حساب «' + esc(name) + '» چیه؟', kb: [[b('ریل', 'a:kind:live'), b('دمو', 'a:kind:demo')], [b('بکتست', 'a:kind:bt'), b('پراپ', 'a:kind:prop')], [b('انصراف', 'x')]] });
    }
    if (st.k === 'adr') {
      const ok = admin ? await admin.replyTicket(st.id, text) : false;
      await store.clearState(ctx.tgId);
      if (!ok) { await flash(ctx, 'ارسال پاسخ ممکن نشد.'); }
      return show(ctx, await adminTicket(st.id));
    }
    if (st.k === 'adbc') {
      const body = text.slice(0, 600);
      st.text = body; delete st.await; await setState(ctx, st);
      return show(ctx, { text: '<b>پیش‌نمایش پیام</b>\n' + esc(body) + '\n\nمخاطب: ' + ({ all: 'همه کاربران سایت', a7: 'فعال ۷ روز اخیر', tg: 'کاربران ربات', both: 'سایت و ربات' }[st.aud] || ''), kb: [[b('ارسال', 'ad:bcs'), b('انصراف', 'ad')]] });
    }
    if (st.k === 'cfg') {
      const v = num(text); if (!(v > 0)) return say(ctx, 'یک عدد مثبت بفرست.');
      await mutate(ctx.uid, ctx.prefs.tz, (c) => { c[st.f] = v; });
      return done((V) => settingsView(V, ctx.prefs));
    }
    await store.clearState(ctx.tgId);
  }

  async function showMenu(ctx) {
    const V = await view(ctx.uid, ctx.prefs.tz);
    await show(ctx, menuView(V, J.nowInTz(ctx.prefs.tz, now()), await isAdm(ctx)));
  }
  // مسیریابی دستورها به همان منطق دکمه‌ها
  async function nav(ctx, data) { return route(ctx, data, null); }

  async function onCallback(q) {
    const msg = q.message;
    if (!msg || !msg.chat || msg.chat.type !== 'private') { try { await tg.answer(q.id); } catch (e) { /* ignore */ } return; }
    const ctx = await mkctx(q.from, msg.chat.id, msg.message_id);
    let toast = '';
    try { toast = await route(ctx, q.data || '', q) || ''; }
    finally { try { await tg.answer(q.id, typeof toast === 'string' ? toast : ''); } catch (e) { /* ignore */ } }
  }

  async function route(ctx, data, q) {
    const p = data.split(':');
    const tz = ctx.prefs.tz, today = J.nowInTz(tz, now());
    const V = () => view(ctx.uid, tz);
    const cmd = p[0];
    if (cmd === 'noop') return;
    if (cmd === 'x') { await store.clearState(ctx.tgId); return showMenu(ctx); }
    if (cmd === 'm') { await store.clearState(ctx.tgId); return showMenu(ctx); }
    if (cmd === 'mo') { await show(ctx, moreView(await V())); return; }
    if (cmd === 'help') { await show(ctx, { text: HELP, kb: [[b('منو', 'm')]] }); return; }

    // روز
    if (cmd === 'd') { const ymd = (p[1] && fromD8(p[1])) || today; await show(ctx, dayView(await V(), ymd, today)); return; }
    if (cmd === 'b') { // شمارندهٔ سریع
      const ymd = fromD8(p[1]), k = p[2], dir = +p[3];
      let res = null;
      const out = await mutate(ctx.uid, tz, (c) => {
        const hit = dir > 0 ? J.ensureDay(c, ymd) : J.findDay(c, ymd);
        if (!hit) return { abort: true, why: 'none' };
        res = J.bumpDay(c, hit.wi, hit.di, k, dir, J.hm(J.nowInTz(tz, now())));
        if (!res.ok) return { abort: true, why: res.why };
        const d = c.weeks[hit.wi].d[hit.di];
        if (dir > 0 && d.t.length && d.t[d.t.length - 1].r === k.toUpperCase() && !d.t[d.t.length - 1].s) { const h = now().getUTCHours(); d.t[d.t.length - 1].s = h < 7 ? 'a' : h < 12 ? 'l' : h < 21 ? 'n' : ''; }
        return { ok: true };
      });
      await show(ctx, dayView(await V(), ymd, today));
      if (out && out.abort) return out.why === 'manual' ? 'نتیجهٔ این روز دستی ثبت شده' : out.why === 'none' ? 'چیزی برای کم کردن نیست' : '';
      return (dir > 0 ? '+' : '-') + ' ' + k.toUpperCase() + ' ثبت شد';
    }
    if (cmd === 'bd') { await askText(ctx, { k: 'dbal', date: p[1], await: 'text' }, 'بالانس پایان این روز رو به دلار بفرست (مثلاً 10250).\nبرای برگشتن به محاسبهٔ خودکار بنویس: خودکار'); return; }
    if (cmd === 'n') { await askText(ctx, { k: 'note', date: p[1], await: 'text' }, 'یادداشت این روز رو بفرست (دلیل ورود، احساس، درس امروز).'); return; }

    // هفته
    if (cmd === 'w') { const ymd = (p[1] && fromD8(p[1])) || today; await show(ctx, weekView(await V(), ymd, today)); return; }
    if (cmd === 'wk') {
      const ymd = fromD8(p[1]), n7 = p[2] === '7';
      await mutate(ctx.uid, tz, (c) => { const hit = J.findDay(c, ymd); if (!hit) return { abort: true }; const w = c.weeks[hit.wi]; if (n7) { J.addWeeksRange(c, ymd, 1, true); } else { if (w.d.slice(5).some((d) => d.tp || d.sl || d.be || d.t.length || d.note || (d.m && d.m !== 'a'))) return { abort: true, why: 'used' }; w.d = w.d.slice(0, 5); w.n = 5; } });
      await show(ctx, weekView(await V(), ymd, today)); return;
    }
    if (cmd === 'nw') {
      const n7 = p[1] === '7' ? true : p[1] === '5' ? false : null;
      let added = null;
      await mutate(ctx.uid, tz, (c) => { if (n7 !== null) c.wk7 = n7; const i = J.addNextWeek(c); added = J.dayToYmd(J.weekStartDay(c.weeks[i])); });
      const V2 = await V();
      const pnl = weekView(V2, added, today);
      pnl.text = 'هفتهٔ جدید ساخته شد.\n\n' + pnl.text;
      await show(ctx, pnl); return 'هفتهٔ جدید';
    }

    // آمار
    if (cmd === 's') { await show(ctx, statsView(await V(), p[1] || 'w', today)); return; }

    // مرور هفته
    if (cmd === 'r') { const ymd = (p[1] && fromD8(p[1])) || today; await show(ctx, reviewView(await V(), ymd)); return; }
    if (cmd === 'rv') {
      const ymd = fromD8(p[1]), i = +p[2];
      await mutate(ctx.uid, tz, (c) => { const hit = J.findDay(c, ymd); if (!hit) return { abort: true }; const w = c.weeks[hit.wi]; w.rv = w.rv || { t: '', b: [] }; const r = c.rules[i]; if (!r) return { abort: true }; const k = w.rv.b.indexOf(r); if (k >= 0) w.rv.b.splice(k, 1); else w.rv.b.push(r); });
      await show(ctx, reviewView(await V(), ymd)); return;
    }
    if (cmd === 'rn') { await askText(ctx, { k: 'rvnote', date: p[1], await: 'text' }, 'یادداشت مرور این هفته رو بفرست (چی خوب بود، چی باید عوض بشه).'); return; }

    // ثبت معامله
    if (cmd === 't') {
      if (p[1] === 'new') { await startWizard(ctx, await V(), p[2] || d8(today)); return; }
      const st = await store.getState(ctx.tgId);
      if (!st || st.k !== 'trade') { await show(ctx, note('این ثبت منقضی شده. از منو دوباره شروع کن.')); return; }
      const Vv = await V();
      st.msg = ctx.msgId;
      if (p[1] === 'r') { st.r = p[2]; if (st.r !== 'TP') st.rr = ''; }
      else if (p[1] === 'p') st.p = st.p === p[2] ? '' : p[2];
      else if (p[1] === 'rr') st.rr = num(p[2]);
      else if (p[1] === 'y') { const s = Vv.c.setups[+p[2]]; st.y = st.y === s ? '' : (s || ''); }
      else if (p[1] === 'ask') {
        const pr = { p: 'نماد رو بفرست (مثلاً USDJPY).', rr: 'RR رو بفرست (مثلاً 2.5).', y: 'اسم استراتژی یا ستاپ رو بفرست (مثلاً ORB).', g: 'برچسب رفتاری رو بفرست (تا ۲۰ حرف؛ مثلاً FOMO).', f: 'کارمزد معامله رو به دلار بفرست.', z: 'اندازهٔ لات رو بفرست (مثلاً 0.25).', h: 'ساعت معامله رو بفرست (مثلاً 14:30).', bal: 'بالانس پایان این روز رو به دلار بفرست (مثلاً 10250). با ذخیرهٔ معامله، نتیجهٔ این روز از روی همین بالانس حساب می‌شه.' }[p[2]];
        st.await = p[2]; await setState(ctx, st);
        await show(ctx, { text: pr, kb: [[b('بازگشت به ثبت', 't:back')]] }); return;
      }
      else if (p[1] === 'back') { delete st.await; }
      else if (p[1] === 'save') {
        if (!st.r) return 'اول نتیجه رو انتخاب کن';
        const ok = await saveWizard(ctx, st);
        if (!ok) { await show(ctx, note('ذخیره نشد.')); return; }
        const ymd = fromD8(st.date), V2 = await V(), pn = dayView(V2, ymd, today);
        pn.text = 'معامله ذخیره شد.\n\n' + pn.text;
        await show(ctx, pn); return 'ذخیره شد';
      }
      await setState(ctx, st);
      await show(ctx, wizView(Vv, st)); return;
    }
    if (cmd === 'ph') {
      const st = await store.getState(ctx.tgId);
      if (!st || st.k !== 'photo') return 'منقضی شد';
      let ok = false;
      await mutate(ctx.uid, tz, (c) => { const hit = J.findDay(c, today); if (!hit) return { abort: true }; const d = c.weeks[hit.wi].d[hit.di]; if (!d.t.length) return { abort: true }; d.t[d.t.length - 1].i = st.i; J.touchDay(c, hit.wi, hit.di); ok = true; });
      await store.clearState(ctx.tgId);
      await show(ctx, ok ? dayView(await V(), today, today) : note('امروز معامله‌ای با جزئیات نداری که عکس بهش وصل بشه. اول معامله ثبت کن.'));
      return ok ? 'عکس وصل شد' : '';
    }

    // بکتست
    if (cmd === 'bt') {
      if (!p[1]) {
        const Vv = await V();
        await show(ctx, { text: '<b>بکتست</b>\nچند هفتهٔ پشت‌سرهم رو با یک تاریخ شروع می‌سازم تا نتیجه‌های گذشته رو ثبت کنی.\nحساب فعال: <b>' + esc(Vv.acct.name) + '</b> (' + (KINDS[Vv.acct.kind] || '') + ')\n\nپیشنهاد: برای بکتست یک حساب جدا از نوع «بکتست» بساز تا آمار حساب اصلی خراب نشه.', kb: [[b('ادامه روی همین حساب', 'bt:s')], [b('ساخت حساب بکتست جدید', 'a:new:bt')], [b('منو', 'm')]] }); return;
      }
      if (p[1] === 's') { await askText(ctx, { k: 'bt', await: 'start' }, 'تاریخ شروع بکتست رو بفرست.\nمثال: 2026-01-05 یا 1404/10/15'); return; }
      const st = await store.getState(ctx.tgId); if (!st || st.k !== 'bt') return 'منقضی شد';
      if (p[1] === 'n') {
        if (p[2] === 'today') { const s = fromD8(st.start); st.n = Math.max(1, Math.min(104, Math.ceil((J.ymdToDay(today.y, today.m, today.d) - J.ymdToDay(s.y, s.m, s.d)) / 7) + 1)); }
        else st.n = +p[2];
        await setState(ctx, st);
        await show(ctx, btLenPanel(st.n, (await V()).c)); return;
      }
      if (p[1] === 'go') {
        const s = fromD8(st.start); let added = 0;
        await mutate(ctx.uid, tz, (c) => { added = J.addWeeksRange(c, s, st.n, p[2] === '7'); });
        await store.clearState(ctx.tgId);
        const pn = weekView(await V(), s, today);
        pn.text = added + ' هفتهٔ جدید اضافه شد (هفته‌های تکراری ساخته نشدن).\nحالا روزها رو باز کن و معامله‌ها رو ثبت کن.\n\n' + pn.text;
        await show(ctx, pn); return;
      }
    }

    // لات
    if (cmd === 'lot') { await store.setState(ctx.tgId, { k: 'lot', chat: ctx.chat }); const st = await store.getState(ctx.tgId); st.msg = ctx.msgId; await setState(ctx, st); await show(ctx, lotView(await V(), st)); return; }
    if (cmd === 'l') {
      let st = await store.getState(ctx.tgId); if (!st || st.k !== 'lot') st = { k: 'lot', chat: ctx.chat };
      st.msg = ctx.msgId;
      if (p[1] === 'p') { st.pre = p[2]; delete st.sl; }
      else if (p[1] === 'reset') { st = { k: 'lot', chat: ctx.chat, msg: ctx.msgId }; }
      else if (p[1] === 'ask') {
        const pr = { sl: 'فاصلهٔ حد ضرر رو بفرست (به واحد نمایش‌داده‌شده).', risk: 'درصد ریسک رو بفرست (مثلاً 1).', bal: 'بالانس رو به دلار بفرست.', rate: 'قیمت فعلی جفت‌ارز رو بفرست (مثلاً 150.25).' }[p[2]];
        st.await = p[2]; await setState(ctx, st); await show(ctx, { text: pr, kb: [[b('بازگشت', 'l:back')]] }); return;
      } else if (p[1] === 'back') delete st.await;
      await setState(ctx, st);
      await show(ctx, lotView(await V(), st)); return;
    }

    // حساب‌ها
    if (cmd === 'ac') { await show(ctx, acctView(await V())); return; }
    if (cmd === 'a') {
      if (p[1] === 'go') {
        await mutate(ctx.uid, tz, (c, doc) => { if (!doc.list.some((x) => x.id === p[2])) return { abort: true }; doc.act = p[2]; doc.actAt = Date.now(); });
        await show(ctx, acctView(await V())); return 'حساب عوض شد';
      }
      if (p[1] === 'new') { await askText(ctx, { k: 'acct', kind: p[2] || '', await: 'name' }, 'اسم حساب جدید رو بفرست (مثلاً بکتست طلا).'); return; }
      if (p[1] === 'kind') {
        const st = await store.getState(ctx.tgId); if (!st || st.k !== 'acct') return 'منقضی شد';
        st.kind = p[2]; await setState(ctx, st);
        await show(ctx, marketView(true, 'fx', 'a:mk:')); return;
      }
      if (p[1] === 'mk') {
        const st = await store.getState(ctx.tgId); if (!st || st.k !== 'acct' || !st.kind) return 'منقضی شد';
        const mk = p[2] === 'cr' ? 'cr' : 'fx';
        await mutate(ctx.uid, tz, (c, doc) => {
          if (doc.list.length >= 12) return { abort: true };
          const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
          const j = J.defaultJournal(today, mk);
          ['risk', 'tpPct', 'target', 'dd', 'ddType', 'ddDay', 'mode', 'cal', 'balance', 'wk7'].forEach((k) => { j[k] = c[k]; });
          j.meta.mkAsked = true;
          doc.list.push({ id, name: st.name, color: COLORS[doc.list.length % COLORS.length], kind: st.kind });
          doc.j[id] = j;
          doc.act = id; doc.actAt = Date.now();
        });
        await store.clearState(ctx.tgId);
        await show(ctx, acctView(await V())); return 'حساب ساخته شد';
      }
    }

    // CSV
    if (cmd === 'csv') {
      if (!p[1]) { await show(ctx, { text: '<b>خروجی CSV</b>\nکدوم رو بفرستم؟', kb: [[b('حساب فعال', 'csv:one'), b('همهٔ حساب‌ها', 'csv:all')], [b('منو', 'm')]] }); return; }
      const Vv = await V();
      let text;
      if (p[1] === 'one') text = J.csvText(Vv.c, Vv.acct.name);
      else {
        const parts = Vv.doc.list.map((x) => J.csvText(J.normalizeJournal(Vv.doc.j[x.id]), x.name));
        text = parts[0] + parts.slice(1).map((t) => '\r\n' + t.replace(/^﻿[^\r\n]*\r\n?/, '')).join('');
      }
      const iso = J.isoOf(today);
      await tg.sendDoc(ctx.chat, 'Surpri3eFX-journal-' + iso + '.csv', Buffer.from(text, 'utf8'), 'خروجی ژورنال');
      ctx.fresh = true;
      await show(ctx, menuView(await V(), today, await isAdm(ctx)));
      return 'فایل ارسال شد';
    }

    // ستاپ و قوانین
    if (cmd === 'su') {
      if (!p[1]) { await show(ctx, setupView(await V())); return; }
      if (p[1] === 'add') { await askText(ctx, { k: 'su', t: p[2], await: 'text' }, p[2] === 's' ? 'اسم استراتژی یا ستاپ رو بفرست (مثلاً ORB یا Order Block).' : 'قانون رو بنویس (مثلاً: بدون ستاپ وارد نمی‌شم).'); return; }
      if (p[1] === 'del') { await mutate(ctx.uid, tz, (c) => { const arr = p[2] === 's' ? c.setups : c.rules; arr.splice(+p[3], 1); }); await show(ctx, setupView(await V())); return; }
    }

    // تنظیمات
    if (cmd === 'st') {
      if (!p[1]) { await show(ctx, settingsView(await V(), ctx.prefs)); return; }
      if (p[1] === 'cal') await mutate(ctx.uid, tz, (c) => { c.cal = c.cal === 'j' ? 'g' : 'j'; });
      else if (p[1] === 'tz') { const z = TZS[p[2]]; if (z) { await store.setPrefs(ctx.tgId, { tz: z[0] }); ctx.prefs.tz = z[0]; } }
      else if (p[1] === 'ask') { await askText(ctx, { k: 'cfg', f: p[2], await: 'text' }, { risk: 'درصد ریسک هر معامله رو بفرست (مثلاً 1).', tpPct: 'درصد سود هر TP رو بفرست (مثلاً 2).', balance: 'بالانس اولیه رو به دلار بفرست.' }[p[2]] || 'عدد رو بفرست.'); return; }
      await show(ctx, settingsView(await V(), ctx.prefs)); return;
    }


    // نوع بازار
    if (cmd === 'mk') {
      if (!p[1]) { const Vv = await V(); await show(ctx, marketView(false, Vv.c.mk)); return; }
      const mk = p[1] === 'cr' ? 'cr' : 'fx';
      await mutate(ctx.uid, tz, (c) => { J.setMarket(c, mk); c.meta.mkAsked = true; });
      await store.clearState(ctx.tgId);
      await showMenu(ctx); return mk === 'cr' ? 'بازار: کریپتو (شنبه تا جمعه)' : 'بازار: فارکس (دوشنبه تا جمعه)';
    }

    // نرخ ارز و طلا / ارز دیجیتال: عکس + متن قیمت‌ها زیرش
    if (cmd === 'rt') {
      const sub = p[1] || 'f';
      const view = sub === 'c' || sub === 'rc' || sub === 'k' ? 'c' : 'f';
      const refresh = sub === 'r' || sub === 'rf' || sub === 'rc' || (sub === 'k' && p[3] === 'r');
      let d = null;
      try { d = rates ? await rates.get({ force: refresh }) : null; } catch (e) { d = null; }
      if (!d || !hasAnyRates(d)) { await show(ctx, { text: '<b>نرخ ارز و طلا</b>\nالان به منبع قیمت‌ها وصل نشدم؛ چند دقیقه بعد دوباره امتحان کن.', kb: [[b('تلاش دوباره', 'rt:rf'), b('منو', 'm')]], plain: true }); return; }
      if (sub === 'k') {
        const coin = cryptoRows(d).find((r) => r.sym === String(p[2] || '').toUpperCase());
        const back = [[b('تاپ ۱۰ ارز دیجیتال', 'rt:c'), b('ارز و طلا', 'rt:f')], [bs('بروزرسانی', 'rt:k:' + String(p[2] || '') + ':r', 'primary'), b('منو', 'm')]];
        if (!coin) { await show(ctx, { text: 'این ارز توی لیست نیست.', kb: [[b('تاپ ۱۰ ارز دیجیتال', 'rt:c'), b('منو', 'm')]] }); return; }
        await show(ctx, { text: coinText(coin, d, tz), kb: back }); return;
      }
      const sections = view === 'c' ? ['crypto'] : ['fiat', 'gold'];
      const only = view === 'c' ? 'crypto' : 'fx';
      let kb;
      if (view === 'c') {
        const coins = cryptoRows(d).slice(0, 10).map((r) => b(r.sym, 'rt:k:' + r.sym));
        kb = [coins.slice(0, 5), coins.slice(5, 10), [b('ارز و طلا', 'rt:f')], [bs('بروزرسانی', 'rt:rc', 'primary'), b('منو', 'm')]].filter((r) => r.length);
      } else {
        kb = [[b('ارز دیجیتال (تاپ ۱۰)', 'rt:c')], [bs('بروزرسانی', 'rt:rf', 'primary'), b('منو', 'm')]];
      }
      const cap = composeRates(d, sections, tz, 950);
      const text = cap.caption;
      let buf = null;
      try { buf = render && render.rates ? await render.rates({ data: d, tz, only }) : null; } catch (e) { buf = null; }
      if (buf) { try { await show(ctx, { photo: buf, text, kb }); return; } catch (e) { console.error('rates photo failed:', e && e.message); } }
      await show(ctx, { text: ratesText(d, tz, sections), kb, plain: true });
      return;
    }

    // اخبار و سشن: فقط تصویر
    if (cmd === 'nx') {
      const nowMs = now().getTime();
      if (!p[1]) { await show(ctx, await hubView(ctx, 'M')); return; }
      if (p[1] === 'h') { await show(ctx, await hubView(ctx, ['H', 'M', 'L'].includes(p[2]) ? p[2] : 'M')); return; }
      const tryPhoto = async (maker, kb, textFallback) => {
        let buf = null;
        try { buf = maker ? await maker() : null; } catch (e) { buf = null; }
        if (buf) {
          try { await show(ctx, { photo: buf, text: '', kb }); return; } catch (e) { console.error('photo send failed:', e && e.message); }
        }
        await show(ctx, { text: textFallback(), kb, plain: true });
      };
      if (p[1] === 's') {
        await tryPhoto(render && render.sessions ? () => render.sessions({ tz, nowMs }) : null,
          [[b('اخبار امروز', 'nx:i:d0:M'), b('اخبار هفته', 'nx:i:w:M')], [b('منو', 'm')]],
          () => sessionsText(tz, nowMs));
        return;
      }
      if (p[1] === 'i') {
        const mode = ['d0', 'd1', 'w', 'nw'].includes(p[2]) ? p[2] : 'd0', f = ['H', 'M', 'L'].includes(p[3]) ? p[3] : 'M';
        const ev = await newsEvents();
        if (!ev.length) return 'هنوز داده‌ای از تقویم اخبار ندارم؛ چند دقیقه بعد دوباره امتحان کن';
        await tryPhoto(render && render.news ? () => render.news({ events: ev, tz, mode, impact: f, nowMs }) : null, nxImgKb(mode, f), () => newsText(ev, tz, mode, f, nowMs));
        return;
      }
    }

    // دستیار هوش مصنوعی (پیوی)
    if (cmd === 'ai') {
      if (!p[1]) { await aiEnter(ctx, false); return; }
      if (p[1] === 'n') { await aiEnter(ctx, true); return 'گفتگوی تازه'; }
      if (p[1] === 'j') {
        const st0 = AI.status();
        if (!st0.on.private) { await aiEnter(ctx, false); return; }
        const Vj = await V();
        if (!Vj.a || !((Vj.a.tp || 0) + (Vj.a.sl || 0) + (Vj.a.be || 0))) { await flash(ctx, 'هنوز معامله‌ای ثبت نکردی که تحلیل کنم.'); return; }
        aiHist.delete(ctx.tgId);
        const sum = JSON.stringify(journalSummaryBot(Vj));
        await aiTurn(ctx, null, 'آمار ژورنال من رو تحلیل کن: نقطه‌قوت‌ها، نقطه‌ضعف‌ها و دو کار مشخص برای هفتهٔ بعد.', 'خلاصهٔ ژورنال کاربر (JSON): ' + sum.slice(0, 3500) + '\nفقط بر پایهٔ همین اعداد نظر بده و چیزی از خودت نساز.');
        return;
      }
    }

    // ادمین
    if (cmd === 'ad') {
      if (!(await isAdm(ctx))) { await show(ctx, note('دسترسی نداری.')); return; }
      if (!admin) { await show(ctx, note('بخش ادمین روی این سرور فعال نیست.')); return; }
      const sub = p[1];
      if (!sub) { await show(ctx, await adminHome()); return; }
      if (sub === 'img') {
        const inf = render && render.info ? await render.info() : { name: null, error: 'موتور تصویر به ربات وصل نیست' };
        let buf = null, err = '';
        try { buf = render && render.sessions ? await render.sessions({ tz, nowMs: now().getTime() }) : null; } catch (e) { err = String(e && e.message || e); }
        if (buf) { try { await show(ctx, { photo: buf, text: '', kb: [[b('بخش ادمین', 'ad')]] }); return 'موتور: ' + inf.name; } catch (e) { err = 'ارسال عکس: ' + String(e && e.message || e); } }
        await show(ctx, { text: '<b>ساخت عکس کار نمی‌کند</b>\nموتور: <code>' + esc(inf.name || 'هیچ‌کدام') + '</code>\nفونت‌ها: <code>' + (inf.fonts == null ? '?' : inf.fonts) + '</code>\n' + (inf.error || err ? '<blockquote>' + esc(inf.error || err) + '</blockquote>' : ''), kb: [[b('بخش ادمین', 'ad')]], plain: true });
        return;
      }
      if (sub === 'out') { await store.setAdmin(ctx.tgId, false); await showMenu(ctx); return 'از حالت ادمین بیرون اومدی'; }
      if (sub === 'u') { await show(ctx, await adminUsers(p[2] === 'a24' ? 'a24' : 'all', Math.max(0, +p[3] || 0))); return; }
      if (sub === 't') {
        if (!p[2] || p[2] === 'all') { await show(ctx, await adminTickets(p[2] === 'all')); return; }
        await show(ctx, await adminTicket(+p[2])); return;
      }
      if (sub === 'tr') { await askText(ctx, { k: 'adr', id: +p[2], await: 'text' }, 'پاسخ تیکت #' + p[2] + ' رو بفرست (تا ۱۵۰۰ حرف). کاربر توی زنگ سایت خبردار می‌شه.', [[b('انصراف', 'ad:t')]]); return; }
      if (sub === 'ts') { await admin.setTicketStatus(+p[2], p[3]); await show(ctx, await adminTicket(+p[2])); return 'وضعیت عوض شد'; }
      if (sub === 'g') { await show(ctx, await adminPosts(p[2] === 'all')); return; }
      if (sub === 'gh') { await admin.hidePost(+p[2], p[3] === '1'); await show(ctx, await adminPosts(false)); return 'انجام شد'; }
      if (sub === 'gd') { await admin.deletePost(+p[2]); await show(ctx, await adminPosts(false)); return 'پست حذف شد'; }
      if (sub === 'gb') { const ok = await admin.ban(p[2], p[3] === '1'); await show(ctx, await adminPosts(false)); return ok ? (p[3] === '1' ? 'کاربر بن شد' : 'بن برداشته شد') : 'کاربر پیدا نشد'; }
      if (sub === 'bc') {
        if (!p[2]) { await show(ctx, { text: '<b>پیام همگانی</b>\nبه کی بفرستم؟', kb: [[b('همه کاربران سایت', 'ad:bc:all'), b('فعال ۷ روز اخیر', 'ad:bc:a7')], [b('همه کاربران ربات (تلگرام)', 'ad:bc:tg')], [b('سایت و تلگرام', 'ad:bc:both')], [b('بخش ادمین', 'ad')]] }); return; }
        await askText(ctx, { k: 'adbc', aud: p[2], await: 'text' }, 'متن پیام رو بفرست (حداکثر ۶۰۰ حرف).', [[b('انصراف', 'ad')]]); return;
      }
      if (sub === 'bcs') {
        const st = await store.getState(ctx.tgId); if (!st || st.k !== 'adbc' || !st.text) return 'منقضی شد';
        let site = null, tgSent = 0, tgFail = 0;
        if (st.aud === 'all' || st.aud === 'both') site = await admin.broadcastSite('all', '', st.text);
        else if (st.aud === 'a7') site = await admin.broadcastSite('active7', '', st.text);
        if (st.aud === 'tg' || st.aud === 'both') {
          const ids = admin.tgIds ? await admin.tgIds() : [];
          for (const id of ids) { try { await tg.send(id, esc(st.text)); tgSent++; } catch (e) { tgFail++; } await new Promise((r) => setTimeout(r, 40)); }
        }
        await store.clearState(ctx.tgId);
        await show(ctx, { text: '<b>پیام فرستاده شد</b>\n' + (site ? 'سایت: ' + (site.ok ? site.recipients + ' نفر' : 'گیرنده‌ای نبود') + '\n' : '') + (st.aud === 'tg' || st.aud === 'both' ? 'تلگرام: ' + tgSent + ' موفق، ' + tgFail + ' ناموفق' : ''), kb: [[b('بخش ادمین', 'ad')]] });
        return;
      }
      if (sub === 'nr') { const ns = await admin.newsRefresh(); await show(ctx, await adminHome()); return ns && ns.lastError ? 'بروزرسانی انجام نشد' : 'اخبار بروز شد'; }
      if (sub === 'ai') { await store.clearState(ctx.tgId); await show(ctx, adminAiView()); return; }
      if (sub === 'ait') {
        const c0 = AI.cfg();
        if (p[2] === 'trig') await AI.set({ groupTrigger: c0.groupTrigger === 'mention' ? 'cmd' : 'mention' });
        else if (['site', 'private', 'group'].includes(p[2])) await AI.set({ [p[2]]: !c0[p[2]] });
        await show(ctx, adminAiView()); return 'انجام شد';
      }
      if (sub === 'ain') {
        const f = p[2], c0 = AI.cfg();
        if (!AI_STEP[f]) return;
        const step = AI_STEP[f][0], cur = +c0[f] || 0;
        const nv = Math.max(f === 'groupCooldown' ? 0 : 1, p[3] === '+' ? cur + step : cur - step);
        await AI.set({ [f]: nv });
        await show(ctx, adminAiView()); return;
      }
      if (sub === 'aik') { await askText(ctx, { k: 'adaik', await: 'text' }, '<b>کلید Gemini</b>\nکلید رو همین‌جا بفرست. پیامت فوراً پاک می‌شه، کلید چک می‌شه و خودکار روی سرور و Render ست می‌شه.\nکلید رو جای دیگه (مثل گیت‌هاب) نذار.', [[b('انصراف', 'ad:ai')]]); return; }
      if (sub === 'aitest') {
        const st0 = AI.status();
        if (!st0.key) { await flash(ctx, 'کلید هنوز تنظیم نشده.'); return; }
        const pr = await AI.ping();
        await show(ctx, { text: '<b>تست اتصال</b>\nمدل: <code>' + esc(st0.model) + '</code>\n' + (pr.ok ? 'جواب داد (' + pr.ms + ' میلی‌ثانیه).' : 'نشد: ' + esc(pr.code || '') + (pr.status ? ' (' + pr.status + ')' : '') + '\nکلید، مدل یا سهمیهٔ گوگل رو چک کن.'), kb: [[b('هوش مصنوعی', 'ad:ai')]] });
        return;
      }
      if (sub === 'aim') { await askText(ctx, { k: 'adaim', await: 'text' }, '<b>اسم مدل</b>\nمثلاً <code>gemini-2.5-flash</code> رو بفرست. برای برگشتن به پیش‌فرض، بنویس: default', [[b('انصراف', 'ad:ai')]]); return; }
      if (sub === 'aikd') {
        if (p[2] !== 'y') { await show(ctx, { text: '<b>حذف کلید</b>\nهوش مصنوعی همه‌جا (سایت، ربات و گروه‌ها) خاموش می‌شه تا کلید جدید بفرستی. مطمئنی؟', kb: [[bs('بله، حذف کن', 'ad:aikd:y', 'danger'), b('انصراف', 'ad:ai')]] }); return; }
        const r = await ENV.set('GEMINI_API_KEY', '');
        await show(ctx, adminAiView()); return r.persisted ? 'کلید از Render هم پاک شد' : 'کلید حذف شد (از Render دستی پاک کن)';
      }
      if (sub === 'gr') {
        const id = p[2];
        if (!id) { await show(ctx, await adminGroupsView()); return; }
        await show(ctx, await adminGroupView(id)); return;
      }
      if (sub === 'grt') {
        if (!groups) return;
        const id = p[2], what = p[3], g = await groups.get(id);
        if (!g) { await show(ctx, await adminGroupsView()); return 'گروه پیدا نشد'; }
        if (what === 'en') await groups.update(id, { enabled: !g.enabled });
        else if (what === 'ai') await groups.update(id, { ai: !g.ai });
        else if (what === 'dp') await groups.update(id, { delPrev: !g.delPrev });
        else if (what === 'mode') await groups.update(id, { mode: g.mode === 'off' ? 'every' : g.mode === 'every' ? 'daily' : 'off' });
        else if (what === 'ivu' || what === 'ivd') { const i = Math.max(0, IVS.findIndex((x) => x >= g.interval)); const ni = what === 'ivu' ? Math.min(IVS.length - 1, i + 1) : Math.max(0, i - 1); await groups.update(id, { interval: IVS[ni] }); }
        else if (what === 's') { const k = p[4], cur = g.sections.slice(), has = cur.includes(k); const nx = has ? cur.filter((x) => x !== k) : cur.concat(k); if (!nx.length) { await flash(ctx, 'حداقل یک بخش باید روشن بمونه.'); return; } await groups.update(id, { sections: nx }); }
        else if (what === 'cd') { const opts = [0, 10, 30, 60, 120, 300]; const i = opts.indexOf(g.cooldown); await groups.update(id, { cooldown: opts[(i + 1) % opts.length] }); }
        await show(ctx, await adminGroupView(id)); return;
      }
      if (sub === 'grtm') { await askText(ctx, { k: 'adgtm', id: p[2], await: 'text' }, '<b>ساعت ارسال خودکار</b>\nساعت‌ها به وقت تهران، با کاما جدا، مثل: <code>09:00, 13:30, 20:00</code>', [[b('انصراف', 'ad:gr:' + p[2])]]); return; }
      if (sub === 'grs') {
        if (!groups) return;
        try { const n = await groups.sendNow(p[2]); return 'فرستاده شد (' + n + ' پیام)'; }
        catch (e) { return 'نشد: ' + String((e && e.message) || e).slice(0, 80); }
      }
      if (sub === 'grx') {
        if (p[3] !== 'y') { await show(ctx, { text: '<b>خروج از گروه</b>\nربات از این گروه بیرون می‌ره و تنظیماتش پاک می‌شه. مطمئنی؟', kb: [[bs('بله، خارج شو', 'ad:grx:' + p[2] + ':y', 'danger'), b('انصراف', 'ad:gr:' + p[2])]] }); return; }
        try { await tg.leave(p[2]); } catch (e) { /* ignore */ }
        if (groups) await groups.remove(p[2]);
        await show(ctx, await adminGroupsView()); return 'ربات خارج شد';
      }
      if (sub === 'ni') { await setState(ctx, { k: 'adni', chat: ctx.chat }); await show(ctx, { text: '<b>ایمپورت فید اخبار</b>\nفایل JSON فید فارکس‌فکتوری (ff_calendar_thisweek.json) رو همین‌جا به‌صورت فایل بفرست.', kb: [[b('انصراف', 'ad')]] }); return; }
    }
    await showMenu(ctx);
  }

  return { handleUpdate, _internals: { parseQuick, dayView, weekView, statsView, reviewView, lotView } };
}
