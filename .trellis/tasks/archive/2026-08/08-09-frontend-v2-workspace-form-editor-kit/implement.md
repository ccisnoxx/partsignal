# 实施计划

## 精确文件范围

计划新增：

- `frontend-v2/src/design-system/workspace/workspace-shell.tsx`：导出 `WorkspaceShell`、`WorkspacePane`、`WorkspaceTabs`。
- `frontend-v2/src/design-system/workspace/sticky-action-bar.tsx`
- `frontend-v2/src/design-system/workspace/detail-section.tsx`
- `frontend-v2/src/design-system/workspace/timeline.tsx`
- `frontend-v2/src/design-system/workspace/workspace-kit.stories.tsx`
- `frontend-v2/src/design-system/workspace/workspace-kit.test.tsx`
- `frontend-v2/src/design-system/forms/form-field.tsx`
- `frontend-v2/src/design-system/forms/form-layout.tsx`：导出 `FormSection`、`FormActions`、`ErrorSummary`。
- `frontend-v2/src/design-system/forms/dirty-guard.tsx`
- `frontend-v2/src/design-system/forms/form-kit.stories.tsx`
- `frontend-v2/src/design-system/forms/form-kit.test.tsx`
- `frontend-v2/src/design-system/editor/markdown-editor.tsx`：导出 `MarkdownEditor`、`MarkdownPreview`。
- `frontend-v2/src/design-system/editor/markdown-editor.stories.tsx`
- `frontend-v2/src/design-system/editor/markdown-editor.test.tsx`

计划修改：

- `frontend-v2/package.json`
- `frontend-v2/package-lock.json`
- `.trellis/tasks/08-09-frontend-v2-workspace-form-editor-kit/{task.json,prd.md,design.md,implement.md}`

明确不修改 `frontend-v2/src/app/router.ts`、routes、domains、`global.css`、现有 data-table、OpenAPI generated types、Storybook/Vitest 配置或旧 `frontend/`。不创建 barrel、demo route、全局 store、通用 action registry、diff 文件或 Playwright Test。

## 最小组件 API 与职责边界

- `WorkspaceShell`：固定 `main/context/reference` slots 和 `ariaLabel`；不接收 domain data/status。
- `WorkspacePane`：`area`、`label`、`children`。
- `WorkspaceTabs`：固定三槽窄屏降级，Main-first。
- `StickyActionBar`：`status?` 与 `StickyAction[]`；只执行 resolved callback。
- `DetailSection`：`title/description/actions/children`。
- `Timeline`：domain-neutral timeline items。
- `FormField<T>`：RHF `name/label/description/id?/render`；可选 `id` 只用于 ErrorSummary 焦点目标，不定义 schema。
- `FormSection`、`FormActions`、`ErrorSummary`：布局与可访问性，不解析 API error。
- `DirtyGuard`：`when` 与可选文案；只桥接 TanStack Router blocker。
- `MarkdownEditor`：受控 Markdown、Edit/Preview、dirty/readonly/revision/conflict display。
- `MarkdownPreview`：安全 React Markdown renderer。

未来 Product domain 负责 Zod schema、OpenAPI DTO 映射、resolved actions、mutation、服务端错误映射、canonical reset 和 reload。Server 继续负责权限、revision、action eligibility 与状态转换。

## 批准依赖

- `react-hook-form@^7.85.0`
- `@hookform/resolvers@^5.7.1`
- `codemirror@^6.0.2`
- `@codemirror/lang-markdown@^6.5.2`
- `react-markdown@^10.1.0`
- `rehype-sanitize@^6.0.0`

不安装 `remark-gfm`、`rehype-raw`、DOMPurify、diff、autosave、state 或 editor plugin 依赖。

## 实施顺序

1. 确认已在 `codex/frontend-v2-workspace-form-editor-kit`，三份文档获批后运行 `task.py start`。
2. 使用 `trellis-before-dev` 读取 task 文档与适用 frontend specs。
3. 安装上述六个依赖，只接受 npm 对 package/lock 的预期修改。
4. 实现固定三槽 Workspace、响应式 tabs、Detail/Timeline，再实现 StickyActionBar resolved-action contract。
5. 实现 RHF FormField/layout/error summary，再实现不依赖 router singleton 的 DirtyGuard。
6. 实现 CodeMirror wrapper、Edit/Preview、安全 MarkdownPreview、统计与 readonly/dirty/revision/conflict UI。
7. 补齐 component tests 与 Storybook 场景，不接入业务 route/API。
8. 运行必需验证；完成命名浏览器 QA 并关闭 session。
9. 执行 `trellis-check`、spec 更新必要性评估、最终 diff 与禁止范围审计。
10. 报告结果和 commit plan，等待用户确认；不得 commit、merge、push、archive 或开始 Phase 1.6。

## Storybook 场景矩阵

| Story | 组件组 | 核心证据 |
|---|---|---|
| Default Workspace | Workspace | 1440 三栏、Main 最大、Detail/Timeline/sticky actions |
| Loading Artifact | Workspace | Shell/context/reference 保留，Main Skeleton |
| Empty Reference | Workspace | Reference 明确空态 |
| Error + Retry | Workspace | Main error、retry 可聚焦、Shell 保留 |
| Long Markdown | Editor | 编辑、预览、滚动、字符/行统计 |
| Dirty Form | Form | dirty 状态与 Router 离开 Dialog |
| Validation Errors | Form | Zod field/root errors、summary、ARIA |
| Revision Conflict | Editor/Workspace | 明确并发文案、revision、reload |
| Readonly Review Snapshot | Editor/Workspace | 清晰只读语义、不可编辑 |
| Disabled Submit | Workspace/Form | disabled reason 可见且不执行 |
| Destructive Action | Workspace | 确认前不执行、focus trap/return |
| Mobile 375 | Workspace | Main-first tabs，侧栏可达，sticky 不遮挡 |
| Tablet 768 | Workspace | tabs 降级、长内容/action bar 稳定 |
| Desktop 1024/1440 | Workspace | 1024 无页面溢出；1440 固定三栏 |

## Component Test 矩阵

- Workspace：三槽语义、optional pane、Main-first tabs、键盘切 tab、loading/error 时保留 shell。
- Sticky Action Bar：resolved callback、disabled reason、danger confirmation、确认前不执行、focus return、safe-area class。
- Detail/Timeline：heading/section/list 语义、空 timeline、长文本。
- Form：RHF + Zod 成功提交、客户端错误、`setError` field/root server error、ARIA、ErrorSummary 聚焦。
- DirtyGuard：clean 不拦截；dirty navigation blocked；取消保留、确认继续；beforeunload 条件启用；reset 后不拦截。
- Editor：受控值、输入回调、Edit/Preview、Unicode 字符数/行数、dirty/revision。
- Preview：raw HTML、script/event handler、`javascript:`、图片被阻断；基础 CommonMark 正常。
- Readonly/conflict：readonly 不触发 change；conflict reload 调用回调。
- Mod-F、undo/redo、selection、focus 和真实布局由浏览器验证，不为 jsdom 编写内部实现断言。

## 必需验证

```bash
npm --prefix frontend-v2 run test -- src/design-system/workspace/workspace-kit.test.tsx src/design-system/forms/form-kit.test.tsx src/design-system/editor/markdown-editor.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run build-storybook
git diff --check
git diff --exit-code main -- frontend backend contracts docs Makefile .github deploy
```

最后一条只验证明确禁止范围无变化；`frontend-v2/` 与当前 Trellis task 文件允许存在预期 diff。

## 可选完整验证

```bash
npm --prefix frontend-v2 run api:check
make contract-check
make verify
```

默认跳过，因为本 Task 不改 API、后端、旧前端、共享质量入口、CI 或部署；仅在失败证据指向共享 contract/门禁时运行。

## `playwright-cli` 视觉验证

唯一 session：`frontend-v2-workspace-form-editor-kit`。

1. 启动 Storybook，以该 session 打开 `http://127.0.0.1:6006`。
2. 检查全部 stories，resize 至 375、768、1024、1440。
3. 验证 1440 三栏、1024 tabs、document root 无横向溢出、Main 最大、长 Markdown 可滚动、Sticky Action Bar 不遮挡正文。
4. 仅键盘验证 tabs、form focus/error summary、DirtyGuard Dialog、danger confirmation、CodeMirror 输入、Mod-F、undo/redo、Edit/Preview 与 focus return。
5. 检查 malicious Markdown 的 DOM、浏览器 console 与 Storybook a11y 结果。
6. 执行 `playwright-cli -s=frontend-v2-workspace-form-editor-kit close`，再用 `playwright-cli list --all --json` 确认 session 不再 open；不得使用 `close-all` 或 `kill-all`。

## 失败归因和停止条件

- 每个失败先证明由当前 diff 引入且属于本 Task；代码、配置或环境无相关变化时不重复运行同一失败命令。
- 依赖 peer/API 不兼容时停止，不加 adapter、第二套 editor/form/Markdown 库或猜测性兼容层。
- 如果必须修改 router singleton、生产 route、domain、OpenAPI、旧前端或新增业务 schema/action token，停止并等待范围决定。
- Preview 无法证明 raw HTML、危险 URL 和图片被阻断时停止交付。
- 1024/375 需要任意 pane 配置、运行时 layout engine 或重复维护 desktop/mobile 业务状态时停止，并只提出最小拆分建议。
- Fact Review Diff 仍无比较源和 contract 时继续延后，不做占位实现。
- 浏览器 session 无法正常关闭时报告并停止；未经用户确认不得全局 kill。
- 最终 diff 出现后端、contracts、旧前端、CI、部署、生产 route 或 domain 文件时停止交付并移除越界改动。

## 回滚点

依次保留四个可审计边界：依赖/lock；Workspace；Form/DirtyGuard；Editor/Preview/Stories/Tests。只反向撤销当前 Task 所有文件，不 reset、回退或覆盖用户改动。

## 明确非目标

- Product Facts 业务页面或真实 API 接入。
- domain schema、action registry、server token mapping。
- autosave、协作、上传、WYSIWYG、富文本、Split、Diff、workflow engine。
- Content/GEO 预留变体。
- 修改旧 `frontend/`、后端、OpenAPI、数据库、CI、部署或稳定 Playwright E2E。
- commit、merge、push、archive 或 Phase 1.6。

## 完成门禁

- `prd.md`、`design.md`、`implement.md` 已获用户批准，task status 为 `in_progress`。
- 所有验收项具有 component test、Storybook 或真实浏览器证据。
- 必需验证全部通过，范围审计无越界文件。
- `frontend-v2-workspace-form-editor-kit` browser session 已关闭且无遗留。
- 完成 `trellis-check`、spec 更新必要性评估和最终 diff 审计。
- 仅报告 commit plan，等待用户确认。
