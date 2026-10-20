import express from 'express';
import crypto from 'crypto';
import { rateLimit } from '../lib/limit.js';
import { sql, getAuth } from '../lib/db.js';

// Economic calendar proxy. The server (not each visitor) pulls the free Forex Factory feed
// published by Fair Economy, validates it and serves a cached copy.
//  - a failed/odd refresh NEVER replaces the last good data
//  - the last good copy is also saved in the database, so a restart / sleeping server keeps serving it
//  - when the source cannot be reached from the host, the admin can import the JSON by hand
//  - data older than STALE_MS is flagged stale; older than EXPIRE_MS is withheld completely
const BASES = (process.env.NEWS_FEED_BASE || 'https://nfs.faireconomy.media,https://cdn-nfs.faireconomy.media')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const IMPACTS = new Set(['High', 'Medium', 'Low', 'Holiday']);
const REFRESH_MS = 30 * 60 * 1000;
const STALE_MS = 3 * 60 * 60 * 1000;
const EXPIRE_MS = 24 * 60 * 60 * 1000 * 3; // a manual import may be a day or two old; users still get the stale warning after 3h
const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
];

let cache = { events: [], updatedAt: 0, source: 'none' };
let state = { lastError: null, failCount: 0, lastTry: 0 };
let refreshing = null;
let retryTimer = null;

export function normalize(raw) {
  if (raw && !Array.isArray(raw) && Array.isArray(raw.events)) {
    // already normalized (our own format)
    raw = raw.events.map((e) => ({ title: e.t, country: e.c, date: new Date(e.d).toISOString(), impact: e.i, forecast: e.f, previous: e.p }));
  }
  if (!Array.isArray(raw)) throw new Error('not_array');
  const out = [];
  let bad = 0;
  for (const r of raw) {
    const d = Date.parse(r && r.date);
    if (!r || typeof r.title !== 'string' || typeof r.country !== 'string' || !IMPACTS.has(r.impact) || Number.isNaN(d)) { bad++; continue; }
    out.push({
      id: crypto.createHash('sha1').update(r.title + '|' + r.country + '|' + r.date).digest('hex').slice(0, 12),
      t: r.title.slice(0, 120),
      c: r.country.slice(0, 8),
      d,
      i: r.impact,
      f: String(r.forecast ?? '').slice(0, 32),
      p: String(r.previous ?? '').slice(0, 32)
    });
  }
  if (raw.length && bad / raw.length > 0.2) throw new Error('too_many_invalid');
  return out;
}

async function getJson(url, attempt) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UAS[attempt % UAS.length], Accept: 'application/json,text/plain,*/*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.forexfactory.com/' }
    });
    if (!r.ok) throw new Error('http_' + r.status);
    const text = await r.text();
    try { return JSON.parse(text); } catch { throw new Error('not_json'); }
  } finally { clearTimeout(to); }
}

// try every mirror, twice, with a different User-Agent each time
async function fetchWeek(file) {
  let err = new Error('no_source');
  for (let a = 0; a < 2; a++) {
    for (const base of BASES) {
      try { return await getJson(base + '/' + file, a); } catch (e) { err = e; }
    }
  }
  throw err;
}

async function persist() {
  try {
    const v = JSON.stringify({ updatedAt: cache.updatedAt, source: cache.source, events: cache.events });
    const ex = await sql`SELECT k FROM site_settings WHERE k = 'news_cache'`;
    if (ex.length) await sql`UPDATE site_settings SET v = ${v} WHERE k = 'news_cache'`;
    else await sql`INSERT INTO site_settings (k, v) VALUES ('news_cache', ${v})`;
  } catch (e) { console.error('news persist failed:', e.message); }
}
async function loadFromDb() {
  try {
    const r = await sql`SELECT v FROM site_settings WHERE k = 'news_cache'`;
    if (!r.length || !r[0].v) return;
    const j = JSON.parse(r[0].v);
    const ev = normalize({ events: j.events || [] });
    if (ev.length >= 5 && j.updatedAt > cache.updatedAt) cache = { events: ev, updatedAt: +j.updatedAt, source: (j.source || 'db') + '(restored)' };
  } catch (e) { console.error('news restore failed:', e.message); }
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  const wait = Math.min(15 * 60 * 1000, 60 * 1000 * 2 ** Math.min(state.failCount, 4));
  retryTimer = setTimeout(refresh, wait);
  if (retryTimer.unref) retryTimer.unref();
}

export function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    state.lastTry = Date.now();
    try {
      const thisWeek = normalize(await fetchWeek('ff_calendar_thisweek.json'));
      if (thisWeek.length < 5) throw new Error('too_few_events');
      let nextWeek = [];
      try { nextWeek = normalize(await fetchWeek('ff_calendar_nextweek.json')); } catch { /* next week is not always published */ }
      const map = new Map();
      [...thisWeek, ...nextWeek].forEach((e) => map.set(e.id, e));
      cache = { events: [...map.values()].sort((a, b) => a.d - b.d), updatedAt: Date.now(), source: 'auto' };
      state = { lastError: null, failCount: 0, lastTry: state.lastTry };
      await persist();
    } catch (e) {
      state.lastError = String((e && e.message) || e);
      state.failCount++;
      console.error('news refresh failed:', state.lastError, '(attempt', state.failCount + ')');
      scheduleRetry();
    } finally { refreshing = null; }
  })();
  return refreshing;
}

export async function importFeed(raw) {
  const ev = normalize(raw);
  if (ev.length < 5) throw new Error('too_few_events');
  cache = { events: ev.sort((a, b) => a.d - b.d), updatedAt: Date.now(), source: 'manual' };
  state = { lastError: null, failCount: 0, lastTry: state.lastTry };
  await persist();
  return ev.length;
}

export function newsStatus() {
  const age = cache.updatedAt ? Date.now() - cache.updatedAt : null;
  return { count: cache.events.length, updatedAt: Math.floor(cache.updatedAt / 1000), ageMin: age === null ? null : Math.floor(age / 60000), source: cache.source, stale: age === null ? null : age > STALE_MS, lastError: state.lastError, failCount: state.failCount, lastTry: Math.floor(state.lastTry / 1000), mirrors: BASES };
}
export function newsEvents() { return cache.events; }

export async function startNewsRefresh() {
  await loadFromDb();
  refresh();
  setInterval(refresh, REFRESH_MS).unref();
}

function adminOk(req) {
  const exp = process.env.ADMIN_KEY;
  const got = req.get('X-Admin-Key') || '';
  if (!exp || !got) return false;
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(got).digest(), crypto.createHash('sha256').update(exp).digest());
}

const router = express.Router();
router.get('/', rateLimit({ windowMs: 60 * 1000, max: 60 }), async (req, res) => {
  const admin = adminOk(req);
  if (!admin) { try { getAuth(req); } catch { return res.status(401).json({ error: 'unauthorized' }); } }
  if (!cache.updatedAt) await Promise.race([refresh(), new Promise((r) => setTimeout(r, 8000))]);
  else if (Date.now() - cache.updatedAt > REFRESH_MS && !refreshing) refresh(); // a sleeping free server refreshes on the first visit
  if (!cache.updatedAt) return res.status(503).json({ error: 'unavailable', detail: admin ? state.lastError : undefined });

  const age = Date.now() - cache.updatedAt;
  const expired = age > EXPIRE_MS;
  res.set('Cache-Control', 'no-store');
  res.json({
    updatedAt: Math.floor(cache.updatedAt / 1000),
    stale: age > STALE_MS,
    expired,
    events: expired ? [] : cache.events
  });
});

export default router;
