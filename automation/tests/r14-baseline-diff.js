// R14 基线比对：新一轮 t1/t2/t3 结果 vs report/baseline/ 基线，逐条比 ok 与 detail
const fs = require("fs");
const path = require("path");
const REPORT = path.join(__dirname, "..", "report");
const BASE = path.join(REPORT, "baseline");

const files = ["t1-core-flow.json", "t2-multicurrency.json", "t3-stats.json"];
let sameOk = 0, diffOk = 0, sameDetail = 0, diffDetail = 0;
const diffs = [];

for (const f of files) {
  const b = JSON.parse(fs.readFileSync(path.join(BASE, f), "utf8"));
  const n = JSON.parse(fs.readFileSync(path.join(REPORT, f), "utf8"));
  const bm = {}; b.results.forEach((r) => { bm[r.id] = r; });
  const nm = {}; n.results.forEach((r) => { nm[r.id] = r; });
  const ids = Array.from(new Set([...Object.keys(bm), ...Object.keys(nm)])).sort();
  console.log("\n===== " + f + " (基线 " + b.results.length + " 条 / 本轮 " + n.results.length + " 条) =====");
  for (const id of ids) {
    const B = bm[id], N = nm[id];
    if (!B || !N) { diffs.push({ f, id, kind: "用例数量不同", base: B ? "有" : "无", now: N ? "有" : "无" }); console.log("  [" + id + "] 用例只存在于一侧"); continue; }
    if (B.ok === N.ok) sameOk++; else { diffOk++; diffs.push({ f, id, kind: "PASS/FAIL 变化", desc: B.desc, base: B.ok, now: N.ok, baseDetail: B.detail, nowDetail: N.detail }); }
    if (B.detail === N.detail) sameDetail++;
    else { diffDetail++; diffs.push({ f, id, kind: "detail 差异", desc: B.desc, baseDetail: B.detail, nowDetail: N.detail }); }
  }
  console.log("  基线 consoleErrors=" + (b.consoleErrors || []).length + " 本轮=" + (n.consoleErrors || []).length);
}

console.log("\n########## 汇总 ##########");
console.log("ok 状态一致 " + sameOk + " 条，变化 " + diffOk + " 条");
console.log("detail 完全一致 " + sameDetail + " 条，有差异 " + diffDetail + " 条");
console.log("\n########## 逐条差异 ##########");
diffs.forEach((d) => {
  console.log("\n[" + d.f + " " + d.id + "] " + d.kind + (d.desc ? " :: " + d.desc : ""));
  if (d.kind === "PASS/FAIL 变化") console.log("   基线 ok=" + d.base + " -> 本轮 ok=" + d.now);
  console.log("   基线 detail: " + JSON.stringify(d.baseDetail));
  console.log("   本轮 detail: " + JSON.stringify(d.nowDetail));
});
fs.writeFileSync(path.join(REPORT, "baseline-diff.json"), JSON.stringify({ at: new Date().toISOString(), sameOk, diffOk, sameDetail, diffDetail, diffs }, null, 2));
