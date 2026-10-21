// اتصال به بات تلگرام (مینی‌اپ). فقط وقتی TELEGRAM_BOT_TOKEN ست باشه فعال می‌شه.
import express from 'express';
import crypto from 'crypto';

const router = express.Router();
const token = () => process.env.TELEGRAM_BOT_TOKEN || '';
const baseUrl = () => String(process.env.PUBLIC_URL || 'https://forexweb.onrender.com').replace(/\/+$/, '');
const secret = () => crypto.createHash('sha256').update('wh:' + token()).digest('hex').slice(0, 32);

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token()}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(method + ': ' + (j.description || r.status));
  return j;
}

export async function setupTelegram() {
  if (!token()) return;
  await tg('setWebhook', { url: baseUrl() + '/api/telegram/webhook', secret_token: secret(), allowed_updates: ['message'] });
  await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: '📒 ژورنال', web_app: { url: baseUrl() } } });
  console.log('telegram bot ready');
}

router.post('/webhook', express.json({ limit: '50kb' }), (req, res) => {
  if (!token() || req.get('x-telegram-bot-api-secret-token') !== secret()) return res.sendStatus(401);
  res.sendStatus(200);
  const m = req.body && req.body.message;
  if (!m || !m.chat || m.chat.type !== 'private') return;
  tg('sendMessage', {
    chat_id: m.chat.id,
    text: '👋 به Surpri3eFX خوش اومدی!\nژورنال TP/SL، آمار، گلوبال، اخبار و دستیار هوش مصنوعی همه تو یه اپ.',
    reply_markup: { inline_keyboard: [[{ text: '📒 باز کردن ژورنال', web_app: { url: baseUrl() } }]] }
  }).catch((e) => console.error('tg send failed:', e.message));
});

export default router;
