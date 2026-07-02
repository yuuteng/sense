const api = require('../../utils/api');
const icons = require('../../utils/icons');

function richify(html) {
  return (html || '').replace(/class="b"/g, 'style="font-weight:700"');
}

// 后端消息 → 前端渲染结构
function normalize(m) {
  if (m.role === 'card' || m.card) {
    const c = m.card || m;
    return { role: 'card', kind: c.kind, rows: c.rows, state: c.state || 'pending' };
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
    navSub: '',
  },

  onLoad() {
    this.setData({
      ic: {
        dotsH: icons.get('dotsH', '#111111', 1.9),
        camera: icons.get('camera', '#6b6b6b', 1.8),
        send: icons.get('send', '#ffffff', 2),
        checkbox: icons.get('checkbox', '#2f6feb', 2),
        clock: icons.get('clock', '#2f6feb', 2),
        checkDone: icons.get('check', '#148f41', 2.4),
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
      if (!book) return;
      this.bookId = book.bookId;
      this.setData({ navSub: `基于「${book.name}」账本数据` });
      const msgs = await api.call('ai', 'listMessages', { bookId: book.bookId });
      this.setData({ messages: msgs.map(normalize) });
      this.scrollBottom();
    } catch (e) { api.toast(e); }
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
        this.replaceLastTyping({ role: 'ai', html: '已把这句话解析成一条<span style="font-weight:700">预填记录</span>，确认后才会入账：' });
        this.push({ role: 'card', kind: res.card.kind, rows: res.card.rows, state: 'pending' });
      } else {
        this.replaceLastTyping({ role: 'ai', html: richify(res.answer || '') });
      }
    } catch (e) {
      this.replaceLastTyping({ role: 'ai', html: '出错了，请稍后再试。' });
      api.toast(e);
    }
  },

  async onUpload() {
    if (!this.bookId) return;
    this.push({ role: 'me', text: '📷 已上传一张收据' });
    this.push({ role: 'ai', typing: true });
    try {
      const res = await api.call('ai', 'parseReceipt', { bookId: this.bookId, fileID: 'demo' });
      this.replaceLastTyping({ role: 'ai', html: '识别到一张收据，已生成预填记录，请核对后确认：' });
      this.push({ role: 'card', kind: res.card.kind, rows: res.card.rows, state: 'pending' });
    } catch (e) {
      this.replaceLastTyping({ role: 'ai', html: '识别失败，请重试。' });
      api.toast(e);
    }
  },

  confirmCard(e) {
    this.setData({ [`messages[${e.currentTarget.dataset.i}].state`]: 'done' });
    wx.showToast({ title: '已入账', icon: 'success' });
  },
  dropCard(e) {
    this.setData({ [`messages[${e.currentTarget.dataset.i}].state`]: 'dropped' });
  },
  goHome() { wx.switchTab({ url: '/pages/home/home' }); },
});
