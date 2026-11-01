// ربات تلگرام Surpri3eFX: همهٔ کارهای ژورنال بدون باز کردن مینی‌اپ.
// منطق ربات توی lib/bot.js هست؛ اینجا فقط اتصال به API تلگرام و وب‌هوکه.
// فقط وقتی TELEGRAM_BOT_TOKEN ست باشه فعال می‌شه.
import express from 'express';
import crypto from 'crypto';
import { createBot } from '../lib/bot.js';
import { botStore, MAX_IMG } from '../lib/store.js';
import adminDep from '../lib/botadmin.js';
import { renderNews, renderSessions, renderRates, engineInfo } from '../lib/render.js';
import { getRates, getRatesConfig, ratesStatus } from '../lib/rates.js';
import { createGroups } from '../lib/groups.js';
import { newsEvents, newsStatus, refresh as refreshNews } from './news.js';

const router = express.Router();
const token = () => process.env.TELEGRAM_BOT_TOKEN || '';
const baseUrl = () => String(process.env.PUBLIC_URL || 'https://forexweb.onrender.com').replace(/\/+$/, '');
const secret = () => crypto.createHash('sha256').update('wh:' + token()).digest('hex').slice(0, 32);
let BOT_USER = process.env.TELEGRAM_BOT_USERNAME || '';
export const botUsername = () => BOT_USER;

async function api(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token()}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) { const e = new Error(method + ': ' + (j.description || r.status)); e.code = j.error_code; throw e; }
  return j.result;
}
const base = { parse_mode: 'HTML', disable_web_page_preview: true };
export const tgApi = {
  send: (chat, text, kb, extra) => api('sendMessage', Object.assign({ chat_id: chat, text: String(text).slice(0, 4000) }, base, kb ? { reply_markup: kb } : {}, extra || {})),
  action: (chat, act) => api('sendChatAction', { chat_id: chat, action: act }),
  edit: (chat, id, text, kb) => api('editMessageText', Object.assign({ chat_id: chat, message_id: id, text: String(text).slice(0, 4000) }, base, kb ? { reply_markup: kb } : {})),
  del: (chat, id) => api('deleteMessage', { chat_id: chat, message_id: id }),
  answer: (id, text) => api('answerCallbackQuery', Object.assign({ callback_query_id: id }, text ? { text: String(text).slice(0, 190) } : {})),
  async getFile(fileId) {
    const f = await api('getFile', { file_id: fileId });
    if (f.file_size && f.file_size > MAX_IMG) return { buf: null };
    const r = await fetch(`https://api.telegram.org/file/bot${token()}/${f.file_path}`);
    if (!r.ok) throw new Error('download ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const ext = String(f.file_path || '').split('.').pop().toLowerCase();
    return { buf, mime: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
  },
  async sendPhoto(chat, buf, caption, kb) {
    const f = new FormData();
    f.append('chat_id', String(chat));
    if (caption) { f.append('caption', String(caption).slice(0, 1000)); f.append('parse_mode', 'HTML'); }
    if (kb) f.append('reply_markup', JSON.stringify(kb));
    f.append('photo', new Blob([buf], { type: 'image/png' }), 'surpri3efx.png');
    const r = await fetch(`https://api.telegram.org/bot${token()}/sendPhoto`, { method: 'POST', body: f });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error('sendPhoto: ' + (j.description || r.status));
    return j.result;
  },
  leave: (chat) => api('leaveChat', { chat_id: chat }),
  editMarkup: (chat, id, kb) => api('editMessageReplyMarkup', { chat_id: chat, message_id: id, reply_markup: kb }),
  editCaption: (chat, id, caption, kb) => api('editMessageCaption', Object.assign({ chat_id: chat, message_id: id, caption: String(caption).slice(0, 1000), parse_mode: 'HTML' }, kb ? { reply_markup: kb } : {})),
  async editPhoto(chat, id, buf, caption, kb) {
    const f = new FormData();
    f.append('chat_id', String(chat)); f.append('message_id', String(id));
    f.append('media', JSON.stringify({ type: 'photo', media: 'attach://photo', caption: String(caption || '').slice(0, 1000), parse_mode: 'HTML' }));
    if (kb) f.append('reply_markup', JSON.stringify(kb));
    f.append('photo', new Blob([buf], { type: 'image/png' }), 'surpri3efx.png');
    const r = await fetch(`https://api.telegram.org/bot${token()}/editMessageMedia`, { method: 'POST', body: f });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) { const e = new Error('editMessageMedia: ' + (j.description || r.status)); e.code = j.error_code; throw e; }
    return j.result;
  },
  async sendDoc(chat, filename, buf, caption) {
    const f = new FormData();
    f.append('chat_id', String(chat));
    if (caption) f.append('caption', caption);
    f.append('document', new Blob([buf], { type: 'text/csv' }), filename);
    const r = await fetch(`https://api.telegram.org/bot${token()}/sendDocument`, { method: 'POST', body: f });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error('sendDocument: ' + (j.description || r.status));
    return j.result;
  }
};

let bot = null;
// اخبار: داده‌ای که از ۳ روز قدیمی‌تره نشون داده نمی‌شه؛ اگه کهنه بود توی پس‌زمینه بروز می‌شه
const newsDep = {
  events: () => { const st = newsStatus(); return st.ageMin != null && st.ageMin > 72 * 60 ? [] : newsEvents(); },
  status: newsStatus,
  async ensure() {
    const st = newsStatus();
    if (!st.count) await Promise.race([refreshNews(), new Promise((r) => setTimeout(r, 8000))]);
    else if (st.ageMin != null && st.ageMin > 30) refreshNews();
  }
};
engineInfo().then((i) => console.log('image engine:', i.name || 'NONE', i.error || '')).catch(() => {});
// گروه‌ها: جواب به نرخ ارز + ارسال خودکار (تنظیمش از پنل ادمین)
export const groupsSvc = createGroups({ tg: tgApi, render: { rates: renderRates }, botName: () => BOT_USER });
const getBot = () => bot || (bot = createBot({ groups: groupsSvc, store: botStore, tg: tgApi, appUrl: baseUrl(), botName: BOT_USER, admin: adminDep, news: newsDep, rates: { get: getRates, cfg: getRatesConfig, set: (p) => groupsSvc.saveRatesConfig(p), status: ratesStatus, setUsd: (v) => groupsSvc.saveManualUsd(v) }, render: { news: renderNews, sessions: renderSessions, rates: renderRates, info: engineInfo } }));

export async function setupTelegram() {
  if (!token()) return;
  // اول وب‌هوک ثبت می‌شه (تا اگه چیز دیگه‌ای گیر کرد، ربات بی‌جواب نمونه)؛ خطا توی هر مرحله جلوی بقیه رو نمی‌گیره
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.error('telegram setup ' + name + ' failed:', e && e.message); } };
  await step('getMe', async () => { const me = await api('getMe', {}); if (me && me.username) BOT_USER = me.username; });
  await step('setWebhook', () => api('setWebhook', { url: baseUrl() + '/api/telegram/webhook', secret_token: secret(), allowed_updates: ['message', 'callback_query', 'my_chat_member'] }));
  if (!healTimer) { healTimer = setInterval(healWebhook, 10 * 60 * 1000); if (healTimer.unref) healTimer.unref(); }
  try { await Promise.race([groupsSvc.loadSettings(), new Promise((r) => setTimeout(r, 15000))]); } catch (e) { console.error('groups settings load failed:', e && e.message); }
  groupsSvc.start();
  await step('menuButton', () => api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'ژورنال', web_app: { url: baseUrl() } } }));
  await step('commands', () => api('setMyCommands', {
    commands: [
      { command: 'menu', description: 'منوی اصلی' },
      { command: 'news', description: 'اخبار و سشن (تصویر)' },
      { command: 'rates', description: 'نرخ ارز و طلا' },
      { command: 'crypto', description: 'تاپ ۱۰ ارز دیجیتال' },
      { command: 'today', description: 'وضعیت و ثبت امروز' },
      { command: 'week', description: 'هفتهٔ جاری' },
      { command: 'stats', description: 'آمار' },
      { command: 'review', description: 'مرور پایان هفته' },
      { command: 'lot', description: 'محاسبهٔ حجم (لات)' },
      { command: 'newweek', description: 'هفتهٔ جدید' },
      { command: 'backtest', description: 'ساخت بکتست' },
      { command: 'accounts', description: 'حساب‌های ژورنال' },
      { command: 'csv', description: 'خروجی CSV' },
      { command: 'ai', description: 'دستیار هوش مصنوعی' },
      { command: 'settings', description: 'تنظیمات' },
      { command: 'link', description: 'اتصال به حساب سایت' },
      { command: 'id', description: 'شناسهٔ عددی تلگرام من' },
      { command: 'help', description: 'راهنما' }
    ]
  })).catch(() => {});
  await step('groupCommands', () => api('setMyCommands', { scope: { type: 'all_group_chats' }, commands: [{ command: 'rates', description: 'نرخ ارز، طلا و ارز دیجیتال' }, { command: 'crypto', description: 'تاپ ۱۰ ارز دیجیتال' }, { command: 'ai', description: 'پرسش از هوش مصنوعی' }] }));
  console.log('telegram bot ready' + (BOT_USER ? ' @' + BOT_USER : ''));
}

// پردازش پشت‌سرهمِ آپدیت‌های هر چت (جلوگیری از رقابت دو دکمهٔ پشت‌سرهم)
const queues = new Map();
function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => Promise.race([fn(), new Promise((r) => setTimeout(() => { console.error('bot update timed out (90s) for', key); r(); }, 90000))]));
  queues.set(key, next);
  next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
  return next;
}

const hook = { hits: 0, rejected: 0, lastAt: 0, lastErr: '', lastErrAt: 0, started: Date.now() };
async function handle(u) {
  try { await getBot().handleUpdate(u); }
  catch (e) {
    hook.lastErr = String((e && e.stack) || e).slice(0, 600); hook.lastErrAt = Date.now();
    console.error('bot error:', e && e.stack || e);
    const chat = (u.message && u.message.chat && u.message.chat.type === 'private' && u.message.chat.id) || (u.callback_query && u.callback_query.message && u.callback_query.message.chat.id);
    if (chat) tgApi.send(chat, 'مشکلی پیش اومد؛ چند لحظه بعد دوباره امتحان کن.', { inline_keyboard: [[{ text: 'منو', callback_data: 'm' }]] }).catch(() => {});
  }
}

router.post('/webhook', express.json({ limit: '200kb' }), (req, res) => {
  if (!token() || req.get('x-telegram-bot-api-secret-token') !== secret()) { hook.rejected++; console.error('telegram webhook rejected (secret mismatch or no token)'); return res.sendStatus(401); }
  res.sendStatus(200);
  const u = req.body || {};
  hook.hits++; hook.lastAt = Date.now();
  console.log('tg update', Object.keys(u).filter((k) => k !== 'update_id').join(','), 'from', from.id, u.message && u.message.chat ? u.message.chat.type : '');
  const from = (u.message && u.message.from) || (u.callback_query && u.callback_query.from) || (u.my_chat_member && u.my_chat_member.from);
  if (!from) return;
  enqueue(String(from.id), () => handle(u));
});

// عیب‌یابی ربات (فقط با ADMIN_KEY): وضعیت وب‌هوک و آخرین خطا. با fix=1 وب‌هوک دوباره ثبت می‌شه.
// باز کردن توی مرورگر:  /api/telegram/diag?key=ADMIN_KEY   یا   /api/telegram/diag?key=ADMIN_KEY&fix=1
router.get('/diag', async (req, res) => {
  const exp = process.env.ADMIN_KEY || '';
  const given = String(req.query.key || '');
  const sha = (x) => crypto.createHash('sha256').update(String(x)).digest();
  if (!exp || !crypto.timingSafeEqual(sha(given), sha(exp))) return res.status(401).json({ error: 'unauthorized' });
  const out = { tokenSet: !!token(), username: BOT_USER || null, expectedUrl: baseUrl() + '/api/telegram/webhook', server: { hits: hook.hits, rejected401: hook.rejected, lastHitSecondsAgo: hook.lastAt ? Math.round((Date.now() - hook.lastAt) / 1000) : null, lastError: hook.lastErr || null, lastErrorSecondsAgo: hook.lastErrAt ? Math.round((Date.now() - hook.lastErrAt) / 1000) : null, uptimeSeconds: Math.round((Date.now() - hook.started) / 1000) } };
  if (!token()) return res.json(out);
  try { const me = await api('getMe', {}); out.getMe = { ok: true, username: me.username }; } catch (e) { out.getMe = { ok: false, error: String(e.message) }; }
  try {
    if (req.query.fix === '1') { await api('setWebhook', { url: out.expectedUrl, secret_token: secret(), allowed_updates: ['message', 'callback_query', 'my_chat_member'] }); out.fixed = true; }
    const w = await api('getWebhookInfo', {});
    out.webhook = { url: w.url, urlMatches: w.url === out.expectedUrl, pending: w.pending_update_count, lastErrorMessage: w.last_error_message || null, lastErrorSecondsAgo: w.last_error_date ? Math.round(Date.now() / 1000 - w.last_error_date) : null, maxConnections: w.max_connections };
  } catch (e) { out.webhook = { error: String(e.message) }; }
  res.json(out);
});

// اگه وب‌هوک یه جای دیگه افتاد یا پاک شد، خودش دوباره ثبتش می‌کنه
let healTimer = null;
async function healWebhook() {
  if (!token()) return;
  try {
    const w = await api('getWebhookInfo', {});
    const want = baseUrl() + '/api/telegram/webhook';
    if (w.url !== want || /401|Unauthorized/i.test(String(w.last_error_message || ''))) {
      console.error('webhook heal: was', w.url || '(none)', 'err:', w.last_error_message || '-');
      await api('setWebhook', { url: want, secret_token: secret(), allowed_updates: ['message', 'callback_query', 'my_chat_member'] });
    }
  } catch (e) { console.error('webhook heal failed:', e && e.message); }
}

export default router;
// END-OF-FILE telegram.js
