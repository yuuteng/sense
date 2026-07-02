const api = require('../../utils/api');
const icons = require('../../utils/icons');

const ROLE_MINE = { owner: '我是 Owner', admin: '我是 Admin', rw: '我是 读写', ro: '我是 只读' };

Page({
  data: {
    ic: {},
    books: [],
  },

  onLoad() {
    this.setData({
      ic: {
        bookWhite: icons.get('book', '#ffffff', 1.7),
        bookAccent: icons.get('book', '#2b5cff', 1.7),
        house: icons.get('house', '#a47d06', 1.7),
        chevron: icons.get('chevron', '#8b867b', 2),
        plus: icons.get('plus', '#1c1b18', 2.2),
      },
    });
  },

  onShow() { this.load(); },

  async load() {
    try {
      const books = await api.call('book', 'list');
      const view = books.map((b) => ({
        ...b,
        roleMine: ROLE_MINE[b.myRole] || b.myRole,
        typeClass: b.type === 'split' ? 'book-type--split' : 'book-type--share',
        iconSrc: b.isCurrent ? this.data.ic.bookWhite : (b.type === 'split' ? this.data.ic.house : this.data.ic.bookAccent),
        iconBg: b.isCurrent ? 'var(--accent)' : (b.type === 'split' ? 'rgba(234,179,8,0.16)' : 'rgba(43,92,255,0.10)'),
      }));
      this.setData({ books: view });
    } catch (e) { api.toast(e); }
  },

  openBook(e) {
    wx.navigateTo({ url: '/pages/bookConfig/bookConfig?bookId=' + e.currentTarget.dataset.id });
  },

  goNewBook() { wx.navigateTo({ url: '/pages/onboarding/onboarding' }); },
});
