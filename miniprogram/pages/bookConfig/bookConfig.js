const api = require('../../utils/api');
const icons = require('../../utils/icons');

const ROLE_BADGE = { owner: 'Owner', admin: 'Admin', rw: '读写', ro: '只读' };
const ROLE_CLASS = { owner: 'role--owner', admin: 'role--admin', rw: 'role--rw', ro: 'role--ro' };

Page({
  data: {
    bookId: '',
    book: null,
    members: [],
    canManage: false,
    isOwner: false,
    isSplit: false,
    ic: {},
    inviteText: '邀请成员',
    dissolveText: '解散账本',
    dissolveConfirm: false,
    loading: true,
  },

  onLoad(query) {
    this.bookId = query.bookId || '';
    this.setData({
      bookId: this.bookId,
      ic: {
        pencil: icons.get('pencil', '#0089c0', 1.7),
        invite: icons.get('share', '#0089c0', 1.7),
        star: icons.get('check', '#0089c0', 2),
        arrow: icons.get('arrowRight', '#0089c0', 1.9),
        chevron: icons.get('chevron', '#748294', 2),
        trash: icons.get('trash', '#f62172', 1.7),
      },
    });
  },

  onShow() { this.load(); },

  async load() {
    try {
      const books = await api.call('book', 'list');
      const book = books.find((b) => b.bookId === this.bookId);
      if (!book) { this.setData({ loading: false }); wx.showToast({ title: '账本不存在', icon: 'none' }); return; }
      const raw = await api.call('member', 'list', { bookId: this.bookId });
      const members = raw.map((m) => ({
        openid: m.openid, name: m.name + (m.isMe ? '（我）' : ''), initial: m.avatarInitial, color: m.avatarColor,
        roleBadge: ROLE_BADGE[m.role], roleClass: ROLE_CLASS[m.role], role: m.role, isMe: m.isMe,
      }));
      this.setData({
        book, members,
        canManage: book.myRole === 'owner' || book.myRole === 'admin',
        isOwner: book.myRole === 'owner',
        isSplit: book.type === 'split',
        loading: false,
      });
    } catch (e) { this.setData({ loading: false }); api.toast(e); }
  },

  editBookName() {
    if (!this.data.canManage) return;
    wx.showModal({
      title: '编辑账本名称', editable: true, content: this.data.book.name,
      success: (res) => {
        if (!res.confirm || !res.content.trim()) return;
        api.call('book', 'update', { bookId: this.bookId, name: res.content.trim() })
          .then(() => this.load()).catch(api.toast);
      },
    });
  },

  setDefault() {
    api.call('book', 'setDefault', { bookId: this.bookId }).then(() => {
      wx.showToast({ title: '已设为默认', icon: 'success' });
      this.load();
    }).catch(api.toast);
  },

  goSettle() {
    wx.navigateTo({ url: '/pages/settle/settle?bookId=' + this.bookId });
  },

  // 微信分享卡片邀请（由 <button open-type="share"> 触发）
  onShareAppMessage() {
    const name = this.data.book ? this.data.book.name : '账本';
    return {
      title: `邀请你加入「${name}」一起记账`,
      path: `/pages/join/join?bookId=${this.bookId}`,
    };
  },

  onTapMember(e) {
    const m = this.data.members[e.currentTarget.dataset.i];
    if (m.isMe) {
      // 修改我在本账本的名字
      wx.showModal({
        title: '我在本账本的名字', editable: true, content: m.name.replace('（我）', ''),
        success: (res) => {
          if (!res.confirm || !res.content.trim()) return;
          api.call('member', 'rename', { bookId: this.bookId, name: res.content.trim() })
            .then(() => this.load()).catch(api.toast);
        },
      });
      return;
    }
    if (!this.data.canManage || m.role === 'owner') return;
    // 成员权限 / 移除，用底部动作面板
    wx.showActionSheet({
      itemList: ['设为管理员', '设为读写成员', '设为只读成员', '移除成员'],
      success: (r) => {
        const roles = ['admin', 'rw', 'ro'];
        if (r.tapIndex < 3) {
          api.call('member', 'updateRole', { bookId: this.bookId, openid: m.openid, role: roles[r.tapIndex] })
            .then(() => this.load()).catch(api.toast);
        } else {
          wx.showModal({
            title: '移除成员', content: `确定将「${m.name}」移出账本？`,
            success: (c) => {
              if (!c.confirm) return;
              api.call('member', 'remove', { bookId: this.bookId, openid: m.openid })
                .then(() => this.load()).catch(api.toast);
            },
          });
        }
      },
    });
  },

  onDissolve() {
    if (!this.data.isOwner) return;
    if (this.data.dissolveConfirm) {
      api.call('book', 'dissolve', { bookId: this.bookId }).then(() => {
        wx.showToast({ title: '已解散', icon: 'success' });
        setTimeout(() => wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }); } }), 500);
      }).catch(api.toast);
      return;
    }
    this.setData({ dissolveConfirm: true, dissolveText: '此操作不可恢复 · 再次点击确认' });
    setTimeout(() => { if (this.data.dissolveConfirm) this.setData({ dissolveConfirm: false, dissolveText: '解散账本' }); }, 2500);
  },
});
