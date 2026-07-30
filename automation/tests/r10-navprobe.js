// R10 判定：UI/导航层是否整体卡死（evaluate 可用但一切导航无效 => 需重启 IDE）
const automator = require("miniprogram-automator");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });
  const stackOf = async () => (await mini.pageStack()).map((p) => p.path).join(">");
  console.log("stack:", await stackOf());

  // evaluate 本身是否活着
  console.log("evaluate alive:", await mini.evaluate(() => Date.now() > 0));

  // 逐个试导航原语
  for (const [name, fn] of [
    ["hideLoading+hideToast", () => { wx.hideLoading(); wx.hideToast(); return "called"; }],
    ["navigateBack", () => { wx.navigateBack({ delta: 1 }); return "called"; }],
    ["switchTab", () => { wx.switchTab({ url: "/pages/home/home" }); return "called"; }],
    ["reLaunch", () => { wx.reLaunch({ url: "/pages/home/home" }); return "called"; }],
  ]) {
    let r = "";
    try { r = await mini.evaluate(fn); } catch (e) { r = "ERR " + e.message; }
    await sleep(2500);
    console.log(name.padEnd(22), "->", r, "| stack:", await stackOf());
  }

  // 页面实例上是否还有 loading / toast 残留标志
  const info = await mini.evaluate(() => {
    const pages = getCurrentPages();
    const top = pages[pages.length - 1];
    return { count: pages.length, path: top && top.route, saving: top && top._saving, saved: top && top._saved, guardOn: top && top._guardOn, amount: top && top.data && top.data.amount };
  });
  console.log("top page:", JSON.stringify(info));
  await mini.disconnect();
})().catch((e) => { console.error("R10 FATAL:", e.message); process.exit(1); });
