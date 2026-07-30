// R5 join 页复验（修正 R4 的等待时序缺陷）+ 收尾清理
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("r5-join-cleanup");
  const st = loadState();

  // ===== join 页复验：不依赖抢 1200ms 定时器 =====
  // 路径 A：无 bookId → 错误态，停留在页面（join.js:16）
  let page = await goto(mini, "/pages/join/join");
  await sleep(1500);
  let cp = await curPage(mini);
  let d = null;
  try { d = await cp.data(); } catch (e) { /* ignore */ }
  R.check("R5-01", "join 页无 bookId 时进入错误态并停留在页面",
    cp.path === "pages/join/join" && d && d.status === "error" && d.msg === "\u9080\u8bf7\u94fe\u63a5\u65e0\u6548",
    "path=" + cp.path + " status=" + (d && d.status) + " msg=" + (d && d.msg));

  // 路径 B：已是成员 → 展示「你已在该账本中」后按设计跳首页（join.js:19-20，1200ms）
  page = await goto(mini, "/pages/join/join?bookId=" + st.retestBookId + "&role=rw");
  const okState = await waitFor(async () => {
    const p = await curPage(mini);
    if (p.path !== "pages/join/join") return null;
    const x = await p.data();
    return x && x.status === "ok" ? x : null;
  }, 4000, 150);
  R.check("R5-02", "join 页已是成员时给出「已在该账本中」提示", !!(okState && okState.msg && okState.msg.indexOf("\u5df2\u5728\u8be5\u8d26\u672c\u4e2d") >= 0),
    okState ? "status=" + okState.status + " msg=" + okState.msg + " bookName=" + okState.bookName : "未捕获到 ok 态（1200ms 内已跳转，属设计行为）");
  await sleep(2500);
  cp = await curPage(mini);
  R.check("R5-03", "join 成功后按设计自动跳回首页(join.js:20)", cp.path === "pages/home/home", "最终 path=" + cp.path);

  // 确认 join 未篡改我的 owner 角色（member.join 对已存在成员只改 defaultBookId）
  const mem = await apiCall(mini, "member", "list", { bookId: st.retestBookId });
  const me = mem.success ? (mem.data || []).find((m) => m.isMe) : null;
  R.check("R5-04", "join 未降级已有成员角色(仍为 owner)", !!me && me.role === "owner", "myRole=" + (me && me.role));

  // ===== 收尾清理 =====
  const sBefore = await apiCall(mini, "settings", "get", {});
  const sd = await apiCall(mini, "book", "setDefault", { bookId: st.origBookId });
  await sleep(1500);
  let gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("R5-05", "当前账本切回「冰岛」", gc.success && gc.data.bookId === st.origBookId,
    "now=" + (gc.success ? gc.data.name + "/" + gc.data.bookId : JSON.stringify(gc)));

  const d1 = await apiCall(mini, "book", "dissolve", { bookId: st.retestBookId });
  await sleep(2000);
  R.check("R5-06", "解散 QA复测账本", !!d1.success, JSON.stringify(d1).slice(0, 150));
  let d2 = { success: true, skipped: true };
  if (st.retestBookId2) {
    d2 = await apiCall(mini, "book", "dissolve", { bookId: st.retestBookId2 });
    await sleep(2000);
  }
  R.check("R5-07", "解散 QA复测账本EUR", !!d2.success, JSON.stringify(d2).slice(0, 150));

  const bl = await apiCall(mini, "book", "list", {});
  const names = bl.success ? bl.data.map((b) => b.name) : [];
  const ids = bl.success ? bl.data.map((b) => b.bookId) : [];
  R.check("R5-08", "账本列表已无任何 QA 复测账本", !ids.includes(st.retestBookId) && !ids.includes(st.retestBookId2),
    "books=" + names.join(","));
  R.check("R5-09", "原账本「冰岛」完好保留", names.indexOf("\u51b0\u5c9b") >= 0, "books=" + names.join(","));

  // 冰岛 账本口径应与本轮开始时一致：base=EUR / display=CNY
  gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("R5-10", "「冰岛」账本币种设置未被本轮测试改动(base=EUR, display=CNY)",
    gc.success && gc.data.baseCurrency === "EUR" && gc.data.displayCurrency === "CNY",
    "base=" + (gc.success && gc.data.baseCurrency) + " display=" + (gc.success && gc.data.displayCurrency));
  const sAfter = await apiCall(mini, "settings", "get", {});
  R.check("R5-11", "全局默认展示币种未被本轮测试改动", sAfter.success && sBefore.success && sAfter.data.displayCurrency === sBefore.data.displayCurrency,
    "before=" + (sBefore.success && sBefore.data.displayCurrency) + " after=" + (sAfter.success && sAfter.data.displayCurrency));

  page = await goto(mini, "/pages/home/home");
  const hd = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 20000);
  R.check("R5-12", "首页恢复到「冰岛」且正常加载", !!(hd && hd.bookName === "\u51b0\u5c9b" && hd.currentBookId === st.origBookId),
    "bookName=" + (hd && hd.bookName) + " curCode=" + (hd && hd.curCode) + " groups=" + ((hd && hd.groups) || []).length);

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  await mini.disconnect();
})().catch((e) => { console.error("R5 FATAL:", e.message, e.stack); process.exit(1); });
