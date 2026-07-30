// U7 决定二 验收2: 顶栏币种胶囊在 首页/统计/AI/结算 4 页各验一次
// 即时生效 + 持久化 + 切走再回保持。全部在 QA 自建账本上做, 不碰真实账本。
const { connect, apiCall, loadState, makeRecorder, waitFor, goto, curPage, sleep } = require("./lib");

async function pickCur(page, mini, code, selectMethod) {
  let viaUI = false;
  try {
    const rows = await page.$$("currency-picker >>> .cp__row");
    for (const r of rows) { const c = await r.attribute("data-code"); if (c === code) { await r.tap(); viaUI = true; break; } }
  } catch (e) { console.log("  picker rows: " + e.message); }
  if (!viaUI) await page.callMethod(selectMethod, { detail: { code } });
  return viaUI;
}

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("u7-pill4pages");
  const st = loadState();
  const bookId = st.b3IskBook;          // QA三批ISK, split 账本(单人 -> settle.get 不产生转账, 可正常返回)
  await apiCall(mini, "book", "setDefault", { bookId });
  await sleep(1000);
  const g0 = await apiCall(mini, "book", "getCurrent", {});
  R.check("U7-00", "测试账本就绪(QA三批ISK, split, base=ISK)",
    g0.success && g0.data.bookId === bookId && g0.data.baseCurrency === "ISK",
    "base=" + (g0.success && g0.data.baseCurrency) + " display=" + (g0.success && g0.data.displayCurrency) + " type=" + (g0.success && g0.data.type));

  const cases = [
    ["U7-01", "\u9996\u9875", "/pages/home/home", "openCurPicker", "onCurPick", "EUR", "\u20ac"],
    ["U7-02", "\u7edf\u8ba1\u9875", "/pages/stats/stats", "openCurPicker", "onCurPick", "USD", "$"],
    ["U7-03", "AI \u9875", "/pages/ai/ai", "openCurPicker", "onCurPick", "JPY", "\u00a5"],
  ];
  for (const [id, label, url, openM, selM, code, symbol] of cases) {
    let page = await goto(mini, url);
    let d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
    const before = d.curCode;
    const pill = await page.$(".cur-pill");
    if (pill) await pill.tap(); else await page.callMethod(openM);
    await sleep(1200);
    d = await page.data();
    const opened = !!d.curVisible;
    const viaUI = await pickCur(page, mini, code, selM);
    await sleep(2500);
    d = await page.data();
    const immediate = d.curCode === code;
    // 持久化: 服务端已落库
    const srv = await apiCall(mini, "book", "getCurrent", {});
    const persisted = srv.success && srv.data.displayCurrency === code;
    // 切走再回
    await goto(mini, "/pages/books/books");
    await sleep(1500);
    page = await goto(mini, url);
    d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
    const kept = d.curCode === code;
    R.check(id, "验收2 " + label + " 胶囊改币种: 可打开/即时生效/落库/切走再回保持",
      opened && immediate && persisted && kept,
      "打开=" + opened + " 改前=" + before + " 即时=" + d.curCode + "(期望 " + code + ")" +
      " 落库=" + (srv.success && srv.data.displayCurrency) + " 切回后=" + d.curCode + " viaUI=" + viaUI);
  }

  // 结算页(单人分账账本, settle.get 无转账 -> 可正常返回)
  let page = await goto(mini, "/pages/settle/settle?bookId=" + bookId);
  let d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 25000);
  R.check("U7-04", "结算页可正常加载(单人分账账本)", !!d, "loading=" + (d && d.loading) + " dispCurCode=" + (d && d.dispCurCode));
  if (d) {
    const before = d.dispCurCode;
    const pill = await page.$(".cur-pill");
    if (pill) await pill.tap(); else await page.callMethod("openDispCur");
    await sleep(1200);
    d = await page.data();
    const opened = !!d.dispCurVisible;
    const viaUI = await pickCur(page, mini, "EUR", "onDispCurSelect");
    await sleep(3000);
    d = await page.data();
    const immediate = d.dispCurCode === "EUR";
    const srv = await apiCall(mini, "book", "getCurrent", {});
    const persisted = srv.success && srv.data.displayCurrency === "EUR";
    await goto(mini, "/pages/books/books");
    await sleep(1500);
    page = await goto(mini, "/pages/settle/settle?bookId=" + bookId);
    d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 25000);
    const kept = d && d.dispCurCode === "EUR";
    R.check("U7-05", "验收2 结算页 胶囊改币种: 可打开/即时生效/落库/切走再回保持",
      opened && immediate && persisted && kept,
      "打开=" + opened + " 改前=" + before + " 即时=" + (d && d.dispCurCode) + " 落库=" + (srv.success && srv.data.displayCurrency) + " 切回后=" + (d && d.dispCurCode) + " viaUI=" + viaUI);
  } else {
    R.check("U7-05", "验收2 结算页 胶囊改币种", false, "结算页未加载出来");
  }

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("U7 FATAL:", e.message, e.stack); process.exit(1); });
