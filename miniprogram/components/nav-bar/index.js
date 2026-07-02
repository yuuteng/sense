const icons = require('../../utils/icons');

Component({
  options: { multipleSlots: true, addGlobalClass: true },
  properties: {
    title: { type: String, value: '' },
    sub: { type: String, value: '' },
    back: { type: Boolean, value: false },
    center: { type: Boolean, value: false },
  },
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    rightGap: 96, // 为右上角微信胶囊按钮预留的宽度（px）
    backIcon: '',
  },
  lifetimes: {
    attached() {
      const app = getApp();
      const sbh = (app && app.globalData && app.globalData.statusBarHeight) || 20;
      let navBarHeight = 44;
      let rightGap = 96;
      try {
        const menu = wx.getMenuButtonBoundingClientRect();
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        // 让导航内容与胶囊垂直居中对齐
        navBarHeight = (menu.top - sbh) * 2 + menu.height;
        // 右侧预留 = 胶囊左边到屏幕右边 + 一点间距
        rightGap = (win.windowWidth - menu.left) + 8;
      } catch (e) { /* 用默认值 */ }
      this.setData({ statusBarHeight: sbh, navBarHeight, rightGap, backIcon: icons.get('back', '#3e4550', 2) });
    },
  },
  methods: {
    onBack() {
      wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/home/home' }); } });
    },
  },
});
