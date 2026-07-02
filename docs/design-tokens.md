# 心数 / Sense · 设计令牌（FPS 色卡）

> 本文件是**唯一配色事实来源**。以后所有配色都基于这套色卡；调色只改这里与 `miniprogram/app.wxss` 的 `page{}` 令牌块。
> 来源：用户 Figma「FPS / Design System」。小程序里已落地为 CSS 变量（见 `app.wxss`）。

---

## 一、原始色卡（Figma FPS）

### 灰阶 Grey
| Token | HEX |
|---|---|
| grey-800 | `#3e4550` |
| grey-700 | `#748294` |
| grey-500 | `#97a7b7` |
| grey-400 | `#b2beca` |
| grey-300 | `#cbd3db` |
| grey-200 | `#e4e7ec` |
| grey-100 | `#e9ecf0` |
| grey-50  | `#f6f9fc` |

### 蓝 Blue
| Token | HEX | 说明 |
|---|---|---|
| blue-800 | `#035599` | 深蓝 |
| blue-600 | `#0089c0` | 中蓝，**蓝色文字/图标用它**（blue-400 对比度不足）|
| blue-400 | `#00ccf9` | 亮蓝 = 主色 primary |

### 语义色 Others
| Token | HEX |
|---|---|
| yellow-500 | `#ffcd2f` |
| orange-500 | `#ffa312` |
| red-500 | `#f62172` |
| green-500 | `#9edf10` |
| white | `#ffffff` |
| main-background | `#f6f9fc` |

### 按钮态 Buttons
| 组 | active | hover | pressed | disabled |
|---|---|---|---|---|
| primary（主）| `#00ccf9` | `#00c4f0` | `#00b8e0` | `#a3e6f5` |
| secondary（次）| `#ffffff` | `#f5f2f2` | `#ededed` | `#fafafa` |
| creation（创建/正向）| `#9edf10` | `#98d60f` | `#8ec80e` | `#cde891` |

### 阴影 Shadows
| Token | 颜色 | x / y / blur / opacity |
|---|---|---|
| small | `#34414e` | 0 / 2 / 4 / 0.05 |
| medium | `#97a7b7` | 0 / 3 / 13 / 0.30 |
| big | `#3e4550` | 0 / 4 / 10 / 0.80 |

> 备注：`big` 原始 0.80 不透明度用于卡片过重，小程序 UI 取 0.20；需要强投影的元素（模态/FAB）再单独加。

---

## 二、语义别名（组件实际引用的变量）

小程序组件不直接用原始色名，而是用下列语义别名（定义在 `app.wxss` 的 `page{}`）：

| 语义变量 | 取值 | 用途 |
|---|---|---|
| `--bg` | grey-50 `#f6f9fc` | 页面背景 |
| `--surface` | white `#ffffff` | 卡片/面 |
| `--fg` | grey-800 `#3e4550` | 主文字 |
| `--muted` | grey-700 `#748294` | 次要文字 |
| `--border` | grey-200 `#e4e7ec` | 描边/分隔 |
| `--accent` | primary-active `#00ccf9` | **主色填充**：按钮/FAB/选中背景/边框 |
| `--accent-ink` | blue-600 `#0089c0` | **蓝色文字/图标**（亮蓝当文字对比不足）|
| `--accent-on` | white | 主色上的文字 |
| `--accent-hover` / `--accent-active` | `#00c4f0` / `#00b8e0` | 主色按压态 |
| `--success` | green-500 `#9edf10` | 正向**填充**：开关/圆点/边框 |
| `--success-strong` | `#5c9a0e` | 正向**文字/图标**（亮绿当文字不可读，加深）|
| `--warn` | yellow-500 `#ffcd2f` | 提醒（外币标签等）|
| `--danger` | red-500 `#f62172` | 危险/删除 |

**收支语义约定**：收入 = 绿（`--success` 填充 / `--success-strong` 文字），支出 = 主色蓝（图标底）/中性。外币 = 黄。

---

## 三、使用规则

1. **只改令牌**：换肤/微调只动 `app.wxss` 的 `page{}` 令牌块，组件自动跟随。
2. **文字用深色**：蓝色文字/图标一律用 `--accent-ink`（blue-600），绿色文字用 `--success-strong`；亮蓝 `#00ccf9` / 亮绿 `#9edf10` 只做填充与大色块。
3. **JS 里传给 `icons.get()` 的颜色**也遵循上表（蓝图标 `#0089c0`、绿图标 `#5c9a0e`、灰图标 `#748294`/`#3e4550`、危险 `#f62172`）。
4. 新增颜色需求先在本表登记，再落地到 `app.wxss`。
