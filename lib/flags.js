// پرچم‌ها و نشان‌های گرد برای کارت نرخ‌ها (هم توی عکس ربات، هم توی سایت)
// همه‌چیز توی یک بوم ۶۴×۶۴ کشیده می‌شه و با دایره بریده می‌شه؛ هیچ فایل بیرونی لازم نیست.

const R = (x, y, w, h, f) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`;
const CIR = (x, y, r, f, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}" ${extra}/>`;
function star(cx, cy, r, f, rot = -90) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (rot + i * 36) * Math.PI / 180, rr = i % 2 ? r * 0.382 : r;
    pts.push((cx + rr * Math.cos(a)).toFixed(2) + ',' + (cy + rr * Math.sin(a)).toFixed(2));
  }
  return `<polygon points="${pts.join(' ')}" fill="${f}"/>`;
}

const FLAGS = {
  USD: () => {
    let s = R(0, 0, 64, 64, '#fff');
    for (let i = 0; i < 7; i++) s += R(0, i * 9.14, 64, 4.57, '#B22234');
    s += R(0, 0, 34, 32, '#3C3B6E');
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) s += CIR(5 + c * 8, 6 + r * 9, 1.7, '#fff');
    return s;
  },
  EUR: () => {
    let s = R(0, 0, 64, 64, '#003399');
    for (let i = 0; i < 12; i++) { const a = i * 30 * Math.PI / 180; s += star(32 + 19 * Math.sin(a), 32 - 19 * Math.cos(a), 3.6, '#FFCC00'); }
    return s;
  },
  GBP: () => R(0, 0, 64, 64, '#012169') +
    '<path d="M-4 -4L68 68M68 -4L-4 68" stroke="#fff" stroke-width="12"/><path d="M-4 -4L68 68M68 -4L-4 68" stroke="#C8102E" stroke-width="4"/>' +
    R(0, 24, 64, 16, '#fff') + R(24, 0, 16, 64, '#fff') + R(0, 27, 64, 10, '#C8102E') + R(27, 0, 10, 64, '#C8102E'),
  CHF: () => R(0, 0, 64, 64, '#D52B1E') + R(27, 14, 10, 36, '#fff') + R(14, 27, 36, 10, '#fff'),
  CAD: () => R(0, 0, 64, 64, '#fff') + R(0, 0, 16, 64, '#D80621') + R(48, 0, 16, 64, '#D80621') +
    '<path d="M32 14l3.6 7.4 4-1.6-1.6 9.2 5-4.4 1.4 3.2 4-.6-1.8 5.6 2.2 1.2-9.4 7.6.8 3.6-7.2-.8v8.2h-2.2v-8.2l-7.2.8.8-3.6-9.4-7.6 2.2-1.2-1.8-5.6 4 .6 1.4-3.2 5 4.4-1.6-9.2 4 1.6z" fill="#D80621"/>',
  TRY: () => R(0, 0, 64, 64, '#E30A17') + CIR(26, 32, 14, '#fff') + CIR(30, 32, 11.2, '#E30A17') + star(41, 32, 6.4, '#fff', 0),
  RUB: () => R(0, 0, 64, 22, '#fff') + R(0, 21, 64, 22, '#0039A6') + R(0, 42, 64, 22, '#D52B1E'),
  INR: () => R(0, 0, 64, 22, '#FF9933') + R(0, 21, 64, 22, '#fff') + R(0, 42, 64, 22, '#138808') +
    CIR(32, 32, 7, 'none', 'stroke="#000080" stroke-width="1.8"') + CIR(32, 32, 1.4, '#000080'),
  CNY: () => R(0, 0, 64, 64, '#DE2910') + star(17, 19, 10, '#FFDE00') + star(32, 8, 3.2, '#FFDE00', -70) + star(38, 15, 3.2, '#FFDE00', -50) + star(38, 24, 3.2, '#FFDE00', -20) + star(32, 31, 3.2, '#FFDE00', 0),
  IQD: () => R(0, 0, 64, 22, '#CE1126') + R(0, 21, 64, 22, '#fff') + R(0, 42, 64, 22, '#000') + R(18, 28, 28, 8, 'none') + '<rect x="19" y="28.5" width="26" height="7" rx="2" fill="#007A3D"/>',
  AED: () => R(0, 0, 64, 64, '#fff') + R(0, 0, 64, 22, '#00732F') + R(0, 42, 64, 22, '#000') + R(0, 0, 18, 64, '#FF0000'),
  AFN: () => R(0, 0, 22, 64, '#000') + R(21, 0, 22, 64, '#BE0000') + R(42, 0, 22, 64, '#007A36') + CIR(32, 32, 9, 'none', 'stroke="#fff" stroke-width="2.4"') + CIR(32, 32, 3, '#fff'),
  KWD: () => R(0, 0, 64, 22, '#007A3D') + R(0, 21, 64, 22, '#fff') + R(0, 42, 64, 22, '#CE1126') + '<path d="M0 0L24 21V43L0 64Z" fill="#000"/>'
};

// دایره‌های طلایی و نماد ارز دیجیتال
const GOLD_BG = ['#F7D774', '#D9A520'];
const COIN_COL = { BTC: '#F7931A', ETH: '#627EEA', BNB: '#F3BA2F', SOL: '#9945FF', XRP: '#23292F', TRX: '#EF0027', DOGE: '#C2A633', ADA: '#0033AD', TON: '#0098EA', LTC: '#345D9D', USDT: '#26A17B', USDC: '#2775CA', AVAX: '#E84142', LINK: '#2A5ADA', DOT: '#E6007A', SHIB: '#F00500', BCH: '#8DC351', XLM: '#14B6E7' };

let uid = 0;
// خروجی: یک <g> آمادهٔ جاگذاری توی SVG (مرکز (cx,cy)، شعاع r)
export function badgeG(kind, code, cx, cy, r) {
  const id = 'fl' + (++uid), s = (r * 2) / 64, tx = cx - r, ty = cy - r;
  let inner;
  if (kind === 'gold') {
    inner = `<defs><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GOLD_BG[0]}"/><stop offset="1" stop-color="${GOLD_BG[1]}"/></linearGradient></defs>` +
      CIR(32, 32, 32, `url(#${id}g)`) + CIR(32, 32, 24, 'none', 'stroke="#fff" stroke-opacity=".55" stroke-width="2.4"') +
      `<path d="M20 40V28l6 5 6-9 6 9 6-5v12z" fill="#fff" fill-opacity=".85"/>`;
  } else if (kind === 'crypto') {
    const col = COIN_COL[code] || '#5B6B7A';
    inner = CIR(32, 32, 32, col) + `<text x="32" y="${code.length > 3 ? 38 : 40}" font-family="Vazirmatn, DejaVu Sans, sans-serif" font-weight="700" font-size="${code.length > 4 ? 17 : code.length > 3 ? 20 : code.length > 2 ? 23 : 28}" fill="#fff" text-anchor="middle">${code.length > 4 ? code.slice(0, 4) : code}</text>`;
  } else {
    const f = FLAGS[code];
    inner = f ? f() : CIR(32, 32, 32, '#8A96A3') + `<text x="32" y="40" font-family="Vazirmatn, DejaVu Sans, sans-serif" font-weight="700" font-size="24" fill="#fff" text-anchor="middle">${String(code).slice(0, 3)}</text>`;
  }
  return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})"><clipPath id="${id}c"><circle cx="32" cy="32" r="32"/></clipPath><g clip-path="url(#${id}c)">${inner}</g>` +
    `<circle cx="32" cy="32" r="31.4" fill="none" stroke="#000" stroke-opacity=".10" stroke-width="1.2"/></g>`;
}

// SVG مستقل (برای <img> توی سایت)
export function badgeSvg(kind, code) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${badgeG(kind, code, 32, 32, 32)}</svg>`;
}
export const hasFlag = (code) => Object.prototype.hasOwnProperty.call(FLAGS, code);

// END-OF-FILE lib/flags.js
