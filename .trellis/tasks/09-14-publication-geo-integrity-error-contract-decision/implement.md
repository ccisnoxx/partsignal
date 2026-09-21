# Implement Plan：Publication/GEO T5 拆分

## 0. 启动边界

本文件是父任务规划，不自动授予子任务实施之外的提交、归档或发布授权。当前 T5-C 保持 `planning`；T5-I1 至 T5-I5 已完成并归档，T5-I6 于 2026-09-21 获明确实施批准并已启动。T5-G/T6 不提前创建、启动或实施。

每项遵守：一 Task 一可 review 目标、只编辑列出的 allowlist、先查真实 PostgreSQL catalog/diagnostics、最多两轮 repair/re-check、一次 full high-risk review + 最多一次 targeted re-review。所有 Task 禁止恢复全局 IntegrityError handler、解析 DB message、修改 production lock 来造竞态、手改 generated client或吸收当前无关 dirty changes。

`task.py validate` 会提示 `database-guidelines.md` 与 `error-handling.md` 超过单条 context injection 的 32768-byte 上限；JSONL 条目仍保留真实 authority，但任何后续 implementer/checker 必须在写代码前分段完整阅读这两份 spec，不能把截断注入当成完整合同。

## 1. 依赖图

```text
T1 unknown boundary（已完成，43c252da）
├─ T5-I1 publication repair source exact mapping（已完成并归档，62bb2360 / 004097bc）
│  └─ T5-I2 publication work unique mapping（已完成并归档，a96f6df2）
│     └─ T5-I3 publication open-issue unique mapping（已完成并归档，a5469871）
└─ T5-I4 GEO/ordinary shared-key race mapping（已完成并归档，d5487430）
   └─ T5-I5 GEO successor unique/code mapping（已完成并归档，7fd3ddd2）
      └─ T5-I6 GEO context/chain code reconciliation（in_progress）

T5-I1..I6 全部 required checks + 独立 review
                   │
                   ▼
T5-G publication/GEO cross-domain read-only gate
                   │
                   ▼
T6 frontend 409 recovery projection reconciliation
```

T5-I1 执行时的 catalog preflight 已确认 `fk_content_tasks_published_issue` 是 final-head `SET NULL`，未触发条件性 `publication-repair-source-fk-catalog-alignment` migration Task。

计划Task slug固定为：T5-I1`publication-repair-task-integrity-mapping`；T5-I2`publication-work-integrity-mapping`；T5-I3`publication-open-issue-integrity-mapping`；T5-I4`geo-content-task-idempotency-integrity-mapping`；T5-I5`geo-observation-successor-integrity-mapping`；T5-I6`geo-observation-context-code-reconciliation`；T5-G`publication-geo-integrity-t5-review-gate`；T6-P`frontend-publication-409-recovery-reconciliation`；T6-G`frontend-geo-409-recovery-reconciliation`；T6-C`frontend-content-task-geo-chain-recovery-reconciliation`。T5-I1至T5-I5均已完成并归档；当前实施项是已启动的T5-I6。

## 2. T5-I1（已完成并归档）：Publication Repair source 精确映射

生命周期记录：工作提交为 `62bb2360`，归档提交为 `004097bc`。以下目标、边界与验收保留为已执行基线，不因状态更新而改写。

### 可 review 目标

只让 `createPublishedContentRepairTask` 的 `23505 + uq_content_tasks_source_published_content_issue_id` 与 precheck 一致返回 `409 REPAIR_TASK_EXISTS`，同时证明 final-head FK、原子性、unknown 和 Session reuse。

### 精确文件边界

- `backend/app/services/publication.py`
- `backend/tests/integration/test_publication_workflow.py`
- `backend/tests/integration/test_migrations.py`
- `contracts/database.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/backend/publication-workbench-guidelines.md`

明确不改：router、OpenAPI、runtime metadata、ORM/migration、generated client、frontend生产/测试、其他 service。

### 可观察验收

1. 真 PostgreSQL catalog 证明 unique constraint 名准确；source FK 名为 `fk_content_tasks_published_issue`、`confdeltype='n'`/定义含 `ON DELETE SET NULL`、source nullable。
2. 合规两 Session 同 Issue 并发通过真实 `FOR UPDATE` 等待：一个创建成功，另一个 precheck `REPAIR_TASK_EXISTS`；用 `pg_stat_activity` wait/event/barrier 与有界 timeout，不使用 `sleep`。
3. test-only bypass writer 让 loser 真正收到 `23505` 且 `diag.constraint_name` 精确等于批准约束；mapper rollback 后返回与 precheck同 code/status/message/details（request ID 除外），恰一 task。
4. HTTP exact path 返回统一 ErrorEnvelope，body `request_id` 与响应 `X-Request-ID`/合法请求 ID 对账，`details={}`；不返回 winner task、不自动 replay。
5. 一个不同 constraint、缺失 diagnostics 及 trigger/guard sentinel 均不转 `REPAIR_TASK_EXISTS`/`REVISION_CONFLICT`；HTTP 为 default 500，不泄漏 SQL、表、constraint、driver message，不在 OpenAPI冻结 500 body。
6. exact mapper rollback 后同一 Session 能查询 Issue/winner；unknown direct-service case 由调用者 rollback后 Session 可用，HTTP request dependency 负责 cleanup。
7. 失败无第二 task、Issue revision/state、WorkEvent、Verification、Article、GEO source/link或 SUCCESS AuditLog；现有 event clock floor、Article永久删除、Repair Task保留且仅 source SET NULL、原 Article 来源 ContentTask 的 OPEN/CANCELLED + `revision+1` + `archived_at` 保留、AuditLog原子测试不回归。

### Required validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_publication_workflow.py backend/tests/integration/test_migrations.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/publication.py backend/tests/integration/test_publication_workflow.py backend/tests/integration/test_migrations.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
git diff --check -- backend/app/services/publication.py backend/tests/integration/test_publication_workflow.py backend/tests/integration/test_migrations.py contracts/database.md .trellis/spec/backend/database-guidelines.md .trellis/spec/backend/error-handling.md .trellis/spec/backend/publication-workbench-guidelines.md
```

### Optional validation

`UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q -ra` 只作为一次 full-suite gate；未运行时记录 targeted integration/unit + mypy/ruff 为替代证据及未覆盖仓库其他域的残余风险。

### 停止/回滚边界

- catalog 不是 final-head 定义、diagnostics 不精确、需要改 schema/status/details、或必须削弱 Issue lock 才能测试时停止。
- 回滚只删除本 Task 在上述 allowlist 的变更；不回退父任务 T1、既有 0037/0038、用户 dirty files或已提交业务历史。

## 3. T5-I2（已完成并归档）：Publication Work unique mapping

### 目标与边界

使 `createPublicationWork` 的 idempotency、content-task identity、active platform/hash 三个 exact unique 与现有 precheck/replay 一致。

文件：`backend/app/services/publication.py`、`backend/tests/integration/test_publication_workflow.py`、`contracts/database.md`、上述三份 backend spec。OpenAPI/router/runtime/generated/frontend不改。

### Required validation / 验收

- catalog/真实 23505 分别证明三个名称；第三约束、PASSED verification/Article/attachment/FK/trigger 均 unknown。
- 同 key同 `content_version_id/platform_account_id` replay；异 payload `IDEMPOTENCY_CONFLICT`。content task或active platform/hash冲突为 `PUBLICATION_IDENTITY_CONFLICT`。
- 合规 advisory/row lock 并发与 test-only bypass race 均恰一 Work；失败无 CREATED event、revision、task state、AuditLog。
- HTTP 409 envelope/request ID正确，unknown 500不泄漏，known Session reuse。
- 停止：任一约束不能由 exact diagnostics 区分、idempotency winner identity需新增 wire字段、或需要改变 event-time/锁序。

Required：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_publication_workflow.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/publication.py backend/tests/integration/test_publication_workflow.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
git diff --check -- backend/app/services/publication.py backend/tests/integration/test_publication_workflow.py contracts/database.md .trellis/spec/backend/database-guidelines.md .trellis/spec/backend/error-handling.md .trellis/spec/backend/publication-workbench-guidelines.md
```

Optional：`UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q -ra`，同一 candidate 只运行一次。

## 4. T5-I3（已完成并归档）：Publication OPEN Issue unique mapping

### 目标与边界

只使 `openPublishedContentIssue` 的 `23505 + uq_published_content_issues_one_open` 与 precheck 一致为 `PUBLISHED_CONTENT_ISSUE_CONFLICT`。

文件：`backend/app/services/publication.py`、`backend/tests/integration/test_publication_workflow.py`、`contracts/database.md`、三份 backend spec。

### Required validation / 验收

- 真 partial unique diagnostics、Article `FOR UPDATE` 合规并发、bypass unique race各自证明恰一 OPEN Issue。
- 已 RETIRED 仍由 precheck同 code处理；DB exact mapper不把其它 issue CHECK/FK/trigger转成业务冲突。
- 失败无 Issue、Repair Task、Article/Work变化、GEO link或 SUCCESS AuditLog；known Session reuse，unknown 500不泄漏。
- 若 normal lock等待测试不能有界证明，停止并报告，不移除 Article lock。

Required：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_publication_workflow.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/publication.py backend/tests/integration/test_publication_workflow.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
git diff --check -- backend/app/services/publication.py backend/tests/integration/test_publication_workflow.py contracts/database.md .trellis/spec/backend/database-guidelines.md .trellis/spec/backend/error-handling.md .trellis/spec/backend/publication-workbench-guidelines.md
```

Optional：`UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q -ra`，同一 candidate 只运行一次。

## 5. T5-I4（已完成并归档）：GEO/ordinary shared idempotency key race

### 目标与边界

只补 `createGeoOptimizationContentTask` 的 exact `uq_content_tasks_idempotency_key` race recovery，冻结双向 source-kind identity；ordinary owner只读回归，不顺带重构。

文件：`backend/app/services/geo_observation.py`、`backend/tests/integration/test_geo_insights.py`、`contracts/database.md`、`.trellis/spec/backend/database-guidelines.md`、`.trellis/spec/backend/error-handling.md`。

### Required validation / 验收

- ordinary先提交、GEO先提交及双方绕过precheck的 race排列；跨 kind永远 `IDEMPOTENCY_CONFLICT`，同 GEO完整 identity才 replay。
- 真实 `23505 + uq_content_tasks_idempotency_key`；winner不存在或必要 ContentTask identity不完整时原抛 unknown；完整 ordinary winner（无 GEO source）明确返回 `IDEMPOTENCY_CONFLICT`；GEO source存在时按完整 identity replay/conflict，source自身不完整才 unknown。
- task/source同事务，失败无 source-less task、GEO relation、AuditLog或 revision；rollback后 Session reuse。
- HTTP 409 envelope/request ID与unknown 500不泄漏。
- 停止：必须改 ordinary service/shared abstraction、schema或 wire 才能完成时，另做独立设计，不在本 Task扩张。

Required：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_insights.py backend/tests/integration/test_content_task_creation.py backend/tests/integration/test_publication_workflow.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/geo_observation.py backend/tests/integration/test_geo_insights.py backend/tests/integration/test_content_task_creation.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
git diff --check -- backend/app/services/geo_observation.py backend/tests/integration/test_geo_insights.py contracts/database.md .trellis/spec/backend/database-guidelines.md .trellis/spec/backend/error-handling.md
```

Optional：`UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests -q -ra`，同一 candidate 只运行一次。

## 6. T5-I5（已完成并归档）：GEO successor unique 与 blocker code

### 目标与边界

把 `createGeoObservation` 的“已有 successor” precheck和 `23505 + uq_geo_observations_supersedes_once` 统一为 `409 GEO_OBSERVATION_HAS_SUCCESSOR`；不处理其余 11 个 producer。

文件：`backend/app/services/geo_observation.py`、`backend/tests/integration/test_geo_observation_correction.py`、`contracts/database.md`、`docs/frontend-v2/05-business-actions-state-and-api-contract.md`、`docs/frontend-v2/08-testing-quality-and-acceptance.md`、`.trellis/spec/backend/database-guidelines.md`、`.trellis/spec/backend/error-handling.md`、`.trellis/spec/frontend/component-guidelines.md`、`.trellis/spec/frontend/state-management.md`。前端生产代码仍不改。

### Required validation / 验收

- 两 Session同 supersedes target：恰一 successor；precheck和真 unique loser同 code/status/details，known Session reuse。
- observation/publication/attachment不可变且同事务；失败无半写入或成功 AuditLog。
- HTTP envelope/request ID、unknown constraint/trigger 500不泄漏；不改变 OpenAPI/runtime/generated。
- 停止：新 code需要 status/details/schema改变时走独立 contract-first Task。

Required：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_observation_correction.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/geo_observation.py backend/tests/integration/test_geo_observation_correction.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
git diff --check -- backend/app/services/geo_observation.py backend/tests/integration/test_geo_observation_correction.py contracts/database.md docs/frontend-v2/05-business-actions-state-and-api-contract.md docs/frontend-v2/08-testing-quality-and-acceptance.md .trellis/spec/backend/database-guidelines.md .trellis/spec/backend/error-handling.md .trellis/spec/frontend/component-guidelines.md .trellis/spec/frontend/state-management.md
```

Optional：`npm --prefix frontend run test -- src/domains/geo/geo.api.test.ts src/domains/geo/geo-observation-correction-page.test.tsx` 作为 T6 前只读兼容性探针；backend full suite同一 candidate最多运行一次。

## 7. T5-I6（in_progress）：GEO context/chain code reconciliation

### 目标与边界

把剩余 11 个非 revision producer按一个可 review 目标改为：10 个 `GEO_OBSERVATION_CONTEXT_INCOMPLETE`，锁后 chain-set变化为 `GEO_OBSERVATION_CHAIN_CHANGED`；保持 409和 `{}`。

文件：`backend/app/services/geo_observation.py`、`backend/tests/integration/test_geo_observation_correction.py`、`backend/tests/integration/test_geo_observation_detail.py`、拟新增 `backend/tests/integration/test_geo_observation_deletion.py`、`backend/tests/integration/test_publication_workflow.py`（只覆盖共享 content-task preview/delete/permanent-delete 调用面）、`docs/frontend-v2/05-business-actions-state-and-api-contract.md`、`docs/frontend-v2/08-testing-quality-and-acceptance.md`、`.trellis/spec/backend/error-handling.md`、`.trellis/spec/frontend/component-guidelines.md`、`.trellis/spec/frontend/state-management.md`。`publication.py`、OpenAPI/router/runtime/generated/frontend production不改。

### Required validation / 验收

- 逐 producer及真实 operation owner精确 code断言；detail/context不返回部分历史，GEO与content-task delete失败不删任何链节点/relation/file或写 SUCCESS AuditLog，preview零写入。
- REPEATABLE READ detail/correction snapshot、root/tail/selected/history、event `tested_at` 与 frozen publication identity不回归。
- chain changed只允许显式刷新；context incomplete保持 blocked；unknown trigger/guard不映射为任何 409。
- 停止：为构造 branch/cycle需要永久弱化 schema；只能用事务内 test fixture/直接 SQL并完整清理。

Required：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_observation_correction.py backend/tests/integration/test_geo_observation_detail.py backend/tests/integration/test_geo_observation_deletion.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_publication_workflow.py -q -ra
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_runtime_response_metadata.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app/services/geo_observation.py backend/tests/integration/test_geo_observation_correction.py backend/tests/integration/test_geo_observation_detail.py backend/tests/integration/test_geo_observation_deletion.py backend/tests/integration/test_publication_workflow.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
git diff --check -- backend/app/services/geo_observation.py backend/tests/integration/test_geo_observation_correction.py backend/tests/integration/test_geo_observation_detail.py backend/tests/integration/test_geo_observation_deletion.py backend/tests/integration/test_publication_workflow.py docs/frontend-v2/05-business-actions-state-and-api-contract.md docs/frontend-v2/08-testing-quality-and-acceptance.md .trellis/spec/backend/error-handling.md .trellis/spec/frontend/component-guidelines.md .trellis/spec/frontend/state-management.md
```

Optional：`npm --prefix frontend run test -- src/domains/geo/geo.api.test.ts src/domains/geo/geo-observation-correction-page.test.tsx src/domains/geo/geo-observation-detail-page.test.tsx` 作为 T6 前只读兼容性探针；backend full suite同一 candidate最多运行一次。

## 8. T5-G：跨域只读完成 gate

目标是只读确认 T5-I1..I6 的 code/constraint matrix、文档、测试和实际 diff无矛盾，不承担新功能。输入包括各 Task closeout、真实 PG diagnostics证据、OpenAPI/runtime/generated zero-diff证明和独立 review报告。

完成条件：

- publication/GEO allowlist之外无行为变更；unknown handler仍不存在；所有 trigger/FK/check/不稳定 diagnostics反例保持 unknown。
- event time、append-only、删除事务、revision/state、AuditLog、GEO link与Session语义全部通过 required checks。
- database contract、Frontend V2、backend/frontend stable specs与代码一致。
- 每项高风险 review已完成，且无未解决 material finding。

T5-G 完成前不得创建、启动或实施 T6。

T5-I5/I6会改变wire code，但按用户要求先完成T5、再进入T6；因此T5-I5到T6构成同一release-atomic train。I5至少等待T6-G；I6必须同时等待T6-G与T6-C，二者完成前禁止部署或发布相关backend code。T5先冻结并实现server authority，T6随后按code更新各自projection consumer；若发布流程无法保证这一gate，停止并将对应backend+frontend变更合并为一个原子实施Task。

## 9. T6：Frontend 409 recovery projection reconciliation

T6只在T5-G后进入，并按“一Task一目标”拆成publication、GEO与共享content-task lifecycle三个前端Task；它们分别拥有T6-P、T6-G、T6-C的consumer。generated client仅在上游真实OpenAPI diff时由生成命令更新；本规划的code-only决定预期没有generated diff。

### T6-P：Publication 409 projection reconciliation

目标：让 `REPAIR_TASK_EXISTS` 显式 reload issue workspace/repair context而不采用空 details或自动 replay；区分 Work identity/idempotency/context/revision；修正测试假码 `PUBLICATION_REVISION_CONFLICT`。

精确文件 allowlist：

- `frontend/src/domains/publication/publication.api.ts`
- `frontend/src/domains/publication/publication.api.test.ts`
- `frontend/src/domains/publication/published-content-issue-workspace-actions.tsx`
- `frontend/src/domains/publication/published-content-issue-workspace-page.tsx`
- `frontend/src/domains/publication/published-content-issue-workspace-page.test.tsx`
- `frontend/src/domains/publication/publication-workspace-actions.tsx`
- `frontend/src/domains/publication/publication-workspace-page.test.tsx`
- `frontend/src/domains/publication/start-publication-dialog.tsx`
- `frontend/src/domains/publication/publication-work-page.test.tsx`
- `frontend/src/domains/publication/published-article-detail-page.tsx`
- `frontend/src/domains/publication/published-article-detail-page.test.tsx`
- `frontend/tests/e2e/fixtures/publication.fixture.ts`
- `frontend/tests/e2e/publication-workspace.spec.ts`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/state-management.md`

Required：

```bash
npm --prefix frontend run test -- src/domains/publication/publication.api.test.ts src/domains/publication/published-content-issue-workspace-page.test.tsx src/domains/publication/publication-workspace-page.test.tsx src/domains/publication/publication-work-page.test.tsx src/domains/publication/published-article-detail-page.test.tsx
npm --prefix frontend run typecheck
npm --prefix frontend exec -- eslint --max-warnings 0 frontend/src/domains/publication/publication.api.ts frontend/src/domains/publication/publication.api.test.ts frontend/src/domains/publication/published-content-issue-workspace-actions.tsx frontend/src/domains/publication/published-content-issue-workspace-page.tsx frontend/src/domains/publication/published-content-issue-workspace-page.test.tsx frontend/src/domains/publication/publication-workspace-actions.tsx frontend/src/domains/publication/publication-workspace-page.test.tsx frontend/src/domains/publication/start-publication-dialog.tsx frontend/src/domains/publication/publication-work-page.test.tsx frontend/src/domains/publication/published-article-detail-page.tsx frontend/src/domains/publication/published-article-detail-page.test.tsx frontend/tests/e2e/fixtures/publication.fixture.ts frontend/tests/e2e/publication-workspace.spec.ts
npm --prefix frontend run e2e -- tests/e2e/publication-workspace.spec.ts
git diff --check -- frontend/src/domains/publication/publication.api.ts frontend/src/domains/publication/publication.api.test.ts frontend/src/domains/publication/published-content-issue-workspace-actions.tsx frontend/src/domains/publication/published-content-issue-workspace-page.tsx frontend/src/domains/publication/published-content-issue-workspace-page.test.tsx frontend/src/domains/publication/publication-workspace-actions.tsx frontend/src/domains/publication/publication-workspace-page.test.tsx frontend/src/domains/publication/start-publication-dialog.tsx frontend/src/domains/publication/publication-work-page.test.tsx frontend/src/domains/publication/published-article-detail-page.tsx frontend/src/domains/publication/published-article-detail-page.test.tsx frontend/tests/e2e/fixtures/publication.fixture.ts frontend/tests/e2e/publication-workspace.spec.ts docs/frontend-v2/05-business-actions-state-and-api-contract.md docs/frontend-v2/08-testing-quality-and-acceptance.md .trellis/spec/frontend/component-guidelines.md .trellis/spec/frontend/state-management.md
```

Optional：`npm --prefix frontend run test` 与 `npm --prefix frontend run build`，同一 candidate各最多一次。停止条件：需要后端返回 existing repair ID、新 details/status/schema或需要改变 server transition时停止并回到 contract-first T5修订。回滚仅限上述文件。

### T6-G：GEO 409 projection reconciliation

目标：`GEO_OBSERVATION_HAS_SUCCESSOR`/`GEO_OBSERVATION_CHAIN_CHANGED` 保留草稿并显式 refresh，`GEO_OBSERVATION_CONTEXT_INCOMPLETE`保持 blocked，unknown 500 generic no-replay；delete chain changed不得自动重发 DELETE。

精确文件 allowlist：

- `frontend/src/domains/geo/geo.api.ts`
- `frontend/src/domains/geo/geo.api.test.ts`
- `frontend/src/domains/geo/geo-observation-correction-page.tsx`
- `frontend/src/domains/geo/geo-observation-correction-page.test.tsx`
- `frontend/src/domains/geo/geo-observation-detail-page.tsx`
- `frontend/src/domains/geo/geo-observation-detail-page.test.tsx`
- `frontend/src/domains/geo/geo-observation-list-page.tsx`
- `frontend/src/domains/geo/geo-observation-list-page.test.tsx`
- `frontend/src/routes/_app/geo/observations/$observationId_.correct.tsx`
- `frontend/tests/e2e/fixtures/geo-correction.fixture.ts`
- `frontend/tests/e2e/fixtures/geo.fixture.ts`
- `frontend/tests/e2e/geo-observation-correction.spec.ts`
- `frontend/tests/e2e/geo-observation-detail.spec.ts`
- `frontend/tests/e2e/geo-observations.spec.ts`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/state-management.md`

Required：

```bash
npm --prefix frontend run test -- src/domains/geo/geo.api.test.ts src/domains/geo/geo-observation-correction-page.test.tsx src/domains/geo/geo-observation-detail-page.test.tsx src/domains/geo/geo-observation-list-page.test.tsx
npm --prefix frontend run typecheck
npm --prefix frontend exec -- eslint --max-warnings 0 frontend/src/domains/geo/geo.api.ts frontend/src/domains/geo/geo.api.test.ts frontend/src/domains/geo/geo-observation-correction-page.tsx frontend/src/domains/geo/geo-observation-correction-page.test.tsx frontend/src/domains/geo/geo-observation-detail-page.tsx frontend/src/domains/geo/geo-observation-detail-page.test.tsx frontend/src/domains/geo/geo-observation-list-page.tsx frontend/src/domains/geo/geo-observation-list-page.test.tsx 'frontend/src/routes/_app/geo/observations/$observationId_.correct.tsx' frontend/tests/e2e/fixtures/geo-correction.fixture.ts frontend/tests/e2e/fixtures/geo.fixture.ts frontend/tests/e2e/geo-observation-correction.spec.ts frontend/tests/e2e/geo-observation-detail.spec.ts frontend/tests/e2e/geo-observations.spec.ts
npm --prefix frontend run e2e -- tests/e2e/geo-observation-correction.spec.ts tests/e2e/geo-observation-detail.spec.ts tests/e2e/geo-observations.spec.ts
git diff --check -- frontend/src/domains/geo/geo.api.ts frontend/src/domains/geo/geo.api.test.ts frontend/src/domains/geo/geo-observation-correction-page.tsx frontend/src/domains/geo/geo-observation-correction-page.test.tsx frontend/src/domains/geo/geo-observation-detail-page.tsx frontend/src/domains/geo/geo-observation-detail-page.test.tsx frontend/src/domains/geo/geo-observation-list-page.tsx frontend/src/domains/geo/geo-observation-list-page.test.tsx 'frontend/src/routes/_app/geo/observations/$observationId_.correct.tsx' frontend/tests/e2e/fixtures/geo-correction.fixture.ts frontend/tests/e2e/fixtures/geo.fixture.ts frontend/tests/e2e/geo-observation-correction.spec.ts frontend/tests/e2e/geo-observation-detail.spec.ts frontend/tests/e2e/geo-observations.spec.ts docs/frontend-v2/05-business-actions-state-and-api-contract.md docs/frontend-v2/08-testing-quality-and-acceptance.md .trellis/spec/frontend/component-guidelines.md .trellis/spec/frontend/state-management.md
```

Optional：`npm --prefix frontend run test` 与 `npm --prefix frontend run build`，同一 candidate各最多一次。停止条件：需要猜测 chain/winner、跨 endpoint拼装 canonical context、改变 backend details/status/schema或自动重放 mutation/delete时停止。回滚仅限上述文件。

### T6-C：Content task GEO chain recovery reconciliation

目标：让共享content-task consumer按GEO chain code恢复，而不是继续把所有409混为自动invalidation。`getContentTaskPermanentDeletionPreview`遇到`GEO_OBSERVATION_CONTEXT_INCOMPLETE`或`GEO_OBSERVATION_CHAIN_CHANGED`时不得使用旧preview，只允许用户显式reload；普通DELETE保持blocked/no replay；permanent-delete POST收到chain changed后使旧preview和确认文本失效，必须显式刷新/重开并重新确认。

精确文件allowlist：

- `frontend/src/domains/content/content-task-lifecycle.tsx`
- `frontend/src/domains/content/content-task-list-page.test.tsx`
- `frontend/src/domains/content/content-task-detail-page.test.tsx`
- `frontend/tests/e2e/fixtures/content.fixture.ts`
- `frontend/tests/e2e/content-task-list.spec.ts`
- `frontend/tests/e2e/content-task-detail.spec.ts`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/state-management.md`

`frontend/src/domains/content/content.api.ts`现有`ContentRequestError`已保留status/code/request ID；T6-C先以只读证据复核，除非实际contract缺口要求，否则不加入production allowlist。禁止解析message或创建第二套code registry。

Required：

```bash
npm --prefix frontend run test -- src/domains/content/content-task-list-page.test.tsx src/domains/content/content-task-detail-page.test.tsx
npm --prefix frontend run typecheck
npm --prefix frontend exec -- eslint --max-warnings 0 frontend/src/domains/content/content-task-lifecycle.tsx frontend/src/domains/content/content-task-list-page.test.tsx frontend/src/domains/content/content-task-detail-page.test.tsx frontend/tests/e2e/fixtures/content.fixture.ts frontend/tests/e2e/content-task-list.spec.ts frontend/tests/e2e/content-task-detail.spec.ts
npm --prefix frontend run e2e -- tests/e2e/content-task-list.spec.ts tests/e2e/content-task-detail.spec.ts
git diff --check -- frontend/src/domains/content/content-task-lifecycle.tsx frontend/src/domains/content/content-task-list-page.test.tsx frontend/src/domains/content/content-task-detail-page.test.tsx frontend/tests/e2e/fixtures/content.fixture.ts frontend/tests/e2e/content-task-list.spec.ts frontend/tests/e2e/content-task-detail.spec.ts docs/frontend-v2/05-business-actions-state-and-api-contract.md docs/frontend-v2/08-testing-quality-and-acceptance.md .trellis/spec/frontend/component-guidelines.md .trellis/spec/frontend/state-management.md
```

Optional：`npm --prefix frontend run test`与`npm --prefix frontend run build`，同一candidate各最多一次。停止条件：需要新backend details/status/schema、跨endpoint拼接GEO chain、自动重放普通DELETE/permanent-delete POST、或T6-C必须修改GEO页面时停止。回滚仅限上述文件。

## 10. 统一回滚边界

- 每个实现 Task只回滚自己的 allowlist diff，不回滚已提交 T1或前序 Task；若后序发现前序设计错误，停止并新建有明确目标的修复 Task。
- migration条件任务若发生，upgrade前先备份/预检；unsafe downgrade明确失败并依赖备份恢复，不伪造可逆性。
- 不触碰当前 `.gitignore`、staged artifacts删除、`backend/app/schemas/configuration.py` 或任何其他无关 dirty files；不执行 `git add -A`、`git add .`、`commit -a`、stash/reset/checkout/clean/push。
