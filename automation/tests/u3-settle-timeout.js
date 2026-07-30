// U3 诊断 settle.get -504003: 冷启动偶发 还是 稳定超时? 与账本大小/汇率快照数是否相关?
const { connect, apiCall, sleep } = require("./lib");
const BOOK_DEMO = "seed-book-split-floeovmie8";
const BOOK_ICE = "9cef38726a522d5f008ef25d7a291933";

async function timed(mini, res, type, params) {
  const t0 = Date.now();
  const r = await apiCall(mini, res, type, params);
  return { ms: Date.now() - t0, ok: !!r.success, code: r.code || (r.success ? "" : "?"), err: (r.errMsg || "").slice(0, 80), data: r.data };
}

(async () => {
  const { mini } = await connect();
  console.log("--- settle.get 旅行分账演示(6 笔, 3 人) 连续 5 次 ---");
  for (let i = 0; i < 5; i++) {
    const t = await timed(mini, "settle", "get", { bookId: BOOK_DEMO });
    console.log(`  #${i + 1} ${t.ms}ms ok=${t.ok} ${t.code} ${t.err}`);
    await sleep(1200);
  }
  console.log("--- settle.get 冰岛(5 笔, 2 人) 连续 3 次 ---");
  for (let i = 0; i < 3; i++) {
    const t = await timed(mini, "settle", "get", { bookId: BOOK_ICE });
    console.log(`  #${i + 1} ${t.ms}ms ok=${t.ok} ${t.code} ${t.err}`);
    await sleep(1200);
  }
  console.log("--- 对照: 其它 handler 耗时(同一云函数实例, 判断是否整体慢) ---");
  for (const [res, type, p] of [["record", "list", { bookId: BOOK_DEMO, page: 0, withSummary: true }],
                                 ["stats", "getMemberData", { bookId: BOOK_DEMO, month: "2026-07", kind: "expense" }],
                                 ["book", "getCurrent", {}],
                                 ["stats", "getDashboard", { bookId: BOOK_DEMO }]]) {
    const t = await timed(mini, res, type, p);
    console.log(`  ${res}.${type} ${t.ms}ms ok=${t.ok} ${t.code} ${t.err}`);
    await sleep(800);
  }
  process.exit(0);
})().catch((e) => { console.error("U3 FATAL:", e.message); process.exit(1); });
