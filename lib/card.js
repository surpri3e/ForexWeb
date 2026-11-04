// کارت نتیجهٔ ژورنال: از سند ژورنال (همون داده‌ای که سایت و ربات استفاده می‌کنن) آمار یک بازه رو می‌سازه.
import * as J from './journal.js';

export const PERIODS = { d: 'امروز', w: 'این هفته', m: 'این ماه', y: 'امسال', a: 'کل' };
export function periodOf(text) {
  const t = String(text || '');
  if (/امروز/.test(t)) return 'd';
  if (/ماه/.test(t)) return 'm';
  if (/امسال|سال/.test(t)) return 'y';
  if (/کل|همه/.test(t)) return 'a';
  return 'w';
}
export function statsFor(doc, per, tz, nowDate = new Date()) {
  if (!doc || !doc.list || !doc.list.length) return null;
  const today = J.nowInTz(tz, nowDate);
  const aid = doc.list.some((x) => x.id === doc.act) ? doc.act : doc.list[0].id;
  const c = J.normalizeJournal(doc.j[aid], today), a = J.compute(c);
  const days = J.periodDays(c, a, per, today), g = J.aggregate(c, a, days);
  const acct = doc.list.find((x) => x.id === aid) || doc.list[0];
  const has = !!(g.count || (g.traded && g.traded.length));
  const netp = g.start > 0 ? g.net / g.start * 100 : 0;
  return {
    hasData: has, net: g.net || 0, count: g.count || 0, acct: acct && acct.name || '',
    title: 'نتیجه ' + PERIODS[per], sub: acct && acct.name || '',
    pct: J.pct(netp, 2), money: J.money(g.net || 0, 1),
    wr: g.tp + g.sl ? Math.round(g.wr * 100) + '%' : '—', pf: g.gl > 0 ? g.pf.toFixed(2) : (g.gp > 0 ? '∞' : '—'),
    tsb: g.tp + ' / ' + g.sl + ' / ' + g.be, dd: g.dd ? g.dd.toFixed(1) + '%' : '0%', rr: g.avgRR ? '1:' + g.avgRR.toFixed(1) : '—'
  };
}
export function cardText(o) {
  if (!o) return 'هنوز ژورنالی ندارم. توی پیوی ربات یا سایت چند معامله ثبت کن تا کارتت ساخته بشه.';
  if (!o.hasData) return '<b>' + o.title + '</b>\nبرای این بازه هنوز معامله‌ای ثبت نشده.';
  return '<b>📊 ' + o.title + '</b>\nسود خالص: <b>' + o.pct + '</b> (' + o.money + ')\nمعامله: <b>' + o.count + '</b>   TP/SL/BE: <b>' + o.tsb + '</b>\nوین‌ریت: <b>' + o.wr + '</b>   پرافیت فکتور: <b>' + o.pf + '</b>\nدراودان: <b>' + o.dd + '</b>   RR: <b>' + o.rr + '</b>';
}

// END-OF-FILE lib/card.js
