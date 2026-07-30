const { connect, apiCall, sleep } = require("./lib");
const DEMO = "seed-book-split-floeovmie8";
const ICE = "9cef38726a522d5f008ef25d7a291933";
async function t(mini, params, label) {
  const t0 = Date.now();
  const r = await apiCall(mini, "settle", "get", params);
  console.log(`  ${label}: ${Date.now() - t0}ms ok=${!!r.success} ${r.success ? "" : (r.code + " " + (r.errMsg || "").slice(0, 60))}`);
  return r;
}
(async () => {
  const { mini } = await connect();

  console.log("A) 演示账本 display=ISK (当前状态)");
  await t(mini, { bookId: DEMO }, "settle.get");

  console.log("B) 演示账本 display 改回 CNY(=base) 后");
  await apiCall(mini, "settings", "update", { displayCurrency: "CNY", bookId: DEMO });
  await sleep(1000);
  await t(mini, { bookId: DEMO }, "settle.get");
  await t(mini, { bookId: DEMO }, "settle.get 再来一次");

  console.log("C) 删掉我注入的 3 份快照后, display 仍 CNY");
  for (const d of ["2026-07-02", "2026-07-09", "2026-07-30"]) {
    const r = await apiCall(mini, "seed", "deleteRateSnapshot", { date: d });
    console.log("   delete", d, JSON.stringify(r.data || r).slice(0, 80));
  }
  await t(mini, { bookId: DEMO }, "settle.get");

  console.log("D) 重新设 display=ISK (无注入快照)");
  await apiCall(mini, "settings", "update", { displayCurrency: "ISK", bookId: DEMO });
  await sleep(1000);
  await t(mini, { bookId: DEMO }, "settle.get");
  await t(mini, { bookId: DEMO }, "settle.get 再来一次");

  console.log("E) 冰岛对照 (base=EUR, display=CNY)");
  await t(mini, { bookId: ICE }, "settle.get");

  console.log("F) 演示账本各子查询耗时(定位慢在哪一步)");
  for (const [res, type, p, label] of [
    ["member", "list", { bookId: DEMO }, "member.list"],
    ["record", "list", { bookId: DEMO, page: 0, withSummary: true }, "record.list"],
    ["stats", "getMemberData", { bookId: DEMO, month: "2026-07", kind: "expense" }, "getMemberData"],
    ["rate", "getDaily", { date: "2026-07-30", base: "CNY" }, "rate.getDaily(读全量 quotes)"],
  ]) {
    const t0 = Date.now();
    const r = await apiCall(mini, res, type, p);
    console.log(`  ${label}: ${Date.now() - t0}ms ok=${!!r.success}`);
    await sleep(600);
  }
  process.exit(0);
})().catch((e) => { console.error("U4 FATAL:", e.message); process.exit(1); });
