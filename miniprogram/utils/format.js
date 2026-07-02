// 金额与日期格式化（后端返回原始数值，展示在前端格式化）
const { SYMBOL } = require('./currency');

function symbolOf(code) { return SYMBOL[code] || ''; }

// 12000 -> "12,000.00"
function fmt(n) {
  const parts = (Math.round((n || 0) * 100) / 100).toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

// 金额 + 币种符号，如 money(42.3) -> "¥42.30"
function money(n, code = 'CNY') { return symbolOf(code) + fmt(n); }

// 带正负号：收入 +，支出 -
function signed(n, type, code = 'CNY') {
  const sign = type === 'income' ? '+' : '-';
  return sign + symbolOf(code) + fmt(Math.abs(n));
}

// 合计带号（正负由数值决定）
function signedTotal(n, code = 'CNY') {
  return (n >= 0 ? '+' : '-') + symbolOf(code) + fmt(Math.abs(n));
}

// 'YYYY-MM-DD' -> '今天/昨天 · M 月 D 日' 或 'M 月 D 日'
function dayLabel(dateStr) {
  const [y, m, d] = (dateStr || '').split('-').map((x) => parseInt(x, 10));
  const md = `${m} 月 ${d} 日`;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yd = new Date(now.getTime() - 86400000);
  const yesterday = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, '0')}-${String(yd.getDate()).padStart(2, '0')}`;
  if (dateStr === today) return `今天 · ${md}`;
  if (dateStr === yesterday) return `昨天 · ${md}`;
  return md;
}

// 'YYYY-MM-DD' -> 'M/D'
function mmdd(dateStr) {
  const p = (dateStr || '').split('-');
  return `${parseInt(p[1], 10)}/${parseInt(p[2], 10)}`;
}

module.exports = { SYMBOL, symbolOf, fmt, money, signed, signedTotal, dayLabel, mmdd };
