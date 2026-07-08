const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

const STATUS_CLASS = { pending: 'fb-status--pending', processing: 'fb-status--processing', resolved: 'fb-status--resolved' };

Page({
  data: {
    ic: {},
    isAdmin: false,
    isOwner: false,
    items: [],
    loading: true,
  },

  onLoad() {
    this.setData({
      ic: {
        plus: icons.get('plus', '#3e4550', 2),
        chevron: icons.get('chevron', '#748294', 2),
        mail: icons.get('mail', '#0089c0', 1.7),
      },
    });
  },

  onShow() { this.load(); },

  async load() {
    try {
      const r = await api.call('feedback', 'list');
      const items = (r.items || []).map((f) => ({
        ...f,
        timeLabel: fmt.dateTime(f.updatedAt),
        statusClass: STATUS_CLASS[f.status] || '',
      }));
      // 客服视角分区：用户工单（他人提交，待处理队列）/ 我的反馈（自己作为用户提交的）
      const queueItems = r.isAdmin ? items.filter((f) => !f.mine) : [];
      const mineItems = r.isAdmin ? items.filter((f) => f.mine) : items;
      this.setData({
        loading: false,
        isAdmin: r.isAdmin,
        isOwner: !!r.isOwner,
        items, queueItems, mineItems,
      });
    } catch (e) { this.setData({ loading: false }); api.toast(e); }
  },

  goNew() { wx.navigateTo({ url: '/pages/feedback-new/feedback-new' }); },
  goDetail(e) { wx.navigateTo({ url: '/pages/feedback-detail/feedback-detail?id=' + e.currentTarget.dataset.id }); },
  goTeam() { wx.navigateTo({ url: '/pages/feedback-team/feedback-team' }); },

  // 普通用户凭 owner 发的邀请码成为客服
  enterInviteCode() {
    wx.showModal({
      title: '输入客服邀请码', editable: true, placeholderText: '6 位邀请码',
      success: (res) => {
        if (!res.confirm || !res.content.trim()) return;
        api.call('feedback', 'acceptAdminInvite', { code: res.content.trim() })
          .then((r) => {
            wx.showToast({ title: r.already ? '你已是客服' : '已成为客服', icon: 'success' });
            this.load();
          })
          .catch(api.toast);
      },
    });
  },
});
