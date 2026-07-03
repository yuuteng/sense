const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

function richify(html) {
  return (html || '').replace(/class="b"/g, 'style="font-weight:700"');
}

// 后端消息 → 前端渲染结构
function normalize(m) {
  if (m.role === 'card' || m.card) {
    const c = m.card || m;
    return { role: 'card', kind: c.kind, rows: c.rows, state: c.state || 'pending', draft: c.draft || null };
  }
  if (m.role === 'ai') return { role: 'ai', html: richify(m.html || m.text || '') };
  // user
  if (m.receipt) return { role: 'me', receipt: true };
  return { role: 'me', text: m.text || '' };
}

Page({
  data: {
    messages: [],
    input: '',
    ic: {},
    bookName: '',
    displayCurrency: '',
    chevronDown: '',
    loading: true,
    // 账本切换面板（与首页/统计一致）
    switcherVisible: false,
    currentBookId: '',
    books: [],
  },

  onLoad() {
    this.setData({
      chevronDown: icons.get('chevronDown', '#748294', 2.2),
      bookIcon: icons.get('book', '#0089c0', 1.7),
      houseIcon: icons.get('house', '#a47d06', 1.7),
      ic: {
        camera: icons.get('camera', '#748294', 1.8),
        send: icons.get('send', '#ffffff', 2),
        checkbox: icons.get('checkbox', '#0089c0', 2),
        clock: icons.get('clock', '#0089c0', 2),
        checkDone: icons.get('check', '#5c9a0e', 2.4),
      },
    });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this.load();
  },

  async load() {
    try {
      const book = await api.call('book', 'getCurrent');
      if (!book) { this.setData({ loading: false }); return; }
      this.bookId = book.bookId;
      const cur = book.displayCurrency || 'CNY';
      const msgs = await api.call('ai', 'listMessages', { bookId: book.bookId });
      this.setData({
        currentBookId: book.bookId,
        bookName: book.name,
        displayCurrency: `展示 · ${fmt.symbolOf(cur)} ${cur}`,
        messages: msgs.map(normalize),
        loading: false,
      });
      this.scrollBottom();
    } catch (e) { this.setData({ loading: false }); api.toast(e); }
  },

  // 顶栏账本切换（与首页一致）：切换后重载该账本的会话
  async openSwitcher() {
    try {
      const list = await api.call('book', 'list');
      this.setData({
        books: list.map((b) => ({
          bookId: b.bookId, name: b.name, typeLabel: b.typeLabel,
          typeClass: b.type === 'split' ? 'book-type--split' : 'book-type--share',
          iconSrc: b.type === 'split' ? this.data.houseIcon : this.data.bookIcon,
          iconBg: b.type === 'split' ? 'rgba(255,205,47,0.16)' : 'rgba(0,204,249,0.12)',
        })),
        switcherVisible: true,
      });
    } catch (e) { api.toast(e); }
  },
  async onSwitcherSelect(e) {
    const { bookId } = e.detail;
    this.setData({ switcherVisible: false });
    if (!bookId || bookId === this.data.currentBookId) return;
    try {
      await api.call('book', 'setDefault', { bookId });
      this.setData({ loading: true, messages: [] });
      await this.load();
      wx.showToast({ title: '已切换账本', icon: 'none' });
    } catch (e2) { api.toast(e2); }
  },
  onSwitcherClose() { this.setData({ switcherVisible: false }); },
  goManageBooks() {
    this.setData({ switcherVisible: false });
    wx.navigateTo({ url: '/pages/books/books' });
  },

  scrollBottom() {
    wx.nextTick(() => wx.pageScrollTo({ scrollTop: 1000000, duration: 200 }));
  },

  onInput(e) { this.setData({ input: e.detail.value }); },

  push(msg) {
    this.setData({ messages: this.data.messages.concat([msg]) });
    this.scrollBottom();
  },
  replaceLastTyping(msg) {
    const messages = this.data.messages.slice();
    const i = messages.map((m) => m.typing).lastIndexOf(true);
    if (i > -1) messages.splice(i, 1);
    messages.push(msg);
    this.setData({ messages });
    this.scrollBottom();
  },

  async onSend() {
    const t = (this.data.input || '').trim();
    if (!t || !this.bookId) return;
    this.push({ role: 'me', text: t });
    this.setData({ input: '' });
    this.push({ role: 'ai', typing: true });
    try {
      const res = await api.call('ai', 'parseText', { bookId: this.bookId, text: t });
      if (res.card) {
        this.replaceLastTyping({ role: 'ai', html: '已把这句话解析成一条<span style="font-weight:700">预填记录</span>，点「编辑并记账」可核对/修改后再入账：' });
        this.push({ role: 'card', kind: res.card.kind, rows: res.card.rows, state: 'pending', draft: res.card.draft || null });
      } else {
        this.replaceLastTyping({ role: 'ai', html: richify(res.answer || '') });
      }
    } catch (e) {
      this.replaceLastTyping({ role: 'ai', html: '出错了，请稍后再试。' });
      api.toast(e);
    }
  },

  // 上传收据：选图 → 传云存储 → 会话内显示真实图片 → 调用 AI 识别生成预填卡
  onUpload() {
    if (!this.bookId) return;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (file && file.tempFilePath) this.uploadAndRecognize(file.tempFilePath);
      },
    });
  },

  uploadAndRecognize(tempFilePath) {
    wx.showLoading({ title: '上传中…', mask: true });
    wx.cloud.uploadFile({
      cloudPath: `receipts/${this.bookId}-${Date.now()}.jpg`,
      filePath: tempFilePath,
    }).then((up) => {
      wx.hideLoading();
      this.push({ role: 'me', receipt: true, image: tempFilePath });
      this.push({ role: 'ai', typing: true });
      api.call('ai', 'parseReceipt', { bookId: this.bookId, fileID: up.fileID })
        .then((res) => {
          if (res.card) {
            this.replaceLastTyping({ role: 'ai', html: '识别到一张收据，已生成<span style="font-weight:700">预填记录</span>，点「编辑并记账」核对/修改后入账：' });
            this.push({ role: 'card', kind: res.card.kind, rows: res.card.rows, state: 'pending', draft: res.card.draft || null });
          } else {
            this.replaceLastTyping({ role: 'ai', html: richify(res.answer || '未能识别，请换一张更清晰的收据。') });
          }
        })
        .catch((e) => {
          this.replaceLastTyping({ role: 'ai', html: '识别失败：' + ((e && e.errMsg) || '请稍后再试') });
        });
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '图片上传失败，请重试', icon: 'none' });
    });
  },

  // 打开记账页并用 AI 预填草稿填充，用户可改任意字段再真正保存入账
  editDraft(e) {
    const m = this.data.messages[e.currentTarget.dataset.i];
    if (!m || !m.draft) { wx.showToast({ title: '无预填数据', icon: 'none' }); return; }
    wx.navigateTo({ url: '/pages/add/add?d=' + encodeURIComponent(JSON.stringify(m.draft)) });
  },
  dropCard(e) {
    this.setData({ [`messages[${e.currentTarget.dataset.i}].state`]: 'dropped' });
  },
  goHome() { wx.switchTab({ url: '/pages/home/home' }); },
});
