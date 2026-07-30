// 探针：验证连接 + evaluate 云函数直调 + 记录当前默认账本
const { connect, apiCall, saveState } = require("./lib");

(async () => {
  const { mini } = await connect();
  console.log("connected");
  const cur = await apiCall(mini, "book", "getCurrent", {});
  console.log("getCurrent:", JSON.stringify(cur));
  const list = await apiCall(mini, "book", "list", {});
  console.log("book.list:", JSON.stringify((list.data || []).map((b) => ({ id: b.bookId, name: b.name, type: b.type }))));
  if (cur && cur.success && cur.data) {
    saveState({ origBookId: cur.data.bookId, origBookName: cur.data.name });
    console.log("saved origBookId:", cur.data.bookId);
  }
  await mini.disconnect();
})().catch((e) => { console.error("PROBE FATAL:", e.message); process.exit(1); });
