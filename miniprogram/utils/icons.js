// 图标库：把原型内联 SVG 转成 data-URI，颜色烘焙进去（小程序 image 不支持 currentColor 继承）。
// 用法：const icons = require('../../utils/icons'); icons.get('dining', '#111', 1.7)

// 各图标的内部路径（viewBox 统一 0 0 24 24，stroke 描边风格）
const PATHS = {
  // —— 分类 / 交易 ——
  dining: '<path d="M4 4v7a4 4 0 0 0 8 0V4M8 4v16M17 4c-1.5 1-2 3-2 5s.5 4 2 4v7"/>',
  bag: '<path d="M4 7h16l-1.3 10.5a2 2 0 0 1-2 1.5H7.3a2 2 0 0 1-2-1.5L4 7Z"/><path d="M8.5 7V5.5a3.5 3.5 0 0 1 7 0V7"/>',
  coffee: '<path d="M4 8h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"/><path d="M4 8l3-4h10l3 4M9 12h6"/>',
  income: '<path d="M12 3v18M7 8l5-5 5 5" stroke-linecap="round" stroke-linejoin="round"/>',
  train: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M4 10h16M8 18v2M16 18v2"/>',
  medicine: '<path d="M12 3v18M3 12h18" stroke-linecap="round"/><rect x="8" y="8" width="8" height="8" rx="2"/>',
  medical: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a3 3 0 0 1 6 0v2M12 11v5M9.5 13.5h5"/>',
  house: '<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>',
  edu: '<path d="M3 8l9-4 9 4-9 4-9-4Z"/><path d="M7 10v5c0 1 2.2 2 5 2s5-1 5-2v-5"/>',
  play: '<circle cx="12" cy="12" r="8"/><path d="M9 10v4l4-2-4-2Z" fill="CFILL" stroke="none"/>',
  dots: '<circle cx="6" cy="12" r="1.4" fill="CFILL" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="CFILL" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="CFILL" stroke="none"/>',

  // —— 导航 / 通用 ——
  back: '<path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke-linecap="round"/>',
  chevron: '<path d="M9 6l6 6-6 6" stroke-linecap="round"/>',
  chevronDown: '<path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>',
  dotsH: '<circle cx="5" cy="12" r="1.6" fill="CFILL" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="CFILL" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="CFILL" stroke="none"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/>',

  // —— 表单 ——
  note: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/>',
  photoAdd: '<path d="M12 8v8M8 12h8" stroke-linecap="round"/><rect x="3" y="5" width="18" height="15" rx="2"/>',
  del: '<path d="M20 6H9l-5 6 5 6h11a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2Z"/><path d="M12 10l4 4M16 10l-4 4"/>',
  dragHandle: '<path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" stroke-linecap="round"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  trash: '<path d="M5 7h14M9 7V5h6v2M6 7l1 13h10l1-13"/>',

  // —— 账本 / 设置 ——
  book: '<path d="M5 4h11l3 3v13H5z"/><path d="M9 9h6M9 13h6"/>',
  bars: '<path d="M5 20v-6M12 20V5M19 20v-9" stroke-linecap="round"/><path d="M3 20h18" stroke-linecap="round"/>',
  aiBox: '<path d="M4 5h16v10H9l-4 3v-3H4z" stroke-linejoin="round"/>',
  currency: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5c.5-1.5 4-2 4 0 0 1.5-2 1.5-2 3M12 16h.01"/>',
  download: '<path d="M12 3v12M8 11l4 4 4-4"/><path d="M5 21h14"/>',
  upload: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 21h14"/>',
  camera: '<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.2"/><path d="M8 6l1.5-2h5L16 6"/>',
  send: '<path d="M4 12l16-8-6 16-3.5-6L4 12Z" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5l3 2"/>',
  checkbox: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  privacy: '<path d="M12 3l7 3v6c0 4-3 6.5-7 9-4-2.5-7-5-7-9V6z"/>',

  // —— tabBar ——
  tabHome: '<path d="M3 10.5 12 3l9 7.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
  tabStats: '<path d="M5 20v-6M12 20V5M19 20v-9" stroke-linecap="round"/><path d="M3 20h18" stroke-linecap="round"/>',
  tabAi: '<path d="M4 5h16v10H9l-4 3v-3H4z" stroke-linejoin="round"/><path d="M12 8l.7 1.8L14.5 10l-1.8.7L12 12l-.7-1.3L9.5 10l1.8-.2z" fill="CFILL" stroke="none"/>',
  tabMe: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>',
};

function get(name, color, width) {
  const inner = (PATHS[name] || '').replace(/CFILL/g, color || '#111111');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="'
    + (color || '#111111') + '" stroke-width="' + (width || 1.7) + '">' + inner + '</svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

module.exports = { get, PATHS };
