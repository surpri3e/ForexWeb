// دستیار هوش مصنوعی (Groq یا Gemini) برای سایت، پیوی ربات و گروه‌ها: تنظیمات مرکزی، سقف‌ها و فراخوانی.
// کلید فقط از متغیر محیطی GROQ_API_KEY یا GEMINI_API_KEY خونده می‌شه (روی Render)؛ هیچ‌جا توی دیتابیس یا لاگ نوشته نمی‌شه.
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
  if (p.model != null) { const m = String(p.model).trim(); if (m === '' || /^[A-Za-z0-9._\/:-]{3,60}$/.test(m)) o.model = m; }
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
  if (patch && patch.model != null) autoModel = ''; // مدل دستی عوض شد: انتخاب خودکار قبلی کنار می‌ره
  cfg = Object.assign({}, cfg, cleanAiConfig(patch || {}));
  try { await db`INSERT INTO bot_settings (k, v) VALUES ('ai_cfg', ${JSON.stringify(cfg)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`; }
  catch (e) { console.error('ai cfg save:', e && e.message); }
  return getAiConfig();
}

const isGsk = (k) => /^gsk_/.test(String(k || '').trim());
// اگه کلید Groq (gsk_...) اشتباهی توی متغیر GEMINI_API_KEY گذاشته شده باشه هم، به‌عنوان Groq شناخته می‌شه
const keyOf = () => { const k = String(process.env.GEMINI_API_KEY || '').trim(); return isGsk(k) ? '' : k; }; // کلید Gemini
const groqKey = () => { const k = String(process.env.GROQ_API_KEY || '').trim(); if (k) return k; const g = String(process.env.GEMINI_API_KEY || '').trim(); return isGsk(g) ? g : ''; }; // کلید Groq (اگه باشه اولویت داره)
export const hasKey = () => !!(groqKey() || keyOf());
export const activeProvider = () => (groqKey() ? 'groq' : keyOf() ? 'gemini' : '');
export const keyKind = (k) => (/^gsk_/.test(String(k || '').trim()) ? 'groq' : 'gemini');
export const envNameFor = (kind) => (kind === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY');
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_DEFAULT = 'openai/gpt-oss-120b';
const groqModel = () => (cfg.model && !/^gemini/i.test(cfg.model) ? cfg.model : '') || process.env.GROQ_MODEL || GROQ_DEFAULT;
let autoModel = ''; // اگه مدل پیش‌فرض وجود نداشت، خودکار از فهرست خود گوگل انتخاب می‌شه
const geminiModel = () => autoModel || (cfg.model && (/^gemini/i.test(cfg.model) || !groqKey()) ? cfg.model : '') || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
export const geminiModelName = () => geminiModel();
export const groqModelName = () => groqModel();
export const currentModel = () => (groqKey() ? groqModel() : geminiModel());
const endpoint = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
export function aiStatus() {
  return { key: hasKey(), provider: activeProvider(), model: currentModel(), site: !!cfg.site, private: !!cfg.private, group: !!cfg.group, on: { site: hasKey() && cfg.site, private: hasKey() && cfg.private, group: hasKey() && cfg.group } };
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
// شمارنده‌ها توی دیتابیس هم نوشته می‌شن تا با ری‌استارت سرور (Render) صفر نشن
const saveCount = (k, db = sql) => { const day = k.split('|')[1]; Promise.resolve(db`INSERT INTO ai_usage (k, n, day) VALUES (${k}, ${n0(k)}, ${day}) ON CONFLICT (k) DO UPDATE SET n = EXCLUDED.n`).catch((e) => console.error('ai usage save:', e && e.message)); };
export async function loadAiUsage(db = sql) {
  try {
    const day = tehDay();
    const rows = await db`SELECT k, n FROM ai_usage WHERE day = ${day}`;
    for (const r of rows) counts.set(r.k, Math.max(n0(r.k), Number(r.n) || 0));
    await db`DELETE FROM ai_usage WHERE day < ${day}`;
  } catch (e) { console.error('ai usage load:', e && e.message); }
}
function bump(scope, uid, chatId) {
  const inc = (k) => { counts.set(k, n0(k) + 1); saveCount(k); };
  if (scope === 'group') { inc(ck('g', chatId)); inc(ck('gu', chatId + ':' + uid)); lastAt.set('g:' + chatId + ':' + uid, Date.now()); }
  else if (scope === 'private') { inc(ck('p', uid)); lastAt.set('p:' + uid, Date.now()); }
  else inc(ck('s', uid));
}
export function leftAi(scope, uid, chatId) {
  if (scope === 'group') return Math.max(0, cfg.groupUserDaily - n0(ck('gu', chatId + ':' + uid)));
  if (scope === 'private') return Math.max(0, cfg.privateDaily - n0(ck('p', uid)));
  return Math.max(0, cfg.siteDaily - n0(ck('s', uid)));
}
// پیام «سقفت پر شد» رو فقط یک بار در روز برای هر نفر بفرست
export function shouldWarn(scope, uid, chatId) { const k = 'w:' + scope + ':' + chatId + ':' + uid + '|' + tehDay(); if (warned.has(k)) return false; warned.add(k); return true; }

// ---------- فراخوانی Gemini ----------
// علت خطای گوگل رو به یک کد قابل‌فهم تبدیل می‌کنه (تا ادمین بدونه کلید مشکل داره یا مدل یا منطقه)
function classify(status, txt) {
  const s = String(txt || '');
  if (status === 429) return 'ai_busy';
  if (status === 404) return 'ai_model';
  if (status === 401 || status === 403 || (status === 400 && /API[_ ]?KEY|api key not valid/i.test(s))) return /location|region|not supported/i.test(s) ? 'ai_region' : 'ai_key';
  return 'ai_failed';
}
// بهترین مدل flash پایدار از فهرست گوگل (فقط وقتی مدل فعلی پیدا نشد)
async function pickModel() {
  const v = await verifyKey(keyOf());
  if (!v.ok || !v.models || !v.models.length) return '';
  const ok = v.models.filter((m) => /flash/.test(m) && !/(lite|image|tts|live|audio|thinking|exp|embedding|robotics|computer)/.test(m));
  const ver = (m) => { const x = /gemini-(\d+(?:\.\d+)?)/.exec(m); return x ? parseFloat(x[1]) : 0; };
  ok.sort((a, b) => (/preview/.test(a) ? 1 : 0) - (/preview/.test(b) ? 1 : 0) || ver(b) - ver(a));
  return ok[0] || '';
}
async function callOnce({ system, contents, maxTokens = 1500, temperature = 0.7, timeoutMs = 45000, _model }) {
  const key = keyOf();
  if (!key) { const e = new Error('ai_off'); e.code = 'ai_off'; throw e; }
  const payload = (thinking) => ({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: Object.assign({ temperature, maxOutputTokens: maxTokens }, thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) });
  const call = async (thinking) => {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeoutMs);
    try { return await fetch(endpoint(_model || geminiModel()), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload(thinking)), signal: ac.signal }); }
    finally { clearTimeout(to); }
  };
  let r;
  try { r = await call(true); if (r.status === 400) r = await call(false); }
  catch (e) { const er = new Error('ai_timeout'); er.code = 'ai_timeout'; throw er; }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('gemini error', r.status, geminiModel(), String(t).split(key).join('[KEY]').slice(0, 300));
    const code = classify(r.status, t);
    const er = new Error(code); er.code = code; er.status = r.status; throw er;
  }
  const j = await r.json();
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const reply = parts.filter((p) => p && typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
  if (!reply) { const er = new Error('ai_empty'); er.code = 'ai_empty'; throw er; }
  return reply;
}
const GEMINI_CANDIDATES = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
export async function callGemini(opts) {
  try { return await callOnce(opts); }
  catch (e) {
    if (e.code !== 'ai_model' || opts._retried) throw e;
    const before = geminiModel();
    // اول از فهرست خود گوگل، بعد چند اسم رایج امتحان می‌شه تا یکی جواب بده
    const tries = [];
    try { const m = await pickModel(); if (m) tries.push(m); } catch (x) { /* ignore */ }
    for (const m of GEMINI_CANDIDATES) if (!tries.includes(m)) tries.push(m);
    for (const m of tries) {
      if (m === before) continue;
      try { const r = await callOnce(Object.assign({}, opts, { _model: m })); autoModel = m; console.error('gemini model fallback:', before, '->', m); return r; }
      catch (e2) { if (e2.code !== 'ai_model') throw e2; }
    }
    throw e;
  }
}
// ---------- فراخوانی Groq (قالب OpenAI) ----------
function classifyGroq(status, txt) {
  const s = String(txt || '');
  if (status === 429) return 'ai_busy';
  if (status === 401 || status === 403) return 'ai_key';
  if (status === 404 || (status === 400 && /model_not_found|decommissioned|does not exist|not supported/i.test(s))) return 'ai_model';
  return 'ai_failed';
}
async function callGroqOnce({ system, contents, maxTokens = 1500, temperature = 0.7, timeoutMs = 45000 }, withEffort) {
  const key = groqKey();
  if (!key) { const e = new Error('ai_off'); e.code = 'ai_off'; throw e; }
  const messages = [{ role: 'system', content: system }].concat((contents || []).map((c) => ({ role: c.role === 'model' ? 'assistant' : 'user', content: (c.parts || []).map((p) => p.text || '').join('') })));
  const body = Object.assign({ model: groqModel(), messages, temperature, max_completion_tokens: maxTokens + (withEffort ? 700 : 0) }, withEffort ? { reasoning_effort: 'low' } : {});
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeoutMs);
  let r;
  try { r = await fetch(GROQ_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal: ac.signal }); }
  catch (e) { const er = new Error('ai_timeout'); er.code = 'ai_timeout'; throw er; }
  finally { clearTimeout(to); }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (r.status === 400 && withEffort && /reasoning/i.test(t)) return callGroqOnce({ system, contents, maxTokens, temperature, timeoutMs }, false);
    console.error('groq error', r.status, groqModel(), String(t).split(key).join('[KEY]').slice(0, 300));
    const code = classifyGroq(r.status, t);
    const er = new Error(code); er.code = code; er.status = r.status; throw er;
  }
  const j = await r.json();
  const reply = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
  if (!reply) { const er = new Error('ai_empty'); er.code = 'ai_empty'; throw er; }
  return reply;
}
export const callGroq = (opts) => callGroqOnce(opts || {}, true);
// اول Groq (اگه کلیدش هست)، اگه خطا داد Gemini (اگه کلیدش هست) پشتیبانه
let lastProvider = '';
export const lastUsedProvider = () => lastProvider;
export async function callAi(opts) {
  const order = []; if (groqKey()) order.push('groq'); if (keyOf()) order.push('gemini');
  if (!order.length) { const e = new Error('ai_off'); e.code = 'ai_off'; throw e; }
  let last = null;
  for (const p of order) {
    try { const reply = p === 'groq' ? await callGroq(opts) : await callGemini(opts); lastProvider = p; return reply; }
    catch (e) { last = e; if (order.length > 1 && p === 'groq') console.error('groq failed, falling back to gemini:', e && e.code); }
  }
  throw last;
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
    const reply = await callAi({ system, contents, maxTokens: maxTokens || (scope === 'group' ? 700 : 1500) });
    bump(scope, uid, chatId);
    return { ok: true, reply, left: leftAi(scope, uid, chatId) };
  } catch (e) { return { ok: false, reason: e.code || 'ai_failed' }; }
}

// بررسی کلید و مدل (بدون چاپ کلید)
export async function verifyKey(key) {
  if (keyKind(key) === 'groq') {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) return { ok: false, status: r.status, provider: 'groq' };
      const j = await r.json().catch(() => ({}));
      return { ok: true, status: 200, provider: 'groq', models: Array.isArray(j.data) ? j.data.map((m) => m.id) : [] };
    } catch (e) { return { ok: false, status: 0, provider: 'groq', error: String(e && e.name || 'error') }; }
  }
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
  try { const reply = await callAi({ system: 'Reply with one short word.', contents: [{ role: 'user', parts: [{ text: 'سلام' }] }], maxTokens: 30, timeoutMs: 20000 }); return { ok: true, ms: Date.now() - t0, reply: reply.slice(0, 40), provider: lastProvider }; }
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
// END-OF-FILE aicore.js
