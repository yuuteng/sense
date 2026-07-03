const api = require('../../utils/api');
const icons = require('../../utils/icons');
const cur = require('../../utils/currency');

Page({
  data: {
    ic: {},
    profile: { nickname: '', avatarInitial: '我', avatarColor: '#0089c0', avatarFileID: '', bookCount: 0, defaultBookName: '' },
    curCode: 'CNY',
    curLabel: cur.label('CNY'),
    curVisible: false,
    aiLimit: 50,
    importVal: '',
    loading: true,
  },

  onLoad() {
    this.setData({
      ic: {
        currency: icons.get('currency', '#0089c0', 1.7),
        list: icons.get('list', '#0089c0', 1.7),
        aiBox: icons.get('aiBox', '#0089c0', 1.7),
        book: icons.get('book', '#0089c0', 1.7),
        download: icons.get('download', '#0089c0', 1.7),
        upload: icons.get('upload', '#0089c0', 1.7),
        seed: icons.get('privacy', '#0089c0', 1.7),
        wipe: icons.get('trash', '#f62172', 1.7),
        refresh: icons.get('refresh', '#0089c0', 1.8),
        chevron: icons.get('chevron', '#748294', 2),
      },
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    // 用缓存的资料先秒显，避免白屏
    const cached = getApp().globalData && getApp().globalData.profile;
    if (cached) this.setData({ profile: cached, loading: false });
    this.load();
  },

  async load() {
    try {
      const [profile, s] = await Promise.all([
        api.call('user', 'getProfile'),
        api.call('settings', 'get'),
      ]);
      getApp().globalData.profile = profile;
      this.setData({
        profile,
        curCode: s.displayCurrency,
        curLabel: cur.label(s.displayCurrency),
        aiLimit: s.aiMessageLimit,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  editProfile() {
    wx.showModal({
      title: '修改昵称', editable: true, content: this.data.profile.nickname,
      success: (res) => {
        if (!res.confirm || !res.content.trim()) return;
        api.call('user', 'updateProfile', { nickname: res.content.trim() })
          .then(() => this.load())
          .catch(api.toast);
      },
    });
  },

  openCur() { this.setData({ curVisible: true }); },
  closeCur() { this.setData({ curVisible: false }); },
  onCur(e) {
    const code = e.detail.code;
    this.setData({ curCode: code, curLabel: cur.label(code), curVisible: false });
    api.call('settings', 'update', { displayCurrency: code }).catch(api.toast);
  },

  refreshRates() {
    wx.showLoading({ title: '刷新汇率中…' });
    api.call('rate', 'refresh').then((r) => {
      wx.hideLoading();
      wx.showToast({ title: `已更新 ${r.count} 种币汇率`, icon: 'none' });
    }).catch((e) => { wx.hideLoading(); api.toast(e); });
  },

  goBooks() { wx.navigateTo({ url: '/pages/books/books' }); },

  // 导出：进入独立配置页（选账本 / 时间段 / 格式 / 下载方式）
  onExport() { wx.navigateTo({ url: '/pages/export/export' }); },

  // 导入：选 JSON 文件 → 读取 → 后端解析入库
  onImport() {
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['json'],
      success: (r) => {
        let content;
        try { content = wx.getFileSystemManager().readFileSync(r.tempFiles[0].path, 'utf8'); }
        catch (e) { wx.showToast({ title: '读取文件失败', icon: 'none' }); return; }
        wx.showLoading({ title: '导入中…' });
        api.call('book', 'getCurrent')
          .then((book) => api.call('data', 'import', { bookId: book.bookId, content }))
          .then((res) => {
            wx.hideLoading();
            this.setData({ importVal: `成功 ${res.success} · 失败 ${res.failed}` });
            wx.showToast({ title: `导入成功 ${res.success} 条`, icon: 'success' });
          })
          .catch((e) => { wx.hideLoading(); api.toast(e); });
      },
    });
  },

  resetData() {
    wx.showModal({
      title: '清空所有数据',
      content: '将删除全部账本/成员/记录/分类/会话，以及所有用户登录信息，回到全新状态（需重新登录）。此操作不可恢复，确定继续？',
      confirmColor: '#f62172',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '清空中…' });
        api.call('seed', 'reset').then((r) => {
          wx.hideLoading();
          const left = Object.entries((r && r.result) || {}).filter(([, v]) => v.remaining > 0);
          if (left.length) {
            wx.showModal({ title: '部分未清空', showCancel: false, content: '仍有残留：' + left.map(([k, v]) => `${k}(${v.remaining})`).join('、') + '。请再点一次「清空所有数据」。' });
            return;
          }
          wx.showToast({ title: '已清空', icon: 'success' });
          setTimeout(() => wx.reLaunch({ url: '/pages/login/login' }), 600);
        }).catch((e) => { wx.hideLoading(); api.toast(e); });
      },
    });
  },

  initSeed() {
    wx.showModal({
      title: '初始化测试数据',
      content: '将清空并重新载入演示数据（账本/成员/记录等），当前用户会成为「小雨」。确定继续？',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '初始化中…' });
        api.call('seed', 'run').then(() => {
          wx.hideLoading();
          wx.showToast({ title: '初始化完成', icon: 'success' });
          this.load();
        }).catch((e) => { wx.hideLoading(); api.toast(e); });
      },
    });
  },
});
