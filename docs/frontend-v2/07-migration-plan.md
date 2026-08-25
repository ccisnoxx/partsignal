# PartSignal Frontend V2 总体实施路线与交付规则

> 状态：已确认的执行基线
>
> 基线日期：2026-08-07
>
> 适用范围：`frontend-v2/` 从初始化到替换 V1 的全部工作
>
> 本文职责：统一保存阶段路线、任务边界、交付规则、Git 例外、质量门禁与新会话接续方式

## 1. 文档定位

本文是 Frontend V2 的执行总入口。后续新会话不需要重新讨论总体路线，也不应一次加载全部 V2 文档；每次只读取本文、项目规则和当前子任务直接相关的蓝图。

本文不替代其他蓝图：

- 技术栈与状态所有权见 `01-technical-architecture.md`；
- 路由与信息架构见 `02-information-architecture-and-routing.md`；
- 页面字段和业务流程见 `03-page-and-workflow-blueprint.md`；
- Design System 规则见 `04-design-system-and-interaction-spec.md`；
- 服务端动作与 API 契约见 `05-business-actions-state-and-api-contract.md`；
- 代码边界见 `06-code-architecture-and-project-structure.md`；
- 验收标准见 `08-testing-quality-and-acceptance.md`；
- 已批准的架构决策见 `09-architecture-decisions.md`。

执行期间如本文与专项蓝图发生冲突：产品与页面行为以专项蓝图为准；任务组织、分支方式和交付节奏以本文为准。冲突必须先写回对应权威文档，不允许在实现中自行选择一个版本。

## 2. 总体目标与边界

V2 使用独立 `frontend-v2/` 开发，不在现有 `frontend/` 中原地重写。

复用：

- FastAPI、OpenAPI、PostgreSQL、Celery、Redis 和对象存储；
- authentication、CSRF、权限和稳定错误契约；
- 已确认的领域状态与服务端投影；
- V1 中已经验证的业务流程和 E2E 场景思想。

不直接复制：

- Ant Design layout、theme override 和页面级 CSS 结构；
- 旧 table columns、action column 与 pathname 特判；
- feature 内部被当作通用组件的 UI；
- 页面根据 status、role 或多接口结果推导出的业务资格。

V1 在 Cutover Gate 通过前必须保持可运行。V2 是新实现，V1 是业务行为、API、字段与回归场景的参考，不是新页面结构或组件代码的模板。

## 3. 十条交付规则

### 3.1 一个 Codex Task 只有一个可 review 目标

每个 Task 必须能独立说明、验证、提交、回滚和归档。推荐范围是 5–20 个主要文件；脚手架和生成文件可以超过，但目标仍必须唯一。

合格任务：

- Foundation Bootstrap；
- App Shell；
- Table Kit；
- Products List；
- Fact Review Workspace。

不合格任务：

- 重构整个前端；
- 实现完整 Design System；
- 迁移 Product、Content 和 Publishing；
- 顺便清理 V1。

一个 Task 不得夹带下一个页面、非阻塞重构或未来能力。发现额外工作时只记录为后续 Task，不在当前分支扩展范围。

### 3.2 Design System 先于业务页面，但按真实消费顺序建设

第一张业务页之前必须完成：

- token、typography 和核心 primitives；
- PageHeader、StatusBadge、EmptyState、ErrorState；
- TableShell、FilterBar、Pagination、RowActions；
- App Shell、Breadcrumb 和 responsive navigation。

Workspace、Form、Editor、Analytics 等 Pattern 在第一个真实消费者之前完成，不提前搭建无人使用的完整组件库。TanStack Virtual、ECharts、AG Grid、Zustand 等能力只有在对应业务证明需要时才引入。

### 3.3 每个 Vertical Slice 完成后做一次抽象回顾

抽象回顾是独立检查点，不新增业务能力。固定检查：

- 是否出现第二份相同交互或状态映射；
- 通用 UI 是否误留在 domain；
- Design System 是否混入业务 token、权限或状态机；
- Table/API abstraction 是否过度；
- URL state、query keys、action registry 是否可复用；
- 是否出现客户端业务资格推导、兼容 fallback 或第二份 DTO；
- 是否应通过删除重复代码解决，而不是继续增加抽象。

只有稳定、已被真实页面验证的 Pattern 才提升到 `design-system/`。第一个页面的偶然实现不能自动成为全系统规范。

### 3.4 后端 API 与 OpenAPI 允许在同一 Slice 内同步调整

当页面需要 join 多个接口、解析 message、推导动作、拼 snapshot 或接受不一致数据时，禁止写前端临时兼容逻辑。处理顺序固定为：

```text
确认页面所需信息
→ 检查 contracts/openapi.yaml 和真实后端投影
→ 修改 OpenAPI / database contract（如需）
→ 修改后端 read model、endpoint 与测试
→ 重新生成 V2 API types
→ 实现前端
→ contract-check 和相关验证
```

主代理维护根级 contracts、backend 与 frontend-v2 的一致性。新增 Workspace context endpoint 必须有真实 waterfall 或 snapshot 一致性问题，不为未来页面预建。

### 3.5 第一项 V2 准备任务创建 `frontend-v2/AGENTS.md`

该文件只保存 V2 特有且需要目录级自动生效的规则，不复制根 `AGENTS.md`。至少包含：

- 必读蓝图与本文入口；
- 技术栈、依赖方向和状态所有权；
- 服务端动作权威与 Action Registry；
- Table、Workspace、不可变 Detail 规则；
- 页面固定开发模板；
- 必需验证和报告格式；
- 禁止万能 DataTable、Redux、Next.js 和页面状态机。

根规则继续负责安全、合同所有权、Trellis、Git 提交确认和项目通用质量要求。

### 3.6 每个页面使用固定开发模板

每个页面 Task 都按以下流程执行：

```text
Read
→ Audit
→ Plan
→ Implement
→ Test
→ Visual QA
→ Self-review
→ Report
```

各步骤含义：

1. **Read**：读取根与 V2 `AGENTS.md`、本文、相关专项蓝图和 contract；
2. **Audit**：确认现有 API、read model、权限、动作和可复用 Pattern；
3. **Plan**：列出单一目标、明确不做什么、预计文件、组件层级和验证命令；
4. **Implement**：按 contract/model → query/action → components → route 的顺序实现；
5. **Test**：运行直接覆盖变更的 unit/component/E2E；
6. **Visual QA**：按 375/768/1024/1440 验证当前页面需要的宽度；
7. **Self-review**：检查契约、依赖方向、动作资格、URL state、可访问性和 diff；
8. **Report**：报告 changed files、decisions、tests、unresolved issues 和推荐下一 Task。

### 3.7 Playwright 从第一张业务页开始

Foundation 只需 App Shell、Router 和 production build 的最小 smoke。自 `/products` 起，每个业务 vertical slice 都必须留下稳定 Playwright Test。

第一张 Products List 至少验证：

- direct URL、加载、搜索、筛选和分页；
- refresh、Back、Forward 和 URL 状态恢复；
- 产品链接、Primary Action 和 overflow；
- keyboard navigation；
- 375px 和 1440px；
- mutation 后服务端重新校验与 canonical state。

临时交互诊断使用项目 `playwright-cli`；验证稳定后转成 Playwright Test。每个临时 session 必须使用当前 Task 的独立名称，并在结束前关闭。

### 3.8 一个 Task 使用一个临时 Git 分支

Frontend V2 获得根 `AGENTS.md` 单分支规则的正式例外。分支格式：

```text
codex/frontend-v2-<task>
```

示例：

```text
codex/frontend-v2-agent-rules
codex/frontend-v2-foundation-bootstrap
codex/frontend-v2-table-kit
codex/frontend-v2-products-list
```

规则：

- 每个实施 Task 从最新、干净的 `main` 创建一个分支；
- 一个分支只能承载该 Task 的目标；
- 提交前必须展示 commit plan 并获得确认；
- 不自动 push；
- 合并到 `main` 后删除本地和远程临时分支；
- 父级路线只保存在本文，不创建长期 `frontend-v2-rewrite` 分支；
- 此例外只适用于 Frontend V2，其他工作继续遵循根规则。

### 3.9 Cutover Gate 通过前不删除旧前端

Phase 0–8 不删除 `frontend/`，不把生产入口直接切向 V2，也不让 V1/V2 共用同一套可变 UI 源码。V1 pipeline 的删除必须是 Phase 9 的最后一个独立 Task。

### 3.10 Codex 固定协作节奏

所有实现会话遵循：

```text
先阅读 → 再说明计划 → 修改 → 自测 → 自审 → 报告
```

计划保持简短但可验证。遇到契约、权限、数据所有权、不可变规则或用户体验边界不明确时，先查证权威来源；无法从仓库确认且会改变结果时，只提出一个最高价值问题。

## 4. 新会话与 Task 生命周期

本路线不预先创建 Trellis 父任务或全部子任务。后续每个新会话只处理下一个 Task，避免长期上下文、跨任务状态和历史实现细节反复压缩。

单个 Task 的生命周期：

```text
选择本文中的下一个 Task
→ 新会话读取最小上下文
→ 创建该 Task 的 Trellis 任务与规划文档
→ 用户审核并批准实施
→ 从最新 main 创建临时分支
→ 实现、验证、自审
→ 提交计划确认、提交、合并
→ 删除临时分支、归档 Task
→ 结束会话
```

新会话不得自动继续下一个 Task；每个 Task 都由用户单独发起。

### 4.1 最小上下文读取矩阵

所有 Task 必读：

- 根 `AGENTS.md`；
- `frontend-v2/AGENTS.md`（创建后）；
- 本文；
- 当前 Task 的 `prd.md`、`design.md`、`implement.md`（创建后）。

按任务增加：

| Task 类型 | 额外读取 |
|---|---|
| Foundation / 技术栈 | `01`、`06`、`08`、`09` |
| App Shell / Router | `02`、`04`、`06`、`08` |
| Design System | `04`、`06`、`08` |
| 业务列表 | `02` 相关路由、`03` 相关页面、`04`、`05`、`08`、OpenAPI 对应段落 |
| Workspace / Review | `03` 相关页面、`04`、`05`、`06`、`08`、相关数据库与 OpenAPI contract |
| Cutover / 部署 | 本文 Phase 9、`08`、infra specs、部署配置与脚本 |

不要仅为了“熟悉项目”重复读取全部蓝图。发现跨域契约问题时，再加载必要的专项文档。

### 4.2 Task 规划卡模板

每个 Task 的规划必须明确：

```text
Goal
In Scope
Out of Scope
Source Documents
Affected Contracts
Expected Files
Acceptance Criteria
Required Validation
Optional Validation
Rollback Point
```

## 5. Phase 0 — Contract & Read Model

目标：确认 V2 不需要通过客户端拼装业务列表、动作资格或 Workspace snapshot。

### 5.1 V2 Agent Rules

先创建最小 `frontend-v2/AGENTS.md`，固化本文第 3 节的目录级规则。该准备任务只改规则文件，不初始化应用、不修改 contract，也不实现业务能力；完成后再进入 Contract Readiness。

### 5.2 执行方式

先建立 Products、Content、Publication、GEO 的 readiness matrix，核对：

- list item 是否能由一个 endpoint 完整绘制；
- 是否有 typed `workflow_stage`；
- 是否有唯一 `primary_task`；
- `available_actions` 是否覆盖需要尝试的命令；
- mutation 是否重新校验、支持 revision 并返回 canonical state；
- 是否有稳定 error code；
- Workspace 是否存在真实 waterfall 或 snapshot 不一致。

只实现当前 vertical slice 的阻塞项。已经满足的 domain 不产生占位修改，也不提前为未来 Workspace 创建 context endpoint。

### 5.3 第一项契约工作

Products List 当前优先核对：

- Product list item 的当前事实版本/状态摘要；
- `q/page/pageSize/sort/factStatus/workflowStage` 与后端参数映射；
- `primary_task` 是否能直接映射到录入、审核、修订和创建内容任务路由；
- list row 是否仍需要额外事实请求。

退出条件：第一条 Products slice 不需要客户端 join，主操作完全由服务端 token 驱动，冲突和不可执行动作能通过稳定 contract 展示。

## 6. Phase 1 — Foundation

Phase 1 分成以下独立 Task，按顺序实施：

### 6.1 Foundation Bootstrap

实现 React 19、TypeScript、Vite、Tailwind CSS 4、TanStack Router、TanStack Query、OpenAPI generated client、基础 providers、最小 App Shell、Vitest、lint、typecheck 和 production build。

明确不做：业务页面、Storybook 全量组件、Table Kit、Workspace Kit、部署切换。

### 6.2 Tokens + Core Primitives

实现 CSS Variables、surface/text/border/semantic tokens，以及 Button、IconButton、Input、Select、Badge、Tooltip、Dropdown、Dialog、Sheet、Tabs、Skeleton 等真实需要的 primitives。建立 Storybook 最小入口。

### 6.3 App Shell + Router Metadata

实现 Sidebar、top shell、mobile navigation、account menu、Breadcrumb、route metadata、`navId` 和 search validation。验证 direct URL、refresh 与 Back/Forward。

### 6.4 Table Kit

实现 TableShell、TableToolbar、FilterBar、ColumnHeader、Pagination、RowActions、BulkActionBar、EmptyTable、TableSkeleton 和 demo server table。固化最多一个 Primary、统一 overflow、144px action zone、keyboard 与 responsive 规则。

### 6.5 Workspace + Form + Editor Kit

实现 WorkspaceShell、WorkspacePane、WorkspaceTabs、StickyActionBar、DetailSection、Timeline、RHF/Zod Form Kit、DirtyGuard 和 CodeMirror 最小 Markdown editor。只覆盖后续 Product Facts 所需能力。

### 6.6 V2 Quality Entry Integration

让 root quality entry 同时覆盖 V1/V2：bootstrap、contract-check、lint、typecheck、unit、build 和 V2 Foundation Playwright smoke。保持 V1 E2E 与构建正常，不在本 Task 切换 Compose、nginx 或生产静态目录。

Phase 1 退出条件：Storybook 可运行；App Shell responsive；demo server table/workspace 可用；RowActions 规则固化；URL 恢复通过；V1/V2 质量入口绿色。

## 7. Phase 2 — Product Facts

按以下 Task 顺序完成第一条完整 vertical slice：

1. Products List；
2. Products List 抽象回顾；
3. New Product；
4. Product Detail；
5. Fact Workspace；
6. Fact Review；
7. Fact Version readonly Detail；
8. Product Facts 完整 E2E 与 vertical slice 抽象回顾；
9. Fact History 缺口关闭。

验证 Pattern：

```text
Table → Form/Detail → Workspace → Review → Immutable Detail
```

退出条件：create、enter facts、submit、review、request changes、revise、approve 主流程通过；批准后服务端投影 `CREATE_CONTENT_TASK`，V2 生成 `/content/tasks/new?productId=...` 的 Phase 3 交接链接；业务页面没有自造 action UI；Products Playwright 覆盖 URL、响应式与关键动作。New Content Task 的完整 UI 创建步骤属于 Phase 3，不得用占位页面计入 Phase 2。

Phase 2.8 审计发现的 Fact History 缺口已由 `frontend-v2-fact-history` 关闭：Product domain 提供 `/products/$productId/facts/versions?page=1&pageSize=20`、分页窄 read model、readonly Table 与 canonical navigation；既有 V1 `listFactVersions` 合同保持不变。contract/backend、component、fixture Playwright、真实栈 Flow B、V1 兼容和文档一致性 required validation 已全部通过，Phase 2 exit gate 改判为 `MET`。

## 8. Phase 3 — Content

按 Task 依次实现：Content Task List、New Task、Task Detail、Content Editor、Content Review、Content Version readonly Detail、完整 E2E、vertical slice 抽象回顾。

Phase 3.1 `frontend-v2-content-task-list` 已实现 `/content/tasks`：扩展同一 ContentTask list endpoint 的兼容双模式分页，补齐 identifier/current mainline summary/updated_at 与权威 stage projection；V2 使用独立 Content domain query keys/action registry、固定六列表格、URL 恢复及列表生命周期命令。既有 V1 在省略分页参数时继续取得完整集合；New Task、Detail、Editor、Review、Publication 和 Content History 仍属于后续 Task。

Phase 3.2 `frontend-v2-new-content-task` 实现 `/content/tasks/new`：以三字段 `ContentTaskCreate` 和一次性 creation-options read model 提供 Product/Approved Fact Version/Target Platform 表单，支持 Product Facts `productId` handoff、dependent selection、稳定幂等键、DirtyGuard 与结构化错误。Phase 3.3 完成后，创建成功采用 POST canonical ID 进入 Task Detail；Editor、Generation、Manual Draft、Review、Publication 和 Content History 仍不在该 Task。

Phase 3.3 `frontend-v2-content-task-detail` 实现 `/content/tasks/$taskId`：新增独立 `ContentTaskDetail` read model，在 `REPEATABLE READ` 中一次装配 compact task/product/platform/fact/current content/generation/review/publishing/source/activity snapshot；V2 页面只请求该 endpoint。Content domain 内最小复用 List 已有 lifecycle commands/action registry，New Task 成功改入 canonical Detail。Editor、AI/Manual Draft、Humanization、Review、Content Version Detail、Publication Workspace 与 Content History 仍是后续独立 Task。

Phase 3.4 拆为两个可独立 review 的 Task。`frontend-v2-content-editor-core` 实现 `/content/tasks/$taskId/editor`、单一 `ContentEditorContext`、人工首稿、人工 revision、当前 HUMAN DRAFT 保存、Preview/Split/服务端 Diff、提交审核及 token 驱动的 delete/abandon；不实现审核决定或异步生产。`frontend-v2-content-ai-production` 在同一 Editor surface 上补齐按需 generation-options、Prompt/model 明确确认、稳定幂等创建、仅 active job 轮询、terminal 后 Editor Context refetch、progress/success/failure、按需完整 snapshot、exact snapshot retry 与 token 驱动 humanization；不新增前端 workflow framework。

关键约束：

- 以 `ContentTask.current_content_version_id` 为当前内容主线；
- 历史版本不可编辑；
- CodeMirror、Preview、Diff、Fact reference、Generation snapshot、Quality warnings、DirtyGuard、StickyActionBar 通过稳定 Pattern 提供；
- Review Context 若存在 waterfall，应先补服务端 context endpoint。

Phase 3.4 Editor 退出条件：人工首稿、保存、修订、提交、readonly matrix、current pointer、DirtyGuard、browser navigation，以及 AI 生成/失败/重试/自然化均由 component、fixture Playwright 和相互独立的 Human/AI real-stack flow 覆盖。Content Review 的 approve/request changes 与 readonly history 继续由后续页面 Task 关闭，不并入 Editor PR。

`frontend-v2-content-review` 实现 `/content/tasks/$taskId/review`：以 task-scoped `ContentReviewContext` 一次读取当前主线、Fact 依据、canonical diff、quality issues、generation/humanization snapshot 与追加式审核历史；approve/request changes 只消费服务端 action token，成功后重读 canonical context 并失效 Detail/Editor/List projection。component、fixture Playwright 和两条独立 real-stack decision flow 已覆盖只读证据、冲突/request ID 与记录追加；Content History 与跨领域 Review framework 仍不在范围内。

`frontend-v2-content-version-detail` 实现 `/content/versions/$versionId`：新增 compact `ContentVersionDetail` read model，在 `REPEATABLE READ` 中一次装配不可变内容、Fact identity、creator/change summary、nullable updated time、generation lineage 与目标版本 review timeline。Content domain 复用既有纯 UI Pattern，但保留自己的 query key、状态/时间映射和错误边界；页面没有任何写命令，也不改变 current pointer。component、generated-type fixture Playwright 和独立 real-stack HUMAN 读取流程负责证明 direct/refresh/navigation、六种状态、AI/HUMAN、snapshot 有无、只读性与 canonical Task 返回链接；Content History、Publication Workspace 和通用 Version Detail framework 仍不在本 Task。

`frontend-v2-content-e2e` 已关闭 Phase 3 Content 完整 E2E 缺口：复用 `deploy/scripts/e2e-local.sh` 的单一隔离生命周期，扩展既有 `content-review-real-stack.spec.ts` 而不新增 spec 或 orchestration。Flow A 通过 V2 页面连续完成 manual draft、save、submit、approve、canonical Task Detail、approved Version Detail 与 `START_PUBLICATION`；Flow B 完成 request changes、HUMAN revision、save、resubmit、approve，并证明旧版本 payload 不变、新版本成为 current pointer、review records 只关联正确目标版本。AI generation/failure/exact retry/humanization 继续由既有专项 real-stack flow 独立证明；Phase 3 仍只剩 vertical slice 抽象回顾，不提前进入 Cutover。

`frontend-v2-content-abstraction-review` 已完成 Content vertical slice 抽象审计：`content.api.ts`、query keys、action registry、current pointer、不可变历史和 `route → domain → design-system/shared` 所有权保持唯一且方向正确；component、generated-type fixture Playwright 与 real-stack 证明互补，没有可删除的重复测试。四个 Content route 的相同意外错误 UI 提升为一个不接收业务 DTO/token 的 `RouteError`，Detail/Review 两个只转发参数的 `StatusBadge` wrapper 已删除；Metadata、EmptyValue、业务错误映射及 Editor/Review/Version framework 均无足够证据提升。targeted component `25 passed`、四 route fixture Playwright `38 passed`、V2 typecheck/lint/build 与 `make verify` 中的 contract/API/backend/V1 门禁通过；`make verify` 的 V2 全套为 `232 passed / 1 failed`，唯一失败是既有 `app-shell.test.tsx` 未给 Product Detail loader 提供 API 响应，与本 Task diff 无关且在此前 Content Task 已有相同记录。由于本 Task 批准的 Phase 3 退出条件要求 `make verify` 全绿，Phase 3 exit gate 暂判 `NOT_MET`；应以独立 Product/AppShell 测试修复 Task 关闭该已知缺口，本 Task 不跨 domain 夹带修改。

前置 `frontend-v2-content-task-detail-platform-fixture` 已修复 Content Task Detail 的 platform fixture，但当次完整 `make verify` 仍为 `49 passed / 3 failed`，因此该 Task 对 Phase 3 exit gate 的结论保持 `NOT_MET`。此记录只追加后续证据，不改写其 Task 或更早 `NOT_MET` 历史。

`frontend-e2e-exit-gate-contract-drift` 重新核对 0037 后永久审计、`deleteProduct` 必填 revision 与生产 TableRegion 合同，并将三个 V1 E2E 及后续获授权暴露的稳定 locator/表格边界对齐到当前合同；同时修复 0042 ORM `updated_at onupdate` 意外扩大内容任务删除受控解绑的回归，未恢复 `ai_model.tested`，未修改审计白名单、OpenAPI、数据库 schema、migration、触发器或生产 TableRegion。精确 targeted E2E 为 `4 passed`（固定 V2 real-stack 前置另为 `7 passed`），PostgreSQL 删除生命周期回归 `1 passed`，frontend lint/typecheck、backend Ruff/mypy 与 `git diff --check` 均通过；完整 `make verify` 中 backend unit `176 passed`、V1 unit `203 passed`、V1 visual-contract `24 passed`、V2 unit `233 passed`、Docker backend integration `87 passed`、V2 real-stack 前置 `7 passed`、V1 E2E `52 passed`、V2 E2E `179 passed / 15 skipped`，双前端构建和 Compose 配置检查也全部通过，最终退出码为 `0`。当前 Phase 3 exit gate 重判为 `MET`。

## 9. Phase 4 — Publishing

按三个独立生命周期实施：

1. Ready Queue + Publication Work List；
2. Publication Work Workspace；
3. Published Articles List + readonly Detail；
4. Published Content Issues List + Workspace；
5. Publishing 完整 E2E；
6. vertical slice 抽象回顾。

`frontend-v2-publication-work-list` 已落地第 1 项：`/publishing/work` 使用 summary、ready items、work list 三个既有窄 endpoint，展示四项运营摘要、no-account Ready 候选和固定六列 active work；START 只消费服务端 action/matching account，并携带 CSRF 与稳定幂等键。列表补齐 Product/latest event 批量投影，仍由服务端分页、筛选和稳定排序。

`frontend-v2-publication-workspace` 及其 verification/revision/handoff 前置已实现 `/publishing/work/$workId`：一个 Workspace Context 返回批准正文、冻结平台/账号、结果、附件、核验与事件；成功核验原子创建同 ID PublishedArticle，并将 COMPLETED handoff 指向 `/publishing/articles/$articleId`。父任务真实栈门禁已覆盖成功与 ACTION_REQUIRED 修订闭环。

`frontend-v2-published-articles` 已落地第 3 项：注册 `/publishing/articles` 与 `/publishing/articles/$articleId`；列表以服务端 search、六种稳定 sort 和 pagination 绘制固定五列，无操作列。Detail endpoint additive 嵌入既有 `ContentVersionDetail` 与 Publication events，在单个 `REPEATABLE READ` 请求中返回来源 Markdown、Fact/generation lineage、首次 PASSED verification 和时间线。

`frontend-v2-published-content-issues` 已落地第 4 项：注册 `/publishing/issues` 与 `/publishing/issues/$issueId`，列表只消费现有批量 Issue DTO，Workspace 使用新的单一 `issue + article + repair_task` Context；Article detail 只按服务端 token 登记或交接问题。repair options 按需读取，create repair 与 resolve 保持独立，cancelled repair task 不再产生不可执行的继续修复入口。vertical slice 抽象回顾仍留在后续任务。

`frontend-v2-publishing-e2e` 已落地第 5 项：扩展既有 `publication-workspace-real-stack.spec.ts`，由 V2 UI 连续完成 Ready Queue 开始发布、准备与平台复核、结果登记、PASSED 核验、只读 PublishedArticle、登记内容问题、创建修复 ContentTask、按服务端 `primary_task` 继续修复并解决问题；既有 Flow B 继续证明 FAILED → ACTION_REQUIRED → 内容修订审批 → 换版 → 重登记 → PASSED。最终只读断言覆盖来源 Content snapshot、verification、publication event、Article issue history 与 Issue/repair-task 投影不可变性。门禁复用 `deploy/scripts/e2e-local.sh` 的隔离 PostgreSQL、Redis、FastAPI、对象存储和 V2 production preview，V2 10 条与指定 V1 7 条均通过，数据库和临时存储由脚本精确删除。Phase 4 仅剩第 6 项抽象回顾。

`frontend-v2-publishing-abstraction-review` 已完成第 6 项的前端白名单调整：Article `OPEN_ISSUE` 与 Issue repair 的 409 现在保持输入、禁止自动 replay，并通过显式重读 canonical Article/Workspace/repair context 恢复；resolved Issue 缺少 `resolution_outcome` 时显式失败，不再猜测为 retired；同时删除无生产消费者的 `publicationCoreActions` 与无语义 error mapper alias。Publication domain 12 files / 48 tests、targeted 4 files / 22 tests、typecheck、lint、build、三个 fixture specs 11 tests，以及 Publishing 三条 real-stack flow 均通过；没有新增 shared framework，也没有删除互补测试。Phase 4 Exit Gate 仍为 `NOT_MET`：Work list/detail/workspace 的 name/label/identifier 投影尚未按非终态 live、终态 frozen snapshot 规则收敛，`GET /api/v1/publication-works` 可实际返回的 409 尚未写入 OpenAPI；此外当次完整 `make verify` 仍有范围外 Content DirtyGuard unit failure，完整 `make e2e` 仍有范围外 Content AI real-stack timeout。上述 blocker 必须由各自 owner 的独立 Task 关闭并重跑最终门禁；不得据此提前进入 GEO。

`publication-work-projection-contract-correction` 已关闭上述 F-14/F-15：Work List、Detail 与 Workspace Context 继续共用 `_work_context_query()` → `_work_list_item()`，非终态显示身份只读 live Profile/Account 且缺失时返回 `PUBLICATION_CONTEXT_INCOMPLETE` / 409，`COMPLETED` / `CLOSED` 在 live rename/delete 后只读 Work frozen snapshot；List OpenAPI 与两套生成类型现声明 runtime 的 `403/409 ErrorResponse`。Target unit/contract 4 tests、四个 PostgreSQL integration 节点、固定 4/5 queries、contract-check、Ruff、mypy、V1/V2 typecheck 与 diff check 均通过，未增加 website snapshot、前端 fallback、状态机、权限或数据库变化。该专项 blocker 已关闭，但 Phase 4 整体仍为 `NOT_MET`：范围外 Content DirtyGuard、Content AI timeout 及最终候选门禁仍由各自 owner 处理，本 Task 不进入最终 closeout 或 GEO。

`frontend-v2-phase-4-exit-gate-environment-corrected` 已在最终 `main` 候选 `b5c5919d96f53d6b3feff4e21f97f87c9a9fc42e` 上完成唯一一次 `make verify`：门禁进程从 `.env` 只导出宿主机化 `DATABASE_URL` 与独占 Redis DB 15 `REDIS_URL`，未导出其他开发变量，最终退出码为 `0`。FastAPI/OpenAPI contract、V1/V2 generated types、Ruff/mypy、双前端 lint/typecheck、backend unit `181 passed`、V1 unit `203 passed` + visual contract `24 passed`、V2 unit `282 passed`、backend integration `93 passed`、backend/V1/V2 production build、V2 real-stack `10 passed`、V1 E2E `52 passed`、V2 fixture E2E `209 passed / 21 skipped` 及 Compose dev/prod config 全部通过；Publishing Flow A/B、Published Article readonly 与 Issue/repair lifecycle 均由真实栈证明。cleanup 确认数据库 `partsignal_e2e_20260812_66472`、临时对象存储和六个测试端口已清理，Redis DB 15 在独占且 queue/unacked 为空后精确删除两个 Celery binding key，最终 `DBSIZE=0`。Product、Engineering、UX、Architecture、Contract、Documentation 六类均为 `MET`，未解决 P0/P1/P2 为 `0`，代码、合同、生成类型与文档无漂移；因此 Phase 4 Exit Gate 最终改判为 `MET`，仍不提前进入 GEO。

退出条件：`PublicationWork / PublishedArticle / PublishedContentIssue` 使用三组 URL；成功核验 snapshot 不可变；失败核验不伪装成功；动作全部 server-driven；timeline/evidence 可追溯。

## 10. Phase 5 — GEO

按 Task 实现 Observation List、New Observation、Observation Detail、Correction Workspace、Topics、Insights、Print、完整 E2E 和抽象回顾。

`frontend-v2-geo-observation-list` 已实现本阶段第一个独立 slice：`/geo/observations` 使用 additive `GET /api/v1/geo-observations/list-items` 完成链尾 compact projection、服务端搜索/筛选/排序/分页、八列 Table、URL state、服务端动作投影和严格 fixture E2E。V1 完整列表接口保持不变；List 已使用 Detail/Correction canonical href。

`frontend-v2-new-geo-observation` 已交付 `/geo/observations/new` 人工创建 Workspace：复用既有 Product 搜索、Query Topic、GEO Published Article 候选与文件上传合同，逐篇显式记录 discovered/mentioned/accuracy，并提供 pending 防重、结构化错误、候选冲突显式刷新和 DirtyGuard。`frontend-v2-geo-observation-detail` 落地后，成功 handoff 已改为直接使用 POST response ID 进入 canonical Detail，不经 List 搜索 ID。

`frontend-v2-geo-observation-detail` 已注册 `/geo/observations/$observationId`：additive Detail read model 在一个 `REPEATABLE READ` 请求中返回 Legacy 完整事实或 Manual root→tail correction history、Product/Query Topic、Published Articles、direct evidence 与 actor-aware actions；旧 GET/collection/POST 保持兼容。页面支持 List/direct/refresh/Back/Forward、两类只读结果、完整 history、404/403/409/普通错误、retry、DELETE confirmation 和四档响应式；strict generated-type fixture 拒绝浏览器 join。

`frontend-v2-geo-observation-correction-workspace` 已注册 `/geo/observations/$observationId/correct`：新增 additive correction-context GET，在同一 `REPEATABLE READ` 事务中组合既有 Manual Detail、权威尾节点、当前 Published Article 候选初值和历史空 Topic 的可选项；写入继续复用通用 append-only POST。页面冻结 Product/Platform/Search Query/非空 Topic，只允许填写本次时间、当前文章事实、新 Evidence 与 Notes；两类 409 不自动 replay，显式刷新按文章 ID 合并草稿并按服务端新尾 replace URL，成功直接使用响应 ID 进入新 Detail。contract/backend integration、API/model/page tests 与 strict generated-type production fixture 覆盖权限、不可变历史、上传重试、防重复、错误恢复、DirtyGuard 和四档宽度。

`frontend-v2-geo-topics` 已注册 `/geo/topics`：保留旧完整 Query Topic 列表供 V1、New Observation 与 Correction Workspace 使用，新增窄 `list-items` read model 负责服务端搜索、排序、分页、三类批量业务引用和 actor-aware actions。固定五列 Table 支持 URL state、开始观测 handoff、短 Dialog 创建/编辑、revision conflict 显式 reload、服务端允许时删除和 canonical 引用筛选链接；strict generated-type fixture 覆盖状态、键盘焦点及四档宽度。

`frontend-v2-geo-insights` 已注册 `/geo/insights`：一个 repeatable-read read model 提供七参数筛选、三项趋势、平台/内容/覆盖、建议与数据质量；actor-aware action source 驱动按需优化 Dialog。PublicationWork 冻结平台 UUID/名称保证平台删除后的历史筛选；局部 SVG + 精确表格替代图表依赖。Coverage 可 handoff Topic+GEO Platform 到 New Observation。

`frontend-v2-geo-insights-print` 已注册 `/geo/insights/print`：Screen/Print 共用七参数 URL、query key、单 GET read model、趋势格式化和 GEO 域报告体；Print 从同一响应解析筛选标签，移除普通 AppShell 与全部筛选、drill-down、优化 Dialog、creation-options 和 mutation，仅保留原生浏览器打印。局部响应式表格在 375px 卡片化，768/1024/1440 保持语义 table，Print media 重复表头并避免拆分行/短卡片。

`frontend-v2-geo-e2e` 已关闭完整 GEO real-stack 闭环缺口：Flow A 通过 V2 New、Detail、Correction 与 List 连续证明真实附件上传、append-only correction、祖先附件投影、节点 direct evidence、原记录不可变和链尾唯一；Flow B 从真实 Insights `CONTENT_DECLINE` 创建带幂等键的 Optimization ContentTask，并在 Task Detail UI/API 证明不可变 GEO source。过程中发现并最小修复 `list-items?page_size=20` 未将查询字符串解析为整数的问题，TestClient 回归锁定合法值。唯一 required gate 为 V2 real-stack `12 passed`、V1 Trusted Types `7 passed`，退出码 0，数据库、对象存储、端口与独占 Redis 均完成精确清理。该检查点当时仅剩 vertical slice 抽象回顾，因此退出条件继续为 `NOT_MET`。

`frontend-v2-geo-abstraction-review` 已完成最后一项抽象回顾：route/API/read model/action/append-only/Screen-Print 所有权保持唯一，没有新增通用框架或依赖。审计关闭三个真实缺口：Detail/Correction 对 route-valid 大写 UUID 的身份比较改为大小写不敏感；Observation create/correct/delete 与 Topic mutation 补齐 Insights、Topic 引用摘要和精准 Product Detail 的缓存失效；New/Correction/Insights 输入统一回到最小 Textarea 与既有 Select primitive。targeted component/model 为 `6 files / 36 tests`，Insights production-artifact Playwright 两个 project 为 `16 passed`，OpenAPI generated check、lint、typecheck 与 production build 均通过；最近 GEO real-stack `12 passed` 与 V1 Trusted Types `7 passed` 因本任务未改后端、数据库、OpenAPI、上传或 append-only command 而作为直接闭环证据保留。最终未解决 P0/P1/P2 为 `0`，Phase 5 Exit Gate 改判为 `MET`。

退出条件：Correction append-only；Topic 删除能显示业务引用；Insights filter 可通过 URL 恢复；print 与 screen 使用同一 read model；375px 不出现不可用的宽表。

## 11. Phase 6 — Configuration

依次实现 Platform List、Platform Workspace、Platform Type subsettings、Prompt Workspace、AI Channel List、AI Channel Workspace、E2E 和抽象回顾。

`frontend-v2-platform-list` 已交付 Phase 6 的第一个 slice：注册所有已认证用户可见的 `/settings/platforms` 与导航入口，复用并扩展既有 PlatformProfile collection read model，提供服务端 readiness 三态、可用账号数、全局摘要、类型 options、actor-aware actions 和 revision mutation。固定七列表格支持 canonical URL 搜索/筛选/分页、完整状态与四档响应式；Platform Workspace、类型/账号/Prompt/AI 管理与完整真实栈 E2E 仍由后续 Task 完成。

`frontend-v2-platform-workspace-core` 与 `frontend-v2-platform-workspace-accounts` 已交付 `/settings/platforms/$platformId?tab=overview|accounts|generation`：一个 repeatable-read、actor-aware Detail 支撑 Header/Overview 首屏，ADMIN 编辑平台身份、Logo 和 Prompt 绑定，ENGINEER 使用同一只读 Workspace；Accounts Tab 复用 actor-aware account projection 完成响应式 CRUD/启停/删除、revision conflict 与 PublicationWork blocker。三个 Tab 支持 refresh/Back/Forward，表单在 409 保留草稿并显式 reload，mutation 精确失效 Configuration/Content/Publication 消费者。

`frontend-v2-platform-types` 已交付 ADMIN-only `/settings/platforms/types`。页面作为“平台与账号”的 subsettings 从 List/Workspace 进入，不占 Sidebar；固定 Name/Slug/平台数量/overflow 四列与 375px card-row 消费服务端 action/deletion/revision。后端增加包含 Enabled/Disabled PlatformProfile 的两查询 `platform_count` 投影、`lower(name), id` 顺序、slug 结构化约束错误和 required DELETE revision；三类 mutation 只失效 Type settings、Platform lists 与 Platform details。

`frontend-v2-prompt-workspace-core` 与 `frontend-v2-prompt-workspace-preview` 已完成并合入 `main`。Core 交付 ADMIN-only `/settings/prompts`、独立导航、canonical `q/promptId/new`、Prompt Library/Detail/CRUD、revision/dirty/Bound Platforms、单一 Prompt query owner 与响应式 Workspace；Preview 新增 ADMIN-only 窄 Options read model，复用 ContentTask `CREATE_GENERATION_JOB` action 与既有 GenerationJob → immutable ContentVersion 链路，覆盖显式 context/model、真实首稿确认、稳定幂等、active-only polling、terminal result/failure 与精确 cache invalidation。两个子任务均已通过各自 required validation、归档并删除临时分支；没有数据库 migration、新依赖、preview 专用状态或 Humanization 配置入口。

`frontend-v2-ai-channel-list` 已实现 ADMIN-only `/settings/ai` 的安全 Summary、canonical 筛选分页、固定七列表格、四档响应式及 revision 命令。Workspace Core 在其上增加完整合同创建与 Basic/Request 配置，Models 交付 lazy collection、discovery、CRUD、真实 test 与启停删除；Runtime 继续交付 URL-owned Usage period、Logs 服务端分页/actor、按需安全 Audit Detail，以及 Channel/Model Runtime handoff。

`frontend-v2-ai-channel-configuration-e2e` 已完成 Configuration 真实栈闭环：同一 V2 SPA 会话由 UI 完成渠道、Header、模型、replacement-only credential、stale revision、正式 Generation、Usage/Logs 与删除收尾，并证明 Prompt Preview 和 Content generation-options consumer handoff。唯一 Required real-stack 命令通过 V2 `13 passed` 与指定 V1 `5 passed`，合计 `18 passed`、退出码 `0`；secret/trace 扫描 clean，Redis DB 14、六端口、临时数据库、对象存储与进程均完成精确清理。

`frontend-v2-configuration-abstraction-review` 已完成 route/API/model/page/test/合同所有权审计，没有新增 Settings、CRUD、Workspace、Table、Runtime、错误处理或状态管理抽象。审计以最小 frontend-only 修复关闭两处真实缺口：AI Channel 干净表单接收后台 canonical 更新时同步下一次编辑使用的 revision baseline；AI Channel List 启停/删除后精确失效工作区 keys，并在删除时移除 Detail/Models/Usage/Logs cache。Configuration targeted `12 files / 81 tests`、OpenAPI generated check、typecheck、lint、production build、contract-check 与 diff check 已通过，Configuration 未解决 P0/P1/P2 为 `0`。当前候选唯一一次 `make verify` 在 V2 unit 阶段失败：Design System token contract 7 条、Product Detail 1 条、Content Editor 1 条、Publication Workspace 1 条；这些文件相对本 Task 基线均无 diff，且失败分别对应既有 print token 重定义、过期导航期望与重复文本选择器。门禁没有进入 integration/build/E2E，本 Task 不越权修改范围外 owner；因此 Engineering 为 `NOT_MET`，Phase 6 Exit Gate 保持 `NOT_MET`。

`frontend-v2-phase6-verify-blockers` 已把上述 10 个失败归因到四个测试边界并完成最小修正，production 行为保持：Design System 测试分别约束根 token 唯一性与 GEO Print 精确高对比覆盖；Product Detail、Content Editor、Publication Workspace 分别在具名 article、`内容文档` region、`发布内容与操作` region 内断言自身语义。四组目标测试为 `33 + 7 + 7 + 5 passed`，完整 V2 unit 为 `73 files / 427 tests passed`；API drift、typecheck、lint、production build、contract-check 与 diff check 均通过。

当前候选按规定只运行一次 `make verify`：合同、双前端与 backend 静态检查、backend unit `193 passed`、V1 unit `205 passed`、visual contract `24 passed`、V2 unit `427 passed` 后，PostgreSQL integration 以 `114 passed / 2 failed` 停止；总退出码 `2`、耗时 `430.93s`，build、real-stack E2E 与 Compose config 未运行。两个新 P2 均来自本分支零 diff 的 backend integration owner：Content Task Detail 的 GEO coverage snapshot 缺当前必填 `optimization_action`；fresh migration head 仍期望 `0042`，实际已为 `0043`。失败路径已证明 PostgreSQL 临时数据库、Redis DB 14、storage、进程与全部测试端口无残留。本 Task 不越权扩围或第二次运行完整门禁；当前 open P0/P1/P2 为 `0/0/2`，Engineering 与 Phase 6 Exit Gate 保持 `NOT_MET`。

`frontend-v2-phase6-integration-verify-blockers` 已把上述两个 P2 精确归因到 integration test 工件漂移：Content Task Detail fixture 现携带与 production 冻结来源一致的 `optimization_action`；fresh migration test 在升级成功和受保护 downgrade 失败后都精确断言唯一 head `0043_geo_platform_identity`。两个目标节点分别为 `1 passed / 1.60s` 和 `1 passed / 2.39s`，完整 backend integration 为 `116 passed / 141.68s`；Alembic heads、Ruff、mypy、contract-check 与 diff check 均通过，production、schema、migration graph、API 和业务行为没有变化，原两个 P2 已关闭。

当前最终候选按规定只运行一次 `make verify`：合同、双前端与 backend 静态检查、backend unit `193 passed / 5.58s`、V1 unit `205 passed / 246.53s`、visual contract `24 passed / 0 failed / 0 skipped` 后，V2 unit 以 `72 passed / 1 failed files`、`426 passed / 1 failed tests / 13.56s` 停止；总退出码 `2`，运行时间为 `2026-08-16 12:52:51 +0800` 至 `12:57:37 +0800`，integration、build、real-stack E2E 与 Compose config 未运行。新 P2 来自本 Task 零 diff 的 `fact-workspace-page.test.tsx:197`：revision conflict 用例保存 CodeMirror DOM `textContent` 后立即比较重渲染结果，本轮期望 `AO## 初始事实`、实际 `LCL## 初始事实`；同一既有测试在前一候选通过，当前证据指向未改动的 unit/CodeMirror DOM 时序 owner，但依单次门禁规则不重跑、不在本 Task 扩围。cleanup 证明 Redis DB 14 `0` key、临时 Redis/container/database/storage/process 均无残留，`8000/9001/5173/4173/4174/19009/16379` 全部释放。当前 open P0/P1/P2 为 `0/0/1`，Engineering 与 Phase 6 Exit Gate 保持 `NOT_MET`。

`frontend-v2-phase6-fact-workspace-unit-blocker` 已把上述 P2 归因到 jsdom 中 CodeMirror 增量 DOM 的断言边界，而不是 RHF controlled state 或 revision conflict production 行为。Fact Workspace 409、dirty background refetch 与 MarkdownEditor readonly toggle 三处同根用例改用单次输入事务、受控字符/行数、Preview 和 mutation payload 精确证明本地值；409 仍保留 request ID、dirty 与显式 canonical reload。两个目标文件分别为 `7 passed / 685ms`、`9 passed / 1.74s`，完整 V2 unit 为 `73 passed files / 427 passed tests / 12.67s`；OpenAPI generated check、typecheck、lint、production build、contract-check 与 diff check 均通过，production、API、数据库、权限、部署、依赖和产品行为无变化，原 Fact Workspace P2 已关闭。

当前最终候选按规定只运行一次 `make verify`：合同、lint/typecheck、backend unit `193 passed / 5.60s`、V1 unit `205 passed / 245.65s`、visual contract `24 passed / 0 failed / 0 skipped`、V2 unit `427 passed / 13.50s`、PostgreSQL integration `116 passed / 144.02s`、backend/V1/V2 production build、V2 real-stack `13 passed / 1.1m` 与 V1 E2E `52 passed / 5.5m` 均通过；V2 fixture E2E 最终为 `355 passed / 27 skipped / 2 failed / 4.5m`，门禁退出码 `2`、总耗时 `1148.07s`，因此 Compose dev/prod config 未运行。两个失败是同一未改动 `geo-insights.spec.ts:27` 用例在 mobile/desktop project 的重复结果：测试把 Reset 后 URL 固定为 `2026-07-15..2026-08-13`，production 的既有 UTC 最近 30 日合同在 `2026-08-16` 正确重置为 `2026-07-18..2026-08-16`。root owner 为时间敏感的 fixture E2E 期望，不是本 Task 的 Fact Workspace/MarkdownEditor owner；依单次门禁与范围约束不扩围或重跑。cleanup 证明 Redis DB 14 `0` key/`0` 外部客户端、临时 database/container/storage/process 均为 `0`，`8000/9001/5173/4173/4174/19009/16379` 全部释放。当前 open P0/P1/P2 为 `0/0/1`，Engineering 与 Phase 6 Exit Gate 保持 `NOT_MET`。

`frontend-v2-phase6-geo-insights-time-sensitive-e2e-blocker` 在唯一失败场景首次导航前复用 fixture `insights.generated_at` 固定 Playwright page clock，使 Reset 的当前 UTC 日与固定历史周期一致；canonical URL、筛选、Reset、Back/Forward 的精确断言以及 production 最近 30 日合同均未改变。精确场景为 mobile/desktop `2 passed / 7.4s`，完整 GEO Insights fixture spec 为 `16 passed / 13.3s`，V2 typecheck、lint、production build、Task validation 与 diff check 均通过；只有既有大 chunk 与颜色环境 warning，原 GEO Insights P2 已关闭。

唯一最终候选 `make verify` 非零结束、总耗时 `1144.56s`。合同与静态检查、backend unit `193 passed / 5.67s`、V1 unit `205 passed / 247.14s`、visual contract `24 passed / 0 failed / 0 skipped`、V2 unit `427 passed / 13.70s`、PostgreSQL integration `116 passed / 144.01s`、三套 production build、V2 real-stack `13 passed / 1.1m`、V1 E2E `52 passed / 5.5m` 均通过；V2 fixture E2E 为 `356 passed / 27 skipped / 1 failed / 4.4m`，Compose config 未运行。本 Task 的 GEO Insights 场景在 mobile/desktop 均通过；唯一新 P2 是未改动 `new-geo-observation.spec.ts:206` 的 desktop 焦点时序：同页从 1024px 切到 1440px 跨越 `WorkspaceShell` 的 1280px DOM 分支后立即 focus，input 在重挂载后变为 inactive，mobile 同场景通过。该测试 owner 不在本 Task 扩围或重跑。临时数据库、Redis DB 14 数据、storage、E2E process/container 与固定七端口最终均无残留。当前 open P0/P1/P2 为 `0/0/1`，Engineering 与 Phase 6 Exit Gate 保持 `NOT_MET`。

`frontend-v2-phase6-new-geo-observation-focus-e2e-blocker` 已在 New GEO Observation 四档宽度循环中等待当前 Workspace 的互斥可访问性分支稳定，再执行根 overflow 与精确 `GEO platform` 焦点断言；修复位于测试 owner，未修改 production、fixture payload、API、数据库、权限、部署、依赖或产品行为，也未新增 helper、sleep、retry、fallback 或抽象。精确场景为 `2 passed / 8.7s`，完整目标 spec 为 `14 passed / 20.8s`，独立完整 V2 fixture E2E 的 384 项为 `357 passed / 27 skipped / 0 failed / 4.2m`；V2 API drift、typecheck、lint、production build、contract-check 与提前执行的 Compose dev/prod config 均通过。

唯一最终候选 `make verify` 于 `2026-08-16 16:20:13 +0800` 至 `16:38:57 +0800` 运行一次，退出 `0`、`real 1124.40s`。contract、Ruff/mypy、双前端 lint/typecheck、backend unit `193 passed / 5.57s`、V1 unit `205 passed / 247.70s`、visual contract `24 passed / 496ms`、V2 unit `427 passed / 13.72s`、PostgreSQL integration `116 passed / 143.95s`、三套 production build、V2 real-stack `13 passed / 1.1m`、V1 E2E `52 passed / 5.5m`、V2 fixture E2E `357 passed / 27 skipped / 0 failed / 4.3m` 与 Compose dev/prod config 全部通过。cleanup 证明 Redis DB 14 为空且独占、独占 Redis container 已移除，临时 E2E database/storage/backend-test container 均为 `0`，固定端口 `8000/9001/5173/4173/4174/19009/16379` 全部释放。当前 open P0/P1/P2=`0/0/0`，Product、Engineering、UX、Architecture、Contract、Documentation 均无新增 blocker；Phase 6 Exit Gate 最终改判为 `MET`，且本 Task 不进入 Phase 7。

退出条件：平台与账号形成统一心智；Platform Type 不占 Sidebar；API key/secret 不出现在列表和日志；Prompt dirty/revision 完整；AI table action 统一。

## 12. Phase 7 — System

依次实现 Users Table 与批量操作、Audit Table + Detail Pane、管理员权限 E2E 和抽象回顾。

`frontend-v2-system-users` 已实现 `/system/users` 的 canonical server table、全局 summary、创建/编辑/reset/启停/删除/CSV、revision-bound selection 与 bulk partial feedback；OpenAPI 同步收紧 reset/delete revision 和 typed bulk failure。

`frontend-v2-system-audit` 已实现 ADMIN-only `/system/audit`、metadata-only 七列表格、canonical server filters、1280px Detail Pane/较窄 Sheet、URL-owned lazy detail 与 Users actor handoff。OpenAPI/runtime/generated clients 同步移除 list `change_summary`，写入与严格详情投影共用安全字段 registry；AI Channel Runtime 复用全局 detail owner，没有数据库迁移、依赖、mutation 或自动刷新。

`frontend-v2-auth-session-ui` 已归档：`/login`、`/account/security`、`_app` 共同认证边界、账户菜单自助改密与退出后的业务缓存清理均已交付。认证动作复用唯一 Auth session Query 和 generated contract，密码不进入 Query mutation cache 或 Playwright 产物；真实改密结果由服务端重新读取。

`frontend-v2-system-admin-e2e` 已复用唯一 `e2e-local.sh` 隔离生命周期补齐管理员权限闭环：ADMIN 通过 V2 UI 创建 ENGINEER，ENGINEER 首次登录并强制改密；System 导航隐藏、两个直接路由 403 与六个 ADMIN-only API 403 均由真实服务证明。ADMIN reset 后旧会话返回 `401/AUTH_REQUIRED`；bulk 同时得到 ENGINEER 成功与 seed ADMIN `LAST_ADMIN_REQUIRED`；create/reset/bulk Request ID 可在 Audit List 与 lazy Detail 追踪，用户删除后改密审计仍保留。最终入口为 V2 real-stack `15 passed`、V1 E2E `52 passed`、退出码 `0`、耗时 `417s`，且 secret scan 与数据库、Redis、storage、进程和端口清理均通过。Phase 7 下一项仅剩 System 抽象回顾。

`frontend-v2-system-abstraction-review` 已完成 System/Auth vertical slice 的依赖、状态 owner、权限、revision、缓存、敏感字段与测试编排审计。任务内以最小修正统一 System component harness 到 canonical Auth session query、拒绝 Audit 空时间输入，并删除薄 admin route wrapper 与无消费者 Audit query-key glue；未新增 Admin/CRUD/Permission/Audit/workflow framework。首次仓库级诊断发现四个范围外测试 owner blocker，因此当时保留 `NOT_MET`；其后 backend reset-password fixture、跨 domain Auth route harness、Fact Review 真实 409 revision flow 与 Platform Types 非管理员 E2E 已分别由独立 Task 关闭。

`frontend-v2-phase-7-exit-gate-recheck` 在同一 `main` 候选 `24cc8f81e12247705b59eb3ade4a2cbbdb049d2c` 上先独立执行全部门禁阶段：contract、lint、typecheck、backend/V1/V2 unit、PostgreSQL integration `117 passed`、三套 production build、V2 real-stack `16 passed`、V1 E2E `52 passed`、V2 fixture E2E `379 passed / 33 skipped` 及 Compose dev/prod config 全部通过；real-stack cleanup 精确删除 Redis DB 14 本次 key、drop 临时数据库、移除临时 storage 并释放六个固定端口。随后唯一一次最终 `make verify` 退出 `0`、总耗时 `19:23.64`：backend unit `201 passed`、V1 unit `205 passed`、visual contract `24 passed`、V2 unit `457 passed`、integration `117 passed`、V2 real-stack `16 passed`、V1 E2E `52 passed`、V2 fixture E2E `379 passed / 33 skipped`，三套 build 与双 Compose config 同样通过。八项 System shared invariant 无新反证，open P0/P1/P2=`0/0/0`；Phase 7 Exit Gate 最终改判为 `MET`，但本检查点不开始 Phase 8。

退出条件：admin 权限由服务端最终验证；bulk partial failure 有明确反馈；mobile audit 使用 Sheet；Audit 无 action column。

## 13. Phase 8 — Workbench

Workbench 最后实现，因为它聚合 Product、Content、Publishing 和 GEO。

实现 actionable counts、attention queue、workflow health、GEO summary 和 recent anomalies。必须使用专用 aggregate read model，每个待办深链接到具体筛选或 Workspace，不在浏览器通过多个分页 endpoint 计算 dashboard。

退出条件：聚合 API 独立；不复制 domain state machine；所有待办可操作；首页不以 vanity metrics 为核心。

`frontend-v2-phase-8-exit-gate-post-blocker-recheck` 在 A25–A30 全部关闭后冻结 `main` 候选 `3c93e8b2d164f57b2ef253bad010bb9e0e1d7403`。九个独立阶段均只运行一次并退出 `0`：contract-check `2.275s`、lint `9.234s`、typecheck `7.915s`、unit `260.219s`、integration `120 passed / 150.100s`、三套 production build `19.440s`、完整 E2E `740.577s`、dev Compose config `0.089s`、prod Compose config `0.037s`。独立 unit 现场保留 V1 Vitest `205 passed`、V2 Vitest `463 passed`；backend pytest 与 V1 visual contract 均通过，但受控内存摘要未保留这两个数字，因此不从历史结果推断。独立 E2E 为 V2 real-stack `16 passed`、V1 `52 passed`、V2 fixture `383 passed / 33 skipped / 0 failed`。

独立阶段全绿后，最终 `make verify` 于 `2026-08-24 15:33:30` 至 `15:53:11 +08:00` 恰好运行一次，退出 `0`、总耗时 `1180.905s`：backend unit `204 passed`、V1 unit `205 passed`、V2 unit `463 passed`、backend integration `120 passed`、V2 real-stack `16 passed`、V1 E2E `52 passed`、V2 fixture `383 passed / 33 skipped / 0 failed`，三套 build 与双 Compose config 同样通过；V1 visual contract 通过，但本次内存摘要未保留数字，未沿用旧计数。两轮 E2E 分别使用现场动态选择、互不相同的非 0 独占 Redis DB `7` 与 `14`，preflight 均通过；database drop、Redis allowlist cleanup/empty/external clients `0`、storage removal、服务 stop/wait 和 `8000/9001/5173/4173/4174/19009` 释放均完整。

A27 两键 allowlist、A28 Settings repr/ValidationError、A30 Celery quiet、既有 dev-storage/Playwright artifact owner 与本轮受控内存审查共同证明本候选的实际敏感输出边界；精确敏感值、Redis URI、Redis connection/broker lifecycle 与签名 query 类别命中均为 `0`，但不宣称存在全局 secret scanner。A25–A30 均为 closed，open P0/P1/P2=`0/0/0`，历史 abstraction review 与旧 recheck 的 `NOT_MET` 结论保持只读；Phase 8 Exit Gate=`MET`。本结论不归档 Phase 8 父任务，也不开始 Phase 9。

## 14. Phase 9 — Cutover

按独立 Task 执行：

1. V2 staging 接入；
2. production-like data rehearsal；
3. V1 → V2 redirect map 与 direct deep link 验证；
4. V2 production artifact 与静态资源发布；
5. 回滚演练；
6. 正式切换与错误率/API 观察；
7. 最后删除 V1 build/deploy pipeline 和 `frontend/`。

### 14.1 Cutover Gate

删除或停用 V1 前必须全部满足：

- V2 目标路由全部完成；
- Product、Content、Publishing、GEO、Configuration、System 核心 E2E 通过；
- 375/768/1024/1440 响应式验收完成；
- keyboard、focus、dialog/menu、status redundancy 等可访问性验收完成；
- 权限、server action revalidation 和 revision conflict 验证完成；
- production build artifact smoke 通过；
- `/login`、`/`、核心列表、Workspace 和管理员 deep link 可直接访问；
- JS chunk、API base URL、client routing fallback、asset caching、CSP/source map 策略已验证；
- redirect map 已验证；
- `contract-check` 和必要部署脚本测试通过；
- staging production-like rehearsal 与回滚演练完成；
- V1 删除是单独、可回滚的最后一个 Task。

不长期保留 `/v1` 与 `/v2` 两套路由语义。

### 14.2 P9.1 Staging 接入状态

- 仓库实现将现有 staging `frontend` service 的 build context 切换为 `frontend-v2/`，service 名、镜像变量、端口、外层 Nginx、安全头和发布脚本保持不变。
- V2 production artifact 由 `frontend-v2/Dockerfile` 与 `frontend-v2/nginx.conf` 持有，production source map 显式关闭；本地容器门禁覆盖 SPA fallback、asset 404、缓存与 `.map`。
- V1 `frontend/`、V1 image owner 和旧 release 均保留；但数据库进入 `0043_geo_platform_identity` 后，历史 release 的 backend 不写 Publication Work 平台 snapshot，历史 frontend 也缺少当前 API 必需的 revision 参数，两者都不再是安全回退 target。
- P9.1 定向门禁、V2 容器检查、部署脚本检查和完整 `make verify` 已通过：修复后的 foundation-mobile 定向用例 1 passed，最终门禁 backend unit 204 项、V1 unit 205 项、V1 visual 24 项、V2 unit 463 项、backend integration 120 项、V1 E2E 52 项、V2 real-stack 16 项、V2 fixture E2E 383 passed/33 skipped，三套镜像构建及 dev/prod Compose config 同时通过；本地 Repository Gate=`MET`。
- 用户于 2026-08-25 确认 P9.1 以 Repository Gate=`MET` 收口并归档；外部 Gate 随后由独立任务 `frontend-v2-phase-9-staging-activation-validation` 检查。公网状态、headers、代表 SPA 路径、health、hashed JS/CSS immutable 与 missing asset 404 均通过，但页面标题为候选 V1 固定标题而非 V2 标题，`/assets/index-B12Mu6hl.js.map` 返回 200 且主 JS 含 `sourceMappingURL`。公网未观察到固定候选 V2 artifact，B 也没有可核验完成证据，并违反 source map Required 合同；故外部 Staging Gate=`NOT_MET`，在浏览器前置处停止，没有创建 Playwright session、登录、业务写入或自动回滚。公网行为与候选 V1 source marker 一致；未通过 SSH 复核，不能断言 current/container、入口缓存或其他远程根因。Cutover Gate 仍未满足，V1 源码、旧 release 与回滚边界继续保留。
- 后续 legacy redirect、production-like rehearsal、production artifact、回滚演练、正式切换和 V1 删除仍为独立 Task。

### 14.3 Staging V1 UI 回退兼容合同

`frontend-v2-phase-9-staging-v1-rollback-compatibility-blocker` 将迁移后回退边界收紧为同一 candidate release 内的 frontend-only 切换：

- migration 只前进；API、Worker、Scheduler 和 `fake-oss` 始终使用同一个与 `0043` 兼容的 candidate backend；
- migration 前从 candidate 保留的当前 `frontend/` 构建并冻结 `partsignal-frontend-v1:<candidate-release>`，不重用历史 V1 artifact；
- V1 fallback 只把 `PARTSIGNAL_FRONTEND_IMAGE` 切到 `partsignal-frontend-v1`，V2 restore 只切回 `partsignal-frontend`；两者的 `PARTSIGNAL_VERSION` 始终是同一 candidate release；
- 两条命令都只选 `frontend`，并固定 `--no-deps --no-build --pull never --force-recreate --wait`；不调用整栈发布脚本、不使用 `--remove-orphans`、不执行 migration/seed、不修改 Nginx 或 `current`；
- 切换前后必须证明 `postgres redis fake-oss api worker scheduler`、migrate container 集合、DB revision、Nginx 校验与 `current` 完全不变，只允许 frontend container/image 变化。

当前 V1 产品树与 Phase 8 固定候选的 frontend/backend/contracts/E2E runner 无差异，可继承 V1 E2E `52 passed`、unit `205 passed`、visual `24 passed` 和 production build 证据；若这些 owner 在新 candidate 固定前变化，必须重跑相关 V1 真实栈门禁，不得继承过期结果。本合同的仓库门禁不代表 Staging artifact 已构建或远程切换已验证；实际 tag/image ID、Compose dry-run 与 protected-state 前后证据仍属后续独立 staging activation Task。

## 15. V1 → V2 路由矩阵

| V1 | V2 | 动作 |
|---|---|---|
| `/` | `/` | 重做 Workbench |
| `/products` | `/products` | 重做 Table |
| `/products/:id` | Detail + Facts Workspace | 拆分 |
| `/tasks` | `/content/tasks` | 重做 |
| `/tasks/:id` | `/content/tasks/:id` | 从 list component 拆出 |
| `/content/:versionId` | Task Editor + Version Detail | 彻底拆分 |
| `/publications` | `/publishing/work|articles|issues` | 一拆三 |
| `/observations` | `/geo/observations` | 重做 |
| `/observations/:id/correct` | Correction Workspace | 拆出 |
| `/observations/insights` | `/geo/insights` | 保留业务，重做 UI |
| `/observations/topics` | `/geo/topics` | 重做 |
| `/settings` | Platform Workspace | 合并 |
| `/configuration/platforms` | Platform Workspace | 合并 |
| `/configuration/platform-types` | Platform subsettings | 降级 |
| `/configuration/prompts` | Prompt Workspace | 保留核心交互 |
| `/configuration/ai` | AI Channels | 重做列表 |
| `/users` | `/system/users` | 重做 |
| `/audit` | `/system/audit` | 优化 |

## 16. 验证策略

### 16.1 Task 级必需验证

每个 Task 选择能直接证明行为的最小验证：

1. targeted unit/component 或最小回归；
2. 相关 typecheck/lint；
3. 受影响 package build；
4. 业务页从 Products 起运行相关 Playwright；
5. 变更共享 contract、权限、状态流或部署时扩大验证。

Foundation 独立期间使用：

```bash
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run build
```

涉及 OpenAPI/backend 时至少增加：

```bash
make contract-check
uv run --project backend pytest <相关测试路径>
```

Phase 1 Quality Integration 完成后，根质量入口必须同时覆盖 V1/V2。`make verify` 用于共享 contract、Phase 退出、release/cutover 或用户明确要求的全量验证，不要求每个低风险 UI Task 都运行后端完整集成套件。

部署脚本测试当前不包含在 `make verify` 中；Cutover 与部署修改还需显式运行：

```bash
make test-deploy-scripts
```

### 16.2 每个 Phase 的 Definition of Done

- **Product**：信息架构、Primary Action、empty/loading/error 完整；
- **Engineering**：所需 lint/typecheck/unit/component/E2E/build 通过；
- **UX**：适用的 375/768/1024/1440、keyboard、Back/Forward、direct URL、refresh 通过；
- **Architecture**：无反向依赖、domain 不自造通用 UI、页面不推导业务资格；
- **Contract**：列表无客户端 join、mutation 服务端重新校验、错误可解释；
- **Documentation**：代码、OpenAPI、设计文档和当前实现一致。

## 17. 新会话启动模板

后续用户可以用下面的最小提示启动一个子任务：

```text
执行 PartSignal Frontend V2 的下一个任务：<Task 名称>。

先读取：
- 根 AGENTS.md
- frontend-v2/AGENTS.md（若已存在）
- docs/frontend-v2/07-migration-plan.md
- 07 中该 Task 的最小上下文读取矩阵所列文档

本会话只处理该 Task，不自动继续下一项。
先审计现有实现和 contract，再创建本 Task 的 Trellis 规划；
规划经确认后，从最新 main 创建 codex/frontend-v2-<task> 临时分支实施。
遵循：先阅读 → 说明计划 → 修改 → 自测 → 自审 → 报告。
```

## 18. 完成报告模板

每个 Task 最终报告：

```text
Outcome
Changed Files
Contract / Architecture Decisions
Validation Run and Results
Documentation Updated or Unchanged
Residual Risks / Deferred Items
Recommended Next Task
Branch / Commit / Merge Status
```

报告下一 Task 只是建议，不在当前会话自动创建、启动或实现。

## 19. 已确认的执行决定

- 独立 `frontend-v2/`，V1 保留到 Cutover；
- 文档驱动、contract-first、vertical slice；
- 一个 Task 一个新会话、一个可 review 目标；
- Design System 先于首个业务消费者并按需扩展；
- 每个 vertical slice 后进行抽象回顾；
- 必要时同一 slice 同步调整 OpenAPI、backend 与 frontend-v2；
- 第一项实施任务创建精简 `frontend-v2/AGENTS.md`；
- Playwright 从第一张业务页开始；
- Frontend V2 正式采用一个 Task 一个 `codex/frontend-v2-*` 临时分支；
- 固定协作节奏为先阅读、说明计划、修改、自测、自审、报告；
- 当前只归档总体计划，不创建 Trellis 任务、分支或实现文件。
