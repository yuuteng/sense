Component({
  options: { addGlobalClass: true },
  properties: {
    src: { type: String, value: '' },       // 微信头像 fileID/URL
    initial: { type: String, value: '' },    // 无头像时的文字
    color: { type: String, value: '#00ccf9' },
    size: { type: Number, value: 40 },        // rpx
  },
  data: { fontSize: 18 },
  observers: {
    size(v) { this.setData({ fontSize: Math.max(18, Math.round(v * 0.44)) }); },
  },
  lifetimes: {
    attached() { this.setData({ fontSize: Math.max(18, Math.round(this.data.size * 0.44)) }); },
  },
});
