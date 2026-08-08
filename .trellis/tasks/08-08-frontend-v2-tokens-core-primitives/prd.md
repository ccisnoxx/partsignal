# Frontend V2 Tokens + Core Primitives

## Goal

建立 `frontend-v2` 可独立消费的最小 Design System 基线，使后续 App Shell 与 Table Kit 能复用稳定的 CSS token 和可访问 primitives，而不引入任何业务、路由或领域状态。

## In Scope

### Token 基线

- 单一权威来源：`frontend-v2/src/styles/global.css`。
- Surface：`surface-app`、`surface-panel`、`surface-raised`、`surface-overlay`、`surface-selected`。
- Text：`text-primary`、`text-secondary`、`text-muted`、`text-disabled`、`text-danger`。
- Border：`border-subtle`、`border-default`、`border-strong`、`border-focus`。
- Status：`success`、`warning`、`danger`、`info`。
- Typography：display、page title、section title、body、body small、label、mono 的最小字号、行高和字重契约。
- 仅补充本任务 primitives 实际消费的交互色、radius、focus ring 与 overlay scrim token。
- Tailwind 4 utilities 只映射上述 CSS Variables；feature 与 story 不写散落的原始颜色。
- 仅交付 light baseline，不交付 dark mode、品牌扩展或用户主题配置。

### Core Primitives

- Button
- IconButton
- Input
- Select
- Badge
- Tooltip
- DropdownMenu
- Dialog
- Sheet
- Tabs
- Skeleton

除 `IconButton` 外，优先使用 shadcn CLI 生成的 Base UI 源码。`IconButton` 必须复用 Button 的 variant、size、focus 和 disabled 能力，并要求可访问名称。

### Storybook 与测试

- 最小 Storybook 配置与 `storybook`、`build-storybook` scripts。
- 每个新增 primitive 有可 review story，并按适用性覆盖 default、disabled、danger、long text、keyboard 与 narrow 状态。
- Storybook 与应用导入同一 `global.css`，共享同一 Tooltip provider，不维护展示主题副本。
- 只测试 PartSignal 新增的 token contract、variant 与组合行为，不重复验证 Base UI/shadcn 内部实现细节。
- 交互组件至少验证关键 keyboard、focus 与 ARIA 行为。

## Constraints

- Design System 不得导入 domain、route、API 或业务状态。
- 不创建万能 variant、万能 Form、万能 DataTable、业务 Action Registry 或未来组件脚手架。
- 只添加当前代码、Storybook 或测试真实消费的依赖；不升级现有 Foundation 依赖，除非出现已验证兼容阻塞。
- V1 只作行为参考；不得复制 Ant Design theme、旧 CSS、V1 组件实现或配色值。
- 不修改 `frontend/`、`backend/`、`contracts/`、Makefile、CI 或部署文件。

## Out of Scope

- App Shell、Sidebar、Breadcrumb、route metadata。
- Table Kit、RowActions、FilterBar。
- Workspace、Form、Editor Kit。
- Products 或其他业务页面、auth UI、业务 Playwright E2E。
- status registry、PageHeader、EmptyState、ErrorState、Table、Workspace。
- Docker、Compose、nginx、部署和下一 Task。

## Acceptance Criteria

- [x] `global.css` 是 token 值的唯一权威文件；Tailwind 和 shadcn 变量仅引用这些语义值。
- [x] 所列 token 均可通过 CSS Variables 与 Tailwind utilities 消费，且源码和 story 中没有 V1 theme 或散落业务颜色。
- [x] 11 个 primitives 存在且 API 保持最小；IconButton 复用 Button，不形成第二套按钮实现。
- [x] Base UI 触发器使用 `render`，Select 使用 `items`，Menu/Select items 位于 Group 中，Dialog/Sheet 均有可访问 Title。
- [x] 应用与 Storybook 共享同一 token 文件及 Tooltip provider 语义。
- [x] 每个 primitive 有可 review story；窄屏状态不会产生非预期横向溢出，overlay 在窄屏仍可操作。
- [x] 针对性测试覆盖 token contract、PartSignal 新 variant 和关键 keyboard/focus/ARIA 组合行为。
- [x] 所有 Required Validation 成功；Visual QA 使用指定 session 完成并关闭。
- [x] 最终 diff 不包含明确 Out of Scope 内容，且不包含未被实际消费的直接依赖。
