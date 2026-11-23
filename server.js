import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import backupRoutes from './routes/backup.js';
import adminRoutes from './routes/admin.js';
import messageRoutes from './routes/messages.js';
import supportRoutes from './routes/support.js';
import globalRoutes, { startGlobalHousekeeping } from './routes/global.js';
import aiRoutes from './routes/ai.js';
import telegramRoutes, { setupTelegram } from './routes/telegram.js';
import syncRoutes from './routes/sync.js';
import newsRoutes, { startNewsRefresh } from './routes/news.js';
import ratesRoutes from './routes/rates.js';
import statementRoutes from './routes/statement.js';
import { rateLimit } from './lib/limit.js';
import pwaRoutes from './lib/pwa.js';
import { ensureSchema, getAuth, sql, tokenFresh } from './lib/db.js';
import { loadAiConfig, loadAiUsage } from './lib/aicore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy (correct client IP)
app.disable('x-powered-by');

// سیاست محتوا: فقط از همین سایت و چند میزبان مشخص چیز بارگذاری می‌شه (فونت گوگل، اسکریپت مینی‌اپ تلگرام، تقویم اقتصادی).
// 'unsafe-inline' و 'unsafe-eval' برای اسکریپت لازمه چون سایت با onclick درونی نوشته شده و بخش‌هاش رو با new Function بارگذاری می‌کنه؛ اگه روزی چیزی خراب شد، CSP_REPORT_ONLY=1 بذار تا فقط هشدار بده.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://nfs.faireconomy.media https://cdn-nfs.faireconomy.media",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org https://t.me"
].join('; ');

// Security headers
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    // مینی‌اپ تلگرام (نسخهٔ وب) سایت رو داخل iframe باز می‌کنه؛ بقیه اجازهٔ قاب‌گرفتن ندارن
    [process.env.CSP_REPORT_ONLY === '1' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy']: CSP,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Strict-Transport-Security': 'max-age=15552000'
  });
  next();
});

// The site and API share one domain, so cross-origin access is only needed for extra origins you list.
const allowed = (process.env.ALLOWED_ORIGINS || 'https://forexweb.onrender.com').split(',').map((s) => s.trim());
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)) }));


// آخرین زمان حضور کاربر (برای «فعال در ۲۴ ساعت» تو مدیریت)؛ حداکثر هر ۱۰ دقیقه یه بار برای هر کاربر نوشته می‌شه
const seenAt = new Map();
setInterval(() => { const t = Date.now() - 7200e3; for (const [k, v] of seenAt) if (v < t) seenAt.delete(k); }, 3600e3).unref();
// سقف کلی درخواست از یک IP (جلوی سیل ساده)؛ سقف‌های دقیق‌تر هر مسیر جداست
app.use('/api', rateLimit({ windowMs: 10 * 60 * 1000, max: 3000, key: (r) => 'all' + r.ip }));

// مسیرهایی که توکن لازم ندارن؛ برای اینا توکن قدیمی/باطل مانع کار نمی‌شه
const OPEN = /^\/(auth\/(login|register|forgot|reset|telegram|logout)|telegram\/|healthz)/;
app.use('/api', async (req, res, next) => {
  let u;
  try { u = getAuth(req); } catch { return next(); } // بدون توکن (یا توکن خراب: خود مسیر ۴۰۱ می‌ده)
  if (!OPEN.test(req.path)) {
    // توکنی که قبل از تغییر رمز صادر شده یا کاربرش حذف شده باطله
    try { if (!(await tokenFresh(u.uid, u.iat))) return res.status(401).json({ error: 'unauthorized' }); }
    catch (e) { console.error('token check:', e && e.message); } // خطای دیتابیس: مسیر خودش مدیریت می‌کنه
  }
  const now = Date.now();
  if (!seenAt.has(u.uid) || now - seenAt.get(u.uid) > 3600e3) { // «آخرین بازدید» ساعتی یک بار ثبت می‌شه تا هر بازدید یک نوشتن روی دیتابیس نباشه
    seenAt.set(u.uid, now);
    Promise.resolve(sql`UPDATE users SET last_seen=NOW() WHERE id=${u.uid}`).catch(() => {});
  }
  next();
});

// نوشتن‌های سنگین (بکاپ/سینک/ژورنال مشترک) سقف جدا دارن؛ خواندن‌ها (مثل چک نسخه) محدود نمی‌شن
const writes = (max) => { const l = rateLimit({ windowMs: 10 * 60 * 1000, max, key: (r) => 'w' + r.ip }); return (req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? next() : l(req, res, next)); };

// Small body for auth/admin, big body only where the backup needs it
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 150 }), express.json({ limit: '20kb' }), authRoutes);
app.use('/api/me', rateLimit({ windowMs: 10 * 60 * 1000, max: 600, key: (r) => 'me' + r.ip }), meRoutes);
app.use('/api/backup', writes(120), express.json({ limit: '5mb' }), backupRoutes);
app.use('/api/admin', express.json({ limit: '300kb' }), adminRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/support', express.json({ limit: '20kb' }), supportRoutes);
app.use('/api/global', writes(200), express.json({ limit: '600kb' }), globalRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/rates', ratesRoutes);
app.use('/api/ai', express.json({ limit: '60kb' }), aiRoutes);
app.use('/api/statement', express.json({ limit: '3mb' }), statementRoutes); // تحلیل استیتمنت از عکس
app.use('/api/telegram', telegramRoutes);
app.use('/api/sync', writes(400), syncRoutes);

// نصب‌پذیری به‌صورت اپ: manifest و service worker و آیکن‌ها و مدرک اتصال به اپ اندروید
app.use(pwaRoutes);
app.use('/icons', express.static(path.join(__dirname, 'icons'), { maxAge: '7d' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// JSON errors (body too large / bad JSON) instead of an HTML stack page
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'bad_size' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
  console.error(err);
  res.status(500).json({ error: 'server' });
});

const PORT = process.env.PORT || 3000;
try { await ensureSchema(); } catch (e) { console.error('schema setup failed:', e); }
try { await loadAiConfig(); await loadAiUsage(); } catch (e) { console.error('ai config load failed:', e && e.message); }
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
  startNewsRefresh().catch((e) => console.error('news start failed:', e.message));
  startGlobalHousekeeping();
  setupTelegram().catch((e) => console.error('telegram setup failed:', e.message));
});

// END-OF-FILE server.js
