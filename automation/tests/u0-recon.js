const { connect, apiCall, loadState } = require("./lib");
(async () => {
  const { mini } = await connect();
  const bl = await apiCall(mini, "book", "list", {});
  const books = (bl.success ? bl.data : []);
  console.log("books:", JSON.stringify(books.map((b) => ({ id: b.bookId, n: b.name, t: b.type, base: b.baseCurrency }))));
  for (const b of books.filter((x) => x.type === "split")) {
    const m = await apiCall(mini, "member", "list", { bookId: b.bookId });
    const l = await apiCall(mini, "record", "list", { bookId: b.bookId, page: 0, withSummary: true });
    const dates = [];
    ((l.success && l.data.groups) || []).forEach((g) => dates.push(g.date + "(" + (g.items || []).length + ")"));
    console.log("SPLIT", b.name, "base=" + b.baseCurrency,
      "members=" + JSON.stringify((m.success ? m.data : []).map((x) => x.name + "/" + x.role + (x.isMe ? "(me)" : ""))),
      "dates=" + JSON.stringify(dates.slice(0, 8)), "summary=" + JSON.stringify(l.success && l.data.summary));
  }
  const inj = await apiCall(mini, "seed", "injectRateSnapshot", { date: "2026-07-01", quotes: { EUR: 7.8, ISK: 0.055 } });
  console.log("inject:", JSON.stringify(inj).slice(0, 300));
  const del = await apiCall(mini, "seed", "deleteRateSnapshot", { date: "2026-07-01" });
  console.log("delete:", JSON.stringify(del).slice(0, 200));
  const prof = await apiCall(mini, "user", "getProfile", {});
  console.log("me openid=", prof.success && prof.data.openid, "isDev=", prof.success && prof.data.isDev);
  process.exit(0);
})().catch((e) => { console.error("U0 FATAL:", e.message); process.exit(1); });
