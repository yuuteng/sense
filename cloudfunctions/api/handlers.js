const {
  cloud, db, _, AppError, getMember, requireMember, requireRole, getRate, round2,
  membersMap, categoriesMap, topCategory, IS_DEV,
} = require('./lib');
const SEED = require('./seedData');
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

// —— 工具 ——
async function getUser(openid) {
  const r = await db.collection('users').doc(openid).get().catch(() => null);
  return r && r.data ? r.data : null;
}
async function ensureUser(openid) {
  let u = await getUser(openid);
  if (!u) {
    u = { _id: openid, openid, nickname: '我', avatarColor: '#00ccf9', avatarInitial: '我', avatarFileID: '', registered: false, defaultBookId: '', settings: { displayCurrency: 'CNY', aiMessageLimit: 50 }, createdAt: db.serverDate() };
    await db.collection('users').doc(openid).set({ data: u }).catch(() => {});
  }
  return u;
}
const COLLECTIONS = ['users', 'books', 'members', 'categories', 'records', 'rates', 'chartLayouts', 'aiMessages'];
async function ensureCollections() {
  for (const c of COLLECTIONS) { await db.createCollection(c).catch(() => {}); }
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
    { name: '职业收入', icon: 'income', subs: ['工资', '奖金', '补贴'] },
    { name: '其他收入', icon: 'dots', subs: ['红包', '理财', '退款'] },
  ],
};
async function seedDefaultCategories(bookId) {
  for (const kind of ['expense', 'income']) {
    let order = 1;
    for (const c of DEFAULT_CATS[kind]) {
      const p = await db.collection('categories').add({ data: { bookId, kind, parentId: null, name: c.name, icon: c.icon, order: order++, disabled: false } });
      let so = 1;
      for (const s of c.subs) {
        await db.collection('categories').add({ data: { bookId, kind, parentId: p._id, name: s, icon: null, order: so++, disabled: false } });
      }
    }
  }
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
    if (r > 0) quotes[c] = c === base ? 1 : round6(1 / r); // 1 单位外币 = ? 基准币
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
    const user = await ensureUser(ctx.openid);
    let bookId = user.defaultBookId;
    if (!bookId) {
      const m = await db.collection('members').where({ openid: ctx.openid }).limit(1).get();
      bookId = m.data[0] && m.data[0].bookId;
    }
    if (!bookId) return null;
    const b = await db.collection('books').doc(bookId).get().catch(() => null);
    if (!b || !b.data) return null;
    const member = await getMember(bookId, ctx.openid);
    return {
      bookId, name: b.data.name, type: b.data.type, baseCurrency: b.data.baseCurrency,
      displayCurrency: (user.settings && user.settings.displayCurrency) || b.data.baseCurrency,
      myRole: member && member.role,
    };
  },

  async create(p, ctx) {
    // 账本类型走 bookType（避免与路由字段 type 冲突）
    const bookType = p.bookType === 'split' ? 'split' : 'share';
    if (!p.name || !p.baseCurrency) throw new AppError('INVALID_PARAM', '缺少账本参数');
    await ensureCollections();
    const add = await db.collection('books').add({ data: {
      name: p.name, type: bookType, baseCurrency: p.baseCurrency, ownerOpenid: ctx.openid, memberCount: 1, createdAt: db.serverDate(),
    } });
    const bookId = add._id;
    const user = await ensureUser(ctx.openid);
    await db.collection('members').add({ data: {
      bookId, openid: ctx.openid, avatarColor: user.avatarColor,
      role: 'owner', joinedAt: db.serverDate(), status: 'active',
    } });
    if (!user.defaultBookId) await db.collection('users').doc(ctx.openid).update({ data: { defaultBookId: bookId } });
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
    for (const c of ['records', 'members', 'categories', 'chartLayouts', 'aiMessages']) {
      await db.collection(c).where({ bookId: p.bookId }).remove().catch(() => {});
    }
    await db.collection('books').doc(p.bookId).remove().catch(() => {});
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
  // 通过分享卡片加入账本（默认读写权限）
  async join(p, ctx) {
    const b = await db.collection('books').doc(p.bookId).get().catch(() => null);
    if (!b || !b.data) throw new AppError('NOT_FOUND', '账本不存在或已解散');
    const existing = await getMember(p.bookId, ctx.openid);
    if (existing) return { ok: true, bookId: p.bookId, name: b.data.name, already: true };
    const u = await ensureUser(ctx.openid);
    await db.collection('members').add({ data: {
      bookId: p.bookId, openid: ctx.openid, avatarColor: u.avatarColor,
      role: 'rw', joinedAt: db.serverDate(), status: 'active',
    } });
    await db.collection('books').doc(p.bookId).update({ data: { memberCount: _.inc(1) } }).catch(() => {});
    return { ok: true, bookId: p.bookId, name: b.data.name };
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
    const [records, mMap, cMap, bk] = await Promise.all([
      fetchBookRecords(p.bookId), membersMap(p.bookId), categoriesMap(p.bookId),
      db.collection('books').doc(p.bookId).get().catch(() => null),
    ]);
    const base = (bk && bk.data && bk.data.baseCurrency) || 'CNY';
    const display = p.currency || base;      // 前端传来的展示币种
    const f = await convFactor(base, display);
    const groupsMap = {};
    const order = [];
    records.forEach((rec) => {
      if (!groupsMap[rec.date]) { groupsMap[rec.date] = { date: rec.date, total: 0, items: [] }; order.push(rec.date); }
      const g = groupsMap[rec.date];
      const conv = round2(rec.amountConverted * f);   // 换算到展示币种
      const signed = rec.type === 'income' ? conv : -conv;
      g.total = round2(g.total + signed);
      const rec2 = mMap[rec.recorderOpenid] || {};
      const pay = mMap[rec.payerOpenid] || {};
      const top = topCategory(cMap, rec.categoryId);
      g.items.push({
        recordId: rec._id, type: rec.type, title: rec.title || rec.categoryPath,
        amountConverted: conv, currency: rec.currency, originalAmount: rec.amount,
        isForeign: rec.currency !== rec.baseCurrency, date: rec.date,
        recorderName: rec2.name || '', recorderInitial: rec2.initial || '', recorderColor: rec2.color || '#00ccf9', recorderAvatar: rec2.avatarFileID || '',
        payerName: pay.name || '', sameActor: rec.recorderOpenid === rec.payerOpenid,
        categoryTopName: top.name, icon: top.icon,
      });
    });
    return { groups: order.map((d) => groupsMap[d]), hasMore: false, displayCurrency: display };
  },

  async get(p, ctx) {
    const r = await db.collection('records').doc(p.recordId).get().catch(() => null);
    if (!r || !r.data) throw new AppError('NOT_FOUND', '记录不存在');
    const rec = r.data;
    const me = await requireMember(rec.bookId, ctx.openid);
    const [mMap, cMap, bk] = await Promise.all([
      membersMap(rec.bookId), categoriesMap(rec.bookId),
      db.collection('books').doc(rec.bookId).get().catch(() => null),
    ]);
    const isSplit = !!(bk && bk.data && bk.data.type === 'split');
    const rec2 = mMap[rec.recorderOpenid] || {};
    const pay = mMap[rec.payerOpenid] || {};
    const top = topCategory(cMap, rec.categoryId);
    const canEdit = rec.recorderOpenid === ctx.openid || me.role === 'admin' || me.role === 'owner';
    return {
      recordId: rec._id, type: rec.type, typeLabel: rec.type === 'income' ? '收入' : '支出', icon: top.icon, isSplit,
      categoryId: rec.categoryId, payerOpenid: rec.payerOpenid, split: rec.split || null,
      title: rec.title || rec.categoryPath, category: rec.categoryPath, date: rec.date,
      amount: rec.amount, currency: rec.currency, rate: rec.rate, amountConverted: rec.amountConverted, baseCurrency: rec.baseCurrency,
      isForeign: rec.currency !== rec.baseCurrency, note: rec.note || '', images: rec.images || [],
      recorder: { name: rec2.name, initial: rec2.initial, color: rec2.color, avatarFileID: rec2.avatarFileID || '' },
      payer: { name: pay.name || '', initial: pay.initial, color: pay.color, avatarFileID: pay.avatarFileID || '' },
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
    const amountConverted = round2(payload.amount * rate);
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
      data.rate = rate; data.amountConverted = round2(amt * rate);
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
    let r = await db.collection('rates').where({ date: p.date, base }).get();
    let doc = r.data[0]; let isFallback = false;
    if (!doc) {
      const q = await db.collection('rates').where({ base, date: _.lte(p.date) }).orderBy('date', 'desc').limit(1).get();
      doc = q.data[0]; isFallback = true;
    }
    if (!doc) return { date: p.date, base, quotes: { [base]: 1 }, isFallback: true };
    return { date: doc.date, base, quotes: doc.quotes, isFallback };
  },
  // 实际拉取逻辑（供手动按钮与每日定时触发器共用）
  async _refresh() {
    const { date, quotes } = await fetchAndStoreCnyQuotes();
    return { date, count: Object.keys(quotes).length };
  },
  // 手动刷新（dev 模式，设置页按钮）
  async refresh(_p) {
    if (!IS_DEV) throw new AppError('NO_PERMISSION', '非 dev 模式禁止刷新汇率');
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
const stats = {
  async _compute(bookId, ctx) {
    const [records, b, u] = await Promise.all([
      fetchBookRecords(bookId), db.collection('books').doc(bookId).get(),
      ctx ? getUser(ctx.openid) : Promise.resolve(null),
    ]);
    const base = b.data.baseCurrency;
    const display = (u && u.settings && u.settings.displayCurrency) || base;
    const f = await convFactor(base, display);
    const conv = (x) => round2(x * f);
    const curMonth = relDate(0).slice(0, 7); // 本月（北京时间）
    let mIncome = 0, mExpense = 0, tIncome = 0, tExpense = 0;
    records.forEach((r) => {
      const v = r.amountConverted;
      if (r.type === 'income') { tIncome += v; if (monthOf(r.date) === curMonth) mIncome += v; }
      else { tExpense += v; if (monthOf(r.date) === curMonth) mExpense += v; }
    });
    const [y, m] = curMonth.split('-');
    return {
      displayCurrency: display,
      overview: { income: conv(mIncome), expense: conv(mExpense), balance: conv(mIncome - mExpense), monthLabel: `${y} 年 ${parseInt(m, 10)} 月` },
      total: { income: conv(tIncome), expense: conv(tExpense), balance: conv(tIncome - tExpense), since: monthOf(b.data.createdAt instanceof Date ? b.data.createdAt.toISOString() : b.data.createdAt) },
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
  // 四张图表的真实数据（均换算到展示币种）
  async getCharts(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const [records, b, u] = await Promise.all([
      fetchBookRecords(p.bookId), db.collection('books').doc(p.bookId).get(), getUser(ctx.openid),
    ]);
    const base = b.data.baseCurrency;
    const display = (u && u.settings && u.settings.displayCurrency) || base;
    const f = await convFactor(base, display);
    const conv = (x) => round2(x * f);
    const curMonth = relDate(0).slice(0, 7);
    // 可配置区间：近 N 日 / 近 N 月
    const weekN = Math.min(60, Math.max(2, Number(p.weekDays) || 7));
    const yearN = Math.min(24, Math.max(2, Number(p.yearMonths) || 12));
    const days = []; for (let i = weekN - 1; i >= 0; i--) days.push(relDate(-i));
    const weekMap = {}; days.forEach((d) => { weekMap[d] = 0; });
    const months = lastNMonths(yearN);
    const ymIn = {}, ymOut = {}; months.forEach((x) => { ymIn[x.ym] = 0; ymOut[x.ym] = 0; });
    let mIncome = 0, mExpense = 0, tIncome = 0, tExpense = 0;
    records.forEach((r) => {
      const v = r.amountConverted; const ym = monthOf(r.date);
      if (r.type === 'income') {
        tIncome += v; if (ym === curMonth) mIncome += v; if (ymIn[ym] != null) ymIn[ym] += v;
      } else {
        tExpense += v; if (ym === curMonth) mExpense += v; if (ymOut[ym] != null) ymOut[ym] += v;
        if (weekMap[r.date] != null) weekMap[r.date] += v;
      }
    });
    const [, mm] = curMonth.split('-');
    return {
      displayCurrency: display,
      monthLabel: `${parseInt(mm, 10)} 月`,
      weekDays: weekN, yearMonths: yearN,
      monthPie: { income: conv(mIncome), expense: conv(mExpense) },
      weekExpense: days.map((d) => ({ date: d, label: d.slice(5).replace('-', '/'), value: conv(weekMap[d]) })),
      yearInOut: months.map((x) => ({ month: x.ym, label: x.label, income: conv(ymIn[x.ym]), expense: conv(ymOut[x.ym]) })),
      totalPie: { income: conv(tIncome), expense: conv(tExpense) },
    };
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
function parseNL(text) {
  const t = text || '';
  const m = t.match(/(\d+(\.\d+)?)/);
  const amt = m ? parseFloat(m[1]) : 0;
  // 收/支判定：命中收入关键词则为收入
  const isIncome = /工资|薪水|薪资|奖金|收入|红包|退款|报销|返现|理财|利息|分红|中奖|收款|进账/.test(t);
  const type = isIncome ? 'income' : 'expense';
  let cat = isIncome ? '其他收入' : '其他';
  if (isIncome) {
    if (/工资|薪水|薪资/.test(t)) cat = '职业收入 / 工资';
    else if (/奖金/.test(t)) cat = '职业收入 / 奖金';
    else if (/补贴/.test(t)) cat = '职业收入 / 补贴';
    else if (/红包/.test(t)) cat = '其他收入 / 红包';
    else if (/理财|利息|分红/.test(t)) cat = '其他收入 / 理财';
    else if (/退款|报销|返现/.test(t)) cat = '其他收入 / 退款';
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
  // 日期：相对今天（北京时间）
  const date = relDate(/前天/.test(t) ? -2 : /昨天/.test(t) ? -1 : /明天/.test(t) ? 1 : 0);
  return { amt, cat, date, type };
}
const ai = {
  async listMessages(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const r = await db.collection('aiMessages').where({ bookId: p.bookId, openid: ctx.openid }).orderBy('createdAt', 'asc').limit(200).get();
    return r.data;
  },
  async ask(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    return { answer: '我基于本账本真实数据回答，不编造数字。可以问我某月某分类合计、谁花得最多，或说一句「昨天打车 35」帮你记账。' };
  },
  async parseText(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid); requireRole(me, 'rw');
    const rec = parseNL(p.text);
    if (rec.amt <= 0) return { card: null, answer: '没识别到金额，换种说法试试～' };
    const mMap = await membersMap(p.bookId);
    const myName = (mMap[ctx.openid] && mMap[ctx.openid].name) || '我';
    return { card: { kind: '自然语言记账', state: 'pending', rows: [
      { k: '类型', v: rec.type === 'income' ? '收入' : '支出' }, { k: '金额', v: '¥' + rec.amt.toFixed(2) },
      { k: '分类', v: rec.cat, edit: true }, { k: '日期', v: rec.date }, { k: '记录人', v: myName },
    ] } };
  },
  async parseReceipt(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid); requireRole(me, 'rw');
    const mMap = await membersMap(p.bookId);
    const myName = (mMap[ctx.openid] && mMap[ctx.openid].name) || '我';
    return { card: { kind: '收据识别', state: 'pending', rows: [
      { k: '类型', v: '支出' }, { k: '金额', v: '¥56.00' },
      { k: '分类', v: '餐饮 / 外卖', edit: true }, { k: '日期', v: relDate(0) }, { k: '记录人', v: myName },
    ] } };
  },
  async appendMessage(p, ctx) {
    const user = await requireMember(p.bookId, ctx.openid) && await getUser(ctx.openid);
    const limit = (user && user.settings && user.settings.aiMessageLimit) || 50;
    await db.collection('aiMessages').add({ data: { ...p.message, bookId: p.bookId, openid: ctx.openid, createdAt: db.serverDate() } });
    const all = await db.collection('aiMessages').where({ bookId: p.bookId, openid: ctx.openid }).orderBy('createdAt', 'asc').limit(500).get();
    const extra = all.data.length - limit;
    for (let i = 0; i < extra; i++) await db.collection('aiMessages').doc(all.data[i]._id).remove().catch(() => {});
    return { ok: true };
  },
};

// ============================== settings / user ==============================
const settings = {
  async get(_p, ctx) {
    const u = await ensureUser(ctx.openid);
    return { displayCurrency: u.settings.displayCurrency, aiMessageLimit: u.settings.aiMessageLimit };
  },
  async update(p, ctx) {
    const u = await ensureUser(ctx.openid);
    const s = { ...u.settings };
    if (p.displayCurrency) s.displayCurrency = p.displayCurrency;
    if (p.aiMessageLimit) s.aiMessageLimit = p.aiMessageLimit;
    await db.collection('users').doc(ctx.openid).update({ data: { settings: s } });
    return { ok: true };
  },
};
const user = {
  async getProfile(_p, ctx) {
    const u = await ensureUser(ctx.openid);
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
      avatarFileID: u.avatarFileID || '', registered: !!u.registered, isDev: IS_DEV,
      bookCount, defaultBookName, defaultBookId: u.defaultBookId || '',
    };
  },

  // 微信授权登录：写入头像/昵称，标记已注册。
  // 名字/头像各处实时取自 users，改这里即全站更新，无需再逐账本同步。
  async login(p, ctx) {
    await ensureCollections();
    await ensureUser(ctx.openid);
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
};

// ============================== data（导入导出）==============================
function exportRows(records, mMap) {
  return records.map((r) => ({
    日期: r.date,
    类型: r.type === 'income' ? '收入' : '支出',
    标题: r.title || '',
    分类: r.categoryPath || '',
    原始金额: r.amount,
    币种: r.currency,
    换算金额: r.amountConverted,
    备注: r.note || '',
    记录人: (mMap[r.recorderOpenid] || {}).name || '',
    付款人: (mMap[r.payerOpenid] || {}).name || '',
  }));
}
function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [headers.join(',')];
  rows.forEach((r) => lines.push(headers.map((h) => esc(r[h])).join(',')));
  return lines.join('\r\n');
}

const data = {
  // 导出：生成文件并上传云存储，返回 fileID 供前端下载/预览/转发
  async export(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const fmt = p.format || 'json';
    const b = await db.collection('books').doc(p.bookId).get();
    const [records, mMap] = await Promise.all([fetchBookRecords(p.bookId), membersMap(p.bookId)]);
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
      throw new AppError('PDF_NOT_READY', 'PDF 报表（含中文字体）开发中，建议先用 Excel/CSV 导出');
    } else {
      throw new AppError('INVALID_PARAM', '不支持的导出格式');
    }

    const up = await cloud.uploadFile({
      cloudPath: `exports/${p.bookId}-${Date.now()}.${ext}`,
      fileContent,
    });
    return { fileID: up.fileID, fileName: `${safeName}-${stamp}.${ext}`, fileType: ext, count: rows.length };
  },

  // 导入：解析导出格式的 records，写入当前账本（记录人=导入者）
  async import(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid); requireRole(me, 'rw');
    let obj = p.content;
    if (typeof obj === 'string') { try { obj = JSON.parse(obj); } catch (e) { throw new AppError('INVALID_PARAM', 'JSON 解析失败'); } }
    const rows = (obj && obj.records) || (Array.isArray(obj) ? obj : []);
    if (!rows.length) return { success: 0, failed: 0, reasons: ['未找到可导入的记录'] };
    const b = await db.collection('books').doc(p.bookId).get();
    const base = b.data.baseCurrency;
    const cMap = await categoriesMap(p.bookId);
    // 名称→分类 id（用 categoryPath 末级名匹配，匹配不到则归“其他”）
    const byName = {};
    Object.values(cMap).forEach((c) => { byName[c.name] = c._id; });
    let success = 0, failed = 0; const reasons = [];
    for (const row of rows) {
      try {
        const amount = Number(row.amount);
        if (!amount || amount <= 0) throw new Error('金额无效');
        const currency = row.currency || base;
        let rate = row.rate;
        if (rate == null) { rate = (await getRate(row.date || new Date().toISOString().slice(0, 10), base, currency)).rate; }
        const leaf = (row.categoryPath || '').split('/').pop().trim();
        const categoryId = byName[leaf] || null;
        await db.collection('records').add({ data: {
          bookId: p.bookId, type: row.type === 'income' ? 'income' : 'expense',
          title: row.title || leaf || '导入记录', amount, currency, rate, baseCurrency: base,
          amountConverted: row.amountConverted != null ? row.amountConverted : round2(amount * rate),
          categoryId, categoryPath: row.categoryPath || leaf || '其他', date: row.date || new Date().toISOString().slice(0, 10),
          note: row.note || '', images: [], recorderOpenid: ctx.openid, payerOpenid: ctx.openid, split: null, createdAt: db.serverDate(),
        } });
        success++;
      } catch (e) { failed++; reasons.push(`第 ${success + failed} 条：${e.message}`); }
    }
    return { success, failed, reasons: reasons.slice(0, 5) };
  },
};

// ============================== settle（P2）==============================
const settle = {
  async get(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const [records, mMap] = await Promise.all([fetchBookRecords(p.bookId), membersMap(p.bookId)]);
    const paid = {}, share = {};
    Object.keys(mMap).forEach((o) => { paid[o] = 0; share[o] = 0; });
    let totalExpense = 0;
    records.forEach((r) => {
      if (r.type !== 'expense') return;
      totalExpense += r.amountConverted;
      paid[r.payerOpenid] = (paid[r.payerOpenid] || 0) + r.amountConverted;
      (r.split && r.split.members ? r.split.members : []).forEach((sm) => { share[sm.openid] = (share[sm.openid] || 0) + (sm.share || 0); });
    });
    const net = {};
    Object.keys(mMap).forEach((o) => { net[o] = round2((paid[o] || 0) - (share[o] || 0)); });
    // 最少转账
    const creditors = Object.keys(net).filter((o) => net[o] > 0).map((o) => ({ o, v: net[o] })).sort((a, b) => b.v - a.v);
    const debtors = Object.keys(net).filter((o) => net[o] < 0).map((o) => ({ o, v: -net[o] })).sort((a, b) => b.v - a.v);
    const transfers = []; let i = 0, j = 0, tid = 1;
    while (i < debtors.length && j < creditors.length) {
      const amt = round2(Math.min(debtors[i].v, creditors[j].v));
      if (amt > 0.001) {
        transfers.push({ transferId: 't' + (tid++), from: mMap[debtors[i].o].name, to: mMap[creditors[j].o].name,
          fromInitial: mMap[debtors[i].o].initial, fromColor: mMap[debtors[i].o].color, fromAvatar: mMap[debtors[i].o].avatarFileID || '',
          toInitial: mMap[creditors[j].o].initial, toColor: mMap[creditors[j].o].color, toAvatar: mMap[creditors[j].o].avatarFileID || '', amount: amt, settled: false });
      }
      debtors[i].v -= amt; creditors[j].v -= amt;
      if (debtors[i].v < 0.001) i++; if (creditors[j].v < 0.001) j++;
    }
    const me = ctx.openid;
    const splits = records.filter((r) => r.type === 'expense').map((r) => {
      const sp = r.split || { mode: 'even', members: [] };
      const n = sp.members.length || 1;
      let detail;
      if (sp.mode === 'treat') detail = `仅${(mMap[r.payerOpenid] || {}).name || ''}承担`;
      else if (sp.mode === 'even') detail = `${n} 人均摊 · 各 ¥${round2(r.amountConverted / n)}`;
      else detail = `${n} 人分摊`;
      return {
        title: r.title || r.categoryPath, amount: r.amountConverted,
        payerName: `${(mMap[r.payerOpenid] || {}).name || ''}垫付`, detail,
        isForeign: r.currency !== r.baseCurrency, fx: r.currency !== r.baseCurrency ? `${r.amount} ${r.currency}` : '',
        avatars: sp.members.map((m) => ({ initial: (mMap[m.openid] || {}).initial || '?', color: (mMap[m.openid] || {}).color || '#999', avatarFileID: (mMap[m.openid] || {}).avatarFileID || '' })),
      };
    });
    return {
      summary: { myNet: net[me] || 0, totalExpense: round2(totalExpense), myPaid: round2(paid[me] || 0), myShare: round2(share[me] || 0) },
      transfers,
      members: Object.keys(mMap).map((o) => ({ name: mMap[o].name + (o === me ? '（我）' : ''), initial: mMap[o].initial, color: mMap[o].color, avatarFileID: mMap[o].avatarFileID || '', paid: round2(paid[o] || 0), share: round2(share[o] || 0), net: net[o] || 0 })),
      splits, splitCount: splits.length,
    };
  },
  async markTransfer(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    return { ok: true }; // 结清方案为实时计算，标记状态由前端本地保留（P2 可落库）
  },
};

// ============================== seed（初始化测试数据）==============================
const DATE_KEYS = ['createdAt', 'joinedAt', 'updatedAt'];
function reviveDates(obj) {
  DATE_KEYS.forEach((k) => { if (typeof obj[k] === 'string') obj[k] = new Date(obj[k]); });
  return obj;
}
const seed = {
  async run(_p, ctx) {
    if (!IS_DEV) {
      throw new AppError('NO_PERMISSION', '当前非 dev 模式，禁止初始化。请在云开发控制台把云函数 api 的环境变量 APP_ENV 设为 dev 后重试。');
    }
    const me = ctx.openid;
    const collections = ['users', 'books', 'members', 'categories', 'records', 'rates', 'chartLayouts', 'aiMessages'];
    // 确保集合存在
    for (const c of collections) { await db.createCollection(c).catch(() => {}); }
    // 清空
    for (const c of collections) { await db.collection(c).where({ _id: _.exists(true) }).remove().catch(() => {}); }
    // 逐集合插入（openid-yu → 当前用户）
    const counts = {};
    for (const c of collections) {
      const list = SEED[c] || [];
      counts[c] = 0;
      for (const raw of list) {
        const doc = reviveDates(JSON.parse(JSON.stringify(raw).split('openid-yu').join(me)));
        const id = doc._id; delete doc._id;
        if (id) await db.collection(c).doc(id).set({ data: doc }).catch((e) => { console.error(c, e); });
        else await db.collection(c).add({ data: doc }).catch((e) => { console.error(c, e); });
        counts[c]++;
      }
    }
    return { ok: true, me, counts };
  },

  // 清空全部数据（含用户，需重新登录），回到干净测试状态（dev）
  async reset(_p, ctx) {
    if (!IS_DEV) throw new AppError('NO_PERMISSION', '非 dev 模式禁止清空数据');
    for (const c of COLLECTIONS) { // 全部 8 个集合，含 users
      await db.createCollection(c).catch(() => {});
      await db.collection(c).where({ _id: _.exists(true) }).remove().catch(() => {});
    }
    return { ok: true };
  },
};

module.exports = { book, member, category, record, rate, stats, layout, ai, settings, user, data, settle, seed };
