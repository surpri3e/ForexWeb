// یادآوری: کاربر می‌گه «یادم بنداز ... فردا ساعت 9» و ربات سر وقت پیام می‌ده.
import { sql } from './db.js';
import { normText } from './words.js';

const TEH = 12600000; // +۳:۳۰
const W2N = { 'یک': 1, 'یه': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10, 'یازده': 11, 'دوازده': 12, 'پانزده': 15, 'بیست': 20, 'سی': 30, 'چهل': 40, 'چهل و پنج': 45, 'پنجاه': 50, 'شصت': 60 };
const WD = { 'شنبه': 6, 'یکشنبه': 0, 'دوشنبه': 1, 'سه شنبه': 2, 'چهارشنبه': 3, 'پنجشنبه': 4, 'جمعه': 5 }; // JS getUTCDay
const tehParts = (ms) => { const d = new Date(ms + TEH); return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; };
const tehMs = (y, mo, d, h, mi) => Date.UTC(y, mo, d, h, mi) - TEH;

// بیرون‌کشیدن زمان از متن؛ خروجی { at (میلی‌ثانیه), text (متن بدون عبارت زمان) } یا null
export function parseWhen(input, nowMs = Date.now()) {
  let t = ' ' + normText(input) + ' ';
  const take = (re) => { const m = re.exec(t); if (m) t = t.replace(m[0], ' '); return m; };
  const numOf = (s) => { s = String(s).trim(); if (/^\d+(\.\d+)?$/.test(s)) return +s; return W2N[s] != null ? W2N[s] : null; };
  const NUMW = '(\\d+(?:\\.\\d+)?|چهل و پنج|یک|یه|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده|یازده|دوازده|پانزده|بیست|سی|چهل|پنجاه|شصت)';
  let at = null, m;
  // نسبی: «۵ دقیقه دیگه»، «۲ ساعت بعد»، «نیم ساعت دیگه»، «یک ساعت و نیم دیگه»، «ربع ساعت دیگه»
  if ((m = take(/ (?:بعد از|تا) ?/) , null)) { /* ignore */ }
  if ((m = take(new RegExp(' ' + NUMW + ' ساعت و نیم (?:دیگه|دیگر|بعد|بعدش)? ?')))) at = nowMs + (numOf(m[1]) + 0.5) * 3600e3;
  else if ((m = take(/ نیم ساعت (?:دیگه|دیگر|بعد|بعدش)? ?/))) at = nowMs + 30 * 60e3;
  else if ((m = take(/ ربع ساعت (?:دیگه|دیگر|بعد|بعدش)? ?/))) at = nowMs + 15 * 60e3;
  else if ((m = take(new RegExp(' ' + NUMW + ' (ثانیه|دقیقه|ساعت|روز|هفته) (?:دیگه|دیگر|بعد|بعدش) ?')))) { const n = numOf(m[1]); const u = { 'ثانیه': 1e3, 'دقیقه': 60e3, 'ساعت': 3600e3, 'روز': 86400e3, 'هفته': 7 * 86400e3 }[m[2]]; if (n != null) at = nowMs + n * u; }
  else if ((m = take(/ (یک|یه) (ساعت|دقیقه|روز|هفته) (?:دیگه|دیگر|بعد|بعدش) ?/))) at = nowMs + { 'ساعت': 3600e3, 'دقیقه': 60e3, 'روز': 86400e3, 'هفته': 7 * 86400e3 }[m[2]];
  if (at == null) {
    // مطلق: روز + ساعت
    const P = tehParts(nowMs);
    let dayOff = null, wdTarget = null;
    if (take(/ پس ?فردا /)) dayOff = 2; else if (take(/ فردا /)) dayOff = 1; else if (take(/ امروز /)) dayOff = 0;
    else { for (const k of Object.keys(WD)) { if (take(new RegExp(' ' + k + ' '))) { wdTarget = WD[k]; break; } } }
    let h = null, mi = 0;
    const per = take(/ (صبح|ظهر|بعد ?از ?ظهر|عصر|شب|نیمه ?شب) /);
    if ((m = take(/ ساعت (\d{1,2})(?:[:٫.](\d{2}))?(?: و (نیم|ربع))? /))) { h = +m[1]; mi = m[2] ? +m[2] : m[3] === 'نیم' ? 30 : m[3] === 'ربع' ? 15 : 0; }
    else if ((m = take(/ (\d{1,2}):(\d{2}) /))) { h = +m[1]; mi = +m[2]; }
    else if ((m = take(new RegExp(' ساعت ' + NUMW + ' ')))) { h = numOf(m[1]); }
    if (h != null && h <= 23 && mi <= 59) {
      const pw = per && per[1].replace(/\s/g, '');
      if (pw && /عصر|شب|بعدازظهر/.test(pw) && h < 12) h += 12;
      if (pw === 'ظهر' && h < 11) h += 12;
      if (pw === 'نیمهشب' && h === 12) h = 0;
      let base = tehMs(P.y, P.mo, P.d, h, mi);
      if (dayOff != null) base += dayOff * 86400e3;
      else if (wdTarget != null) { let diff = (wdTarget - P.wd + 7) % 7; if (diff === 0 && base <= nowMs) diff = 7; base += diff * 86400e3; }
      else if (base <= nowMs) base += 86400e3; // ساعت امروز گذشته: فردا
      at = base;
    } else if (dayOff != null || wdTarget != null) {
      // روز بدون ساعت: ۹ صبح
      const dd = dayOff != null ? dayOff : ((wdTarget - P.wd + 7) % 7 || 7);
      at = tehMs(P.y, P.mo, P.d, 9, 0) + dd * 86400e3;
      if (dayOff === 0 && at <= nowMs) at = null;
    }
  }
  if (at == null || !(at > nowMs - 1000)) return null;
  let text = t.replace(/\s+/g, ' ').trim().replace(/^(?:که|تا|رو|را|برای|اینکه)\s+/, '').replace(/\s+(?:که|رو|را)$/, '').trim();
  return { at: Math.max(at, nowMs + 5000), text };
}
// حذف کلمهٔ فعال‌ساز از اول پیام (مثلاً «یادم بنداز»)
export function stripTrigger(text, words) {
  let t = String(text || '').trim();
  const n = normText(t);
  for (const w of (words || []).slice().sort((a, b) => b.length - a.length)) { const nw = normText(w); if (n.startsWith(nw)) { return t.slice(Math.min(t.length, nw.length)).replace(/^[\s،,:]+/, '').trim(); } }
  return t;
}
export const fmtWhen = (ms) => { const p = tehParts(ms), pad = (n) => String(n).padStart(2, '0'); const d = new Date(ms + TEH); return ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'][p.wd] + ' ' + d.getUTCFullYear() + '/' + pad(p.mo + 1) + '/' + pad(p.d) + '  ساعت ' + pad(p.h) + ':' + pad(p.mi); };

export function createReminders({ tg, db = sql, max = () => 20 }) {
  let timer = null;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  async function add({ tgId, chatId, text, at, unlimited = false }) {
    const clean = String(text || '').trim().slice(0, 500);
    if (!clean) return { ok: false, reason: 'empty' };
    if (at > Date.now() + 366 * 86400e3) return { ok: false, reason: 'far' };
    if (!unlimited) { const c = await db`SELECT COUNT(*)::int AS n FROM reminders WHERE tg_id = ${tgId} AND sent = FALSE`; if (c[0] && c[0].n >= max()) return { ok: false, reason: 'limit', max: max() }; }
    const r = await db`INSERT INTO reminders (tg_id, chat_id, text, due_at) VALUES (${tgId}, ${chatId}, ${clean}, ${new Date(at).toISOString()}) RETURNING id`;
    return { ok: true, id: r[0] && r[0].id, at };
  }
  async function list(tgId) { const r = await db`SELECT id, text, due_at FROM reminders WHERE tg_id = ${tgId} AND sent = FALSE ORDER BY due_at LIMIT 30`; return r.map((x) => ({ id: x.id, text: x.text, at: new Date(x.due_at).getTime() })); }
  async function remove(tgId, id) { const r = await db`DELETE FROM reminders WHERE id = ${id} AND tg_id = ${tgId} RETURNING id`; return !!r.length; }
  async function tick() {
    let rows = [];
    try { rows = await db`SELECT id, tg_id, chat_id, text, attempts FROM reminders WHERE sent = FALSE AND due_at <= NOW() ORDER BY due_at LIMIT 40`; } catch (e) { console.error('reminders tick:', e && e.message); return 0; }
    let n = 0;
    for (const r of rows) {
      const claim = await db`UPDATE reminders SET sent = TRUE WHERE id = ${r.id} AND sent = FALSE RETURNING id`.catch(() => []);
      if (!claim.length) continue;
      try {
        const group = Number(r.chat_id) !== Number(r.tg_id);
        await tg.send(r.chat_id, '<b>⏰ یادآوری</b>\n' + esc(r.text) + (group ? '\n<a href="tg://user?id=' + r.tg_id + '">‌‌‌👤</a>' : ''));
        n++;
      } catch (e) {
        console.error('reminder send failed:', r.id, e && e.message);
        if ((r.attempts || 0) < 3) await db`UPDATE reminders SET sent = FALSE, attempts = attempts + 1, due_at = NOW() + INTERVAL '2 minutes' WHERE id = ${r.id}`.catch(() => {});
      }
    }
    return n;
  }
  function start() { if (timer) return; timer = setInterval(() => { tick().catch(() => {}); }, 30000); if (timer.unref) timer.unref(); }
  return { add, list, remove, tick, start };
}

// END-OF-FILE reminders.js
