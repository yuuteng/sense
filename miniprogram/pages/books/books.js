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
        bookAccent: icons.get('book', '#0089c0', 1.7),
        bookSplit: icons.get('bookSplit', '#a47d06', 1.7),
        chevron: icons.get('chevron', '#748294', 2),
        plus: icons.get('plus', '#3e4550', 2.2),
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
        // 图标只表达账本类型（共享=蓝 / 分账=黄），当前账本由「当前 · 默认」徽章标识
        iconSrc: b.type === 'split' ? this.data.ic.bookSplit : this.data.ic.bookAccent,
        iconBg: b.type === 'split' ? 'rgba(255,205,47,0.16)' : 'rgba(0,204,249,0.12)',
      }));
      this.setData({ books: view });
    } catch (e) { api.toast(e); }
  },

  openBook(e) {
    wx.navigateTo({ url: '/pages/bookConfig/bookConfig?bookId=' + e.currentTarget.dataset.id });
  },

  goNewBook() { wx.navigateTo({ url: '/pages/onboarding/onboarding' }); },
});
