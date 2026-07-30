// R0 部署探针：判断 cloudfunctions/api 是否已重新部署（FIX-01 是云函数改动）
// 纯读操作，不写任何数据；在真实账本「冰岛」上安全执行
// 判据：故意传一个荒谬的 currency=JPY
//   旧代码 display = p.currency || base  → 回传 displayCurrency='JPY'（信任前端）
//   新代码 display = displayCurrencyOf() → 忽略 p.currency，回传该账本真实展示币种
const { connect, apiCall, loadState, makeRecorder } = require("./lib");

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("r0-deploy-probe");
  const st = loadState();

  const gc = await apiCall(mini, "book", "getCurrent", {});
  const bk = gc.success ? gc.data : {};
  console.log("冰岛 账本:", JSON.stringify({ bookId: bk.bookId, name: bk.name, base: bk.baseCurrency, display: bk.displayCurrency }));

  const probe = await apiCall(mini, "record", "list", { bookId: st.origBookId, page: 0, withSummary: true, currency: "JPY" });
  const got = probe.success ? probe.data.displayCurrency : "(调用失败)";
  const deployed = probe.success && got !== "JPY";
  console.log("探针结果: 传 currency=JPY 时回传 displayCurrency =", got);
  R.check("R0-01", "云函数 api 已重新部署（record.list 忽略 p.currency）", deployed,
    "传 currency=JPY → displayCurrency=" + got + "（账本真实展示币种=" + bk.displayCurrency + "，base=" + bk.baseCurrency + "）");

  // 契约断言（FIX-01 验收标准 1）：传与不传 currency 结果应逐字相等
  const withCur = await apiCall(mini, "record", "list", { bookId: st.origBookId, page: 0, withSummary: true, currency: "JPY" });
  const noCur = await apiCall(mini, "record", "list", { bookId: st.origBookId, page: 0, withSummary: true });
  const norm = (r) => JSON.stringify(r.success ? { dc: r.data.displayCurrency, sum: r.data.summary, groups: (r.data.groups || []).map((g) => ({ d: g.date, t: g.total, items: (g.items || []).map((i) => [i.recordId, i.amountConverted, i.isForeign]) })) } : r);
  const a = norm(withCur), b = norm(noCur);
  R.check("R0-02", "契约：record.list 传 currency 与不传，返回逐字相等", a === b,
    a === b ? "一致（长度 " + a.length + "）" : "不一致\n withJPY=" + a.slice(0, 400) + "\n noCur  =" + b.slice(0, 400));

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 2000));
  await mini.disconnect();
})().catch((e) => { console.error("R0 FATAL:", e.message, e.stack); process.exit(1); });
