/**
 * 跑重固化的 dry-run（dryRun 默认 true，不写任何数据）
 */
const automator = require("miniprogram-automator");

(async () => {
  const mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });
  const page = await mini.reLaunch("/pages/settings/settings");
  await page.waitFor(2500);

  const res = await mini.evaluate(() => new Promise((resolve) => {
    wx.cloud.callFunction({
      name: "api",
      data: { resource: "seed", type: "refixAmountConverted", dryRun: true },
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
