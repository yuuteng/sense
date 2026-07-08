const api = require('../../utils/api');
const icons = require('../../utils/icons');

Page({
  data: {
    ic: {},
    title: '',
    content: '',
    contactEmail: '',
    photos: [],
  },

  onLoad() {
    this.setData({ ic: { photoAdd: icons.get('photoAdd', '#748294', 1.7) } });
  },

  onTitle(e) { this.setData({ title: e.detail.value }); },
  onContent(e) { this.setData({ content: e.detail.value }); },
  onEmail(e) { this.setData({ contactEmail: e.detail.value }); },

  choosePhoto() {
    const left = 3 - this.data.photos.length;
    if (left <= 0) { wx.showToast({ title: '最多 3 张', icon: 'none' }); return; }
    wx.chooseMedia({
      count: left, mediaType: ['image'], sizeType: ['compressed'],
      success: (res) => this.setData({ photos: this.data.photos.concat(res.tempFiles.map((f) => f.tempFilePath)) }),
    });
  },
  removePhoto(e) { const arr = this.data.photos.slice(); arr.splice(e.currentTarget.dataset.i, 1); this.setData({ photos: arr }); },

  async uploadPhotos() {
    const ids = [];
    for (const p of this.data.photos) {
      const up = await wx.cloud.uploadFile({ cloudPath: `feedback/${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`, filePath: p });
      ids.push(up.fileID);
    }
    return ids;
  },

  async submit() {
    const title = this.data.title.trim();
    const content = this.data.content.trim();
    const email = this.data.contactEmail.trim();
    if (!title) { wx.showToast({ title: '请填写标题', icon: 'none' }); return; }
    if (!content) { wx.showToast({ title: '请填写问题描述', icon: 'none' }); return; }
    // 邮箱选填，但填了必须是合法格式（服务端同样校验）
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { wx.showToast({ title: '联系邮箱格式不正确', icon: 'none' }); return; }
    if (this.submitting) return;
    this.submitting = true;
    wx.showLoading({ title: '提交中…', mask: true });
    try {
      const images = await this.uploadPhotos();
      await api.call('feedback', 'create', { title, content, images, contactEmail: this.data.contactEmail.trim() });
      wx.hideLoading();
      wx.showToast({ title: '已提交', icon: 'success' });
      setTimeout(() => wx.navigateBack({ fail() { wx.navigateTo({ url: '/pages/feedback/feedback' }); } }), 600);
    } catch (e) { this.submitting = false; wx.hideLoading(); api.toast(e); }
  },
});
