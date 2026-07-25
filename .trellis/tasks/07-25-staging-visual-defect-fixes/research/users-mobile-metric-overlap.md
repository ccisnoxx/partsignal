# Research: 用户管理移动端指标卡重叠

- Query: 定位 `/users` 在 375×812 下指标卡图标覆盖标题和数值的真实根因，确认响应式布局所有者、共享消费者、修复边界及最小回归检查。
- Scope: internal
- Date: 2026-07-25

## Findings

### 1. 已确认现象与任务边界

- 子任务当前只给出总体目标，`prd.md` 的 Requirements/Acceptance Criteria 仍为 TBD；已明确的范围是“用户管理 375px 指标卡重叠及对应视觉回归”：
  - `.trellis/tasks/07-25-staging-visual-defect-fixes/task.json:5`
  - `.trellis/tasks/07-25-staging-visual-defect-fixes/prd.md:5`
- 父任务在真实预发布 `375×812`、浅色主题下观察到：五张指标卡保持两列，但圆形图标与标题、数值占用同一区域：
  - `.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md:75`
  - `.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md:78`
  - `.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md:79`
- 仓库自动基线 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/users-light-375x900.png` 也直接显示相同现象：五张卡的图标、标题和被遮罩的动态数值从同一左上区域开始。该图是现有实现基线，不是“无缺陷”证据。

### 2. DOM 与数据所有者没有问题

- `/users` 的 `UserManagementPage` 在 `user-management-summary-grid` 中直接渲染五个共享 `MetricTile`，每个都传入 Ant Design 图标；数量和数值来自服务端 `summary`，没有页面自制指标卡：
  - `frontend/src/features/users/UserManagementPage.tsx:248` — `summary = users.data?.summary`
  - `frontend/src/features/users/UserManagementPage.tsx:298` — `section.user-management-summary-grid`
  - `frontend/src/features/users/UserManagementPage.tsx:299-303` — 五个带 `icon` 的 `MetricTile`
- `MetricTile` 的结构稳定且语义合理：`Card` 取得 `metric-with-icon`，图标、标签、数值和说明是同一 `ant-card-body` 下的兄弟节点：
  - `frontend/src/shared/components/MetricTile.tsx:6` — `MetricTile`
  - `frontend/src/shared/components/MetricTile.tsx:17` — 带图标时增加 `metric-with-icon`
  - `frontend/src/shared/components/MetricTile.tsx:18-22` — `metric-icon`、`metric-label`、`metric-value`、`metric-meta`
- 因此不需要改 `UserManagementPage.tsx` 的数据流或 `MetricTile.tsx` 的 DOM；根因完全在共享 CSS 的窄屏级联。

### 3. 根因是 419px 规则清除了共享图标槽

共享图标卡的基础约束是：

```css
/* frontend/src/styles/global.css:531-533 */
.metric-tile > .ant-card-body { min-height: 112px; padding: 16px; }
.metric-with-icon > .ant-card-body { position: relative; padding-left: 64px; }
.metric-icon { position: absolute; top: 16px; left: 14px; width: 38px; height: 38px; }
```

这套桌面/中等宽度布局通过 `padding-left: 64px` 为绝对定位图标预留水平空间。

窄屏级联随后发生两步：

1. `max-width: 767px` 只把共享图标移动并缩小为 `top: 12px; left: 12px; width/height: 34px`，但没有给所有 `metric-with-icon` 统一调整正文内边距：
   - `frontend/src/styles/global.css:1158` — 既有移动断点
   - `frontend/src/styles/global.css:1230` — 移动图标几何
2. `max-width: 419px` 中的通用规则把所有指标卡 body 改成 `padding: 12px`：
   - `frontend/src/styles/global.css:1443`
   - `frontend/src/styles/global.css:1448`

`.metric-with-icon > .ant-card-body` 与 `.metric-tile .ant-card-body` 的选择器优先级同为 `0-2-0`；后者位于文件更后面，所以 `padding: 12px` 覆盖了基础 `padding-left: 64px`。`position: relative` 仍保留，于是：

- 图标占据 body 内横向 `12px–46px`；
- 标签和数值也从 body 的 `12px` 左内边距开始；
- 图标纵向覆盖标签与紧随其后的数值，形成父任务报告中的重叠。

用户页 Grid 在桌面为五列，`<=899px` 和 `<=599px` 均明确改为两列，375px 下仍为两列是现有页面响应式意图：

- `frontend/src/styles/global.css:825` — 桌面五列
- `frontend/src/styles/global.css:884-885` — 899px 以下两列
- `frontend/src/styles/global.css:888-889` — 599px 以下仍为两列并缩小 gap

两列会缩小卡片，但不是直接根因：基础 `64px` 图标槽未被清除时，图标与正文在水平方向已分离。把用户页强制改为单列只能掩盖共享级联错误，并会无必要改变当前信息密度。

### 4. 真实所有者与其他消费者

视觉规范把 `MetricTile` 定义为服务端指标的唯一共享实现，业务页不得复制：

- `.trellis/spec/frontend/visual-system.md:172`
- `.trellis/spec/frontend/visual-system.md:274`
- `.trellis/spec/frontend/component-guidelines.md:19`
- 历史设计也明确 `MetricTile.icon` 负责“稳定图标槽、tone 和排版”：`.trellis/tasks/archive/2026-07/07-25-frontend-visual-system-recalibration/design.md:132-134`

当前 `MetricTile` 的全部消费者如下：

| 消费者 | 图标 | 移动端现状 |
| --- | --- | --- |
| Dashboard | 有，`frontend/src/features/dashboard/DashboardPage.tsx:67-71` | `global.css:1228-1229` 和 `1449-1450` 以更高优先级改为上方图标、下方正文；已有几何断言 |
| 内容任务 | 有，`frontend/src/features/content-tasks/ContentTasksPage.tsx:151-155` | `global.css:1243` 以更高优先级预留顶部空间 |
| GEO 观测 | 有，`frontend/src/features/geo-observations/GeoObservationsPage.tsx:297-302` | 与 Dashboard 共用 `global.css:1228-1230`、`1449-1450`，已有几何断言 |
| 用户管理 | 有，`frontend/src/features/users/UserManagementPage.tsx:298-303` | 没有图标卡 body 的页面级移动覆盖，命中缺陷 |
| 平台管理 | 有，`frontend/src/features/configuration/PlatformsPage.tsx:295-302,327-328` | 同样没有图标卡 body 的页面级移动覆盖；`global.css:1180` 在移动端也是两列，存在同源潜在缺陷 |
| AI 渠道使用统计 | 无，`frontend/src/features/configuration/AIChannelDetailPage.tsx:447-451` | 不产生 `metric-with-icon`，不受影响 |

结论：修复应归属 `frontend/src/styles/global.css` 的共享 `metric-with-icon` 移动布局，而不是 `/users` 页面局部 Grid 或 TSX。最小安全边界是在已有 `max-width: 419px` 断点内，让带图标卡在通用 `padding: 12px` 之后继续保留图标净空（例如复用已有 `54px 12px 12px` 的上方图标布局）；不需要新断点、新组件或新依赖。

这个边界还有三个好处：

- 同时消除平台统计卡的同源潜在问题；
- 只影响 `<=419px`，不会改变 1440px 桌面和父任务实测 CSS 视口为 `720×500` 的真实 200% 场景（`.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md:56`）；
- Dashboard、GEO 和内容任务现有更高优先级移动规则保持原状，无需为本缺陷清理或重构它们。

不建议：

- 把 `.user-management-summary-grid` 改为单列：未修复共享图标槽，并遗漏平台消费者；
- 在 `UserManagementPage.tsx` 增加包装节点或内联样式：会复制 `MetricTile` 的展示责任；
- 修改桌面基础 `padding-left: 64px`：会扩大到已批准的 1440px 用户锚点；
- 为 375px 新增相邻断点：规范要求复用现有断点（`.trellis/spec/frontend/visual-system.md:246-249`）。

### 5. 现有测试为什么没有发现

1. `frontend/src/features/users/UserManagementPage.test.tsx:36-64`
   - 验证服务端 summary、五张卡、标签和值；
   - jsdom 不提供可信布局几何，本就不适合捕获覆盖；质量规范也明确 jsdom 不断言具体布局坐标（`.trellis/spec/frontend/quality-guidelines.md:45`）。
2. `frontend/tests/e2e/list-workbench-convergence.spec.ts:51-65`
   - 桌面只检查用户/平台各有五张 `metric-tile`；
   - `frontend/tests/e2e/list-workbench-convergence.spec.ts:91-100` 虽遍历 `1024/768/375/320`，但只断言文档没有横向溢出，没有检查卡内矩形相交。
3. `frontend/tests/e2e/dashboard-geo-convergence.spec.ts:51-60`
   - 已有 `expectMetricIconClearance`，通过 `iconBottom <= labelTop` 检查图标净空；
   - `frontend/tests/e2e/dashboard-geo-convergence.spec.ts:101-115` 只调用于 Dashboard 和 GEO 观测，没有覆盖后来新增图标的用户/平台卡。
4. `frontend/tests/e2e/cross-page-visual-convergence.spec.ts:318-353`
   - 固定比较用户 375×900 基线；
   - 用户 mask 在 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts:192-197` 遮罩动态数值，而当前基线本身已经记录了错误的图标/标题位置，所以测试会稳定复现缺陷而不是报告缺陷。

### 6. 最小回归检查

建议把几何断言放进已覆盖用户和平台的 `list-workbench-convergence.spec.ts`，不新增测试文件或 fixture：

1. 在现有 `375/320px` 循环内，对用户和平台的每张 `.metric-tile` 读取 `.metric-icon`、`.metric-label`、`.metric-value` 的 `DOMRect`。
2. 断言图标矩形分别不与标签、数值矩形相交。使用“矩形不相交”比直接复制 `iconBottom <= labelTop` 更稳健，因为共享组件允许水平图标槽和上方图标槽两种合法排列。
3. 复跑现有 Dashboard/GEO 净空测试，确认共享规则没有破坏已通过消费者。

最小命令：

```bash
cd frontend
npm exec -- playwright test tests/e2e/list-workbench-convergence.spec.ts --grep "窄屏只允许"
npm exec -- playwright test tests/e2e/dashboard-geo-convergence.spec.ts --grep "1024 至 320px"
npm run typecheck
npm run lint
```

浏览器检查至少保留：

- `/users`：375×812（线上复现尺寸）、320×900、1440×1000；
- `/configuration/platforms`：375×900，用于确认同源消费者；
- `/users`：真实 200% tab zoom，确认 720px CSS 视口未回归；
- 浅色为主，深色快速复核即可，因为修复只改变几何、不改变语义色。

当前 `users-light-375x900.png` 是已知坏基线。修复后截图比较应因稳定构图变化而失败；必须先人工确认修复图，再按规范更新基线，不能扩大 `maxDiffPixelRatio`、增加整卡遮罩或自动接受：

- `.trellis/spec/frontend/visual-system.md:309-312`
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts:342-352`

## Files Found

- `.trellis/tasks/07-25-staging-visual-defect-fixes/task.json` — 子任务元数据与缺陷范围。
- `.trellis/tasks/07-25-staging-visual-defect-fixes/prd.md` — 当前子任务目标；详细需求和验收标准尚未填写。
- `.trellis/tasks/07-25-post-deployment-visual-acceptance/prd.md` — 父任务的 375px、200% 与只读验收边界。
- `.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md` — 375×812 真实预发布复现、严重度及 200% CSS 视口证据。
- `.trellis/spec/frontend/visual-system.md` — `MetricTile` 共享所有权、响应式、文字遮挡和视觉基线规则。
- `.trellis/spec/frontend/component-guidelines.md` — 共享展示组件边界。
- `.trellis/spec/frontend/quality-guidelines.md` — 真实浏览器响应式检查与 jsdom 边界。
- `frontend/src/features/users/UserManagementPage.tsx` — `/users` 五张服务端统计卡的真实调用点。
- `frontend/src/shared/components/MetricTile.tsx` — 图标、标题、数值和说明的共享 DOM 所有者。
- `frontend/src/styles/global.css` — 图标槽、用户/平台 Grid 及 419px 级联冲突的真实 CSS 所有者。
- `frontend/src/features/dashboard/DashboardPage.tsx` — 带图标 `MetricTile` 消费者。
- `frontend/src/features/content-tasks/ContentTasksPage.tsx` — 带图标 `MetricTile` 消费者。
- `frontend/src/features/geo-observations/GeoObservationsPage.tsx` — 带图标 `MetricTile` 消费者。
- `frontend/src/features/configuration/PlatformsPage.tsx` — 与用户页同样缺少移动图标净空覆盖的带图标消费者。
- `frontend/src/features/configuration/AIChannelDetailPage.tsx` — 无图标消费者，不受本缺陷影响。
- `frontend/src/features/users/UserManagementPage.test.tsx` — 仅覆盖用户统计数据与 DOM 数量。
- `frontend/tests/e2e/list-workbench-convergence.spec.ts` — 已覆盖用户/平台与 320–1024px，但缺少卡内重叠断言。
- `frontend/tests/e2e/dashboard-geo-convergence.spec.ts` — 已有可复用的图标净空几何测试模式。
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts` — 用户 375×900 自动截图基线及动态值 mask。
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/users-light-375x900.png` — 直接包含当前缺陷的已知坏基线。
- `frontend/package.json`、`frontend/playwright.config.ts` — Playwright 1.61.1、本地/CI 真实栈入口和验证命令。

## Related Specs

- `.trellis/spec/frontend/visual-system.md:172` — 服务端指标必须使用 `MetricTile`，不得复制实现。
- `.trellis/spec/frontend/visual-system.md:247-249` — 窄屏指标必须减列/堆叠，320px 与 200% 下不得文字遮挡。
- `.trellis/spec/frontend/visual-system.md:309-312` — 用户移动基线、人工批准、mask 与 2% 阈值规则。
- `.trellis/spec/frontend/component-guidelines.md:19` — `MetricTile` 属于稳定共享展示边界。
- `.trellis/spec/frontend/quality-guidelines.md:45,47` — 几何验收应由真实浏览器承担。

## External References

- 无需外部资料；根因由仓库 DOM、CSS 级联和现有真实浏览器证据完整确定。
- 相关本地版本：Ant Design `^6.2.0`、Playwright `^1.61.1`，见 `frontend/package.json:23,34`。本问题不依赖第三方未公开行为。

## Caveats / Not Found

- 本研究未修改或运行产品代码；没有启动本地真实 API E2E 栈。根因由父任务真实预发布报告、现有 375×900 基线和静态 CSS 级联交叉确认。
- 平台管理的同源风险是根据相同 `MetricTile.icon` DOM、相同 419px 通用规则和相同移动两列 Grid 推导，未在本研究中独立获取平台 375px 浏览器截图。
- 当前子任务 `prd.md` 仍为 TBD；主 Agent 应把“共享图标卡在 375/320 下与标签、数值均不相交，并复核平台消费者、桌面和真实 200%”写入可执行验收标准。
- 自动用户移动基线已经固化缺陷。未经用户批准，不应在实现阶段直接更新该 snapshot。
