// ماشین‌حساب امن برای مایکی: بدون eval؛ فقط عدد، + - * / ^ % ، پرانتز و چند تابع ریاضی.
// مایکی به‌جای حدس زدن، عبارت رو به‌صورت [[calc:عبارت]] می‌نویسه و ربات جواب دقیق رو برمی‌گردونه.
const FN = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
  exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan, min: Math.min, max: Math.max, pow: Math.pow, pct: (a, b) => a * b / 100
};
const CONST = { pi: Math.PI, e: Math.E };
const faDigits = (s) => String(s).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 1776).replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 1632).replace(/[٫]/g, '.').replace(/[٬،]/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/\^/g, '^');

export function calc(exprIn) {
  const src = faDigits(exprIn).replace(/,/g, '').replace(/\s+/g, '').toLowerCase();
  if (!src || src.length > 200) throw new Error('bad_expr');
  let i = 0, steps = 0;
  const peek = () => src[i];
  const guard = () => { if (++steps > 2000) throw new Error('too_complex'); };
  function num() {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(src.slice(i));
    if (!m) throw new Error('bad_expr'); i += m[0].length; return parseFloat(m[0]);
  }
  function atom() {
    guard();
    const c = peek();
    if (c === '(') { i++; const v = add(); if (peek() !== ')') throw new Error('bad_expr'); i++; return v; }
    if (c === '-') { i++; return -pow(); }
    if (c === '+') { i++; return pow(); }
    if (/[a-z]/.test(c)) {
      const m = /^[a-z][a-z0-9]*/.exec(src.slice(i)); const name = m[0]; i += name.length;
      if (peek() === '(') {
        i++; const args = []; if (peek() !== ')') { for (;;) { args.push(add()); if (peek() === ',') { i++; continue; } break; } }
        if (peek() !== ')') throw new Error('bad_expr'); i++;
        if (!FN[name]) throw new Error('bad_fn'); return FN[name](...args);
      }
      if (name in CONST) return CONST[name]; throw new Error('bad_expr');
    }
    return num();
  }
  function pct() { let v = atom(); while (peek() === '%') { i++; v = v / 100; } return v; }
  function pow() { const b = pct(); if (peek() === '^') { i++; const e = pow(); return Math.pow(b, e); } return b; }
  function mul() { let v = pow(); for (;;) { const c = peek(); if (c === '*') { i++; v *= pow(); } else if (c === '/') { i++; const d = pow(); if (d === 0) throw new Error('div0'); v /= d; } else break; } return v; }
  function add() { let v = mul(); for (;;) { const c = peek(); if (c === '+') { i++; v += mul(); } else if (c === '-') { i++; v -= mul(); } else break; } return v; }
  const r = add();
  if (i !== src.length) throw new Error('bad_expr');
  if (!Number.isFinite(r)) throw new Error('bad_expr');
  return r;
}
export const fmtNum = (n) => { const a = Math.abs(n); if (a !== 0 && (a >= 1e15 || a < 1e-9)) return n.toExponential(6); return String(Math.round(n * 1e10) / 1e10); };
export function calcSafe(expr) { try { return { ok: true, value: calc(expr), text: fmtNum(calc(expr)) }; } catch (e) { return { ok: false, error: e.message }; } }

// END-OF-FILE lib/calc.js
