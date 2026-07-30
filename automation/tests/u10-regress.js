// U10 回归: 前 6 项修复不能被破 + 四页数值口径
const { connect, apiCall, loadState, makeRecorder, waitFor, goto, curPage, sleep } = require("./lib");
const r2 = (n) => Math.round(n * 100) / 100;
function norm(r) {
  if (!r.success) return "ERR" + JSON.stringify(r).slice(0, 80);
  const d = r.data;
  return JSON.stringify({ dc: d.displayCurrency, sum: d.summary,
    g: (d.groups || []).map((x) => ({ d: x.date, t: x.total, i: (x.items || []).map((y) => [y.recordId, y.amountConverted, y.isForeign]) })) });
}
const cnt = async (mini, bookId) => (await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true })).data.summary.count;

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("u10-regress");
  const st = loadState();
  const bookId = st.b3EurBook;                     // QA三批EUR (share, base=EUR)
  await apiCall(mini, "book", "setDefault", { bookId });
  await sleep(1000);
  // 设账本级覆盖 ISK, 造出 display != base 以验 record.list 契约
  await apiCall(mini, "settings", "update", { displayCurrency: "ISK", bookId });
  await sleep(800);
  const gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("U10-00", "回归账本 base=EUR / display=ISK", gc.success && gc.data.baseCurrency === "EUR" && gc.data.displayCurrency === "ISK",
    "base=" + (gc.success && gc.data.baseCurrency) + " display=" + (gc.success && gc.data.displayCurrency));

  // 造两笔(含一笔外币)
  for (const [curCode, amt] of [["EUR", "12"], ["CNY", "50"]]) {
    const page = await goto(mini, "/pages/add/add");
    await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
    await page.callMethod("onCur", { detail: { code: curCode } });
    await sleep(500);
    await page.callMethod("onAmountInput", { detail: { value: amt } });
    await sleep(400);
    const b = await page.$(".btn--block");
    await b.tap();
    await sleep(6500);
  }

  // ===== FIX-01 契约 =====
  const a = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true });
  const b = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true, currency: "ISK" });
  const c = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true, currency: "JPY" });
  R.check("U10-01", "回归 FIX-01 契约: 不传 currency 与传 ISK / JPY 返回逐字相等",
    norm(a) === norm(b) && norm(a) === norm(c),
    "displayCurrency=" + (a.success && a.data.displayCurrency) + " 三者一致=" + (norm(a) === norm(b) && norm(a) === norm(c)));

  // ===== 四页口径一致 =====
  let page = await goto(mini, "/pages/home/home");
  let d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.groups && x.groups.length ? x : null; }, 20000);
  const hItems = d.groups[0].items || [];
  const hTotal = d.groups[0].total;
  const now = new Date();
  const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const lastD = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  page = await goto(mini, "/pages/records/records?bookId=" + bookId + "&dateFrom=" + ym + "-01&dateTo=" + ym + "-" + lastD + "&type=expense");
  const d2 = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
  const rItems = (d2.groups[0] || {}).items || [];
  R.check("U10-02", "回归 首页与 records 页 每笔金额/pill/汇率文案逐字一致",
    hItems.length === rItems.length && hItems.every((h, i) => h.amount === rItems[i].amount && h.fx === rItems[i].fx && h.sub === rItems[i].sub),
    "home=" + JSON.stringify(hItems.map((x) => [x.amount, x.fx])) + " records=" + JSON.stringify(rItems.map((x) => [x.amount, x.fx])));
  R.check("U10-03", "回归 分组合计一致", d2.groups[0] && d2.groups[0].total === hTotal,
    "home=" + hTotal + " records=" + (d2.groups[0] && d2.groups[0].total));
  const ms = await apiCall(mini, "stats", "getMonthlySummary", { bookId });
  const expSum = a.success ? a.data.summary.expense : NaN;
  R.check("U10-04", "回归 统计月度支出与 record.list 汇总同口径", ms.success && Math.abs(ms.data.expense - expSum) < 0.005,
    "stats=" + (ms.success && ms.data.expense) + " record.list=" + expSum);
  const items = [];
  ((a.success && a.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => items.push(i)));
  const det = await apiCall(mini, "record", "get", { recordId: items[0].recordId });
  R.check("U10-05", "回归 详情页展示币种与换算金额同源", det.success && det.data.displayCurrency === "ISK" && Math.abs(det.data.amountConverted - items[0].amountConverted) < 0.005,
    "detail dc=" + (det.success && det.data.displayCurrency) + " amt=" + (det.success && det.data.amountConverted) + " list amt=" + items[0].amountConverted);

  // ===== FIX-02 连点幂等 =====
  page = await goto(mini, "/pages/add/add");
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  await page.callMethod("onAmountInput", { detail: { value: "4.44" } });
  await sleep(400);
  const n0 = await cnt(mini, bookId);
  const btn = await page.$(".btn--block");
  await Promise.all([btn.tap(), btn.tap(), btn.tap()].map((p) => p.catch(() => {})));
  await sleep(8000);
  const n1 = await cnt(mini, bookId);
  R.check("U10-06", "回归 FIX-02 连点 3 次仍只入 1 笔", n1 === n0 + 1, "count " + n0 + "->" + n1 + " 新增=" + (n1 - n0));

  // ===== FIX-05 编辑流 600ms 内手动返回停在 detail =====
  const home = await goto(mini, "/pages/home/home");
  await waitFor(async () => { const x = await home.data(); return !x.loading && x.groups && x.groups.length ? x : null; }, 20000);
  const row = await home.$(".txn");
  await row.tap();
  await sleep(2800);
  let p = await curPage(mini);
  if (p.path === "pages/detail/detail") {
    await waitFor(async () => { const x = await p.data(); return x.d ? x : null; }, 15000);
    const eb = await p.$(".btn--ghost");
    await eb.tap();
    await sleep(3000);
    p = await curPage(mini);
    await waitFor(async () => { const x = await p.data(); return !x.loading && x.editId ? x : null; }, 20000);
    await p.callMethod("onAmountInput", { detail: { value: "5.55" } });
    await sleep(400);
    const sb = await p.$(".btn--block");
    await sb.tap();
    for (let i = 0; i < 200; i++) {
      const inst = await mini.evaluate(() => { const ps = getCurrentPages(); const t = ps[ps.length - 1]; return { saved: t && t._saved }; }).catch(() => null);
      if (inst && inst.saved) { await mini.evaluate(() => { wx.navigateBack({ delta: 1 }); }); break; }
      await sleep(50);
    }
    await sleep(2800);
    const fin = await curPage(mini);
    const stack = (await mini.pageStack()).map((x) => x.path).join(">");
    R.check("U10-07", "回归 FIX-05 编辑流保存后立刻返回, 停在 detail 且 2.8s 后未被多弹一层",
      fin.path === "pages/detail/detail" && stack === "pages/home/home>pages/detail/detail",
      "最终页=" + fin.path + " 栈=" + stack);
  } else {
    R.check("U10-07", "回归 FIX-05 编辑流", false, "未进入 detail: " + p.path);
  }

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("U10 FATAL:", e.message, e.stack); process.exit(1); });
