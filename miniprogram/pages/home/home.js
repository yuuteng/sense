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
  },

  onLoad() {
    this.setData({
      chevronDown: icons.get('chevronDown', '#6b6b6b', 2.2),
      plusIcon: icons.get('plus', '#ffffff', 2.4),
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
        bookName: book.name,
        displayCurrency: `展示 · ${sym} ${cur}`,
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
    const who = it.sameActor
      ? `${it.recorderName}记 · ${it.categoryTopName}`
      : `${it.payerName}付 · ${it.categoryTopName}`;
    return {
      id: it.recordId,
      iconSrc: icons.get(it.icon, it.type === 'income' ? '#17a34a' : '#444444', 1.7),
      title: it.title,
      who,
      whoInitial: it.recorderInitial,
      whoColor: it.recorderColor,
      amount: fmt.signed(it.amountConverted, it.type, cur),
      in: it.type === 'income',
      fx: it.isForeign ? (fmt.symbolOf(it.currency) + fmt.fmt(it.originalAmount)) : '',
      sub: it.isForeign ? `按 ${fmt.mmdd(it.date)} 汇率` : '',
    };
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  goSettings() {
    wx.switchTab({ url: '/pages/settings/settings' });
  },
});
