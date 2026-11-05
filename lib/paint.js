// رنگ خودکار همهٔ دکمه‌های شیشه‌ای ربات (primary آبی | success سبز | danger قرمز).
// هر دکمه‌ای که خودش رنگ نداشته باشه اینجا رنگ می‌گیره؛ فقط دکمه‌های برچسب (noop) بی‌رنگ می‌مونن.
const GREEN = /^(t:save|t:r:TP|bt:go|nw:go|ac:new|su:add|b:[^:]+:tp:1|ad:aik|ad:kp:add|ad:aitest)(:|$)|:(save|add|on|ok|go|send|yes)(:|$)/;
const RED = /^(t:r:SL|x|rs|ac:rm|b:[^:]+:sl:1|ad:aikd)(:|$)|^rs|:del|:reset|:(off|no|stop)(:|$)/;
const NONE = /^(noop|t:noop|nop)$/;
export function paintBtn(btn) {
  if (!btn || typeof btn !== 'object' || btn.style) return btn;
  const d = String(btn.callback_data || '');
  if (NONE.test(d)) return btn;
  if (btn.web_app || btn.url) return Object.assign({}, btn, { style: 'primary' });
  if (d === 'm') return Object.assign({}, btn, { style: 'primary' });
  if (RED.test(d)) return Object.assign({}, btn, { style: 'danger' });
  if (GREEN.test(d)) return Object.assign({}, btn, { style: 'success' });
  return Object.assign({}, btn, { style: 'primary' });
}
export const paintKb = (kb) => (Array.isArray(kb) ? kb.map((row) => (Array.isArray(row) ? row.map(paintBtn) : row)) : kb);
// reply_markup کامل ({inline_keyboard}) را رنگی می‌کند؛ هر چیز دیگه‌ای (کیبورد معمولی، حذف) دست‌نخورده برمی‌گردد
export function paintMarkup(m) {
  if (m && Array.isArray(m.inline_keyboard)) return Object.assign({}, m, { inline_keyboard: paintKb(m.inline_keyboard) });
  return m;
}

// END-OF-FILE lib/paint.js
