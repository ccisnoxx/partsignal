# Frontend V2 Workbench E2E

## 1. 背景与目标

本任务是父任务 `08-23-frontend-v2-phase-8-workbench-planning` 的第三个 child Task。前置任务
`frontend-v2-workbench-aggregate-read-model` 与 `frontend-v2-workbench-ui` 已提交并归档。

本任务只在 Product Facts、Content Review、Publication、GEO 四个既有真实栈 workflow 的自然状态检查点，
通过真实 V2 `/` 读取 `GET /api/v1/workbench`，验证 actionable count、唯一 attention item 与服务端 canonical
`href`。不新建跨域 workflow，不修改产品源码、backend、合同、数据库或 V1。

## 2. Requirements

### 2.1 Product Facts

- 在 Flow A 通过 V2 UI 提交事实审核后、批准前访问 `/`。
- `fact_reviews` count 必须为正；不得依赖隔离栈中的绝对总数。
- 本场景唯一产品 `PartSignal E2E {partNumber}` 必须出现在 attention queue。
- count link 必须为 `/products?page=1&factStatus=PENDING_REVIEW&workflowStage=FACT_REVIEW_PENDING`。
- attention link 必须为 `/products/{productId}/facts/review`，并可进入真实 Fact Review Workspace。

### 2.2 Content Review

- 在 Flow A 通过 V2 UI 创建并提交待审核内容后、批准前访问 `/`。
- `content_reviews` count 必须为正；不得依赖隔离栈中的绝对总数。
- 本场景唯一标题 `{partNumber} 审核内容` 必须出现在 attention queue。
- count link 必须为
  `/content/tasks?workflowStage=REVIEW_PENDING&archiveStatus=ACTIVE&page=1&pageSize=20`。
- attention link 必须为 `/content/tasks/{taskId}/review`，并可进入真实 Content Review Workspace。

### 2.3 Publication

在既有 Flow A 的三个状态点分别访问 `/`，不创建第二条 Publication workflow：

1. `PREPARING`：`publication_actions` count 为正；`继续准备` filter 为
   `/publishing/work?status=PREPARING&page=1&pageSize=20`；唯一内容 attention link 为
   `/publishing/work/{workId}#preparation`。
2. `AWAITING_VERIFICATION`：`publication_verifications` count 为正；filter 为
   `/publishing/work?status=AWAITING_VERIFICATION&page=1&pageSize=20`；同一内容的 attention link 为
   `/publishing/work/{workId}#verification`。
3. `OPEN issue` 且尚未创建 repair task：`content_issues` count 为正；filter 为
   `/publishing/issues?status=OPEN&page=1&pageSize=20`；唯一来源内容 `{approvedContent.title}` 的 attention link 使用服务端投影的
   `/publishing/issues/{issueId}#repair`。

### 2.4 GEO

- 在 Flow A 创建 `PARTIAL` manual root 后访问 `/`；该 root 此时是 current correction-chain tail。
- `geo_accuracy_issues` count 为正，唯一 `rootQuery` attention item 指向
  `/geo/observations/{rootId}`；`部分准确` 与 `不准确` filter 保持服务端 canonical href。
- 30 日 GEO summary 对本场景 root 显示 discovery `1/1=100%`、mention `0/1=0%`、accuracy
  `0/1=0%`。
- 追加 `UNJUDGEABLE` correction tail 后再次访问 `/`：accuracy issue count 相对前一检查点精确减少 `1`，
  root attention item 消失；discovery/mention 只取新 tail，accuracy 显示 `0/0` 与“暂无数据”，不得显示伪造的
  `0%`。

### 2.5 共同边界

- 使用 Playwright Test Runner 与 `deploy/scripts/e2e-local.sh`；不使用 `playwright-cli`。
- 浏览器连接真实 V2 production preview、FastAPI 与 PostgreSQL，不 `page.route`、不导入 fixture、不通过 API
  seed 重复被测业务 mutation。
- Workbench 页面继续只消费独立 aggregate endpoint；no-client-join 由既有 strict Workbench fixture owner 保持，
  本任务不复制 allowlist/orchestration。
- Product、Content、Publication count 只断言为正，并同时用本场景唯一资源和精确 href 证明归属；GEO 使用同一
  chain 前后可靠减量，不依赖跨 spec 数据。
- 不放宽既有业务断言、browser error 审计或 secret artifact 规则；新增失败信息只包含合成测试资源、DOM 数值与
  relative href，不记录 password、Cookie、CSRF、header、request body、storage state 或正文。
- 每个 real-stack owner 独立运行并保留 database、Redis、storage、process 与 port cleanup 证据。

## 3. Out of scope

- `workbench-real-stack.spec.ts`、新 fixture、新 helper 文件、通用 E2E orchestration/helper framework。
- 第二套服务、数据库、Redis、storage、进程、端口或清理生命周期。
- 产品源码、backend、OpenAPI、generated types、数据库、V1 frontend 或 Workbench API/UI 设计修改。
- 其他 domain mutation/cache owner、响应式 fixture、完整 `make verify`、Workbench 抽象回顾或 Phase 9。
- 为无法自然建立的状态增加测试 API、固定成功路径、兼容 fallback 或宽松断言。

## 4. Acceptance Criteria

- [x] 四个既有 real-stack spec 在上述自然状态点读取真实 Workbench aggregate。
- [x] Product 与 Content 分别验证正 count、唯一 attention item、canonical filter 和 Workspace navigation。
- [x] Publication 在同一既有 Flow A 验证 primary action、verification、open issue 的 count/item/server href。
- [x] GEO 验证 PARTIAL root issue、Observation Detail、30 日 rates、tail-only 减量和 unknown rate `null`。
- [x] 没有新增 spec/fixture/helper 文件，没有重复 workflow/API mutation/服务与 cleanup owner。
- [x] `docs/frontend-v2/08-testing-quality-and-acceptance.md` 只补 Workbench real-stack owner、状态点、secret 与 cleanup
  证据边界；`07` Phase 8 状态不提前改为完成。
- [x] 四个定向 real-stack owner、lint、typecheck、`git diff --check` 与 Task validate 全部通过。
- [x] 任一 real-stack 失败后仍完成其他安全独立 owner 的诊断；代码/环境未改变时不重复失败命令。
- [x] 每次运行的数据库、Redis、storage、进程与端口 cleanup 均有成功证据，且无敏感产物。

## 5. Planning Gate

规划已获用户批准；任务已通过 `task.py start` 进入 `in_progress`，并创建、绑定唯一临时分支
`codex/frontend-v2-workbench-e2e`。实施与 Required Validation 已完成，等待 commit plan 审批；尚未提交、推送、创建
PR 或归档任务。
