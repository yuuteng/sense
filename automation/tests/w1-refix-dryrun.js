// W1 amountConverted 重固化 dry-run（BUG-04 任务 2）
// **只跑 dry-run，不写任何数据**（handlers 侧 dryRun 默认 true，此处仍显式传 true）。
// 前置：cloudfunctions/api 必须已部署本轮改动，否则报「未知接口：seed.refixAmountConverted」。
const { connect, apiCall, makeRecorder } = require("./lib");

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("w1-refix-dryrun");

  const res = await apiCall(mini, "seed", "refixAmountConverted", { dryRun: true });
  if (!res.success) {
    console.log("调用失败：" + JSON.stringify(res));
    R.check("W1-00", "seed.refixAmountConverted 可调用（云函数已部署）", false, JSON.stringify(res));
    R.save(errors); await mini.disconnect(); return;
  }
  const d = res.data;
  R.check("W1-00", "seed.refixAmountConverted 可调用（云函数已部署）", true, "");
  R.check("W1-01", "dryRun 生效：未写入任何数据", d.dryRun === true && d.summary.written === 0, JSON.stringify(d.summary));

  console.log("\n================ 重固化 DRY-RUN 报告 ================");
  console.log("摘要: " + JSON.stringify(d.summary, null, 2));

  console.log("\n---- 按账本 ----");
  (d.byBook || []).forEach((g) => {
    console.log(`  「${g.name}」 共 ${g.total} 条｜会变 ${g.change} 条｜缺 rate ${g.noRate} 条｜最大差 ${g.maxDiff}`);
  });

  console.log(`\n---- 会被改写的记录（显示前 ${(d.changes || []).length} 条，另有 ${d.changesTruncated} 条截断）----`);
  if (!(d.changes || []).length) console.log("  (无 —— 全部已是 round6，幂等)");
  (d.changes || []).forEach((c, i) => {
    console.log(`  ${i + 1}. 「${c.bookName}」${c.title || "(无标题)"} ${c.date}  ${c.amount} ${c.currency} × ${c.rate}`);
    console.log(`     旧 ${c.old}  →  新 ${c.new}   差 ${c.diff} ${c.baseCurrency || ""}${c.seed ? "   [演示数据]" : ""}`);
  });

  console.log(`\n---- 缺 rate 被跳过的记录（前 ${(d.noRate || []).length} 条，另有 ${d.noRateTruncated} 条）----`);
  if (!(d.noRate || []).length) console.log("  (无)");
  (d.noRate || []).forEach((c, i) => {
    console.log(`  ${i + 1}. 「${c.bookName}」${c.title || "(无标题)"} ${c.date}  amount=${c.amount} ${c.currency} rate=${c.rate} amountConverted=${c.amountConverted}`);
  });

  console.log("\n---- QA 那笔 700 CNY 的归属 ----");
  if (!(d.probe700 || []).length) console.log("  库里没有 amount=700 CNY 的记录");
  (d.probe700 || []).forEach((c) => {
    console.log(`  「${c.bookName}」${c.title || "(无标题)"} ${c.date}  base=${c.baseCurrency} rate=${c.rate}`);
    console.log(`     amountConverted=${c.amountConverted}   演示数据=${c.seed}   会被重固化=${c.wouldChange}   createdAt=${JSON.stringify(c.createdAt)}`);
  });
  console.log("==================================================\n");

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 1500));
  await mini.disconnect();
})().catch((e) => { console.error("W1 FATAL:", e.message, e.stack); process.exit(1); });
