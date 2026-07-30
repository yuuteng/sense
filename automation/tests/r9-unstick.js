// R9 解卡：add 页残留「未保存」守卫会让每次 reLaunch 弹出无人应答的确认框，导致导航挂死
const automator = require("miniprogram-automator");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });
  console.log("connected");
  console.log("stack before:", JSON.stringify((await mini.pageStack()).map((p) => p.path)));

  // 1) 解除离开守卫（这是导航挂死的直接原因）
  const r1 = await mini.evaluate(() => {
    try {
      const pages = getCurrentPages();
      const top = pages[pages.length - 1];
      const info = { path: top && top.route, amount: top && top.data && top.data.amount, guardOn: top && top._guardOn, saving: top && top._saving, saved: top && top._saved };
      if (top && top.route === "pages/add/add") {
        top._saved = true;              // 标记已保存，syncUnloadGuard 会判定 not dirty
        top._saving = false;            // 顺带清掉 in-flight 标志，避免影响后续测试
        if (top.syncUnloadGuard) top.syncUnloadGuard();
      }
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      return info;
    } catch (e) { return { err: String(e) }; }
  });
  console.log("add page state before unlock:", JSON.stringify(r1));

  // 2) 用 app 内部导航离开 add 页
  await mini.evaluate(() => { wx.reLaunch({ url: "/pages/home/home" }); });
  await sleep(4000);
  console.log("stack after:", JSON.stringify((await mini.pageStack()).map((p) => p.path)));

  // 3) 验证 automator 的 reLaunch 是否恢复
  try {
    const p = await mini.reLaunch("/pages/home/home");
    console.log("automator reLaunch OK, path =", p.path);
  } catch (e) { console.log("automator reLaunch STILL FAILING:", e.message); }
  await mini.disconnect();
})().catch((e) => { console.error("R9 FATAL:", e.message); process.exit(1); });
