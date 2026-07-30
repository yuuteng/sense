// V7 验收10: >1000 条记录的账本 —— fetchBookRecords 原为 .limit(1000) 无分页(静默截断),
// 现已分页。断言: settle 净额/总额包含全部记录, 无 -504003。
// 用一次性 QA 账本(单人分账), 测完解散。每笔 1 CNY, 截断会立刻显形。
const { connect, apiCall, loadState, saveState, makeRecorder, sleep } = require("./lib");
const ICE = "9cef38726a522d5f008ef25d7a291933";
const TARGET = 1100;
const BATCH = 100;

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("v7-bigbook");
  console.log("开始时刻(UTC):", new Date().toISOString());

  const cr = await apiCall(mini, "book", "create", { name: "QA大账本", baseCurrency: "CNY", bookType: "split" });
  const bookId = cr.success ? cr.data.bookId : null;
  R.check("V7-00", "建一次性大账本成功(base=CNY, split)", !!bookId, JSON.stringify(cr).slice(0, 150));
  if (!bookId) { R.save(errors); process.exit(1); }
  saveState({ bigBookId: bookId });

  // 批量导入, 每笔 1 CNY
  let imported = 0, failedTotal = 0, slowest = 0;
  for (let start = 0; start < TARGET; start += BATCH) {
    const n = Math.min(BATCH, TARGET - start);
    const rows = [];
    for (let k = 0; k < n; k++) {
      const day = String((start + k) % 28 + 1).padStart(2, "0");
      rows.push({ 日期: "2026-07-" + day, 类型: "支出", 标题: "QA批量", 分类: "其他", 原始金额: 1, 币种: "CNY", 备注: "v7-" + (start + k) });
    }
    const t0 = Date.now();
    const r = await apiCall(mini, "data", "import", { bookId, format: "json", content: JSON.stringify({ records: rows }), autoCreateCategories: true });
    const ms = Date.now() - t0;
    slowest = Math.max(slowest, ms);
    if (r.success) { imported += r.data.success || 0; failedTotal += r.data.failed || 0; }
    else { console.log("  batch@" + start + " 失败 " + ms + "ms " + r.code + " " + (r.errMsg || "").slice(0, 60)); }
    if ((start / BATCH) % 3 === 0) console.log("  已导入 " + imported + "/" + TARGET + " (本批 " + ms + "ms)");
    await sleep(300);
  }
  console.log("导入完成: success=" + imported + " failed=" + failedTotal + " 最慢批次=" + slowest + "ms");
  R.check("V7-01", "批量导入 " + TARGET + " 笔成功(每笔 1 CNY)", imported >= 1001,
    "成功=" + imported + " 失败=" + failedTotal + " 最慢批次=" + slowest + "ms");

  const l = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true });
  const cnt = l.success ? l.data.summary.count : -1;
  const expSum = l.success ? l.data.summary.expense : -1;
  R.check("V7-02", "record.list 汇总确认账本记录数 > 1000", cnt > 1000, "count=" + cnt + " expense=" + expSum);

  // ===== 核心: settle.get 不截断、不超时 =====
  let ok = 0, worst = 0, tot = null;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const s = await apiCall(mini, "settle", "get", { bookId });
    const ms = Date.now() - t0;
    worst = Math.max(worst, ms);
    if (s.success) { ok++; tot = s.data.summary.totalExpense; }
    console.log("  settle.get #" + (i + 1) + " " + ms + "ms ok=" + !!s.success + (s.success ? " totalExpense=" + s.data.summary.totalExpense + " splitCount=" + s.data.splitCount : " " + s.code));
    await sleep(900);
  }
  R.check("V7-03", "验收10 settle.get 在 >1000 条账本上成功, 无 -504003", ok === 3, "成功 " + ok + "/3 最慢 " + worst + "ms");
  R.check("V7-04", "★验收10 结算总额包含全部记录(未在 1000 条处静默截断)",
    tot != null && Math.abs(tot - cnt) < 0.01,
    "settle.totalExpense=" + tot + " 应等于记录数(每笔 1 CNY)=" + cnt + (tot != null && Math.abs(tot - 1000) < 0.01 ? "  *** 恰为 1000, 疑似仍被截断 ***" : ""));
  const s2 = await apiCall(mini, "settle", "get", { bookId });
  R.check("V7-05", "验收10 splits 明细条数 == 记录数(逐笔全量回传)",
    s2.success && s2.data.splitCount === cnt, "splitCount=" + (s2.success && s2.data.splitCount) + " 记录数=" + cnt);
  R.check("V7-06", "验收10 单人账本净额为 0(付款=应摊), 无异常转账",
    s2.success && Math.abs(s2.data.members.reduce((a, m) => a + m.net, 0)) < 0.0001 && s2.data.transfers.length === 0,
    "Σnet=" + (s2.success && s2.data.members.reduce((a, m) => a + m.net, 0)) + " transfers=" + (s2.success && s2.data.transfers.length));

  // ===== 清理 =====
  const ds = await apiCall(mini, "book", "dissolve", { bookId });
  await sleep(2500);
  const bl = await apiCall(mini, "book", "list", {});
  const names = bl.success ? bl.data.map((b) => b.name) : [];
  R.check("V7-07", "清理 大账本已解散", !!ds.success && !names.some((n) => /^QA/.test(n)), "剩余账本=" + names.join(","));
  await apiCall(mini, "book", "setDefault", { bookId: ICE });
  await sleep(1500);
  const prof = await apiCall(mini, "user", "getProfile", {});
  R.check("V7-08", "清理 defaultBookId = 冰岛", prof.success && prof.data.defaultBookName === "\u51b0\u5c9b",
    "defaultBookName=" + (prof.success && prof.data.defaultBookName));
  const igc = await apiCall(mini, "book", "getCurrent", {});
  const il = await apiCall(mini, "record", "list", { bookId: ICE, page: 0, withSummary: true });
  const g0 = il.success && il.data.groups && il.data.groups[0];
  R.check("V7-09", "清理 冰岛未被改动(EUR/CNY, 5 笔 -1047.97)",
    igc.success && igc.data.baseCurrency === "EUR" && igc.data.displayCurrency === "CNY" && !!g0 && (g0.items || []).length === 5 && Math.abs(g0.total + 1047.97) < 0.01,
    "base=" + (igc.success && igc.data.baseCurrency) + " display=" + (igc.success && igc.data.displayCurrency) + " 笔数=" + (g0 && (g0.items || []).length) + " total=" + (g0 && g0.total));

  console.log("结束时刻(UTC):", new Date().toISOString());
  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 2500));
  process.exit(0);
})().catch((e) => { console.error("V7 FATAL:", e.message, e.stack); process.exit(1); });
