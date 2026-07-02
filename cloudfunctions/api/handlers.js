const {
  db, _, AppError, getMember, requireMember, requireRole, getRate, round2,
  membersMap, categoriesMap, topCategory, IS_DEV,
} = require('./lib');
const SEED = require('./seedData');

// —— 工具 ——
async function getUser(openid) {
  const r = await db.collection('users').doc(openid).get().catch(() => null);
  return r && r.data ? r.data : null;
}
async function ensureUser(openid) {
  let u = await getUser(openid);
  if (!u) {
    u = { _id: openid, openid, nickname: '我', avatarColor: '#2f6feb', avatarInitial: '我', avatarFileID: '', registered: false, defaultBookId: '', settings: { displayCurrency: 'CNY', aiMessageLimit: 50 }, createdAt: db.serverDate() };
    await db.collection('users').doc(openid).set({ data: u }).catch(() => {});
  }
  return u;
}
const COLLECTIONS = ['users', 'books', 'members', 'categories', 'records', 'rates', 'chartLayouts', 'aiMessages'];
async function ensureCollections() {
  for (const c of COLLECTIONS) { await db.createCollection(c).catch(() => {}); }
}
async function fetchBookRecords(bookId) {
  const r = await db.collection('records').where({ bookId }).orderBy('date', 'desc').orderBy('createdAt', 'desc').limit(1000).get();
  return r.data;
}
function monthOf(dateStr) { return (dateStr || '').slice(0, 7); }

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
      bookId: b._id, name: b.name, type: b.type, typeLabel: b.type === 'split' ? '分账结算型' : '共享可见型',
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
    if (!p.name || !p.type || !p.baseCurrency) throw new AppError('INVALID_PARAM', '缺少账本参数');
    await ensureCollections();
    const add = await db.collection('books').add({ data: {
      name: p.name, type: p.type, baseCurrency: p.baseCurrency, ownerOpenid: ctx.openid, memberCount: 1, createdAt: db.serverDate(),
    } });
    const bookId = add._id;
    const user = await ensureUser(ctx.openid);
    await db.collection('members').add({ data: {
      bookId, openid: ctx.openid, nameCache: user.nickname, avatarColor: user.avatarColor, avatarInitial: user.avatarInitial,
      role: 'owner', joinedAt: db.serverDate(), status: 'active',
    } });
    if (!user.defaultBookId) await db.collection('users').doc(ctx.openid).update({ data: { defaultBookId: bookId } });
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
    const r = await db.collection('members').where({ bookId: p.bookId, status: _.neq('removed') }).get();
    return r.data.map((m) => ({
      openid: m.openid, name: m.nameCache, avatarInitial: m.avatarInitial, avatarColor: m.avatarColor,
      role: m.role, joinedAt: m.joinedAt, isMe: m.openid === ctx.openid,
    }));
  },
  async invite(p, ctx) {
    const m = await requireMember(p.bookId, ctx.openid); requireRole(m, 'admin');
    return { inviteToken: p.bookId, expireAt: null };
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
  // 修改「我」在某账本内的名字
  async rename(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid);
    const name = (p.name || '').trim();
    if (!name) throw new AppError('INVALID_PARAM', '名字不能为空');
    await db.collection('members').doc(me._id).update({ data: { nameCache: name, avatarInitial: name.slice(0, 1) } });
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
    const m = await requireMember(p.bookId, ctx.openid); requireRole(m, 'admin');
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
    const m = await requireMember(p.bookId, ctx.openid); requireRole(m, 'admin');
    await db.collection('categories').doc(p.categoryId).update({ data: { disabled: true } });
    return { ok: true };
  },
};

// ============================== record ==============================
const record = {
  async list(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const [records, mMap, cMap] = await Promise.all([
      fetchBookRecords(p.bookId), membersMap(p.bookId), categoriesMap(p.bookId),
    ]);
    const groupsMap = {};
    const order = [];
    records.forEach((rec) => {
      if (!groupsMap[rec.date]) { groupsMap[rec.date] = { date: rec.date, total: 0, items: [] }; order.push(rec.date); }
      const g = groupsMap[rec.date];
      const signed = rec.type === 'income' ? rec.amountConverted : -rec.amountConverted;
      g.total = round2(g.total + signed);
      const rec2 = mMap[rec.recorderOpenid] || {};
      const pay = mMap[rec.payerOpenid] || {};
      const top = topCategory(cMap, rec.categoryId);
      g.items.push({
        recordId: rec._id, type: rec.type, title: rec.title || rec.categoryPath,
        amountConverted: rec.amountConverted, currency: rec.currency, originalAmount: rec.amount,
        isForeign: rec.currency !== rec.baseCurrency, date: rec.date,
        recorderName: rec2.name || '', recorderInitial: rec2.initial || '', recorderColor: rec2.color || '#2f6feb',
        payerName: pay.name || '', sameActor: rec.recorderOpenid === rec.payerOpenid,
        categoryTopName: top.name, icon: top.icon,
      });
    });
    return { groups: order.map((d) => groupsMap[d]), hasMore: false, displayCurrency: 'CNY' };
  },

  async get(p, ctx) {
    const r = await db.collection('records').doc(p.recordId).get().catch(() => null);
    if (!r || !r.data) throw new AppError('NOT_FOUND', '记录不存在');
    const rec = r.data;
    const me = await requireMember(rec.bookId, ctx.openid);
    const [mMap, cMap] = await Promise.all([membersMap(rec.bookId), categoriesMap(rec.bookId)]);
    const rec2 = mMap[rec.recorderOpenid] || {};
    const pay = mMap[rec.payerOpenid] || {};
    const top = topCategory(cMap, rec.categoryId);
    const canEdit = rec.recorderOpenid === ctx.openid || me.role === 'admin' || me.role === 'owner';
    return {
      recordId: rec._id, type: rec.type, typeLabel: rec.type === 'income' ? '收入' : '支出', icon: top.icon,
      title: rec.title || rec.categoryPath, category: rec.categoryPath, date: rec.date,
      amount: rec.amount, currency: rec.currency, rate: rec.rate, amountConverted: rec.amountConverted, baseCurrency: rec.baseCurrency,
      isForeign: rec.currency !== rec.baseCurrency, note: rec.note || '', images: rec.images || [],
      recorder: { name: rec2.name + (rec.recorderOpenid === ctx.openid ? '（我）' : ''), initial: rec2.initial, color: rec2.color },
      payer: { name: pay.name || '', initial: pay.initial, color: pay.color },
      canEdit, canDelete: canEdit,
    };
  },

  async create(p, ctx) {
    const bookId = p.bookId; const payload = p.payload || {};
    const me = await requireMember(bookId, ctx.openid); requireRole(me, 'rw');
    const b = await db.collection('books').doc(bookId).get();
    const base = b.data.baseCurrency;
    const { rate } = await getRate(payload.date, base, payload.currency);
    const amountConverted = round2(payload.amount * rate);
    const cMap = await categoriesMap(bookId);
    const cat = cMap[payload.categoryId];
    let categoryPath = '';
    if (cat) categoryPath = cat.parentId && cMap[cat.parentId] ? `${cMap[cat.parentId].name} / ${cat.name}` : cat.name;
    const doc = {
      bookId, type: payload.type, title: payload.title || categoryPath,
      amount: payload.amount, currency: payload.currency, rate, baseCurrency: base, amountConverted,
      categoryId: payload.categoryId, categoryPath, date: payload.date, note: payload.note || '', images: payload.images || [],
      recorderOpenid: payload.recorderOpenid || ctx.openid, payerOpenid: payload.payerOpenid || ctx.openid,
      split: payload.split || null, createdAt: db.serverDate(),
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
    const data = { updatedAt: db.serverDate() };
    ['type', 'note', 'categoryId', 'title', 'images', 'payerOpenid', 'split', 'date', 'amount', 'currency'].forEach((k) => {
      if (payload[k] !== undefined) data[k] = payload[k];
    });
    if (payload.amount !== undefined || payload.currency !== undefined || payload.date !== undefined) {
      const cur = payload.currency || rec.currency; const date = payload.date || rec.date; const amt = payload.amount != null ? payload.amount : rec.amount;
      const { rate } = await getRate(date, rec.baseCurrency, cur);
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
};

// ============================== stats ==============================
const stats = {
  async _compute(bookId) {
    const [records, b] = await Promise.all([
      fetchBookRecords(bookId), db.collection('books').doc(bookId).get(),
    ]);
    const latestMonth = records.length ? monthOf(records[0].date) : monthOf(new Date().toISOString());
    let mIncome = 0, mExpense = 0, tIncome = 0, tExpense = 0;
    records.forEach((r) => {
      const v = r.amountConverted;
      if (r.type === 'income') { tIncome += v; if (monthOf(r.date) === latestMonth) mIncome += v; }
      else { tExpense += v; if (monthOf(r.date) === latestMonth) mExpense += v; }
    });
    const [y, m] = latestMonth.split('-');
    return {
      overview: { income: round2(mIncome), expense: round2(mExpense), balance: round2(mIncome - mExpense), monthLabel: `${y} 年 ${parseInt(m, 10)} 月` },
      total: { income: round2(tIncome), expense: round2(tExpense), balance: round2(tIncome - tExpense), since: monthOf(b.data.createdAt instanceof Date ? b.data.createdAt.toISOString() : b.data.createdAt) },
    };
  },
  async getMonthlySummary(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const c = await stats._compute(p.bookId);
    return { ...c.overview };
  },
  async getDashboard(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    return stats._compute(p.bookId);
  },
};

// ============================== layout ==============================
const DEFAULT_LAYOUT = ['overview', 'trend', 'year', 'total'];
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
function parseNL(text) {
  const m = (text || '').match(/(\d+(\.\d+)?)/);
  const amt = m ? parseFloat(m[1]) : 0;
  let cat = '其他';
  if (/打车|地铁|公交|车/.test(text)) cat = '交通 · 打车';
  else if (/饭|餐|吃|外卖|咖啡|奶茶/.test(text)) cat = '餐饮';
  else if (/超市|买|购/.test(text)) cat = '购物 · 日用';
  else if (/药|医/.test(text)) cat = '医疗';
  const date = /昨天/.test(text) ? '2026-06-30' : '2026-07-01';
  return { amt, cat, date };
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
    return { card: { kind: '自然语言记账', state: 'pending', rows: [
      { k: '类型', v: '支出' }, { k: '金额', v: '¥' + rec.amt.toFixed(2) },
      { k: '分类', v: rec.cat, edit: true }, { k: '日期', v: rec.date }, { k: '记录人 / 付款人', v: '小雨' },
    ] } };
  },
  async parseReceipt(p, ctx) {
    const me = await requireMember(p.bookId, ctx.openid); requireRole(me, 'rw');
    return { card: { kind: '收据识别', state: 'pending', rows: [
      { k: '类型', v: '支出' }, { k: '金额', v: '¥56.00' },
      { k: '分类', v: '餐饮 · 外卖', edit: true }, { k: '日期', v: '2026-07-01' }, { k: '记录人 / 付款人', v: '小雨' },
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
    const ms = await db.collection('members').where({ openid: ctx.openid, status: _.neq('removed') }).count();
    let defaultBookName = '';
    if (u.defaultBookId) {
      const b = await db.collection('books').doc(u.defaultBookId).get().catch(() => null);
      defaultBookName = b && b.data ? b.data.name : '';
    }
    return {
      nickname: u.nickname, avatarInitial: u.avatarInitial, avatarColor: u.avatarColor,
      avatarFileID: u.avatarFileID || '', registered: !!u.registered,
      bookCount: ms.total, defaultBookName, defaultBookId: u.defaultBookId || '',
    };
  },

  // 微信授权登录：写入头像/昵称，标记已注册
  async login(p, ctx) {
    await ensureCollections();
    await ensureUser(ctx.openid);
    const nickname = (p.nickname || '').trim() || '微信用户';
    const data = {
      nickname, avatarInitial: nickname.slice(0, 1), registered: true,
    };
    if (p.avatarFileID) data.avatarFileID = p.avatarFileID;
    await db.collection('users').doc(ctx.openid).update({ data });
    return { ok: true, nickname };
  },

  // 修改个人昵称/头像；同步更新我在各账本的成员昵称
  async updateProfile(p, ctx) {
    const data = {};
    if (p.nickname) { data.nickname = p.nickname.trim(); data.avatarInitial = data.nickname.slice(0, 1); }
    if (p.avatarFileID) data.avatarFileID = p.avatarFileID;
    await db.collection('users').doc(ctx.openid).update({ data });
    if (data.nickname) {
      const ms = await db.collection('members').where({ openid: ctx.openid }).get();
      for (const m of ms.data) {
        await db.collection('members').doc(m._id).update({ data: { nameCache: data.nickname, avatarInitial: data.avatarInitial } }).catch(() => {});
      }
    }
    return { ok: true };
  },
};

// ============================== data（导入导出）==============================
const data = {
  // 导出：返回结构化 JSON（前端负责落地成文件/复制）
  async export(p, ctx) {
    await requireMember(p.bookId, ctx.openid);
    const b = await db.collection('books').doc(p.bookId).get();
    const [records, categories, members] = await Promise.all([
      fetchBookRecords(p.bookId),
      db.collection('categories').where({ bookId: p.bookId }).get(),
      db.collection('members').where({ bookId: p.bookId }).get(),
    ]);
    const payload = {
      format: 'sense.book.v1',
      exportedAt: new Date().toISOString(),
      book: { name: b.data.name, type: b.data.type, baseCurrency: b.data.baseCurrency },
      categories: categories.data.map((c) => ({ name: c.name, kind: c.kind, parentName: c.parentId ? (categories.data.find((x) => x._id === c.parentId) || {}).name : null, icon: c.icon || null })),
      members: members.data.map((m) => ({ name: m.nameCache, role: m.role })),
      records: records.map((r) => ({
        type: r.type, title: r.title || '', amount: r.amount, currency: r.currency, rate: r.rate,
        amountConverted: r.amountConverted, categoryPath: r.categoryPath, date: r.date, note: r.note || '',
      })),
    };
    return { data: payload, count: records.length };
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
          fromInitial: mMap[debtors[i].o].initial, fromColor: mMap[debtors[i].o].color,
          toInitial: mMap[creditors[j].o].initial, toColor: mMap[creditors[j].o].color, amount: amt, settled: false });
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
        avatars: sp.members.map((m) => ({ initial: (mMap[m.openid] || {}).initial || '?', color: (mMap[m.openid] || {}).color || '#999' })),
      };
    });
    return {
      summary: { myNet: net[me] || 0, totalExpense: round2(totalExpense), myPaid: round2(paid[me] || 0), myShare: round2(share[me] || 0) },
      transfers,
      members: Object.keys(mMap).map((o) => ({ name: mMap[o].name + (o === me ? '（我）' : ''), initial: mMap[o].initial, color: mMap[o].color, paid: round2(paid[o] || 0), share: round2(share[o] || 0), net: net[o] || 0 })),
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
};

module.exports = { book, member, category, record, rate, stats, layout, ai, settings, user, data, settle, seed };
