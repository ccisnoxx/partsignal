# Implement — Publication Work Projection Contract Correction

> 当前状态：白名单实施与 required validation 已完成；按用户明确要求使用临时分支，尚未提交、合并、push 或归档。

## Phase 0 — Approval and baseline

- [x] 用户批准 `prd.md`、`design.md`、`implement.md`、List `403/409` 目标矩阵及精确白名单，并明确要求完成后再提交 commit plan。
- [x] 核对本地 `main` 包含 `origin/main`、领先 119 且落后 0；定向暂存 Task 目录后确认基线干净。
- [x] 按用户明确要求从 `main` 基线 `01de56b7ae85047af16bd28015cf4a13dd29c053` 创建 `codex/frontend-v2-publication-work-projection-contract-correction`。
- [x] 重新读取本 Task 三份文档、backend/frontend AGENTS、相关 specs 与共享 thinking guides。
- [x] 设置 Task branch 并运行 `task.py start`，状态由 `planning` 进入 `in_progress`。

## Phase 1 — Shared backend projection

- [x] 在 `_work_context_query()` 将 name/label/identifier 的 live-first `coalesce` 替换为状态显式的 SQL `case`，保留既有 row labels、outer joins 与所有调用方。
- [x] 在 `_work_list_item()` 增加一个共享 identity 完整性检查，缺任一字段时抛 `PUBLICATION_CONTEXT_INCOMPLETE` / 409。
- [x] 未修改 Work 写路径、状态机、权限、Pydantic DTO、数据库约束或 migration。

## Phase 2 — Backend regressions

- [x] 在 `test_security_and_publication.py` 增加 `test_publication_work_projection_rejects_missing_live_identity`，精确断言 code/status。
- [x] 在 `test_publication_workflow.py` 增加 `test_publication_work_read_surfaces_use_state_aware_identity`，覆盖非终态 live rename、`COMPLETED`/`CLOSED` live rename/delete 与三 surface 对称。
- [x] 在同文件增加 `test_publication_work_list_malformed_context_returns_structured_409`，通过真实 HTTP List 响应验证 ErrorEnvelope。
- [x] 扩展既有 `test_publication_work_list_read_model_and_start_boundary` 与 `test_publication_workspace_context_is_consistent_and_bounded`，分别冻结列表行数与历史数量增长时的 4/5 queries；未另建性能框架。

## Phase 3 — OpenAPI and generated consumers

- [x] 在 `contracts/openapi.yaml` 为 List GET 增加 `403`、`409 ErrorResponse`；Detail/Workspace response set 保持不变。
- [x] 在 `test_contract.py` 增加 `test_publication_work_read_contract_matches_runtime_error_matrix`，冻结三个 GET 的完整响应集合。
- [x] 运行项目现有生成命令更新两份 `schema.d.ts`，未手改生成结果。
- [x] 生成 diff 仅增加 List 对应的 `403/409` response types，没有非相关 schema 漂移。

## Phase 4 — Documentation consistency

- [x] 复核 `publication-workbench-guidelines.md`、state-management、OpenAPI、代码与测试表达同一 invariant；现有 spec 已正确，未重复修改。
- [x] 更新 `docs/frontend-v2/07-migration-plan.md`：只记录 F-14/F-15 关闭及专项证据，Phase 4 仍保持 `NOT_MET`。
- [x] 更新本 execution record；Python 触及范围增加中文 query docstring、共享 invariant 注释和结构化错误文本。

## Required validation

先确保开发 PostgreSQL 已可访问；集成测试使用项目 compose 映射的独立临时数据库并自行迁移/删除。

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_security_and_publication.py::test_publication_work_projection_rejects_missing_live_identity \
  backend/tests/unit/test_contract.py::test_publication_work_read_contract_matches_runtime_error_matrix

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py::test_publication_work_read_surfaces_use_state_aware_identity \
  backend/tests/integration/test_publication_workflow.py::test_publication_work_list_malformed_context_returns_structured_409 \
  backend/tests/integration/test_publication_workflow.py::test_publication_work_list_read_model_and_start_boundary \
  backend/tests/integration/test_publication_workflow.py::test_publication_workspace_context_is_consistent_and_bounded

make contract-check

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/services/publication_queries.py \
  backend/tests/unit/test_security_and_publication.py \
  backend/tests/unit/test_contract.py \
  backend/tests/integration/test_publication_workflow.py

UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app

npm --prefix frontend run typecheck
npm --prefix frontend-v2 run typecheck
git diff --check
```

Required 证据必须同时证明：状态来源选择正确、结构化 409 可从 HTTP runtime 到达、OpenAPI/生成类型一致、查询次数固定。若同一检查失败，只有代码/配置/环境发生足以影响结果的变化后才重跑。

## Optional validation

仅在 targeted failure、共享 Publication 回归迹象或最终 Phase gate owner 要求时运行：

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py

UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
```

本 Task 不把 `make verify`、完整 `make e2e`、完整 Publishing fixture/real-stack 或双前端 build 列为 required：成功响应 shape 和前端生产代码未变，专项 backend/contract/typecheck 是更直接证据；已知 Content DirtyGuard 与 AI timeout 也不属于本 Task。完整门禁只在其他 blocker 由各自 owner 关闭后的 Phase 4 最终候选 commit 上运行。

## Rollback

- [x] 已记录 rollback 基线 `01de56b7ae85047af16bd28015cf4a13dd29c053`；白名单可作为一个一致单元恢复。
- [x] 无需回滚或迁移业务数据：本 Task 没有 schema、migration、写路径或数据回填。
- [x] 未保留 feature flag、双 DTO、旧 `coalesce` fallback 或前端兼容分支。

## Phase 4 blocker close conditions

本 Task 仅在以下条件全部满足时可声明已关闭 F-14/F-15：

1. 非终态 live、缺失 live 409、终态 frozen 的 invariant 在 List/Detail/Workspace 全部由测试证明。
2. `COMPLETED` 与 `CLOSED` 都覆盖 live rename 和合法 delete 后的历史显示。
3. List malformed context 的真实 HTTP 响应为 `409 ErrorEnvelope`，三个 GET 的 OpenAPI error matrix 与 runtime 一致。
4. List 4 queries、Workspace 5 queries 的 bounded 断言在行数/历史增长后仍通过。
5. 两份 TypeScript schema 由命令生成，contract check、backend targeted checks、双 typecheck、lint/mypy、`git diff --check` 全绿。
6. Diff 不越过白名单，没有 website snapshot、fallback、第二 DTO/owner、状态机/权限/数据库/前端页面变化。
7. `07-migration-plan.md` 只标记该 projection/contract blocker 关闭；完整 Phase 4 继续 `NOT_MET`，等待范围外 blocker 与最终 gate Task。

## Execution record

2026-08-12：

- 两套 `api:generate` 成功，生成 diff 均只新增 List `403/409 ErrorResponse`。
- Target unit/contract：4 passed。
- Target PostgreSQL integration：首轮 3 passed / 1 test-fixture failure；将读取断言改用独立 Session 后，失败节点复跑 1 passed。四个 required 节点均有绿色证据，List/Workspace 查询数分别保持 4/5。
- `make contract-check`、targeted Ruff、backend mypy、V1/V2 typecheck、`git diff --check` 全部通过。
- `trellis-check` 与逐文件 diff 自审未发现 spec 漂移、第二投影 owner、隐藏 fallback、N+1、白名单外生产改动或生成文件手工漂移；Task context validation 通过。
- 未运行 optional full backend suites、`make verify`、完整 Publishing E2E 或 build；成功响应 shape 与前端生产代码未变，且这些检查会越过本 Task 的直接风险或进入已知范围外 blocker。
- F-14/F-15 的 task-specific 关闭条件已满足；完整 Phase 4 仍为 `NOT_MET`，未进入最终 closeout 或 GEO。
