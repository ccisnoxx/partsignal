# Implement

## Phase 1：Preflight

1. 读取本Task `prd.md`、`design.md`、`implement.md`、父规划决策及三份backend spec全文。
2. 确认当前main和dirty baseline，只认本Task allowlist；不暂存、清理或回退无关文件。
3. 先以现有test PostgreSQL查询`pg_constraint`/`information_schema.columns`，验证unique、FK `SET NULL`和nullable。若不符，触发stop condition。

## Phase 2：Targeted tests and implementation

1. 在`test_publication_workflow.py`/`test_migrations.py`先建立真实catalog、precheck、合规锁等待、bypass 23505、unknown、HTTP、Session reuse和删除owner回归。
2. 在`publication.py`的Repair Task flush owner实现exact classifier/同义error，known rollback，unknown re-raise。
3. 更新`contracts/database.md`及三份stable backend spec，保持OpenAPI/runtime/generated/frontend zero diff。
4. 执行targeted checks；失败只做最多两轮与根因相关的repair/re-check。

## Required validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_publication_workflow.py backend/tests/integration/test_migrations.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/publication.py backend/tests/integration/test_publication_workflow.py backend/tests/integration/test_migrations.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
git diff --check -- backend/app/services/publication.py backend/tests/integration/test_publication_workflow.py backend/tests/integration/test_migrations.py contracts/database.md .trellis/spec/backend/database-guidelines.md .trellis/spec/backend/error-handling.md .trellis/spec/backend/publication-workbench-guidelines.md
```

## Optional validation

一次`UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q -ra`。不运行时在closeout说明targeted integration/unit、ruff和完整app mypy是替代证据，残余风险为未覆盖的其他domain suite。

## Review gate

required checks通过后执行一次独立高风险只读full review，重点为diagnostics allowlist、root rollback、production lock、single winner、unknown不泄漏、Session reuse、Repair/Article来源Task所有权、event/deletion/AuditLog原子性和diff范围；最多一次targeted re-review。

## Completion boundary

通过review后报告diff、实际命令和残余风险。提交前另行给出commit plan并等待确认；不自动commit/push，不归档父规划任务，不启动T5-I2。

## Execution results（2026-09-14）

- 已在 `publication.create_repair_task` 的 flush owner 完成 `23505 + uq_content_tasks_source_published_content_issue_id` 精确映射；precheck 与数据库最终失败共用既有 `REPAIR_TASK_EXISTS`，known 先 rollback，unknown 原样上抛。
- current-head PostgreSQL 16.14 catalog、真实 service flush diagnostics、双 Session Issue 行锁等待/单赢家、HTTP exact/precheck ErrorEnvelope、unknown FK 500 无泄漏、known/unknown Session reuse 和成果删除状态所有权均有集成回归。
- `contracts/database.md` 与三份稳定 backend spec 已同步；schema、migration、ORM、OpenAPI、runtime metadata、generated client 与前端生产代码均未修改。
- Required：受影响两个 integration 文件完整执行通过；目标 8 cases 复查通过；`test_contract.py` 与 `test_runtime_response_metadata.py` 通过；Ruff、完整 `backend/app` mypy 与 allowlist `git diff --check` 通过。
- Optional full backend suite 按一次性门禁执行一次，在 collection 阶段因既有 integration/unit 同名模块 `test_geo_insights.py` 的 import file mismatch 中止；失败与本 Task allowlist 无关，依规未清理缓存、未修复或重跑 full gate。
- 独立高风险 full review 提出 HTTP exact path 与负向 allowlist 两项 P2；唯一一轮定向修补和 8-case re-check 已完成，targeted re-review 确认两项均闭合且无剩余阻断问题。
