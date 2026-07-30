// QA 测试公共库：连接 / 错误收集 / 云函数直调（仅用于前置与清理）/ 结果记录
const automator = require("miniprogram-automator");
const fs = require("fs");
const path = require("path");

const REPORT_DIR = path.join(__dirname, "..", "report");
const STATE_FILE = path.join(REPORT_DIR, "qa-state.json");
const QA_BOOK = "QA测试账本";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function connect() {
  let mini;
  try {
    mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });
  } catch (e) {
    console.log("connect failed, retry in 3s:", e.message);
    await sleep(3000);
    mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });
  }
  const errors = [];
  mini.on("console", (msg) => {
    if (msg.type === "error" || msg.type === "warning") {
      errors.push({ type: msg.type, text: String(msg.args ? msg.args.join(" ") : msg.text) });
    }
  });
  mini.on("exception", (err) => {
    errors.push({ type: "exception", text: (err.message || "") + "\n" + (err.stack || "") });
  });
  // 白屏自愈：IDE 重启后偶发 app service 已起但页面栈为空，从 app 内部 reLaunch 一次
  try {
    const stack = await mini.pageStack();
    if (!stack.length) {
      console.log("empty page stack, warm up via wx.reLaunch");
      await mini.evaluate(() => { wx.reLaunch({ url: "/pages/home/home" }); });
      await sleep(4000);
    }
  } catch (e) {
    try {
      await mini.evaluate(() => { wx.reLaunch({ url: "/pages/home/home" }); });
      await sleep(4000);
    } catch (e2) { console.log("warmup failed: " + e2.message); }
  }
  return { mini, errors };
}

// 云函数直调（在 app service 上下文执行）
async function apiCall(mini, resource, type, params = {}) {
  return await mini.evaluate(
    (resource, type, params) =>
      new Promise((resolve) => {
        wx.cloud
          .callFunction({ name: "api", data: { ...params, resource, type, envVersion: "develop" } })
          .then((res) => resolve(res.result))
          .catch((err) => resolve({ success: false, code: "CALL_FAIL", errMsg: err && err.errMsg }));
      }),
    resource,
    type,
    params
  );
}

// 导航与取页带重试：devtools 自动化偶发 rawPath/timeout 抖动
async function goto(mini, url, attempts = 4) {
  const want = url.split("?")[0].replace(/^\//, "");
  for (let i = 0; i < attempts; i++) {
    try {
      const p = await mini.reLaunch(url);
      if (p) return p;
    } catch (e) { console.log("goto retry " + i + " " + url + " :: " + e.message); }
    await sleep(2500);
    try {
      const p = await mini.currentPage();
      if (p && p.path === want) return p;
    } catch (e2) { /* ignore */ }
  }
  throw new Error("goto failed: " + url);
}

async function curPage(mini, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try { const p = await mini.currentPage(); if (p) return p; } catch (e) { console.log("curPage retry: " + e.message); }
    await sleep(1500);
  }
  throw new Error("currentPage failed");
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch (e) { return {}; }
}
function saveState(patch) {
  const s = { ...loadState(), ...patch };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  return s;
}

function makeRecorder(name) {
  const results = [];
  return {
    results,
    check(id, desc, ok, detail) {
      results.push({ id, desc, ok: !!ok, detail: detail === undefined ? "" : String(detail) });
      console.log((ok ? "PASS" : "FAIL") + " [" + id + "] " + desc + (ok ? "" : " :: " + (detail || "")));
    },
    save(errors) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(REPORT_DIR, name + ".json"),
        JSON.stringify({ name, at: new Date().toISOString(), results, consoleErrors: errors || [] }, null, 2)
      );
    },
  };
}

async function waitFor(fn, timeout = 10000, interval = 500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { /* 继续轮询 */ }
    await sleep(interval);
  }
  return null;
}

module.exports = { connect, sleep, apiCall, goto, curPage, loadState, saveState, makeRecorder, waitFor, QA_BOOK, REPORT_DIR };