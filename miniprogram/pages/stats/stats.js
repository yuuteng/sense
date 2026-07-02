const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

function enc(svg) { return 'data:image/svg+xml,' + encodeURIComponent(svg); }

const TREND_IMG = enc(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="130" viewBox="0 0 300 130" preserveAspectRatio="none">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#2f6feb" stop-opacity="0.22"/>' +
  '<stop offset="1" stop-color="#2f6feb" stop-opacity="0"/></linearGradient></defs>' +
  '<path d="M0 95 L50 70 L100 105 L150 55 L200 80 L250 40 L300 65 L300 130 L0 130 Z" fill="url(#g)"/>' +
  '<path d="M0 95 L50 70 L100 105 L150 55 L200 80 L250 40 L300 65" fill="none" stroke="#2f6feb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle cx="250" cy="40" r="4" fill="#2f6feb"/></svg>'
);
const YEAR_IMG = enc(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="130" viewBox="0 0 300 130" preserveAspectRatio="none">' +
  '<rect x="10" y="40" width="9" height="80" rx="2" fill="#17a34a"/><rect x="21" y="70" width="9" height="50" rx="2" fill="#e5e5e5"/>' +
  '<rect x="55" y="35" width="9" height="85" rx="2" fill="#17a34a"/><rect x="66" y="82" width="9" height="38" rx="2" fill="#e5e5e5"/>' +
  '<rect x="100" y="50" width="9" height="70" rx="2" fill="#17a34a"/><rect x="111" y="60" width="9" height="60" rx="2" fill="#e5e5e5"/>' +
  '<rect x="145" y="30" width="9" height="90" rx="2" fill="#17a34a"/><rect x="156" y="78" width="9" height="42" rx="2" fill="#e5e5e5"/>' +
  '<rect x="190" y="45" width="9" height="75" rx="2" fill="#17a34a"/><rect x="201" y="66" width="9" height="54" rx="2" fill="#e5e5e5"/>' +
  '<rect x="235" y="25" width="9" height="95" rx="2" fill="#2f6feb"/><rect x="246" y="88" width="9" height="32" rx="2" fill="rgba(47,111,235,0.38)"/></svg>'
);

const DEFAULT_IDS = ['overview', 'trend', 'year', 'total'];

function buildDefs(dash, cur) {
  const o = dash.overview, t = dash.total;
  return {
    overview: {
      id: 'overview', kind: 'grid', title: '本月收支概览', sub: o.monthLabel,
      minis: [
        { k: '收入', v: fmt.money(o.income, cur), color: '#17a34a' },
        { k: '支出', v: fmt.money(o.expense, cur), color: '' },
        { k: '结余', v: fmt.signedTotal(o.balance, cur), color: '#2f6feb', span2: true, accent: true },
      ],
    },
    trend: {
      id: 'trend', kind: 'chart', title: '支出趋势', sub: '近 7 日 · 按日', img: TREND_IMG,
      legends: [{ text: '近 7 日' }, { text: '示意', right: true }],
    },
    year: {
      id: 'year', kind: 'chart', title: '近一年收支', sub: '收入 vs 支出 · 按月', img: YEAR_IMG,
      legends: [
        { dot: true, dotColor: '#17a34a', text: '收入' },
        { dot: true, dotColor: '#e5e5e5', text: '支出' },
        { text: '示意', right: true },
      ],
    },
    total: {
      id: 'total', kind: 'grid', title: '账本累计收支', sub: `自 ${t.since} 建立以来`,
      minis: [
        { k: '总收入', v: fmt.money(t.income, cur), color: '#17a34a' },
        { k: '总支出', v: fmt.money(t.expense, cur), color: '' },
        { k: '累计结余', v: fmt.signedTotal(t.balance, cur), color: '', span2: true },
      ],
    },
  };
}

Page({
  data: {
    cards: [],
    editing: false,
    draggingId: null,
    editIcon: '',
    dragIcon: '',
    barsIcon: '',
    navSub: '',
    needInit: false,
  },

  onLoad() {
    this.setData({
      editIcon: icons.get('pencil', '#111111', 1.8),
      dragIcon: icons.get('dragHandle', '#9a9a9a', 1.8),
      barsIcon: icons.get('bars', '#9a9a9a', 1.4),
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
      if (!book) { this.setData({ needInit: true }); return; }
      this.bookId = book.bookId;
      const cur = book.displayCurrency || 'CNY';
      this.setData({ navSub: `${book.name} · 展示 ${fmt.symbolOf(cur)} ${cur}`, needInit: false });
      const [dash, layout] = await Promise.all([
        api.call('stats', 'getDashboard', { bookId: book.bookId }),
        api.call('layout', 'get', { bookId: book.bookId }),
      ]);
      this.defs = buildDefs(dash, cur);
      const ids = (layout.order || DEFAULT_IDS).filter((id) => this.defs[id]);
      this.setData({ cards: ids.map((id) => this.defs[id]) });
    } catch (e) { api.toast(e); }
  },

  toggleEdit() {
    const editing = !this.data.editing;
    this.setData({ editing, editIcon: icons.get('pencil', editing ? '#2f6feb' : '#111111', 1.8) });
    if (!editing) this.saveOrder();
  },

  onLongPress() { if (!this.data.editing) this.toggleEdit(); },

  removeCard(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ cards: this.data.cards.filter((c) => c.id !== id) });
    this.saveOrder();
  },

  saveOrder() {
    if (!this.bookId) return;
    api.call('layout', 'save', { bookId: this.bookId, order: this.data.cards.map((c) => c.id) }).catch(() => {});
  },

  restoreDefault() {
    if (!this.defs) return;
    this.setData({ cards: DEFAULT_IDS.map((id) => this.defs[id]), editing: false, editIcon: icons.get('pencil', '#111111', 1.8) });
    this.saveOrder();
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
    if (to !== from && to >= 0) {
      const arr = cards.slice();
      const [m] = arr.splice(from, 1);
      arr.splice(to, 0, m);
      this.setData({ cards: arr });
      this.measure();
    }
  },
  onHandleTouchEnd() {
    if (this.data.draggingId != null) { this.setData({ draggingId: null }); this.saveOrder(); }
  },
});
