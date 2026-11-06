// تحلیل استیتمنت: پاک‌سازی خروجی هوش مصنوعی (خواندن عکس هیستوری متاتریدر) و محاسبهٔ آمار حساب.
// هیچ وابستگی بیرونی نداره تا هم سرور و هم تست‌ها ازش استفاده کنن.

export const STATEMENT_SYSTEM = `تو یک ابزار خواندن (OCR) برای اسکرین‌شات «تاریخچهٔ معاملات» متاتریدر ۴ و ۵ و پلتفرم‌های مشابه هستی.
فقط و فقط یک JSON معتبر برگردان، بدون هیچ متن، توضیح یا بلاک کد. ساختار:
{"platform":"mt4|mt5|other","currency":"USD","balance":عدد یا null,"equity":عدد یا null,
"rows":[{"ticket":"رشته یا null","symbol":"EURUSD","type":"buy|sell|deposit|withdrawal","lots":عدد یا null,"open":"YYYY-MM-DD HH:MM یا null","close":"YYYY-MM-DD HH:MM یا null","profit":عدد,"commission":عدد,"swap":عدد}]}
قوانین:
- هر ردیفِ معاملهٔ بسته‌شده یک آیتم. سفارش‌های باز، پندینگ و لغوشده را نیاور.
- سود/زیان با علامت: عدد قرمز یا داخل پرانتز یا با منفی = منفی. جداکنندهٔ هزارگان (فاصله یا ویرگول) را حذف کن و اعشار را با نقطه بنویس.
- تاریخ‌ها را به YYYY-MM-DD HH:MM تبدیل کن (مثلاً 2026.11.03 14:22:10 ← 2026-11-03 14:22). اگر سال دیده نمی‌شود یا خوانا نیست null بگذار.
- اگر کمیسیون یا سواپ دیده نمی‌شود 0 بگذار. اگر چیزی خوانا نیست حدس نزن: null (یا برای profit همان ردیف را نیاور).
- واریز و برداشت (deposit/withdrawal/balance) را با type مناسب و profit با علامت بیاور.
- balance/equity فقط اگر در عکس دیده می‌شود، وگرنه null.
- ترتیب ردیف‌ها همان ترتیب عکس باشد. هیچ ردیفی را تکرار یا اختراع نکن.`;

const num = (v, lim = 1e9) => {
  if (v == null || v === '') return null;
  let n;
  if (typeof v === 'number') n = v;
  else {
    const paren = /^\s*\(.*\)\s*$/.test(String(v));
    let t = String(v).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 1776).replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 1632).replace(/[\s\u00a0\u202f]/g, '').replace(/[()]/g, '').replace('\u2212', '-').replace(/\u066b/g, '.').replace(/\u066c/g, ',');
    const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) t = lc > ld ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''); // آخرین جداکننده اعشار است
    else if (lc >= 0) t = /,\d{1,2}$/.test(t) && t.indexOf(',') === lc ? t.replace(',', '.') : t.replace(/,/g, '');
    n = parseFloat(t);
    if (paren && n > 0) n = -n; // (40.00) یعنی منفی
  }
  return Number.isFinite(n) && Math.abs(n) <= lim ? n : null;
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const p2 = (n) => String(n).padStart(2, '0');

export function normDate(s) {
  if (s == null) return '';
  const t = String(s).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 1776).replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 1632).trim();
  const m = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T,]+(\d{1,2}):(\d{2}))?/.exec(t);
  if (!m) return '';
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCMonth() !== mo - 1) return '';
  const hh = m[4] != null ? +m[4] : null, mm = m[5] != null ? +m[5] : null;
  return y + '-' + p2(mo) + '-' + p2(d) + (hh != null && hh < 24 && mm < 60 ? ' ' + p2(hh) + ':' + p2(mm) : '');
}

// متن/JSON خام مدل -> { rows, account }
export function parseModelJson(text) {
  let s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let j; try { j = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  return sanitize(j);
}

export function sanitize(j) {
  const rows = [];
  for (const x of (j && Array.isArray(j.rows) ? j.rows : []).slice(0, 400)) {
    if (!x || typeof x !== 'object') continue;
    let type = String(x.type || '').toLowerCase();
    if (type === 'balance' || type === 'credit') type = Number(x.profit) < 0 ? 'withdrawal' : 'deposit';
    if (!['buy', 'sell', 'deposit', 'withdrawal'].includes(type)) continue;
    const profit = num(x.profit); if (profit == null) continue;
    rows.push({
      ticket: x.ticket == null ? '' : String(x.ticket).replace(/[^\w#-]/g, '').slice(0, 20),
      symbol: String(x.symbol || '').toUpperCase().replace(/[^A-Z0-9._#-]/g, '').slice(0, 14),
      type, lots: type === 'buy' || type === 'sell' ? (num(x.lots, 1e4) == null ? null : Math.abs(num(x.lots, 1e4))) : null,
      open: normDate(x.open), close: normDate(x.close), profit: r2(profit),
      comm: r2(num(x.commission != null ? x.commission : x.comm, 1e7) || 0), swap: r2(num(x.swap, 1e7) || 0),
    });
  }
  const acc = { platform: ['mt4', 'mt5'].includes(String(j && j.platform).toLowerCase()) ? String(j.platform).toLowerCase() : 'other', currency: String((j && j.currency) || 'USD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'USD', balance: num(j && j.balance), equity: num(j && j.equity) };
  return { rows, account: acc };
}

export function dedupe(rows) {
  const seen = new Set(), out = [];
  for (const r of rows) {
    const k = r.ticket ? 't' + r.ticket : [r.symbol, r.type, r.lots, r.open, r.close, r.profit].join('|');
    if (seen.has(k)) continue; seen.add(k); out.push(r);
  }
  return out;
}

const when = (r) => r.close || r.open || '';
export function analyze(inRows, opts = {}) {
  const rows = dedupe((inRows || []).filter((r) => r && typeof r === 'object').map((r) => ({
    ticket: String(r.ticket || ''), symbol: String(r.symbol || '').toUpperCase(), type: r.type, lots: r.lots == null ? null : +r.lots,
    open: normDate(r.open), close: normDate(r.close), profit: +r.profit || 0, comm: +r.comm || 0, swap: +r.swap || 0,
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
  return {
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
  };
}
// END-OF-FILE lib/statement.js
