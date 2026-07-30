// S2b 阴性对照：证明 S2-04 的断言确实能抓到这个 bug
// 手法：建 home>detail>add 栈后，手动排一个与旧代码等价的「未被清理的 600ms 定时器」，
// 再立刻手动返回。若断言点有效，应观察到被多弹一层到 home。
// 这不改产品代码，只是复现旧代码的时序，用来验证用例灵敏度。
const { connect, sleep, makeRecorder, waitFor, goto, curPage } = require("./lib");
const stackOf = async (mini) => (await mini.pageStack()).map((p) => p.path).join(">");

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("s2b-negative-control");

  const home = await goto(mini, "/pages/home/home");
  await waitFor(async () => { const x = await home.data(); return !x.loading && x.groups && x.groups.length ? x : null; }, 20000);
  const row = await home.$(".txn");
  await row.tap();
  await sleep(2800);
  let p = await curPage(mini);
  await waitFor(async () => { const x = await p.data(); return x.d ? x : null; }, 15000);
  const editBtn = await p.$(".btn--ghost");
  await editBtn.tap();
  await sleep(3000);
  p = await curPage(mini);
  await waitFor(async () => { const x = await p.data(); return !x.loading && x.editId ? x : null; }, 20000);
  const s0 = await stackOf(mini);
  R.check("S2B-01", "建立编辑流三层栈", s0 === "pages/home/home>pages/detail/detail>pages/add/add", "栈=" + s0);

  // 模拟旧代码：排一个不受页面生命周期管理的 600ms 返回定时器（页面销毁后依然执行）
  await mini.evaluate(() => { setTimeout(() => wx.navigateBack({ delta: 1 }), 600); return true; });
  // 用户立刻自己返回（此时栈顶变成 detail）
  await mini.evaluate(() => { wx.navigateBack({ delta: 1 }); return true; });
  await sleep(500);
  const mid = await curPage(mini);
  const sMid = await stackOf(mini);
  console.log("手动返回后(定时器尚未触发):", mid.path, "栈=", sMid);
  await sleep(2500);
  const fin = await curPage(mini);
  const sFin = await stackOf(mini);
  console.log("等定时器触发后:", fin.path, "栈=", sFin);

  R.check("S2B-02", "阴性对照：未被清理的定时器确实会把用户多弹一层到 home（证明 S2-04 断言灵敏）",
    fin.path === "pages/home/home" && sFin === "pages/home/home",
    "手动返回后=" + mid.path + "(" + sMid + ") → 定时器触发后=" + fin.path + "(" + sFin + ")");

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 2000));
  process.exit(0);
})().catch((e) => { console.error("S2b FATAL:", e.message); process.exit(1); });
