// سقف‌های خود ربات (غیر از هوش مصنوعی) برای فشار نیاوردن کاربرها و گروه‌ها. ادمین (صاحب ربات) هیچ سقفی نداره.
import { sql } from './db.js';

const DEF = { privateMin: 20, groupDaily: 400, groupUserDaily: 60, remindersMax: 20 };
const RANGE = { privateMin: [1, 200], groupDaily: [10, 5000], groupUserDaily: [3, 500], remindersMax: [1, 100] };
export const LIMIT_STEPS = { privateMin: [5, 'پیوی: پیام در دقیقهٔ هر کاربر'], groupDaily: [50, 'گروه: پاسخ ربات در روز'], groupUserDaily: [10, 'گروه: درخواست هر نفر در روز'], remindersMax: [5, 'یادآوری فعال هر نفر'] };
let cfg = Object.assign({}, DEF);
export const clean = (p) => { const o = {}; for (const k of Object.keys(RANGE)) if (p && p[k] != null) { const n = Math.round(Number(p[k])); if (Number.isFinite(n)) o[k] = Math.min(RANGE[k][1], Math.max(RANGE[k][0], n)); } return o; };
export const getLimits = () => Object.assign({}, cfg);
export async function loadLimits(db = sql) { try { const r = await db`SELECT v FROM bot_settings WHERE k = 'bot_limits'`; if (r[0] && r[0].v) cfg = Object.assign({}, DEF, clean(JSON.parse(r[0].v))); } catch (e) { console.error('limits load:', e && e.message); } return getLimits(); }
export async function setLimits(patch, db = sql) {
  cfg = Object.assign({}, cfg, clean(patch));
  try { await db`INSERT INTO bot_settings (k, v) VALUES ('bot_limits', ${JSON.stringify(cfg)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`; } catch (e) { console.error('limits save:', e && e.message); }
  return getLimits();
}
export const resetLimits = (db) => setLimits(DEF, db);

const day = (ms = Date.now()) => new Date(ms + 12600000).toISOString().slice(0, 10);
const cnt = new Map(), mins = new Map(), warned = new Set(), titles = new Map();
const totals = { day: day(), n: 0, kinds: {} };
function roll() { const d = day(); if (totals.day !== d) { totals.day = d; totals.n = 0; totals.kinds = {}; cnt.clear(); warned.clear(); titles.clear(); } }
setInterval(() => { roll(); const t = Date.now() - 120e3; for (const [k, v] of mins) { const a = v.filter((x) => x > t); if (a.length) mins.set(k, a); else mins.delete(k); } }, 600e3).unref();
// scope: private | group؛ نتیجه {ok, reason, warn} — warn یعنی این بار پیام «سقفت پر شد» رو بفرست (روزی یک بار)
export function checkAction(scope, uid, chatId, unlimited = false) {
  if (unlimited) return { ok: true };
  roll();
  const w = (k) => { if (warned.has(k)) return false; warned.add(k); return true; };
  if (scope === 'private') {
    const t = Date.now() - 60e3, a = (mins.get('p' + uid) || []).filter((x) => x > t);
    if (a.length >= cfg.privateMin) return { ok: false, reason: 'pm', warn: w('pm:' + uid + ':' + Math.floor(Date.now() / 60e3)) };
    return { ok: true };
  }
  if ((cnt.get('g' + chatId) || 0) >= cfg.groupDaily) return { ok: false, reason: 'g_daily', warn: w('gd:' + chatId) };
  if ((cnt.get('gu' + chatId + ':' + uid) || 0) >= cfg.groupUserDaily) return { ok: false, reason: 'gu_daily', warn: w('gu:' + chatId + ':' + uid) };
  return { ok: true };
}
// بعد از هر جواب ربات صدا زده می‌شه (برای ادمین هم آمار ثبت می‌شه، فقط سقف نداره)
export function track(scope, uid, chatId, kind, title = '') {
  roll(); totals.n++; totals.kinds[kind] = (totals.kinds[kind] || 0) + 1;
  if (scope === 'private') { const a = mins.get('p' + uid) || []; a.push(Date.now()); mins.set('p' + uid, a); return; }
  cnt.set('g' + chatId, (cnt.get('g' + chatId) || 0) + 1);
  cnt.set('gu' + chatId + ':' + uid, (cnt.get('gu' + chatId + ':' + uid) || 0) + 1);
  if (title) titles.set(String(chatId), title);
}
export function usageStats() {
  roll();
  const groups = [...cnt.entries()].filter(([k]) => k.startsWith('g') && !k.startsWith('gu')).map(([k, n]) => ({ id: k.slice(1), n, title: titles.get(k.slice(1)) || '' })).sort((a, b) => b.n - a.n).slice(0, 5);
  return { day: totals.day, total: totals.n, kinds: Object.assign({}, totals.kinds), groups };
}
export const _reset = () => { cnt.clear(); mins.clear(); warned.clear(); titles.clear(); totals.n = 0; totals.kinds = {}; cfg = Object.assign({}, DEF); };

// END-OF-FILE limits.js
