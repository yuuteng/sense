// R7 专项：save() 成功后 navigateBack 是否正常（自然页面栈 home -> add）
// R2 全程用 reLaunch 进 add 页，从未验证过这条返回路径
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

async function trial(mini, st, label, amount) {
  const page0 = await goto(mini, "/pages/home/home");
  await waitFor(async () => { const x = await page0.data(); return !x.loading ? x : null; }, 20000);
  const fab = await page0.$(".fab");
  await fab.tap();
  await sleep(3000);
  let page = await curPage(mini);
  if (page.path !== "pages/add/add") return { label, err: "未进入 add 页: " + page.path };
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  const stack0 = await mini.pageStack();
  await page.callMethod("onAmountInput", { detail: { value: String(amount) } });
  await sleep(500);
  const n0 = (await apiCall(mini, "record", "list", { bookId: st.qaBookId, page: 0, withSummary: true })).data.summary.count;
  const t0 = Date.now();
  const btn = await page.$(".btn--block");
  await btn.tap();
  let leftAt = -1, finalPath = "";
  for (let i = 0; i < 48; i++) {          // 最长 12s
    await sleep(250);
    const cp = await curPage(mini);
    finalPath = cp.path;
    if (cp.path !== "pages/add/add") { leftAt = Date.now() - t0; break; }
  }
  const n1 = (await apiCall(mini, "record", "list", { bookId: st.qaBookId, page: 0, withSummary: true })).data.summary.count;
  return { label, stackBefore: stack0.map((p) => p.path).join(">"), leftAt, finalPath, added: n1 - n0 };
}

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("r7-navback");
  const st = loadState();

  const results = [];
  for (const t of [["第1次", "4.01"], ["第2次", "4.02"], ["第3次", "4.03"]]) {
    const r = await trial(mini, st, t[0], t[1]);
    console.log("TRIAL", JSON.stringify(r));
    results.push(r);
  }
  const allLeft = results.every((r) => r.leftAt > 0);
  const allOne = results.every((r) => r.added === 1);
  R.check("R7-01", "自然页面栈(home>add)保存成功后能返回首页", allLeft,
    results.map((r) => r.label + ": 离开耗时=" + r.leftAt + "ms 最终页=" + r.finalPath + " 栈=" + r.stackBefore).join(" | "));
  R.check("R7-02", "每次保存仍只入 1 笔", allOne, results.map((r) => r.label + ":+" + r.added).join(" "));

  // 对照：reLaunch 进 add（单页栈，navigateBack 应 fail 后 switchTab 兜底）
  const page = await goto(mini, "/pages/add/add");
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  const stack1 = await mini.pageStack();
  await page.callMethod("onAmountInput", { detail: { value: "4.04" } });
  await sleep(500);
  const m0 = (await apiCall(mini, "record", "list", { bookId: st.qaBookId, page: 0, withSummary: true })).data.summary.count;
  const t0 = Date.now();
  const b = await page.$(".btn--block");
  await b.tap();
  let leftAt = -1, fp = "";
  for (let i = 0; i < 48; i++) { await sleep(250); const cp = await curPage(mini); fp = cp.path; if (cp.path !== "pages/add/add") { leftAt = Date.now() - t0; break; } }
  const m1 = (await apiCall(mini, "record", "list", { bookId: st.qaBookId, page: 0, withSummary: true })).data.summary.count;
  R.check("R7-03", "对照：reLaunch 单页栈保存后经 switchTab 兜底离开 add 页", leftAt > 0,
    "离开耗时=" + leftAt + "ms 最终页=" + fp + " 栈=" + stack1.map((p) => p.path).join(">") + " 新增=" + (m1 - m0));

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 4000));
  await mini.disconnect();
})().catch((e) => { console.error("R7 FATAL:", e.message, e.stack); process.exit(1); });
