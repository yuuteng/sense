# 心数 / Sense — 品牌图标资源包

记账 App 图标，主视觉为「方孔钱 + 记账明细」并排式，金币渐变底，黑色线条。

## 目录结构

### icon/  主图标
- `icon-square.svg` — 方角满铺主图标（**App Store / iOS 提交用**，系统会自动加圆角遮罩，所以这一版不要自带圆角）
- `icon-rounded.svg` — 圆角版（网页、营销物料、Android、预览用）
- `icon-1024/180/167/152/120/87/80/60/40.png` — 方角各尺寸 PNG（iOS 常用尺寸全覆盖）
- `icon-rounded-1024/512/256.png` — 圆角版 PNG

### wordmark/  字标组合（含 SVG 矢量 + PNG）
- `wordmark-en-horizontal` — 英文横版（图标 + Sense）
- `wordmark-cn-horizontal` — 中文横版（图标 + 心数）
- `logo-vertical-cn` — 竖版中文（图标在上，心数在下）
- `logo-vertical-en` — 竖版英文（图标在上，Sense 在下）

### variant/  变体
- `icon-dark.svg` / `.png` — 深底版（近黑底 + 金色线条），用于深色背景
- `icon-mono-black.svg` — 纯黑单色（透明底，仅图形），用于单色印刷、盖章、水印
- `icon-mono-white.svg` — 纯白单色（透明底），用于深色背景

## 设计规范
- 金色渐变：上 #F7CB57 → 下 #E29A2B
- 线条主色：#161616（近黑）
- 文字色：#1A1A1A
- 圆角半径：约图标边长的 22.5%

## 说明
- 字标里的「心数 / Sense」文字已转为矢量轮廓（不依赖字体），任何设备打开都一致。当前用的是 Noto Sans CJK 字形；若日后想换成指定品牌字体或做定制字形，可随时重做。
- PNG 已按 iOS 常见尺寸导出；如需 Android 自适应图标（前景/背景分层）或更多尺寸，可再补。
