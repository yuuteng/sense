// V4 第三批完整验收(部署后 2026-07-30 18:26Z)
// 字段口径(team-lead 已指出的坑, 本脚本严格区分):
//   transfers[].amount    = 基准币(固化台账, 供 settle.mark 落库) -> 断言2 测它(整数分)
//   transfers[].amountRef = 展示币种(合计用)                      -> 断言1/4 测它
//   members[].net/paid/share = 展示币种
// 账本: 旅行分账演示(演示数据, 可自由增删改)。冰岛严格只读。
const { connect, apiCall, makeRecorder, sleep } = require("./lib");
const DEMO = "seed-book-split-floeovmie8";
const ICE = "9cef38726a522d5f008ef25d7a291933";
const r2 = (n) => Math.round(n * 100) / 100;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const stamp = () => new Date().toISOString();
function pick(s) {
  return JSON.stringify({ summary: s.summary,
    members: (s.members || []).map((m) => [m.name, m.paid, m.share, m.net]),
    transfers: (s.transfers || []).map((t) => [t.from, t.to, t.amount, t.amountDisp, t.cur, t.amountRef]),
    settled: (s.settled || []).map((x) => [x.from, x.to, x.amount, x.amountDisp, x.cur]),
    splits: (s.splits || []).map((x) => [x.title, x.amount, x.isForeign, x.fx]) });
}
async function safeInject(mini, date, quotes, R, id) {
  const pre = await apiCall(mini, "rate", "getDaily", { date, base: "CNY" });
  const exact = pre.success && pre.data.date === date && pre.data.isFallback === false;
  R.check(id, "注入前确认 " + date + " 原本无真实快照(可完全回滚)", !exact,
    exact ? "*** 该日已有真实快照, 拒绝注入 ***" : "无精确快照, 安全");
  if (exact) return false;
  const r = await apiCall(mini, "seed", "injectRateSnapshot", { date, quotes });
  return !!r.success;
}
const S = (mini, bookId) => apiCall(mini, "settle", "get", { bookId });

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("v4-settle-full");
  const created = { settlementIds: [], recordIds: [], injected: [] };
  console.log("=== 开始时刻(UTC):", stamp(), "===");

  await apiCall(mini, "book", "setDefault", { bookId: DEMO });
  await sleep(1000);
  await apiCall(mini, "settings", "update", { displayCurrency: "ISK", bookId: DEMO });
  await sleep(900);
  const gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("V4-00", "演示分账账本 base=CNY / display=ISK(F != 1) / split",
    gc.success && gc.data.baseCurrency === "CNY" && gc.data.displayCurrency === "ISK" && gc.data.type === "split",
    "base=" + (gc.success && gc.data.baseCurrency) + " display=" + (gc.success && gc.data.displayCurrency));
  if (await safeInject(mini, "2026-07-02", { EUR: 7.8, ISK: 0.05 }, R, "V4-01")) created.injected.push("2026-07-02");
  if (await safeInject(mini, "2026-07-09", { EUR: 7.8, ISK: 0.10 }, R, "V4-02")) created.injected.push("2026-07-09");

  // ===== A. REG-01 复测 =====
  let okc = 0, worst = 0;
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now(); const r = await S(mini, DEMO); const ms = Date.now() - t0;
    worst = Math.max(worst, ms); if (r.success) okc++;
    console.log("  settle.get #" + (i + 1) + " " + ms + "ms ok=" + !!r.success + (r.success ? "" : " " + r.code));
    await sleep(700);
  }
  R.check("V4-03", "REG-01 复测: settle.get 连续 5 次全部成功, 无 -504003", okc === 5, "成功 " + okc + "/5, 最慢 " + worst + "ms");

  const s1r = await S(mini, DEMO);
  const S1 = s1r.success ? s1r.data : null;
  if (!S1) { R.check("V4-FATAL", "settle.get 不可用", false, JSON.stringify(s1r).slice(0, 200)); R.save(errors); process.exit(1); }
  console.log("  members:", JSON.stringify(S1.members.map((m) => [m.name, m.paid, m.share, m.net])));
  console.log("  transfers:", JSON.stringify(S1.transfers.map((t) => ({ from: t.from, to: t.to, amount: t.amount, amountRef: t.amountRef, cur: t.cur }))));
  console.log("  summary:", JSON.stringify(S1.summary));

  // ===== B. 最大余额法 5 条结构性断言 =====
  // 断言1: 每成员净额(展示币) == 其相关转账的净流入(用 amountRef, 展示币)
  const netOf = {}; S1.members.forEach((m) => { netOf[m.name] = m.net; });
  const nameOf = {}; S1.members.forEach((m) => { nameOf[m.name.replace("\uff08\u6211\uff09", "")] = m.name; });
  const flowRef = {};
  S1.transfers.forEach((t) => {
    const fn = nameOf[t.from] || t.from, tn = nameOf[t.to] || t.to;
    flowRef[fn] = (flowRef[fn] || 0) - t.amountRef;
    flowRef[tn] = (flowRef[tn] || 0) + t.amountRef;
  });
  const mis1 = [];
  Object.keys(netOf).forEach((n) => {
    const f = flowRef[n] || 0;
    if (Math.abs(netOf[n] - f) > 0.011) mis1.push({ 成员: n, net: netOf[n], 转账净流_amountRef: r2(f), 差: r2(netOf[n] - f) });
  });
  R.check("V4-04", "最大余额法断言1: 每成员净额 == 其相关转账净流入(均用展示币 amountRef, 容差 0.011=单行取整)",
    mis1.length === 0, mis1.length ? "不符=" + JSON.stringify(mis1) : "全部相符 " + JSON.stringify(Object.keys(netOf).map((n) => [n, netOf[n], r2(flowRef[n] || 0)])));

  // 断言2: amount(基准币) 全 > 0 且是整数分
  const badAmt = S1.transfers.filter((t) => !(t.amount > 0) || Math.abs(t.amount * 100 - Math.round(t.amount * 100)) > 1e-9);
  R.check("V4-05", "最大余额法断言2: 无 <=0 转账行, 且 amount(基准币)均为整数分",
    badAmt.length === 0, "amount=" + JSON.stringify(S1.transfers.map((t) => t.amount)) + " 违规=" + JSON.stringify(badAmt.map((t) => t.amount)));

  // 断言3: Σnet 严格为 0
  const netSum = sum(S1.members.map((m) => m.net));
  R.check("V4-06", "最大余额法断言3: Σ members[].net 严格为 0(零和守恒离散化)", Math.abs(netSum) < 0.0001, "Σnet=" + netSum);

  // 断言4: Σ amountRef == Σ 债权方净额(均展示币)
  const refSum = sum(S1.transfers.map((t) => t.amountRef));
  const credSum = sum(S1.members.filter((m) => m.net > 0).map((m) => m.net));
  R.check("V4-07", "最大余额法断言4: Σ transfers[].amountRef == Σ 债权方净额(均展示币, 容差 0.011×行数)",
    Math.abs(refSum - credSum) <= 0.011 * Math.max(1, S1.transfers.length),
    "Σ amountRef=" + r2(refSum) + " Σ债权方净额=" + r2(credSum) + " 差=" + r2(refSum - credSum));

  // 断言5: 未触发迭代上限
  const loopErr = errors.filter((e) => /guard|迭代|iteration|settle/i.test(e.text || ""));
  R.check("V4-08", "最大余额法断言5: 未触发迭代上限(无相关 console.error)", loopErr.length === 0, "相关报错=" + JSON.stringify(loopErr).slice(0, 200));

  // ===== C. 验收 4a: totalExpense == Σ splits[].amount (逐字) =====
  const splitSum = r2(sum(S1.splits.map((x) => x.amount)));
  R.check("V4-09", "验收4a totalExpense == Σ splits[].amount(逐字相等)",
    Math.abs(S1.summary.totalExpense - splitSum) < 0.0001,
    "totalExpense=" + S1.summary.totalExpense + " Σsplits=" + splitSum);

  // ===== D. 验收 4b: splits 每笔 == record.list(首页/records/详情同源) =====
  const l = await apiCall(mini, "record", "list", { bookId: DEMO, page: 0, withSummary: true });
  const items = []; ((l.success && l.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => items.push(i)));
  const exp = items.filter((i) => i.type === "expense");
  const a = S1.splits.map((x) => x.amount).sort((x, y) => x - y);
  const b = exp.map((i) => i.amountConverted).sort((x, y) => x - y);
  R.check("V4-10", "验收4b splits 每笔 == record.list 逐笔(逐字相等)",
    a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.0001),
    "splits=" + JSON.stringify(a) + " record.list=" + JSON.stringify(b));

  // ===== E. 验收 4c: |totalExpense - Σ paid| <= 0.005 × 成员数 (允许不为 0) =====
  const paidSum = sum(S1.members.map((m) => m.paid));
  const tol = 0.005 * S1.members.length;
  R.check("V4-11", "验收4c |totalExpense - Σ members[].paid| <= 0.005×成员数(设计接缝, 不按相等测)",
    Math.abs(S1.summary.totalExpense - paidSum) <= tol + 1e-9,
    "totalExpense=" + S1.summary.totalExpense + " Σpaid=" + r2(paidSum) + " 差=" + r2(S1.summary.totalExpense - paidSum) + " 容差=" + tol);

  // ===== F. 验收1 加权 F: 注入今日极端汇率 -> 逐字不变 =====
  if (await safeInject(mini, "2026-07-30", { EUR: 7.8, ISK: 0.5 }, R, "V4-12")) created.injected.push("2026-07-30");
  const s2r = await S(mini, DEMO);
  R.check("V4-13", "验收1(加权F) 注入今日极端汇率后 settle.get 逐字不变(不漂移)",
    s2r.success && pick(S1) === pick(s2r.data),
    pick(S1) === pick(s2r.data) ? "逐字相等" : "不相等\nS1=" + pick(S1).slice(0, 420) + "\nS2=" + pick(s2r.data).slice(0, 420));
  const expBase = sum(exp.map((i) => i.originalAmount));
  R.check("V4-14", "灵敏度: 若用最新汇率(f=2)总额会是 " + r2(expBase * 2) + ", 实际稳定在 " + S1.summary.totalExpense,
    Math.abs(S1.summary.totalExpense - r2(expBase * 2)) > 1,
    "固化=" + S1.summary.totalExpense + " 最新汇率会是=" + r2(expBase * 2));

  // ===== G. 验收2 增删记录 =====
  const cats = await apiCall(mini, "category", "list", { bookId: DEMO, kind: "expense" });
  const c0 = cats.success && cats.data && cats.data[0];
  const catId = c0 ? (c0.subs && c0.subs[0] ? c0.subs[0].categoryId : (c0.id || c0._id)) : null;
  const cr = await apiCall(mini, "record", "create", { bookId: DEMO, payload: {
    type: "expense", amount: 300, currency: "CNY", rate: 1, date: "2026-07-05",
    categoryId: catId, title: "QA\u4e34\u65f6", note: "QA-v4", images: [] } });
  const newId = cr.success ? cr.data.recordId : null;
  if (newId) created.recordIds.push(newId);
  await sleep(1600);
  const s3r = await S(mini, DEMO);
  R.check("V4-15", "验收2 新增一笔后总额与净额相应变化",
    !!newId && s3r.success && s3r.data.summary.totalExpense !== S1.summary.totalExpense,
    "新增前=" + S1.summary.totalExpense + " 新增后=" + (s3r.success && s3r.data.summary.totalExpense) + " recordId=" + newId);
  if (newId) { await apiCall(mini, "record", "remove", { recordId: newId }); created.recordIds = []; await sleep(1600); }
  const s4r = await S(mini, DEMO);
  R.check("V4-16", "验收2 删除该笔后逐字回到原值", s4r.success && pick(S1) === pick(s4r.data),
    pick(S1) === pick(s4r.data) ? "逐字相等" : "未回到原值");

  // ===== H. 验收6 已结清历史不变 + 撤销 =====
  const t0 = S1.transfers[0];
  if (t0) {
    const mk = await apiCall(mini, "settle", "mark", { bookId: DEMO, from: t0.fromOpenid, to: t0.toOpenid, amount: t0.amount });
    const sid = mk.success ? mk.data.settlementId : null;
    if (sid) created.settlementIds.push(sid);
    await sleep(1600);
    const s5r = await S(mini, DEMO);
    const st5 = (s5r.success ? s5r.data.settled : []) || [];
    const gone = (s5r.success ? s5r.data.transfers : []).every((t) => !(t.fromOpenid === t0.fromOpenid && t.toOpenid === t0.toOpenid && Math.abs(t.amount - t0.amount) < 0.005));
    R.check("V4-17", "验收6 标记结清后进入 settled[] 且从待结清移除", !!sid && st5.length > 0 && gone,
      "settled=" + JSON.stringify(st5.map((x) => [x.from, x.to, x.amount, x.amountDisp, x.cur])) + " 剩余转账=" + JSON.stringify((s5r.success ? s5r.data.transfers : []).map((t) => t.amount)));
    const snap = JSON.stringify(st5.map((x) => [x.amount, x.amountDisp, x.cur]));
    await apiCall(mini, "seed", "injectRateSnapshot", { date: "2026-07-30", quotes: { EUR: 7.8, ISK: 0.9 } });
    await sleep(900);
    const s6r = await S(mini, DEMO);
    const snap2 = JSON.stringify(((s6r.success ? s6r.data.settled : []) || []).map((x) => [x.amount, x.amountDisp, x.cur]));
    R.check("V4-18", "验收6 汇率大幅变动后已结清条目 amount/amountDisp/cur 逐字不变", snap === snap2, "改前=" + snap + " 改后=" + snap2);
    await apiCall(mini, "seed", "injectRateSnapshot", { date: "2026-07-30", quotes: { EUR: 7.8, ISK: 0.5 } });
    await sleep(700);
    if (sid) {
      await apiCall(mini, "settle", "unmark", { bookId: DEMO, settlementId: sid });
      created.settlementIds = created.settlementIds.filter((x) => x !== sid);
      await sleep(1600);
      const s7r = await S(mini, DEMO);
      const back = (s7r.success ? s7r.data.transfers : []).some((t) => t.fromOpenid === t0.fromOpenid && t.toOpenid === t0.toOpenid);
      R.check("V4-19", "验收6 撤销结清后欠款回到待结清方案且 settled 清空",
        back && ((s7r.success ? s7r.data.settled : []) || []).length === 0,
        "转账恢复=" + back + " settled 数=" + (((s7r.success ? s7r.data.settled : []) || []).length));
      R.check("V4-20", "验收6 撤销后整体逐字回到原值", s7r.success && pick(S1) === pick(s7r.data),
        pick(S1) === pick(s7r.data) ? "逐字相等" : "未回到原值");
    }
  } else { R.check("V4-17", "验收6 需至少一条待结清转账", false, "transfers 为空"); }

  // ===== I. 验收7 settleCur =====
  const cur0 = await S(mini, DEMO);
  const t1 = cur0.success && cur0.data.transfers[0];
  if (t1) {
    await apiCall(mini, "settle", "setCurrency", { bookId: DEMO, from: t1.fromOpenid, to: t1.toOpenid, currency: "EUR" });
    await sleep(1300);
    const s8r = await S(mini, DEMO);
    const row = (s8r.success ? s8r.data.transfers : []).find((t) => t.fromOpenid === t1.fromOpenid && t.toOpenid === t1.toOpenid);
    const others = (s8r.success ? s8r.data.transfers : []).filter((t) => !(t.fromOpenid === t1.fromOpenid && t.toOpenid === t1.toOpenid));
    R.check("V4-21", "验收7 指定 settleCur=EUR 的行按 EUR 显示(最新汇率, 故意不走 F)",
      !!row && row.cur === "EUR", "该行 cur=" + (row && row.cur) + " amountDisp=" + (row && row.amountDisp) + " amount(基准币)=" + (row && row.amount));
    R.check("V4-22", "验收7 其余行仍按展示币种(F)显示",
      others.length === 0 || others.every((t) => t.cur === s8r.data.summary.currency),
      "其余行 cur=" + JSON.stringify(others.map((t) => t.cur)) + " 展示币种=" + (s8r.success && s8r.data.summary.currency));
    await apiCall(mini, "settle", "setCurrency", { bookId: DEMO, from: t1.fromOpenid, to: t1.toOpenid, currency: "ISK" });
    await sleep(900);
  }

  // ===== J. 验收8 变体: 删单日快照验回退 =====
  await apiCall(mini, "seed", "deleteRateSnapshot", { date: "2026-07-02" });
  created.injected = created.injected.filter((d) => d !== "2026-07-02");
  await sleep(900);
  const s9r = await S(mini, DEMO);
  R.check("V4-23", "验收8变体 删掉 07-02 单日快照后 settle.get 不报错且币种标签合理(未动 rates 全集)",
    s9r.success && !!s9r.data.summary.currency,
    "ok=" + !!s9r.success + " currency=" + (s9r.success && s9r.data.summary.currency) + " totalExpense=" + (s9r.success && s9r.data.summary.totalExpense));

  // ===== 冰岛只读复核(BUG-04 修复效果) =====
  const ice = await S(mini, ICE);
  if (ice.success) {
    const iSplit = r2(sum(ice.data.splits.map((x) => x.amount)));
    R4 = Math.abs(ice.data.summary.totalExpense - iSplit) < 0.0001;
    R.check("V4-24", "BUG-04 修复复核(冰岛只读): totalExpense == Σ splits[].amount",
      R4, "totalExpense=" + ice.data.summary.totalExpense + " Σsplits=" + iSplit + "(修复前 1047.96 vs 1047.97)");
    R.check("V4-25", "BUG-04 修复复核(冰岛只读): Σ net 严格为 0", Math.abs(sum(ice.data.members.map((m) => m.net))) < 0.0001,
      "Σnet=" + sum(ice.data.members.map((m) => m.net)));
  } else { R.check("V4-24", "冰岛 settle.get 可用", false, JSON.stringify(ice).slice(0, 150)); }

  // ===== 清理 =====
  for (const sid of created.settlementIds) { await apiCall(mini, "settle", "unmark", { bookId: DEMO, settlementId: sid }); await sleep(700); }
  for (const rid of created.recordIds) { await apiCall(mini, "record", "remove", { recordId: rid }); await sleep(700); }
  for (const d of ["2026-07-02", "2026-07-09", "2026-07-30"]) { await apiCall(mini, "seed", "deleteRateSnapshot", { date: d }); await sleep(500); }
  const left = [];
  for (const d of ["2026-07-02", "2026-07-09", "2026-07-30"]) {
    const g = await apiCall(mini, "rate", "getDaily", { date: d, base: "CNY" });
    if (g.success && g.data.date === d && g.data.isFallback === false) left.push(d);
  }
  R.check("V4-26", "清理: rates 无任何残留注入快照", left.length === 0, left.length ? "残留=" + JSON.stringify(left) : "07-02/07-09/07-30 均已清除");
  await apiCall(mini, "settings", "update", { displayCurrency: "CNY", bookId: DEMO });
  await sleep(700);
  await apiCall(mini, "book", "setDefault", { bookId: ICE });
  await sleep(1500);
  const fin = await apiCall(mini, "record", "list", { bookId: DEMO, page: 0, withSummary: true });
  R.check("V4-27", "清理: 演示账本回到 6 笔 / 1455.6", fin.success && fin.data.summary.count === 6 && Math.abs(fin.data.summary.expense - 1455.6) < 0.01,
    "count=" + (fin.success && fin.data.summary.count) + " expense=" + (fin.success && fin.data.summary.expense));
  const s10 = await S(mini, DEMO);
  R.check("V4-28", "清理: 无残留结清记录", s10.success && ((s10.data.settled || []).length === 0), "settled 数=" + (s10.success ? (s10.data.settled || []).length : "?"));
  const prof = await apiCall(mini, "user", "getProfile", {});
  const bl = await apiCall(mini, "book", "list", {});
  R.check("V4-29", "清理: defaultBookId 回到冰岛", prof.success && prof.data.defaultBookName === "\u51b0\u5c9b",
    "defaultBookName=" + (prof.success && prof.data.defaultBookName) + " isDefault/isCurrent=" + JSON.stringify((bl.success ? bl.data : []).map((b) => [b.name, b.isDefault, b.isCurrent])));
  const igc = await apiCall(mini, "book", "getCurrent", {});
  const il = await apiCall(mini, "record", "list", { bookId: ICE, page: 0, withSummary: true });
  const ig0 = il.success && il.data.groups && il.data.groups[0];
  R.check("V4-30", "清理: 冰岛未被改动(base=EUR/display=CNY, 5 笔 -1047.97)",
    igc.success && igc.data.baseCurrency === "EUR" && igc.data.displayCurrency === "CNY" && !!ig0 && (ig0.items || []).length === 5 && Math.abs(ig0.total + 1047.97) < 0.01,
    "base=" + (igc.success && igc.data.baseCurrency) + " display=" + (igc.success && igc.data.displayCurrency) + " 笔数=" + (ig0 && (ig0.items || []).length) + " total=" + (ig0 && ig0.total));

  console.log("=== 结束时刻(UTC):", stamp(), "===");
  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("V4 FATAL:", e.message, e.stack); process.exit(1); });
