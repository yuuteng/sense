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
    roleLabel: '',
    ic: {},
    inviteVisible: false,
    loading: true,
  },

  onLoad(query) {
    this.bookId = query.bookId || '';
    this.setData({
      bookId: this.bookId,
      ic: {
        pencil: icons.get('pencil', '#0089c0', 1.7),
        plus: icons.get('plus', '#0089c0', 2.4),
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
        avatarFileID: m.avatarFileID || '', // 真实头像，缺失时 avatar 组件回退首字母
        roleBadge: ROLE_BADGE[m.role], roleClass: ROLE_CLASS[m.role], role: m.role, isMe: m.isMe,
      }));
      this.setData({
        book, members,
        canManage: book.myRole === 'owner' || book.myRole === 'admin',
        isOwner: book.myRole === 'owner',
        isSplit: book.type === 'split',
        roleLabel: ROLE_BADGE[book.myRole] || book.myRole,
        loading: false,
      });
    } catch (e) { this.setData({ loading: false }); api.toast(e); }
  },

  // 改名：乐观更新本地名称，失败回滚
  editBookName() {
    if (!this.data.canManage) return;
    wx.showModal({
      title: '编辑账本名称', editable: true, content: this.data.book.name,
      success: (res) => {
        if (!res.confirm || !res.content.trim()) return;
        const name = res.content.trim();
        const prev = this.data.book.name;
        if (name === prev) return;
        this.setData({ 'book.name': name });
        api.call('book', 'update', { bookId: this.bookId, name })
          .catch((e) => { this.setData({ 'book.name': prev }); api.toast(e); });
      },
    });
  },

  // 设为默认：乐观切换标记，失败回滚
  setDefault() {
    if (this.data.book.isDefault) return;
    this.setData({ 'book.isDefault': true });
    wx.showToast({ title: '已设为默认', icon: 'success' });
    api.call('book', 'setDefault', { bookId: this.bookId })
      .catch((e) => { this.setData({ 'book.isDefault': false }); api.toast(e); });
  },

  goSettle() {
    wx.navigateTo({ url: '/pages/settle/settle?bookId=' + this.bookId });
  },

  // 邀请弹层：先选权限，再由 open-type=share 按钮直接拉起分享
  openInvite() { this.setData({ inviteVisible: true }); },
  closeInvite() { this.setData({ inviteVisible: false }); },
  noop() {},

  // 微信分享卡片邀请（由弹层内 <button open-type="share" data-role> 触发，角色随卡片链接下发）
  onShareAppMessage(res) {
    const name = this.data.book ? this.data.book.name : '账本';
    const role = res && res.target && res.target.dataset && res.target.dataset.role === 'ro' ? 'ro' : 'rw';
    return {
      title: `邀请你加入「${name}」一起记账`,
      path: `/pages/join/join?bookId=${this.bookId}&role=${role}`,
    };
  },

  onTapMember(e) {
    const i = e.currentTarget.dataset.i;
    const m = this.data.members[i];
    // 自己：不在此改名（昵称在「我的」里改，且不允许他人代改）
    if (m.isMe) return;
    if (!this.data.canManage || m.role === 'owner') return;
    // 成员权限 / 移除，用底部动作面板
    wx.showActionSheet({
      itemList: ['设为管理员', '设为读写成员', '设为只读成员', '移除成员'],
      success: (r) => {
        const roles = ['admin', 'rw', 'ro'];
        if (r.tapIndex < 3) {
          this.changeRole(i, roles[r.tapIndex]);
        } else {
          wx.showModal({
            title: '移除成员', content: `确定将「${m.name}」移出账本？`,
            success: (c) => { if (c.confirm) this.removeMember(i); },
          });
        }
      },
    });
  },

  // 乐观更新：本地立即改角色徽章，云端失败回滚并提示（消除「改完等一秒」）
  changeRole(i, role) {
    const m = this.data.members[i];
    if (!m || m.role === role) return;
    const prev = { role: m.role, roleBadge: m.roleBadge, roleClass: m.roleClass };
    this.setData({
      [`members[${i}].role`]: role,
      [`members[${i}].roleBadge`]: ROLE_BADGE[role],
      [`members[${i}].roleClass`]: ROLE_CLASS[role],
    });
    api.call('member', 'updateRole', { bookId: this.bookId, openid: m.openid, role })
      .catch((e) => {
        this.setData({
          [`members[${i}].role`]: prev.role,
          [`members[${i}].roleBadge`]: prev.roleBadge,
          [`members[${i}].roleClass`]: prev.roleClass,
        });
        api.toast(e);
      });
  },
  // 乐观移除：本地先消失，失败恢复列表
  removeMember(i) {
    const m = this.data.members[i];
    if (!m) return;
    const prevList = this.data.members;
    this.setData({ members: prevList.filter((_x, idx) => idx !== i) });
    api.call('member', 'remove', { bookId: this.bookId, openid: m.openid })
      .catch((e) => { this.setData({ members: prevList }); api.toast(e); });
  },

  // 解散 = 全产品最高风险操作：两段式确认（说明后果 → 输入账本名核对），对齐「注销账户」守卫级别。
  // 旧实现是 2.5s 内双击，误触即毁掉整个共享账本，已废弃。
  onDissolve() {
    if (!this.data.isOwner) return;
    const name = (this.data.book && this.data.book.name) || '';
    wx.showModal({
      title: '解散账本？',
      content: `「${name}」及其全部记录将对所有成员消失，且无法恢复。`,
      confirmText: '继续',
      cancelText: '取消',
      success: (r) => {
        if (!r.confirm) return;
        wx.showModal({
          title: '确认解散',
          editable: true,
          placeholderText: `输入账本名「${name}」确认`,
          confirmText: '解散',
          confirmColor: '#c41e5a',
          success: (c) => {
            if (!c.confirm) return;
            if ((c.content || '').trim() !== name) {
              wx.showToast({ title: '账本名不一致，未解散', icon: 'none' });
              return;
            }
            api.call('book', 'dissolve', { bookId: this.bookId }).then(() => {
              wx.showToast({ title: '已解散', icon: 'success' });
              setTimeout(() => wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }); } }), 500);
            }).catch(api.toast);
          },
        });
      },
    });
  },
});
