# 实施计划

## 0. 启动门禁

- [x] 用户已评审并明确批准 `prd.md`、`design.md`、`implement.md`，已运行 `python3 ./.trellis/scripts/task.py start 07-16-frontend-workspace-layout`。
- [x] 在主工作目录 `/Users/sc/PycharmProjects/partsignal` 确认分支为 `main`，且除本任务目录外没有未识别修改；不创建开发分支。
- [x] 运行 `trellis-before-dev`，完整读取本任务三份文档、frontend spec 索引和共享复用指南；当前 frontend spec 多为占位内容，实际实现以已验证代码、测试和任务设计为准。
- [x] 不修改后端、契约、数据库、部署、依赖、主题架构、全局导航或工作台指标结构。
- [x] 本任务使用 Codex inline 流程，不整理 `implement.jsonl` / `check.jsonl`，不派发实现或检查子 Agent。

## 1. 建立基线与精确清单

- [x] 记录主工作目录状态与以下基线结果，现有失败先报告，不用布局改造掩盖：

  ```bash
  cd /Users/sc/PycharmProjects/partsignal/frontend
  npm run api:check
  npm run lint
  npm run typecheck
  npm test
  npm run build
  ```

- [x] 不保存或提交截图基线；实施前以源码、现有测试和既有布局规则确认现状，实施后用真实浏览器覆盖 `/products`、`/configuration/ai`、一个 Table 配置页、一个内容审核页和产品事实长表单的 375/768/1024/1440 验收矩阵。
- [x] 搜索所有 `PageHeader`、主要 Table 外层 Card、`.configuration-channel-grid`、`.review-cockpit`、`.review-document-grid`、`.form-section-nav` 和 `.decision-rail` 调用方，形成最终触及文件清单。
- [x] 确认目标页面的字段、操作、路由和测试断言基线；不改变 API、query key 或 mutation。

## 2. 建立最小共享布局规则

目标文件：`frontend/src/styles/global.css`，默认不改共享 TSX 组件。

- [x] 收紧非 Hero `PageHeader` 的字号、上下间距和操作区布局；Dashboard Hero 保持现状。
- [x] 增加集合数据表面的共享语义类，消除无标题 Card 与 Table 的重复边界，同时保留 Card 需要的 loading/extra 行为。
- [x] 增加详情网格、章节目标 `scroll-margin-top` 和审核粘性操作条样式；全部消费现有 CSS 变量。
- [x] 复用 `.form-section-nav` 的玻璃材质和横向滚动行为，不创建第二套章节导航样式。
- [x] 增加最少断点：沿用 767/1199px，仅为 1440 三栏补充必要的宽屏规则。
- [x] 检查新规则不对登录页、Dashboard Hero、AppLayout、Modal 或普通业务 Card 造成旁路影响。

定向检查：

```bash
npm run lint
npm run typecheck
```

回滚点：若默认页头或 Card 规则影响非目标页面，回退通配选择器并改用目标页面语义类，不在每页复制样式。

## 3. 重塑集合与配置页

### 3.1 AI 渠道列表

目标文件：`frontend/src/features/configuration/AIChannelsPage.tsx`、`ConfigurationPages.test.tsx`。

- [x] 使用现有 Ant Design Table 和 `TableRegion` 替换渠道卡片网格。
- [x] 按设计顺序完整保留名称、状态、根地址、超时、API Key、Header、模型、查看、启停和删除。
- [x] 名称/详情入口继续使用现有详情 URL；启停和删除复用现有 mutation、确认和加载状态。
- [x] 长 URL、模型标签和操作列配置明确宽度/换行与局部横向滚动，不增加移动卡片分支。
- [x] 删除不再使用的卡片专用 JSX、图标、类和 CSS；不保留两套渲染。
- [x] 更新单测，验证字段、敏感信息边界、详情链接、启停与删除仍可用，不断言脆弱样式值。

### 3.2 已有 Table 的集合页

目标范围：产品、任务、发布、观测、用户、业务设置和其他配置集合页。

- [x] 为每个主要数据集增加 `.collection-panel`，将搜索、筛选、Tabs 与 Table 放在同一视觉层级。
- [x] 除 AI 渠道旧卡片外不删除 Card DOM；Card 承担标题、`extra`、提示、错误、空态、加载或独立业务分组时保留，只收紧其视觉密度。
- [x] 保留所有列、展开行、分页、Modal、危险确认、空/错/加载状态和权限分支。
- [x] 人工发布 Tabs、GEO 指标和发布摘要结构不变。
- [x] 不抽取通用 Table 配置或列工厂。

定向检查：

```bash
npm test -- src/features/configuration/ConfigurationPages.test.tsx src/features/dashboard/DashboardPage.test.tsx
npm run lint
npm run typecheck
```

回滚点：若统一表面类无法覆盖某一页面，只保留该页现有 Card，不新建页面专用设计系统。

## 4. 重塑详情与审核长页面

### 4.1 内容审核工作台

目标文件：`frontend/src/features/content-editor/ContentEditorPage.tsx`、`ContentEditorPage.test.tsx`、`global.css`。

- [x] 将 Markdown、预览和决策依据改为同一 12 列 CSS Grid，1440px 使用约 `5:4:3`。
- [x] 在 1024px 降为 Markdown/预览双列加全宽决策区，在 768px 及以下降为单列；DOM 顺序保持 Markdown、预览、决策。
- [x] 将现有审核按钮从 PageHeader 移入同时承载章节链接的唯一 `.review-toolbar`；继续直接使用同一个 `available_actions`，保留危险语义、loading 与错误反馈。
- [x] 为正文、差异、冻结事实和审核历史增加稳定 ID；生成追溯和人工修订的链接与目标使用相同条件渲染，业务顺序和内容不变。
- [x] 删除被替代的嵌套 `Row/Col + review-document-grid` 布局，不保留兼容分支。
- [x] 更新测试，验证三个主要区域、所有业务区块、章节链接和审核按钮存在，mutation 行为不变。

### 4.2 其他详情页

- [x] 产品事实页只调整页头、表面、锚点偏移和现有章节导航；不重写 FactsForm、Tabs、动态字段或保存条。
- [x] 内容任务详情只为始终存在的任务约束、生成输入和内容版本增加锚点；保留追溯内容的现有位置、现有顺序和 0.8/1.2 主次关系。
- [x] AI 渠道详情为连接、Header、模型三个区块增加章节导航与统一详情表面；表格保持全宽。
- [x] 发布记录、异常和修复任务只应用紧凑页头/详情表面；没有三个连续区块时不增加章节导航或三栏。
- [x] 检查返回链接、面包屑、浏览器返回、焦点顺序和 sticky 偏移。

定向检查：

```bash
npm test -- src/features/content-editor/ContentEditorPage.test.tsx src/features/product-facts/ProductFactsPage.test.tsx src/features/configuration/ConfigurationPages.test.tsx
npm run lint
npm run typecheck
```

回滚点：若粘性操作或章节导航在中小视口遮挡内容，先回退 sticky 定位，保留正常文档流；不得通过固定高度或内部滚动补救。

## 5. 功能测试与文档

- [x] 在 `frontend/tests/e2e/mvp-flow.spec.ts` 已有登录和数据准备流程中增加最小布局不变量：页面无横向溢出、目标 TableRegion 存在、详情 URL/返回稳定、代表性主操作可见。
- [x] 不创建重复 E2E 数据种子，不新增视觉测试依赖，不恢复 `toHaveScreenshot` 或 PNG 基线。
- [x] 更新 `frontend/README.md`，记录集合工作区、详情工作区、章节导航、断点和人工验收边界。
- [x] 对触及的 TSX 文件执行中文注释/JSDoc/开发者文本检查；只有文件职责变化时更新文件级注释，不添加机械布局注释。

## 6. 完整验证

### 6.1 自动检查

```bash
cd /Users/sc/PycharmProjects/partsignal/frontend
npm run api:check
npm run lint
npm run typecheck
npm test
npm run build
```

本地完整 E2E 栈可用时运行：

```bash
npx playwright test tests/e2e/mvp-flow.spec.ts tests/e2e/theme.spec.ts
```

若 E2E 依赖未就绪，明确记录缺少的服务；启动开发服务器不算通过。`npm run perf:production` 默认跳过，因为本任务不增加依赖、动画或数据量；只有浏览器检查出现卡顿、Long Task 或包体异常时再运行。

最终结果：

- `npm run api:check`、`npm run lint`、`npm run typecheck`、`npm run build` 均退出 0；最后一条移动断点 CSS 修正后再次通过 Lint、类型检查、构建和 `git diff --check`。
- `npm test` 退出 0，14/14 个测试文件、43/43 个测试通过；输出仅含既有 jsdom 对伪元素和部分 CSS 的能力提示。
- 使用命令级 `DATABASE_URL` / `REDIS_URL` 主机映射运行 `deploy/scripts/e2e-local.sh`，没有修改 `.env`；Playwright 6/6 通过并由脚本清理服务。
- 构建保留既有主 chunk 大于 500 kB 警告；本任务没有增加依赖或发现新的包体异常，因此按计划不运行 `npm run perf:production`。

### 6.2 浏览器验收矩阵

对普通列表、AI 配置、内容审核和产品事实长表单执行：

- [x] 375px：单列页头、44px 主要操作、TableRegion 局部滚动、章节导航可触控。
- [x] 768px：工具栏换行、单列审核区、粘性区不遮挡。
- [x] 1024px：集合列可扫描，审核双主列加全宽决策区。
- [x] 1440px：审核 `5:4:3` 三栏，集合页主要数据表面完整。
- [x] 浅色、深色、`system`：边框、焦点、状态、粘性表面同等级可辨识。
- [x] 200% 缩放：无页面横向溢出，主要操作、返回和章节导航仍可达。
- [x] 键盘：DOM 顺序未重排，原生章节链接和行操作均有可访问名称；单测、E2E 和浏览器语义快照可定位这些控件。
- [x] 浏览器返回：从 AI 渠道和业务详情返回集合页，URL 与页面状态没有第二来源。

真实浏览器覆盖 5 个代表页面 × 4 个视口 × 浅/深主题，共 40 个状态；`system`、减少动态效果和禁用模糊由 `theme.spec.ts` 覆盖。四档视口均无页面级横向溢出，审核网格依次为单列、单列、双列加全宽决策区、`5:4:3` 三列，AI 宽表保持局部滚动。浏览器检查发现并修正产品事实锚点偏移和移动页头主操作高度；1440px 的 200% 等效 720 CSS px 复查中，产品列表和长表单无页面溢出，主操作 44px，长表单无死锚点且保存操作可达。

## 7. 差异审计与完成门禁

- [x] `git diff -- contracts backend deploy frontend/package.json frontend/package-lock.json frontend/src/app/theme.ts frontend/src/app/AppLayout.tsx` 不包含未计划变化。
- [x] 检查 diff 没有字段、操作、路由、权限、API、query key、mutation 或状态转换变化。
- [x] 检查旧渠道卡片网格和嵌套审核布局已删除，没有双实现、隐藏 fallback 或页面构建器。
- [x] 检查普通业务表面未新增 `backdrop-filter`，没有硬编码主题颜色或第二套断点系统。
- [x] 对照 PRD AC1–AC10 记录证据，并运行 `trellis-check`。
- [x] 向用户汇报修改、验证、文档更新和剩余风险；提交前给出精确文件与提交信息计划，获得确认后才提交到主工作目录 `main`，不自动推送。
