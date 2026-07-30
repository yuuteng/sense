const { connect, sleep, curPage, waitFor } = require("./lib");
(async () => {
  const { mini } = await connect();
  await mini.switchTab("/pages/stats/stats");
  await sleep(4000);
  const page = await curPage(mini);
  const d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.cards.length ? x : null; }, 15000);
  d.cards.forEach((c, i) => {
    console.log(i, JSON.stringify({ title: c.title, kind: c.kind, empty: c.empty, rows: c.rows ? c.rows.length : undefined, month: c.month && c.month.text }));
  });
  const catRows = await page.$$(".cat-row");
  console.log("cat-row count:", catRows.length);
  const catCard = d.cards.find((c) => c.kind === "cat");
  if (catCard) console.log("catCard rows:", JSON.stringify(catCard.rows || []).slice(0, 500), "empty:", catCard.empty, "month:", catCard.month && catCard.month.text);
  await mini.disconnect();
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });