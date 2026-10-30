// دستیار هوش مصنوعی (Gemini) برای سایت، پیوی ربات و گروه‌ها: تنظیمات مرکزی، سقف‌ها و فراخوانی.
// کلید فقط از متغیر محیطی GEMINI_API_KEY خونده می‌شه (روی Render)؛ هیچ‌جا توی دیتابیس یا لاگ نوشته نمی‌شه.
import { sql } from './db.js';

export const BASE_PROMPT = `تو «دستیار Surpri3eFX» هستی؛ یه مربی و همراه ترید برای معامله‌گرهای فارکس/کریپتو/شاخص که فارسی صحبت می‌کنن.
- همیشه فارسی و محاوره‌ای-محترمانه جواب بده؛ اصطلاحات تخصصی (TP, SL, RR, Drawdown, Liquidity و…) رو انگلیسی بنویس.
- کوتاه و کاربردی باش: بیشتر ۱۵۰ تا ۳۰۰ کلمه، با بولت‌پوینت وقتی لازمه.
- سیگنال قطعی نده و سود تضمین نکن. تحلیل‌ها آموزشی‌ان و مسئولیت تصمیم با خود کاربره؛ فقط اگه واقعاً مرتبطه، یه جمله یادآوری کن.
- روی مدیریت ریسک، روانشناسی و انضباط تمرکز کن.
- اگه سؤال به ترید ربطی نداره، مختصر جواب بده و به موضوع ترید برگرد.`;
const GROUP_PROMPT = '\n\nاین جواب توی یه گروه تلگرام فرستاده می‌شه: خیلی کوتاه بنویس (حداکثر حدود ۱۲۰ کلمه)، بدون تیتر و جدول، و فقط به سؤالی که پرسیده شده جواب بده.';
const PRIVATE_PROMPT = '\n\nاین جواب توی چت تلگرام فرستاده می‌شه: حداکثر حدود ۲۰۰ کلمه، بدون جدول.';

const DEFAULTS = {
  site: true, private: true, group: true,        // کجا فعاله
  siteDaily: 60, privateDaily: 40,                // سقف روزانهٔ هر کاربر
  groupUserDaily: 10, groupDaily: 60,             // گروه: هر کاربر در روز و کل گروه در روز
  groupCooldown: 20, privateCooldown: 3,          // ثانیه بین دو سؤال پشت‌سرهم
  groupTrigger: 'mention',                        // cmd = فقط /ai ، mention = /ai و منشن و ریپلای به ربات
  model: '', prompt: ''
};
const LIMITS = { siteDaily: [1, 1000], privateDaily: [1, 1000], groupUserDaily: [1, 200], groupDaily: [1, 2000], groupCooldown: [0, 3600], privateCooldown: [0, 600] };
let cfg = Object.assign({}, DEFAULTS);

export const getAiConfig = () => Object.assign({}, cfg);
export function cleanAiConfig(p) {
  const o = {};
  for (const k of ['site', 'private', 'group']) if (p[k] != null) o[k] = !!p[k];
  for (const k of Object.keys(LIMITS)) if (p[k] != null) { const n = Math.round(Number(p[k])); if (Number.isFinite(n)) o[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], n)); }
  if (p.groupTrigger != null && ['cmd', 'mention'].includes(p.groupTrigger)) o.groupTrigger = p.groupTrigger;
  if (p.model != null) { const m = String(p.model).trim(); if (m === '' || /^[A-Za-z0-9._-]{3,60}$/.test(m)) o.model = m; }
  if (p.prompt != null) o.prompt = String(p.prompt).slice(0, 500);
  return o;
}
export async function loadAiConfig(db = sql) {
  try {
    const r = await db`SELECT v FROM bot_settings WHERE k = 'ai_cfg'`;
    if (r[0] && r[0].v) cfg = Object.assign({}, DEFAULTS, cleanAiConfig(JSON.parse(r[0].v)));
  } catch (e) { console.error('ai cfg load:', e && e.message); }
  return getAiConfig();
}
export async function setAiConfig(patch, db = sql) {
  cfg = Object.assign({}, cfg, cleanAiConfig(patch || {}));
  try { await db`INSERT INTO bot_settings (k, v) VALUES ('ai_cfg', ${JSON.stringify(cfg)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`; }
  catch (e) { console.error('ai cfg save:', e && e.message); }
  return getAiConfig();
}

const keyOf = () => process.env.GEMINI_API_KEY || '';
export const hasKey = () => !!keyOf();
export const currentModel = () => cfg.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const endpoint = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
export function aiStatus() {
  return { key: hasKey(), model: currentModel(), site: !!cfg.site, private: !!cfg.private, group: !!cfg.group, on: { site: hasKey() && cfg.site, private: hasKey() && cfg.private, group: hasKey() && cfg.group } };
}

// ---------- سقف‌ها (توی حافظه؛ با ری‌استارت سرور صفر می‌شن) ----------
const tehDay = (ms = Date.now()) => new Date(ms + 12600000).toISOString().slice(0, 10);
const counts = new Map(), lastAt = new Map(), warned = new Set();
setInterval(() => { const d = tehDay(); for (const k of [...counts.keys()]) if (!k.endsWith('|' + d)) counts.delete(k); for (const k of [...warned]) if (!k.endsWith('|' + d)) warned.delete(k); const t = Date.now() - 3600e3; for (const [k, v] of lastAt) if (v < t) lastAt.delete(k); }, 3600e3).unref();
const ck = (scope, id) => scope + ':' + id + '|' + tehDay();
const n0 = (k) => counts.get(k) || 0;
// scope: site | private | group؛ uid: شناسهٔ کاربر؛ chatId: فقط برای گروه
export function checkAi(scope, uid, chatId) {
  if (!hasKey()) return { ok: false, reason: 'off' };
  if (!cfg[scope]) return { ok: false, reason: 'disabled' };
  const now = Date.now();
  if (scope === 'group') {
    if (n0(ck('g', chatId)) >= cfg.groupDaily) return { ok: false, reason: 'group_daily' };
    if (n0(ck('gu', chatId + ':' + uid)) >= cfg.groupUserDaily) return { ok: false, reason: 'daily' };
    if (now - (lastAt.get('g:' + chatId + ':' + uid) || 0) < cfg.groupCooldown * 1000) return { ok: false, reason: 'cooldown' };
  } else if (scope === 'private') {
    if (n0(ck('p', uid)) >= cfg.privateDaily) return { ok: false, reason: 'daily' };
    if (now - (lastAt.get('p:' + uid) || 0) < cfg.privateCooldown * 1000) return { ok: false, reason: 'cooldown' };
  } else if (n0(ck('s', uid)) >= cfg.siteDaily) return { ok: false, reason: 'daily' };
  return { ok: true };
}
function bump(scope, uid, chatId) {
  if (scope === 'group') { counts.set(ck('g', chatId), n0(ck('g', chatId)) + 1); counts.set(ck('gu', chatId + ':' + uid), n0(ck('gu', chatId + ':' + uid)) + 1); lastAt.set('g:' + chatId + ':' + uid, Date.now()); }
  else if (scope === 'private') { counts.set(ck('p', uid), n0(ck('p', uid)) + 1); lastAt.set('p:' + uid, Date.now()); }
  else counts.set(ck('s', uid), n0(ck('s', uid)) + 1);
}
export function leftAi(scope, uid, chatId) {
  if (scope === 'group') return Math.max(0, cfg.groupUserDaily - n0(ck('gu', chatId + ':' + uid)));
  if (scope === 'private') return Math.max(0, cfg.privateDaily - n0(ck('p', uid)));
  return Math.max(0, cfg.siteDaily - n0(ck('s', uid)));
}
// پیام «سقفت پر شد» رو فقط یک بار در روز برای هر نفر بفرست
export function shouldWarn(scope, uid, chatId) { const k = 'w:' + scope + ':' + chatId + ':' + uid + '|' + tehDay(); if (warned.has(k)) return false; warned.add(k); return true; }

// ---------- فراخوانی Gemini ----------
export async function callGemini({ system, contents, maxTokens = 1500, temperature = 0.7, timeoutMs = 45000 }) {
  const key = keyOf();
  if (!key) { const e = new Error('ai_off'); e.code = 'ai_off'; throw e; }
  const payload = (thinking) => ({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: Object.assign({ temperature, maxOutputTokens: maxTokens }, thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) });
  const call = async (thinking) => {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeoutMs);
    try { return await fetch(endpoint(currentModel()), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload(thinking)), signal: ac.signal }); }
    finally { clearTimeout(to); }
  };
  let r;
  try { r = await call(true); if (r.status === 400) r = await call(false); }
  catch (e) { const er = new Error('ai_timeout'); er.code = 'ai_timeout'; throw er; }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('gemini error', r.status, String(t).split(key).join('[KEY]').slice(0, 300));
    const er = new Error(r.status === 429 ? 'ai_busy' : 'ai_failed'); er.code = r.status === 429 ? 'ai_busy' : 'ai_failed'; er.status = r.status; throw er;
  }
  const j = await r.json();
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const reply = parts.filter((p) => p && typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
  if (!reply) { const er = new Error('ai_empty'); er.code = 'ai_empty'; throw er; }
  return reply;
}
// پیام‌های متنی [{role:'user'|'assistant', text}] -> قالب Gemini (نقش‌ها یکی‌درمیون و شروع با user)
export function toContents(msgs) {
  const out = [];
  for (const m of msgs || []) {
    const text = typeof m.text === 'string' ? m.text.trim().slice(0, 2000) : '';
    if (!text) continue;
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (out.length && out[out.length - 1].role === role) { out[out.length - 1].parts[0].text += '\n' + text; continue; }
    out.push({ role, parts: [{ text }] });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
// پرسش: سقف‌ها رو چک می‌کنه، می‌پرسه و فقط بعد از جواب موفق از سهمیه کم می‌کنه
export async function askAi({ scope, uid, chatId, msgs, extraSystem = '', maxTokens }) {
  const chk = checkAi(scope, uid, chatId);
  if (!chk.ok) return chk;
  const contents = toContents(msgs);
  if (!contents.length || contents[contents.length - 1].role !== 'user') return { ok: false, reason: 'bad_request' };
  let system = BASE_PROMPT + (scope === 'group' ? GROUP_PROMPT : scope === 'private' ? PRIVATE_PROMPT : '') + (cfg.prompt ? '\n\n' + cfg.prompt : '') + extraSystem;
  try {
    const reply = await callGemini({ system, contents, maxTokens: maxTokens || (scope === 'group' ? 700 : 1500) });
    bump(scope, uid, chatId);
    return { ok: true, reply, left: leftAi(scope, uid, chatId) };
  } catch (e) { return { ok: false, reason: e.code || 'ai_failed' }; }
}

// بررسی کلید و مدل (بدون چاپ کلید)
export async function verifyKey(key) {
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { ok: false, status: r.status };
    const j = await r.json().catch(() => ({}));
    const models = Array.isArray(j.models) ? j.models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name)).map((m) => m.name.replace('models/', '')) : [];
    return { ok: true, status: 200, models };
  } catch (e) { return { ok: false, status: 0, error: String(e && e.name || 'error') }; }
}
export async function pingModel() {
  const t0 = Date.now();
  try { const reply = await callGemini({ system: 'Reply with one short word.', contents: [{ role: 'user', parts: [{ text: 'سلام' }] }], maxTokens: 30, timeoutMs: 20000 }); return { ok: true, ms: Date.now() - t0, reply: reply.slice(0, 40) }; }
  catch (e) { return { ok: false, ms: Date.now() - t0, code: e.code || 'ai_failed', status: e.status || 0 }; }
}

// خروجی مارک‌داون Gemini -> HTML تلگرام
export function mdToTg(s) {
  let t = String(s == null ? '' : s).replace(/\r/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  t = t.replace(/```[a-z]*\n?([\s\S]*?)```/g, (m, c) => '<pre>' + c.trim() + '</pre>');
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/__([^_\n]+)__/g, '<b>$1</b>');
  t = t.replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, '<b>$1</b>');
  t = t.replace(/^\s*[*-]\s+/gm, '• ');
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,:;!؟]|$)/g, '$1<i>$2</i>');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}
