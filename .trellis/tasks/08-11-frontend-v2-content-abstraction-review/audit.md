# Frontend V2 Content Abstraction Review — Audit Ledger

## 1. 审查基线与提交范围

### 基线

- 审查日期：2026-08-11。
- 代码基线：主工作目录位于 `main`；审计开始前工作树干净，`main` 相对 `origin/main` ahead 76。未执行 pull、未创建分支、未运行 `task.py start`。
- Trellis 状态：已创建 `.trellis/tasks/08-11-frontend-v2-content-abstraction-review`，状态为 `planning`。
- 规范基线：根 `AGENTS.md`、`frontend-v2/AGENTS.md`、Frontend V2 文档 04/05/06/07/08/09、`.trellis/spec/frontend/` 的 architecture/state/testing/UI 相关规范。
- 历史交付基线：已复核 Phase 3 已归档的 Task List、New Task、Task Detail、Editor Core、AI Production、Review、Version readonly Detail、Content E2E 的 `prd.md`、`design.md`、`implement.md` 与交付/验证结果。
- 当前状态文档：`docs/frontend-v2/07-migration-plan.md:356-381` 记录 Phase 3 只剩本次 vertical slice 抽象回顾。

### 批准后的最小提交范围

- 允许：四个 Content route 的相同意外错误边界改用一个纯 UI Pattern；Content Detail/Review 内两个无意义 `StatusBadge` 转发包装就地删除；对应最小测试；Phase 3 状态文档；本 Task 审计/计划/结果。
- 不允许：Product domain 跟随式清理、跨 domain 批量替换、公共合同或服务端变更、目录重排、新依赖、业务能力扩张。
- 实现文件数量上限：9 个（Trellis 任务产物不计入该上限）；超过即停止并重新申请规划批准。

## 2. 固定检查结果

| # | 检查 | 结论 | 关键证据 |
| --- | --- | --- | --- |
| 1 | 第二份相同交互、状态映射或错误处理 | **发现 1 组真实重复**：四个 Content route 的意外错误 UI 仅标题不同 | `src/routes/_app/content/tasks/$taskId.tsx:39-46`、`$taskId_.editor.tsx:28-35`、`$taskId_.review.tsx:28-35`、`content/versions_.$versionId.tsx:27-34` |
| 2 | 通用 UI 误留在 Content domain | route 错误 UI 是通用交互，应提升；页面级 business failure、Metadata/EmptyValue 尚无稳定统一 API | 同上；`content-review-page.tsx:544-579`、`content-task-detail-page.tsx:387-448` |
| 3 | Design System 混入 Content token/权限/状态机/DTO | **未发现** | `src/design-system/` 只依赖自身 primitives/types；审计搜索未发现从 `@/domains/content` 或 generated Content DTO 的反向 import |
| 4 | 万能 DataTable/Editor/Review/Detail/Workflow/API abstraction | **未发现** | `content.api.ts:45-76` 为 Content 唯一 query-key owner；Editor/Review/Version 保持各自 read model；ADR-026/027 明确禁止通用框架（`09-architecture-decisions.md:135-151`） |
| 5 | route 仅负责 search/loader/prefetch/composition | 除重复通用错误 UI 外保持成立 | 四个 route 的 loader 只构造 query options、条件 prefetch 并组合 domain page；业务逻辑不在 route |
| 6 | Query/Router/RHF/Table/local state 所有权 | **清晰** | Query 管服务端缓存/canonical refetch；Router 管 URL/loader；RHF 管表单输入；Table 接收服务端分页投影；local state 仅管 Dialog、announcement、pending、stale UI |
| 7 | `content.api.ts`、query keys、action registry 唯一 owner | **成立** | `content.api.ts:45-76`；`content-task-actions.ts:17-195`；全仓搜索未发现第二组 Content query key/action registry |
| 8 | 页面按 status 推导资格 | **未发现** | Detail 在 `content-task-detail-page.tsx:79-84` 从 projection 解析动作，status 仅生成 readonly/display；Review 合同要求 `available_actions`（`.trellis/spec/frontend/state-management.md:400-418`） |
| 9 | 客户端 join、waterfall、兼容 fallback、第二 DTO、静默默认 | **未发现业务违例** | 各页首屏使用唯一专用 read model；fixture 对未声明 API 返回 501 并在 teardown 断言（`tests/e2e/fixtures/content.fixture.ts:1012-1034,1813-1815,1913-1914`）；`ReviewRecord.action` 未知值显示原 token，不伪造已知语义（`content-version.model.ts:19-25`） |
| 10 | `current_content_version_id` 是主线唯一权威 | **成立** | Editor/Review spec 以该指针为唯一权威（`.trellis/spec/frontend/state-management.md:166-172,400-406`）；real-stack Flow A/B 直接断言指针与版本链（`tests/e2e/content-review-real-stack.spec.ts:218-274` 起） |
| 11 | ContentVersion/ReviewRecord/Generation snapshot 不可变 | **成立** | Content full Flow 对批准前后 payload 与目标记录做等值/归属断言；独立 Version Detail 无写入口且只发 GET（`tests/e2e/content-version-detail-real-stack.spec.ts:131-169`） |
| 12 | component/fixture/real-stack 重复证明 | **未发现可删除测试** | component 证明 view-model/交互，fixture 证明异常/响应式/请求拓扑，real-stack 证明真实 PostgreSQL/CSRF/不可变链；`08-testing-quality-and-acceptance.md:170-180,194-207` 明确分工 |
| 13 | `route → domain → design-system/shared` | **成立** | 审计搜索未发现 design-system/shared 反向 import route/domain；Content domain 不 import route 或其他 domain |
| 14 | 至少两个真实消费者验证、值得提升的 Pattern | **有 1 个**：route 意外错误 UI 已有四个 Content 消费者，结构、可访问性和 retry 行为相同 | 四个 route 上述行号；现有 Design System 无同类 Pattern |
| 15 | 删除/局部简化优先于新增抽象 | **成立** | 两个 `StatusBadge` 只转发 label/tone，计划直接内联并删除；Metadata/EmptyValue 不新建抽象 |

## 3. Ownership Matrix

| Concern | 当前 owner | 推荐 owner | 判定 |
| --- | --- | --- | --- |
| route params/search/head/loader/prefetch/composition | `src/routes/_app/content/**` | 不变 | route 不拥有业务资格、DTO 变换或错误码解释 |
| route unexpected error 的通用视觉、`role=alert`、retry | 四个 Content route 各自复制 | `design-system/workspace/route-error.tsx` | 提升一个最小纯 UI Pattern；标题仍由 route 提供 |
| Content endpoint、API error envelope、query options/keys | `domains/content/content.api.ts` | 不变 | 唯一 owner，不拆 API layer、不建 server-list hook |
| Content primary/overflow action token 映射 | `domains/content/content-task-actions.ts` | 不变 | Content 业务所有权，不进入 Design System/shared |
| Content status/time/review timeline 映射 | Content `*.model.ts` | 不变 | 业务展示映射，不建立跨 domain registry |
| server state / canonical response | TanStack Query + Content API/model | 不变 | mutation 后按既有 projection 更新/失效，不在 local state 复制 DTO |
| URL state / direct navigation | TanStack Router route/search schema | 不变 | 列表筛选和 handoff 由 URL owner 管理 |
| form state / validation | RHF + Content form model | 不变 | 不把 server state 或 workflow 放入 RHF |
| table state | 服务端分页/筛选 projection + TanStack Table view | 不变 | 不建立万能 DataTable 或客户端业务 join |
| transient UI state | 各 page/component local state | 不变 | 仅 Dialog、focus、pending、announcement、stale 等短生命周期状态 |
| generic primitives/workspace layout | `design-system/` | 不变 | 不接收 Content DTO、权限、action token 或状态机 |
| generated DTO | `shared/api/generated/schema.d.ts`（OpenAPI 生成） | 不变 | 本任务不改生成文件，不创建第二 DTO |
| fixture request boundary | `tests/e2e/fixtures/content.fixture.ts` | 不变 | 单一 generated-type Content fixture，未知 API 明确失败 |
| real-stack orchestration | `deploy/scripts/e2e-local.sh` + 专项 spec | 不变 | 本任务不改；复用已归档真实栈证据 |

## 4. Findings Ledger

### Keep in Content Domain

#### KCD-01 — Content API、query keys 与 action registry 保持唯一 owner

- severity: `INFO`
- file:line: `frontend-v2/src/domains/content/content.api.ts:45-76`；`frontend-v2/src/domains/content/content-task-actions.ts:17-195`
- evidence: 所有 Content query key 位于 `contentKeys`；List/Detail 共用的 primary/overflow 映射集中在 `content-task-actions.ts`，并对合同 token 穷尽处理。
- impact: 保留该边界可避免第二缓存命名体系、动作资格漂移及跨 domain workflow registry。
- current owner: Content domain。
- recommended owner: Content domain，不变。
- decision: `Keep in Content Domain`。
- proposed change: 无。
- validation: typecheck；现有 action/model/component 测试；搜索不得出现第二个 `['content', ...]` key owner。
- defer trigger: 只有另一个真实 domain 出现相同服务端合同与相同语义，且合同 owner 明确统一时才重新评估；仅 token 同名不触发。

#### KCD-02 — 页面错误分类与字段映射不抽成通用 API abstraction

- severity: `INFO`
- file:line: `frontend-v2/src/domains/content/content.api.ts:447-488`；`frontend-v2/src/domains/content/content-editor.model.ts:143-183`；`frontend-v2/src/domains/content/content-review.model.ts:27-59`
- evidence: 三处都读取结构化错误，但允许字段、冲突语义和输出目标分别属于 create/editor/review 表单，不是同一业务映射。
- impact: 强行合并会引入泛型字段 registry 或丢失 surface-specific UX，形成第二错误合同。
- current owner: 各 Content surface model/API 边界。
- recommended owner: 各 Content surface，保留现状。
- decision: `Keep in Content Domain`。
- proposed change: 无；不创建跨 domain error registry。
- validation: 既有 create/editor/review error component tests。
- defer trigger: shared API client 提供一个与业务字段无关、被至少两个 domain 使用的稳定 envelope parser，且能删除更多代码而不改变错误语义。

#### KCD-03 — fixture、component 与 real-stack 是互补证明，不删除专项测试

- severity: `INFO`
- file:line: `docs/frontend-v2/08-testing-quality-and-acceptance.md:170-180,194-207`；`frontend-v2/tests/e2e/content-version-detail-real-stack.spec.ts:131-169`
- evidence: fixture 覆盖 loading/404/响应式/键盘和未声明 API；real-stack 覆盖真实 PostgreSQL/CSRF/current pointer/不可变链；Version Detail 独立 spec 额外证明单一 detail GET、无上下文 waterfall、无写入口。
- impact: 删除独立 real-stack 或把异常矩阵搬进真实栈都会降低边界证明或显著增加运行成本。
- current owner: component tests、`content.fixture.ts`、专项 real-stack specs。
- recommended owner: 分层保持不变。
- decision: `Keep in Content Domain`。
- proposed change: 无测试删除。
- validation: 实施 diff 不触碰 real-stack/fixture；targeted fixture Playwright 通过。
- defer trigger: 同一 invariant 已由同层另一个测试以相同数据边界和相同失败模式完整证明，且删除后测试矩阵无缺口。

### Keep in Design System/shared

#### KDS-01 — Design System 保持纯 UI 与交互所有权

- severity: `INFO`
- file:line: `frontend-v2/src/design-system/editor/markdown-editor.tsx:1-230`；`frontend-v2/src/design-system/workspace/workspace-shell.tsx:1-108`
- evidence: MarkdownEditor/Workspace 接收 generic props，不导入 Content DTO、action token、权限或状态机；全目录反向依赖搜索为零。
- impact: 保持此边界可复用于 Product/Content，同时避免 Design System 成为业务 workflow owner。
- current owner: Design System。
- recommended owner: Design System，不变。
- decision: `Keep in Design System/shared`。
- proposed change: 新 route error Pattern 也只接收 `title`、`Error` 与 retry callback，不接受 Content 类型。
- validation: typecheck；ESLint；依赖方向搜索；Design System component test。
- defer trigger: 无；若未来需要业务 token/权限 prop，应拒绝提升并留在 domain。

### Simplify locally

#### SL-01 — 删除两个只转发参数的 `StatusBadge` wrapper

- severity: `LOW`
- file:line: `frontend-v2/src/domains/content/content-task-detail-page.tsx:130-147,437-445`；`frontend-v2/src/domains/content/content-review-page.tsx:227-228,577-579`
- evidence: wrapper 只执行 `<Badge variant={tone}>{label}</Badge>`，没有语义、可访问性、状态或测试边界；真实映射已由 Content registry 拥有。
- impact: 多一个无价值符号与重复类型，暗示不存在的抽象边界。
- current owner: Content Detail/Review page-local helper。
- recommended owner: 调用点直接使用 Design System `Badge`；业务 registry 仍留 Content model。
- decision: `Simplify locally`。
- proposed change: 内联现有 `Badge` 调用并删除两个 helper/不再需要的 type import；不新增共享 `StatusBadge`。
- validation: `content-task-detail-page.test.tsx`、`content-review-page.test.tsx`、typecheck。
- defer trigger: 不适用；若未来需要统一可访问性或结构行为，应以真实消费者重新审计，不恢复单纯转发 wrapper。

### Promote only after proven consumers

#### PAP-01 — Metadata/EmptyValue 暂不提升

- severity: `INFO`
- file:line: `frontend-v2/src/domains/content/content-task-detail-page.tsx:416-448`；`frontend-v2/src/domains/content/content-review-page.tsx:568-574`；`frontend-v2/src/domains/content/content-version-detail-page.tsx:381-403`
- evidence: 名称相同但布局至少有 grid metadata、左右对齐 metadata、可选 className/mono 等不同约束；EmptyValue 也存在固定值与 children override 两种语义。
- impact: 现在提升会产生 options-heavy 通用组件，调用代码不更短，且会把偶然页面布局固化。
- current owner: 各 Content page-local presentation helper。
- recommended owner: 当前 page-local owner。
- decision: `Promote only after proven consumers`；当前**无需提升**。
- proposed change: 无。
- validation: 无代码变更；自审确认未新增 Metadata/Detail/Version framework。
- defer trigger: 至少两个真实页面出现完全相同 DOM、样式、可访问性和 props，且共享后能净删除代码而无需布局开关。

### Confirmed defects requiring change

#### CDR-01 — 四个 Content route 复制同一意外错误 UI

- severity: `LOW`
- file:line: `frontend-v2/src/routes/_app/content/tasks/$taskId.tsx:39-46`；`frontend-v2/src/routes/_app/content/tasks/$taskId_.editor.tsx:28-35`；`frontend-v2/src/routes/_app/content/tasks/$taskId_.review.tsx:28-35`；`frontend-v2/src/routes/_app/content/versions_.$versionId.tsx:27-34`
- evidence: 四段 JSX 的容器、`role="alert"`、错误 message 和 retry 按钮完全相同，仅标题不同；Design System 尚无同类组件。
- impact: 相同交互和可访问性以后会在多个 route 漂移；route 同时拥有了可复用视觉细节。
- current owner: 四个 Content route。
- recommended owner: `design-system/workspace/route-error.tsx` 管纯 UI；route 只提供标题、错误和 reset callback。
- decision: `Confirmed defects requiring change`；这是本任务唯一提升的 Pattern。
- proposed change: 新增一个最小 `RouteError` 组件，替换四段重复 JSX；不处理 Product routes，不增加 registry/factory/config，不新增依赖。
- validation: 在现有 `workspace-kit.test.tsx` 增加 render/message/retry/alert 的最小测试；四个 Content fixture Playwright；typecheck/lint/build。
- defer trigger: 不适用；若实现需要跨 domain 批量修改或超过文件上限，停止并拆独立 Task。

### Deferred product/UX decisions

#### DUX-01 — Content History 与 Phase 4 handoff 不在本审计补齐

- severity: `INFO`
- file:line: `docs/frontend-v2/07-migration-plan.md:377-387`；`frontend-v2/src/domains/content/content-task-actions.ts:45-56`
- evidence: 当前 Content Review/Version Detail 明确把 Content History 留到后续；`START_PUBLICATION`/`CONTINUE_PUBLICATION` 是服务端 projection 的既定 handoff，不代表 Phase 3 应实现 Publishing surface。
- impact: 在本任务补 route/read model 会触发用户明确的停止条件，并把 Phase 4 产品/UX 决策夹带进抽象回顾。
- current owner: Phase 4/后续独立 Task。
- recommended owner: 对应后续 vertical slice。
- decision: `Deferred product/UX decisions`。
- proposed change: 无；只在 gate 报告注明非 Phase 3 blocker。
- validation: 自审确认没有新增 route、占位页面或 fallback link。
- defer trigger: 启动 Content History 或 Phase 4 Publishing 的正式 Task，并取得各自 PRD/合同批准。

## 5. 可删除的重复代码/测试

### 批准后删除

1. 四个 Content route 中共四份 `*UnexpectedError` JSX 与四个直接 `Button` import；由一个纯 UI `RouteError` Pattern 代替。
2. `content-task-detail-page.tsx` 与 `content-review-page.tsx` 的两个 `StatusBadge` 只转发 wrapper。

### 不删除

- 不删除 component、fixture Playwright 或 real-stack spec：三层证明不同 failure mode。
- 不拆分 1932 行 `content.fixture.ts`：文件长度不是抽象证据，当前它是单一 Content fixture owner，并对未知 API 明确失败。
- 不合并 page-specific failure/refresh failure：初始无数据错误与 mutation 后 canonical context 刷新失败有不同恢复语义。

## 6. 明确保留在 Content Domain 的实现

- `content.api.ts` 的 endpoint/query options/query keys/API error owner。
- `content-task-actions.ts` 的 primary/overflow 映射与 lifecycle command 语义。
- Content status/workflow/review timeline/time/error 映射。
- Editor/AI/Review 的 surface-specific mutation、canonical refetch、conflict、Dialog/focus 与 local UI state。
- current pointer、version/source/status 的只读展示逻辑。
- Content fixture、专项 component/Playwright/real-stack 测试。

## 7. 值得提升的 Pattern

- **值得提升且已证明**：`RouteError` 纯 UI Pattern；四个真实 Content route 已验证相同 DOM、错误 message、`role=alert` 和 retry 行为。
- **无需提升**：Metadata、EmptyValue、Content status/action/error registry、Editor/Review/Version Detail、fixture helper、server-list hook。

## 8. Phase 3 Exit Gate 判定基线

Phase 3 只有同时满足以下条件才判为 `MET`：

1. CDR-01 与 SL-01 按批准设计完成，或用户明确批准 no-code 结论。
2. 其他 findings 保持原 owner，所有 defer 项有 owner 与触发条件，且没有未记录的 P0/P1/P2 blocker。
3. required validation、`trellis-check` 与实现后自审通过。
4. 实现 diff 未触及业务合同、query/action/current-pointer/immutability 边界；已归档 real-stack 证据因此仍有效。
5. `docs/frontend-v2/07-migration-plan.md` 与最终实现、测试和 gate 结论一致。

任一条件失败则判为 `NOT_MET`，列出 blocker；不得用 fallback、扩大测试阈值或夹带 Phase 4 工作改判。

## 9. 实施与验证结果

### 已实施

- CDR-01：新增纯 UI `RouteError`，四个 Content route 保留原标题与 retry callback，删除四份重复 JSX。
- SL-01：Content Task Detail 与 Content Review 直接消费既有 `Badge`，删除两个只转发参数的 `StatusBadge` helper。
- 实现范围为 9 个代码/测试/权威状态文档文件，未超过批准上限；未修改 Product、backend、contract、generated、deployment 或 Phase 4 文件。

### 验证证据

| 检查 | 结果 |
| --- | --- |
| targeted component | `3 files / 25 tests passed` |
| V2 typecheck | 通过 |
| V2 lint | 通过 |
| V2 production build | 通过；仅有既有 Markdown Editor 大 chunk 警告 |
| Content fixture Playwright | `38 passed` |
| `make verify` contract/API/backend/V1 | contract/API check、ruff、mypy、lint/typecheck、backend unit `176 passed`、V1 unit `203 passed`、visual contract `24 passed` |
| `make verify` V2 unit/component | `232 passed / 1 failed`；失败为 `src/app/layout/app-shell.test.tsx:70-79` 未 mock Product Detail loader API |
| `git diff --check` | 通过 |
| Trellis scope check | 依赖方向、复用边界、文件上限、禁止模式与相关测试通过 |

### Spec 更新判断

无需修改 `.trellis/spec/`：本次没有新增 API、数据、状态、权限或跨层合同；`component-guidelines.md:19,58-59,89` 已规定共享组件只承载稳定展示边界、业务恢复路径留在 feature owner、不得建立只转发的通用组件。`RouteError` 只是该既有约束的第四个真实消费者收敛结果，签名与本次提升证据已由组件代码、测试和本 Task 台账持有；再次写入 spec 会复制同一规则并突破批准的 9 文件上限。

### 失败归因与停止条件

- 同一 AppShell/Product Detail 测试失败已记录于归档 Task：`08-10-frontend-v2-content-task-list/implementation-results.md:36` 与 `08-10-frontend-v2-content-editor/implement.md:21`。
- 本 Task diff 不包含 `src/app/layout/app-shell.test.tsx`、Product route、Product API 或 Product domain；targeted Content/Design System 和四 route Playwright 全绿，未发现本次改动导致该失败的路径。
- 修复需要进入 Product/AppShell 测试所有权，超出批准文件白名单并触发跨 domain 停止条件。建议独立 Task：`frontend-v2-app-shell-product-detail-loader-test`。
- 按“同一失败在没有新证据时不得重复”规则，不重跑、不在本 Task 修改该测试。

### 最终 Phase 3 Gate

**`NOT_MET`**。本 Task 的 CDR-01、SL-01 和全部相关验证已完成，但批准的退出算法要求 required `make verify` 全部通过；上述既有 Product/AppShell 测试缺口关闭前不能宣称 Phase 3 全绿。其余 Content architecture、contract、UX、real-stack、文档条件均无 blocker。
