// ست کردن متغیرهای محیطی از داخل ربات: هم روی همین سرور (فوری) و هم روی Render (ماندگار).
// لازم: RENDER_API_KEY و RENDER_SERVICE_ID توی متغیرهای Render. کلیدها هیچ‌وقت توی GitHub یا دیتابیس نمی‌رن.
const ALLOW = ['GEMINI_API_KEY', 'GEMINI_MODEL'];
export const envAllowed = (n) => ALLOW.includes(n);
export const renderConfigured = () => !!(process.env.RENDER_API_KEY && process.env.RENDER_SERVICE_ID);

export async function setEnv(name, value, { fetchFn = fetch } = {}) {
  if (!envAllowed(name)) throw new Error('not_allowed');
  const v = String(value == null ? '' : value);
  if (v) process.env[name] = v; else delete process.env[name];
  if (!renderConfigured()) return { persisted: false, reason: 'no_render' };
  const url = 'https://api.render.com/v1/services/' + encodeURIComponent(process.env.RENDER_SERVICE_ID) + '/env-vars/' + encodeURIComponent(name);
  const headers = { Authorization: 'Bearer ' + process.env.RENDER_API_KEY, Accept: 'application/json', 'Content-Type': 'application/json' };
  try {
    const r = v
      ? await fetchFn(url, { method: 'PUT', headers, body: JSON.stringify({ value: v }), signal: AbortSignal.timeout(20000) })
      : await fetchFn(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok && !(r.status === 404 && !v)) return { persisted: false, reason: 'render_' + r.status };
    return { persisted: true };
  } catch (e) { return { persisted: false, reason: 'render_unreachable' }; }
}
