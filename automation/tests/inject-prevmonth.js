// 为 T3 造上月数据（基线同款：66 CNY / 2026-06-15 / 备注 QA上月造数），使月份切换器的「上月」可用
const { connect, apiCall, loadState, sleep } = require("./lib");
(async () => {
  const { mini } = await connect();
  const st = loadState();
  const cats = await apiCall(mini, "category", "list", { bookId: st.qaBookId, kind: "expense" });
  const first = cats.success && cats.data && cats.data[0] ? cats.data[0] : null;
  const catId = first ? (first.subs && first.subs[0] ? first.subs[0].categoryId : first.id || first._id) : null;
  const title = first ? (first.subs && first.subs[0] ? first.subs[0].name : first.name) : "其他";
  const me = await apiCall(mini, "user", "getProfile", {});
  const openid = me.success ? me.data.openid : undefined;
  const r = await apiCall(mini, "record", "create", {
    bookId: st.qaBookId,
    payload: {
      type: "expense", amount: 66, currency: "CNY", rate: 1, date: "2026-06-15",
      categoryId: catId, title, note: "QA\u4e0a\u6708\u9020\u6570", images: [],
      recorderOpenid: openid, payerOpenid: openid,
    },
  });
  console.log("inject prior-month record:", JSON.stringify(r).slice(0, 200));
  await sleep(1000);
  const l = await apiCall(mini, "record", "list", { bookId: st.qaBookId, page: 0, withSummary: true });
  const all = [];
  ((l.success && l.data.groups) || []).forEach((g) => (g.items || []).forEach((i) => all.push(i.originalAmount + i.currency + "@" + i.date)));
  console.log("book records now:", JSON.stringify(all), " displayCurrency=", l.success && l.data.displayCurrency);
  await mini.disconnect();
})().catch((e) => { console.error("INJECT FATAL:", e.message); process.exit(1); });
