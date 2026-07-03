const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

Page({
  data: {
    bookName: '',
    displayCurrency: '',
    summary: {},
    groups: [],
    chevronDown: '',
    plusIcon: '',
    loading: true,
    needInit: false,
    // 账本切换面板
    switcherVisible: false,
    currentBookId: '',
    books: [],
    // 展示币种切换
    curCode: 'CNY',
    curSym: '¥',
    curVisible: false,
  },

  onLoad() {
    this.setData({
      chevronDown: icons.get('chevronDown', '#748294', 2.2),
      plusIcon: icons.get('plus', '#ffffff', 2.4),
      bookIcon: icons.get('book', '#0089c0', 1.7),
      houseIcon: icons.get('house', '#a47d06', 1.7),
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    this.load();
  },

  async load() {
    try {
      // 登录闸门：未注册 → 登录页
      const profile = await api.call('user', 'getProfile');
      if (!profile.registered) { wx.reLaunch({ url: '/pages/login/login' }); return; }
      const book = await api.call('book', 'getCurrent');
      // 无账本 → 引导创建
      if (!book) { wx.reLaunch({ url: '/pages/onboarding/onboarding' }); return; }
      const cur = book.displayCurrency || 'CNY';
      const sym = fmt.symbolOf(cur);
      const [summary, list] = await Promise.all([
        api.call('stats', 'getMonthlySummary', { bookId: book.bookId }),
        api.call('record', 'list', { bookId: book.bookId, currency: cur }),
      ]);
      this.setData({
        loading: false,
        needInit: false,
        currentBookId: book.bookId,
        bookName: book.name,
        curCode: cur,
        curSym: sym,
        summary: {
          monthLabel: `${summary.monthLabel} · 本月结余`,
          balance: fmt.signedTotal(summary.balance, cur),
          income: fmt.money(summary.income, cur),
          expense: fmt.money(summary.expense, cur),
        },
        groups: (list.groups || []).map((g) => ({
          date: fmt.dayLabel(g.date),
          total: fmt.signedTotal(g.total, cur),
          items: (g.items || []).map((it) => this.mapItem(it, cur)),
        })),
      });
    } catch (e) {
      this.setData({ loading: false, needInit: e.code === 'NOT_MEMBER' });
      if (e.code !== 'NOT_MEMBER') api.toast(e);
    }
  },

  mapItem(it, cur) {
    return {
      id: it.recordId,
      iconSrc: icons.get(it.icon, it.type === 'income' ? '#5c9a0e' : '#0089c0', 1.7),
      title: it.title || it.categoryTopName || (it.type === 'income' ? '收入' : '支出'),
      who: it.recorderName,
      whoInitial: it.recorderInitial,
      whoColor: it.recorderColor,
      whoAvatar: it.recorderAvatar || '',
      amount: fmt.signed(it.amountConverted, it.type, cur),
      in: it.type === 'income',
      fx: it.isForeign ? (fmt.symbolOf(it.currency) + fmt.fmt(it.originalAmount)) : '',
      sub: it.isForeign ? `按 ${fmt.cnMonthDay(it.date)} 汇率` : '',
    };
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  goSettings() {
    wx.switchTab({ url: '/pages/settings/settings' });
  },

  // 点击顶栏账本名 → 拉取账本列表并弹出切换面板
  async openSwitcher() {
    try {
      const list = await api.call('book', 'list');
      this.setData({
        books: list.map((b) => ({
          bookId: b.bookId,
          name: b.name,
          typeLabel: b.typeLabel,
          typeClass: b.type === 'split' ? 'book-type--split' : 'book-type--share',
          iconSrc: b.type === 'split' ? this.data.houseIcon : this.data.bookIcon,
          iconBg: b.type === 'split' ? 'rgba(255,205,47,0.16)' : 'rgba(0,204,249,0.12)',
        })),
        switcherVisible: true,
      });
    } catch (e) { api.toast(e); }
  },

  // 选中某账本：设为默认账本（服务端），关闭面板并刷新首页
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

  goManageBooks() {
    this.setData({ switcherVisible: false });
    wx.navigateTo({ url: '/pages/books/books' });
  },

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
