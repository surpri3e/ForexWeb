import { sql } from './db.js';

// خروجی نرخ‌ها: عکس یا فقط متن؛ برای هر گروه و هر کاربر خصوصی جدا، توی تنظیمات.
// کلیدها: شناسهٔ گروه (مثل -1001234) یا u<tgId> برای چت خصوصی. مقدار: 'i' (عکس، پیش‌فرض) یا 't' (متن).
// همه‌چیز توی یک ردیف bot_settings (rates_out) نگهداری می‌شه و توی حافظه هم هست؛ پس خوندنش به دیتابیس فشار نمیاره.

let dbq = sql;
const map = new Map();
let loaded = false, loading = null;
const DB_TMO = 8e3;
const withTmo = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('db_timeout')), DB_TMO))]);

export async function load() {
  if (loaded) return;
  if (!loading) {
    loading = (async () => {
      try {
        const r = await withTmo(dbq`SELECT v FROM bot_settings WHERE k = 'rates_out'`);
        const o = r[0] && r[0].v ? JSON.parse(r[0].v) : {};
        for (const k of Object.keys(o)) if (!map.has(k)) map.set(k, o[k] === 't' ? 't' : 'i');
        loaded = true;
      } catch (e) { /* بعداً دوباره */ }
      loading = null;
    })();
  }
  await loading;
}
export const key = (chat, isPrivate) => (isPrivate ? 'u' + chat : String(chat));
// عکس روشنه؟ (همگام؛ بعد از load درسته)
export const isImage = (k) => map.get(String(k)) !== 't';
export async function getImage(k) { await load(); return isImage(k); }
export async function setImage(k, on) {
  await load();
  map.set(String(k), on ? 'i' : 't');
  const o = {};
  for (const [a, v] of map) if (v === 't') o[a] = 't'; // فقط استثناها (متن) ذخیره می‌شن
  try { await withTmo(dbq`INSERT INTO bot_settings (k, v) VALUES ('rates_out', ${JSON.stringify(o)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`); }
  catch (e) { console.error('rates_out save:', e && e.message); }
  return !!on;
}
export function _reset(db) { dbq = db || sql; map.clear(); loaded = false; loading = null; }
export function start(ctx) { if (ctx && ctx.db) dbq = ctx.db; load().catch(() => {}); }

// END-OF-FILE lib/ratesout.js
