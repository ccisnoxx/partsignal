# Frontend V2 Phase 6 integration verify blocker 复现与归因

## 1. Baseline

- 日期：2026-08-16（Asia/Shanghai）。
- 基线：clean `main` at `e3803c8c89487802e9c14084bf6629d32413c7b2`；相对 `origin/main` ahead 222，不因此 pull 或 push。
- 前置 Task `frontend-v2-phase6-verify-blockers` 已归档并合入 `main`；其最终候选唯一一次 `make verify` 在 integration 阶段以 `114 passed / 2 failed / 142.21s` 停止，总退出码 `2`、耗时 `430.93s`。
- 当前 Task 是唯一 active Trellis Task，状态为 `planning`；未创建分支、未运行 `task.py start`，production、test 和权威文档均未修改。
- 当前 Phase 6 open P0/P1/P2 为 `0/0/2`，Exit Gate 为 `NOT_MET`。

## 2. Independent reproductions

| ID | 精确命令 | Exit | 实际结果 | Root owner |
| --- | --- | ---: | --- | --- |
| B-01 | `docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest tests/integration/test_content_task_detail.py::test_content_task_detail_uses_pointer_stable_sources_and_fixed_query_count` | 1 | `1 failed in 1.52s`；`GeoQuestionCoverageGapBasis.item.optimization_action` 缺失 | integration fixture |
| B-02 | `docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest tests/integration/test_migrations.py::test_fresh_postgresql_migrates_to_head_and_seed_is_idempotent` | 1 | `1 failed in 1.36s`；期望 `0042_content_version_detail`，实际 `0043_geo_platform_identity` | integration expectation |

两组使用独立 one-off container 运行；复现后相关容器为 `0`，`partsignal_*` 临时数据库为 `0`。目标测试未进入 Redis、storage 或 E2E 进程路径，既有开发 PostgreSQL/Redis/API/worker/scheduler 容器保持原状。

## 3. B-01 — GEO coverage snapshot fixture 漂移

### Observed contract

- `backend/app/schemas/geo_files.py::GeoInsightCoverageItem` 将 `optimization_action` 作为必需字段；`primary_task == "CREATE_OPTIMIZATION_TASK"` 时，它必须存在，并与 item 的 `rule_code`、`query_topic_id`、`geo_platform` 及空 `published_article_id` 一致。
- `backend/app/services/geo_observation.py` 的权威 production builder 已构造完整 `GeoInsightOptimizationAction`，创建优化任务时再以 `basis.model_dump(mode="json")` 冻结 snapshot。
- `backend/app/services/content_task_detail.py::_compact_geo_basis` 先用严格 union adapter 校验完整冻结 snapshot，再只投影 Detail 页面实际使用的 compact 字段；这与 Content Task Detail spec 的真实来源、固定查询和无伪造 fallback 合同一致。
- 现有 backend unit test 已使用相同完整 action 结构。production、schema 和 service owner 内部一致。

### Root cause and minimum correction

- `backend/tests/integration/test_content_task_detail.py` 的手工 snapshot 创建于 action 合同之前；它设置 `primary_task="CREATE_OPTIMIZATION_TASK"`，却缺少当前必需的 `optimization_action`。
- 最小修复只在该 fixture 的 item 中加入与外层 source 完全一致的 action：`QUESTION_COVERAGE_GAP`、`2026-08-01` 至 `2026-08-10`、`published_article_id=None`、当前 `topic.id`、`DeepSeek`。
- 不修改 compact response 期望，因为 action 是冻结来源校验字段，不是 Detail UI projection 字段；不放宽 Pydantic 校验，不加 compatibility fallback。

## 4. B-02 — fresh migration head 期望漂移

### Observed contract

- `backend/.venv/bin/alembic -c backend/alembic.ini heads` 实际只返回 `0043_geo_platform_identity (head)`。
- `0043_geo_insight_platform_identity.py` 的 `down_revision` 为 `0042_content_version_detail`，迁移链唯一且有序。
- database spec 要求空库升级到 head，并保留精确迁移、约束和 downgrade 门禁；历史 migration 文件不得为追赶测试而改写。

### Root cause and minimum correction

- `test_fresh_postgresql_migrates_to_head_and_seed_is_idempotent` 在 `upgrade head` 后仍断言 `0042`。
- 同一测试函数在预期失败的 downgrade 后再次断言版本仍为 `0042`；该行因前一处先失败而尚未执行，但属于同一个 stale owner。
- 最小修复把这两处 current-head 断言都精确更新为 `0043_geo_platform_identity`。不动态读取 Alembic head，不删除断言，不修改 migration；文件中显式升级/降级到 `0042` 的 0043 专项测试保持不变。

## 5. Correction matrix

| Finding | 精确修改文件 | Production behavior | Required proof |
| --- | --- | --- | --- |
| B-01 | `backend/tests/integration/test_content_task_detail.py` | 保持 | 目标 test + 完整 integration + 最终 verify |
| B-02 | `backend/tests/integration/test_migrations.py`（同一函数两处） | 保持 | `alembic heads` + 目标 test + 完整 integration + 最终 verify |
| Gate evidence | `docs/frontend-v2/07-migration-plan.md`、`docs/frontend-v2/08-testing-quality-and-acceptance.md`、本 Task artifacts | 仅据实记录 | 与唯一最终候选结果一致 |

## 6. Planning conclusion

- 两项均为既有 integration test 工件相对当前权威 production/migration 合同的漂移；没有证据要求修改 production、API、数据库、权限、部署或依赖。
- 计划只改两个测试文件及两份 Phase 6 权威文档，不新增 helper、抽象、fallback 或其它测试清理。
- planning 证据不能关闭 blocker 或改判 Gate；只有修复、完整验证与 cleanup 实际通过后，open P2 才能从 2 降为 0。

## 7. Implementation evidence before final gate

| Check | Actual result | Status |
| --- | --- | --- |
| Content Task Detail exact node | `1 passed in 1.60s` | passed |
| fresh migration exact node | `1 passed in 2.39s` | passed |
| Alembic heads | only `0043_geo_platform_identity (head)` | passed |
| Complete backend integration | `116 passed in 141.68s` | passed |
| Ruff | `All checks passed!` | passed |
| mypy | `Success: no issues found in 77 source files` | passed |
| contract-check | runtime OpenAPI、V1/V2 generated types consistent | passed |
| diff check | exit `0` | passed |

- B-01 与 B-02 均已关闭；production、schema、migration、API、database 和 frontend 无修改。
- 目标与完整 integration 后，相关 one-off containers 为 `0`，`partsignal_*` 临时数据库为 `0`；这些阶段不使用 Redis DB 14、storage 或 E2E 进程。
- 当前 open P0/P1/P2 暂为 `0/0/0`，但最终 Gate 必须等待唯一最终候选 `make verify`。

## 8. Final-candidate gate and new blocker attribution

- 唯一一次 `make verify`：`2026-08-16 12:52:51 +0800` 至 `12:57:37 +0800`，退出码 `2`，总耗时约 `286s`。
- 已通过：contract-check；backend/V1/V2 lint 与 typecheck；backend unit `193 passed / 5.58s`；V1 unit `28 files / 205 tests / 246.53s`；V1 visual contract `24 passed / 0 failed / 0 skipped / 490.67ms`。
- 停止阶段：V2 unit `72 passed / 1 failed files`、`426 passed / 1 failed tests / 13.56s`；没有进入 backend integration、三套 build、real-stack、V1/V2 E2E 或 Compose config。
- 新 P2 B-03：`frontend-v2/src/domains/product/fact-workspace-page.test.tsx:197` 的 revision conflict 用例先读取 CodeMirror rendered DOM `editor.textContent`，冲突重渲染后立即用同一 DOM 表面比较；本轮期望 `AO## 初始事实`、实际 `LCL## 初始事实`。该测试和 production owner 相对本 Task 均为零 diff，同一测试在前一候选完整 V2 unit 中通过；当前证据将其归到既有 Fact Workspace unit/CodeMirror DOM 时序边界，未获得授权在本 Task 修改或重跑。
- 原 B-01/B-02 已由目标和完整 integration 证明关闭；B-03 与两个 backend test 修复没有因果关系。依单次完整门禁和停止条件，本 Task 不扩围、不自动第二次运行 `make verify`。

## 9. Final cleanup

- 门禁在 V2 unit 停止，integration、build 与 E2E 未启动；没有创建 E2E database、storage 或服务进程。
- 独占 Redis DB 14 cleanup 为 `keys=0`，临时 Redis container 已移除，16379 已释放。
- backend-test one-off containers `0`，`partsignal_*` 临时数据库 `0`，storage 目录 `0`。
- `8000/9001/5173/4173/4174/19009` 全部释放。
- 当前 open P0/P1/P2 为 `0/0/1`；Engineering 与 Phase 6 Exit Gate 保持 `NOT_MET`。
