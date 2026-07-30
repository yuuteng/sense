const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');
const cur = require('../../utils/currency');

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

Page({
  data: {
    editId: '',
    navTitle: '记一笔',
    book: null,
    type: 'out',            // out=expense | in=income
    amount: '',
    curs: [],
    curIndex: 0,
    curLabels: [],
    curLabel: '',
    curVisible: false,
    fxHint: '',
    cats: [],
    catIndex: 0,
    subs: [],
    subIndex: 0,
    members: [],
    payerIndex: 0,
    splitModes: [
      { k: 'even', label: '均摊' },
      { k: 'treat', label: '我请客' },
    ],
    splitMode: 'even',
    splitMembers: [],
    splitHint: '',
    note: '',
    date: '',
    dateLabel: '',
    calVisible: false,
    photos: [],
    ic: {},
    isSplit: false,
    meOpenid: '',
    amountFocus: false,
    loading: true, // 数据就绪前整页遮罩，杜绝「加载中乱点 → 刷新后状态错乱」
    // 新增一级分类弹层
    addCat: { visible: false, name: '', iconIndex: 0 },
    iconOptions: [],
    catHint: false, // 「长按分类可停用」一次性提示
  },

  dismissCatHint() {
    wx.setStorageSync('hintCatLongpress', 1);
    this.setData({ catHint: false });
  },

  async onLoad(query) {
    this.editId = query.id || '';
    this.setData({ catHint: !wx.getStorageSync('hintCatLongpress') });
    this.aiMsgId = query.m || ''; // 来自 AI 预填卡时带上消息 id，保存后回写卡片状态
    try { this.draft = query.d ? JSON.parse(decodeURIComponent(query.d)) : null; } catch (e) { this.draft = null; }
    const t = today();
    this.setData({
      editId: this.editId, navTitle: this.editId ? '编辑记录' : (this.draft ? '确认记账' : '记一笔'),
      date: t, dateLabel: fmt.dayLabel(t),
      ic: {
        note: icons.get('note', '#748294', 1.7),
        calendar: icons.get('calendar', '#748294', 1.7),
        chevron: icons.get('chevron', '#748294', 2),
        photoAdd: icons.get('photoAdd', '#748294', 1.7),
        plus: icons.get('plus', '#748294', 2),
      },
      // 只留与收支场景相关的图标（mail/privacy/share/refresh/bars 等系统图标与记账无关，已剔除）
      iconOptions: [
        'dining', 'coffee', 'bag', 'train', 'car', 'house',
        'medical', 'medicine', 'edu', 'book', 'play', 'ticket',
        'gift', 'heart', 'star', 'phone', 'camera', 'income',
        'currency', 'receipt', 'clock', 'note', 'list', 'dots',
      ].map((n) => ({
        name: n, off: icons.get(n, '#3e4550', 1.6), on: icons.get(n, '#ffffff', 1.6),
      })),
    });
    try {
      const book = await api.call('book', 'getCurrent');
      if (!book) { wx.showToast({ title: '请先创建账本', icon: 'none' }); return; }
      const base = book.baseCurrency;
      // 录入默认币种跟随「展示币种」（用户拍板：录入与看账口径一致）；取不到其汇率时回退基准币。
      // 防「默认币种莫名不对」靠的是整页 loading 闸门：数据就绪前遮罩挡住一切交互。
      const display = book.displayCurrency || base;
      const [rate, members, exp, inc] = await Promise.all([
        api.call('rate', 'getDaily', { date: t, base }),
        api.call('member', 'list', { bookId: book.bookId }),
        api.call('category', 'list', { bookId: book.bookId, kind: 'expense' }),
        api.call('category', 'list', { bookId: book.bookId, kind: 'income' }),
      ]);
      const front = rate.quotes[display] != null ? display : base;
      const curs = cur.CURRENCIES.filter((c) => rate.quotes[c.code] != null)
        .map((c) => ({ code: c.code, symbol: c.symbol, rate: rate.quotes[c.code] }))
        .sort((a, b) => (a.code === front ? -1 : b.code === front ? 1 : 0));
      const curLabels = curs.map((c) => cur.label(c.code));
      const meIdx = Math.max(0, members.findIndex((m) => m.isMe));
      const memberPicks = members.map((m) => ({ openid: m.openid, initial: m.avatarInitial, color: m.avatarColor, avatarFileID: m.avatarFileID || '', name: m.isMe ? `${m.name}（我）` : m.name }));
      const splitPicks = members.map((m) => ({ openid: m.openid, initial: m.avatarInitial, color: m.avatarColor, avatarFileID: m.avatarFileID || '', name: m.name, selected: true }));

      this.catsByKind = { expense: this.mapCats(exp), income: this.mapCats(inc) };
      this.setData({
        book, curs, curLabels, curIndex: 0, curLabel: curLabels[0] || '',
        isSplit: book.type === 'split',
        members: memberPicks, payerIndex: meIdx, splitMembers: splitPicks,
        meOpenid: members[meIdx] ? members[meIdx].openid : '',
      });
      this.applyKind('out');
      if (this.editId) await this.loadForEdit();
      else if (this.draft) this.prefillFromDraft();
      this.updateComputed();
      this.setData({ loading: false }); // 数据全部就绪，撤掉遮罩开放交互
      // 内容挂载后再聚焦，避免原生 input 在挂载同帧聚焦导致同层渲染卡成灰框
      if (!this.editId && !this.draft) setTimeout(() => this.setData({ amountFocus: true }), 350);
    } catch (e) { this.setData({ loading: false }); api.toast(e); }
  },

  // setTimeout 不随页面销毁取消、wx.navigateBack 也不绑页面实例：保存成功后 600ms 内用户自己返回，
  // 定时器仍会从新的栈顶再弹一页（编辑流 home→detail→add 会被多弹一层回到 home）。必须显式清理。
  onUnload() {
    if (this._navTimer) clearTimeout(this._navTimer);
  },

  mapCats(tree) {
    return (tree || []).map((c) => ({
      key: c.name, id: c.categoryId, icon: c.icon,
      iconOff: icons.get(c.icon || 'dots', '#3e4550', 1.6),
      iconOn: icons.get(c.icon || 'dots', '#ffffff', 1.6),
      subs: c.children || [],
    }));
  },

  // 从缓存切换收支分类，同步、无网络请求
  applyKind(type) {
    const kind = type === 'in' ? 'income' : 'expense';
    const cats = this.catsByKind[kind] || [];
    this.setData({ cats, catIndex: 0, subs: cats[0] ? cats[0].subs : [], subIndex: 0 });
  },

  async loadForEdit() {
    const r = await api.call('record', 'get', { recordId: this.editId });
    const type = r.type === 'income' ? 'in' : 'out';
    this.setData({ type });
    this.applyKind(type);
    let ci = this.data.curs.findIndex((c) => c.code === r.currency); if (ci < 0) ci = 0;
    const cats = this.data.cats;
    let catIndex = 0, subIndex = 0;
    for (let i = 0; i < cats.length; i++) {
      if (cats[i].id === r.categoryId) { catIndex = i; break; }
      const si = (cats[i].subs || []).findIndex((s) => s.categoryId === r.categoryId);
      if (si >= 0) { catIndex = i; subIndex = si; break; }
    }
    const subs = cats[catIndex] ? cats[catIndex].subs : [];
    let payerIndex = this.data.payerIndex;
    if (r.payerOpenid) { const pi = this.data.members.findIndex((m) => m.openid === r.payerOpenid); if (pi >= 0) payerIndex = pi; }
    let splitMembers = this.data.splitMembers; let splitMode = this.data.splitMode;
    if (r.split) {
      // 旧记录可能存过已下线的「按人指定」(by)——统一归一化为均摊
      splitMode = r.split.mode === 'treat' ? 'treat' : 'even';
      const sel = {}; (r.split.members || []).forEach((m) => { sel[m.openid] = true; });
      splitMembers = this.data.splitMembers.map((m) => ({ ...m, selected: !!sel[m.openid] }));
    }
    this.setData({
      amount: String(r.amount), curIndex: ci, curLabel: this.data.curLabels[ci] || '',
      catIndex, subIndex, subs, note: r.note || '', date: r.date, dateLabel: fmt.dayLabel(r.date),
      photos: r.images || [], payerIndex, splitMembers, splitMode,
    });
  },

  // 用 AI 预填草稿填充（金额/类型/币种/分类/日期/备注），用户可再改后保存入账
  prefillFromDraft() {
    const d = this.draft || {};
    const type = d.type === 'income' ? 'in' : 'out';
    this.setData({ type });
    this.applyKind(type);
    // 草稿未指定币种时默认展示币种（curs[0]）
    let ci = d.currency ? this.data.curs.findIndex((c) => c.code === d.currency) : 0;
    if (ci < 0) ci = 0;
    const cats = this.data.cats;
    let catIndex = 0, subIndex = 0;
    if (d.categoryText) {
      const parts = String(d.categoryText).split('/').map((s) => s.trim());
      const pi = cats.findIndex((c) => c.key === parts[0]);
      if (pi >= 0) {
        catIndex = pi;
        if (parts[1]) { const si = (cats[pi].subs || []).findIndex((s) => s.name === parts[1]); if (si >= 0) subIndex = si; }
      }
    }
    const date = d.date || this.data.date;
    this.setData({
      amount: d.amount ? String(d.amount) : '',
      curIndex: ci, curLabel: this.data.curLabels[ci] || '',
      catIndex, subs: cats[catIndex] ? cats[catIndex].subs : [], subIndex,
      note: d.note || '', date, dateLabel: fmt.dayLabel(date),
    });
  },

  updateComputed() {
    const c = this.data.curs[this.data.curIndex];
    if (!c) return;
    const val = parseFloat(this.data.amount) || 0;
    const base = this.data.book ? this.data.book.baseCurrency : 'CNY';
    const display = this.data.book ? (this.data.book.displayCurrency || base) : base;
    // 展示币种对基准币的汇率（display→base），用于把录入币种折算到展示币种
    const dispCur = this.data.curs.find((x) => x.code === display);
    const dispRate = dispCur ? dispCur.rate : 1;
    // 折算到展示币种：code→display =（code→base）/（display→base）
    const conv = dispRate ? (val * c.rate) / dispRate : val * c.rate;
    let fxHint;
    if (c.code === display) fxHint = `展示币种 ${display}`;
    else fxHint = `约 ${fmt.money(conv, display)}（1 ${c.code} ≈ ${fmt.money(c.rate / dispRate, display)}）`;
    const mode = this.data.splitMode;
    let splitHint;
    if (mode === 'treat') splitHint = `我请客：本人全额承担 ${fmt.money(conv, display)}`;
    else {
      const n = this.data.splitMembers.filter((m) => m.selected).length || 1;
      splitHint = `均摊：${n} 人 · 每人 ${fmt.money(conv / n, display)}`;
    }
    this.setData({ fxHint, splitHint });
  },

  onAmountInput(e) {
    // 法语/德语等地区的 iOS 小数键盘给的是逗号——一律归一化成小数点，再清掉其他字符
    let v = (e.detail.value || '').replace(/[,，。]/g, '.').replace(/[^\d.]/g, '');
    const parts = v.split('.');
    let out = parts[0].slice(0, 9);
    if (parts.length > 1) out += '.' + parts[1].slice(0, 2);
    this.setData({ amount: out });
    this.updateComputed();
    this.syncUnloadGuard();
    return out;
  },

  // 收起键盘时同步受控焦点状态：focus 停留 true 会导致「再点输入框键盘不弹」
  onAmountBlur() {
    if (this.data.amountFocus) this.setData({ amountFocus: false });
  },

  // 未保存离开守卫：填了内容（金额/备注/图片）且未保存时，返回/手势离开先确认，防误滑丢输入
  syncUnloadGuard() {
    // !! 必须留着：&&/|| 返回操作数本身（金额串 "5.01" / 图片数 2），下一行是严格相等去重，
    // 不转布尔会导致每次按键的值都不同 → 去重永久失效 → enableAlertBeforeUnload 被反复重调
    const dirty = !!(!this._saved && (this.data.amount || this.data.note || this.data.photos.length));
    if (dirty === this._guardOn) return;
    this._guardOn = dirty;
    if (dirty && wx.enableAlertBeforeUnload) {
      wx.enableAlertBeforeUnload({ message: '这笔账还没保存，确定离开？' });
    } else if (!dirty && wx.disableAlertBeforeUnload) {
      wx.disableAlertBeforeUnload();
    }
  },

  switchType(e) {
    const type = e.currentTarget.dataset.k;
    if (type === this.data.type) return;
    this.setData({ type });
    this.applyKind(type);
    this.updateComputed();
  },

  openCur() { if (!this.data.curs.length) return; this.setData({ curVisible: true }); },
  closeCur() { this.setData({ curVisible: false }); },
  onCur(e) {
    const i = this.data.curs.findIndex((c) => c.code === e.detail.code);
    if (i < 0) { wx.showToast({ title: '该币种暂无汇率', icon: 'none' }); this.setData({ curVisible: false }); return; }
    this.setData({ curIndex: i, curLabel: this.data.curLabels[i], curVisible: false });
    this.updateComputed();
  },

  pickCat(e) { const i = e.currentTarget.dataset.i; this.setData({ catIndex: i, subs: this.data.cats[i].subs, subIndex: 0 }); },
  pickSub(e) { this.setData({ subIndex: e.currentTarget.dataset.i }); },
  pickPayer(e) { this.setData({ payerIndex: e.currentTarget.dataset.i }); },
  switchSplitMode(e) { this.setData({ splitMode: e.currentTarget.dataset.k }); this.updateComputed(); },
  toggleSplitMember(e) {
    if (this.data.splitMode === 'treat') return;
    const i = e.currentTarget.dataset.i;
    this.setData({ [`splitMembers[${i}].selected`]: !this.data.splitMembers[i].selected });
    this.updateComputed();
  },
  onNoteInput(e) { this.setData({ note: e.detail.value }); this.syncUnloadGuard(); },
  noop() {},

  // 日期：日历
  openCalendar() { this.setData({ calVisible: true }); },
  onCalPick(e) { this.setData({ date: e.detail.date, dateLabel: fmt.dayLabel(e.detail.date), calVisible: false }); },
  onCalClose() { this.setData({ calVisible: false }); },

  // 自定义分类（持久化到账本）
  async reloadKind(kind) {
    const tree = await api.call('category', 'list', { bookId: this.data.book.bookId, kind });
    this.catsByKind[kind] = this.mapCats(tree);
    return this.catsByKind[kind];
  },
  // 新增一级分类：名字 + 选图标
  onAddCat() { this.setData({ addCat: { visible: true, name: '', iconIndex: 0 } }); },
  onAddCatName(e) { this.setData({ 'addCat.name': e.detail.value }); },
  pickAddIcon(e) { this.setData({ 'addCat.iconIndex': e.currentTarget.dataset.i }); },
  cancelAddCat() { this.setData({ 'addCat.visible': false }); },
  confirmAddCat() {
    const name = (this.data.addCat.name || '').trim();
    if (!name) { wx.showToast({ title: '请输入分类名', icon: 'none' }); return; }
    const kind = this.data.type === 'in' ? 'income' : 'expense';
    const icon = this.data.iconOptions[this.data.addCat.iconIndex].name;
    api.call('category', 'create', { bookId: this.data.book.bookId, kind, parentId: null, name, icon })
      .then((r) => this.reloadKind(kind).then((cats) => {
        let i = cats.findIndex((c) => c.id === r.categoryId); if (i < 0) i = 0;
        this.setData({ cats, catIndex: i, subs: cats[i].subs, subIndex: 0, 'addCat.visible': false });
      }))
      .catch(api.toast);
  },
  onAddSub() {
    const cat = this.data.cats[this.data.catIndex];
    if (!cat) { wx.showToast({ title: '请先选一级分类', icon: 'none' }); return; }
    const kind = this.data.type === 'in' ? 'income' : 'expense';
    wx.showModal({
      title: `在「${cat.key}」下新增`, editable: true, placeholderText: '二级分类名称',
      success: (res) => {
        if (!res.confirm || !res.content.trim()) return;
        api.call('category', 'create', { bookId: this.data.book.bookId, kind, parentId: cat.id, name: res.content.trim() })
          .then((r) => this.reloadKind(kind).then((cats) => {
            let ci = cats.findIndex((c) => c.id === cat.id); if (ci < 0) ci = this.data.catIndex;
            const subs = cats[ci].subs;
            let si = subs.findIndex((s) => s.categoryId === r.categoryId); if (si < 0) si = 0;
            this.setData({ cats, catIndex: ci, subs, subIndex: si });
          }))
          .catch(api.toast);
      },
    });
  },

  // 长按停用（删除）分类
  onDeleteCat(e) {
    const cat = this.data.cats[e.currentTarget.dataset.i];
    if (!cat) return;
    const kind = this.data.type === 'in' ? 'income' : 'expense';
    wx.showModal({
      title: '停用分类', content: `停用「${cat.key}」？其下二级分类一并隐藏，历史记录仍保留原分类名。`, confirmColor: '#c41e5a',
      success: (res) => {
        if (!res.confirm) return;
        // 乐观移除：本地立即从九宫格消失，云端失败再拉回真实列表
        const cats = this.data.cats.filter((c) => c.id !== cat.id);
        this.catsByKind[kind] = cats;
        const ci = Math.min(this.data.catIndex, Math.max(0, cats.length - 1));
        this.setData({ cats, catIndex: ci, subs: cats[ci] ? cats[ci].subs : [], subIndex: 0 });
        api.call('category', 'disable', { bookId: this.data.book.bookId, categoryId: cat.id })
          .catch((e) => {
            api.toast(e);
            this.reloadKind(kind).then((real) => this.setData({ cats: real, catIndex: 0, subs: real[0] ? real[0].subs : [], subIndex: 0 }));
          });
      },
    });
  },
  onDeleteSub(e) {
    const sub = this.data.subs[e.currentTarget.dataset.i];
    if (!sub) return;
    const kind = this.data.type === 'in' ? 'income' : 'expense';
    wx.showModal({
      title: '停用分类', content: `停用「${sub.name}」？历史记录仍保留原分类名。`, confirmColor: '#c41e5a',
      success: (res) => {
        if (!res.confirm) return;
        // 乐观移除二级：本地立即消失，失败拉回真实列表
        const ci = this.data.catIndex;
        const subs = this.data.subs.filter((s) => s.categoryId !== sub.categoryId);
        const cats = this.data.cats.map((c, i) => (i === ci ? { ...c, subs } : c));
        this.catsByKind[kind] = cats;
        this.setData({ cats, subs, subIndex: 0 });
        api.call('category', 'disable', { bookId: this.data.book.bookId, categoryId: sub.categoryId })
          .catch((e) => {
            api.toast(e);
            this.reloadKind(kind).then((real) => this.setData({ cats: real, subs: real[ci] ? real[ci].subs : [], subIndex: 0 }));
          });
      },
    });
  },

  choosePhoto() {
    const left = 9 - this.data.photos.length;
    if (left <= 0) { wx.showToast({ title: '最多 9 张', icon: 'none' }); return; }
    wx.chooseMedia({
      count: left, mediaType: ['image'], sizeType: ['compressed'],
      success: (res) => { this.setData({ photos: this.data.photos.concat(res.tempFiles.map((f) => f.tempFilePath)) }); this.syncUnloadGuard(); },
    });
  },
  removePhoto(e) { const arr = this.data.photos.slice(); arr.splice(e.currentTarget.dataset.i, 1); this.setData({ photos: arr }); this.syncUnloadGuard(); },
  async uploadPhotos() {
    const ids = [];
    for (const p of this.data.photos) {
      if (p.indexOf('cloud://') === 0) { ids.push(p); continue; }
      const up = await wx.cloud.uploadFile({ cloudPath: `records/${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`, filePath: p });
      ids.push(up.fileID);
    }
    return ids;
  },

  async save() {
    const amount = parseFloat(this.data.amount) || 0;
    if (amount <= 0) { wx.showToast({ title: '请输入金额', icon: 'none' }); return; }
    if (!this.data.book) { wx.showToast({ title: '账本信息加载中，请稍候', icon: 'none' }); return; }
    // 已成功入账但页面仍留存（导航失败等）：只提示、绝不解锁——账已落库，解锁再点就是重复入账。
    // 飞行途中（_saving 真、_saved 假）静默 return：那时遮罩在，不需要提示。
    if (this._saving) {
      if (this._saved) wx.showToast({ title: '这笔已保存，请返回', icon: 'none' });
      return;
    }
    this._saving = true;
    wx.showLoading({ title: '保存中…', mask: true });
    try {
      const images = await this.uploadPhotos();
      const c = this.data.curs[this.data.curIndex];
      const cat = this.data.cats[this.data.catIndex];
      const sub = this.data.subs[this.data.subIndex];
      const payer = this.data.members[this.data.payerIndex] || {};
      const payload = {
        type: this.data.type === 'in' ? 'income' : 'expense',
        amount, currency: c.code, rate: c.rate, date: this.data.date,
        categoryId: sub ? sub.categoryId : (cat ? cat.id : null),
        title: sub ? sub.name : (cat ? cat.key : ''),
        note: this.data.note, images,
        recorderOpenid: this.data.meOpenid,
        payerOpenid: this.data.isSplit ? (payer.openid || this.data.meOpenid) : this.data.meOpenid,
      };
      if (this.data.isSplit) {
        payload.split = { mode: this.data.splitMode, members: this.data.splitMembers.filter((m) => m.selected).map((m) => ({ openid: m.openid })) };
      }
      if (this.editId) await api.call('record', 'update', { recordId: this.editId, payload });
      else await api.call('record', 'create', { bookId: this.data.book.bookId, payload });
      // 来自 AI 预填卡：入账成功后把卡片状态回写为「已入账」（返回 AI 页时刷新可见）
      if (this.aiMsgId) {
        api.call('ai', 'setCardState', { bookId: this.data.book.bookId, msgId: this.aiMsgId, state: 'done' }).catch(() => {});
      }
      // 交接给首页做乐观插入：先本地上屏，服务器数据回来后整体覆盖
      if (!this.editId) {
        getApp().globalData.justSaved = {
          bookId: this.data.book.bookId,
          date: this.data.date,
          type: payload.type,
          title: payload.title,
          icon: cat ? cat.icon : 'dots',
          amount,
          currency: c.code,
          base: this.data.book.baseCurrency,
          amountConverted: Math.round(amount * (c.rate || 1) * 100) / 100,
        };
      }
      this._saved = true;
      this.syncUnloadGuard(); // 已保存，解除离开确认
      wx.hideLoading();
      wx.showToast({ title: this.editId ? '已更新' : '已保存', icon: 'success' });
      // 回调统一用箭头函数：方法简写 fail() {} 里的 this 是框架传的 options 对象，不是页面实例，
      // 写 this._xxx 会静默无效。timer 存 id 供 onUnload 清理（见 onUnload 注释）。
      this._navTimer = setTimeout(() => wx.navigateBack({
        delta: 1,
        fail: () => wx.switchTab({
          url: '/pages/home/home',
          fail: () => wx.showToast({ title: '已保存，请手动返回', icon: 'none', duration: 3000 }),
        }),
      }), 600);
    } catch (e) { this._saving = false; wx.hideLoading(); api.toast(e); }
  },
});
