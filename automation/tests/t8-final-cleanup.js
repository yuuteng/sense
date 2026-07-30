// T8 BUG-01 补充举证（外币 pill 误判）+ 收尾：解散 QA 账本、切回「冰岛」
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("t8-final-cleanup");
  const st = loadState();

  // ===== BUG-01 补充症状：本币记录在 records 页被误判为外币 =====
  // QA 账本展示币种 ISK，存在 currency=ISK 的记录：首页应「无外币 pill」，records 页(错用 CNY)会误加 pill
  let page = await goto(mini, "/pages/home/home");
  let d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.groups && x.groups.length ? x : null; }, 20000);
  const homeIsk = (d.groups[0].items || []).find((i) => /1\.11/.test(i.amount));
  R.check("T8-01", "首页：ISK 记录(=展示币种)不显示外币 pill", !!homeIsk && !homeIsk.fx,
    "amount=" + (homeIsk && homeIsk.amount) + " fx=" + JSON.stringify(homeIsk && homeIsk.fx) + " sub=" + JSON.stringify(homeIsk && homeIsk.sub));

  const now = new Date();
  const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  page = await goto(mini, "/pages/records/records?bookId=" + st.qaBookId + "&dateFrom=" + ym + "-01&dateTo=" + ym + "-" + last + "&type=expense");
  d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
  const recIsk = ((d.groups[0] || {}).items || []).find((i) => /1\.11/.test(i.amount));
  R.check("T8-02", "records 页：同一 ISK 记录也不应显示外币 pill", !!recIsk && !recIsk.fx,
    "amount=" + (recIsk && recIsk.amount) + " fx=" + JSON.stringify(recIsk && recIsk.fx) + " sub=" + JSON.stringify(recIsk && recIsk.sub));
  console.log("HOME ISK ROW   :", JSON.stringify(homeIsk && { amount: homeIsk.amount, fx: homeIsk.fx, sub: homeIsk.sub }));
  console.log("RECORDS ISK ROW:", JSON.stringify(recIsk && { amount: recIsk.amount, fx: recIsk.fx, sub: recIsk.sub }));

  // ===== 收尾 1：切回「冰岛」 =====
  const sd = await apiCall(mini, "book", "setDefault", { bookId: st.origBookId });
  await sleep(1500);
  let gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("T8-03", "当前账本已切回「冰岛」", gc.success && gc.data.bookId === st.origBookId,
    "now=" + (gc.success ? gc.data.name + "/" + gc.data.bookId : JSON.stringify(gc)));

  // ===== 收尾 2：解散 QA 测试账本 =====
  const ds = await apiCall(mini, "book", "dissolve", { bookId: st.qaBookId });
  await sleep(2500);
  R.check("T8-04", "QA 测试账本解散接口成功", !!ds.success, JSON.stringify(ds).slice(0, 200));
  const bl = await apiCall(mini, "book", "list", {});
  const stillThere = bl.success && bl.data.some((b) => b.bookId === st.qaBookId);
  const names = bl.success ? bl.data.map((b) => b.name) : [];
  R.check("T8-05", "账本列表中已无 QA 测试账本", bl.success && !stillThere, "books=" + names.join(","));
  R.check("T8-06", "原账本「冰岛」完好保留", names.includes("冰岛"), "books=" + names.join(","));

  // ===== 收尾 3：首页回到「冰岛」且数据正常 =====
  page = await goto(mini, "/pages/home/home");
  d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
  R.check("T8-07", "首页恢复到「冰岛」账本且正常加载", d && d.bookName === "冰岛" && d.currentBookId === st.origBookId,
    "bookName=" + (d && d.bookName) + " curCode=" + (d && d.curCode) + " groups=" + ((d && d.groups) || []).length);
  const sFin = await apiCall(mini, "settings", "get", {});
  R.check("T8-08", "全局默认展示币种为测试前的值(ISK)", sFin.success && sFin.data.displayCurrency === "ISK",
    "displayCurrency=" + (sFin.success && sFin.data.displayCurrency));

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 4000));
  await mini.disconnect();
})().catch((e) => { console.error("T8 FATAL:", e.message, e.stack); process.exit(1); });
