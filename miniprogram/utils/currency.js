// 常用币种（选择/展示用）。symbol 用于金额格式化，name 用于中文展示。
// 这些币种在后端 rates 中都有种子汇率；如需全量可在设置里「刷新汇率」（dev）从开放源拉取。
const CURRENCIES = [
  // 主流
  { code: 'CNY', symbol: '¥', name: '人民币' },
  { code: 'USD', symbol: '$', name: '美元' },
  { code: 'EUR', symbol: '€', name: '欧元' },
  { code: 'GBP', symbol: '£', name: '英镑' },
  { code: 'JPY', symbol: '¥', name: '日元' },
  { code: 'HKD', symbol: 'HK$', name: '港币' },
  // 欧洲
  { code: 'CHF', symbol: 'Fr', name: '瑞士法郎' },
  { code: 'ISK', symbol: 'kr', name: '冰岛克朗' },
  { code: 'SEK', symbol: 'kr', name: '瑞典克朗' },
  { code: 'NOK', symbol: 'kr', name: '挪威克朗' },
  { code: 'DKK', symbol: 'kr', name: '丹麦克朗' },
  { code: 'PLN', symbol: 'zł', name: '波兰兹罗提' },
  { code: 'CZK', symbol: 'Kč', name: '捷克克朗' },
  { code: 'HUF', symbol: 'Ft', name: '匈牙利福林' },
  { code: 'RON', symbol: 'lei', name: '罗马尼亚列伊' },
  { code: 'BGN', symbol: 'лв', name: '保加利亚列弗' },
  { code: 'TRY', symbol: '₺', name: '土耳其里拉' },
  { code: 'RUB', symbol: '₽', name: '俄罗斯卢布' },
  // 亚太/美洲
  { code: 'KRW', symbol: '₩', name: '韩元' },
  { code: 'AUD', symbol: 'A$', name: '澳元' },
  { code: 'CAD', symbol: 'C$', name: '加元' },
  { code: 'NZD', symbol: 'NZ$', name: '新西兰元' },
  { code: 'SGD', symbol: 'S$', name: '新加坡元' },
  { code: 'TWD', symbol: 'NT$', name: '新台币' },
  { code: 'THB', symbol: '฿', name: '泰铢' },
  { code: 'MYR', symbol: 'RM', name: '马来西亚林吉特' },
  { code: 'VND', symbol: '₫', name: '越南盾' },
  { code: 'IDR', symbol: 'Rp', name: '印尼盾' },
  { code: 'INR', symbol: '₹', name: '印度卢比' },
  { code: 'AED', symbol: 'د.إ', name: '阿联酋迪拉姆' },
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
