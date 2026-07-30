// U8 决定一 在冰岛(唯一能跑通的多人分账账本)上验「不漂移」等只读类验收
// 安全性: 冰岛是真实数据 —— 全程只读, 不增删记录/不 mark 结清/不改 settleCur/不清 rates。
// 只注入「今天(07-30)」一份快照: 冰岛记录都在 07-22, quotesAt(07-22) 取的是 07-11 那份,
// 故注入今天不改变任何历史记录的换算系数(下面 U8-03 会实测证明), 且测完立即删除。
const { connect, apiCall, makeRecorder, sleep } = require("./lib");
const ICE = "9cef38726a522d5f008ef25d7a291933";
const r2 = (n) => Math.round(n * 100) / 100;
const sum = (a) => a.reduce((x, y) => x + y, 0);
function pick(s) {
  return JSON.stringify({
    summary: s.summary,
    members: (s.members || []).map((m) => [m.name, m.paid, m.share, m.net]),
    transfers: (s.transfers || []).map((t) => [t.from, t.to, t.amount, t.amountDisp, t.cur, t.amountRef]),
    settled: (s.settled || []).map((x) => [x.from, x.to, x.amount, x.amountDisp, x.cur]),
    splits: (s.splits || []).map((x) => [x.title, x.amount, x.isForeign, x.fx]),
  });
}

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("u8-settle-ice");
  await apiCall(mini, "book", "setDefault", { bookId: ICE });
  await sleep(1000);
  const gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("U8-00", "冰岛 base=EUR / display=CNY / split", gc.success && gc.data.baseCurrency === "EUR" && gc.data.displayCurrency === "CNY" && gc.data.type === "split",
    "base=" + (gc.success && gc.data.baseCurrency) + " display=" + (gc.success && gc.data.displayCurrency));

  const s1r = await apiCall(mini, "settle", "get", { bookId: ICE });
  const S1 = s1r.success ? s1r.data : null;
  R.check("U8-01", "settle.get 正常返回(冰岛贪心不踩死循环)", !!S1, S1 ? "totalExpense=" + S1.summary.totalExpense + " cur=" + S1.summary.currency + " transfers=" + S1.transfers.length + " splits=" + S1.splitCount : JSON.stringify(s1r).slice(0, 200));
  if (!S1) { R.save(errors); process.exit(1); }
  console.log("S1 summary:", JSON.stringify(S1.summary));
  console.log("S1 members:", JSON.stringify(S1.members.map((m) => [m.name, m.paid, m.share, m.net])));
  console.log("S1 transfers:", JSON.stringify(S1.transfers.map((t) => [t.from, t.to, t.amount, t.amountRef, t.cur])));

  const beforeList = await apiCall(mini, "record", "list", { bookId: ICE, page: 0, withSummary: true });
  const bItems = [];
  ((beforeList.success && beforeList.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => bItems.push(i)));

  // ===== 验收1 核心: 注入今日大幅变动快照 -> settle 结果必须逐字不变 =====
  const inj = await apiCall(mini, "seed", "injectRateSnapshot", { date: "2026-07-30", quotes: { EUR: 15, ISK: 0.2, USD: 7 } });
  R.check("U8-02", "注入今日快照成功(EUR 7.745693 -> 15, 近乎翻倍)", inj.success, JSON.stringify(inj.data || inj).slice(0, 160));
  // 先证明它没改动历史记录的换算(record.list 逐字不变) —— 这既是安全性证明也是口径固化的证据
  const afterList = await apiCall(mini, "record", "list", { bookId: ICE, page: 0, withSummary: true });
  const aItems = [];
  ((afterList.success && afterList.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => aItems.push(i)));
  const listSame = JSON.stringify(bItems.map((i) => [i.recordId, i.amountConverted])) === JSON.stringify(aItems.map((i) => [i.recordId, i.amountConverted]));
  R.check("U8-03", "注入今日快照未改动任何历史记录的换算金额(record.list 逐字不变, 同时证明对真实数据无副作用)",
    listSame, listSame ? "逐字相等" : "变了! before=" + JSON.stringify(bItems.map((i) => i.amountConverted)) + " after=" + JSON.stringify(aItems.map((i) => i.amountConverted)));

  const s2r = await apiCall(mini, "settle", "get", { bookId: ICE });
  const S2 = s2r.success ? s2r.data : null;
  R.check("U8-04", "★验收1 核心: 注入今日新汇率后 settle.get 逐字不变(不漂移)",
    !!S2 && pick(S1) === pick(S2),
    pick(S1) === pick(S2) ? "逐字相等" : "不相等\nS1=" + pick(S1).slice(0, 600) + "\nS2=" + pick(S2).slice(0, 600));

  // 灵敏度: 旧代码用最新汇率(EUR=15), 总额会变成另一个数
  const baseTotal = sum(bItems.filter((i) => i.type === "expense").map((i) => i.originalAmount)); // 原币 EUR = base
  const oldWouldBe = r2(baseTotal * 15);
  R.check("U8-05", "灵敏度: 若仍用最新汇率, totalExpense 会变成 " + oldWouldBe + "(证明 U8-04 断言有效)",
    Math.abs(S1.summary.totalExpense - oldWouldBe) > 1,
    "固化系数下=" + S1.summary.totalExpense + " 最新汇率下会是=" + oldWouldBe);

  // ===== 验收9: getMemberData 也不漂移 =====
  const md1 = await apiCall(mini, "stats", "getMemberData", { bookId: ICE, month: "2026-07", kind: "expense" });
  const inj2 = await apiCall(mini, "seed", "injectRateSnapshot", { date: "2026-07-30", quotes: { EUR: 25, ISK: 0.3, USD: 7 } });
  const md2 = await apiCall(mini, "stats", "getMemberData", { bookId: ICE, month: "2026-07", kind: "expense" });
  R.check("U8-06", "验收9 getMemberData 重构后同样不漂移(注入更极端汇率后逐字不变)",
    md1.success && md2.success && JSON.stringify(md1.data) === JSON.stringify(md2.data),
    "一致=" + (JSON.stringify(md1.data) === JSON.stringify(md2.data)) + " data=" + JSON.stringify(md1.data).slice(0, 260));
  const s3r = await apiCall(mini, "settle", "get", { bookId: ICE });
  R.check("U8-07", "settle 在第二次更极端注入后仍逐字不变", s3r.success && pick(S1) === pick(s3r.data),
    pick(S1) === pick(s3r.data) ? "逐字相等" : "变了");

  // ===== 验收4: 总额精确 == 逐笔各自当日换算之和 =====
  const expItems = bItems.filter((i) => i.type === "expense");
  const totalDisp = sum(expItems.map((i) => i.amountConverted));
  R.check("U8-08", "验收4 summary.totalExpense == 逐笔按各自当日汇率换算之和",
    Math.abs(S1.summary.totalExpense - r2(totalDisp)) < 0.005,
    "settle=" + S1.summary.totalExpense + " 逐笔累加=" + r2(totalDisp));

  // ===== 验收3: splits 每笔与 record.list 一致 =====
  const a = S1.splits.map((x) => x.amount).sort((x, y) => x - y);
  const b = expItems.map((i) => i.amountConverted).sort((x, y) => x - y);
  R.check("U8-09", "验收3 splits 每笔金额与 record.list 逐笔一致",
    a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.005),
    "splits=" + JSON.stringify(a) + " record.list=" + JSON.stringify(b));

  // ===== 验收5: 零和 / 无垃圾行 =====
  const netSum = sum(S1.members.map((m) => m.net));
  R.check("U8-10", "验收5 零和 |Σnet| <= 0.005", Math.abs(netSum) <= 0.005, "Σnet=" + netSum + " nets=" + JSON.stringify(S1.members.map((m) => [m.name, m.net])));
  const tiny = S1.transfers.filter((t) => t.amount <= 0.01);
  R.check("U8-11", "验收5 无 <=0.01 垃圾转账行", tiny.length === 0, "转账=" + JSON.stringify(S1.transfers.map((t) => t.amount)));

  // ===== isForeign 语义变更(预期): 冰岛 base=EUR display=CNY, EUR 记录现在应显示 pill =====
  const eurSplits = S1.splits.filter((x) => x.isForeign);
  R.check("U8-12", "isForeign 已改为跟展示币种比(base=EUR/display=CNY 时 EUR 记录显示 pill, 预期变化非回归)",
    eurSplits.length > 0, "isForeign 为真的笔数=" + eurSplits.length + "/" + S1.splits.length + " 例=" + JSON.stringify(eurSplits.slice(0, 2).map((x) => [x.title, x.amount, x.fx])));

  // ===== 清理注入的今日快照 =====
  const del = await apiCall(mini, "seed", "deleteRateSnapshot", { date: "2026-07-30" });
  await sleep(800);
  const finalList = await apiCall(mini, "record", "list", { bookId: ICE, page: 0, withSummary: true });
  const fItems = [];
  ((finalList.success && finalList.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => fItems.push(i)));
  const restored = JSON.stringify(bItems.map((i) => [i.recordId, i.amountConverted])) === JSON.stringify(fItems.map((i) => [i.recordId, i.amountConverted]));
  R.check("U8-13", "注入的今日快照已删除, 冰岛金额与注入前逐字一致", !!del.success && restored,
    "delete=" + JSON.stringify(del.data || del).slice(0, 80) + " 金额还原=" + restored);

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("U8 FATAL:", e.message, e.stack); process.exit(1); });
