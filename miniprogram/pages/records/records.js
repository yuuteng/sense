// 记录筛选列表（统计钻取落地页）：按 月份/日期范围 × 分类 × 收支类型 过滤，
// 布局与首页记账列表一致（.txn 全局样式），按天分组、分页加载，点行进详情。
const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

Page({
  data: {
    title: '记录明细',
    subtitle: '',
    summaryText: '',
    groups: [],
    hasMore: false,
    loadingMore: false,
    loading: true,
    empty: false,
  },

  onLoad(q) {
    // 入参均可选：bookId 必传；dateFrom/dateTo/categoryTopId/type/catName/monthText
    this.bookId = q.bookId;
    this.filters = {
      dateFrom: q.dateFrom || '',
      dateTo: q.dateTo || '',
      categoryTopId: q.categoryTopId || '',
      type: q.type === 'income' || q.type === 'expense' ? q.type : '',
    };
    const catName = decodeURIComponent(q.catName || '');
    const monthText = decodeURIComponent(q.monthText || '');
    const typeText = this.filters.type === 'income' ? '收入' : this.filters.type === 'expense' ? '支出' : '';
    const parts = [monthText, catName, typeText].filter(Boolean);
    this.setData({ title: parts.join(' · ') || '记录明细' });
    this.load();
  },

  async load() {
    try {
      const list = await this.fetch(0);
      this.page = 0;
      const cur = list.displayCurrency || 'CNY';
      this.cur = cur;
      const s = list.summary || { income: 0, expense: 0, count: 0 };
      const sumParts = [];
      if (this.filters.type !== 'expense' && s.income > 0) sumParts.push(`收入 ${fmt.money(s.income, cur)}`);
      if (this.filters.type !== 'income' && s.expense > 0) sumParts.push(`支出 ${fmt.money(s.expense, cur)}`);
      this.setData({
        loading: false,
        summaryText: s.count ? `共 ${s.count} 笔${sumParts.length ? ' · ' + sumParts.join(' · ') : ''}` : '',
        groups: this.mapGroups(list.groups, cur),
        hasMore: !!list.hasMore,
        empty: !(list.groups || []).length,
      });
    } catch (e) { this.setData({ loading: false }); api.toast(e); }
  },

  fetch(page) {
    return api.call('record', 'list', {
      bookId: this.bookId,
      page,
      withSummary: page === 0,
      ...this.filters,
    });
  },

  async onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    try {
      const list = await this.fetch((this.page || 0) + 1);
      this.page = list.page;
      this.setData({
        groups: this.data.groups.concat(this.mapGroups(list.groups, this.cur)),
        hasMore: !!list.hasMore,
        loadingMore: false,
      });
    } catch (e) { this.setData({ loadingMore: false }); api.toast(e); }
  },

  mapGroups(groups, cur) {
    return (groups || []).map((g) => ({
      date: fmt.dayLabel(g.date),
      total: fmt.signedTotal(g.total, cur),
      items: (g.items || []).map((it) => ({
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
      })),
    }));
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },
});
