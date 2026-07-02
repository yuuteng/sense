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
      { k: 'by', label: '按人指定' },
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
    // 新增一级分类弹层
    addCat: { visible: false, name: '', iconIndex: 0 },
    iconOptions: [],
  },

  async onLoad(query) {
    this.editId = query.id || '';
    const t = today();
    this.setData({
      editId: this.editId, navTitle: this.editId ? '编辑记录' : '记一笔',
      date: t, dateLabel: fmt.dayLabel(t),
      ic: {
        note: icons.get('note', '#748294', 1.7),
        calendar: icons.get('calendar', '#748294', 1.7),
        chevron: icons.get('chevron', '#748294', 2),
        photoAdd: icons.get('photoAdd', '#748294', 1.7),
        plus: icons.get('plus', '#748294', 2),
      },
      iconOptions: ['dining', 'coffee', 'bag', 'train', 'car', 'house', 'medical', 'edu', 'play', 'ticket', 'gift', 'heart', 'star', 'phone', 'income', 'book'].map((n) => ({
        name: n, off: icons.get(n, '#3e4550', 1.6), on: icons.get(n, '#ffffff', 1.6),
      })),
    });
    try {
      const book = await api.call('book', 'getCurrent');
      if (!book) { wx.showToast({ title: '请先创建账本', icon: 'none' }); return; }
      const base = book.baseCurrency;
      const [rate, members, exp, inc] = await Promise.all([
        api.call('rate', 'getDaily', { date: t, base }),
        api.call('member', 'list', { bookId: book.bookId }),
        api.call('category', 'list', { bookId: book.bookId, kind: 'expense' }),
        api.call('category', 'list', { bookId: book.bookId, kind: 'income' }),
      ]);
      // 所有能取到汇率的常用币种，基准币排最前
      const curs = cur.CURRENCIES.filter((c) => rate.quotes[c.code] != null)
        .map((c) => ({ code: c.code, symbol: c.symbol, rate: rate.quotes[c.code] }))
        .sort((a, b) => (a.code === base ? -1 : b.code === base ? 1 : 0));
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
      this.updateComputed();
      // 内容挂载后再聚焦，避免原生 input 在挂载同帧聚焦导致同层渲染卡成灰框
      if (!this.editId) setTimeout(() => this.setData({ amountFocus: true }), 350);
    } catch (e) { api.toast(e); }
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
      splitMode = r.split.mode || 'even';
      const sel = {}; (r.split.members || []).forEach((m) => { sel[m.openid] = true; });
      splitMembers = this.data.splitMembers.map((m) => ({ ...m, selected: !!sel[m.openid] }));
    }
    this.setData({
      amount: String(r.amount), curIndex: ci, curLabel: this.data.curLabels[ci] || '',
      catIndex, subIndex, subs, note: r.note || '', date: r.date, dateLabel: fmt.dayLabel(r.date),
      photos: r.images || [], payerIndex, splitMembers, splitMode,
    });
  },

  updateComputed() {
    const c = this.data.curs[this.data.curIndex];
    if (!c) return;
    const val = parseFloat(this.data.amount) || 0;
    const base = this.data.book ? this.data.book.baseCurrency : 'CNY';
    let fxHint;
    if (c.code === base) fxHint = `展示币种 ${base}`;
    else fxHint = `约 ${fmt.money(val * c.rate, base)}（1 ${c.code} ≈ ${fmt.money(c.rate, base)}）`;
    const cny = c.code === base ? val : val * c.rate;
    const mode = this.data.splitMode;
    let splitHint;
    if (mode === 'treat') splitHint = `我请客：本人全额承担 ${fmt.money(cny, base)}`;
    else {
      const n = this.data.splitMembers.filter((m) => m.selected).length || 1;
      if (mode === 'even') splitHint = `均摊：${n} 人 · 每人 ${fmt.money(cny / n, base)}`;
      else splitHint = `按人指定：${n} 人参与（P1 仅记录分摊）`;
    }
    this.setData({ fxHint, splitHint });
  },

  onAmountInput(e) {
    let v = (e.detail.value || '').replace(/[^\d.]/g, '');
    const parts = v.split('.');
    let out = parts[0].slice(0, 9);
    if (parts.length > 1) out += '.' + parts[1].slice(0, 2);
    this.setData({ amount: out });
    this.updateComputed();
    return out;
  },

  switchType(e) {
    const type = e.currentTarget.dataset.k;
    if (type === this.data.type) return;
    this.setData({ type });
    this.applyKind(type);
    this.updateComputed();
  },

  openCur() { this.setData({ curVisible: true }); },
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
  onNoteInput(e) { this.setData({ note: e.detail.value }); },
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
      title: '停用分类', content: `停用「${cat.key}」？其下二级分类一并隐藏，历史记录仍保留原分类名。`, confirmColor: '#f62172',
      success: (res) => {
        if (!res.confirm) return;
        api.call('category', 'disable', { bookId: this.data.book.bookId, categoryId: cat.id })
          .then(() => this.reloadKind(kind).then((cats) => {
            const ci = Math.min(this.data.catIndex, Math.max(0, cats.length - 1));
            this.setData({ cats, catIndex: ci, subs: cats[ci] ? cats[ci].subs : [], subIndex: 0 });
          })).catch(api.toast);
      },
    });
  },
  onDeleteSub(e) {
    const sub = this.data.subs[e.currentTarget.dataset.i];
    if (!sub) return;
    const kind = this.data.type === 'in' ? 'income' : 'expense';
    wx.showModal({
      title: '停用分类', content: `停用「${sub.name}」？历史记录仍保留原分类名。`, confirmColor: '#f62172',
      success: (res) => {
        if (!res.confirm) return;
        api.call('category', 'disable', { bookId: this.data.book.bookId, categoryId: sub.categoryId })
          .then(() => this.reloadKind(kind).then((cats) => {
            const ci = this.data.catIndex < cats.length ? this.data.catIndex : 0;
            this.setData({ cats, subs: cats[ci] ? cats[ci].subs : [], subIndex: 0 });
          })).catch(api.toast);
      },
    });
  },

  choosePhoto() {
    const left = 9 - this.data.photos.length;
    if (left <= 0) { wx.showToast({ title: '最多 9 张', icon: 'none' }); return; }
    wx.chooseMedia({
      count: left, mediaType: ['image'], sizeType: ['compressed'],
      success: (res) => this.setData({ photos: this.data.photos.concat(res.tempFiles.map((f) => f.tempFilePath)) }),
    });
  },
  removePhoto(e) { const arr = this.data.photos.slice(); arr.splice(e.currentTarget.dataset.i, 1); this.setData({ photos: arr }); },
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
    if (!this.data.book) return;
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
      wx.hideLoading();
      wx.showToast({ title: this.editId ? '已更新' : '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }); } }), 600);
    } catch (e) { wx.hideLoading(); api.toast(e); }
  },
});
