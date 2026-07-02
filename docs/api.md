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

**record.list** 入参 `{ bookId, currency, page, pageSize, dateRange? }` → 
```json
{ "success": true, "data": {
  "groups": [
    { "date": "2026-07-01", "total": -299.50, "items": [
      { "recordId": "r-1", "type": "expense", "categoryPath": "餐饮 / 外卖", "icon": "dining",
        "amountConverted": 86.00, "currency": "CNY", "originalAmount": 86.00,
        "recorderName": "小雨", "payerName": "小雨", "isForeign": false }
    ] }
  ],
  "hasMore": false
} }
```
> `total`/`amount*` 为数值，前端加符号与千分位格式化。`isForeign=true` 时前端显示原始币种 pill 与「按 X 汇率」。

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
| `ask` | 🟢 | 数据问答（基于真实数据） | 成员（含只读） |
| `parseText` | 🟢 | 自然语言 → 预填记录 | rw 及以上 |
| `parseReceipt` | 🟢 | 收据图 → 预填记录 | rw 及以上 |
| `appendMessage` | 🟢 | 追加会话并滚动裁剪 | 成员 |

**ai.listMessages** 入参 `{ bookId }` → 会话数组（结构见 sql.md `aiMessages`）。
**ai.ask** 入参 `{ bookId, text }` → `{ answer }`。后端读账本真实数据作答，**不编造数字**。
**ai.parseText** 入参 `{ bookId, text }` → `{ card }`（预填记录，`state:"pending"`）。
**ai.parseReceipt** 入参 `{ bookId, fileID }` → `{ card }`。
> **AI 绝不直接入账**：`parse*` 只产出预填，用户确认后前端调用 `record.create` 入账。只读成员可 `ask`，不可 `parse*`/入账。会话超上限由 `appendMessage` 服务端滚动删除最旧。

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
| `import` | 🟢 | 导入 JSON / Excel(含 CSV) | rw 及以上 |

**data.export** 入参 `{ bookId, format: "json"|"excel"|"pdf", range?: {from,to} }` → `{ fileID }`（云存储文件，前端下载/转发）。
**data.import** 入参 `{ bookId, fileID }` → `{ success: 30, failed: 0, reasons: [] }`。**PDF 不支持导入**，收到即拒绝并说明。

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

## 12. 接口 ↔ 页面对照

| 页面 | 依赖接口 |
|---|---|
| home | `book.getCurrent`、`stats.getMonthlySummary`、`record.list` |
| add | `category.list`、`rate.getDaily`、`member.list`、`record.create`/`update` |
| detail | `record.get`、`record.delete` |
| stats | `stats.getDashboard`、`layout.get`/`save` |
| ai | `ai.listMessages`/`ask`/`parseText`/`parseReceipt`、`record.create` |
| books | `book.list`/`update`/`dissolve`/`setDefault`、`member.list`/`invite`/`updateRole`/`remove` |
| settings | `user.getProfile`、`settings.get`/`update`、`data.export`/`import` |
| onboarding | `book.create` |
| settle（P2） | `settle.get`/`markTransfer` |

---

## 13. 建议的云函数目录（落地时）
`book / member / category / record / rate / stats / layout / ai / settings / data`（P1，共 10 个）+ `settle`（P2）。
每个函数内 `event.type` 分发；公共逻辑（取 openid、校验成员与角色、读汇率）抽到共享模块复用。
