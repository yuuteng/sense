// U11 收尾清理 + 独立核验(先实测再声明)。重点: rates 集合不得残留任何注入的假汇率。
const { connect, apiCall, loadState, makeRecorder, sleep } = require("./lib");
const ICE = "9cef38726a522d5f008ef25d7a291933";
const DEMO_SHARE = "seed-book-share-floeovmie8";
const DEMO_SPLIT = "seed-book-split-floeovmie8";
const INJECTED = ["2026-07-02", "2026-07-09", "2026-07-30"];

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("u11-cleanup");
  const st = loadState();

  // ===== 1. 删除所有注入的汇率快照 =====
  for (const d of INJECTED) {
    const r = await apiCall(mini, "seed", "deleteRateSnapshot", { date: d });
    console.log("delete", d, JSON.stringify(r.data || r).slice(0, 90));
    await sleep(400);
  }
  // 核验: 这三天都不该再有精确快照(应回退到更早/更晚的真实快照)
  const leftovers = [];
  for (const d of INJECTED) {
    const g = await apiCall(mini, "rate", "getDaily", { date: d, base: "CNY" });
    const ok = g.success ? g.data : {};
    const exact = ok.date === d && ok.isFallback === false;
    console.log("  verify", d, "-> date=" + ok.date, "isFallback=" + ok.isFallback, "EUR=" + (ok.quotes && ok.quotes.EUR), exact ? "*** 仍存在精确快照 ***" : "无精确快照(已清)");
    if (exact) leftovers.push(d);
  }
  R.check("U11-01", "★ rates 集合已无任何我注入的假汇率快照", leftovers.length === 0,
    leftovers.length ? "残留=" + JSON.stringify(leftovers) : "07-02 / 07-09 / 07-30 均已清除");

  // 真实快照(07-11)完好: EUR 应仍是 7.745693
  const real = await apiCall(mini, "rate", "getDaily", { date: "2026-07-11", base: "CNY" });
  R.check("U11-02", "原有真实快照(2026-07-11)未被破坏, EUR=7.745693 且币种数 166",
    real.success && real.data.date === "2026-07-11" && real.data.quotes.EUR === 7.745693 && Object.keys(real.data.quotes).length === 166,
    "date=" + (real.success && real.data.date) + " EUR=" + (real.success && real.data.quotes.EUR) + " 币种数=" + (real.success && Object.keys(real.data.quotes).length) + " isFallback=" + (real.success && real.data.isFallback));

  // ===== 2. 解散 QA 账本 =====
  const bl0 = await apiCall(mini, "book", "list", {});
  const targets = (bl0.success ? bl0.data : []).filter((x) => /^QA/.test(x.name));
  R.check("U11-03", "待清理账本均为 QA*, 不含真实/演示账本",
    targets.every((t) => t.name !== "\u51b0\u5c9b" && t.name.indexOf("\u6f14\u793a") < 0 && t.name !== "\u54c8\u54c8"),
    "待清理=" + JSON.stringify(targets.map((t) => t.name)));
  for (const t of targets) { const r = await apiCall(mini, "book", "dissolve", { bookId: t.bookId }); console.log("dissolve", t.name, JSON.stringify(r.data || r).slice(0, 60)); await sleep(1200); }

  // ===== 3. 切回冰岛 =====
  await apiCall(mini, "book", "setDefault", { bookId: ICE });
  await sleep(1500);

  // ===== 4. 独立核验 =====
  const bl = await apiCall(mini, "book", "list", {});
  const books = bl.success ? bl.data : [];
  console.log("book.list:", JSON.stringify(books.map((x) => ({ n: x.name, base: x.baseCurrency, isDefault: x.isDefault, isCurrent: x.isCurrent }))));
  R.check("U11-04", "账本 4 本且无任何 QA* 账本", books.length === 4 && !books.some((x) => /^QA/.test(x.name)),
    "共 " + books.length + " 本: " + books.map((x) => x.name).join(","));
  const gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("U11-05", "当前账本 = 冰岛", gc.success && gc.data.bookId === ICE, "current=" + (gc.success && gc.data.name));
  const prof = await apiCall(mini, "user", "getProfile", {});
  R.check("U11-06", "用户默认账本 = 冰岛", prof.success && prof.data.defaultBookName === "\u51b0\u5c9b",
    "defaultBookName=" + (prof.success && prof.data.defaultBookName));
  R.check("U11-07", "冰岛 base=EUR / display=CNY / split 未被改动",
    gc.success && gc.data.baseCurrency === "EUR" && gc.data.displayCurrency === "CNY" && gc.data.type === "split",
    "base=" + (gc.success && gc.data.baseCurrency) + " display=" + (gc.success && gc.data.displayCurrency) + " type=" + (gc.success && gc.data.type));
  const il = await apiCall(mini, "record", "list", { bookId: ICE, page: 0, withSummary: true });
  const g0 = il.success && il.data.groups && il.data.groups[0];
  R.check("U11-08", "冰岛数据完好: 首组 2026-07-22 / 5 笔 / 合计 -1047.97 / CNY",
    !!g0 && g0.date === "2026-07-22" && (g0.items || []).length === 5 && Math.abs(g0.total + 1047.97) < 0.01 && il.data.displayCurrency === "CNY",
    "date=" + (g0 && g0.date) + " 笔数=" + (g0 && (g0.items || []).length) + " total=" + (g0 && g0.total) + " dc=" + (il.success && il.data.displayCurrency));
  const sg = await apiCall(mini, "settings", "get", {});
  R.check("U11-09", "settings.get 仍不含 displayCurrency(决定二生效状态保持)",
    sg.success && !("displayCurrency" in sg.data), "返回体=" + JSON.stringify(sg.data));
  // 演示账本口径
  for (const [id, name] of [[DEMO_SHARE, "\u5bb6\u5ead\u6f14\u793a\u8d26\u672c"], [DEMO_SPLIT, "\u65c5\u884c\u5206\u8d26\u6f14\u793a"]]) {
    const bk = books.find((x) => x.bookId === id);
    console.log("  demo", name, "base=" + (bk && bk.baseCurrency));
  }
  const dl = await apiCall(mini, "record", "list", { bookId: DEMO_SPLIT, page: 0, withSummary: true });
  R.check("U11-10", "旅行分账演示 口径为 CNY(=其基准币), 金额未被我的测试改动(6 笔 / 1455.6)",
    dl.success && dl.data.displayCurrency === "CNY" && dl.data.summary.count === 6 && Math.abs(dl.data.summary.expense - 1455.6) < 0.01,
    "dc=" + (dl.success && dl.data.displayCurrency) + " count=" + (dl.success && dl.data.summary.count) + " expense=" + (dl.success && dl.data.summary.expense));

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("U11 FATAL:", e.message, e.stack); process.exit(1); });
