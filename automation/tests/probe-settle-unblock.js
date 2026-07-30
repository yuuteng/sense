/**
 * 只读探针：确认死循环修复后 settle.get 对「旅行分账演示」不再超时
 * 零写操作。
 */
const automator = require("miniprogram-automator");

const BOOKS = [
  { id: "seed-book-split-floeovmie8", name: "旅行分账演示（原 100% 超时）" },
  { id: "9cef38726a522d5f008ef25d7a291933", name: "冰岛（对照，原本正常）" },
];

(async () => {
  const mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });
  const page = await mini.reLaunch("/pages/settings/settings");
  await page.waitFor(2000);

  for (const b of BOOKS) {
    const out = await mini.evaluate((bookId) => new Promise((resolve) => {
      const t0 = Date.now();
      wx.cloud.callFunction({
        name: "api",
        data: { resource: "settle", type: "get", bookId },
        success: (r) => {
          const ms = Date.now() - t0;
          const d = r.result && r.result.data;
          resolve(JSON.stringify({
            ok: !!(r.result && r.result.success), ms,
            errMsg: r.result && r.result.errMsg,
            transfers: d && d.transfers ? d.transfers.map((t) => `${t.from}→${t.to} ${t.amount}(${t.cur} ${t.amountDisp})`) : null,
            netSum: d && d.members ? d.members.reduce((s, m) => s + m.net, 0) : null,
            totalExpense: d && d.summary ? d.summary.totalExpense : null,
            memberNets: d && d.members ? d.members.map((m) => `${m.name}:${m.net}`) : null,
          }));
        },
        fail: (e) => resolve(JSON.stringify({ ok: false, ms: Date.now() - t0, callFail: e.errMsg || String(e) })),
      });
    }), b.id);
    console.log("=== " + b.name + " ===");
    console.log(out);
    console.log();
  }
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
