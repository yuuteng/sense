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
    exportVal: '',
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

  // 导出：先选格式
  onExport() {
    wx.showActionSheet({
      itemList: ['Excel (.xlsx)', 'CSV', 'JSON', 'PDF'],
      success: (r) => {
        const map = ['excel', 'csv', 'json', 'pdf'];
        this.doExport(map[r.tapIndex]);
      },
    });
  },

  doExport(format) {
    wx.showLoading({ title: '生成中…' });
    api.call('book', 'getCurrent')
      .then((book) => { if (!book) throw { errMsg: '请先创建账本' }; return api.call('data', 'export', { bookId: book.bookId, format }); })
      .then((res) => {
        // 下载到本地临时文件
        wx.cloud.downloadFile({ fileID: res.fileID }).then((dl) => {
          wx.hideLoading();
          this.setData({ exportVal: `已导出 ${res.count} 条` });
          this.deliverFile(dl.tempFilePath, res.fileType, res.fileName);
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '下载失败', icon: 'none' }); });
      })
      .catch((e) => { wx.hideLoading(); api.toast(e); });
  },

  // 交付文件：预览 或 转发/保存到微信
  deliverFile(filePath, fileType, fileName) {
    wx.showActionSheet({
      itemList: ['预览文件', '转发 / 保存到微信'],
      success: (r) => {
        if (r.tapIndex === 0) {
          wx.openDocument({
            filePath, fileType, showMenu: true,
            fail: () => wx.shareFileMessage({ filePath, fileName, fail: () => wx.showToast({ title: '该格式不支持预览，请选转发', icon: 'none' }) }),
          });
        } else {
          wx.shareFileMessage({ filePath, fileName, fail: () => wx.showToast({ title: '转发失败，可改用预览后保存', icon: 'none' }) });
        }
      },
    });
  },

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
        api.call('seed', 'reset').then(() => {
          wx.hideLoading();
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
