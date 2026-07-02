# 心数 / Sense

一款简洁轻量、支持**多人协作**与**多币种**、内置 **AI 助手**的微信小程序记账应用。基于**微信云开发**（无独立后端服务器）。

- 产品需求：[Sense-PRD.md](Sense-PRD.md)
- 开发规范：[CLAUDE.md](CLAUDE.md)
- 数据与接口梳理：[数据与接口梳理.md](数据与接口梳理.md)
- 数据库设计 + 测试数据：[docs/sql.md](docs/sql.md)
- 后端接口说明：[docs/api.md](docs/api.md)
- 变更记录：[.claude/devlog.md](.claude/devlog.md)

---

## 功能一览（P1）

- **账本**：共享可见型 / 分账结算型；默认账本、切换、成员与四级权限（owner/admin/读写/只读）。
- **记账**：收入/支出、两级分类、多币种（当日汇率固化换算）、备注、图片附件、付款人；记录人固定为当前用户。
- **多币种**：按记账当日汇率固化换算，历史金额不随汇率变动。
- **图表**：本月概览 / 支出趋势 / 近一年收支 / 累计收支，卡片可增删、长按拖拽排序，布局按「账本 + 用户」各存一套。
- **AI 助手**：数据问答、收据识别、自然语言记账（均生成预填记录，确认后才入账）。
- **导入导出**：JSON 导出 / 导入。
- **登录**：微信授权获取头像昵称，可随时修改在各账本中的名字。

> 分账结算（自动算谁欠谁）为 P2；当前 settle 页已可展示与标记结清。

---

## 技术栈

- **前端**：微信原生小程序（WXML / WXSS / JS / JSON），自定义导航栏 + 自定义 tabBar。
- **后端**：微信云开发
  - 云函数 `cloudfunctions/api`：单入口，按 `{ resource, type }` 路由（如 `record.list`），服务端 `OPENID` 鉴权。
  - 云数据库：8 个集合（users / books / members / categories / records / rates / chartLayouts / aiMessages）。
  - 云存储：头像、记录图片。
- 设计系统：Alan 风格（暖奶油底 + Alan 蓝 + 柔和分层阴影 + 弹性微交互），令牌驱动。

---

## 目录结构

```
sense/
├── miniprogram/            # 小程序前端
│   ├── app.js/json/wxss    # 全局配置与样式（设计令牌）
│   ├── pages/              # 页面：home/stats/ai/settings(tab) + add/detail/books/bookConfig/onboarding/settle/login
│   ├── components/nav-bar/ # 自定义导航栏（状态栏让位 + 胶囊避让）
│   ├── custom-tab-bar/     # 自定义底部导航
│   └── utils/              # api(调用封装) / format(格式化) / icons(SVG 图标)
├── cloudfunctions/api/     # 后端主云函数（含 seed 测试数据）
├── design/                 # ⚠️ 只读：HTML 高保真原型（UI 事实来源）
├── docs/                   # 数据库与接口设计文档
├── Sense-PRD.md            # 产品需求
└── CLAUDE.md               # 开发规范
```

---

## 本地运行 / 部署

1. **环境**：微信开发者工具打开本项目；`miniprogram/app.js` 的 `globalData.env` 填入你的云开发环境 ID（云环境 ID 可公开）。
2. **部署云函数**：右键 `cloudfunctions/api` →「上传并部署：云端安装依赖」。
3. **编译运行**：点击「编译」。首次进入会走**登录页**（填头像昵称）。
4. **载入演示数据（仅开发用）**：在云开发控制台把云函数 `api` 的**环境变量 `APP_ENV` 设为 `dev`**，然后登录 → 我的 →「初始化测试数据」。生产环境不设或设为 `prod`，该功能自动禁用。

> 数据库集合由云函数在登录/建账本/初始化时自举创建，无需手动建表。
> **安全**：清库重灌等危险脚本仅在 `APP_ENV=dev` 时可用；默认（无配置）即禁用，公开仓库无法被利用。真实密钥（如将来接入的 AI key、AppSecret）请放云函数环境变量，切勿写进代码。

---

## 开发约定

- `design/` 目录只读，是 UI 事实来源；HTML→小程序转换见 skill `/html-to-miniprogram`。
- 权限、汇率固化、AI 数据范围等在云函数端强制，不信任前端。
- 详见 [CLAUDE.md](CLAUDE.md)。
</content>
