# Implement

> 用户已批准规划并进入实施；任务当前为`in_progress`。提交、归档与push仍未授权。

## Phase 1: Preflight and allowlist baseline

1. 重新读取本任务`prd.md/design.md/implement.md`、两个JSONL、T5-C冻结决策及三份backend spec全文。
2. 确认T1 `43c252da`、T5-I1 `62bb2360`和T5-C规划基线仍可达；实施开始后本任务为`in_progress`，T5-C与顶层父任务仍为`planning`，T5-I1仍`completed/archived`。
3. 记录`git status --short`及implementation allowlist、zero-diff owner的HEAD基线；所有其他dirty/staged文件保持不动。禁止`git add -A`、`git add .`、`commit -a`、stash、reset、checkout、clean。
4. 在现有临时PostgreSQL head fixture中先完成三个catalog/diagnostics sentinel。任一不满足即停止，不进入service/spec修改。

## Phase 2: Tests first

在`backend/tests/integration/test_publication_workflow.py`建立可复用且有界的fixture/helper：

1. catalog断言与三个真实`23505 + exact constraint_name`正例。
2. precheck：同key同payload replay、同key异payload、content-task identity、active platform/hash，并冻结现有code/message/status/details。
3. 合规双Session advisory/row-lock竞争，使用event/barrier和`pg_stat_activity`证明等待及winner提交后的single-work结果。
4. test-only bypass双Session race：用session-scoped替代读取保留全部production校验但省略`FOR UPDATE`，并仅跳过目标advisory/precheck；以连接事件、`pg_stat_activity.query`和`pg_blocking_pids`证明loser等待在真实Work INSERT，而不是任意锁；分别证明三个约束和幂等恢复优先级。production lock/schema不修改。
5. 统一失败副作用快照、known与unknown Session reuse。
6. HTTP exact/precheck 409 ErrorEnvelope/request-ID对账，以及真实无关IntegrityError的unknown 500 no-leak。
7. synthetic classifier负矩阵：其他unique、Verification/Article/Attachment、FK/CHECK/trigger、缺失及不稳定diagnostics均fail closed。
8. 既有event-time、publication workflow、不可变历史和删除事务回归继续由本文件完整执行覆盖。

## Phase 3: Narrow implementation

1. 在`backend/app/services/publication.py`把identity precheck从content-version改为content-task，保持调用位置、active hash判断和错误tuple。
2. 在Work首个flush owner加入只识别三个exact pair的局部classifier/recovery；known先root rollback，unknown原抛。
3. rollback后先按idempotency key解析winner：同完整identity canonical replay，异payload `IDEMPOTENCY_CONFLICT`；没有同key winner的content-task/active冲突为`PUBLICATION_IDENTITY_CONFLICT`；无法证明则unknown。
4. 不包围event/finish/verification/article/attachment/audit flush，不改锁顺序、event clock、状态机、revision或删除事务。
5. 更新`contracts/database.md`和三份backend spec；不修改任何其他production、contract或frontend owner。

## Phase 4: Required validation

按下列顺序执行；targeted失败后只修复本任务归因问题。验证与后续review共享总计最多两轮repair/re-check预算：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_publication_workflow.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/publication.py backend/tests/integration/test_publication_workflow.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
npm --prefix frontend run api:check
git diff --check -- backend/app/services/publication.py backend/tests/integration/test_publication_workflow.py contracts/database.md .trellis/spec/backend/database-guidelines.md .trellis/spec/backend/error-handling.md .trellis/spec/backend/publication-workbench-guidelines.md .trellis/tasks/09-14-publication-work-integrity-mapping .trellis/tasks/09-14-publication-geo-integrity-error-contract-decision/task.json
git diff --exit-code HEAD -- contracts/openapi.yaml backend/app/routers/publication.py backend/app/main.py backend/app/errors.py backend/app/schemas/common.py backend/app/schemas/publication.py backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py frontend/src frontend/tests frontend/package.json frontend/package-lock.json frontend/scripts
```

最后用精确path status/diff确认implementation diff仅为六个owner文件和本任务Trellis工件；既有无关dirty/staged状态与preflight记录一致。

## Optional full-suite gate

同一candidate最多运行一次：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q -ra
```

若不运行，closeout必须注明required integration/unit、ruff和完整app mypy为替代证据，以及未覆盖其他backend domain suite的残余风险；若collection/environment失败，准确归因，不清理用户缓存或越界修复后重跑该一次性gate。

## Phase 5: Independent review gate

required checks通过后执行一次独立高风险只读full review，覆盖：

- 三个diagnostics exact allowlist及所有unknown反例；
- 幂等winner优先级、完整identity与canonical replay；
- content-task precheck、production锁顺序、test-only race和single winner；
- root rollback、Session reuse、失败副作用、HTTP envelope/no-leak；
- event-time、append-only/immutable history、删除事务、revision/state/AuditLog；
- OpenAPI/runtime/generated/frontend零差异及实际diff allowlist。

full review发现material问题时，在上述总计两轮repair/re-check预算仍有余额的前提下，只允许一次targeted repair与一次targeted re-review；该review repair计入总预算，不形成第三轮。已关闭问题不得借机扩展到T5-I3、GEO或T6。若预算用尽或re-review仍有material finding，停止并报告。

## Completion boundary

实现和review均通过后，先向用户报告实际diff、验证、review finding和残余风险；提交、归档、push均需要届时明确授权。无论结果如何，不归档T5-C或顶层`integrity-error-domain-mapping`，不自动进入下一项任务。

## Execution record（2026-09-15）

- 用户批准规划后已执行`task.py start`，任务保持`in_progress`；未提交、未归档、未push。
- required integration通过：`backend/tests/integration/test_publication_workflow.py`共57项通过。
- contract/runtime unit、精确ruff、完整`backend/app` mypy、`frontend api:check`、allowlist `git diff --check`及protected owner零差异检查均通过。
- `task.py validate`通过；仅保留`database-guidelines.md`与`error-handling.md`在两个JSONL中的四条已知context injection大小警告，未重写稳定spec。
- 可选full backend suite按单次预算运行一次，在collection阶段因integration/unit同名`test_geo_insights.py`导入错配退出；未进入测试，未清理用户缓存，也未重跑。
- 独立高风险只读full review未发现material finding；未使用targeted repair/re-review额度。
