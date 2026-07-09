# 心数 / Sense

一款简洁轻量、支持**多人协作**与**多币种**、内置 **AI 助手**的微信小程序记账应用。基于**微信云开发**（无独立后端服务器）。

- 产品需求：[Sense-PRD.md](Sense-PRD.md)
- 开发规范：[CLAUDE.md](CLAUDE.md)
- 数据与接口梳理：[数据与接口梳理.md](数据与接口梳理.md)
- 数据库设计 + 测试数据：[docs/sql.md](docs/sql.md)
- 后端接口说明：[docs/api.md](docs/api.md)
- 设计令牌（FPS 色卡）：[docs/design-tokens.md](docs/design-tokens.md)
- 变更记录：[.claude/devlog.md](.claude/devlog.md)

---

## 功能一览

- **账本**：共享账本 / 分账账本；默认账本与顶栏一键切换、微信卡片邀请加入、成员四级权限（owner / admin / 读写 / 只读，服务端强制）。
- **记账**：收入/支出、两级分类（账本级、可自定义、软停用）、多币种、备注、图片附件、付款人与分摊（均摊 / 我请客）；支持编辑与删除。
- **多币种**：每笔按**记账当日汇率固化**，历史金额永不随汇率漂移；展示币种随时切换（只改汇总口径）；汇率每日定时更新 + 懒加载兜底。
- **统计（ECharts）**：8 种图表卡（月度收支 / 分类占比排行 / 支出趋势 / 收支对比 / 结余走势 / 年度收支 / 每日支出 / 累计收支），可重复添加、整卡拖拽排序、区间与月份切换，布局按「账本 × 用户」各存一套；图例行 / 分类排行 / 柱状图两段式均可**点击钻取**到记录明细页。
- **AI 助手**：数据问答（服务端聚合真实数据，不编造）、收据识别（多模态模型）、自然语言记账、**语音输入**（腾讯云一句话识别，按住说话）——记账类结果一律生成**预填记录，确认后才入账**；免费额度 50 次模型调用。
- **导入导出**：导出 JSON / Excel / CSV / PDF（下载或邮件发送）；导入 JSON / Excel / CSV，指纹查重防重复、结果面板（成功/跳过/失败/新建分类 + 行号明细）、支持**撤销本次导入**。
- **分账结算**：按付款人 + 分摊算成员净额、合并最少转账笔数、标记结清（P2 核心已提前落地）。
- **反馈工单**：用户提交（标题/描述/截图/邮箱）→ 客服回复线程 + 状态流转；owner 邀请码管理客服团队；未读红点。
- **其他**：微信授权登录、头像昵称修改、隐私说明页、演示数据一键载入/清除（与真实数据完全隔离）。

---

## 技术栈

- **前端**：微信原生小程序（WXML / WXSS / JS / JSON），自定义导航栏 + 自定义 tabBar；图表用 **ECharts**（`ec-canvas` canvas 2d 定制包）。
- **后端**：微信云开发
  - 云函数 `cloudfunctions/api`：单入口，按 `{ resource, type }` 路由（如 `record.list`），服务端 `OPENID` 鉴权；腾讯云 ASR 以手写 TC3 签名直调（零第三方依赖）。
  - 云数据库：11 个集合（users / books / members / categories / records / rates / chartLayouts / aiMessages / feedbacks / admins / files）。
  - 云存储：头像、记录图片、反馈截图、导出文件（有台账可回收）、语音临时音频（识别完即删）。
  - AI：云开发大模型接入（`cloud.extend.AI`，问答 + 收据多模态）。
- **设计系统**：FPS 色卡整体换肤（令牌驱动，见 [docs/design-tokens.md](docs/design-tokens.md)）。

---

## 目录结构

```
sense/
├── miniprogram/            # 小程序前端
│   ├── app.js/json/wxss    # 全局配置与样式（设计令牌）
│   ├── pages/              # tab：home/stats/ai/settings
│   │                       # 页面：add/detail/records/books/bookConfig/export/onboarding/
│   │                       #       settle/login/join/privacy/feedback(-new/-detail/-team)
│   ├── components/         # nav-bar/chart/avatar/calendar/currency-picker/book-switcher/loading
│   ├── custom-tab-bar/     # 自定义底部导航
│   ├── ec-canvas/          # ECharts canvas 2d 定制包
│   └── utils/              # api(调用封装)/format/icons(SVG)/chart-theme/currency/tabbar
├── cloudfunctions/api/     # 后端主云函数（handlers/lib/dataio/seedData）
├── design/                 # ⚠️ 只读：HTML 高保真原型（UI 事实来源）
├── docs/                   # 数据库/接口/设计令牌文档
├── Sense-PRD.md            # 产品需求
└── CLAUDE.md               # 开发规范
```

---

## 本地运行 / 部署

1. **环境**：微信开发者工具打开本项目；`miniprogram/app.js` 的 `globalData.env` 填入你的云开发环境 ID（云环境 ID 可公开）。
2. **部署云函数**：右键 `cloudfunctions/api` →「上传并部署：云端安装依赖」。
3. **编译运行**：点击「编译」。首次进入会走**登录页**（填头像昵称）。
4. **云函数环境变量**（云开发控制台 → 云函数 `api` → 配置）：

   | 变量 | 用途 | 必需 |
   |---|---|---|
   | `APP_ENV` | `dev` 开启演示数据/清库等开发功能；缺省 `prod` 全部禁用 | 开发时 |
   | `FEEDBACK_OWNER` | 反馈工单 owner 的 openid（逗号分隔可多个） | 用反馈功能时 |
   | `AI_PROVIDER` / `AI_VISION_MODEL` | 大模型供应商与多模态模型（默认 hunyuan-vision） | 用 AI 时 |
   | `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` | 腾讯云 ASR 密钥（语音输入） | 用语音时 |
   | `AI_FREE_QUOTA` | AI 免费调用次数（默认 50） | 可选 |

5. **载入演示数据（仅 dev）**：登录 → 我的 →「载入演示数据」；重复载入自动先清旧数据。「清空所有数据」可整库（含云存储文件）重置。
6. **语音输入前提**：腾讯云开通「语音识别」服务（新账号后付费默认关闭，只用免费额度零成本）；mp 后台「用户隐私保护指引」勾选**麦克风**（相机/相册同理，供收据识别用）。

> 数据库集合由云函数在登录/建账本/初始化时自举创建，无需手动建表。
> **安全**：清库重灌等危险脚本仅在 `APP_ENV=dev` 时可用；默认（无配置）即禁用，公开仓库无法被利用。所有密钥只放云函数环境变量，切勿写进代码。

---

## 开发约定

- `design/` 目录只读，是 UI 事实来源；HTML→小程序转换见 skill `/html-to-miniprogram`。
- 权限、汇率固化、AI 数据范围等在云函数端强制，不信任前端。
- AI 绝不自动入账：收据识别 / 自然语言 / 语音输入全部走「预填记录 → 用户确认」。
- devlog 每天一条（[.claude/devlog.md](.claude/devlog.md)）；git 不自动提交，等指令。
- 详见 [CLAUDE.md](CLAUDE.md)。
