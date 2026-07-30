// S0 探针：确认 FIX-06 的守卫 API 在模拟器里是否存在，以及能否用 hook 记录调用
const { connect, sleep, makeRecorder, waitFor, goto } = require("./lib");
(async () => {
  const { mini, errors } = await connect();

  const avail = await mini.evaluate(() => ({
    enable: typeof wx.enableAlertBeforeUnload,
    disable: typeof wx.disableAlertBeforeUnload,
    showToast: typeof wx.showToast,
  }));
  console.log("API availability:", JSON.stringify(avail));

  // 装 hook（只记录调用，不改变行为）
  const hooked = await mini.evaluate(() => {
    if (!wx.__qaHooked) {
      const oe = wx.enableAlertBeforeUnload, od = wx.disableAlertBeforeUnload, ot = wx.showToast;
      wx.__qaLog = [];
      wx.enableAlertBeforeUnload = function (o) { wx.__qaLog.push({ t: "enable" }); return oe ? oe.call(wx, o) : undefined; };
      wx.disableAlertBeforeUnload = function (o) { wx.__qaLog.push({ t: "disable" }); return od ? od.call(wx, o) : undefined; };
      wx.showToast = function (o) { wx.__qaLog.push({ t: "toast", title: o && o.title }); return ot.call(wx, o); };
      wx.__qaHooked = true;
    }
    wx.__qaLog = [];
    return true;
  });
  console.log("hook installed:", hooked);

  // 进 add 页，逐字符输金额，看 enable 被调几次（FIX-06 的核心：去重应生效 => 恰好 1 次）
  const page = await goto(mini, "/pages/add/add");
  await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
  await mini.evaluate(() => { wx.__qaLog = []; });
  for (const v of ["5", "5.", "5.0", "5.01"]) {
    await page.callMethod("onAmountInput", { detail: { value: v } });
    await sleep(200);
  }
  const log = await mini.evaluate(() => wx.__qaLog.slice());
  const guardOn = await mini.evaluate(() => { const ps = getCurrentPages(); const t = ps[ps.length - 1]; return { guardOn: t._guardOn, type: typeof t._guardOn, amount: t.data.amount }; });
  console.log("log after 4 keystrokes:", JSON.stringify(log));
  console.log("guard state:", JSON.stringify(guardOn));
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 1500));
  process.exit(0);
})().catch((e) => { console.error("S0 FATAL:", e.message); process.exit(1); });
