import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { sql, getAuth } from '../lib/db.js';
import { userForTg } from '../lib/store.js';
import { rateLimit } from '../lib/limit.js';
import { tgApi } from './telegram.js';

const router = express.Router();
const DUMMY_HASH = bcrypt.hashSync('timing-dummy', 10); // equalizes timing when the email does not exist
const sign = (uid) => jwt.sign({ uid }, process.env.JWT_SECRET, { expiresIn: '30d', algorithm: 'HS256' });
const normEmail = (e) => String(e ?? '').trim().toLowerCase();

// 10 attempts / 15 min per IP+email (per-IP only would punish shared mobile/ISP addresses)
const perEmail = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: (req) => req.ip + ':' + normEmail(req.body && req.body.email)
});

router.post('/register', perEmail, async (req, res) => {
  const email = normEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  if (!email || typeof password !== 'string' || !password) return res.status(400).json({ error: 'missing' });
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
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
    res.status(500).json({ error: 'server' });
  }
});

router.post('/login', perEmail, async (req, res) => {
  const email = normEmail(req.body && req.body.email);
  const password = req.body && req.body.password;
  if (!email || typeof password !== 'string' || !password) return res.status(400).json({ error: 'missing' });
  if (Buffer.byteLength(password) > 1024) return res.status(401).json({ error: 'invalid' });

  try {
    // LOWER() keeps older accounts that were saved with capital letters working
    const [u] = await sql`SELECT * FROM users WHERE LOWER(email)=${email} ORDER BY id LIMIT 1`;
    const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
    if (!u || !ok) return res.status(401).json({ error: 'invalid' });

    await sql`UPDATE users SET last_login=NOW() WHERE id=${u.id}`;
    res.json({ token: sign(u.id), email: u.email });
  } catch (e) {
    console.error(e);
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
    await sql`UPDATE users SET last_login=NOW() WHERE id=${u.id}`;
    res.json({ token: sign(u.id), email: u.email });
  } catch (e) {
    console.error(e);
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
    await sql`UPDATE users SET password_hash=${hash} WHERE id=${u.id}`;
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
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server' });
  }
});

export default router;
