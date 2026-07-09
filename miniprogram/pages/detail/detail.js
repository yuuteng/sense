const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

Page({
  data: {
    d: null,
    ic: {},
    delConfirm: false,
    delText: '删除',
    loading: true,
  },

  onLoad(query) {
    this.recordId = query.id;
    this.setData({ ic: { check: icons.get('check', '#0089c0', 2.4) } });
  },

  onShow() { if (this.recordId) this.load(); },

  async load() {
    if (!this.recordId) { this.setData({ loading: false }); return; }
    try {
      const r = await api.call('record', 'get', { recordId: this.recordId });
      const disp = r.displayCurrency || r.currency;
      const d = {
        title: r.title,
        category: r.category,
        type: r.typeLabel,
        isForeign: r.isForeign,
        isSplit: r.isSplit,
        displayAmount: fmt.signed(r.amountConverted, r.type, disp),
        originalAmount: fmt.symbolOf(r.currency) + fmt.fmt(r.amount),
        rate: `1 ${r.currency} ≈ ${fmt.money(r.rate, disp)}`,
        convertedAmount: fmt.money(r.amountConverted, disp),
        fixNote: `此笔按记账当日（${fmt.cnMonthDay(r.date)}）的「${r.currency} → ${disp}」汇率换算；换其他展示币种会用当日对应汇率，历史金额不随今日汇率变动。`,
        date: r.date,
        note: r.note || '—',
        images: r.images || [],
        recorder: r.recorder,
        payer: r.payer,
        canEdit: r.canEdit,
      };
      this.setData({ d, loading: false, iconSrc: icons.get(r.icon || 'dots', '#3e4550', 1.6) });
    } catch (e) {
      this.setData({ loading: false });
      api.toast(e);
    }
  },

  onEdit() {
    wx.navigateTo({ url: '/pages/add/add?id=' + this.recordId });
  },

  async onDelete() {
    if (this.data.delConfirm) {
      try {
        await api.call('record', 'delete', { recordId: this.recordId });
        // 交接给首页做乐观移除：返回时该行立即消失，服务器数据回来后整体校正
        getApp().globalData.justDeleted = this.recordId;
        wx.showToast({ title: '已删除', icon: 'success' });
        setTimeout(() => wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }); } }), 500);
      } catch (e) { api.toast(e); }
      return;
    }
    this.setData({ delConfirm: true, delText: '再次点击确认删除' });
    setTimeout(() => {
      if (this.data.delConfirm) this.setData({ delConfirm: false, delText: '删除' });
    }, 2500);
  },
});
