// V6 复测 V4-16 / V4-20 (上次失败是我把 record.delete 误写成 record.remove, 导致临时记录未删)
const { connect, apiCall, makeRecorder, sleep } = require("./lib");
const DEMO = "seed-book-split-floeovmie8";
const ICE = "9cef38726a522d5f008ef25d7a291933";
const r2 = (n) => Math.round(n * 100) / 100;
function pick(s) {
  return JSON.stringify({ summary: s.summary,
    members: (s.members || []).map((m) => [m.name, m.paid, m.share, m.net]),
    transfers: (s.transfers || []).map((t) => [t.from, t.to, t.amount, t.amountDisp, t.cur, t.amountRef]),
    settled: (s.settled || []).map((x) => [x.from, x.to, x.amount, x.amountDisp, x.cur]),
    splits: (s.splits || []).map((x) => [x.title, x.amount, x.isForeign, x.fx]) });
}
const S = (mini) => apiCall(mini, "settle", "get", { bookId: DEMO });

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("v6-retest-2and6");
  console.log("开始时刻(UTC):", new Date().toISOString());
  await apiCall(mini, "book", "setDefault", { bookId: DEMO });
  await sleep(1000);
  await apiCall(mini, "settings", "update", { displayCurrency: "ISK", bookId: DEMO });
  await sleep(900);
  // 注入两日快照造 F != 1(与 v4 同条件)
  for (const [d, q] of [["2026-07-02", { EUR: 7.8, ISK: 0.05 }], ["2026-07-09", { EUR: 7.8, ISK: 0.10 }]]) {
    const pre = await apiCall(mini, "rate", "getDaily", { date: d, base: "CNY" });
    if (pre.success && pre.data.date === d && pre.data.isFallback === false) { console.log("!! " + d + " 已有真实快照, 跳过注入"); continue; }
    await apiCall(mini, "seed", "injectRateSnapshot", { date: d, quotes: q });
    await sleep(400);
  }
  const base = await S(mini);
  const BASE = base.success ? base.data : null;
  R.check("V6-00", "基线 settle.get 可用", !!BASE, BASE ? "totalExpense=" + BASE.summary.totalExpense + " cur=" + BASE.summary.currency : JSON.stringify(base).slice(0, 150));
  if (!BASE) { R.save(errors); process.exit(1); }

  // ===== 验收2: 新增 -> 变化; 删除 -> 逐字回到原值 =====
  const cats = await apiCall(mini, "category", "list", { bookId: DEMO, kind: "expense" });
  const c0 = cats.success && cats.data && cats.data[0];
  const catId = c0 ? (c0.subs && c0.subs[0] ? c0.subs[0].categoryId : (c0.id || c0._id)) : null;
  const cr = await apiCall(mini, "record", "create", { bookId: DEMO, payload: {
    type: "expense", amount: 300, currency: "CNY", rate: 1, date: "2026-07-05",
    categoryId: catId, title: "QA\u4e34\u65f6V6", note: "QA-v6", images: [] } });
  const rid = cr.success ? cr.data.recordId : null;
  await sleep(1600);
  const after = await S(mini);
  R.check("V6-01", "验收2 新增一笔后总额变化", !!rid && after.success && after.data.summary.totalExpense !== BASE.summary.totalExpense,
    "前=" + BASE.summary.totalExpense + " 后=" + (after.success && after.data.summary.totalExpense));
  const del = rid ? await apiCall(mini, "record", "delete", { recordId: rid }) : { success: false };
  R.check("V6-02", "record.delete 调用成功(上次我误写 record.remove 导致未删)", !!del.success, JSON.stringify(del).slice(0, 120));
  await sleep(1700);
  const back = await S(mini);
  R.check("V6-03", "验收2 删除该笔后 settle.get 逐字回到原值", back.success && pick(BASE) === pick(back.data),
    pick(BASE) === pick(back.data) ? "逐字相等" : "不相等\n基线=" + pick(BASE).slice(0, 380) + "\n删后=" + pick(back.data).slice(0, 380));

  // ===== 验收6: mark -> unmark -> 逐字回到原值 =====
  const t0 = BASE.transfers[0];
  if (t0) {
    const mk = await apiCall(mini, "settle", "mark", { bookId: DEMO, from: t0.fromOpenid, to: t0.toOpenid, amount: t0.amount });
    const sid = mk.success ? mk.data.settlementId : null;
    await sleep(1600);
    const marked = await S(mini);
    R.check("V6-04", "验收6 标记结清生效", !!sid && marked.success && (marked.data.settled || []).length === 1,
      "settled=" + JSON.stringify((marked.success ? marked.data.settled : []).map((x) => [x.amount, x.amountDisp, x.cur])));
    if (sid) {
      const um = await apiCall(mini, "settle", "unmark", { bookId: DEMO, settlementId: sid });
      await sleep(1700);
      const un = await S(mini);
      R.check("V6-05", "验收6 撤销结清后 settle.get 逐字回到原值", !!um.success && un.success && pick(BASE) === pick(un.data),
        pick(BASE) === pick(un.data) ? "逐字相等" : "不相等\n基线=" + pick(BASE).slice(0, 380) + "\n撤销后=" + pick(un.data).slice(0, 380));
    }
  } else { R.check("V6-04", "验收6 需至少一条待结清转账", false, "transfers 为空"); }

  // ===== 清理 + 独立核验 =====
  for (const d of ["2026-07-02", "2026-07-09", "2026-07-30"]) { await apiCall(mini, "seed", "deleteRateSnapshot", { date: d }); await sleep(450); }
  const left = [];
  for (const d of ["2026-07-02", "2026-07-09", "2026-07-30"]) {
    const g = await apiCall(mini, "rate", "getDaily", { date: d, base: "CNY" });
    if (g.success && g.data.date === d && g.data.isFallback === false) left.push(d);
  }
  R.check("V6-06", "清理 rates 无残留注入快照", left.length === 0, left.length ? "残留=" + JSON.stringify(left) : "已清空");
  await apiCall(mini, "settings", "update", { displayCurrency: "CNY", bookId: DEMO });
  await sleep(700);
  await apiCall(mini, "book", "setDefault", { bookId: ICE });
  await sleep(1500);
  const fin = await apiCall(mini, "record", "list", { bookId: DEMO, page: 0, withSummary: true });
  R.check("V6-07", "清理 演示账本回到 6 笔 / 1455.6", fin.success && fin.data.summary.count === 6 && Math.abs(fin.data.summary.expense - 1455.6) < 0.01,
    "count=" + (fin.success && fin.data.summary.count) + " expense=" + (fin.success && fin.data.summary.expense) + " display=" + (fin.success && fin.data.displayCurrency));
  const s = await S(mini);
  R.check("V6-08", "清理 无残留结清记录", s.success && (s.data.settled || []).length === 0, "settled 数=" + (s.success ? (s.data.settled || []).length : "?"));
  const prof = await apiCall(mini, "user", "getProfile", {});
  const bl = await apiCall(mini, "book", "list", {});
  R.check("V6-09", "清理 defaultBookId = 冰岛", prof.success && prof.data.defaultBookName === "\u51b0\u5c9b",
    "defaultBookName=" + (prof.success && prof.data.defaultBookName) + " " + JSON.stringify((bl.success ? bl.data : []).map((b) => [b.name, b.isDefault, b.isCurrent])));
  const igc = await apiCall(mini, "book", "getCurrent", {});
  const il = await apiCall(mini, "record", "list", { bookId: ICE, page: 0, withSummary: true });
  const g0 = il.success && il.data.groups && il.data.groups[0];
  R.check("V6-10", "清理 冰岛未被改动(EUR/CNY, 5 笔 -1047.97)",
    igc.success && igc.data.baseCurrency === "EUR" && igc.data.displayCurrency === "CNY" && !!g0 && (g0.items || []).length === 5 && Math.abs(g0.total + 1047.97) < 0.01,
    "base=" + (igc.success && igc.data.baseCurrency) + " display=" + (igc.success && igc.data.displayCurrency) + " 笔数=" + (g0 && (g0.items || []).length) + " total=" + (g0 && g0.total));
  console.log("结束时刻(UTC):", new Date().toISOString());
  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 2500));
  process.exit(0);
})().catch((e) => { console.error("V6 FATAL:", e.message, e.stack); process.exit(1); });
