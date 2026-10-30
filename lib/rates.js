// نرخ ارز، طلا و ارز دیجیتال (بازار آزاد ایران)
// - سرور یک نسخهٔ کش‌شده نگه می‌داره (۹۰ ثانیه) تا هر کاربر مستقیم به منابع نره
// - هر منبع جدا امتحان می‌شه؛ اگه یکی نیومد، بقیه‌ی بخش‌ها همچنان نشون داده می‌شن
// - آدرس منابع با متغیرهای RATES_TGJU_URLS (جدا با کاما)، RATES_NOBITEX_URL و RATES_GECKO_URL قابل عوض کردنه
const TTL = 90 * 1000;
const STALE_MS = 15 * 60 * 1000;

const TGJU = (process.env.RATES_TGJU_URLS || 'https://call2.tgju.org/ajax.json,https://call1.tgju.org/ajax.json,https://call3.tgju.org/ajax.json,https://call4.tgju.org/ajax.json')
  .split(',').map((s) => s.trim()).filter(Boolean);
const NOBITEX = process.env.RATES_NOBITEX_URL || 'https://api.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls';
const GECKO_IDS = [['BTC', 'بیت‌کوین', 'bitcoin'], ['ETH', 'اتریوم', 'ethereum'], ['USDT', 'تتر', 'tether'], ['XRP', 'ریپل', 'ripple'], ['BNB', 'بایننس کوین', 'binancecoin'],
  ['SOL', 'سولانا', 'solana'], ['USDC', 'یو‌اس‌دی‌کوین', 'usd-coin'], ['TRX', 'ترون', 'tron'], ['DOGE', 'دوج‌کوین', 'dogecoin'], ['ADA', 'کاردانو', 'cardano']];
// نام فارسی ارزهای پرتکرار؛ بقیه با نام انگلیسی نشون داده می‌شن
const FA_NAMES = { BTC: 'بیت‌کوین', ETH: 'اتریوم', USDT: 'تتر', XRP: 'ریپل', BNB: 'بایننس کوین', SOL: 'سولانا', USDC: 'یو‌اس‌دی‌کوین', TRX: 'ترون', DOGE: 'دوج‌کوین', ADA: 'کاردانو',
  TON: 'تون‌کوین', LINK: 'چین‌لینک', AVAX: 'آوالانچ', SHIB: 'شیبا', DOT: 'پولکادات', BCH: 'بیت‌کوین کش', LTC: 'لایت‌کوین', STETH: 'استیک‌شده اتر', WSTETH: 'استیک‌شده اتر', WBTC: 'بیت‌کوین رپد', LEO: 'لئو', HYPE: 'هایپرلیکویید', SUI: 'سویی' };
// تاپ ۱۰ ارز دیجیتال به ترتیب ارزش بازار (با نمودار ۷ روزه)
const GECKO = process.env.RATES_GECKO_URL || 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=true&price_change_percentage=24h,7d';
const GECKO_SIMPLE = 'https://api.coingecko.com/api/v3/simple/price?ids=' + GECKO_IDS.map((x) => x[2]).join(',') + '&vs_currencies=usd&include_24hr_change=true';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FIAT = [['USD', 'دلار آمریکا', ['price_dollar_rl']], ['EUR', 'یورو', ['price_eur']], ['GBP', 'پوند', ['price_gbp']], ['CHF', 'فرانک سوئیس', ['price_chf']],
  ['CAD', 'دلار کانادا', ['price_cad']], ['TRY', 'لیر ترکیه', ['price_try']], ['RUB', 'روبل', ['price_rub']], ['INR', 'روپیه هند', ['price_inr']],
  ['CNY', 'یوان چین', ['price_cny']], ['IQD', 'دینار عراق', ['price_iqd']], ['AED', 'درهم امارات', ['price_aed']], ['AFN', 'افغانی', ['price_afn']]];
const GOLD = [['coin', 'سکه امامی', ['sekee', 'sekeb']], ['mesghal', 'مثقال طلا', ['mesghal']], ['gram18', 'طلای ۱۸ عیار (گرم)', ['geram18']], ['silver', 'نقرهٔ ۹۹۹ (گرم)', ['silver_999', 'silver']]];

const num = (v) => { const x = parseFloat(String(v == null ? '' : v).replace(/[,\s٬]/g, '')); return Number.isFinite(x) ? x : null; };
async function getJson(url, ms = 8000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function fromTgju() {
  let lastErr = null;
  for (const u of TGJU) {
    try {
      const j = await getJson(u);
      const cur = j && (j.current || j);
      if (!cur || typeof cur !== 'object') throw new Error('bad shape');
      const pick = (keys) => {
        for (const k of keys) {
          const o = cur[k]; if (!o) continue;
          const p = num(o.p != null ? o.p : o.price); if (p == null || p <= 0) continue;
          const dp = num(o.dp);
          return { rial: p, chg: dp == null ? null : (String(o.dt || '').toLowerCase() === 'low' ? -Math.abs(dp) : Math.abs(dp)) };
        }
        return null;
      };
      const fiat = [], gold = [];
      for (const [code, name, keys] of FIAT) { const x = pick(keys); if (x) fiat.push({ code, name, price: Math.round(x.rial / 10), chg: x.chg }); }
      for (const [key, name, keys] of GOLD) { const x = pick(keys); if (x) gold.push({ key, name, price: Math.round(x.rial / 10), unit: 'تومان', chg: x.chg }); }
      const ons = pick(['ons']);
      if (ons) gold.push({ key: 'ons', name: 'انس طلا', price: Math.round(ons.rial), unit: 'دلار', chg: ons.chg });
      if (!fiat.length && !gold.length) throw new Error('no keys');
      return { fiat, gold };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('tgju failed');
}

async function fromNobitex() {
  const j = await getJson(NOBITEX);
  const s = j && j.stats && (j.stats['usdt-rls'] || j.stats[Object.keys(j.stats)[0]]);
  const rial = s && num(s.latest);
  if (!rial) throw new Error('bad shape');
  const ch = s && num(s.dayChange);
  return { usdt: { price: Math.round(rial / 10), chg: ch } };
}

function sparkOf(arr) {
  if (!Array.isArray(arr) || arr.length < 4) return null;
  const n = 28, out = [];
  for (let i = 0; i < n; i++) { const v = num(arr[Math.min(arr.length - 1, Math.round(i * (arr.length - 1) / (n - 1)))]); if (v != null) out.push(+v.toPrecision(6)); }
  return out.length > 3 ? out : null;
}
async function fromGecko() {
  try {
    const j = await getJson(GECKO);
    const arr = Array.isArray(j) ? j : [];
    const out = arr.map((o, i) => {
      const usd = num(o && o.current_price); if (!usd) return null;
      const sym = String(o.symbol || '').toUpperCase();
      return { sym, id: String(o.id || sym), name: FA_NAMES[sym] || String(o.name || sym), rank: num(o.market_cap_rank) || i + 1, usd,
        chg: num(o.price_change_percentage_24h_in_currency != null ? o.price_change_percentage_24h_in_currency : o.price_change_percentage_24h),
        chg7: num(o.price_change_percentage_7d_in_currency), cap: num(o.market_cap), vol: num(o.total_volume), hi: num(o.high_24h), lo: num(o.low_24h), spark: sparkOf(o.sparkline_in_7d && o.sparkline_in_7d.price) };
    }).filter(Boolean);
    if (out.length) return out;
  } catch (e) { /* می‌ریم سراغ نسخهٔ ساده */ }
  const j = await getJson(GECKO_SIMPLE);
  const out = [];
  GECKO_IDS.forEach(([sym, name, id], i) => {
    const o = j && j[id]; const p = o && num(o.usd); if (!p) return;
    out.push({ sym, id, name, rank: i + 1, usd: p, chg: o ? num(o.usd_24h_change) : null, chg7: null, cap: null, vol: null, hi: null, lo: null, spark: null });
  });
  if (!out.length) throw new Error('no coins');
  return out;
}

let cache = { at: 0, data: null };
let manualUsd = null;
export function setManualUsd(price, at = Date.now()) { const p = num(price); manualUsd = p && p > 1000 ? { price: Math.round(p), at } : null; cache = { at: 0, data: cache.data }; return manualUsd; }
export const getManualUsd = () => manualUsd;
let state = { lastError: {}, lastTry: 0 };
let inflight = null;

async function build() {
  const errs = {};
  const [tg, nb, cg] = await Promise.allSettled([fromTgju(), fromNobitex(), fromGecko()]);
  if (tg.status === 'rejected') errs.tgju = String(tg.reason && tg.reason.message || tg.reason).slice(0, 80);
  if (nb.status === 'rejected') errs.nobitex = String(nb.reason && nb.reason.message || nb.reason).slice(0, 80);
  if (cg.status === 'rejected') errs.coingecko = String(cg.reason && cg.reason.message || cg.reason).slice(0, 80);
  const d = { at: Date.now(), fiat: [], gold: [], crypto: [], usdt: null, missing: [] };
  if (tg.status === 'fulfilled') { d.fiat = tg.value.fiat; d.gold = tg.value.gold; } else d.missing.push('fiat', 'gold');
  if (nb.status === 'fulfilled') d.usdt = nb.value.usdt; else d.missing.push('usdt');
  if (cg.status === 'fulfilled') d.crypto = cg.value; else d.missing.push('crypto');
  // دلار همیشه دلار بازار آزاده؛ تتر هیچ‌وقت جاش نمی‌شینه. اگه منبع خودکار قطع بود و ادمین نرخ دستی گذاشته باشه، با برچسب «دستی» نشون داده می‌شه.
  if (!d.fiat.some((x) => x.code === 'USD') && manualUsd && manualUsd.price > 0) d.fiat.unshift({ code: 'USD', name: 'دلار (دستی)', price: manualUsd.price, chg: null, manual: true, at: manualUsd.at });
  state = { lastError: errs, lastTry: Date.now() };
  return d;
}

export async function getRates({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < TTL) return cache.data;
  if (!inflight) inflight = build().then((d) => {
    const has = d.fiat.length || d.gold.length || d.crypto.length || d.usdt;
    if (has) { cache = { at: Date.now(), data: d }; return d; }
    if (cache.data) return cache.data; // چیزی نیومد: آخرین نسخهٔ سالم
    return d;
  }).finally(() => { inflight = null; });
  const d = await inflight;
  return Object.assign({}, d, { stale: Date.now() - d.at > STALE_MS });
}
export function ratesStatus() { return { at: cache.at ? Math.floor(cache.at / 1000) : 0, errors: state.lastError, lastTry: Math.floor(state.lastTry / 1000), sources: { tgju: TGJU, nobitex: NOBITEX } }; }
export const hasAnyRates = (d) => !!(d && (d.fiat.length || d.gold.length || d.crypto.length || d.usdt));

// ---------- قالب‌بندی ----------
export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
export function fmtUsd(n) {
  if (n >= 100) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  const dec = Math.min(10, Math.max(4, 3 - Math.floor(Math.log10(n))));
  return n.toFixed(dec).replace(/0+$/, '').replace(/\.$/, '');
}
export const fmtChg = (c) => (c == null ? '' : (c > 0 ? '+' : c < 0 ? '−' : '') + Math.abs(c).toFixed(2) + '%');
export function faStamp(ms, tz = 'Asia/Tehran') {
  const d = new Date(ms);
  let date = '', time = '';
  try {
    const parts = {}; new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).formatToParts(d).forEach((x) => { parts[x.type] = x.value; });
    date = [parts.weekday, parts.day, parts.month, parts.year].filter(Boolean).join(' ');
    time = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(d);
  } catch { date = d.toISOString().slice(0, 10); time = d.toISOString().slice(11, 16); }
  return { date, time };
}

// ---------- ردیف‌های ارز دیجیتال و متن‌ها ----------
// تتر توی لیست با قیمت تومانی (نرخ نوبیتکس) نشون داده می‌شه؛ بقیه با قیمت دلاری
export function cryptoRows(d) {
  const rows = ((d && d.crypto) || []).map((c) => Object.assign({}, c));
  if (d && d.usdt) {
    const i = rows.findIndex((r) => r.sym === 'USDT');
    if (i >= 0) { rows[i].toman = d.usdt.price; rows[i].tchg = d.usdt.chg; }
    else rows.unshift({ sym: 'USDT', id: 'tether', name: 'تتر', rank: 0, usd: null, toman: d.usdt.price, chg: d.usdt.chg, tchg: d.usdt.chg });
  }
  return rows;
}
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sgn = (c) => (c == null ? '' : (c > 0 ? '+' : c < 0 ? '−' : '') + Math.abs(c).toFixed(1) + '%');
export const fmtBig = (n) => (n == null ? '—' : n >= 1e12 ? (n / 1e12).toFixed(2) + ' تریلیون' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' میلیارد' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' میلیون' : fmtInt(n));
export function coinLine(r, withChg = true) {
  const price = r.usd == null ? fmtInt(r.toman) + ' تومان' : '$' + fmtUsd(r.usd);
  const toman = r.sym === 'USDT' && r.usd != null && r.toman ? ' · ' + fmtInt(r.toman) + ' تومان' : '';
  return esc(r.name) + '   <b>' + price + '</b>' + toman + (withChg && r.chg != null ? '  <code>' + sgn(r.chg) + '</code>' : '');
}
// بخش‌های متن نرخ‌ها؛ هر کدوم یک رشته HTML مستقل (برای کپشن عکس یا پیام جدا)
export function ratesParts(d, tz) {
  const st = faStamp((d && d.at) || Date.now(), tz || 'Asia/Tehran');
  const head = '<b>نرخ ارز و طلا</b>  ·  ' + st.date + '  ·  ' + st.time;
  const line = (name, price, unit, chg) => esc(name) + '   <b>' + price + '</b> ' + unit + (chg == null ? '' : '  <code>' + sgn(chg) + '</code>');
  const parts = { head };
  if (d.fiat && d.fiat.length) parts.fiat = '<b>ارز (تومان)</b>\n' + d.fiat.map((f) => line(f.name, fmtInt(f.price), 'تومان', f.chg)).join('\n');
  if (d.gold && d.gold.length) parts.gold = '<b>طلا و سکه</b>\n' + d.gold.map((g) => line(g.name, g.unit === 'دلار' ? fmtUsd(g.price) : fmtInt(g.price), g.unit, g.chg)).join('\n');
  const cr = cryptoRows(d);
  if (cr.length) parts.crypto = '<b>ارز دیجیتال (تاپ ۱۰)</b>\n' + cr.map((r) => coinLine(r)).join('\n');
  if (d.stale) parts.stale = 'این قیمت‌ها چند دقیقه قدیمی‌ان.';
  return parts;
}
// sections: ['fiat','gold','crypto']؛ خروجی: { caption (حداکثر ۱۰۰۰ نویسه)، extra (باقی‌مانده، ممکنه خالی باشه) }
export function composeRates(d, sections, tz, limit = 1000) {
  const p = ratesParts(d, tz), want = (sections && sections.length ? sections : ['fiat', 'gold', 'crypto']).filter((k) => p[k]);
  let cap = p.head, extra = '';
  for (const k of want) {
    if (!extra && (cap + '\n\n' + p[k]).length <= limit) cap += '\n\n' + p[k];
    else extra += (extra ? '\n\n' : '') + p[k];
  }
  if (p.stale) { if (extra) extra += '\n\n' + p.stale; else if ((cap + '\n\n' + p.stale).length <= limit) cap += '\n\n' + p.stale; }
  return { caption: cap, extra };
}
export function coinText(r, d, tz) {
  const st = faStamp((d && d.at) || Date.now(), tz || 'Asia/Tehran');
  const tom = d && d.usdt && r.usd != null ? Math.round(r.usd * d.usdt.price) : null;
  let t = '<b>' + esc(r.name) + '</b>  ·  ' + esc(r.sym) + (r.rank ? '  ·  رتبهٔ ' + r.rank + ' بازار' : '') + '\n';
  t += r.usd == null ? 'قیمت: <b>' + fmtInt(r.toman) + ' تومان</b>' : 'قیمت: <b>$' + fmtUsd(r.usd) + '</b>';
  if (tom && r.sym !== 'USDT') t += '\nمعادل تومان (با نرخ تتر): <b>' + fmtInt(tom) + '</b>';
  if (r.sym === 'USDT' && r.usd != null && r.toman) t += '\nقیمت تومانی: <b>' + fmtInt(r.toman) + '</b>';
  if (r.chg != null) t += '\nتغییر ۲۴ ساعت: <b>' + sgn(r.chg) + '</b>';
  if (r.chg7 != null) t += '\nتغییر ۷ روز: <b>' + sgn(r.chg7) + '</b>';
  if (r.hi != null && r.lo != null) t += '\nبالاترین و پایین‌ترین ۲۴ ساعت: <b>$' + fmtUsd(r.hi) + '</b> و <b>$' + fmtUsd(r.lo) + '</b>';
  if (r.cap) t += '\nارزش بازار: <b>$' + fmtBig(r.cap) + '</b>';
  if (r.vol) t += '\nحجم معاملات ۲۴ ساعت: <b>$' + fmtBig(r.vol) + '</b>';
  return t + '\n\n' + st.date + '  ·  ' + st.time;
}
