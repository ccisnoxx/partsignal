# Research: AI 渠道表格“测试状态”与固定“操作”列重叠

- Query: 定位 AI 渠道与模型页面在 1440×1000、右侧详情打开时，“测试状态”与固定“操作”列重叠的精确根因，并给出最小修复边界与可执行回归检查。
- Scope: internal / external / mixed
- Date: 2026-07-25

## Findings

### 1. 已确认现象与责任边界

- 父任务线上验收已在真实预发布页面 `/configuration/ai/channels/:channelId`、1440×1000 浅色、详情面板打开时复现：两个单元格均从 `x=979` 开始，控件相交约 `48.3×27px`（`.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md:67-73`）。
- 线上同一轮检查确认文档宽度仍为 `1440/1440`，所以这不是页面级横向溢出或部署资源失败，而是表格内部列几何问题（`.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md:34-49`）。
- 修复范围应只落在前端 AI 渠道主列表的列宽/局部固定列样式及对应 E2E；不需要修改后端、OpenAPI、数据库、权限、查询或详情业务逻辑。

### 2. 调用链与组件所有权

调用链如下：

1. `AppLayout` 提供 208px 桌面侧栏和带 20px 内边距的内容区（`frontend/src/app/AppLayout.tsx:155-162`、`frontend/src/app/AppLayout.tsx:212-216`；`frontend/src/styles/global.css:53`）。
2. `App` 把 `/configuration/ai` 路由交给 `AIChannelsPage`，把 `channels/:channelId` 子路由交给 `AIChannelDetailPage`（`frontend/src/app/App.tsx:61-65`）。
3. `ConfigurationLayout` 只承担管理员权限边界，不参与尺寸计算（`frontend/src/features/configuration/ConfigurationLayout.tsx:1-7`）。
4. `AIChannelsPage` 在列表有数据且 URL 未指定渠道时自动导航到首条渠道详情，因此正常有数据时右侧详情会自动打开（`frontend/src/features/configuration/AIChannelsPage.tsx:152-163`）。
5. `AIChannelsPage` 渲染状态 rail、渠道列表和 340px 详情栏；详情栏通过 `Outlet` 渲染 `AIChannelDetailPage`（`frontend/src/features/configuration/AIChannelsPage.tsx:342-440`）。
6. `AIChannelDetailPage` 只填充右侧既定容器，根节点是 `.ai-detail-panel`，没有反向修改主表列宽或滚动（`frontend/src/features/configuration/AIChannelDetailPage.tsx:484-510`）。

因此，精确责任组件是 `AIChannelsPage` 的 `columns` 与主表 `scroll.x`，精确布局所有者是 `global.css` 的 `.ai-workspace`、`.ai-list-table-wrap` 和 AI 表格局部样式；`AIChannelDetailPage` 只是让预留的 340px 详情栏出现真实内容。

### 3. 1440px 下可复算的重叠等式

桌面三栏 CSS 固定为：

```css
.ai-workspace {
  grid-template-columns: 188px minmax(0, 1fr) 340px;
}

.ai-list-table-wrap {
  padding: 0 14px;
}
```

对应代码位于 `frontend/src/styles/global.css:955`、`frontend/src/styles/global.css:972-973`。在 1440px 视口下：

| 项目 | 计算 | 宽度 |
| --- | ---: | ---: |
| 视口 |  | 1440 |
| 桌面侧栏 | `AppLayout` | -208 |
| `.app-content` 左右内边距 | `20 × 2` | -40 |
| `.ai-config-page` 左右边框 | `1 × 2` | -2 |
| 状态 rail |  | -188 |
| 详情面板 |  | -340 |
| 渠道列表 pane 分配宽度 | `1440-208-40-2-188-340` | 662 |
| 列表 pane 右边框 |  | -1 |
| 表格包裹左右内边距 | `14 × 2` | -28 |
| `TableRegion` 左右边框 | `1 × 2` | -2 |
| Ant Table 实际可见区 | `662-1-28-2` | **631** |

主表当前八列全部设置了固定宽度（`frontend/src/features/configuration/AIChannelsPage.tsx:268-322`）：

```text
124 + 50 + 167 + 72 + 66 + 68 + 82 + 84 = 713
```

其中“测试状态”之前六列的宽度总和为：

```text
124 + 50 + 167 + 72 + 66 + 68 = 547
```

固定“操作”列宽 84px，在 631px 可见区内被 sticky 到：

```text
631 - 84 = 547
```

所以正常流中的“测试状态”列与固定“操作”列都从表格内部 `x=547` 开始；换算到页面坐标后正好对应线上量测的 `x=979`。这不是随机像素误差，而是当前列宽、三栏布局和固定列宽形成的确定等式。

此外，`Table.scroll.x` 配置为 710，但列声明总宽为 713（`frontend/src/features/configuration/AIChannelsPage.tsx:416`）。真正导致 1440px 首屏重叠的是 713px 表格最小内容宽度大于 631px 可见区；`scroll.x` 与列宽总和相差 3px 是同一列宽契约失配的附加信号，不是单独把 710 改为 713 就能修复的问题。

### 4. 违反了现有弹性列约定

- “API 根地址”是可截断的长文本列，已经使用 `ellipsis`，却仍固定为 167px（`frontend/src/features/configuration/AIChannelsPage.tsx:277-280`）。
- 同一张表的名称、URL、状态、数量、测试状态、操作八列全部设置 `width`，没有任何一列吸收剩余空间。
- 项目组件规范明确要求状态、数量、操作使用紧凑固定宽度，名称/标题/长文本至少保留一列不设置 `width`；只有列的最小可用宽度超过容器时才设置 `scroll.x`（`.trellis/spec/frontend/component-guidelines.md:37-54`）。
- 视觉规范同样要求长文本至少一列弹性、关键宽表固定操作列，并由 `TableRegion` + `Table.scroll.x` 持有局部滚动（`.trellis/spec/frontend/visual-system.md:177-185`）。

因此根因不是 `TableRegion` 缺少新能力，而是 AI 渠道表格没有遵守已经存在的列宽分工。

### 5. `TableRegion`、scroll、fixed/sticky 与 CSS 的关系

- `TableRegion` 只是带 `role="region"`、`aria-label` 和 `tabIndex={0}` 的六行语义包装，不计算列宽、不设置 sticky，也不承载 Ant Table 的实际横向滚动（`frontend/src/shared/components/TableRegion.tsx:1-6`）。
- 共享 CSS 明确规定横向滚动由 Ant Table 的 `scroll.x` 持有，`.table-region` 只限制 `max-width: 100%`（`frontend/src/styles/global.css:669-671`）。
- AI 页面额外把 `.ai-list-table-wrap` 设为 `overflow-x: hidden`，并把直属 `.table-region` 设为 `overflow: hidden`（`frontend/src/styles/global.css:972-973`）。它们会裁切边缘和避免页面级溢出，但不会改变 Ant 内部 sticky 列的起点；不应通过修改共享 `TableRegion` 或给外层增加第二个滚动容器来修复。
- `fixed: 'right'` 由当前 `@rc-component/table` 转为逻辑方向 `end`，实际 DOM 类是 `.ant-table-cell-fix-end`，并通过 `inset-inline-end` 实现 sticky（`frontend/node_modules/@rc-component/table/es/hooks/useColumns/index.js:38-50`、`frontend/node_modules/@rc-component/table/es/Cell/index.js:96-105`、`frontend/node_modules/@rc-component/table/es/Cell/index.js:138-151`）。
- AI 页面局部 CSS 仍只匹配旧类 `.ant-table-cell-fix-right` / `.ant-table-cell-fix-right-first`（`frontend/src/styles/global.css:982-989`），所以这些固定列专用背景、间距、阴影和按钮规则在 Ant Design 6 的逻辑类名下不会命中。代码库的内容任务表已经用 `:is(.ant-table-cell-fix-end, .ant-table-cell-fix-right)` 兼容当前类名（`frontend/src/styles/global.css:641-648`）。
- 选中/悬停行背景使用含透明 `actionPrimarySoft` 的 `color-mix`（`frontend/src/styles/global.css:979-985`；浅色 token 为 `rgba(49,92,245,.11)`，见 `frontend/src/app/theme.ts:129`）。这会让被 sticky 操作单元格压在下面的测试状态控件更容易透出。更新逻辑类名或改不透明背景可以消除“透字”，但如果仍保留 713px 内容宽与 631px 可见区，只是把“测试状态”遮住，不能算根因修复。

### 6. 最小根因修复建议

首选在 `frontend/src/features/configuration/AIChannelsPage.tsx` 内完成，不改共享组件、不加断点：

1. 去掉“API 根地址”列的固定 `width: 167`，保留 `ellipsis`，让它成为表格唯一弹性长文本列。
2. 把主表 `scroll.x` 从 710 收紧到约 630。其余固定列合计 546px，弹性 URL 列在 1440px 下可获得约 84px，八列总宽不超过 631px 可见区；“测试状态”和“操作”恢复相邻而非叠放。
3. 保留“操作”列 `fixed: 'right'` 和 84px 宽度；当真实窄屏使 630px 最小表宽超过容器时，仍由 Ant Table 在 `TableRegion` 内滚动并固定操作入口。

这是一处列定义和一处 `scroll.x` 的最小结构性修复。不要采用以下替代方案：

- 不要删除“测试状态”：它是 `AIChannelSummary` 的必需字段，契约还提供 `LAST_TESTED_DESC` 排序（`contracts/openapi.yaml:2930-2946`、`frontend/src/shared/api/schema.d.ts:2269-2285`）。
- 不要移除固定操作列：违反关键宽表保持操作入口的既有规范。
- 不要缩窄 340px 详情面板、改变 188px 状态 rail 或新增 1440px 附近断点：会扩大为页面构图变更，且视觉规范把标准详情面板定为 340px（`.trellis/spec/frontend/visual-system.md:85-104`）。
- 不要只提高 `z-index`、隐藏测试状态、加 `overflow: hidden` 或把固定列背景涂实：这些只遮蔽症状。
- 不要修改 `TableRegion`：共享语义包装与滚动所有权没有故障。

受影响局部 CSS 若在回归中仍出现窄屏固定列透字，可在同一作用域把 `.ant-table-cell-fix-right` 选择器改为同时覆盖 `.ant-table-cell-fix-end`，并保证固定操作单元格的普通/悬停/选中背景为不透明语义表面；这属于当前 Ant Design 6 类名对齐，但不能替代上述宽度修复。

### 7. 必须保持的行为

- 保留现有八类信息：渠道名称/描述、启用状态、API 根地址、API Key 配置状态、Header 数量、已启用模型数、最新测试状态/时间和操作。
- 保留 188px 状态 rail、340px 详情面板、自动选择首条渠道和 URL 驱动详情/Tabs（`frontend/src/features/configuration/AIChannelsPage.tsx:157-176`、`frontend/src/features/configuration/AIChannelsPage.tsx:438-440`）。
- 保留操作列两个直接图标入口及 `Dropdown` 内的测试、启停、删除流程，包括 `stopPropagation`、确认、权限和 API 载荷（`frontend/src/features/configuration/AIChannelsPage.tsx:294-321`）。
- 保留 `TableRegion` 的可聚焦语义，窄屏横向滚动只能发生在 Ant Table 内，不得产生文档级横向滚动。
- 保留浅色、深色、跟随系统、选中、悬停、键盘焦点和 200% 缩放下的可读性。
- 不修改契约、查询参数、query key、分页、筛选、排序、详情 API 或任何服务端状态转换。

### 8. 现有测试覆盖与缺口

1. `ConfigurationPages.test.tsx`
   - 已覆盖 URL 恢复、筛选参数、`TableRegion`、状态标签与操作按钮存在性（`frontend/src/features/configuration/ConfigurationPages.test.tsx:677-695`）。
   - jsdom 不适合断言 sticky 坐标，项目质量规范也明确把具体 sticky 几何留给真实浏览器（`.trellis/spec/frontend/quality-guidelines.md:41-47`）。

2. `ai-channel-management.spec.ts`
   - 已构造真实测试状态数据、详情路由和多行渠道，并量测 rail、详情、表头与行高（`frontend/tests/e2e/ai-channel-management.spec.ts:65-128`、`frontend/tests/e2e/ai-channel-management.spec.ts:346-406`）。
   - 其桌面视口固定为 **1570×1001**（`frontend/tests/e2e/ai-channel-management.spec.ts:160`），此时渠道列表比 1440px 场景宽约 130px，713px 表格可以完整展开，所以没有复现缺陷。
   - 测试没有量测“测试状态”与固定“操作”列的矩形是否相交。

3. `list-workbench-convergence.spec.ts`
   - 1440px 会访问 AI 渠道页面并保存普通测试产物截图，但只断言页面无文档级溢出、`TableRegion` 可聚焦和状态有文本（`frontend/tests/e2e/list-workbench-convergence.spec.ts:51-89`）。
   - 截图不是 `toHaveScreenshot` 基线，也没有列间不相交断言，因此缺陷不会使测试失败。

4. `cross-page-visual-convergence.spec.ts`
   - 1440px 明暗主题会打开 AI 页面，但只比较共享壳层签名和文档宽度（`frontend/tests/e2e/cross-page-visual-convergence.spec.ts:257-288`）。
   - 自动视觉基线只保护用户、Prompt、GEO 洞察、Dashboard 和内容审核，不包含 AI 渠道页（`frontend/tests/e2e/cross-page-visual-convergence.spec.ts:318-369`；`.trellis/spec/frontend/visual-system.md:306-313`）。

### 9. 可执行回归检查

优先扩展现有 `frontend/tests/e2e/ai-channel-management.spec.ts`，复用它已经创建的 PASSED/UNTESTED 渠道数据，不新增测试框架或新 fixture：

1. 将桌面几何检查切到或补充 **1440×1000**，保持右侧 `AIChannelDetailPage` 已打开。
2. 在同一可见行中量测：
   - `.ai-test-status`（或其 `.status-tag`）；
   - 固定操作单元格 `.ant-table-cell-fix-end` 内的操作区域。
3. 断言测试状态控件右边界不大于操作区域左边界；不要只断言背景色或 `z-index`。
4. 同时断言 1440px 下 `.ant-table-content.scrollWidth <= clientWidth`，证明状态不是被不透明固定列“藏起来”。
5. 保留 390/375px 检查：文档无横向溢出，Ant Table 内部可以横向滚动，固定操作按钮仍可见、可聚焦并能打开 Dropdown。
6. 补查浅色与深色下选中行、悬停行，避免半透明固定单元格再次透出下层内容。

建议命令：

```bash
npm --prefix frontend exec -- vitest run src/features/configuration/ConfigurationPages.test.tsx
deploy/scripts/e2e-local.sh tests/e2e/ai-channel-management.spec.ts
npm --prefix frontend run typecheck
npm --prefix frontend run lint
```

`deploy/scripts/e2e-local.sh` 需要已配置本地/CI 的 `DATABASE_URL` 与 `REDIS_URL`，只应在本地 E2E 数据栈运行，不应指向预发布。无需创建或更新 AI 页面截图基线；当前规范要求截图基线更新必须另获用户批准。

### 10. External references / versions

- `frontend/package-lock.json` 锁定 Ant Design `6.5.0` 与 `@rc-component/table 1.10.4`（`frontend/package-lock.json:1928-1946`、`frontend/package-lock.json:3313-3354`）。
- Ant Design 官方 Table 文档：<https://ant.design/components/table/>。固定列章节要求配合 `scroll.x`，建议至少保留一列不设宽度以适配流式布局，并约束非固定列宽度总和与 `scroll.x` 的关系。该建议与项目自身 `component-guidelines.md` 一致。
- 本机 `node_modules` 当前解析到 Ant Design `6.5.1`、`@rc-component/table 1.10.4`；锁文件与本机安装的 Ant Design patch 版本存在 6.5.0/6.5.1 差异。上述 `fixed: 'right'` → `end` 逻辑已直接在本机 1.10.4 源码确认，回归应使用项目标准依赖安装流程。

## Files found

- `.trellis/tasks/07-25-staging-visual-defect-fixes/task.json`：子任务元数据，父任务为线上视觉验收。
- `.trellis/tasks/07-25-staging-visual-defect-fixes/prd.md`：当前目标已记录，但 Requirements/Acceptance Criteria 仍为 TBD。
- `.trellis/tasks/07-25-post-deployment-visual-acceptance/prd.md`：1440×1000、表格和视觉验收边界。
- `.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md`：线上重叠的权威复现坐标与条件。
- `.trellis/spec/frontend/visual-system.md`：三栏几何、340px 详情栏、表格、响应式和视觉回归规则。
- `.trellis/spec/frontend/component-guidelines.md`：弹性长文本列、紧凑固定字段、`TableRegion` 与 `scroll.x` 约定。
- `.trellis/spec/frontend/quality-guidelines.md`：真实浏览器响应式与 sticky 几何测试边界。
- `frontend/src/app/App.tsx`：AI 渠道主/详情嵌套路由。
- `frontend/src/app/AppLayout.tsx`：208px 侧栏和内容区所有者。
- `frontend/src/features/configuration/ConfigurationLayout.tsx`：管理员配置权限边界。
- `frontend/src/features/configuration/AIChannelsPage.tsx`：缺陷所在列定义、表格 `scroll.x`、自动选择和详情 Outlet。
- `frontend/src/features/configuration/AIChannelDetailPage.tsx`：340px 右侧详情内容，不参与主表列定位。
- `frontend/src/shared/components/TableRegion.tsx`：可聚焦表格区域语义包装。
- `frontend/src/styles/global.css`：AI 三栏尺寸、表格包裹、固定列与断点样式。
- `frontend/src/app/theme.ts`：表格表面与半透明选中 token 的唯一值来源。
- `contracts/openapi.yaml` / `frontend/src/shared/api/schema.d.ts`：`latest_test_status`、`last_tested_at` 是渠道摘要必需字段。
- `frontend/src/features/configuration/ConfigurationPages.test.tsx`：AI 页面 jsdom 行为测试。
- `frontend/tests/e2e/ai-channel-management.spec.ts`：最适合补充 1440px 不相交断言的真实 E2E。
- `frontend/tests/e2e/list-workbench-convergence.spec.ts`：已有 1440px/窄屏工作台检查，但不校验列交叠。
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`：共享壳层与有限自动视觉基线，AI 页不在基线清单。

## Related specs

- `.trellis/spec/frontend/visual-system.md:85-104`：208px 侧栏、20px 内容边距、340px 详情面板与无页面级横向滚动。
- `.trellis/spec/frontend/visual-system.md:177-185`：弹性长文本列、紧凑状态/数量/操作列、固定操作列。
- `.trellis/spec/frontend/visual-system.md:244-258`：`TableRegion` 内滚动、响应式、缩放、键盘与焦点。
- `.trellis/spec/frontend/component-guidelines.md:37-54`：表格列宽与 `scroll.x` 的项目级实现约定。
- `.trellis/spec/frontend/quality-guidelines.md:41-47`：真实浏览器覆盖 375/768/1024/1440、200% 缩放和键盘链。

## Caveats / Not Found

- 本次为研究子代理，只写入本文件；未修改产品代码、任务主文档、规范、测试或 Git 状态，也未运行会写测试产物/本地业务数据的 E2E。
- 子任务 `prd.md` 的 Requirements 与 Acceptance Criteria 仍为 TBD；上述“必须保持”和回归标准依据父任务权威复现、现有前端规范、当前契约和实际实现推导，主 Agent 仍需把批准范围写入任务规划产物。
- 未在公网重新登录或重复预发布量测；根因使用父任务已记录的真实坐标与当前源码进行确定性复算。
- 当前批准资产登记了 AI 渠道 1440×1000 浅色图，但 AI 页面不在自动 `toHaveScreenshot` 基线中；不要在本缺陷修复中擅自新增或更新批准基线。
