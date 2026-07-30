// T6 AI 页(仅 UI，不发消息) + 设置页各入口 + 展示币种切换器
// 安全红线：绝不触发 onSend / resetData / deleteAccount / purgeTestData / clearSeed / initSeed
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("t6-ai-settings");
  const st = loadState();

  // ===== 补测 T5 遗漏：账本列表行真实选择器 .li 可点进配置页 =====
  let page = await goto(mini, "/pages/books/books");
  await waitFor(async () => { const x = await page.data(); return x.books && x.books.length ? x : null; }, 15000);
  const li = await page.$(".li");
  if (li) { await li.tap(); await sleep(2800); }
  page = await curPage(mini);
  R.check("T6-00", "账本列表行(.li)点击进入账本配置页", page.path === "pages/bookConfig/bookConfig", page.path);

  // ===== AI 页 =====
  page = await goto(mini, "/pages/ai/ai");
  let d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
  R.check("T6-01", "AI 页加载完成并绑定当前账本", !!(d && d.currentBookId === st.qaBookId), "bookId=" + (d && d.currentBookId) + " bookName=" + (d && d.bookName));
  R.check("T6-02", "AI 页顶栏显示展示币种胶囊", !!(d && d.curCode), "curCode=" + (d && d.curCode) + " sym=" + (d && d.curSym));

  const input = await page.$(".composer__input");
  R.check("T6-03", "输入框存在", !!input);
  if (input) {
    await input.input("QA 只测输入不发送");
    await sleep(800);
    d = await page.data();
  }
  R.check("T6-04", "输入框可输入且双向绑定到 data.input", d && d.input === "QA 只测输入不发送", "input=" + JSON.stringify(d && d.input));

  const sendBtn = await page.$(".composer__send");
  R.check("T6-05", "发送按钮存在(不点击)", !!sendBtn);
  const micGone = await page.$(".composer__mic");
  R.check("T6-06", "有文字时语音按钮隐藏", !micGone, micGone ? "mic 仍在" : "已隐藏");

  // 起手示例只填输入框、不发起请求
  const msgCount0 = (d.messages || []).length;
  if (!msgCount0) {
    const starter = await page.$(".ai-starter__row");
    if (starter) { await starter.tap(); await sleep(1000); }
    d = await page.data();
    R.check("T6-07", "点起手示例只填入输入框、不发送", !!d.input && (d.messages || []).length === 0,
      "input=" + JSON.stringify(d.input) + " messages=" + (d.messages || []).length);
  } else {
    R.check("T6-07", "历史消息区渲染(已有会话，跳过起手示例)", true, "messages=" + msgCount0);
  }

  // 历史区渲染能力：ai.listMessages 通路可用
  const msgs = await apiCall(mini, "ai", "listMessages", { bookId: st.qaBookId });
  R.check("T6-08", "历史消息接口可用(历史区数据源)", msgs.success, "count=" + (msgs.success ? msgs.data.length : JSON.stringify(msgs).slice(0, 120)));
  const quota = await apiCall(mini, "ai", "quota", {});
  R.check("T6-09", "AI 额度接口可用", quota.success, JSON.stringify(quota.data || quota).slice(0, 150));

  // 清掉输入框，避免残留
  if (input) { await input.input(""); await sleep(300); }

  // AI 页币种切换器可打开（只开不选，避免改状态）
  const curPill = await page.$(".cur-pill");
  if (curPill) { await curPill.tap(); await sleep(1200); }
  d = await page.data();
  R.check("T6-10", "AI 页展示币种切换器可打开", !!(d && d.curVisible), "curVisible=" + (d && d.curVisible));
  await page.callMethod("closeCurPicker");
  await sleep(500);

  // ===== 设置页 =====
  page = await goto(mini, "/pages/settings/settings");
  d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.profile ? x : null; }, 20000);
  R.check("T6-11", "设置页加载用户资料", !!(d && d.profile && d.profile.nickname), JSON.stringify(d && { nick: d.profile.nickname, books: d.profile.bookCount, cur: d.curLabel }));
  R.check("T6-12", "设置页显示默认展示币种", !!(d && d.curCode && d.curLabel), "curCode=" + (d && d.curCode) + " label=" + (d && d.curLabel));
  const GLOBAL_CUR_BEFORE = d && d.curCode;

  // 展示币种切换器（设置页 = 全局默认）：改成 USD 再改回，校验 book 级覆盖不被冲掉
  await page.callMethod("openCur");
  await sleep(1200);
  d = await page.data();
  R.check("T6-13", "设置页币种切换器可打开", !!(d && d.curVisible), "curVisible=" + (d && d.curVisible));
  let picked = false;
  try {
    const rows = await page.$$("currency-picker >>> .cp__row");
    for (const r of rows) { const c = await r.attribute("data-code"); if (c === "USD") { await r.tap(); picked = true; break; } }
  } catch (e) { console.log("cp rows: " + e.message); }
  if (!picked) await page.callMethod("onCur", { detail: { code: "USD" } });
  await sleep(3000);
  d = await page.data();
  R.check("T6-14", "选 USD 后设置页胶囊更新为 USD", d && d.curCode === "USD", "curCode=" + (d && d.curCode) + " label=" + (d && d.curLabel) + " viaUI=" + picked);
  const sGet = await apiCall(mini, "settings", "get", {});
  R.check("T6-15", "全局默认展示币种已落库", sGet.success && sGet.data.displayCurrency === "USD", JSON.stringify(sGet.data || sGet));
  const gcAfter = await apiCall(mini, "book", "getCurrent", {});
  R.check("T6-16", "改全局默认不覆盖账本级展示币种(QA 账本仍 ISK)", gcAfter.success && gcAfter.data.displayCurrency === "ISK",
    "bookDisplay=" + (gcAfter.success && gcAfter.data.displayCurrency));
  // 还原全局默认
  await page.callMethod("onCur", { detail: { code: GLOBAL_CUR_BEFORE || "CNY" } });
  await sleep(2500);
  const sBack = await apiCall(mini, "settings", "get", {});
  R.check("T6-17", "全局默认展示币种已还原", sBack.success && sBack.data.displayCurrency === (GLOBAL_CUR_BEFORE || "CNY"),
    "now=" + (sBack.success && sBack.data.displayCurrency) + " before=" + GLOBAL_CUR_BEFORE);

  // 各安全入口可打开（跳过全部危险项）
  const navs = [
    ["T6-18", "账本管理入口", "goBooks", "pages/books/books"],
    ["T6-19", "导出数据入口", "onExport", "pages/export/export"],
    ["T6-20", "意见反馈入口", "goFeedback", "pages/feedback/feedback"],
    ["T6-21", "隐私说明入口", "goPrivacy", "pages/privacy/privacy"],
  ];
  for (const [id, desc, method, want] of navs) {
    page = await goto(mini, "/pages/settings/settings");
    await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 15000);
    await page.callMethod(method);
    await sleep(3000);
    const p2 = await curPage(mini);
    let ok = p2.path === want;
    let detail = p2.path;
    if (ok) {
      const pd = await waitFor(async () => { const x = await p2.data(); return x && !x.loading ? x : null; }, 12000);
      if (!pd) detail += " (进入了但 loading 未结束)";
      ok = !!pd;
    }
    R.check(id, desc + "可打开且加载完成", ok, detail);
  }

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 4000));
  await mini.disconnect();
})().catch((e) => { console.error("T6 FATAL:", e.message, e.stack); process.exit(1); });
