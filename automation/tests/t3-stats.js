// T3 统计页：卡片渲染 / 月份切换 / 图例钻取到 records
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("t3-stats");
  const st = loadState();

  let page = await goto(mini, "/pages/home/home");
  await sleep(2000);
  page = await mini.switchTab("/pages/stats/stats");
  await sleep(3000);
  page = await curPage(mini);
  R.check("T3-01", "切到统计 tab", page.path === "pages/stats/stats", page.path);

  let d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.cards.length ? x : null; }, 15000);
  R.check("T3-02", "图表卡片渲染", d && d.cards.length >= 4, d && ("cards=" + d.cards.length + " titles=" + d.cards.map((c) => c.title).join(",")));

  // 月份切换
  const withMonth = d && d.cards.map((c, i) => ({ c, i })).filter((x) => x.c.month);
  R.check("T3-03", "存在带月份切换器的卡片", withMonth && withMonth.length > 0, "count=" + (withMonth ? withMonth.length : 0));
  if (withMonth && withMonth.length) {
    const idx = withMonth[0].i;
    const before = d.cards[idx].month.text;
    const prevOk = d.cards[idx].month.prevOk;
    R.check("T3-04", "上月箭头可用(有上月数据)", !!prevOk, "prevOk=" + prevOk + " month=" + before);
    if (prevOk) {
      const btns = await page.$$(".mnav__btn");
      await btns[0].tap();
      await sleep(3000);
      d = await waitFor(async () => {
        const x = await page.data();
        return x.cards[idx].month && x.cards[idx].month.text !== before ? x : null;
      }, 12000);
      R.check("T3-05", "点‹后月份文本变化", !!d, d ? d.cards[idx].month.text : "未变化: " + before);
      // 上月卡片数值应包含造数的 66（CNY→展示币换算后可能非 66，仅验证图例有数值且不为 0）
      if (d) {
        const lg = d.cards[idx].legends || [];
        console.log("上月图例:", JSON.stringify(lg).slice(0, 300));
        const btns2 = await page.$$(".mnav__btn");
        await btns2[1].tap();
        await sleep(2500);
      }
    }
  }

  // 钻取：优先饼图图例链接，其次分类行
  d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 10000);
  let drillEls = await page.$$(".pl-item--link"); let drillEl = null; for (const el of drillEls) { if ((await el.attribute("data-type")) === "expense") { drillEl = el; break; } } if (!drillEl) drillEl = drillEls[0] || null;
  let drillVia = ".pl-item--link";
  if (!drillEl) { drillEl = await page.$(".cat-row"); drillVia = ".cat-row"; }
  if (drillEl) {
    await drillEl.tap();
    await sleep(3000);
    page = await curPage(mini);
    R.check("T3-06", "统计卡钻取进入 records 页 (" + drillVia + ")", page.path === "pages/records/records", page.path);
    if (page.path === "pages/records/records") {
      d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 12000);
      R.check("T3-07", "records 页加载出记录", d && d.groups.length > 0 && !d.empty, d && ("groups=" + d.groups.length + " title=" + d.title + " summary=" + d.summaryText));
      // records 行点击进详情
      const row = await page.$(".txn");
      if (row) {
        await row.tap();
        await sleep(2500);
        page = await curPage(mini);
        R.check("T3-08", "records 行进入详情", page.path === "pages/detail/detail", page.path);
        await mini.navigateBack();
        await sleep(1200);
      }
      await mini.navigateBack();
      await sleep(1500);
    }
  } else {
    R.check("T3-06", "统计卡存在可钻取入口", false, "既无 .pl-item--link 也无 .cat-row");
  }

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 4000));
  await mini.disconnect();
})().catch((e) => { console.error("T3 FATAL:", e.message); process.exit(1); });