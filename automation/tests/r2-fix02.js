// R2 FIX-02 复测：add 页 save() in-flight 幂等标志
// 按 bug-triage.md FIX-02 验收标准 1-9 逐条验
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

async function countRecords(mini, bookId) {
  const r = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true });
  return r.success && r.data.summary ? r.data.summary.count : -1;
}
async function freshAdd(mini, amount, note) {
  const page = await goto(mini, "/pages/add/add");
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  if (amount != null) await page.callMethod("onAmountInput", { detail: { value: String(amount) } });
  if (note) await page.callMethod("onNoteInput", { detail: { value: note } });
  await sleep(500);
  return page;
}

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("r2-fix02");
  const st = loadState();
  const bookId = st.retestBookId;
  if (!bookId) { console.error("no retestBookId in state"); process.exit(1); }
  await apiCall(mini, "book", "setDefault", { bookId });
  await sleep(1200);

  // ===== 先补一条 R1-10 的正确断言（原用例 sym() 误匹配到「支出」二字）=====
  const now = new Date();
  const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let page = await goto(mini, "/pages/records/records?bookId=" + bookId + "&dateFrom=" + ym + "-01&dateTo=" + ym + "-" + last + "&type=expense");
  let d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
  const stxt = d.summaryText || "";
  R.check("R2-00", "records 汇总条用展示币种 kr 且不含基准币符号(修正 R1-10 断言)",
    /kr /.test(stxt) && !/\u00a5/.test(stxt), "summaryText=" + stxt);

  // ===== 验收标准 1：连点 3 次(无间隔) → 1 笔 =====
  page = await freshAdd(mini, "7.01", "R2-triple");
  let n1 = await countRecords(mini, bookId);
  let btn = await page.$(".btn--block");
  await Promise.all([btn.tap(), btn.tap(), btn.tap()].map((p) => p.catch((e) => console.log("tap: " + e.message))));
  await sleep(8000);
  let n2 = await countRecords(mini, bookId);
  R.check("R2-01", "连点 3 次(无间隔)只入 1 笔", n2 === n1 + 1, "count " + n1 + "->" + n2 + " 新增=" + (n2 - n1));

  // ===== 验收标准 2：双击间隔 150 / 300 / 600ms → 各 1 笔 =====
  const gaps = [[  "R2-02", 150], ["R2-03", 300], ["R2-04", 600]];
  for (let gi = 0; gi < gaps.length; gi++) {
    const id = gaps[gi][0], gap = gaps[gi][1];
    page = await freshAdd(mini, "8.0" + (gi + 1), "R2-gap" + gap);
    n1 = await countRecords(mini, bookId);
    btn = await page.$(".btn--block");
    const p1 = btn.tap().catch((e) => console.log("tapA: " + e.message));
    await sleep(gap);
    const p2 = btn.tap().catch((e) => console.log("tapB: " + e.message));
    await Promise.all([p1, p2]);
    await sleep(8000);
    n2 = await countRecords(mini, bookId);
    R.check(id, "双击间隔 " + gap + "ms 只入 1 笔", n2 === n1 + 1, "count " + n1 + "->" + n2 + " 新增=" + (n2 - n1));
  }

  // ===== 验收标准 3（关键）：成功后 toast 无遮罩窗口内连续再点 → 不产生第二笔 =====
  // 用「连续锤击」覆盖 in-flight + 成功后 ~600ms toast 窗口 + navigateBack 之后
  page = await freshAdd(mini, "9.99", "R2-hammer");
  n1 = await countRecords(mini, bookId);
  btn = await page.$(".btn--block");
  await btn.tap().catch((e) => console.log("tap0: " + e.message));
  let hammered = 0;
  for (let i = 0; i < 24; i++) {   // 24 x 200ms = 4.8s，横跨请求在途 + toast 窗口 + 返回后
    await sleep(200);
    try { await btn.tap(); hammered++; } catch (e) { /* 页面已返回，按钮消失属预期 */ }
  }
  await sleep(6000);
  n2 = await countRecords(mini, bookId);
  R.check("R2-05", "成功后 toast 窗口内连续锤击保存仍只入 1 笔", n2 === n1 + 1,
    "count " + n1 + "->" + n2 + " 新增=" + (n2 - n1) + " 额外点击成功次数=" + hammered);

  // ===== 验收标准 4：并发直调 save() 两次 → 1 笔 =====
  page = await freshAdd(mini, "6.06", "R2-concurrent");
  n1 = await countRecords(mini, bookId);
  await Promise.all([
    page.callMethod("save").catch((e) => console.log("s1: " + e.message)),
    page.callMethod("save").catch((e) => console.log("s2: " + e.message)),
  ]);
  await sleep(8000);
  n2 = await countRecords(mini, bookId);
  R.check("R2-06", "并发直调 save() 两次只入 1 笔", n2 === n1 + 1, "count " + n1 + "->" + n2 + " 新增=" + (n2 - n1));

  // ===== 验收标准 5：失败后标志必须已复位，能立即重试成功 =====
  // 制造服务端失败：把页面持有的 bookId 改成不存在的 id，record.create 会在 requireMember 抛错
  page = await freshAdd(mini, "5.55", "R2-retry");
  n1 = await countRecords(mini, bookId);
  await page.setData({ "book.bookId": "nonexistent-book-id-qa" });
  await sleep(400);
  await page.callMethod("save").catch((e) => console.log("failsave: " + e.message));
  await sleep(6000);
  let nFail = await countRecords(mini, bookId);
  const pAfter = await curPage(mini);
  R.check("R2-07", "失败路径：未入账且仍停留在记账页", nFail === n1 && pAfter.path === "pages/add/add",
    "count " + n1 + "->" + nFail + " path=" + pAfter.path);
  // 恢复正确 bookId 后立即重试
  await page.setData({ "book.bookId": bookId });
  await sleep(400);
  await page.callMethod("save").catch((e) => console.log("retrysave: " + e.message));
  await sleep(8000);
  n2 = await countRecords(mini, bookId);
  R.check("R2-08", "失败后 _saving 已复位：可立即重试并成功入账 1 笔", n2 === nFail + 1,
    "count " + nFail + "->" + n2 + " 新增=" + (n2 - nFail) + "（若为 0 说明失败后被永久锁死）");

  // ===== 验收标准 6：前置校验拦截后页面不得被锁死 =====
  page = await freshAdd(mini, "0", "R2-guard");
  n1 = await countRecords(mini, bookId);
  btn = await page.$(".btn--block");
  await btn.tap();           // 金额 0，应被拦截
  await sleep(2000);
  await page.callMethod("onAmountInput", { detail: { value: "" } });
  await sleep(300);
  await btn.tap();           // 金额空，应被拦截
  await sleep(2000);
  let nGuard = await countRecords(mini, bookId);
  R.check("R2-09", "金额 0 / 空 仍被拦截(不入账)", nGuard === n1, "count " + n1 + "->" + nGuard);
  // 改成合法金额，应能正常保存（证明未被锁死）
  await page.callMethod("onAmountInput", { detail: { value: "2.22" } });
  await sleep(400);
  await btn.tap();
  await sleep(8000);
  n2 = await countRecords(mini, bookId);
  R.check("R2-10", "前置校验拦截后未锁死：改合法金额可正常保存", n2 === nGuard + 1,
    "count " + nGuard + "->" + n2 + " 新增=" + (n2 - nGuard) + "（若为 0 说明校验失败把页面锁死）");

  // ===== 验收标准 7：编辑既有记录连点保存 → 不新增、内容正确 =====
  const lst = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true });
  const all = [];
  ((lst.success && lst.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => all.push(i)));
  const target = all.find((i) => Math.abs(i.originalAmount - 2.22) < 0.001) || all[0];
  const nEdit0 = await countRecords(mini, bookId);
  page = await goto(mini, "/pages/add/add?id=" + target.recordId);
  d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.editId ? x : null; }, 20000);
  R.check("R2-11", "编辑模式正确载入既有记录", !!(d && d.editId === target.recordId && d.amount),
    "editId=" + (d && d.editId) + " amount=" + (d && d.amount) + " navTitle=" + (d && d.navTitle));
  await page.callMethod("onAmountInput", { detail: { value: "2.99" } });
  await sleep(400);
  btn = await page.$(".btn--block");
  const e1 = btn.tap().catch((e) => console.log("edt1: " + e.message));
  await sleep(200);
  const e2 = btn.tap().catch((e) => console.log("edt2: " + e.message));
  await Promise.all([e1, e2]);
  await sleep(8000);
  const nEdit1 = await countRecords(mini, bookId);
  const chk = await apiCall(mini, "record", "get", { recordId: target.recordId });
  R.check("R2-12", "编辑连点保存不产生新增记录", nEdit1 === nEdit0, "count " + nEdit0 + "->" + nEdit1 + " 新增=" + (nEdit1 - nEdit0));
  R.check("R2-13", "编辑内容已正确更新(金额 2.22 -> 2.99)", chk.success && Math.abs(chk.data.originalAmountRaw != null ? chk.data.originalAmountRaw : parseFloat(String(chk.data.originalAmount).replace(/[^\d.]/g, "")) - 2.99) < 0.01,
    "originalAmount=" + (chk.success && chk.data.originalAmount) + " amountConverted=" + (chk.success && chk.data.amountConverted));

  console.log("FINAL COUNT:", await countRecords(mini, bookId));
  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 5000));
  await mini.disconnect();
})().catch((e) => { console.error("R2 FATAL:", e.message, e.stack); process.exit(1); });
