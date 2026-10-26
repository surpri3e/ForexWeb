// کارهای ادمین برای ربات تلگرام (همان کارهای پنل ادمین سایت، ولی بدون HTTP).
// دسترسی ادمین توی خود ربات کنترل می‌شه (فقط با نوشتن «لوموس» و رمز ADMIN_KEY).
import crypto from 'crypto';
import { sql } from './db.js';
import { newsStatus, refresh as refreshNews, importFeed } from '../routes/news.js';

const sec = (d) => (d ? Math.floor(new Date(d).getTime() / 1000) : 0);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const cleanTxt = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁩﻿]/g, '').trim().slice(0, max);

export function keyOk(given) {
  const exp = process.env.ADMIN_KEY;
  if (!exp || !given) return false;
  return crypto.timingSafeEqual(sha(given), sha(exp));
}

export const admin = {
  keyOk,
  async stats() {
    const [r] = await sql`
      SELECT
        (SELECT COUNT(*) FROM users)::int AS users,
        (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '24 hours')::int AS new24h,
        (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '7 days')::int AS new7d,
        (SELECT COUNT(*) FROM users WHERE GREATEST(COALESCE(last_login,'epoch'::timestamptz),COALESCE(last_seen,'epoch'::timestamptz)) > NOW() - INTERVAL '24 hours')::int AS active24h,
        (SELECT COUNT(*) FROM users WHERE GREATEST(COALESCE(last_login,'epoch'::timestamptz),COALESCE(last_seen,'epoch'::timestamptz)) > NOW() - INTERVAL '7 days')::int AS active7d,
        (SELECT COUNT(*) FROM backups)::int AS "withBackup",
        (SELECT COUNT(*) FROM tg_links)::int AS "tgUsers",
        (SELECT COUNT(*) FROM journals)::int AS journals,
        (SELECT COUNT(*) FROM tickets WHERE status = 'open')::int AS "openTickets"`;
    return r;
  },
  // کاربران: همه یا فقط فعال ۲۴ ساعت اخیر (صفحه‌بندی ۸تایی)
  async users(mode, page) {
    const off = Math.max(0, page | 0) * 8;
    const rows = mode === 'a24'
      ? await sql`SELECT email, created_at, GREATEST(COALESCE(last_login,'epoch'::timestamptz),COALESCE(last_seen,'epoch'::timestamptz)) AS seen FROM users WHERE GREATEST(COALESCE(last_login,'epoch'::timestamptz),COALESCE(last_seen,'epoch'::timestamptz)) > NOW() - INTERVAL '24 hours' ORDER BY seen DESC LIMIT 9 OFFSET ${off}`
      : await sql`SELECT email, created_at, GREATEST(COALESCE(last_login,'epoch'::timestamptz),COALESCE(last_seen,'epoch'::timestamptz)) AS seen FROM users ORDER BY created_at DESC LIMIT 9 OFFSET ${off}`;
    return { more: rows.length > 8, users: rows.slice(0, 8).map((u) => ({ email: u.email, created: sec(u.created_at), seen: sec(u.seen) })) };
  },
  async tickets(all) {
    const rows = all
      ? await sql`SELECT t.id, t.subject, t.status, u.email FROM tickets t JOIN users u ON u.id = t.user_id ORDER BY t.updated_at DESC, t.id DESC LIMIT 8`
      : await sql`SELECT t.id, t.subject, t.status, u.email FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.status = 'open' ORDER BY t.updated_at DESC, t.id DESC LIMIT 8`;
    return rows.map((r) => ({ id: r.id, subject: r.subject, status: r.status, email: r.email }));
  },
  async ticket(id) {
    const t = await sql`SELECT t.id, t.subject, t.category, t.status, u.email FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ${id}`;
    if (!t.length) return null;
    const m = await sql`SELECT from_admin, body FROM ticket_messages WHERE ticket_id = ${id} ORDER BY id DESC LIMIT 6`;
    return { ticket: t[0], messages: m.reverse().map((x) => ({ admin: !!x.from_admin, body: x.body })) };
  },
  async replyTicket(id, body) {
    body = cleanTxt(body, 1500);
    if (!body) return false;
    const t = await sql`SELECT id, user_id, subject FROM tickets WHERE id = ${id}`;
    if (!t.length) return false;
    await sql`INSERT INTO ticket_messages (ticket_id, from_admin, body) VALUES (${id}, TRUE, ${body})`;
    await sql`UPDATE tickets SET status = 'answered', updated_at = NOW() WHERE id = ${id}`;
    const [m] = await sql`INSERT INTO messages (title, body, kind, audience) VALUES (${'پاسخ تیکت #' + id}, ${'به تیکتت «' + String(t[0].subject).slice(0, 40) + '» جواب دادیم؛ از منو ← پشتیبانی ببینش.'}, 'info', 'user') RETURNING id`;
    await sql`INSERT INTO message_recipients (message_id, user_id) VALUES (${m.id}, ${t[0].user_id})`;
    return true;
  },
  async setTicketStatus(id, st) {
    if (!['open', 'answered', 'closed'].includes(st)) return false;
    await sql`UPDATE tickets SET status = ${st}, updated_at = NOW() WHERE id = ${id}`;
    return true;
  },
  async posts(all) {
    const rows = all
      ? await sql`SELECT p.id, p.symbol, p.body, p.hidden, pr.username, pr.banned, (SELECT COUNT(*) FROM post_reports r WHERE r.post_id = p.id)::int AS reports FROM posts p JOIN profiles pr ON pr.user_id = p.user_id ORDER BY p.id DESC LIMIT 6`
      : await sql`SELECT p.id, p.symbol, p.body, p.hidden, pr.username, pr.banned, (SELECT COUNT(*) FROM post_reports r WHERE r.post_id = p.id)::int AS reports FROM posts p JOIN profiles pr ON pr.user_id = p.user_id WHERE EXISTS (SELECT 1 FROM post_reports r WHERE r.post_id = p.id) OR p.hidden = TRUE ORDER BY p.id DESC LIMIT 6`;
    return rows.map((r) => ({ id: r.id, symbol: r.symbol || '', body: r.body || '', hidden: !!r.hidden, username: r.username, banned: !!r.banned, reports: r.reports }));
  },
  async hidePost(id, hidden) {
    await sql`UPDATE posts SET hidden = ${!!hidden} WHERE id = ${id}`;
    if (!hidden) await sql`DELETE FROM post_reports WHERE post_id = ${id}`;
    return true;
  },
  async deletePost(id) { await sql`DELETE FROM posts WHERE id = ${id}`; return true; },
  async ban(username, banned) {
    const u = String(username || '').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20);
    if (!u) return false;
    const r = await sql`SELECT user_id FROM profiles WHERE username = ${u}`;
    if (!r.length) return false;
    await sql`UPDATE profiles SET banned = ${!!banned} WHERE username = ${u}`;
    return true;
  },
  // پیام همگانی: توی زنگ سایت + (اختیاری) مستقیم توی تلگرام
  async broadcastSite(audience, title, body) {
    body = String(body || '').trim().slice(0, 600);
    title = String(title || '').trim().slice(0, 80);
    if (!body) return { ok: false };
    const [m] = await sql`INSERT INTO messages (title, body, kind, audience, popup) VALUES (${title || null}, ${body}, 'info', ${audience === 'active7' ? 'active7' : 'all'}, FALSE) RETURNING id`;
    const id = m.id;
    if (audience === 'active7') await sql`INSERT INTO message_recipients (message_id, user_id) SELECT ${id}, id FROM users WHERE last_login > NOW() - INTERVAL '7 days'`;
    else await sql`INSERT INTO message_recipients (message_id, user_id) SELECT ${id}, id FROM users`;
    const [c] = await sql`SELECT COUNT(*)::int AS n FROM message_recipients WHERE message_id = ${id}`;
    if (!c.n) { await sql`DELETE FROM messages WHERE id = ${id}`; return { ok: false }; }
    return { ok: true, recipients: c.n };
  },
  async tgIds() { const r = await sql`SELECT tg_id FROM tg_links`; return r.map((x) => String(x.tg_id)); },
  newsStatus,
  async newsRefresh() { try { await Promise.race([refreshNews(), new Promise((r) => setTimeout(r, 30000))]); } catch { /* status shows the error */ } return newsStatus(); },
  async newsImport(raw) { if (typeof raw === 'string') raw = JSON.parse(raw); return importFeed(raw); }
};
export default admin;
