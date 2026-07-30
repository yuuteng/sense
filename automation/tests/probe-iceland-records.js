/**
 * 只读探针：确认「冰岛」账本记录是否完整
 * 零写操作。
 */
const automator = require("miniprogram-automator");

(async () => {
  const mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });

  const hp = await mini.reLaunch("/pages/home/home");
  await hp.waitFor(6000); // 云调用给足时间
  const h = await hp.data();
  console.log("=== 首页 ===");
  console.log("展示币种:", h.curCode);
  console.log("月度概要:", JSON.stringify({
    monthLabel: h.monthLabel, income: h.income, expense: h.expense, balance: h.balance,
  }));
  const items = h.items || [];
  console.log("items 条数:", items.length);
  console.log("groups 条数:", (h.groups || []).length);
  console.log("hasMore:", h.hasMore, "| empty 标志:", h.isEmpty, h.showEmpty);
  console.log("\n前 5 行:");
  for (const it of items.slice(0, 5)) {
    console.log("  ", it.title, "|", it.amount, "|", it.who, "|", it.fx || "");
  }
  // 分组视图（首页可能按天分组渲染）
  for (const g of (h.groups || []).slice(0, 3)) {
    console.log("  组:", g.date || g.label, "| 合计:", g.total, "| 行数:", (g.items || []).length);
  }
  console.log("\n=== 全部 data 键 ===");
  console.log(Object.keys(h).join(","));
  process.exit(0);
})().catch((e) => {
  console.error("PROBE FAIL:", e.message);
  process.exit(1);
});
