# 前端视觉系统重校准实施计划

> 本计划只在用户批准最终规划摘要、执行 `task.py start` 后实施。实施过程按批次暂停并由主 Agent 提交视觉结果，未经人工批准不得更新基线或推广到下一批。

## 1. 实施前基线

- [x] 确认主工作目录位于 `main`，记录并排除既有 `.playwright-cli/console-2026-07-23T23-17-17-038Z.log`。
- [x] 完整读取 `prd.md`、`design.md`、本计划、`research/prototype-analysis.md` 和三个前端规范。
- [x] 运行 ThemeProvider、AppLayout、共享组件、四个锚点页面的目标单测和视觉契约测试。
- [ ] 使用本地真实 E2E 栈保存 Dashboard、用户、GEO 洞察和内容审核当前 1440×1000 浅色截图及计算样式，只作为 before 证据。
- [ ] 记录现有全路由壳层、浅/深主题、375/768/1024/1440px 和真实 200% 结果；既有失败必须与本任务改动区分。

## 2. 批次 A：共享视觉基础

### 2.1 主题与 Token

- [x] 在 `frontend/src/app/theme.ts` 内校准浅色画布、表面、文字、边界、品牌蓝、状态、阴影和玻璃值。
- [x] 增加最小的 `actionPrimaryEnd`、`ambientBlue`、`ambientPurple`、`ambientPink` 语义角色及深色对应值。
- [x] 增加 6px 紧凑圆角，调整动效为 160/200/240ms；继续由同一 `visualConstants` 注入 Ant Design 与 `--ps-*`。
- [x] 保持 `createAntTheme` 的语义映射，不为渐变创建第二个 Ant Design 主题。
- [x] 更新 ThemeProvider/theme 目标测试，验证浅/深角色完整、主色对比、字体、圆角、阴影和动效。

### 2.2 应用壳层

- [x] 在 `AppLayout` 把桌面 Sider 收敛为 208px、折叠 72px；保持 64px Header 和 280px 移动 Drawer。
- [x] 在 `global.css` 统一 20/16/12px 内容边距、16px 页面间距和 24px 页面标题。
- [x] 在 `.app-shell` 使用新增环境光语义变量形成统一低饱和 radial gradients，使 `.app-content` 透明消费同一画布。
- [x] 保持导航、权限、搜索、路由预取、折叠、移动 Drawer、主题、账号和 pathname 焦点行为不变。
- [x] 更新 AppLayout 单测与跨路由计算样式断言。

### 2.3 共享组件与基础组件样式

- [x] 给 `MetricTile` 增加可选 `icon`，迁移 Dashboard、内容任务和 GEO 已有重复图标包装；不计算趋势或业务值。
- [x] 为用户和平台真实指标选择现有 Ant 图标，保持指标数量和服务端值不变。
- [x] 统一 PageHeader、MetricTile、TableRegion、StatusTag、Ant Card、Table、Input、Select 和 Button 的字体、间距、圆角、边界和阴影。
- [x] 仅在共享 `.ant-btn-primary` 允许语义蓝紫渐变；更新 `check-theme-colors.mjs` 精确 allowlist 及正反 fixture。
- [x] 删除被共享 MetricTile 取代的页面图标包装和重复 CSS，不创建新卡片或页面工厂。

### 2.4 批次 A 验证

```bash
cd frontend
npm exec -- vitest run \
  src/app/ThemeProvider.test.tsx \
  src/app/AppLayout.test.tsx \
  src/features/dashboard/DashboardPage.test.tsx \
  src/features/users/UserManagementPage.test.tsx \
  src/features/content-tasks/ContentTasksPage.test.tsx \
  src/features/geo-observations/GeoObservationsPage.test.tsx
npm run test:visual-contract
npm run typecheck
```

## 3. 批次 B：四个批准锚点

### 3.1 Dashboard

- [x] 对照 `13-dashboard.png` 调整真实 KPI、运营状态、待办、近期动态和快捷入口的密度、卡片层级与两栏比例。
- [x] 不新增原型中的示例指标或业务操作。

### 3.2 用户管理

- [x] 对照 `01-users.png` 调整五个真实指标、筛选表格、分页和桌面辅助区；标准详情/辅助区按 340px。
- [x] 保持 URL 筛选、权限、批量操作、确认和服务端集合口径。

### 3.3 GEO 洞察

- [x] 对照 `08-geo-insights.png` 调整筛选、趋势卡、平台对比、漏斗、排行、矩阵和建议的密度与图例。
- [x] 保持单一服务端洞察读模型、真实时间范围、统计公式、数据不足和打印行为。

### 3.4 内容审核

- [x] 对照 `12-content-review.png` 调整队列、Markdown 正文、质量审核区和决策操作的三栏比例、表面与阅读密度。
- [x] 保持不可变版本、服务端状态、审核意见、修订号、附件和 available actions。

### 3.5 锚点审批门

- [x] 使用 Playwright CLI 生成四页 1440×1000 浅色截图和壳层/字号/表格行/工作区比例计算样式。
- [x] 主 Agent 向用户展示四个结果并记录反馈。
- [x] 用户明确批准后，把四张实施截图放入 `assets/approved/`，并在 `assets/approved/manifest.md` 记录页面、对应原型、截图 SHA-256、视口、主题、批准者、北京时间和批准原话或反馈结论。
- [x] 未获用户明确批准时只迭代批次 A/B，不更新快照基线、不进入其余九页。

### 3.6 批次 B 验证

```bash
cd frontend
npm exec -- vitest run \
  src/features/dashboard/DashboardPage.test.tsx \
  src/features/users/UserManagementPage.test.tsx \
  src/features/geo-observations/GeoInsightsPage.test.tsx \
  src/features/content-editor/ContentEditorPage.test.tsx
deploy/scripts/e2e-local.sh \
  tests/e2e/cross-page-visual-convergence.spec.ts \
  tests/e2e/dashboard-geo-convergence.spec.ts \
  tests/e2e/editor-workspace-convergence.spec.ts
```

## 4. 批次 C：九个页面局部收敛

- [x] `02-audit-log.png`：审计组合筛选、表格和安全详情。
- [x] `03-publication-accounts.png`：真实发布账号指标、列表和说明区。
- [x] `04-prompt-management.png`：平台列表、Markdown、输出预览和安全边界。
- [x] `05-platform-rules.png`：平台、版本、规则详情和版本信息。
- [x] `06-platforms.png`：平台指标、列表和详情。
- [x] `07-geo-observations.png`：真实指标、双层筛选、记录表和详情。
- [x] `09-publications.png`：真实发布流程、列表、Drawer 和异常摘要。
- [x] `10-ai-channels.png`：状态 rail、渠道集合和详情工作区。
- [x] `11-content-tasks.png`：任务指标、筛选、表格和真实工作流。
- [x] 每页只调整局部 Grid/Flex、密度和表面；共享值必须返回批次 A 的权威位置修改。
- [x] 使用对应原型确认页面家族关系，不复制原型字段、数据或操作。

### 批次 C 验证

```bash
cd frontend
npm exec -- vitest run \
  src/features/configuration/ConfigurationPages.test.tsx \
  src/features/configuration/AuditLogPage.test.tsx \
  src/features/publications/PublicationsPage.test.tsx
deploy/scripts/e2e-local.sh \
  tests/e2e/list-workbench-convergence.spec.ts \
  tests/e2e/editor-workspace-convergence.spec.ts \
  tests/e2e/ai-channel-management.spec.ts \
  tests/e2e/dashboard-geo-convergence.spec.ts
```

## 5. 批次 D：跨主题、响应式与可访问性

- [x] 检查浅色、深色和跟随系统；深色不复制浅色原型，但必须保持同一语义层级。
- [x] 检查 375/768/1024/1440px，表格横向滚动只能发生在 TableRegion。
- [x] 使用现有持久 Chromium 扩展执行真实 200% tab zoom。
- [x] 完成键盘链、全局搜索焦点、pathname 焦点、Dropdown/Drawer 焦点恢复和 reduced-motion。
- [x] 检查 GEO 打印、内容阅读和复杂表单不被透明度或环境光降低对比。
- [x] 普通文字 ≥ 4.5:1，大字和非文字元素 ≥ 3:1。

## 6. 批次 E：人工批准、基线与文档

- [x] 生成四锚点和九个局部页的最终 1440×1000 浅色截图；对动态数据使用精确遮罩。
- [x] 主 Agent 提交最终视觉结果，取得用户明确批准。
- [x] 更新 `assets/approved/manifest.md` 中的最终截图文件名、SHA-256、视口、主题、批准者、北京时间和最终批准原话或反馈结论。
- [x] 只有在批准后，更新用户、Prompt、GEO 洞察既有九张自动基线，并增加 Dashboard 与内容审核 1440×1000 浅色稳定基线。
- [x] 更新 `visual-system.md`：批准参考从属关系、精确几何、颜色角色、共享主按钮渐变例外和人工基线更新规则。
- [x] 不修改 API、数据库、部署或业务方案文档；若最终 diff 只改变视觉行为，在收尾中明确无需更新业务文档。

## 7. 最终质量门禁

```bash
npm --prefix frontend run test
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
deploy/scripts/e2e-local.sh \
  tests/e2e/theme.spec.ts \
  tests/e2e/cross-page-visual-convergence.spec.ts \
  tests/e2e/list-workbench-convergence.spec.ts \
  tests/e2e/editor-workspace-convergence.spec.ts \
  tests/e2e/dashboard-geo-convergence.spec.ts \
  tests/e2e/ai-channel-management.spec.ts
git diff --check
```

- [x] 检查失败不得通过扩大截图阈值、整块遮罩、skip、固定成功数据或兼容 fallback 掩盖。
- [x] 检查 diff：无第二套 Token、页面级主题、重复指标包装、无关重构、业务行为变化或未说明的快照更新。
- [x] 完整 Vitest、类型检查、Lint、构建与 E2E 均通过，不存在需要记录的既有环境失败。

## 8. 回滚点

- 批次 A：主题、壳层和共享组件可独立反向修改。
- 批次 B：四个锚点局部调整与共享基础分开，未批准时不推广。
- 批次 C：按页面局部规则逐项反向修改，不影响已批准锚点。
- 批次 D/E：快照、规范和批准资产最后更新，可在不回滚产品视觉代码的情况下重新生成。
- 禁止使用 `git reset --hard`、`git checkout -- <file>` 或覆盖用户未提交文件。
