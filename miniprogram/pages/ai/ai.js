const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

function richify(html) {
  return (html || '').replace(/class="b"/g, 'style="font-weight:700"');
}

// 后端消息 → 前端渲染结构（id 保留：卡片状态回写数据库要用）
function normalize(m) {
  if (m.role === 'card' || m.card) {
    const c = m.card || m;
    return { role: 'card', id: m._id || '', kind: c.kind, rows: c.rows, state: c.state || 'pending', draft: c.draft || null };
  }
  if (m.role === 'ai') return { role: 'ai', html: richify(m.html || m.text || '') };
  // user
  if (m.receipt) return { role: 'me', receipt: true, image: m.fileID || '' };
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
    placeholder: '问一句，或说「昨天打车 35」记一笔…',
    // 账本切换面板（与首页/统计一致）
    switcherVisible: false,
    currentBookId: '',
    books: [],
  },

  onLoad() {
    this.setData({
      chevronDown: icons.get('chevronDown', '#748294', 2.2),
      bookIcon: icons.get('book', '#0089c0', 1.7),
      splitIcon: icons.get('bookSplit', '#a47d06', 1.7),
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
      this.getTabBar().setData({ selected: 2, hidden: false });
    }
    this.load();
  },

  async load() {
    try {
      const book = await api.call('book', 'getCurrent');
      if (!book) { this.setData({ loading: false }); return; }
      this.bookId = book.bookId;
      this.canWrite = book.myRole !== 'ro'; // 只读成员：可问答，不产生入账
      const cur = book.displayCurrency || 'CNY';
      const msgs = await api.call('ai', 'listMessages', { bookId: book.bookId });
      this.setData({
        currentBookId: book.bookId,
        bookName: book.name,
        displayCurrency: `展示 · ${fmt.symbolOf(cur)} ${cur}`,
        placeholder: this.canWrite ? '问一句，或说「昨天打车 35」记一笔…' : '问一句，如「本月支出多少」…',
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
          iconSrc: b.type === 'split' ? this.data.splitIcon : this.data.bookIcon,
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

  // 会话持久化（滚动上限由后端控制）；卡片需要返回的消息 id 做状态回写
  persist(message) {
    return api.call('ai', 'appendMessage', { bookId: this.bookId, message })
      .then((r) => (r && r.id) || '').catch(() => '');
  },
  // AI 回复（文本或预填卡）统一上屏 + 落库
  async pushAiResult(res, cardLead) {
    if (res.card) {
      const lead = cardLead || '已解析成一条<span style="font-weight:700">预填记录</span>，确认无误可直接入账，或编辑后再入账：';
      this.replaceLastTyping({ role: 'ai', html: lead });
      await this.persist({ role: 'ai', html: lead }); // 先落引导语再落卡片，保证重载后顺序不乱
      const card = { role: 'card', kind: res.card.kind, rows: res.card.rows, state: 'pending', draft: res.card.draft || null };
      card.id = await this.persist({ role: 'card', card: { kind: card.kind, rows: card.rows, state: 'pending', draft: card.draft } });
      this.push(card);
    } else {
      const html = richify(res.answer || '');
      this.replaceLastTyping({ role: 'ai', html });
      this.persist({ role: 'ai', html });
    }
  },

  async onSend() {
    const t = (this.data.input || '').trim();
    if (!t || !this.bookId) return;
    this.push({ role: 'me', text: t });
    this.setData({ input: '' });
    this.persist({ role: 'me', text: t });
    this.push({ role: 'ai', typing: true });
    try {
      const res = await api.call('ai', 'chat', { bookId: this.bookId, text: t });
      await this.pushAiResult(res);
    } catch (e) {
      this.replaceLastTyping({ role: 'ai', html: '出错了，请稍后再试。' });
      api.toast(e);
    }
  },

  // 上传收据：选图 → 传云存储 → 会话内显示真实图片 → 调用 AI 识别生成预填卡
  onUpload() {
    if (!this.bookId) return;
    if (!this.canWrite) { wx.showToast({ title: '只读成员不能记账，可直接提问账本数据', icon: 'none' }); return; }
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
      this.persist({ role: 'me', receipt: true, fileID: up.fileID });
      this.push({ role: 'ai', typing: true });
      api.call('ai', 'parseReceipt', { bookId: this.bookId, fileID: up.fileID })
        .then((res) => this.pushAiResult(res, '识别到一张收据，已生成<span style="font-weight:700">预填记录</span>，确认无误可直接入账，或编辑后再入账：'))
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
    // 带上消息 id：记账页保存成功后回写卡片为「已入账」，返回本页 onShow 刷新即可见
    const mid = m.id ? '&m=' + m.id : '';
    wx.navigateTo({ url: '/pages/add/add?d=' + encodeURIComponent(JSON.stringify(m.draft)) + mid });
  },
  // 确认入账：预填卡一键入账（服务端解析分类并复用记账链路），成功后卡片置为已入账
  async confirmCard(e) {
    const i = e.currentTarget.dataset.i;
    const m = this.data.messages[i];
    if (!m || !m.draft) { wx.showToast({ title: '无预填数据', icon: 'none' }); return; }
    if (this._confirming) return;
    this._confirming = true;
    wx.showLoading({ title: '入账中…', mask: true });
    try {
      await api.call('ai', 'confirmDraft', { bookId: this.bookId, draft: m.draft, msgId: m.id || '' });
      wx.hideLoading();
      this.setData({ [`messages[${i}].state`]: 'done' });
      wx.showToast({ title: '已入账', icon: 'success' });
    } catch (e2) {
      wx.hideLoading();
      api.toast(e2);
    }
    this._confirming = false;
  },
  dropCard(e) {
    const i = e.currentTarget.dataset.i;
    const m = this.data.messages[i];
    this.setData({ [`messages[${i}].state`]: 'dropped' });
    if (m && m.id) api.call('ai', 'setCardState', { bookId: this.bookId, msgId: m.id, state: 'dropped' }).catch(() => {});
  },
  goHome() { wx.switchTab({ url: '/pages/home/home' }); },
});
