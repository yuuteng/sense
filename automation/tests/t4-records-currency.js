// T4 records 页展示币种口径：钻取落地页金额是否与首页一致（PRD 7.2 / CLAUDE.md 展示币种规则）
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

function num(s) { const m = String(s || "").replace(/,/g, "").match(/[\d.]+/); return m ? parseFloat(m[0]) : NaN; }
function sym(s) { const m = String(s || "").match(/[^\d\s,.\-+]+/); return m ? m[0] : ""; }

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("t4-records-currency");
  const st = loadState();

  // 0) 前置：当前账本 = QA 账本，展示币种 ISK / 基准 CNY
  const cur = await apiCall(mini, "book", "getCurrent", {});
  const bk = cur.success ? cur.data : {};
  R.check("T4-00", "当前账本=QA 账本 且展示币种!=基准币种", bk.bookId === st.qaBookId && bk.displayCurrency && bk.displayCurrency !== bk.baseCurrency,
    JSON.stringify({ bookId: bk.bookId, name: bk.name, display: bk.displayCurrency, base: bk.baseCurrency }));
  const DISP = bk.displayCurrency, BASE = bk.baseCurrency;

  // 1) 首页金额（基准答案）
  let page = await goto(mini, "/pages/home/home");
  let d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.groups && x.groups.length ? x : null; }, 15000);
  const homeRow = d && d.groups[0] && d.groups[0].items[0];
  const homeAmt = homeRow ? num(homeRow.amount) : NaN;
  const homeSym = homeRow ? sym(homeRow.amount) : "";
  R.check("T4-01", "首页行按展示币种显示", !!homeRow, "curCode=" + (d && d.curCode) + " amount=" + (homeRow && homeRow.amount));
  console.log("HOME:", JSON.stringify({ curCode: d && d.curCode, amount: homeRow && homeRow.amount, fx: homeRow && homeRow.fx }));

  // 2) 服务端两种调法对比：不传 currency（records 页做法） vs 传 currency（首页做法）
  const noCur = await apiCall(mini, "record", "list", { bookId: st.qaBookId, page: 0, withSummary: true });
  const withCur = await apiCall(mini, "record", "list", { bookId: st.qaBookId, page: 0, withSummary: true, currency: DISP });
  const a = noCur.success ? noCur.data : {}, b = withCur.success ? withCur.data : {};
  console.log("API no-currency :", JSON.stringify({ displayCurrency: a.displayCurrency, summary: a.summary, item0: a.groups && a.groups[0] && a.groups[0].items[0] && a.groups[0].items[0].amountConverted }));
  console.log("API w/ currency :", JSON.stringify({ displayCurrency: b.displayCurrency, summary: b.summary, item0: b.groups && b.groups[0] && b.groups[0].items[0] && b.groups[0].items[0].amountConverted }));
  R.check("T4-02", "record.list 不传 currency 时应仍按用户展示币种解析(displayCurrencyOf)", a.displayCurrency === DISP,
    "expect=" + DISP + " actual=" + a.displayCurrency);
  R.check("T4-03", "record.list 不传 currency 时金额应按展示币种换算", a.summary && b.summary && Math.abs(a.summary.expense - b.summary.expense) < 0.01,
    "noCur.expense=" + (a.summary && a.summary.expense) + " withCur.expense=" + (b.summary && b.summary.expense));

  // 3) 前端：真实钻取路径（stats 卡片 → records）
  const now = new Date();
  const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const url = "/pages/records/records?bookId=" + st.qaBookId + "&dateFrom=" + ym + "-01&dateTo=" + ym + "-" + last
    + "&type=expense&monthText=" + encodeURIComponent(now.getFullYear() + "年" + (now.getMonth() + 1) + "月");
  page = await goto(mini, url);
  d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 15000);
  const recRow = d && d.groups && d.groups[0] && d.groups[0].items[0];
  const recAmt = recRow ? num(recRow.amount) : NaN;
  const recSym = recRow ? sym(recRow.amount) : "";
  console.log("RECORDS:", JSON.stringify({ summaryText: d && d.summaryText, amount: recRow && recRow.amount, fx: recRow && recRow.fx, groupTotal: d && d.groups[0] && d.groups[0].total }));

  R.check("T4-04", "records 页行金额币种符号与首页一致", recSym === homeSym, "home=" + homeSym + "(" + (homeRow && homeRow.amount) + ") records=" + recSym + "(" + (recRow && recRow.amount) + ")");
  R.check("T4-05", "records 页行金额数值与首页一致", Math.abs(recAmt - homeAmt) < 0.01, "home=" + homeAmt + " records=" + recAmt);
  R.check("T4-06", "records 页汇总条币种与展示币种一致", d && d.summaryText && sym(d.summaryText.split("·").pop()) === homeSym,
    "summaryText=" + (d && d.summaryText) + " expectSym=" + homeSym);
  R.check("T4-07", "records 页外币 pill 判定正确(原币 EUR≠展示币应显示 pill)", !!(recRow && recRow.fx),
    "fx=" + (recRow && recRow.fx) + " sub=" + (recRow && recRow.sub));
  R.check("T4-08", "records 页分组合计币种与展示币种一致", d && d.groups && d.groups[0] && sym(d.groups[0].total) === homeSym,
    "groupTotal=" + (d && d.groups[0] && d.groups[0].total));

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  await mini.disconnect();
})().catch((e) => { console.error("T4 FATAL:", e.message, e.stack); process.exit(1); });
