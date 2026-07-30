// S1 FIX-06 复测：syncUnloadGuard 的 4 个场景 + 去重是否恢复
// 手法说明：wx.enableAlertBeforeUnload 触发的是原生确认框，automator 无法点击，
// 故改为 (a) hook 这两个 API 记录调用序列、(b) 读页面实例 _guardOn 真值。
// hook 只记录、不改变行为（内部仍调用原实现）。
const { connect, sleep, apiCall, loadState, saveState, makeRecorder, waitFor, goto, curPage } = require("./lib");

async function hook(mini) {
  await mini.evaluate(() => {
    if (!wx.__qaHooked) {
      const oe = wx.enableAlertBeforeUnload, od = wx.disableAlertBeforeUnload, ot = wx.showToast;
      wx.enableAlertBeforeUnload = function (o) { wx.__qaLog.push({ t: "enable" }); return oe ? oe.call(wx, o) : undefined; };
      wx.disableAlertBeforeUnload = function (o) { wx.__qaLog.push({ t: "disable" }); return od ? od.call(wx, o) : undefined; };
      wx.showToast = function (o) { wx.__qaLog.push({ t: "toast", title: o && o.title }); return ot.call(wx, o); };
      wx.__qaHooked = true;
    }
    wx.__qaLog = [];
    return true;
  });
}
const getLog = (mini) => mini.evaluate(() => wx.__qaLog.slice());
const clearLog = (mini) => mini.evaluate(() => { wx.__qaLog = []; return true; });
const guardOf = (mini) => mini.evaluate(() => {
  const ps = getCurrentPages(); const t = ps[ps.length - 1];
  return { guardOn: t._guardOn, type: typeof t._guardOn, saved: t._saved, saving: t._saving, amount: t.data.amount, note: t.data.note, photos: (t.data.photos || []).length };
});

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("s1-fix06-guard");
  const st = loadState();

  // 前置：建复测账本（注意：book.create 会把新账本设为用户默认账本，收尾会清理并切回冰岛）
  const cr = await apiCall(mini, "book", "create", { name: "QA二批账本", baseCurrency: "CNY", bookType: "share" });
  const bookId = cr.success ? cr.data.bookId : null;
  R.check("S1-00", "建复测账本成功", !!bookId, JSON.stringify(cr).slice(0, 150));
  if (!bookId) { R.save(errors); process.exit(1); }
  saveState({ batch2BookId: bookId });
  await hook(mini);

  // ===== 去重验证（FIX-06 的核心）=====
  let page = await goto(mini, "/pages/add/add");
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  await clearLog(mini);
  for (const v of ["5", "5.", "5.0", "5.01", "5.012"]) { await page.callMethod("onAmountInput", { detail: { value: v } }); await sleep(180); }
  let log = await getLog(mini);
  let enables = log.filter((x) => x.t === "enable").length;
  R.check("S1-01", "连续 5 次按键只调用 1 次 enableAlertBeforeUnload（去重已恢复）", enables === 1,
    "enable 次数=" + enables + " 完整调用序列=" + JSON.stringify(log));
  let g = await guardOf(mini);
  R.check("S1-02", "_guardOn 已是布尔值(修复前是金额字符串)", g.type === "boolean" && g.guardOn === true,
    "_guardOn=" + JSON.stringify(g.guardOn) + " type=" + g.type);

  // ===== 场景①：填了金额后离开 → 应启用离开确认 =====
  R.check("S1-03", "场景①填了金额 → 离开确认已启用", g.guardOn === true,
    "_guardOn=" + g.guardOn + " amount=" + g.amount + "（enable 已被调用，见 S1-01）");

  // ===== 场景②：填了又清空 → 应停用 =====
  await clearLog(mini);
  await page.callMethod("onAmountInput", { detail: { value: "" } });
  await sleep(400);
  log = await getLog(mini);
  g = await guardOf(mini);
  R.check("S1-04", "场景②金额清空 → 离开确认已停用(且调用了 disable)",
    g.guardOn === false && log.some((x) => x.t === "disable"),
    "_guardOn=" + g.guardOn + " 调用序列=" + JSON.stringify(log));

  // ===== 场景③：只加图片、不填金额 → 应启用 =====
  // 造状态：自动化无法选真实图片，直接 setData 一个占位路径后调 syncUnloadGuard（与真实选图后同一代码路径）
  await clearLog(mini);
  await page.setData({ photos: ["/qa/fake-photo.png"], amount: "", note: "" });
  await sleep(300);
  await page.callMethod("syncUnloadGuard");
  await sleep(400);
  log = await getLog(mini);
  g = await guardOf(mini);
  R.check("S1-05", "场景③只有图片没金额 → 离开确认已启用",
    g.guardOn === true && g.photos === 1 && !g.amount && log.some((x) => x.t === "enable"),
    "_guardOn=" + g.guardOn + " photos=" + g.photos + " amount=" + JSON.stringify(g.amount) + " 调用序列=" + JSON.stringify(log));

  // 场景③补充：只填备注不填金额 → 也应启用
  await clearLog(mini);
  await page.setData({ photos: [], amount: "", note: "" });
  await page.callMethod("syncUnloadGuard");
  await sleep(300);
  await clearLog(mini);
  await page.callMethod("onNoteInput", { detail: { value: "QA备注" } });
  await sleep(400);
  g = await guardOf(mini);
  log = await getLog(mini);
  R.check("S1-06", "场景③变体：只填备注没金额 → 离开确认已启用", g.guardOn === true && log.some((x) => x.t === "enable"),
    "_guardOn=" + g.guardOn + " note=" + JSON.stringify(g.note) + " 调用序列=" + JSON.stringify(log));

  // ===== 场景④：保存成功后 → 应停用 =====
  await page.setData({ note: "" });
  await page.callMethod("onAmountInput", { detail: { value: "6.66" } });
  await sleep(400);
  await clearLog(mini);
  const n0 = (await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true })).data.summary.count;
  const btn = await page.$(".btn--block");
  await btn.tap();
  // 等保存成功（_saved 变 true）
  const okSaved = await waitFor(async () => { const s = await guardOf(mini); return s && s.saved ? s : null; }, 15000, 120);
  log = await getLog(mini);
  R.check("S1-07", "场景④保存成功后 → 离开确认已停用",
    !!okSaved && okSaved.guardOn === false && log.some((x) => x.t === "disable"),
    "_guardOn=" + (okSaved && okSaved.guardOn) + " _saved=" + (okSaved && okSaved.saved) + " 调用序列=" + JSON.stringify(log));
  await sleep(3000);
  const n1 = (await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true })).data.summary.count;
  R.check("S1-08", "场景④该笔已正常入账 1 笔", n1 === n0 + 1, "count " + n0 + "->" + n1);

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  process.exit(0);
})().catch((e) => { console.error("S1 FATAL:", e.message, e.stack); process.exit(1); });
