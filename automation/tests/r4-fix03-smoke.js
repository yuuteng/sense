// R4 FIX-03 复测 + 全页面冒烟回归（对齐 report/smoke-report.json 的 18 页清单）
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage, REPORT_DIR } = require("./lib");
const fs = require("fs");
const path = require("path");

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("r4-fix03-smoke");
  const st = loadState();
  const bookId = st.retestBookId;

  // ===== FIX-03：设置页「默认展示币种」作用范围说明 =====
  let page = await goto(mini, "/pages/settings/settings");
  let d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.profile ? x : null; }, 20000);
  const sub = await page.$(".li__val--sub");
  let subText = "", subSize = null;
  const subs = await page.$$(".li__val--sub");
  const texts = [];
  for (const el of subs) { try { texts.push(await el.text()); } catch (e) { /* ignore */ } }
  const hit = texts.find((t) => t && t.indexOf("\u4ec5\u5f71\u54cd") >= 0);
  R.check("R4-01", "设置页出现作用范围说明「仅影响未单独设置币种的账本」",
    hit === "\u4ec5\u5f71\u54cd\u672a\u5355\u72ec\u8bbe\u7f6e\u5e01\u79cd\u7684\u8d26\u672c", "找到的子行文案=" + JSON.stringify(texts));

  // 排版：说明行不得被 ellipsis 截断（.li__val--sub 有 nowrap + max-width:420rpx）
  let subW = -1, maxW = -1;
  for (const el of subs) {
    try { const t = await el.text(); if (t && t.indexOf("\u4ec5\u5f71\u54cd") >= 0) { const sz = await el.size(); subW = sz.width; } } catch (e) { /* ignore */ }
  }
  R.check("R4-02", "说明行实际宽度未触及 max-width(420rpx=210px)，无省略号截断", subW > 0 && subW < 210,
    "实测宽度=" + subW + "px (阈值 210px)");

  // 行高与点击行为
  const curRow = await page.$(".li");
  let rowH = -1;
  try { const rows = await page.$$(".li"); for (const r of rows) { const t = await r.text(); if (t && t.indexOf("\u9ed8\u8ba4\u5c55\u793a\u5e01\u79cd") >= 0) { rowH = (await r.size()).height; break; } } } catch (e) { /* ignore */ }
  R.check("R4-03", "该行行高自然增高未裁剪(>=52px 即 104rpx 最小高)", rowH >= 52, "实测行高=" + rowH + "px");
  await page.callMethod("openCur");
  await sleep(1200);
  d = await page.data();
  R.check("R4-04", "点击行为未变：仍能打开币种选择器", !!d.curVisible, "curVisible=" + d.curVisible);
  await page.callMethod("closeCur");
  await sleep(500);
  const sBefore = await apiCall(mini, "settings", "get", {});
  R.check("R4-05", "纯文案改动未带来行为变化：全局默认展示币种读取正常", sBefore.success && !!sBefore.data.displayCurrency,
    "displayCurrency=" + (sBefore.success && sBefore.data.displayCurrency));

  // ===== 全页面冒烟回归：18 页 =====
  const rec = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true });
  let recId = "";
  ((rec.success && rec.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => { if (!recId) recId = i.recordId; }));
  const now = new Date();
  const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");

  const PAGES = [
    ["pages/home/home", "/pages/home/home"],
    ["pages/stats/stats", "/pages/stats/stats"],
    ["pages/ai/ai", "/pages/ai/ai"],
    ["pages/settings/settings", "/pages/settings/settings"],
    ["pages/add/add", "/pages/add/add"],
    ["pages/detail/detail", "/pages/detail/detail?id=" + recId],
    ["pages/records/records", "/pages/records/records?bookId=" + bookId + "&dateFrom=" + ym + "-01&dateTo=" + ym + "-28"],
    ["pages/books/books", "/pages/books/books"],
    ["pages/bookConfig/bookConfig", "/pages/bookConfig/bookConfig?bookId=" + bookId],
    ["pages/export/export", "/pages/export/export"],
    ["pages/onboarding/onboarding", "/pages/onboarding/onboarding"],
    ["pages/settle/settle", "/pages/settle/settle?bookId=" + bookId],
    ["pages/join/join", "/pages/join/join?bookId=" + bookId + "&role=rw"],
    ["pages/feedback/feedback", "/pages/feedback/feedback"],
    ["pages/feedback-new/feedback-new", "/pages/feedback-new/feedback-new"],
    ["pages/feedback-detail/feedback-detail", "/pages/feedback-detail/feedback-detail"],
    ["pages/feedback-team/feedback-team", "/pages/feedback-team/feedback-team"],
    ["pages/privacy/privacy", "/pages/privacy/privacy"],
  ];
  const smoke = [];
  for (const entry of PAGES) {
    const want = entry[0], url = entry[1];
    const before = errors.length;
    let ok = false, detail = "", keys = [];
    try {
      const p = await goto(mini, url);
      await sleep(1800);
      const cp = await curPage(mini);
      ok = cp.path === want;
      detail = cp.path;
      try { const pd = await cp.data(); keys = Object.keys(pd || {}); } catch (e) { detail += " (data 读取失败: " + e.message + ")"; }
    } catch (e) { ok = false; detail = "打开失败: " + e.message; }
    const newErrs = errors.slice(before);
    smoke.push({ page: want, ok, detail, dataKeys: keys, errors: newErrs });
    R.check("R4-S-" + want.split("/")[1], "冒烟 " + want, ok && newErrs.length === 0,
      detail + (newErrs.length ? " | 新增报错 " + JSON.stringify(newErrs).slice(0, 300) : ""));
  }
  fs.writeFileSync(path.join(REPORT_DIR, "smoke-report-retest.json"),
    JSON.stringify({ at: new Date().toISOString(), pages: smoke }, null, 2));
  const failed = smoke.filter((s) => !s.ok);
  R.check("R4-06", "18 页全部可打开且无 console 报错", smoke.length === 18 && failed.length === 0 && errors.length === 0,
    "总页数=" + smoke.length + " 失败=" + failed.length + " console 报错总数=" + errors.length +
    (failed.length ? " 失败页=" + failed.map((f) => f.page + "(" + f.detail + ")").join("; ") : ""));

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 5000));
  await mini.disconnect();
})().catch((e) => { console.error("R4 FATAL:", e.message, e.stack); process.exit(1); });
