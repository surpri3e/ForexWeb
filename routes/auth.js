import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { sql, getAuth, forgetAuth } from '../lib/db.js';
import { userForTg, dropDoc, unlinkAllForUser } from '../lib/store.js';
import { rateLimit } from '../lib/limit.js';
import { tgApi } from './telegram.js';

const router = express.Router();
const DUMMY_HASH = bcrypt.hashSync('timing-dummy', 10); // equalizes timing when the email does not exist
const sign = (uid) => jwt.sign({ uid }, process.env.JWT_SECRET, { expiresIn: '30d', algorithm: 'HS256' });

// ---- حالت قطعی دیتابیس (Neon خاموش/سهمیه تموم) ----
// کسی که قبلاً از همین سرور وارد شده، تا وقتی دیتابیس برگرده با رمزش (یا مینی‌اپ تلگرام) باز هم وارد می‌شه.
// فقط توی حافظهٔ سرور و ۲۴ ساعت نگه داشته می‌شه (هش bcrypt؛ همونی که توی دیتابیس هست) و با ریستارت سرور پاک می‌شه.
const OFF_TTL = 24 * 3600e3;
const offLogin = new Map(); // email → { uid, email, hash, at }
const offTg = new Map(); // tgId → { uid, email, at }
const capMap = (m) => { if (m.size > 3000) m.delete(m.keys().next().value); };
export const dropOffline = (uid) => { for (const [k, v] of [...offLogin]) if (v.uid === uid) offLogin.delete(k); for (const [k, v] of [...offTg]) if (v.uid === uid) offTg.delete(k); };
// خطای خود دیتابیس (کد پنج‌حرفی Postgres) یا خطای اتصال؟ فقط اتصال/قطعی «قطعی دیتابیس» حساب می‌شه
const dbDown = (e) => !(e && /^[0-9A-Z]{5}$/.test(String(e.code || '')));
const sendDown = (res) => res.status(503).json({ error: 'db_down' });
const normEmail = (e) => String(e ?? '').trim().toLowerCase();

// 10 attempts / 15 min per IP+email (per-IP only would punish shared mobile/ISP addresses)
const perEmail = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: (req) => req.ip + ':' + normEmail(req.body && req.body.email)
});

// سقف سراسری برای هر ایمیل (از هر IP): جلوی حدس رمز از چند IP مختلف رو می‌گیره
const perEmailGlobal = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  key: (req) => 'g:' + normEmail(req.body && req.body.email)
});
// فقط کاراکترهای معمولِ ایمیل (جلوی < > " ' و … رو می‌گیره)؛ دامنهٔ داخلی تلگرام برای ثبت‌نام ممنوعه
const EMAIL_RE = /^[a-z0-9.!#$%&*+\/=?^_`{|}~-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

router.post('/register', perEmail, perEmailGlobal, async (req, res) => {
  const email = normEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  if (!email || typeof password !== 'string' || !password) return res.status(400).json({ error: 'missing' });
  if (email.length > 254 || !EMAIL_RE.test(email) || /@telegram\.local$/.test(email))
    return res.status(400).json({ error: 'bad_email' });
  // bcrypt only uses the first 72 bytes, so longer passwords are rejected instead of silently truncated
  if (password.length < 8 || Buffer.byteLength(password) > 72)
    return res.status(400).json({ error: 'weak_password' });

  try {
    const exists = await sql`SELECT id FROM users WHERE LOWER(email)=${email} LIMIT 1`;
    if (exists.length) return res.status(409).json({ error: 'exists' });

    const hash = await bcrypt.hash(password, 10);
    const [u] = await sql`
      INSERT INTO users (email, password_hash)
      VALUES (${email}, ${hash})
      RETURNING id, email`;

    res.json({ token: sign(u.id), email: u.email });
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: 'exists' }); // simultaneous register
    console.error(e);
    if (dbDown(e)) return sendDown(res);
    res.status(500).json({ error: 'server' });
  }
});

router.post('/login', perEmail, perEmailGlobal, async (req, res) => {
  const email = normEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  if (!email || typeof password !== 'string' || !password) return res.status(400).json({ error: 'missing' });
  if (Buffer.byteLength(password) > 1024) return res.status(401).json({ error: 'invalid' });

  try {
    // LOWER() keeps older accounts that were saved with capital letters working
    const [u] = await sql`SELECT * FROM users WHERE LOWER(email)=${email} ORDER BY id LIMIT 1`;
    const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
    if (!u || !ok) return res.status(401).json({ error: 'invalid' });

    capMap(offLogin); offLogin.set(email, { uid: u.id, email: u.email, hash: u.password_hash, at: Date.now() });
    Promise.resolve(sql`UPDATE users SET last_login=NOW() WHERE id=${u.id}`).catch(() => {});
    res.json({ token: sign(u.id), email: u.email });
  } catch (e) {
    console.error(e);
    if (dbDown(e)) {
      const c = offLogin.get(email);
      if (c && Date.now() - c.at < OFF_TTL) {
        const ok = await bcrypt.compare(password, c.hash);
        if (!ok) return res.status(401).json({ error: 'invalid' });
        return res.json({ token: sign(c.uid), email: c.email, offline: true });
      }
      return sendDown(res);
    }
    res.status(500).json({ error: 'server' });
  }
});


// ---- ورود خودکار از مینی‌اپ تلگرام (initData با توکن بات اعتبارسنجی می‌شه) ----
function verifyTelegram(initData) {
  const tok = process.env.TELEGRAM_BOT_TOKEN;
  if (!tok) return { error: 'tg_off' };
  if (typeof initData !== 'string' || initData.length > 4096) return { error: 'invalid' };
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { error: 'invalid' };
  p.delete('hash');
  const str = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => k + '=' + v).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(tok).digest();
  const calc = crypto.createHmac('sha256', secret).update(str).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== calc.length || !crypto.timingSafeEqual(given, calc)) return { error: 'invalid' };
  const age = Math.floor(Date.now() / 1000) - (parseInt(p.get('auth_date') || '0', 10) || 0);
  if (age > 86400 || age < -300) return { error: 'expired' };
  try { const u = JSON.parse(p.get('user') || 'null'); if (u && Number.isFinite(u.id)) return { id: u.id }; } catch {}
  return { error: 'invalid' };
}

router.post('/telegram', async (req, res) => {
  const v = verifyTelegram(req.body && req.body.initData);
  if (v.error) return res.status(v.error === 'tg_off' ? 503 : 401).json({ error: v.error });
  try {
    // اگه این تلگرام به حساب سایت وصل شده باشه، همون حساب باز می‌شه (ژورنال مشترک)
    const u = await userForTg(v.id);
    capMap(offTg); offTg.set(String(v.id), { uid: u.id, email: u.email, at: Date.now() });
    Promise.resolve(sql`UPDATE users SET last_login=NOW() WHERE id=${u.id}`).catch(() => {});
    res.json({ token: sign(u.id), email: u.email });
  } catch (e) {
    console.error(e);
    if (dbDown(e)) {
      const c = offTg.get(String(v.id));
      if (c && Date.now() - c.at < OFF_TTL) return res.json({ token: sign(c.uid), email: c.email, offline: true });
      return sendDown(res);
    }
    res.status(500).json({ error: 'server' });
  }
});

// ---- فراموشی رمز: کد ۶ رقمی به تلگرامِ وصل‌شده به حساب فرستاده می‌شه ----
const codeHash = (uid, code) => crypto.createHash('sha256').update(uid + ':' + code + ':' + process.env.JWT_SECRET).digest('hex');
router.post('/forgot', rateLimit({ windowMs: 15 * 60 * 1000, max: 4, key: (req) => 'fg' + req.ip + ':' + normEmail(req.body && req.body.email) }), async (req, res) => {
  const email = normEmail(req.body && req.body.email);
  if (!email) return res.status(400).json({ error: 'missing' });
  try {
    const [u] = await sql`SELECT id FROM users WHERE LOWER(email)=${email} ORDER BY id LIMIT 1`;
    if (u) {
      const links = await sql`SELECT tg_id FROM tg_links WHERE user_id=${u.id}`;
      if (links.length) {
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        await sql`INSERT INTO password_resets (user_id, code_hash, expires_at, tries) VALUES (${u.id}, ${codeHash(u.id, code)}, NOW() + INTERVAL '10 minutes', 0)
          ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, tries = 0`;
        for (const l of links) { try { await tgApi.send(l.tg_id, '<b>بازیابی رمز Surpri3eFX</b>\nکد تو: <code>' + code + '</code>\nتا ۱۰ دقیقه معتبره. اگه تو درخواست ندادی، نادیده‌اش بگیر.'); } catch (e) { console.error('reset send:', e && e.message); } }
      }
    }
    res.json({ ok: true }); // همیشه یک جواب؛ معلوم نمی‌شه ایمیل وجود داره یا نه
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});
router.post('/reset', rateLimit({ windowMs: 15 * 60 * 1000, max: 12, key: (req) => 'rs' + req.ip }), async (req, res) => {
  const email = normEmail(req.body && req.body.email), code = String((req.body && req.body.code) || '').replace(/\D/g, ''), password = req.body && req.body.password;
  if (!email || code.length !== 6 || typeof password !== 'string') return res.status(400).json({ error: 'missing' });
  if (password.length < 8 || Buffer.byteLength(password) > 72) return res.status(400).json({ error: 'weak_password' });
  try {
    const [u] = await sql`SELECT id FROM users WHERE LOWER(email)=${email} ORDER BY id LIMIT 1`;
    const [r] = u ? await sql`SELECT code_hash, tries, expires_at > NOW() AS live FROM password_resets WHERE user_id=${u.id}` : [];
    if (!r || !r.live || r.tries >= 5) return res.status(400).json({ error: 'bad_code' });
    const a = Buffer.from(codeHash(u.id, code), 'hex'), b = Buffer.from(r.code_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { await sql`UPDATE password_resets SET tries = tries + 1 WHERE user_id=${u.id}`; return res.status(400).json({ error: 'bad_code' }); }
    const hash = await bcrypt.hash(password, 10);
    await sql`UPDATE users SET password_hash=${hash}, pw_changed_at=NOW() WHERE id=${u.id}`;
    forgetAuth(u.id); dropOffline(u.id); // همهٔ نشست‌های قبلی (توکن‌های قدیمی) از این لحظه باطل می‌شن
    await sql`DELETE FROM password_resets WHERE user_id=${u.id}`;
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

router.post('/logout', (req, res) => res.json({ ok: true }));

// Delete own account (frontend: POST /api/auth/delete {password}); backups cascade
router.post('/delete', async (req, res) => {
  let user;
  try { user = getAuth(req); }
  catch { return res.status(401).json({ error: 'unauthorized' }); }

  const { password } = req.body || {};
  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'missing' });

  try {
    const [u] = await sql`SELECT id, password_hash FROM users WHERE id=${user.uid}`;
    if (!u) return res.status(401).json({ error: 'unauthorized' });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid' });
    await sql`DELETE FROM users WHERE id=${u.id}`;
    forgetAuth(u.id); dropOffline(u.id);
    dropDoc(u.id);
    try { await unlinkAllForUser(u.id); } catch (e) { /* ignore */ }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

export default router;

// END-OF-FILE routes/auth.js
