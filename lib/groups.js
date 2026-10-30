// گروه‌ها و کانال‌های تلگرام: جواب به «نرخ ارز» بدون سؤال + ارسال خودکار لیست قیمت‌ها طبق تنظیمات ادمین
import { sql } from './db.js';
import { getRates, hasAnyRates, composeRates, setManualUsd } from './rates.js';
import { askAi, checkAi, shouldWarn, mdToTg, getAiConfig } from './ai.js';

const ALL = ['fiat', 'gold', 'crypto'];
const MODES = ['off', 'every', 'daily'];
const TEH = 12600000; // +۳:۳۰ (ایران ساعت تابستانی ندارد)
const GROUP_TYPES = ['group', 'supergroup', 'channel'];

const num = (v, lo, hi, def) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def; };
export const parseSections = (v) => { const a = String(v || '').split(',').map((x) => x.trim()).filter((x) => ALL.includes(x)); return a.length ? ALL.filter((x) => a.includes(x)) : ALL.slice(); };
export const parseTimes = (v) => {
  const out = [];
  String(v || '').split(/[,،\s]+/).forEach((t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim()); if (m && +m[1] < 24 && +m[2] < 60) { const k = String(+m[1]).padStart(2, '0') + ':' + m[2]; if (!out.includes(k)) out.push(k); } });
  return out.sort().slice(0, 12);
};
function shape(r) {
  let last = [];
  try { last = JSON.parse(r.last_msgs || '[]'); } catch (e) { last = []; }
  return { id: String(r.chat_id), ai: r.ai_on == null ? true : !!r.ai_on, title: r.title || '', kind: r.kind || 'group', active: !!r.active, enabled: !!r.enabled, mode: MODES.includes(r.mode) ? r.mode : 'off',
    interval: r.interval_min, times: parseTimes(r.times), sections: parseSections(r.sections), cooldown: r.cooldown_sec, delPrev: !!r.del_prev,
    lastAuto: r.last_auto ? Math.floor(new Date(r.last_auto).getTime() / 1000) : 0, addedAt: r.added_at ? Math.floor(new Date(r.added_at).getTime() / 1000) : 0, last };
}
// آیا الان نوبت ارسال خودکار هست؟
export function isDue(g, nowMs) {
  if (!g.active || g.mode === 'off') return false;
  const last = g.lastAuto ? g.lastAuto * 1000 : 0;
  if (g.mode === 'every') return nowMs - last >= Math.max(10, g.interval) * 60000 - 5000;
  const mid = Math.floor((nowMs + TEH) / 864e5) * 864e5 - TEH;
  return g.times.some((t) => { const [h, m] = t.split(':').map(Number); const slot = mid + (h * 60 + m) * 60000; return nowMs >= slot && nowMs - slot < 6 * 3600e3 && last < slot; });
}

export function createGroups({ tg, render = null, botName = () => '', db = sql }) {
  const known = new Map();      // chatId -> زمان آخرین ثبت (برای کم کردن نوشتن توی دیتابیس)
  const lastCmd = new Map();    // chatId -> زمان آخرین جواب
  const cache = new Map();      // chatId -> { g, at }

  async function upsert(chat, active = true) {
    if (!chat || !GROUP_TYPES.includes(chat.type)) return;
    await db`INSERT INTO bot_groups (chat_id, title, kind, active) VALUES (${chat.id}, ${String(chat.title || '').slice(0, 120)}, ${chat.type}, ${active})
      ON CONFLICT (chat_id) DO UPDATE SET title = EXCLUDED.title, kind = EXCLUDED.kind, active = ${active}, updated_at = NOW()`;
    known.set(String(chat.id), Date.now()); cache.delete(String(chat.id));
  }
  async function get(id) {
    const c = cache.get(String(id)); if (c && Date.now() - c.at < 20000) return c.g;
    const r = await db`SELECT * FROM bot_groups WHERE chat_id = ${id}`;
    const g = r[0] ? shape(r[0]) : null; cache.set(String(id), { g, at: Date.now() }); return g;
  }
  async function list() { const r = await db`SELECT * FROM bot_groups ORDER BY active DESC, added_at DESC LIMIT 300`; return r.map(shape); }
  async function update(id, p) {
    const q = (v) => v; void q;
    if (p.enabled != null) await db`UPDATE bot_groups SET enabled = ${!!p.enabled}, updated_at = NOW() WHERE chat_id = ${id}`;
    if (p.mode != null && MODES.includes(p.mode)) await db`UPDATE bot_groups SET mode = ${p.mode}, updated_at = NOW() WHERE chat_id = ${id}`;
    if (p.interval != null) await db`UPDATE bot_groups SET interval_min = ${num(p.interval, 10, 1440, 180)}, updated_at = NOW() WHERE chat_id = ${id}`;
    if (p.times != null) await db`UPDATE bot_groups SET times = ${parseTimes(Array.isArray(p.times) ? p.times.join(',') : p.times).join(',') || '09:00'}, updated_at = NOW() WHERE chat_id = ${id}`;
    if (p.sections != null) await db`UPDATE bot_groups SET sections = ${parseSections(Array.isArray(p.sections) ? p.sections.join(',') : p.sections).join(',')}, updated_at = NOW() WHERE chat_id = ${id}`;
    if (p.cooldown != null) await db`UPDATE bot_groups SET cooldown_sec = ${num(p.cooldown, 0, 3600, 30)}, updated_at = NOW() WHERE chat_id = ${id}`;
    if (p.ai != null) await db`UPDATE bot_groups SET ai_on = ${!!p.ai}, updated_at = NOW() WHERE chat_id = ${id}`;
    if (p.delPrev != null) await db`UPDATE bot_groups SET del_prev = ${!!p.delPrev}, updated_at = NOW() WHERE chat_id = ${id}`;
    cache.delete(String(id));
    return get(id);
  }
  async function remove(id) { await db`DELETE FROM bot_groups WHERE chat_id = ${id}`; cache.delete(String(id)); known.delete(String(id)); }

  // ارسال بستهٔ نرخ‌ها: عکس + متن زیرش (اگه متن طولانی بود، بقیه‌اش یک پیام جدا درست زیر عکس)
  async function sendPack(chatId, { sections, only, tz = 'Asia/Tehran' } = {}) {
    const d = await getRates();
    if (!hasAnyRates(d)) throw new Error('rates_unavailable');
    const want = sections && sections.length ? sections : ALL;
    const hasFx = want.includes('fiat') || want.includes('gold'), hasCr = want.includes('crypto');
    const mode = only || (hasFx && hasCr ? undefined : hasCr ? 'crypto' : 'fx');
    const { caption, extra } = composeRates(d, want, tz);
    let buf = null;
    try { buf = render && render.rates ? await render.rates({ data: d, tz, only: mode }) : null; } catch (e) { buf = null; }
    const ids = [];
    if (buf) {
      try {
        const m = await tg.sendPhoto(chatId, buf, caption);
        if (m && m.message_id) ids.push(m.message_id);
        if (extra) { const m2 = await tg.send(chatId, extra); if (m2 && m2.message_id) ids.push(m2.message_id); }
        return ids;
      } catch (e) { if (/chat not found|kicked|blocked|not a member|forbidden/i.test(String(e.message))) throw e; /* عکس نشد: متن */ }
    }
    const m = await tg.send(chatId, caption + (extra ? '\n\n' + extra : ''));
    if (m && m.message_id) ids.push(m.message_id);
    return ids;
  }

  async function sendAuto(g) {
    if (g.delPrev && g.last && g.last.length) { for (const id of g.last) { try { await tg.del(g.id, id); } catch (e) { /* ignore */ } } }
    const ids = await sendPack(g.id, { sections: g.sections });
    await db`UPDATE bot_groups SET last_msgs = ${JSON.stringify(ids)}, updated_at = NOW() WHERE chat_id = ${g.id}`;
    cache.delete(String(g.id));
    return ids;
  }
  // ارسال دستی از پنل ادمین (زمان‌بندی خودکار رو به‌هم نمی‌زنه)
  async function sendNow(id) {
    const g = await get(id); if (!g) throw new Error('not_found');
    const ids = await sendPack(g.id, { sections: g.sections });
    return ids.length;
  }

  let ticking = false;
  async function tick() {
    if (ticking) return; ticking = true;
    try {
      const rows = (await db`SELECT * FROM bot_groups WHERE active = TRUE AND mode <> 'off'`).map(shape);
      const nowMs = Date.now();
      for (const g of rows) {
        if (!isDue(g, nowMs)) continue;
        // رزرو اتمیک تا دو نمونهٔ سرور هم‌زمان نفرستن
        const cut = new Date(g.lastAuto ? g.lastAuto * 1000 : 0).toISOString();
        const claim = await db`UPDATE bot_groups SET last_auto = NOW() WHERE chat_id = ${g.id} AND (last_auto IS NULL OR last_auto <= ${cut}) RETURNING chat_id`;
        if (!claim.length) continue;
        try { await sendAuto(g); }
        catch (e) {
          console.error('group auto send failed:', g.id, e && e.message);
          if (/chat not found|kicked|not a member|forbidden|have no rights|group chat was deleted/i.test(String(e && e.message))) await db`UPDATE bot_groups SET active = FALSE WHERE chat_id = ${g.id}`;
          else await db`UPDATE bot_groups SET last_auto = ${cut} WHERE chat_id = ${g.id}`; // خطای موقت: دفعهٔ بعد دوباره
        }
      }
    } catch (e) { console.error('group tick:', e && e.message); }
    finally { ticking = false; }
  }
  let timer = null;
  function start() { if (timer) return; timer = setInterval(() => { tick(); }, 60000); if (timer.unref) timer.unref(); setTimeout(() => { tick(); }, 15000).unref?.(); }

  // ---------- رویدادهای تلگرام ----------
  async function onMember(ev) {
    const st = ev && ev.new_chat_member && ev.new_chat_member.status, chat = ev && ev.chat;
    if (!chat || !GROUP_TYPES.includes(chat.type)) return;
    if (['member', 'administrator', 'creator'].includes(st)) await upsert(chat, true);
    else if (['left', 'kicked'].includes(st)) await upsert(chat, false);
  }
  const CMD = /^\/([a-z_]+)(@(\w+))?(\s|$)/i;
  const FX_WORDS = /^(نرخ|نرخ ارز|نرخ ارز و طلا|نرخ دلار|قیمت|قیمت ارز|قیمت دلار|قیمت طلا|نرخ طلا)\s*[؟?!.]*$/;
  const CR_WORDS = /^(ارز دیجیتال|کریپتو|نرخ ارز دیجیتال|قیمت ارز دیجیتال|نرخ کریپتو|قیمت کریپتو)\s*[؟?!.]*$/;
  function classify(text, me) {
    const t = String(text || '').trim();
    const c = CMD.exec(t);
    if (c) {
      if (c[3] && me && c[3].toLowerCase() !== String(me).toLowerCase()) return null; // دستور برای ربات دیگه‌ست
      const k = c[1].toLowerCase();
      if (['rates', 'rate', 'nerkh', 'price', 'prices', 'arz', 'ghimat'].includes(k)) return 'all';
      if (['crypto', 'coins', 'coin', 'cryptos'].includes(k)) return 'crypto';
      return null;
    }
    const plain = t.replace(new RegExp('@' + String(me || '__none__') + '\\b', 'i'), '').trim();
    if (CR_WORDS.test(plain)) return 'crypto';
    if (FX_WORDS.test(plain)) return 'all';
    return null;
  }
  // سؤال از هوش مصنوعی توی گروه: /ai سؤال ، منشن ربات ، یا ریپلای به پیام ربات
  function aiTrigger(m, me, mode) {
    const text = String(m.text || '').trim(); if (!text) return null;
    const c = /^\/(ai|ask)(@(\w+))?(\s+([\s\S]*))?$/i.exec(text);
    if (c) { if (c[3] && me && c[3].toLowerCase() !== String(me).toLowerCase()) return null; return { q: String(c[5] || '').trim(), cmd: true, prior: '' }; }
    if (mode !== 'mention' || !me) return null;
    const re = new RegExp('@' + String(me).replace(/[^\w]/g, '') + '\\b', 'i');
    if (re.test(text)) return { q: text.replace(re, '').trim(), cmd: false, prior: '' };
    const rp = m.reply_to_message;
    if (rp && rp.from && rp.from.is_bot && rp.from.username && rp.from.username.toLowerCase() === String(me).toLowerCase()) return { q: text, cmd: false, prior: String(rp.text || rp.caption || '').slice(0, 1200) };
    return null;
  }
  const aiWarned = new Map();
  async function onAiMessage(m, g, t) {
    const chat = m.chat, uid = String(m.from.id), cfg = getAiConfig();
    if (!g || !g.ai || !cfg.group) return;
    if (!t.q) {
      const k = chat.id + ':usage', nowMs = Date.now();
      if (nowMs - (aiWarned.get(k) || 0) > 60000) { aiWarned.set(k, nowMs); try { await tg.send(chat.id, 'بعد از /ai سؤالت رو بنویس؛ مثلاً: <code>/ai ریسک ۱ درصد یعنی چی؟</code>', undefined, { reply_to_message_id: m.message_id, allow_sending_without_reply: true }); } catch (e) { /* ignore */ } }
      return;
    }
    const chk = checkAi('group', uid, chat.id);
    if (!chk.ok) {
      if ((chk.reason === 'daily' || chk.reason === 'group_daily') && shouldWarn('group', uid, chat.id)) { try { await tg.send(chat.id, chk.reason === 'daily' ? 'سقف سؤال امروزت توی این گروه پر شده؛ فردا دوباره بپرس.' : 'سقف سؤال‌های امروزِ این گروه پر شده؛ فردا دوباره امتحان کن.', undefined, { reply_to_message_id: m.message_id, allow_sending_without_reply: true }); } catch (e) { /* ignore */ } }
      return;
    }
    try { if (tg.action) await tg.action(chat.id, 'typing'); } catch (e) { /* ignore */ }
    const msgs = []; if (t.prior) msgs.push({ role: 'assistant', text: t.prior }); msgs.push({ role: 'user', text: t.q.slice(0, 1500) });
    const r = await askAi({ scope: 'group', uid, chatId: chat.id, msgs });
    const opt = { reply_to_message_id: m.message_id, allow_sending_without_reply: true };
    if (!r.ok) {
      if (['ai_busy', 'ai_timeout', 'ai_failed', 'ai_empty'].includes(r.reason)) { try { await tg.send(chat.id, 'الان نتونستم جواب بدم؛ چند لحظه بعد دوباره بپرس.', undefined, opt); } catch (e) { /* ignore */ } }
      return;
    }
    let out = mdToTg(r.reply); if (out.length > 3500) out = out.slice(0, 3490) + '…';
    try { await tg.send(chat.id, out, undefined, opt); }
    catch (e) { try { await tg.send(chat.id, String(r.reply).slice(0, 3500).replace(/[<>&]/g, ' '), undefined, opt); } catch (e2) { /* ignore */ } }
  }
  async function onMessage(m) {
    const chat = m.chat; if (!chat || !GROUP_TYPES.includes(chat.type)) return;
    const key = String(chat.id);
    if (!known.has(key) || Date.now() - known.get(key) > 6 * 3600e3) { try { await upsert(chat, true); } catch (e) { /* ignore */ } }
    if (!m.from || m.from.is_bot) return;
    const kind = classify(m.text, botName());
    const g = await get(chat.id);
    if (!kind) { const t = aiTrigger(m, botName(), getAiConfig().groupTrigger); if (t) await onAiMessage(m, g, t); return; }
    if (!g || !g.enabled) return;
    const nowMs = Date.now(), prev = lastCmd.get(key) || 0;
    if (nowMs - prev < Math.max(0, g.cooldown) * 1000) return; // جلوگیری از اسپم
    lastCmd.set(key, nowMs);
    try { await sendPack(chat.id, { sections: kind === 'crypto' ? ['crypto'] : g.sections }); }
    catch (e) {
      if (e && e.message === 'rates_unavailable') { try { await tg.send(chat.id, 'الان به منبع قیمت‌ها وصل نشدم؛ چند دقیقه بعد دوباره بزن.'); } catch (e2) { /* ignore */ } }
      else console.error('group rates failed:', chat.id, e && e.message);
    }
  }

  async function loadSettings() {
    try {
      const r = await db`SELECT v FROM bot_settings WHERE k = 'usd_manual'`;
      if (r[0] && r[0].v) { const o = JSON.parse(r[0].v); setManualUsd(o.price, o.at); }
    } catch (e) { console.error('load settings:', e && e.message); }
  }
  async function saveManualUsd(price) {
    const m = setManualUsd(price);
    if (m) await db`INSERT INTO bot_settings (k, v) VALUES ('usd_manual', ${JSON.stringify(m)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`;
    else await db`DELETE FROM bot_settings WHERE k = 'usd_manual'`;
    return m;
  }
  return { aiTrigger, upsert, get, list, update, remove, sendNow, sendPack, tick, start, onMember, onMessage, classify, loadSettings, saveManualUsd, isDue };
}
