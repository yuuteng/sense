/**
 * 只读探针：账本类型 / 基准币 / 展示币种 / 当前与默认账本
 * 零写操作。
 */
const automator = require("miniprogram-automator");

(async () => {
  const mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });

  const bp = await mini.reLaunch("/pages/books/books");
  await bp.waitFor(2500);
  const books = (await bp.data()).books || [];
  console.log("=== 账本清单 (%d 本) ===", books.length);
  for (const b of books) {
    console.log(
      [
        b.name,
        b.type,
        "base=" + b.baseCurrency,
        "members=" + b.memberCount,
        b.isCurrent ? "当前" : "",
        b.isDefault ? "默认" : "",
        b.bookId,
      ].filter(Boolean).join(" | ")
    );
  }

  // 当前账本的展示币种（走 book.getCurrent，即 displayCurrencyOf 的输出）
  const hp = await mini.reLaunch("/pages/home/home");
  await hp.waitFor(3000);
  const h = await hp.data();
  console.log("\n=== 首页 ===");
  console.log("当前账本:", h.currentBookName, "| 展示币种:", h.curCode, "| 记录数:", (h.items || []).length);

  // 不调 mini.close()：会销毁 cli auto 会话，后续脚本得重启
  process.exit(0);
})().catch((e) => {
  console.error("PROBE FAIL:", e.message);
  process.exit(1);
});
