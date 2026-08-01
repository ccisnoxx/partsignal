# 前端轻量资源与兼容清理

## 目标

修复第二轮全项目回归中的 `PS-QA2-UI-001` 与 `PS-QA2-UI-003`：让匿名入口使用受版本控制的 PartSignal favicon，消除首次加载的 `/favicon.ico` 404；把发布详情唯一的 Ant Design Timeline 弃用字段迁移到当前合同，消除稳定控制台警告且保持状态轨迹内容不变。

## 背景与已确认事实

- 权威来源：
  - `.trellis/tasks/archive/2026-08/07-31-sitewide-functional-regression-testing-round-2/report.md`
  - `.trellis/tasks/archive/2026-08/07-31-sitewide-functional-regression-testing-round-2/research/findings.md`
- `frontend/index.html:1-20` 没有 `rel="icon"` 声明；`frontend/public/` 只有 `llms.txt`、`robots.txt` 和 `theme-init.js`，浏览器因而回退请求 `/favicon.ico` 并得到 404。
- 登录页和应用壳层已经持有 PartSignal 矢量标记；favicon 可复用适合小尺寸的应用壳层紧凑标记，不需要新品牌概念或外部素材。
- 当前安装的 Ant Design 为 `6.5.0`；`TimelineItemType.children` 已标记弃用，运行时会提示改用 `content`。
- `frontend/src/features/publications/PublicationDetailPage.tsx:61-72` 是仓库唯一仍在 Timeline `items` 中使用 `children` 的业务页面；发布 Drawer、内容审核、审计详情和产品事实已使用 `content`。
- 现有生产公开资产门禁由 `frontend/scripts/check-production-assets.mjs` 持有，发布详情回归已有 `frontend/src/features/publications/PublicationsPage.test.tsx`，无需新增测试框架或包装组件。

## 根因

1. HTML 入口没有声明站点图标，公开资源目录也没有图标文件；浏览器只能尝试约定路径 `/favicon.ico`。
2. 发布详情保留了 Ant Design 旧版 Timeline item 字段，依赖升级后仍能渲染但会在开发/验收环境稳定输出弃用警告。

## 范围内

1. 在 `frontend/public/` 增加受版本控制的 SVG favicon，复用现有 PartSignal 紧凑矢量标记。
2. 在 `frontend/index.html` 显式声明该 SVG favicon。
3. 扩展现有生产公开资产检查和最小夹具测试，使缺失 favicon 文件或声明时构建门禁明确失败。
4. 将发布详情 Timeline item 的 `children` 改为 `content`，保持状态、说明和时间渲染完全一致。
5. 扩展现有发布页面测试，证明只读发布详情仍展示状态轨迹，且不再产生 `items.children` 弃用警告。

## 范围外

- 不新增 `.ico`、Web App Manifest、Apple Touch Icon、多尺寸图标管线或图标生成依赖。
- 不重绘品牌、不改变登录页或应用壳层 Logo，不修改主题 Token、CSS、页面布局或视觉基线。
- 不封装 Timeline，不批量重写已经使用 `content` 的其他四处 Timeline。
- 不修改发布 API、状态事件结构、路由、权限、数据合同、后端或数据库。
- 不处理 24 表门禁、验收文档、`available_actions` 决策或其他剩余回归组。

## 需求

1. HTML 必须显式声明唯一的 `/favicon.svg`，文件由 Vite `public/` 机制原样进入构建产物。
2. favicon 必须复用现有 PartSignal 紧凑标记，保持透明背景和小尺寸可辨识性，不引入第二套品牌资产体系。
3. 生产公开资产门禁必须同时验证 favicon 声明和构建产物存在；错误应继续进入现有统一失败列表，不新增独立脚本。
4. 发布详情必须只使用 Ant Design 当前支持的 `content` 字段，状态轨迹的文本、状态标签、时间和顺序不变。
5. 测试不得过滤或吞掉未知 console 输出；只对本缺陷的 Timeline 弃用消息建立回归断言。

## 验收标准

- [x] AC1：`frontend/index.html` 只有一个 `rel="icon"` 声明，指向受版本控制的 `/favicon.svg`。
- [x] AC2：生产构建包含 `dist/favicon.svg`；现有公开资产检查在 favicon 文件或声明缺失时失败，在两者正确时通过。
- [x] AC3：新浏览器会话加载匿名入口时不再依赖 `/favicon.ico`，声明的 favicon 可返回成功响应且不产生资源 404。
- [x] AC4：发布详情 Timeline item 使用 `content`，页面仍按原顺序显示状态、说明和时间。
- [x] AC5：发布详情渲染不再输出 Ant Design `items.children` 弃用警告，测试不通过屏蔽 console 达成绿色。
- [x] AC6：不修改 CSS、依赖、API、路由、权限、状态逻辑、后端、合同或数据库；其他 Timeline 实现保持不变。
- [x] AC7：公开资产脚本测试、发布页面定向 Vitest、前端类型检查、Lint 和生产构建通过。

## 依赖与阻塞问题

- 本任务不依赖 24 表门禁或文档决策，可以独立实施。
- 已完成的浮层焦点、危险删除文案和资源动作投影不在本任务修改范围。
- 阻塞问题为空；favicon 形状、Timeline 新字段和验证所有者均已由当前仓库确定。
