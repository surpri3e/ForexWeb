// ابزارهای جانبی ربات: دانلود ویدیو/صدا از لینک و تشخیص آهنگ (از لینک یا از کلیپ ارسالی).
// دانلود با yt-dlp (باینری مستقل؛ اولین بار خودکار از GitHub گرفته می‌شه). تشخیص آهنگ با AudD (متغیر AUDD_API_TOKEN).
// همه‌چیز موقتیه: فایل‌ها توی یک پوشهٔ موقت ساخته و بعد از کار پاک می‌شن؛ هیچ‌چیزی نگه‌داری نمی‌شه.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MAX_SEND = 49 * 1024 * 1024;      // سقف آپلود ربات تلگرام (۵۰ مگ)
const MAX_RECOG = 9.5 * 1024 * 1024;     // سقف فایل برای تشخیص آهنگ
const MAX_DURATION = 25 * 60;            // طولانی‌تر از ۲۵ دقیقه دانلود نمی‌شه
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

// اولین لینک http(s) توی متن
export function extractUrl(text) {
  const m = /https?:\/\/[^\s<>"'«»]+/i.exec(String(text || ''));
  if (!m) return '';
  return m[0].replace(/[)\].,،؛!؟]+$/, '');
}
// فقط آدرس‌های اینترنتی عمومی (جلوگیری از باز کردن آدرس‌های داخلی سرور)
export function safeUrl(u) {
  let x; try { x = new URL(String(u)); } catch (e) { return ''; }
  if (!/^https?:$/.test(x.protocol)) return '';
  const h = x.hostname.toLowerCase();
  if (!h.includes('.') || h === 'localhost' || /\.(local|internal|localhost)$/.test(h)) return '';
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(':')) return ''; // آی‌پی مستقیم ممنوع
  if (x.username || x.password) return '';
  return x.toString();
}
export function siteOf(u) {
  try { return new URL(u).hostname.replace(/^(www|m)\./, ''); } catch (e) { return ''; }
}
const cleanName = (s) => String(s || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const run = (cmd, args, { timeout = 120000, cwd } = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout, cwd, maxBuffer: 8 * 1024 * 1024, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
    if (err) { err.stdout = String(stdout || ''); err.stderr = String(stderr || ''); return reject(err); }
    resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
  });
});

export function createTools({ env = process.env, fetchFn = fetch, exec = run, tmpRoot = os.tmpdir() } = {}) {
  let ytPath = env.YTDLP_PATH || '';
  let ytLoading = null;
  let active = 0;
  const waiting = [];
  const info = { downloads: 0, recognized: 0, fails: 0, lastErr: '' };

  const auddToken = () => String(env.AUDD_API_TOKEN || '').trim();
  const canRecognize = () => !!auddToken();

  // صف: هم‌زمان فقط یک کار سنگین (سرور رایگان کم‌حافظه‌ست)
  async function slot(fn) {
    if (waiting.length >= 3) { const e = new Error('busy'); e.code = 'busy'; throw e; }
    if (active >= 1) await new Promise((r) => waiting.push(r));
    active++;
    try { return await fn(); }
    finally { active--; const n = waiting.shift(); if (n) n(); }
  }

  async function ensureYtdlp() {
    if (ytPath) { try { await fs.access(ytPath); return ytPath; } catch (e) { /* دوباره می‌گیریم */ } }
    if (ytLoading) return ytLoading;
    ytLoading = (async () => {
      const dir = path.join(tmpRoot, 'sfx-ytdlp'); await fs.mkdir(dir, { recursive: true });
      const p = path.join(dir, 'yt-dlp');
      try { await fs.access(p); ytPath = p; return p; } catch (e) { /* نیست */ }
      const r = await fetchFn(YTDLP_URL, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
      if (!r.ok) { const e = new Error('ytdlp_download'); e.code = 'tool_missing'; throw e; }
      await fs.writeFile(p + '.part', Buffer.from(await r.arrayBuffer()), { mode: 0o755 });
      await fs.rename(p + '.part', p); await fs.chmod(p, 0o755);
      ytPath = p; return p;
    })().finally(() => { ytLoading = null; });
    return ytLoading;
  }

  async function cookiesArg(dir) {
    const c = String(env.YTDLP_COOKIES || '').trim();
    if (!c) return [];
    const f = path.join(dir, 'cookies.txt'); await fs.writeFile(f, c.replace(/\\n/g, '\n'), { mode: 0o600 });
    return ['--cookies', f];
  }
  const failCode = (e) => {
    const t = String((e && (e.stderr || e.message)) || '');
    if (e && e.code === 'tool_missing') return 'tool_missing';
    if (e && e.killed) return 'timeout';
    if (/larger than max-filesize|File is larger|max-filesize/i.test(t)) return 'too_big';
    if (/Sign in to confirm|not a bot|cookies|login required|Log in|private|age/i.test(t)) return 'login';
    if (/Unsupported URL|no video|There is no video|No video formats|Unable to extract/i.test(t)) return 'unsupported';
    if (/does not pass filter|duration/i.test(t)) return 'too_long';
    if (/HTTP Error 4(03|29)|blocked|unavailable|geo/i.test(t)) return 'blocked';
    return 'failed';
  };

  // دانلود از لینک: kind = 'video' | 'audio'
  async function download(url, kind) {
    const u = safeUrl(url); if (!u) return { ok: false, reason: 'bad_url' };
    return slot(async () => {
      const dir = await fs.mkdtemp(path.join(tmpRoot, 'sfx-dl-'));
      try {
        const yt = await ensureYtdlp();
        const fmt = kind === 'audio'
          ? 'bestaudio[ext=m4a][filesize<45M]/bestaudio[ext=m4a]/bestaudio[filesize<45M]/bestaudio'
          : 'best[ext=mp4][height<=720][filesize<45M]/best[ext=mp4][filesize<45M]/best[ext=mp4][filesize_approx<45M]/best[height<=480]/best';
        const args = ['--no-playlist', '--no-warnings', '--no-progress', '--socket-timeout', '20', '--retries', '2', '--max-filesize', '48M',
          '--match-filters', 'duration<=' + MAX_DURATION + ' | !duration', '-f', fmt, '--no-simulate', '--print', '%(title)s\t%(uploader)s\t%(duration)s',
          '-o', path.join(dir, 'f.%(ext)s'), ...(await cookiesArg(dir)), '--', u];
        const r = await exec(yt, args, { timeout: 180000, cwd: dir });
        const files = (await fs.readdir(dir)).filter((x) => /^f\./.test(x) && !/\.(part|ytdl|json)$/.test(x));
        if (!files.length) return { ok: false, reason: 'failed' };
        const fp = path.join(dir, files[0]), st = await fs.stat(fp);
        if (st.size > MAX_SEND) return { ok: false, reason: 'too_big' };
        const [title, uploader, dur] = (String(r.stdout).trim().split('\n').pop() || '').split('\t');
        const buf = await fs.readFile(fp);
        info.downloads++;
        const ext = path.extname(fp).slice(1).toLowerCase() || (kind === 'audio' ? 'm4a' : 'mp4');
        return { ok: true, buf, ext, title: cleanName(title === 'NA' ? '' : title), uploader: cleanName(uploader === 'NA' ? '' : uploader), duration: Math.round(Number(dur) || 0), size: st.size };
      } catch (e) { info.fails++; info.lastErr = String((e && (e.stderr || e.message)) || e).slice(-200); return { ok: false, reason: failCode(e) }; }
      finally { fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
    }).catch((e) => ({ ok: false, reason: e && e.code === 'busy' ? 'busy' : 'failed' }));
  }
  const video = (url) => download(url, 'video');
  const audio = (url) => download(url, 'audio');

  // تشخیص آهنگ از روی بایت‌های صدا/ویدیو
  async function recognizeBuffer(buf, name = 'clip.mp4') {
    if (!canRecognize()) return { ok: false, reason: 'no_key' };
    if (!buf || !buf.length) return { ok: false, reason: 'failed' };
    if (buf.length > MAX_RECOG) return { ok: false, reason: 'too_big' };
    try {
      const f = new FormData();
      f.append('api_token', auddToken()); f.append('return', 'apple_music,spotify');
      f.append('file', new Blob([buf]), cleanName(name) || 'clip.mp4');
      const r = await fetchFn('https://api.audd.io/', { method: 'POST', body: f, signal: AbortSignal.timeout(40000) });
      const j = await r.json().catch(() => ({}));
      if (j.status === 'error') { info.lastErr = 'audd:' + String(j.error && (j.error.error_message || j.error.error_code)).slice(0, 80); return { ok: false, reason: /limit|token|quota|402|901|900/i.test(info.lastErr) ? 'quota' : 'failed' }; }
      const x = j.result;
      if (!x || !x.title) return { ok: true, found: false };
      info.recognized++;
      return { ok: true, found: true, title: String(x.title), artist: String(x.artist || ''), album: String(x.album || ''), year: String(x.release_date || '').slice(0, 4),
        link: String(x.song_link || ''), spotify: String((x.spotify && x.spotify.external_urls && x.spotify.external_urls.spotify) || ''), apple: String((x.apple_music && x.apple_music.url) || '') };
    } catch (e) { info.fails++; info.lastErr = String((e && e.message) || e).slice(0, 120); return { ok: false, reason: 'failed' }; }
  }
  // تشخیص آهنگ از لینک: صدا دانلود می‌شه و برای تشخیص فرستاده می‌شه
  async function recognizeUrl(url) {
    if (!canRecognize()) return { ok: false, reason: 'no_key' };
    const d = await download(url, 'audio');
    if (!d.ok) return d;
    return recognizeBuffer(d.buf, 'audio.' + d.ext);
  }

  return { video, audio, recognizeBuffer, recognizeUrl, canRecognize, extractUrl, safeUrl, status: () => Object.assign({ recognize: canRecognize(), ytdlp: !!ytPath, active, waiting: waiting.length }, info) };
}

export const TOOL_ERR = {
  bad_url: 'این لینک معتبر نیست.',
  busy: 'الان چند نفر دارن از ابزارها استفاده می‌کنن؛ یه دقیقه بعد دوباره امتحان کن. ⏳',
  too_big: 'حجم فایل از سقف ربات (۵۰ مگابایت) بیشتره.',
  too_long: 'این ویدیو خیلی طولانیه (بیشتر از ۲۵ دقیقه).',
  login: 'این سایت برای باز کردن این لینک ورود/اجازه می‌خواد (لینک خصوصی یا محدود به سن یا مسدودکنندهٔ ربات).',
  blocked: 'سایت مقصد اجازهٔ دانلود نداد (محدودیت منطقه یا مسدود کردن سرور).',
  unsupported: 'از این لینک نتونستم ویدیو یا صدا دربیارم.',
  timeout: 'زمان دانلود تموم شد؛ دوباره امتحان کن یا لینک کوتاه‌تری بفرست.',
  tool_missing: 'ابزار دانلود روی سرور آماده نیست؛ چند دقیقه بعد دوباره امتحان کن.',
  no_key: 'تشخیص آهنگ هنوز روی این ربات فعال نشده.',
  quota: 'سهمیهٔ سرویس تشخیص آهنگ تموم شده؛ بعداً دوباره امتحان کن.',
  failed: 'نشد؛ چند لحظه بعد دوباره امتحان کن.'
};

// END-OF-FILE lib/tools.js
