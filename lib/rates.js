// نرخ ارز، طلا و ارز دیجیتال (بازار آزاد ایران)
// - سرور یک نسخهٔ کش‌شده نگه می‌داره (۹۰ ثانیه) تا هر کاربر مستقیم به منابع نره
// - هر منبع جدا امتحان می‌شه؛ اگه یکی نیومد، بقیه‌ی بخش‌ها همچنان نشون داده می‌شن
// - آدرس منابع با متغیرهای RATES_TGJU_URLS (جدا با کاما)، RATES_NOBITEX_URL و RATES_GECKO_URL قابل عوض کردنه
const TTL = 90 * 1000;
const STALE_MS = 15 * 60 * 1000;

const TGJU = (process.env.RATES_TGJU_URLS || 'https://call2.tgju.org/ajax.json,https://call1.tgju.org/ajax.json,https://call3.tgju.org/ajax.json,https://call4.tgju.org/ajax.json')
  .split(',').map((s) => s.trim()).filter(Boolean);
const NOBITEX = process.env.RATES_NOBITEX_URL || 'https://api.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls';
const GECKO_IDS = [['BTC', 'بیت‌کوین', 'bitcoin'], ['ETH', 'اتریوم', 'ethereum'], ['BNB', 'بایننس کوین', 'binancecoin'], ['SOL', 'سولانا', 'solana'], ['XRP', 'ریپل', 'ripple'],
  ['TON', 'تون‌کوین', 'the-open-network'], ['DOGE', 'دوج‌کوین', 'dogecoin'], ['TRX', 'ترون', 'tron'], ['LTC', 'لایت‌کوین', 'litecoin'], ['BCH', 'بیت‌کوین کش', 'bitcoin-cash']];
const GECKO = process.env.RATES_GECKO_URL || ('https://api.coingecko.com/api/v3/simple/price?ids=' + GECKO_IDS.map((x) => x[2]).join(',') + '&vs_currencies=usd&include_24hr_change=true');

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

async function fromGecko() {
  const j = await getJson(GECKO);
  const out = [];
  for (const [sym, name, id] of GECKO_IDS) {
    const o = j && j[id]; const p = o && num(o.usd); if (!p) continue;
    out.push({ sym, name, usd: p, chg: o ? num(o.usd_24h_change) : null });
  }
  if (!out.length) throw new Error('no coins');
  return out;
}

let cache = { at: 0, data: null };
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
  // اگه دلار بازار آزاد نیومد، تتر جایگزین نمایشی می‌شه
  if (!d.fiat.some((x) => x.code === 'USD') && d.usdt) d.fiat.unshift({ code: 'USD', name: 'دلار (بر پایهٔ تتر)', price: d.usdt.price, chg: d.usdt.chg });
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
