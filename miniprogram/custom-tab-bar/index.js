const icons = require('../utils/icons');
const MUTED = '#8b867b';
const ACTIVE = '#2b5cff';

const BASE = [
  { path: '/pages/home/home', text: '首页', key: 'tabHome' },
  { path: '/pages/stats/stats', text: '统计', key: 'tabStats' },
  { path: '/pages/ai/ai', text: 'AI 助手', key: 'tabAi' },
  { path: '/pages/settings/settings', text: '我的', key: 'tabMe' },
];

Component({
  data: {
    selected: 0,
    list: [],
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
