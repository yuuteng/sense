// 自定义 tabBar 显隐控制。
// 微信里自定义 tabBar 的层级高于页面元素，底部弹层再高的 z-index 也盖不住它，
// 会露出 tabBar 并挡住弹层最后一行 —— 弹层打开时调 setHidden(true) 把 tabBar 滑出屏幕，关闭时还原。
// 非 tab 页（无 getTabBar）静默跳过，组件里可放心调用。
function setHidden(hidden) {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  if (page && typeof page.getTabBar === 'function') {
    const tb = page.getTabBar();
    if (tb) tb.setData({ hidden: !!hidden });
  }
}

module.exports = { setHidden };
