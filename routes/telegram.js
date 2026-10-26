// ربات تلگرام Surpri3eFX: همهٔ کارهای ژورنال بدون باز کردن مینی‌اپ.
// منطق ربات توی lib/bot.js هست؛ اینجا فقط اتصال به API تلگرام و وب‌هوکه.
// فقط وقتی TELEGRAM_BOT_TOKEN ست باشه فعال می‌شه.
import express from 'express';
import crypto from 'crypto';
import { createBot } from '../lib/bot.js';
import { botStore, MAX_IMG } from '../lib/store.js';
import adminDep from '../lib/botadmin.js';
import { renderNews, renderSessions } from '../lib/render.js';
import { newsEvents, newsStatus, refresh as refreshNews } from './news.js';

const router = express.Router();
const token = () => process.env.TELEGRAM_BOT_TOKEN || '';
const baseUrl = () => String(process.env.PUBLIC_URL || 'https://forexweb.onrender.com').replace(/\/+$/, '');
const secret = () => crypto.createHash('sha256').update('wh:' + token()).digest('hex').slice(0, 32);
let BOT_USER = process.env.TELEGRAM_BOT_USERNAME || '';
export const botUsername = () => BOT_USER;

async function api(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token()}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) { const e = new Error(method + ': ' + (j.description || r.status)); e.code = j.error_code; throw e; }
  return j.result;
}
const base = { parse_mode: 'HTML', disable_web_page_preview: true };
export const tgApi = {
  send: (chat, text, kb) => api('sendMessage', Object.assign({ chat_id: chat, text: String(text).slice(0, 4000) }, base, kb ? { reply_markup: kb } : {})),
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
const getBot = () => bot || (bot = createBot({ store: botStore, tg: tgApi, appUrl: baseUrl(), botName: BOT_USER, admin: adminDep, news: newsDep, render: { news: renderNews, sessions: renderSessions } }));

export async function setupTelegram() {
  if (!token()) return;
  const me = await api('getMe', {}).catch(() => null);
  if (me && me.username) BOT_USER = me.username;
  await api('setWebhook', { url: baseUrl() + '/api/telegram/webhook', secret_token: secret(), allowed_updates: ['message', 'callback_query'] });
  await api('setChatMenuButton', { menu_button: { type: 'web_app', text: 'ژورنال', web_app: { url: baseUrl() } } });
  await api('setMyCommands', {
    commands: [
      { command: 'menu', description: 'منوی اصلی' },
      { command: 'news', description: 'اخبار و سشن (تصویر)' },
      { command: 'today', description: 'ثبت سریع و وضعیت امروز' },
      { command: 'week', description: 'هفتهٔ جاری' },
      { command: 'stats', description: 'آمار' },
      { command: 'review', description: 'مرور پایان هفته' },
      { command: 'lot', description: 'محاسبهٔ حجم (لات)' },
      { command: 'newweek', description: 'هفتهٔ جدید' },
      { command: 'backtest', description: 'ساخت بکتست' },
      { command: 'accounts', description: 'حساب‌های ژورنال' },
      { command: 'csv', description: 'خروجی CSV' },
      { command: 'settings', description: 'تنظیمات' },
      { command: 'link', description: 'اتصال به حساب سایت' },
      { command: 'id', description: 'شناسهٔ عددی تلگرام من' },
      { command: 'help', description: 'راهنما' }
    ]
  }).catch(() => {});
  console.log('telegram bot ready' + (BOT_USER ? ' @' + BOT_USER : ''));
}

// پردازش پشت‌سرهمِ آپدیت‌های هر چت (جلوگیری از رقابت دو دکمهٔ پشت‌سرهم)
const queues = new Map();
function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
  return next;
}

async function handle(u) {
  try { await getBot().handleUpdate(u); }
  catch (e) {
    console.error('bot error:', e && e.stack || e);
    const chat = (u.message && u.message.chat && u.message.chat.id) || (u.callback_query && u.callback_query.message && u.callback_query.message.chat.id);
    if (chat) tgApi.send(chat, 'مشکلی پیش اومد؛ چند لحظه بعد دوباره امتحان کن.', { inline_keyboard: [[{ text: 'منو', callback_data: 'm' }]] }).catch(() => {});
  }
}

router.post('/webhook', express.json({ limit: '200kb' }), (req, res) => {
  if (!token() || req.get('x-telegram-bot-api-secret-token') !== secret()) return res.sendStatus(401);
  res.sendStatus(200);
  const u = req.body || {};
  const from = (u.message && u.message.from) || (u.callback_query && u.callback_query.from);
  if (!from) return;
  enqueue(String(from.id), () => handle(u));
});

export default router;
