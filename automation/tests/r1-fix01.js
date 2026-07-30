// R1 FIX-01 复测：record.list 展示币种由服务端权威解析
// 按 bug-triage.md FIX-01 验收标准 1-6 逐条验
const { connect, sleep, apiCall, loadState, saveState, makeRecorder, waitFor, goto, curPage } = require("./lib");

function num(s) { const m = String(s || "").replace(/,/g, "").match(/[\d.]+/); return m ? parseFloat(m[0]) : NaN; }
function sym(s) { const m = String(s || "").match(/[^\d\s,.\-+]+/); return m ? m[0] : ""; }
// 归一化 record.list 返回，用于「逐字相等」契约断言
function norm(r) {
  if (!r.success) return "ERR:" + JSON.stringify(r);
  const d = r.data;
  return JSON.stringify({
    displayCurrency: d.displayCurrency, summary: d.summary,
    groups: (d.groups || []).map((g) => ({ date: g.date, total: g.total,
      items: (g.items || []).map((i) => [i.recordId, i.amountConverted, i.currency, i.originalAmount, i.isForeign]) })),
  });
}

async function addRecord(mini, opt) {
  const currency = opt.currency, amount = opt.amount, note = opt.note;
  let page = await goto(mini, "/pages/add/add");
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  if (currency) {
    const pick = await page.$(".cur-pick");
    if (pick) { await pick.tap(); await sleep(1000); }
    let ok = false;
    try {
      const rows = await page.$$("currency-picker >>> .cp__row");
      for (const r of rows) { const c = await r.attribute("data-code"); if (c === currency) { await r.tap(); ok = true; break; } }
    } catch (e) { console.log("cp rows: " + e.message); }
    if (!ok) await page.callMethod("onCur", { detail: { code: currency } });
    await sleep(800);
  }
  await page.callMethod("onAmountInput", { detail: { value: String(amount) } });
  if (note) await page.callMethod("onNoteInput", { detail: { value: note } });
  await sleep(600);
  const btn = await page.$(".btn--block");
  await btn.tap();
  await sleep(6000);
  return await curPage(mini);
}

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("r1-fix01");
  const st = loadState();

  // ===== 前置：建复测账本 base=CNY，账本级展示币种覆盖为 ISK =====
  const cr = await apiCall(mini, "book", "create", { name: "QA复测账本", baseCurrency: "CNY", bookType: "share" });
  const bookId = cr.success ? cr.data.bookId : null;
  R.check("R1-00", "建复测账本成功(base=CNY)", !!bookId, JSON.stringify(cr).slice(0, 200));
  if (!bookId) { R.save(errors); await mini.disconnect(); return; }
  saveState({ retestBookId: bookId });
  await apiCall(mini, "settings", "update", { displayCurrency: "ISK", bookId });
  const gc0 = await apiCall(mini, "book", "getCurrent", {});
  R.check("R1-01", "账本级展示币种覆盖生效(base=CNY, display=ISK)",
    gc0.success && gc0.data.bookId === bookId && gc0.data.baseCurrency === "CNY" && gc0.data.displayCurrency === "ISK",
    JSON.stringify(gc0.data || gc0));

  // ===== 造数：EUR 10（外币）+ ISK 1.11（本币=展示币）=====
  await addRecord(mini, { currency: "EUR", amount: 10, note: "R1-EUR" });
  await addRecord(mini, { currency: "ISK", amount: "1.11", note: "R1-ISK" });
  const lst0 = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true });
  const items0 = [];
  ((lst0.success && lst0.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => items0.push(i)));
  R.check("R1-02", "造数成功：EUR 与 ISK 各一笔", items0.length === 2 && items0.some((i) => i.currency === "EUR") && items0.some((i) => i.currency === "ISK"),
    "count=" + items0.length + " " + JSON.stringify(items0.map((i) => i.currency + " " + i.originalAmount)));

  // ===== 验收标准 1（最关键）：服务端契约，传/不传 currency 逐字相等 =====
  const noCur = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true });
  const isk = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true, currency: "ISK" });
  const jpy = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true, currency: "JPY" });
  const cny = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true, currency: "CNY" });
  const nN = norm(noCur), nI = norm(isk), nJ = norm(jpy), nC = norm(cny);
  R.check("R1-03", "契约：不传 currency 与传 currency:ISK 返回逐字相等", nN === nI, nN === nI ? "一致" : "不一致 no=" + nN.slice(0, 300) + " isk=" + nI.slice(0, 300));
  R.check("R1-04", "契约：传荒谬 currency:JPY 被忽略，结果同不传", nN === nJ, nN === nJ ? "一致" : "不一致 no=" + nN.slice(0, 300) + " jpy=" + nJ.slice(0, 300));
  R.check("R1-05", "契约：传 currency:CNY(基准币)也被忽略，结果同不传", nN === nC, nN === nC ? "一致" : "不一致 no=" + nN.slice(0, 300) + " cny=" + nC.slice(0, 300));
  R.check("R1-06", "record.list 回传 displayCurrency 恒为账本展示币种 ISK", noCur.success && noCur.data.displayCurrency === "ISK",
    "displayCurrency=" + (noCur.success && noCur.data.displayCurrency));

  // ===== 验收标准 2：records 页数值与首页逐字一致 =====
  let page = await goto(mini, "/pages/home/home");
  let d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.groups && x.groups.length ? x : null; }, 20000);
  const homeItems = d.groups[0].items || [];
  const homeEur = homeItems.find((i) => i.fx && i.fx.includes("EUR") === false && i.fx.length > 0 && /\u20ac/.test(i.fx));
  const homeIsk = homeItems.find((i) => !i.fx);
  const homeTotal = d.groups[0].total;
  R.check("R1-07", "首页：EUR 记录按展示币种 ISK 显示且带原币 pill", !!homeEur && sym(homeEur.amount) === "kr",
    "amount=" + (homeEur && homeEur.amount) + " fx=" + (homeEur && homeEur.fx) + " sub=" + (homeEur && homeEur.sub));
  console.log("HOME  EUR:", JSON.stringify(homeEur && { amount: homeEur.amount, fx: homeEur.fx, sub: homeEur.sub }));
  console.log("HOME  ISK:", JSON.stringify(homeIsk && { amount: homeIsk.amount, fx: homeIsk.fx, sub: homeIsk.sub }));
  console.log("HOME  total:", homeTotal, " curCode:", d.curCode);

  const now = new Date();
  const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  page = await goto(mini, "/pages/records/records?bookId=" + bookId + "&dateFrom=" + ym + "-01&dateTo=" + ym + "-" + last + "&type=expense&monthText=" + encodeURIComponent(now.getFullYear() + "\u5e74" + (now.getMonth() + 1) + "\u6708"));
  d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
  const recItems = (d.groups[0] || {}).items || [];
  const recEur = recItems.find((i) => i.fx && /\u20ac/.test(i.fx));
  const recIsk = recItems.find((i) => !i.fx);
  console.log("RECS  EUR:", JSON.stringify(recEur && { amount: recEur.amount, fx: recEur.fx, sub: recEur.sub }));
  console.log("RECS  ISK:", JSON.stringify(recIsk && { amount: recIsk.amount, fx: recIsk.fx, sub: recIsk.sub }));
  console.log("RECS  total:", d.groups[0] && d.groups[0].total, " summary:", d.summaryText);

  R.check("R1-08", "records 页 EUR 行金额与首页逐字一致", !!recEur && !!homeEur && recEur.amount === homeEur.amount,
    "home=" + (homeEur && homeEur.amount) + " records=" + (recEur && recEur.amount));
  R.check("R1-09", "records 页分组合计与首页逐字一致", !!(d.groups[0] && d.groups[0].total === homeTotal),
    "home=" + homeTotal + " records=" + (d.groups[0] && d.groups[0].total));
  R.check("R1-10", "records 页汇总条用展示币种 ISK(kr)", !!d.summaryText && sym(d.summaryText.split("\u00b7").pop()) === "kr",
    "summaryText=" + d.summaryText);

  // ===== 验收标准 3：外币 pill 判定（上一轮仅代码推导、未观测的附带症状）=====
  R.check("R1-11", "records 页：ISK 原币记录不显示外币 pill(与首页一致)", !!recIsk && !recIsk.fx && !recIsk.sub,
    "records ISK fx=" + JSON.stringify(recIsk && recIsk.fx) + " sub=" + JSON.stringify(recIsk && recIsk.sub) + " | home fx=" + JSON.stringify(homeIsk && homeIsk.fx));
  R.check("R1-12", "records 页：EUR 记录显示 pill 且文案为「按 X月X日 汇率」", !!recEur && /\u20ac/.test(recEur.fx) && /^\u6309 .*\u6708.*\u65e5 \u6c47\u7387$/.test(recEur.sub),
    "fx=" + (recEur && recEur.fx) + " sub=" + (recEur && recEur.sub));
  R.check("R1-13", "records 页 ISK 行金额与首页逐字一致", !!recIsk && !!homeIsk && recIsk.amount === homeIsk.amount,
    "home=" + (homeIsk && homeIsk.amount) + " records=" + (recIsk && recIsk.amount));

  // ===== 验收标准 5：详情页 / 统计四卡 口径回归 =====
  const eurId = (items0.find((i) => i.currency === "EUR") || {}).recordId;
  const det = await apiCall(mini, "record", "get", { recordId: eurId });
  R.check("R1-14", "详情接口展示币种为 ISK 且换算金额与列表一致",
    det.success && det.data.displayCurrency === "ISK" && Math.abs(det.data.amountConverted - num(homeEur && homeEur.amount)) < 0.01,
    "detail displayCurrency=" + (det.success && det.data.displayCurrency) + " amountConverted=" + (det.success && det.data.amountConverted) + " homeAmt=" + num(homeEur && homeEur.amount));
  const ms = await apiCall(mini, "stats", "getMonthlySummary", { bookId });
  const expectExp = noCur.success ? noCur.data.summary.expense : NaN;
  R.check("R1-15", "统计月度支出与 records 汇总同口径(均 ISK)", ms.success && Math.abs(ms.data.expense - expectExp) < 0.01,
    "stats.expense=" + (ms.success && ms.data.expense) + " records.summary.expense=" + expectExp);
  const cd = await apiCall(mini, "stats", "getCategoryData", { bookId, month: ym });
  R.check("R1-16", "统计分类数据展示币种为 ISK", cd.success && cd.data.displayCurrency === "ISK", "displayCurrency=" + (cd.success && cd.data.displayCurrency));

  // ===== 验收标准 4 变体：无账本覆盖的账本，首页与 records 页口径一致 =====
  const cr2 = await apiCall(mini, "book", "create", { name: "QA复测账本EUR", baseCurrency: "EUR", bookType: "share" });
  const bookId2 = cr2.success ? cr2.data.bookId : null;
  R.check("R1-17", "建 base=EUR 账本成功(不设账本级覆盖)", !!bookId2, JSON.stringify(cr2).slice(0, 150));
  if (bookId2) {
    saveState({ retestBookId2: bookId2 });
    const sg = await apiCall(mini, "settings", "get", {});
    const globalDef = sg.success ? sg.data.displayCurrency : "?";
    await addRecord(mini, { amount: "20", note: "R1-fallback" });
    const gc2 = await apiCall(mini, "book", "getCurrent", {});
    const l2 = await apiCall(mini, "record", "list", { bookId: bookId2, page: 0, withSummary: true });
    R.check("R1-18", "兜底路径：base=EUR 无覆盖账本，record.list 口径 = 全局默认(非 base)",
      l2.success && l2.data.displayCurrency === globalDef,
      "record.list=" + (l2.success && l2.data.displayCurrency) + " 全局默认=" + globalDef + " book.getCurrent=" + (gc2.success && gc2.data.displayCurrency));

    page = await goto(mini, "/pages/home/home");
    d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.groups && x.groups.length ? x : null; }, 20000);
    const h2 = d.groups[0].items[0];
    const h2cur = d.curCode;
    page = await goto(mini, "/pages/records/records?bookId=" + bookId2 + "&dateFrom=" + ym + "-01&dateTo=" + ym + "-" + last + "&type=expense");
    const d2 = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
    const r2 = ((d2.groups[0] || {}).items || [])[0];
    R.check("R1-19", "兜底路径：首页与 records 页行金额逐字一致", !!h2 && !!r2 && h2.amount === r2.amount,
      "home=" + (h2 && h2.amount) + "(curCode=" + h2cur + ") records=" + (r2 && r2.amount) + " summary=" + d2.summaryText);
  }

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 4000));
  await mini.disconnect();
})().catch((e) => { console.error("R1 FATAL:", e.message, e.stack); process.exit(1); });
