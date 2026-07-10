const icons = require('../utils/icons');
const MUTED = '#5f6c7d';
const ACTIVE = '#01749f';

const BASE = [
  { path: '/pages/home/home', text: '首页', key: 'tabHome' },
  { path: '/pages/stats/stats', text: '统计', key: 'tabStats' },
  { path: '/pages/ai/ai', text: '助手', key: 'tabAi' },
  { path: '/pages/settings/settings', text: '我的', key: 'tabMe' },
];

Component({
  data: {
    selected: 0,
    list: [],
    hidden: false, // 底部弹层打开时置 true（自定义 tabBar 层级高于页面元素，弹层盖不住它，只能藏）
  },
  lifetimes: {
    attached() {
      const list = BASE.map((it) => ({
        path: it.path,
        text: it.text,
        iconOn: icons.get(it.key, ACTIVE, 1.8),
        iconOff: icons.get(it.key, MUTED, 1.8),
      }));
      this.setData({ list });
    },
  },
  methods: {
    onTap(e) {
      const path = e.currentTarget.dataset.path;
      wx.switchTab({ url: path });
    },
  },
});
