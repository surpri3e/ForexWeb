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
}
