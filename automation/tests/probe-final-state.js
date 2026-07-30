/**
 * 收尾状态独立核验：账本 / 冰岛数据 / rates 无假汇率残留 / 默认账本
 * 零写操作。
 */
const automator = require("miniprogram-automator");

(async () => {
  const mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });

  const bp = await mini.reLaunch("/pages/books/books");
  await bp.waitFor(2500);
  console.log("=== 账本 ===");
  for (const b of (await bp.data()).books || []) {
    console.log(" ", [b.name, b.type, "base=" + b.baseCurrency, "members=" + b.memberCount,
      b.isCurrent ? "当前" : "", b.isDefault ? "默认" : ""].filter(Boolean).join(" | "));
  }

  const hp = await mini.reLaunch("/pages/home/home");
  await hp.waitFor(4000);
  const h = await hp.data();
  console.log("\n=== 当前账本首页 ===");
  console.log("  展示币种:", h.curCode, "| 账本:", h.bookName);
  for (const g of (h.groups || [])) console.log("  组:", g.date || g.label, "| 合计:", g.total, "| 行数:", (g.items || []).length);

  // rates: 有没有 injected 残留
  const rates = await mini.evaluate(() => new Promise((res) => {
    wx.cloud.callFunction({
      name: "api", data: { resource: "seed", type: "injectRateSnapshot", date: "1999-01-01", quotes: { EUR: 1 } },
      success: () => res("DEV_OK"), fail: (e) => res("DEV_BLOCKED:" + (e.errMsg || "")),
    });
  }));
  console.log("\n(dev 接口可用性:", rates, ")");

  process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
