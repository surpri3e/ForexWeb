import { sql } from './db.js';

// هشدار خبر قرمز: چند دقیقه قبل از هر خبر مهم (Forex Factory، اثر High) به کاربران ربات پیام می‌ده.
// هر کاربر خودش روشن/خاموش و زمان هشدار رو تنظیم می‌کنه (پیش‌فرض: روشن، ۳۰ دقیقه قبل).
//  - خبرها از حافظهٔ سرور خونده می‌شن (به دیتابیس دست نمی‌زنه)
//  - فقط وقتی یه خبر قرمز توی بازهٔ هشدار باشه، لیست کاربرها از دیتابیس گرفته می‌شه و تا ۲ ساعت توی حافظه می‌مونه
//  - اینکه هشدار هر خبر برای هر نفر فرستاده شده یا نه توی bot_settings ذخیره می‌شه تا بعد از ری‌استارت دوباره نیاد

export const LEADS = [10, 15, 30, 45, 60, 90];
const DEF = { on: true, lead: 30 };
const MAXLEAD = Math.max(...LEADS);
const TICK_MS = 60e3;
const SUBS_TTL = 2 * 3600e3;
const PREF_TTL = 10 * 60e3;
const DB_TMO = 10e3;

const cleanPref = (p) => ({
  on: !(p && p.on === false),
  lead: LEADS.includes(Number(p && p.lead)) ? Number(p.lead) : DEF.lead
});

const withTmo = (p, ms = DB_TMO) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('db_timeout')), ms))]);

let dbq = sql;
const prefCache = new Map(); // tgId -> {v, at}
const opts = new Map();      // tgId -> {on, lead}  (فقط کسانی که چیزی رو تغییر دادن)
let subs = null;             // Map tgId -> tz
let subsAt = 0, subsFail = 0;
let sent = null;             // Map eventId -> {t, u:Set}
let running = false;
const dead = new Set();      // کسانی که ربات رو بلاک کردن (تا بارگیری بعدی لیست)

export function getSync(id) {
  const c = prefCache.get(String(id));
  return c ? c.v : (opts.get(String(id)) || cleanPref({}));
}

export async function get(id) {
  const k = String(id), c = prefCache.get(k);
  if (c && Date.now() - c.at < PREF_TTL) return c.v;
  let v = opts.get(k) || cleanPref({});
  try {
    const r = await withTmo(dbq`SELECT v FROM bot_settings WHERE k = ${'nalert:' + k}`);
    if (r[0] && r[0].v) v = cleanPref(JSON.parse(r[0].v));
  } catch (e) { /* همون مقدار حافظه یا پیش‌فرض */ }
  prefCache.set(k, { v, at: Date.now() });
  return v;
}

export async function set(id, patch) {
  const k = String(id), cur = await get(k), v = cleanPref(Object.assign({}, cur, patch || {}));
  prefCache.set(k, { v, at: Date.now() });
  opts.set(k, v);
  try {
    await withTmo(dbq`INSERT INTO bot_settings (k, v) VALUES (${'nalert:' + k}, ${JSON.stringify(v)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`);
  } catch (e) { console.error('news alert pref save:', e && e.message); }
  return v;
}

async function loadAll(now) {
  const links = await withTmo(dbq`SELECT tg_id, tz FROM tg_links`);
  const rows = await withTmo(dbq`SELECT k, v FROM bot_settings WHERE k LIKE 'nalert:%'`);
  const s = new Map();
  for (const r of links) s.set(String(r.tg_id), r.tz || 'Asia/Tehran');
  for (const r of rows) {
    try { opts.set(String(r.k).slice(7), cleanPref(JSON.parse(r.v))); } catch (e) { /* ignore */ }
  }
  if (!sent) {
    sent = new Map();
    try {
      const r = await withTmo(dbq`SELECT v FROM bot_settings WHERE k = 'nalert_sent'`);
      const o = r[0] && r[0].v ? JSON.parse(r[0].v) : {};
      for (const id of Object.keys(o)) sent.set(id, { t: Number(o[id].t) || 0, u: new Set((o[id].u || []).map(String)) });
    } catch (e) { /* از صفر شروع می‌کنیم */ }
  }
  subs = s; subsAt = now; dead.clear();
}

async function persistSent(now) {
  for (const [id, e] of sent) if (e.t < now - 48 * 3600e3) sent.delete(id);
  const o = {};
  for (const [id, e] of sent) o[id] = { t: e.t, u: [...e.u] };
  try {
    await withTmo(dbq`INSERT INTO bot_settings (k, v) VALUES ('nalert_sent', ${JSON.stringify(o)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`);
  } catch (e) { console.error('news alert sent save:', e && e.message); }
}

const FLAG = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿', CHF: '🇨🇭', CNY: '🇨🇳' };
const TZ_FA = { 'Asia/Tehran': 'تهران', UTC: 'UTC', 'Asia/Dubai': 'دبی', 'Europe/Istanbul': 'استانبول' };
const FA = '۰۱۲۳۴۵۶۷۸۹';
const fa = (x) => String(x).replace(/[0-9]/g, (d) => FA[d]);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function hm(ts, tz) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(ts); }
  catch (e) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(ts); }
}

export function buildText(events, tz, now) {
  const first = events[0], mins = Math.max(1, Math.round((first.d - now) / 60000));
  let t = '<b>🔴 هشدار خبر قرمز</b>\n';
  t += '<b>' + fa(mins) + ' دقیقه</b> دیگه ' + (events.length > 1 ? 'چند خبر مهم' : 'یه خبر مهم') + ' می‌آد (ساعت ' + fa(hm(first.d, tz)) + ' به وقت ' + esc(TZ_FA[tz] || tz) + ').\n';
  for (const e of events) {
    t += '\n' + fa(hm(e.d, tz)) + ' · ' + (FLAG[e.c] || '🌐') + ' <b>' + esc(e.c) + '</b> · ' + esc(e.t);
    const fp = [];
    if (e.f) fp.push('پیش‌بینی ' + esc(fa(e.f)));
    if (e.p) fp.push('قبلی ' + esc(fa(e.p)));
    if (fp.length) t += '\n      ' + fp.join(' · ');
  }
  t += '\n\nاگه معامله‌ی باز داری، قبل از خبر چکش کن؛ نوسان و اسپرد زیاد می‌شه.';
  t += '\n<i>خاموش کردن یا تغییر زمان: /settings</i>';
  return t;
}

export async function tick(ctx, now = Date.now()) {
  if (running) return 0;
  const evs = (ctx.events() || []).filter((e) => e.i === 'High' && e.d > now && e.d - now <= MAXLEAD * 60e3).sort((a, b) => a.d - b.d);
  if (!evs.length) return 0;
  running = true;
  try {
    if (!subs || now - subsAt >= SUBS_TTL) {
      if (!subs || now - subsFail >= 120e3) {
        try { await loadAll(now); } catch (e) { subsFail = now; console.error('news alert load:', e && e.message); }
      }
    }
    if (!subs) return 0;
    if (!sent) sent = new Map();
    let n = 0, changed = false;
    for (const [id, tz] of subs) {
      const o = opts.get(id) || DEF;
      if (!o.on || dead.has(id)) continue;
      const mine = evs.filter((e) => e.d - now <= o.lead * 60e3 && !(sent.get(e.id) && sent.get(e.id).u.has(id)));
      if (!mine.length) continue;
      let done = false;
      try {
        await ctx.send(id, buildText(mine, tz, now));
        done = true; n++;
      } catch (e) {
        const m = String((e && e.message) || e);
        done = /\b403\b|\b400\b|blocked|deactivated|chat not found|forbidden/i.test(m); // کاربر ربات رو بلاک کرده؛ دیگه تلاش نکن
        if (done) dead.add(id);
        if (!done) console.error('news alert send:', id, m.slice(0, 120));
      }
      if (done) {
        for (const e of mine) { const x = sent.get(e.id) || { t: e.d, u: new Set() }; x.u.add(id); sent.set(e.id, x); }
        changed = true;
      }
    }
    if (changed) await persistSent(now);
    return n;
  } finally { running = false; }
}

let timer = null;
export function start(ctx) {
  if (ctx.db) dbq = ctx.db;
  if (timer) return;
  timer = setInterval(() => { tick(ctx).catch((e) => console.error('news alert tick:', e && e.message)); }, TICK_MS);
  if (timer.unref) timer.unref();
}

// فقط برای تست
export function _reset(db) { dbq = db || sql; prefCache.clear(); opts.clear(); subs = null; sent = null; subsAt = 0; subsFail = 0; running = false; dead.clear(); }

// END-OF-FILE lib/newsalert.js
