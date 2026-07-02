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
    this.setData({ ic: { check: icons.get('check', '#2f6feb', 2.4) } });
    this.load();
  },

  async load() {
    if (!this.recordId) { this.setData({ loading: false }); return; }
    try {
      const r = await api.call('record', 'get', { recordId: this.recordId });
      const base = r.baseCurrency;
      const d = {
        title: r.title,
        category: r.category,
        type: r.typeLabel,
        isForeign: r.isForeign,
        displayAmount: fmt.signed(r.amountConverted, r.type, base),
        originalAmount: fmt.symbolOf(r.currency) + fmt.fmt(r.amount),
        rate: `1 ${r.currency} ≈ ${fmt.money(r.rate, base)}`,
        convertedAmount: fmt.money(r.amountConverted, base),
        fixNote: `此笔换算金额在记账当日（${fmt.mmdd(r.date)}）已固定，之后汇率变化不影响历史。汇率仅供记账参考，与银行实际结算可能有差异。`,
        date: r.date,
        note: r.note || '—',
        images: r.images || [],
        recorder: r.recorder,
        payer: r.payer,
        canEdit: r.canEdit,
      };
      this.setData({ d, loading: false, iconSrc: icons.get(r.icon || 'dots', '#444444', 1.6) });
    } catch (e) {
      this.setData({ loading: false });
      api.toast(e);
    }
  },

  onEdit() {
    wx.navigateTo({ url: '/pages/add/add' });
  },

  async onDelete() {
    if (this.data.delConfirm) {
      try {
        await api.call('record', 'delete', { recordId: this.recordId });
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
