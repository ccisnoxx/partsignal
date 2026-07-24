# 跨页面视觉系统收口实施计划

> 最终规划已于 2026-07-24 获得用户批准。运行 `task.py start` 后按本计划实施；不得创建新任务、开发分支、第二套视觉系统或新增视觉依赖。

## 1. 建立实施基线

- [x] 确认主工作目录位于 `main`，记录并排除无关 `.playwright-cli` 文件。
- [x] 读取 `visual-system.md`、组件规范、质量规范、本任务 PRD、设计和研究。
- [ ] 保存现有代表路由截图与计算样式清单，仅作为回归定位证据，不作为新规范。未在产品修改前形成同路由成对截图，最终不得补造。
- [x] 运行当前前端目标测试、typecheck、lint、build 和三批视觉 E2E，记录既有失败。
- [x] 使用 `rg` 固化当前 `app-shell-*`、`--um-*`、`--audit-*`、GEO 基础变量、页面字体、任意圆角/阴影清单。

## 2. 收敛运行时视觉常量

- [x] 在现有 `theme.ts` 中增加最小共享视觉常量，覆盖系统字体、等宽字体、圆角和动效。
- [x] 让 Ant Design ThemeConfig 和 ThemeProvider 的 CSS 变量注入消费同一常量。
- [x] 从 `global.css :root` 删除重复字面量，只保留语义变量消费。
- [x] 保持现有品牌颜色、状态色、图表色、阴影值和深浅主题映射不变。
- [x] 更新 ThemeProvider/theme 针对性测试。
- [x] 若运行时所有权描述发生变化，只同步更新 `visual-system.md` 对应权威条目，不修改视觉规则。

## 3. 统一 AppLayout

- [x] 删除路由到 `app-shell-dashboard/geo/configuration/user-management/audit/platform-* /prompt-management` 的视觉 class 映射。
- [x] Sider 使用统一 220px 宽度与 76px 折叠宽度。
- [x] 统一品牌区、Header 64px、搜索、主题、账号区和 Content padding。
- [x] 保留路由导航选中、上下文文字、管理权限、预取、快捷搜索、焦点恢复和移动 Drawer 行为。
- [x] 更新 AppLayout 测试，覆盖至少 Dashboard、GEO、用户、审计和配置路由的同壳层结果。
- [x] 运行 AppLayout 与主题目标测试。

## 4. 删除路由级壳层和基础 Token

- [x] 从 `global.css` 删除八组页面壳层对 Sider/Header/Content/品牌/搜索/账号的覆盖。
- [x] 删除 `--um-*`、`--audit-*` 和 GEO 基础表面/文字/边界别名；保留真实图表系列语义。
- [x] 删除页面级 `font-family`，统一使用 `--ps-font-sans/mono`。
- [x] 删除业务页面主按钮蓝紫渐变和独立 elevation 阴影，回到 Ant primary。
- [x] 用 `--ps-radius-sm/md/lg` 和 `--ps-shadow-sm/md/lg` 替换任意业务值；保留规范明确的 4px 状态、认证、打印、焦点和动态图形例外。
- [x] 每删除一组路由覆盖后，运行该路由与相邻路由 smoke，防止级联回归累积。

## 5. 按页面类型收敛内容表面

### 数据列表

- [x] 复核产品、任务、发布、GEO 记录、设置、用户、审计、平台和 AI 渠道页面。
- [x] 统一 PageHeader、筛选表面、MetricTile、TableRegion、StatusTag 和操作层级的最终计算样式。
- [x] 保留真实列、筛选、分页、详情 Drawer、权限和恢复入口。

### 编辑审核

- [x] 复核内容编辑、产品事实、平台规则和 Prompt 管理。
- [x] 统一正文/表单高不透明表面、面板标题、标签、保存反馈、圆角和阴影。
- [x] 允许调整 Grid/Flex 和冗余容器，但不强制统一三栏、不改变 Markdown 或服务端状态权威。

### 分析洞察

- [x] 复核 Dashboard、GEO 洞察和打印输出。
- [x] 统一 PageHeader、指标卡、图表容器、网格、Tooltip 和信息层级。
- [x] 保留真实数据、统计口径、自绘图表和 GEO 系列语义。

## 6. 扩展静态视觉门禁

- [x] 复用并扩展现有颜色检查脚本，覆盖原始颜色函数、禁止壳层、页面基础 Token、页面字体和外部视觉依赖。
- [x] 为合法主题源、认证/打印和动态图形例外建立最小显式 allowlist。
- [x] 增加脚本测试，证明每类禁止模式能够失败、合法模式能够通过。
- [x] 接入现有 `npm run lint`，不新增依赖。

## 7. 建立跨路由视觉门禁

- [x] 新增一个跨页面 Playwright spec，复用真实登录和现有数据流程。
- [x] 对主要业务路由执行壳层计算样式矩阵，不允许因数据不足跳过。
- [x] 为数据列表、编辑审核、分析洞察各保留一个 1440px 浅/深基线和一个 375px 浅色基线。
- [x] 遮罩动态数据并关闭动画/光标，设置能容纳系统字体差异但能识别结构、表面和颜色回归的阈值。
- [x] 验证 system、200% 缩放、键盘、焦点恢复、reduced-motion 和打印边界。
- [x] 把基线与测试纳入现有 CI。

## 7A. 八组壳层的准确删除映射

| 壳层 | `AppLayout.tsx` 来源 | `global.css` 来源 | 删除/替换目标 |
|---|---|---|---|
| `app-shell-dashboard` | `isDashboard`、`compactShell`；GEO 当前也获得该 class | `52-60,1279-1281,1353-1354` | 删除 route class；根画布、Sider、菜单、品牌、Header、Content 合并到 `.app-shell/.app-*` |
| `app-shell-geo` | `pathname.startsWith('/observations')` | `61-85,1225-1226,1268` | 删除壳层、搜索、菜单覆盖；GEO 内容保留 `.geo-*`；主按钮回到 Ant primary |
| `app-shell-configuration` | configuration、settings，排除 users/audit | `805-827,1220,1225-1227,1297-1303` | 删除 inset 壳、字体、Header 网格和移动覆盖；Header 截断改为通用断点 |
| `app-shell-user-management` | 精确 `/users` | `830-854,996-999,1011-1012` | 删除壳层和独立字体；内容规则留在 `.user-management-*` 并迁移 `--ps-*` |
| `app-shell-audit` | 精确 `/audit` | `857-880,1221-1224,1304-1305` | 删除壳层和独立字体；内容规则留在 `.audit-*` |
| `app-shell-platform-management` | 精确 `/configuration/platforms` | `1026-1028,1315` | 删除 Header/Content 路由几何；保留平台内容布局 |
| `app-shell-platform-rules` | 精确 `/configuration/platform-rules` | `1444-1445,1534-1535,1546` | 删除 Header/Content 路由几何；保留平台/版本/详情布局 |
| `app-shell-prompt-management` | 精确 `/configuration/prompts` | `1603-1604,1691,1702` | 删除 Header/Content 路由几何；保留 Prompt 工作区 |

- `global.css:356-358,1299-1302` 通过 `:has(page)` 改变全局搜索、用户区或 Header，也属于路由视觉分支，删除或改写成统一断点。
- 保留 `@media print` 下隐藏 Sider/Header 和展开 GEO 打印内容的规则。
- 完成后 `frontend/src` 不得残留上述八个字符串。

## 7B. Token 消费与迁移

| 当前 Token | 准确消费位置 | 迁移目标 |
|---|---|---|
| `--um-primary/hover/soft` | `global.css:837,842-843,946-980` | `--ps-action-primary/hover/soft` |
| `--um-border` | `833,845,850,852,952-981` | `--ps-border-subtle/default` |
| `--um-surface` | `833,845,850,852,952,955,980` | `--ps-bg-surface` 或允许的 `--ps-glass-surface-strong` |
| `--um-text-primary/secondary` | `830,838,840,847,940-985` | 对应 `--ps-text-*` |
| `--audit-border` | `860,872,876,878,889,903,913,918,932,936` | `--ps-border-subtle/default` |
| `--audit-surface` | `860,872,876,878` | `--ps-bg-surface` |
| `--geo-border` | `62,67,75,185-317` | `--ps-border-subtle/default` |
| `--geo-surface/strong` | `185` | `--ps-glass-surface/strong` 或高不透明 `--ps-bg-surface` |
| `--geo-text-primary/secondary/tertiary` | `61,79,178-317` | 对应 `--ps-text-*` |

GEO 数据语义直接消费现有主题系列：

- 趋势 mention/recommendation/citation/accuracy/missing → `--ps-geo-series-blue/green/purple/orange/red`。
- 平台 mention/recommendation/citation/accuracy → `--ps-geo-series-green/purple/orange/teal`。
- 修改 `GeoInsightsPage.tsx:252-255,502-506` 和 `global.css:261-264`。
- 保留 `--geo-accent`、`--geo-rate-color`、数据比例宽度和坐标。

## 7C. 运行时所有权与 AppLayout 终态

`theme.ts`：

- `projectThemes` 继续持有浅/深语义颜色、玻璃、状态、图表和 `shadowSm/md/lg`。
- 新增模块私有扁平 `visualConstants`，持有系统/等宽字体、8/12/16px 圆角、150/200/220ms 动效和现有 easing。
- `applyProjectTheme` 签名不变，一次性注入主题值和静态视觉变量。
- `createAntTheme` 签名不变，从同一常量映射字体、圆角和动效；移除 Button/Menu/Card 重复字面量。

`ThemeProvider.tsx` 继续只解析模式、system、reduced-motion 并调用上述函数，预计不修改。`global.css :root` 删除重复值，只消费 `--ps-*`。`index.html` 的画布字面量仅是挂载前防闪烁例外。

`AppLayout.tsx`：

- 保留 `matchesRoute`、`selected`、`selectedKey`、`currentSection`、权限、预取、搜索、退出、焦点和 Drawer。
- 保留 `isConfiguration`、`isAuditLog`、`isBusinessSettings`、`isGeo`，但只用于 Header 上下文。
- 删除 `isDashboard`、`isManagementShell`、`isUserManagement`、`isPlatformManagement`、`isPlatformRules`、`isPromptManagement`、`compactShell`。
- 根节点固定 `app-shell`；Sider 固定 220/76px；桌面折叠按钮统一位于 Sider 底部；移动 Header 只打开 280px Drawer；主题按钮紧凑模式只取决于视口。
- `>=992px` Header/品牌区 64px、Content 24px；`<992px` Content 16px；`<=419px` Content 12px。

## 7D. 字面量扫描、例外与替换

- 圆角：控件/紧凑子容器用 `radius-sm`，局部业务容器用 `radius-md`，Card/页面大面板用 `radius-lg`。5/6/7px → sm；9/10/14/18px 按层级 → md/lg；普通业务中的 8/12/16px 也改为变量。
- 圆角例外：4px 紧凑状态、50% 圆形、999px 明确胶囊、0 reset、认证现有圆角、打印 reset。
- 阴影：Card/Sider/Header → `shadow-sm`；悬浮/固定操作 → `shadow-md`；Modal/Drawer → `shadow-lg`。允许 `none`、焦点/选中/校验 inset、差异标记和数据点环；登录认证玻璃阴影保留。
- 主操作：GEO、任务、用户、AI 配置等删除蓝紫渐变和彩色阴影；Prompt 平台选中改为 `actionPrimarySoft` 加主色 inset。登录主按钮和真实数据图形色带保留。
- 字体：删除用户、审计的 `PingFang SC` 覆盖；`.data-code` 使用 `--ps-font-mono`；普通页面只允许 `--ps-font-sans`。

## 7E. 静态视觉契约细节

扩展 `frontend/scripts/check-theme-colors.mjs`，不改名、不增加依赖。

输入：

- `frontend/src/**/*.{css,ts,tsx}`；
- `frontend/index.html`；
- `frontend/package.json`；
- 可选 CLI 扫描根目录供临时测试使用。

失败规则：

- hex、rgb/rgba、hsl/hsla、oklch/oklab；
- 八组禁止壳层；
- `--um-*`、`--audit-*`、`--geo-border`、`--geo-surface*`、`--geo-text-*`；
- 页面字体、`@font-face`、外链字体；
- 未 allowlist 的数字圆角、外部 elevation 阴影、主操作蓝紫渐变；
- 从 `--ps-chart-series-*` 或 `--ps-geo-series-*` 派生非数据基础表面、文字或操作色的 `color-mix()`；
- Tailwind、shadcn registry、Lucide、Phosphor、Web Font 和 CSS-in-JS 依赖/import。

allowlist 必须是准确文件加选择器/属性类型：

- `theme.ts` 仅 `projectThemes` 主题值区；
- `index.html` 的浅/深首屏画布；
- 认证、打印、4px 状态、圆形/胶囊、焦点/选中 inset、数据图形；
- `--geo-accent`、`--geo-rate-color`、`--ps-geo-series-*`。

新增 `scripts/check-theme-colors.test.mjs`，使用 Node `node:test` 和临时目录。每类禁止 fixture 必须失败并输出 `文件:行号:规则`，合法例外必须通过。`package.json` 新增 `test:visual-contract`，现有 `test` 串联该测试；不改锁文件。

## 7F. Playwright 准确矩阵

固定路由：

- `/`、`/products`、`/tasks`、`/publications`
- `/observations`、`/observations/insights`
- `/settings`、`/settings?tab=accounts`
- `/users`、`/audit`
- `/configuration`（断言重定向 `/configuration/ai`）
- `/configuration/ai`、`/configuration/platform-types`、`/configuration/platforms`

真实 API 解析后增加：

- `/products/:productId`
- `/tasks/:taskId`
- `/content/:contentVersionId`
- `/configuration/platform-rules?platform_profile_id=:id&version_id=:id`
- `/configuration/prompts?tab=platform&page=1&page_size=10&platform_profile_id=:id`

出版详情、attention/repair、观测纠错和 AI channel 动态路由继续由既有 MVP/AI E2E 覆盖，不复制业务建数流程。缺少产品、内容版本、平台或规则版本时抛出明确错误，不得 skip。

主题/视口：

- 全部壳层路由 light/dark，1440×1000。
- `/users`、Prompt、GEO 洞察额外检查 1024×900、768×900、375×900、320×900。
- system dark、reduced-motion、键盘搜索选择、Tab 顺序、`:focus-visible`、焦点恢复和打印使用行为/计算样式断言。
- Playwright 持久 Chromium 加载 `fixtures/browser-zoom-extension`，通过浏览器 `chrome.tabs.setZoom` 设置真实 200% tab zoom，并验证三类页面的有效视口、移动壳层、关键内容和无文档溢出。

计算样式断言：

- 根 class 只有 `app-shell`；
- Sider 220/76px，品牌/Header 64px；
- Content 24/16/12px；
- 搜索、主题、用户区跨路由一致；
- 移动无桌面 Sider，Drawer 280px；
- document 无横向溢出，宽表只在 `.table-region` 内滚动；
- 普通文字 4.5:1，大文字/控件边界 3:1。

九个 `toHaveScreenshot` 基线：

- `users-{light,dark}-1440x1000.png`、`users-light-375x900.png`
- `prompts-{light,dark}-1440x1000.png`、`prompts-light-375x900.png`
- `geo-insights-{light,dark}-1440x1000.png`、`geo-insights-light-375x900.png`

使用 viewport screenshot、关闭动画/光标、`maxDiffPixelRatio: 0.02`。只遮罩用户动态值/表体、Prompt 平台文字/编辑器内容/预览，以及 GEO 时间、质量计数、趋势数值与曲线、漏斗数值与高度、动态表体；不遮罩壳层、筛选器、卡片边界、静态标签和操作。

## 7G. 既有 E2E 与 skip

必须回归：

- `theme.spec.ts`
- `list-workbench-convergence.spec.ts`
- `dashboard-geo-convergence.spec.ts`
- `editor-workspace-convergence.spec.ts`
- `ai-channel-management.spec.ts`
- `mvp-flow.spec.ts`
- 新 `cross-page-visual-convergence.spec.ts`

修改：

- `dashboard-geo-convergence.spec.ts` 删除 `eligible_observation_count===0` 的 `test.skip`；有数据验证图表，无数据验证真实 NoData。
- `ai-channel-management.spec.ts` 把配置壳层绝对 rect 改为统一 220/64/24 基线和相对布局断言。
- 其他 E2E 原则上只回归；目标解析、编辑工作区、洞察状态和视觉基线均不得因数据不足 skip。

## 8. 最终验证

- [x] 目标单测通过。
- [x] `npm --prefix frontend run test`。
- [x] `npm --prefix frontend run typecheck`。
- [x] `npm --prefix frontend run lint`。
- [x] `npm --prefix frontend run build`。
- [x] 新跨路由视觉 spec 通过。
- [x] 既有三批视觉 E2E 和 MVP 关键流程通过。
- [x] 浅色、深色、system、375/768/1024/1440px、真实 200% 缩放和 reduced-motion 完成人工抽查。
- [x] `git diff --check` 通过。
- [x] `rg` 确认禁止壳层、基础 Token、页面字体和任意主按钮渐变没有残留。
- [x] 检查 diff 未包含 backend、contracts、依赖锁文件、无关部署文件或 `.playwright-cli` 日志。

## 9. 质量检查与提交前门禁

- [x] 由独立 `trellis-check` 核对 PRD AC1–AC12、视觉规范、代码复用、测试和跨路由截图。
- [x] 对发现的问题仅修复本任务范围；业务契约变化必须返回规划。
- [x] 评估是否需要更新 `visual-system.md` 的运行时所有权描述；无需更新时明确记录原因。
- [x] 向用户提供准确 diff、验证结果、视觉前后证据、剩余风险和仅包含本任务文件的提交计划。
- [x] 未经提交计划确认，不提交、归档或推送。

## 10. 阶段文件、最小命令、停止条件与回滚点

### 阶段 0：基线

```bash
git status --short --branch
npm --prefix frontend exec -- vitest run src/app/AppLayout.test.tsx src/app/ThemeProvider.test.tsx
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
deploy/scripts/e2e-local.sh \
  tests/e2e/theme.spec.ts \
  tests/e2e/list-workbench-convergence.spec.ts \
  tests/e2e/dashboard-geo-convergence.spec.ts \
  tests/e2e/editor-workspace-convergence.spec.ts \
  tests/e2e/ai-channel-management.spec.ts
```

停止：不在 `main`、出现未识别 dirty 文件、既有检查失败且无法证明与任务无关。回滚点：产品代码尚未修改。

### 阶段 1：主题所有权

必改：

- `frontend/src/app/theme.ts`
- `frontend/src/app/ThemeProvider.test.tsx`
- `frontend/src/styles/global.css :root`
- `.trellis/spec/frontend/visual-system.md`

风险但预计不改：`ThemeProvider.tsx`、`index.html`。

```bash
npm --prefix frontend exec -- vitest run src/app/ThemeProvider.test.tsx
npm --prefix frontend run typecheck
```

停止：浅/深变量缺失、Ant 与 CSS 值不一致、首屏主题回归。回滚：只反向修改阶段 1 hunks。

### 阶段 2：单一 AppLayout

必改：

- `frontend/src/app/AppLayout.tsx`
- `frontend/src/app/AppLayout.test.tsx`
- `frontend/src/styles/global.css` 壳层基础和 route shell

```bash
npm --prefix frontend exec -- vitest run src/app/AppLayout.test.tsx src/app/ThemeProvider.test.tsx
deploy/scripts/e2e-local.sh tests/e2e/list-workbench-convergence.spec.ts tests/e2e/dashboard-geo-convergence.spec.ts
```

停止：导航选中、面包屑、权限、折叠、Drawer 或路由可达性变化。回滚：保留阶段 1，只反向修改阶段 2；不得恢复 route shell。

### 阶段 3：Token 和页面表面

必改：

- `frontend/src/styles/global.css`
- `frontend/src/features/geo-observations/GeoInsightsPage.tsx`
- `frontend/tests/e2e/dashboard-geo-convergence.spec.ts`
- `frontend/tests/e2e/ai-channel-management.spec.ts`

页面和共享组件是风险文件，不预先承诺修改。

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
deploy/scripts/e2e-local.sh \
  tests/e2e/list-workbench-convergence.spec.ts \
  tests/e2e/editor-workspace-convergence.spec.ts \
  tests/e2e/dashboard-geo-convergence.spec.ts \
  tests/e2e/ai-channel-management.spec.ts
```

停止：字段、按钮、权限、查询、保存/审核、图表语义变化，或页面 class 被迫承担 AppLayout 职责。回滚：按三类页面分组反向修改，不恢复基础 Token。

### 阶段 4：静态契约

必改：

- `frontend/scripts/check-theme-colors.mjs`
- `frontend/scripts/check-theme-colors.test.mjs`
- `frontend/package.json`

```bash
npm --prefix frontend run test:visual-contract
npm --prefix frontend run lint
```

停止：合法主题/认证/打印/数据图形误报，或任一禁止 fixture 未失败。回滚：只撤销脚本相关变更；不得增加宽泛目录 allowlist。

### 阶段 5：视觉门禁

必改/新增：

- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`
- 九个 snapshot
- `dashboard-geo-convergence.spec.ts`
- `ai-channel-management.spec.ts`

预计不改：`playwright.config.ts`、CI、部署脚本。

```bash
deploy/scripts/e2e-local.sh tests/e2e/cross-page-visual-convergence.spec.ts
deploy/scripts/e2e-local.sh \
  tests/e2e/theme.spec.ts \
  tests/e2e/list-workbench-convergence.spec.ts \
  tests/e2e/dashboard-geo-convergence.spec.ts \
  tests/e2e/editor-workspace-convergence.spec.ts \
  tests/e2e/ai-channel-management.spec.ts
```

停止：需要遮罩静态结构、阈值超过 2%、依赖测试顺序或使用 skip。回滚：先撤销新 spec/基线；产品回归返回阶段 2/3 修根因。

### 阶段 6：全量验证

```bash
npm --prefix frontend run test
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
deploy/scripts/e2e-local.sh
git diff --check
rg -n "app-shell-(dashboard|geo|configuration|user-management|audit|platform-management|platform-rules|prompt-management)|--um-|--audit-|--geo-(border|surface|text-)" frontend/src
```

停止：任一 AC 缺少直接证据，或 diff 出现 backend、contracts、锁文件、部署文件及无关日志。

## 11. AC1–AC12 验证矩阵

| AC | 实施阶段 | 直接证据 |
|---|---|---|
| AC1 | 阶段 2 | AppLayout 参数化单测、静态契约、220/76 壳层断言 |
| AC2 | 阶段 2、5 | 全路由 light/dark 计算样式、八路由前后截图 |
| AC3 | 阶段 3、4 | `rg` 零命中、禁止 fixture、lint |
| AC4 | 阶段 1 | ThemeProvider 变量注入、Ant 映射、reduced-motion 单测 |
| AC5 | 阶段 3、4、5 | 字面量扫描、静态契约、三类视觉基线 |
| AC6 | 阶段 3、6 | 既有单测/E2E/MVP、业务契约 diff 审计 |
| AC7 | 阶段 1、3、5 | light/dark/system、对比度、焦点、Tooltip、图表 Token |
| AC8 | 阶段 2、3、5 | 1024/768/375/320、真实 Chrome 200% tab zoom、无溢出 |
| AC9 | 阶段 5 | 跨路由矩阵、九个 `toHaveScreenshot`、CI |
| AC10 | 阶段 4 | Node fixture、生产扫描、lint |
| AC11 | 阶段 6 | test/typecheck/lint/build/e2e、`git diff --check` |
| AC12 | 全阶段 | 无新依赖/锁文件/新壳层/新设计系统，准确 diff |

## 12. 人工前后视觉证据

在忽略目录 `frontend/test-results/visual-convergence/{before,after}/` 保留：

- 1440×1000 light 壳层：Dashboard、GEO、AI 配置、用户、审计、平台、规则、Prompt。
- `/users`、Prompt、GEO 洞察：1440 light/dark、375 light。
- GEO 打印预览和三个代表页真实 Chrome 200%。

比较视角：

1. 左上壳层裁切：Sider、品牌、Header、搜索、用户区。
2. 完整 viewport：页面层级、表面、主操作和信息密度。
3. 375px Drawer 关闭/打开：关键操作和焦点顺序。
4. 200% 和打印：遮挡、裁切、横向溢出、导航隐藏。

仓库只提交九个 after 自动视觉基线；人工 before/after 保持为验收产物。

## 关键风险文件

- `frontend/src/app/AppLayout.tsx`
- `frontend/src/app/AppLayout.test.tsx`
- `frontend/src/app/theme.ts`
- `frontend/src/app/ThemeProvider.tsx`
- `frontend/src/app/ThemeProvider.test.tsx`
- `frontend/src/styles/global.css`
- `frontend/src/shared/components/PageHeader.tsx`
- `frontend/src/shared/components/MetricTile.tsx`
- `frontend/src/shared/components/TableRegion.tsx`
- `frontend/src/shared/components/StatusTag.tsx`
- `frontend/scripts/check-theme-colors.mjs`
- `frontend/playwright.config.ts`
- `frontend/tests/e2e/*visual*.spec.ts`

只修改证据证明需要变化的文件；关键风险列表不是预先承诺全部修改。

## 13. 实施结果与验证证据（2026-07-24）

任务已执行至最终质量门禁，状态保持 `in_progress`。AC1–AC12 均有通过证据，独立 `trellis-check` 已完成且发现的静态契约绕过已修复；未运行归档、提交或推送。

### 13.1 实际修改范围

规范与任务证据：

- `.trellis/spec/frontend/visual-system.md`
- `.trellis/tasks/07-24-frontend-cross-page-visual-convergence/prd.md`
- `.trellis/tasks/07-24-frontend-cross-page-visual-convergence/implement.md`
- `.trellis/tasks/07-24-frontend-cross-page-visual-convergence/research/current-state.md`
- 任务自身 `task.json`、`check.jsonl`、`implement.jsonl` 和既有 `design.md`

主题、壳层与页面：

- `frontend/src/app/theme.ts`
- `frontend/src/app/AppLayout.tsx`
- `frontend/src/styles/global.css`
- `frontend/src/features/geo-observations/GeoInsightsPage.tsx`

单元与契约测试：

- `frontend/src/app/AppLayout.test.tsx`
- `frontend/src/app/ThemeProvider.test.tsx`
- `frontend/src/features/dashboard/DashboardPage.test.tsx`
- `frontend/scripts/check-theme-colors.mjs`
- `frontend/scripts/check-theme-colors.test.mjs`
- `frontend/package.json`
- `frontend/vite.config.ts`

Playwright：

- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`
- `frontend/tests/e2e/fixtures/browser-zoom-extension/manifest.json`
- `frontend/tests/e2e/fixtures/browser-zoom-extension/service-worker.js`
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/*.png` 九个基线
- `frontend/tests/e2e/dashboard-geo-convergence.spec.ts`
- `frontend/tests/e2e/ai-channel-management.spec.ts`
- `frontend/tests/e2e/mvp-flow.spec.ts`
- `frontend/playwright.config.ts`

`playwright.config.ts` 的实际修改是使用无平台后缀的 snapshot `pathTemplate`，让同一组经阈值和遮罩稳定化的基线可由现有 CI 消费。`vite.config.ts` 的实际修改是排除 Node `node:test` 契约脚本，避免 Vitest 把它误收集为无 suite 文件。这两项均由真实测试失败触发，不是新抽象。

未修改 `ThemeProvider.tsx`、共享视觉组件、其他页面 TSX、CI、部署脚本、依赖锁文件、backend 或 contracts。无关 `.playwright-cli/console-2026-07-23T23-17-17-038Z.log` 不在任务范围且必须从任何提交排除；最终审计发现其 mtime 在 E2E 运行窗口变为 19:50:48，无法继续声称“未触碰”，未读取、恢复、删除或纳入该文件，且当前无进程持有它。

### 13.2 实施阶段与依赖结果

1. `theme.ts` 建立唯一运行时常量，`ThemeProvider` 保持现有职责。
2. `AppLayout` 删除八组路由视觉分支，固定 220/76/64/24 和 280/16/12 壳层几何。
3. `global.css` 删除重复 Token、页面字体、主操作渐变和路由壳层，GEO 直接消费项目系列 Token。
4. 静态契约扩展为 Node 标准库脚本和 14 个失败/合法 fixture，并把原始颜色 allowlist 收紧到 `projectThemes` 值区。
5. Playwright 增加跨路由、主题、视口、键盘、真实浏览器 tab zoom、打印矩阵及九个基线。
6. 按当前 API 契约和业务前置状态修复既有 MVP E2E，目标测试、全量单测、typecheck、lint、build、视觉 E2E、MVP 及差异扫描全部完成。

依赖顺序与原计划一致：主题所有权 → 壳层 → 页面表面 → 静态契约 → 视觉门禁 → 全量验证。没有为并行实施制造过渡层或第二套所有者。

### 13.3 AC1–AC12 最终证据

| AC | 状态 | 实施与测试证据 |
|---|---|---|
| AC1 | 通过 | `AppLayout` 根节点固定 `app-shell`；单测覆盖多路由同壳层和 220/76 折叠 |
| AC2 | 通过 | 19 个静态/动态路由 light/dark 计算样式矩阵验证 Sider、Header、品牌、搜索、账号区和 Content |
| AC3 | 通过 | 静态契约与 `rg` 对八组壳层、`--um-*`、`--audit-*`、GEO 基础 Token 零命中 |
| AC4 | 通过 | `visualConstants` 同时驱动 Ant ThemeConfig 与 CSS 变量；ThemeProvider 目标测试通过 |
| AC5 | 通过 | 静态契约检查数字圆角、外部 elevation、页面字体、主按钮渐变和图表色派生基础表面；合法例外精确 allowlist |
| AC6 | 通过 | 未修改产品 API、路由、权限、查询口径、状态转换或业务组件；125 个 Vitest、完整 MVP 2/2 和既有视觉 E2E 通过 |
| AC7 | 通过 | light/dark/system、对比度、键盘搜索选择、Tab、可见焦点环、reduced-motion、图表和玻璃断言通过 |
| AC8 | 通过 | 1440/1024/768/375/320、真实浏览器 200% tab zoom、Drawer 280 和无横向溢出断言通过 |
| AC9 | 通过 | 新 spec 含五个矩阵测试及九个 `toHaveScreenshot` 基线；真实 GEO 数据变化后仅补充数值、曲线和漏斗动态节点遮罩，阈值保持 2% |
| AC10 | 通过 | `test:visual-contract` 14/14，覆盖精确主题 allowlist 与图表色 `color-mix()` 绕过 |
| AC11 | 通过 | test/typecheck/lint/build 全通过；完整 `mvp-flow.spec.ts` 2/2，相关视觉 E2E 整批 22/22，无 skip |
| AC12 | 通过 | 无新依赖、锁文件、新页面壳、设计系统或 backend/contracts 变更；`git diff --check` 通过 |

已观察命令结果：

- `npm run test`：首次运行出现 Vitest worker 启动/终止超时；相关三个文件最小复现 23/23 通过，随后原命令完整重跑为 21 个 Vitest 文件、125 个测试通过，视觉契约 14 个测试通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过；仅保留既有大于 500 kB chunk 警告。
- `cross-page-visual-convergence.spec.ts`：五个测试整批通过；真实 200% 使用浏览器 `chrome.tabs.setZoom`，不是 CDP 页面缩放仿真。
- `theme.spec.ts`：4/4；`list-workbench-convergence.spec.ts`：3/3；`dashboard-geo-convergence.spec.ts`：4/4；`editor-workspace-convergence.spec.ts`：4/4；`ai-channel-management.spec.ts`：2/2。
- `mvp-flow.spec.ts`：2/2；账号契约测试与完整业务链均单独通过，完整 spec 无 skip。
- 上述六组视觉 E2E 合并回归：22/22；MVP 写入真实 GEO 观测后首次发现 3% 动态数据差异，补充精确遮罩并在无更新模式和整批模式复跑通过。
- `git diff --check`：通过。

### 13.4 AC11 解阻结果

全量 `mvp-flow.spec.ts` 的失败不来自视觉实现，已在用户授权的测试范围内修复：

1. 创建用户改用当前 `temporary_password` 字段；临时管理员显式走首次改密后再验证自助改密、会话失效、最后管理员与停用规则。
2. 测试开始时只停用用户名匹配 `admin-[0-9a-f]{8}` 且显示名符合本测试命名规则的遗留管理员，结束时停用本轮账号，避免持久测试库破坏“最后管理员”前置状态且不影响其他账号。
3. 平台预览和自然化的可检索 Select 填入本轮唯一文本后普通点击精确可见 title；GEO 固定枚举直接精确点击当前可见 title，并仅对已确认会被表单标签遮挡的枚举点击使用 `force`。不再按 Enter、隐藏 `role=option` 或模糊文本猜选。
4. GEO 创建前读取真实 `/api/v1/query-topics` 并要求至少一条，不以数据不足 skip；账号权限以真实 API 403 断言服务端权威。

API、backend、权限、状态转换和产品业务流程保持不变；最终使用标准本地 E2E 栈完整运行 `mvp-flow.spec.ts`，2/2 通过。

### 13.5 最终视觉证据

仓库保留 `/users?q=admin`、Prompt 管理和 GEO 洞察三类代表页的 1440×1000 light/dark 与 375×900 light 九个自动基线。人工抽查了用户 light 桌面、Prompt dark 桌面和 GEO light 移动视角，重点比较壳层、内容层级、表面、主操作及移动裁切。

精确成对的人工 before 截图未在产品代码修改前生成，不能事后伪造；现有 `.playwright-cli` 中的任务前内容审查截图可作辅助但不等同于九组同路由 before。自动 after 基线和计算样式矩阵完整保留，这是剩余的人工证据缺口，不影响可重复门禁。

### 13.6 剩余真实风险

- 静态契约直接阻断 `--ps-chart-series-*`、`--ps-geo-series-*` 的基础表面 `color-mix()`；合法的数据驱动 `--geo-accent` 局部别名不做递归 Token 解析，后续若被用于非图形表面只能由代码审查和视觉 E2E 发现。当前用法仍限于数据图形，不为理论绕过新增解析器。
- 完整 Vitest 首次运行出现一次 worker 超时，但最小复现和原命令完整重跑均通过；测试运行器仍有低概率环境波动。
- 生产构建保留既有主 chunk 大于 500 kB 警告，本任务未引入依赖或扩大该问题，也不在视觉收口范围内处理。
- 视觉基线依赖持久测试库；当前只遮罩明确的用户、Prompt 与 GEO 动态数据节点，任何新增动态区域都应先证明来源再调整遮罩，不能直接提高 2% 阈值。
- GEO 基线当前遮罩整个动态 Ant Table 表体，因此仍能发现壳层、卡片、表头、筛选器和页面 Grid 回归，但不能发现表体内部行高、列对齐及行内结构回归；后续只有在动态单元值可稳定定位时才应收窄遮罩。
- 无关 `.playwright-cli/console-2026-07-23T23-17-17-038Z.log` 仍为未跟踪文件且不在任务 diff，但 mtime 在 E2E 窗口发生变化；没有修改前基线可安全恢复，因此保持原地并明确禁止纳入提交。

### 13.7 AC11 授权解阻完成项

1. [x] 将用户创建 payload 改为 `temporary_password`，并验证首次改密、最后管理员、停用会话等既有业务规则。
2. [x] 修正持久测试库中的测试管理员前置状态，并在本轮结束时清理新建账号。
3. [x] 用本轮真实建数的精确可见选项驱动平台预览、自然化和 GEO 表单，不修改产品门禁。
4. [x] 完整 MVP 2/2 后重跑全量单测、typecheck、lint、build、视觉 E2E、skip 扫描和 diff 扫描。
5. [x] 由独立 `trellis-check` 复核 AC1–AC12。

### 13.8 独立质量检查

最终 `trellis-check` 未发现 P0/P1 或业务契约越界。它发现静态视觉脚本原先会无条件放行任意 `inset` 阴影；现已收紧为 GEO 筛选、审核差异、选中态、焦点态和认证等现有真实选择器，并新增任意 `inset` 必须失败的测试。检查后 lint、typecheck、目标 Vitest 25/25 和静态视觉契约 14/14 通过。
