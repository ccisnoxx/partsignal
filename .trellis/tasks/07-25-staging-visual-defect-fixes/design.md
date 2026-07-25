# 设计：线上视觉缺陷修复

## 设计目标

在现有组件和 CSS 所有权内修复三项确定性几何缺陷，并用真实浏览器留下会在缺陷复发时失败的最小回归断言。业务功能、数据流、权限、URL 和主题 Token 保持不变。

## 变更边界

### AI 渠道表格

责任点是 `AIChannelsPage` 的列宽与 `scroll.x`：

- 移除可截断的 API 根地址列固定宽度，使其成为唯一弹性长文本列。
- 将表格最小滚动宽度收敛到其余紧凑列与弹性列在 1440px 主列表可见区内可共存的值。
- 保留操作列 `fixed: 'right'` 及原有宽度和行为。
- 将 AI 页面固定列局部选择器对齐 Ant Design 6 的 `.ant-table-cell-fix-end`，确保普通、悬停和选中状态使用正确语义表面；不通过遮挡状态内容解决列重叠。

不修改 188px 状态 rail、340px 详情栏、共享 `TableRegion`、详情路由或服务端契约。

### 共享指标卡

责任点是 `global.css` 的 `max-width: 419px` 级联：

- 在通用 `padding: 12px` 之后，为 `.metric-with-icon > .ant-card-body` 恢复明确图标净空。
- 使用现有上方图标、下方正文的移动布局，不改变 `MetricTile` DOM、用户页两列 Grid 或桌面 `padding-left: 64px`。
- 共享规则同时覆盖用户和平台，Dashboard、GEO 与内容任务既有高优先级页面规则保持不变。

### 共享移动触控目标

责任点是 `global.css` 的既有 `max-width: 991px` 壳层断点：

- `.app-header .ant-btn` 设置 `min-width/min-height: 44px`。
- 默认 `.ant-drawer-close` 设置 `min-width/min-height: 44px`。
- 不改变桌面全局 `controlHeight=36`，不改 `AppLayout`、`ThemeModeControl` 或 Drawer DOM。

CSS-only 修复保留 Ant Drawer 的 Escape、焦点圈定、触发器恢复与现有可访问名称。

## 测试设计

### 几何断言

- `ai-channel-management.spec.ts`：使用 1440×1000、详情打开的真实渠道行，断言测试状态右边界不超过操作区域左边界；桌面可见区不靠固定列遮挡，窄屏只在 Ant Table 内滚动。
- `list-workbench-convergence.spec.ts`：复用用户与平台页面，在 375px、320px 断言每张带图标指标卡的图标矩形分别不与标题和值矩形相交。
- `cross-page-visual-convergence.spec.ts`：在 375px、768px 和真实 200% 代表场景断言导航、主题和默认 Drawer 关闭按钮均至少 44×44；Escape 后焦点恢复导航触发器。

### 既有回归

- 复跑 Dashboard/GEO 指标净空检查。
- 复跑相关 Vitest，确认查询、权限和交互入口未变化。
- 运行前端 typecheck、lint、production build。

### 视觉基线

用户 375px 基线会因缺陷修复产生预期差异。实施阶段先生成候选图并人工检查；只有用户批准后才更新对应 snapshot，其他 snapshot 不变。

## 不采用的方案

- 不通过隐藏测试状态、提高 sticky `z-index`、涂实遮罩或新增外层滚动容器修复 AI 表格。
- 不把用户指标 Grid 改为单列，也不复制页面级指标卡样式。
- 不把全局 `controlHeight` 提高到 44px，也不为每个 Drawer 单独配置关闭按钮。
- 不新增断点、Token、组件、依赖或兼容分支。

## 回滚

所有产品变更仅限前端列定义、共享 CSS 和对应测试。若局部验证失败，恢复这些精确改动即可；不涉及数据库、服务端状态、契约或部署数据回滚。
