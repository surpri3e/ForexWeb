// نصب‌پذیری سایت به‌صورت اپ (PWA) و اتصال به اپ اندروید (TWA)
// - /manifest.webmanifest : مشخصات اپ (اسم، آیکن، رنگ)
// - /sw.js                 : سرویس‌ورکر ساده؛ همیشه اول از اینترنت می‌خونه و فقط وقتی آفلاینی نسخهٔ ذخیره‌شده رو نشون می‌ده
// - /.well-known/assetlinks.json : مدرکی که اپ اندروید رو به این سایت وصل می‌کنه (بدون اون اپ با نوار آدرس باز می‌شه)
import express from 'express';

const router = express.Router();

const MANIFEST = {
  id: '/',
  name: 'Surpri3eFX | ژورنال TP / SL',
  short_name: 'Surpri3eFX',
  description: 'ژورنال معاملات فارکس و کریپتو با آمار، ربات تلگرام و دستیار هوشمند مایکی',
  lang: 'fa',
  dir: 'rtl',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#EDE9E0',
  theme_color: '#EDE9E0',
  categories: ['finance', 'productivity'],
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
};

const SW = `// Surpri3eFX service worker v1
const V = 'sfx-v1';
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then((res) => {
      if (res.ok) { const c = res.clone(); caches.open(V).then((ca) => ca.put('/', c)).catch(() => {}); }
      return res;
    }).catch(() => caches.match('/').then((m) => m || new Response('آفلاین هستی و هنوز نسخهٔ ذخیره‌شده‌ای نداریم.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))));
    return;
  }
  if (u.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(r).then((m) => m || fetch(r).then((res) => { const c = res.clone(); caches.open(V).then((ca) => ca.put(r, c)).catch(() => {}); return res; })));
  }
});
`;

router.get('/manifest.webmanifest', (req, res) => {
  res.set({ 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  res.send(JSON.stringify(MANIFEST));
});

router.get('/sw.js', (req, res) => {
  res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
  res.send(SW);
});

// ANDROID_PACKAGE = شناسهٔ اپ (مثل ir.surpri3efx.app) ، ANDROID_SHA256 = اثرانگشت کلید امضا (چندتا با ویرگول جدا می‌شه)
router.get('/.well-known/assetlinks.json', (req, res) => {
  const pkg = String(process.env.ANDROID_PACKAGE || '').trim();
  const fps = String(process.env.ANDROID_SHA256 || '').split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(x));
  const out = pkg && fps.length
    ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fps } }]
    : [];
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
  res.send(JSON.stringify(out));
});

export default router;

// END-OF-FILE lib/pwa.js
