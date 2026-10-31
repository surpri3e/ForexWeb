// نرخ ارز، طلا و ارز دیجیتال (بازار آزاد ایران)
// - سرور یک نسخهٔ کش‌شده نگه می‌داره (مدتش از پنل ادمین تنظیم می‌شه) تا هر کاربر مستقیم به منابع نره
// - هر منبع جدا امتحان می‌شه؛ اگه یکی نیومد، بقیه‌ی بخش‌ها همچنان نشون داده می‌شن و آخرین قیمت سالم (تا ۳۰ دقیقه) نگه داشته می‌شه
// - منبع ارز دیجیتال و تتر و فهرست ارزها و ... از پنل ادمین ربات تنظیم می‌شه (getRatesConfig / setRatesConfig)
const STALE_MS = 15 * 60 * 1000;
const KEEP_MS = 30 * 60 * 1000;

const TGJU = (process.env.RATES_TGJU_URLS || 'https://call2.tgju.org/ajax.json,https://call1.tgju.org/ajax.json,https://call3.tgju.org/ajax.json,https://call4.tgju.org/ajax.json')
  .split(',').map((s) => s.trim()).filter(Boolean);
const NOBITEX_BASE = 'https://api.nobitex.ir/market/stats';
const NOBITEX = process.env.RATES_NOBITEX_URL || NOBITEX_BASE + '?srcCurrency=usdt&dstCurrency=rls';
const WALLEX = 'https://api.wallex.ir/v1/markets';
const GECKO = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&sparkline=true&price_change_percentage=24h,7d';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// فهرست ارزهایی که می‌شه توی پنل انتخاب کرد: [نماد، اسم فارسی، شناسهٔ کوین‌گکو]
export const CATALOG = [['BTC', 'بیت‌کوین', 'bitcoin'], ['ETH', 'اتریوم', 'ethereum'], ['BNB', 'بایننس کوین', 'binancecoin'], ['SOL', 'سولانا', 'solana'], ['XRP', 'ریپل', 'ripple'],
  ['LTC', 'لایت‌کوین', 'litecoin'], ['BCH', 'بیت‌کوین کش', 'bitcoin-cash'], ['TRX', 'ترون', 'tron'], ['DOGE', 'دوج‌کوین', 'dogecoin'], ['TON', 'تون‌کوین', 'the-open-network'],
  ['ADA', 'کاردانو', 'cardano'], ['AVAX', 'آوالانچ', 'avalanche-2'], ['LINK', 'چین‌لینک', 'chainlink'], ['DOT', 'پولکادات', 'polkadot'], ['SHIB', 'شیبا', 'shiba-inu'],
  ['XLM', 'استلار', 'stellar'], ['ETC', 'اتریوم کلاسیک', 'ethereum-classic'], ['ATOM', 'کازماس', 'cosmos'], ['NEAR', 'نییر', 'near'], ['UNI', 'یونی‌سواپ', 'uniswap'],
  ['PEPE', 'پپه', 'pepe'], ['SUI', 'سویی', 'sui'], ['APT', 'آپتوس', 'aptos'], ['XMR', 'مونرو', 'monero']];
const CAT = new Map(CATALOG.map((x) => [x[0], x]));
const TOP_FIXED = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'TRX', 'DOGE', 'ADA', 'TON', 'LTC'];
const FA_NAMES = Object.assign({ FLOKI: 'فلوکی', BONK: 'بونک', WIF: 'داگ‌ویف‌هت', NOT: 'ناتکوین', ARB: 'آربیتروم', OP: 'اپتیمیسم', INJ: 'اینجکتیو', FIL: 'فایل‌کوین', AAVE: 'آوه', USDT: 'تتر', USDC: 'یو‌اس‌دی‌کوین', STETH: 'استیک‌شده اتر', WSTETH: 'استیک‌شده اتر', WBTC: 'بیت‌کوین رپد', LEO: 'لئو', HYPE: 'هایپرلیکویید' }, Object.fromEntries(CATALOG.map((x) => [x[0], x[1]])));
const STABLE = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'PYUSD', 'USDS', 'BUSD', 'USDD', 'USDG', 'USD1']);
const WRAPPED = new Set(['STETH', 'WSTETH', 'WBTC', 'WEETH', 'WETH', 'BSC-USD', 'CBBTC', 'WBETH', 'BETH', 'USDT0']);

const FIAT = [['USD', 'دلار آزاد', ['price_dollar_rl']], ['EUR', 'یورو', ['price_eur']], ['GBP', 'پوند', ['price_gbp']], ['CHF', 'فرانک سوئیس', ['price_chf']],
  ['CAD', 'دلار کانادا', ['price_cad']], ['TRY', 'لیر ترکیه', ['price_try']], ['RUB', 'روبل', ['price_rub']], ['INR', 'روپیه هند', ['price_inr']],
  ['CNY', 'یوان چین', ['price_cny']], ['IQD', 'دینار عراق', ['price_iqd']], ['AED', 'درهم امارات', ['price_aed']], ['AFN', 'افغانی', ['price_afn']]];
const GOLD = [['coin', 'سکه امامی', ['sekee', 'sekeb']], ['mesghal', 'مثقال طلا', ['mesghal']], ['gram18', 'طلای ۱۸ عیار (گرم)', ['geram18']], ['silver', 'نقرهٔ ۹۹۹ (گرم)', ['silver_999', 'silver_925', 'silver', 'silver_ounce_ir']]];
export const FIAT_LIST = FIAT.map((x) => [x[0], x[1]]);
export const GOLD_LIST = GOLD.map((x) => [x[0], x[1]]).concat([['ons', 'انس طلا']]);
export const CRYPTO_SOURCES = ['auto', 'nobitex', 'coingecko', 'cryptocompare', 'coinpaprika'];
export const TETHER_SOURCES = ['nobitex', 'wallex'];
export const TETHER_POS = ['fiat', 'crypto', 'both'];

const num = (v) => { const x = parseFloat(String(v == null ? '' : v).replace(/[,\s٬]/g, '')); return Number.isFinite(x) ? x : null; };

// ---------- تنظیمات (از پنل ادمین) ----------
const DEFAULTS = { words: [], cryptoSource: 'auto', tetherSource: 'nobitex', tetherIn: 'both', coins: 'top10', ttl: 60, showChg: false, fiat: FIAT.map((x) => x[0]), gold: GOLD_LIST.map((x) => x[0]) };
let cfg = JSON.parse(JSON.stringify(DEFAULTS));
export function cleanRatesConfig(p) {
  const o = {}; if (!p || typeof p !== 'object') return o;
  if (CRYPTO_SOURCES.includes(p.cryptoSource)) o.cryptoSource = p.cryptoSource;
  if (TETHER_SOURCES.includes(p.tetherSource)) o.tetherSource = p.tetherSource;
  if (TETHER_POS.includes(p.tetherIn)) o.tetherIn = p.tetherIn;
  if (p.coins === 'top10') o.coins = 'top10';
  else if (Array.isArray(p.coins)) { const l = [...new Set(p.coins.map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z0-9]{2,12}$/.test(x)))].slice(0, 15); o.coins = l.length ? l : 'top10'; }
  if (Array.isArray(p.words)) o.words = [...new Set(p.words.map((w) => String(w == null ? '' : w).replace(/[<>&]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30)).filter((w) => w.length >= 2))].slice(0, 10);
  if (p.ttl != null) { const t = Math.round(+p.ttl); if (Number.isFinite(t)) o.ttl = Math.max(15, Math.min(600, t)); }
  if (p.showChg != null) o.showChg = !!p.showChg;
  if (Array.isArray(p.fiat)) { const l = FIAT.map((x) => x[0]).filter((c) => p.fiat.includes(c)); o.fiat = l.includes('USD') ? l : ['USD'].concat(l); }
  if (Array.isArray(p.gold)) { const all = GOLD_LIST.map((x) => x[0]); o.gold = all.filter((c) => p.gold.includes(c)); }
  return o;
}
// کلمه‌های دلخواهی که ادمین تعیین کرده (مثلاً «قیمت امروز») و باعث ارسال نرخ‌ها می‌شن
const normWord = (s) => String(s || '').toLowerCase().replace(/[\u200c\u200f]/g, ' ').replace(/\s+/g, ' ').replace(/[؟?!.،,\s]+$/, '').trim();
export const matchRatesWord = (text) => { const t = normWord(text); return !!t && (cfg.words || []).some((w) => normWord(w) === t); };
export const getRatesConfig = () => JSON.parse(JSON.stringify(cfg));
export function setRatesConfig(p) { cfg = Object.assign({}, cfg, cleanRatesConfig(p)); cache = { at: 0, data: cache.data }; return getRatesConfig(); }

async function getJson(url, ms = 8000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------- ارز و طلا (tgju) ----------
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
      for (const [key, name, keys] of GOLD) {
        let x = pick(keys);
        if (!x && key === 'silver') { const alt = Object.keys(cur).filter((k) => /^silver/i.test(k) && !/ounce|ons|usd/i.test(k)); x = pick(alt); }
        if (x) gold.push({ key, name, price: Math.round(x.rial / 10), unit: 'تومان', chg: x.chg });
      }
      const ons = pick(['ons']);
      if (ons) gold.push({ key: 'ons', name: 'انس طلا', price: Math.round(ons.rial), unit: 'دلار', chg: ons.chg });
      if (!fiat.length && !gold.length) throw new Error('no keys');
      return { fiat, gold };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('tgju failed');
}

// ---------- تتر (تومان) ----------
async function tetherNobitex() {
  const j = await getJson(NOBITEX);
  const s = j && j.stats && (j.stats['usdt-rls'] || j.stats[Object.keys(j.stats)[0]]);
  const rial = s && num(s.latest);
  if (!rial) throw new Error('bad shape');
  return { price: Math.round(rial / 10), chg: s && num(s.dayChange) };
}
async function tetherWallex() {
  const j = await getJson(WALLEX);
  const s = j && j.result && j.result.symbols && j.result.symbols.USDTTMN;
  const p = s && s.stats && num(s.stats.lastPrice);
  if (!p) throw new Error('bad shape');
  return { price: Math.round(p), chg: num(s.stats['24h_ch']) };
}
async function fromTether(c) {
  const order = c.tetherSource === 'wallex' ? [['wallex', tetherWallex], ['nobitex', tetherNobitex]] : [['nobitex', tetherNobitex], ['wallex', tetherWallex]];
  const errs = [];
  for (const [name, fn] of order) { try { const v = await fn(); return Object.assign(v, { src: name, fallback: name !== c.tetherSource }); } catch (e) { errs.push(name + ': ' + String(e && e.message || e).slice(0, 30)); } }
  throw new Error(errs.join(' | '));
}

// ---------- ارز دیجیتال ----------
function sparkOf(arr) {
  if (!Array.isArray(arr) || arr.length < 4) return null;
  const n = 28, out = [];
  for (let i = 0; i < n; i++) { const v = num(arr[Math.min(arr.length - 1, Math.round(i * (arr.length - 1) / (n - 1)))]); if (v != null) out.push(+v.toPrecision(6)); }
  return out.length > 3 ? out : null;
}
const coin = (sym, o) => Object.assign({ sym, id: sym.toLowerCase(), name: FA_NAMES[sym] || sym, rank: 0, usd: null, chg: null, chg7: null, cap: null, vol: null, hi: null, lo: null, spark: null }, o);
// هر منبع: syms = فهرست نمادها یا null (تاپ بر اساس ارزش بازار)؛ خروجی آرایه‌ای از ارزها
const SRC = {
  async nobitex(syms) {
    const want = syms || TOP_FIXED;
    const one = (s) => getJson(NOBITEX_BASE + '?srcCurrency=' + s.map((x) => x.toLowerCase()).join(',') + '&dstCurrency=usdt');
    let stats = {};
    try { const j = await one(want); stats = (j && j.stats) || {}; }
    catch (e) { // یکی از نمادها رو نوبیتکس نداره؛ تک‌تک امتحان می‌شه
      const rs = await Promise.allSettled(want.slice(0, 15).map((s) => one([s])));
      rs.forEach((r) => { if (r.status === 'fulfilled' && r.value && r.value.stats) Object.assign(stats, r.value.stats); });
    }
    const out = [];
    want.forEach((sym, i) => { const o = stats[sym.toLowerCase() + '-usdt']; const p = o && num(o.latest); if (p) out.push(coin(sym, { rank: i + 1, usd: p, chg: num(o.dayChange), hi: num(o.dayHigh), lo: num(o.dayLow), vol: num(o.volumeDst) })); });
    if (!out.length) throw new Error('no coins');
    return out;
  },
  async coingecko(syms) {
    const tail = '&order=market_cap_desc&per_page=50&page=1', urls = [];
    if (!syms) urls.push(GECKO + '&order=market_cap_desc&per_page=25&page=1');
    else {
      const known = syms.filter((s) => CAT.has(s)), unk = syms.filter((s) => !CAT.has(s)); // نماد ناشناخته با پارامتر symbols پیدا می‌شه
      if (known.length) urls.push(GECKO + '&ids=' + known.map((s) => CAT.get(s)[2]).join(',') + tail);
      if (unk.length) urls.push(GECKO + '&symbols=' + unk.map((s) => s.toLowerCase()).join(',') + tail);
    }
    const parts = await Promise.all(urls.map((u) => getJson(u)));
    const seenSym = new Set();
    const flat = parts.flatMap((j) => (Array.isArray(j) ? j : [])).filter((o) => { const s = String(o && o.symbol || '').toUpperCase(); if (!s || seenSym.has(s)) return false; seenSym.add(s); return true; });
    const out = flat.map((o, i) => {
      const usd = num(o && o.current_price); if (!usd) return null;
      const sym = String(o.symbol || '').toUpperCase();
      return coin(sym, { id: String(o.id || sym), name: FA_NAMES[sym] || String(o.name || sym), rank: num(o.market_cap_rank) || i + 1, usd,
        chg: num(o.price_change_percentage_24h_in_currency != null ? o.price_change_percentage_24h_in_currency : o.price_change_percentage_24h), chg7: num(o.price_change_percentage_7d_in_currency),
        cap: num(o.market_cap), vol: num(o.total_volume), hi: num(o.high_24h), lo: num(o.low_24h), spark: sparkOf(o.sparkline_in_7d && o.sparkline_in_7d.price) });
    }).filter(Boolean);
    if (!out.length) throw new Error('no coins');
    return out;
  },
  async cryptocompare(syms) {
    const mk = (r, sym, rank, name) => coin(sym, { rank, name: FA_NAMES[sym] || name || sym, usd: num(r.PRICE), chg: num(r.CHANGEPCT24HOUR), cap: num(r.MKTCAP), vol: num(r.TOTALVOLUME24HTO || r.VOLUME24HOURTO), hi: num(r.HIGH24HOUR), lo: num(r.LOW24HOUR) });
    const out = [];
    if (syms) {
      const j = await getJson('https://min-api.cryptocompare.com/data/pricemultifull?tsyms=USD&fsyms=' + syms.join(','));
      syms.forEach((sym, i) => { const r = j && j.RAW && j.RAW[sym] && j.RAW[sym].USD; if (r && num(r.PRICE)) out.push(mk(r, sym, i + 1)); });
    } else {
      const j = await getJson('https://min-api.cryptocompare.com/data/top/mktcapfull?limit=25&tsym=USD');
      ((j && j.Data) || []).forEach((o) => { const r = o && o.RAW && o.RAW.USD; if (r && o.CoinInfo && num(r.PRICE)) out.push(mk(r, String(o.CoinInfo.Name || '').toUpperCase(), out.length + 1, o.CoinInfo.FullName)); });
    }
    if (!out.length) throw new Error('no coins');
    return out;
  },
  async coinpaprika(syms) {
    const j = await getJson('https://api.coinpaprika.com/v1/tickers?quotes=USD&limit=' + (syms ? 250 : 30));
    let out = [];
    (Array.isArray(j) ? j : []).forEach((o) => {
      const q = o && o.quotes && o.quotes.USD; const usd = q && num(q.price); if (!usd) return;
      const sym = String(o.symbol || '').toUpperCase();
      out.push(coin(sym, { id: String(o.id || sym), name: FA_NAMES[sym] || String(o.name || sym), rank: num(o.rank) || out.length + 1, usd, chg: num(q.percent_change_24h), chg7: num(q.percent_change_7d), cap: num(q.market_cap), vol: num(q.volume_24h) }));
    });
    if (syms) { const seen = new Set(); out = out.filter((c) => syms.includes(c.sym) && !seen.has(c.sym) && seen.add(c.sym)); }
    if (!out.length) throw new Error('no coins');
    return out;
  }
};
const finishCoins = (list, syms) => {
  if (syms) return syms.map((s, i) => { const c = list.find((x) => x.sym === s); return c ? Object.assign({}, c, { rank: i + 1 }) : null; }).filter(Boolean);
  return list.filter((c) => !STABLE.has(c.sym) && !WRAPPED.has(c.sym)).sort((a, b) => a.rank - b.rank).slice(0, 10).map((c, i) => Object.assign({}, c, { rank: i + 1 }));
};
async function fromCrypto(c) {
  const syms = Array.isArray(c.coins) ? c.coins : null, errs = [];
  const run = async (name) => { try { return await SRC[name](syms); } catch (e) { errs.push(name + ': ' + String(e && e.message || e).slice(0, 36)); return null; } };
  const chain = async (names) => { for (const n of names) { const r = await run(n); if (r) return { list: r, src: n }; } return null; };
  const others = (skip) => ['coingecko', 'cryptocompare', 'coinpaprika', 'nobitex'].filter((x) => !skip.includes(x));
  let base = null, fresh = null, src = '';
  if (c.cryptoSource === 'auto') {
    // قیمت زنده از نوبیتکس + اطلاعات کامل (رتبه، ارزش بازار، نمودار) از اولین منبع سالم
    const [nb, ch] = await Promise.all([run('nobitex'), chain(others(['nobitex']))]);
    fresh = nb; base = ch ? ch.list : nb; src = ch ? ch.src + (nb ? ' + nobitex' : '') : (nb ? 'nobitex' : '');
  } else {
    const r = await chain([c.cryptoSource].concat(others([c.cryptoSource])));
    if (r) { base = r.list; src = r.src === c.cryptoSource ? r.src : r.src + ' (جایگزین)'; }
  }
  if (!base) throw new Error(errs.join(' | ') || 'no source');
  if (syms) { // ارزی که منبع اصلی نداشت (مثلاً یک میم‌کوین) از منابع دیگه تکمیل می‌شه
    let missing = syms.filter((s) => !base.some((x) => x.sym === s) && !(fresh && fresh.some((x) => x.sym === s)));
    for (const n of ['coingecko', 'cryptocompare', 'coinpaprika', 'nobitex']) {
      if (!missing.length) break;
      try { const more = await SRC[n](missing); const add = more.filter((x) => missing.includes(x.sym)); if (add.length) { base = base.concat(add); missing = missing.filter((s) => !add.some((x) => x.sym === s)); } } catch (e) { /* منبع بعدی */ }
    }
  }
  if (fresh && base !== fresh) base = base.map((b) => { const f = fresh.find((x) => x.sym === b.sym); return f ? Object.assign({}, b, { usd: f.usd, chg: f.chg != null ? f.chg : b.chg, hi: f.hi != null ? f.hi : b.hi, lo: f.lo != null ? f.lo : b.lo }) : b; });
  const list = finishCoins(base, syms);
  if (!list.length) throw new Error('empty list');
  return { list, src, errs };
}

// ---------- ساخت و کش ----------
let cache = { at: 0, data: null };
let manualUsd = null;
export function setManualUsd(price, at = Date.now()) { const p = num(price); manualUsd = p && p > 1000 ? { price: Math.round(p), at } : null; cache = { at: 0, data: cache.data }; return manualUsd; }
export const getManualUsd = () => manualUsd;
let state = { lastError: {}, lastTry: 0, info: {} };
let inflight = null;
const good = { fx: null, tether: null, crypto: null }; // آخرین نتیجهٔ سالم هر منبع (تا ۳۰ دقیقه نگه می‌داریم)
const keep = (k, v) => { if (v) good[k] = { at: Date.now(), v }; return v; };
const lastGood = (k) => (good[k] && Date.now() - good[k].at < KEEP_MS ? good[k].v : null);

async function build() {
  const c = getRatesConfig(), errs = {}, info = {};
  const t0 = Date.now();
  const [tg, tt, cg] = await Promise.allSettled([fromTgju(), fromTether(c), fromCrypto(c)]);
  const d = { at: Date.now(), fiat: [], gold: [], crypto: [], usdt: null, missing: [] };
  let fx = tg.status === 'fulfilled' ? keep('fx', tg.value) : null;
  if (tg.status === 'rejected') { errs.tgju = String(tg.reason && tg.reason.message || tg.reason).slice(0, 80); fx = lastGood('fx'); info.fx = { ok: false, kept: !!fx }; } else info.fx = { ok: true, fiat: fx.fiat.length, gold: fx.gold.length };
  if (fx) { d.fiat = fx.fiat.map((x) => Object.assign({}, x)); d.gold = fx.gold.map((x) => Object.assign({}, x)); } else d.missing.push('fiat', 'gold');
  let te = tt.status === 'fulfilled' ? keep('tether', tt.value) : null;
  if (tt.status === 'rejected') { errs.tether = String(tt.reason && tt.reason.message || tt.reason).slice(0, 90); te = lastGood('tether'); info.tether = { ok: false, kept: !!te }; } else info.tether = { ok: true, src: te.src, fallback: te.fallback };
  if (te) d.usdt = { price: te.price, chg: te.chg, src: te.src }; else d.missing.push('usdt');
  let cr = cg.status === 'fulfilled' ? keep('crypto', cg.value) : null;
  if (cg.status === 'rejected') { errs.crypto = String(cg.reason && cg.reason.message || cg.reason).slice(0, 220); cr = lastGood('crypto'); info.crypto = { ok: false, kept: !!cr }; } else info.crypto = { ok: true, src: cr.src, count: cr.list.length, errs: cr.errs };
  if (cr) d.crypto = cr.list.map((x) => Object.assign({}, x)); else d.missing.push('crypto');
  if (!d.fiat.some((x) => x.code === 'USD') && manualUsd && manualUsd.price > 0) d.fiat.unshift({ code: 'USD', name: 'دلار (دستی)', price: manualUsd.price, chg: null, manual: true, at: manualUsd.at });
  info.ms = Date.now() - t0;
  state = { lastError: errs, lastTry: Date.now(), info };
  return d;
}
// نمای نهایی: فیلتر ارزها و طلاها و جای تتر، طبق تنظیمات (بدون دوباره گرفتن قیمت)
function shape(d) {
  const c = cfg, o = Object.assign({}, d);
  o.fiat = (d.fiat || []).filter((x) => x.manual || c.fiat.includes(x.code)).map((x) => Object.assign({}, x));
  o.gold = (d.gold || []).filter((x) => c.gold.includes(x.key));
  o.tetherIn = c.tetherIn; o.showChg = c.showChg;
  if (d.usdt && d.usdt.price && c.tetherIn !== 'crypto') { const i = o.fiat.findIndex((x) => x.code === 'USD'); o.fiat.splice(i >= 0 ? i + 1 : 0, 0, { code: 'USDT', name: 'تتر (USDT)', price: d.usdt.price, chg: d.usdt.chg, tether: true }); }
  return o;
}
export async function getRates({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < cfg.ttl * 1000) return Object.assign(shape(cache.data), { stale: Date.now() - cache.data.at > STALE_MS });
  if (!inflight) inflight = build().then((d) => {
    const has = d.fiat.length || d.gold.length || d.crypto.length || d.usdt;
    if (has) { cache = { at: Date.now(), data: d }; return d; }
    if (cache.data) return cache.data; // چیزی نیومد: آخرین نسخهٔ سالم
    return d;
  }).finally(() => { inflight = null; });
  const d = await inflight;
  return Object.assign(shape(d), { stale: Date.now() - d.at > STALE_MS });
}
export function ratesStatus() { return { at: cache.at ? Math.floor(cache.at / 1000) : 0, errors: state.lastError, info: state.info || {}, lastTry: Math.floor(state.lastTry / 1000), config: getRatesConfig(), sources: { tgju: TGJU, nobitex: NOBITEX } }; }
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
// تتر (اگه تنظیم باشه) اول لیست و با قیمت تومانی صرافی؛ بقیه با قیمت دلاری
export function cryptoRows(d) {
  const rows = ((d && d.crypto) || []).filter((r) => r.sym !== 'USDT').map((c) => Object.assign({}, c));
  if (d && d.usdt && d.tetherIn !== 'fiat') rows.unshift({ sym: 'USDT', id: 'tether', name: 'تتر', rank: 0, usd: null, toman: d.usdt.price, chg: d.usdt.chg, tchg: d.usdt.chg });
  return rows;
}
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sgn = (c) => (c == null ? '' : (c > 0 ? '+' : c < 0 ? '−' : '') + Math.abs(c).toFixed(1) + '%');
export const fmtBig = (n) => (n == null ? '—' : n >= 1e12 ? (n / 1e12).toFixed(2) + ' تریلیون' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' میلیارد' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' میلیون' : fmtInt(n));
// تغییر قیمت (اختیاری): رنگ نشون‌دهندهٔ جهته و عدد بدون علامت، تا توی متن راست‌به‌چپ بهم نریزه
const chgTag = (c, dec = 2) => (c == null ? '' : '  ' + (c > 0 ? '🟢' : c < 0 ? '🔴' : '⚪') + '‎' + Math.abs(c).toFixed(dec) + '%');
const RLM = '‏';
const FIAT_EMO = { USD: '🇺🇸', USDT: '💵', EUR: '🇪🇺', GBP: '🇬🇧', CHF: '🇨🇭', CAD: '🇨🇦', TRY: '🇹🇷', RUB: '🇷🇺', INR: '🇮🇳', CNY: '🇨🇳', IQD: '🇮🇶', AED: '🇦🇪', AFN: '🇦🇫' };
const FIAT_SHORT = { USD: 'دلار', USDT: 'تتر', EUR: 'یورو', GBP: 'پوند', CHF: 'فرانک', CAD: 'دلار کانادا', TRY: 'لیر', RUB: 'روبل', INR: 'روپیه', CNY: 'یوان', IQD: 'دینار', AED: 'درهم', AFN: 'افغانی' };
const GOLD_SHORT = { coin: 'سکه', mesghal: 'مثقال طلا', gram18: 'گرم طلا', silver: 'گرم نقره', ons: 'انس طلا' };
export function coinLine(r, withChg = true) {
  const price = r.usd == null ? fmtInt(r.toman) + ' تومان' : fmtUsd(r.usd) + ' دلار';
  return RLM + (r.sym === 'USDT' ? '💵' : '💰') + ' ' + esc(r.name) + ' : ' + price + (withChg ? chgTag(r.chg, 1) : '');
}
// بخش‌های متن نرخ‌ها؛ هر کدوم یک رشتهٔ HTML مستقل (برای کپشن عکس یا پیام جدا)
export function ratesParts(d, tz) {
  const st = faStamp((d && d.at) || Date.now(), tz || 'Asia/Tehran'), sc = !!(d && d.showChg);
  const head = '<b>◄ نرخ ارز و طلا در بازار آزاد :</b>\n\n• ' + st.date + '\n• ساعت : ' + st.time;
  const parts = { head };
  if (d.fiat && d.fiat.length) parts.fiat = d.fiat.map((f) => RLM + (FIAT_EMO[f.code] || '💱') + ' ' + esc(f.manual ? f.name : FIAT_SHORT[f.code] || f.name) + ' : ' + fmtInt(f.price) + ' تومان' + (sc ? chgTag(f.chg) : '')).join('\n');
  if (d.gold && d.gold.length) parts.gold = d.gold.map((g) => RLM + '• ' + esc(GOLD_SHORT[g.key] || g.name) + ' : ' + (g.unit === 'دلار' ? fmtInt(g.price) + ' دلار' : fmtInt(g.price) + ' تومان') + (sc ? chgTag(g.chg) : '')).join('\n');
  const cr = cryptoRows(d);
  if (cr.length) parts.crypto = '<b>◄ قیمت ارزهای دیجیتال:</b>\n\n' + cr.map((r) => coinLine(r, sc)).join('\n');
  if (d.stale) parts.stale = 'این قیمت‌ها چند دقیقه قدیمی‌ان.';
  return parts;
}
// sections: ['fiat','gold','crypto']؛ خروجی: { caption (حداکثر ۱۰۰۰ نویسه)، extra (باقی‌مانده، ممکنه خالی باشه) }
const SEP = '\n~ ~ ~ ~ ~ ~\n';
export function composeRates(d, sections, tz, limit = 1000, footer = '') {
  const ft = footer ? '\n\n' + footer : '', full = limit; limit -= ft.length;
  const p = ratesParts(d, tz), want = (sections && sections.length ? sections : ['fiat', 'gold', 'crypto']).filter((k) => p[k]);
  let cap = p.head, extra = '', first = true, inExtra = false;
  for (const k of want) {
    const glue = first ? '\n\n' : SEP;
    if (!inExtra && (cap + glue + p[k]).length <= limit) cap += glue + p[k];
    else { inExtra = true; extra += (extra ? SEP : '') + p[k]; }
    first = false;
  }
  if (p.stale) { if (extra) extra += '\n\n' + p.stale; else if ((cap + '\n\n' + p.stale).length <= limit) cap += '\n\n' + p.stale; }
  if (ft) { if (extra) extra += ft; else cap += ft; }
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
