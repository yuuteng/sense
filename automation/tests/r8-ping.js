const automator = require("miniprogram-automator");
(async () => {
  let mini;
  try {
    mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });
    console.log("connected ok");
  } catch (e) { console.log("CONNECT FAIL:", e.message); process.exit(2); }
  try {
    const stack = await Promise.race([
      mini.pageStack(),
      new Promise((_r, rj) => setTimeout(() => rj(new Error("pageStack timeout 15s")), 15000)),
    ]);
    console.log("pageStack:", JSON.stringify(stack.map((p) => p.path)));
  } catch (e) { console.log("PAGESTACK FAIL:", e.message); }
  try {
    const v = await Promise.race([
      mini.evaluate(() => 1 + 1),
      new Promise((_r, rj) => setTimeout(() => rj(new Error("evaluate timeout 15s")), 15000)),
    ]);
    console.log("evaluate 1+1 =", v);
  } catch (e) { console.log("EVALUATE FAIL:", e.message); }
  try { await mini.disconnect(); } catch (e) {}
})();
