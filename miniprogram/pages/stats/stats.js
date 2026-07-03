const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

const GREEN = '#9edf10', BLUE = '#00ccf9', TRACK = '#e4e7ec', AXIS = '#97a7b7';
function enc(svg) { return 'data:image/svg+xml,' + encodeURIComponent(svg); }
function genId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// 甜甜圈饼图：收入(绿) vs 支出(蓝)
function donutSvg(income, expense) {
  const cx = 100, cy = 100, r = 66, sw = 30, C = 2 * Math.PI * r;
  const total = income + expense;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${sw}"/>`;
  if (total > 0) {
    const incLen = C * (income / total);
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${GREEN}" stroke-width="${sw}" stroke-dasharray="${incLen.toFixed(2)} ${(C - incLen).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    const expLen = C - incLen;
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${BLUE}" stroke-width="${sw}" stroke-dasharray="${expLen.toFixed(2)} ${incLen.toFixed(2)}" stroke-dashoffset="${(-incLen).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
  }
  s += `</svg>`;
  return enc(s);
}
// 柱状图（支出）
function barsSvg(values, labels) {
  const W = 320, H = 156, base = H - 24, top = 12, n = values.length || 1;
  const max = Math.max(1, ...values);
  const slot = W / n;
  const bw = Math.max(6, Math.min(28, slot * 0.5));
  const every = Math.ceil(n / 7);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="${TRACK}" stroke-width="1"/>`;
  values.forEach((v, i) => {
    const h = v > 0 ? Math.max(3, (v / max) * (base - top)) : 0;
    const x = slot * i + (slot - bw) / 2;
    s += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${BLUE}"/>`;
    if (i % every === 0) s += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 5}" font-size="11" text-anchor="middle" fill="${AXIS}">${labels[i]}</text>`;
  });
  s += `</svg>`;
  return enc(s);
}
// 分组柱状图：每月 收入(绿) + 支出(蓝)
function pairedSvg(rows) {
  const W = 320, H = 156, base = H - 24, top = 12, n = rows.length || 1;
  const max = Math.max(1, ...rows.map((r) => r.income), ...rows.map((r) => r.expense));
  const slot = W / n;
  const bw = Math.max(4, Math.min(11, slot * 0.30));
  const every = Math.ceil(n / 6);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  s += `<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="${TRACK}" stroke-width="1"/>`;
  rows.forEach((r, i) => {
    const c = slot * i + slot / 2;
    const hi = r.income > 0 ? Math.max(3, (r.income / max) * (base - top)) : 0;
    const he = r.expense > 0 ? Math.max(3, (r.expense / max) * (base - top)) : 0;
    s += `<rect x="${(c - bw - 1).toFixed(1)}" y="${(base - hi).toFixed(1)}" width="${bw.toFixed(1)}" height="${hi.toFixed(1)}" rx="2" fill="${GREEN}"/>`;
    s += `<rect x="${(c + 1).toFixed(1)}" y="${(base - he).toFixed(1)}" width="${bw.toFixed(1)}" height="${he.toFixed(1)}" rx="2" fill="${BLUE}"/>`;
    if (i % every === 0) s += `<text x="${c.toFixed(1)}" y="${H - 5}" font-size="10" text-anchor="middle" fill="${AXIS}">${rows[i].label}</text>`;
  });
  s += `</svg>`;
  return enc(s);
}

// 图表类型（可添加多个同类型实例）
const TYPES = {
  monthPie: { title: '本月收支', desc: '本月收入 / 支出占比', kind: 'pie' },
  weekExpense: { title: '支出趋势', desc: '近 N 日每日支出', kind: 'bars', defRange: 7 },
  yearInOut: { title: '收支趋势', desc: '近 N 月收入 vs 支出', kind: 'paired', defRange: 12 },
  totalPie: { title: '累计收支', desc: '账本累计收入 / 支出占比', kind: 'pie' },
};
const TYPE_IDS = ['monthPie', 'weekExpense', 'yearInOut', 'totalPie'];
const DEFAULT_LAYOUT = ['monthPie', 'weekExpense', 'yearInOut', 'totalPie'];

// 「添加图表」弹层用的示意缩略图：套用真实图表的画法 + 一组样例数据，纯展示、不含真实金额
const PREVIEW = {
  monthPie: donutSvg(62, 38),
  totalPie: donutSvg(56, 44),
  weekExpense: barsSvg([30, 52, 40, 68, 45, 60, 74], ['', '', '', '', '', '', '']),
  yearInOut: pairedSvg([
    { income: 70, expense: 52, label: '' }, { income: 60, expense: 66, label: '' },
    { income: 82, expense: 48, label: '' }, { income: 55, expense: 62, label: '' },
    { income: 76, expense: 58, label: '' }, { income: 64, expense: 72, label: '' },
  ]),
};
const PICKER_TYPES = TYPE_IDS.map((id) => ({
  type: id, kind: TYPES[id].kind, title: TYPES[id].title, desc: TYPES[id].desc, preview: PREVIEW[id],
}));

// 兼容旧布局（字符串 id）与新布局（实例对象）
function normalizeLayout(order) {
  const arr = (Array.isArray(order) && order.length) ? order : DEFAULT_LAYOUT;
  return arr.map((it) => {
    if (typeof it === 'string') {
      if (!TYPES[it]) return null;
      return { iid: genId(), type: it, range: TYPES[it].defRange };
    }
    if (it && TYPES[it.type]) return { iid: it.iid || genId(), type: it.type, range: it.range || TYPES[it.type].defRange };
    return null;
  }).filter(Boolean);
}

Page({
  data: {
    cards: [],
    editing: false,
    bookName: '',
    displayCurrency: '',
    chevronDown: '',
    addIcon: '',
    barsIcon: '',
    canAdd: true,
    needInit: false,
    loading: true,
    // 账本切换（与首页一致）
    switcherVisible: false,
    currentBookId: '',
    books: [],
    // 展示币种切换
    curCode: 'CNY',
    curSym: '¥',
    curVisible: false,
    // 添加图表弹层
    pickerRender: false,
    pickerUp: false,
    pickerTypes: PICKER_TYPES,
  },

  onLoad() {
    this.layout = normalizeLayout(DEFAULT_LAYOUT);
    this.setData({
      chevronDown: icons.get('chevronDown', '#748294', 2.2),
      addIcon: icons.get('plus', '#0089c0', 2),
      barsIcon: icons.get('bars', '#97a7b7', 1.4),
      bookIcon: icons.get('book', '#0089c0', 1.7),
      houseIcon: icons.get('house', '#a47d06', 1.7),
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    this.load();
  },

  async load() {
    try {
      const book = await api.call('book', 'getCurrent');
      if (!book) { this.setData({ needInit: true, loading: false }); return; }
      this.bookId = book.bookId;
      this.cur = book.displayCurrency || 'CNY';
      this.setData({ bookName: book.name, currentBookId: book.bookId, curCode: this.cur, curSym: fmt.symbolOf(this.cur), needInit: false });
      const [raw, layout] = await Promise.all([
        api.call('stats', 'getChartData', { bookId: book.bookId }),
        api.call('layout', 'get', { bookId: book.bookId }),
      ]);
      this.raw = raw;
      this.layout = normalizeLayout(layout.order);
      this.rebuild();
      this.setData({ loading: false });
    } catch (e) { this.setData({ loading: false }); api.toast(e); }
  },

  rebuild() {
    this.setData({ cards: this.layout.map((inst) => this.buildCard(inst)), canAdd: true });
  },

  buildCard(inst) {
    const raw = this.raw || {}; const cur = this.cur;
    if (inst.type === 'monthPie' || inst.type === 'totalPie') {
      const isMonth = inst.type === 'monthPie';
      const p = (isMonth ? raw.monthPie : raw.totalPie) || { income: 0, expense: 0 };
      return {
        iid: inst.iid, type: inst.type, kind: 'pie',
        title: isMonth ? '本月收支' : '账本累计收支',
        sub: isMonth ? `${raw.monthLabel || ''} · 收入 vs 支出` : '自建立以来 · 收入 vs 支出',
        svg: donutSvg(p.income, p.expense),
        legends: [
          { dot: GREEN, k: isMonth ? '收入' : '总收入', v: fmt.money(p.income, cur) },
          { dot: BLUE, k: isMonth ? '支出' : '总支出', v: fmt.money(p.expense, cur) },
          { k: isMonth ? '结余' : '累计结余', v: fmt.signedTotal(p.income - p.expense, cur), strong: true },
        ],
      };
    }
    if (inst.type === 'weekExpense') {
      const arr = (raw.daily || []).slice(-inst.range);
      const sum = arr.reduce((s, x) => s + x.expense, 0);
      return {
        iid: inst.iid, type: inst.type, kind: 'bars', range: 'day', rangeVal: inst.range,
        title: `近 ${inst.range} 日支出`, sub: `按日 · 合计 ${fmt.money(sum, cur)}`,
        svg: barsSvg(arr.map((x) => x.expense), arr.map((x) => x.label)),
        legends: [{ dot: BLUE, k: '每日支出' }],
      };
    }
    // yearInOut
    const arr = (raw.monthly || []).slice(-inst.range);
    return {
      iid: inst.iid, type: inst.type, kind: 'paired', range: 'month', rangeVal: inst.range,
      title: `近 ${inst.range} 个月收支`, sub: '按月 · 收入 vs 支出',
      svg: pairedSvg(arr),
      legends: [{ dot: GREEN, k: '收入' }, { dot: BLUE, k: '支出' }],
    };
  },

  toggleEdit() { this.setData({ editing: !this.data.editing }); },

  // 添加图表：弹出带示意图的选择面板（可重复添加，例如两个不同区间的支出趋势）
  openPicker() {
    this.setData({ pickerRender: true });
    this._pt = setTimeout(() => this.setData({ pickerUp: true }), 20);
  },
  closePicker() {
    this.setData({ pickerUp: false });
    this._pt = setTimeout(() => this.setData({ pickerRender: false }), 300);
  },
  noop() {},
  pickType(e) {
    const { type } = e.currentTarget.dataset;
    if (!type || !TYPES[type]) return;
    this.layout = this.layout.concat([{ iid: genId(), type, range: TYPES[type].defRange }]);
    this.rebuild();
    this.saveLayout();
    this.closePicker();
  },

  moveUp(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (i <= 0) return;
    const a = this.layout.slice();
    [a[i - 1], a[i]] = [a[i], a[i - 1]];
    this.layout = a; this.rebuild(); this.saveLayout();
  },
  moveDown(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (i >= this.layout.length - 1) return;
    const a = this.layout.slice();
    [a[i + 1], a[i]] = [a[i], a[i + 1]];
    this.layout = a; this.rebuild(); this.saveLayout();
  },
  removeCard(e) {
    const iid = e.currentTarget.dataset.iid;
    this.layout = this.layout.filter((x) => x.iid !== iid);
    this.rebuild(); this.saveLayout();
  },
  setRange(e) {
    const iid = e.currentTarget.dataset.iid; const r = Number(e.currentTarget.dataset.r);
    this.layout = this.layout.map((x) => (x.iid === iid ? { ...x, range: r } : x));
    this.rebuild(); this.saveLayout();
  },

  restoreDefault() {
    this.layout = normalizeLayout(DEFAULT_LAYOUT);
    this.setData({ editing: false });
    this.rebuild(); this.saveLayout();
  },

  saveLayout() {
    if (!this.bookId) return;
    api.call('layout', 'save', { bookId: this.bookId, order: this.layout }).catch(() => {});
  },

  // —— 账本切换（与首页同一套逻辑）——
  async openSwitcher() {
    try {
      const list = await api.call('book', 'list');
      this.setData({
        books: list.map((b) => ({
          bookId: b.bookId, name: b.name, typeLabel: b.typeLabel,
          typeClass: b.type === 'split' ? 'book-type--split' : 'book-type--share',
          iconSrc: b.type === 'split' ? this.data.houseIcon : this.data.bookIcon,
          iconBg: b.type === 'split' ? 'rgba(255,205,47,0.16)' : 'rgba(0,204,249,0.12)',
        })),
        switcherVisible: true,
      });
    } catch (e) { api.toast(e); }
  },
  async onSwitcherSelect(e) {
    const { bookId } = e.detail;
    this.setData({ switcherVisible: false });
    if (!bookId || bookId === this.data.currentBookId) return;
    try {
      await api.call('book', 'setDefault', { bookId });
      this.setData({ loading: true });
      await this.load();
      wx.showToast({ title: '已切换账本', icon: 'none' });
    } catch (e2) { api.toast(e2); }
  },
  onSwitcherClose() { this.setData({ switcherVisible: false }); },
  goManageBooks() { this.setData({ switcherVisible: false }); wx.navigateTo({ url: '/pages/books/books' }); },

  // 展示币种切换（顶部按钮 → 币种选择器）
  openCurPicker() { this.setData({ curVisible: true }); },
  closeCurPicker() { this.setData({ curVisible: false }); },
  onCurPick(e) {
    const code = e.detail.code;
    this.setData({ curVisible: false });
    if (!code || code === this.data.curCode) return;
    api.call('settings', 'update', { displayCurrency: code })
      .then(() => { this.setData({ loading: true }); return this.load(); })
      .catch(api.toast);
  },
});
