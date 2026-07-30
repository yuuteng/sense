const { connect, apiCall } = require("./lib");
(async () => {
  const { mini } = await connect();
  const dates = ["2026-06-15","2026-07-01","2026-07-02","2026-07-05","2026-07-06","2026-07-07","2026-07-08","2026-07-09","2026-07-22","2026-07-29","2026-07-30",
                 "2026-03-03","2026-03-04","2026-04-10","2026-04-11"];
  for (const d of dates) {
    const r = await apiCall(mini, "rate", "getDaily", { date: d, base: "CNY" });
    const ok = r.success ? r.data : {};
    const exact = ok.date === d && ok.isFallback === false;
    console.log(d, exact ? "EXACT快照存在" : "无精确快照(回退到 " + ok.date + ")",
      "isFallback=" + ok.isFallback, "EUR=" + (ok.quotes && ok.quotes.EUR), "ISK=" + (ok.quotes && ok.quotes.ISK), "币种数=" + (ok.quotes ? Object.keys(ok.quotes).length : 0));
  }
  process.exit(0);
})().catch((e) => { console.error("U1 FATAL:", e.message); process.exit(1); });
