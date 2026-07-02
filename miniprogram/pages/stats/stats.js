const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

const GREEN = '#9edf10', BLUE = '#00ccf9', TRACK = '#e4e7ec', AXIS = '#97a7b7';
function enc(svg) { return 'data:image/svg+xml,' + encodeURIComponent(svg); }

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

// 预设图表类型
const PRESETS = {
  monthPie: { title: '本月收支', desc: '本月收入 / 支出占比' },
  weekExpense: { title: '支出趋势', desc: '近 N 日每日支出' },
  yearInOut: { title: '近一年收支', desc: '按月收入 vs 支出' },
  totalPie: { title: '账本累计收支', desc: '累计收入 / 支出占比' },
};
const DEFAULT_IDS = ['monthPie', 'weekExpense', 'yearInOut', 'totalPie'];

Page({
  data: {
    cards: [],
    editing: false,
    draggingId: null,
    weekDays: 7,
    yearMonths: 12,
    editIcon: '',
    dragIcon: '',
    barsIcon: '',
    addIcon: '',
    navSub: '',
    canAdd: true,
    needInit: false,
    loading: true,
  },

  onLoad() {
    this.order = DEFAULT_IDS.slice();
    this.setData({
      editIcon: icons.get('pencil', '#3e4550', 1.8),
      dragIcon: icons.get('dragHandle', '#97a7b7', 1.8),
      barsIcon: icons.get('bars', '#97a7b7', 1.4),
      addIcon: icons.get('plus', '#0089c0', 2),
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
      this.setData({ navSub: `${book.name} · 展示 ${fmt.symbolOf(this.cur)} ${this.cur}`, needInit: false });
      const [charts, layout] = await Promise.all([
        api.call('stats', 'getCharts', { bookId: book.bookId, weekDays: this.data.weekDays, yearMonths: this.data.yearMonths }),
        api.call('layout', 'get', { bookId: book.bookId }),
      ]);
      this.chartData = charts;
      let ids = (layout.order || DEFAULT_IDS).filter((id) => PRESETS[id]);
      if (!ids.length) ids = DEFAULT_IDS.slice();  // 兼容旧布局（老 id 已废弃）
      this.order = ids;
      this.rebuild();
      this.setData({ loading: false });
    } catch (e) { this.setData({ loading: false }); api.toast(e); }
  },

  // 区间变化后仅重取图表数据
  async reloadCharts() {
    if (!this.bookId) return;
    try {
      this.chartData = await api.call('stats', 'getCharts', { bookId: this.bookId, weekDays: this.data.weekDays, yearMonths: this.data.yearMonths });
      this.rebuild();
    } catch (e) { api.toast(e); }
  },

  rebuild() {
    const cards = this.order.filter((id) => PRESETS[id]).map((id) => this.buildCard(id));
    const canAdd = DEFAULT_IDS.some((id) => !this.order.includes(id));
    this.setData({ cards, canAdd });
  },

  buildCard(id) {
    const d = this.chartData || {}; const cur = this.cur;
    if (id === 'monthPie') {
      const p = d.monthPie || { income: 0, expense: 0 };
      return { id, kind: 'pie', title: '本月收支', sub: `${d.monthLabel || ''} · 收入 vs 支出`,
        svg: donutSvg(p.income, p.expense),
        legends: [
          { dot: GREEN, k: '收入', v: fmt.money(p.income, cur) },
          { dot: BLUE, k: '支出', v: fmt.money(p.expense, cur) },
          { k: '结余', v: fmt.signedTotal(p.income - p.expense, cur), strong: true },
        ] };
    }
    if (id === 'weekExpense') {
      const arr = d.weekExpense || [];
      const sum = arr.reduce((s, x) => s + x.value, 0);
      return { id, kind: 'bars', range: 'week', title: `近 ${this.data.weekDays} 日支出`, sub: `按日 · 合计 ${fmt.money(sum, cur)}`,
        svg: barsSvg(arr.map((x) => x.value), arr.map((x) => x.label)),
        legends: [{ dot: BLUE, k: '每日支出' }] };
    }
    if (id === 'yearInOut') {
      const arr = d.yearInOut || [];
      return { id, kind: 'paired', range: 'year', title: `近 ${this.data.yearMonths} 个月收支`, sub: '按月 · 收入 vs 支出',
        svg: pairedSvg(arr),
        legends: [{ dot: GREEN, k: '收入' }, { dot: BLUE, k: '支出' }] };
    }
    // totalPie
    const p = d.totalPie || { income: 0, expense: 0 };
    return { id, kind: 'pie', title: '账本累计收支', sub: '自建立以来 · 收入 vs 支出',
      svg: donutSvg(p.income, p.expense),
      legends: [
        { dot: GREEN, k: '总收入', v: fmt.money(p.income, cur) },
        { dot: BLUE, k: '总支出', v: fmt.money(p.expense, cur) },
        { k: '累计结余', v: fmt.signedTotal(p.income - p.expense, cur), strong: true },
      ] };
  },

  // —— 区间切换 ——
  setWeekRange(e) { const dd = Number(e.currentTarget.dataset.d); if (dd === this.data.weekDays) return; this.setData({ weekDays: dd }); this.reloadCharts(); },
  setYearRange(e) { const mm = Number(e.currentTarget.dataset.m); if (mm === this.data.yearMonths) return; this.setData({ yearMonths: mm }); this.reloadCharts(); },

  // —— 编辑 / 增删 ——
  toggleEdit() {
    const editing = !this.data.editing;
    this.setData({ editing, editIcon: icons.get('pencil', editing ? '#00ccf9' : '#3e4550', 1.8) });
    if (!editing) this.saveOrder();
  },
  onLongPress() { if (!this.data.editing) this.toggleEdit(); },

  addChart() {
    const missing = DEFAULT_IDS.filter((id) => !this.order.includes(id));
    if (!missing.length) { wx.showToast({ title: '已全部添加', icon: 'none' }); return; }
    wx.showActionSheet({
      itemList: missing.map((id) => `${PRESETS[id].title}（${PRESETS[id].desc}）`),
      success: (r) => {
        this.order = this.order.concat([missing[r.tapIndex]]);
        this.rebuild();
        this.saveOrder();
      },
    });
  },

  removeCard(e) {
    const id = e.currentTarget.dataset.id;
    this.order = this.order.filter((c) => c !== id);
    this.rebuild();
    this.saveOrder();
  },

  restoreDefault() {
    this.order = DEFAULT_IDS.slice();
    this.setData({ editing: false, editIcon: icons.get('pencil', '#3e4550', 1.8) });
    this.rebuild();
    this.saveOrder();
  },

  saveOrder() {
    if (!this.bookId) return;
    api.call('layout', 'save', { bookId: this.bookId, order: this.order.slice() }).catch(() => {});
  },

  // —— 拖拽排序 ——
  onHandleTouchStart(e) {
    if (!this.data.editing) return;
    this.dragId = e.currentTarget.dataset.id;
    this.setData({ draggingId: this.dragId });
    this.measure();
  },
  measure() {
    wx.createSelectorQuery().selectAll('.chart-card').boundingClientRect((rects) => { this.rects = rects || []; }).exec();
  },
  onListTouchMove(e) {
    if (this.data.draggingId == null || !this.rects) return;
    const y = e.touches[0].clientY;
    const cards = this.data.cards;
    const from = cards.findIndex((c) => c.id === this.dragId);
    let to = this.rects.length - 1;
    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i];
      if (y < r.top + r.height / 2) { to = i; break; }
    }
    if (to !== from && to >= 0 && from >= 0) {
      const arr = cards.slice();
      const [m] = arr.splice(from, 1);
      arr.splice(to, 0, m);
      this.order = arr.map((c) => c.id);
      this.setData({ cards: arr });
      this.measure();
    }
  },
  onHandleTouchEnd() {
    if (this.data.draggingId != null) { this.setData({ draggingId: null }); this.saveOrder(); }
  },
});
