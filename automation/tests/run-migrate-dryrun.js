/**
 * 跑迁移的 dry-run（dryRun 默认 true，不写任何数据）
 * 通过页面上下文调 wx.cloud.callFunction，走真实鉴权。
 */
const automator = require("miniprogram-automator");

(async () => {
  const mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });
  const page = await mini.reLaunch("/pages/settings/settings");
  await page.waitFor(2500);

  const res = await mini.evaluate(() => new Promise((resolve) => {
    wx.cloud.callFunction({
      name: "api",
      data: { resource: "seed", type: "migrateDisplayCurrency", dryRun: true },
      success: (r) => resolve(JSON.stringify(r.result)),
      fail: (e) => resolve("CALL_FAIL: " + JSON.stringify(e)),
    });
  }));

  console.log(res);
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
