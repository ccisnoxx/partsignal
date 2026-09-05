# Humanization Job IntegrityError 领域映射实施计划

> 当前仅为 reviewable planning。未经用户在阅读最新总结后的明确实施批准，不运行 `task.py start`，不修改生产代码、测试、spec、合同或数据库。

## 0. 进入实施的前置门禁

- [ ] 用户明确批准本 Task 最新 `prd.md`、`design.md`、`implement.md`。
- [ ] 运行 `task.py start` 前确认 current task 指向本目录、状态为 `planning`，主工作区仍在 `main`；记录并隔离全部既有脏文件。
- [ ] 完整重读本 Task 三份规划、`implement.jsonl`、相关 research 与注入的 backend specs。
- [ ] 确认文件边界仍只有四项；任何 contract/schema/frontend/其他 service 需求立即停止。

## 1. Current-head PostgreSQL 证据门禁（代码修改前）

- [ ] 使用 `test_generation_reliability.py` 的随机临时数据库 fixture 执行 `alembic upgrade head`；确认其 `alembic_version` 与执行时仓库 head 一致。
- [ ] 只读查询 `pg_constraint`、`pg_index`、`pg_class`、`pg_namespace`，确认：
  - `uq_generation_jobs_idempotency_key` 是 `public.generation_jobs(idempotency_key)` 的非 deferrable UNIQUE constraint-backed index；
  - `uq_generation_jobs_active_humanization_source` 是有效 partial unique index，键与谓词准确，且不要求 `pg_constraint` 行。
- [ ] 在隔离临时库中捕获两个真实 unique violation，记录 `orig.sqlstate`、`diag.constraint_name`、`diag.schema_name`、`diag.table_name`；mapper 只依赖前两个字段。
- [ ] 任一名称/diagnostics 不一致即停止；不添加 alias、不改 migration、不先写 mapper。

## 2. Service 实施

- [ ] 在 `content_production.py` 提取现有 canonical existing-job matcher，使正常 `_create_job` replay 与 idempotency race recovery 共用同一 identity 规则；在 flush 前冻结比较所需的标量 identity，rollback 后不依赖过期 ORM 对象；保持 GENERATE Prompt identity 判断不变。
- [ ] 调整 HUMANIZE retry 的 key lookup 顺序：旧 job existence、snapshot contract、`FAILED` 与父 task `OPEN` 检查后先做 canonical replay/conflict；只有 key 不存在的新 retry 才执行 latest、资格、source/AI model、active 与 flush。不得改变 GENERATE retry，亦不得让 replay 绕过前述 contract/state 拒绝。
- [ ] 增加 HUMANIZE 私有 diagnostics classifier：只接受 `23505` 与两个精确 constraint/index 名；helper 不 rollback、不查询数据库。
- [ ] 修正 `create_humanization_job`：unknown 在 local rollback/query 前原抛；idempotency 已知后由 caller rollback 并复用 canonical matcher；active 已知后由 caller rollback 并抛 `HUMANIZATION_ALREADY_ACTIVE`。
- [ ] 为 `retry_generation_job` 的 HUMANIZE `_create_job` 分支增加同样处理；GENERATE retry 调用路径保持原样。
- [ ] idempotency diagnostics 命中但 winner 不存在/不可验证时原异常上抛；不得降级为任一 409。
- [ ] 保持 `commit -> dispatch -> refresh` 顺序，不新增 audit、事件、revision、version/review 或补偿逻辑。
- [ ] 对 touched Python scope 做中文注释/docstring/developer-visible text 检查；只记录非显而易见的 diagnostics 与事务责任。

## 3. Integration 测试

在 `backend/tests/integration/test_generation_reliability.py` 新增以下精确 nodeid，并复用现有真实 PostgreSQL fixture：

> 2026-09-05 实施补充：初次约 300 行及后续约 500 行测试预算仍无法完整覆盖两 caller 事务归属、unknown 副作用矩阵、winner 缺失与精确合同断言；用户已明确批准最后一个 `2.1 -> 2.2` 回合，并将两份测试的净新增预算提高到最多约 650 行。新增行必须只服务于本节与第 4 节的既定验收，不得扩展业务范围或新增 harness 文件。

- [ ] `test_humanization_job_unique_catalog_and_diagnostics_are_exact`
  - current-head catalog；两个真实 `23505`；constraint/index 名、schema/table；partial index 类型/谓词。
- [ ] `test_humanization_job_idempotency_replay_and_conflict_are_atomic`
  - create 顺序 replay；HUMANIZE retry 首次成功后新 job 已成为 latest，仍以原 previous/key replay；父 task 非 OPEN 等既有拒绝优先级不被绕过。
  - 分别建立 create-vs-create 与 HUMANIZE-retry-vs-retry 两组不同 task/source 的双 Session 同 key barrier，令两个 caller 都真实触发最终 idempotency unique；断言精确 diagnostics、`IDEMPOTENCY_CONFLICT` 与副作用计数。
- [ ] `test_humanization_active_constraint_maps_for_create_and_retry`
  - create/retry 预检与真实 partial unique 最终路径；使用窄 test-only precheck seam，不削弱 production lock；均为 `HUMANIZATION_ALREADY_ACTIVE`。
- [ ] `test_humanization_unknown_integrity_error_reaches_default_500`
  - 真实 `pk_generation_jobs` 或等价第三 unique sentinel；service 原抛；HTTP app 使用实际 `get_db()` cleanup 路径，并将 `app.db.SessionLocal` 定向到隔离临时数据库，不能用绕过 generator cleanup 的简单 dependency override；断言 default 500、不泄漏且请求后独立 Session 可查询。
- [ ] 每个场景在独立 Session 断言 GenerationJob、ContentVersion、ContentReviewRecord、AuditLog、task pointer/revision 与 dispatch spy；使用 event/barrier 和有界 timeout，不使用 `sleep`。

## 4. Unit 测试

在 `backend/tests/unit/test_generation.py` 新增：

- [ ] `test_humanization_integrity_classifier_requires_exact_23505_diagnostics`
  - 两个允许组合；缺 diagnostics、非 23505、未知 PK/unique、CHECK、NOT NULL、FK、trigger-like SQLSTATE 全部 unknown。
- [ ] `test_humanization_integrity_recovery_preserves_caller_transaction_ownership`
  - create 与 HUMANIZE retry 的 known/unknown 分支、rollback 次数、winner query 限制、same/different identity 结果；GENERATE retry 不进入 mapper。

Unit 不伪造 PostgreSQL 成功证据，只补足难以逐类真实触发的负分支。

## 5. Spec 同步

- [ ] 仅更新 `.trellis/spec/backend/error-handling.md`：增加 generation humanization 的两个精确 `23505 + constraint_name` 映射、idempotency winner 回查前提、active 不回查、unknown 原抛、caller root rollback 与 commit-before-dispatch（dispatch-after-commit）边界。
- [ ] 不新增全局 registry，不把默认 500 写成公共 JSON 合同，不重复 `database-guidelines.md` 已有业务事实。

## 6. Required validation

先运行新增 unit，再运行真实 PostgreSQL targeted integration；两者通过后运行静态检查、既有 worker 回归与 contract/零 diff gate。实现后的测试名必须与下列 nodeid 一致，不使用宽 `-k` 掩盖零收集。

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_generation.py::test_humanization_integrity_classifier_requires_exact_23505_diagnostics \
  backend/tests/unit/test_generation.py::test_humanization_integrity_recovery_preserves_caller_transaction_ownership

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest \
  tests/integration/test_generation_reliability.py::test_humanization_job_unique_catalog_and_diagnostics_are_exact \
  tests/integration/test_generation_reliability.py::test_humanization_job_idempotency_replay_and_conflict_are_atomic \
  tests/integration/test_generation_reliability.py::test_humanization_active_constraint_maps_for_create_and_retry \
  tests/integration/test_generation_reliability.py::test_humanization_unknown_integrity_error_reaches_default_500

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/services/content_production.py \
  backend/tests/integration/test_generation_reliability.py \
  backend/tests/unit/test_generation.py

UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml \
  backend/app/services/content_production.py

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest \
  tests/integration/test_generation_reliability.py::test_duplicate_workers_use_one_real_provider_call_and_one_content_version \
  tests/integration/test_generation_reliability.py::test_humanization_uses_real_http_and_creates_repeatable_immutable_versions \
  tests/integration/test_generation_reliability.py::test_accepted_broker_message_with_lost_metadata_is_safely_redispatched \
  tests/integration/test_generation_reliability.py::test_provider_failure_has_safe_diagnostic_code

make contract-check

git diff --check -- \
  backend/app/services/content_production.py \
  backend/tests/integration/test_generation_reliability.py \
  backend/tests/unit/test_generation.py \
  .trellis/spec/backend/error-handling.md

git diff --exit-code -- \
  contracts/openapi.yaml \
  contracts/database.md \
  docs/frontend-v2/05-business-actions-state-and-api-contract.md \
  backend/app/routers/production.py \
  backend/app/models/ai_generation.py \
  backend/alembic/versions \
  frontend/src/shared/api/generated \
  frontend/src/domains/content
```

证明目标：精确 diagnostics、两 caller 行为、事务/副作用、worker 隔离、静态质量、公共合同与只读边界零漂移。若路径受实施前既有 dirty 状态影响，先用记录的 baseline 做路径限定比较，不清理或覆盖用户文件。

## 7. Optional validation

- `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_generation.py`
- 完整 `backend/tests/integration/test_generation_reliability.py`
- `make lint`、`make typecheck`、backend unit/integration 全套
- `make verify` 仅在用户要求 release/full-scope gate 时运行一次；本窄 backend mapper 无 frontend/build/E2E 行为变化，默认不升级为 required。

跳过重型检查时，以第 6 节 targeted PostgreSQL、worker、contract、Ruff/mypy 作为替代；残余风险仅限未运行的无关模块回归。

## 8. Review 与收敛

- [ ] 主 agent 分离检查 Trellis 规划/bookkeeping 与实施 payload；实施 payload 只允许四文件，确认没有重复 comparator、宽 catch、隐藏 fallback、错误文本解析或 GENERATE/worker 行为变化。
- [ ] 独立只读 review 聚焦：constraint owner、current-head diagnostics、failed Session cleanup、replay/active 优先级、task lock 真实语义、失败副作用与零公共合同漂移。
- [ ] 一个 validation/review gate 最多两轮 `repair -> targeted re-check`；独立 review 最多一次 full review和一次 affected-path re-review。同根因复现、第二轮失败或 re-review 出现新 material issue 即停止报告。
- [ ] required targeted checks 通过后才允许一次 final/full-scope gate；失败后不在同一 turn 自动重跑。

## 9. 停止与回滚边界

出现 `design.md` 第 8 节任一停止条件，保留已取得的证据与当前 diff，停止实施并提出 `content-integrity-error-contract-decision`，不得扩大文件集合。

回滚单位为：

1. `content_production.py` 的 classifier、canonical matcher 提取与两 caller mapper；
2. 对应 integration/unit tests；
3. `error-handling.md` 的同一规则。

三者必须一致回滚；不执行 `git reset --hard`、`checkout --`、stash、宽删除或数据库 schema rollback，不触碰既有脏文件。实施完成后先展示路径受限 commit plan 并取得用户确认；不自动 commit、archive 或 push。
