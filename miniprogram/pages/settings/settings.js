const api = require('../../utils/api');
const icons = require('../../utils/icons');
const cur = require('../../utils/currency');
const fmt = require('../../utils/format');

// 最近一次导入结果的本地缓存键（关面板后可从导入行摘要重新打开）
const LAST_IMPORT_KEY = 'sense.lastImportResult';

Page({
  data: {
    ic: {},
    profile: { nickname: '', avatarInitial: '我', avatarColor: '#0089c0', avatarFileID: '', bookCount: 0, defaultBookName: '' },
    curCode: 'CNY',
    curLabel: cur.label('CNY'),
    curVisible: false,
    importVal: '',
    importResult: null, // 导入结果面板：{ success, failed, createdCategories, failures[], allOk }
    fbUnread: 0,
    versionLabel: '',
    loading: true,
  },

  onLoad() {
    // 真实版本号：正式版取上架版本；体验/开发环境无版本号，标注环境
    let versionLabel = '开发版';
    try {
      const mp = (wx.getAccountInfoSync() || {}).miniProgram || {};
      if (mp.version) versionLabel = 'v' + mp.version;
      else if (mp.envVersion === 'trial') versionLabel = '体验版';
    } catch (e) { /* 取不到就保持开发版 */ }
    this.setData({
      versionLabel,
      ic: {
        currency: icons.get('currency', '#0089c0', 1.7),
        list: icons.get('list', '#0089c0', 1.7),
        book: icons.get('book', '#0089c0', 1.7),
        download: icons.get('download', '#0089c0', 1.7),
        upload: icons.get('upload', '#0089c0', 1.7),
        seed: icons.get('privacy', '#0089c0', 1.7),
        mail: icons.get('mail', '#0089c0', 1.7),
        wipe: icons.get('trash', '#f62172', 1.7),
        refresh: icons.get('refresh', '#0089c0', 1.8),
        chevron: icons.get('chevron', '#748294', 2),
      },
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3, hidden: false });
    }
    // 用缓存的资料先秒显，避免白屏
    const cached = getApp().globalData && getApp().globalData.profile;
    if (cached) this.setData({ profile: cached, loading: false });
    // 恢复最近一次导入的摘要（点击可重开结果面板）
    if (!this.data.importVal) {
      try {
        const r = wx.getStorageSync(LAST_IMPORT_KEY);
        if (r && r.time) this.setData({ importVal: r.undone ? '已撤销' : `成功 ${r.success} · 失败 ${r.failed}` });
      } catch (e) { /* 读不到当作没有 */ }
    }
    this.load();
  },

  async load() {
    try {
      const [profile, s, fb] = await Promise.all([
        api.call('user', 'getProfile'),
        api.call('settings', 'get'),
        api.call('feedback', 'unreadCount').catch(() => ({ count: 0 })),
      ]);
      getApp().globalData.profile = profile;
      this.setData({
        profile,
        curCode: s.displayCurrency,
        curLabel: cur.label(s.displayCurrency),
        fbUnread: fb.count || 0,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  // 改昵称：乐观更新本地与全局缓存，失败回滚
  editProfile() {
    wx.showModal({
      title: '修改昵称', editable: true, content: this.data.profile.nickname,
      success: (res) => {
        if (!res.confirm || !res.content.trim()) return;
        const nickname = res.content.trim().slice(0, 20);
        const prev = this.data.profile.nickname;
        if (nickname === prev) return;
        const apply = (name) => {
          this.setData({ 'profile.nickname': name, 'profile.avatarInitial': name.slice(0, 1) });
          const g = getApp().globalData;
          if (g && g.profile) { g.profile.nickname = name; g.profile.avatarInitial = name.slice(0, 1); }
        };
        apply(nickname);
        api.call('user', 'updateProfile', { nickname })
          .catch((e) => { apply(prev); api.toast(e); });
      },
    });
  },

  // 换头像：微信头像选择 → 乐观先显示临时图 → 传云存储 → 落库（失败回滚）
  onChooseAvatar(e) {
    const url = e.detail && e.detail.avatarUrl;
    if (!url) return;
    const prev = this.data.profile.avatarFileID;
    this.setData({ 'profile.avatarFileID': url });
    wx.cloud.uploadFile({ cloudPath: `avatars/${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`, filePath: url })
      .then((up) => api.call('user', 'updateProfile', { avatarFileID: up.fileID }).then(() => up.fileID))
      .then((fileID) => {
        this.setData({ 'profile.avatarFileID': fileID });
        const g = getApp().globalData;
        if (g && g.profile) g.profile.avatarFileID = fileID;
        wx.showToast({ title: '头像已更新', icon: 'success' });
      })
      .catch((err) => { this.setData({ 'profile.avatarFileID': prev }); api.toast(err); });
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

  goFeedback() { wx.navigateTo({ url: '/pages/feedback/feedback' }); },

  goPrivacy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },

  // 导出：进入独立配置页（选账本 / 时间段 / 格式 / 下载方式）
  onExport() { wx.navigateTo({ url: '/pages/export/export' }); },

  // 导入：选 JSON / CSV / Excel 文件 → 按扩展名读文本或 base64 → 后端解析入库
  // 外部软件导出的表头会在后端做键名映射适配；结果弹窗给出成功/失败与原因
  onImport() {
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['json', 'csv', 'xlsx', 'xls'],
      success: (r) => {
        const f = r.tempFiles[0];
        const name = String(f.name || '').toLowerCase();
        const fmt = name.endsWith('.csv') ? 'csv'
          : (name.endsWith('.xlsx') || name.endsWith('.xls')) ? 'excel' : 'json';
        const payload = { format: fmt };
        try {
          const fsm = wx.getFileSystemManager();
          if (fmt === 'excel') payload.contentBase64 = fsm.readFileSync(f.path, 'base64');
          else payload.content = fsm.readFileSync(f.path, 'utf8');
        } catch (e) { wx.showToast({ title: '读取文件失败', icon: 'none' }); return; }
        wx.showLoading({ title: '导入中…' });
        let bookId = '';
        api.call('book', 'getCurrent')
          .then((book) => {
            bookId = book.bookId;
            return api.call('data', 'import', { bookId, ...payload });
          })
          .then((res) => {
            wx.hideLoading();
            // 结果落本地缓存：关闭面板后点导入行摘要可随时重看，撤销也仍可用
            const result = {
              success: res.success, failed: res.failed,
              createdCategories: res.createdCategories || 0,
              skippedCount: res.skippedCount || 0,
              skipped: res.skipped || [],
              failures: res.failures || [],
              batchId: res.batchId || '',
              bookId,
              time: Date.now(),
              timeLabel: fmt.dateTime(Date.now()),
              allOk: !res.failed,
            };
            try { wx.setStorageSync(LAST_IMPORT_KEY, result); } catch (e) { /* 缓存失败不影响本次展示 */ }
            this.setData({ importVal: `成功 ${res.success} · 失败 ${res.failed}`, importResult: result });
          })
          .catch((e) => { wx.hideLoading(); api.toast(e); });
      },
    });
  },

  closeImportResult() { this.setData({ importResult: null }); },
  noop() {},

  // 重看最近一次导入结果（点导入行的摘要文字）
  showLastImport() {
    let r = null;
    try { r = wx.getStorageSync(LAST_IMPORT_KEY); } catch (e) { /* 读不到当作没有 */ }
    if (r && r.time) this.setData({ importResult: r });
  },

  // 撤销本次导入：删除该批次写入的全部记录
  undoImport() {
    const r = this.data.importResult;
    if (!r || !r.batchId || !r.bookId) return;
    wx.showModal({
      title: '撤销本次导入',
      content: `将删除该批次导入的 ${r.success} 条记录（不影响其他数据）。确定撤销？`,
      confirmColor: '#f62172',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '撤销中…' });
        api.call('data', 'undoImport', { bookId: r.bookId, batchId: r.batchId })
          .then((u) => {
            wx.hideLoading();
            // 缓存里的批次标记为已撤销：结果仍可回看，但撤销按钮不再出现
            const undone = { ...r, batchId: '', undone: true };
            try { wx.setStorageSync(LAST_IMPORT_KEY, undone); } catch (e) { /* 忽略 */ }
            this.setData({ importResult: null, importVal: `已撤销（删除 ${u.removed} 条）` });
            wx.showToast({ title: `已删除 ${u.removed} 条`, icon: 'success' });
          })
          .catch((e) => { wx.hideLoading(); api.toast(e); });
      },
    });
  },

  // 复制失败明细，方便去源文件修改后重新导入
  copyImportFailures() {
    const r = this.data.importResult;
    if (!r || !r.failures.length) return;
    const lines = r.failures.map((f) => `${f.index ? `第 ${f.index} 条` : '—'}${f.summary ? `（${f.summary}）` : ''}：${f.reason}`);
    const text = `导入失败明细（成功 ${r.success} · 失败 ${r.failed}）\n${lines.join('\n')}\n\n行号按数据行计，不含表头。`;
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '已复制', icon: 'none' }) });
  },

  // 注销账户：两段确认（列后果 → 输入「注销」）。破坏性导航流程，按 PRD 例外用加载态。
  // owner 多人账本会被服务端阻断（OWNER_BLOCKED），弹窗引导先解散/移交。
  deleteAccount() {
    wx.showModal({
      title: '注销账户',
      content: '注销后：你独享的账本将解散并删除全部数据；你在多人账本中的记录会保留，显示为「昵称（已注销）」；AI 会话、图表布局、反馈工单将删除。操作不可恢复，之后重新使用将从零开始。',
      confirmText: '继续',
      confirmColor: '#f62172',
      success: (res) => {
        if (!res.confirm) return;
        wx.showModal({
          title: '确认注销',
          editable: true,
          placeholderText: '输入「注销」两字确认',
          content: '',
          confirmColor: '#f62172',
          success: (r2) => {
            if (!r2.confirm) return;
            if ((r2.content || '').trim() !== '注销') {
              wx.showToast({ title: '未输入「注销」，已取消', icon: 'none' });
              return;
            }
            wx.showLoading({ title: '注销中…', mask: true });
            api.call('user', 'deleteAccount')
              .then(() => {
                wx.hideLoading();
                try { wx.clearStorageSync(); } catch (e) { /* 忽略 */ }
                const g = getApp().globalData;
                if (g) g.profile = null;
                wx.showToast({ title: '已注销', icon: 'success' });
                setTimeout(() => wx.reLaunch({ url: '/pages/login/login' }), 600);
              })
              .catch((e) => {
                wx.hideLoading();
                if (e && e.code === 'OWNER_BLOCKED') {
                  wx.showModal({ title: '暂不能注销', content: e.errMsg, showCancel: false });
                } else {
                  api.toast(e);
                }
              });
          },
        });
      },
    });
  },

  resetData() {
    wx.showModal({
      title: '清空所有数据',
      content: '将删除全部账本/成员/记录/分类/会话、云存储图片与文件，以及所有用户登录信息，回到全新状态（需重新登录）。此操作不可恢复，确定继续？',
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
          try { wx.removeStorageSync(LAST_IMPORT_KEY); } catch (e) { /* 忽略 */ }
          wx.showToast({ title: '已清空', icon: 'success' });
          setTimeout(() => wx.reLaunch({ url: '/pages/login/login' }), 600);
        }).catch((e) => { wx.hideLoading(); api.toast(e); });
      },
    });
  },

  initSeed() {
    wx.showModal({
      title: '载入演示数据',
      content: '将创建两个演示账本（家庭 / 旅行分账）及演示成员与记录，与你的真实账本互不影响；重复载入会先清掉旧演示数据。',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '载入中…' });
        api.call('seed', 'run').then(() => {
          wx.hideLoading();
          wx.showToast({ title: '演示数据已载入', icon: 'success' });
          this.load();
        }).catch((e) => { wx.hideLoading(); api.toast(e); });
      },
    });
  },

  clearSeed() {
    wx.showModal({
      title: '清除演示数据',
      content: '将删除全部演示账本/成员/记录（seed 标记数据），你的真实数据不受影响。',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '清除中…' });
        api.call('seed', 'clear').then(() => {
          wx.hideLoading();
          wx.showToast({ title: '演示数据已清除', icon: 'success' });
          this.load();
        }).catch((e) => { wx.hideLoading(); api.toast(e); });
      },
    });
  },
});
