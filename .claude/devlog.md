# 心数 / Sense · 开发变更记录（devlog）

> 本文件记录项目的重大改动，按日期倒序（最新在上）。每次完成重要功能或每天收尾时追加一条。
> 约定：日期用绝对日期；每条尽量简明，列出「做了什么 + 涉及范围」。细节以 git 提交历史为准。

---

## 2026-07-02

**安全加固（准备公开仓库）**
- 危险脚本（`seed.run` 清库重灌）改由云函数环境变量 **`APP_ENV=dev`** 控制：默认 prod → 禁用，公开仓库也无法被利用；开发时控制台设 `APP_ENV=dev` 即可，一次配置长期有效，无需改代码/管 openid。
- 云环境 ID 视为可公开（云资源仍需微信鉴权），保留直接写在 `app.js`，日常开发无额外文件负担。
- 备注：曾短暂用 config.js/secret.js 双文件方案，因日常开发繁琐已回退为上面的 `APP_ENV` 开关。真实密钥（AI key/AppSecret）仍应走云函数环境变量，不入代码。

**登录与关键逻辑修复（11 项）**
- 新增微信授权登录页 `pages/login`（chooseAvatar 头像 + nickname 昵称，上传云存储），登录态由 `users.registered` 标记；可在设置页改昵称、在账本设置页改「我在该账本的名字」。
- 首页闸门：未注册 → 登录页；已注册无账本 → 引导创建页（不再进空首页）。
- 账本管理拆分：新增 `pages/bookConfig`，点某账本进入其**独立**配置页（成员/编辑信息/管理分类/设默认/分账/解散）；修复「解散账本误删第一个账本」的 bug（严格按 bookId）。`books` 页只剩列表。
- 记账页：金额改用系统数字键盘（`input type=digit` + 净化）；日期用 `picker`；图片去掉默认图、支持选图上传云存储、详情页渲染真实图；记录人固定为当前用户、仅保留付款人单选；收/支切换时整页配色切换（收入转绿）。
- 修复新建账本名称无法编辑（受控 input 未 setData）。
- 导航栏适配微信右上角胶囊按钮，避免遮挡（`getMenuButtonBoundingClientRect`）。
- 实现导入导出：`data.export`（JSON，前端转发/复制）、`data.import`（选 JSON 文件入库）。
- 后端加自举建集合 + 汇率缺失回退；`/html-to-miniprogram` skill 补充胶囊避让、受控输入、系统键盘等坑。

**视觉：Alan 风格移植**
- 令牌层改暖奶油底 + Alan 蓝 + 暖近黑；新增柔和分层阴影与弹性缓动；卡片去硬边加阴影、按钮胶囊化、FAB/主按钮彩色投影。涉及 `app.wxss`、`custom-tab-bar`、`app.json`。

**工程**
- 删除 quickstart 模板残留图片目录（1.3MB，超 200KB 告警）。
- 初始化 git、补 README 与 .gitignore、建立本 devlog。

## 2026-07-01

**后端接入 + 测试数据**
- 新增云函数 `cloudfunctions/api`（单入口 `{resource,type}` 路由）：book/member/category/record/rate/stats/layout/ai/settings/user/data/settle/seed。服务端 OPENID 鉴权、可见性/角色校验、记账当日汇率固化。
- 设计并落地 8 个云数据库集合（见 docs/sql.md）；`seed.run` 一键建集合 + 载入测试数据（把调用者绑为演示用户「小雨」）。
- 前端各页从 mock 切换为真实接口调用，新增 `utils/api.js`（调用封装）、`utils/format.js`（金额/日期格式化），移除 `utils/mock.js`。
- 输出设计文档 `docs/sql.md`、`docs/api.md`、`数据与接口梳理.md`。

**前端页面全量搭建**
- 按 `design/` 10 个 HTML 原型转出 9 个小程序页面（home/add/detail/stats/ai/books/settings/onboarding/settle）+ 自定义 `nav-bar`、`custom-tab-bar`、SVG 图标库；从 quickstart 模板重构而来。
- 建立 `/html-to-miniprogram` skill 固化转换流程与陷阱。
</content>
