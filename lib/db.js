import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
if (process.env.JWT_SECRET.length < 32) console.warn('JWT_SECRET is short; use 32+ random characters');

export const sql = neon(process.env.DATABASE_URL);

export function getAuth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new Error('no token');
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
}

// Creates the message tables if they do not exist yet (safe to run on every start)
export async function ensureSchema() {
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ`;
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

  await sql`CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    bio TEXT,
    avatar_b64 TEXT,
    avatar_v INTEGER NOT NULL DEFAULT 0,
    banned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    bias TEXT,
    body TEXT,
    img_b64 TEXT NOT NULL,
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  // دفتر پست‌های گذاشته‌شده: حذف پست، سهمیهٔ روزانه رو برنمی‌گردونه
  await sql`CREATE TABLE IF NOT EXISTS post_log (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_post_log_user ON post_log(user_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at)`;
  await sql`CREATE TABLE IF NOT EXISTS post_likes (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, user_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS post_reports (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (follower_id, followee_id)
  )`;

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
  // messages created by an earlier version of this project get the new "edited" column
  try { await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`; } catch (e) { console.error('alter messages:', e.message); }
}
