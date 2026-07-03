# 心数 / Sense · 开发变更记录（devlog）

> 本文件记录项目的重大改动，按日期倒序（最新在上）。
> 约定：日期用绝对日期；每条尽量简明，列出「做了什么 + 涉及范围」。细节以 git 提交历史为准。

---

## 2026-07-03

**多币种模型重构（核心）**
- 纠正金额模型：真值 = 原始金额 + 原始币种 + 日期；任意展示币种都用「该记录当日」的汇率经 CNY 枢轴换算，结果随记录日期固化、不随今日汇率漂移（旧逻辑是固化到基准币再用最新汇率乘系数，会漂移且详情汇率锁死 orig→CNY）。新增 `loadRateIndex/quotesAt/recCny/recToDisplay`；`record.list/get`、`stats._compute/getChartData` 全改逐笔当日换算。
- `isForeign` 改判「原币 ≠ 展示币」（原来判 ≠ 基准币）：展示币=原币时不再显示"原"；展示其他币种才显示原始金额。
- 详情页显示「原币 → 展示币」当日汇率，随展示币种变化（不再锁死 EUR→CNY）。
- 汇率懒加载：库里无 CNY 快照时首次换算自动拉实时汇率入库（`fetchAndStoreCnyQuotes`，`rate._refresh` 复用）。

**统计页重做 + 顶部统一**
- 图表实例化：可重复添加同类型、上移/下移（取代拖拽）、删除、区间 chips（近 7/14/30 日、6/12 月）；后端 `stats.getChartData` 返回原始序列（近 30 日逐日 + 近 12 月逐月 + 本/累计饼），前端切片渲染，增删/改区间本地即时、按账本×用户持久化。
- 顶部与首页统一：账本切换用同一 `book-switcher`；展示币种改为**黄色胶囊按钮**（点开 `currency-picker` 切换，写 settings 并刷新）；`sticky-header` 常驻不随滚动消失；账本名左加账本图标。home/stats/ai 三个 tab 头部一致。

**AI 预填可编辑并真正入账**
- `parseText/parseReceipt` 额外返回结构化 `draft`；卡片按钮「编辑并记账」跳记账页预填（金额/类型/币种/分类/日期/备注，按"父 / 子"文字匹配分类）→ 保存走 `record.create` 真正写库；新增收入关键词识别（工资/奖金/红包…）。

**首页交易行**
- 外币记录：原始金额移到右侧**黄色胶囊**「原€5.40」+ 当日汇率同一行；中间只留头像 + 记录人名字（去掉尾部"记"）；分类为空不再显示悬空「· 」，标题空则退化为收入/支出。

**记账页**
- 新增一级分类的图标从 16 扩到 **30 个（6 列 × 5 行铺满）**。录入默认币种跟随展示币种。

**清空数据修复**
- `seed.reset`/`seed.run` 清空改用 `clearCollection` **循环删空**（云函数端 `where().remove()` 单次有批量上限，只调一次会残留）；`reset` 返回每集合 removed/remaining，前端在有残留时提示"部分未清空，请再点一次"。

**约定**
- devlog 改为每天一条、次日开工补记前一天；git 仍不自动提交。

## 2026-07-02

**视觉 / 换肤**
- 最终采用用户 Figma「FPS」色卡整体换肤（先前一版 Alan 暖奶油/蓝方案已被取代）。新增 `docs/design-tokens.md` 为唯一配色事实来源。
- `app.wxss` `page{}` 重建令牌层：完整 FPS 色卡（grey/blue/primary/creation/secondary/语义色）+ 语义别名。关键：`--bg`#f6f9fc、`--fg`#3e4550、`--accent`#00ccf9（主色填充）、`--accent-ink`#0089c0（蓝色文字/图标，blue-400 对比不足）、`--success`#9edf10（填充）/`--success-strong`#5c9a0e（绿色文字）、`--warn`#ffcd2f、`--danger`#f62172；阴影改 FPS 冷灰。
- 全量替换预算 rgba/hex（旧蓝→#00ccf9、中性→冷灰、旧绿/黄/红 tint→新语义色）；所有作文字用的 `color: var(--accent)` 改 `--accent-ink`；各 JS `icons.get()` 颜色、custom-tab-bar、nav-bar、avatar 默认色、app.json 主题色、loading/calendar/currency-picker 组件色全部对齐。
- 首页顶部统计卡重设计为 FPS 深蓝 hero（`#035599→#0089c0` 渐变 + 青色光晕）；记账条目图标底色：支出=蓝、收入=绿。

**统计页**
- 删「本月收支概览」（与首页重复）；改为 4 张真实数据图表——本月收支饼、近 N 日支出柱状、近 N 月收入vs支出分组柱、账本累计收支饼。新增后端 `stats.getCharts`（可传 `weekDays`/`yearMonths`，均按展示币种换算）；前端 SVG 现算（donut/bars/paired）。
- 标题居中（nav-bar center）；新增「添加图表」预设选择（ActionSheet），保留删除/拖拽排序；近 N 日 7/14/30、近 N 月 6/12 区间 chips 可切换重取。`DEFAULT_LAYOUT` 改新 id，旧布局自动回退默认。

**汇率 / 展示币种**
- 展示币种切换真实换算：新增 `latestCnyQuotes`/`convFactor`（以 CNY 快照为枢轴，base→display）。`record.list` 按前端 `currency` 换算每笔与分组合计并回传 `displayCurrency`；`stats._compute`/`getMonthlySummary`/`getDashboard` 传 ctx 取用户展示币种换算（口径换算，不改历史每笔，符合 PRD）。「本月」改为当前自然月（北京时间）。
- 汇率更新改为每日定时触发器（`config.json` cron 06:30 调 `rate._refresh`），手动「刷新汇率」保留；记账当日汇率固化。`getRate` 回退最近含该币种快照，`record.create/update` 兜底用前端已展示汇率。汇率提示文案改为「约 ¥766.16（1 EUR ≈ ¥7.84）」。

**记账 / 录入 / 编辑页**
- 实现编辑记录：detail 传 recordId → add 读 `record.get` 预填（金额/类型/币种/分类/日期/图片/付款人/分摊），保存走 `record.update`；修「编辑进来金额为 0」。
- 收支切换 onLoad 一次性预加载 expense+income 缓存，切换瞬时；收/支整页配色切换。
- 分类可用户自定义（一级九宫格/二级 chips 末尾「添加」，持久化到账本，创建后自动选中）；一级新增支持选图标（弹层）；长按停用（软删，历史保留原名）。权限：新增/停用放宽到 rw，重命名/排序仍 owner/admin（PRD 权限矩阵与 4.4 同步）。
- 金额改系统数字键盘（`type=digit` + 净化）；日期改自定义 `components/calendar`；币种改自定义 `components/currency-picker` 底部弹层（替换原生小字滚轮）。
- 记账页 loading 反复调整后最终整套移除（曾做全屏遮罩 + `page-meta` 锁滚 + `wx:if` 闸门，因卡住阻塞开发而拆除）；保存反馈用原生 `wx.showLoading({mask:true})`。修金额输入框卡成灰框：去 `always-embed` + 延时 350ms 聚焦。

**AI 预填**
- 修正预填卡：日期用 `relDate()` 按北京时间相对今天算（修「昨天=6/30」）；记录人取当前用户（membersMap，修「小雨」）；去掉付款人只留记录人；分类匹配到二级；新增收入关键词识别（工资/奖金/红包… → 收入 + 对应分类，修「工资算支出」）。
- 注：AI 仍是关键词占位；预填卡「改」编辑与「确认真正入账」尚未实现（待真 AI）。

**账本 / onboarding / 成员 / 登录**
- 修建账本报错「未知接口:book.share」：账本类型字段与路由 `type` 撞名，改用 `bookType`。`book.create` 为新账本注入默认两级分类。
- onboarding 最终定为「字段撑满上半屏」（品牌左上、按钮吸底；曾试居中卡片式被弃）；账本类型改名「共享账本 / 分账账本」，描述精简；「基准币种」→「统计币种」。
- 新增微信授权登录页 `pages/login`（头像 + 昵称上传云存储，`users.registered` 标记登录态）；首页闸门（未注册→登录、无账本→引导）。账本管理拆分出 `pages/bookConfig`（独立配置：成员/信息/设默认/分账/解散），修「解散误删第一个账本」；「设为默认」改明确按钮。
- 身份数据源统一为 `users`：`membersMap`/`member.list`/`record.*`/`settle` join users 取实时昵称+头像，改资料各处自动更新；`member.rename` 写 `nameOverride`。新增 `components/avatar`（照片缺失回退彩色首字母）。昵称限长 20。邀请改微信分享卡片 + `pages/join` 落地页 + 后端 `member.join`（默认读写）。
- 账本数修复：`user.getProfile` 的 bookCount 改为「我参与且仍存在的账本去重计数」，修虚高（显示 2 本）。

**导入导出**
- 导出改为「选格式(Excel/CSV/JSON/PDF) → 后端生成真实文件传云存储(fileID) → 前端下载预览/转发」。Excel 用 `xlsx`，CSV 带 BOM，PDF 暂「开发中」。导入选 JSON 文件入库。

**数据模型 / 安全 / 工程**
- 移除 members 冗余 `nameCache`/`avatarInitial`；records 加审计字段 `createdBy`/`updatedBy`，`updatedAt` 创建即写。`seed.reset` 清空全部 8 集合（含 users，需重登）。默认头像色统一 `#00ccf9`。
- 安全加固（准备公开仓库）：危险脚本 `seed.run`/`reset`/`rate.refresh` 由云函数环境变量 `APP_ENV=dev` 控制，默认 prod 禁用；云环境 ID 视为可公开保留在 `app.js`；真实密钥走云函数环境变量。
- 修 `index.js` `event1` 笔误（会导致云函数每次崩溃）；nav-bar 适配右上角胶囊避让、标题绝对整屏居中。删 quickstart 残留图片目录；初始化 git、补 README/.gitignore；建立 `/html-to-miniprogram` skill。

## 2026-07-01

**后端接入 + 测试数据**
- 新增云函数 `cloudfunctions/api`（单入口 `{resource,type}` 路由）：book/member/category/record/rate/stats/layout/ai/settings/user/data/settle/seed。服务端 OPENID 鉴权、可见性/角色校验、记账当日汇率固化。
- 设计并落地 8 个云数据库集合（见 docs/sql.md）；`seed.run` 一键建集合 + 载入测试数据（把调用者绑为演示用户「小雨」）。
- 前端各页从 mock 切换为真实接口调用，新增 `utils/api.js`（调用封装）、`utils/format.js`（金额/日期格式化），移除 `utils/mock.js`。
- 输出设计文档 `docs/sql.md`、`docs/api.md`、`数据与接口梳理.md`。

**前端页面全量搭建**
- 按 `design/` 10 个 HTML 原型转出 9 个小程序页面（home/add/detail/stats/ai/books/settings/onboarding/settle）+ 自定义 `nav-bar`、`custom-tab-bar`、SVG 图标库；从 quickstart 模板重构而来。
- 建立 `/html-to-miniprogram` skill 固化转换流程与陷阱。
