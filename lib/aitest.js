// تست کلید هوش مصنوعی از روی خود سرور (همون جایی که ربات اجرا می‌شه): کلید رو جایی ذخیره نمی‌کنه و توی جواب هم برنمی‌گردونه.
import { keyKind, geminiModelName, groqModelName } from './aicore.js';

const CANDIDATES = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const shortMsg = (txt, key) => {
  let m = String(txt || '');
  try { const j = JSON.parse(m); m = (j.error && (j.error.message || j.error.status)) || m; } catch (e) { /* خام می‌مونه */ }
  return String(m).split(key).join('[KEY]').replace(/\s+/g, ' ').slice(0, 220);
};
async function req(fetchFn, url, opt, ms = 20000) {
  const t0 = Date.now();
  try {
    const r = await fetchFn(url, Object.assign({ signal: AbortSignal.timeout(ms) }, opt));
    const body = await r.text().catch(() => '');
    return { status: r.status, ok: r.ok, ms: Date.now() - t0, body };
  } catch (e) { return { status: 0, ok: false, ms: Date.now() - t0, body: '', error: String((e && e.name) || 'error') }; }
}

export async function keyTest(rawKey, { fetchFn = fetch } = {}) {
  const typed = String(rawKey || '').trim().replace(/\s+/g, '');
  const key = typed || process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || '';
  const out = { source: typed ? 'typed' : key ? 'saved' : 'none', kind: key ? keyKind(key) : '', list: null, tries: [], diagnosis: [], suggestModel: '' };
  if (!key) { out.diagnosis.push('هیچ کلیدی وارد یا ذخیره نشده.'); return out; }
  if (out.source === 'saved' && process.env.GROQ_API_KEY) out.kind = 'groq';
  if (out.kind === 'groq') {
    const l = await req(fetchFn, 'https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key } });
    let models = []; try { models = (JSON.parse(l.body).data || []).map((m) => m.id); } catch (e) { /* ignore */ }
    out.list = { status: l.status, ms: l.ms, error: l.error || null, count: models.length, msg: l.ok ? '' : shortMsg(l.body, key), models: models.slice(0, 40) };
    const model = groqModelName();
    const g = await req(fetchFn, 'https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say hi' }], max_completion_tokens: 40 }) }, 30000);
    out.tries.push({ model, status: g.status, ok: g.ok, ms: g.ms, msg: g.ok ? '' : shortMsg(g.body, key), error: g.error || null });
    if (!l.ok && (l.status === 401 || l.status === 403)) out.diagnosis.push('Groq کلید رو قبول نکرد (' + l.status + '). کلید اشتباه یا غیرفعاله؛ یک کلید تازه از console.groq.com/keys بساز.');
    else if (g.ok) out.diagnosis.push('Groq درست کار می‌کنه با مدل ' + model + '.');
    else if (g.status === 404 || /model/i.test(g.body)) { out.diagnosis.push('مدل ' + model + ' توی Groq پیدا نشد.'); out.suggestModel = models.find((m) => /gpt-oss-120b/.test(m)) || models.find((m) => /llama/.test(m)) || ''; }
    else if (g.status === 429) out.diagnosis.push('سقف درخواست Groq پر شده؛ کمی بعد دوباره تست کن.');
    else if (g.status === 0) out.diagnosis.push('اتصال سرور به Groq برقرار نشد (' + (g.error || 'خطا') + ').');
    else out.diagnosis.push('Groq جواب خطا داد (' + g.status + ').');
    return out;
  }
  // Gemini
  const l = await req(fetchFn, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
  let models = []; try { models = (JSON.parse(l.body).models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name)).map((m) => m.name.replace('models/', '')); } catch (e) { /* ignore */ }
  out.list = { status: l.status, ms: l.ms, error: l.error || null, count: models.length, msg: l.ok ? '' : shortMsg(l.body, key), models: models.slice(0, 60) };
  const flash = models.filter((m) => /flash/.test(m) && !/(lite|image|tts|live|audio|exp|embedding|robotics|computer)/.test(m));
  const order = [];
  for (const m of [geminiModelName()].concat(flash.slice(0, 4), CANDIDATES)) if (m && !order.includes(m)) order.push(m);
  for (const m of order.slice(0, 8)) {
    const g = await req(fetchFn, 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m) + ':generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Say hi' }] }], generationConfig: { maxOutputTokens: 40 } }) }, 30000);
    out.tries.push({ model: m, status: g.status, ok: g.ok, ms: g.ms, msg: g.ok ? '' : shortMsg(g.body, key), error: g.error || null });
    if (g.ok && m !== geminiModelName()) { out.suggestModel = m; break; }
    if (g.ok) break;
    if (g.status === 400 || g.status === 401 || g.status === 403 || g.status === 429 || g.status === 0) break; // مشکل از کلید/منطقه/سهمیه‌ست، نه اسم مدل
  }
  const first = out.tries[0], okTry = out.tries.find((t) => t.ok);
  if (l.status === 0) out.diagnosis.push('اتصال سرور به گوگل برقرار نشد (' + (l.error || 'خطا') + ').');
  else if (/location|region|not supported/i.test(l.msg || '') || (first && /location|region|not supported/i.test(first.msg))) out.diagnosis.push('گوگل از منطقهٔ سرور Render پاسخ نمی‌ده (محدودیت منطقه). باید منطقهٔ سرویس رو عوض کنی یا از Groq استفاده کنی.');
  else if (!l.ok && (l.status === 400 || l.status === 401 || l.status === 403)) out.diagnosis.push('گوگل کلید رو قبول نکرد (' + l.status + '). کلید اشتباه، ناقص یا غیرفعاله؛ یک کلید تازه از aistudio.google.com بساز.');
  else if (okTry && okTry.model === geminiModelName()) out.diagnosis.push('Gemini درست کار می‌کنه با مدل ' + okTry.model + '. اگه ربات هنوز ارور می‌ده، فایل aicore.js جدید آپلود نشده.');
  else if (okTry) out.diagnosis.push('مدلی که الان تنظیمه (' + geminiModelName() + ') وجود نداره، ولی ' + okTry.model + ' جواب می‌ده. توی پنل ربات: هوش مصنوعی ← عوض کردن مدل ← ' + okTry.model);
  else if (first && first.status === 429) out.diagnosis.push('سهمیهٔ رایگان گوگل پر شده یا درخواست زیاد بوده؛ کمی بعد دوباره تست کن.');
  else out.diagnosis.push('هیچ‌کدوم از مدل‌های امتحان‌شده جواب ندادن؛ جزئیات پایین رو بفرست.');
  return out;
}
// END-OF-FILE aitest.js
