// گروه‌ها و کانال‌های تلگرام: جواب به «نرخ ارز» (با دکمهٔ بروزرسانی زیر پیام) + ارسال خودکار لیست قیمت‌ها طبق تنظیمات ادمین
import { sql } from './db.js';
import { getRates, hasAnyRates, composeRates, setManualUsd, setRatesConfig, getRatesConfig, matchRatesWord } from './rates.js';
import { askAi, checkAi, shouldWarn, mdToTg, getAiConfig } from './aicore.js';
import { pickNews, sessionWindows, partsIn, dateEn, MODE_TITLE } from './render.js';
import { detect, newsMode, guideText, aiName, isAiNameOnly, getWords } from './words.js';
import { periodOf } from './card.js';
import { parseWhen, fmtWhen } from './reminders.js';
import { checkAction, track } from './limits.js';

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
  return { id: String(r.chat_id), news: r.news_on == null ? true : !!r.news_on, sess: r.sess_on == null ? true : !!r.sess_on, ai: r.ai_on == null ? true : !!r.ai_on, title: r.title || '', kind: r.kind || 'group', active: !!r.active, enabled: !!r.enabled, mode: MODES.includes(r.mode) ? r.mode : 'off',
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

export function createGroups({ tg, render = null, news = null, botName = () => '', db = sql, reminders = null, cardFor = null, isBotAdmin = null }) {
  const admCache = new Map(); // tgId -> {v, at}: ادمین بودن صاحب ربات (برای معافیت از سقف‌ها)
  const isOwner = async (id) => {
    if (!isBotAdmin || !id) return false;
    const c = admCache.get(String(id)); if (c && Date.now() - c.at < 60000) return c.v;
    let v = false; try { v = !!(await isBotAdmin(id)); } catch (e) { v = false; }
    admCache.set(String(id), { v, at: Date.now() }); return v;
  };
  const replyOpt = (m) => (m && m.message_id ? { reply_to_message_id: m.message_id, allow_sending_without_reply: true } : undefined);
  const known = new Map();      // chatId -> زمان آخرین ثبت (برای کم کردن نوشتن توی دیتابیس)
  const lastCmd = new Map();    // chatId -> زمان آخرین جواب
  const cache = new Map();      // chatId -> { g, at }
  const errs = new Map();       // chatId -> { msg, at } آخرین خطای ارسال خودکار/دستی (توی پنل‌ها نشون داده می‌شه)
  const withErr = (g) => { if (g) { const e = errs.get(String(g.id)); g.err = e ? e.msg : ''; g.errAt = e ? Math.floor(e.at / 1000) : 0; } return g; };
  const errText = (e) => { const m = String((e && e.message) || e || ''); return /have no rights|not enough rights|CHAT_WRITE_FORBIDDEN|can't send/i.test(m) ? 'ربات توی این چت اجازهٔ فرستادن پیام نداره (برای کانال باید ادمین با دسترسی «ارسال پیام» باشه)' : /kicked|not a member|chat not found|deleted/i.test(m) ? 'ربات توی این چت عضو نیست' : /rates_unavailable/.test(m) ? 'منبع قیمت‌ها الان در دسترس نیست' : m.slice(0, 140); };

  async function upsert(chat, active = true) {
    if (!chat || !GROUP_TYPES.includes(chat.type)) return;
    await db`INSERT INTO bot_groups (chat_id, title, kind, active) VALUES (${chat.id}, ${String(chat.title || '').slice(0, 120)}, ${chat.type}, ${active})
      ON CONFLICT (chat_id) DO UPDATE SET title = EXCLUDED.title, kind = EXCLUDED.kind, active = ${active}, updated_at = NOW()`;
    known.set(String(chat.id), Date.now()); cache.delete(String(chat.id));
  }
  async function get(id) {
    const c = cache.get(String(id)); if (c && Date.now() - c.at < 20000) return withErr(c.g);
    const r = await db`SELECT * FROM bot_groups WHERE chat_id = ${id}`;
    const g = r[0] ? shape(r[0]) : null; cache.set(String(id), { g, at: Date.now() }); return withErr(g);
  }
  async function list() { const r = await db`SELECT * FROM bot_groups ORDER BY active DESC, added_at DESC LIMIT 300`; return r.map(shape).map(withErr); }
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
    if (p.news != null) await db`UPDATE bot_groups SET news_on = ${!!p.news}, updated_at = NOW() WHERE chat_id = ${id}`;
    if (p.sess != null) await db`UPDATE bot_groups SET sess_on = ${!!p.sess}, updated_at = NOW() WHERE chat_id = ${id}`;
    cache.delete(String(id));
    return get(id);
  }
  async function remove(id) { await db`DELETE FROM bot_groups WHERE chat_id = ${id}`; cache.delete(String(id)); known.delete(String(id)); }

  // ارسال بستهٔ نرخ‌ها: عکس + متن زیرش (اگه متن طولانی بود، بقیه‌اش یک پیام جدا درست زیر عکس)
  const MASK = { fiat: 'f', gold: 'g', crypto: 'c' };
  const refreshKb = (extraId, want) => ({ inline_keyboard: [[{ text: 'بروزرسانی نرخ‌ها', callback_data: 'gr:u:' + (extraId || 0) + ':' + want.map((k) => MASK[k]).join('') }]] });
  async function sendPack(chatId, { sections, only, tz = 'Asia/Tehran', channel = false } = {}) {
    const d = await getRates();
    if (!hasAnyRates(d)) throw new Error('rates_unavailable');
    const want = sections && sections.length ? sections : ALL;
    const hasFx = want.includes('fiat') || want.includes('gold'), hasCr = want.includes('crypto');
    const mode = only || (hasFx && hasCr ? undefined : hasCr ? 'crypto' : 'fx');
    const bn = String(botName() || '').replace(/^@/, '');
    const { caption, extra } = composeRates(d, want, tz, 1000, bn ? '@' + bn : '');
    let buf = null;
    try { buf = render && render.rates ? await render.rates({ data: d, tz, only: mode }) : null; } catch (e) { buf = null; }
    const kbOf = (xid) => (channel ? undefined : refreshKb(xid, want)); // توی کانال دکمهٔ بروزرسانی نیست
    const ids = [];
    if (buf) {
      try {
        // اگه متن اضافه‌ای هست، اول عکس بدون دکمه می‌ره و بعد از فرستادن متن، دکمه (با شناسهٔ پیام دوم) روی عکس گذاشته می‌شه
        const m = await tg.sendPhoto(chatId, buf, caption, extra ? undefined : kbOf(0));
        if (m && m.message_id) ids.push(m.message_id);
        if (extra) {
          const m2 = await tg.send(chatId, extra); if (m2 && m2.message_id) ids.push(m2.message_id);
          if (!channel && m && m.message_id && tg.editMarkup) { try { await tg.editMarkup(chatId, m.message_id, refreshKb(m2 && m2.message_id, want)); } catch (e) { /* بدون دکمه می‌مونه */ } }
        }
        return ids;
      } catch (e) { if (/chat not found|kicked|blocked|not a member|forbidden/i.test(String(e.message))) throw e; /* عکس نشد: متن */ }
    }
    const m = await tg.send(chatId, caption + (extra ? '\n\n' + extra : ''), kbOf(0));
    if (m && m.message_id) ids.push(m.message_id);
    return ids;
  }

  // دکمهٔ «بروزرسانی نرخ‌ها» زیر پیام: همون پیام ویرایش می‌شه، پیام تازه‌ای نمی‌ره
  const lastRefresh = new Map(), lastForce = { at: 0 };
  async function onCallback(q) {
    const m = q.message, data = String(q.data || '');
    if (m && m.chat && GROUP_TYPES.includes(m.chat.type)) {
      if (data.startsWith('gs:')) return onSettingsCallback(q);
      if (data.startsWith('gn:')) return onNewsCallback(q);
    }
    const mm = /^gr:u:(\d+):([fgc]{1,3})$/.exec(data);
    const ans = async (text) => { try { await tg.answer(q.id, text); } catch (e) { /* ignore */ } };
    if (!m || !m.chat || !GROUP_TYPES.includes(m.chat.type) || !mm) return ans();
    const chatId = m.chat.id, key = String(chatId), extraId = +mm[1];
    const want = ALL.filter((k) => mm[2].includes(MASK[k]));
    const nowMs = Date.now();
    if (nowMs - (lastRefresh.get(key) || 0) < 8000) return ans('چند ثانیه بعد دوباره بزن.');
    lastRefresh.set(key, nowMs);
    try {
      const force = nowMs - lastForce.at > 15000; // قیمت تازه از منبع، ولی نه بیشتر از هر ۱۵ ثانیه برای کل ربات
      if (force) lastForce.at = nowMs;
      const d = await getRates({ force });
      if (!hasAnyRates(d)) return ans('الان به منبع قیمت‌ها وصل نشدم.');
      const hasFx = want.includes('fiat') || want.includes('gold'), hasCr = want.includes('crypto');
      const mode = hasFx && hasCr ? undefined : hasCr ? 'crypto' : 'fx';
      const bn = String(botName() || '').replace(/^@/, '');
      const { caption, extra } = composeRates(d, want, 'Asia/Tehran', 1000, bn ? '@' + bn : '');
      const kbFor = (xid) => refreshKb(xid, want);
      let newExtra = extraId;
      if (m.photo) {
        let buf = null;
        try { buf = render && render.rates ? await render.rates({ data: d, tz: 'Asia/Tehran', only: mode }) : null; } catch (e) { buf = null; }
        if (extra && !extraId && tg.send) { try { const m2 = await tg.send(chatId, extra); newExtra = (m2 && m2.message_id) || 0; } catch (e) { newExtra = 0; } }
        else if (extra && extraId) { try { await tg.edit(chatId, extraId, extra); } catch (e) { if (!/not modified/i.test(String(e.message))) console.error('group extra edit:', e && e.message); } }
        try {
          if (buf && tg.editPhoto) await tg.editPhoto(chatId, m.message_id, buf, caption, kbFor(newExtra));
          else await tg.editCaption(chatId, m.message_id, caption, kbFor(newExtra));
        } catch (e) { if (!/not modified/i.test(String(e.message))) throw e; return ans('همین الان بروزه.'); }
      } else {
        try { await tg.edit(chatId, m.message_id, caption + (extra ? '\n\n' + extra : ''), kbFor(0)); }
        catch (e) { if (!/not modified/i.test(String(e.message))) throw e; return ans('همین الان بروزه.'); }
      }
      return ans('نرخ‌ها بروز شد.');
    } catch (e) {
      console.error('group refresh failed:', chatId, e && e.message);
      return ans('بروزرسانی نشد؛ بعداً دوباره بزن.');
    }
  }

  async function sendAuto(g) {
    if (g.delPrev && g.last && g.last.length) { for (const id of g.last) { try { await tg.del(g.id, id); } catch (e) { /* ignore */ } } }
    const ids = await sendPack(g.id, { sections: g.sections, channel: g.kind === 'channel' });
    await db`UPDATE bot_groups SET last_msgs = ${JSON.stringify(ids)}, updated_at = NOW() WHERE chat_id = ${g.id}`;
    cache.delete(String(g.id));
    return ids;
  }
  // ارسال دستی از پنل ادمین (زمان‌بندی خودکار رو به‌هم نمی‌زنه)
  async function sendNow(id) {
    const g = await get(id); if (!g) throw new Error('not_found');
    try { const ids = await sendPack(g.id, { sections: g.sections, channel: g.kind === 'channel' }); errs.delete(String(g.id)); return ids.length; }
    catch (e) { errs.set(String(g.id), { msg: errText(e), at: Date.now() }); throw e; }
  }

  let ticking = false;
  async function tick() {
    if (ticking) return; ticking = true;
    try {
      const rows = (await db`SELECT * FROM bot_groups WHERE active = TRUE AND mode <> 'off'`).map(shape);
      const nowMs = Date.now();
      for (const g of rows) {
        if (!isDue(g, nowMs)) continue;
        // رزرو اتمیک تا دو نمونهٔ سرور هم‌زمان نفرستن (مقایسه با ثانیهٔ گرد‌شده، چون توی دیتابیس کسر ثانیه هم هست)
        const claim = await db`UPDATE bot_groups SET last_auto = NOW() WHERE chat_id = ${g.id} AND (last_auto IS NULL OR FLOOR(EXTRACT(EPOCH FROM last_auto)) <= ${g.lastAuto})
          RETURNING chat_id`;
        if (!claim.length) continue;
        try { await sendAuto(g); errs.delete(String(g.id)); console.log('group auto sent:', g.id, g.title || ''); }
        catch (e) {
          const m = String((e && e.message) || e);
          console.error('group auto send failed:', g.id, m);
          errs.set(String(g.id), { msg: errText(e), at: Date.now() });
          if (/have no rights|not enough rights|can't send|CHAT_WRITE_FORBIDDEN/i.test(m)) { /* فعال می‌مونه؛ ادمین خطا رو می‌بینه و دسترسی رو درست می‌کنه. تلاش بعدی طبق زمان‌بندی */ }
          else if (/chat not found|kicked|not a member|forbidden|group chat was deleted/i.test(m)) await db`UPDATE bot_groups SET active = FALSE WHERE chat_id = ${g.id}`;
          else if (g.lastAuto) await db`UPDATE bot_groups SET last_auto = to_timestamp(${g.lastAuto}) WHERE chat_id = ${g.id}`; // خطای موقت: دفعهٔ بعد دوباره
          else await db`UPDATE bot_groups SET last_auto = NULL WHERE chat_id = ${g.id}`;
        }
      }
    } catch (e) { console.error('group tick:', e && e.message); }
    finally { ticking = false; }
  }
  let timer = null;
  function start() { if (timer) return; timer = setInterval(() => { tick(); }, 60000); if (timer.unref) timer.unref(); setTimeout(() => { tick(); }, 15000).unref?.(); }

  // ---------- رویدادهای تلگرام ----------
  async function onMember(ev) {
    const st = ev && ev.new_chat_member && ev.new_chat_member.status, old = ev && ev.old_chat_member && ev.old_chat_member.status, chat = ev && ev.chat;
    if (!chat || !GROUP_TYPES.includes(chat.type)) return;
    if (['member', 'administrator', 'creator'].includes(st)) {
      const fresh = !old || ['left', 'kicked'].includes(old);
      await upsert(chat, true);
      if (chat.type === 'channel') return;
      if (fresh) { try { await tg.send(chat.id, welcomeText(await get(chat.id), st !== 'member')); } catch (e) { console.error('welcome send failed:', chat.id, e && e.message); } }
      else if (old === 'member' && st === 'administrator') { try { await tg.send(chat.id, '<b>✅ ممنون که ادمینم کردی!</b>\nحالا همهٔ امکانات بدون محدودیت کار می‌کنن. برای دیدن کلمه‌ها بنویس «راهنما».'); } catch (e) { /* ignore */ } }
    } else if (['left', 'kicked'].includes(st)) await upsert(chat, false);
  }
  const flagsOf = (g) => (g ? { rates: g.enabled, news: g.news, sess: g.sess, ai: g.ai && getAiConfig().group } : null);
  function welcomeText(g, isAdminNow) {
    const bn = String(botName() || '').replace(/^@/, '');
    let t = '<b>👋 سلام! من ربات Surpri3eFX هستم</b>\n\n' + guideText({ botUser: bn, flags: flagsOf(g), intro: false });
    t += '\n\n' + (isAdminNow ? '✅ ادمینم؛ همهٔ امکانات فعاله.' : '⚠️ <b>الان ادمین نیستم.</b> برای اینکه همهٔ پیام‌های گروه رو ببینم و درست جواب بدم، منو <b>ادمین</b> کن (فقط دسترسی «ارسال پیام» کافیه).');
    t += '\n\n⚙️ ادمین‌های گروه با نوشتن «تنظیمات» می‌تونن هر امکان رو روشن/خاموش کنن یا ارسال خودکار نرخ‌ها رو تنظیم کنن.\n📖 هر وقت خواستی بنویس «راهنما».';
    return t;
  }
  // اطلاع کلمه‌های جدید به همهٔ گروه‌های فعال (بعد از تغییر توی پنل ادمین)
  async function broadcastGuide() {
    const all = (await list()).filter((g) => g.active && g.kind !== 'channel');
    let ok = 0;
    for (const g of all) {
      try { await tg.send(g.id, '<b>🔔 کلمه‌های فعال‌ساز ربات بروز شد</b>\nاز این به بعد این‌ها کار می‌کنن:\n\n' + guideText({ botUser: String(botName() || '').replace(/^@/, ''), flags: flagsOf(g), intro: false })); ok++; }
      catch (e) { if (/kicked|chat not found|not a member|forbidden/i.test(String(e && e.message))) await db`UPDATE bot_groups SET active = FALSE WHERE chat_id = ${g.id}`.catch(() => {}); }
      await new Promise((r) => setTimeout(r, 120));
    }
    return { sent: ok, total: all.length };
  }
  let bcTimer = null;
  // چند تغییر پشت‌سرهم یک‌جا اعلام می‌شن (۶۰ ثانیه بعد از آخرین تغییر)
  function scheduleBroadcast(delayMs = 60000) { if (bcTimer) clearTimeout(bcTimer); bcTimer = setTimeout(() => { bcTimer = null; broadcastGuide().catch((e) => console.error('guide broadcast:', e && e.message)); }, delayMs); if (bcTimer.unref) bcTimer.unref(); }
  const CMD = /^\/([a-z_]+)(@(\w+))?(\s|$)/i;
  const KIND_OF = { rates: 'all', crypto: 'crypto', sess: 'sess', help: 'help', settings: 'settings', remind: 'remind', ai: 'ai' };
  // خروجی: { kind, arg, pos } یا null. kind: all|crypto|settings|sess|help|remind|ai|news:d0|d1|w|nw|card:d|w|m|y|a
  function classifyFull(text, me) {
    const t = String(text || '').trim();
    const c = CMD.exec(t);
    if (c) {
      if (c[3] && me && c[3].toLowerCase() !== String(me).toLowerCase()) return null; // دستور برای ربات دیگه‌ست
      const k = c[1].toLowerCase(), rest = t.slice(c[0].length).trim();
      if (['rates', 'rate', 'nerkh', 'price', 'prices', 'arz', 'ghimat'].includes(k)) return { kind: 'all', arg: rest, pos: 'cmd' };
      if (['crypto', 'coins', 'coin', 'cryptos'].includes(k)) return { kind: 'crypto', arg: rest, pos: 'cmd' };
      if (['settings', 'setting', 'config'].includes(k)) return { kind: 'settings', arg: '', pos: 'cmd' };
      if (['news', 'calendar'].includes(k)) return { kind: 'news:' + newsMode(rest), arg: rest, pos: 'cmd' };
      if (['sessions', 'session'].includes(k)) return { kind: 'sess', arg: '', pos: 'cmd' };
      if (['help', 'guide', 'start'].includes(k)) return { kind: 'help', arg: '', pos: 'cmd' };
      if (['card'].includes(k)) return { kind: 'card:' + periodOf(rest), arg: rest, pos: 'cmd' };
      if (['remind', 'reminder'].includes(k)) return { kind: 'remind', arg: rest, pos: 'cmd' };
      return null;
    }
    const d = detect(t, { me });
    if (!d) return null;
    const kind = d.k === 'news' ? 'news:' + newsMode(d.arg) : d.k === 'card' ? 'card:' + periodOf(d.arg) : KIND_OF[d.k];
    return kind ? { kind, arg: d.arg, pos: d.pos } : null;
  }
  const classify = (text, me) => { const r = classifyFull(text, me); return r ? r.kind : null; };
  // سؤال از هوش مصنوعی توی گروه: /ai سؤال ، منشن ربات ، یا ریپلای به پیام ربات
  function aiTrigger(m, me, mode) {
    const text = String(m.text || '').trim(); if (!text) return null;
    const c = /^\/(ai|ask)(@(\w+))?(\s+([\s\S]*))?$/i.exec(text);
    if (c) { if (c[3] && me && c[3].toLowerCase() !== String(me).toLowerCase()) return null; return { q: String(c[5] || '').trim(), cmd: true, prior: '' }; }
    if (mode !== 'mention') return null;
    { const nd = detect(text, { me }); if (nd && nd.k === 'ai') return { q: nd.arg, cmd: false, prior: '', named: true }; }
    if (!me) return null;
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
    const opt = replyOpt(m);
    const owner = await isOwner(m.from.id);
    if (!t.q) {
      const k = chat.id + ':usage', nowMs = Date.now();
      if (nowMs - (aiWarned.get(k) || 0) > 60000) { aiWarned.set(k, nowMs); try { await tg.send(chat.id, t.named ? 'جانم؟ 🙌 سؤالت رو بعد از اسمم بنویس؛ مثلاً: «' + aiName() + ' بیتکوین الان چنده؟»' : 'بعد از /ai سؤالت رو بنویس؛ مثلاً: <code>/ai ریسک ۱ درصد یعنی چی؟</code>', undefined, opt); } catch (e) { /* ignore */ } }
      return;
    }
    const chk = checkAi('group', uid, chat.id, owner);
    if (!chk.ok) {
      if ((chk.reason === 'daily' || chk.reason === 'group_daily') && shouldWarn('group', uid, chat.id)) { try { await tg.send(chat.id, chk.reason === 'daily' ? 'سقف سؤال امروزت توی این گروه پر شده؛ فردا دوباره بپرس. ⏳' : 'سقف سؤال‌های امروزِ این گروه پر شده؛ فردا دوباره امتحان کنین. ⏳', undefined, opt); } catch (e) { /* ignore */ } }
      return;
    }
    const lim = checkAction('group', uid, chat.id, owner);
    if (!lim.ok) { if (lim.warn) { try { await tg.send(chat.id, 'سقف درخواست‌های امروز پر شده؛ فردا دوباره. ⏳', undefined, opt); } catch (e) { /* ignore */ } } return; }
    try { if (tg.action) await tg.action(chat.id, 'typing'); } catch (e) { /* ignore */ }
    const msgs = []; if (t.prior) msgs.push({ role: 'assistant', text: t.prior }); msgs.push({ role: 'user', text: t.q.slice(0, 1500) });
    const r = await askAi({ scope: 'group', uid, chatId: chat.id, msgs, unlimited: owner });
    if (!r.ok) {
      if (['ai_busy', 'ai_timeout', 'ai_failed', 'ai_empty', 'ai_key', 'ai_model', 'ai_region'].includes(r.reason)) { try { await tg.send(chat.id, 'الان نتونستم جواب بدم؛ چند لحظه بعد دوباره بپرس. 🙏', undefined, opt); } catch (e) { /* ignore */ } }
      return;
    }
    track('group', uid, chat.id, 'ai', chat.title);
    let out = mdToTg(r.reply); if (out.length > 3800) out = out.slice(0, 3790) + '…';
    try { await tg.send(chat.id, out, undefined, opt); }
    catch (e) { try { await tg.send(chat.id, String(r.reply).slice(0, 3500).replace(/[<>&]/g, ' '), undefined, opt); } catch (e2) { /* ignore */ } }
  }
  /* ---------- تنظیمات داخل گروه (با نوشتن «تنظیمات»)، اخبار و سشن ---------- */
  const IVS = [10, 15, 30, 60, 120, 180, 360, 720, 1440];
  const ivLabel = (m) => (m >= 1440 ? 'یک روز' : m >= 60 && m % 60 === 0 ? m / 60 + ' ساعت' : m + ' دقیقه');
  const TIME_PRESETS = ['09:00', '09:00,18:00', '08:00,13:00,20:00', '09:00,12:00,15:00,18:00,21:00'];
  const CD_OPTS = [0, 10, 30, 60, 120, 300];
  const onOff = (v) => (v ? 'روشن' : 'خاموش');
  const SEC_FA = { fiat: 'ارز', gold: 'طلا', crypto: 'ارز دیجیتال' };
  const lastNews = new Map();

  async function isGroupAdmin(chat, from, m) {
    if (m && m.sender_chat && m.sender_chat.id === chat.id) return true;   // ادمین ناشناس
    if (from && from.id === 1087968824) return true;                        // GroupAnonymousBot
    if (!from || !tg.getMember) return false;
    try { const r = await tg.getMember(chat.id, from.id); return !!r && ['creator', 'administrator'].includes(r.status); } catch (e) { return false; }
  }
  function settingsPanel(g) {
    const ai = getAiConfig();
    const auto = g.mode === 'off' ? 'خاموش' : g.mode === 'every' ? 'هر ' + ivLabel(g.interval) : 'روزانه ' + g.times.join('، ');
    let t = '<b>تنظیمات ربات برای این گروه</b>\nفقط ادمین‌های گروه می‌تونن تغییر بدن.\n\n' +
      'جواب به «نرخ ارز»: <b>' + onOff(g.enabled) + '</b>\nجواب به «اخبار»: <b>' + onOff(g.news) + '</b>\nجواب به «سشن»: <b>' + onOff(g.sess) + '</b>\nهوش مصنوعی: <b>' + onOff(g.ai) + '</b>' + (ai.group ? '' : ' (از طرف مدیر کل ربات خاموشه)') +
      '\nارسال خودکار نرخ‌ها: <b>' + auto + '</b>\nچی فرستاده بشه: <b>' + g.sections.map((k) => SEC_FA[k]).join('، ') + '</b>\nفاصلهٔ ضد اسپم: <b>' + g.cooldown + ' ثانیه</b>\nپاک شدن پیام خودکار قبلی: <b>' + onOff(g.delPrev) + '</b>' +
      '\n\nبرای دیدن: «نرخ ارز»، «اخبار»، «اخبار فردا»، «اخبار هفته»، «اخبار هفته بعد»، «سشن»';
    const kb = [
      [{ text: 'نرخ ارز: ' + onOff(g.enabled), callback_data: 'gs:rt' }, { text: 'اخبار: ' + onOff(g.news), callback_data: 'gs:nw' }],
      [{ text: 'سشن: ' + onOff(g.sess), callback_data: 'gs:ss' }, { text: 'هوش مصنوعی: ' + onOff(g.ai), callback_data: 'gs:ai' }],
      [{ text: 'ارسال خودکار: ' + (g.mode === 'off' ? 'خاموش' : g.mode === 'every' ? 'فاصله‌ای' : 'ساعت ثابت'), callback_data: 'gs:am' }]
    ];
    if (g.mode === 'every') kb.push([{ text: '−', callback_data: 'gs:iv-' }, { text: 'هر ' + ivLabel(g.interval), callback_data: 'gs:noop' }, { text: '+', callback_data: 'gs:iv+' }]);
    if (g.mode === 'daily') kb.push([{ text: 'ساعت‌ها: ' + g.times.join('، ') + ' (عوض کن)', callback_data: 'gs:tm' }]);
    kb.push(['fiat', 'gold', 'crypto'].map((k) => ({ text: SEC_FA[k] + ': ' + (g.sections.includes(k) ? 'بله' : 'نه'), callback_data: 'gs:s:' + k.slice(0, 1) })));
    kb.push([{ text: 'ضد اسپم: ' + g.cooldown + ' ثانیه', callback_data: 'gs:cd' }, { text: 'پاک کردن قبلی: ' + onOff(g.delPrev), callback_data: 'gs:dp' }]);
    kb.push([{ text: 'ارسال نرخ‌ها همین الان', callback_data: 'gs:now' }, { text: 'بستن', callback_data: 'gs:x' }]);
    return { text: t, kb: { inline_keyboard: kb } };
  }
  async function showSettings(chat) {
    const g = await get(chat.id); if (!g) return;
    const pn = settingsPanel(g);
    await tg.send(chat.id, pn.text, pn.kb);
  }
  // دکمه‌های تنظیمات: فقط ادمین‌ها
  async function onSettingsCallback(q) {
    const m = q.message, chat = m.chat;
    const ans = async (text) => { try { await tg.answer(q.id, text); } catch (e) { /* ignore */ } };
    if (!(await isGroupAdmin(chat, q.from, null))) return ans('فقط ادمین‌های گروه می‌تونن تنظیمات رو عوض کنن.');
    const p = String(q.data || '').split(':'), act = p[1];
    let g = await get(chat.id); if (!g) return ans();
    if (act === 'noop') return ans();
    if (act === 'x') { try { await tg.del(chat.id, m.message_id); } catch (e) { /* ignore */ } return ans(); }
    if (act === 'now') {
      try { const ids = await sendPack(chat.id, { sections: g.sections }); return ans(ids.length ? 'فرستاده شد.' : 'نشد.'); }
      catch (e) { return ans(e && e.message === 'rates_unavailable' ? 'الان به منبع قیمت‌ها وصل نشدم.' : 'ارسال نشد.'); }
    }
    const patch = {};
    if (act === 'rt') patch.enabled = !g.enabled;
    else if (act === 'nw') patch.news = !g.news;
    else if (act === 'ss') patch.sess = !g.sess;
    else if (act === 'ai') patch.ai = !g.ai;
    else if (act === 'dp') patch.delPrev = !g.delPrev;
    else if (act === 'am') patch.mode = g.mode === 'off' ? 'every' : g.mode === 'every' ? 'daily' : 'off';
    else if (act === 'iv+' || act === 'iv-') { const i = Math.max(0, IVS.findIndex((x) => x >= g.interval)); patch.interval = IVS[act === 'iv+' ? Math.min(IVS.length - 1, i + 1) : Math.max(0, i - 1)]; }
    else if (act === 'tm') { const cur = g.times.join(','); const i = TIME_PRESETS.indexOf(cur); patch.times = TIME_PRESETS[(i + 1) % TIME_PRESETS.length]; }
    else if (act === 'cd') patch.cooldown = CD_OPTS[(Math.max(0, CD_OPTS.indexOf(g.cooldown)) + 1) % CD_OPTS.length];
    else if (act === 's') {
      const k = { f: 'fiat', g: 'gold', c: 'crypto' }[p[2]]; if (!k) return ans();
      const nx = g.sections.includes(k) ? g.sections.filter((x) => x !== k) : g.sections.concat(k);
      if (!nx.length) return ans('حداقل یکی باید روشن بمونه.');
      patch.sections = ALL.filter((x) => nx.includes(x));
    } else return ans();
    try { g = await update(chat.id, patch); } catch (e) { console.error('group settings update:', e && e.message); return ans('ذخیره نشد.'); }
    const pn = settingsPanel(g);
    try { await tg.edit(chat.id, m.message_id, pn.text, pn.kb); } catch (e) { if (!/not modified/i.test(String(e && e.message))) console.error('group settings edit:', e && e.message); }
    return ans('ذخیره شد.');
  }

  // ---- اخبار و سشن ----
  const NEWS_MODES = ['d0', 'd1', 'w', 'nw'];
  const newsKb = (mode) => ({ inline_keyboard: [[['d0', 'امروز'], ['d1', 'فردا'], ['w', 'این هفته'], ['nw', 'هفتهٔ بعد']].map(([k, l]) => ({ text: (k === mode ? '• ' : '') + l, callback_data: 'gn:' + k }))] });
  const hmP = (n) => String(n.hh).padStart(2, '0') + ':' + String(n.mm).padStart(2, '0');
  const DAYS_FA = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  const MARK = { High: '●', Medium: '◐', Low: '○', Holiday: '◇' };
  const hx = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function newsPlain(ev, mode, tz, nowMs) {
    const sel = pickNews(ev, { tz, mode, impact: 'M', nowMs });
    let t = '<b>' + MODE_TITLE[mode] + '</b>  ·  ' + dateEn(partsIn(nowMs, tz)).split(' ').slice(0, 3).join(' ');
    if (!sel.rows.length) return t + '\nخبر مهمی پیدا نشد.';
    let rows = sel.rows.slice(0, 40), cur = -1;
    for (const r of rows) {
      if (r.dn !== cur) { cur = r.dn; t += '\n\n<b>' + DAYS_FA[(r.p.wd + 1) % 7] + '  ' + dateEn(r.p).split(' ').slice(1, 3).join(' ') + '</b>'; }
      t += '\n' + hmP(r.p) + '  ' + hx(r.ev.c) + '  ' + (MARK[r.ev.i] || '○') + '  ' + hx(r.ev.t);
    }
    return t.slice(0, 3900);
  }
  function sessionsPlain(tz, nowMs) {
    const win = sessionWindows(nowMs);
    return '<b>سشن‌های بازار</b>  ·  ' + hmP(partsIn(nowMs, tz)) + '\n' + win.map((w) => (w.isOpen ? '<b>' + w.fa + '</b>  باز' : w.fa + '  بسته') + '   ' + hmP(partsIn(w.open * 6e4, tz)) + ' تا ' + hmP(partsIn(w.close * 6e4, tz))).join('\n');
  }
  async function newsEv() { try { if (news && news.ensure) await news.ensure(); } catch (e) { /* ignore */ } return news && news.events ? news.events() : []; }
  async function sendNews(chatId, mode, channel) {
    const tz = 'Asia/Tehran', nowMs = Date.now(), ev = await newsEv();
    if (!ev.length) { await tg.send(chatId, 'هنوز داده‌ای از تقویم اخبار ندارم؛ چند دقیقه بعد دوباره بزن.'); return; }
    let buf = null;
    try { buf = render && render.news ? await render.news({ events: ev, tz, mode, impact: 'M', nowMs }) : null; } catch (e) { buf = null; }
    const kb = channel ? undefined : newsKb(mode);
    if (buf) { try { await tg.sendPhoto(chatId, buf, MODE_TITLE[mode], kb); return; } catch (e) { if (/chat not found|kicked|blocked|not a member|forbidden/i.test(String(e.message))) throw e; } }
    await tg.send(chatId, newsPlain(ev, mode, tz, nowMs), kb);
  }
  async function sendSessions(chatId) {
    const tz = 'Asia/Tehran', nowMs = Date.now();
    let buf = null;
    try { buf = render && render.sessions ? await render.sessions({ tz, nowMs }) : null; } catch (e) { buf = null; }
    if (buf) { try { await tg.sendPhoto(chatId, buf, 'سشن‌های بازار'); return; } catch (e) { if (/chat not found|kicked|blocked|not a member|forbidden/i.test(String(e.message))) throw e; } }
    await tg.send(chatId, sessionsPlain(tz, nowMs));
  }
  // دکمه‌های امروز/فردا/هفته: همون پیام ویرایش می‌شه
  async function onNewsCallback(q) {
    const m = q.message, chat = m.chat, key = 'n' + chat.id;
    const ans = async (text) => { try { await tg.answer(q.id, text); } catch (e) { /* ignore */ } };
    const mode = String(q.data || '').split(':')[1];
    if (!NEWS_MODES.includes(mode)) return ans();
    const nowMs = Date.now();
    if (nowMs - (lastNews.get(key) || 0) < 3000) return ans('چند ثانیه بعد دوباره بزن.');
    lastNews.set(key, nowMs);
    const tz = 'Asia/Tehran', ev = await newsEv();
    if (!ev.length) return ans('هنوز داده‌ای ندارم.');
    try {
      if (m.photo) {
        let buf = null; try { buf = render && render.news ? await render.news({ events: ev, tz, mode, impact: 'M', nowMs }) : null; } catch (e) { buf = null; }
        if (!buf) return ans('ساخت تصویر نشد.');
        await tg.editPhoto(chat.id, m.message_id, buf, MODE_TITLE[mode], newsKb(mode));
      } else await tg.edit(chat.id, m.message_id, newsPlain(ev, mode, tz, nowMs), newsKb(mode));
    } catch (e) { if (!/not modified/i.test(String(e && e.message))) { console.error('group news edit:', e && e.message); return ans('نشد.'); } }
    return ans();
  }

  // ---- امکانات «کلمه‌ای»: کارت، یادآوری، راهنما (هم برای گروه هم برای پیوی) ----
  const hint = (t) => String(t == null ? '' : t);
  async function sendCard(chatId, tgId, per, opt) {
    const say = (t) => tg.send(chatId, t, undefined, opt);
    if (!cardFor) return say('کارت نتیجه الان در دسترس نیست.');
    let r; try { r = await cardFor(tgId, per); } catch (e) { console.error('card failed:', e && e.message); return say('ساخت کارت نشد؛ چند لحظه بعد دوباره بزن.'); }
    const bn = String(botName() || '').replace(/^@/, '');
    if (r.state === 'none') return say('📊 هنوز ژورنالی برات ندارم. توی پیوی ربات' + (bn ? ' (@' + bn + ')' : '') + ' چند معامله ثبت کن تا کارت نتیجه‌ات ساخته بشه.');
    if (r.state === 'nodata') return say(r.text);
    if (r.buf) { try { await tg.sendPhoto(chatId, r.buf, '<b>📊 ' + hint(r.o.title) + '</b>', undefined, opt); return; } catch (e) { /* متن */ } }
    return say(r.text);
  }
  async function remindFlow({ chatId, tgId, arg, strict, opt, owner }) {
    if (!reminders) return;
    const say = (t) => tg.send(chatId, t, undefined, opt);
    const r = parseWhen(arg, Date.now());
    if (!r) { if (strict) await say('⏰ <b>کی یادت بندازم؟</b>\nمثال:\n• یادم بنداز فردا ساعت ۹ جلسه دارم\n• یادم بنداز ۲ ساعت دیگه دارو بخورم\n• یادم بنداز دوشنبه ساعت ۱۰ چک کردن اخبار'); return; }
    const res = await reminders.add({ tgId, chatId, text: r.text || 'یادآوری', at: r.at, unlimited: owner });
    if (!res.ok) return say(res.reason === 'limit' ? '⏰ سقف یادآوری‌های فعالت پر شده (' + res.max + ' تا). چندتا رو پاک کن یا صبر کن بهشون برسه.' : res.reason === 'far' ? 'یادآوری بیشتر از یک سال بعد ممکن نیست.' : 'متن یادآوری خالیه.');
    return say('<b>✅ باشه، یادآوری ثبت شد</b>\n🗓 ' + fmtWhen(r.at) + '\n📝 ' + hint(r.text || 'یادآوری').replace(/[<>&]/g, ' '));
  }
  async function sendHelp(chatId, g, opt) {
    return tg.send(chatId, '<b>📖 راهنما</b>\n\n' + guideText({ botUser: String(botName() || '').replace(/^@/, ''), flags: flagsOf(g), intro: false }), undefined, opt);
  }

  async function onMessage(m) {
    const chat = m.chat; if (!chat || !GROUP_TYPES.includes(chat.type)) return;
    const key = String(chat.id);
    if (!known.has(key) || Date.now() - known.get(key) > 6 * 3600e3) { try { await upsert(chat, true); } catch (e) { /* ignore */ } }
    const anon = !!(m.sender_chat && m.sender_chat.id === chat.id);
    if (!m.from || (m.from.is_bot && !anon && m.from.id !== 1087968824)) return;
    const cl = classifyFull(m.text, botName());
    const kind = cl ? cl.kind : null;
    const g = await get(chat.id);
    const opt = replyOpt(m);
    if (kind === 'settings') {
      if (chat.type === 'channel') return;
      if (await isGroupAdmin(chat, m.from, m)) { try { await showSettings(chat); } catch (e) { console.error('group settings show:', e && e.message); } }
      else { try { await tg.send(chat.id, 'فقط ادمین‌های گروه می‌تونن تنظیمات ربات رو ببینن و عوض کنن.', undefined, opt); } catch (e) { /* ignore */ } }
      return;
    }
    // سقف‌های ربات (ادمین ربات معافه)؛ هوش مصنوعی سقف جدا داره
    const feature = kind && kind !== 'ai';
    let owner = false;
    if (feature) {
      owner = await isOwner(m.from.id);
      const lim = checkAction('group', String(m.from.id), chat.id, owner);
      if (!lim.ok) { if (lim.warn) { try { await tg.send(chat.id, 'سقف درخواست‌های امروزِ ربات پر شده؛ فردا دوباره. ⏳', undefined, opt); } catch (e) { /* ignore */ } } return; }
    }
    const done = (what) => { track('group', String(m.from.id), chat.id, what, chat.title); };
    if (kind === 'help') {
      const nowMs3 = Date.now(), k3 = 'h' + key;
      if (nowMs3 - (lastNews.get(k3) || 0) < 15000) return;
      lastNews.set(k3, nowMs3);
      try { await sendHelp(chat.id, g, opt); done('help'); } catch (e) { console.error('group help failed:', chat.id, e && e.message); }
      return;
    }
    if (kind === 'remind') {
      if (chat.type === 'channel') return;
      try { await remindFlow({ chatId: chat.id, tgId: m.from.id, arg: cl.arg, strict: cl.pos !== 'any', opt, owner }); done('remind'); } catch (e) { console.error('group remind failed:', chat.id, e && e.message); }
      return;
    }
    if (kind && kind.startsWith('card:')) {
      if (chat.type === 'channel' || !g) return;
      const nowMs4 = Date.now(), k4 = 'c' + key + ':' + m.from.id;
      if (nowMs4 - (lastNews.get(k4) || 0) < Math.max(10, g.cooldown) * 1000) return;
      lastNews.set(k4, nowMs4);
      try { await sendCard(chat.id, m.from.id, kind.slice(5), opt); done('card'); } catch (e) { console.error('group card failed:', chat.id, e && e.message); }
      return;
    }
    if (kind && (kind === 'sess' || kind.startsWith('news:'))) {
      if (!g || !(kind === 'sess' ? g.sess : g.news)) return;
      const nowMs2 = Date.now(), k2 = 'n' + key;
      if (nowMs2 - (lastNews.get(k2) || 0) < Math.max(3, g.cooldown) * 1000) return;
      lastNews.set(k2, nowMs2);
      try { if (kind === 'sess') await sendSessions(chat.id); else await sendNews(chat.id, kind.slice(5), chat.type === 'channel'); done(kind === 'sess' ? 'sess' : 'news'); }
      catch (e) { console.error('group news/sessions failed:', chat.id, e && e.message); }
      return;
    }
    if (!kind || kind === 'ai') { const t = aiTrigger(m, botName(), getAiConfig().groupTrigger); if (t) await onAiMessage(m, g, t); return; }
    if (!g || !g.enabled) return;
    const nowMs = Date.now(), prev = lastCmd.get(key) || 0;
    if (nowMs - prev < Math.max(0, g.cooldown) * 1000) return; // جلوگیری از اسپم
    lastCmd.set(key, nowMs);
    try { await sendPack(chat.id, { sections: kind === 'crypto' ? ['crypto'] : g.sections, channel: chat.type === 'channel' }); done(kind === 'crypto' ? 'crypto' : 'rates'); }
    catch (e) {
      if (e && e.message === 'rates_unavailable') { try { await tg.send(chat.id, 'الان به منبع قیمت‌ها وصل نشدم؛ چند دقیقه بعد دوباره بزن.'); } catch (e2) { /* ignore */ } }
      else console.error('group rates failed:', chat.id, e && e.message);
    }
  }

  async function loadSettings() {
    try {
      const r = await db`SELECT v FROM bot_settings WHERE k = 'usd_manual'`;
      if (r[0] && r[0].v) { const o = JSON.parse(r[0].v); setManualUsd(o.price, o.at); }
      const q = await db`SELECT v FROM bot_settings WHERE k = 'rates_cfg'`;
      if (q[0] && q[0].v) setRatesConfig(JSON.parse(q[0].v));
    } catch (e) { console.error('load settings:', e && e.message); }
  }
  // تنظیمات نرخ‌ها (منبع، فهرست ارزها، ...): هم توی حافظه ست می‌شه هم توی دیتابیس
  async function saveRatesConfig(patch) {
    const c = setRatesConfig(patch);
    try { await db`INSERT INTO bot_settings (k, v) VALUES ('rates_cfg', ${JSON.stringify(c)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`; } catch (e) { console.error('rates cfg save:', e && e.message); }
    return c;
  }
  async function saveManualUsd(price) {
    const m = setManualUsd(price);
    if (m) await db`INSERT INTO bot_settings (k, v) VALUES ('usd_manual', ${JSON.stringify(m)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`;
    else await db`DELETE FROM bot_settings WHERE k = 'usd_manual'`;
    return m;
  }
  return { sendNews, sendSessions, sendCard, remindFlow, sendHelp, broadcastGuide, scheduleBroadcast, welcomeText, classifyFull, isOwner, aiTrigger, upsert, get, list, update, remove, sendNow, sendPack, tick, start, onMember, onMessage, classify, loadSettings, saveManualUsd, saveRatesConfig, getRatesConfig, isDue, onCallback };
}

// END-OF-FILE groups.js
