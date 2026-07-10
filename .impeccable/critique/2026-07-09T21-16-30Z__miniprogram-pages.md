---
target: 当前实现的所有页面 (miniprogram/pages)
total_score: 32
p0_count: 1
p1_count: 3
timestamp: 2026-07-09T21-16-30Z
slug: miniprogram-pages
---
Method: dual-agent (A: design review · B: detector + objective scans)

# 心数 / Sense 全页面 Critique（miniprogram/pages，19 页）

## Design Health Score

| # | 启发式 | 分 | 关键问题 |
|---|---|---|---|
| 1 | 系统状态可见性 | 4 | 无图片保存也走 wx.showLoading 阻塞（add.js:371）；其余典范（pending 行 0.55、typing 点、load-more） |
| 2 | 贴近真实世界 | 4 | 「已固化」「口径」等术语漏进用户文案（detail.js:36、detail.wxml:29） |
| 3 | 用户控制与自由 | 2 | 录入页离开无未保存守卫；删记录无撤销；AI 卡「放弃」不可逆（ai.wxml:57） |
| 4 | 一致性与标准 | 3 | tabBar 违反自家墨水规则；book-type--share 徽章被挪用当收/支标签（detail.wxml:13）；role--ro 样式孤儿（books.wxml:19） |
| 5 | 错误预防 | 3 | 解散账本仅双击守卫（bookConfig.js:162-170）；反馈邮箱行内校验做得好 |
| 6 | 识别而非回忆 | 3 | 长按停用分类、长按进图表编辑均无可见提示（add.wxml:25、stats.wxml:38） |
| 7 | 灵活与效率 | 4 | 语音按住说话、一句话记账、每人图表布局、点击钻取 |
| 8 | 美学与克制 | 4 | 真正克制；hero 一屏一块守住了 |
| 9 | 错误恢复 | 3 | api.toast 透传服务端原始 errMsg（utils/api.js:20-23）；AI 失败只有「出错了，请稍后再试。」（ai.js:187） |
| 10 | 帮助与文档 | 2 | 无帮助/FAQ；AI 页零引导（空会话只有额度免责一行，ai.wxml:19-22） |
| **合计** | | **32/40** | **Good：底子扎实，扣分集中且可修** |

## 反模式判定（AI slop）

**不是 AI slop。** LLM 评审与检测器一致：0 侧边彩条、0 渐变文字、backdrop-filter 仅 3 处功能性使用、唯一渐变面（hero）守住、19 页共用一套组件词汇。检测器 20 条命中：3 条弹跳缓动（ease-spring overshoot 1.4 属 DESIGN.md 已文档化的品牌手感，判**接受偏差**；typing-bounce/rec-bounce 同理）、9 条色板外颜色（真越界：#7fe6ff、rgba(196,30,90)、#2c4a00/#5c4a00；误报：rgba(0,0,0,.2) 是阴影）、8 条圆角偏移（12/14/16/18/24rpx 不在 20/28/40 刻度上，轻微漂移）。检测器对 .wxml 零解析（HTML 检测器不认 WXML），浏览器可视化不适用（小程序无浏览器渲染路径）。残留模板惯性：group__title 的 uppercase+tracking 对中文是空操作（app.wxss:437）；「还没有账本」空态在 home/stats 内联复制两份而非组件。

## 总体印象

工具感成立、纪律感罕见地好：乐观更新是真架构不是口号，导入结果面板是同品类顶级。最大的一个机会：**对比度契约与 FPS 色卡在数学上不可两全**——PRODUCT.md 写「严格 AA」，但两个墨水色（#0089c0 ≈3.9:1、#5c9a0e ≈3.45:1）和 --muted（#748294 ≈4.0:1）全部落在 4.5:1 之下。双层墨水规则修掉了最坏一类错误，但墨水层本身从未按 4.5 验过。这必须拍板，不能两头都装作成立。

## 做得好的

1. **乐观更新架构落地**：justSaved/justDeleted 跨页交接 + 服务端对账 + pending 行样式（home.js:47-92），币种切换/工单状态/停用分类均有失败回滚。
2. **导入结果 UX**：成功/跳过/失败计数、逐行原因、复制失败明细、批次撤销、可重看（settings.wxml:100-141）。
3. **图表色治理**：CVD 校验过的 8 色分类板、灰色「其他」溢出、色点+文字+金额三重冗余（utils/chart-theme.js:115-150）；语音识别只填输入框不自动发送，忠于「AI 绝不自动入账」。

## 优先问题

1. **[P0] 对比度契约系统性未达标。** 白字压湖心青 ≈1.9:1（btn--primary app.wxss:237、FAB :135、msg--me :387、currency-switch selected :284、日历选中 calendar/index.wxss:23）；--accent-ink #0089c0 ≈3.9:1（30 处文字用）；--success-strong #5c9a0e ≈3.45:1（收入金额）；--muted #748294 ≈4.0:1（75 处，其中 ≥42 处 ≤24rpx 小字）；占位符 #b2beca ≈2.1:1，直接违反 PRODUCT.md「placeholder 同样 ≥4.5:1」。**修法二选一**：在 app.wxss 色卡块铸造更深墨水层（蓝 ~#01678f、绿 ~#4a7d0b、灰 ~#5f6c7d），或把 PRODUCT.md 无障碍声明诚实降级为「大字 AA + UI 组件 3:1」。两文档必须对齐。
2. **[P1] 自定义 tabBar 违反自家墨水规则 + 对比不达标。** 选中 tab = #00ccf9 亮青文字，20rpx/10px，≈2.0:1（custom-tab-bar/index.wxss:20、index.js:3、app.json:32 同步错）。修：选中色换墨水层深蓝，标签升 22rpx。
3. **[P1] 首页零记录无空态。** 有账本 0 记录时 hero 下面纯空白（home.wxml:42-75）；「空态给出路」承诺与新手首航双双落空。且 needInit 文案指向「我的 → 初始化测试数据」——开发者菜单、名字还对不上（实际叫「载入演示数据」，settings.wxml:58）。修：空态引导 FAB / AI 一句话记账；改写 needInit 文案。
4. **[P1] 解散账本只有 2.5s 双击守卫**（bookConfig.js:162-170）。全产品最高风险操作，守卫弱于移除单个成员（有 modal）。修：对齐注销账号级别——modal + 输入账本名确认。
5. **[P2] AI 用户气泡：湖心青底白字**（app.wxss:387）——≈1.9:1 不可读，且任何活跃会话必然击穿「一处湖心 ≤10%」。修：气泡换深蓝填充，或浅青底 + 墨字。
6. **[P2] 旗舰数字违反等宽数字规则。** 录入页金额输入（全应用唯一 Display 级数字）无 mono/tabular（add.wxss:13-17、add.wxml:17）；app.wxss:272 的 104rpx .val 同病。修：补 font-family: var(--font-mono) + tabular-nums。
7. **[P2] 破坏性/精细控件触控 <88rpx**：照片删除 × 40rpx（app.wxss:335）、图表删除徽标 48-52rpx（app.wxss:364、stats.wxss:117）、月份切换 ‹› 56rpx（stats.wxss:5-10）。修：padding/伪元素扩大热区，视觉不动。
8. **[P3] 详情页打磨簇**：记录图片不可预览（feedback-detail 有 previewImage，detail 没有）；收/支徽章借用 book-type--share 样式带对勾图标；settle 金额永远 ¥ 不看基准币种（settle.js:52）且 '−'/'-' 字形混用。

## Persona 红旗

**Casey（单手分心）**：40-52rpx 删除类目标拇指易误触；币种胶囊+账本切换都在顶部拇指盲区，误触币种胶囊触发整页口径切换；错误只有 ~1.5s toast，走神即错过、回滚看着像丢数据。好的一面：删除双击 2.5s 自取消、按住说话可滑动取消。
**Jordan（记账新手）**：开屏第一个决策就是「共享 vs 分账」+「统计币种」双术语，无「跳过/以后再说」；建完账本落在无空态首页，FAB 是无标注的 +；AI 页无起手问题示例，相机图标≠收据识别无提示；两个长按手势纯靠回忆。
**Sam（无障碍）**：P0 全套对比清单最伤（收入金额 3.45:1、次要文字 3.9:1、占位 2.1:1、白压青 1.9:1、青 tab 标签 10px 2.0:1）；hero 上 opacity:0.7 白标签 <3:1（app.wxss:172）。颜色不孤立传义做得真好：金额 +/- 前缀、图例点+字、已结清=删除线+透明度+按钮文案、CVD 图表板。✓

## 次要观察

- 10 位数结余会顶到 hero 卡边，无缩排策略（app.wxss:173）。
- books.wxml:19 把 ro 映射到 role--rw 灰徽章，role--ro 黄样式成孤儿。
- 色板外颜色：#2c4a00/#5c4a00（settings.wxss:33-34）、#7fe6ff（ai.wxss:33）、rgba(196,30,90,.92)（ai.wxss:29）。
- feedback-team 用 fb-status--processing 徽章标 owner——状态词汇挪用为角色词汇。
- login 加号头像亮青 ~2:1（login.wxss:22）。
- .ai-disclaimer 类被 home/books/settle 借用当列表尾注——类语义漂移。
- 圆角刻度漂移 8 处（检测器：12/14/16/18/24rpx）。
- prefers-reduced-motion 全库 0 处（小程序支持有限，但无任何补偿策略）。
- AI 额度是静态文案，无剩余次数显示，首次硬拒绝会显得莫名其妙。
- 分类图标选择器混入 mail/privacy/share 等与记账无关图标（add.js:67-73）。

## 值得想的三个问题

1. **真正的契约是冻结的 FPS 色卡还是「严格 WCAG AA 全项」？** 两者数学上不可兼得，装作都成立是设计系统对自己撒的最大的谎。
2. **「展示币种」配得上三个 tab 的顶栏常驻位吗？** 全局低频设置占着最稀缺的 chrome，还紧挨账本切换，一次误触重算全屏数字。
3. **产品即「记一笔」，为何主行动是无标注的悬浮 +，而 tabBar 却给「AI 助手」整个坑位？** 中央记一笔 tab（或带标签 FAB）能把 JTBD 编码进导航本身。
