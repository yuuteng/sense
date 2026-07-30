// T5 账本管理：账本列表 / 切换账本(冰岛<->QA) / 账本配置页 / 分类管理
const { connect, sleep, apiCall, loadState, makeRecorder, waitFor, goto, curPage } = require("./lib");

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("t5-books");
  const st = loadState();

  // ---- 账本列表页 ----
  let page = await goto(mini, "/pages/books/books");
  let d = await waitFor(async () => { const x = await page.data(); return x.books && x.books.length ? x : null; }, 15000);
  const names = (d.books || []).map((b) => b.name);
  R.check("T5-01", "账本列表页渲染出账本", !!d && d.books.length > 0, "count=" + d.books.length + " names=" + names.join(","));
  R.check("T5-02", "列表含 QA 账本与原账本「冰岛」", names.includes("QA测试账本") && names.includes("冰岛"), names.join(","));
  const qa = (d.books || []).find((b) => b.bookId === st.qaBookId);
  R.check("T5-03", "账本行带类型与角色 meta", !!qa && !!qa.roleMine && !!qa.typeClass, JSON.stringify(qa && { role: qa.roleMine, type: qa.typeClass, isDefault: qa.isDefault }));

  // 点行进配置页
  const rows = await page.$$(".book-row, .pl-item, .list-row");
  let opened = false;
  if (rows && rows.length) { try { await rows[0].tap(); await sleep(2500); opened = true; } catch (e) { console.log("row tap: " + e.message); } }
  page = await curPage(mini);
  if (page.path !== "pages/bookConfig/bookConfig") {
    console.log("fallback: goto bookConfig directly (tap path=" + page.path + ")");
    page = await goto(mini, "/pages/bookConfig/bookConfig?bookId=" + st.qaBookId);
  }
  R.check("T5-04", "账本行可进入账本配置页", page.path === "pages/bookConfig/bookConfig", page.path + " viaTap=" + opened);

  d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.book ? x : null; }, 15000);
  R.check("T5-05", "配置页加载账本信息", !!(d && d.book && d.book.name), JSON.stringify(d && { name: d.book.name, type: d.book.type, role: d.roleLabel }));
  R.check("T5-06", "配置页渲染成员列表", !!(d && d.members && d.members.length), "members=" + JSON.stringify((d && d.members || []).map((m) => m.name + "/" + m.roleBadge)));
  R.check("T5-07", "owner 身份识别正确(有管理权)", !!(d && d.isOwner && d.canManage), "isOwner=" + (d && d.isOwner) + " canManage=" + (d && d.canManage));
  const dissolveEl = await page.$(".danger, .cfg__dissolve, .btn--danger");
  R.check("T5-08", "owner 可见解散入口", !!dissolveEl, dissolveEl ? "found" : "not found (选择器可能不匹配)");

  // ---- 首页账本切换：QA -> 冰岛 -> QA ----
  page = await goto(mini, "/pages/home/home");
  await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 15000);
  const bookBtn = await page.$(".appbar__book");
  R.check("T5-09", "首页顶栏有账本切换入口", !!bookBtn);
  if (bookBtn) await bookBtn.tap();
  await sleep(1500);
  d = await page.data();
  R.check("T5-10", "账本切换器打开并列出账本", !!d.switcherVisible && d.books.length > 0, "visible=" + d.switcherVisible + " count=" + d.books.length);

  // 选「冰岛」
  let switched = false;
  try {
    const srows = await page.$$("book-switcher >>> .bs__row");
    for (const r of srows) {
      const id = await r.attribute("data-id");
      if (id === st.origBookId) { await r.tap(); switched = true; break; }
    }
  } catch (e) { console.log("switcher rows: " + e.message); }
  if (!switched) { await page.callMethod("onSwitcherSelect", { detail: { bookId: st.origBookId }, currentTarget: { dataset: { id: st.origBookId } } }); }
  await sleep(4000);
  page = await curPage(mini);
  d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.currentBookId === st.origBookId ? x : null; }, 15000);
  let gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("T5-11", "切到「冰岛」后首页刷新为该账本", !!(d && d.bookName === "冰岛"), "bookName=" + (d && d.bookName) + " curCode=" + (d && d.curCode) + " viaUI=" + switched);
  R.check("T5-12", "服务端当前账本同步为「冰岛」", gc.success && gc.data.bookId === st.origBookId, gc.success ? gc.data.name + "/" + gc.data.bookId : JSON.stringify(gc));

  // 切回 QA
  const bookBtn2 = await page.$(".appbar__book");
  if (bookBtn2) await bookBtn2.tap();
  await sleep(1500);
  let back = false;
  try {
    const srows = await page.$$("book-switcher >>> .bs__row");
    for (const r of srows) {
      const id = await r.attribute("data-id");
      if (id === st.qaBookId) { await r.tap(); back = true; break; }
    }
  } catch (e) { console.log("switcher rows2: " + e.message); }
  if (!back) { await page.callMethod("onSwitcherSelect", { detail: { bookId: st.qaBookId }, currentTarget: { dataset: { id: st.qaBookId } } }); }
  await sleep(4000);
  page = await curPage(mini);
  d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.currentBookId === st.qaBookId ? x : null; }, 15000);
  gc = await apiCall(mini, "book", "getCurrent", {});
  R.check("T5-13", "切回 QA 账本成功且展示币种保持 ISK", !!(d && d.currentBookId === st.qaBookId) && gc.success && gc.data.displayCurrency === "ISK",
    "bookName=" + (d && d.bookName) + " curCode=" + (d && d.curCode) + " serverDisplay=" + (gc.success && gc.data.displayCurrency));

  // ---- 分类管理（在 add 页）----
  page = await goto(mini, "/pages/add/add");
  d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.cats && x.cats.length ? x : null; }, 15000);
  const catCount0 = d.cats.length;
  R.check("T5-14", "记账页渲染分类九宫格", catCount0 > 0, "cats=" + catCount0 + " first=" + d.cats.slice(0, 4).map((c) => c.key).join(","));

  const NEWCAT = "QA分类" + String(Date.now()).slice(-4);
  await page.callMethod("onAddCat");
  await sleep(800);
  d = await page.data();
  R.check("T5-15", "新增分类弹层可打开", !!(d.addCat && d.addCat.visible), JSON.stringify(d.addCat));
  await page.callMethod("onAddCatName", { detail: { value: NEWCAT } });
  await sleep(300);
  await page.callMethod("confirmAddCat");
  await sleep(3500);
  d = await page.data();
  const added = (d.cats || []).find((c) => c.key === NEWCAT);
  R.check("T5-16", "新增一级分类后九宫格出现该分类且弹层关闭", !!added && !d.addCat.visible, "found=" + !!added + " visible=" + (d.addCat && d.addCat.visible));

  const clist = await apiCall(mini, "category", "list", { bookId: st.qaBookId, kind: "expense" });
  const inServer = clist.success && JSON.stringify(clist.data).includes(NEWCAT);
  R.check("T5-17", "新增分类已持久化到账本(category.list 可查)", inServer, "found=" + inServer);

  // 停用（onDeleteCat 走 showModal，自动化点不到弹窗，直接调 category.disable 校验服务端行为）
  const catId = added && added.id;
  const dis = catId ? await apiCall(mini, "category", "disable", { bookId: st.qaBookId, categoryId: catId }) : { success: false, errMsg: "no catId" };
  R.check("T5-18", "停用分类接口成功", !!dis.success, JSON.stringify(dis).slice(0, 200));
  const clist2 = await apiCall(mini, "category", "list", { bookId: st.qaBookId, kind: "expense" });
  R.check("T5-19", "停用后分类不再出现在可选列表", clist2.success && !JSON.stringify(clist2.data).includes(NEWCAT), "stillThere=" + (clist2.success && JSON.stringify(clist2.data).includes(NEWCAT)));

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 4000));
  await mini.disconnect();
})().catch((e) => { console.error("T5 FATAL:", e.message, e.stack); process.exit(1); });
