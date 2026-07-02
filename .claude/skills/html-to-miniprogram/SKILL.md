---
name: html-to-miniprogram
description: 把 HTML/CSS 原型页面转换成微信小程序页面（WXML/WXSS/JS/JSON）。当需要将 design/ 里的 HTML 原型移植为 miniprogram 页面、或任何「html 转小程序 / 把网页原型变成小程序页面」的场景时使用。覆盖顶部状态栏/导航栏、底部 tabBar、内联 SVG 图标、不支持的 CSS（color-mix/backdrop-filter/oklab）、px→rpx、原生组件层级、scroll-view 滚动、拖拽交互、安全区等常见坑与对策。
---

# HTML 原型 → 微信小程序页面 转换

把一个 HTML 原型页移植成小程序页面时，按下面的**流程**做，并对照**陷阱清单**逐项检查。原型是「视觉契约」：像素、间距、状态、交互以原型为准，冲突时先对齐原型再重构内部。

## 转换流程（按顺序）

1. **读原型**：打开目标 HTML 及其 CSS，识别：页面结构区块、用到的组件类、内联 SVG 图标、交互态、固定/悬浮元素、滚动区域。
2. **令牌先行**：确认设计令牌（颜色/字号/间距/圆角/阴影/动效）已进 `app.wxss`；页面里只引用令牌，不写魔法值。
3. **剥离原型外壳**：删掉模拟外壳（iPhone 画框 `.phone`、`.stage`、状态栏 `.statusbar`、灵动岛 `.dynamic-island`、home 条 `.home-indicator`、9:41/电池/信号等）——这些系统会自己提供。
4. **搭页面四件套**：`index.wxml / .wxss / .js / .json`；把 `<div>→<view>`、`<span>→<text>`、`<a href>→navigator/bindtap`、`<img>→<image>`。
5. **处理顶部**：决定是否 `navigationStyle: custom`（见下），并给状态栏做动态占位。
6. **处理底部**：决定原生 tabBar 还是自定义 tabBar（见下）；底部安全区用 `env(safe-area-inset-bottom)`。
7. **换图标**：内联 SVG → `image`(PNG/SVG 文件或 base64) 或 icon 组件；tabBar 图标必须 PNG。
8. **换单位**：px → rpx（基准：设计稿逻辑宽度对应 750rpx）；细边框/字体可酌情保留 px。
9. **数据驱动**：静态内容改为 `data` + `setData`；`aria-selected`/`aria-current` 等状态用 class 绑定。
10. **落交互**：跳转、表单、拖拽、键盘、滚动逐一实现（见清单）。
11. **对像素**：真机/多机型比对原型，检查无横向溢出、安全区、颜色是否降级。

## 陷阱清单与对策

### 顶部（状态栏 + 导航栏 + 胶囊按钮）
- 原型自绘的状态栏/灵动岛是假的 → **删除**，系统提供真的。
- 原型的内容区自绘头部会和**原生导航栏叠加** → 设 `"navigationStyle": "custom"` 隐藏原生栏后自绘。
- 自定义导航后**状态栏会压住头部** → 用 `wx.getWindowInfo().statusBarHeight` 动态撑占位块（各机型高度不同，刘海屏更高）。
- **右上角胶囊按钮（⋯ 和 ○）永远存在且不可移除** → 自绘导航栏右侧内容（币种、操作按钮）会被它遮挡。必须用 `wx.getMenuButtonBoundingClientRect()` 拿到胶囊位置：导航栏高度 = `(menu.top - statusBarHeight) * 2 + menu.height`（与胶囊垂直居中对齐），右侧预留 = `windowWidth - menu.left`（作为 padding-right，右侧内容不越界到胶囊下）。

### 底部（tabBar）
- 原生 tabBar **只支持 PNG 图标（不支持 SVG）**，建议 81×81px，只能配 color/selectedColor/文字，**做不了毛玻璃、做不了中间凸起 FAB**。
- 原型若是「毛玻璃 tabBar + 悬浮记账 FAB」这类效果 → 需用**自定义 tabBar**（`custom-tab-bar` 组件）才能还原。
- 底部小黑条是假的删掉；**底部安全区是真的** → 用 `env(safe-area-inset-bottom)`，别用原型里写死的 padding。
- tabBar 页面间跳转用 `wx.switchTab`，不是 `navigateTo`。

### 图标
- **WXML 不渲染内联 `<svg>`** → 导出为 PNG/SVG 文件用 `<image>`、转 base64 data-URI，或做 icon 组件/字体图标。

### CSS 兼容（WXSS 跑在各机型 webview）
- **`color-mix()` / `oklab`**：新特性，安卓旧内核会整片失效 → 移植时**预先算成固定 hex**，别运行时 color-mix。
- **`backdrop-filter: blur()`**：安卓支持差，常只剩半透明底 → 需毛玻璃处的效果要有降级方案。
- 没有 hover：`:hover`/`:focus-visible`/`::selection`/`::-webkit-scrollbar`/`prefers-reduced-motion` 多数无意义或不支持。
- CSS 变量能用，但全局变量建议定义在 `page{}` 上（`:root` 在 WXSS 里语义不完全对等）。
- `aspect-ratio`、容器查询等新特性慎用，需验证目标基础库/机型。

### 单位
- 原型 px 基于固定逻辑宽度 → 换 **rpx**（`屏宽 = 750rpx`，按比例换算再校准）。

### 原生组件层级（隐蔽！）
- `textarea` / `input`(部分) / `video` / `canvas` / `map` 是**原生组件，渲染在 webview 之上**，普通 `view` **盖不住** → 遮罩/下拉/弹层在输入框上方会被穿透，用 `cover-view` 或改结构。
- 键盘弹起会顶开/遮住底部 `position: fixed` 的输入条 → 处理 `adjust-position`、`cursor-spacing`。

### 滚动
- 页面本身可滚；若要「头部固定 + 中间独立滚动」，用 `scroll-view`，它**必须有固定高度**才滚，另有惯性滚动/滚动事件等脾气。

### 交互 / JS
- `<a href>` → `navigator` 或 `bindtap` + `wx.navigateTo`；无 DOM，不能 `querySelector`，一律 `setData` 数据驱动。
- **拖拽排序 / 长按拖拽**：HTML5 drag 不存在 → 用 `movable-view` 或自写 touch 手势。

### 受控输入 / 表单
- **`<input value="{{x}}">` 若 `bindinput` 里不 `setData(x)`，用户会「打不上字/被重置」** → 受控输入必须在 `bindinput` 里 `this.setData({ x: e.detail.value })`。
- **自定义数字键盘 vs 系统键盘**：原型常自绘九宫格键盘，但它固定在长页面底部要滚动才看得到、且实现繁琐。多数场景直接用 `<input type="digit">`（金额）或 `type="number"` 调系统键盘更稳，再在 `bindinput` 里净化非法字符（只留数字 + 一个小数点 + 限定小数位）。需要键盘立即弹出可加 `focus="{{true}}"`。
- **日期/选择类**：原型的假下拉/日期 → 用 `<picker mode="date/selector">` 包住那一行。
- **微信头像昵称授权**：`wx.getUserProfile` 已废弃 → 用 `<button open-type="chooseAvatar" bindchooseavatar>` 取头像 + `<input type="nickname">` 取昵称，头像是临时路径需 `wx.cloud.uploadFile` 上云后存 fileID。

### 其他
- **字体**：不能直接 `@font-face` 引本地字体 → `wx.loadFontFace` 或退回系统字体。
- **自定义组件样式隔离**：app.wxss 全局 class 默认**进不去组件内部** → `addGlobalClass` 或显式传样式。
- **`<button>`** 自带样式和 `::after` 边框，难清 → 多数情况用 `view` + `bindtap` 更干净。
- **`<image>`** 默认 320×240 且必须指定 `mode`，否则变形。

## 完成前自检
- [ ] 假外壳（画框/状态栏/灵动岛/home 条）已删除
- [ ] 顶部不与原生导航栏叠加，状态栏高度已让位
- [ ] tabBar 方案确定，图标为 PNG，安全区已用 env()
- [ ] 内联 SVG 已全部替换
- [ ] color-mix/backdrop-filter 等有固定色/降级
- [ ] px 已换 rpx，多机型无横向溢出
- [ ] 输入框相关的遮挡/键盘问题已处理
- [ ] 静态内容已数据驱动，跳转/拖拽等交互已实现
- [ ] 与原型逐屏比对视觉与交互一致
</content>
