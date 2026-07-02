const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

const CUR_CODES = ['CNY', 'EUR', 'USD'];

Page({
  data: {
    ic: {},
    profile: { nickname: '', avatarInitial: '我', avatarColor: '#2b5cff', avatarFileID: '', bookCount: 0, defaultBookName: '' },
    curCode: 'CNY',
    curVal: '¥ CNY ⌄',
    aiLimit: 50,
    exportVal: 'JSON',
    importVal: 'JSON',
  },

  onLoad() {
    this.setData({
      ic: {
        currency: icons.get('currency', '#2b5cff', 1.7),
        list: icons.get('list', '#2b5cff', 1.7),
        aiBox: icons.get('aiBox', '#2b5cff', 1.7),
        book: icons.get('book', '#2b5cff', 1.7),
        download: icons.get('download', '#2b5cff', 1.7),
        upload: icons.get('upload', '#2b5cff', 1.7),
        seed: icons.get('privacy', '#2b5cff', 1.7),
        chevron: icons.get('chevron', '#8b867b', 2),
      },
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    this.load();
  },

  async load() {
    try {
      const [profile, s] = await Promise.all([
        api.call('user', 'getProfile'),
        api.call('settings', 'get'),
      ]);
      this.setData({
        profile,
        curCode: s.displayCurrency,
        curVal: `${fmt.symbolOf(s.displayCurrency)} ${s.displayCurrency} ⌄`,
        aiLimit: s.aiMessageLimit,
      });
    } catch (e) { /* 未初始化时静默 */ }
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

  cycleCurrency() {
    const i = (CUR_CODES.indexOf(this.data.curCode) + 1) % CUR_CODES.length;
    const code = CUR_CODES[i];
    this.setData({ curCode: code, curVal: `${fmt.symbolOf(code)} ${code} ⌄` });
    api.call('settings', 'update', { displayCurrency: code }).catch(api.toast);
  },

  goBooks() { wx.navigateTo({ url: '/pages/books/books' }); },

  // 导出：拉数据 → 写临时文件 → 转发/保存，失败则复制到剪贴板
  onExport() {
    wx.showLoading({ title: '导出中…' });
    let bookName = '账本';
    api.call('book', 'getCurrent').then((book) => {
      if (!book) throw { errMsg: '请先创建账本' };
      bookName = book.name;
      return api.call('data', 'export', { bookId: book.bookId });
    }).then((res) => {
      wx.hideLoading();
      const json = JSON.stringify(res.data, null, 2);
      const path = `${wx.env.USER_DATA_PATH}/sense-${Date.now()}.json`;
      const fs = wx.getFileSystemManager();
      fs.writeFile({
        filePath: path, data: json, encoding: 'utf8',
        success: () => {
          wx.shareFileMessage({
            filePath: path, fileName: `${bookName}.json`,
            success: () => this.setData({ exportVal: `已导出 ${res.count} 条` }),
            fail: () => { wx.setClipboardData({ data: json }); wx.showToast({ title: `已导出 ${res.count} 条并复制`, icon: 'none' }); this.setData({ exportVal: `已导出 ${res.count} 条` }); },
          });
        },
        fail: () => { wx.setClipboardData({ data: json }); wx.showToast({ title: '已复制到剪贴板', icon: 'none' }); },
      });
    }).catch((e) => { wx.hideLoading(); api.toast(e); });
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
