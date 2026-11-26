import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
if (process.env.JWT_SECRET.length < 32) console.warn('JWT_SECRET is short; use 32+ random characters');

export const sql = neon(process.env.DATABASE_URL);

// توکن‌های قدیمی بعد از تغییر/بازیابی رمز باطل می‌شن: iat توکن باید از لحظهٔ آخرین تغییر رمز جدیدتر باشه.
// جواب ۳۰ ثانیه کش می‌شه تا هر درخواست یک کوئری اضافه نزنه؛ تغییر رمز کش همان کاربر رو فوراً پاک می‌کنه.
const authCache = new Map();
export function forgetAuth(uid) { authCache.delete(uid); }
export async function tokenFresh(uid, iat) {
  const now = Date.now();
  let c = authCache.get(uid);
  if (!c || now - c.at > 6 * 3600e3) { // تغییر رمز/حذف حساب کش رو با forgetAuth فوراً پاک می‌کنه؛ پس لازم نیست مدام از دیتابیس بپرسیم
    const [r] = await sql`SELECT FLOOR(EXTRACT(EPOCH FROM pw_changed_at))::bigint AS pw FROM users WHERE id=${uid}`;
    c = { ok: !!r, pw: r && r.pw != null ? Number(r.pw) : 0, at: now };
    if (authCache.size > 5000) authCache.clear();
    authCache.set(uid, c);
  }
  return c.ok && (Number(iat) || 0) >= c.pw;
}

export function getAuth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new Error('no token');
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
}

// Creates the message tables if they do not exist yet (safe to run on every start)
export async function ensureSchema() {
  // روی دیتابیس تازه (بدون این دو جدول) همه‌چیز از همین‌جا شروع می‌شد و می‌ترکید؛ روی دیتابیس فعلی اثری ندارن
  await sql`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ
  )`;
  await sql`CREATE TABLE IF NOT EXISTS backups (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ`;
  try { await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pw_changed_at TIMESTAMPTZ`; } catch (e) { console.error('alter users pw_changed_at:', e.message); }
  // دو ایمیل که فقط در حروف بزرگ/کوچک فرق دارن نباید بشه؛ اگه از قبل تکراری داشته باشی این ساخته نمی‌شه و فقط لاگ می‌خوره
  try { await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (LOWER(email))`; } catch (e) { console.error('unique email index (duplicates exist?):', e.message); }
  await sql`CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    title TEXT,
    body TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'info',
    audience TEXT NOT NULL DEFAULT 'all',
    target_email TEXT,
    popup BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
  )`;
  await sql`CREATE TABLE IF NOT EXISTS message_recipients (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ,
    PRIMARY KEY (message_id, user_id)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_msg_rec_user ON message_recipients(user_id)`;

  await sql`CREATE TABLE IF NOT EXISTS site_settings (
    k TEXT PRIMARY KEY,
    v TEXT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS donate_methods (
    id SERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    value TEXT NOT NULL,
    extra TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS tickets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    status TEXT NOT NULL DEFAULT 'open',
    user_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id)`;
  await sql`CREATE TABLE IF NOT EXISTS ticket_messages (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    from_admin BOOLEAN NOT NULL DEFAULT FALSE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ticket_msgs ON ticket_messages(ticket_id)`;

  // ژورنال مشترک سایت و ربات تلگرام (یک سند برای هر کاربر؛ rev برای جلوگیری از رونویسی همزمان)
  await sql`CREATE TABLE IF NOT EXISTS journals (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    doc JSONB NOT NULL,
    rev INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  // اتصال حساب تلگرام به حساب کاربری سایت + وضعیت گفتگوی ربات
  await sql`CREATE TABLE IF NOT EXISTS tg_links (
    tg_id BIGINT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tz TEXT NOT NULL DEFAULT 'Asia/Tehran',
    state JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tg_links_user ON tg_links(user_id)`;
  // پنل ثابت ربات (شناسهٔ پیام) و دسترسی ادمین ربات
  try { await sql`ALTER TABLE tg_links ADD COLUMN IF NOT EXISTS panel BIGINT`; await sql`ALTER TABLE tg_links ADD COLUMN IF NOT EXISTS adm BOOLEAN NOT NULL DEFAULT FALSE`; } catch (e) { console.error('alter tg_links:', e.message); }
  await sql`CREATE TABLE IF NOT EXISTS tg_link_codes (
    code TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS trade_images (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    b64 TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_trade_images_user ON trade_images(user_id)`;
  // گروه‌ها و کانال‌هایی که ربات توشونه + تنظیمات ارسال خودکار نرخ‌ها
  await sql`CREATE TABLE IF NOT EXISTS bot_groups (
    chat_id BIGINT PRIMARY KEY,
    title TEXT,
    kind TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    mode TEXT NOT NULL DEFAULT 'off',
    interval_min INTEGER NOT NULL DEFAULT 180,
    times TEXT NOT NULL DEFAULT '09:00,18:00',
    sections TEXT NOT NULL DEFAULT 'fiat,gold,crypto',
    cooldown_sec INTEGER NOT NULL DEFAULT 30,
    del_prev BOOLEAN NOT NULL DEFAULT TRUE,
    last_msgs TEXT,
    last_auto TIMESTAMPTZ,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS bot_settings (k TEXT PRIMARY KEY, v TEXT)`;
  await sql`CREATE TABLE IF NOT EXISTS password_resets (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, tries INTEGER NOT NULL DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS reminders (id SERIAL PRIMARY KEY, tg_id BIGINT NOT NULL, chat_id BIGINT NOT NULL, text TEXT NOT NULL, due_at TIMESTAMPTZ NOT NULL, sent BOOLEAN NOT NULL DEFAULT FALSE, attempts INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`;
  try { await sql`CREATE INDEX IF NOT EXISTS reminders_due ON reminders (sent, due_at)`; } catch (e) { console.error('reminders index:', e.message); }
  await sql`CREATE TABLE IF NOT EXISTS ai_usage (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, day TEXT NOT NULL)`;
  try { await sql`ALTER TABLE bot_groups ADD COLUMN IF NOT EXISTS ai_on BOOLEAN NOT NULL DEFAULT TRUE`; } catch (e) { console.error('alter bot_groups:', e.message); }
  try { await sql`ALTER TABLE bot_groups ADD COLUMN IF NOT EXISTS ai_search TEXT NOT NULL DEFAULT ''`; await sql`ALTER TABLE bot_groups ADD COLUMN IF NOT EXISTS ai_think TEXT NOT NULL DEFAULT ''`; } catch (e) { console.error('alter bot_groups ai_search:', e.message); }
  await sql`CREATE TABLE IF NOT EXISTS mikey_memory (id SERIAL PRIMARY KEY, scope TEXT NOT NULL, text TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  try { await sql`CREATE INDEX IF NOT EXISTS mikey_memory_scope_idx ON mikey_memory (scope)`; } catch (e) { console.error('index mikey_memory:', e.message); }
  try { await sql`ALTER TABLE bot_groups ADD COLUMN IF NOT EXISTS sum_on BOOLEAN NOT NULL DEFAULT FALSE`; await sql`ALTER TABLE bot_groups ADD COLUMN IF NOT EXISTS sum_hour INTEGER NOT NULL DEFAULT 22`; await sql`ALTER TABLE bot_groups ADD COLUMN IF NOT EXISTS last_sum TIMESTAMPTZ`; } catch (e) { console.error('alter bot_groups sum:', e.message); }
  try { await sql`ALTER TABLE bot_groups ADD COLUMN IF NOT EXISTS news_on BOOLEAN NOT NULL DEFAULT TRUE`; } catch (e) { console.error('alter bot_groups news_on:', e.message); }
  try { await sql`ALTER TABLE bot_groups ADD COLUMN IF NOT EXISTS sess_on BOOLEAN NOT NULL DEFAULT TRUE`; } catch (e) { console.error('alter bot_groups sess_on:', e.message); }
  // messages created by an earlier version of this project get the new "edited" column
  try { await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`; } catch (e) { console.error('alter messages:', e.message); }
}

// END-OF-FILE lib/db.js
