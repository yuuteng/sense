// R11 判别实验：save 后 navigateBack 卡住，是否由「未保存离开守卫」(wx.enableAlertBeforeUnload) 引起
// A 组：正常流程（守卫会被 onAmountInput 打开）
// B 组：保存前显式 disableAlertBeforeUnload，其余完全相同
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

async function trial(mini, bookId, amount, killGuard) {
  const home = await goto(mini, "/pages/home/home");
  await waitFor(async () => { const x = await home.data(); return !x.loading ? x : null; }, 20000);
  const fab = await home.$(".fab");
  await fab.tap();
  await sleep(3000);
  const page = await curPage(mini);
  if (page.path !== "pages/add/add") return { err: "未进入 add: " + page.path };
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  await page.callMethod("onAmountInput", { detail: { value: String(amount) } });
  await sleep(500);
  const guardBefore = await mini.evaluate(() => {
    const ps = getCurrentPages(); const t = ps[ps.length - 1];
    return { guardOn: t && t._guardOn, saved: t && t._saved, saving: t && t._saving };
  });
  if (killGuard) {
    await mini.evaluate(() => { if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); });
    await sleep(300);
  }
  const n0 = (await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true })).data.summary.count;
  const t0 = Date.now();
  const btn = await page.$(".btn--block");
  await btn.tap();
  let leftAt = -1, finalPath = "";
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { const cp = await curPage(mini); finalPath = cp.path; if (cp.path !== "pages/add/add") { leftAt = Date.now() - t0; break; } }
    catch (e) { finalPath = "curPage err: " + e.message; break; }
  }
  let n1 = -1;
  try { n1 = (await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true })).data.summary.count; } catch (e) { /* ignore */ }
  return { guardBefore, killGuard: !!killGuard, leftAt, finalPath, added: n1 - n0 };
}

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("r11-guard-experiment");
  const st = loadState();
  const bookId = st.qaBookId;

  const B = await trial(mini, bookId, "5.01", true);   // 先跑 B 组，避免 A 组卡死影响后续
  console.log("B(保存前解除守卫):", JSON.stringify(B));
  R.check("R11-01", "B 组：保存前显式解除离开守卫 → 能正常返回首页", B.leftAt > 0,
    "离开耗时=" + B.leftAt + "ms 最终页=" + B.finalPath + " 新增=" + B.added + " 守卫状态=" + JSON.stringify(B.guardBefore));

  const A = await trial(mini, bookId, "5.02", false);  // A 组：原样流程
  console.log("A(原样流程):", JSON.stringify(A));
  R.check("R11-02", "A 组：原样流程保存后能返回首页", A.leftAt > 0,
    "离开耗时=" + A.leftAt + "ms 最终页=" + A.finalPath + " 新增=" + A.added + " 守卫状态=" + JSON.stringify(A.guardBefore));

  R.check("R11-03", "两组均只入 1 笔（保存逻辑本身正确）", B.added === 1 && A.added === 1,
    "B 新增=" + B.added + " A 新增=" + A.added);

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  await mini.disconnect();
})().catch((e) => { console.error("R11 FATAL:", e.message); process.exit(1); });
