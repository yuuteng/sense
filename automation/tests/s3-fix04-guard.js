// S3 FIX-04 复测：in-flight 守卫区分「飞行途中」与「已存但页面留存」，且绝不解锁
// 造状态说明：「已存但页面留存」上一轮是靠导航故障自然撞到的；环境修好后无法自然复现，
// 故用 evaluate 把页面实例的 _saving/_saved 置为 true 来造该状态（team-lead 已认可此手法）。
// 这是造状态、不是绕过断言：断言仍然是「点保存后行为是否符合预期」。
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

async function hook(mini) {
  await mini.evaluate(() => {
    if (!wx.__qaHooked2) {
      const ot = wx.showToast;
      wx.__toasts = [];
      wx.showToast = function (o) { wx.__toasts.push(o && o.title); return ot.call(wx, o); };
      wx.__qaHooked2 = true;
    }
    wx.__toasts = [];
    return true;
  });
}
const toasts = (mini) => mini.evaluate(() => (wx.__toasts || []).slice());
const clearToasts = (mini) => mini.evaluate(() => { wx.__toasts = []; return true; });
const inst = (mini) => mini.evaluate(() => {
  const ps = getCurrentPages(); const t = ps[ps.length - 1];
  return { path: t && t.route, saving: t && t._saving, saved: t && t._saved };
});
const count = async (mini, bookId) => (await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true })).data.summary.count;

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("s3-fix04-guard");
  const st = loadState();
  const bookId = st.batch2BookId;
  await apiCall(mini, "book", "setDefault", { bookId });
  await sleep(1200);
  await hook(mini);

  // ===== 验收标准 2：飞行途中点保存 → 静默，不弹提示 =====
  let page = await goto(mini, "/pages/add/add");
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  await page.callMethod("onAmountInput", { detail: { value: "3.11" } });
  await sleep(400);
  const n0 = await count(mini, bookId);
  await clearToasts(mini);
  const btn = await page.$(".btn--block");
  await btn.tap();                                  // 第 1 次：真正发起
  await sleep(120);
  const midFlight = await inst(mini);
  await page.callMethod("save");                     // 飞行途中再点
  await page.callMethod("save");
  await sleep(150);
  const flightToasts = await toasts(mini);
  R.check("S3-01", "飞行途中(_saving 真/_saved 假)确认处于在途状态",
    !!midFlight && midFlight.saving === true && !midFlight.saved,
    "_saving=" + (midFlight && midFlight.saving) + " _saved=" + (midFlight && midFlight.saved));
  R.check("S3-02", "飞行途中点保存 → 静默，不出现「这笔已保存」提示",
    !flightToasts.some((t) => t && t.indexOf("\u8fd9\u7b14\u5df2\u4fdd\u5b58") >= 0),
    "飞行期间 toast 记录=" + JSON.stringify(flightToasts));
  await sleep(6000);
  const n1 = await count(mini, bookId);
  R.check("S3-03", "飞行途中重复点击未产生多笔(只入 1 笔)", n1 === n0 + 1, "count " + n0 + "->" + n1);

  // ===== 验收标准 1：已存但页面留存 → 提示「这笔已保存，请返回」且不产生第二笔 =====
  page = await goto(mini, "/pages/add/add");
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  await page.callMethod("onAmountInput", { detail: { value: "3.22" } });
  await sleep(400);
  const n2 = await count(mini, bookId);
  // 造状态：模拟「已成功入账但页面没走掉」
  const set = await mini.evaluate(() => {
    const ps = getCurrentPages(); const t = ps[ps.length - 1];
    t._saving = true; t._saved = true;
    return { saving: t._saving, saved: t._saved };
  });
  R.check("S3-04", "已造出「_saving 真 + _saved 真」的页面留存状态", set.saving === true && set.saved === true, JSON.stringify(set));
  await clearToasts(mini);
  const btn2 = await page.$(".btn--block");
  await btn2.tap();
  await sleep(1200);
  const t2 = await toasts(mini);
  R.check("S3-05", "该状态下点保存 → 出现「这笔已保存，请返回」",
    t2.some((t) => t === "\u8fd9\u7b14\u5df2\u4fdd\u5b58\uff0c\u8bf7\u8fd4\u56de"),
    "toast 记录=" + JSON.stringify(t2));
  await btn2.tap(); await sleep(800); await btn2.tap(); await sleep(3000);
  const n3 = await count(mini, bookId);
  R.check("S3-06", "该状态下连点保存不产生任何新记录(锁未被释放)", n3 === n2, "count " + n2 + "->" + n3 + " 新增=" + (n3 - n2));
  const after = await inst(mini);
  R.check("S3-07", "提示后 _saving 仍为 true(确认「只提示、不解锁」)", after && after.saving === true,
    "_saving=" + (after && after.saving) + " _saved=" + (after && after.saved));

  // ===== FIX-04a 第一级兜底：navigateBack 失败 → switchTab 成功 =====
  // reLaunch 进 add 形成单页栈，navigateBack 无处可回必然 fail，应由 switchTab 兜到首页
  page = await goto(mini, "/pages/add/add");
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  const stk = (await mini.pageStack()).map((p) => p.path).join(">");
  await page.callMethod("onAmountInput", { detail: { value: "3.33" } });
  await sleep(400);
  const n4 = await count(mini, bookId);
  const btn3 = await page.$(".btn--block");
  await btn3.tap();
  const left = await waitFor(async () => { const p = await curPage(mini); return p.path !== "pages/add/add" ? p : null; }, 15000, 200);
  await sleep(1500);
  const fin = await curPage(mini);
  const n5 = await count(mini, bookId);
  R.check("S3-08", "FIX-04a 一级兜底：单页栈下 navigateBack 失败后由 switchTab 正确兜到首页",
    !!left && fin.path === "pages/home/home", "保存前栈=" + stk + " 最终页=" + fin.path);
  R.check("S3-09", "该路径仍只入 1 笔", n5 === n4 + 1, "count " + n4 + "->" + n5);

  // ===== 回归：FIX-02 连点幂等未被破 =====
  page = await goto(mini, "/pages/add/add");
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  await page.callMethod("onAmountInput", { detail: { value: "3.44" } });
  await sleep(400);
  const n6 = await count(mini, bookId);
  const btn4 = await page.$(".btn--block");
  await Promise.all([btn4.tap(), btn4.tap(), btn4.tap()].map((p) => p.catch((e) => console.log("tap: " + e.message))));
  await sleep(8000);
  const n7 = await count(mini, bookId);
  R.check("S3-10", "回归：连点 3 次仍只入 1 笔(FIX-02 幂等未被破)", n7 === n6 + 1, "count " + n6 + "->" + n7 + " 新增=" + (n7 - n6));

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("S3 FATAL:", e.message, e.stack); process.exit(1); });
