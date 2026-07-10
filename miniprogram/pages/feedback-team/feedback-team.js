const api = require('../../utils/api');
const icons = require('../../utils/icons');
const fmt = require('../../utils/format');

Page({
  data: {
    ic: {},
    owners: [],
    admins: [],
    loading: true,
  },

  onLoad() {
    this.setData({ ic: { chevron: icons.get('chevron', '#748294', 2) } });
    this.load();
  },

  async load() {
    try {
      const r = await api.call('feedback', 'listAdmins');
      this.setData({
        loading: false,
        owners: r.owners || [],
        admins: (r.admins || []).map((a) => ({ ...a, timeLabel: fmt.dateTime(a.addedAt) })),
      });
    } catch (e) { this.setData({ loading: false }); api.toast(e); }
  },

  // 生成一次性邀请码（24 小时有效），复制后发给新客服
  invite() {
    api.call('feedback', 'createAdminInvite')
      .then((r) => {
        wx.showModal({
          title: '客服邀请码',
          content: `${r.code}\n\n${r.expireHours} 小时内有效、仅可使用一次。对方在「意见反馈」页底部点「收到客服邀请码？」输入即可。`,
          confirmText: '复制',
          cancelText: '关闭',
          success: (res) => {
            if (res.confirm) wx.setClipboardData({ data: r.code });
          },
        });
      })
      .catch(api.toast);
  },

  remove(e) {
    const { openid, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '移除客服',
      content: `移除「${name}」的客服身份？其已回复的工单内容保留。`,
      confirmColor: '#c41e5a',
      success: (res) => {
        if (!res.confirm) return;
        api.call('feedback', 'removeAdmin', { openid })
          .then(() => { wx.showToast({ title: '已移除', icon: 'success' }); this.load(); })
          .catch(api.toast);
      },
    });
  },
});
