# Frontend V2 Workbench Root Fixture Convergence Blocker

## 1. 目标

只关闭 Workbench abstraction review finding A25：让所有主动进入 `/` 的 Frontend V2 unit / production-artifact 测试 owner 明确提供符合 generated contract 的 `GET /api/v1/workbench` 响应，使 App Shell、Auth Session 与 Prompt Workspace 继续通过真实根路由和真实主导航验证用户行为。

本任务是 `.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/` 的新增 P1 blocker child Task，不创建新的 Phase 8 父任务，也不重新判定 Phase 8 Exit Gate。

## 2. 背景与已确认事实

- `frontend-v2-workbench-abstraction-review` 已合入 `main` 并归档；其 A25 证据记录 V2 unit 为 `462 passed / 1 failed`，V2 fixture E2E 为 `379 passed / 33 skipped / 4 failed`。
- 三组失败都在测试主动进入 `/` 后触发真实 Workbench route loader；production route、query key 和 `GET /api/v1/workbench` 合同本身没有 finding。
- App Shell unit 的 broad GET mock 对 Workbench 与 Products 都返回 ProductList shape，导致 Workbench 展示模型读取错误响应结构。
- Auth strict fixture 在强制改密和自助改密后进入 `/`，但 allowlist 只有 Auth API；Workbench GET 被记为 unexpected 并返回 501。
- Prompt Workspace 首个场景从 `/` 经 App Shell 导航进入 `/settings/prompts`；`prompt-workspace.fixture.ts` 继承 `platforms.fixture.ts`，后者未声明 Workbench GET，因此 mobile/desktop 都被 strict audit 拦截。
- `frontend-v2/tests/e2e/fixtures/workbench.fixture.ts` 已有 generated-type-backed `emptyAggregate`，可作为 Playwright runner 内最小稳定数据来源；unit 不应依赖 Playwright fixture 模块。

## 3. Requirements

### R1. App Shell unit harness

- `frontend-v2/src/app/layout/app-shell.test.tsx` 必须按精确 endpoint 返回对应 generated response shape。
- `/api/v1/workbench` 返回本 unit owner 本地声明的最小 `WorkbenchAggregate`；`/api/v1/products` 返回最小 ProductList。
- 未声明 GET 必须显式失败，不得再让一个 ProductList shape 响应所有 GET。

### R2. Auth strict fixture

- `frontend-v2/tests/e2e/auth-session.spec.ts` 必须显式声明 `GET /api/v1/workbench`，返回 generated contract 有效的最小 aggregate。
- 强制改密、自助改密、ENGINEER 403、退出和 secret artifact 断言全部保留。
- unexpected API 501 与 teardown audit 必须保持；除精确 Workbench GET 外不增加 wildcard 例外。

### R3. Prompt / Platforms strict fixture

- `frontend-v2/tests/e2e/fixtures/platforms.fixture.ts` 必须显式声明 `GET /api/v1/workbench`；`prompt-workspace.fixture.ts` 继续通过既有 fixture 继承链取得该声明。
- `prompt-workspace.spec.ts` 继续从 `/` 经真实 App Shell 主导航进入 Prompt Workspace；mobile navigation、CRUD/Preview/dirty/focus/响应式断言不得删除或改写。
- Platforms 的 unexpected API 501、runtime error 收集与 teardown audit 必须保持。

### R4. Fixture data ownership

- Workbench aggregate 必须满足 `components['schemas']['WorkbenchAggregate']`，全部 required 字段显式存在，rate 的 `0/0` 保持 `value: null`。
- Playwright owner 复用现有 Workbench strict fixture 的 `emptyAggregate`；不复制一份新 builder，不创建通用 fixture framework。
- App Shell Vitest 使用本文件 owner 内的最小 typed aggregate，不导入 `tests/e2e`，避免 Vitest 与 Playwright 形成跨 runner 依赖。

### R5. Preservation

- 不修改 Workbench、Auth、App Shell、Prompt、Platform 产品代码。
- 不修改 backend、OpenAPI、generated types、数据库、旧 frontend、Playwright config 或 npm scripts。
- 不放宽 strict audit，不吞掉未知 API，不增加 fallback、静默成功、新依赖或 shared Dashboard/fixture framework。

### R6. A26 isolation

- A26（Auth logout 与在途 Workbench GET 的取消/错误收集竞态）明确不在本任务处理。
- 不修改 `auth-session-real-stack.spec.ts`、Auth/query lifecycle 或 `requestfailed` 过滤规则来掩盖 A26。
- 若定向 fixture 测试暴露 A26 同形竞态，只记录并停止扩围；由独立 A26 Task 处理。

## 4. Acceptance Criteria

- [x] App Shell 定向 unit test 通过，且 GET mock 对 Workbench / Products 精确分流，未知 endpoint 显式失败。
- [x] Frontend V2 完整 unit suite 通过，原 `462 passed / 1 failed` 的 A25 失败关闭且无新失败。
- [x] `auth-session.spec.ts` 在 `foundation-mobile`、`foundation-desktop` 均通过；真实 `/`、工作台 heading、改密、403、退出和 secret scan 保留。
- [x] `prompt-workspace.spec.ts` 在 `foundation-mobile`、`foundation-desktop` 均通过；首场景仍从 `/` 经主导航进入 Prompt Workspace。
- [x] Auth 与 Platforms fixture 只对精确 `GET /api/v1/workbench` 返回最小 aggregate，其他未声明 API 仍返回 501 并在 teardown 失败。
- [x] Playwright 复用既有 typed `emptyAggregate`；Vitest 保持本地 typed fixture，不新增通用 framework 或跨 runner import。
- [x] Frontend V2 typecheck、lint、`git diff --check` 与 Trellis Task validate 通过。
- [x] 产品代码、backend、contracts、generated types、数据库、旧 frontend、配置与依赖无改动。
- [x] A26 未处理，Phase 8 Exit Gate 保持 `NOT_MET`，未运行 `make verify`、完整 `make e2e` 或真实栈 Auth。

## 5. Out of Scope

- A26 的诊断或修复。
- Phase 8 Exit Gate recheck、`MET` 文档更新、Phase 9。
- Workbench 产品行为、Auth/session 生命周期、Prompt/Platform 页面行为或 API contract 变化。
- `make verify`、完整 `make e2e`、真实栈 Auth、临时 `playwright-cli` 流程。
- 新的 shared test-data framework、builder hierarchy、wildcard route、依赖或兼容层。
