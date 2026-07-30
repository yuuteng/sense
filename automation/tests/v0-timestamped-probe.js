// V0 带时刻的单次探针: 确认 REG-01 当前是否已生效(只读, 不跑完整套件)
const { connect, apiCall } = require("./lib");
const DEMO = "seed-book-split-floeovmie8";
const ICE = "9cef38726a522d5f008ef25d7a291933";
(async () => {
  const { mini } = await connect();
  const stamp = () => new Date().toISOString();
  console.log("探针开始时刻(UTC):", stamp());
  for (const [id, name] of [[DEMO, "旅行分账演示(3人)"], [ICE, "冰岛(2人)"]]) {
    const t0 = Date.now();
    const r = await apiCall(mini, "settle", "get", { bookId: id });
    const ms = Date.now() - t0;
    if (r.success) {
      console.log(`  ${name}: ok=true ${ms}ms  totalExpense=${r.data.summary.totalExpense} cur=${r.data.summary.currency} transfers=${r.data.transfers.length} splits=${r.data.splitCount}`);
      console.log(`     members: ${JSON.stringify(r.data.members.map((m) => [m.name, m.net]))}`);
      console.log(`     transfers: ${JSON.stringify(r.data.transfers.map((t) => [t.from, t.to, t.amount, t.amountRef]))}`);
      const netSum = r.data.members.reduce((a, m) => a + m.net, 0);
      const tSum = r.data.transfers.reduce((a, t) => a + t.amount, 0);
      console.log(`     Sigma net=${netSum}  Sigma transfers=${Math.round(tSum * 100) / 100}`);
    } else {
      console.log(`  ${name}: ok=false ${ms}ms  ${r.code} ${(r.errMsg || "").slice(0, 70)}`);
    }
  }
  console.log("探针结束时刻(UTC):", stamp());
  process.exit(0);
})().catch((e) => { console.error("V0 FATAL:", e.message); process.exit(1); });
