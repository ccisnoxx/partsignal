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
8. Product Facts 完整 E2E 与 vertical slice 抽象回顾。

验证 Pattern：

```text
Table → Form/Detail → Workspace → Review → Immutable Detail
```

退出条件：create、enter facts、submit、review、request changes、revise、approve、create content task 主流程通过；业务页面没有自造 action UI；Products Playwright 覆盖 URL、响应式与关键动作。

## 8. Phase 3 — Content

按 Task 依次实现：Content Task List、New Task、Task Detail、Content Editor、Content Review、Content Version readonly Detail、完整 E2E、vertical slice 抽象回顾。

关键约束：

- 以 `ContentTask.current_content_version_id` 为当前内容主线；
- 历史版本不可编辑；
- CodeMirror、Preview、Diff、Fact reference、Generation snapshot、Quality warnings、DirtyGuard、StickyActionBar 通过稳定 Pattern 提供；
- Review Context 若存在 waterfall，应先补服务端 context endpoint。

退出条件：AI/Human draft、approve/reject、revision、readonly history、dirty guard、browser navigation 全覆盖。

## 9. Phase 4 — Publishing

按三个独立生命周期实施：

1. Ready Queue + Publication Work List；
2. Publication Work Workspace；
3. Published Articles List + readonly Detail；
4. Published Content Issues List + Workspace；
5. Publishing 完整 E2E；
6. vertical slice 抽象回顾。

退出条件：`PublicationWork / PublishedArticle / PublishedContentIssue` 使用三组 URL；成功核验 snapshot 不可变；失败核验不伪装成功；动作全部 server-driven；timeline/evidence 可追溯。

## 10. Phase 5 — GEO

按 Task 实现 Observation List、New Observation、Observation Detail、Correction Workspace、Topics、Insights、Print、完整 E2E 和抽象回顾。

退出条件：Correction append-only；Topic 删除能显示业务引用；Insights filter 可通过 URL 恢复；print 与 screen 使用同一 read model；375px 不出现不可用的宽表。

## 11. Phase 6 — Configuration

依次实现 Platform List、Platform Workspace、Platform Type subsettings、Prompt Workspace、AI Channel List、AI Channel Workspace、E2E 和抽象回顾。

退出条件：平台与账号形成统一心智；Platform Type 不占 Sidebar；API key/secret 不出现在列表和日志；Prompt dirty/revision 完整；AI table action 统一。

## 12. Phase 7 — System

依次实现 Users Table 与批量操作、Audit Table + Detail Pane、管理员权限 E2E 和抽象回顾。

退出条件：admin 权限由服务端最终验证；bulk partial failure 有明确反馈；mobile audit 使用 Sheet；Audit 无 action column。

## 13. Phase 8 — Workbench

Workbench 最后实现，因为它聚合 Product、Content、Publishing 和 GEO。

实现 actionable counts、attention queue、workflow health、GEO summary 和 recent anomalies。必须使用专用 aggregate read model，每个待办深链接到具体筛选或 Workspace，不在浏览器通过多个分页 endpoint 计算 dashboard。

退出条件：聚合 API 独立；不复制 domain state machine；所有待办可操作；首页不以 vanity metrics 为核心。

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
