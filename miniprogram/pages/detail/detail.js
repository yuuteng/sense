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
        isIn: r.type === 'income',
        isForeign: r.isForeign,
        isSplit: r.isSplit,
        displayAmount: fmt.signed(r.amountConverted, r.type, disp),
        originalAmount: fmt.symbolOf(r.currency) + ' ' + fmt.fmt(r.amount),
        rate: `1 ${r.currency} ≈ ${fmt.money(r.rate, disp)}`,
        convertedAmount: fmt.money(r.amountConverted, disp),
        fixNote: `这笔账按记账当天（${fmt.cnMonthDay(r.date)}）的「${r.currency} → ${disp}」汇率换算，结果保存后不再变：以后汇率涨跌，这笔的金额也不会跟着变。`,
        date: r.date,
        note: r.note || '—',
        images: r.images || [],
        recorder: r.recorder,
        payer: r.payer,
        splitInfo: r.splitInfo || null,
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

  // 图片附件全屏预览（与反馈详情页同能力）
  previewImage(e) {
    const src = e.currentTarget.dataset.src;
    if (!src) return;
    wx.previewImage({ current: src, urls: this.data.d.images });
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
