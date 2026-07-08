// 演示数据生成器 —— 与用户真实数据完全隔离：
// - 不触碰调用者的 users 文档（不改昵称/头像/默认账本）
// - 所有演示文档带 seed: true 标记 + `seed-` 前缀 id，可整体清除（seed.clear）
// - 演示成员是独立假用户（seed-u-*，无法登录），调用者仅以 owner 身份加入两个演示账本
// - 不写 rates（汇率走真实快照/懒加载）、不写 chartLayouts（用默认布局）
// 数据形态：近 45 天高频（覆盖按天分页）+ 早 10 个月稀疏（撑起年度图表）+ 多币种固化 + 分账账本样例
module.exports = { build };

const BOOK_SHARE = 'seed-book-share';
const BOOK_SPLIT = 'seed-book-split';

// 北京时间「今天 + offset 天」的 YYYY-MM-DD
function bjDate(offset) {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
function at(dateStr, hour) {
  return new Date(`${dateStr}T${hour < 10 ? '0' + hour : hour}:00:00+08:00`);
}
// 确定性伪随机（0~1）：同一天生成的数据稳定可复现
function frac(n) { return ((n * 9301 + 49297) % 233280) / 233280; }
function pick(arr, n) { return arr[Math.floor(frac(n) * arr.length) % arr.length]; }
function round2(x) { return Math.round(x * 100) / 100; }

// 假成员（独立于真实用户体系）
const FAKES = [
  { openid: 'seed-u-xiaoyu', nickname: '小雨', color: '#00ccf9' },
  { openid: 'seed-u-azhe', nickname: '阿哲', color: '#9edf10' },
  { openid: 'seed-u-momo', nickname: 'Momo', color: '#ffcd2f' },
];

// 演示分类（账本级，两级，收支分离）
const CATS = {
  expense: [
    { key: 'dining', name: '餐饮', icon: 'dining', subs: ['早餐', '午餐', '晚餐', '饮料', '外卖'] },
    { key: 'transport', name: '交通', icon: 'car', subs: ['打车', '地铁', '加油'] },
    { key: 'shopping', name: '购物', icon: 'bag', subs: ['日用', '服饰', '数码'] },
    { key: 'home', name: '居家', icon: 'house', subs: ['房租', '水电'] },
    { key: 'play', name: '娱乐', icon: 'play', subs: ['电影', '游戏'] },
    { key: 'medical', name: '医疗', icon: 'medical', subs: [] },
    { key: 'other', name: '其他', icon: 'dots', subs: [] },
  ],
  income: [
    { key: 'job', name: '职业收入', icon: 'income', subs: ['工资', '奖金', '补贴'] },
    { key: 'extra', name: '其他收入', icon: 'gift', subs: ['红包', '退款', '理财'] },
  ],
};

// 消费菜单：{ 标题, 一级 key, 二级名, 金额区间(CNY), 可选外币 }
const MENU = [
  { t: '午餐', cat: 'dining', sub: '午餐', lo: 18, hi: 45 },
  { t: '早餐', cat: 'dining', sub: '早餐', lo: 6, hi: 18 },
  { t: '晚餐', cat: 'dining', sub: '晚餐', lo: 30, hi: 120 },
  { t: '咖啡', cat: 'dining', sub: '饮料', lo: 12, hi: 38, fx: 'EUR' },
  { t: '外卖', cat: 'dining', sub: '外卖', lo: 20, hi: 55 },
  { t: '打车', cat: 'transport', sub: '打车', lo: 12, hi: 68 },
  { t: '地铁', cat: 'transport', sub: '地铁', lo: 3, hi: 8 },
  { t: '超市采购', cat: 'shopping', sub: '日用', lo: 35, hi: 160 },
  { t: '衣服', cat: 'shopping', sub: '服饰', lo: 99, hi: 420, fx: 'USD' },
  { t: '数码配件', cat: 'shopping', sub: '数码', lo: 49, hi: 320, fx: 'JPY' },
  { t: '电影', cat: 'play', sub: '电影', lo: 35, hi: 90 },
  { t: '水电缴费', cat: 'home', sub: '水电', lo: 80, hi: 260 },
];

// 演示用固化汇率（原币 → CNY），按月微幅漂移模拟波动；写进每条记录固化保存
const FX_BASE = { EUR: 7.85, USD: 7.23, JPY: 0.048 };
function fxRate(cur, dateStr) {
  const m = parseInt(dateStr.slice(5, 7), 10);
  const drift = 1 + ((m % 5) - 2) * 0.004;
  return Math.round(FX_BASE[cur] * drift * 1e6) / 1e6;
}

function build(me) {
  const users = FAKES.map((f) => ({
    _id: f.openid, openid: f.openid, nickname: f.nickname,
    avatarColor: f.color, avatarInitial: f.nickname.slice(0, 1), avatarFileID: '',
    registered: true, defaultBookId: '',
    settings: { displayCurrency: 'CNY', aiMessageLimit: 50 },
    createdAt: at(bjDate(-360), 9), seed: true,
  }));

  const books = [
    { _id: BOOK_SHARE, name: '家庭演示账本', type: 'share', baseCurrency: 'CNY', ownerOpenid: me, memberCount: 4, createdAt: at(bjDate(-320), 9), seed: true },
    { _id: BOOK_SPLIT, name: '旅行分账演示', type: 'split', baseCurrency: 'CNY', ownerOpenid: me, memberCount: 3, createdAt: at(bjDate(-20), 9), seed: true },
  ];

  const mk = (bookId, openid, role, color) => ({ bookId, openid, role, avatarColor: color, joinedAt: at(bjDate(-300), 10), status: 'active', seed: true });
  const members = [
    mk(BOOK_SHARE, me, 'owner', '#00ccf9'),
    mk(BOOK_SHARE, FAKES[0].openid, 'admin', FAKES[0].color),
    mk(BOOK_SHARE, FAKES[1].openid, 'rw', FAKES[1].color),
    mk(BOOK_SHARE, FAKES[2].openid, 'ro', FAKES[2].color),
    mk(BOOK_SPLIT, me, 'owner', '#00ccf9'),
    mk(BOOK_SPLIT, FAKES[0].openid, 'rw', FAKES[0].color),
    mk(BOOK_SPLIT, FAKES[1].openid, 'rw', FAKES[1].color),
  ];

  // 分类（两个账本各一套，id 前缀区分）
  const categories = [];
  const catId = {}; // `${bookId}|${topKey}|${subName||''}` → id
  [BOOK_SHARE, BOOK_SPLIT].forEach((bookId, bi) => {
    ['expense', 'income'].forEach((kind) => {
      CATS[kind].forEach((c, i) => {
        const topId = `seed-c-${bi}-${kind}-${c.key}`;
        categories.push({ _id: topId, bookId, kind, parentId: null, name: c.name, icon: c.icon, order: i + 1, disabled: false, seed: true });
        catId[`${bookId}|${c.key}|`] = topId;
        c.subs.forEach((s, j) => {
          const subId = `${topId}-${j}`;
          categories.push({ _id: subId, bookId, kind, parentId: topId, name: s, icon: null, order: j + 1, disabled: false, seed: true });
          catId[`${bookId}|${c.key}|${s}`] = subId;
        });
      });
    });
  });

  // 记账者轮换（只读成员 Momo 不产生记录）
  const writers = [me, FAKES[0].openid, FAKES[1].openid];

  const records = [];
  let sn = 7; // 伪随机步进种子
  const expByKey = {}; CATS.expense.forEach((c) => { expByKey[c.key] = c; });
  const incByKey = {}; CATS.income.forEach((c) => { incByKey[c.key] = c; });

  const addExpense = (bookId, dayOffset, idx) => {
    sn += 13;
    const item = pick(MENU, sn + idx * 31);
    const date = bjDate(dayOffset);
    const amountCny = round2(item.lo + frac(sn * 3 + idx) * (item.hi - item.lo));
    // 每 ~7 条一条外币记录（记账当日汇率固化进记录）
    const useFx = item.fx && (sn + idx) % 7 === 0;
    const currency = useFx ? item.fx : 'CNY';
    const rate = useFx ? fxRate(currency, date) : 1;
    const amount = useFx ? round2(amountCny / rate) : amountCny;
    const who = pick(writers, sn + idx * 17);
    records.push({
      bookId, type: 'expense', title: item.t,
      amount, currency, rate, baseCurrency: 'CNY', amountConverted: round2(amount * rate),
      categoryId: catId[`${bookId}|${item.cat}|${item.sub}`] || catId[`${bookId}|${item.cat}|`],
      categoryPath: item.sub ? `${expByKey[item.cat].name} / ${item.sub}` : expByKey[item.cat].name,
      date, note: '', images: [],
      recorderOpenid: who, payerOpenid: who, split: null,
      createdAt: at(date, 10 + (idx % 9)), createdBy: who, updatedAt: at(date, 10 + (idx % 9)), updatedBy: who,
      seed: true,
    });
  };
  const addIncome = (bookId, dayOffset, subName, amount, title) => {
    const date = bjDate(dayOffset);
    const top = (subName === '工资' || subName === '奖金' || subName === '补贴') ? 'job' : 'extra';
    records.push({
      bookId, type: 'income', title: title || subName,
      amount, currency: 'CNY', rate: 1, baseCurrency: 'CNY', amountConverted: amount,
      categoryId: catId[`${bookId}|${top}|${subName}`] || catId[`${bookId}|${top}|`],
      categoryPath: `${incByKey[top].name} / ${subName}`,
      date, note: '', images: [],
      recorderOpenid: me, payerOpenid: me, split: null,
      createdAt: at(date, 9), createdBy: me, updatedAt: at(date, 9), updatedBy: me,
      seed: true,
    });
  };

  // ① 近 45 天高频（覆盖分页：20 天/页 ≈ 2 页多）
  const pattern = [2, 1, 0, 3, 1, 2, 1];
  for (let d = 0; d >= -44; d--) {
    const n = pattern[(-d) % pattern.length];
    for (let i = 0; i < n; i++) addExpense(BOOK_SHARE, d, i);
  }
  // ② 早 10 个月稀疏（撑起近 12 月收支趋势）
  for (let m = 2; m <= 11; m++) {
    [5, 12, 21, 27].forEach((day, i) => {
      if (frac(m * 37 + i) < 0.8) addExpense(BOOK_SHARE, -m * 30 - (day % 9), i + m);
    });
    addIncome(BOOK_SHARE, -m * 30 - 3, '工资', 8000 + (m % 3) * 400);
  }
  // ③ 近期收入
  addIncome(BOOK_SHARE, -2, '工资', 8600);
  addIncome(BOOK_SHARE, -9, '红包', 200, '生日红包');
  addIncome(BOOK_SHARE, -16, '退款', 89.9, '网购退款');

  // ④ 分账账本：付款人 + 分摊样例（含一条外币）
  const splitAll = [me, FAKES[0].openid, FAKES[1].openid].map((o) => ({ openid: o }));
  const splitRecs = [
    { d: -1, t: '民宿房费', amt: 680, payer: me, mode: 'even' },
    { d: -2, t: '打车去机场', amt: 96, payer: FAKES[0].openid, mode: 'even' },
    { d: -3, t: '晚餐居酒屋', amt: 5200, payer: FAKES[1].openid, mode: 'even', cur: 'JPY' },
    { d: -4, t: '门票', amt: 240, payer: me, mode: 'even' },
    { d: -5, t: '咖啡请客', amt: 58, payer: FAKES[0].openid, mode: 'treat' },
    { d: -8, t: '超市补给', amt: 132, payer: FAKES[1].openid, mode: 'even' },
  ];
  splitRecs.forEach((s, i) => {
    const date = bjDate(s.d);
    const currency = s.cur || 'CNY';
    const rate = currency === 'CNY' ? 1 : fxRate(currency, date);
    records.push({
      bookId: BOOK_SPLIT, type: 'expense', title: s.t,
      amount: s.amt, currency, rate, baseCurrency: 'CNY', amountConverted: round2(s.amt * rate),
      categoryId: catId[`${BOOK_SPLIT}|other|`],
      categoryPath: '其他', date, note: '', images: [],
      recorderOpenid: s.payer, payerOpenid: s.payer,
      split: { mode: s.mode, members: s.mode === 'treat' ? [{ openid: s.payer }] : splitAll },
      createdAt: at(date, 12 + i), createdBy: s.payer, updatedAt: at(date, 12 + i), updatedBy: s.payer,
      seed: true,
    });
  });

  // ⑤ AI 会话样例（属于调用者，仅演示账本）
  const aiMessages = [
    { bookId: BOOK_SHARE, openid: me, role: 'ai', html: '你好，我是心数 AI 助手。可以问我「本月支出多少」「餐饮花了多少」，也可以说「昨天打车 35」帮你记一笔。', createdAt: at(bjDate(0), 8), seed: true },
  ];

  return { users, books, members, categories, records, aiMessages };
}
