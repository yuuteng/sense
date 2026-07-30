// R6 诊断：T1 保存失败是真回归还是时序问题
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

(async () => {
  const { mini, errors } = await connect();
  const st = loadState();
  console.log("qaBookId(state) =", st.qaBookId);

  const gc = await apiCall(mini, "book", "getCurrent", {});
  console.log("getCurrent:", JSON.stringify(gc.data || gc));

  const lst = await apiCall(mini, "record", "list", { bookId: st.qaBookId, page: 0, withSummary: true });
  const all = [];
  ((lst.success && lst.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => all.push({ amt: i.originalAmount, cur: i.currency, title: i.title, date: i.date })));
  console.log("QA book records:", JSON.stringify(all));
  console.log("summary:", JSON.stringify(lst.success && lst.data.summary));

  const p = await curPage(mini);
  console.log("current page:", p.path);
  try { const d = await p.data(); console.log("page data amount=", d.amount, " loading=", d.loading, " editId=", d.editId); } catch (e) { console.log("data err", e.message); }

  // 计时：单次保存端到端耗时（判断 3500ms 等待是否够）
  const page = await goto(mini, "/pages/add/add");
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  await page.callMethod("onAmountInput", { detail: { value: "3.33" } });
  await sleep(500);
  const n0 = (await apiCall(mini, "record", "list", { bookId: st.qaBookId, page: 0, withSummary: true })).data.summary.count;
  const t0 = Date.now();
  const btn = await page.$(".btn--block");
  await btn.tap();
  // 轮询何时离开 add 页
  let leftAt = -1;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const cp = await curPage(mini);
    if (cp.path !== "pages/add/add") { leftAt = Date.now() - t0; break; }
  }
  const n1 = (await apiCall(mini, "record", "list", { bookId: st.qaBookId, page: 0, withSummary: true })).data.summary.count;
  console.log("=== 单次保存耗时(ms) 离开 add 页 =", leftAt, " 记录数", n0, "->", n1);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  await mini.disconnect();
})().catch((e) => { console.error("R6 FATAL:", e.message, e.stack); process.exit(1); });
