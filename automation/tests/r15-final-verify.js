// R15 独立收尾核验：不复用清理脚本的判断，重新读一遍真实状态
// 重点核 team-lead 上次指出的问题：defaultBookId 是否真的回到冰岛（不只是 getCurrent）
const { connect, apiCall, loadState, makeRecorder } = require("./lib");
(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("r15-final-verify");
  const st = loadState();

  const bl = await apiCall(mini, "book", "list", {});
  const books = bl.success ? bl.data : [];
  console.log("book.list:", JSON.stringify(books.map((b) => ({ name: b.name, type: b.type, base: b.baseCurrency, isDefault: b.isDefault, isCurrent: b.isCurrent }))));
  R.check("R15-01", "账本共 4 本且无任何 QA* 账本", books.length === 4 && !books.some((b) => /^QA/.test(b.name)),
    "共 " + books.length + " 本: " + books.map((b) => b.name).join(","));

  const gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("R15-02", "当前账本 = 冰岛", gc.success && gc.data.bookId === st.origBookId,
    "current=" + (gc.success ? gc.data.name : "?"));

  // 直接读 user.getProfile 的 defaultBookName —— 上次就是这里没回到冰岛
  const prof = await apiCall(mini, "user", "getProfile", {});
  const defName = prof.success ? prof.data.defaultBookName : "?";
  R.check("R15-03", "用户默认账本(defaultBookId) = 冰岛（上轮被指出的问题点）",
    defName === "\u51b0\u5c9b", "user.getProfile.defaultBookName=" + defName + " bookCount=" + (prof.success && prof.data.bookCount));

  R.check("R15-04", "冰岛 base=EUR / display=CNY 未被改动",
    gc.success && gc.data.baseCurrency === "EUR" && gc.data.displayCurrency === "CNY",
    "base=" + (gc.success && gc.data.baseCurrency) + " display=" + (gc.success && gc.data.displayCurrency) + " type=" + (gc.success && gc.data.type));

  const sg = await apiCall(mini, "settings", "get", {});
  R.check("R15-05", "全局默认展示币种 = ISK", sg.success && sg.data.displayCurrency === "ISK",
    "displayCurrency=" + (sg.success && sg.data.displayCurrency));

  // 冰岛数据完好：team-lead 报的基准是「7月22日 一组 5 笔 合计 -¥ 1,047.97」
  const l = await apiCall(mini, "record", "list", { bookId: st.origBookId, page: 0, withSummary: true });
  const g0 = l.success && l.data.groups && l.data.groups[0];
  R.check("R15-06", "冰岛数据完好：首组 7月22日 5 笔 合计 -1047.97，展示币种 CNY",
    !!g0 && g0.date === "2026-07-22" && (g0.items || []).length === 5 && Math.abs(g0.total + 1047.97) < 0.01 && l.data.displayCurrency === "CNY",
    "date=" + (g0 && g0.date) + " 笔数=" + (g0 && (g0.items || []).length) + " total=" + (g0 && g0.total) + " displayCurrency=" + (l.success && l.data.displayCurrency));

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 2000));
  await mini.disconnect();
})().catch((e) => { console.error("R15 FATAL:", e.message); process.exit(1); });
