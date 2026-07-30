// V1 settle 不漂移专项（决定一验收标准 1 / 6 / 8 的自动化骨架）
// 依赖新部署的 seed.injectRateSnapshot / seed.deleteRateSnapshot（dev 门控）。
// 做法：注入两天有明显差异的历史汇率 → 读一次 settle.get → **再注入一份「今天」的大幅变动汇率**
//      → 再读一次 → 两次结果必须逐字相等。
// 注意：本脚本会写 rates 集合（注入的快照带 injected:true 标记），跑完会删掉自己注入的日期。
//      它不碰任何账本/记录数据。需要一个分账账本 bookId，从 qa-state.json 取或用 --book 传入。
const { connect, apiCall, makeRecorder, loadState } = require("./lib");

const argBook = (process.argv.find((a) => a.startsWith("--book=")) || "").split("=")[1];
const TODAY = new Date().toISOString().slice(0, 10);
const D1 = "2026-07-01", D2 = "2026-07-30";

// 关键：三份快照的 EUR/ISK 比值差异要大，才能把漂移暴露出来
const Q1 = { EUR: 8.00, ISK: 0.0550, USD: 7.20 };           // EUR→ISK ≈ 145.45
const Q2 = { EUR: 8.40, ISK: 0.0510, USD: 7.25 };           // EUR→ISK ≈ 164.71
const QNOW = { EUR: 9.50, ISK: 0.0400, USD: 7.30 };         // EUR→ISK ≈ 237.50（大幅变动）

const norm = (d) => JSON.stringify({
  summary: d.summary,
  members: (d.members || []).map((m) => [m.name, m.paid, m.share, m.net]),
  transfers: (d.transfers || []).map((t) => [t.from, t.to, t.amount, t.amountDisp, t.cur, t.amountRef]),
  settled: (d.settled || []).map((s) => [s.amount, s.amountDisp, s.cur, s.amountRef]),
  splits: (d.splits || []).map((s) => [s.title, s.amount, s.detail, s.isForeign, s.fx]),
});

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("v1-settle-nodrift");
  const st = loadState();
  const bookId = argBook || st.splitBookId || st.qaBookId || st.origBookId;
  if (!bookId) { console.log("没有可用 bookId，请用 --book=xxx 指定一个分账账本"); await mini.disconnect(); return; }
  console.log("测试账本 bookId = " + bookId);

  const inj = async (date, quotes) => {
    const r = await apiCall(mini, "seed", "injectRateSnapshot", { date, quotes });
    console.log(`  注入 ${date}: ` + (r.success ? `ok(${r.data.currencies} 币种)` : JSON.stringify(r)));
    return r.success;
  };

  const ok0 = await inj(D1, Q1) && await inj(D2, Q2);
  R.check("V1-00", "seed.injectRateSnapshot 可用（云函数已部署）", ok0, "");
  if (!ok0) { R.save(errors); await mini.disconnect(); return; }

  const a = await apiCall(mini, "settle", "get", { bookId });
  if (!a.success) { R.check("V1-01", "settle.get 首次调用成功", false, JSON.stringify(a)); R.save(errors); await mini.disconnect(); return; }
  console.log("\n第一次 settle.get:\n  " + norm(a.data).slice(0, 600));

  console.log("\n注入「今天」的大幅变动汇率（EUR→ISK 从 164.71 变 237.50）");
  await inj(TODAY, QNOW);

  const b = await apiCall(mini, "settle", "get", { bookId });
  if (!b.success) { R.check("V1-01", "settle.get 二次调用成功", false, JSON.stringify(b)); R.save(errors); await mini.disconnect(); return; }
  console.log("\n第二次 settle.get:\n  " + norm(b.data).slice(0, 600));

  const same = norm(a.data) === norm(b.data);
  R.check("V1-01", "验收1 核心：注入今天的新汇率后 settle.get 返回逐字相等（不漂移）", same,
    same ? "逐字一致" : "不一致：\n before=" + norm(a.data).slice(0, 800) + "\n after =" + norm(b.data).slice(0, 800));

  // 验收 8：清掉全部注入快照后不应报错（若库里还有其他真实快照，此项只验不报错）
  await apiCall(mini, "seed", "deleteRateSnapshot", { date: TODAY });
  const c = await apiCall(mini, "settle", "get", { bookId });
  R.check("V1-02", "验收8 删掉今天快照后 settle.get 仍成功、无报错", c.success,
    c.success ? "currency=" + (c.data.summary || {}).currency : JSON.stringify(c));

  // 清理自己注入的历史快照（保留真实的当天快照由线上流程重建）
  await apiCall(mini, "seed", "deleteRateSnapshot", { date: D1 });
  await apiCall(mini, "seed", "deleteRateSnapshot", { date: D2 });
  console.log("\n已清理注入的 " + [D1, D2, TODAY].join(" / "));

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 1500));
  await mini.disconnect();
})().catch((e) => { console.error("V1 FATAL:", e.message, e.stack); process.exit(1); });
