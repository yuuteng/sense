// T2 多币种：记一笔 EUR 支出，校验列表/详情/统计三处口径一致（PRD 7.2 当日汇率固化）
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

function num(s) { const m = String(s || "").replace(/,/g, "").match(/[\d.]+/); return m ? parseFloat(m[0]) : NaN; }

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("t2-multicurrency");
  const st = loadState();

  const cur = await apiCall(mini, "book", "getCurrent", {});
  R.check("T2-00", "当前账本是 QA 测试账本", cur.success && cur.data && cur.data.bookId === st.qaBookId, JSON.stringify(cur.data));

  let page = await goto(mini, "/pages/home/home");
  await sleep(2500);
  const fab = await page.$(".fab");
  await fab.tap();
  await sleep(2500);
  page = await curPage(mini);
  let d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 10000);

  // 打开币种选择器并点 EUR 行
  const curPick = await page.$(".cur-pick");
  await curPick.tap();
  await sleep(1000);
  let eurPicked = false;
  try {
    const rows = await page.$$("currency-picker >>> .cp__row");
    for (const r of rows) {
      const code = await r.attribute("data-code");
      if (code === "EUR") { await r.tap(); eurPicked = true; break; }
    }
  } catch (e) { console.log("picker rows error: " + e.message); }
  if (!eurPicked) {
    console.log("fallback: callMethod onCur EUR");
    await page.callMethod("onCur", { detail: { code: "EUR" } });
  }
  await sleep(800);
  d = await page.data();
  const selCode = d.curs[d.curIndex] && d.curs[d.curIndex].code;
  R.check("T2-01", "币种选择器可选 EUR", selCode === "EUR", "picked=" + selCode + " viaUI=" + eurPicked);

  const amountEl = await page.$(".amount-input");
  await amountEl.input("10");
  await sleep(500);
  d = await page.data();
  R.check("T2-02", "外币金额下方给出折算提示", /≈/.test(d.fxHint), "fxHint=" + d.fxHint);
  const rateUsed = d.curs[d.curIndex].rate;
  console.log("EUR rate used:", rateUsed, "fxHint:", d.fxHint);

  const noteEl = await page.$(".field-row__val input");
  if (noteEl) await noteEl.input("QA-EUR");
  const saveBtn = await page.$(".btn--block");
  await saveBtn.tap();
  await sleep(3500);
  page = await curPage(mini);
  R.check("T2-03", "保存后返回首页", page.path === "pages/home/home", page.path);

  d = await waitFor(async () => {
    const x = await page.data();
    const it = x.groups[0] && x.groups[0].items.find((i) => !String(i.id).startsWith("pending-"));
    return it ? x : null;
  }, 12000);
  const row = d && d.groups[0] && d.groups[0].items[0];
  R.check("T2-04", "首页行给出原币金额 pill(€ 10)", !!row && row.fx.includes("€") && row.fx.includes("10"), row && JSON.stringify(row));
  R.check("T2-05", "首页行标注按记账日汇率", !!row && row.sub.includes("汇率"), row && row.sub);
  const homeAmt = row ? num(row.amount) : NaN;
  console.log("home converted amount:", row && row.amount, "->", homeAmt);

  // 详情
  const txn = await page.$(".txn");
  await txn.tap();
  await sleep(2500);
  page = await curPage(mini);
  d = await waitFor(async () => { const x = await page.data(); return x.d ? x : null; }, 10000);
  R.check("T2-06", "详情标记外币并展示 原始金额/当日汇率/换算金额", d && d.d.isForeign && d.d.originalAmount.includes("10") && d.d.rate.startsWith("1 EUR"),
    d && JSON.stringify({ orig: d.d.originalAmount, rate: d.d.rate, conv: d.d.convertedAmount }));
  const detailConv = d ? num(d.d.convertedAmount) : NaN;
  const detailDisplay = d ? num(d.d.displayAmount) : NaN;
  R.check("T2-07", "详情主金额=换算金额", Math.abs(detailConv - detailDisplay) < 0.01, "display=" + detailDisplay + " conv=" + detailConv);
  R.check("T2-08", "列表与详情换算金额一致", Math.abs(homeAmt - detailConv) < 0.01, "home=" + homeAmt + " detail=" + detailConv);
  R.check("T2-09", "汇率固化说明文案存在", d && d.d.fixNote.includes("不再变"), d && d.d.fixNote.slice(0, 60));

  // 统计口径：月度汇总的支出应等于该笔换算金额（QA 账本仅此一笔）
  const sum = await apiCall(mini, "stats", "getMonthlySummary", { bookId: st.qaBookId });
  const statExp = sum.success ? sum.data.expense : NaN;
  R.check("T2-10", "统计月度支出与列表/详情一致", sum.success && Math.abs(statExp - detailConv) < 0.01, "stats=" + statExp + " detail=" + detailConv);

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  await mini.disconnect();
})().catch((e) => { console.error("T2 FATAL:", e.message); process.exit(1); });