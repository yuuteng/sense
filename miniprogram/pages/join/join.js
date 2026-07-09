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
    const role = query.role === 'ro' ? 'ro' : 'rw'; // 邀请人在分享时选定的权限
    if (!bookId) { this.setData({ status: 'error', msg: '邀请链接无效' }); return; }
    api.call('member', 'join', { bookId, role }).then((r) => {
      // 后端已把该账本设为默认；未注册用户引导先完成登录，登录后进首页即见新账本
      if (!r.registered) {
        this.setData({ status: 'ok', bookName: r.name, msg: '已加入账本，请先完成微信登录' });
        setTimeout(() => wx.reLaunch({ url: '/pages/login/login' }), 1200);
        return;
      }
      this.setData({ status: 'ok', bookName: r.name, msg: r.already ? '你已在该账本中，已切换为当前账本' : '成功加入，已切换为当前账本' });
      setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 1200);
    }).catch((e) => {
      this.setData({ status: 'error', msg: (e && e.errMsg) || '加入失败' });
    });
  },

  goHome() { wx.switchTab({ url: '/pages/home/home' }); },
});
