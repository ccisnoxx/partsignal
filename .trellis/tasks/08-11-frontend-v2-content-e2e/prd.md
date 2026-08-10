# Frontend V2 Phase 3 — Content E2E

## Goal

用现有 real-stack E2E 生命周期证明 Frontend V2 Phase 3 Content vertical slice 已形成两条相互独立、连续、可追溯的真实业务闭环，而不是若干互相独立的页面证明；本任务不实现新页面。

## User Value

- 正常内容从创建任务到批准、只读版本详情和发布交接可由 V2 页面连续完成。
- 被退回内容可从不可变旧版本创建新的 HUMAN revision，重新送审并批准，且版本主线与审核记录不会串线。
- Phase 3 退出门禁使用真实 PostgreSQL、FastAPI、Celery、独占 Redis broker、fake AI provider 和 V2 production preview，不把 fixture 证据冒充真实业务闭环。

## Confirmed Facts

- `deploy/scripts/e2e-local.sh` 已拥有唯一真实栈 orchestration：进程唯一 PostgreSQL、临时对象存储、真实 FastAPI、Celery Worker/Beat、fake AI provider 与 V2 production preview；真实栈 spec 已在 V1 suite 前运行。
- fixture specs 已覆盖 Content Task List、New Task、Task Detail、Editor、Review、Version Detail 的 loading/error/404、四档响应式、键盘、焦点、URL 与 production-artifact 页面矩阵，不需要在本任务重复。
- `product-facts-real-stack.spec.ts` Flow C 已通过 V2 页面证明独立 ContentTask 的 manual first draft → save → submit review，但到此停止。
- `content-ai-real-stack.spec.ts` 已独立证明 generation、humanization、真实 timeout failure、exact snapshot retry、源版本不可变和 Worker/fake provider 链路，不需要并入新闭环。
- `content-review-real-stack.spec.ts` 已有两条使用唯一业务数据的 V2 页面流程：一条到 APPROVE，一条到 REQUEST_CHANGES；它是补齐正常闭环和退回修订闭环的最小 owner。
- `content-version-detail-real-stack.spec.ts` 只证明独立 API-prepared HUMAN 版本的真实只读读取，尚未证明从同一批准流程进入版本详情。
- `ContentTask.current_content_version_id` 是当前内容主线唯一权威；内容审核历史按记录自身的 `target_id` / `target_version` 关联具体版本。

## In Scope

- 扩展现有 Content Review real-stack 的两条独立 test，分别关闭正常批准与退回修订闭环。
- 通过页面完成所有已迁移业务动作，并用最终只读 API 投影交叉验证 pointer、状态、不可变 payload 和 review target 关联。
- 更新 Phase 3 路线、测试验收和 E2E isolation 权威说明。
- 仅在新连续流程直接暴露证据时，修复 Content 页面之间的小型 canonical navigation、cache invalidation 或测试隔离缺陷。

## Requirements

### R1 — Flow A：Content 正常闭环

通过 V2 页面连续完成：创建 Product 与 Fact、批准 Fact、创建 ContentTask、进入 Task Detail 和 Editor、创建 manual draft、人工编辑并保存、提交审核、从 canonical Task Detail 进入 Content Review、批准、返回 canonical Task Detail、打开当前 readonly Content Version Detail。

最终必须同时验证：

- Task `workflow_stage=APPROVED`；
- Task `primary_task=START_PUBLICATION`，页面存在 canonical `/publishing/work` handoff；
- `current_content_version_id` 等于本次批准版本；
- 当前版本状态为 `APPROVED`；
- Version Detail 是同一版本的不可变只读快照，审核结果包含 `approve`。

### R2 — Flow B：Content 退回修订闭环

使用与 Flow A 完全独立的业务数据，通过 V2 页面连续完成：创建独立 draft、提交审核、request changes、返回 canonical Task Detail、进入 Editor、从被退回版本创建新的 HUMAN revision、更新并保存、重新提交、返回 Review、批准。

最终必须同时验证：

- 旧版本 payload 保持不变，且不再是 current；
- 新版本 `source_type=HUMAN`、`based_on_id` 指向旧版本；
- 新版本成为 `current_content_version_id` 并处于 `APPROVED`；
- 旧版本的 `submit-review/request-changes` 记录只关联旧版本；
- 新版本的 `submit-review/approve` 记录只关联新版本；
- Task 最终同样投影 `START_PUBLICATION`。

### R3 — 页面业务动作边界

- Product、Fact、ContentTask、draft、save、submit、review decision、revision 和 approve 必须通过 V2 页面完成。
- 只允许通过 API 创建尚未迁移的 Platform、Prompt、AI Channel 等管理前置数据；本任务的两条 manual flow 只需要 Platform 前置数据。
- API 只读请求只用于最终 canonical 投影和不可变性/关联关系交叉验证，不替代页面业务操作。

### R4 — 真实栈与隔离

- 不导入 `content.fixture.ts`，不使用 `page.route`、`route.fulfill`、API mock、Vite dev server、共享开发数据库或共享 Redis。
- 复用 `deploy/scripts/e2e-local.sh` 的单一数据库、seed、服务、preview 和 cleanup 生命周期；不得增加第二套 orchestration。
- 每条 Flow 使用随机唯一 PlatformType、PlatformProfile、Product、Fact、ContentTask 和版本链；除隔离栈 seed 的登录账号外不共享业务实体。
- 不通过 sleep 猜测业务异步完成；使用 Playwright 可观察页面状态和既有 query/refetch 行为。

### R5 — 最小补证

- 扩展现有 `content-review-real-stack.spec.ts`，不新增 real-stack spec、通用 setup/helper 或 workflow abstraction。
- 不修改已经通过的 fixture specs，也不重复 loading、404、响应式或键盘矩阵。
- 不把 AI generation 串入 Flow A/B；既有 `content-ai-real-stack.spec.ts` 继续在同一隔离栈中独立证明 AI/Celery/fake provider 能力。
- 不新增依赖、固定成功 fallback、兼容分支或第二套状态来源。

### R6 — 失败边界

- 失败必须保留真实业务错误与 request ID；不自动重放失败命令。
- 允许修复由新连续流程直接暴露的 Content 页面 canonical navigation、cache invalidation 或测试隔离小缺陷。
- 如需修改公共 API、数据库、权限、状态机或新建 read model，立即停止实施，保留证据并建议独立修复 Task。
- 不修复无法归因于当前 Content slice 的既有 V1、全仓或环境失败。

## Acceptance Criteria

- [ ] AC1：Flow A 的全部业务 mutation 由 V2 页面完成，并从创建一路连续到 APPROVED Task、readonly approved Content Version Detail 与 `START_PUBLICATION` handoff。
- [ ] AC2：Flow B 的全部业务 mutation 由 V2 页面完成，并从首次提交一路连续到 request changes、HUMAN revision、save、resubmit 和 approve。
- [ ] AC3：Flow B 最终只读投影证明旧版本 payload 不变、新版本为 current，且四类 review records 的 `target_id` / `target_version` 分别关联正确版本。
- [ ] AC4：两条 Flow 使用独立随机业务数据，不依赖其他 real-stack test 的实体、fixture、请求拦截、共享 PostgreSQL/Redis 或业务 sleep。
- [ ] AC5：既有 AI real-stack 继续独立通过 generation、failure、exact retry、humanization；新流程没有机械重复这些证据。
- [ ] AC6：`deploy/scripts/e2e-local.sh` 继续作为唯一入口，在 V2 production preview 上运行全部既有 real-stack specs 与扩展后的两条 Content Flow，并输出数据库/临时存储精确清理成功。
- [ ] AC7：直接相关 lint、typecheck、脚本语法、数据库生命周期脚本编译与目标 real-stack required validation 全部通过。
- [ ] AC8：代码、E2E isolation spec、Phase 3 路线和测试验收文档一致；未新增依赖、spec、helper、orchestration、公共合同或范围外页面。

## Out of Scope

- 新业务页面、Content History、Publication Workspace、GEO、Design System 重构、V1 功能重构、Cutover。
- Content vertical slice 抽象回顾、通用 E2E framework、通用 workflow helper、第二套 E2E orchestration。
- AI generation 流程重写或把 AI 步骤机械嵌入两条 manual Content Flow。
- 公共 API、数据库、权限、状态机、新 read model，以及无法归因于当前 Content slice 的既有失败。

## Delivery Gate

- 当前只完成规划；不运行 `task.py start`、不创建分支、不修改业务代码或测试。
- 用户批准本轮最终规划后，才允许激活 Task，并从最新、干净的 `main` 创建 `codex/frontend-v2-content-e2e`。
- 提交前展示 commit plan 并等待确认；不 push。
