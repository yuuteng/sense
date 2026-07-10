# 心数 / Sense · 后端接口设计

> 技术栈：微信云开发**云函数**。数据库集合见 [sql.md](sql.md)，业务规则见 [../Sense-PRD.md](../Sense-PRD.md)。
> **本文只做接口设计，不含实现代码。**

---

## 〇、通用约定

### 调用方式
按领域拆多个云函数，每个云函数内部用 `event.type` 分发（沿用 [../CLAUDE.md](../CLAUDE.md) 的模式）：
```js
wx.cloud.callFunction({
  name: 'record',           // 云函数名（领域）
  data: { type: 'create', bookId: 'book-home', payload: { ... } }
})
```

### 统一返回结构
```json
// 成功
{ "success": true, "data": { ... } }
// 失败
{ "success": false, "code": "NO_PERMISSION", "errMsg": "无权操作" }
```

### 身份与鉴权
- 用户身份来自云函数上下文 `cloud.getWXContext().OPENID`，**前端不传身份、后端不信任前端身份**。
- 所有涉及账本的接口先校验：调用者是否为该账本 `members`（决定可见性）+ 角色是否满足操作（决定权限）。
- 权限矩阵见 PRD 第三节；关键点：读写成员只能改/删自己的记录，admin/owner 可改全部；只读成员无写权限。

### 通用错误码
| code | 含义 |
|---|---|
| `UNAUTHENTICATED` | 未获取到 openid |
| `NOT_MEMBER` | 非该账本成员（不可见） |
| `NO_PERMISSION` | 角色权限不足 |
| `NOT_FOUND` | 目标不存在 |
| `INVALID_PARAM` | 参数校验失败 |
| `RATE_UNAVAILABLE` | 汇率取不到且无回退 |

### 分期标记
🟢 P1（MVP 必需）｜🟡 P2（分账结算）｜⚪ 可延后

---

## 1. 云函数 `book`（账本）

| type | 分期 | 描述 | 权限 |
|---|---|---|---|
| `list` | 🟢 | 我加入的账本列表 | 登录用户 |
| `getCurrent` | 🟢 | 当前/默认账本 + 我的展示币种 | 成员 |
| `create` | 🟢 | 新建账本 | 登录用户 |
| `update` | 🟢 | 编辑账本信息 | owner/admin |
| `setDefault` | 🟢 | 设为默认账本 | 成员 |
| `dissolve` | 🟢 | 解散账本 | 仅 owner |

**book.list** → 返回
```json
{ "success": true, "data": [
  { "bookId": "book-home", "name": "家庭日常", "type": "share", "myRole": "owner", "isDefault": true, "isCurrent": true, "memberCount": 2 },
  { "bookId": "book-jp", "name": "日本旅行 2026", "type": "split", "myRole": "admin", "isDefault": false, "isCurrent": false, "memberCount": 3 }
] }
```
**book.create** 入参 `{ name, type: "share"|"split", baseCurrency }` → `{ bookId }`（创建者自动成为 owner 并写一条 `members`，若为首个账本则设为默认；建议同时写入预设分类）。
**book.update** 入参 `{ bookId, name }`。
**book.dissolve** 入参 `{ bookId }`（级联删除/归档该账本 records/members/categories，二次确认在前端）。

---

## 2. 云函数 `member`（成员与权限）

| type | 分期 | 描述 | 权限 |
|---|---|---|---|
| `list` | 🟢 | 账本成员列表 | 成员 |
| `invite` | 🟢 | 生成微信邀请（分享参数） | owner/admin |
| `join` | 🟢 | 通过邀请加入账本 | 被邀请者 |
| `updateRole` | 🟢 | 修改成员角色 | owner/admin |
| `remove` | 🟢 | 移除成员 | owner/admin |

**member.list** 入参 `{ bookId }` → 
```json
{ "success": true, "data": [
  { "openid": "openid-yu", "name": "小雨", "avatarInitial": "雨", "avatarColor": "#2f6feb", "role": "owner", "joinedAt": "2025-09-01", "isMe": true },
  { "openid": "openid-zhe", "name": "阿哲", "avatarInitial": "哲", "avatarColor": "#17a34a", "role": "admin", "joinedAt": "2025-11" }
] }
```
**member.invite** 入参 `{ bookId }` → `{ inviteToken, expireAt }`（前端用于微信分享卡片）。
**member.updateRole** 入参 `{ bookId, openid, role: "rw"|"ro"|"admin" }` → ok。规则：admin 不能改 owner、不能任命/取消 admin（仅 owner 可）。
**member.remove** 入参 `{ bookId, openid }`；admin 不能移除 owner/其他 admin。

---

## 3. 云函数 `category`（分类）

| type | 分期 | 描述 | 权限 |
|---|---|---|---|
| `list` | 🟢 | 账本分类树（按 kind） | 成员 |
| `create` | 🟢 | 新增分类 | owner/admin |
| `update` | 🟢 | 重命名/调序 | owner/admin |
| `disable` | 🟢 | 停用（不硬删） | owner/admin |

**category.list** 入参 `{ bookId, kind: "expense"|"income" }` → 两级树
```json
{ "success": true, "data": [
  { "categoryId": "cat-food", "name": "餐饮", "icon": "dining", "children": [
    { "categoryId": "cat-food-dinner", "name": "晚餐" },
    { "categoryId": "cat-food-takeout", "name": "外卖" }
  ] }
] }
```

---

## 4. 云函数 `record`（记账记录）

| type | 分期 | 描述 | 权限 |
|---|---|---|---|
| `list` | 🟢 | 账本记录列表（分页/按天分组，按展示币种） | 成员 |
| `get` | 🟢 | 单条详情（含权限标记） | 成员 |
| `create` | 🟢 | 新增记录（固化汇率） | rw 及以上 |
| `update` | 🟢 | 编辑记录 | 本人 / admin / owner |
| `delete` | 🟢 | 删除记录 | 本人 / admin / owner |

**record.list** 入参 `{ bookId, currency, page, pageSize, dateFrom?, dateTo?, type?, categoryTopId?, withSummary? }` → 
```json
{ "success": true, "data": {
  "groups": [
    { "date": "2026-07-01", "total": -299.50, "items": [
      { "recordId": "r-1", "type": "expense", "categoryPath": "餐饮 / 外卖", "icon": "dining",
        "amountConverted": 86.00, "currency": "CNY", "originalAmount": 86.00,
        "recorderName": "小雨", "payerName": "小雨", "isForeign": false }
    ] }
  ],
  "hasMore": false,
  "page": 0,
  "summary": { "income": 0, "expense": 1234.50, "count": 18 }
} }
```
> `total`/`amount*` 为数值，前端加符号与千分位格式化。`isForeign=true` 时前端显示原始币种 pill 与「按 X 汇率」。
> 筛选参数供统计钻取（records 页）使用：`dateFrom/dateTo` 日期范围；`type` 限收/支；`categoryTopId` 顶级分类（自动包含其子分类，`"_none"` 表示未分类）；`withSummary=true` 时返回跨全部分页的 `summary`（与图表同口径：按日聚合 × 记录当日汇率）。

**record.get** 入参 `{ recordId }` → 
```json
{ "success": true, "data": {
  "recordId": "r-4", "type": "expense", "categoryPath": "餐饮 / 咖啡", "date": "2026-06-30 08:12",
  "originalAmount": 5.40, "currency": "EUR", "rate": 7.83, "amountConverted": 42.30, "baseCurrency": "CNY",
  "note": "通勤路上的拿铁", "images": ["cloud://.../receipt-coffee.jpg"],
  "recorder": { "name": "小雨（我）", "avatarInitial": "雨", "avatarColor": "#2f6feb" },
  "payer": { "name": "小雨", "avatarInitial": "雨", "avatarColor": "#2f6feb" },
  "canEdit": true, "canDelete": true
} }
```

**record.create** 入参
```json
{ "bookId": "book-home", "payload": {
  "type": "expense", "amount": 18.90, "currency": "EUR", "date": "2026-07-01",
  "categoryId": "cat-shop-daily", "note": "超市", "images": ["cloud://..."],
  "recorderOpenid": "openid-yu", "payerOpenid": "openid-yu",
  "split": { "mode": "even", "members": ["openid-yu","openid-zhe"] }
} }
```
**后端职责**：查 `rates` 取 `date` 当日（或最近一次）汇率 → 计算并**固化** `rate`、`amountConverted`、`baseCurrency`，连同记录写库 → 返回 `{ recordId }`。前端不传汇率。

---

## 5. 云函数 `rate`（汇率）

| type | 分期 | 描述 |
|---|---|---|
| `getDaily` | 🟢 | 取某日汇率（用于录入页实时预览） |

**rate.getDaily** 入参 `{ date, base }` → 
```json
{ "success": true, "data": { "date": "2026-07-01", "base": "CNY", "quotes": { "CNY":1, "EUR":7.84, "USD":7.24, "JPY":0.0463 }, "isFallback": false } }
```
> 当日无数据时返回最近一次并置 `isFallback=true`，前端提示「汇率为最近一次数据」。汇率入库可由定时触发器每日拉取（⚪ 后续）。

---

## 6. 云函数 `stats`（统计）

| type | 分期 | 描述 | 权限 |
|---|---|---|---|
| `getMonthlySummary` | 🟢 | 本月收入/支出/结余 | 成员 |
| `getDashboard` | 🟢 | 统计页四类卡片数据 | 成员 |
| `getChartData` | 🟢 | 图表原始数据集（饼图 + 近30日逐日 + 建账以来逐月） | 成员 |
| `getCategoryData` | 🟢 | 某月按顶级分类聚合的收支占比（含子分类细分/笔数/百分比） | 成员 |

**stats.getChartData** 入参 `{ bookId }` → `{ displayCurrency, monthLabel, curMonth, firstMonth, monthPie: {income, expense}, totalPie: {...}, daily: [{date, label, income, expense}] (近30日), monthly: [{ym, label, income, expense}] (建账首月~当月连续，不足补齐近12月) }`
> `monthly` 覆盖全部历史月份：月度收支卡切任意月、收支趋势卡切区间均由前端切片，无需再请求。`firstMonth` 为月份选择器可选下限。

**stats.getCategoryData** 入参 `{ bookId, month: "2026-07" }` → 
```json
{ "success": true, "data": {
  "displayCurrency": "CNY", "month": "2026-07",
  "expense": { "total": 3357.80, "cats": [
    { "categoryId": "cat-food", "name": "餐饮", "icon": "dining", "total": 1201.30, "count": 21, "percent": 35.8,
      "subs": [ { "name": "外卖", "total": 520.00, "count": 9 } ] }
  ] },
  "income": { "total": 12000, "cats": [ "同上结构" ] }
} }
```
> 聚合方式：group by (日期 × 分类 × 类型) 后按记录当日汇率换算再归并到顶级分类，与其他图表口径完全一致；`categoryId` 为 `"_none"` 表示未分类记录。

**stats.getMonthlySummary** 入参 `{ bookId, month: "2026-07", currency }` → `{ income, expense, balance }`（数值）。
**stats.getDashboard** 入参 `{ bookId, currency }` → 
```json
{ "success": true, "data": {
  "overview": { "income": 12000, "expense": 3357, "balance": 8642.20, "monthLabel": "2026 年 7 月" },
  "trend":    { "unit": "day", "points": [95,70,105,55,80,40,65], "labels": ["6/25","...","今日"], "todayExpense": 299.50 },
  "year":     { "unit": "month", "series": [ { "income": 80, "expense": 50 }, ... ] },
  "total":    { "income": 128400, "expense": 96713, "balance": 31687.00, "since": "2025-09" }
} }
```
> 均只统计当前账本、按 `currency` 汇总。图表数值由前端画折线/柱状。

---

## 7. 云函数 `layout`（图表布局）

| type | 分期 | 描述 | 权限 |
|---|---|---|---|
| `get` | 🟢 | 我在该账本的卡片布局 | 成员 |
| `save` | 🟢 | 保存布局（顺序/可见集合） | 成员 |

**layout.get** 入参 `{ bookId }` → `{ order: ["overview","trend","year","total"] }`（无记录返回默认四卡）。
**layout.save** 入参 `{ bookId, order }` → ok。
> 替换前端当前的 `wx.storage` 方案；布局按「账本 + 用户」隔离。

---

## 8. 云函数 `ai`（AI 助手）

| type | 分期 | 描述 | 权限 |
|---|---|---|---|
| `listMessages` | 🟢 | 该账本会话历史（≤上限） | 成员 |
| `chat` | 🟢 | 统一入口：意图分流（记账句→预填卡 / 数据问答→基于聚合数据包回答 / 跑题→拒绝） | 成员（记账意图需 rw） |
| `parseText` | 🟢 | 关键词规则解析（chat 的降级兜底，前端已不直接调用） | rw 及以上 |
| `parseReceipt` | 🟢 | 收据图 → 预填记录（cloud.extend.AI 多模态） | rw 及以上 |
| `confirmDraft` | 🟢 | 预填卡「确认入账」：服务端解析分类 + 复用 record.create，回写卡片状态 | rw 及以上 |
| `setCardState` | 🟢 | 卡片状态回写（放弃等），仅本人消息 | 成员 |
| `appendMessage` | 🟢 | 追加会话（完整保留、不裁剪），返回 `{ id }` | 成员 |

**ai.listMessages** 入参 `{ bookId }` → 会话数组（结构见 sql.md `aiMessages`）。
**ai.chat** 入参 `{ bookId, text }` → `{ card }` 或 `{ answer }`。实现要点：
- 数字只来自服务端聚合的**紧凑数据包**（本月/累计/近12月/近30日/本月分类含子类/上月分类/本月成员，全部按展示币种、记录当日汇率口径），模型只能引用不能编造；
- **域限制**：只处理本账本记账与统计，其他话题（股票/百科/闲聊等）礼貌拒绝；
- 环境变量 `AI_PROVIDER`（默认 hunyuan-open）/ `AI_TEXT_MODEL`（默认 hunyuan-lite）；AI 未开通或调用失败时自动降级 parseNL 关键词解析。
- **用量额度（开关制）**：环境变量 `AI_FREE_QUOTA > 0` 时启用——免费用户累计 N 次真实模型调用（chat / parseReceipt 各计 1，成功才计），用尽后 chat 降级关键词解析、收据识别提示额度用完，`users.aiPaid=true` 不受限；**缺省/0 = 不限次数（当前默认），`ai.quota` 返回 `enabled:false`，前端隐藏额度文案**。无论开关，用量都在 `users.aiUsage` 累计。会话记录不再滚动删除。改 `AI_FREE_QUOTA` 即时生效，无需重新部署。
**ai.parseReceipt** 入参 `{ bookId, fileID }` → `{ card }`（`AI_VISION_MODEL` 默认 hunyuan-vision）。
**ai.confirmDraft** 入参 `{ bookId, draft, msgId? }` → `{ recordId }`。分类按「父 / 子」全路径→末级→一级匹配，匹配不到置空（不自动建分类）。
**ai.setCardState** 入参 `{ bookId, msgId, state: pending|done|dropped }`。
> **AI 绝不直接入账**：`chat`/`parseReceipt` 只产出预填；入账必经用户动作——「确认入账」走 `confirmDraft`，「编辑」跳记账页走 `record.create`。只读成员可问答，记账意图会被服务端拒绝并提示。会话超上限由 `appendMessage` 服务端滚动删除最旧。

---

## 9. 云函数 `settings` / `user`（个人）

| type | 分期 | 描述 |
|---|---|---|
| `user.getProfile` | 🟢 | 昵称/头像/账本数/默认账本 |
| `settings.get` | 🟢 | 展示币种、AI 上限 |
| `settings.update` | 🟢 | 改展示币种 / AI 上限 |

**settings.update** 入参 `{ displayCurrency?, aiMessageLimit? }` → ok。改展示币种后各页按新币种重新汇总展示（历史每笔仍按其记账日汇率换算）。

---

## 10. 云函数 `data`（导入导出）

| type | 分期 | 描述 | 权限 |
|---|---|---|---|
| `export` | 🟢 | 导出 JSON / Excel(含 CSV) / PDF | 成员 |
| `import` | 🟢 | 导入 JSON / Excel(含 CSV)，自动查重（数量对齐） | rw 及以上 |
| `undoImport` | 🟢 | 撤销一次导入（按批次号删除该批记录） | rw（本人批次）/ admin·owner（任意批次） |

**data.export** 入参 `{ bookId, format: "json"|"excel"|"pdf", range?: {from,to} }` → `{ fileID }`（云存储文件，前端下载/转发）。
**data.import** 入参 `{ bookId, format: "json"|"csv"|"excel", content?, contentBase64? }` → `{ success, failed, createdCategories, skippedCount, skipped: [{index, summary}], failures: [{ index, summary, reason }], batchId }`（明细各 ≤100 条；`index` 为数据行号、1 起、不含表头）。查重为**数量对齐**：指纹 = 日期|收支|金额|币种|标题|备注，每个指纹只导入「文件条数 − 库中已有条数」，重复导入幂等。前端以半屏结果面板展示，支持复制失败明细与撤销。
**data.undoImport** 入参 `{ bookId, batchId }` → `{ removed }`（删除该批次全部记录；rw 仅限自己导入的批次）。**PDF 不支持导入**，收到即拒绝并说明。

---

## 11. 云函数 `settle`（分账结算）🟡 P2

| type | 分期 | 描述 | 权限 |
|---|---|---|---|
| `get` | 🟡 | 结算方案 + 成员维度 + 分摊明细 | 成员（分账结算型账本） |
| `markTransfer` | 🟡 | 标记某笔转账结清/撤销 | owner/admin |

**settle.get** 入参 `{ bookId }` → 
```json
{ "success": true, "data": {
  "summary": { "myNet": 2600, "totalExpense": 5220, "myPaid": 4500, "myShare": 1900 },
  "transfers": [
    { "transferId": "t1", "from": "阿哲", "to": "小雨", "amount": 1030, "settled": false },
    { "transferId": "t2", "from": "小林", "to": "小雨", "amount": 1570, "settled": false }
  ],
  "members": [
    { "name": "小雨（我）", "paid": 4500, "share": 1900, "net": 2600 },
    { "name": "阿哲", "paid": 630, "share": 1660, "net": -1030 },
    { "name": "小林", "paid": 90, "share": 1660, "net": -1570 }
  ],
  "splits": [ { "title": "新宿酒店 3 晚", "amount": 2400, "payer": "小雨", "detail": "3 人均摊 · 各 ¥800", "members": ["雨","哲","林"] } ]
} }
```
> 后端按每笔 `payer` 与 `split` 自动算「谁欠谁」并合并为最少转账笔数；金额按各笔固化汇率换算。

---

## 11.5 云函数 `feedback`（用户反馈 · 轻量工单，PRD 4.9）

| type | 分期 | 描述 | 权限 |
|---|---|---|---|
| `create` | 🟢 | 提交反馈（标题/内容/图片≤3/选填邮箱） | 任意登录用户 |
| `list` | 🟢 | 我的工单列表；管理员见全部（附提交人昵称） | 本人 / 管理员 |
| `get` | 🟢 | 工单详情 + 回复线程；查看即清除本侧未读 | 本人 / 管理员 |
| `reply` | 🟢 | 追加回复；客服首次回复自动「待处理→处理中」 | 本人 / 管理员 |
| `setStatus` | 🟢 | 修改状态 pending/processing/resolved | 仅管理员 |
| `unreadCount` | 🟢 | 我这一侧未读工单数（设置页红点） | 任意登录用户 |
| `listAdmins` | 🟢 | 客服团队名单（owner + admins，附昵称） | 仅 owner |
| `createAdminInvite` | 🟢 | 生成一次性客服邀请码（24h 有效） | 仅 owner |
| `acceptAdminInvite` | 🟢 | 凭邀请码成为客服 | 任意登录用户 |
| `removeAdmin` | 🟢 | 移除某客服 | 仅 owner |

**客服两级**：owner = 云函数环境变量 `FEEDBACK_OWNER`（通常一个 openid，支持逗号分隔多个；唯一权力源，应用内不可增删）；admin = owner 用邀请码邀请的客服（`admins` 集合），仅 owner 可移除，admin 之间不可互删。二者都能看/回全部工单、改状态；仅 owner 能管理团队。
**feedback.create** 入参 `{ title, content, images?: [fileID], contactEmail? }` → `{ feedbackId }`。
**feedback.reply** 入参 `{ feedbackId, content }`；回复方向由服务端判定（管理员回他人工单记为 `cs`，否则 `user`），并置对侧未读标记。
**数据模型**（`feedbacks` 集合）：`openid, title, content, images[], contactEmail, status, replies[{from,content,time}], unreadForUser, unreadForAdmin, createdAt, updatedAt`。

---

## 12. 接口 ↔ 页面对照

| 页面 | 依赖接口 |
|---|---|
| home | `book.getCurrent`、`stats.getMonthlySummary`、`record.list` |
| add | `category.list`、`rate.getDaily`、`member.list`、`record.create`/`update` |
| detail | `record.get`、`record.delete` |
| stats | `stats.getChartData`、`stats.getCategoryData`、`layout.get`/`save` |
| records（钻取明细） | `record.list`（带筛选 + `withSummary`） |
| ai | `ai.listMessages`/`chat`/`parseReceipt`/`confirmDraft`/`setCardState`/`appendMessage`、`record.create` |
| books | `book.list`/`update`/`dissolve`/`setDefault`、`member.list`/`invite`/`updateRole`/`remove` |
| settings | `user.getProfile`、`settings.get`/`update`、`data.export`/`import`、`feedback.unreadCount` |
| feedback / feedback-new / feedback-detail / feedback-team | `feedback.list`/`create`/`get`/`reply`/`setStatus`/`listAdmins`/`createAdminInvite`/`acceptAdminInvite`/`removeAdmin` |
| onboarding | `book.create` |
| settle（P2） | `settle.get`/`markTransfer` |

---

## 13. 建议的云函数目录（落地时）
`book / member / category / record / rate / stats / layout / ai / settings / data`（P1，共 10 个）+ `settle`（P2）。
每个函数内 `event.type` 分发；公共逻辑（取 openid、校验成员与角色、读汇率）抽到共享模块复用。
