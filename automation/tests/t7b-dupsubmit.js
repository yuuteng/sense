// T7b 重复提交复现细化：真实人手可达的双击间隔（150ms / 300ms / 600ms）是否仍产生重复入账
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

async function countRecords(mini, bookId) {
  const r = await apiCall(mini, "record", "list", { bookId, page: 0, withSummary: true });
  return r.success && r.data.summary ? r.data.summary.count : -1;
}

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("t7b-dupsubmit");
  const st = loadState();

  // 先看上一轮连点产生的 3 笔是否内容完全相同（判定「重复入账」而非「误触多笔」）
  const lst = await apiCall(mini, "record", "list", { bookId: st.qaBookId, page: 0, withSummary: true, currency: "ISK" });
  const items = [];
  ((lst.success && lst.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => items.push(i)));
  const dbl = items.filter((i) => i.title === "QA-dblclick" || (i.note || "") === "QA-dblclick");
  console.log("ALL ITEMS:", JSON.stringify(items.map((i) => ({ t: i.title, amt: i.originalAmount, cur: i.currency, d: i.date })), null, 0));

  for (const [id, gap] of [["T7B-01", 150], ["T7B-02", 300], ["T7B-03", 600]]) {
    const page = await goto(mini, "/pages/add/add");
    await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 20000);
    await page.callMethod("onAmountInput", { detail: { value: "1.11" } });
    await page.callMethod("onNoteInput", { detail: { value: "QA-gap" + gap } });
    await sleep(500);
    const n1 = await countRecords(mini, st.qaBookId);
    const btn = await page.$(".btn--block");
    const p1 = btn.tap().catch((e) => console.log("tapA " + e.message));
    await sleep(gap);
    const p2 = btn.tap().catch((e) => console.log("tapB " + e.message));
    await Promise.all([p1, p2]);
    await sleep(8000);
    const n2 = await countRecords(mini, st.qaBookId);
    R.check(id, "间隔 " + gap + "ms 双击保存只入账 1 笔", n2 === n1 + 1, "count " + n1 + "->" + n2 + " 新增=" + (n2 - n1) + " 笔");
  }

  // 最终列出全部记录，供报告举证
  const fin = await apiCall(mini, "record", "list", { bookId: st.qaBookId, page: 0, withSummary: true, currency: "ISK" });
  const all = [];
  ((fin.success && fin.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => all.push({ title: i.title, amt: i.originalAmount, cur: i.currency, date: i.date })));
  console.log("FINAL RECORDS(" + all.length + "):", JSON.stringify(all));
  R.check("T7B-04", "记录条数与预期一致(仅用于举证，无断言意义)", true, "total=" + all.length);

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  await mini.disconnect();
})().catch((e) => { console.error("T7b FATAL:", e.message, e.stack); process.exit(1); });
