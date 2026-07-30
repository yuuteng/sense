// U6 决定二: 删掉设置页「默认展示币种」—— 验收 1/3/4/5/6/7 + 顶栏胶囊 4 页
const { connect, apiCall, loadState, saveState, makeRecorder, waitFor, goto, curPage, sleep } = require("./lib");
const ICE = "9cef38726a522d5f008ef25d7a291933";
const DEMO_SHARE = "seed-book-share-floeovmie8";
const DEMO_SPLIT = "seed-book-split-floeovmie8";

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("u6-partA");
  const st = loadState();

  // ===== 验收 4: settings.get 不含 displayCurrency =====
  const sg = await apiCall(mini, "settings", "get", {});
  R.check("U6-01", "验收4 settings.get 返回体不含 displayCurrency",
    sg.success && !("displayCurrency" in sg.data), "返回体=" + JSON.stringify(sg.data));

  // ===== 验收 5: settings.update 不带 bookId -> 不报错且不改口径 =====
  const iceBefore = await apiCall(mini, "book", "getCurrent", {});
  await apiCall(mini, "book", "setDefault", { bookId: ICE });
  await sleep(900);
  const b0 = await apiCall(mini, "book", "getCurrent", {});
  const upd = await apiCall(mini, "settings", "update", { displayCurrency: "JPY" });
  R.check("U6-02", "验收5 settings.update 不带 bookId 不报错(老客户端兼容)", !!upd.success,
    JSON.stringify(upd).slice(0, 200));
  await sleep(900);
  const b1 = await apiCall(mini, "book", "getCurrent", {});
  R.check("U6-03", "验收5 该调用未改变任何账本口径", b1.success && b0.success && b1.data.displayCurrency === b0.data.displayCurrency,
    "调用前 display=" + (b0.success && b0.data.displayCurrency) + " 调用后=" + (b1.success && b1.data.displayCurrency));
  const sg2 = await apiCall(mini, "settings", "get", {});
  R.check("U6-04", "验收5 也未写出全局 displayCurrency 字段", sg2.success && !("displayCurrency" in sg2.data),
    "返回体=" + JSON.stringify(sg2.data));

  // ===== 验收 6: 冰岛(已设 CNY 覆盖) 口径不变 =====
  R.check("U6-05", "验收6 冰岛 base=EUR 但因有账本级覆盖仍显示 CNY",
    b1.success && b1.data.baseCurrency === "EUR" && b1.data.displayCurrency === "CNY",
    "base=" + (b1.success && b1.data.baseCurrency) + " display=" + (b1.success && b1.data.displayCurrency));

  // ===== 验收 7: 演示账本按其基准币显示(seed 未把字段种回来) =====
  const bl = await apiCall(mini, "book", "list", {});
  for (const [id, label] of [[DEMO_SHARE, "家庭演示账本"], [DEMO_SPLIT, "旅行分账演示"]]) {
    await apiCall(mini, "book", "setDefault", { bookId: id });
    await sleep(900);
    const g = await apiCall(mini, "book", "getCurrent", {});
    const okv = g.success && g.data.bookId === id;
    console.log(label, "base=" + (g.success && g.data.baseCurrency), "display=" + (g.success && g.data.displayCurrency));
    if (label === "\u5bb6\u5ead\u6f14\u793a\u8d26\u672c") {
      R.check("U6-06", "验收7 家庭演示账本按其基准币 CNY 显示", okv && g.data.displayCurrency === g.data.baseCurrency,
        "base=" + g.data.baseCurrency + " display=" + g.data.displayCurrency);
    }
  }

  // ===== 验收 3 / TODO-4: 新建 base=EUR 账本 -> 首页立即显示 EUR, 无需手动改胶囊 =====
  const cr = await apiCall(mini, "book", "create", { name: "QA三批EUR", baseCurrency: "EUR", bookType: "share" });
  const eurBook = cr.success ? cr.data.bookId : null;
  saveState({ b3EurBook: eurBook });
  const ge = await apiCall(mini, "book", "getCurrent", {});
  R.check("U6-07", "验收3 新建 base=EUR 账本, 服务端口径立即为 EUR(不再被全局 CNY 遮蔽)",
    !!eurBook && ge.success && ge.data.bookId === eurBook && ge.data.displayCurrency === "EUR",
    "base=" + (ge.success && ge.data.baseCurrency) + " display=" + (ge.success && ge.data.displayCurrency));
  let page = await goto(mini, "/pages/home/home");
  let d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
  R.check("U6-08", "验收3 首页顶栏胶囊直接显示 EUR 符号(无需手动改)",
    !!d && d.curCode === "EUR" && d.curSym === "\u20ac", "curCode=" + (d && d.curCode) + " curSym=" + (d && d.curSym));

  // 新建 base=ISK 账本 -> 显示 kr
  const cr2 = await apiCall(mini, "book", "create", { name: "QA三批ISK", baseCurrency: "ISK", bookType: "split" });
  const iskBook = cr2.success ? cr2.data.bookId : null;
  saveState({ b3IskBook: iskBook });
  page = await goto(mini, "/pages/home/home");
  d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
  R.check("U6-09", "验收5(spec) 新建 base=ISK 账本首页显示 kr(不再 CNY)",
    !!d && d.curCode === "ISK" && d.curSym === "kr", "curCode=" + (d && d.curCode) + " curSym=" + (d && d.curSym));

  // ===== 验收 1: 设置页无该行、无残留空隙、其余入口正常 =====
  page = await goto(mini, "/pages/settings/settings");
  d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.profile ? x : null; }, 20000);
  R.check("U6-10", "验收1 设置页 data 中已无 curCode / curLabel / curVisible",
    !("curCode" in d) && !("curLabel" in d) && !("curVisible" in d),
    "data keys=" + Object.keys(d).join(","));
  const titles = [];
  for (const el of await page.$$(".group__title")) { try { titles.push(await el.text()); } catch (e) {} }
  R.check("U6-11", "验收1 「偏好」分组已整组移除", !titles.some((t) => t && t.indexOf("\u504f\u597d") >= 0),
    "现存分组=" + JSON.stringify(titles));
  // 无残留空隙: 每个 .group 里都必须至少有一个 .li
  const groups = await page.$$(".group");
  let emptyGroups = 0;
  for (const g of groups) { const lis = await g.$$(".li"); if (!lis || lis.length === 0) emptyGroups++; }
  R.check("U6-12", "验收1 无空的 .group 容器(无残留空隙)", emptyGroups === 0,
    ".group 数=" + groups.length + " 空组数=" + emptyGroups);
  const picker = await page.$("currency-picker");
  R.check("U6-13", "验收1 currency-picker 组件实例已从设置页移除", !picker, picker ? "仍存在" : "已移除");

  // 其余入口可点、跳转正确
  const navs = [["U6-14", "分类管理/账本管理", "goBooks", "pages/books/books"],
                ["U6-15", "导出数据", "onExport", "pages/export/export"],
                ["U6-16", "意见反馈", "goFeedback", "pages/feedback/feedback"],
                ["U6-17", "隐私说明", "goPrivacy", "pages/privacy/privacy"]];
  for (const [id, label, method, want] of navs) {
    page = await goto(mini, "/pages/settings/settings");
    await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 15000);
    await page.callMethod(method);
    await sleep(2800);
    const p2 = await curPage(mini);
    let ok = p2.path === want;
    if (ok) { const pd = await waitFor(async () => { const x = await p2.data(); return x && !x.loading ? x : null; }, 12000); ok = !!pd; }
    R.check(id, "验收1 " + label + " 入口可打开且加载完成", ok, p2.path);
  }

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("U6 FATAL:", e.message, e.stack); process.exit(1); });
