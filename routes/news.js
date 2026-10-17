import express from 'express';
import crypto from 'crypto';
import { rateLimit } from '../lib/limit.js';

// Economic calendar proxy: the server (not each visitor) pulls the free Forex Factory feed
// published by Fair Economy, validates it and serves a cached copy.
// Rules that protect users from wrong data:
//  - a failed/odd refresh NEVER replaces the last good data
//  - data older than STALE_MS is flagged stale; older than EXPIRE_MS is withheld completely
const BASE = (process.env.NEWS_FEED_BASE || 'https://nfs.faireconomy.media').replace(/\/+$/, '');
const URLS = {
  thisWeek: BASE + '/ff_calendar_thisweek.json',
  nextWeek: BASE + '/ff_calendar_nextweek.json' // optional; failure is ignored
};
const IMPACTS = new Set(['High', 'Medium', 'Low', 'Holiday']);
const REFRESH_MS = 30 * 60 * 1000;
const STALE_MS = 3 * 60 * 60 * 1000;
const EXPIRE_MS = 24 * 60 * 60 * 1000;

let cache = { events: [], updatedAt: 0, lastError: null };
let refreshing = null;

export function normalize(raw) {
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

async function getJson(url) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'SurpriseFX-Journal/1.0', Accept: 'application/json' } });
    if (!r.ok) throw new Error('http_' + r.status);
    return await r.json();
  } finally { clearTimeout(to); }
}

export function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const thisWeek = normalize(await getJson(URLS.thisWeek));
      if (thisWeek.length < 5) throw new Error('too_few_events');
      let nextWeek = [];
      try { nextWeek = normalize(await getJson(URLS.nextWeek)); } catch { /* next week is not always published */ }
      const map = new Map();
      [...thisWeek, ...nextWeek].forEach((e) => map.set(e.id, e));
      cache = { events: [...map.values()].sort((a, b) => a.d - b.d), updatedAt: Date.now(), lastError: null };
    } catch (e) {
      cache.lastError = String((e && e.message) || e);
      console.error('news refresh failed:', cache.lastError);
    } finally { refreshing = null; }
  })();
  return refreshing;
}

export function startNewsRefresh() {
  refresh();
  setInterval(refresh, REFRESH_MS).unref();
}

const router = express.Router();
router.get('/', rateLimit({ windowMs: 60 * 1000, max: 60 }), async (req, res) => {
  if (!cache.updatedAt) await Promise.race([refresh(), new Promise((r) => setTimeout(r, 8000))]);
  else if (Date.now() - cache.updatedAt > REFRESH_MS) refresh(); // free Render sleeps; first visit after waking triggers a refresh
  if (!cache.updatedAt) return res.status(503).json({ error: 'unavailable' });

  const age = Date.now() - cache.updatedAt;
  const expired = age > EXPIRE_MS;
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    updatedAt: Math.floor(cache.updatedAt / 1000),
    stale: age > STALE_MS,
    expired,
    events: expired ? [] : cache.events
  });
});

export default router;
