// لایهٔ «ابر هوش»: هر مدل هوش مصنوعی که کلیدش رو بدی (OpenAI، DeepSeek، Mistral، OpenRouter، xAI/Grok، Anthropic/Claude یا هر API سازگار با OpenAI)
// با همون مجموعه اسکیل‌های مایکی کار می‌کنه. کلیدها فقط از متغیرهای محیطی Render خونده می‌شن و هیچ‌جا ذخیره یا چاپ نمی‌شن.
// Groq و Gemini توی aicore.js هستن؛ این فایل بقیه رو اضافه می‌کنه.

const PRESETS = [
  { id: 'openai',     kind: 'openai',    env: 'OPENAI_API_KEY',     base: 'https://api.openai.com/v1',     model: 'gpt-4o-mini',          modelEnv: 'OPENAI_MODEL',     vision: true,  strong: false },
  { id: 'anthropic',  kind: 'anthropic', env: 'ANTHROPIC_API_KEY',  base: 'https://api.anthropic.com/v1',  model: 'claude-sonnet-5-5',    modelEnv: 'ANTHROPIC_MODEL',  vision: true,  strong: true, pdf: true },
  { id: 'deepseek',   kind: 'openai',    env: 'DEEPSEEK_API_KEY',   base: 'https://api.deepseek.com/v1',   model: 'deepseek-chat',        modelEnv: 'DEEPSEEK_MODEL',   vision: false, strong: true },
  { id: 'mistral',    kind: 'openai',    env: 'MISTRAL_API_KEY',    base: 'https://api.mistral.ai/v1',     model: 'mistral-large-latest', modelEnv: 'MISTRAL_MODEL',    vision: false, strong: true },
  { id: 'xai',        kind: 'openai',    env: 'XAI_API_KEY',        base: 'https://api.x.ai/v1',           model: 'grok-3-mini',          modelEnv: 'XAI_MODEL',        vision: false, strong: true },
  { id: 'openrouter', kind: 'openai',    env: 'OPENROUTER_API_KEY', base: 'https://openrouter.ai/api/v1',  model: 'openrouter/auto',      modelEnv: 'OPENROUTER_MODEL', vision: false, strong: true }
];
const okKey = (k) => /^[A-Za-z0-9._~+\/=-]{12,300}$/.test(String(k || '').trim());
const okUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' && x.hostname.includes('.') && !/^(\d{1,3}\.){3}\d{1,3}$/.test(x.hostname); } catch (e) { return false; } };
const okModel = (m) => /^[A-Za-z0-9._\/:@-]{2,80}$/.test(String(m || ''));

// فهرست مدل‌های اضافه که الان کلیدشون هست
export function extraProviders(env = process.env) {
  const out = [];
  for (const p of PRESETS) {
    const key = String(env[p.env] || '').trim(); if (!okKey(key)) continue;
    const base = p.id === 'openai' && okUrl(env.OPENAI_BASE_URL) ? String(env.OPENAI_BASE_URL).replace(/\/+$/, '') : p.base;
    const model = okModel(env[p.modelEnv]) ? String(env[p.modelEnv]).trim() : p.model;
    out.push({ id: p.id, kind: p.kind, key, base, model, vision: p.vision, strong: p.strong, pdf: !!p.pdf, search: false });
  }
  // هر API سازگار با OpenAI: AI_EXTRA='[{"id":"my","url":"https://.../v1","key":"...","model":"...","vision":false,"strong":true}]'
  try {
    const arr = JSON.parse(String(env.AI_EXTRA || '[]'));
    for (const x of Array.isArray(arr) ? arr.slice(0, 6) : []) {
      if (!x || !/^[a-z0-9_-]{2,20}$/i.test(x.id || '') || !okKey(x.key) || !okUrl(x.url) || !okModel(x.model)) continue;
      if (out.some((o) => o.id === x.id)) continue;
      out.push({ id: String(x.id).toLowerCase(), kind: 'openai', key: String(x.key).trim(), base: String(x.url).replace(/\/+$/, ''), model: String(x.model), vision: !!x.vision, strong: x.strong !== false, pdf: false, search: false });
    }
  } catch (e) { /* JSON خراب: نادیده */ }
  return out;
}
export const maskTail = (k) => '…' + String(k || '').slice(-4);

function classify(status, txt) {
  const s = String(txt || '');
  if (status === 429 || status === 529 || status === 503 || status === 502) return 'ai_busy';
  if (status === 401 || status === 403) return 'ai_key';
  if (status === 404 || (status === 400 && /model.*(not|does)|invalid model|unknown model/i.test(s))) return 'ai_model';
  if (status === 402) return 'ai_busy'; // اعتبار تموم شده
  return 'ai_failed';
}
const cut = (t, key) => String(t || '').split(key).join('[KEY]').slice(0, 250);

function toOpenAI(system, contents) {
  const msgs = [{ role: 'system', content: system }];
  for (const c of contents || []) {
    const parts = c.parts || [], txt = parts.map((p) => p.text || '').join(''), imgs = parts.filter((p) => p.inlineData && /^image\//.test(p.inlineData.mimeType));
    if (c.role === 'model') { msgs.push({ role: 'assistant', content: txt }); continue; }
    if (!imgs.length) msgs.push({ role: 'user', content: txt });
    else msgs.push({ role: 'user', content: [{ type: 'text', text: txt || 'این عکس رو بررسی کن.' }].concat(imgs.map((p) => ({ type: 'image_url', image_url: { url: 'data:' + p.inlineData.mimeType + ';base64,' + p.inlineData.data } }))) });
  }
  return msgs;
}
function toAnthropic(contents) {
  return (contents || []).map((c) => {
    const parts = c.parts || [], blocks = [];
    for (const p of parts) {
      if (p.inlineData && /^image\//.test(p.inlineData.mimeType)) blocks.push({ type: 'image', source: { type: 'base64', media_type: p.inlineData.mimeType, data: p.inlineData.data } });
      else if (p.inlineData && p.inlineData.mimeType === 'application/pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.inlineData.data } });
    }
    const txt = parts.map((p) => p.text || '').join('');
    blocks.push({ type: 'text', text: txt || (blocks.length ? 'این فایل رو بررسی کن.' : '.') });
    return { role: c.role === 'model' ? 'assistant' : 'user', content: c.role === 'model' ? txt : blocks };
  });
}

async function post(url, headers, body, timeoutMs, key) {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), timeoutMs);
  try { return await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body), signal: ac.signal }); }
  catch (e) { const er = new Error('ai_timeout'); er.code = 'ai_timeout'; throw er; }
  finally { clearTimeout(to); }
}
async function openaiCall(p, { system, contents, maxTokens = 1500, temperature = 0.7, timeoutMs = 45000 }) {
  const msgs = toOpenAI(system, contents);
  const newStyle = (p.id === 'openai' && /^(o\d|gpt-5)/i.test(p.model));
  const variants = [
    Object.assign({ model: p.model, messages: msgs }, newStyle ? { max_completion_tokens: maxTokens + 2000 } : { max_tokens: maxTokens, temperature }),
    { model: p.model, messages: msgs, max_completion_tokens: maxTokens + 2000 },
    { model: p.model, messages: msgs }
  ];
  let last;
  for (const body of variants) {
    const r = await post(p.base + '/chat/completions', { Authorization: 'Bearer ' + p.key }, body, timeoutMs, p.key);
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      const reply = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (!reply) { const er = new Error('ai_empty'); er.code = 'ai_empty'; throw er; }
      return reply;
    }
    const t = await r.text().catch(() => '');
    console.error(p.id + ' error', r.status, p.model, cut(t, p.key));
    const er = new Error(classify(r.status, t)); er.code = er.message; er.status = r.status; last = er;
    if (r.status !== 400) throw er; // فقط خطای ۴۰۰ (پارامتر نامناسب) با قالب بعدی امتحان می‌شه
  }
  throw last;
}
async function anthropicCall(p, { system, contents, maxTokens = 1500, temperature = 0.7, timeoutMs = 60000 }) {
  const body = { model: p.model, max_tokens: maxTokens + 1000, system, messages: toAnthropic(contents), temperature: Math.min(1, temperature) };
  const r = await post(p.base + '/messages', { 'x-api-key': p.key, 'anthropic-version': '2023-06-01' }, body, timeoutMs, p.key);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('anthropic error', r.status, p.model, cut(t, p.key));
    const er = new Error(classify(r.status, t)); er.code = er.message; er.status = r.status; throw er;
  }
  const j = await r.json().catch(() => ({}));
  const reply = (j.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('').trim();
  if (!reply) { const er = new Error('ai_empty'); er.code = 'ai_empty'; throw er; }
  return reply;
}
export async function callExtra(p, opts) { return p.kind === 'anthropic' ? anthropicCall(p, opts) : openaiCall(p, opts); }

// آمار ساده برای پنل ادمین
const st = new Map();
export const noteExtra = (id, ok) => { const s = st.get(id) || { ok: 0, fail: 0 }; if (ok) s.ok++; else s.fail++; st.set(id, s); };
export const extraInfo = () => extraProviders().map((p) => Object.assign({ id: p.id, model: p.model, vision: p.vision, strong: p.strong, tail: maskTail(p.key) }, st.get(p.id) || { ok: 0, fail: 0 }));

// END-OF-FILE lib/models.js
