// 公共库：数据库句柄、错误、身份/成员/角色校验、汇率换算
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// 运行环境开关：仅当云函数环境变量 APP_ENV=dev 时，才允许脚本注入(seed)等危险操作。
// 未配置（默认 prod）→ seed 禁用，公开仓库也无法被利用。开发时在云开发控制台把 APP_ENV 设为 dev。
const APP_ENV = process.env.APP_ENV || 'prod';
const IS_DEV = APP_ENV === 'dev';

// 币种符号（前后端一致，与 miniprogram/utils/currency.js 同步维护）
const CUR_SYMBOL = {
  CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥', HKD: 'HK$',
  CHF: 'Fr', ISK: 'kr', SEK: 'kr', NOK: 'kr', DKK: 'kr',
  PLN: 'zł', CZK: 'Kč', HUF: 'Ft', RON: 'lei', BGN: 'лв', TRY: '₺', RUB: '₽',
  KRW: '₩', AUD: 'A$', CAD: 'C$', NZD: 'NZ$', SGD: 'S$', TWD: 'NT$',
  THB: '฿', MYR: 'RM', VND: '₫', IDR: 'Rp', INR: '₹', AED: 'د.إ',
};

class AppError extends Error {
  constructor(code, msg) {
    super(msg || code);
    this.code = code;
  }
}

const ROLE_RANK = { ro: 1, rw: 2, admin: 3, owner: 4 };

// 取某账本中某用户的成员记录（未加入返回 null）
async function getMember(bookId, openid) {
  const r = await db.collection('members').where({ bookId, openid }).get();
  const m = r.data[0];
  if (m && m.status === 'removed') return null;
  return m || null;
}

// 必须是成员，否则不可见
async function requireMember(bookId, openid) {
  const m = await getMember(bookId, openid);
  if (!m) throw new AppError('NOT_MEMBER', '非该账本成员');
  return m;
}

// 角色需达到 min
function requireRole(member, min) {
  if (ROLE_RANK[member.role] < ROLE_RANK[min]) {
    throw new AppError('NO_PERMISSION', '角色权限不足');
  }
}

// 取 date 当日（或最近一次）1 单位 currency 折算成 base 的汇率。
// 快照统一以 CNY 为基准（quotes[X]=1 单位 X 折合多少 CNY），任意 base 经 CNY 枢轴换算：
// base 每 1 currency = (CNY/currency) / (CNY/base)。修复非 CNY 基准账本取不到汇率的 blocker。
async function getRate(date, base, currency) {
  if (currency === base) return { rate: 1, isFallback: false };
  // 当日精确 → 最近一个 <=date → 最近任意一天，均按 CNY 基准快照取
  let doc = (await db.collection('rates').where({ date, base: 'CNY' }).get()).data[0];
  let isFallback = false;
  if (!doc) {
    doc = (await db.collection('rates').where({ base: 'CNY', date: _.lte(date) }).orderBy('date', 'desc').limit(1).get()).data[0];
    isFallback = true;
  }
  if (!doc) {
    doc = (await db.collection('rates').where({ base: 'CNY' }).orderBy('date', 'desc').limit(1).get()).data[0];
    isFallback = true;
  }
  const cny = (doc && doc.quotes) || null;
  if (!cny) throw new AppError('RATE_UNAVAILABLE', '汇率取不到');
  const cCur = currency === 'CNY' ? 1 : cny[currency];
  const cBase = base === 'CNY' ? 1 : cny[base];
  if (!cCur || !cBase) throw new AppError('RATE_UNAVAILABLE', '汇率取不到');
  return { rate: round6(cCur / cBase), isFallback };
}

const round2 = (n) => Math.round(n * 100) / 100;

// 取账本成员映射 openid -> {name, initial, color, avatarFileID, role}
// 名字/头像实时取自 users（唯一数据源）：改了个人资料，各处显示自动更新；
// members.nameOverride 为「我在本账本的自定义名」，优先于 users.nickname。
async function membersMap(bookId) {
  const r = await db.collection('members').where({ bookId }).get();
  const openids = r.data.map((m) => m.openid);
  const users = {};
  if (openids.length) {
    const u = await db.collection('users').where({ _id: _.in(openids) }).get();
    u.data.forEach((x) => { users[x._id] = x; });
  }
  const map = {};
  r.data.forEach((m) => {
    const u = users[m.openid] || {};
    // 已注销用户：注销时昵称已快照进 nameOverride，展示加后缀，历史记录仍可读
    const baseName = m.nameOverride || u.nickname || '成员';
    const name = m.deletedUser ? `${baseName}（已注销）` : baseName;
    map[m.openid] = {
      name, initial: u.avatarInitial || baseName.slice(0, 1),
      color: m.avatarColor || u.avatarColor || '#00ccf9',
      avatarFileID: u.avatarFileID || '',
      role: m.role,
    };
  });
  return map;
}

// 取账本分类映射 _id -> cat；并可解析顶级图标/名称
async function categoriesMap(bookId) {
  const r = await db.collection('categories').where({ bookId }).get();
  const map = {};
  r.data.forEach((c) => { map[c._id] = c; });
  return map;
}
function topCategory(map, categoryId) {
  const c = map[categoryId];
  if (!c) return { name: '', icon: 'dots' };
  const top = c.parentId ? map[c.parentId] : c;
  return { name: (top && top.name) || c.name, icon: (top && top.icon) || 'dots' };
}

module.exports = {
  cloud, db, _, AppError, ROLE_RANK, CUR_SYMBOL,
  getMember, requireMember, requireRole, getRate, round2,
  membersMap, categoriesMap, topCategory,
  IS_DEV, APP_ENV,
};
