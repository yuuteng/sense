// U5 定位 -504003 根因: 复算 net 是否落进 [0.001,0.005) 这个「amt=round2()->0 且指针不推进」的窗口
const { connect, apiCall, sleep } = require("./lib");
const DEMO = "seed-book-split-floeovmie8";
const r2 = (n) => Math.round(n * 100) / 100;

(async () => {
  const { mini } = await connect();
  // 让 record.list 回基准币口径(display=CNY=base), 便于拿到基准币金额
  await apiCall(mini, "settings", "update", { displayCurrency: "CNY", bookId: DEMO });
  await sleep(1000);
  const l = await apiCall(mini, "record", "list", { bookId: DEMO, page: 0, withSummary: true });
  const items = [];
  ((l.success && l.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => items.push(i)));
  console.log("displayCurrency=", l.success && l.data.displayCurrency, " 记录数=", items.length);

  const mem = await apiCall(mini, "member", "list", { bookId: DEMO });
  const members = mem.success ? mem.data : [];
  console.log("members:", JSON.stringify(members.map((m) => [m.openid, m.name])));

  const paid = {}, share = {};
  for (const it of items) {
    const d = await apiCall(mini, "record", "get", { recordId: it.recordId });
    if (!d.success) { console.log("record.get fail", it.recordId); continue; }
    const r = d.data;
    const A = r.amountConverted;
    console.log("  rec", it.recordId.slice(-6), "title=" + r.title, "amountConverted=" + A,
      "payer=" + (r.payerOpenid || "").slice(-6), "isSplit=" + r.isSplit,
      "splitInfo=" + JSON.stringify(r.splitInfo).slice(0, 220));
    paid[r.payerOpenid] = (paid[r.payerOpenid] || 0) + A;
    const sp = r.split;
    if (!sp || sp.mode === "treat" || !(sp.members || []).length) {
      share[r.payerOpenid] = (share[r.payerOpenid] || 0) + A;
    } else if ((sp.members || []).some((m) => typeof m.share === "number")) {
      sp.members.forEach((m) => { share[m.openid] = (share[m.openid] || 0) + (m.share || 0); });
    } else {
      const per = A / sp.members.length;
      sp.members.forEach((m) => { share[m.openid] = (share[m.openid] || 0) + per; });
    }
  }
  console.log("paid :", JSON.stringify(paid));
  console.log("share:", JSON.stringify(share));

  const net = {};
  members.forEach((m) => { net[m.openid] = (paid[m.openid] || 0) - (share[m.openid] || 0); });
  console.log("net(全精度, 未计结清抵扣):", JSON.stringify(net));
  console.log("Σnet =", Object.values(net).reduce((a, b) => a + b, 0));

  // 复演贪心, 检测是否会卡死
  const creditors = Object.keys(net).filter((o) => net[o] > 0).map((o) => ({ o, v: net[o] })).sort((a, b) => b.v - a.v);
  const debtors = Object.keys(net).filter((o) => net[o] < 0).map((o) => ({ o, v: -net[o] })).sort((a, b) => b.v - a.v);
  console.log("creditors:", JSON.stringify(creditors), "debtors:", JSON.stringify(debtors));
  let i = 0, j = 0, guard = 0, stuck = null;
  while (i < debtors.length && j < creditors.length) {
    if (++guard > 200) { stuck = { i, j, dv: debtors[i].v, cv: creditors[j].v, amt: r2(Math.min(debtors[i].v, creditors[j].v)) }; break; }
    const amt = r2(Math.min(debtors[i].v, creditors[j].v));
    debtors[i].v -= amt; creditors[j].v -= amt;
    if (debtors[i].v < 0.001) i++;
    if (creditors[j].v < 0.001) j++;
  }
  if (stuck) {
    console.log("*** 贪心死循环复现 ***", JSON.stringify(stuck));
    console.log("    min(v)=" + Math.min(stuck.dv, stuck.cv) + " -> round2 = " + stuck.amt + " (=0 故不减)"
      + " 且 v >= 0.001 故 i/j 都不推进 => while 永不结束");
  } else {
    console.log("贪心正常结束, 迭代次数=" + guard);
  }
  process.exit(0);
})().catch((e) => { console.error("U5 FATAL:", e.message); process.exit(1); });
