// U0 迁移预览（read-only，不写任何数据，**不需要新部署**）：
// 用当前线上（旧优先级链）的已部署接口，测出当前用户每个账本的「迁移前生效展示币种」，
// 与账本基准币比对，推出迁移会写什么。仅覆盖当前 openid —— 其他成员的 settings 读不到，
// 完整权威结果必须部署后跑 u1-migrate-dryrun.js。
const { connect, apiCall, makeRecorder } = require("./lib");

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("u0-migrate-preview");

  const sg = await apiCall(mini, "settings", "get", {});
  const globalDefault = sg.success ? sg.data.displayCurrency : "(读不到)";
  console.log("\n当前用户全局默认展示币种 settings.displayCurrency = " + globalDefault);

  const bl = await apiCall(mini, "book", "list", {});
  if (!bl.success) { console.log("book.list 失败: " + JSON.stringify(bl)); await mini.disconnect(); return; }
  const books = bl.data || [];
  console.log("我参与的账本数: " + books.length + "\n");

  const rows = [];
  for (const b of books) {
    // record.list 回传的 displayCurrency 就是服务端按**当前已部署**（旧）优先级解析的生效值
    const rl = await apiCall(mini, "record", "list", { bookId: b.bookId, page: 0 });
    const eff = rl.success ? rl.data.displayCurrency : "(取不到)";
    const ml = await apiCall(mini, "member", "list", { bookId: b.bookId });
    const members = ml.success ? (ml.data || []) : [];
    rows.push({
      name: b.name, bookId: b.bookId, base: b.baseCurrency, eff,
      memberCount: members.length,
      others: members.filter((m) => !m.isMe).map((m) => m.name || m.openid),
      action: eff === b.baseCurrency ? "跳过（生效值==基准币，新逻辑自动回落）" : "写入账本级覆盖 " + eff,
      changesIfNoMigration: eff === b.baseCurrency ? "无变化" : `会从 ${eff} 变成 ${b.baseCurrency}`,
    });
  }

  console.log("================ 迁移预览（仅当前用户）================");
  rows.forEach((r, i) => {
    console.log(`${i + 1}. 「${r.name}」  base=${r.base}  当前生效=${r.eff}  成员${r.memberCount}人`);
    console.log(`   不迁移的后果: ${r.changesIfNoMigration}`);
    console.log(`   迁移动作: ${r.action}`);
    if (r.others.length) console.log(`   ⚠ 其他成员（其生效值本脚本读不到，需部署后由 u1 覆盖）: ${r.others.join(", ")}`);
    console.log(`   bookId=${r.bookId}`);
  });
  console.log("======================================================\n");

  R.check("U0-01", "预览完成（read-only）", true, JSON.stringify({ globalDefault, books: rows.length }));
  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 1500));
  await mini.disconnect();
})().catch((e) => { console.error("U0 FATAL:", e.message, e.stack); process.exit(1); });
