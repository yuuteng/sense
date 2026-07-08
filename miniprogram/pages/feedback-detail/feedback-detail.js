const api = require('../../utils/api');
const fmt = require('../../utils/format');

const STATUS_CLASS = { pending: 'fb-status--pending', processing: 'fb-status--processing', resolved: 'fb-status--resolved' };
const STATUSES = [
  { k: 'pending', label: '待处理' },
  { k: 'processing', label: '处理中' },
  { k: 'resolved', label: '已解决' },
];

Page({
  data: {
    id: '',
    fb: null,
    replies: [],
    statusClass: '',
    statuses: STATUSES,
    replyText: '',
    loading: true,
  },

  onLoad(query) {
    this.setData({ id: query.id || '' });
    this.load();
  },

  async load() {
    try {
      const fb = await api.call('feedback', 'get', { feedbackId: this.data.id });
      this.setData({
        loading: false,
        fb: { ...fb, timeLabel: fmt.dateTime(fb.createdAt) },
        statusClass: STATUS_CLASS[fb.status] || '',
        replies: (fb.replies || []).map((r) => ({ ...r, timeLabel: fmt.dateTime(r.time) })),
      });
    } catch (e) { this.setData({ loading: false }); api.toast(e); }
  },

  previewImage(e) {
    const urls = this.data.fb.images;
    wx.previewImage({ current: urls[e.currentTarget.dataset.i], urls });
  },

  onReplyInput(e) { this.setData({ replyText: e.detail.value }); },

  async sendReply() {
    const content = this.data.replyText.trim();
    if (!content) { wx.showToast({ title: '请输入回复内容', icon: 'none' }); return; }
    if (this.sending) return;
    this.sending = true;
    try {
      await api.call('feedback', 'reply', { feedbackId: this.data.id, content });
      this.setData({ replyText: '' });
      await this.load();
    } catch (e) { api.toast(e); }
    this.sending = false;
  },

  // 管理员：改状态
  async pickStatus(e) {
    const status = e.currentTarget.dataset.k;
    if (!this.data.fb || status === this.data.fb.status) return;
    try {
      await api.call('feedback', 'setStatus', { feedbackId: this.data.id, status });
      await this.load();
      wx.showToast({ title: '状态已更新', icon: 'none' });
    } catch (e) { api.toast(e); }
  },
});
