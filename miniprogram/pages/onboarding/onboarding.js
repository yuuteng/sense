const icons = require('../../utils/icons');
const api = require('../../utils/api');
const cur = require('../../utils/currency');

Page({
  data: {
    statusBarHeight: 20,
    bookName: '',
    type: 'share',
    baseCur: 'CNY',
    curLabel: cur.label('CNY'),
    curVisible: false,
    chevron: '',
  },

  onLoad() {
    const app = getApp();
    this.setData({
      statusBarHeight: (app && app.globalData && app.globalData.statusBarHeight) || 20,
      chevron: icons.get('chevron', '#748294', 2),
    });
  },

  onNameInput(e) { this.setData({ bookName: e.detail.value }); },
  pickType(e) { this.setData({ type: e.currentTarget.dataset.t }); },

  openCur() { this.setData({ curVisible: true }); },
  closeCur() { this.setData({ curVisible: false }); },
  onCur(e) {
    const code = e.detail.code;
    this.setData({ baseCur: code, curLabel: cur.label(code), curVisible: false });
  },

  create() {
    const name = (this.data.bookName || '').trim() || '我的账本';
    wx.showLoading({ title: '创建中…' });
    api.call('book', 'create', { name, bookType: this.data.type, baseCurrency: this.data.baseCur })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '账本已创建', icon: 'success' });
        setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 600);
      })
      .catch((e) => { wx.hideLoading(); api.toast(e); });
  },
});
