// R12 判别：navigateBack 本身在本环境是否可用（完全不涉及 save）
const { connect, sleep, makeRecorder, waitFor, goto, curPage } = require("./lib");
(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("r12-navback-isolated");

  // 建立自然栈 home > add，不做任何保存
  const home = await goto(mini, "/pages/home/home");
  await waitFor(async () => { const x = await home.data(); return !x.loading ? x : null; }, 20000);
  const fab = await home.$(".fab");
  await fab.tap();
  await sleep(3000);
  let page = await curPage(mini);
  R.check("R12-01", "进入 add 页(自然栈 home>add)", page.path === "pages/add/add", page.path);
  let stack = await mini.pageStack();
  console.log("stack:", stack.map((p) => p.path).join(">"));

  // A) 直接调 navigateBack（同步，不经 setTimeout，不涉及 save）
  await mini.evaluate(() => { wx.navigateBack({ delta: 1 }); });
  await sleep(3000);
  let cp = await curPage(mini);
  R.check("R12-02", "裸调 wx.navigateBack 能离开 add 页(未做任何保存)", cp.path !== "pages/add/add",
    "最终页=" + cp.path + " (期望回到 pages/home/home)");
  console.log("after bare navigateBack:", cp.path);

  if (cp.path === "pages/add/add") {
    // B) 再试 setTimeout 包裹（与 add.js:439 同形）
    await mini.evaluate(() => { setTimeout(() => wx.navigateBack({ delta: 1 }), 600); });
    await sleep(4000);
    cp = await curPage(mini);
    R.check("R12-03", "setTimeout 包裹的 navigateBack 能离开 add 页", cp.path !== "pages/add/add", "最终页=" + cp.path);
  } else {
    R.check("R12-03", "裸调已成功，无需再试 setTimeout 变体", true, "skipped");
  }

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 2000));
  await mini.disconnect();
})().catch((e) => { console.error("R12 FATAL:", e.message); process.exit(1); });
