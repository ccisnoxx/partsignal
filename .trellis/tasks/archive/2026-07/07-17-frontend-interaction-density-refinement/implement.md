# 实施计划

## 0. 启动门禁

- [x] 用户评审并明确批准 `prd.md`、`design.md`、`implement.md` 后，才运行 `python3 ./.trellis/scripts/task.py start 07-17-frontend-interaction-density-refinement`。
- [x] 在主工作目录 `/Users/sc/PycharmProjects/partsignal` 确认分支为 `main` 且除本任务目录外没有未识别修改；不创建开发分支。
- [x] 运行 `trellis-before-dev`，完整读取本任务三份文档、frontend spec 与共享复用指南。
- [x] 本任务使用 Codex inline 流程，不整理 `implement.jsonl` / `check.jsonl`，不派发实现或检查子 Agent。
- [x] 不修改后端、契约、数据库、部署、运行时依赖、路由表、权限和服务端状态转换。

## 1. 建立基线与清单

- [x] 记录以下基线，现有失败先报告，不用 UI 变更掩盖：

  ```bash
  cd /Users/sc/PycharmProjects/partsignal/frontend
  npm run api:check
  npm run lint
  npm run typecheck
  npm test
  npm run build
  ```

- [x] 搜索所有高密度 Table 操作列、`QueryFailure`/`NoData`、`.form-section-nav`、`.form-save-bar`、长期保存 mutation 与集合页视图状态调用方，确认最终触及清单。
- [x] 用真实浏览器记录产品列表、产品事实、内容任务、内容审核、AI 配置和工作台当前行为；复用本任务开始前的审计结论，不创建或提交截图基线。

## 2. P0：表格操作与扫读

- [x] 在产品、AI 渠道、平台类型、平台账号和事实版本等有危险行操作的表格中保留一个可见主入口，将删除/停用移入中文可访问的更多菜单。
- [x] 复用现有权限、确认文案、加载状态、mutation 和服务端拒绝；菜单项不得绕过确认直接执行。
- [x] 对产品、任务、发布、观测、用户、AI 渠道等长集合 Table 启用 Ant `sticky`，使用 72px 顶栏偏移；短子表不强制处理。
- [x] 在 `global.css` 增加 token 驱动的 `focus-within` 和更多触发器状态，不让整行进入 Tab 顺序，不增加硬编码颜色。
- [x] 保留 `TableRegion` 局部横向滚动、稳定列宽与长值完整提示。

定向验证：

```bash
npm test -- src/features/product-facts/ProductsPage.test.tsx src/features/configuration/ConfigurationPages.test.tsx
npm run lint
npm run typecheck
```

回滚点：若更多菜单破坏确认或焦点恢复，先回退该页操作列；不得临时保留菜单和旧危险按钮两套入口。

## 3. P0：章节与长表单状态

- [x] 新增最小 `useActiveSection` Hook，以原生 `IntersectionObserver` 返回当前章节；覆盖不支持观察器的稳定首章节行为。
- [x] 在产品事实、内容任务、内容审核和 AI 渠道详情接入当前章节，增加 `aria-current`，保持条件链接和目标同时渲染。
- [x] 为产品事实表单接入 Ant Form 实例，按字段首段记录 dirty/error section；不新增表单 Store 或 Context。
- [x] 增加错误摘要与首错定位，继续使用现有验证规则和 `scrollToFirstError`。
- [x] 保存条显示未修改、未保存、保存中、已保存、失败；保存成功后清理状态，再次编辑时重置成功提示。
- [x] 给动态对象增加序号标题，将删除移到标题行；不折叠、不重排字段，不改变提交载荷。

定向验证：

```bash
npm test -- src/features/product-facts/ProductFactsPage.test.tsx src/features/content-editor/ContentEditorPage.test.tsx src/features/configuration/ConfigurationPages.test.tsx
npm run lint
npm run typecheck
```

回滚点：若观察器或 sticky 状态影响锚点定位，先回退当前态逻辑，保留原生导航；不得引入滚动轮询或内部滚动容器。

## 4. P1：异步状态与成功反馈

- [x] 扩展 `QueryFailure` 的可选 actions 与 `NoData` 的 ReactNode/action，保留现有 API 和错误码/请求 ID 展示。
- [x] 内容任务只把任务身份查询作为整页门禁，将版本、作业、生成选项 loading/error 放回所属区块；保留现有 query key、retry 和 mutation。
- [x] 产品事实只让产品与草稿阻断工作区，版本查询错误留在版本 Tab；审核上下文继续留在 Modal。
- [x] 单查询详情的错误态补齐现有返回入口与页面上下文；不猜测业务恢复路径。
- [x] 使用现有 `App.useApp().message` 为长期保存、删除、启停和显式状态操作增加短成功反馈；简单创建且结果已立即可见时不重复提示。

定向验证：

```bash
npm test -- src/shared/components/AsyncState.test.tsx src/features/content-tasks/ContentTasksPage.test.tsx src/features/product-facts/ProductFactsPage.test.tsx
npm run lint
npm run typecheck
```

回滚点：若局部错误拆分导致未定义数据进入业务组件，收紧该区块的渲染门禁并显式显示错误；不得用空数组或默认对象伪造成功数据。

## 5. P1：URL 状态、焦点与双主题

- [x] 产品页接入 `q`/`page`，任务和观测接入 `page`，人工发布接入 `tab`/页码，用户页接入 `inactive`/`page`；使用页面现有 React Router API，不抽取全局 Hook。
- [x] 对查询参数做最小严格解析；无效值回到现有默认值，replace 修正 URL，前进/后退保持 UI 同步。
- [x] 在 `AppLayout` 主内容边界实现 pathname 变化后的无滚动焦点；查询参数变化不抢焦点。
- [x] 验证更多菜单和 Modal 关闭后的焦点恢复、章节导航键盘顺序、错误摘要和空态动作中文名称。
- [x] 实测浅/深主题关键文字、选中导航、边框、焦点、状态与 sticky 表面对比度；只有失败时才修改 `theme.ts` 语义 token。

定向验证：

```bash
npm test -- src/app/AppLayout.test.tsx src/features/product-facts/ProductsPage.test.tsx src/features/publications/PublicationsPage.test.tsx src/features/users/UserManagementPage.test.tsx
npm run lint
npm run typecheck
```

回滚点：若受控分页与现有查询冲突，先回退该页面 URL 同步并重新确认唯一状态拥有者；不得并存内部页码和 URL 页码。

## 6. P2：工作台指标权重

- [x] 只调整现有 `MetricTile` tone 映射：非零待办/异常提高语义强调，零值保持中性。
- [x] 不增加字段、文案口径、趋势、推测值、图表、依赖或 API 请求。
- [x] 更新工作台单测，验证零值与非零值的语义 tone，不断言具体颜色。

定向验证：

```bash
npm test -- src/features/dashboard/DashboardPage.test.tsx
```

## 7. 文档与功能测试

- [x] 更新相关单元测试，覆盖更多菜单确认、章节当前/错误/修改状态、保存状态、局部失败、URL 恢复、路由焦点和工作台 tone。
- [x] 在现有 E2E 数据流程中增加最小行为断言，不创建第二套种子、不恢复截图基线。
- [x] 更新 `frontend/README.md`，记录行操作层级、URL 视图状态、长表单状态、局部错误和双主题验收规则。
- [x] 对触及的 TSX/TS 文件执行中文注释、JSDoc 和开发者可见文本检查；不添加机械注释。

## 8. 完整验证

### 8.1 自动检查

```bash
cd /Users/sc/PycharmProjects/partsignal/frontend
npm run api:check
npm run lint
npm run typecheck
npm test
npm run build
```

本地 E2E 栈可用时运行：

```bash
npx playwright test tests/e2e/mvp-flow.spec.ts tests/e2e/theme.spec.ts
```

启动服务器不算通过；若 E2E 依赖不可用，记录具体阻塞和替代检查。

### 8.2 浏览器验收

- [x] 375px：单列页头、更多菜单、表格局部滚动、章节导航、保存条和错误摘要可达。
- [x] 768px：sticky 表头/工具条不遮挡，长表单和审核区保持单列业务顺序。
- [x] 1024px：集合列可扫描，内容审核保持既有双主列加全宽决策区。
- [x] 1440px：高密度表格、长表单与既有 `5:4:3` 审核工作区完整。
- [x] 浅色、深色、`system`：文字、边框、焦点、当前章节、错误/修改/成功状态同等级可辨识。
- [x] 200% 缩放：无页面级横向溢出，更多菜单、返回、章节导航、错误摘要和保存操作可达。
- [x] 键盘：路由切换焦点、TableRegion、更多菜单、Modal、章节导航和首错定位顺序正确。
- [x] 状态恢复：搜索、Tab、分页、显示停用账号在刷新与浏览器前进/后退后保持一致。

## 9. 差异审计与完成门禁

- [x] `git diff -- contracts backend deploy frontend/package.json frontend/package-lock.json` 无变化。
- [x] 检查 diff 没有字段、操作权限、路由表、API、query key、mutation、状态转换或数据契约变化。
- [x] 检查没有新的表格/表单框架、Provider、全局 Store、通知系统、兼容分支、隐藏 fallback 或第二套渲染。
- [x] 检查普通业务表面未新增 `backdrop-filter`，主题颜色只来自 `theme.ts`。
- [x] 对照 PRD AC1–AC12 记录证据，并运行 `trellis-check`。
- [x] 向用户汇报修改、验证、文档更新和剩余风险；提交前给出精确文件与提交信息计划，获得确认后才提交到主工作目录 `main`，不自动推送。

## 10. 实施与验收记录（2026-07-17）

- 自动检查：`npm run api:check`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run build` 全部通过；全量单测为 17 个文件、54 个测试，构建仅保留既有的大 chunk 提示。
- E2E：通过 `deploy/scripts/e2e-local.sh tests/e2e/mvp-flow.spec.ts tests/e2e/theme.spec.ts` 启动真实本地栈，6 个测试全部通过；没有新增种子或截图基线。
- 响应式：真实浏览器覆盖 375/768/1024/1440px；宽表只在 `TableRegion` 内滚动，产品事实 sticky 导航/保存条与审核区既有单列、双列、`5:4:3` 布局均可达。
- 主题与对比度：浅色正文/次级文字对比度分别为 15.46/5.07，深色为 17.48/6.61；`system` 与当前媒体查询一致。浏览器验收发现并修复从显式深色切回 `system` 时沿用旧解析值的问题，已增加 `ThemeProvider` 回归测试。
- 200%：真实 Chrome 工具栏显示“缩放比例：200%”；产品列表没有页面级横向溢出，更多菜单可打开并恢复触发器焦点，产品事实章节导航、错误摘要、首错入口与保存按钮均可达。验收后刷新丢弃未保存输入并关闭测试窗口。
- 状态与键盘：实测产品搜索/分页、任务分页、GEO 分页、人工发布 Tab/分页、用户停用筛选/分页可由 URL 和浏览器历史恢复；路由主内容焦点、章节链接、更多菜单和 Modal 键盘链通过单测、E2E 与浏览器检查。
- 差异审计：后端、契约、数据库、部署、依赖、路由表、权限、query key、mutation、状态转换和字段契约均未变化；没有新增 Provider、Store、通知系统、兼容分支、硬编码主题颜色或第二套设计系统。
