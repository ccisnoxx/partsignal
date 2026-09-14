# Implementation execution results

- Task: `09-14-fact-version-integrity-mapping`
- Date: 2026-09-14
- State: `in_progress`；已实施并完成 required validation，未提交、未归档、未 push。

## 实施结果

- `product_facts.submit_fact_review` 保持 Product `FOR UPDATE`、active/revision/body/pending precheck 与 `max(version)+1` 顺序。FactVersion flush、FactReviewRecord 写入和 commit 位于同一 `IntegrityError` boundary；所有该类失败先执行 root `rollback()`。
- classifier 只读取 `error.orig.sqlstate` 与 `error.orig.diag.constraint_name`。仅 `23505 + uq_fact_versions_one_pending_per_product` 转为既有 `409 FACT_REVIEW_PENDING`；`uq_fact_versions_product_id`、其他 constraint/sqlstate 与 diagnostics 缺失均 bare re-raise 原始异常。
- Fact Workspace 只在非 5xx、合法 details、非空 request ID 与精确 code 同时成立时进入 pending/revision/state recovery。pending blocker 由按 `productId` 隔离的 editor 持有；canonical refetch 失败保留 blocker，成功后按服务器 `available_actions` 收敛。refetch 期间新增 dirty 草稿与旧 revision 基线不会被 canonical reset/提升。
- 四份稳定 spec/docs 已同步上述已验证行为。`contracts/openapi.yaml`、router metadata、generated schema 与数据库 schema/migration 均未修改。

## PostgreSQL 实证

required integration run 使用 `.env` 的数据库配置，并将容器 host 映射到 `127.0.0.1:55432`；每个 `temporary_database()` 创建独立数据库并执行 Alembic current head。

```text
uq_fact_versions_product_id
  CREATE UNIQUE INDEX ... ON public.fact_versions USING btree (product_id, version)
  predicate=NULL
  backing constraint=uq_fact_versions_product_id

uq_fact_versions_one_pending_per_product
  CREATE UNIQUE INDEX ... ON public.fact_versions USING btree (product_id)
  WHERE status = 'PENDING_REVIEW'
  backing constraint=NULL（partial unique index）

version identity: sqlstate=23505, constraint_name=uq_fact_versions_product_id
pending partial:  sqlstate=23505, constraint_name=uq_fact_versions_one_pending_per_product
```

真实 INSERT、双 Session Product-lock 等待、HTTP TestClient 与 request/independent Session 快照共同证明：正常并发后到请求走 pending precheck；约束失败后候选 FactVersion/FactReviewRecord 不存在，Product workspace/`facts_revision`、既有 pending/ReviewRecord、ContentTask pointer、ContentVersion 与 SUCCESS AuditLog 均保持基线，且失败 Session 可继续查询。`submit_fact_review` 及其 router 调用链没有 generation dispatch/broker import 或调用；仓库 broker dispatch owner 仍只位于 `content_production`/`generation_dispatch`，因此该 command 的两类失败不会产生 broker dispatch。这里是静态调用边界证据，不描述为 runtime dispatch spy 计数。

## Required validation

| Gate | 结果 |
|---|---|
| `pytest backend/tests/integration/test_publication_workflow.py backend/tests/integration/test_product_detail.py -q -ra` | 通过，44 passed，0 skipped；覆盖 catalog、两种真实 23505、classifier、Product lock、rollback/Session reuse、HTTP 等价/no-leak、成功/stale/precheck 回归 |
| `pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q` | 通过；公共合同与 runtime response metadata 未漂移 |
| `ruff check` 三个 changed backend files | 通过 |
| `mypy --config-file backend/pyproject.toml backend/app` | 通过，80 source files |
| 两个 Fact Workspace Vitest 文件 | 首轮 19 passed；review 修复后定向重检 23 passed |
| 四个 changed frontend files ESLint | 通过，0 warning |
| `npm --prefix frontend run api:check` | 通过，generated OpenAPI types 与根合同一致 |
| `npm --prefix frontend run typecheck` | 本 Task 相关代码未报错；仍仅被未修改的 `frontend/src/domains/publication/publication-work-page.test.tsx:351:37` 既有 TS2345 阻断：`[never, never]` 不能赋给 `never` |
| `git diff --check` | 通过 |
| Trellis task validation 与 JSONL parse | 通过；仅有三个大 spec 超过 32 KiB 的既知注入截断 warning，实施时已直接读取原文件 |
| readonly/public owner path-limited diff/status | 通过，零 diff、无新增 untracked file |

修复 review finding 后，因 frontend production/test 发生相关变化，typecheck 重新运行一次并得到同一无关 TS2345；之后未重复该失败门禁。`publication-work-page.test.tsx` 对 HEAD 为零 diff。

## 零 diff 边界

已用 `git diff HEAD --exit-code` 与 path-limited `git status` 验证以下 owner 无本 Task 差异：

- `contracts/openapi.yaml`、`contracts/database.md`
- `backend/app/routers/product_facts.py`
- `backend/tests/unit/test_contract.py`、`backend/tests/unit/test_runtime_response_metadata.py`
- `frontend/src/shared/api/generated/schema.d.ts`
- `backend/app/models`、`backend/alembic`、`backend/app/migration_schema_v1.py`
- `backend/app/services/review.py` 及 ContentVersion、ContentTask、Generation Job、publication/GEO service owner

`task.py start` 仅将本 Task 置为 `in_progress`，并在父任务 `children` 中登记本 Task；父任务与合同决策任务的 `status` 继续为 `planning`。既有 `.gitignore`、artifacts 与其他无关 dirty changes 未恢复、删除、格式化或纳入本 Task。

## Optional validation 与残余风险

- 未运行完整 backend/frontend suite、完整 frontend build；required 的真实 PostgreSQL 文件级 integration、公共 contract/runtime unit、相关 Vitest、backend app mypy、受影响 lint 与 OpenAPI 生成一致性已提供更直接证据。
- runtime broker dispatch spy/counter 未新增；无 dispatch 的结论来自 current-head 静态调用边界与 command 无 dispatch dependency。若未来该 command 引入外部 side effect，应在引入时增加可观察的 dispatch seam 和失败计数测试。
- 完整 frontend typecheck 当前仍受上述未修改 publication 测试既有 TS2345 阻断；按任务批准边界未修改 publication owner。
