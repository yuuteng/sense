// T7 边界：金额 0 / 超大金额 / 非法字符 / 空备注 / 快速连点保存(重复提交) + 展示币种覆盖优先级
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

function num(s) { const m = String(s || "").replace(/,/g, "").match(/[\d.]+/); return m ? parseFloat(m[0]) : NaN; }

async function countRecords(mini, bookId) {
  const r = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true });
  return r.success && r.data.summary ? r.data.summary.count : -1;
}
async function freshAdd(mini) {
  const page = await goto(mini, "/pages/add/add");
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  return page;
}

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("t7-boundary");
  const st = loadState();

  // ===== 展示币种覆盖优先级（重测 T6-16：先显式写入账本级覆盖）=====
  // QA 账本即将解散，在其上写覆盖值不影响真实数据
  await apiCall(mini, "settings", "update", { displayCurrency: "ISK", bookId: st.qaBookId });
  const sBefore = await apiCall(mini, "settings", "get", {});
  const globalBefore = sBefore.success ? sBefore.data.displayCurrency : "CNY";
  await apiCall(mini, "settings", "update", { displayCurrency: "JPY" }); // 改全局
  const gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("T7-00", "账本级展示币种覆盖优先于全局默认(全局改 JPY，QA 账本仍 ISK)",
    gc.success && gc.data.displayCurrency === "ISK", "bookDisplay=" + (gc.success && gc.data.displayCurrency) + " global=JPY");
  await apiCall(mini, "settings", "update", { displayCurrency: globalBefore }); // 还原全局
  const sAfter = await apiCall(mini, "settings", "get", {});
  R.check("T7-01", "全局默认展示币种已还原", sAfter.success && sAfter.data.displayCurrency === globalBefore,
    "now=" + (sAfter.success && sAfter.data.displayCurrency) + " expect=" + globalBefore);

  // ===== 金额输入清洗 =====
  let page = await freshAdd(mini);
  const cases = [
    ["T7-02", "字母被过滤", "abc", ""],
    ["T7-03", "混合非法字符只留数字与首个小数点", "12ab.3.4x", "12.3"],
    ["T7-04", "逗号归一化成小数点", "12,5", "12.5"],
    ["T7-05", "负号被过滤(不允许负金额)", "-50", "50"],
    ["T7-06", "整数位截断到 9 位", "1234567890123", "123456789"],
    ["T7-07", "小数位截断到 2 位", "1.239", "1.23"],
    ["T7-08", "纯小数点不产生 NaN", ".", "."],
  ];
  for (const [id, desc, input, want] of cases) {
    const got = await page.callMethod("onAmountInput", { detail: { value: input } });
    await sleep(300);
    const d = await page.data();
    R.check(id, "金额输入-" + desc, d.amount === want, "input=" + JSON.stringify(input) + " expect=" + JSON.stringify(want) + " actual=" + JSON.stringify(d.amount) + " fxHint=" + d.fxHint);
  }

  // ===== 金额 0 / 空 不允许保存 =====
  const n0 = await countRecords(mini, st.qaBookId);
  for (const [id, desc, val] of [["T7-09", "金额 0", "0"], ["T7-10", "金额留空", ""], ["T7-11", "金额 0.00", "0.00"]]) {
    page = await curPage(mini);
    if (page.path !== "pages/add/add") page = await freshAdd(mini);
    await page.callMethod("onAmountInput", { detail: { value: val } });
    await sleep(300);
    const btn = await page.$(".btn--block");
    if (btn) await btn.tap();
    await sleep(2500);
    const p2 = await curPage(mini);
    const cnt = await countRecords(mini, st.qaBookId);
    R.check(id, desc + " 被拦截(不入账且停留在记账页)", p2.path === "pages/add/add" && cnt === n0,
      "path=" + p2.path + " countBefore=" + n0 + " countAfter=" + cnt);
  }

  // ===== 超大金额 + 空备注 保存 =====
  page = await freshAdd(mini);
  await page.callMethod("onAmountInput", { detail: { value: "99999999" } });
  await sleep(500);
  let d = await page.data();
  R.check("T7-12", "超大金额有折算提示且不为 NaN/Infinity", !!d.fxHint && !/NaN|Infinity/.test(d.fxHint), "fxHint=" + d.fxHint);
  R.check("T7-13", "备注默认为空(空备注场景)", d.note === "", "note=" + JSON.stringify(d.note));
  const nBig = await countRecords(mini, st.qaBookId);
  let saveBtn = await page.$(".btn--block");
  await saveBtn.tap();
  await sleep(5000);
  page = await curPage(mini);
  const nBig2 = await countRecords(mini, st.qaBookId);
  R.check("T7-14", "超大金额 + 空备注 可保存成功", nBig2 === nBig + 1 && page.path !== "pages/add/add",
    "count " + nBig + "->" + nBig2 + " path=" + page.path);

  // 首页渲染超大金额（不截断成 NaN / 不丢币种符号）
  page = await goto(mini, "/pages/home/home");
  d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.groups && x.groups.length ? x : null; }, 20000);
  const bigRow = (d.groups[0].items || []).find((i) => num(i.amount) >= 99999999);
  R.check("T7-15", "首页正确渲染超大金额(有币种符号、无 NaN)", !!bigRow && !/NaN|Infinity|undefined/.test(bigRow.amount) && /[^\d\s,.\-]/.test(bigRow.amount),
    "amount=" + (bigRow ? bigRow.amount : "未找到该行, first=" + JSON.stringify(d.groups[0].items[0] && d.groups[0].items[0].amount)));
  const sumOk = d.summary && !/NaN|Infinity|undefined/.test(JSON.stringify(d.summary));
  R.check("T7-16", "首页月度概要不因超大金额出现 NaN", !!sumOk, JSON.stringify(d.summary));

  // ===== 快速连点保存：重复提交防护 =====
  page = await freshAdd(mini);
  await page.callMethod("onAmountInput", { detail: { value: "3.21" } });
  await page.callMethod("onNoteInput", { detail: { value: "QA-dblclick" } });
  await sleep(500);
  const nDbl = await countRecords(mini, st.qaBookId);
  saveBtn = await page.$(".btn--block");
  // 连点 3 次，不等待
  const taps = [saveBtn.tap(), saveBtn.tap(), saveBtn.tap()];
  await Promise.all(taps.map((p) => p.catch((e) => console.log("tap err: " + e.message))));
  await sleep(7000);
  const nDbl2 = await countRecords(mini, st.qaBookId);
  R.check("T7-17", "快速连点保存只产生 1 笔(重复提交防护)", nDbl2 === nDbl + 1,
    "count " + nDbl + "->" + nDbl2 + " 新增=" + (nDbl2 - nDbl) + " 笔");

  // 代码级：save() 是否有 in-flight 幂等标志（掩码之外的第二道防线）
  page = await freshAdd(mini);
  await page.callMethod("onAmountInput", { detail: { value: "4.44" } });
  await page.callMethod("onNoteInput", { detail: { value: "QA-concurrent" } });
  await sleep(500);
  const nCc = await countRecords(mini, st.qaBookId);
  await Promise.all([
    page.callMethod("save").catch((e) => console.log("save1: " + e.message)),
    page.callMethod("save").catch((e) => console.log("save2: " + e.message)),
  ]);
  await sleep(7000);
  const nCc2 = await countRecords(mini, st.qaBookId);
  R.check("T7-18", "并发调用 save() 仍只入账 1 笔(代码级幂等)", nCc2 === nCc + 1,
    "count " + nCc + "->" + nCc2 + " 新增=" + (nCc2 - nCc) + " 笔");

  // ===== 空 records 页（空态）=====
  page = await goto(mini, "/pages/records/records?bookId=" + st.qaBookId + "&dateFrom=2001-01-01&dateTo=2001-01-31&monthText=" + encodeURIComponent("2001年1月"));
  d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
  R.check("T7-19", "records 页无数据时进入空态(不报错/不显示脏汇总)", !!(d && d.empty && !d.summaryText && (d.groups || []).length === 0),
    "empty=" + (d && d.empty) + " summaryText=" + JSON.stringify(d && d.summaryText) + " groups=" + ((d && d.groups) || []).length);

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 5000));
  await mini.disconnect();
})().catch((e) => { console.error("T7 FATAL:", e.message, e.stack); process.exit(1); });
