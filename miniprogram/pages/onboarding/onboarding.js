Page({
  data: {
    statusBarHeight: 20,
    bookName: '家庭日常',
    type: 'share', // share | split
    baseCur: 'CNY',
    curs: [
      { code: 'CNY', label: '¥ CNY' },
      { code: 'EUR', label: '€ EUR' },
      { code: 'USD', label: '$ USD' },
    ],
  },

  onLoad() {
    const app = getApp();
    this.setData({ statusBarHeight: (app && app.globalData && app.globalData.statusBarHeight) || 20 });
  },

  onNameInput(e) {
    this.setData({ bookName: e.detail.value });
  },

  pickType(e) {
    this.setData({ type: e.currentTarget.dataset.t });
  },

  pickCur(e) {
    this.setData({ baseCur: e.currentTarget.dataset.c });
  },

  create() {
    const name = (this.data.bookName || '').trim() || '我的账本';
    const api = require('../../utils/api');
    wx.showLoading({ title: '创建中…' });
    api.call('book', 'create', { name, type: this.data.type, baseCurrency: this.data.baseCur })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '账本已创建', icon: 'success' });
        setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 600);
      })
      .catch((e) => { wx.hideLoading(); api.toast(e); });
  },
});
