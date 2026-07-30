/**
 * 实测：删掉设置页默认币种后，新建非 CNY 基准币账本，首页是否直接按基准币显示
 * （旧问题：ensureUser 把全局默认写死 CNY，永久遮蔽「按基准币兜底」，建 EUR 账本却看到 ¥）
 * 会新建账本并在结尾删除。
 */
const automator = require("miniprogram-automator");

const call = (mini, resource, type, params = {}) => mini.evaluate((a) => new Promise((res) => {
  wx.cloud.callFunction({
    name: "api", data: { resource: a.resource, type: a.type, ...a.params },
    success: (r) => res(JSON.stringify(r.result)),
    fail: (e) => res(JSON.stringify({ success: false, errMsg: e.errMsg || String(e) })),
  });
}), { resource, type, params });

(async () => {
  const mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });
  const p = await mini.reLaunch("/pages/settings/settings");
  await p.waitFor(2000);

  // 0. 先看用户文档里那个已废弃的全局默认字段还在不在（应该还在，但必须是惰性的）
  const prof = JSON.parse(await call(mini, "user", "getProfile"));
  console.log("原默认账本:", prof.data && prof.data.defaultBookName);

  const created = [];
  for (const base of ["EUR", "ISK", "JPY"]) {
    const r = JSON.parse(await call(mini, "book", "create", {
      name: "口径测试" + base, bookType: "share", baseCurrency: base,
    }));
    if (!r.success) { console.log(base, "建账本失败:", r.errMsg); continue; }
    const bookId = r.data.bookId || r.data._id || (r.data.book && r.data.book.bookId);
    created.push({ base, bookId });

    // 服务端权威解析结果
    const cur = JSON.parse(await call(mini, "book", "getCurrent", {}));
    // 前端首页实际渲染
    const hp = await mini.reLaunch("/pages/home/home");
    await hp.waitFor(3500);
    const h = await hp.data();
    console.log(`base=${base}  →  服务端 displayCurrency=${cur.data && cur.data.displayCurrency}  |  首页 curCode=${h.curCode} curSym=${h.curSym}  |  ${h.curCode === base ? "✅ 直接按基准币" : "❌ 仍被遮蔽"}`);
  }

  // 清理：删掉测试账本，默认账本还原
  console.log("\n--- 清理 ---");
  for (const c of created) {
    const d = JSON.parse(await call(mini, "book", "dissolve", { bookId: c.bookId }));
    console.log("解散", c.base, d.success ? "ok" : d.errMsg);
  }
  const back = JSON.parse(await call(mini, "book", "setDefault", { bookId: "9cef38726a522d5f008ef25d7a291933" }));
  console.log("默认账本还原冰岛:", back.success ? "ok" : back.errMsg);
  const list = JSON.parse(await call(mini, "book", "list", {}));
  console.log("剩余账本:", (list.data || []).map((b) => b.name + (b.isDefault ? "(默认)" : "")).join(", "));

  process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
