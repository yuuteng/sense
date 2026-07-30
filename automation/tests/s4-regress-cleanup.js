// S4 FIX-01 口径回归 + 收尾清理 + 独立核验
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");
const sym = (s) => { const m = String(s || "").match(/[^\d\s,.\-+\u2009]+/); return m ? m[0] : ""; };
function norm(r) {
  if (!r.success) return "ERR";
  const d = r.data;
  return JSON.stringify({ dc: d.displayCurrency, sum: d.summary,
    groups: (d.groups || []).map((g) => ({ d: g.date, t: g.total, i: (g.items || []).map((x) => [x.recordId, x.amountConverted, x.isForeign]) })) });
}

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("s4-fix01-regress-cleanup");
  const st = loadState();
  const bookId = st.batch2BookId;
  await apiCall(mini, "book", "setDefault", { bookId });
  await sleep(1200);

  // ===== FIX-01 回归：契约 + 两页一致 =====
  const gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("S4-01", "复测账本 base=CNY / display=ISK", gc.success && gc.data.baseCurrency === "CNY" && gc.data.displayCurrency === "ISK",
    "base=" + (gc.success && gc.data.baseCurrency) + " display=" + (gc.success && gc.data.displayCurrency));
  const a = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true });
  const b = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true, currency: "ISK" });
  const c = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true, currency: "JPY" });
  R.check("S4-02", "契约仍成立：不传 currency 与传 ISK / JPY 返回逐字相等", norm(a) === norm(b) && norm(a) === norm(c),
    "displayCurrency=" + (a.success && a.data.displayCurrency) + " 三者一致=" + (norm(a) === norm(b) && norm(a) === norm(c)));

  // 加一笔 EUR 验外币 pill 两页一致
  let page = await goto(mini, "/pages/add/add");
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  await page.callMethod("onCur", { detail: { code: "EUR" } });
  await sleep(600);
  await page.callMethod("onAmountInput", { detail: { value: "10" } });
  await sleep(500);
  const btn = await page.$(".btn--block");
  await btn.tap();
  await sleep(7000);

  page = await goto(mini, "/pages/home/home");
  let d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.groups && x.groups.length ? x : null; }, 20000);
  const hEur = (d.groups[0].items || []).find((i) => i.fx && /\u20ac/.test(i.fx));
  const hTotal = d.groups[0].total;
  const now = new Date();
  const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  page = await goto(mini, "/pages/records/records?bookId=" + bookId + "&dateFrom=" + ym + "-01&dateTo=" + ym + "-" + last + "&type=expense");
  const d2 = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
  const rEur = ((d2.groups[0] || {}).items || []).find((i) => i.fx && /\u20ac/.test(i.fx));
  console.log("HOME EUR:", JSON.stringify(hEur && { amount: hEur.amount, fx: hEur.fx, sub: hEur.sub }));
  console.log("RECS EUR:", JSON.stringify(rEur && { amount: rEur.amount, fx: rEur.fx, sub: rEur.sub }));
  R.check("S4-03", "EUR 记录首页与 records 页金额/pill/汇率文案逐字一致",
    !!hEur && !!rEur && hEur.amount === rEur.amount && hEur.fx === rEur.fx && hEur.sub === rEur.sub,
    "home=" + JSON.stringify(hEur && [hEur.amount, hEur.fx, hEur.sub]) + " records=" + JSON.stringify(rEur && [rEur.amount, rEur.fx, rEur.sub]));
  R.check("S4-04", "EUR 换算金额与上轮记录逐字一致(-kr 1,431.74)", !!hEur && hEur.amount === "-kr\u20091,431.74",
    "实测=" + JSON.stringify(hEur && hEur.amount) + "（注：币种与数字间为 U+2009 窄空格）");
  R.check("S4-05", "records 页分组合计与首页一致，且汇总条用 kr", d2.groups[0] && d2.groups[0].total === hTotal && /kr/.test(d2.summaryText) && !/\u00a5/.test(d2.summaryText),
    "home total=" + hTotal + " records total=" + (d2.groups[0] && d2.groups[0].total) + " summary=" + d2.summaryText);

  // ===== 收尾清理 =====
  const bl0 = await apiCall(mini, "book", "list", {});
  const targets = (bl0.success ? bl0.data : []).filter((x) => /^QA/.test(x.name));
  R.check("S4-06", "待清理账本全部为 QA*，不含冰岛", targets.every((t) => t.name !== "\u51b0\u5c9b"), JSON.stringify(targets.map((t) => t.name)));
  for (const t of targets) { const r = await apiCall(mini, "book", "dissolve", { bookId: t.bookId }); console.log("dissolve", t.name, JSON.stringify(r).slice(0, 100)); await sleep(1500); }
  await apiCall(mini, "book", "setDefault", { bookId: st.origBookId });
  await sleep(1500);

  // ===== 独立核验（不采信上面清理动作的返回值，重新读真实状态）=====
  const bl = await apiCall(mini, "book", "list", {});
  const books = bl.success ? bl.data : [];
  console.log("book.list:", JSON.stringify(books.map((x) => ({ n: x.name, isDefault: x.isDefault, isCurrent: x.isCurrent }))));
  R.check("S4-07", "账本 4 本且无任何 QA* 账本", books.length === 4 && !books.some((x) => /^QA/.test(x.name)),
    "共 " + books.length + " 本: " + books.map((x) => x.name).join(","));
  const gc2 = await apiCall(mini, "book", "getCurrent", {});
  R.check("S4-08", "当前账本 = 冰岛", gc2.success && gc2.data.bookId === st.origBookId, "current=" + (gc2.success && gc2.data.name));
  const prof = await apiCall(mini, "user", "getProfile", {});
  R.check("S4-09", "用户默认账本(defaultBookId) = 冰岛", prof.success && prof.data.defaultBookName === "\u51b0\u5c9b",
    "defaultBookName=" + (prof.success && prof.data.defaultBookName));
  R.check("S4-10", "冰岛 base=EUR / display=CNY 未被改动",
    gc2.success && gc2.data.baseCurrency === "EUR" && gc2.data.displayCurrency === "CNY",
    "base=" + (gc2.success && gc2.data.baseCurrency) + " display=" + (gc2.success && gc2.data.displayCurrency));
  const sg = await apiCall(mini, "settings", "get", {});
  R.check("S4-11", "全局默认展示币种 = ISK", sg.success && sg.data.displayCurrency === "ISK", "displayCurrency=" + (sg.success && sg.data.displayCurrency));
  const il = await apiCall(mini, "record", "list", { bookId: st.origBookId, page: 0, withSummary: true });
  const g0 = il.success && il.data.groups && il.data.groups[0];
  R.check("S4-12", "冰岛数据完好：首组 2026-07-22 / 5 笔 / 合计 -1047.97 / CNY",
    !!g0 && g0.date === "2026-07-22" && (g0.items || []).length === 5 && Math.abs(g0.total + 1047.97) < 0.01 && il.data.displayCurrency === "CNY",
    "date=" + (g0 && g0.date) + " 笔数=" + (g0 && (g0.items || []).length) + " total=" + (g0 && g0.total) + " dc=" + (il.success && il.data.displayCurrency));

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("S4 FATAL:", e.message, e.stack); process.exit(1); });
