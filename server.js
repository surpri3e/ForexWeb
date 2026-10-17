import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import backupRoutes from './routes/backup.js';
import adminRoutes from './routes/admin.js';
import messageRoutes from './routes/messages.js';
import newsRoutes, { startNewsRefresh } from './routes/news.js';
import { rateLimit } from './lib/limit.js';
import { ensureSchema } from './lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy (correct client IP)
app.disable('x-powered-by');

// Security headers
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=15552000'
  });
  next();
});

// The site and API share one domain, so cross-origin access is only needed for extra origins you list.
const allowed = (process.env.ALLOWED_ORIGINS || 'https://forexweb.onrender.com').split(',').map((s) => s.trim());
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)) }));

// Small body for auth/admin, big body only where the backup needs it
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 150 }), express.json({ limit: '20kb' }), authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/backup', express.json({ limit: '5mb' }), backupRoutes);
app.use('/api/admin', express.json({ limit: '20kb' }), adminRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/news', newsRoutes);

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// JSON errors (body too large / bad JSON) instead of an HTML stack page
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'bad_size' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
  console.error(err);
  res.status(500).json({ error: 'server' });
});

const PORT = process.env.PORT || 3000;
try { await ensureSchema(); } catch (e) { console.error('schema setup failed:', e); }
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
  startNewsRefresh();
});
