// T1 记账核心流：建 QA 账本 → 记支出 → 列表 → 详情 → 编辑 → 删除 → 收入
const { connect, sleep, apiCall, loadState, saveState, makeRecorder, waitFor, QA_BOOK } = require("./lib");

(async () => {
  const { mini, errors } = await connect();
  const R = makeRecorder("t1-core-flow");

  // ---------- 0. 建 QA 测试账本（走 onboarding 真实 UI）----------
  let page = await mini.reLaunch("/pages/onboarding/onboarding");
  await sleep(1500);
  const nameInput = await page.$(".text-input");
  await nameInput.input(QA_BOOK);
  await sleep(300);
  const createBtn = await page.$(".action-bar .btn--primary");
  await createBtn.tap();
  const cur = await waitFor(async () => {
    const r = await apiCall(mini, "book", "getCurrent", {});
    return r.success && r.data && r.data.name === QA_BOOK ? r.data : null;
  }, 15000);
  R.check("T1-01", "onboarding 创建 QA 测试账本成功且成为当前账本", !!cur, JSON.stringify(cur));
  if (!cur) { R.save(errors); await mini.disconnect(); return; }
  saveState({ qaBookId: cur.bookId });

  await sleep(2500);
  page = await mini.currentPage();
  R.check("T1-02", "创建后自动回到首页", page.path === "pages/home/home", page.path);
  if (page.path !== "pages/home/home") { page = await mini.reLaunch("/pages/home/home"); await sleep(2000); }

  let d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 10000);
  R.check("T1-03", "新账本首页为空列表", d && d.groups.length === 0, d && JSON.stringify(d.groups).slice(0, 200));

  // ---------- 1. 记一笔支出 12.5 ----------
  const fab = await page.$(".fab");
  R.check("T1-04", "首页有「记一笔」入口", !!fab);
  await fab.tap();
  await sleep(2500);
  page = await mini.currentPage();
  R.check("T1-05", "进入记账页", page.path === "pages/add/add", page.path);
  d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 10000);
  R.check("T1-06", "记账页数据就绪(默认支出)", d && d.type === "out" && d.curs.length > 0, d && ("type=" + d.type + " curs=" + d.curs.length + " cur0=" + (d.curs[0] && d.curs[0].code)));

  const amountEl = await page.$(".amount-input");
  await amountEl.input("12.5");
  await sleep(300);
  const cats = await page.$$(".cat");
  if (cats.length > 1) await cats[1].tap();
  await sleep(300);
  const noteEl = await page.$(".field-row__val input");
  if (noteEl) await noteEl.input("QA支出测试"); else R.check("T1-07a", "找到备注输入框", false, "selector 未命中");
  await sleep(300);
  d = await page.data();
  console.log("picked cat=" + (d.cats[d.catIndex] && d.cats[d.catIndex].key) + " sub=" + (d.subs[d.subIndex] && d.subs[d.subIndex].name) + " amount=" + d.amount);
  R.check("T1-07", "金额/备注输入生效", d.amount === "12.5" && d.note === "QA支出测试", "amount=" + d.amount + " note=" + d.note);

  const saveBtn = await page.$(".btn--block");
  await saveBtn.tap();
  await sleep(3500);
  page = await mini.currentPage();
  R.check("T1-08", "保存后返回首页", page.path === "pages/home/home", page.path);

  d = await waitFor(async () => {
    const x = await page.data();
    const it = x.groups[0] && x.groups[0].items.find((i) => !String(i.id).startsWith("pending-"));
    return it ? x : null;
  }, 12000);
  const row = d && d.groups[0] && d.groups[0].items[0];
  R.check("T1-09", "首页列表出现该笔支出", !!row && row.amount.includes("12.5"), row && JSON.stringify(row));
  R.check("T1-10", "首页月度概要支出=12.50", d && d.summary.expense.includes("12.5"), d && JSON.stringify(d.summary));

  // ---------- 2. 详情 ----------
  const txn = await page.$(".txn");
  await txn.tap();
  await sleep(2500);
  page = await mini.currentPage();
  R.check("T1-11", "点行进入详情页", page.path === "pages/detail/detail", page.path);
  d = await waitFor(async () => { const x = await page.data(); return x.d ? x : null; }, 10000);
  R.check("T1-12", "详情金额/备注正确", d && d.d.displayAmount.includes("12.5") && d.d.note === "QA支出测试",
    d && JSON.stringify({ amt: d.d.displayAmount, note: d.d.note, cat: d.d.category, type: d.d.type }));
  R.check("T1-13", "记录人本人可编辑", d && d.d.canEdit === true, d && String(d.d.canEdit));

  // ---------- 3. 编辑金额 12.5 → 99.99 ----------
  const editBtn = await page.$(".action-bar .btn--ghost");
  await editBtn.tap();
  await sleep(2500);
  page = await mini.currentPage();
  d = await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 10000);
  R.check("T1-14", "编辑模式进入且预填原值", page.path === "pages/add/add" && d && d.amount === "12.5" && d.navTitle === "编辑记录",
    "path=" + page.path + " amount=" + (d && d.amount) + " title=" + (d && d.navTitle));
  const amountEl2 = await page.$(".amount-input");
  await amountEl2.input("99.99");
  await sleep(300);
  const saveBtn2 = await page.$(".btn--block");
  await saveBtn2.tap();
  await sleep(3000);
  page = await mini.currentPage();
  R.check("T1-15", "保存修改后返回详情页", page.path === "pages/detail/detail", page.path);
  d = await waitFor(async () => {
    const x = await page.data();
    return x.d && x.d.displayAmount.includes("99.99") ? x : null;
  }, 10000);
  R.check("T1-16", "详情金额已更新为 99.99", !!d, d ? d.d.displayAmount : "详情未更新");

  await mini.navigateBack();
  await sleep(3000);
  page = await mini.currentPage();
  d = await waitFor(async () => {
    const x = await page.data();
    const it = x.groups[0] && x.groups[0].items[0];
    return it && it.amount.includes("99.99") ? x : null;
  }, 10000);
  R.check("T1-17", "首页列表金额已更新为 99.99", !!d, d ? "" : JSON.stringify((await page.data()).groups).slice(0, 300));

  // ---------- 4. 删除 ----------
  const txn2 = await page.$(".txn");
  await txn2.tap();
  await sleep(2500);
  page = await mini.currentPage();
  const delBtn = await page.$(".action-bar .btn--danger");
  await delBtn.tap();
  await sleep(500);
  d = await page.data();
  R.check("T1-18", "删除二次确认文案出现", d.delText.includes("确认"), d.delText);
  await delBtn.tap();
  await sleep(3000);
  page = await mini.currentPage();
  R.check("T1-19", "删除后返回首页", page.path === "pages/home/home", page.path);
  d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.groups.length === 0 ? x : null; }, 10000);
  R.check("T1-20", "首页列表该笔已消失", !!d, d ? "" : JSON.stringify((await page.data()).groups).slice(0, 300));

  // ---------- 5. 收入流 500 ----------
  const fab2 = await page.$(".fab");
  await fab2.tap();
  await sleep(2500);
  page = await mini.currentPage();
  await waitFor(async () => { const x = await page.data(); return !x.loading ? x : null; }, 10000);
  const segs = await page.$$(".segmented__btn");
  await segs[1].tap();
  await sleep(500);
  d = await page.data();
  R.check("T1-21", "切到收入且分类切换", d.type === "in" && d.cats.length > 0, "type=" + d.type + " cats=" + d.cats.length);
  const amountEl3 = await page.$(".amount-input");
  await amountEl3.input("500");
  const noteEl3 = await page.$(".field-row__val input");
  if (noteEl3) await noteEl3.input("QA收入测试");
  await sleep(300);
  const saveBtn3 = await page.$(".btn--block");
  await saveBtn3.tap();
  await sleep(3500);
  page = await mini.currentPage();
  d = await waitFor(async () => {
    const x = await page.data();
    const it = x.groups[0] && x.groups[0].items.find((i) => i.in && !String(i.id).startsWith("pending-"));
    return it ? x : null;
  }, 12000);
  const inRow = d && d.groups[0].items.find((i) => i.in);
  R.check("T1-22", "收入出现在首页列表(+500)", !!inRow && inRow.amount.includes("500"), inRow && JSON.stringify(inRow));
  R.check("T1-23", "月度概要收入=500", d && d.summary.income.includes("500"), d && JSON.stringify(d.summary));

  const txn3 = await page.$(".txn");
  await txn3.tap();
  await sleep(2500);
  page = await mini.currentPage();
  d = await waitFor(async () => { const x = await page.data(); return x.d ? x : null; }, 10000);
  R.check("T1-24", "收入详情正确(+500/收入)", d && d.d.isIn && d.d.displayAmount.includes("500"), d && JSON.stringify({ amt: d.d.displayAmount, type: d.d.type }));
  const delBtn2 = await page.$(".action-bar .btn--danger");
  await delBtn2.tap(); await sleep(400); await delBtn2.tap();
  await sleep(3000);
  page = await mini.currentPage();
  d = await waitFor(async () => { const x = await page.data(); return !x.loading && x.groups.length === 0 ? x : null; }, 10000);
  R.check("T1-25", "收入删除后列表恢复为空", !!d);

  R.save(errors);
  console.log("CONSOLE_ERRORS:" + JSON.stringify(errors).slice(0, 3000));
  await mini.disconnect();
})().catch((e) => { console.error("T1 FATAL:", e.message, e.stack); process.exit(1); });