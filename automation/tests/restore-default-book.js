/**
 * 恢复当前/默认账本为「冰岛」（qa-state.json 记录的原始账本）
 * 只调 book.setDefault 一次写操作，可逆；不解散任何账本、不动任何记录。
 */
const automator = require("miniprogram-automator");

const ICELAND = "9cef38726a522d5f008ef25d7a291933";

(async () => {
  const mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });

  const cfg = await mini.reLaunch("/pages/bookConfig/bookConfig?bookId=" + ICELAND);
  await cfg.waitFor(2500);
  const before = await cfg.data();
  console.log("目标账本:", before.book && before.book.name, "| 当前 isDefault:", before.book && before.book.isDefault);

  await cfg.callMethod("setDefault");
  await cfg.waitFor(2500);

  const bp = await mini.reLaunch("/pages/books/books");
  await bp.waitFor(2500);
  console.log("\n=== 恢复后账本清单 ===");
  for (const b of (await bp.data()).books || []) {
    console.log([b.name, b.type, "base=" + b.baseCurrency, b.isCurrent ? "当前" : "", b.isDefault ? "默认" : ""].filter(Boolean).join(" | "));
  }

  const hp = await mini.reLaunch("/pages/home/home");
  await hp.waitFor(3000);
  const h = await hp.data();
  console.log("\n首页展示币种:", h.curCode, "| 记录数:", (h.items || []).length);

  process.exit(0);
})().catch((e) => {
  console.error("RESTORE FAIL:", e.message);
  process.exit(1);
});
