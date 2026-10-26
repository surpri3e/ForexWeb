// ذخیره‌سازی مشترک: ژورنال (یک سند برای هر کاربر)، اتصال تلگرام، عکس چارت.
// سایت (routes/sync.js) و ربات (routes/telegram.js) هر دو از همین‌جا می‌خونن و می‌نویسن.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { sql } from './db.js';
import * as J from './journal.js';
import { mergeDocs } from './merge.js';

const adminIdsFromEnv = () => String(process.env.TELEGRAM_ADMIN_IDS || '').split(/[\s,]+/).map((x) => x.trim()).filter((x) => /^\d{3,15}$/.test(x));

export const MAX_DOC = 4_500_000;
export const MAX_IMG = 900_000;   // بایت
export const MAX_IMGS = 150;      // برای هر کاربر
const KINDS = ['live', 'demo', 'bt', 'prop'];

/* ---------- سند ---------- */
export function emptyDoc(now) {
  return { v: 3, act: 'a1', actAt: 0, list: [{ id: 'a1', name: 'حساب اصلی', color: '#1F7A4D', kind: 'live' }], j: { a1: J.defaultJournal(now) } };
}
// هر چی از بیرون میاد (سایت) قبل از ذخیره تمیز می‌شه
export function sanitizeDoc(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.list)) return null;
  const ids = new Set(), list = [];
  for (const a of doc.list.slice(0, 12)) {
    const id = String((a && a.id) || '').replace(/[^\w-]/g, '').slice(0, 24);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    list.push({ id, name: String(a.name || 'حساب').slice(0, 24), color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : '#1F7A4D', kind: KINDS.includes(a.kind) ? a.kind : 'live' });
  }
  if (!list.length) return null;
  const j = {};
  for (const a of list) j[a.id] = J.normalizeJournal(doc.j && doc.j[a.id]);
  let act = String(doc.act || '');
  if (!ids.has(act)) act = list[0].id;
  return { v: 3, act, actAt: Math.max(0, Math.floor(+doc.actAt) || 0), list, j };
}

export async function loadDoc(uid) {
  const rows = await sql`SELECT doc, rev FROM journals WHERE user_id=${uid}`;
  if (rows.length) {
    let d = rows[0].doc;
    if (typeof d === 'string') d = JSON.parse(d);
    return { doc: sanitizeDoc(d), rev: rows[0].rev };
  }
  return { doc: null, rev: 0 };
}
export async function saveDoc(uid, doc, baseRev) {
  const clean = sanitizeDoc(doc);
  if (!clean) return { ok: false, error: 'bad_doc' };
  const json = JSON.stringify(clean);
  if (json.length > MAX_DOC) return { ok: false, error: 'bad_size' };
  if (!baseRev) {
    const r = await sql`INSERT INTO journals (user_id, doc, rev) VALUES (${uid}, ${json}::jsonb, 1) ON CONFLICT (user_id) DO NOTHING RETURNING rev`;
    if (r.length) return { ok: true, rev: r[0].rev, doc: clean };
  } else {
    const r = await sql`UPDATE journals SET doc=${json}::jsonb, rev=rev+1, updated_at=NOW() WHERE user_id=${uid} AND rev=${baseRev} RETURNING rev`;
    if (r.length) return { ok: true, rev: r[0].rev, doc: clean };
  }
  return { ok: false, conflict: true };
}
export async function getRev(uid) {
  const r = await sql`SELECT rev FROM journals WHERE user_id=${uid}`;
  return r.length ? r[0].rev : 0;
}

/* ---------- کاربر تلگرام ---------- */
const tgEmail = (id) => `tg_${id}@telegram.local`;
export async function ensureTgUser(tgId) {
  const l = await sql`SELECT user_id FROM tg_links WHERE tg_id=${tgId}`;
  if (l.length) return l[0].user_id;
  const email = tgEmail(tgId);
  let [u] = await sql`SELECT id FROM users WHERE LOWER(email)=${email} LIMIT 1`;
  if (!u) {
    const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
    [u] = await sql`INSERT INTO users (email, password_hash) VALUES (${email}, ${hash}) ON CONFLICT DO NOTHING RETURNING id`;
    if (!u) [u] = await sql`SELECT id FROM users WHERE LOWER(email)=${email} LIMIT 1`;
  }
  await sql`INSERT INTO tg_links (tg_id, user_id) VALUES (${tgId}, ${u.id}) ON CONFLICT (tg_id) DO NOTHING`;
  const l2 = await sql`SELECT user_id FROM tg_links WHERE tg_id=${tgId}`;
  return l2.length ? l2[0].user_id : u.id;
}
export async function userForTg(tgId) {
  const uid = await ensureTgUser(tgId);
  const [u] = await sql`SELECT id, email FROM users WHERE id=${uid}`;
  return u;
}

/* ---------- رابط ربات (store) ---------- */
export const botStore = {
  async resolveUser(tgId) {
    const uid = await ensureTgUser(tgId);
    const r = await sql`SELECT tz FROM tg_links WHERE tg_id=${tgId}`;
    return { uid, prefs: { tz: (r[0] && r[0].tz) || 'Asia/Tehran' } };
  },
  loadDoc,
  saveDoc,
  async getState(tgId) {
    const r = await sql`SELECT state FROM tg_links WHERE tg_id=${tgId}`;
    let s = r[0] && r[0].state;
    if (typeof s === 'string') { try { s = JSON.parse(s); } catch { s = null; } }
    return s || null;
  },
  async setState(tgId, st) { await sql`UPDATE tg_links SET state=${JSON.stringify(st)}::jsonb WHERE tg_id=${tgId}`; },
  async clearState(tgId) { await sql`UPDATE tg_links SET state=NULL WHERE tg_id=${tgId}`; },
  async getPanel(tgId) { const r = await sql`SELECT panel FROM tg_links WHERE tg_id=${tgId}`; return r[0] && r[0].panel ? Number(r[0].panel) : null; },
  async setPanel(tgId, id) { await sql`UPDATE tg_links SET panel=${id || null} WHERE tg_id=${tgId}`; },
  async isAdmin(tgId) {
    if (adminIdsFromEnv().includes(String(tgId))) return true;
    const r = await sql`SELECT adm FROM tg_links WHERE tg_id=${tgId}`;
    return !!(r[0] && r[0].adm);
  },
  async setAdmin(tgId, on) { await sql`UPDATE tg_links SET adm=${!!on} WHERE tg_id=${tgId}`; },
  async setPrefs(tgId, p) { if (p && p.tz) await sql`UPDATE tg_links SET tz=${String(p.tz).slice(0, 40)} WHERE tg_id=${tgId}`; },
  async putImage(uid, mime, buf) {
    const r = await saveImage(uid, mime, buf);
    return r.id || null;
  },
  // کد اتصال که از سایت ساخته شده؛ داده‌های قبلیِ حساب تلگرامی با ژورنال سایت ادغام می‌شه
  async consumeLinkCode(code, tgId) {
    const rows = await sql`SELECT user_id FROM tg_link_codes WHERE code=${code} AND expires_at > NOW()`;
    if (!rows.length) return { ok: false };
    const target = rows[0].user_id;
    await sql`DELETE FROM tg_link_codes WHERE code=${code}`;
    const cur = await sql`SELECT user_id FROM tg_links WHERE tg_id=${tgId}`;
    const prev = cur.length ? cur[0].user_id : null;
    let merged = false;
    if (prev && prev !== target) {
      const a = await loadDoc(prev), b = await loadDoc(target);
      if (a.doc) {
        const hasData = Object.values(a.doc.j).some((j) => j.weeks.some((w) => w.d.some((d) => d.tp || d.sl || d.be || d.t.length || d.note || d.m !== 'a')));
        if (hasData) {
          const out = mergeDocs(null, b.doc || emptyDoc(), a.doc);
          const s = await saveDoc(target, out, b.rev);
          if (s.ok) merged = true;
          else if (s.conflict) { const b2 = await loadDoc(target); const s2 = await saveDoc(target, mergeDocs(null, b2.doc || emptyDoc(), a.doc), b2.rev); merged = !!s2.ok; }
        }
      }
    }
    if (cur.length) await sql`UPDATE tg_links SET user_id=${target}, state=NULL WHERE tg_id=${tgId}`;
    else await sql`INSERT INTO tg_links (tg_id, user_id) VALUES (${tgId}, ${target})`;
    const [u] = await sql`SELECT email FROM users WHERE id=${target}`;
    return { ok: true, email: u ? u.email : '', merged };
  },
  async unlink(tgId) {
    const cur = await sql`SELECT user_id FROM tg_links WHERE tg_id=${tgId}`;
    if (!cur.length) return false;
    const [u] = await sql`SELECT email FROM users WHERE id=${cur[0].user_id}`;
    if (u && u.email === tgEmail(tgId)) return false; // خودش حساب مخصوص تلگرامه
    await sql`DELETE FROM tg_links WHERE tg_id=${tgId}`;
    return true;
  }
};

export async function makeLinkCode(uid) {
  await sql`DELETE FROM tg_link_codes WHERE user_id=${uid}`;
  const code = crypto.randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 12);
  await sql`INSERT INTO tg_link_codes (code, user_id, expires_at) VALUES (${code}, ${uid}, NOW() + INTERVAL '15 minutes')`;
  return code;
}
export async function linkInfo(uid) {
  const r = await sql`SELECT tg_id FROM tg_links WHERE user_id=${uid}`;
  return { linked: r.length > 0, count: r.length };
}
export async function unlinkAllForUser(uid) {
  await sql`DELETE FROM tg_links WHERE user_id=${uid}`;
}

/* ---------- عکس چارت ---------- */
export async function saveImage(uid, mime, buf) {
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return { error: 'bad_type' };
  if (!buf || !buf.length || buf.length > MAX_IMG) return { error: 'bad_size' };
  const cnt = await sql`SELECT COUNT(*)::int AS n FROM trade_images WHERE user_id=${uid}`;
  if (cnt[0].n >= MAX_IMGS) return { error: 'too_many' };
  const id = crypto.randomBytes(16).toString('hex');
  await sql`INSERT INTO trade_images (id, user_id, mime, b64) VALUES (${id}, ${uid}, ${mime}, ${buf.toString('base64')})`;
  return { id };
}
export async function getImage(id) {
  const r = await sql`SELECT mime, b64 FROM trade_images WHERE id=${id}`;
  return r.length ? { mime: r[0].mime, buf: Buffer.from(r[0].b64, 'base64') } : null;
}
export async function deleteImage(uid, id) {
  await sql`DELETE FROM trade_images WHERE id=${id} AND user_id=${uid}`;
}
