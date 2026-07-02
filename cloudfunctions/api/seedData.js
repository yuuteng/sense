// 测试数据集（对应 docs/sql.md）。
// 约定：'openid-yu' 为占位，seed 时替换成调用者真实 openid（即“我/小雨”）。
// createdAt/joinedAt/updatedAt 为 ISO 字符串，seed 时转为 Date。

module.exports = {
  users: [
    { _id: 'openid-yu', openid: 'openid-yu', nickname: '小雨', avatarColor: '#2f6feb', avatarInitial: '雨', avatarFileID: '', registered: true, defaultBookId: 'book-home', settings: { displayCurrency: 'CNY', aiMessageLimit: 50 }, createdAt: '2025-09-01T00:00:00.000Z' },
    { _id: 'openid-zhe', openid: 'openid-zhe', nickname: '阿哲', avatarColor: '#17a34a', avatarInitial: '哲', avatarFileID: '', registered: true, defaultBookId: 'book-home', settings: { displayCurrency: 'CNY', aiMessageLimit: 50 }, createdAt: '2025-11-01T00:00:00.000Z' },
    { _id: 'openid-lin', openid: 'openid-lin', nickname: '小林', avatarColor: '#b06f3c', avatarInitial: '林', avatarFileID: '', registered: true, defaultBookId: 'book-jp', settings: { displayCurrency: 'CNY', aiMessageLimit: 50 }, createdAt: '2026-05-01T00:00:00.000Z' },
  ],

  books: [
    { _id: 'book-home', name: '家庭日常', type: 'share', baseCurrency: 'CNY', ownerOpenid: 'openid-yu', memberCount: 2, createdAt: '2025-09-01T00:00:00.000Z' },
    { _id: 'book-jp', name: '日本旅行 2026', type: 'split', baseCurrency: 'CNY', ownerOpenid: 'openid-zhe', memberCount: 3, createdAt: '2026-05-10T00:00:00.000Z' },
  ],

  members: [
    { _id: 'm-home-yu', bookId: 'book-home', openid: 'openid-yu', avatarColor: '#2f6feb', role: 'owner', joinedAt: '2025-09-01T00:00:00.000Z', status: 'active' },
    { _id: 'm-home-zhe', bookId: 'book-home', openid: 'openid-zhe', avatarColor: '#17a34a', role: 'admin', joinedAt: '2025-11-01T00:00:00.000Z', status: 'active' },
    { _id: 'm-jp-zhe', bookId: 'book-jp', openid: 'openid-zhe', avatarColor: '#17a34a', role: 'owner', joinedAt: '2026-05-10T00:00:00.000Z', status: 'active' },
    { _id: 'm-jp-yu', bookId: 'book-jp', openid: 'openid-yu', avatarColor: '#2f6feb', role: 'admin', joinedAt: '2026-05-11T00:00:00.000Z', status: 'active' },
    { _id: 'm-jp-lin', bookId: 'book-jp', openid: 'openid-lin', avatarColor: '#b06f3c', role: 'rw', joinedAt: '2026-05-11T00:00:00.000Z', status: 'active' },
  ],

  categories: [
    // 家庭日常 · 支出
    { _id: 'cat-food', bookId: 'book-home', kind: 'expense', parentId: null, name: '餐饮', icon: 'dining', order: 1, disabled: false },
    { _id: 'cat-food-dinner', bookId: 'book-home', kind: 'expense', parentId: 'cat-food', name: '晚餐', order: 1, disabled: false },
    { _id: 'cat-food-takeout', bookId: 'book-home', kind: 'expense', parentId: 'cat-food', name: '外卖', order: 2, disabled: false },
    { _id: 'cat-food-coffee', bookId: 'book-home', kind: 'expense', parentId: 'cat-food', name: '咖啡', order: 3, disabled: false },
    { _id: 'cat-trans', bookId: 'book-home', kind: 'expense', parentId: null, name: '交通', icon: 'train', order: 2, disabled: false },
    { _id: 'cat-trans-metro', bookId: 'book-home', kind: 'expense', parentId: 'cat-trans', name: '地铁', order: 1, disabled: false },
    { _id: 'cat-shop', bookId: 'book-home', kind: 'expense', parentId: null, name: '购物', icon: 'bag', order: 3, disabled: false },
    { _id: 'cat-shop-daily', bookId: 'book-home', kind: 'expense', parentId: 'cat-shop', name: '日用', order: 1, disabled: false },
    { _id: 'cat-med', bookId: 'book-home', kind: 'expense', parentId: null, name: '医疗', icon: 'medical', order: 4, disabled: false },
    { _id: 'cat-med-drug', bookId: 'book-home', kind: 'expense', parentId: 'cat-med', name: '药品', order: 1, disabled: false },
    { _id: 'cat-income-salary', bookId: 'book-home', kind: 'income', parentId: null, name: '职业收入', icon: 'income', order: 1, disabled: false },
    // 日本旅行 · 支出（简版）
    { _id: 'cat-jp-hotel', bookId: 'book-jp', kind: 'expense', parentId: null, name: '住宿', icon: 'house', order: 1, disabled: false },
    { _id: 'cat-jp-trans', bookId: 'book-jp', kind: 'expense', parentId: null, name: '交通', icon: 'train', order: 2, disabled: false },
    { _id: 'cat-jp-food', bookId: 'book-jp', kind: 'expense', parentId: null, name: '餐饮', icon: 'dining', order: 3, disabled: false },
    { _id: 'cat-jp-shop', bookId: 'book-jp', kind: 'expense', parentId: null, name: '购物', icon: 'bag', order: 4, disabled: false },
  ],

  records: [
    // 家庭日常
    { _id: 'r-1', bookId: 'book-home', type: 'expense', title: '晚餐 · 外卖', amount: 86.0, currency: 'CNY', rate: 1, baseCurrency: 'CNY', amountConverted: 86.0, categoryId: 'cat-food-takeout', categoryPath: '餐饮 / 外卖', date: '2026-07-01', note: '超市晚餐食材', images: [], recorderOpenid: 'openid-yu', payerOpenid: 'openid-yu', createdAt: '2026-07-01T12:30:00.000Z' },
    { _id: 'r-2', bookId: 'book-home', type: 'expense', title: '超市采购', amount: 213.5, currency: 'CNY', rate: 1, baseCurrency: 'CNY', amountConverted: 213.5, categoryId: 'cat-shop-daily', categoryPath: '购物 / 日用', date: '2026-07-01', note: '', images: [], recorderOpenid: 'openid-yu', payerOpenid: 'openid-yu', createdAt: '2026-07-01T18:05:00.000Z' },
    { _id: 'r-3', bookId: 'book-home', type: 'income', title: '工资', amount: 12000.0, currency: 'CNY', rate: 1, baseCurrency: 'CNY', amountConverted: 12000.0, categoryId: 'cat-income-salary', categoryPath: '职业收入 / 工资', date: '2026-06-30', note: '', images: [], recorderOpenid: 'openid-yu', payerOpenid: 'openid-yu', createdAt: '2026-06-30T09:00:00.000Z' },
    { _id: 'r-4', bookId: 'book-home', type: 'expense', title: '星巴克咖啡', amount: 5.4, currency: 'EUR', rate: 7.83, baseCurrency: 'CNY', amountConverted: 42.3, categoryId: 'cat-food-coffee', categoryPath: '餐饮 / 咖啡', date: '2026-06-30', note: '通勤路上的拿铁', images: [], recorderOpenid: 'openid-yu', payerOpenid: 'openid-yu', createdAt: '2026-06-30T08:12:00.000Z' },
    { _id: 'r-5', bookId: 'book-home', type: 'expense', title: '地铁通勤', amount: 6.0, currency: 'CNY', rate: 1, baseCurrency: 'CNY', amountConverted: 6.0, categoryId: 'cat-trans-metro', categoryPath: '交通 / 地铁', date: '2026-06-29', note: '', images: [], recorderOpenid: 'openid-zhe', payerOpenid: 'openid-zhe', createdAt: '2026-06-29T08:40:00.000Z' },
    { _id: 'r-6', bookId: 'book-home', type: 'expense', title: '感冒药', amount: 58.0, currency: 'CNY', rate: 1, baseCurrency: 'CNY', amountConverted: 58.0, categoryId: 'cat-med-drug', categoryPath: '医疗 / 药品', date: '2026-06-29', note: '', images: [], recorderOpenid: 'openid-yu', payerOpenid: 'openid-yu', createdAt: '2026-06-29T20:10:00.000Z' },
    // 日本旅行（分账结算型）
    { _id: 'r-jp-1', bookId: 'book-jp', type: 'expense', title: '新宿酒店 3 晚', amount: 2400, currency: 'CNY', rate: 1, baseCurrency: 'CNY', amountConverted: 2400, categoryId: 'cat-jp-hotel', categoryPath: '住宿', date: '2026-06-20', note: '', images: [], recorderOpenid: 'openid-yu', payerOpenid: 'openid-yu', split: { mode: 'even', members: [{ openid: 'openid-yu', share: 800 }, { openid: 'openid-zhe', share: 800 }, { openid: 'openid-lin', share: 800 }] }, createdAt: '2026-06-20T15:00:00.000Z' },
    { _id: 'r-jp-2', bookId: 'book-jp', type: 'expense', title: 'JR Pass ×3', amount: 1860, currency: 'CNY', rate: 1, baseCurrency: 'CNY', amountConverted: 1860, categoryId: 'cat-jp-trans', categoryPath: '交通', date: '2026-06-20', note: '', images: [], recorderOpenid: 'openid-yu', payerOpenid: 'openid-yu', split: { mode: 'even', members: [{ openid: 'openid-yu', share: 620 }, { openid: 'openid-zhe', share: 620 }, { openid: 'openid-lin', share: 620 }] }, createdAt: '2026-06-20T16:00:00.000Z' },
    { _id: 'r-jp-3', bookId: 'book-jp', type: 'expense', title: '居酒屋晚餐', amount: 13650, currency: 'JPY', rate: 0.04615, baseCurrency: 'CNY', amountConverted: 630, categoryId: 'cat-jp-food', categoryPath: '餐饮', date: '2026-06-21', note: '', images: [], recorderOpenid: 'openid-zhe', payerOpenid: 'openid-zhe', split: { mode: 'even', members: [{ openid: 'openid-yu', share: 210 }, { openid: 'openid-zhe', share: 210 }, { openid: 'openid-lin', share: 210 }] }, createdAt: '2026-06-21T20:30:00.000Z' },
    { _id: 'r-jp-4', bookId: 'book-jp', type: 'expense', title: '便利店零食', amount: 90, currency: 'CNY', rate: 1, baseCurrency: 'CNY', amountConverted: 90, categoryId: 'cat-jp-food', categoryPath: '餐饮', date: '2026-06-21', note: '', images: [], recorderOpenid: 'openid-lin', payerOpenid: 'openid-lin', split: { mode: 'even', members: [{ openid: 'openid-yu', share: 30 }, { openid: 'openid-zhe', share: 30 }, { openid: 'openid-lin', share: 30 }] }, createdAt: '2026-06-21T22:00:00.000Z' },
    { _id: 'r-jp-5', bookId: 'book-jp', type: 'expense', title: '药妆店（个人）', amount: 240, currency: 'CNY', rate: 1, baseCurrency: 'CNY', amountConverted: 240, categoryId: 'cat-jp-shop', categoryPath: '购物', date: '2026-06-22', note: '', images: [], recorderOpenid: 'openid-yu', payerOpenid: 'openid-yu', split: { mode: 'treat', members: [{ openid: 'openid-yu', share: 240 }] }, createdAt: '2026-06-22T11:00:00.000Z' },
  ],

  rates: [
    { _id: '2026-06-29_CNY', date: '2026-06-29', base: 'CNY', quotes: { CNY: 1, USD: 7.23, EUR: 7.81, JPY: 0.0461, KRW: 0.0053, HKD: 0.925, GBP: 9.13, AUD: 4.79, CAD: 5.29, SGD: 5.38, TWD: 0.224, THB: 0.199 }, isFallback: false },
    { _id: '2026-06-30_CNY', date: '2026-06-30', base: 'CNY', quotes: { CNY: 1, USD: 7.24, EUR: 7.83, JPY: 0.0462, KRW: 0.0053, HKD: 0.926, GBP: 9.15, AUD: 4.80, CAD: 5.30, SGD: 5.40, TWD: 0.225, THB: 0.200 }, isFallback: false },
    { _id: '2026-07-01_CNY', date: '2026-07-01', base: 'CNY', quotes: { CNY: 1, USD: 7.24, EUR: 7.84, JPY: 0.0463, KRW: 0.0054, HKD: 0.926, GBP: 9.16, AUD: 4.81, CAD: 5.31, SGD: 5.41, TWD: 0.225, THB: 0.201 }, isFallback: false },
  ],

  chartLayouts: [
    { _id: 'book-home_openid-yu', bookId: 'book-home', openid: 'openid-yu', order: ['overview', 'trend', 'year', 'total'], updatedAt: '2026-07-01T00:00:00.000Z' },
  ],

  aiMessages: [
    { _id: 'ai-1', bookId: 'book-home', openid: 'openid-yu', role: 'user', text: '上个月我们餐饮花了多少？', createdAt: '2026-07-01T09:00:00.000Z' },
    { _id: 'ai-2', bookId: 'book-home', openid: 'openid-yu', role: 'ai', text: '6 月「家庭日常」账本的餐饮合计支出为 ¥1,284.60，共 32 笔。其中外卖占 ¥612，晚餐 ¥458，咖啡/奶茶 ¥214.60（含 3 笔欧元记录已按当日汇率换算）。', createdAt: '2026-07-01T09:00:03.000Z' },
    { _id: 'ai-3', bookId: 'book-home', openid: 'openid-yu', role: 'user', text: '这周谁花得最多？', createdAt: '2026-07-01T09:01:00.000Z' },
    { _id: 'ai-4', bookId: 'book-home', openid: 'openid-yu', role: 'ai', text: '本周小雨记账 ¥1,240、阿哲记账 ¥860，合计约 ¥2,100。其中「超市采购 ¥213.50」是最大的一笔。', createdAt: '2026-07-01T09:01:04.000Z' },
    { _id: 'ai-5', bookId: 'book-home', openid: 'openid-yu', role: 'card', card: { kind: '收据识别', state: 'pending', rows: [{ k: '商家', v: 'City Supermarkt', edit: true }, { k: '金额', v: '€18.90', extra: '≈ ¥147.99', edit: true }, { k: '建议分类', v: '购物 · 日用', edit: true }, { k: '日期', v: '2026-07-01' }, { k: '记录人 / 付款人', v: '小雨' }] }, createdAt: '2026-07-01T09:02:00.000Z' },
  ],
};
