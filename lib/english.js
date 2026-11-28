import { sql } from './db.js';
import { callAi } from './aicore.js';

// آموزش انگلیسی: هر روز یه درس گرامر (با مثال‌هایی از اطلاعات عمومی) + چند کلمهٔ تازه + کوییز ۵ سؤالی با دکمه.
//  - برنامهٔ گرامر از A1 تا C2 مرتب شده و هیچ مبحثی تکرار نمی‌شه؛ بعد از تموم شدنش مایکی مبحث پیشرفتهٔ جدید انتخاب می‌کنه
//  - کلمه‌هایی که قبلاً اومدن دوباره نمیان (۶۰۰ کلمهٔ آخر به مدل داده می‌شه و خروجی هم چک می‌شه)
//  - سختی با نتیجهٔ کوییزها کم و زیاد می‌شه
//  - وضعیت هر کاربر توی bot_settings (کلید eng:<tgId>) ذخیره می‌شه؛ فقط موقع ساخت درس و پایان کوییز می‌نویسه

const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
// [مبحث, سطح ۱ تا ۶]
const GRAMMAR = [
  ['To be: am / is / are', 1], ['Present Simple (habits and facts)', 1], ['Articles: a / an / the', 1], ['Plural nouns', 1],
  ['Subject and object pronouns', 1], ['Possessive adjectives', 1], ['There is / There are', 1], ['Can / Can\'t (ability)', 1],
  ['Present Continuous (now)', 1], ['Question words: what, where, when, who, why', 1], ['Prepositions of place: in, on, at', 1], ['This / That / These / Those', 1],
  ['Past Simple (regular verbs)', 2], ['Past Simple (irregular verbs)', 2], ['Countable and uncountable nouns: some / any', 2], ['Comparative adjectives', 2],
  ['Superlative adjectives', 2], ['Future with going to', 2], ['Will (predictions and quick decisions)', 2], ['Present Perfect (life experience)', 2],
  ['Adverbs of frequency', 2], ['Have to / Must', 2], ['Should / Shouldn\'t (advice)', 2], ['Possessive pronouns and object pronouns', 2],
  ['Prepositions of time: in, on, at', 2], ['Quantifiers: much / many / a lot of', 2], ['Past Continuous', 2], ['Like + -ing and want + to verb', 2],
  ['Present Perfect vs Past Simple', 3], ['Present Perfect Continuous', 3], ['First Conditional', 3], ['Second Conditional', 3],
  ['Passive Voice (present and past)', 3], ['Reported Speech (statements)', 3], ['Defining relative clauses: who / which / that', 3], ['Used to and would (past habits)', 3],
  ['Gerund vs Infinitive', 3], ['Modals of deduction: must / might / can\'t', 3], ['Too and enough', 3], ['Phrasal verbs (everyday)', 3],
  ['So and such', 3], ['Question tags', 3], ['Past Perfect', 3], ['Future Continuous', 3],
  ['Reflexive pronouns', 3], ['Linking words: although, however, despite', 3], ['Wish (present situations)', 3], ['Indirect questions', 3],
  ['Third Conditional', 4], ['Mixed Conditionals', 4], ['Passive Voice (all tenses and modals)', 4], ['Reported questions and commands', 4],
  ['Non-defining relative clauses', 4], ['Future Perfect', 4], ['Wish and If only (past regrets)', 4], ['Causative: have / get something done', 4],
  ['Participle clauses', 4], ['Modals in the past: should have / could have / must have', 4], ['Cleft sentences: It is ... that', 4], ['Zero article and advanced article use', 4],
  ['Phrasal verbs (advanced)', 4], ['Collocations with make / do / take / have', 4], ['Subjunctive: suggest that he go', 4], ['Discourse markers', 4],
  ['Comparative structures: the more ... the more', 4], ['Few / little / fewer / less', 4], ['Emphatic do / does / did', 4],
  ['Inversion after negative adverbials', 5], ['Advanced conditionals: provided that, unless, otherwise', 5], ['Nominalisation', 5], ['Ellipsis and substitution', 5],
  ['Hedging language', 5], ['Common idioms', 5], ['Impersonal passive: It is said that ...', 5], ['Fronting for emphasis', 5],
  ['Formal vs informal register', 5], ['Complex noun phrases', 5],
  ['Subtle modal nuance', 6], ['Rare and literary structures', 6], ['Rhetorical devices in writing', 6], ['Proverbs and sayings', 6],
  ['Word formation: prefixes and suffixes', 6], ['Tone and register in writing', 6]
];

export const HOURS = [7, 9, 12, 18, 21];
const TZ = 'Asia/Tehran';
const MAX_WORDS = 600, MAX_BANK = 80, DB_TMO = 10e3;

let dbq = sql, ai = callAi;
export function _setDeps(d) { if (d.db) dbq = d.db; if (d.ai) ai = d.ai; }
const withTmo = (p, ms = DB_TMO) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('db_timeout')), ms))]);

const FA = '۰۱۲۳۴۵۶۷۸۹';
export const fa = (x) => String(x).replace(/[0-9]/g, (d) => FA[d]);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const states = new Map();   // tgId -> state
const users = new Set();    // کاربرانی که ارسال روزانه دارن
let usersLoaded = false;

export const defState = () => ({ v: 1, n: 0, gi: 0, words: [], gram: [], bank: [], hist: [], streak: 0, last: '', sent: '', on: true, hour: 9, cur: null });

const today = (now = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
function tehranHm(now = Date.now()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  return { h: +p.find((x) => x.type === 'hour').value % 24, m: +p.find((x) => x.type === 'minute').value };
}

export async function getState(id) {
  const k = String(id);
  if (states.has(k)) return states.get(k);
  let st = null;
  try {
    const r = await withTmo(dbq`SELECT v FROM bot_settings WHERE k = ${'eng:' + k}`);
    if (r[0] && r[0].v) st = Object.assign(defState(), JSON.parse(r[0].v));
  } catch (e) { /* از صفر شروع می‌کنیم؛ اگه دیتابیس قطع بود، بعداً ذخیره می‌شه */ }
  if (!st) st = defState();
  states.set(k, st);
  if (st.n > 0 && st.on) users.add(k);
  return st;
}

export async function saveState(id, st) {
  const k = String(id);
  states.set(k, st);
  if (st.on) users.add(k); else users.delete(k);
  const keep = Object.assign({}, st); delete keep.run; // پیشرفت کوییز فقط توی حافظه‌ست
  try {
    await withTmo(dbq`INSERT INTO bot_settings (k, v) VALUES (${'eng:' + k}, ${JSON.stringify(keep)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`);
    return true;
  } catch (e) { console.error('english save:', e && e.message); return false; }
}

export const levelOf = (st) => {
  const g = GRAMMAR[st.gi];
  return g ? g[1] : 6;
};
export const cefrOf = (st) => CEFR[levelOf(st) - 1];

// ---------- ساخت درس ----------
function extractJson(txt) {
  const s = String(txt || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}
const str = (x, max) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function cleanLesson(j, used) {
  if (!j || typeof j !== 'object') return null;
  const g = j.grammar || {};
  const title = str(g.title, 90), ex = (Array.isArray(g.examples) ? g.examples : []).map((e) => ({ en: str(e && e.en, 220), fa: str(e && e.fa, 260) })).filter((e) => e.en && e.fa).slice(0, 3);
  const gram = { title, fa: str(g.fa, 700), rule: str(g.rule, 160), examples: ex };
  if (!gram.title || !gram.fa || ex.length < 1) return null;
  const seen = new Set(), words = [];
  for (const w of (Array.isArray(j.words) ? j.words : [])) {
    const word = str(w && w.w, 40), key = word.toLowerCase();
    if (!word || !/^[A-Za-z][A-Za-z' -]*$/.test(word) || seen.has(key) || used.has(key)) continue;
    const fa_ = str(w.fa, 80); if (!fa_) continue;
    seen.add(key);
    words.push({ w: word, ipa: str(w.ipa, 40).replace(/^\/|\/$/g, ''), pos: str(w.pos, 20), fa: fa_, ex: str(w.ex, 200), exfa: str(w.exfa, 240) });
  }
  if (words.length < 3) return null;
  const quiz = [];
  for (const q of (Array.isArray(j.quiz) ? j.quiz : [])) {
    const question = str(q && q.q, 260), a = str(q && q.a, 120);
    const wrong = [...new Set((Array.isArray(q && q.w) ? q.w : []).map((x) => str(x, 120)).filter((x) => x && x !== a))].slice(0, 3);
    if (!question || !a || wrong.length < 2) continue;
    const opts = shuffle([a].concat(wrong));
    quiz.push({ q: question, opts, ci: opts.indexOf(a), why: str(q.why, 300) });
  }
  if (quiz.length < 3) return null;
  return { grammar: gram, words: words.slice(0, 6), quiz: quiz.slice(0, 5) };
}

function buildPrompt(st, topic) {
  const lvl = CEFR[levelOf(st) - 1], recent = st.hist.slice(-3);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
  const hint = avg == null ? '' : avg >= 85 ? 'The learner is doing very well: choose vocabulary from the upper end of this level and make quiz distractors trickier.'
    : avg < 50 ? 'The learner is struggling: choose more common vocabulary from the lower end of this level and keep quiz questions straightforward.' : '';
  const avoid = st.words.slice(-150).join(', ');
  const topicLine = topic ? `Grammar topic (fixed): ${topic}` : `Grammar topic: choose ONE NEW advanced grammar or usage topic (C2 level, interesting and practical) that is NOT in this list of topics already taught: ${st.gram.slice(-60).join(' | ')}`;
  return `Create today's English lesson for a Persian (Farsi) speaker.
Level: CEFR ${lvl}
${topicLine}
${hint}

Rules:
- "grammar.fa": a short clear explanation in natural Persian (2 to 4 sentences). "grammar.rule": the pattern/formula in English (for example "have/has + past participle").
- "grammar.examples": exactly 2 example sentences that use the grammar and each teach one interesting general-knowledge fact (science, history, geography, space, nature, human body, technology, culture). Include a natural Persian translation in "fa".
- "words": exactly 5 useful words or short phrases at level ${lvl}, with IPA, part of speech, Persian meaning, an example sentence (also about a general-knowledge fact) and its Persian translation. Do NOT use any of these already-taught words: ${avoid || '(none yet)'}.
- "quiz": exactly 5 multiple-choice questions: 3 about the words (mix "What does X mean?" with Persian options, and choosing the right English word for a definition or a sentence gap) and 2 about the grammar (fill the gap or pick the correct sentence). Each has "q", the correct option "a", three plausible wrong options in "w", and a one-sentence Persian explanation "why". Keep every option short.
- Everything must be accurate and suitable for level ${lvl}.

Return ONLY a JSON object, no markdown, in exactly this shape:
{"grammar":{"title":"","fa":"","rule":"","examples":[{"en":"","fa":""},{"en":"","fa":""}]},"words":[{"w":"","ipa":"","pos":"","fa":"","ex":"","exfa":""}],"quiz":[{"q":"","a":"","w":["","",""],"why":""}]}`;
}

export async function makeLesson(id) {
  const st = await getState(id);
  const topic = GRAMMAR[st.gi] ? GRAMMAR[st.gi][0] : null;
  const used = new Set(st.words);
  let lesson = null, err = null;
  for (let i = 0; i < 2 && !lesson; i++) {
    try {
      const reply = await ai({
        system: 'You are an expert English teacher who writes accurate, engaging lessons for Persian speakers. You always answer with valid JSON only.',
        contents: [{ role: 'user', parts: [{ text: buildPrompt(st, topic) }] }],
        maxTokens: 3200, temperature: i ? 0.6 : 0.85, timeoutMs: 60000
      });
      lesson = cleanLesson(extractJson(reply), used);
    } catch (e) { err = e; }
  }
  if (!lesson) { const e = new Error((err && (err.code || err.message)) || 'lesson_failed'); e.code = 'lesson_failed'; throw e; }
  st.n += 1; st.gi += 1;
  st.gram.push(lesson.grammar.title); st.gram = st.gram.slice(-120);
  for (const w of lesson.words) { st.words.push(w.w.toLowerCase()); st.bank.push({ w: w.w, fa: w.fa }); }
  st.words = st.words.slice(-MAX_WORDS); st.bank = st.bank.slice(-MAX_BANK);
  st.cur = { n: st.n, lvl: levelOf({ gi: st.gi - 1 }), lesson };
  st.run = null;
  await saveState(id, st);
  return st;
}

// ---------- نمایش ----------
const b = (text, data, style) => (style ? { text, callback_data: data, style } : { text, callback_data: data });

export function homeView(st) {
  const avg = st.hist.length ? Math.round(st.hist.slice(-3).reduce((a, c) => a + c, 0) / Math.min(3, st.hist.length)) : null;
  let t = '<b>آموزش انگلیسی</b>\n';
  if (!st.n) t += '\nهر روز یه درس گرامر با مثال‌هایی از اطلاعات عمومی، چند کلمهٔ تازه و یه کوییز کوتاه می‌گیری. درس‌ها از سطح مقدماتی شروع می‌شن، تکراری نیستن و کم‌کم سخت‌تر می‌شن.\n\nبرای شروع، «درس اول» رو بزن.';
  else {
    t += '\nسطح: <b>' + cefrOf(st) + '</b>   درس: <b>' + fa(st.n) + '</b>\nرکورد روزهای پشت‌سرهم: <b>' + fa(st.streak) + '</b>' + (avg != null ? '\nمیانگین ۳ کوییز آخر: <b>' + fa(avg) + '٪</b>' : '') + '\nکلمه‌های یادگرفته‌شده: <b>' + fa(st.words.length) + '</b>';
    t += '\nارسال روزانه: <b>' + (st.on ? 'روشن، ساعت ' + fa(String(st.hour).padStart(2, '0')) + ':۰۰' : 'خاموش') + '</b>';
  }
  const kb = [[b(st.n ? 'درس جدید' : 'درس اول', 'en:new', 'success')]];
  if (st.n) {
    kb.push([b('درس فعلی', 'en:l'), b('کوییز', 'en:q')]);
    kb.push([b('کلمه‌های من', 'en:w')]);
    kb.push([b('ارسال روزانه: ' + (st.on ? 'روشن' : 'خاموش'), 'en:d', st.on ? 'success' : 'danger')].concat(st.on ? [b('ساعت ' + fa(st.hour), 'en:h')] : []));
  }
  kb.push([b('منو', 'm')]);
  return { text: t, kb };
}

export function lessonView(st) {
  const c = st.cur;
  if (!c) return homeView(st);
  const L = c.lesson, g = L.grammar;
  let t = '<b>درس ' + fa(c.n) + '</b>  ·  سطح ' + CEFR[c.lvl - 1] + '\n';
  t += '\n<b>گرامر: ' + esc(g.title) + '</b>\n' + esc(g.fa);
  if (g.rule) t += '\n\n<code>' + esc(g.rule) + '</code>';
  g.examples.forEach((e) => { t += '\n\n' + esc(e.en) + '\n<i>' + esc(e.fa) + '</i>'; });
  t += '\n\n<b>کلمه‌های امروز</b>';
  L.words.forEach((w, i) => {
    t += '\n\n<b>' + fa(i + 1) + '. ' + esc(w.w) + '</b>' + (w.ipa ? '  /' + esc(w.ipa) + '/' : '') + (w.pos ? '  (' + esc(w.pos) + ')' : '') + '\n' + esc(w.fa);
    if (w.ex) t += '\n' + esc(w.ex) + (w.exfa ? '\n<i>' + esc(w.exfa) + '</i>' : '');
  });
  return { text: t, kb: [[b('شروع کوییز', 'en:q', 'success'), b('درس جدید', 'en:new')], [b('بازگشت', 'en'), b('منو', 'm')]] };
}

export function wordsView(st) {
  const list = st.bank.slice(-30).reverse();
  let t = '<b>کلمه‌های من</b>\n';
  t += list.length ? '\n' + list.map((x) => esc(x.w) + '  —  ' + esc(x.fa)).join('\n') : '\nهنوز کلمه‌ای نداری.';
  return { text: t, kb: [[b('بازگشت', 'en'), b('منو', 'm')]] };
}

export function startQuiz(st) {
  if (!st.cur) return false;
  st.run = { qi: 0, score: 0, ans: [] };
  return true;
}

export function questionView(st, picked) {
  const c = st.cur, run = st.run;
  if (!c || !run) return homeView(st);
  const q = c.lesson.quiz[run.qi], total = c.lesson.quiz.length;
  const done = picked != null;
  let t = '<b>کوییز درس ' + fa(c.n) + '</b>   سؤال ' + fa(run.qi + 1) + ' از ' + fa(total) + '\n\n' + esc(q.q);
  const kb = q.opts.map((o, i) => {
    if (!done) return [b(o, 'en:a:' + run.qi + ':' + i)];
    if (i === q.ci) return [b('✓  ' + o, 'noop', 'success')];
    if (i === picked) return [b('✗  ' + o, 'noop', 'danger')];
    return [b(o, 'noop')];
  });
  if (done) {
    t += '\n\n' + (picked === q.ci ? '<b>درسته</b>' : '<b>نه؛ جواب درست:</b> ' + esc(q.opts[q.ci])) + (q.why ? '\n' + esc(q.why) : '');
    kb.push([b(run.qi + 1 < total ? 'سؤال بعدی' : 'نتیجه', 'en:n', 'success')]);
  }
  return { text: t, kb };
}

export async function answer(id, st, qi, oi, now = Date.now()) {
  const run = st.run;
  if (!st.cur || !run || run.qi !== qi || run.ans[qi] != null) return null;
  const q = st.cur.lesson.quiz[qi];
  if (!q || oi < 0 || oi >= q.opts.length) return null;
  run.ans[qi] = oi;
  if (oi === q.ci) run.score++;
  return questionView(st, oi);
}

export async function next(id, st, now = Date.now()) {
  const run = st.run;
  if (!st.cur || !run) return homeView(st);
  const total = st.cur.lesson.quiz.length;
  if (run.ans[run.qi] == null) return questionView(st); // هنوز جواب نداده
  if (run.qi + 1 < total) { run.qi++; return questionView(st); }
  // پایان
  const pct = Math.round(run.score / total * 100), d = today(now);
  st.hist.push(pct); st.hist = st.hist.slice(-20);
  if (st.last !== d) {
    const y = today(now - 86400e3);
    st.streak = st.last === y ? st.streak + 1 : 1;
    st.last = d;
  }
  const score = run.score;
  st.run = null;
  await saveState(id, st);
  const msg = pct >= 80 ? 'عالی بود. درس بعدی کمی سخت‌تر می‌شه.' : pct >= 50 ? 'خوبه. یه مرور کلمه‌ها کمک می‌کنه.' : 'اشکال نداره؛ درس رو دوباره بخون و کوییز رو دوباره بزن.';
  const t = '<b>نتیجهٔ کوییز</b>\n\nامتیاز: <b>' + fa(score) + ' از ' + fa(total) + '</b>  (' + fa(pct) + '٪)\nرکورد روزهای پشت‌سرهم: <b>' + fa(st.streak) + '</b>\n\n' + msg;
  return { text: t, kb: [[b('درس جدید', 'en:new', 'success'), b('کوییز دوباره', 'en:q')], [b('درس فعلی', 'en:l'), b('بازگشت', 'en')]] };
}

export async function toggleDaily(id, st) { st.on = !st.on; await saveState(id, st); }
export async function cycleHour(id, st) { st.hour = HOURS[(HOURS.indexOf(st.hour) + 1) % HOURS.length] || 9; await saveState(id, st); }

// ---------- ارسال روزانه ----------
let timer = null, busy = false;
const tries = new Map(); // id -> {day, n, next}

async function loadUsers() {
  if (usersLoaded) return;
  try {
    const r = await withTmo(dbq`SELECT k FROM bot_settings WHERE k LIKE 'eng:%'`);
    for (const x of r) await getState(String(x.k).slice(4));
    usersLoaded = true;
  } catch (e) { /* دوباره امتحان می‌کنیم */ }
}

export async function dailyTick(ctx, now = Date.now()) {
  if (busy) return 0;
  busy = true;
  let sent = 0;
  try {
    await loadUsers();
    const { h } = tehranHm(now), d = today(now);
    for (const id of [...users]) {
      const st = states.get(id);
      if (!st || !st.on || st.sent === d || h < st.hour || h - st.hour >= 6) continue;
      let t = tries.get(id);
      if (!t || t.day !== d) { t = { day: d, n: 0, next: 0 }; tries.set(id, t); }
      if (t.n >= 4 || now < t.next) continue;
      t.n++; t.next = now + 10 * 60e3;
      try {
        const s2 = await makeLesson(id);
        s2.sent = d; await saveState(id, s2);
        await ctx.send(id, lessonView(s2));
        sent++;
      } catch (e) { console.error('english daily:', id, e && (e.code || e.message)); }
    }
  } finally { busy = false; }
  return sent;
}

export function start(ctx) {
  if (ctx.db) dbq = ctx.db;
  if (timer) return;
  timer = setInterval(() => { dailyTick(ctx).catch((e) => console.error('english tick:', e && e.message)); }, 60e3);
  if (timer.unref) timer.unref();
}

export function _reset() { states.clear(); users.clear(); usersLoaded = false; tries.clear(); busy = false; }

// END-OF-FILE lib/english.js
