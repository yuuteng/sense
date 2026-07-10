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
      // 客服视角：「用户工单」= 全部工单（含自己提交的，标「我」）——与 PRD「客服看到全部工单」
      // 的心智一致，避免「自己的单在队列里消失」的困惑；「我的反馈」分区仅普通用户视角使用
      const queueItems = r.isAdmin ? items : [];
      const mineItems = r.isAdmin ? [] : items;
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
