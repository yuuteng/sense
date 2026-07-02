# 心数 / Sense · 数据库设计与测试数据

> 技术栈：微信云开发**云数据库**（文档型 / JSON，非关系型 SQL）。本文用「集合（collection）」对应传统「表」。
> 配套接口见 [api.md](api.md)；字段与业务规则依据 [../Sense-PRD.md](../Sense-PRD.md) 与 [../数据与接口梳理.md](../数据与接口梳理.md)。

---

## 〇、总览

| 集合 | 作用 | 主要关联 |
|---|---|---|
| `users` | 用户资料 + 个人偏好设置 | `_id = openid` |
| `books` | 账本 | `ownerOpenid → users` |
| `members` | 账本成员关系（决定可见性与权限） | `bookId → books`，`openid → users` |
| `categories` | 账本级两级分类 | `bookId → books`，`parentId → categories` |
| `records` | 记账记录 | `bookId`、`recorderOpenid`、`payerOpenid`、`categoryId` |
| `rates` | 每日汇率快照 | 按 `date + base` |
| `chartLayouts` | 图表卡片布局（每用户每账本一套） | `bookId + openid` |
| `aiMessages` | AI 会话记录（按账本，滚动保留上限） | `bookId + openid` |

**通用约定**
- 金额一律存**原始数值**（`Number`，不带符号、不做格式化），正负由 `type` 区分，展示格式化交给前端。
- 币种存 ISO 代码字符串（`CNY/EUR/USD/JPY`）。
- 身份统一用云函数上下文的 `OPENID`，**不信任前端传入**。
- `createdAt/updatedAt` 用云数据库服务端时间 `db.serverDate()`；测试数据里先用 ISO 字符串占位，导入时转成 Date。
- `date`（业务日期，如记账日）用 `'YYYY-MM-DD'` 字符串，便于按天/月聚合与展示。

---

## 一、集合结构

### 1. users — 用户

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `_id` | string | ✅ | 等于用户 `openid` |
| `openid` | string | ✅ | 微信 openid |
| `nickname` | string | ✅ | 昵称 |
| `avatarColor` | string | | 头像底色（无微信头像时用） |
| `avatarInitial` | string | | 头像文字（如「雨」） |
| `defaultBookId` | string | | 默认账本 id |
| `settings.displayCurrency` | string | ✅ | 展示币种，默认 `CNY` |
| `settings.aiMessageLimit` | number | ✅ | AI 会话保留上限，默认 `50` |
| `createdAt` | Date | ✅ | |

**索引**：`_id`（主键即 openid）。

---

### 2. books — 账本

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `_id` | string | ✅ | 账本 id |
| `name` | string | ✅ | 账本名称 |
| `type` | string | ✅ | `share`（共享可见型）/ `split`（分账结算型） |
| `baseCurrency` | string | ✅ | 基准币种，记录换算目标 |
| `ownerOpenid` | string | ✅ | 创建者/所有者 |
| `memberCount` | number | | 成员数（冗余，便于列表展示） |
| `createdAt` | Date | ✅ | 建立时间（累计统计起点） |

**索引**：`ownerOpenid`；`type`。
**规则**：每账本有且仅有一个 owner；`type` 创建时选定（能否改列 PRD 待定）。

---

### 3. members — 账本成员关系

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `_id` | string | ✅ | |
| `bookId` | string | ✅ | 所属账本 |
| `openid` | string | ✅ | 成员用户 |
| `nameCache` | string | | 成员昵称快照（列表展示） |
| `avatarColor` | string | | 头像底色 |
| `avatarInitial` | string | | 头像文字 |
| `role` | string | ✅ | `owner` / `admin` / `rw`（读写） / `ro`（只读） |
| `joinedAt` | Date | ✅ | 加入时间 |
| `status` | string | | `active` / `removed` |

**索引**：复合唯一 `bookId + openid`；`openid`（查我加入了哪些账本）。
**规则**：权限跟随账本；未在此表的用户对该账本完全不可见（查询层用它过滤）。

---

### 4. categories — 账本级分类（两级）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `_id` | string | ✅ | |
| `bookId` | string | ✅ | 账本级 |
| `kind` | string | ✅ | `expense`（支出）/ `income`（收入） |
| `parentId` | string\|null | ✅ | 一级为 `null`，二级指向一级 `_id` |
| `name` | string | ✅ | 分类名 |
| `icon` | string | | 一级分类图标名（对应前端 icons.js） |
| `order` | number | ✅ | 排序 |
| `disabled` | boolean | ✅ | 停用（历史记录仍显示原名，不硬删） |

**索引**：`bookId + kind`；`parentId`。

---

### 5. records — 记账记录

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `_id` | string | ✅ | |
| `bookId` | string | ✅ | 所属账本 |
| `type` | string | ✅ | `expense` / `income` |
| `amount` | number | ✅ | **原始币种**金额（正数） |
| `currency` | string | ✅ | 原始币种 |
| `rate` | number | ✅ | 记账当日汇率：1 单位 `currency` = `rate` 单位 `baseCurrency`（**固化**） |
| `baseCurrency` | string | ✅ | 换算目标（=账本基准币种） |
| `amountConverted` | number | ✅ | 固化换算金额 = `amount × rate`（正数） |
| `categoryId` | string | ✅ | 二级分类 id（或一级） |
| `categoryPath` | string | ✅ | 分类名快照，如「餐饮 / 咖啡」（历史稳定） |
| `date` | string | ✅ | 业务日期 `YYYY-MM-DD` |
| `note` | string | | 备注 |
| `images` | string[] | | 云存储 fileID 列表 |
| `recorderOpenid` | string | ✅ | 记录人 |
| `payerOpenid` | string | ✅ | 付款人 |
| `split` | object | | 分账结算型账本用；见下 |
| `createdAt` | Date | ✅ | 入账时间 |
| `updatedAt` | Date | | |

**`split` 结构**（仅 `type=split` 账本；P1 仅记录）：
```json
{ "mode": "even", "members": [ { "openid": "openid-yu", "share": 800 } ] }
```
`mode`：`even`（均摊）/ `by`（按人指定）/ `treat`（我请客）。`share` 为该成员应摊金额（基准币种）。

**索引**：`bookId + date`（列表/按天）；`bookId + type`；`categoryId`；`payerOpenid`。

---

### 6. rates — 每日汇率快照

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `_id` | string | ✅ | 建议 `${date}` 或 `${date}_${base}` |
| `date` | string | ✅ | `YYYY-MM-DD` |
| `base` | string | ✅ | 基准币种（报价相对它） |
| `quotes` | object | ✅ | `{ CNY:1, EUR:7.83, USD:7.24, JPY:0.048 }`（1 外币 = ? 基准币） |
| `isFallback` | boolean | | 当天取不到、沿用最近一次时标 `true` |

**索引**：`date + base`。

---

### 7. chartLayouts — 图表布局（每用户每账本）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `_id` | string | ✅ | 建议 `${bookId}_${openid}` |
| `bookId` | string | ✅ | |
| `openid` | string | ✅ | |
| `order` | string[] | ✅ | 卡片顺序与可见集合，如 `["overview","trend","year","total"]` |
| `updatedAt` | Date | ✅ | |

**索引**：`bookId + openid`。
**规则**：布局跟随「账本 + 用户」，互不影响；可选卡片种类：`overview / trend / year / total`。

---

### 8. aiMessages — AI 会话

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `_id` | string | ✅ | |
| `bookId` | string | ✅ | 按账本分别保留 |
| `openid` | string | ✅ | 所属用户 |
| `role` | string | ✅ | `user` / `ai` / `card`（预填确认卡） |
| `text` | string | | 文本内容（user/ai） |
| `receipt` | boolean | | user 消息是否为上传的收据图 |
| `card` | object | | role=card 时的预填记录（见下） |
| `createdAt` | Date | ✅ | 排序用 |

**`card` 结构**：
```json
{ "kind": "收据识别", "state": "pending", "rows": [ { "k": "金额", "v": "€18.90", "extra": "≈ ¥147.99" } ] }
```
`kind`：`收据识别` / `自然语言记账`；`state`：`pending`/`done`/`dropped`。

**索引**：`bookId + openid + createdAt`。
**规则**：超过 `users.settings.aiMessageLimit`（默认 50）由服务端滚动删除最旧。

---

## 二、测试数据

> 用途：先塞入云数据库，让 App 各页面有真实可读的数据。
> 说明：`openid` 为**占位值**（真实为微信下发）；`Date` 字段以 ISO 字符串占位，导入时转 `Date`；可用云开发控制台「导入」或写一个一次性 seed 云函数逐条 `add`。

### users
```json
[
  { "_id": "openid-yu", "openid": "openid-yu", "nickname": "小雨", "avatarColor": "#2f6feb", "avatarInitial": "雨", "defaultBookId": "book-home", "settings": { "displayCurrency": "CNY", "aiMessageLimit": 50 }, "createdAt": "2025-09-01T00:00:00.000Z" },
  { "_id": "openid-zhe", "openid": "openid-zhe", "nickname": "阿哲", "avatarColor": "#17a34a", "avatarInitial": "哲", "defaultBookId": "book-home", "settings": { "displayCurrency": "CNY", "aiMessageLimit": 50 }, "createdAt": "2025-11-01T00:00:00.000Z" },
  { "_id": "openid-lin", "openid": "openid-lin", "nickname": "小林", "avatarColor": "#b06f3c", "avatarInitial": "林", "defaultBookId": "book-jp", "settings": { "displayCurrency": "CNY", "aiMessageLimit": 50 }, "createdAt": "2026-05-01T00:00:00.000Z" }
]
```

### books
```json
[
  { "_id": "book-home", "name": "家庭日常", "type": "share", "baseCurrency": "CNY", "ownerOpenid": "openid-yu", "memberCount": 2, "createdAt": "2025-09-01T00:00:00.000Z" },
  { "_id": "book-jp", "name": "日本旅行 2026", "type": "split", "baseCurrency": "CNY", "ownerOpenid": "openid-zhe", "memberCount": 3, "createdAt": "2026-05-10T00:00:00.000Z" }
]
```

### members
```json
[
  { "_id": "m-home-yu", "bookId": "book-home", "openid": "openid-yu", "nameCache": "小雨", "avatarColor": "#2f6feb", "avatarInitial": "雨", "role": "owner", "joinedAt": "2025-09-01T00:00:00.000Z", "status": "active" },
  { "_id": "m-home-zhe", "bookId": "book-home", "openid": "openid-zhe", "nameCache": "阿哲", "avatarColor": "#17a34a", "avatarInitial": "哲", "role": "admin", "joinedAt": "2025-11-01T00:00:00.000Z", "status": "active" },
  { "_id": "m-jp-zhe", "bookId": "book-jp", "openid": "openid-zhe", "nameCache": "阿哲", "avatarColor": "#17a34a", "avatarInitial": "哲", "role": "owner", "joinedAt": "2026-05-10T00:00:00.000Z", "status": "active" },
  { "_id": "m-jp-yu", "bookId": "book-jp", "openid": "openid-yu", "nameCache": "小雨", "avatarColor": "#2f6feb", "avatarInitial": "雨", "role": "admin", "joinedAt": "2026-05-11T00:00:00.000Z", "status": "active" },
  { "_id": "m-jp-lin", "bookId": "book-jp", "openid": "openid-lin", "nameCache": "小林", "avatarColor": "#b06f3c", "avatarInitial": "林", "role": "rw", "joinedAt": "2026-05-11T00:00:00.000Z", "status": "active" }
]
```

### categories（家庭日常账本，支出预设两级 + 收入一级）
```json
[
  { "_id": "cat-food", "bookId": "book-home", "kind": "expense", "parentId": null, "name": "餐饮", "icon": "dining", "order": 1, "disabled": false },
  { "_id": "cat-food-dinner", "bookId": "book-home", "kind": "expense", "parentId": "cat-food", "name": "晚餐", "order": 1, "disabled": false },
  { "_id": "cat-food-takeout", "bookId": "book-home", "kind": "expense", "parentId": "cat-food", "name": "外卖", "order": 2, "disabled": false },
  { "_id": "cat-food-coffee", "bookId": "book-home", "kind": "expense", "parentId": "cat-food", "name": "咖啡", "order": 3, "disabled": false },
  { "_id": "cat-trans", "bookId": "book-home", "kind": "expense", "parentId": null, "name": "交通", "icon": "train", "order": 2, "disabled": false },
  { "_id": "cat-trans-metro", "bookId": "book-home", "kind": "expense", "parentId": "cat-trans", "name": "地铁", "order": 1, "disabled": false },
  { "_id": "cat-shop", "bookId": "book-home", "kind": "expense", "parentId": null, "name": "购物", "icon": "bag", "order": 3, "disabled": false },
  { "_id": "cat-shop-daily", "bookId": "book-home", "kind": "expense", "parentId": "cat-shop", "name": "日用", "order": 1, "disabled": false },
  { "_id": "cat-med", "bookId": "book-home", "kind": "expense", "parentId": null, "name": "医疗", "icon": "medical", "order": 4, "disabled": false },
  { "_id": "cat-med-drug", "bookId": "book-home", "kind": "expense", "parentId": "cat-med", "name": "药品", "order": 1, "disabled": false },
  { "_id": "cat-income-salary", "bookId": "book-home", "kind": "income", "parentId": null, "name": "职业收入", "icon": "income", "order": 1, "disabled": false }
]
```

### records（家庭日常账本，对应首页列表与详情页）
```json
[
  { "_id": "r-1", "bookId": "book-home", "type": "expense", "amount": 86.00, "currency": "CNY", "rate": 1, "baseCurrency": "CNY", "amountConverted": 86.00, "categoryId": "cat-food-takeout", "categoryPath": "餐饮 / 外卖", "date": "2026-07-01", "note": "晚餐 外卖", "images": [], "recorderOpenid": "openid-yu", "payerOpenid": "openid-yu", "createdAt": "2026-07-01T12:30:00.000Z" },
  { "_id": "r-2", "bookId": "book-home", "type": "expense", "amount": 213.50, "currency": "CNY", "rate": 1, "baseCurrency": "CNY", "amountConverted": 213.50, "categoryId": "cat-shop-daily", "categoryPath": "购物 / 日用", "date": "2026-07-01", "note": "超市采购", "images": [], "recorderOpenid": "openid-yu", "payerOpenid": "openid-zhe", "createdAt": "2026-07-01T18:05:00.000Z" },
  { "_id": "r-3", "bookId": "book-home", "type": "income", "amount": 12000.00, "currency": "CNY", "rate": 1, "baseCurrency": "CNY", "amountConverted": 12000.00, "categoryId": "cat-income-salary", "categoryPath": "职业收入 / 工资", "date": "2026-06-30", "note": "工资", "images": [], "recorderOpenid": "openid-yu", "payerOpenid": "openid-yu", "createdAt": "2026-06-30T09:00:00.000Z" },
  { "_id": "r-4", "bookId": "book-home", "type": "expense", "amount": 5.40, "currency": "EUR", "rate": 7.83, "baseCurrency": "CNY", "amountConverted": 42.30, "categoryId": "cat-food-coffee", "categoryPath": "餐饮 / 咖啡", "date": "2026-06-30", "note": "通勤路上的拿铁", "images": ["cloud://example/receipt-coffee.jpg"], "recorderOpenid": "openid-yu", "payerOpenid": "openid-yu", "createdAt": "2026-06-30T08:12:00.000Z" },
  { "_id": "r-5", "bookId": "book-home", "type": "expense", "amount": 6.00, "currency": "CNY", "rate": 1, "baseCurrency": "CNY", "amountConverted": 6.00, "categoryId": "cat-trans-metro", "categoryPath": "交通 / 地铁", "date": "2026-06-29", "note": "地铁通勤", "images": [], "recorderOpenid": "openid-zhe", "payerOpenid": "openid-zhe", "createdAt": "2026-06-29T08:40:00.000Z" },
  { "_id": "r-6", "bookId": "book-home", "type": "expense", "amount": 58.00, "currency": "CNY", "rate": 1, "baseCurrency": "CNY", "amountConverted": 58.00, "categoryId": "cat-med-drug", "categoryPath": "医疗 / 药品", "date": "2026-06-29", "note": "感冒药", "images": [], "recorderOpenid": "openid-yu", "payerOpenid": "openid-yu", "createdAt": "2026-06-29T20:10:00.000Z" }
]
```

### records（日本旅行账本，分账结算型，对应 settle 页明细）
```json
[
  { "_id": "r-jp-1", "bookId": "book-jp", "type": "expense", "amount": 2400, "currency": "CNY", "rate": 1, "baseCurrency": "CNY", "amountConverted": 2400, "categoryId": "cat-jp-hotel", "categoryPath": "住宿 / 酒店", "date": "2026-06-20", "note": "新宿酒店 3 晚", "images": [], "recorderOpenid": "openid-yu", "payerOpenid": "openid-yu", "split": { "mode": "even", "members": [ { "openid": "openid-yu", "share": 800 }, { "openid": "openid-zhe", "share": 800 }, { "openid": "openid-lin", "share": 800 } ] }, "createdAt": "2026-06-20T15:00:00.000Z" },
  { "_id": "r-jp-2", "bookId": "book-jp", "type": "expense", "amount": 1860, "currency": "CNY", "rate": 1, "baseCurrency": "CNY", "amountConverted": 1860, "categoryId": "cat-jp-trans", "categoryPath": "交通 / 铁路", "date": "2026-06-20", "note": "JR Pass ×3", "images": [], "recorderOpenid": "openid-yu", "payerOpenid": "openid-yu", "split": { "mode": "even", "members": [ { "openid": "openid-yu", "share": 620 }, { "openid": "openid-zhe", "share": 620 }, { "openid": "openid-lin", "share": 620 } ] }, "createdAt": "2026-06-20T16:00:00.000Z" },
  { "_id": "r-jp-3", "bookId": "book-jp", "type": "expense", "amount": 13650, "currency": "JPY", "rate": 0.04615, "baseCurrency": "CNY", "amountConverted": 630, "categoryId": "cat-jp-food", "categoryPath": "餐饮 / 晚餐", "date": "2026-06-21", "note": "居酒屋晚餐", "images": [], "recorderOpenid": "openid-zhe", "payerOpenid": "openid-zhe", "split": { "mode": "even", "members": [ { "openid": "openid-yu", "share": 210 }, { "openid": "openid-zhe", "share": 210 }, { "openid": "openid-lin", "share": 210 } ] }, "createdAt": "2026-06-21T20:30:00.000Z" },
  { "_id": "r-jp-4", "bookId": "book-jp", "type": "expense", "amount": 90, "currency": "CNY", "rate": 1, "baseCurrency": "CNY", "amountConverted": 90, "categoryId": "cat-jp-food", "categoryPath": "餐饮 / 零食", "date": "2026-06-21", "note": "便利店零食", "images": [], "recorderOpenid": "openid-lin", "payerOpenid": "openid-lin", "split": { "mode": "even", "members": [ { "openid": "openid-yu", "share": 30 }, { "openid": "openid-zhe", "share": 30 }, { "openid": "openid-lin", "share": 30 } ] }, "createdAt": "2026-06-21T22:00:00.000Z" },
  { "_id": "r-jp-5", "bookId": "book-jp", "type": "expense", "amount": 240, "currency": "CNY", "rate": 1, "baseCurrency": "CNY", "amountConverted": 240, "categoryId": "cat-jp-shop", "categoryPath": "购物 / 药妆", "date": "2026-06-22", "note": "药妆店（个人）", "images": [], "recorderOpenid": "openid-yu", "payerOpenid": "openid-yu", "split": { "mode": "treat", "members": [ { "openid": "openid-yu", "share": 240 } ] }, "createdAt": "2026-06-22T11:00:00.000Z" }
]
```

> 校验（settle 页应得）：小雨垫付 4500、应摊 1900、净额 +2600；阿哲垫付 630、应摊 1660、净额 −1030；小林垫付 90、应摊 1660、净额 −1570。最少转账：阿哲→小雨 1030、小林→小雨 1570。

### categories（日本旅行账本，被上面 records 引用的分类，简版）
```json
[
  { "_id": "cat-jp-hotel", "bookId": "book-jp", "kind": "expense", "parentId": null, "name": "住宿", "icon": "house", "order": 1, "disabled": false },
  { "_id": "cat-jp-trans", "bookId": "book-jp", "kind": "expense", "parentId": null, "name": "交通", "icon": "train", "order": 2, "disabled": false },
  { "_id": "cat-jp-food", "bookId": "book-jp", "kind": "expense", "parentId": null, "name": "餐饮", "icon": "dining", "order": 3, "disabled": false },
  { "_id": "cat-jp-shop", "bookId": "book-jp", "kind": "expense", "parentId": null, "name": "购物", "icon": "bag", "order": 4, "disabled": false }
]
```

### rates
```json
[
  { "_id": "2026-06-29_CNY", "date": "2026-06-29", "base": "CNY", "quotes": { "CNY": 1, "EUR": 7.81, "USD": 7.23, "JPY": 0.0461 }, "isFallback": false },
  { "_id": "2026-06-30_CNY", "date": "2026-06-30", "base": "CNY", "quotes": { "CNY": 1, "EUR": 7.83, "USD": 7.24, "JPY": 0.0462 }, "isFallback": false },
  { "_id": "2026-07-01_CNY", "date": "2026-07-01", "base": "CNY", "quotes": { "CNY": 1, "EUR": 7.84, "USD": 7.24, "JPY": 0.0463 }, "isFallback": false }
]
```

### chartLayouts
```json
[
  { "_id": "book-home_openid-yu", "bookId": "book-home", "openid": "openid-yu", "order": ["overview", "trend", "year", "total"], "updatedAt": "2026-07-01T00:00:00.000Z" }
]
```

### aiMessages（家庭日常账本，小雨的会话）
```json
[
  { "_id": "ai-1", "bookId": "book-home", "openid": "openid-yu", "role": "user", "text": "上个月我们餐饮花了多少？", "createdAt": "2026-07-01T09:00:00.000Z" },
  { "_id": "ai-2", "bookId": "book-home", "openid": "openid-yu", "role": "ai", "text": "6 月「家庭日常」账本的餐饮合计支出为 ¥1,284.60，共 32 笔。其中外卖占 ¥612，晚餐 ¥458，咖啡/奶茶 ¥214.60（含 3 笔欧元记录已按当日汇率换算）。", "createdAt": "2026-07-01T09:00:03.000Z" },
  { "_id": "ai-3", "bookId": "book-home", "openid": "openid-yu", "role": "user", "text": "这周谁花得最多？", "createdAt": "2026-07-01T09:01:00.000Z" },
  { "_id": "ai-4", "bookId": "book-home", "openid": "openid-yu", "role": "ai", "text": "本周小雨记账 ¥1,240、阿哲记账 ¥860。按付款人看，阿哲付款 ¥1,510（含一次超市大额采购）。", "createdAt": "2026-07-01T09:01:04.000Z" },
  { "_id": "ai-5", "bookId": "book-home", "openid": "openid-yu", "role": "card", "card": { "kind": "收据识别", "state": "pending", "rows": [ { "k": "商家", "v": "City Supermarkt", "edit": true }, { "k": "金额", "v": "€18.90", "extra": "≈ ¥147.99", "edit": true }, { "k": "建议分类", "v": "购物 · 日用", "edit": true }, { "k": "日期", "v": "2026-07-01" }, { "k": "记录人 / 付款人", "v": "小雨" } ] }, "createdAt": "2026-07-01T09:02:00.000Z" }
]
```

---

## 三、需在云开发控制台预建的集合清单
`users`、`books`、`members`、`categories`、`records`、`rates`、`chartLayouts`、`aiMessages`（共 8 个）。建好后导入上面的测试数据，并按各集合「索引」小节建立索引。
