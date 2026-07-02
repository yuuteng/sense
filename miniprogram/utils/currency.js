// 常用币种（选择/展示用）。symbol 用于金额格式化，name 用于中文展示。
// 这些币种在后端 rates 中都有种子汇率；如需全量可在设置里「刷新汇率」（dev）从开放源拉取。
const CURRENCIES = [
  { code: 'CNY', symbol: '¥', name: '人民币' },
  { code: 'USD', symbol: '$', name: '美元' },
  { code: 'EUR', symbol: '€', name: '欧元' },
  { code: 'JPY', symbol: '¥', name: '日元' },
  { code: 'KRW', symbol: '₩', name: '韩元' },
  { code: 'HKD', symbol: 'HK$', name: '港币' },
  { code: 'GBP', symbol: '£', name: '英镑' },
  { code: 'AUD', symbol: 'A$', name: '澳元' },
  { code: 'CAD', symbol: 'C$', name: '加元' },
  { code: 'SGD', symbol: 'S$', name: '新加坡元' },
  { code: 'TWD', symbol: 'NT$', name: '新台币' },
  { code: 'THB', symbol: '฿', name: '泰铢' },
];

const SYMBOL = {};
const NAME = {};
CURRENCIES.forEach((c) => { SYMBOL[c.code] = c.symbol; NAME[c.code] = c.name; });

// 选择器展示文案，如 "¥ 人民币 · CNY"
function label(code) {
  return `${SYMBOL[code] || ''} ${NAME[code] || ''} · ${code}`;
}
function indexOf(code) {
  const i = CURRENCIES.findIndex((c) => c.code === code);
  return i < 0 ? 0 : i;
}

module.exports = { CURRENCIES, SYMBOL, NAME, label, indexOf };
