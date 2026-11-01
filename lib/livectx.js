// «اطلاعات زنده» که به مایکی داده می‌شه تا قیمت و اخبار رو از حافظه نگه: نرخ‌ها، طلا، کریپتو، اخبار مهم و سشن‌ها.
import { cryptoRows, fmtInt, fmtUsd } from './rates.js';
import { sessionWindows, partsIn } from './render.js';

const DAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const hm = (p) => String(p.hh).padStart(2, '0') + ':' + String(p.mm).padStart(2, '0');
export async function buildContext({ getRates, news, nowMs = Date.now(), tz = 'Asia/Tehran' }) {
  const out = [];
  const p = partsIn(nowMs, tz);
  out.push('زمان تهران: ' + DAYS[(p.wd + 1) % 7] + ' ' + p.y + '/' + String(p.m + 1).padStart(2, '0') + '/' + String(p.d).padStart(2, '0') + ' (میلادی) ساعت ' + hm(p));
  try {
    const d = getRates ? await getRates() : null;
    if (d) {
      const fx = (d.fiat || []).slice(0, 8).map((f) => (f.name || f.code) + ' ' + fmtInt(f.price)).join('، ');
      if (fx) out.push('نرخ بازار آزاد ایران (تومان): ' + fx);
      const gd = (d.gold || []).slice(0, 6).map((g) => (g.name || g.key) + ' ' + fmtInt(g.price) + (g.unit === 'دلار' ? ' دلار' : ' تومان')).join('، ');
      if (gd) out.push('طلا و سکه: ' + gd);
      const cr = cryptoRows(d).slice(0, 12).map((r) => r.sym + ' ' + (r.usd == null ? fmtInt(r.toman) + ' تومان' : '$' + fmtUsd(r.usd)) + (r.chg != null ? ' (' + (r.chg > 0 ? '+' : '') + r.chg.toFixed(1) + '% در ۲۴ساعت)' : '')).join('، ');
      if (cr) out.push('ارز دیجیتال: ' + cr);
    }
  } catch (e) { /* ignore */ }
  try {
    const ev = news && news.events ? news.events() : [];
    const up = (ev || []).filter((e) => e.d >= nowMs - 3600e3 && e.d <= nowMs + 72 * 3600e3 && (e.i === 'High' || e.i === 'Medium')).sort((a, b) => a.d - b.d).slice(0, 12);
    if (up.length) out.push('اخبار اقتصادی مهم پیش‌رو (ساعت تهران): ' + up.map((e) => { const q = partsIn(e.d, tz); return (q.d + '/' + (q.m + 1) + ' ' + hm(q)) + ' ' + e.c + ' ' + e.t + (e.i === 'High' ? ' [مهم]' : '') + (e.f ? ' پیش‌بینی ' + e.f : '') + (e.p ? ' قبلی ' + e.p : ''); }).join(' | '));
  } catch (e) { /* ignore */ }
  try { const w = sessionWindows(nowMs).filter((s) => s.isOpen).map((s) => s.fa); out.push('سشن‌های باز الان: ' + (w.length ? w.join('، ') : 'هیچ‌کدوم (بازار بسته یا بین دو سشن)')); } catch (e) { /* ignore */ }
  return out.join('\n');
}

// END-OF-FILE livectx.js
