const {
  cloud, db, _, AppError, getMember, requireMember, requireRole, getRate, round2,
  membersMap, categoriesMap, topCategory, IS_DEV, CUR_SYMBOL,
} = require('./lib');
const SEED = require('./seedData');
const dataio = require('./dataio');
const https = require('https');

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const round6 = (n) => Math.round(n * 1e6) / 1e6;
// 汇率一律按有效数字保精度（小面值币种的汇率用 round6 只剩 2~4 位有效数字，
// 误差经 1/rate 放大后金额差出几分到几毛），金额才用 round2/round6
const rateSig = (n) => Number(Number(n).toPrecision(12));

// —— 工具 ——
async function getUser(openid) {
  const r = await db.collection('users').doc(openid).get().catch(() => null);
  return r && r.data ? r.data : null;
}
// 静默注册的随机身份：审核要求「先体验后授权」，首次进入不再强制填昵称头像，
// 由 openid 稳定哈希生成默认昵称/首字头像/颜色，用户之后可随时在「我的」修改
const NICK_ADJ = ['元气', '悠闲', '安然', '清爽', '温暖', '明快', '沉静', '奇思'];
const NICK_NOUN = ['小鹿', '小猫', '小熊', '小狐', '白鲸', '刺猬', '企鹅', '水獭'];
const AVATAR_COLORS = ['#00ccf9', '#7a5af8', '#f59e0b', '#10b981', '#f97316', '#ec4899', '#6366f1', '#14b8a6'];
function genIdentity(openid) {
  let h = 0;
  for (const ch of String(openid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  // 必须无符号移位（>>>）：h 超过 2^31 时 >> 会得到负数，负索引取出 undefined
  const noun = NICK_NOUN[(h >>> 4) % NICK_NOUN.length];
  return {
    nickname: NICK_ADJ[h % NICK_ADJ.length] + noun,
    avatarInitial: noun.slice(-1),
    avatarColor: AVATAR_COLORS[(h >>> 8) % AVATAR_COLORS.length],
  };
}
async function ensureUser(openid, channel) {
  let u = await getUser(openid);
  if (!u) {
    // data 里不能带 _id（set 会整单失败），且失败必须抛出——静默吞错会导致用户文档永远建不起来
    // channel = 首次进入时的渠道（develop/trial/release），仅统计用；同一 openid 各渠道是同一人，清理时绝不按此删用户
    // registered 直接 true：身份即 openid，无需授权即可用全部功能（微信审核不允许进入即强制授权）
    u = { openid, ...genIdentity(openid), avatarFileID: '', registered: true, defaultBookId: '', settings: { displayCurrency: 'CNY', aiMessageLimit: 50 }, channel: channel || 'unknown', createdAt: db.serverDate() };
    await db.collection('users').doc(openid).set({ data: u });
    u._id = openid;
  }
  return u;
}

// 展示币种解析（PRD 待定 5 已拍板：每账本各设一个，全局给默认）：
// 优先级 = 该用户在该账本的覆盖值 > 用户全局默认 > 账本基准币种。
// 覆盖值存 users.settings.bookCurrency[bookId]，跟随「账本 × 用户」，与图表布局同一归属模型。
function displayCurrencyOf(u, bookId, base) {
  const s = (u && u.settings) || {};
  const byBook = s.bookCurrency || {};
  return (bookId && byBook[bookId]) || s.displayCurrency || base || 'CNY';
}
const COLLECTIONS = ['users', 'books', 'members', 'categories', 'records', 'rates', 'chartLayouts', 'aiMessages', 'feedbacks', 'admins', 'files', 'settlements'];
async function ensureCollections() {
  // 并行建集合：串行 11 次在全新环境下会顶到云函数 3 秒默认超时（-504003）
  await Promise.all(COLLECTIONS.map((c) => db.createCollection(c).catch(() => {})));
}
// 彻底清空一个集合：循环批量删除，直到删空。
// 云函数端 where().remove() 单次有批量上限，只调一次会残留；这里循环直到无可删。
async function clearCollection(name) {
  const col = db.collection(name);
  let removed = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const res = await col.where({ _id: _.exists(true) }).remove().catch(() => null);
    const n = res && res.stats ? res.stats.removed : 0;
    if (!n) break;
    removed += n;
  }
  return removed;
}

// 按条件删光集合中匹配的文档：where().remove() 单次有批量上限，循环直到无可删（同 clearCollection）
async function removeAllWhere(name, where) {
  for (let guard = 0; guard < 1000; guard++) {
    const res = await db.collection(name).where(where).remove().catch(() => null);
    const n = res && res.stats ? res.stats.removed : 0;
    if (!n) break;
  }
}

// 分批删除云存储文件（deleteFile 单次上限 50，失败不阻断流程）
async function deleteFiles(fileIDs) {
  const ids = [...new Set((fileIDs || []).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 50) {
    await cloud.deleteFile({ fileList: ids.slice(i, i + 50) }).catch(() => {});
  }
  return ids.length;
}

// 收集某账本全部记录图片的云存储 fileID（分页，防大账本截断）
async function collectBookImageFileIDs(bookId) {
  const PAGE = 1000; const ids = [];
  for (let skip = 0; ; skip += PAGE) {
    const r = await db.collection('records').where({ bookId }).field({ images: true }).skip(skip).limit(PAGE).get();
    r.data.forEach((rec) => { (rec.images || []).forEach((f) => ids.push(f)); });
    if (r.data.length < PAGE) break;
  }
  return ids;
}

// 解散账本：先删记录图片的云存储文件（否则文件泄漏无人引用），再删各集合数据与账本本身
async function dissolveBook(bookId) {
  const imgs = await collectBookImageFileIDs(bookId).catch(() => []);
  await deleteFiles(imgs);
  for (const c of ['records', 'members', 'categories', 'chartLayouts', 'aiMessages', 'settlements']) {
    await removeAllWhere(c, { bookId });
  }
  await db.collection('books').doc(bookId).remove().catch(() => {});
}

// 新账本的默认两级分类（之后用户可增/删，按账本独立）
const DEFAULT_CATS = {
  expense: [
    { name: '餐饮', icon: 'dining', subs: ['早餐', '午餐', '晚餐', '外卖', '零食', '饮料'] },
    { name: '交通', icon: 'train', subs: ['公交', '地铁', '打车', '加油', '停车'] },
    { name: '购物', icon: 'bag', subs: ['日用', '服饰', '数码', '美妆'] },
    { name: '居家', icon: 'house', subs: ['房租', '水电', '物业', '家具'] },
    { name: '娱乐', icon: 'play', subs: ['电影', '游戏', '订阅', '旅行'] },
    { name: '医疗', icon: 'medical', subs: ['药品', '门诊', '体检'] },
    { name: '教育', icon: 'edu', subs: ['书籍', '课程', '文具'] },
    { name: '其他', icon: 'dots', subs: [] },
  ],
  income: [
    { name: '工资薪酬', icon: 'income', subs: ['工资', '奖金', '补贴', '加班费'] },
    { name: '兼职副业', icon: 'pencil', subs: ['兼职', '稿费', '接单'] },
    { name: '投资理财', icon: 'bars', subs: ['利息', '分红', '基金', '股票'] },
    { name: '租金经营', icon: 'house', subs: ['房租', '经营'] },
    { name: '人情往来', icon: 'gift', subs: ['红包', '礼金', '压岁钱'] },
    { name: '报销退款', icon: 'refresh', subs: ['报销', '退款', '返现'] },
    { name: '奖励中奖', icon: 'star', subs: ['中奖', '积分兑换'] },
    { name: '其他收入', icon: 'dots', subs: [] },
  ],
};
async function seedDefaultCategories(bookId) {
  // 批量插入（服务端 add 支持数组）：原先约 68 次串行 add 会把 book.create 顶过 3 秒超时
  await Promise.all(['expense', 'income'].map(async (kind) => {
    const cats = DEFAULT_CATS[kind];
    const parentDocs = cats.map((c, i) => ({ bookId, kind, parentId: null, name: c.name, icon: c.icon, order: i + 1, disabled: false }));
    const pr = await db.collection('categories').add({ data: parentDocs });
    const pids = pr._ids || (pr._id ? [pr._id] : []);
    const subDocs = [];
    cats.forEach((c, i) => {
      c.subs.forEach((s, j) => {
        subDocs.push({ bookId, kind, parentId: pids[i], name: s, icon: null, order: j + 1, disabled: false });
      });
    });
    if (subDocs.length) await db.collection('categories').add({ data: subDocs });
  }));
}
async function fetchBookRecords(bookId) {
  const r = await db.collection('records').where({ bookId }).orderBy('date', 'desc').orderBy('createdAt', 'desc').limit(1000).get();
  return r.data;
}
function monthOf(dateStr) { return (dateStr || '').slice(0, 7); }

// —— 展示币种换算 ——
// 记录里 amountConverted 固化在账本基准币；切换「展示币种」只改变汇总口径（用最新汇率整体换算），
// 不重算历史每笔（符合 PRD）。汇率快照以 CNY 为基准，quotes[X]=1 单位 X 折合多少 CNY。
let _lazyRateTried = false; // 单次云函数实例内避免重复外呼

// 拉取实时 CNY 基准汇率并入库（供每日定时、手动刷新、懒加载共用）
async function fetchAndStoreCnyQuotes() {
  const base = 'CNY';
  const j = await httpGetJson(`https://open.er-api.com/v6/latest/${base}`);
  if (!j || !j.rates) throw new AppError('RATE_UNAVAILABLE', '获取汇率失败');
  const quotes = {};
  Object.keys(j.rates).forEach((c) => {
    const r = j.rates[c];
    if (r > 0) quotes[c] = c === base ? 1 : rateSig(1 / r); // 1 单位外币 = ? 基准币（有效数字保精度）
  });
  const date = relDate(0); // 北京时间当天
  await db.collection('rates').doc(`${date}_${base}`).set({ data: { date, base, quotes, isFallback: false } });
  return { date, quotes };
}

async function latestCnyQuotes() {
  const r = await db.collection('rates').where({ base: 'CNY' }).orderBy('date', 'desc').limit(1).get();
  if (r.data[0]) return r.data[0].quotes;
  // 库里没有任何 CNY 汇率快照：首次需要换算时懒加载一次实时汇率（不依赖 seed/定时器）
  if (!_lazyRateTried) {
    _lazyRateTried = true;
    try { return (await fetchAndStoreCnyQuotes()).quotes; }
    catch (e) { console.error('[lazy rate]', e); }
  }
  return null;
}
// 基准币 base → 展示币 display 的换算系数
async function convFactor(base, display) {
  if (!display || display === base) return 1;
  const q = await latestCnyQuotes();
  if (!q) return 1;
  const qb = base === 'CNY' ? 1 : q[base];
  const qd = display === 'CNY' ? 1 : q[display];
  if (!qb || !qd) return 1; // 缺汇率则不换算，避免出错
  return qb / qd;
}

// —— 按「记录当日」汇率换算（正确模型）——
// 真值 = 原始金额 + 原始币种 + 日期。任意展示币种都用「该记录当日」的汇率换算（经 CNY 枢轴），
// 结果随记录日期固化、不随今日汇率漂移；换展示币种时用的是记录当日的 原币→展示币 汇率。
function cnyPerUnit(quotes, cur) {
  if (cur === 'CNY') return 1;
  return quotes && quotes[cur] != null ? quotes[cur] : null;
}
// 载入全部 CNY 基准汇率快照（按日期升序），按记录日期就近取
async function loadRateIndex() {
  const r = await db.collection('rates').where({ base: 'CNY' }).orderBy('date', 'asc').limit(1000).get();
  let list = r.data || [];
  if (!list.length) { const q = await latestCnyQuotes(); if (q) list = [{ date: relDate(0), quotes: q }]; }
  return list;
}
// 取 date 当日（或最近一个 <=date）的快照 quotes；都没有则取最早
function quotesAt(index, date) {
  if (!index || !index.length) return null;
  let chosen = null;
  for (let i = 0; i < index.length; i++) { if (index[i].date <= date) chosen = index[i]; else break; }
  return (chosen || index[0]).quotes;
}
// 记录固化的 CNY 值（基准币=CNY 时即 amountConverted）
function recCny(rec, quotes) {
  if (!rec.baseCurrency || rec.baseCurrency === 'CNY') return rec.amountConverted;
  const qb = cnyPerUnit(quotes, rec.baseCurrency);
  return qb ? rec.amountConverted * qb : rec.amountConverted;
}
// 记录换算到 display 币种（用记录当日汇率）
function recToDisplay(rec, display, quotes) {
  // 展示币种 = 记录原始币种：直接用原始金额。走「原币→基准币(round2)→展示币」往返会把
  // 基准币的分级舍入放大回来（如 1000 ISK 固化成 €6.29 再换回来变 1000.78）
  if (rec.currency === display && rec.amount != null) return round2(rec.amount);
  const cny = recCny(rec, quotes);
  if (display === 'CNY') return round2(cny);
  const qd = cnyPerUnit(quotes, display);
  return round2(qd ? cny / qd : cny);
}
// 某日「基准币 → 展示币」换算系数（该日汇率、CNY 枢轴）。
// recToDisplay ≡ amountConverted × dayFactor(记录日期)，故日聚合 × 系数与逐笔换算口径完全一致。
function dayFactor(rateIndex, date, base, display) {
  if (!display || display === base) return 1;
  const q = quotesAt(rateIndex, date);
  const qb = cnyPerUnit(q, base);
  const qd = cnyPerUnit(q, display);
  return (qb && qd) ? qb / qd : 1;
}
// 服务端聚合：按（日期 × 收/支）汇总基准币金额，只回日汇总。
// 回传量 ∝ 有记账的天数（一年 ≤ 730 行），与记录条数无关；分批翻页防天数极多。
async function aggregateDaily(bookId) {
  const $ = _.aggregate;
  const out = [];
  const step = 1000;
  for (let skip = 0; skip < 100000; skip += step) {
    const r = await db.collection('records').aggregate()
      .match({ bookId })
      .group({ _id: { date: '$date', type: '$type' }, total: $.sum('$amountConverted') })
      .sort({ '_id.date': 1 })
      .skip(skip).limit(step)
      .end();
    const rows = r.list || [];
    rows.forEach((x) => out.push({ date: x._id.date, type: x._id.type, total: x.total }));
    if (rows.length < step) break;
  }
  return out;
}

// ============================== book ==============================
const book = {
  async list(_p, ctx) {
    const ms = await db.collection('members').where({ openid: ctx.openid, status: _.neq('removed') }).get();
    const bookIds = ms.data.map((m) => m.bookId);
    if (!bookIds.length) return [];
    const bs = await db.collection('books').where({ _id: _.in(bookIds) }).get();
    const roleBy = {};
    ms.data.forEach((m) => { roleBy[m.bookId] = m.role; });
    const user = await getUser(ctx.openid);
    const defaultId = user && user.defaultBookId;
    return bs.data.map((b) => ({
      bookId: b._id, name: b.name, type: b.type, typeLabel: b.type === 'split' ? '分账账本' : '共享账本',
      baseCurrency: b.baseCurrency, myRole: roleBy[b._id], memberCount: b.memberCount || 0,
      isDefault: b._id === defaultId, isCurrent: b._id === defaultId,
    }));
  },

  async getCurrent(_p, ctx) {
    const user = await ensureUser(ctx.openid, ctx.channel);
    // 校验某账本对我仍有效：账本存在 且 我仍是成员（getMember 已过滤被移除）
    const tryBook = async (id) => {
      if (!id) return null;
      const b = await db.collection('books').doc(id).get().catch(() => null);
      if (!b || !b.data) return null;
      const member = await getMember(id, ctx.openid);
      if (!member) return null;
      return { bookId: id, data: b.data, member };
    };
    // 默认账本失效（被解散/被移出/已退出）→ 自动回退到成员表里的下一个有效账本，
    // 并把修正结果落库；只有真的一个账本都没有了才返回 null（前端才进建账引导）
    let hit = await tryBook(user.defaultBookId);
    let fallback = false; // 原默认账本失效且回退成功：前端据此 toast 告知，避免「账本静默变了」
    if (!hit) {
      const m = await db.collection('members')
        .where({ openid: ctx.openid, status: _.neq('removed') })
        .limit(10).get().catch(() => ({ data: [] }));
      for (const row of (m.data || [])) {
        hit = await tryBook(row.bookId);
        if (hit) break;
      }
      fallback = !!(hit && user.defaultBookId); // 首次使用（无默认）不算回退
      const fixed = hit ? hit.bookId : '';
      if (fixed !== (user.defaultBookId || '')) {
        db.collection('users').doc(ctx.openid).update({ data: { defaultBookId: fixed } }).catch(() => {});
      }
    }
    if (!hit) return null;
    return {
      bookId: hit.bookId, name: hit.data.name, type: hit.data.type, baseCurrency: hit.data.baseCurrency,
      displayCurrency: displayCurrencyOf(user, hit.bookId, hit.data.baseCurrency),
      myRole: hit.member.role,
      fallback,
    };
  },

  async create(p, ctx) {
    // 账本类型走 bookType（避免与路由字段 type 冲突）
    const bookType = p.bookType === 'split' ? 'split' : 'share';
    if (!p.name || !p.baseCurrency) throw new AppError('INVALID_PARAM', '缺少账本参数');
    await ensureCollections();
    const add = await db.collection('books').add({ data: {
      name: p.name, type: bookType, baseCurrency: p.baseCurrency, ownerOpenid: ctx.openid, memberCount: 1,
      channel: ctx.channel, // 创建渠道（develop/trial/release）：账本级打标，整棵数据树随 bookId 可追溯、可清理
      createdAt: db.serverDate(),
    } });
    const bookId = add._id;
    const user = await ensureUser(ctx.openid, ctx.channel);
    await db.collection('members').add({ data: {
      bookId, openid: ctx.openid, avatarColor: user.avatarColor,
      role: 'owner', joinedAt: db.serverDate(), status: 'active',
    } });
    // 新建账本立即设为当前默认，用户建完回首页即看到新账本
    await db.collection('users').doc(ctx.openid).update({ data: { defaultBookId: bookId } });
    await seedDefaultCategories(bookId); // 注入默认分类
    return { bookId };
  },

  async update(p, ctx) {
    const m = await requireMember(p.bookId, ctx.openid); requireRole(m, 'admin');
    await db.collection('books').doc(p.bookId).update({ data: { name: p.name } });
    return { ok: true };
  },

  async setDefault(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    await db.collection('users').doc(ctx.openid).update({ data: { defaultBookId: p.bookId } });
    return { ok: true };
  },

  async dissolve(p, ctx) {
    const m = await requireMember(p.bookId, ctx.openid); requireRole(m, 'owner');
    await dissolveBook(p.bookId);
    return { ok: true };
  },
};

// ============================== member ==============================
const member = {
  async list(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const [r, mMap] = await Promise.all([
      db.collection('members').where({ bookId: p.bookId, status: _.neq('removed') }).get(),
      membersMap(p.bookId),
    ]);
    return r.data.map((m) => {
      const v = mMap[m.openid] || {};
      return {
        openid: m.openid, name: v.name, avatarInitial: v.initial, avatarColor: v.color, avatarFileID: v.avatarFileID || '',
        role: m.role, joinedAt: m.joinedAt, isMe: m.openid === ctx.openid,
      };
    });
  },
  async invite(p, ctx) {
    const m = await requireMember(p.bookId, ctx.openid); requireRole(m, 'admin');
    const b = await db.collection('books').doc(p.bookId).get();
    return { inviteToken: p.bookId, bookName: b.data ? b.data.name : '账本', expireAt: null };
  },
  // 通过分享卡片加入账本。邀请人可在分享时指定权限（仅 rw/ro，admin 不允许经链接授予）；
  // 加入后把该账本设为默认——用户点邀请卡的意图就是去这个账本
  async join(p, ctx) {
    const b = await db.collection('books').doc(p.bookId).get().catch(() => null);
    if (!b || !b.data) throw new AppError('NOT_FOUND', '账本不存在或已解散');
    const u = await ensureUser(ctx.openid, ctx.channel);
    const existing = await getMember(p.bookId, ctx.openid);
    if (!existing) {
      const role = p.role === 'ro' ? 'ro' : 'rw';
      await db.collection('members').add({ data: {
        bookId: p.bookId, openid: ctx.openid, avatarColor: u.avatarColor,
        role, joinedAt: db.serverDate(), status: 'active',
      } });
      await db.collection('books').doc(p.bookId).update({ data: { memberCount: _.inc(1) } }).catch(() => {});
    }
    await db.collection('users').doc(ctx.openid).update({ data: { defaultBookId: p.bookId } }).catch(() => {});
    return { ok: true, bookId: p.bookId, name: b.data.name, already: !!existing, registered: !!u.registered };
  },
  async updateRole(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid); requireRole(me, 'admin');
    const target = await getMember(p.bookId, p.openid);
    if (!target) throw new AppError('NOT_FOUND', '成员不存在');
    if (target.role === 'owner') throw new AppError('NO_PERMISSION', '不能修改 owner');
    if ((p.role === 'admin' || target.role === 'admin') && me.role !== 'owner') throw new AppError('NO_PERMISSION', '仅 owner 可任命/取消 admin');
    await db.collection('members').doc(target._id).update({ data: { role: p.role } });
    return { ok: true };
  },
  async remove(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid); requireRole(me, 'admin');
    const target = await getMember(p.bookId, p.openid);
    if (!target) throw new AppError('NOT_FOUND', '成员不存在');
    if (target.role === 'owner') throw new AppError('NO_PERMISSION', '不能移除 owner');
    if (target.role === 'admin' && me.role !== 'owner') throw new AppError('NO_PERMISSION', '仅 owner 可移除 admin');
    await db.collection('members').doc(target._id).update({ data: { status: 'removed' } });
    return { ok: true };
  },
  // 修改「我」在某账本内的名字（仅覆盖本账本，不影响全局昵称）
  async rename(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid);
    const name = (p.name || '').trim().slice(0, 20);
    if (!name) throw new AppError('INVALID_PARAM', '名字不能为空');
    await db.collection('members').doc(me._id).update({ data: { nameOverride: name } });
    return { ok: true };
  },
};

// ============================== category ==============================
const category = {
  async list(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const r = await db.collection('categories').where({ bookId: p.bookId, kind: p.kind || 'expense', disabled: _.neq(true) }).get();
    const all = r.data.sort((a, b) => (a.order || 0) - (b.order || 0));
    const level1 = all.filter((c) => !c.parentId);
    return level1.map((c) => ({
      categoryId: c._id, name: c.name, icon: c.icon || 'dots',
      children: all.filter((s) => s.parentId === c._id).map((s) => ({ categoryId: s._id, name: s.name })),
    }));
  },
  async create(p, ctx) {
    // 新增分类：读写(rw)及以上即可（记账时可随手加）
    const m = await requireMember(p.bookId, ctx.openid); requireRole(m, 'rw');
    const add = await db.collection('categories').add({ data: {
      bookId: p.bookId, kind: p.kind, parentId: p.parentId || null, name: p.name, icon: p.icon || null, order: p.order || 99, disabled: false,
    } });
    return { categoryId: add._id };
  },
  async update(p, ctx) {
    const m = await requireMember(p.bookId, ctx.openid); requireRole(m, 'admin');
    const data = {}; if (p.name != null) data.name = p.name; if (p.order != null) data.order = p.order;
    await db.collection('categories').doc(p.categoryId).update({ data });
    return { ok: true };
  },
  async disable(p, ctx) {
    // 停用分类：读写及以上（与新增对称，可随手删）。历史记录仍显示原分类名。
    const m = await requireMember(p.bookId, ctx.openid); requireRole(m, 'rw');
    await db.collection('categories').doc(p.categoryId).update({ data: { disabled: true } });
    return { ok: true };
  },
};

// ============================== record ==============================
const record = {
  async list(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    // 按「天」分页：每页 pageSize 个记账日（整天取，保证每日分组与合计完整），page 从 0 起
    const pageSize = Math.min(60, Math.max(5, Number(p.pageSize) || 20));
    const page = Math.max(0, Number(p.page) || 0);
    const bk = await db.collection('books').doc(p.bookId).get().catch(() => null);
    const base = (bk && bk.data && bk.data.baseCurrency) || 'CNY';
    const display = p.currency || base;      // 前端传来的展示币种
    // 可选筛选（统计钻取用）：日期范围 / 收支类型 / 顶级分类（自动包含其全部子分类）
    const cMap = await categoriesMap(p.bookId);
    const match = { bookId: p.bookId };
    if (p.dateFrom && p.dateTo) match.date = _.gte(p.dateFrom).and(_.lte(p.dateTo));
    else if (p.dateFrom) match.date = _.gte(p.dateFrom);
    else if (p.dateTo) match.date = _.lte(p.dateTo);
    // 收支筛选走独立字段 recordType（p.type 是路由字段，不能复用）
    if (p.recordType === 'income' || p.recordType === 'expense') match.type = p.recordType;
    // 成员维度钻取：按付款人 / 记录人过滤
    if (p.payerOpenid) match.payerOpenid = p.payerOpenid;
    if (p.recorderOpenid) match.recorderOpenid = p.recorderOpenid;
    if (p.categoryTopId) {
      if (p.categoryTopId === '_none') {
        match.categoryId = null; // 「未分类」聚合桶：categoryId 为空的记录
      } else {
        const catIds = [p.categoryTopId];
        Object.values(cMap).forEach((c) => { if (c.parentId === p.categoryTopId) catIds.push(c._id); });
        match.categoryId = catIds.length > 1 ? _.in(catIds) : p.categoryTopId;
      }
    }
    // 1) 聚合出本页的日期集合（走 bookId_date 索引）
    const dg = await db.collection('records').aggregate()
      .match(match)
      .group({ _id: '$date' })
      .sort({ _id: -1 })
      .skip(page * pageSize)
      .limit(pageSize + 1)   // 多取 1 个探测是否还有下一页
      .end();
    const dateRows = dg.list || [];
    const hasMore = dateRows.length > pageSize;
    const dates = dateRows.slice(0, pageSize).map((x) => x._id);
    if (!dates.length) {
      return { groups: [], hasMore: false, page, displayCurrency: display, summary: p.withSummary ? { income: 0, expense: 0, count: 0 } : undefined };
    }
    // 2) 取这些日期的记录与元数据（沿用筛选条件，日期改为本页集合）
    const [rr, mMap, rateIndex] = await Promise.all([
      db.collection('records').where({ ...match, date: _.in(dates) })
        .orderBy('date', 'desc').orderBy('createdAt', 'desc').limit(1000).get(),
      membersMap(p.bookId), loadRateIndex(),
    ]);
    const records = rr.data;
    // 筛选合计（钻取页摘要用）：与图表同口径（按日聚合 × 当日汇率），跨全部页
    let summary;
    if (p.withSummary) {
      const $ = _.aggregate;
      const srows = [];
      for (let skip = 0; skip < 100000; skip += 1000) {
        const r = await db.collection('records').aggregate().match(match)
          .group({ _id: { date: '$date', type: '$type' }, total: $.sum('$amountConverted'), count: $.sum(1) })
          .skip(skip).limit(1000).end();
        const list = r.list || [];
        list.forEach((x) => srows.push({ date: x._id.date, type: x._id.type, total: x.total, count: x.count }));
        if (list.length < 1000) break;
      }
      let ti = 0, te = 0, cnt = 0;
      srows.forEach((x) => {
        const v = x.total * dayFactor(rateIndex, x.date, base, display);
        if (x.type === 'income') ti += v; else te += v;
        cnt += x.count;
      });
      summary = { income: round2(ti), expense: round2(te), count: cnt };
    }
    const groupsMap = {};
    const order = [];
    records.forEach((rec) => {
      if (!groupsMap[rec.date]) { groupsMap[rec.date] = { date: rec.date, total: 0, items: [] }; order.push(rec.date); }
      const g = groupsMap[rec.date];
      const conv = recToDisplay(rec, display, quotesAt(rateIndex, rec.date)); // 按记录当日汇率换算
      const signed = rec.type === 'income' ? conv : -conv;
      g.total = round2(g.total + signed);
      const rec2 = mMap[rec.recorderOpenid] || {};
      const pay = mMap[rec.payerOpenid] || {};
      const top = topCategory(cMap, rec.categoryId);
      g.items.push({
        recordId: rec._id, type: rec.type, title: rec.title || rec.categoryPath,
        amountConverted: conv, currency: rec.currency, originalAmount: rec.amount,
        isForeign: rec.currency !== display, date: rec.date, // 仅当原币≠展示币才算外币
        recorderName: rec2.name || '', recorderInitial: rec2.initial || '', recorderColor: rec2.color || '#00ccf9', recorderAvatar: rec2.avatarFileID || '',
        payerName: pay.name || '', sameActor: rec.recorderOpenid === rec.payerOpenid,
        payerInitial: pay.initial || '', payerColor: pay.color || '#00ccf9', payerAvatar: pay.avatarFileID || '',
        // 分账账本副行「XX 付款 · N 人分摊」用：0 = 仅付款人承担（treat）或非分账记录
        splitCount: rec.split && rec.split.mode !== 'treat' ? (rec.split.members || []).length : 0,
        categoryTopName: top.name, icon: top.icon,
      });
    });
    return { groups: order.map((d) => groupsMap[d]), hasMore, page, displayCurrency: display, summary };
  },

  async get(p, ctx) {
    const r = await db.collection('records').doc(p.recordId).get().catch(() => null);
    if (!r || !r.data) throw new AppError('NOT_FOUND', '记录不存在');
    const rec = r.data;
    const me = await requireMember(rec.bookId, ctx.openid);
    const [mMap, cMap, bk, u, rateIndex] = await Promise.all([
      membersMap(rec.bookId), categoriesMap(rec.bookId),
      db.collection('books').doc(rec.bookId).get().catch(() => null),
      getUser(ctx.openid), loadRateIndex(),
    ]);
    const base = (bk && bk.data && bk.data.baseCurrency) || rec.baseCurrency || 'CNY';
    const display = displayCurrencyOf(u, rec.bookId, base);
    const q = quotesAt(rateIndex, rec.date);
    const converted = recToDisplay(rec, display, q);
    // 记录当日的「原币 → 展示币」汇率：1 原币 = ? 展示币
    let rateOrigToDisplay = 1;
    if (rec.currency !== display) {
      if (rec.amount) rateOrigToDisplay = round6(converted / rec.amount);
      else { const qo = cnyPerUnit(q, rec.currency); const qd = cnyPerUnit(q, display); rateOrigToDisplay = (qo && qd) ? round6(qo / qd) : null; }
    }
    const isSplit = !!(bk && bk.data && bk.data.type === 'split');
    const rec2 = mMap[rec.recorderOpenid] || {};
    const pay = mMap[rec.payerOpenid] || {};
    const top = topCategory(cMap, rec.categoryId);
    const canEdit = rec.recorderOpenid === ctx.openid || me.role === 'admin' || me.role === 'owner';
    // 分账账本：分摊方式 + 参与成员（头像/名字），金额按展示币种口径
    let splitInfo = null;
    if (isSplit && rec.type === 'expense') {
      const sp = rec.split || { mode: 'even', members: [] };
      const list = (sp.members || []).map((m) => {
        const v = mMap[m.openid] || {};
        return { name: v.name || '成员', initial: v.initial || '?', color: v.color || '#97a7b7', avatarFileID: v.avatarFileID || '' };
      });
      const n = list.length || 1;
      const dsym = CUR_SYMBOL[display] || display + ' ';
      const modeLabel = (sp.mode === 'treat' || !list.length)
        ? `仅${pay.name || '付款人'}承担`
        : `${n} 人均摊 · 各 ${dsym}${round2(converted / n)}`;
      splitInfo = { modeLabel, members: list };
    }
    return {
      recordId: rec._id, type: rec.type, typeLabel: rec.type === 'income' ? '收入' : '支出', icon: top.icon, isSplit,
      categoryId: rec.categoryId, payerOpenid: rec.payerOpenid, split: rec.split || null,
      title: rec.title || rec.categoryPath, category: rec.categoryPath, date: rec.date,
      amount: rec.amount, currency: rec.currency,
      displayCurrency: display, rate: rateOrigToDisplay, amountConverted: converted,
      isForeign: rec.currency !== display, note: rec.note || '', images: rec.images || [],
      recorder: { name: rec2.name, initial: rec2.initial, color: rec2.color, avatarFileID: rec2.avatarFileID || '' },
      payer: { name: pay.name || '', initial: pay.initial, color: pay.color, avatarFileID: pay.avatarFileID || '' },
      splitInfo,
      canEdit, canDelete: canEdit,
    };
  },

  async create(p, ctx) {
    const bookId = p.bookId; const payload = p.payload || {};
    const me = await requireMember(bookId, ctx.openid); requireRole(me, 'rw');
    const b = await db.collection('books').doc(bookId).get();
    const base = b.data.baseCurrency;
    let rate;
    try { rate = (await getRate(payload.date, base, payload.currency)).rate; }
    catch (e) { if (payload.rate > 0) rate = payload.rate; else throw e; } // 兜底用前端已展示的汇率
    // 固化精度 6 位：round2 到基准币的「分」会在小面值展示币上放大回来
    // （1000 ISK → €6.29 → 换回 1000.78），展示层各出口自会 round2
    const amountConverted = round6(payload.amount * rate);
    const cMap = await categoriesMap(bookId);
    const cat = cMap[payload.categoryId];
    let categoryPath = '';
    if (cat) categoryPath = cat.parentId && cMap[cat.parentId] ? `${cMap[cat.parentId].name} / ${cat.name}` : cat.name;
    // 记录人恒为当前用户；共享账本不区分付款人（=记录人），仅分账账本才用 payer
    const recorderOpenid = ctx.openid;
    const payerOpenid = b.data.type === 'split' ? (payload.payerOpenid || ctx.openid) : recorderOpenid;
    const doc = {
      bookId, type: payload.type, title: payload.title || categoryPath,
      amount: payload.amount, currency: payload.currency, rate, baseCurrency: base, amountConverted,
      categoryId: payload.categoryId, categoryPath, date: payload.date, note: payload.note || '', images: payload.images || [],
      recorderOpenid, payerOpenid,
      split: b.data.type === 'split' ? (payload.split || null) : null,
      createdAt: db.serverDate(), createdBy: ctx.openid,
      updatedAt: db.serverDate(), updatedBy: ctx.openid,
    };
    const add = await db.collection('records').add({ data: doc });
    return { recordId: add._id };
  },

  async update(p, ctx) {
    const r = await db.collection('records').doc(p.recordId).get().catch(() => null);
    if (!r || !r.data) throw new AppError('NOT_FOUND', '记录不存在');
    const rec = r.data;
    const me = await requireMember(rec.bookId, ctx.openid);
    const canEdit = rec.recorderOpenid === ctx.openid || me.role === 'admin' || me.role === 'owner';
    if (!canEdit) throw new AppError('NO_PERMISSION', '只能修改自己的记录');
    const payload = p.payload || {};
    const bk = await db.collection('books').doc(rec.bookId).get().catch(() => null);
    const isSplit = !!(bk && bk.data && bk.data.type === 'split');
    const data = { updatedAt: db.serverDate(), updatedBy: ctx.openid };
    ['type', 'note', 'categoryId', 'title', 'images', 'date', 'amount', 'currency'].forEach((k) => {
      if (payload[k] !== undefined) data[k] = payload[k];
    });
    // 分账账本才允许改付款人/分摊；共享账本付款人恒等记录人
    if (isSplit) {
      if (payload.payerOpenid !== undefined) data.payerOpenid = payload.payerOpenid;
      if (payload.split !== undefined) data.split = payload.split;
    } else {
      data.payerOpenid = rec.recorderOpenid; data.split = null;
    }
    // 分类变了同步 categoryPath 快照
    if (payload.categoryId !== undefined) {
      const cMap = await categoriesMap(rec.bookId);
      const cat = cMap[payload.categoryId];
      data.categoryPath = cat ? (cat.parentId && cMap[cat.parentId] ? `${cMap[cat.parentId].name} / ${cat.name}` : cat.name) : rec.categoryPath;
    }
    if (payload.amount !== undefined || payload.currency !== undefined || payload.date !== undefined) {
      const curCode = payload.currency || rec.currency; const date = payload.date || rec.date; const amt = payload.amount != null ? payload.amount : rec.amount;
      let rate;
      try { rate = (await getRate(date, rec.baseCurrency, curCode)).rate; }
      catch (e) { if (payload.rate > 0) rate = payload.rate; else throw e; }
      data.rate = rate; data.amountConverted = round6(amt * rate); // 精度同 create：6 位固化
    }
    await db.collection('records').doc(p.recordId).update({ data });
    return { ok: true };
  },

  async delete(p, ctx) {
    const r = await db.collection('records').doc(p.recordId).get().catch(() => null);
    if (!r || !r.data) throw new AppError('NOT_FOUND', '记录不存在');
    const rec = r.data;
    const me = await requireMember(rec.bookId, ctx.openid);
    const canDel = rec.recorderOpenid === ctx.openid || me.role === 'admin' || me.role === 'owner';
    if (!canDel) throw new AppError('NO_PERMISSION', '只能删除自己的记录');
    await db.collection('records').doc(p.recordId).remove();
    return { ok: true };
  },
};

// ============================== rate ==============================
const rate = {
  async getDaily(p) {
    const base = p.base || 'CNY';
    // 快照统一以 CNY 为基准；请求任意 base 时按 CNY 枢轴换算出完整 quotes，
    // 否则非 CNY 基准账本只会拿到 { base: 1 }，币种选择/切换/汇率全废。
    let doc = (await db.collection('rates').where({ date: p.date, base: 'CNY' }).get()).data[0];
    let isFallback = false;
    if (!doc) {
      doc = (await db.collection('rates').where({ base: 'CNY', date: _.lte(p.date) }).orderBy('date', 'desc').limit(1).get()).data[0];
      isFallback = true;
    }
    if (!doc) { const q = await latestCnyQuotes(); if (q) { doc = { date: p.date, quotes: q }; isFallback = true; } }
    if (!doc) return { date: p.date, base, quotes: { [base]: 1 }, isFallback: true };
    const cny = doc.quotes || {};
    if (base === 'CNY') return { date: doc.date, base, quotes: cny, isFallback };
    const qb = cny[base];
    if (!qb) return { date: doc.date, base, quotes: { [base]: 1 }, isFallback: true };
    const quotes = {};
    Object.keys(cny).forEach((c) => { quotes[c] = rateSig(cny[c] / qb); });
    quotes[base] = 1;
    return { date: doc.date, base, quotes, isFallback };
  },
  // 实际拉取逻辑（供手动按钮与每日定时触发器共用）
  async _refresh() {
    const { date, quotes } = await fetchAndStoreCnyQuotes();
    return { date, count: Object.keys(quotes).length };
  },
  // 手动刷新（dev 工具，设置页按钮）
  async refresh(_p, ctx) {
    if (!isDevUser(ctx.openid)) throw new AppError('NO_PERMISSION', '非开发者禁止刷新汇率');
    return rate._refresh();
  },
};

// ============================== stats ==============================
// 最近 n 个自然月（含本月），返回 [{ ym:'YYYY-MM', label:'M月' }]
function lastNMonths(n) {
  let [y, m] = relDate(0).split('-').map(Number);
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.unshift({ ym: `${y}-${String(m).padStart(2, '0')}`, label: `${m}月` });
    m--; if (m < 1) { m = 12; y--; }
  }
  return arr;
}
// 从 firstYm（最早记账月）到当月的连续月序列；不足 12 个月补齐为近 12 月（保证区间 chips 可用）
function monthsSince(firstYm) {
  const cur = relDate(0).slice(0, 7);
  if (!firstYm || firstYm > cur) return lastNMonths(12);
  let [y, m] = firstYm.split('-').map(Number);
  const [cy, cm] = cur.split('-').map(Number);
  const arr = [];
  while (y < cy || (y === cy && m <= cm)) {
    arr.push({ ym: `${y}-${String(m).padStart(2, '0')}`, label: `${m}月` });
    m++; if (m > 12) { m = 1; y++; }
  }
  return arr.length < 12 ? lastNMonths(12) : arr;
}
const stats = {
  async _compute(bookId, ctx) {
    const [daily, b, u, rateIndex] = await Promise.all([
      aggregateDaily(bookId), db.collection('books').doc(bookId).get(),
      ctx ? getUser(ctx.openid) : Promise.resolve(null), loadRateIndex(),
    ]);
    const base = b.data.baseCurrency;
    const display = displayCurrencyOf(u, bookId, base);
    const curMonth = relDate(0).slice(0, 7); // 本月（北京时间）
    let mIncome = 0, mExpense = 0, tIncome = 0, tExpense = 0;
    daily.forEach((row) => {
      const v = row.total * dayFactor(rateIndex, row.date, base, display); // 按该日汇率
      if (row.type === 'income') { tIncome += v; if (monthOf(row.date) === curMonth) mIncome += v; }
      else { tExpense += v; if (monthOf(row.date) === curMonth) mExpense += v; }
    });
    const [y, m] = curMonth.split('-');
    return {
      displayCurrency: display,
      overview: { income: round2(mIncome), expense: round2(mExpense), balance: round2(mIncome - mExpense), monthLabel: `${y} 年 ${parseInt(m, 10)} 月` },
      total: { income: round2(tIncome), expense: round2(tExpense), balance: round2(tIncome - tExpense), since: monthOf(b.data.createdAt instanceof Date ? b.data.createdAt.toISOString() : b.data.createdAt) },
    };
  },
  async getMonthlySummary(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const c = await stats._compute(p.bookId, ctx);
    return { ...c.overview, displayCurrency: c.displayCurrency };
  },
  async getDashboard(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    return stats._compute(p.bookId, ctx);
  },
  // 图表原始数据集（均换算到展示币种）：本月/累计饼 + 近30日逐日 + 建账以来全部逐月。
  // 前端按图表区间/所选月份自行切片，增删卡片、改区间、切月份均无需再请求后端。
  async getChartData(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const [daily, b, u, rateIndex] = await Promise.all([
      aggregateDaily(p.bookId), db.collection('books').doc(p.bookId).get(), getUser(ctx.openid), loadRateIndex(),
    ]);
    const base = b.data.baseCurrency;
    const display = displayCurrencyOf(u, p.bookId, base);
    const curMonth = relDate(0).slice(0, 7);
    const days = []; for (let i = 29; i >= 0; i--) days.push(relDate(-i)); // 近 30 日
    const dMap = {}; days.forEach((d) => { dMap[d] = { date: d, income: 0, expense: 0 }; });
    // 全部历史月份（daily 按日期升序，取最早记账月）
    const months = monthsSince(daily.length ? monthOf(daily[0].date) : null);
    const mMap = {}; months.forEach((x) => { mMap[x.ym] = { income: 0, expense: 0 }; });
    let mIncome = 0, mExpense = 0, tIncome = 0, tExpense = 0;
    daily.forEach((row) => {
      const v = row.total * dayFactor(rateIndex, row.date, base, display); const ym = monthOf(row.date);
      if (row.type === 'income') {
        tIncome += v; if (ym === curMonth) mIncome += v;
        if (mMap[ym]) mMap[ym].income += v; if (dMap[row.date]) dMap[row.date].income += v;
      } else {
        tExpense += v; if (ym === curMonth) mExpense += v;
        if (mMap[ym]) mMap[ym].expense += v; if (dMap[row.date]) dMap[row.date].expense += v;
      }
    });
    const [, mm] = curMonth.split('-');
    return {
      displayCurrency: display,
      monthLabel: `${parseInt(mm, 10)} 月`,
      curMonth,
      firstMonth: months[0].ym, // 月份选择器可选下限
      monthPie: { income: round2(mIncome), expense: round2(mExpense) },
      totalPie: { income: round2(tIncome), expense: round2(tExpense) },
      daily: days.map((d) => ({ date: d, label: d.slice(5).replace('-', '/'), income: round2(dMap[d].income), expense: round2(dMap[d].expense) })),
      monthly: months.map((x) => ({ ym: x.ym, label: x.label, income: round2(mMap[x.ym].income), expense: round2(mMap[x.ym].expense) })),
    };
  },

  // 某月按「顶级分类」聚合的收支占比（含子分类细分与笔数）。
  // 口径与其他图表一致：group by (日期×分类×类型) 后按记录当日汇率换算到展示币种再归并，
  // 子分类计入其顶级；已停用/已删分类的历史记录仍按原分类聚合。
  async getCategoryData(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const month = /^\d{4}-\d{2}$/.test(p.month || '') ? p.month : relDate(0).slice(0, 7);
    const [b, u, cMap, rateIndex] = await Promise.all([
      db.collection('books').doc(p.bookId).get(), getUser(ctx.openid), categoriesMap(p.bookId), loadRateIndex(),
    ]);
    const base = b.data.baseCurrency;
    const display = displayCurrencyOf(u, p.bookId, base);
    const $ = _.aggregate;
    const rows = [];
    const step = 1000;
    for (let skip = 0; skip < 100000; skip += step) {
      const r = await db.collection('records').aggregate()
        .match({ bookId: p.bookId, date: _.gte(`${month}-01`).and(_.lte(`${month}-31`)) })
        .group({ _id: { date: '$date', categoryId: '$categoryId', type: '$type' }, total: $.sum('$amountConverted'), count: $.sum(1) })
        .skip(skip).limit(step)
        .end();
      const list = r.list || [];
      list.forEach((x) => rows.push({ date: x._id.date, categoryId: x._id.categoryId, type: x._id.type, total: x.total, count: x.count }));
      if (list.length < step) break;
    }
    const buckets = { expense: {}, income: {} };
    const totals = { expense: 0, income: 0 };
    rows.forEach((r0) => {
      const kind = r0.type === 'income' ? 'income' : 'expense';
      const v = r0.total * dayFactor(rateIndex, r0.date, base, display);
      const c = cMap[r0.categoryId];
      const top = c ? (c.parentId ? cMap[c.parentId] || c : c) : null;
      const topId = top ? top._id : '_none';
      const map = buckets[kind];
      if (!map[topId]) map[topId] = { categoryId: topId, name: top ? top.name : '未分类', icon: (top && top.icon) || 'dots', total: 0, count: 0, subs: {} };
      const bk = map[topId];
      bk.total += v; bk.count += r0.count;
      totals[kind] += v;
      const subName = c ? c.name : '未分类'; // 顶级直记时 sub 即顶级名
      if (!bk.subs[subName]) bk.subs[subName] = { name: subName, total: 0, count: 0 };
      bk.subs[subName].total += v; bk.subs[subName].count += r0.count;
    });
    const pack = (kind) => ({
      total: round2(totals[kind]),
      cats: Object.values(buckets[kind]).map((c) => ({
        categoryId: c.categoryId, name: c.name, icon: c.icon,
        total: round2(c.total), count: c.count,
        percent: totals[kind] > 0 ? Math.round((c.total / totals[kind]) * 1000) / 10 : 0,
        subs: Object.values(c.subs).map((s) => ({ name: s.name, total: round2(s.total), count: s.count })).sort((a, b2) => b2.total - a.total),
      })).sort((a, b2) => b2.total - a.total),
    });
    return { displayCurrency: display, month, expense: pack('expense'), income: pack('income') };
  },

  // 某月按「成员」聚合（成员维度统计卡，PRD P2）。
  // kind=expense 按付款人（scope=paid）或按应摊（scope=share，分账账本）；kind=income 恒按记录人。
  // 口径与其他图表一致：逐笔按记录当日汇率换算到该用户该账本的展示币种；应摊走 splitShares（与 settle 同源）。
  async getMemberData(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const month = /^\d{4}-\d{2}$/.test(p.month || '') ? p.month : relDate(0).slice(0, 7);
    const kind = p.kind === 'income' ? 'income' : 'expense';
    const scope = kind === 'expense' && p.scope === 'share' ? 'share' : 'paid';
    const [b, u, mMap, rateIndex] = await Promise.all([
      db.collection('books').doc(p.bookId).get(), getUser(ctx.openid), membersMap(p.bookId), loadRateIndex(),
    ]);
    const base = b.data.baseCurrency;
    const display = displayCurrencyOf(u, p.bookId, base);
    // 该月该类型全量记录（月内条数有限，分页取全；share 需要 split 数组，无法走聚合 group）
    const recs = [];
    for (let skip = 0; skip < 100000; skip += 1000) {
      const r = await db.collection('records')
        .where({ bookId: p.bookId, type: kind, date: _.gte(`${month}-01`).and(_.lte(`${month}-31`)) })
        .field({ amountConverted: 1, date: 1, payerOpenid: 1, recorderOpenid: 1, split: 1 })
        .skip(skip).limit(1000).get();
      recs.push(...(r.data || []));
      if ((r.data || []).length < 1000) break;
    }
    const sums = {}, counts = {};
    const add = (o, v) => { if (!o) return; sums[o] = (sums[o] || 0) + v; counts[o] = (counts[o] || 0) + 1; };
    let total = 0;
    recs.forEach((r0) => {
      const f = dayFactor(rateIndex, r0.date, base, display);
      if (kind === 'income') { const v = r0.amountConverted * f; add(r0.recorderOpenid, v); total += v; return; }
      if (scope === 'paid') { const v = r0.amountConverted * f; add(r0.payerOpenid, v); total += v; return; }
      const sh = splitShares(r0);
      Object.keys(sh).forEach((o) => { const v = sh[o] * f; add(o, v); total += v; });
    });
    const members = Object.keys(sums).map((o) => {
      const m = mMap[o];
      return {
        openid: o,
        name: m ? m.name : '已退出成员',
        initial: m ? m.initial : '退',
        color: m ? m.color : '#97a7b7',
        avatarFileID: (m && m.avatarFileID) || '',
        isMe: o === ctx.openid,
        total: round2(sums[o]), count: counts[o],
        percent: total > 0 ? Math.round((sums[o] / total) * 1000) / 10 : 0,
      };
    }).sort((a, b2) => b2.total - a.total);
    return { displayCurrency: display, month, kind, scope, total: round2(total), members };
  },
};

// ============================== layout ==============================
const DEFAULT_LAYOUT = ['monthPie', 'weekExpense', 'yearInOut', 'totalPie'];
const layout = {
  async get(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const id = `${p.bookId}_${ctx.openid}`;
    const r = await db.collection('chartLayouts').doc(id).get().catch(() => null);
    return { order: (r && r.data && r.data.order) || DEFAULT_LAYOUT.slice() };
  },
  async save(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const id = `${p.bookId}_${ctx.openid}`;
    await db.collection('chartLayouts').doc(id).set({ data: {
      bookId: p.bookId, openid: ctx.openid, order: p.order || [], updatedAt: db.serverDate(),
    } });
    return { ok: true };
  },
};

// ============================== ai ==============================
// 相对今天（北京时间 UTC+8）偏移 offsetDays 天的日期字符串
function relDate(offsetDays) {
  const bj = new Date(Date.now() + 8 * 3600 * 1000);
  bj.setUTCDate(bj.getUTCDate() + (offsetDays || 0));
  return bj.toISOString().slice(0, 10);
}
// 中文数字 → 数值：三十五=35、一百二十三=123、两千=2000、一千五=1500（省略式）、两百零五=205
function cnNumber(str) {
  const D = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0, section = 0, num = 0, lastUnit = 1, sawZero = false;
  for (const ch of String(str || '')) {
    if (D[ch] != null) { if (ch === '零') sawZero = true; else num = D[ch]; }
    else if (ch === '十') { section += (num || 1) * 10; lastUnit = 10; num = 0; }
    else if (ch === '百') { section += num * 100; lastUnit = 100; num = 0; }
    else if (ch === '千') { section += num * 1000; lastUnit = 1000; num = 0; }
    else if (ch === '万') { total += (section + num) * 10000; section = 0; num = 0; lastUnit = 10000; sawZero = false; }
  }
  if (num) {
    // 省略式：一千五=1500、三百二=320（末位数字乘上一单位的 1/10）；出现「零」则按个位（两百零五=205）
    if (!sawZero && lastUnit >= 100) section += num * (lastUnit / 10);
    else section += num;
  }
  return total + section;
}

// 关键词解析（无模型的本地规则）：金额（阿拉伯/中文/块角）、收支、分类、日期、币种。
// 顺序要点：先抽日期并从文本中挖掉（防「3号打车35」把 3 当金额），再抽币种，最后抽金额。
function parseNL(text) {
  const t = text || '';
  let w = t; // 工作副本：日期片段会被挖掉

  // —— 日期 ——（默认今天；只认过去/近未来的相对表达）
  let date = null;
  const today = relDate(0);
  const todayD = new Date(today + 'T00:00:00Z');
  const cut = (mm) => { w = w.replace(mm[0], ' '); };
  let mm;
  if ((mm = w.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日](?!元|币)/))) {
    // 7月3号 → 今年该日
    const y = today.slice(0, 4);
    date = `${y}-${String(mm[1]).padStart(2, '0')}-${String(mm[2]).padStart(2, '0')}`;
    cut(mm);
  } else if ((mm = w.match(/(?<![\d.])(\d{1,2})\s*[号日](?!元|币)/))) {
    // 3号 → 本月 3 号；比今天晚则回退到上个月
    const d = parseInt(mm[1], 10);
    const base = new Date(todayD);
    if (d > base.getUTCDate()) base.setUTCMonth(base.getUTCMonth() - 1);
    base.setUTCDate(d);
    date = base.toISOString().slice(0, 10);
    cut(mm);
  } else if ((mm = w.match(/(\d+)\s*天前/))) {
    date = relDate(-parseInt(mm[1], 10)); cut(mm);
  } else if ((mm = w.match(/(上+)?(?:周|星期|礼拜)([一二三四五六日天])/))) {
    const W = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
    const target = W[mm[2]];
    const todayW = todayD.getUTCDay();
    let back = (todayW - target + 7) % 7;           // 最近的那个周 X（今天即 0）
    back += 7 * (mm[1] ? mm[1].length : 0);          // 每个「上」再往前推一周
    date = relDate(-back); cut(mm);
  } else if (/大前天/.test(w)) { date = relDate(-3); w = w.replace('大前天', ' '); }
  else if (/前天/.test(w)) { date = relDate(-2); w = w.replace('前天', ' '); }
  else if (/昨天|昨晚/.test(w)) { date = relDate(-1); w = w.replace(/昨天|昨晚/, ' '); }
  else if (/后天/.test(w)) { date = relDate(2); w = w.replace('后天', ' '); }
  else if (/明天/.test(w)) { date = relDate(1); w = w.replace('明天', ' '); }
  if (!date) date = today;

  // —— 币种 ——（不写则跟随账本基准币；「¥」人民币/日元歧义，不认符号只认词）
  let cur = '';
  const CURS = [
    [/美元|美金|USD|\$/i, 'USD'], [/日元|日币|JPY/i, 'JPY'], [/欧元|EUR|€/i, 'EUR'],
    [/英镑|GBP|£/i, 'GBP'], [/港币|港元|HKD/i, 'HKD'], [/韩元|韩币|KRW/i, 'KRW'],
    [/泰铢|THB/i, 'THB'], [/新台币|台币|TWD/i, 'TWD'], [/澳元|AUD/i, 'AUD'],
    [/加元|CAD/i, 'CAD'], [/新加坡元|新币|SGD/i, 'SGD'],
  ];
  for (const [re2, code] of CURS) { if (re2.test(w)) { cur = code; w = w.replace(re2, ' '); break; } }

  // —— 金额 ——（顺序：X块Y → 阿拉伯数字 → 中文数字）
  let amt = 0;
  const D1 = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if ((mm = w.match(/(\d+(?:\.\d+)?)\s*[块元]\s*([\d一二两三四五六七八九])?\s*[毛角]?/))) {
    // 35块 / 35块5 / 35元3毛
    amt = parseFloat(mm[1]) + (mm[2] ? (D1[mm[2]] || parseInt(mm[2], 10) || 0) / 10 : 0);
  } else if ((mm = w.match(/([零一二两三四五六七八九十百千万]+)\s*[块元]\s*([\d一二两三四五六七八九])?\s*[毛角]?/))) {
    // 三十五块 / 三块五 / 两千块
    amt = cnNumber(mm[1]) + (mm[2] ? (D1[mm[2]] || parseInt(mm[2], 10) || 0) / 10 : 0);
  } else if ((mm = w.match(/([\d一二两三四五六七八九])\s*[毛角]/))) {
    // 五毛
    amt = (D1[mm[1]] || parseInt(mm[1], 10) || 0) / 10;
  } else if ((mm = w.match(/(\d+(?:\.\d+)?)/))) {
    amt = parseFloat(mm[1]);
  } else if ((mm = w.match(/([一二两三四五六七八九]?[十百千万][零一二两三四五六七八九十百千万]*)/))) {
    // 纯中文数字：必须含十/百/千/万（防「三明治」的「三」被当金额）
    amt = cnNumber(mm[1]);
  }

  // —— 收/支与分类 ——
  const isIncome = /工资|薪水|薪资|奖金|收入|红包|礼金|压岁钱|退款|报销|返现|理财|利息|分红|中奖|兼职|稿费|收租|收款|进账/.test(t);
  const type = isIncome ? 'income' : 'expense';
  let cat = isIncome ? '其他收入' : '其他';
  if (isIncome) {
    if (/工资|薪水|薪资/.test(t)) cat = '工资薪酬 / 工资';
    else if (/加班/.test(t)) cat = '工资薪酬 / 加班费';
    else if (/奖金|年终奖/.test(t)) cat = '工资薪酬 / 奖金';
    else if (/补贴/.test(t)) cat = '工资薪酬 / 补贴';
    else if (/兼职|稿费|接单|外快/.test(t)) cat = '兼职副业';
    else if (/基金/.test(t)) cat = '投资理财 / 基金';
    else if (/股票/.test(t)) cat = '投资理财 / 股票';
    else if (/理财|利息|分红/.test(t)) cat = '投资理财';
    else if (/收租|租金/.test(t)) cat = '租金经营 / 房租';
    else if (/压岁钱/.test(t)) cat = '人情往来 / 压岁钱';
    else if (/礼金/.test(t)) cat = '人情往来 / 礼金';
    else if (/红包/.test(t)) cat = '人情往来 / 红包';
    else if (/报销/.test(t)) cat = '报销退款 / 报销';
    else if (/返现/.test(t)) cat = '报销退款 / 返现';
    else if (/退款/.test(t)) cat = '报销退款 / 退款';
    else if (/中奖|彩票/.test(t)) cat = '奖励中奖 / 中奖';
  } else {
    if (/打车|滴滴|出租|网约车/.test(t)) cat = '交通 / 打车';
    else if (/地铁/.test(t)) cat = '交通 / 地铁';
    else if (/公交/.test(t)) cat = '交通 / 公交';
    else if (/加油|油费/.test(t)) cat = '交通 / 加油';
    else if (/停车/.test(t)) cat = '交通 / 停车';
    else if (/咖啡|奶茶|饮料|可乐|星巴克/.test(t)) cat = '餐饮 / 饮料';
    else if (/早餐|早饭/.test(t)) cat = '餐饮 / 早餐';
    else if (/午餐|午饭/.test(t)) cat = '餐饮 / 午餐';
    else if (/晚餐|晚饭|夜宵/.test(t)) cat = '餐饮 / 晚餐';
    else if (/外卖/.test(t)) cat = '餐饮 / 外卖';
    else if (/零食|小吃/.test(t)) cat = '餐饮 / 零食';
    else if (/饭|餐|吃/.test(t)) cat = '餐饮';
    else if (/超市|日用|纸巾/.test(t)) cat = '购物 / 日用';
    else if (/衣服|服饰|鞋|裤/.test(t)) cat = '购物 / 服饰';
    else if (/数码|手机|电脑|耳机/.test(t)) cat = '购物 / 数码';
    else if (/美妆|化妆|护肤/.test(t)) cat = '购物 / 美妆';
    else if (/买|购/.test(t)) cat = '购物';
    else if (/药|门诊|挂号|体检/.test(t)) cat = '医疗';
    else if (/电影|游戏|订阅|旅行|娱乐/.test(t)) cat = '娱乐';
    else if (/房租|水电|物业|家具/.test(t)) cat = '居家';
    else if (/书|课程|文具|学费/.test(t)) cat = '教育';
  }
  return { amt: round2(amt), cat, date, type, cur };
}

// 预填确认卡（自然语言 / 收据共用的卡片结构）
function draftCard(kind, draft, myName) {
  const sym = CUR_SYMBOL[draft.currency] || '';
  return { kind, state: 'pending', draft, rows: [
    { k: '类型', v: draft.type === 'income' ? '收入' : '支出' },
    { k: '金额', v: (sym || draft.currency + ' ') + Number(draft.amount).toFixed(2) },
    { k: '分类', v: draft.categoryText || '其他' },
    { k: '日期', v: draft.date },
    { k: '记录人', v: myName },
  ] };
}
// 「父 / 子」文字 → 分类 id（收/支各自集合内）：全路径 → 末级名 → 一级名；
// 找不到返回 null（AI 预填不自动建分类，入账后显示文字快照）
function resolveCategoryByText(cMap, kind, text) {
  const parts = String(text || '').split('/').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const cats = Object.values(cMap).filter((c) => ((c.kind === 'income' ? 'income' : 'expense') === kind) && c.disabled !== true);
  const topName = parts[0], leafName = parts[parts.length - 1];
  if (parts.length > 1) {
    const hit = cats.find((c) => c.parentId && c.name === leafName && cMap[c.parentId] && cMap[c.parentId].name === topName);
    if (hit) return hit._id;
  }
  const leaf = cats.find((c) => c.name === leafName) || cats.find((c) => c.name === topName);
  return leaf ? leaf._id : null;
}
// 账本分类表（给模型选分类用）：「餐饮(早餐/午餐/晚餐)；交通(打车/地铁)…」
function categoryTreeText(cMap, kind) {
  const cats = Object.values(cMap).filter((c) => ((c.kind === 'income' ? 'income' : 'expense') === kind) && c.disabled !== true);
  const tops = cats.filter((c) => !c.parentId).sort((a, b) => (a.order || 0) - (b.order || 0));
  return tops.map((t) => {
    const subs = cats.filter((c) => c.parentId === t._id).map((c) => c.name);
    return subs.length ? `${t.name}(${subs.join('/')})` : t.name;
  }).join('；');
}
function prevYm(ym) { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); }

// AI 用量额度开关：云函数环境变量 AI_FREE_QUOTA > 0 时启用「免费 N 次真实模型调用」限额；
// 未配置或 0 = 不限次且前端隐藏额度文案（当前默认）。之后额度扛不住时在控制台配 AI_FREE_QUOTA=50
// 即时生效，无需改代码重新部署。用量始终计数（users.aiUsage），关着也能观察消耗决定何时开。
const AI_FREE_QUOTA = Number(process.env.AI_FREE_QUOTA || 0);
// 大模型总开关：审核期/个人主体阶段设 AI_ENABLED=false → 全部请求走本地关键词解析，零模型调用
const AI_ENABLED = process.env.AI_ENABLED !== 'false';
async function aiQuota(openid) {
  const u = await getUser(openid);
  const used = (u && u.aiUsage) || 0;
  const paid = !!(u && u.aiPaid);
  const unlimited = paid || AI_FREE_QUOTA <= 0;
  return { used, paid, left: unlimited ? Infinity : Math.max(0, AI_FREE_QUOTA - used) };
}
function aiCountUse(openid) {
  return db.collection('users').doc(openid).update({ data: { aiUsage: _.inc(1) } }).catch(() => {});
}

// AI 数据包：只给聚合、不给逐笔——模型只能引用这些数字（防编造），token 也压到最小。
// 口径与统计页完全一致：日聚合 × 记录当日汇率系数，换算到用户展示币种。
async function buildAiPack(bookId, ctx) {
  const [daily, b, u, rateIndex, mMap] = await Promise.all([
    aggregateDaily(bookId), db.collection('books').doc(bookId).get(),
    getUser(ctx.openid), loadRateIndex(), membersMap(bookId),
  ]);
  const base = b.data.baseCurrency;
  const display = displayCurrencyOf(u, bookId, base);
  const curYm = relDate(0).slice(0, 7);
  // 逐月 + 累计
  const mAgg = {}; let tIn = 0, tEx = 0;
  daily.forEach((row) => {
    const v = row.total * dayFactor(rateIndex, row.date, base, display);
    const ym = monthOf(row.date);
    if (!mAgg[ym]) mAgg[ym] = { in: 0, ex: 0 };
    if (row.type === 'income') { mAgg[ym].in += v; tIn += v; } else { mAgg[ym].ex += v; tEx += v; }
  });
  const yms = Object.keys(mAgg).sort();
  // 近 30 日（只列有记账的日子）
  const from30 = relDate(-29);
  const dAgg = {};
  daily.forEach((row) => {
    if (row.date < from30) return;
    const v = row.total * dayFactor(rateIndex, row.date, base, display);
    if (!dAgg[row.date]) dAgg[row.date] = { in: 0, ex: 0 };
    if (row.type === 'income') dAgg[row.date].in += v; else dAgg[row.date].ex += v;
  });
  // 本月 + 上月分类聚合（口径复用统计页 getCategoryData）
  const [curCat, prevCat] = await Promise.all([
    stats.getCategoryData({ bookId, month: curYm }, ctx),
    stats.getCategoryData({ bookId, month: prevYm(curYm) }, ctx),
  ]);
  const catPack = (kd, withSubs) => (kd.cats || []).slice(0, 10).map((c) => {
    const o = { 分类: c.name, 金额: c.total, 笔数: c.count };
    if (withSubs && c.subs && c.subs.length > 1) o.子类 = c.subs.slice(0, 6).map((s) => ({ 名: s.name, 金额: s.total }));
    return o;
  });
  // 本月按成员（付款人）聚合：按 成员×类型×日期 分组后逐日换算，与其他口径一致
  const $ = _.aggregate;
  const memRows = [];
  for (let skip = 0; skip < 100000; skip += 1000) {
    const r = await db.collection('records').aggregate()
      .match({ bookId, date: _.gte(`${curYm}-01`).and(_.lte(`${curYm}-31`)) })
      .group({ _id: { p: '$payerOpenid', type: '$type', date: '$date' }, total: $.sum('$amountConverted') })
      .skip(skip).limit(1000).end();
    const list = r.list || [];
    list.forEach((x) => memRows.push(x));
    if (list.length < 1000) break;
  }
  const byMember = {};
  memRows.forEach((x) => {
    const v = x.total * dayFactor(rateIndex, x._id.date, base, display);
    const name = (mMap[x._id.p] && mMap[x._id.p].name) || '成员';
    if (!byMember[name]) byMember[name] = { in: 0, ex: 0 };
    if (x._id.type === 'income') byMember[name].in += v; else byMember[name].ex += v;
  });
  const members = Object.keys(byMember)
    .map((n) => ({ 成员: n, 支出: round2(byMember[n].ex), 收入: round2(byMember[n].in) }))
    .sort((a, b2) => b2.支出 - a.支出);
  const r2 = (o) => ({ 收: round2(o.in), 支: round2(o.ex) });
  return {
    base, display,
    pack: {
      今天: relDate(0),
      金额币种: display,
      本月: { 月: curYm, ...r2(mAgg[curYm] || { in: 0, ex: 0 }) },
      累计: { 收: round2(tIn), 支: round2(tEx), 记账起始月: yms[0] || curYm },
      近12月: yms.slice(-12).map((ym) => ({ 月: ym, ...r2(mAgg[ym]) })),
      近30日: Object.keys(dAgg).sort().map((d) => ({ 日: d, ...r2(dAgg[d]) })),
      本月支出分类: catPack(curCat.expense, true),
      本月收入分类: catPack(curCat.income, false),
      上月支出分类: catPack(prevCat.expense, false),
      本月成员: members,
    },
  };
}

const ai = {
  async listMessages(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const r = await db.collection('aiMessages').where({ bookId: p.bookId, openid: ctx.openid }).orderBy('createdAt', 'asc').limit(200).get();
    return r.data;
  },
  // 额度查询（AI 页顶部显示剩余次数；Infinity 无法过 JSON，不限一律 left:-1）
  // enabled=false（限额关闭）时前端整条额度文案隐藏
  async quota(p, ctx) {
    const q = await aiQuota(ctx.openid);
    return { used: q.used, paid: q.paid, total: AI_FREE_QUOTA, aiOn: AI_ENABLED, enabled: AI_ENABLED && AI_FREE_QUOTA > 0, left: isFinite(q.left) ? q.left : -1 };
  },
  // 统一入口：意图分流（记账句 → 预填卡 / 数据问答 → 基于数据包回答 / 跑题 → 拒绝）。
  // 数字只能来自 buildAiPack 的聚合结果——模型负责挑选与组织语言，不负责算术来源，杜绝编造。
  async chat(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid);
    const text = String(p.text || '').trim().slice(0, 300);
    if (!text) throw new AppError('INVALID_PARAM', '请输入内容');
    const canWrite = me.role !== 'ro';
    const mMap = await membersMap(p.bookId);
    const myName = (mMap[ctx.openid] && mMap[ctx.openid].name) || '我';
    // 开关关闭：不触碰任何模型，纯关键词模板解析（非深度合成）
    if (!AI_ENABLED) {
      return ai._ruleFallback(p.bookId, text, canWrite, myName, '');
    }
    if (!cloud.extend || !cloud.extend.AI) {
      return ai._ruleFallback(p.bookId, text, canWrite, myName, '（智能能力未开通，已按关键词解析）');
    }
    // 免费额度用尽：记账句仍走关键词解析兜底，问答给出明确提示
    const quota = await aiQuota(ctx.openid);
    if (quota.left <= 0) {
      return ai._ruleFallback(p.bookId, text, canWrite, myName, `（免费额度 ${AI_FREE_QUOTA} 次已用完，关键词记账仍可用）`);
    }
    let packInfo, cMap;
    try {
      [packInfo, cMap] = await Promise.all([buildAiPack(p.bookId, ctx), categoriesMap(p.bookId)]);
    } catch (e) {
      console.error('[ai.chat pack]', e);
      return ai._ruleFallback(p.bookId, text, canWrite, myName, '');
    }
    const sym = CUR_SYMBOL[packInfo.display] || packInfo.display;
    const prompt = [
      '你是记账小程序「心数」里某一个账本的 AI 助手。你只处理两类请求：A) 把用户描述的一笔收支解析成记账草稿；B) 回答关于这个账本的收支统计问题。',
      '除此之外的任何话题（股票行情、生活百科、闲聊、翻译、写代码、其他软件等）一律归为 C，礼貌拒绝。',
      `今天是 ${packInfo.pack.今天}（北京时间）。账本基准币种 ${packInfo.base}，统计金额币种 ${packInfo.display}。`,
      '',
      '【账本数据】以下 JSON 是唯一可引用的数字来源，可做加减合并，绝不允许编造或估算其中没有的数字：',
      JSON.stringify(packInfo.pack),
      '',
      '【账本分类表】记账草稿的分类优先从这里选：',
      `支出：${categoryTreeText(cMap, 'expense')}`,
      `收入：${categoryTreeText(cMap, 'income')}`,
      '',
      '判断用户输入属于 A/B/C，严格只输出一个 JSON 对象，不要 Markdown、不要解释：',
      `A 记账句 → {"intent":"record","draft":{"type":"expense或income","amount":数字,"currency":"三字母币码，用户没提外币就用 ${packInfo.base}","date":"YYYY-MM-DD，按今天解析 昨天/前天/上周X 等，默认今天","categoryText":"从分类表选，二级写成 父 / 子，都不合适用 其他","note":"3~8 字概括，如 打车"}}`,
      `B 数据问题 → {"intent":"qa","answer":"中文口语化回答，金额保留两位小数并带 ${sym} 符号；【账本数据】覆盖不到的维度直接说明暂不支持，并举例能问什么（本月/某月支出、分类花费、成员支出、收支趋势）；绝不编造数字"}`,
      'C 其他话题 → {"intent":"reject","answer":"一句话说明你只服务这个账本的记账与统计，并给一个可以问的例子"}',
      '',
      `用户输入：${text}`,
    ].join('\n');
    let out = '';
    try {
      const provider = process.env.AI_PROVIDER || 'hunyuan-open';
      const modelName = process.env.AI_TEXT_MODEL || 'hunyuan-lite';
      const model = cloud.extend.AI.createModel(provider);
      const r = await model.generateText({ model: modelName, messages: [{ role: 'user', content: prompt }] });
      out = (r && (r.text || r.content || r.output)) || '';
      aiCountUse(ctx.openid); // 只有真实模型调用成功才消耗额度
    } catch (e) {
      console.error('[ai.chat]', e);
      return ai._ruleFallback(p.bookId, text, canWrite, myName, '（服务暂时不可用，已按关键词解析）');
    }
    let obj = null;
    try { const mt = out.match(/\{[\s\S]*\}/); obj = mt ? JSON.parse(mt[0]) : null; } catch (e) { obj = null; }
    if (!obj || !obj.intent) return ai._ruleFallback(p.bookId, text, canWrite, myName, '');
    if (obj.intent === 'record') {
      if (!canWrite) return { answer: '你在这个账本是只读成员，不能记账；账本的收支统计随时可以问我。' };
      const d0 = obj.draft || {};
      const amount = round2(Number(d0.amount));
      if (!(amount > 0)) return { answer: '没识别到有效金额，换种说法试试，比如「昨天打车 35」。' };
      const today = relDate(0);
      let date = /^\d{4}-\d{2}-\d{2}$/.test(d0.date || '') ? d0.date : today;
      if (date > relDate(1)) date = today; // 防幻觉出离谱的未来日期（明天以内保留）
      const draft = {
        type: d0.type === 'income' ? 'income' : 'expense',
        amount,
        currency: /^[A-Za-z]{3}$/.test(d0.currency || '') ? String(d0.currency).toUpperCase() : packInfo.base,
        date,
        categoryText: String(d0.categoryText || '').replace(/\s*\/\s*/g, ' / ').slice(0, 30) || (d0.type === 'income' ? '其他收入' : '其他'),
        note: String(d0.note || text).slice(0, 140),
      };
      return { card: draftCard('自然语言记账', draft, myName) };
    }
    const answer = String(obj.answer || '').slice(0, 1000);
    return { answer: answer || '这个我答不了。可以问我本月支出、某个分类花了多少、谁花得最多，或说「昨天打车 35」帮你记一笔。' };
  },
  // 关键词规则兜底（AI 未开通 / 调用失败时）：能解析出金额就给预填卡，否则给引导语
  async _ruleFallback(bookId, text, canWrite, myName, notice) {
    const rec = parseNL(text);
    if (rec.amt > 0 && canWrite) {
      const b = await db.collection('books').doc(bookId).get().catch(() => null);
      const base = (b && b.data && b.data.baseCurrency) || 'CNY';
      const draft = { type: rec.type, amount: rec.amt, currency: rec.cur || base, date: rec.date, categoryText: rec.cat, note: text };
      return { card: draftCard('自然语言记账', draft, myName) };
    }
    // 关键词模式答不了统计问题——提示语只承诺记账，不承诺问答（模型开着时问答走不到这里）
    const tail = AI_ENABLED
      ? '没识别到可记账的金额。也可以问我账本的收支统计，比如「本月支出多少」。'
      : '没识别到可记账的金额，试试「昨天打车 35」这样的说法。';
    return { answer: (notice ? notice + ' ' : '') + tail };
  },
  // 兼容旧入口：走规则兜底（前端已改用 chat）
  async parseText(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid); requireRole(me, 'rw');
    const mMap = await membersMap(p.bookId);
    const myName = (mMap[ctx.openid] && mMap[ctx.openid].name) || '我';
    return ai._ruleFallback(p.bookId, p.text, true, myName, '');
  },
  // 收据识别：上传的图片 → 云开发 AI 多模态大模型识别 → 生成「预填记录」（用户确认后才入账，AI 绝不直接写库）
  async parseReceipt(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid); requireRole(me, 'rw');
    if (!AI_ENABLED) throw new AppError('AI_OFF', '收据识别暂未开放');
    if (!p.fileID) throw new AppError('INVALID_PARAM', '缺少收据图片');
    // 取图片临时链接供多模态模型读取
    const tmp = await cloud.getTempFileURL({ fileList: [p.fileID] });
    const imageUrl = tmp.fileList && tmp.fileList[0] && tmp.fileList[0].tempFileURL;
    if (!imageUrl) throw new AppError('UPLOAD_FAIL', '收据图片读取失败，请重试');
    // 依赖云开发 AI 能力（cloud.extend.AI）。未开通 / SDK 过旧时给出明确指引，绝不编造数字。
    if (!cloud.extend || !cloud.extend.AI) {
      throw new AppError('AI_NOT_READY', '收据识别需先在云开发控制台开通「AI 能力」，并将云函数 api 的 wx-server-sdk 升级到支持 cloud.extend.AI 的版本后重新部署');
    }
    const quota = await aiQuota(ctx.openid);
    if (quota.left <= 0) {
      return { card: null, answer: `免费 AI 额度（${AI_FREE_QUOTA} 次）已用完，暂时无法识别收据。` };
    }

    const b = await db.collection('books').doc(p.bookId).get();
    const base = (b.data && b.data.baseCurrency) || 'CNY';
    const today = relDate(0);
    const prompt = [
      '你是记账助手。请识别这张收据/小票图片，严格只输出一个 JSON 对象，不要任何多余文字、解释或 Markdown 代码块。',
      'JSON 字段：',
      '- type: "expense" 或 "income"（收据一般为 expense）',
      '- amount: 数字，实付总金额，不带货币符号',
      `- currency: 三字母币种码（CNY/USD/EUR/JPY 等），识别不到用 "${base}"`,
      `- date: "YYYY-MM-DD"，识别不到用 "${today}"`,
      '- merchant: 商家名称，识别不到用 ""',
      '- categoryText: 用中文给出建议分类，如 "餐饮 / 晚餐"、"购物 / 日用"、"交通 / 打车"',
      '若图片不是收据或识别不到金额，输出 {"amount":0}。',
    ].join('\n');

    let text = '';
    try {
      const provider = process.env.AI_PROVIDER || 'hunyuan-open';
      const modelName = process.env.AI_VISION_MODEL || 'hunyuan-vision';
      const model = cloud.extend.AI.createModel(provider);
      const r = await model.generateText({
        model: modelName,
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ] }],
      });
      text = (r && (r.text || r.content || r.output)) || '';
      aiCountUse(ctx.openid); // 真实模型调用成功才消耗额度
    } catch (e) {
      console.error('[parseReceipt AI]', e);
      throw new AppError('AI_FAILED', '收据识别服务调用失败：' + (e.message || String(e)));
    }

    // 从模型输出中提取 JSON
    let obj = null;
    try { const mt = text.match(/\{[\s\S]*\}/); obj = mt ? JSON.parse(mt[0]) : null; } catch (e) { obj = null; }
    if (!obj || !(Number(obj.amount) > 0)) {
      return { card: null, answer: '没能从这张图片识别到有效的收据金额，换一张更清晰的试试～' };
    }

    const amount = round2(Number(obj.amount));
    const currency = /^[A-Za-z]{3}$/.test(obj.currency || '') ? String(obj.currency).toUpperCase() : base;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(obj.date || '') ? obj.date : today;
    const categoryText = String(obj.categoryText || '其他').slice(0, 20);
    const merchant = String(obj.merchant || '').slice(0, 40);
    const type = obj.type === 'income' ? 'income' : 'expense';

    const mMap = await membersMap(p.bookId);
    const myName = (mMap[ctx.openid] && mMap[ctx.openid].name) || '我';
    const sym = CUR_SYMBOL[currency] || '';
    const draft = { type, amount, currency, date, categoryText, note: merchant };
    const rows = [
      { k: '类型', v: type === 'income' ? '收入' : '支出' },
      { k: '金额', v: sym + amount.toFixed(2) },
      { k: '分类', v: categoryText },
      { k: '日期', v: date },
      { k: '记录人', v: myName },
    ];
    if (merchant) rows.splice(1, 0, { k: '商家', v: merchant });
    return { card: { kind: '收据识别', state: 'pending', draft, rows } };
  },
  // 会话记录全部保留（不做滚动删除）；用量限制走「免费 50 次 AI 调用」额度（见 aiQuota）
  async appendMessage(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const add = await db.collection('aiMessages').add({ data: { ...p.message, bookId: p.bookId, openid: ctx.openid, createdAt: db.serverDate() } });
    return { ok: true, id: add._id };
  },
  // 「确认入账」：预填卡直接入账（服务端解析分类 + 复用 record.create 的汇率固化/鉴权），
  // 并把该条会话消息的卡片状态置为已入账。用户点了确认才走到这里——AI 仍然绝不自动写库。
  async confirmDraft(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid); requireRole(me, 'rw');
    const d = p.draft || {};
    const amount = round2(Number(d.amount));
    if (!(amount > 0)) throw new AppError('INVALID_PARAM', '预填金额无效');
    const b = await db.collection('books').doc(p.bookId).get();
    const base = b.data.baseCurrency;
    const type = d.type === 'income' ? 'income' : 'expense';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : relDate(0);
    const currency = /^[A-Za-z]{3}$/.test(d.currency || '') ? String(d.currency).toUpperCase() : base;
    const cMap = await categoriesMap(p.bookId);
    const categoryId = resolveCategoryByText(cMap, type, d.categoryText);
    const r = await record.create({ bookId: p.bookId, payload: {
      type, amount, currency, date, categoryId,
      title: '', note: d.note || '', images: [],
    } }, ctx);
    if (p.msgId) {
      await db.collection('aiMessages').where({ _id: p.msgId, bookId: p.bookId, openid: ctx.openid })
        .update({ data: { 'card.state': 'done' } }).catch(() => {});
    }
    return { recordId: r.recordId };
  },
  // 卡片状态持久化（放弃等），只能改自己的消息
  async setCardState(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    if (!p.msgId) throw new AppError('INVALID_PARAM', '缺少消息 id');
    const state = ['pending', 'done', 'dropped'].indexOf(p.state) > -1 ? p.state : 'pending';
    await db.collection('aiMessages').where({ _id: p.msgId, bookId: p.bookId, openid: ctx.openid })
      .update({ data: { 'card.state': state } });
    return { ok: true };
  },
};

// ============================== settings / user ==============================
const settings = {
  async get(_p, ctx) {
    const u = await ensureUser(ctx.openid, ctx.channel);
    return { displayCurrency: u.settings.displayCurrency, aiMessageLimit: u.settings.aiMessageLimit };
  },
  async update(p, ctx) {
    const u = await ensureUser(ctx.openid, ctx.channel);
    // 带 bookId = 设置该账本的展示币种（每账本一个，PRD 待定 5）；不带 = 改全局默认
    if (p.displayCurrency && p.bookId) {
      await requireMember(p.bookId, ctx.openid);
      await db.collection('users').doc(ctx.openid).update({
        data: { ['settings.bookCurrency.' + p.bookId]: p.displayCurrency },
      });
      return { ok: true };
    }
    const s = { ...u.settings };
    if (p.displayCurrency) s.displayCurrency = p.displayCurrency;
    if (p.aiMessageLimit) s.aiMessageLimit = p.aiMessageLimit;
    await db.collection('users').doc(ctx.openid).update({ data: { settings: s } });
    return { ok: true };
  },
};
const user = {
  async getProfile(_p, ctx) {
    const u = await ensureUser(ctx.openid, ctx.channel);
    // 账本数 = 我参与的、且仍存在的账本去重计数（避免残留/重复成员记录导致虚高）
    const ms = await db.collection('members').where({ openid: ctx.openid, status: _.neq('removed') }).get();
    const bookIds = [...new Set(ms.data.map((m) => m.bookId))];
    let bookCount = 0;
    if (bookIds.length) {
      const bs = await db.collection('books').where({ _id: _.in(bookIds) }).get();
      bookCount = bs.data.length;
    }
    let defaultBookName = '';
    if (u.defaultBookId) {
      const b = await db.collection('books').doc(u.defaultBookId).get().catch(() => null);
      defaultBookName = b && b.data ? b.data.name : '';
    }
    return {
      nickname: u.nickname, avatarInitial: u.avatarInitial, avatarColor: u.avatarColor,
      avatarFileID: u.avatarFileID || '',
      registered: !!u.registered,
      isDev: isDevUser(ctx.openid),                    // dev 工具区块显隐（owner 常驻可见）
      canReset: isDevUser(ctx.openid),                 // 「清空所有数据」：只认 owner 身份
      bookCount, defaultBookName, defaultBookId: u.defaultBookId || '',
    };
  },

  // 微信授权登录：写入头像/昵称，标记已注册。
  // 名字/头像各处实时取自 users，改这里即全站更新，无需再逐账本同步。
  async login(p, ctx) {
    await ensureCollections();
    await ensureUser(ctx.openid, ctx.channel);
    const nickname = (p.nickname || '').trim().slice(0, 20) || '微信用户';
    const data = { nickname, avatarInitial: nickname.slice(0, 1), registered: true };
    if (p.avatarFileID) data.avatarFileID = p.avatarFileID;
    await db.collection('users').doc(ctx.openid).update({ data });
    return { ok: true, nickname };
  },

  // 修改个人昵称/头像（全站显示自动跟随）
  async updateProfile(p, ctx) {
    const data = {};
    if (p.nickname) { data.nickname = p.nickname.trim().slice(0, 20); data.avatarInitial = data.nickname.slice(0, 1); }
    if (p.avatarFileID) data.avatarFileID = p.avatarFileID;
    await db.collection('users').doc(ctx.openid).update({ data });
    return { ok: true };
  },

  // 注销账户（不可恢复）。处理原则：
  // - 我独享的 owner 账本 → 连数据带图片整本删除；
  // - 多人账本我是 owner → 阻断，要求先解散/移交；
  // - 他人账本里我的记录 → 保留（其他成员的统计与分账依赖这些数据），
  //   成员行快照昵称进 nameOverride 并标记 deletedUser，历史记录显示「原名（已注销）」；
  // - 个人私有数据（用户文档/图表布局/AI 会话/反馈工单/客服身份/头像文件）→ 全部删除。
  // 无跨集合事务，靠顺序保证可重试：users 文档最后删，中途失败可重新发起注销。
  async deleteAccount(_p, ctx) {
    const openid = ctx.openid;
    const u = await getUser(openid);
    const nickname = (u && u.nickname) || '成员';

    // 1) 阻断检查：我是 owner 且仍有其他活跃成员的账本
    const allMs = await db.collection('members').where({ openid }).get();
    const activeMs = allMs.data.filter((m) => m.status !== 'removed');
    const soloBookIds = []; const blocked = [];
    for (const m of activeMs) {
      const b = await db.collection('books').doc(m.bookId).get().catch(() => null);
      if (!b || !b.data || b.data.ownerOpenid !== openid) continue;
      const others = await db.collection('members')
        .where({ bookId: m.bookId, openid: _.neq(openid), status: _.neq('removed') }).count();
      if (others.total > 0) blocked.push(b.data.name);
      else soloBookIds.push(m.bookId);
    }
    if (blocked.length) {
      throw new AppError('OWNER_BLOCKED', `你仍是多人账本「${blocked.join('」「')}」的 owner，请先在账本管理中解散或移交后再注销`);
    }

    // 2) 昵称快照 + 标记已注销：含历史已被移除的成员行，保证他人账本的历史记录仍显示原名
    for (const m of allMs.data) {
      await db.collection('members').doc(m._id).update({ data: {
        nameOverride: m.nameOverride || nickname, status: 'removed', deletedUser: true,
      } }).catch(() => {});
    }

    // 3) 独享账本整本删除（含记录图片文件）
    for (const bookId of soloBookIds) await dissolveBook(bookId);

    // 4) 留存账本成员数减一
    for (const m of activeMs) {
      if (soloBookIds.includes(m.bookId)) continue;
      await db.collection('books').doc(m.bookId).update({ data: { memberCount: _.inc(-1) } }).catch(() => {});
    }

    // 5) 个人私有数据：布局、AI 会话（全部账本）、反馈工单（含图片）、客服身份、头像文件
    await removeAllWhere('chartLayouts', { openid });
    await removeAllWhere('aiMessages', { openid });
    const fbs = await db.collection('feedbacks').where({ openid }).get().catch(() => ({ data: [] }));
    const fbImgs = [];
    (fbs.data || []).forEach((f) => { (f.images || []).forEach((x) => fbImgs.push(x)); });
    await deleteFiles(fbImgs);
    await removeAllWhere('feedbacks', { openid });
    await removeAllWhere('admins', { openid });
    if (u && u.avatarFileID) await deleteFiles([u.avatarFileID]);

    // 6) 最后删用户文档（此步成功即注销完成；之前任何一步失败，重新发起即可续跑）
    await db.collection('users').doc(openid).remove();
    return { ok: true, dissolvedBooks: soloBookIds.length, keptBooks: activeMs.length - soloBookIds.length };
  },
};

// ============================== data（导入导出）==============================
// 行构造/CSV/解析/键名映射等纯逻辑在 ./dataio.js（可本地单测）
const { exportRows, toCsv } = dataio;

// 导出用：按可选时间段 [dateFrom, dateTo] 拉取账本全部记录。
// 分页累加，突破单次 get 的 1000 上限，避免大账本静默截断。
async function collectExportRecords(bookId, dateFrom, dateTo) {
  const where = { bookId };
  if (dateFrom && dateTo) where.date = _.gte(dateFrom).and(_.lte(dateTo));
  else if (dateFrom) where.date = _.gte(dateFrom);
  else if (dateTo) where.date = _.lte(dateTo);
  const PAGE = 1000; const all = [];
  for (let skip = 0; ; skip += PAGE) {
    const r = await db.collection('records').where(where)
      .orderBy('date', 'desc').orderBy('createdAt', 'desc')
      .skip(skip).limit(PAGE).get();
    all.push(...r.data);
    if (r.data.length < PAGE) break;
  }
  return all;
}

// 邮件发送（SMTP，凭据取自云函数环境变量）。未配置时抛出明确指引。
// 在云开发控制台为云函数 api 配置：SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS（可选 SMTP_FROM）。
async function sendExportMail({ to, bookName, count, rangeText, fileType, filename, content }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const usr = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || usr;
  if (!host || !usr || !pass) {
    throw new AppError('MAIL_NOT_CONFIGURED', '邮件服务未配置：请在云开发控制台为云函数 api 添加环境变量 SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS');
  }
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: usr, pass } });
  await transporter.sendMail({
    from: `心数 Sense <${from}>`,
    to,
    subject: `【心数 Sense】「${bookName}」记账数据导出`,
    text: `你好，\n\n附件为账本「${bookName}」的记账数据导出。\n记录条数：${count}\n时间范围：${rangeText}\n文件格式：${String(fileType).toUpperCase()}\n\n（本邮件由心数 Sense 小程序自动发送）`,
    attachments: [{ filename, content }],
  });
}

const data = {
  // 导出：生成文件并上传云存储，返回 fileID 供前端下载/预览/转发
  async export(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const fmt = p.format || 'json';
    const b = await db.collection('books').doc(p.bookId).get();
    const [records, mMap] = await Promise.all([collectExportRecords(p.bookId, p.dateFrom, p.dateTo), membersMap(p.bookId)]);
    const rows = exportRows(records, mMap);
    const stamp = new Date().toISOString().slice(0, 10);
    const safeName = (b.data.name || '账本').replace(/[\\/:*?"<>|]/g, '');
    let fileContent; let ext;

    if (fmt === 'json') {
      const payload = {
        format: 'sense.book.v1', exportedAt: new Date().toISOString(),
        book: { name: b.data.name, type: b.data.type, baseCurrency: b.data.baseCurrency },
        records: records.map((r) => ({ type: r.type, title: r.title || '', amount: r.amount, currency: r.currency, rate: r.rate, amountConverted: r.amountConverted, categoryPath: r.categoryPath, date: r.date, note: r.note || '' })),
      };
      fileContent = Buffer.from(JSON.stringify(payload, null, 2), 'utf8'); ext = 'json';
    } else if (fmt === 'csv') {
      fileContent = Buffer.from('﻿' + toCsv(rows), 'utf8'); ext = 'csv'; // BOM 便于 Excel 正确识别中文
    } else if (fmt === 'excel') {
      const XLSX = require('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '记账明细');
      fileContent = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); ext = 'xlsx';
    } else if (fmt === 'pdf') {
      const rangeText = (p.dateFrom || p.dateTo) ? `${p.dateFrom || '起始'} ~ ${p.dateTo || '至今'}` : '全部时间';
      fileContent = await dataio.buildPdf({ bookName: b.data.name, baseCurrency: b.data.baseCurrency, rangeText, exportedAt: stamp }, rows);
      ext = 'pdf';
    } else {
      throw new AppError('INVALID_PARAM', '不支持的导出格式');
    }

    const up = await cloud.uploadFile({
      cloudPath: `exports/${p.bookId}-${Date.now()}.${ext}`,
      fileContent,
    });
    // 登记到 files 集合：导出文件（前端下载路径）不被任何业务文档引用，
    // reset 清库时靠这份台账才能连云存储一起清掉
    await db.collection('files').add({ data: { kind: 'export', fileID: up.fileID, openid: ctx.openid, createdAt: db.serverDate() } }).catch(() => {});
    return { fileID: up.fileID, fileName: `${safeName}-${stamp}.${ext}`, fileType: ext, count: rows.length, bookName: b.data.name };
  },

  // 导出并以邮件附件形式发送到指定邮箱：复用 export 落云存储，再取回内容发送，最后删中转文件
  async exportEmail(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const to = (p.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new AppError('INVALID_PARAM', '邮箱格式不正确');
    const res = await data.export(p, ctx);
    const dl = await cloud.downloadFile({ fileID: res.fileID });
    const rangeText = (p.dateFrom || p.dateTo) ? `${p.dateFrom || '起始'} ~ ${p.dateTo || '至今'}` : '全部时间';
    try {
      await sendExportMail({
        to, bookName: res.bookName || '账本', count: res.count, rangeText,
        fileType: res.fileType, filename: res.fileName, content: dl.fileContent,
      });
    } finally {
      cloud.deleteFile({ fileList: [res.fileID] }).catch(() => {});
    }
    return { ok: true, count: res.count, fileName: res.fileName, to };
  },

  // 导入：JSON / CSV / Excel。解析 + 键名映射归一化在 dataio（外部软件表头自动适配）；
  // 这里做：分类匹配（全路径→末级名→空）、汇率补齐、批量入库。记录人=导入者。
  async import(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid); requireRole(me, 'rw');
    const fmt = String(p.format || 'json').toLowerCase();
    let parsed;
    try { parsed = dataio.parseImportContent(fmt, p.content, p.contentBase64); }
    catch (e) { throw new AppError('INVALID_PARAM', `文件解析失败：${e.message}`); }
    const { rows, errors } = parsed;
    if (!rows.length && !errors.length) {
      return { success: 0, failed: 0, createdCategories: 0, failures: [{ index: 0, summary: '', reason: '未找到可导入的记录' }] };
    }
    const b = await db.collection('books').doc(p.bookId).get();
    const base = b.data.baseCurrency;
    const cMap = await categoriesMap(p.bookId);
    // 分类匹配（收/支各自集合内）：「父 / 子」全路径 → 末级名并入已有结构 → 自动创建
    // （p.autoCreateCategories === false 时关闭自动创建，未匹配则置空、保留文字快照）
    const topByName = { expense: {}, income: {} };  // 一级名 → id
    const subByPath = { expense: {}, income: {} };  // 「父 / 子」 → 二级 id
    const leafByName = { expense: {}, income: {} }; // 任意名 → id（末级名兜底）
    Object.values(cMap).forEach((c) => {
      const k = c.kind === 'income' ? 'income' : 'expense';
      leafByName[k][c.name] = c._id;
      if (!c.parentId) topByName[k][c.name] = c._id;
      else if (cMap[c.parentId]) subByPath[k][`${cMap[c.parentId].name} / ${c.name}`] = c._id;
    });
    const autoCreate = p.autoCreateCategories !== false;
    let createdCategories = 0;
    const mkCat = async (kind, name, parentId) => {
      const add = await db.collection('categories').add({ data: {
        bookId: p.bookId, kind, parentId: parentId || null, name, icon: parentId ? null : 'dots', order: 99, disabled: false,
      } });
      createdCategories++;
      return add._id;
    };
    // 取（或创建）path 对应分类 id。path 已由 dataio 归一为「父」或「父 / 子」
    const ensureCategory = async (kind, path) => {
      const parts = path.split('/').map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return null;
      if (parts.length === 1) {
        const hit = topByName[kind][parts[0]] || leafByName[kind][parts[0]];
        if (hit) return hit;
        if (!autoCreate) return null;
        const id = await mkCat(kind, parts[0], null);
        topByName[kind][parts[0]] = id; leafByName[kind][parts[0]] = id;
        return id;
      }
      const top = parts[0], sub = parts[parts.length - 1];
      const full = `${top} / ${sub}`;
      if (subByPath[kind][full]) return subByPath[kind][full];
      if (leafByName[kind][sub]) return leafByName[kind][sub]; // 末级同名并入已有结构，避免重复建树
      if (!autoCreate) return null;
      let topId = topByName[kind][top];
      if (!topId) { topId = await mkCat(kind, top, null); topByName[kind][top] = topId; if (!leafByName[kind][top]) leafByName[kind][top] = topId; }
      const subId = await mkCat(kind, sub, topId);
      subByPath[kind][full] = subId; leafByName[kind][sub] = subId;
      return subId;
    };
    let success = 0;
    // 失败明细：{ index: 数据行号(1 起，不含表头), summary: 日期·标题摘要, reason: 可执行的原因 }
    const failures = errors.map((e) => ({ index: e.index, summary: e.summary || '', reason: e.reason }));
    // —— 查重（数量对齐）——
    // 指纹 = 日期|收支|金额|币种|标题|备注。每个指纹只导入「文件条数 − 库中已有条数」：
    // 同一文件重复导入幂等；与手动录入重复的行被跳过；文件内合法的重复记录（库里没有）不误伤。
    const fpOf = (r) => [r.date, r.type, round2(r.amount), r.currency, String(r.title || '').trim(), String(r.note || '').trim()].join('|');
    const dupBudget = {};
    // 分页拉全量（复用导出的取数函数），避免大账本超 1000 条时漏查旧记录
    (await collectExportRecords(p.bookId)).forEach((r) => { const k = fpOf(r); dupBudget[k] = (dupBudget[k] || 0) + 1; });
    const skipped = [];
    // 本次导入的批次号：写入每条记录，供「撤销本次导入」定位
    const batchId = 'imp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const docs = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const currency = row.currency || base;
        let rate;
        if (currency === base) rate = 1;
        else if (row.rate > 0) rate = row.rate;
        else if (row.amountConverted > 0) rate = rateSig(row.amountConverted / row.amount); // 由换算金额反推当日汇率
        else rate = (await getRate(row.date, base, currency)).rate;
        const path = row.categoryPath || '';
        const leaf = path.split('/').pop().trim();
        const doc = {
          bookId: p.bookId, type: row.type,
          title: row.title || leaf || (row.type === 'income' ? '导入收入' : '导入支出'),
          amount: row.amount, currency, rate, baseCurrency: base,
          amountConverted: row.amountConverted != null ? row.amountConverted : round6(row.amount * rate),
          categoryId: null,
          categoryPath: path || leaf || '其他', date: row.date,
          note: row.note || '', images: [], recorderOpenid: ctx.openid, payerOpenid: ctx.openid, split: null,
          importBatchId: batchId,
          createdAt: db.serverDate(), createdBy: ctx.openid, updatedAt: db.serverDate(), updatedBy: ctx.openid,
        };
        const k = fpOf(doc);
        if (dupBudget[k] > 0) {
          dupBudget[k]--;
          skipped.push({ index: row._idx || 0, summary: [row.date, row.title || row.note].filter(Boolean).join(' · ').slice(0, 40) });
          continue;
        }
        // 分类匹配/自动创建放在查重之后，跳过的行不会误建分类
        doc.categoryId = path ? await ensureCategory(row.type, path) : null;
        docs.push(doc);
      } catch (e) {
        failures.push({
          index: row._idx || 0,
          summary: [row.date, row.title || row.note].filter(Boolean).join(' · ').slice(0, 40),
          reason: e.message || '处理失败',
        });
      }
    }
    // 批量入库（100 条/批）
    for (let i = 0; i < docs.length; i += 100) {
      const batch = docs.slice(i, i + 100);
      try { await db.collection('records').add({ data: batch }); success += batch.length; }
      catch (e) { failures.push({ index: 0, summary: `${batch.length} 条记录`, reason: `批量写入失败：${e.message || e}` }); }
    }
    const failed = rows.length + errors.length - success - skipped.length;
    failures.sort((a, b) => a.index - b.index);
    return {
      success, failed, createdCategories,
      skippedCount: skipped.length, skipped: skipped.slice(0, 100),
      failures: failures.slice(0, 100),
      batchId: success > 0 ? batchId : '',
    };
  },

  // 撤销一次导入：删除该批次写入的全部记录。
  // 权限：rw 成员只能撤销自己导入的批次；admin/owner 可撤销任意批次（与记录删除权限一致）
  async undoImport(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid); requireRole(me, 'rw');
    if (!p.batchId) throw new AppError('INVALID_PARAM', '缺少导入批次号');
    const where = { bookId: p.bookId, importBatchId: p.batchId };
    if (me.role !== 'admin' && me.role !== 'owner') where.createdBy = ctx.openid;
    let removed = 0;
    for (let guard = 0; guard < 100; guard++) {
      const res = await db.collection('records').where(where).remove().catch(() => null);
      const n = res && res.stats ? res.stats.removed : 0;
      if (!n) break;
      removed += n;
    }
    return { removed };
  },
};

// ============================== settle（P2）==============================
// 单笔支出的成员应摊（基准币口径）。settle 与成员统计共用此口径，两处必须一致。
// 历史数据可能已带 share（seed/导入）则直用；没带按 mode 现算：
// treat = 仅付款人承担全额；even/其他 = 选中成员均摊；无分摊信息（共享账本/旧数据）= 付款人承担。
function splitShares(rec) {
  const out = {};
  const total = rec.amountConverted || 0;
  const sp = rec.split || null;
  const members = (sp && sp.members) || [];
  if (!sp || sp.mode === 'treat' || !members.length) {
    out[rec.payerOpenid] = (out[rec.payerOpenid] || 0) + total;
    return out;
  }
  if (members.some((m) => typeof m.share === 'number')) {
    members.forEach((m) => { out[m.openid] = (out[m.openid] || 0) + (m.share || 0); });
    return out;
  }
  const per = total / members.length;
  members.forEach((m) => { out[m.openid] = (out[m.openid] || 0) + per; });
  return out;
}

// 全量取某账本的结清抵扣（settlements 集合，条数少，分页取全）
async function fetchSettlements(bookId) {
  const out = [];
  for (let skip = 0; ; skip += 100) {
    const r = await db.collection('settlements').where({ bookId }).skip(skip).limit(100).get().catch(() => ({ data: [] }));
    out.push(...(r.data || []));
    if ((r.data || []).length < 100) break;
  }
  return out;
}

// 结算语义（抵扣模型，无周期/快照）：「标记结清」= 往 settlements 插一笔抵扣
// （from 已把 amount 付给 to，基准币种口径）；重算时先按全量记录算净额，再用抵扣冲抵，
// 剩余部分生成最少转账方案。结清后继续记账，方案只会体现增量欠款；撤销结清 = 删抵扣文档。
const settle = {
  async get(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const [records, mMap, bk, stl] = await Promise.all([
      fetchBookRecords(p.bookId), membersMap(p.bookId),
      db.collection('books').doc(p.bookId).get(),
      fetchSettlements(p.bookId),
    ]);
    const base = (bk.data && bk.data.baseCurrency) || 'CNY';
    // 展示口径跟随「账本 × 用户」展示币种（与首页/统计一致）；内部欠款与结清抵扣仍固化在基准币，
    // 仅展示时按最新汇率整体换算——所有数字同一系数缩放，净额零和与方案一致性不受影响。
    // 每笔转账可另选结算币种（books.settleCur['from|to']），仅覆盖该行展示，不动内部台账。
    const me0 = await getUser(ctx.openid);
    const display = displayCurrencyOf(me0, p.bookId, base);
    const q = await latestCnyQuotes();
    const facTo = (to) => { // 基准币 → to 的最新换算系数；缺汇率返回 null
      if (!to || to === base) return 1;
      const qb = base === 'CNY' ? 1 : (q && q[base]);
      const qd = to === 'CNY' ? 1 : (q && q[to]);
      return (qb && qd) ? qb / qd : null;
    };
    let dispFactor = 1, dispCur = base;
    const fd = facTo(display);
    if (fd) { dispFactor = fd; dispCur = display; } // 缺汇率回退基准币展示
    const disp = (n) => round2((n || 0) * dispFactor);
    const sym = CUR_SYMBOL[dispCur] || dispCur + ' ';
    const settleCur = (bk.data && bk.data.settleCur) || {};
    // 该笔转账的展示币种与金额：对方选了结算币种则按它换算，否则跟随展示币种
    const pairView = (from, to, amtBase) => {
      const want = settleCur[`${from}|${to}`];
      if (want && want !== dispCur) {
        const f = facTo(want);
        if (f) return { cur: want, amt: round2(amtBase * f) };
      }
      return { cur: dispCur, amt: disp(amtBase) };
    };
    const paid = {}, share = {};
    Object.keys(mMap).forEach((o) => { paid[o] = 0; share[o] = 0; });
    let totalExpense = 0;
    records.forEach((r) => {
      if (r.type !== 'expense') return;
      totalExpense += r.amountConverted;
      paid[r.payerOpenid] = (paid[r.payerOpenid] || 0) + r.amountConverted;
      const sh = splitShares(r); // 与成员统计同口径；旧数据无 share 字段时按 mode 现算，修掉「均摊应摊恒为 0」的隐性坑
      Object.keys(sh).forEach((o) => { share[o] = (share[o] || 0) + sh[o]; });
    });
    const net = {};
    Object.keys(mMap).forEach((o) => { net[o] = round2((paid[o] || 0) - (share[o] || 0)); });
    // 抵扣：已结清的转账视同「from 已付给 to」，双方净额向 0 冲抵。
    // 全部结清后各净额归零，之后的新记录只产生增量欠款。
    stl.forEach((s) => {
      net[s.from] = round2((net[s.from] || 0) + s.amount);
      net[s.to] = round2((net[s.to] || 0) - s.amount);
    });
    // 最少转账（基于冲抵后的剩余净额）
    const creditors = Object.keys(net).filter((o) => net[o] > 0).map((o) => ({ o, v: net[o] })).sort((a, b) => b.v - a.v);
    const debtors = Object.keys(net).filter((o) => net[o] < 0).map((o) => ({ o, v: -net[o] })).sort((a, b) => b.v - a.v);
    const who = (o) => {
      const m = mMap[o] || {};
      return { name: m.name || '成员', initial: m.initial || '?', color: m.color || '#999', avatar: m.avatarFileID || '' };
    };
    const transfers = []; let i = 0, j = 0, tid = 1;
    while (i < debtors.length && j < creditors.length) {
      const amt = round2(Math.min(debtors[i].v, creditors[j].v));
      if (amt > 0.001) {
        const f = who(debtors[i].o), t = who(creditors[j].o);
        const pv = pairView(debtors[i].o, creditors[j].o, amt);
        transfers.push({ transferId: 't' + (tid++),
          fromOpenid: debtors[i].o, toOpenid: creditors[j].o, // 标记结清时回传，服务端据此落抵扣
          from: f.name, fromInitial: f.initial, fromColor: f.color, fromAvatar: f.avatar,
          to: t.name, toInitial: t.initial, toColor: t.color, toAvatar: t.avatar,
          // amount 固化基准币（标记结清用）；amountDisp/cur 为该行结算币种视图；amountRef 为展示币种（合计用）
          amount: amt, amountDisp: pv.amt, cur: pv.cur, amountRef: disp(amt), settled: false });
      }
      debtors[i].v -= amt; creditors[j].v -= amt;
      if (debtors[i].v < 0.001) i++; if (creditors[j].v < 0.001) j++;
    }
    // 已结清列表（可撤销），新结清的在前
    const settled = stl.map((s) => {
      const f = who(s.from), t = who(s.to);
      // 结清时如选了结算币种，金额快照（amountFx/currency）落在抵扣文档里，历史显示不随汇率漂移
      return { settlementId: s._id,
        from: f.name, fromInitial: f.initial, fromColor: f.color, fromAvatar: f.avatar,
        to: t.name, toInitial: t.initial, toColor: t.color, toAvatar: t.avatar,
        amount: s.amount, amountDisp: s.amountFx != null ? s.amountFx : disp(s.amount),
        cur: s.currency || dispCur, amountRef: disp(s.amount), settledAt: s.settledAt };
    }).reverse();
    const me = ctx.openid;
    const splits = records.filter((r) => r.type === 'expense').map((r) => {
      const sp = r.split || { mode: 'even', members: [] };
      const n = sp.members.length || 1;
      let detail;
      if (sp.mode === 'treat') detail = `仅${(mMap[r.payerOpenid] || {}).name || ''}承担`;
      else if (sp.mode === 'even') detail = `${n} 人均摊 · 各 ${sym}${round2(disp(r.amountConverted) / n)}`;
      else detail = `${n} 人分摊`;
      return {
        title: r.title || r.categoryPath, amount: disp(r.amountConverted),
        payerName: `${(mMap[r.payerOpenid] || {}).name || ''}垫付`, detail,
        isForeign: r.currency !== r.baseCurrency, fx: r.currency !== r.baseCurrency ? `${r.amount} ${r.currency}` : '',
        avatars: sp.members.map((m) => ({ initial: (mMap[m.openid] || {}).initial || '?', color: (mMap[m.openid] || {}).color || '#999', avatarFileID: (mMap[m.openid] || {}).avatarFileID || '' })),
      };
    });
    return {
      // myNet / 成员净额均为「冲抵后的剩余口径」：全部结清则归零，关心的是还差多少而非历史总账
      summary: { myNet: disp(net[me]), totalExpense: disp(totalExpense), myPaid: disp(paid[me]), myShare: disp(share[me]), currency: dispCur },
      transfers, settled,
      members: Object.keys(mMap).map((o) => ({ name: mMap[o].name + (o === me ? '（我）' : ''), initial: mMap[o].initial, color: mMap[o].color, avatarFileID: mMap[o].avatarFileID || '', paid: disp(paid[o]), share: disp(share[o]), net: disp(net[o]) })),
      splits, splitCount: splits.length,
    };
  },

  // 标记结清：落一笔抵扣。写权限 rw 起（只读成员不产生入账类操作）
  // amount 恒为基准币（台账口径）；前端传了结算币种则把「结清那一刻」的换算金额一并快照，历史显示不漂移
  async mark(p, ctx) {
    const m = await requireMember(p.bookId, ctx.openid); requireRole(m, 'rw');
    const amount = round2(Number(p.amount));
    if (!(amount > 0) || amount > 1e9) throw new AppError('INVALID_PARAM', '结清金额不合法');
    if (!p.from || !p.to || p.from === p.to) throw new AppError('INVALID_PARAM', '结清双方不合法');
    const mm = await membersMap(p.bookId); // 双方须是本账本成员（含已移除：历史欠款可能涉及）
    if (!mm[p.from] || !mm[p.to]) throw new AppError('INVALID_PARAM', '结清双方不是账本成员');
    const doc = {
      bookId: p.bookId, from: p.from, to: p.to, amount,
      settledBy: ctx.openid, settledAt: db.serverDate(),
    };
    if (p.currency && CUR_SYMBOL[p.currency] && p.amountFx > 0) {
      doc.currency = p.currency; doc.amountFx = round2(Number(p.amountFx));
    }
    await db.createCollection('settlements').catch(() => {});
    const add = await db.collection('settlements').add({ data: doc });
    return { settlementId: add._id };
  },

  // 为某笔转账指定结算币种（按 from|to 记在账本上，双方都可见；仅改展示口径，不动台账）
  async setCurrency(p, ctx) {
    const m = await requireMember(p.bookId, ctx.openid); requireRole(m, 'rw');
    if (!p.from || !p.to) throw new AppError('INVALID_PARAM', '缺少结算双方');
    if (!p.currency || !CUR_SYMBOL[p.currency]) throw new AppError('INVALID_PARAM', '不支持的币种');
    const bk = await db.collection('books').doc(p.bookId).get();
    const map = (bk.data && bk.data.settleCur) || {};
    map[`${p.from}|${p.to}`] = p.currency;
    await db.collection('books').doc(p.bookId).update({ data: { settleCur: map } });
    return { ok: true };
  },

  // 撤销结清：删抵扣文档，欠款回到方案里
  async unmark(p, ctx) {
    const m = await requireMember(p.bookId, ctx.openid); requireRole(m, 'rw');
    const r = await db.collection('settlements').doc(p.settlementId).get().catch(() => null);
    if (!r || !r.data || r.data.bookId !== p.bookId) throw new AppError('NOT_FOUND', '结清记录不存在');
    await db.collection('settlements').doc(p.settlementId).remove();
    return { ok: true };
  },

  // 旧版客户端兼容：历史体验版仍会调 markTransfer，保持成功返回但不落库（新逻辑走 mark/unmark）
  async markTransfer(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    return { ok: true };
  },
};

// ============================== feedback（用户反馈 · 轻量工单，PRD 4.9）==============================
// 客服两级：owner = 云函数环境变量 FEEDBACK_OWNER（唯一权力源，只能在云开发控制台修改，
// 应用内任何操作都动不了它）；admin = owner 用邀请码邀请的客服（admins 集合），仅 owner 可移除，
// admin 之间不可互删。工单双侧未读标记：unreadForUser（客服有新回复）/ unreadForAdmin（用户有新工单或追问）。
const FEEDBACK_STATUS = { pending: '待处理', processing: '处理中', resolved: '已解决' };
function feedbackOwnerIds() {
  // 通常只填一个 openid；支持逗号分隔多个（共同 owner）
  return (process.env.FEEDBACK_OWNER || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function isFeedbackOwner(openid) { return feedbackOwnerIds().includes(openid); }
// 开发者判定（dev 工具显隐与执行的统一权限源）：配了 FEEDBACK_OWNER 就只认身份（服务端 openid，
// 不可伪造）；没配（早期开发/新环境）才退回 APP_ENV=dev 兜底。上线后改 APP_ENV 不会把 dev
// 工具暴露给普通用户。seed.reset 同样只认此身份（原「且 APP_ENV=dev」双闸已按 owner 决策移除）。
function isDevUser(openid) {
  const owners = feedbackOwnerIds();
  if (owners.length) return owners.includes(openid);
  return IS_DEV;
}
async function isFeedbackAdmin(openid) {
  if (isFeedbackOwner(openid)) return true;
  const r = await db.collection('admins').where({ kind: 'admin', openid }).count().catch(() => ({ total: 0 }));
  return (r.total || 0) > 0;
}
// 6 位邀请码（去掉 0/O/1/I 等易混淆字符）
function genInviteCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
const feedback = {
  async create(p, ctx) {
    const title = (p.title || '').trim();
    const content = (p.content || '').trim();
    if (!title || !content) throw new AppError('INVALID_PARAM', '标题和内容不能为空');
    const email = (p.contactEmail || '').trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError('INVALID_PARAM', '联系邮箱格式不正确');
    const images = (Array.isArray(p.images) ? p.images : []).slice(0, 3);
    await db.createCollection('feedbacks').catch(() => {});
    const add = await db.collection('feedbacks').add({ data: {
      openid: ctx.openid, title: title.slice(0, 50), content: content.slice(0, 1000),
      images, contactEmail: email.slice(0, 100),
      channel: ctx.channel,
      status: 'pending', replies: [],
      unreadForUser: false, unreadForAdmin: true,
      createdAt: db.serverDate(), updatedAt: db.serverDate(),
    } });
    return { feedbackId: add._id };
  },

  // 普通用户见自己的工单；管理员见全部（附提交人昵称）
  async list(_p, ctx) {
    const admin = await isFeedbackAdmin(ctx.openid);
    const where = admin ? { _id: _.exists(true) } : { openid: ctx.openid };
    const r = await db.collection('feedbacks').where(where).orderBy('updatedAt', 'desc').limit(100).get().catch(() => ({ data: [] }));
    const items = r.data || [];
    const names = {};
    if (admin && items.length) {
      const ids = [...new Set(items.map((f) => f.openid))];
      const u = await db.collection('users').where({ _id: _.in(ids) }).get().catch(() => ({ data: [] }));
      (u.data || []).forEach((x) => { names[x._id] = x.nickname || '用户'; });
    }
    return {
      isAdmin: admin,
      isOwner: isFeedbackOwner(ctx.openid),
      items: items.map((f) => ({
        feedbackId: f._id, title: f.title,
        status: f.status, statusLabel: FEEDBACK_STATUS[f.status] || f.status,
        replyCount: (f.replies || []).length,
        unread: admin ? !!f.unreadForAdmin : !!f.unreadForUser,
        fromName: admin ? (names[f.openid] || '用户') : '',
        mine: f.openid === ctx.openid, // 客服视角用于「用户工单 / 我的反馈」分区
        updatedAt: f.updatedAt,
      })),
    };
  },

  // 查看详情：仅本人或管理员；查看即清除自己这一侧的未读标记
  async get(p, ctx) {
    const r = await db.collection('feedbacks').doc(p.feedbackId).get().catch(() => null);
    if (!r || !r.data) throw new AppError('NOT_FOUND', '反馈不存在');
    const f = r.data;
    const admin = await isFeedbackAdmin(ctx.openid);
    const mine = f.openid === ctx.openid;
    if (!admin && !mine) throw new AppError('NO_PERMISSION', '无权查看该反馈');
    const clear = {};
    if (mine && f.unreadForUser) clear.unreadForUser = false;
    if (admin && f.unreadForAdmin) clear.unreadForAdmin = false;
    if (Object.keys(clear).length) await db.collection('feedbacks').doc(p.feedbackId).update({ data: clear }).catch(() => {});
    let fromName = '';
    if (admin) { const u = await getUser(f.openid); fromName = (u && u.nickname) || '用户'; }
    return {
      feedbackId: p.feedbackId, title: f.title, content: f.content, images: f.images || [],
      contactEmail: f.contactEmail || '', status: f.status, statusLabel: FEEDBACK_STATUS[f.status] || f.status,
      replies: f.replies || [], createdAt: f.createdAt,
      isAdmin: admin, isMine: mine, fromName,
    };
  },

  // 追加回复：本人或管理员；客服首次回复自动把「待处理」转「处理中」
  async reply(p, ctx) {
    const content = (p.content || '').trim();
    if (!content) throw new AppError('INVALID_PARAM', '回复内容不能为空');
    const r = await db.collection('feedbacks').doc(p.feedbackId).get().catch(() => null);
    if (!r || !r.data) throw new AppError('NOT_FOUND', '反馈不存在');
    const f = r.data;
    const admin = await isFeedbackAdmin(ctx.openid);
    const mine = f.openid === ctx.openid;
    if (!admin && !mine) throw new AppError('NO_PERMISSION', '无权回复该反馈');
    const from = admin && !mine ? 'cs' : 'user';
    const data = {
      replies: _.push([{ from, content: content.slice(0, 1000), time: new Date().toISOString() }]),
      updatedAt: db.serverDate(),
    };
    if (from === 'cs') {
      data.unreadForUser = true;
      if (f.status === 'pending') data.status = 'processing';
    } else {
      data.unreadForAdmin = true;
    }
    await db.collection('feedbacks').doc(p.feedbackId).update({ data });
    return { ok: true };
  },

  // 修改状态：仅管理员
  async setStatus(p, ctx) {
    if (!(await isFeedbackAdmin(ctx.openid))) throw new AppError('NO_PERMISSION', '仅客服可修改状态');
    if (!FEEDBACK_STATUS[p.status]) throw new AppError('INVALID_PARAM', '未知状态');
    await db.collection('feedbacks').doc(p.feedbackId).update({ data: {
      status: p.status, updatedAt: db.serverDate(), unreadForUser: true,
    } });
    return { ok: true, statusLabel: FEEDBACK_STATUS[p.status] };
  },

  // 设置页入口红点：我这一侧的未读工单数
  async unreadCount(_p, ctx) {
    const admin = await isFeedbackAdmin(ctx.openid);
    const where = admin ? { unreadForAdmin: true } : { openid: ctx.openid, unreadForUser: true };
    const c = await db.collection('feedbacks').where(where).count().catch(() => ({ total: 0 }));
    return { count: c.total || 0 };
  },

  // —— 客服团队管理（owner 专属）——
  async listAdmins(_p, ctx) {
    if (!isFeedbackOwner(ctx.openid)) throw new AppError('NO_PERMISSION', '仅 owner 可管理客服团队');
    const r = await db.collection('admins').where({ kind: 'admin' }).orderBy('addedAt', 'asc').get().catch(() => ({ data: [] }));
    const admins = r.data || [];
    const ownerIds = feedbackOwnerIds();
    const ids = [...new Set([...ownerIds, ...admins.map((a) => a.openid)])];
    const names = {};
    if (ids.length) {
      const u = await db.collection('users').where({ _id: _.in(ids) }).get().catch(() => ({ data: [] }));
      (u.data || []).forEach((x) => { names[x._id] = x.nickname || '用户'; });
    }
    return {
      owners: ownerIds.map((o) => ({ openid: o, name: names[o] || '（未登录过）', isMe: o === ctx.openid })),
      admins: admins.map((a) => ({ openid: a.openid, name: names[a.openid] || '用户', addedAt: a.addedAt })),
    };
  },

  // 生成一次性邀请码（24 小时有效），owner 通过微信等渠道发给新客服
  async createAdminInvite(_p, ctx) {
    if (!isFeedbackOwner(ctx.openid)) throw new AppError('NO_PERMISSION', '仅 owner 可邀请客服');
    await db.createCollection('admins').catch(() => {});
    const code = genInviteCode();
    await db.collection('admins').add({ data: {
      kind: 'invite', code, createdBy: ctx.openid, createdAt: db.serverDate(),
      expiresAt: Date.now() + 24 * 3600 * 1000, usedBy: '',
    } });
    return { code, expireHours: 24 };
  },

  // 凭邀请码成为客服（一次性、限时）
  async acceptAdminInvite(p, ctx) {
    const code = (p.code || '').trim().toUpperCase();
    if (!code) throw new AppError('INVALID_PARAM', '请输入邀请码');
    if (await isFeedbackAdmin(ctx.openid)) return { ok: true, already: true };
    const r = await db.collection('admins').where({ kind: 'invite', code }).get().catch(() => ({ data: [] }));
    const inv = (r.data || [])[0];
    if (!inv) throw new AppError('NOT_FOUND', '邀请码不存在');
    if (inv.usedBy) throw new AppError('INVALID_PARAM', '邀请码已被使用');
    if (inv.expiresAt && Date.now() > inv.expiresAt) throw new AppError('INVALID_PARAM', '邀请码已过期');
    await db.collection('admins').add({ data: {
      kind: 'admin', openid: ctx.openid, addedBy: inv.createdBy, addedAt: db.serverDate(),
    } });
    await db.collection('admins').doc(inv._id).update({ data: { usedBy: ctx.openid, usedAt: db.serverDate() } }).catch(() => {});
    return { ok: true };
  },

  // 移除客服：仅 owner；owner 本身在环境变量里，应用内不可能被移除
  async removeAdmin(p, ctx) {
    if (!isFeedbackOwner(ctx.openid)) throw new AppError('NO_PERMISSION', '仅 owner 可移除客服');
    if (isFeedbackOwner(p.openid)) throw new AppError('NO_PERMISSION', 'owner 不可被移除');
    await db.collection('admins').where({ kind: 'admin', openid: p.openid }).remove();
    return { ok: true };
  },
};

// ============================== asr（语音识别 · 腾讯云一句话识别）==============================
// 音频经云存储中转（callFunction 传参有大小上限，直传 base64 会超），云函数下载后
// 用 TC3-HMAC-SHA256 手写签名直调腾讯云 API（不引第三方 SDK，免云端装依赖）。
// 密钥只存云函数环境变量 TENCENT_SECRET_ID / TENCENT_SECRET_KEY；音频识别完立即删除，不留存。
const crypto = require('crypto');
function tc3Request(host, action, version, payload, secretId, secretKey) {
  const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
  const sha256hex = (msg) => crypto.createHash('sha256').update(msg, 'utf8').digest('hex');
  const service = host.split('.')[0];
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonical = ['POST', '/', '', 'content-type:application/json; charset=utf-8', `host:${host}`, '', 'content-type;host', sha256hex(payload)].join('\n');
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, `${date}/${service}/tc3_request`, sha256hex(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac('TC3' + secretKey, date), service), 'tc3_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return new Promise((resolve, reject) => {
    const req = https.request({
      host, method: 'POST', path: '/',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        Host: host,
        Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${service}/tc3_request, SignedHeaders=content-type;host, Signature=${signature}`,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Timestamp': String(timestamp),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('ASR_TIMEOUT')));
    req.write(payload);
    req.end();
  });
}

const asr = {
  // 一句话识别：fileID 指向云存储里的临时 mp3（≤60s）
  async sentence(p) {
    const sid = process.env.TENCENT_SECRET_ID;
    const skey = process.env.TENCENT_SECRET_KEY;
    if (!sid || !skey) throw new AppError('ASR_NOT_CONFIGURED', '语音服务未配置，请手动输入');
    if (!p.fileID) throw new AppError('INVALID_PARAM', '缺少音频文件');
    let buf;
    try {
      const dl = await cloud.downloadFile({ fileID: p.fileID });
      buf = dl.fileContent;
      if (!buf || !buf.length) throw new AppError('INVALID_PARAM', '音频为空，请重试');
      if (buf.length > 3 * 1024 * 1024) throw new AppError('INVALID_PARAM', '录音过长，请分段说');
      const payload = JSON.stringify({
        EngSerViceType: '16k_zh', SourceType: 1, VoiceFormat: 'mp3',
        Data: buf.toString('base64'), DataLen: buf.length,
        UsrAudioKey: 'sense-' + Date.now(),
      });
      const res = await tc3Request('asr.tencentcloudapi.com', 'SentenceRecognition', '2019-06-14', payload, sid, skey);
      const err = res.Response && res.Response.Error;
      if (err) {
        console.error('[asr]', err.Code, err.Message);
        // 额度/欠费类 → 明确告知；鉴权类 → 配置问题；其余统一「重试」
        if (/NoFreeAmount|Arrears|Isolate|ResourceInsufficient|ResourcesSoldOut|PackageExhausted/i.test(err.Code)) {
          throw new AppError('ASR_QUOTA', '本月语音识别额度已用完，请手动输入');
        }
        if (/AuthFailure|Signature|SecretId/i.test(err.Code)) {
          throw new AppError('ASR_AUTH', '语音服务配置异常，请手动输入');
        }
        throw new AppError('ASR_FAIL', '识别失败，请重试或手动输入');
      }
      return { text: (res.Response && res.Response.Result) || '' };
    } finally {
      // 临时音频用完即删，失败也不留存
      await cloud.deleteFile({ fileIdList: [p.fileID] }).catch(() => {});
    }
  },
};

// ============================== seed（演示数据 · 与用户真实数据隔离）==============================
// 演示文档全部带 seed:true + seedBy:<openid>，id 带用户后缀：多用户互不覆盖，
// 载入不触碰调用者的用户资料与真实账本，清除只清「自己的」演示数据。
const SEED_COLLECTIONS = ['records', 'categories', 'members', 'aiMessages', 'books', 'users', 'feedbacks'];
async function clearSeedData(openid) {
  const result = {};
  const wipe = async (c, where) => {
    let removed = 0;
    for (let guard = 0; guard < 200; guard++) { // 单次 remove 有批量上限，循环删空
      const r = await db.collection(c).where(where).remove().catch(() => null);
      const n = r && r.stats ? r.stats.removed : 0;
      if (!n) break;
      removed += n;
    }
    return removed;
  };
  for (const c of SEED_COLLECTIONS) {
    await db.createCollection(c).catch(() => {});
    // 自己的演示数据 + 无归属的旧版演示数据（固定 id 时代的共享残留，顺带自愈清理）
    result[c] = await wipe(c, { seed: true, seedBy: openid })
      + await wipe(c, { seed: true, seedBy: _.exists(false) });
  }
  // 用户在演示账本里手动记的账/会话/自建分类没有 seed 标记——按演示账本 id 清孤儿
  // （含旧版固定 id 的两个账本）
  const bookIds = SEED.seedBookIds(openid).concat(['seed-book-share', 'seed-book-split']);
  for (const c of ['records', 'aiMessages', 'categories', 'chartLayouts', 'members', 'settlements']) {
    await db.createCollection(c).catch(() => {});
    result[c] = (result[c] || 0) + await wipe(c, { bookId: _.in(bookIds) });
  }
  return result;
}
const seed = {
  // 载入演示数据：先清掉旧演示数据再插入。不改用户资料、不碰真实账本。
  async run(_p, ctx) {
    if (!isDevUser(ctx.openid)) {
      throw new AppError('NO_PERMISSION', '非开发者禁止初始化演示数据');
    }
    await clearSeedData(ctx.openid);
    const data = SEED.build(ctx.openid);
    const counts = {};
    for (const c of Object.keys(data)) {
      const list = data[c] || [];
      counts[c] = list.length;
      const withId = list.filter((d) => d._id);
      const noId = list.filter((d) => !d._id);
      for (let i = 0; i < withId.length; i += 20) {
        await Promise.all(withId.slice(i, i + 20).map((doc) => {
          const id = doc._id; const d2 = { ...doc }; delete d2._id;
          return db.collection(c).doc(id).set({ data: d2 }).catch((e) => { console.error(c, id, e); });
        }));
      }
      for (let i = 0; i < noId.length; i += 100) {
        await db.collection(c).add({ data: noId.slice(i, i + 100) }).catch((e) => { console.error(c, e); });
      }
    }
    return { ok: true, counts };
  },

  // 清除演示数据（只删自己的 seed 数据，他人与真实数据不受影响）
  async clear(_p, ctx) {
    if (!isDevUser(ctx.openid)) throw new AppError('NO_PERMISSION', '非开发者禁止操作');
    const result = await clearSeedData(ctx.openid);
    return { ok: true, result };
  },

  // 按渠道清理测试数据：删除开发版/体验版创建的账本（级联记录/成员/分类/布局/AI 会话/图片）与反馈工单。
  // 只允许 develop/trial，release 永远删不到；users 不删——同一 openid 在各渠道是同一个人，按渠道删用户会误伤真实账号。
  async purgeChannel(p, ctx) {
    if (!isDevUser(ctx.openid)) throw new AppError('NO_PERMISSION', '非开发者禁止操作');
    const channels = (Array.isArray(p.channels) ? p.channels : [p.channels])
      .filter((c) => ['develop', 'trial'].includes(c));
    if (!channels.length) throw new AppError('INVALID_PARAM', '仅允许清理 develop / trial 渠道');
    const result = { books: 0, feedbacks: 0 };
    // 账本：逐本级联解散（dissolveBook 连图片一起删），循环取批直到无匹配
    for (let guard = 0; guard < 200; guard++) {
      const r = await db.collection('books').where({ channel: _.in(channels) }).limit(20).get().catch(() => ({ data: [] }));
      if (!r.data.length) break;
      for (const b of r.data) { await dissolveBook(b._id); result.books++; }
    }
    // 反馈工单：先删截图文件再删文档（删完文档就找不到 fileID 了）
    for (let guard = 0; guard < 200; guard++) {
      const r = await db.collection('feedbacks').where({ channel: _.in(channels) }).limit(50).get().catch(() => ({ data: [] }));
      if (!r.data.length) break;
      const imgs = [];
      r.data.forEach((f) => (f.images || []).forEach((x) => imgs.push(x)));
      await deleteFiles(imgs);
      await db.collection('feedbacks').where({ _id: _.in(r.data.map((f) => f._id)) }).remove().catch(() => {});
      result.feedbacks += r.data.length;
    }
    return result;
  },

  // 清空全部数据（含用户，需重新登录），回到干净测试状态。
  // 云存储一并清：先趁数据还在，把各集合引用的 fileID 全收集起来（删完库就找不到了）。
  async reset(_p, ctx) {
    // 单闸：只认 owner 身份（服务端 openid，不可伪造）。前端另有两段式确认兜误触。
    if (!isDevUser(ctx.openid)) {
      throw new AppError('NO_PERMISSION', '仅 owner 本人可清空全库');
    }
    const fileIDs = [];
    const collect = async (coll, pick) => {
      for (let skip = 0; ; skip += 1000) {
        const r = await db.collection(coll).skip(skip).limit(1000).get().catch(() => ({ data: [] }));
        (r.data || []).forEach(pick);
        if ((r.data || []).length < 1000) break;
      }
    };
    await collect('users', (d) => { if (d.avatarFileID) fileIDs.push(d.avatarFileID); });        // 头像
    await collect('records', (d) => { (d.images || []).forEach((f) => fileIDs.push(f)); });      // 记录图片
    await collect('feedbacks', (d) => { (d.images || []).forEach((f) => fileIDs.push(f)); });    // 反馈截图
    await collect('aiMessages', (d) => { if (d.fileID) fileIDs.push(d.fileID); });               // 收据图
    await collect('files', (d) => { if (d.fileID) fileIDs.push(d.fileID); });                    // 导出文件台账
    const filesRemoved = await deleteFiles(fileIDs);
    const result = {};
    for (const c of COLLECTIONS) { // 全部集合，含 users
      await db.createCollection(c).catch(() => {});
      const removed = await clearCollection(c);
      const left = await db.collection(c).where({ _id: _.exists(true) }).count().catch(() => ({ total: -1 }));
      result[c] = { removed, remaining: left.total };
    }
    return { ok: true, result, filesRemoved };
  },
};

module.exports = { book, member, category, record, rate, stats, layout, ai, settings, user, data, settle, feedback, asr, seed };
