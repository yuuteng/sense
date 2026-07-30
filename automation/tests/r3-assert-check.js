// R3 核对两条可疑失败是否为用例自身缺陷：R2-00(汇总条空格字符) / R2-13(编辑金额断言写错)
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto } = require("./lib");

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("r3-assert-check");
  const st = loadState();
  const bookId = st.retestBookId;

  const now = new Date();
  const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const lastD = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const page = await goto(mini, "/pages/records/records?bookId=" + bookId + "&dateFrom=" + ym + "-01&dateTo=" + ym + "-" + lastD + "&type=expense");
  const d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
  const s = d.summaryText || "";
  const codes = Array.from(s).map((ch) => ch + ":U+" + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0"));
  console.log("summaryText raw   :", JSON.stringify(s));
  console.log("summaryText codes :", codes.join(" "));
  const hasKr = s.indexOf("kr") >= 0;
  const hasYen = s.indexOf("\u00a5") >= 0;
  const nbsp = s.indexOf("\u00a0") >= 0;
  R.check("R3-01", "汇总条含 kr、不含 ¥（展示币种正确）", hasKr && !hasYen,
    "hasKr=" + hasKr + " hasYen=" + hasYen + " 含不换行空格U+00A0=" + nbsp);
  R.check("R3-02", "R2-00/R1-10 的失败原因 = 金额与币种间是不换行空格 U+00A0，正则用普通空格匹配不到（用例缺陷，非产品问题）",
    nbsp, "nbsp=" + nbsp);

  // 行金额同样核对
  const row = ((d.groups[0] || {}).items || [])[0];
  console.log("row amount raw:", JSON.stringify(row && row.amount));

  // R2-13：确认编辑后的金额确实是 2.99
  const lst = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true });
  const all = [];
  ((lst.success && lst.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => all.push(i)));
  const edited = all.filter((i) => Math.abs(i.originalAmount - 2.99) < 0.001);
  const stale = all.filter((i) => Math.abs(i.originalAmount - 2.22) < 0.001);
  console.log("ALL originalAmounts:", JSON.stringify(all.map((i) => i.originalAmount)));
  R.check("R3-03", "编辑生效：存在 2.99 的记录且不存在旧值 2.22 的记录", edited.length === 1 && stale.length === 0,
    "2.99 笔数=" + edited.length + " 2.22 笔数=" + stale.length);
  const det = await apiCall(mini, "record", "get", { recordId: edited.length ? edited[0].recordId : all[0].recordId });
  console.log("record.get keys:", det.success ? Object.keys(det.data).join(",") : JSON.stringify(det));
  R.check("R3-04", "R2-13 的失败原因 = 我的三元表达式运算符优先级写错且读了不存在的字段（用例缺陷，非产品问题）",
    det.success && det.data.originalAmount === undefined, "record.get.originalAmount=" + (det.success ? JSON.stringify(det.data.originalAmount) : "?"));

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 2000));
  await mini.disconnect();
})().catch((e) => { console.error("R3 FATAL:", e.message, e.stack); process.exit(1); });
