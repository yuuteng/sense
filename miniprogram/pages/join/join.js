const api = require('../../utils/api');

Page({
  data: {
    statusBarHeight: 20,
    status: 'joining', // joining | ok | error
    bookName: '',
    msg: '',
  },

  onLoad(query) {
    const app = getApp();
    this.setData({ statusBarHeight: (app && app.globalData && app.globalData.statusBarHeight) || 20 });
    const bookId = query.bookId;
    if (!bookId) { this.setData({ status: 'error', msg: '邀请链接无效' }); return; }
    api.call('member', 'join', { bookId }).then((r) => {
      this.setData({ status: 'ok', bookName: r.name, msg: r.already ? '你已在该账本中' : '成功加入账本' });
    }).catch((e) => {
      this.setData({ status: 'error', msg: (e && e.errMsg) || '加入失败' });
    });
  },

  goHome() { wx.switchTab({ url: '/pages/home/home' }); },
});
