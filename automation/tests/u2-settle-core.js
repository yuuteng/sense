// U2 决定一核心：settle 逐笔当日汇率固化 —— 验收 1/3/4/5 + 灵敏度
// 用账本「旅行分账演示」(seed 演示数据, base=CNY, 3 名真实成员, 6 笔支出在 07-02..07-09)
// 注入日期 07-02 / 07-09 经探针确认**原本没有任何真实快照**(库里仅 07-11 一份), 故注入可由 delete 完全回滚
const { connect, apiCall, loadState, saveState, makeRecorder, sleep } = require("./lib");

const BOOK = "seed-book-split-floeovmie8";
const sum = (a) => a.reduce((x, y) => x + y, 0);
const r2 = (n) => Math.round(n * 100) / 100;
function pick(s) {
  return JSON.stringify({
    summary: s.summary,
    members: (s.members || []).map((m) => [m.name, m.paid, m.share, m.net]),
    transfers: (s.transfers || []).map((t) => [t.from, t.to, t.amount, t.amountDisp, t.cur, t.amountRef]),
    splits: (s.splits || []).map((x) => [x.title, x.amount, x.isForeign, x.fx]),
  });
}

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("u2-settle-core");

  // ===== 前置 =====
  await apiCall(mini, "book", "setDefault", { bookId: BOOK });
  await sleep(1000);
  const inj1 = await apiCall(mini, "seed", "injectRateSnapshot", { date: "2026-07-02", quotes: { EUR: 7.8, ISK: 0.05 } });
  const inj2 = await apiCall(mini, "seed", "injectRateSnapshot", { date: "2026-07-09", quotes: { EUR: 7.8, ISK: 0.10 } });
  saveState({ injectedRateDates: ["2026-07-02", "2026-07-09"] });
  R.check("U2-00", "注入两日汇率快照成功(CNY->ISK 系数 20 与 10, 差 100% >= 10%)",
    inj1.success && inj2.success, "07-02 ISK=0.05(f=20) 07-09 ISK=0.10(f=10)");
  await apiCall(mini, "settings", "update", { displayCurrency: "ISK", bookId: BOOK });
  await sleep(800);
  const gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("U2-01", "账本 base=CNY / display=ISK (display != base)",
    gc.success && gc.data.baseCurrency === "CNY" && gc.data.displayCurrency === "ISK",
    "base=" + (gc.success && gc.data.baseCurrency) + " display=" + (gc.success && gc.data.displayCurrency) + " type=" + (gc.success && gc.data.type));

  // ===== 验收 1: 不漂移 =====
  const s1r = await apiCall(mini, "settle", "get", { bookId: BOOK });
  const S1 = s1r.success ? s1r.data : null;
  R.check("U2-02", "settle.get 调用成功且展示币种为 ISK", !!S1 && S1.summary.currency === "ISK",
    S1 ? "currency=" + S1.summary.currency + " totalExpense=" + S1.summary.totalExpense + " transfers=" + S1.transfers.length + " splits=" + S1.splitCount : JSON.stringify(s1r).slice(0, 200));
  if (!S1) { R.save(errors); process.exit(1); }
  console.log("S1 summary:", JSON.stringify(S1.summary));
  console.log("S1 members:", JSON.stringify(S1.members.map((m) => [m.name, m.paid, m.share, m.net])));
  console.log("S1 transfers:", JSON.stringify(S1.transfers.map((t) => [t.from, t.to, t.amount, t.amountDisp, t.cur, t.amountRef])));
  console.log("S1 splits:", JSON.stringify(S1.splits.map((x) => [x.title, x.amount, x.isForeign, x.fx])));

  // 中途注入「今天」的大幅变动快照 —— 旧代码(最新汇率)会被它改掉, 新代码(F)不该受影响
  const inj3 = await apiCall(mini, "seed", "injectRateSnapshot", { date: "2026-07-30", quotes: { EUR: 7.8, ISK: 0.5 } });
  saveState({ injectedRateDates: ["2026-07-02", "2026-07-09", "2026-07-30"] });
  R.check("U2-03", "注入今日(07-30)大幅变动快照成功(ISK=0.5, f=2)", inj3.success, JSON.stringify(inj3.data || inj3).slice(0, 150));
  const s2r = await apiCall(mini, "settle", "get", { bookId: BOOK });
  const S2 = s2r.success ? s2r.data : null;
  R.check("U2-04", "★核心: 注入新汇率后 settle.get 结果逐字不变(summary/members/transfers.amountRef/splits)",
    !!S2 && pick(S1) === pick(S2),
    pick(S1) === pick(S2) ? "逐字相等" : "不相等\nS1=" + pick(S1).slice(0, 500) + "\nS2=" + pick(S2).slice(0, 500));

  // 灵敏度: 证明这条断言能抓到旧行为 —— 旧代码用最新汇率, 系数会从 F 变成 f(今天)=2
  const latestF = 1 / 0.5;
  const recs = await apiCall(mini, "record", "list", { bookId: BOOK, page: 0, withSummary: true });
  const items = [];
  ((recs.success && recs.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => items.push(i)));
  const expItems = items.filter((i) => i.type === "expense");
  const totalDisp = sum(expItems.map((i) => i.amountConverted));   // 逐笔各自当日换算之和
  const baseTotal = sum(expItems.map((i) => i.originalAmount));    // 原币=CNY=base, 故等于基准币合计
  const oldWouldBe = r2(baseTotal * latestF);
  R.check("U2-05", "灵敏度: 若仍用最新汇率, 总额会变成另一个值(证明 U2-04 的断言有效)",
    Math.abs(S1.summary.totalExpense - oldWouldBe) > 1,
    "固化系数下 totalExpense=" + S1.summary.totalExpense + " / 若用最新汇率会是 " + oldWouldBe + "(差 " + r2(Math.abs(S1.summary.totalExpense - oldWouldBe)) + ")");

  // ===== 验收 4: 总额精确 == 逐笔各自当日换算之和 =====
  R.check("U2-06", "验收4 总额精确: summary.totalExpense == 逐笔按各自当日汇率换算之和",
    Math.abs(S1.summary.totalExpense - r2(totalDisp)) < 0.005,
    "settle.totalExpense=" + S1.summary.totalExpense + " 逐笔累加(record.list)=" + r2(totalDisp) + " 基准币合计=" + r2(baseTotal));

  // ===== 验收 3: splits 逐笔与 record.list 逐字一致 =====
  const a = S1.splits.map((x) => x.amount).sort((x, y) => x - y);
  const b = expItems.map((i) => i.amountConverted).sort((x, y) => x - y);
  R.check("U2-07", "验收3 splits 每笔金额与 record.list(首页/records/详情同源) 逐笔一致",
    a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.005),
    "settle splits=" + JSON.stringify(a) + " record.list=" + JSON.stringify(b));

  // 证明确实用了两种不同的当日系数(而非单一系数)
  const ratios = expItems.map((i) => r2(i.amountConverted / i.originalAmount));
  const uniq = Array.from(new Set(ratios));
  R.check("U2-08", "逐笔明细确实按各自当日汇率(存在 >=2 种不同的换算系数)", uniq.length >= 2,
    "各笔 换算/原值 系数=" + JSON.stringify(ratios) + " 去重=" + JSON.stringify(uniq));

  // ===== 验收 5: 零和 + 无垃圾转账行 =====
  const netSum = sum(S1.members.map((m) => m.net));
  R.check("U2-09", "验收5 零和: |Σ members[].net| <= 0.005", Math.abs(netSum) <= 0.005,
    "Σnet=" + netSum + " 各成员 net=" + JSON.stringify(S1.members.map((m) => [m.name, m.net])));
  const tiny = S1.transfers.filter((t) => t.amount <= 0.01);
  R.check("U2-10", "验收5 无 <=0.01 的垃圾转账行", tiny.length === 0,
    "转账金额=" + JSON.stringify(S1.transfers.map((t) => t.amount)) + " 垃圾行=" + tiny.length);
  // 债务方付出 == 债权方收到
  const paidOut = {}, gotIn = {};
  S1.transfers.forEach((t) => { paidOut[t.fromOpenid] = (paidOut[t.fromOpenid] || 0) + t.amount; gotIn[t.toOpenid] = (gotIn[t.toOpenid] || 0) + t.amount; });
  const totalOut = sum(Object.values(paidOut)), totalIn = sum(Object.values(gotIn));
  R.check("U2-11", "验收5 债务方付出总额 == 债权方收款总额", Math.abs(totalOut - totalIn) < 0.005,
    "付出=" + r2(totalOut) + " 收款=" + r2(totalIn));

  saveState({ u2_S1: pick(S1) });
  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("U2 FATAL:", e.message, e.stack); process.exit(1); });
