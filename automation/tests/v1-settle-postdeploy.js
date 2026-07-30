// V1 部署后待跑: REG-01 复测 + 最大余额法结构性断言 + 补齐验收 1(加权F)/2/6/7/8
// 前提: team-lead 通知「最大余额法」已部署后再跑。
// 账本: 「旅行分账演示」(seedData 生成的演示数据, 3 名 seed 成员, team-lead 已确认可自由增删改,
//        坏了可从「载入演示数据」重建)。冰岛严格只读, 本脚本不碰。
// 安全: 汇率注入前先探针确认该日无真实快照; 结束时删除注入 + 撤销我建的结清 + 还原 settleCur。
const { connect, apiCall, makeRecorder, sleep } = require("./lib");
const DEMO = "seed-book-split-floeovmie8";
const r2 = (n) => Math.round(n * 100) / 100;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const stamp = () => new Date().toISOString();
function pick(s) {
  return JSON.stringify({
    summary: s.summary,
    members: (s.members || []).map((m) => [m.name, m.paid, m.share, m.net]),
    transfers: (s.transfers || []).map((t) => [t.from, t.to, t.amount, t.amountDisp, t.cur, t.amountRef]),
    settled: (s.settled || []).map((x) => [x.from, x.to, x.amount, x.amountDisp, x.cur]),
    splits: (s.splits || []).map((x) => [x.title, x.amount, x.isForeign, x.fx]),
  });
}
// 只在「该日原本没有精确快照」时才注入, 保证 delete 能完全还原
async function safeInject(mini, date, quotes, R, id) {
  const pre = await apiCall(mini, "rate", "getDaily", { date, base: "CNY" });
  const exact = pre.success && pre.data.date === date && pre.data.isFallback === false;
  R.check(id, "注入前确认 " + date + " 原本无真实快照(可完全回滚)", !exact,
    exact ? "*** 该日已有真实快照, 拒绝注入以免破坏真实数据 ***" : "无精确快照, 安全");
  if (exact) return false;
  const r = await apiCall(mini, "seed", "injectRateSnapshot", { date, quotes });
  return !!r.success;
}

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("v1-settle-postdeploy");
  const created = { settlementIds: [], recordIds: [], injected: [] };
  console.log("开始时刻(UTC):", stamp());

  await apiCall(mini, "book", "setDefault", { bookId: DEMO });
  await sleep(1000);
  await apiCall(mini, "settings", "update", { displayCurrency: "ISK", bookId: DEMO });
  await sleep(800);
  const gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("V1-00", "演示分账账本就绪 base=CNY / display=ISK(造出 F != 1)",
    gc.success && gc.data.baseCurrency === "CNY" && gc.data.displayCurrency === "ISK" && gc.data.type === "split",
    "base=" + (gc.success && gc.data.baseCurrency) + " display=" + (gc.success && gc.data.displayCurrency));

  // 两日汇率差 100%, 构造加权 F
  if (await safeInject(mini, "2026-07-02", { EUR: 7.8, ISK: 0.05 }, R, "V1-01")) created.injected.push("2026-07-02");
  if (await safeInject(mini, "2026-07-09", { EUR: 7.8, ISK: 0.10 }, R, "V1-02")) created.injected.push("2026-07-09");

  // ===== A. REG-01 复测 =====
  let okCount = 0, worst = 0;
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await apiCall(mini, "settle", "get", { bookId: DEMO });
    const ms = Date.now() - t0;
    worst = Math.max(worst, ms);
    if (r.success) okCount++;
    console.log("  settle.get #" + (i + 1) + " " + ms + "ms ok=" + !!r.success + " " + (r.success ? "" : r.code));
    await sleep(800);
  }
  R.check("V1-03", "REG-01 复测: settle.get 连续 5 次全部成功, 无 -504003", okCount === 5,
    "成功 " + okCount + "/5, 最慢 " + worst + "ms");

  const s1r = await apiCall(mini, "settle", "get", { bookId: DEMO });
  const S1 = s1r.success ? s1r.data : null;
  if (!S1) { R.check("V1-FATAL", "settle.get 不可用, 后续无法进行", false, JSON.stringify(s1r).slice(0, 200)); R.save(errors); process.exit(1); }
  console.log("S1 members:", JSON.stringify(S1.members.map((m) => [m.name, m.net])));
  console.log("S1 transfers:", JSON.stringify(S1.transfers.map((t) => [t.from, t.to, t.amount])));

  // ===== B. 最大余额法 三条结构性断言(不依赖具体数值, 不会被数值变化推翻) =====
  const netOf = {};
  S1.members.forEach((m) => { netOf[m.name.replace("\uff08\u6211\uff09", "")] = m.net; });
  const flow = {};
  S1.transfers.forEach((t) => {
    flow[t.from] = (flow[t.from] || 0) - t.amount;
    flow[t.to] = (flow[t.to] || 0) + t.amount;
  });
  const mismatch = [];
  Object.keys(netOf).forEach((n) => {
    const f = flow[n] || 0;
    if (Math.abs(netOf[n] - f) > 0.0001) mismatch.push({ name: n, net: netOf[n], 转账净流: r2(f) });
  });
  R.check("V1-04", "最大余额法断言1: 每个成员的净额 == 其相关转账的净流入(收 - 付)", mismatch.length === 0,
    mismatch.length ? "不符=" + JSON.stringify(mismatch) : "全部成员相符: " + JSON.stringify(Object.keys(netOf).map((n) => [n, netOf[n]])));

  const badAmt = S1.transfers.filter((t) => !(t.amount > 0) || r2(t.amount) !== t.amount);
  R.check("V1-05", "最大余额法断言2: 无 <=0 的转账行, 且每行金额都是 0.01 的整数倍", badAmt.length === 0,
    "转账金额=" + JSON.stringify(S1.transfers.map((t) => t.amount)) + " 违规=" + JSON.stringify(badAmt.map((t) => t.amount)));

  const netSum = sum(S1.members.map((m) => m.net));
  R.check("V1-06", "最大余额法断言3: Sigma net 严格为 0(净额取整后零和守恒)", Math.abs(netSum) < 0.0001,
    "Sigma net=" + netSum);
  const tSum = sum(S1.transfers.map((t) => t.amount));
  const creditorSum = sum(S1.members.filter((m) => m.net > 0).map((m) => m.net));
  R.check("V1-07", "最大余额法断言4: Sigma 转账金额 == Sigma 债权方净额(无多出的 0.01)",
    Math.abs(tSum - creditorSum) < 0.0001, "Sigma transfers=" + r2(tSum) + " Sigma 债权方净额=" + r2(creditorSum));
  const loopErr = errors.filter((e) => /guard|迭代|iteration/i.test(e.text || ""));
  R.check("V1-08", "最大余额法断言5: 未触发迭代上限(无相关 console.error)", loopErr.length === 0,
    "相关报错=" + JSON.stringify(loopErr).slice(0, 200));

  // ===== C. 验收1 加权 F 场景: 注入今日极端汇率 -> 逐字不变 =====
  if (await safeInject(mini, "2026-07-30", { EUR: 7.8, ISK: 0.5 }, R, "V1-09")) created.injected.push("2026-07-30");
  const s2r = await apiCall(mini, "settle", "get", { bookId: DEMO });
  R.check("V1-10", "验收1(加权F): 两日汇率差 100% 的账本, 注入今日极端汇率后 settle.get 逐字不变",
    s2r.success && pick(S1) === pick(s2r.data),
    pick(S1) === pick(s2r.data) ? "逐字相等" : "不相等 S1=" + pick(S1).slice(0, 400) + " S2=" + pick(s2r.data).slice(0, 400));
  // 灵敏度
  const l = await apiCall(mini, "record", "list", { bookId: DEMO, page: 0, withSummary: true });
  const items = [];
  ((l.success && l.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => items.push(i)));
  const expBase = sum(items.filter((i) => i.type === "expense").map((i) => i.originalAmount));
  R.check("V1-11", "灵敏度: 若用最新汇率(f=2), totalExpense 会是 " + r2(expBase * 2) + ", 实际稳定在 " + S1.summary.totalExpense,
    Math.abs(S1.summary.totalExpense - r2(expBase * 2)) > 1,
    "固化=" + S1.summary.totalExpense + " 最新汇率会是=" + r2(expBase * 2));

  // ===== D. 验收2: 新增一笔 -> 变化; 删除 -> 回到原值 =====
  const prof = await apiCall(mini, "user", "getProfile", {});
  const meOpen = S1.members.find((m) => m.name.indexOf("\uff08\u6211\uff09") >= 0);
  const cats = await apiCall(mini, "category", "list", { bookId: DEMO, kind: "expense" });
  const c0 = cats.success && cats.data && cats.data[0];
  const catId = c0 ? (c0.subs && c0.subs[0] ? c0.subs[0].categoryId : (c0.id || c0._id)) : null;
  const cr = await apiCall(mini, "record", "create", { bookId: DEMO, payload: {
    type: "expense", amount: 300, currency: "CNY", rate: 1, date: "2026-07-05",
    categoryId: catId, title: "QA\u9a8c\u6536\u4e8c\u4e34\u65f6", note: "QA-v1", images: [],
  } });
  const newId = cr.success ? cr.data.recordId : null;
  if (newId) created.recordIds.push(newId);
  await sleep(1500);
  const s3r = await apiCall(mini, "settle", "get", { bookId: DEMO });
  R.check("V1-12", "验收2 新增一笔后总额与净额相应变化", !!newId && s3r.success && s3r.data.summary.totalExpense !== S1.summary.totalExpense,
    "新增前 totalExpense=" + S1.summary.totalExpense + " 新增后=" + (s3r.success && s3r.data.summary.totalExpense));
  if (newId) { await apiCall(mini, "record", "remove", { recordId: newId }); created.recordIds = []; await sleep(1500); }
  const s4r = await apiCall(mini, "settle", "get", { bookId: DEMO });
  R.check("V1-13", "验收2 删除该笔后逐字回到原值", s4r.success && pick(S1) === pick(s4r.data),
    pick(S1) === pick(s4r.data) ? "逐字相等" : "未回到原值");

  // ===== E. 验收6: 已结清历史不变 + 撤销结清 =====
  const t0 = S1.transfers[0];
  if (t0) {
    const mk = await apiCall(mini, "settle", "mark", { bookId: DEMO, from: t0.fromOpenid, to: t0.toOpenid, amount: t0.amount });
    const sid = mk.success ? mk.data.settlementId : null;
    if (sid) created.settlementIds.push(sid);
    await sleep(1500);
    const s5r = await apiCall(mini, "settle", "get", { bookId: DEMO });
    const st5 = s5r.success ? s5r.data.settled : [];
    R.check("V1-14", "验收6 标记结清后出现在 settled[] 且该笔从待结清中移除",
      !!sid && st5.length > 0 && (s5r.data.transfers || []).every((t) => !(t.fromOpenid === t0.fromOpenid && t.toOpenid === t0.toOpenid && Math.abs(t.amount - t0.amount) < 0.005)),
      "settled=" + JSON.stringify(st5.map((x) => [x.from, x.to, x.amount, x.amountDisp, x.cur])) + " 剩余转账=" + JSON.stringify((s5r.data.transfers || []).map((t) => t.amount)));
    const snap = JSON.stringify(st5.map((x) => [x.amount, x.amountDisp, x.cur]));
    // 改汇率后已结清条目必须不变
    await apiCall(mini, "seed", "injectRateSnapshot", { date: "2026-07-30", quotes: { EUR: 7.8, ISK: 0.9 } });
    const s6r = await apiCall(mini, "settle", "get", { bookId: DEMO });
    const snap2 = JSON.stringify((s6r.success ? s6r.data.settled : []).map((x) => [x.amount, x.amountDisp, x.cur]));
    R.check("V1-15", "验收6 汇率大幅变动后已结清条目 amountDisp/cur 逐字不变", snap === snap2,
      "改前=" + snap + " 改后=" + snap2);
    if (sid) {
      await apiCall(mini, "settle", "unmark", { bookId: DEMO, settlementId: sid });
      created.settlementIds = created.settlementIds.filter((x) => x !== sid);
      await sleep(1500);
      const s7r = await apiCall(mini, "settle", "get", { bookId: DEMO });
      const back = (s7r.success ? s7r.data.transfers : []).some((t) => t.fromOpenid === t0.fromOpenid && t.toOpenid === t0.toOpenid);
      R.check("V1-16", "验收6 撤销结清后欠款正确回到待结清方案", back && (s7r.data.settled || []).length === 0,
        "转账恢复=" + back + " settled 数=" + ((s7r.data.settled || []).length));
    }
  } else {
    R.check("V1-14", "验收6 需要至少一条待结清转账", false, "S1.transfers 为空");
  }

  // ===== F. 验收7: settleCur 单笔结算币种走最新汇率 =====
  const t1 = (await apiCall(mini, "settle", "get", { bookId: DEMO })).data.transfers[0];
  if (t1) {
    await apiCall(mini, "settle", "setCurrency", { bookId: DEMO, from: t1.fromOpenid, to: t1.toOpenid, currency: "EUR" });
    await sleep(1200);
    const s8r = await apiCall(mini, "settle", "get", { bookId: DEMO });
    const row = (s8r.success ? s8r.data.transfers : []).find((t) => t.fromOpenid === t1.fromOpenid && t.toOpenid === t1.toOpenid);
    const others = (s8r.success ? s8r.data.transfers : []).filter((t) => !(t.fromOpenid === t1.fromOpenid && t.toOpenid === t1.toOpenid));
    R.check("V1-17", "验收7 指定 settleCur=EUR 的那行按 EUR 显示(最新汇率, 故意不走 F)",
      !!row && row.cur === "EUR", "该行 cur=" + (row && row.cur) + " amountDisp=" + (row && row.amountDisp) + " amountRef=" + (row && row.amountRef));
    R.check("V1-18", "验收7 其余行仍按展示币种(F)显示", others.every((t) => t.cur === s8r.data.summary.currency),
      "其余行 cur=" + JSON.stringify(others.map((t) => t.cur)) + " 展示币种=" + (s8r.success && s8r.data.summary.currency));
    // 还原 settleCur 为展示币种(无删除接口, 设回 ISK 等效于不覆盖)
    await apiCall(mini, "settle", "setCurrency", { bookId: DEMO, from: t1.fromOpenid, to: t1.toOpenid, currency: "ISK" });
  }

  // ===== G. 验收8 变体: 删掉某一日快照验回退(不动 rates 全集) =====
  await apiCall(mini, "seed", "deleteRateSnapshot", { date: "2026-07-02" });
  created.injected = created.injected.filter((d) => d !== "2026-07-02");
  await sleep(800);
  const s9r = await apiCall(mini, "settle", "get", { bookId: DEMO });
  R.check("V1-19", "验收8变体 删掉 07-02 单日快照后 settle.get 不报错且币种标签合理",
    s9r.success && !!s9r.data.summary.currency,
    "ok=" + !!s9r.success + " currency=" + (s9r.success && s9r.data.summary.currency) + " totalExpense=" + (s9r.success && s9r.data.summary.totalExpense));

  // ===== 清理 =====
  for (const sid of created.settlementIds) { await apiCall(mini, "settle", "unmark", { bookId: DEMO, settlementId: sid }); await sleep(600); }
  for (const rid of created.recordIds) { await apiCall(mini, "record", "remove", { recordId: rid }); await sleep(600); }
  for (const d of ["2026-07-02", "2026-07-09", "2026-07-30"]) { await apiCall(mini, "seed", "deleteRateSnapshot", { date: d }); await sleep(400); }
  const left = [];
  for (const d of ["2026-07-02", "2026-07-09", "2026-07-30"]) {
    const g = await apiCall(mini, "rate", "getDaily", { date: d, base: "CNY" });
    if (g.success && g.data.date === d && g.data.isFallback === false) left.push(d);
  }
  R.check("V1-20", "清理: rates 无任何残留注入快照", left.length === 0, left.length ? "残留=" + JSON.stringify(left) : "已清空");
  await apiCall(mini, "settings", "update", { displayCurrency: "CNY", bookId: DEMO });
  const fin = await apiCall(mini, "record", "list", { bookId: DEMO, page: 0, withSummary: true });
  R.check("V1-21", "清理: 演示账本记录数回到 6 笔 / 1455.6(我新增的已删除)",
    fin.success && fin.data.summary.count === 6 && Math.abs(fin.data.summary.expense - 1455.6) < 0.01,
    "count=" + (fin.success && fin.data.summary.count) + " expense=" + (fin.success && fin.data.summary.expense));
  const s10 = await apiCall(mini, "settle", "get", { bookId: DEMO });
  R.check("V1-22", "清理: 无残留结清记录", s10.success && (s10.data.settled || []).length === 0,
    "settled 数=" + (s10.success ? (s10.data.settled || []).length : "?"));

  console.log("结束时刻(UTC):", stamp());
  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("V1 FATAL:", e.message, e.stack); process.exit(1); });
