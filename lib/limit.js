// Tiny in-memory rate limiter (no dependency). Counters reset on server restart.
export function rateLimit({ windowMs, max, key }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const k = String(key ? key(req) : req.ip).slice(0, 300);
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset <= now) {
      if (hits.size >= 50000) hits.clear(); // hard cap so a flood of unique keys cannot exhaust memory
      h = { n: 0, reset: now + windowMs }; hits.set(k, h);
    }
    if (++h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: 'rate_limited' });
    }
    next();
  };
}
