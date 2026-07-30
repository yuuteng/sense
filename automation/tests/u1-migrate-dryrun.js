// U1 展示币种迁移 dry-run：删掉「全局默认展示币种」后，把各 (用户 × 账本) 的迁移前生效口径
// 物化成账本级覆盖。**本脚本只跑 dry-run，不写任何数据**（handlers 侧 dryRun 默认 true，此处仍显式传）。
// 前置：cloudfunctions/api 必须已重新部署，否则 seed.migrateDisplayCurrency 不存在（报「未知接口」）。
const { connect, apiCall, makeRecorder } = require("./lib");

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("u1-migrate-dryrun");

  const res = await apiCall(mini, "seed", "migrateDisplayCurrency", { dryRun: true });
  if (!res.success) {
    console.log("调用失败：" + JSON.stringify(res));
    R.check("U1-00", "seed.migrateDisplayCurrency 可调用（云函数已部署）", false, JSON.stringify(res));
    R.save(errors);
    await mini.disconnect();
    return;
  }
  const d = res.data;
  R.check("U1-00", "seed.migrateDisplayCurrency 可调用（云函数已部署）", true, "");
  R.check("U1-01", "dryRun 生效：未写入任何数据", d.dryRun === true && d.summary.written === 0 && d.summary.fieldsRemoved === 0,
    JSON.stringify(d.summary));

  console.log("\n================ 迁移 DRY-RUN 报告 ================");
  console.log("摘要: " + JSON.stringify(d.summary, null, 2));

  console.log("\n---- 将写入的账本级覆盖 (" + d.plan.length + " 组) ----");
  if (!d.plan.length) console.log("(无)");
  d.plan.forEach((x, i) => {
    console.log(`${i + 1}. ${x.nickname} × 「${x.bookName}」  base=${x.base}  全局默认=${x.globalDefault}  →  写入 ${x.write}`);
    console.log(`   openid=${x.openid}  bookId=${x.bookId}`);
  });

  console.log("\n---- 跳过的组合 (" + d.skipped.length + " 组) ----");
  if (!d.skipped.length) console.log("(无)");
  d.skipped.forEach((x, i) => {
    console.log(`${i + 1}. ${x.nickname} × 「${x.bookName}」  base=${x.base || "?"}  跳过原因: ${x.reason}`);
  });

  console.log("\n---- 待清理的遗留 settings.displayCurrency (" + d.stale.length + " 个用户) ----");
  if (!d.stale.length) console.log("(无)");
  d.stale.forEach((x, i) => {
    console.log(`${i + 1}. ${x.nickname || "(无昵称)"}  ${x.openid}  = ${x.displayCurrency}`);
  });
  console.log("==================================================\n");

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 2000));
  await mini.disconnect();
})().catch((e) => { console.error("U1 FATAL:", e.message, e.stack); process.exit(1); });
