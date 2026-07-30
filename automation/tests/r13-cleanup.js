// R13 收尾清理（导航层不可用，全部走云函数直调，不依赖页面跳转）
const { connect, sleep, apiCall, loadState, makeRecorder } = require("./lib");
(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("r13-cleanup");
  const st = loadState();

  const bl0 = await apiCall(mini, "book", "list", {});
  const before = bl0.success ? bl0.data.map((b) => ({ id: b.bookId, name: b.name })) : [];
  console.log("books before:", JSON.stringify(before));

  // 解散所有 QA 相关账本（名称以 QA 开头），绝不动「冰岛」
  const targets = before.filter((b) => /^QA/.test(b.name));
  R.check("R13-01", "识别出待清理的 QA 账本，且不含「冰岛」", targets.every((t) => t.name !== "\u51b0\u5c9b"),
    "待清理=" + JSON.stringify(targets.map((t) => t.name)));
  for (const t of targets) {
    const r = await apiCall(mini, "book", "dissolve", { bookId: t.id });
    console.log("dissolve", t.name, JSON.stringify(r).slice(0, 120));
    await sleep(1500);
  }

  const bl1 = await apiCall(mini, "book", "list", {});
  const after = bl1.success ? bl1.data.map((b) => b.name) : [];
  R.check("R13-02", "所有 QA 测试账本已解散", !after.some((n) => /^QA/.test(n)), "剩余账本=" + after.join(","));
  R.check("R13-03", "原账本「冰岛」完好保留", after.indexOf("\u51b0\u5c9b") >= 0, "剩余账本=" + after.join(","));

  // 当前账本切回「冰岛」
  await apiCall(mini, "book", "setDefault", { bookId: st.origBookId });
  await sleep(1500);
  const gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("R13-04", "当前账本切回「冰岛」", gc.success && gc.data.bookId === st.origBookId,
    "now=" + (gc.success ? gc.data.name + "/" + gc.data.bookId : JSON.stringify(gc)));
  R.check("R13-05", "「冰岛」币种设置未被改动(base=EUR, display=CNY)",
    gc.success && gc.data.baseCurrency === "EUR" && gc.data.displayCurrency === "CNY",
    "base=" + (gc.success && gc.data.baseCurrency) + " display=" + (gc.success && gc.data.displayCurrency));
  const sg = await apiCall(mini, "settings", "get", {});
  R.check("R13-06", "全局默认展示币种为 ISK(与测试前一致)", sg.success && sg.data.displayCurrency === "ISK",
    "displayCurrency=" + (sg.success && sg.data.displayCurrency));

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 2000));
  await mini.disconnect();
})().catch((e) => { console.error("R13 FATAL:", e.message); process.exit(1); });
