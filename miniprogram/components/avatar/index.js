// 成员色可能是任意亮色（默认亮青 #00ccf9，白字仅 1.9:1）——底色统一压暗后再放白字，
// 任意输入色都能保住对比；字号下限 22rpx（旧 18rpx ≈9px 过小）
function darken(hex, k) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#5a6472'; // 空/非法色兜底为深灰，避免透明圆圈「隐形」
  const n = parseInt(m[1], 16);
  const f = (x) => Math.round(x * (1 - k));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => f(x).toString(16).padStart(2, '0')).join('');
}

Component({
  options: { addGlobalClass: true },
  properties: {
    src: { type: String, value: '' },       // 微信头像 fileID/URL
    initial: { type: String, value: '' },    // 无头像时的文字
    color: { type: String, value: '#00ccf9' },
    size: { type: Number, value: 40 },        // rpx
  },
  data: { fontSize: 22, bg: darken('#00ccf9', 0.42), failed: false },
  observers: {
    size(v) { this.setData({ fontSize: Math.max(22, Math.round(v * 0.44)) }); },
    color(c) { this.setData({ bg: darken(c, 0.42) }); },
    src() { if (this.data.failed) this.setData({ failed: false }); }, // 换了新图重试
  },
  lifetimes: {
    attached() {
      this.setData({
        fontSize: Math.max(22, Math.round(this.data.size * 0.44)),
        bg: darken(this.data.color, 0.42),
      });
    },
  },
  methods: {
    // fileID 失效（文件被清/跨环境）时 image 渲染空白 —— 降级回字母圈
    onImgError() { this.setData({ failed: true }); },
  },
});
