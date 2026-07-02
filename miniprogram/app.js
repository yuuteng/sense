// app.js
App({
  globalData: {
    env: "cloud1-d3gg4cb1z3c89e62c", // 云开发环境 ID（可公开，云函数/数据库仍需微信鉴权才能访问）
    statusBarHeight: 20, // 状态栏高度（px），onLaunch 动态获取
    navBarHeight: 44,    // 导航栏内容高度（px）
  },

  onLaunch() {
    // 自定义导航栏：动态获取状态栏高度，供各页面让位
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.globalData.statusBarHeight = info.statusBarHeight || 20;
    } catch (e) {
      // 忽略，用默认值
    }

    // 云开发初始化
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else if (this.globalData.env) {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }
  },
});
