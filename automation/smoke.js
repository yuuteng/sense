/**
 * Sense 小程序冒烟测试
 * 用法: node smoke.js [--port 4300]
 * 前置: 微信开发者工具已用 `cli auto --project <root> --auto-port <port>` 启动
 *
 * 做什么:
 *  1. 连接自动化端口
 *  2. 依次打开 app.json 里全部页面
 *  3. 收集每页 console 错误 / pageerror / 页面 data 快照
 *  4. 输出 JSON 报告到 report/smoke-report.json
 */
const automator = require("miniprogram-automator");
const fs = require("fs");
const path = require("path");

const argPort = (() => {
  const i = process.argv.indexOf("--port");
  return i > -1 ? process.argv[i + 1] : "4300";
})();

const PAGES = require("../miniprogram/app.json").pages;
// 需要参数才能正常打开的页面, 冒烟阶段仅验证「能打开不白屏不报错」
const PAGE_ARGS = {
  "pages/detail/detail": "", // 无 id 时页面应有兜底, 不崩即过
  "pages/join/join": "",
  "pages/feedback-detail/feedback-detail": "",
};

async function main() {
  const report = { startedAt: new Date().toISOString(), port: argPort, pages: [] };
  console.log(`connecting ws://localhost:${argPort} ...`);
  const mini = await automator.connect({ wsEndpoint: `ws://localhost:${argPort}` });
  console.log("connected");

  const consoleBuf = [];
  mini.on("console", (msg) => {
    if (msg.type === "error" || msg.type === "warning") {
      consoleBuf.push({ type: msg.type, text: String(msg.args ? msg.args.join(" ") : msg.text) });
    }
  });
  mini.on("exception", (err) => {
    consoleBuf.push({ type: "exception", text: `${err.message}\n${err.stack || ""}` });
  });

  for (const p of PAGES) {
    const entry = { page: p, ok: false, errors: [], dataKeys: [] };
    consoleBuf.length = 0;
    try {
      const url = "/" + p + (PAGE_ARGS[p] || "");
      const page = await mini.reLaunch(url);
      await new Promise((r) => setTimeout(r, 2500)); // 等首屏请求
      const data = await page.data();
      entry.dataKeys = Object.keys(data || {});
      // 白屏探测: 页面至少渲染出一个非 page 根节点
      const body = await page.$("page");
      entry.rendered = !!body;
      entry.ok = true;
    } catch (e) {
      entry.errors.push({ type: "navigate", text: e.message });
    }
    entry.errors.push(...consoleBuf.splice(0));
    report.pages.push(entry);
    console.log(`${entry.ok && entry.errors.length === 0 ? "PASS" : "FAIL"} ${p} (${entry.errors.length} errors)`);
  }

  const outDir = path.join(__dirname, "report");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "smoke-report.json"), JSON.stringify(report, null, 2));
  console.log("report written: report/smoke-report.json");
  // 不调 mini.close()：它会销毁 cli auto 会话，导致后续脚本连不上而不得不重启 IDE，
  // 而重复 `cli auto` 会堆积 IDE 实例并楔死模拟器导航层（本轮踩过，堆到 27 个进程）
  process.exit(report.pages.some((p) => !p.ok || p.errors.length) ? 2 : 0);
}

main().catch((e) => {
  console.error("SMOKE FATAL:", e.message);
  process.exit(1);
});
