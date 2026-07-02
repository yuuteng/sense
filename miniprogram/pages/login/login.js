const api = require('../../utils/api');

Page({
  data: {
    statusBarHeight: 20,
    avatarUrl: '',
    nickname: '',
    submitting: false,
  },

  onLoad() {
    const app = getApp();
    this.setData({ statusBarHeight: (app && app.globalData && app.globalData.statusBarHeight) || 20 });
  },

  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl });
  },

  onNickname(e) {
    this.setData({ nickname: e.detail.value });
  },

  async submit() {
    const nickname = (this.data.nickname || '').trim();
    if (!nickname) { wx.showToast({ title: '请填写昵称', icon: 'none' }); return; }
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    wx.showLoading({ title: '登录中…' });
    try {
      let avatarFileID = '';
      if (this.data.avatarUrl) {
        const up = await wx.cloud.uploadFile({
          cloudPath: `avatars/${Date.now()}.png`,
          filePath: this.data.avatarUrl,
        });
        avatarFileID = up.fileID;
      }
      await api.call('user', 'login', { nickname, avatarFileID });
      const app = getApp();
      if (app && app.globalData) app.globalData.profile = { nickname, avatarFileID, registered: true };
      wx.hideLoading();
      // 有账本进首页，无账本去引导创建
      const books = await api.call('book', 'list').catch(() => []);
      if (books && books.length) wx.switchTab({ url: '/pages/home/home' });
      else wx.reLaunch({ url: '/pages/onboarding/onboarding' });
    } catch (e) {
      wx.hideLoading();
      this.setData({ submitting: false });
      api.toast(e);
    }
  },
});
