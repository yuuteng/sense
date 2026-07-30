const { connect, apiCall, sleep } = require("./lib");
const ICE = "9cef38726a522d5f008ef25d7a291933";
(async () => {
  const { mini } = await connect();
  await apiCall(mini, "book", "setDefault", { bookId: ICE });
  await sleep(1500);
  console.log("还原时刻(UTC):", new Date().toISOString());
  const gc = await apiCall(mini, "book", "getCurrent", {});
  const prof = await apiCall(mini, "user", "getProfile", {});
  const bl = await apiCall(mini, "book", "list", {});
  console.log("当前账本:", gc.success && gc.data.name, "base=" + (gc.success && gc.data.baseCurrency), "display=" + (gc.success && gc.data.displayCurrency));
  console.log("默认账本:", prof.success && prof.data.defaultBookName);
  console.log("isDefault/isCurrent:", JSON.stringify((bl.success ? bl.data : []).map((b) => [b.name, b.isDefault, b.isCurrent])));
  const il = await apiCall(mini, "record", "list", { bookId: ICE, page: 0, withSummary: true });
  const g0 = il.success && il.data.groups && il.data.groups[0];
  console.log("冰岛:", g0 && g0.date, (g0 && (g0.items || []).length) + " 笔", "total=" + (g0 && g0.total), "display=" + (il.success && il.data.displayCurrency));
  for (const d of ["2026-07-02", "2026-07-09", "2026-07-30"]) {
    const g = await apiCall(mini, "rate", "getDaily", { date: d, base: "CNY" });
    const ok = g.success ? g.data : {};
    console.log("  rates", d, (ok.date === d && ok.isFallback === false) ? "*** 有注入快照 ***" : "干净");
  }
  process.exit(0);
})().catch((e) => { console.error("V3 FATAL:", e.message); process.exit(1); });
