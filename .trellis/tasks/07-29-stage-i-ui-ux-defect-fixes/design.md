# 技术设计：阶段 I UI/UX 五项缺陷修复

## 设计边界

本任务保持前端现有 React、React Router、Ant Design、`workspace.css` 和测试架构。所有修复落在现有页面或样式所有者中，不增加公共 API、组件抽象、依赖、视觉 Token 或数据状态。

## 根因与最小修复

### DEF-UI-01：打印摘要固定三列压缩日期内容

- 根因：`frontend/src/features/geo-observations/GeoInsightsPage.tsx:611` 对打印摘要 `Descriptions` 固定使用 `column={3}`。在 390px 视口中，第一列还要容纳“时间范围”标签，日期内容只剩约 28px，因而逐字符折行。
- 修复：使用 Ant Design `Descriptions` 已有响应式 `column` 配置，窄屏一列、中等宽度两列、桌面三列。数据、顺序和打印媒体样式不变。
- 不采用：局部强制 `white-space: nowrap`，因为它会把长日期推出卡片；也不手写新的摘要 Grid。

### DEF-UI-02：固定列选中背景仍含透明通道

- 根因：`frontend/src/styles/workspace.css:915-921` 使用半透明的 `--ps-action-primary-soft` 与表面色做 `color-mix()`。由于输入色本身带 alpha，计算结果仍为半透明；固定列作为 sticky 覆盖层时会透出被滚动到其下方的 API 地址等文字。
- 修复：继续使用现有 `--ps-action-primary` 与 `--ps-bg-surface`，以低比例不透明主色混合出等价的悬停/选中淡色，并让普通单元格与 `.ant-table-cell-fix-end` 共享相同的完全不透明结果。
- 不采用：增加遮罩、提高 z-index、隐藏底层文字或取消固定列，这些方案只掩盖根因并破坏表格可用性。

### DEF-UI-03：API Key 内容默认不换行

- 根因：`frontend/src/features/configuration/AIChannelDetailPage.tsx:389` 在固定标签宽度的单列 `Descriptions` 中使用默认不换行的 Ant `Space`，状态文字和链接总宽度超过 320px 详情内容区；`frontend/src/styles/workspace.css:960` 又正确禁止详情区横向溢出，因此链接右侧被裁切。
- 修复：启用 Ant `Space` 原生 `wrap`，在空间不足时让“重新配置”整体换到下一行，不改变标签、入口或容器宽度。
- 不采用：缩小字体、压缩触控目标或允许详情区横向滚动。

### DEF-UI-04：站内确认后又触发浏览器离开保护

- 根因：`frontend/src/features/configuration/PlatformPromptsPage.tsx:170-197` 同时维护刷新/关页用的 `beforeunload` 和站内链接用的自定义确认。自定义确认通过 `window.location.assign()` 硬跳转，而 dirty 状态尚未卸载，因此同一个操作再次进入 `beforeunload`。
- 修复：仅对同源站内链接使用 React Router `useNavigate()` 完成确认后的 SPA 跳转，并在跳转前清除本地编辑态。外站跳转、刷新和关页继续由现有 `beforeunload` 提供一次原生保护。
- 不采用：删除 `beforeunload`、加入延时、全局跳过标志或第二套 blocker 状态。

### DEF-UI-05：特殊路由未参与当前页头标题计算

- 根因：`frontend/src/app/AppLayout.tsx:92-126` 把“平台类型”追加到全局搜索数据，但当前页头 `selected/currentSection` 只从侧栏叶子计算；该路由没有侧栏叶子，因而回退到 `/` 的“工作台”。
- 修复：在现有 `currentSection` 计算中为 `/configuration/platform-types` 提供精确页面标题。侧栏菜单、搜索入口和权限保持不变。
- 不采用：为了一个隐藏配置子页新增侧栏项或重构整套导航模型。

## 数据流与合同

- GEO 查询参数和 `GeoInsights` 响应不变。
- AI 渠道、Header、模型、权限、表格字段、URL 查询参数和 API 调用不变。
- Prompt dirty 状态仍由名称/正文与基线的差异唯一计算；保存、revision 冲突和刷新/关闭保护不变。
- 平台类型路由与接口不变。
- 不修改 OpenAPI、数据库文档或生成类型。

## 测试设计

- `frontend/src/app/AppLayout.test.tsx`：直接进入 `/configuration/platform-types`，断言页头强上下文为“配置中心”，末级为“平台类型”。
- `frontend/src/features/configuration/ConfigurationPages.test.tsx`：扩展 Prompt 站内链接回归，确认放弃后路由切换且卸载后的 `beforeunload` 不再阻止。
- `frontend/tests/e2e/dashboard-geo-convergence.spec.ts`：在 `390×844` 量测打印摘要日期内容，断言保持正常横向可读并位于卡片内。
- `frontend/tests/e2e/ai-channel-management.spec.ts`：在 `320×800` 断言固定操作列背景完全不透明，并量测“重新配置”边界不超出详情容器。
- `frontend/tests/e2e/editor-workspace-convergence.spec.ts`：在 `1440×900` 产生 Prompt 脏草稿，确认一次后完成站内导航，并断言未出现原生浏览器对话框。
- Playwright CLI 复测 DEF-UI-01 至 DEF-UI-05 的原始 URL/视口，保存修复后截图并检查 `console`、`requests`。

## 兼容性、回滚与风险

- 使用的响应式 `Descriptions`、`Space wrap`、React Router `navigate` 和 CSS `color-mix()` 均已由当前依赖/代码使用，不增加兼容面。
- 回滚按五个独立小改动进行；任何一项失败可只撤销对应 JSX/CSS/标题分支和测试。
- 主要剩余风险是本地 E2E 数据与报告中的线上记录不同，但布局根因与数据值无关；CLI 会使用长日期、长 API 地址和已配置 Key 状态复核真实边界。
- 已有脏文件存在并行任务修改风险。实施时每次编辑前重读目标片段，最终通过 `git diff` 只核对本任务新增差异，不回退现有内容。
