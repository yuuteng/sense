---
name: 心数 / Sense
description: 简洁轻量、多人协作、多币种、内置 AI 助手的微信小程序记账应用视觉系统
colors:
  lake-cyan: "#00ccf9"
  lake-blue: "#0089c0"
  deep-lake-blue: "#01749f"
  deep-pool-blue: "#035599"
  sprout-green: "#9edf10"
  leaf-green: "#4a7d0b"
  sun-yellow: "#ffcd2f"
  amber-ink: "#8a690a"
  sunset-orange: "#ffa312"
  rose-red: "#f62172"
  rose-ink: "#c41e5a"
  ink-grey: "#3e4550"
  slate-ink: "#5f6c7d"
  slate-grey: "#748294"
  mist-grey: "#97a7b7"
  cloud-grey: "#b2beca"
  border-grey: "#e4e7ec"
  frost-white: "#f6f9fc"
  pure-white: "#ffffff"
typography:
  display:
    fontFamily: "Inter, -apple-system, system-ui, PingFang SC, sans-serif"
    fontSize: "104rpx"
    fontWeight: 600
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Inter, -apple-system, system-ui, PingFang SC, sans-serif"
    fontSize: "64rpx"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, -apple-system, system-ui, PingFang SC, sans-serif"
    fontSize: "40rpx"
    fontWeight: 600
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, -apple-system, system-ui, PingFang SC, sans-serif"
    fontSize: "32rpx"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, -apple-system, system-ui, PingFang SC, sans-serif"
    fontSize: "24rpx"
    fontWeight: 600
  numeric:
    fontFamily: "ui-monospace, JetBrains Mono, monospace"
    fontSize: "32rpx"
    fontWeight: 600
    letterSpacing: "-0.02em"
rounded:
  sm: "20rpx"
  md: "28rpx"
  lg: "40rpx"
  pill: "9999rpx"
spacing:
  "1": "8rpx"
  "2": "16rpx"
  "3": "24rpx"
  "4": "32rpx"
  "5": "40rpx"
  "6": "48rpx"
  "8": "64rpx"
  "12": "96rpx"
components:
  button-primary:
    backgroundColor: "{colors.lake-cyan}"
    textColor: "{colors.pure-white}"
    rounded: "{rounded.pill}"
    padding: "26rpx 36rpx"
    height: "96rpx"
  button-primary-pressed:
    backgroundColor: "#00b8e0"
    textColor: "{colors.pure-white}"
    rounded: "{rounded.pill}"
  button-ghost:
    backgroundColor: "{colors.pure-white}"
    textColor: "{colors.ink-grey}"
    rounded: "{rounded.pill}"
    padding: "26rpx 36rpx"
    height: "96rpx"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.rose-red}"
    rounded: "{rounded.pill}"
    padding: "26rpx 36rpx"
  card:
    backgroundColor: "{colors.pure-white}"
    rounded: "{rounded.md}"
    padding: "40rpx"
  chip:
    backgroundColor: "{colors.pure-white}"
    textColor: "{colors.ink-grey}"
    rounded: "{rounded.pill}"
    padding: "14rpx 28rpx"
    height: "72rpx"
  chip-selected:
    backgroundColor: "#e0f8fe"
    textColor: "{colors.deep-lake-blue}"
    rounded: "{rounded.pill}"
  input:
    backgroundColor: "{colors.pure-white}"
    textColor: "{colors.ink-grey}"
    rounded: "{rounded.sm}"
    padding: "0 32rpx"
    height: "96rpx"
  fab:
    backgroundColor: "{colors.lake-cyan}"
    textColor: "{colors.pure-white}"
    rounded: "{rounded.pill}"
    height: "108rpx"
    padding: "0 40rpx 0 32rpx"
---

# Design System: 心数 / Sense

## 1. Overview

**Creative North Star: "会呼吸的计算器"**

心数是一台会呼吸的计算器：内核是工具的准确——等宽数字、口径一致、汇率固化、≤100ms 反馈；外表是生物的柔软——胶囊按钮、弹性按压、去硬边框的柔光阴影。冷灰湖水底色让数字清澈见底，湖心青只在用户要行动的地方亮起。记账是几秒钟的小动作，界面在你按下时轻轻回弹，在你等待时安静让路，绝不制造记账焦虑。

本系统明确拒绝两件事（承 PRODUCT.md）：**随手记式密集堆砌**——首页永远只有账本、概要、记录列表、记一笔，不塞广告位与功能矩阵；**营销页花哨感**——不用渐变大字与装饰性插画抢数字的焦点，视觉全部服务于金额的可读性。设计语言对齐 iOS（HIG）：分组列表、原生开关、tabBar 导航、安全区适配；载体为微信小程序（WXML/WXSS，rpx 单位，1px ≈ 2rpx）。

**Key Characteristics:**
- 冷灰湖水底（#f6f9fc）+ 纯白卡片，湖心青（#00ccf9）只做行动信号
- 亮色填充 / 深色文字的双层用色纪律（严格 WCAG AA）
- 等宽 tabular 数字，金额永远是页面主角
- 胶囊 + 圆角 + 柔光阴影 + 弹性按压（cubic-bezier(0.34, 1.4, 0.64, 1)）
- 密度克制：一屏一件事，空态给出路

## 2. Colors

FPS 色卡（唯一色彩来源，定义于 `miniprogram/app.wxss` 的 `page` 令牌块）：冷灰水域打底，湖心青点睛，语义色各司其职。

### Primary
- **湖心青** (#00ccf9)：唯一行动色。主按钮、FAB「记一笔」、选中态填充、支出图标底（14% 透明度）。只做填充与信号，**不做正文文字**（对白底对比不足）。
- **深湖蓝** (#01749f)：湖心青的墨水态（≥5:1）。凡是青色系的**文字与图标**（链接、选中文字、chip 描边、tabBar 选中、AI 用户气泡底）一律用它。
- **湖蓝** (#0089c0)：中间调（3.9:1）。仅用于图表高亮、大号图形元素等 UI 组件口径（≥3:1）场景，**不做正文文字**。
- **深潭蓝** (#035599)：概要条 hero 渐变的起点（135deg 深潭蓝 → 湖蓝 → #00b0e6），全应用唯一一块深色浸染面。

### Secondary
- **嫩芽绿** (#9edf10)：正向/收入的填充色。收入图标底（20% 透明度）、iOS 开关 on 态、结算横幅底。
- **深叶绿** (#4a7d0b)：嫩芽绿的墨水态（≥4.7:1）。收入金额、绿色文字与图标一律用它（旧值 #5c9a0e 仅 3.45:1，已弃用于文字）。

### Tertiary
- **暖阳黄** (#ffcd2f)：提示与标注（汇率胶囊底 16–18% 透明度、只读角色徽标底）。
- **琥珀墨** (#8a690a)：暖阳黄的墨水态，黄色系文字专用（旧值 #a47d06 仅 3.8:1）。
- **落日橙** (#ffa312)：支出色点、待处理状态。
- **蔷薇红** (#f62172)：危险填充专用（删除徽标底、未读红点）。**不用于「超支」恐吓**。
- **蔷薇墨** (#c41e5a)：危险文字的墨水态（danger 按钮文字、错误提示、负结余；蔷薇红作文字仅 3.9:1）。

### Neutral
- **墨灰** (#3e4550)：主文字（--fg）。
- **石板墨** (#5f6c7d)：次要文字（--muted，≥5:1）与输入框占位文字。
- **板岩灰** (#748294)：仅 4.0:1，降级为非文字用途（图标着色、装饰性元素）。
- **雾灰** (#97a7b7)：拖拽把手等弱化图形元素（图表轴文字已改用石板墨）。
- **云灰** (#b2beca)：仅限图形/描边弱化，**不再做占位文字**（2.1:1 违反 AA）。
- **界灰** (#e4e7ec)：1rpx 分隔线与描边。
- **霜白** (#f6f9fc)：页面底色（--bg），冷调，绝不发暖。
- **纯白** (#ffffff)：卡片与表面（--surface）。

**Named Rules**

**双层墨水规则（The Ink Rule）。** 每个亮色都有一个同族深色墨水态（均对白底 ≥4.5:1）：湖心青→深湖蓝 #01749f、嫩芽绿→深叶绿 #4a7d0b、暖阳黄→琥珀墨 #8a690a、蔷薇红→蔷薇墨 #c41e5a。**亮色只做填充与底色，文字与图标永远用墨水态。** 违反即违反 WCAG AA，禁止。已登记的品牌例外仅两处：湖心青填充上的白字（按钮/FAB）与 hero 渐变上的白字，靠形状与位置冗余识别，不得新增。

**一处湖心规则。** 任一屏幕上湖心青的覆盖面 ≤10%。它的稀缺就是它的信号强度——到处是青色，等于没有青色。

**收支不靠色规则。** 收入/支出除颜色（深叶绿/墨灰）外必须有文字或符号标识（+/-、图例文字），色盲用户不靠红绿区分。

## 3. Typography

**Display/Body Font:** Inter（回退 -apple-system, system-ui, PingFang SC）
**Numeric Font:** ui-monospace / JetBrains Mono（等宽，`font-variant-numeric: tabular-nums`）

**Character:** 单一无衬线家族靠字重与字号分层，中性、透明、不表演；数字换等宽字体，是整套排印里唯一的「换声道」，让金额天然对齐、扫读如表。

### Hierarchy
- **Display**（600，104rpx，letter-spacing -0.03em）：仅录入页金额大显示一处。
- **Headline**（600，64rpx / --text-2xl，行高 1.15）：引导页 h1、概要条结余金额。
- **Title**（600，40rpx / --text-lg）：appbar 标题、卡片主数字。
- **Body**（400–500，32rpx / --text-base，行高 1.5）：正文、列表主文字、按钮文字（600）。
- **Label**（600，24rpx / --text-xs）：区块标签、day-head、图例；22rpx 用于徽标/胶囊内文字。
- **Numeric**（600，随所在层级取号，tabular-nums，letter-spacing -0.02em）：一切金额（`.num` 类）。

**Named Rules**

**等宽数字规则（The Tabular Rule）。** 任何金额、汇率、笔数必须走 `.num`（等宽 + tabular-nums）。列表里的数字必须右对齐成列；比例失调的数字是本系统最刺眼的 bug。

**层级靠字重规则。** 相邻层级字号比 ≤1.25；对比不够时加字重（500→600），不加字号。工具界面拒绝夸张的字号跳跃。

## 4. Elevation

柔光分层（现状即规范）：**无硬边框**——卡片、分组、图表卡的 border 均为 transparent，层次全靠柔和的冷灰环境光阴影；**主色元素带同色光晕**——主按钮、FAB、选中态的阴影是自身颜色的半透明投影，像光从元素内部透出。这是「会呼吸」的物理基础：静止时柔光贴地，按下时缩放 + 阴影收紧。

### Shadow Vocabulary
- **soft**（`0 2rpx 6rpx rgba(52,65,78,0.05), 0 3rpx 13rpx rgba(151,167,183,0.16)`）：卡片/分组/输入框静置态。
- **press**（`0 2rpx 4rpx rgba(52,65,78,0.05), 0 4rpx 12rpx rgba(151,167,183,0.20)`）：分段控件选中态。
- **raised**（`0 4rpx 10rpx rgba(62,69,80,0.14)`）：编辑中的图表卡、需要浮起的元素。
- **primary-glow**（按钮 `0 10rpx 24rpx rgba(0,204,249,0.28)`；FAB `0 16rpx 36rpx rgba(0,204,249,0.36), 0 4rpx 12rpx rgba(0,204,249,0.24)`）：湖心青元素专属。
- **hero**（`0 18rpx 44rpx rgba(3,85,153,0.30)`）：概要条唯一使用。

**Named Rules**

**同色光晕规则。** 彩色阴影只允许是元素自身颜色的半透明投影（湖心青元素配青晕、hero 配深潭蓝晕）。中性元素禁止彩色阴影，彩色元素禁止黑灰阴影。

## 5. Components

**手感一句话：柔软但精确。** 外表圆润（胶囊、圆角、柔光），行为精确（≤100ms 反馈、等宽数字、态完整）。所有可点元素统一弹性按压过渡：`transform var(--motion-base) var(--ease-spring)`，ease-spring = `cubic-bezier(0.34, 1.4, 0.64, 1)`，motion-fast 160ms / motion-base 240ms。

### Buttons
- **Shape:** 全胶囊（radius-pill），最小高度 96rpx（≥44pt 触控目标）
- **Primary:** 湖心青填充 + 白字 600 + 青色光晕；按压 `scale(0.96)` + 底色加深（#00b8e0）+ 光晕收紧
- **Ghost:** 纯白底 + 1rpx 界灰描边 + 墨灰文字
- **Danger:** 透明底 + 蔷薇红文字 + 30% 蔷薇红描边（破坏性操作唯一样式）
- **Mini:** 68rpx 高胶囊，行内动作用
- **Disabled:** 主按钮用 #a3e6f5（湖心青 disabled 态），不做半透明

### Chips / Pills
- **分类 chip:** 白底 + 界灰描边，72rpx 高；选中 = 湖蓝描边 + 8% 青底 + 湖蓝文字 600
- **信息 pill:** 22rpx 文字胶囊；汇率 = 暖阳黄 16% 底 + 琥珀墨字；角色徽标 owner/admin/rw/ro 各配「填充底 + 墨水字」
- **状态徽章:** 反馈工单三态（待处理橙 / 处理中青 / 已解决绿），同样遵守双层墨水规则

### Cards / Containers
- **Corner:** radius-md（28rpx）；概要条 hero 用 radius-lg（40rpx）
- **Background:** 纯白；border transparent，层次靠 soft 阴影
- **Internal Padding:** 40rpx（--space-5）
- **概要条（签名组件）:** 深潭蓝→湖蓝 135° 渐变 + 右上角青色 radial 光斑 + hero 阴影，白字。全应用唯一深色浸染面，一屏只许一块

### Inputs / Fields
- **独立输入:** 96rpx 高、20rpx 圆角、白底 + 1rpx 界灰描边 + soft 阴影；聚焦描边变湖蓝
- **占位文字:** 云灰 #b2beca（placeholder-class="input-ph"），明显浅于正文防误读为已填
- **表单行（field-row）:** iOS 分组表单式，左标签（板岩灰）右值（500），行间 1rpx 分隔线，最小 108rpx 高

### Lists
- **设置行（li）:** 60rpx 圆角图标底（10% 青底 + 湖蓝图标）+ 正文 + 右侧值/chevron，104rpx 高，按压 4% 墨灰底
- **交易行（txn，签名组件）:** 84rpx 分类图标（支出 14% 青底 / 收入 20% 绿底）+ 标题/meta + 右侧等宽金额（收入深叶绿带 +，支出墨灰）；乐观插入的待同步行 opacity 0.55

### Navigation
- **自定义 tabBar** 四项（首页/统计/AI/我的），custom；**自定义导航栏**（navigationStyle: custom）：appbar 88rpx，标题 40rpx 600，账本切换胶囊居左
- **FAB「记一笔」:** 扩展胶囊（108rpx 高，图标 + 「记一笔」标签），湖心青 + 双层青晕，按压 `scale(0.9)`；只读成员不渲染。主行动必须带标签——无标注的 + 是全屏最没解释的元素
- **展示币种胶囊:** 顶栏常驻但安静（5% 墨灰底 + 石板墨字）；黄色（`--stale` 态）只在汇率回退/过期时出现

### Switch（iOS 式）
- 102×62rpx 胶囊轨道，off 界灰 / on 嫩芽绿，白色滑块带阴影，240ms 标准缓动

### AI 确认卡（签名组件）
- 白底 + 湖心青 1rpx 描边 + 青色光晕；头部 7% 青底 + 湖蓝小字「AI 预填」；键值行列表 + 双按钮（确认入账/放弃）；完成态描边与头部转绿。**AI 产出必经此卡确认，绝不直接入账**

### 图表（ECharts）
- 系列色：收入嫩芽绿 #9edf10、支出湖心青 #00ccf9、辅助界灰 #e4e7ec；轴线/标签雾灰 #97a7b7、板岩灰 #748294；高亮湖蓝 #0089c0
- 图表卡编辑态：湖蓝描边 + raised 阴影 + 左上角蔷薇红删除徽标 + 拖拽把手显现

## 6. Do's and Don'ts

### Do:
- **Do** 遵守双层墨水规则：文字用湖蓝/深叶绿/琥珀墨，填充才用湖心青/嫩芽绿/暖阳黄。对比度正文 ≥4.5:1、大字 ≥3:1、占位文字同样达标。
- **Do** 所有金额走 `.num`（等宽 + tabular-nums），列表数字右对齐成列。
- **Do** 可点元素给弹性按压反馈（ease-spring + scale），写操作乐观更新 ≤100ms 呈现（例外四类见 PRD 三之二），待同步行用 opacity 0.55。
- **Do** 触控目标 ≥88rpx（44pt），底部固定元素加 `env(safe-area-inset-bottom)`。
- **Do** 空态给出路（引导创建/示例），加载用骨架或整页遮罩（录入页数据未就绪时禁交互）。
- **Do** 新页面直接复用 `app.wxss` 既有组件类（.card/.li/.txn/.btn/.chip/.group/.empty/.foot-note），不另造轮子。
- **Do** 小目标控件用「透明 border + background-clip: padding-box」扩命中区到 ≥88rpx，视觉尺寸不变。
- **Do** 允许两类受控偏差：亮色的同族 pressed 加深色（如 #3f6a09/#365c08）、次级小元素 <20rpx 微圆角（图标底、声浪柱）；容器级圆角仍只用 20/28/40rpx 刻度。

### Don't:
- **Don't** 随手记式密集堆砌：首页与任何一屏不塞广告位、金融推销、功能矩阵；一屏只做一件事。
- **Don't** 营销页花哨感：不用渐变文字、装饰性插画堆砌、campaign 视觉；概要条是唯一渐变面，一屏一块，不得新增。
- **Don't** 修改 `design/` 目录任何文件，不改设计令牌的值，不新增色卡外的颜色（改配色只改 app.wxss 色卡块）。
- **Don't** 把原型 iPhone 画框 chrome（.stage/.phone/.dynamic-island/.statusbar/.home-indicator）带进小程序。
- **Don't** 用亮色（湖心青/嫩芽绿/暖阳黄）直接写文字，用板岩灰在青/绿底上写字（灰字配彩底必糊）。
- **Don't** 用蔷薇红渲染「超支」吓用户：红色只属于破坏性操作与错误。
- **Don't** 侧边彩条（border-left >1rpx 做强调）、嵌套卡片、装饰性毛玻璃（backdrop-filter 只用于 action-bar/composer 两处功能性场景）。
