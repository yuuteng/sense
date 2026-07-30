// S2 FIX-05 复测：add.js 新增 onUnload 清理 600ms 导航定时器
// 关键场景（PM 新发现，此前无任何用例覆盖）：编辑流 home -> detail -> add，
// 保存成功后 600ms 内用户自己返回，旧代码定时器仍会从新栈顶再弹一页 => 被多弹到 home。
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

const stackOf = async (mini) => (await mini.pageStack()).map((p) => p.path).join(">");
const instOf = (mini) => mini.evaluate(() => {
  const ps = getCurrentPages(); const t = ps[ps.length - 1];
  return { path: t && t.route, saved: t && t._saved, saving: t && t._saving, hasTimer: !!(t && t._navTimer), editId: t && t.editId };
});

// 建立 home -> detail -> add(编辑) 三层栈
async function openEditStack(mini) {
  const home = await goto(mini, "/pages/home/home");
  await waitFor(async () => { const x = await home.data(); return !x.loading && x.groups && x.groups.length ? x : null; }, 20000);
  const row = await home.$(".txn");
  await row.tap();
  await sleep(2800);
  let p = await curPage(mini);
  if (p.path !== "pages/detail/detail") return { err: "未进入 detail: " + p.path };
  await waitFor(async () => { const x = await p.data(); return x.d ? x : null; }, 15000);
  const editBtn = await p.$(".btn--ghost");
  await editBtn.tap();
  await sleep(3000);
  p = await curPage(mini);
  if (p.path !== "pages/add/add") return { err: "未进入 add: " + p.path };
  await waitFor(async () => { const x = await p.data(); return !x.loading && x.editId ? x : null; }, 20000);
  return { page: p, stack: await stackOf(mini) };
}

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("s2-fix05-timer");
  const st = loadState();
  const bookId = st.batch2BookId;
  await apiCall(mini, "book", "setDefault", { bookId });
  await sleep(1200);

  // ===== 场景 A（关键）：编辑流保存成功后 600ms 内手动返回 =====
  let o = await openEditStack(mini);
  R.check("S2-01", "建立编辑流三层栈 home>detail>add", !o.err && o.stack === "pages/home/home>pages/detail/detail>pages/add/add",
    o.err || ("栈=" + o.stack));
  if (o.err) { R.save(errors); process.exit(1); }
  let page = o.page;
  const n0 = (await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true })).data.summary.count;
  await page.callMethod("onAmountInput", { detail: { value: "7.77" } });
  await sleep(400);
  const btn = await page.$(".btn--block");
  await btn.tap();
  // 高频轮询 _saved，一变 true 立刻手动返回（模拟用户在 600ms 窗口内自己返回）
  let sawSaved = false, backAt = -1;
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) {
    const inst = await instOf(mini).catch(() => null);
    if (inst && inst.saved) {
      sawSaved = true;
      await mini.evaluate(() => { wx.navigateBack({ delta: 1 }); });
      backAt = Date.now() - t0;
      break;
    }
    await sleep(50);
  }
  R.check("S2-02", "在 600ms 窗口内成功抢到手动返回", sawSaved, "抢到 _saved 并立即返回，耗时=" + backAt + "ms");
  await sleep(700);
  let p1 = await curPage(mini);
  let s1 = await stackOf(mini);
  R.check("S2-03", "手动返回后停在 detail（不是 home）", p1.path === "pages/detail/detail",
    "当前页=" + p1.path + " 栈=" + s1);
  // 关键断言：再等 2s，若定时器未被清理会再弹一层到 home
  await sleep(2200);
  let p2 = await curPage(mini);
  let s2 = await stackOf(mini);
  R.check("S2-04", "再等 2.2s 仍停在 detail —— 600ms 定时器已被 onUnload 清理，未越权再弹一层",
    p2.path === "pages/detail/detail" && s2 === "pages/home/home>pages/detail/detail",
    "当前页=" + p2.path + " 栈=" + s2 + "（若定时器未清理，此处会变成 pages/home/home）");
  const n1 = (await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true })).data.summary.count;
  R.check("S2-05", "编辑保存未产生新增记录", n1 === n0, "count " + n0 + "->" + n1);
  const chk = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true });
  const amts = [];
  ((chk.success && chk.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => amts.push(i.originalAmount)));
  R.check("S2-06", "编辑内容已生效(出现 7.77)", amts.some((a) => Math.abs(a - 7.77) < 0.001), "金额列表=" + JSON.stringify(amts));

  // ===== 场景 B（对照）：正常等满 600ms，返回行为不变 =====
  o = await openEditStack(mini);
  R.check("S2-07", "重新建立编辑流三层栈", !o.err && o.stack === "pages/home/home>pages/detail/detail>pages/add/add", o.err || ("栈=" + o.stack));
  if (!o.err) {
    page = o.page;
    await page.callMethod("onAmountInput", { detail: { value: "8.88" } });
    await sleep(400);
    const b2 = await page.$(".btn--block");
    await b2.tap();
    const left = await waitFor(async () => { const p = await curPage(mini); return p.path !== "pages/add/add" ? p : null; }, 15000, 200);
    await sleep(1500);
    const p3 = await curPage(mini);
    const s3 = await stackOf(mini);
    R.check("S2-08", "对照组：等满 600ms 自动返回，停在 detail（编辑流正常行为不变）",
      !!left && p3.path === "pages/detail/detail" && s3 === "pages/home/home>pages/detail/detail",
      "自动返回到=" + (left && left.path) + " 稳定后=" + p3.path + " 栈=" + s3);
  }

  // ===== 场景 C：新增流（home -> add）等满 600ms 自动返回首页，行为不变 =====
  const home = await goto(mini, "/pages/home/home");
  await waitFor(async () => { const x = await home.data(); return !x.loading ? x : null; }, 20000);
  const fab = await home.$(".fab");
  await fab.tap();
  await sleep(3000);
  let pa = await curPage(mini);
  if (pa.path === "pages/add/add") {
    await waitFor(async () => { const x = await pa.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
    await pa.callMethod("onAmountInput", { detail: { value: "9.09" } });
    await sleep(400);
    const b3 = await pa.$(".btn--block");
    await b3.tap();
    const left2 = await waitFor(async () => { const p = await curPage(mini); return p.path !== "pages/add/add" ? p : null; }, 15000, 200);
    await sleep(1200);
    const p4 = await curPage(mini);
    R.check("S2-09", "新增流：保存后自动返回首页，行为不变", !!left2 && p4.path === "pages/home/home",
      "返回到=" + (left2 && left2.path) + " 稳定后=" + p4.path + " 栈=" + (await stackOf(mini)));
  } else {
    R.check("S2-09", "新增流：保存后自动返回首页，行为不变", false, "未进入 add 页: " + pa.path);
  }

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("S2 FATAL:", e.message, e.stack); process.exit(1); });
