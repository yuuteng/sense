const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

Page({
  data: {
    book: null,
    type: 'out',            // out=expense | in=income
    amount: '',
    curs: [],
    curIndex: 0,
    fxHint: '',
    cats: [],
    catIndex: 0,
    subs: [],
    subIndex: 0,
    members: [],
    payerIndex: 0,          // 付款人（记录人固定为当前用户）
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
    photos: [],
    ic: {},
    isSplit: false,
    meOpenid: '',
  },

  async onLoad() {
    const t = today();
    this.setData({
      date: t, dateLabel: fmt.dayLabel(t),
      ic: {
        note: icons.get('note', '#8b867b', 1.7),
        calendar: icons.get('calendar', '#8b867b', 1.7),
        chevron: icons.get('chevron', '#8b867b', 2),
        photoAdd: icons.get('photoAdd', '#8b867b', 1.7),
      },
    });
    try {
      const book = await api.call('book', 'getCurrent');
      if (!book) { wx.showToast({ title: '请先创建账本', icon: 'none' }); return; }
      const base = book.baseCurrency;
      const [rate, members] = await Promise.all([
        api.call('rate', 'getDaily', { date: t, base }),
        api.call('member', 'list', { bookId: book.bookId }),
      ]);
      const order = [base, 'EUR', 'USD', 'JPY'].filter((c, i, a) => rate.quotes[c] != null && a.indexOf(c) === i);
      const curs = order.map((code) => ({ code, symbol: fmt.symbolOf(code), rate: rate.quotes[code] }));
      const meIdx = Math.max(0, members.findIndex((m) => m.isMe));
      const memberPicks = members.map((m) => ({ openid: m.openid, initial: m.avatarInitial, color: m.avatarColor, name: m.isMe ? `${m.name}（我）` : m.name }));
      const splitPicks = members.map((m) => ({ openid: m.openid, initial: m.avatarInitial, color: m.avatarColor, name: m.name, selected: true }));
      this.setData({
        book, curs, curIndex: 0, isSplit: book.type === 'split',
        members: memberPicks, payerIndex: meIdx, splitMembers: splitPicks,
        meOpenid: members[meIdx] ? members[meIdx].openid : '',
      });
      await this.loadCategories();
      this.updateComputed();
    } catch (e) { api.toast(e); }
  },

  async loadCategories() {
    if (!this.data.book) return;
    const kind = this.data.type === 'in' ? 'income' : 'expense';
    const tree = await api.call('category', 'list', { bookId: this.data.book.bookId, kind });
    const cats = tree.map((c) => ({
      key: c.name, id: c.categoryId,
      iconOff: icons.get(c.icon, '#1c1b18', 1.6),
      iconOn: icons.get(c.icon, '#ffffff', 1.6),
      subs: c.children || [],
    }));
    this.setData({ cats, catIndex: 0, subs: cats[0] ? cats[0].subs : [], subIndex: 0 });
  },

  updateComputed() {
    const cur = this.data.curs[this.data.curIndex];
    if (!cur) return;
    const val = parseFloat(this.data.amount) || 0;
    const base = this.data.book ? this.data.book.baseCurrency : 'CNY';
    let fxHint;
    if (cur.code === base) fxHint = `展示币种 ${base}`;
    else fxHint = `按今日汇率约 ${fmt.money(val * cur.rate, base)} · 1 ${cur.code} ≈ ${cur.rate}`;

    const cny = cur.code === base ? val : val * cur.rate;
    const mode = this.data.splitMode;
    let splitHint;
    if (mode === 'treat') splitHint = `我请客：本人全额承担 ${fmt.money(cny, base)}，不参与他人分摊`;
    else {
      const n = this.data.splitMembers.filter((m) => m.selected).length || 1;
      if (mode === 'even') splitHint = `均摊：${n} 人 · 每人 ${fmt.money(cny / n, base)}`;
      else splitHint = `按人指定：${n} 人参与，可为每人单独填写金额（P1 仅记录分摊）`;
    }
    this.setData({ fxHint, splitHint });
  },

  // 金额：系统数字键盘输入 + 净化（仅数字、一个小数点、最多两位小数）
  onAmountInput(e) {
    let v = (e.detail.value || '').replace(/[^\d.]/g, '');
    const parts = v.split('.');
    let out = parts[0].slice(0, 8);
    if (parts.length > 1) out += '.' + parts[1].slice(0, 2);
    this.setData({ amount: out });
    this.updateComputed();
    return out;
  },

  async switchType(e) {
    this.setData({ type: e.currentTarget.dataset.k });
    await this.loadCategories();
    this.updateComputed();
  },

  switchCur(e) { this.setData({ curIndex: e.currentTarget.dataset.i }); this.updateComputed(); },
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

  onDateChange(e) {
    this.setData({ date: e.detail.value, dateLabel: fmt.dayLabel(e.detail.value) });
  },

  choosePhoto() {
    const left = 9 - this.data.photos.length;
    if (left <= 0) { wx.showToast({ title: '最多 9 张', icon: 'none' }); return; }
    wx.chooseMedia({
      count: left, mediaType: ['image'], sizeType: ['compressed'],
      success: (res) => {
        const paths = res.tempFiles.map((f) => f.tempFilePath);
        this.setData({ photos: this.data.photos.concat(paths) });
      },
    });
  },
  removePhoto(e) {
    const arr = this.data.photos.slice();
    arr.splice(e.currentTarget.dataset.i, 1);
    this.setData({ photos: arr });
  },
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
    wx.showLoading({ title: '保存中…' });
    try {
      const images = await this.uploadPhotos();
      const cur = this.data.curs[this.data.curIndex];
      const cat = this.data.cats[this.data.catIndex];
      const sub = this.data.subs[this.data.subIndex];
      const payer = this.data.members[this.data.payerIndex] || {};
      const payload = {
        type: this.data.type === 'in' ? 'income' : 'expense',
        amount, currency: cur.code, date: this.data.date,
        categoryId: sub ? sub.categoryId : (cat ? cat.id : null),
        note: this.data.note, images,
        recorderOpenid: this.data.meOpenid,   // 记录人固定=当前用户
        payerOpenid: payer.openid || this.data.meOpenid,
      };
      if (this.data.isSplit) {
        payload.split = { mode: this.data.splitMode, members: this.data.splitMembers.filter((m) => m.selected).map((m) => ({ openid: m.openid })) };
      }
      await api.call('record', 'create', { bookId: this.data.book.bookId, payload });
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }); } }), 600);
    } catch (e) { wx.hideLoading(); api.toast(e); }
  },
});
