const { connect, apiCall } = require("./lib");
const DEMO = "seed-book-split-floeovmie8";
(async () => {
  const { mini } = await connect();
  console.log("核查时刻(UTC):", new Date().toISOString());
  const gc = await apiCall(mini, "book", "getCurrent", {});
  console.log("当前账本:", gc.success ? gc.data.name + " base=" + gc.data.baseCurrency + " display=" + gc.data.displayCurrency : JSON.stringify(gc));
  const prof = await apiCall(mini, "user", "getProfile", {});
  console.log("默认账本:", prof.success && prof.data.defaultBookName);
  for (const d of ["2026-07-02", "2026-07-09", "2026-07-30"]) {
    const g = await apiCall(mini, "rate", "getDaily", { date: d, base: "CNY" });
    const ok = g.success ? g.data : {};
    const exact = ok.date === d && ok.isFallback === false;
    console.log("  rates", d, exact ? "*** 存在注入快照 ISK=" + ok.quotes.ISK + " ***" : "无精确快照(干净)");
  }
  const l = await apiCall(mini, "record", "list", { bookId: DEMO, page: 0, withSummary: true });
  console.log("演示账本记录:", l.success ? "count=" + l.data.summary.count + " expense=" + l.data.summary.expense + " display=" + l.data.displayCurrency : JSON.stringify(l));
  const items = [];
  ((l.success && l.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => items.push([i.title, i.originalAmount, i.currency, i.date, i.recordId])));
  console.log("  逐笔:", JSON.stringify(items));
  const s = await apiCall(mini, "settle", "get", { bookId: DEMO });
  if (s.success) {
    console.log("settle: settled 数=" + (s.data.settled || []).length, " transfers=" + JSON.stringify(s.data.transfers.map((t) => [t.from, t.to, t.amount, t.cur])));
    console.log("  settled 明细:", JSON.stringify((s.data.settled || []).map((x) => [x.settlementId, x.from, x.to, x.amount])));
  } else { console.log("settle.get 失败:", s.code, (s.errMsg || "").slice(0, 60)); }
  const bk = await apiCall(mini, "book", "list", {});
  console.log("账本数:", bk.success && bk.data.length, JSON.stringify((bk.success ? bk.data : []).map((b) => b.name)));
  process.exit(0);
})().catch((e) => { console.error("V2 FATAL:", e.message); process.exit(1); });
