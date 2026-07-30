/**
 * 最小 navigateBack 探针：不涉及保存、不涉及本轮任何改动
 * home -> navigateTo(add) -> navigateBack -> 是否回到 home
 * 零写操作。
 */
const automator = require("miniprogram-automator");

(async () => {
  const mini = await automator.connect({ wsEndpoint: "ws://localhost:4300" });

  await mini.reLaunch("/pages/home/home");
  await new Promise((r) => setTimeout(r, 2000));
  let stack = await mini.pageStack();
  console.log("1. reLaunch home  -> 栈:", stack.map((p) => p.path).join(" > "));

  await mini.navigateTo("/pages/add/add");
  await new Promise((r) => setTimeout(r, 2000));
  stack = await mini.pageStack();
  console.log("2. navigateTo add -> 栈:", stack.map((p) => p.path).join(" > "));
  const pushed = stack.length === 2;

  await mini.navigateBack();
  await new Promise((r) => setTimeout(r, 2000));
  stack = await mini.pageStack();
  console.log("3. navigateBack   -> 栈:", stack.map((p) => p.path).join(" > "));
  const popped = stack.length === 1 && stack[0].path === "pages/home/home";

  console.log("\nnavigateTo 正常:", pushed);
  console.log("navigateBack 正常:", popped, popped ? "" : "  <== 故障复现");
  process.exit(popped ? 0 : 2);
})().catch((e) => {
  console.error("PROBE FAIL:", e.message);
  process.exit(1);
});
