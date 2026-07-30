const { connect, apiCall, sleep } = require("./lib");
const DEMO = "seed-book-split-floeovmie8";
const ICE = "9cef38726a522d5f008ef25d7a291933";
(async () => {
  const { mini } = await connect();
  console.log("清理时刻(UTC):", new Date().toISOString());
  const l = await apiCall(mini, "record", "list", { bookId: DEMO, page: 0, withSummary: true });
  const items = [];
  ((l.success && l.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => items.push(i)));
  console.log("清理前:", l.success && l.data.summary.count, "笔 expense=" + (l.success && l.data.summary.expense));
  const mine = items.filter((i) => i.title === "QA\u4e34\u65f6" || Math.abs(i.originalAmount - 300) < 0.001);
  console.log("识别出我的残留记录:", JSON.stringify(mine.map((i) => [i.recordId, i.title, i.originalAmount, i.currency, i.date])));
  for (const m of mine) {
    const d = await apiCall(mini, "record", "delete", { recordId: m.recordId });
    console.log("  delete", m.recordId, JSON.stringify(d).slice(0, 120));
    await sleep(900);
  }
  const l2 = await apiCall(mini, "record", "list", { bookId: DEMO, page: 0, withSummary: true });
  console.log("清理后:", l2.success && l2.data.summary.count, "笔 expense=" + (l2.success && l2.data.summary.expense), "display=" + (l2.success && l2.data.displayCurrency));
  const items2 = [];
  ((l2.success && l2.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => items2.push([i.title, i.originalAmount, i.currency, i.date])));
  console.log("  逐笔:", JSON.stringify(items2));
  const s = await apiCall(mini, "settle", "get", { bookId: DEMO });
  console.log("settle:", s.success ? "totalExpense=" + s.data.summary.totalExpense + " cur=" + s.data.summary.currency + " settled=" + (s.data.settled || []).length + " transfers=" + JSON.stringify(s.data.transfers.map((t) => [t.amount, t.amountRef])) : "FAIL");
  // 汇率与账本状态
  for (const d of ["2026-07-02", "2026-07-09", "2026-07-30"]) {
    const g = await apiCall(mini, "rate", "getDaily", { date: d, base: "CNY" });
    const ok = g.success ? g.data : {};
    console.log("  rates", d, (ok.date === d && ok.isFallback === false) ? "*** 有残留 ***" : "干净");
  }
  const prof = await apiCall(mini, "user", "getProfile", {});
  const gc = await apiCall(mini, "book", "getCurrent", {});
  console.log("默认账本:", prof.success && prof.data.defaultBookName, "| 当前:", gc.success && gc.data.name, "base=" + (gc.success && gc.data.baseCurrency), "display=" + (gc.success && gc.data.displayCurrency));
  process.exit(0);
})().catch((e) => { console.error("V5 FATAL:", e.message); process.exit(1); });
