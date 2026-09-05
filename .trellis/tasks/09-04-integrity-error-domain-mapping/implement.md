# IntegrityError 领域错误映射实施计划

> 状态：planning-only。本文件是后续任务拆分与验证计划，不授权执行。当前任务不得运行 `task.py start`。

## Phase 0：规划完成门槛（本 Task）

### 0.1 权威证据

- [x] 读取项目指令、Trellis workflow、backend error/database specs 与 Frontend V2 行为/验收文档。
- [x] 读取已归档 Frontend V2 baseline、non-2xx parent 及全部子任务、complete response gate 和相关前置任务。
- [x] 静态审计 0001–0043 Alembic migration、当前 ORM models、冻结 migration schema 与 `contracts/database.md`。
- [x] 审计所有 `IntegrityError` import/catch、service flush/commit、全局 handler、相关 routers/operationId。
- [x] 审计 ErrorEnvelope、OpenAPI/runtime metadata、generated client、contract tests、PostgreSQL integration tests和前端 409 consumer。
- [x] 建立 constraint-to-domain-error matrix、事务设计、测试策略和拆分方案。

### 0.2 本 Task 交付物

- [x] `prd.md`
- [x] `design.md`
- [x] `implement.md`
- [x] `research/database-constraint-matrix.md`
- [x] `research/database-constraint-companion.csv`
- [x] `research/backend-integrity-paths.md`
- [x] `research/revision-conflict-producer-inventory.md`
- [x] `research/transaction-handler-design.md`
- [x] `research/api-frontend-impact.md`
- [x] `research/testing-strategy.md`
- [x] `research/domain-spec-evidence.md`
- [x] `research/prior-task-evidence.md`

### 0.3 本 Task 不执行

- [ ] 不运行 `task.py start`。
- [ ] 不修改 production code、tests、contracts、database、migration、generated client、frontend 或稳定 specs。
- [ ] 不运行数据库写入测试或线上请求。
- [ ] 不创建/启动以下后续 Task。
- [ ] 不 commit、archive 或 push。

## Phase 1：T1 unknown IntegrityError boundary correction

### 1.1 目标与依赖

- 目标：撤销全局 `IntegrityError -> REVISION_CONFLICT` 业务伪装；unknown 进入框架现有 server-error boundary。
- 依赖：本 planning task 经用户 review/批准；无其他代码 task 依赖。
- 不新增公共 error code/status/schema，不改变已知 service-owned mapper。

### 1.2 精确文件边界

- `backend/app/errors.py`
- `backend/app/main.py`
- `backend/tests/integration/test_ai_channel_management.py`（新增 AI Model duplicate unknown sentinel）
- `backend/tests/unit/test_runtime_response_metadata.py`（仅证明没有误注册/metadata 漂移，不冻结 500 body）
- `.trellis/spec/backend/error-handling.md`

`backend/tests/integration/test_platform_types.py` 与 `backend/tests/unit/test_contract.py` 只读作为 required validation target，不进入修改边界。禁止：`contracts/openapi.yaml`、generated client、frontend、service mapping、migration/schema。

### 1.3 实施步骤

1. 先用真实 PostgreSQL catalog/异常捕获确认 AI Model duplicate 的 SQLSTATE 与最终 constraint name；记录证据。
2. 添加 targeted HTTP sentinel：`TestClient(..., raise_server_exceptions=False)` 或项目等价 transport，应用 `debug=False`。
3. 删除专用 handler 和注册；保留 AppError/validation handler。
4. 断言 unknown 为 500、不是 `REVISION_CONFLICT`、响应不泄露 SQL/表/约束/stack。
5. 断言失败无第二行、无成功审计、revision 不变、后续查询可用。
6. 更新 error-handling spec 的 unknown boundary 描述，不定义新的稳定 JSON 500 contract。
7. 复跑一个真正 revision conflict 与一个正确 unique mapper 回归。

### 1.4 Required validation

命令在后续 Task 的实际环境中根据新增 nodeid 固化；最低集合：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_ai_channel_management.py -k 'unknown_integrity or duplicate_model'

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_platform_types.py -k 'duplicate or revision'

make contract-check
```

若 sentinel 落在新文件，第一条替换为精确 test nodeid，不用宽 `-k` 掩盖零收集。

### 1.5 Optional validation

- backend unit 全套；
- backend integration 全套；
- typecheck/lint；
- frontend typecheck（本 Task 无前端或 generated diff，非直接证明）。

### 1.6 Review / stop / rollback

- 独立只读 review：全局 exception ownership、敏感信息、Session cleanup、无 public 500 contract。
- targeted gate 最多两轮 repair/re-check；同根因复现即停止。
- 回滚粒度为 handler/registration + sentinel + spec；不得只恢复 handler 而保留相反 spec。

### 1.7 Acceptance criteria

- [ ] unknown real PostgreSQL `IntegrityError` 不返回 409/`REVISION_CONFLICT`。
- [ ] 默认 500 不泄漏 SQL、表、约束、DB message 或 stack。
- [ ] 未新增 `INTERNAL_ERROR` 等猜测 code，OpenAPI/generated 无 diff。
- [ ] 失败无成功 AuditLog、第二行、revision 或 failed Session 残留。
- [ ] 真正 revision conflict 和至少一个正确 constraint mapper 不回归。
- [ ] diff 仅限 1.2 的文件边界。

## Phase 2：T2 configuration identity constraints

### 2.1 目标

- 将 platform profile slug、Prompt name 的 catch 改为最终 DB constraint name 精确匹配。
- 保留并强化 platform type slug、platform account normalized identifier 的正确映射。
- AI Header/Model identity duplicate 不在 T2 内新增 code；没有独立 T2-C contract decision 前保持 unknown。

### 2.2 文件边界

- `backend/app/services/platform_configuration.py`
- `backend/app/services/content_planning.py`：仅 platform profile 创建路径（update schema 不写 slug）
- `backend/app/services/publication.py`：仅 platform account helper
- `backend/tests/integration/test_platform_types.py`
- `backend/tests/integration/test_platform_accounts.py`
- `backend/tests/integration/test_platform_profile_list.py`
- `backend/tests/integration/test_platform_workspace.py`
- `backend/tests/integration/test_prompt_preview_options.py`
- `backend/tests/unit/test_audit.py`
- `backend/tests/unit/test_configuration_audit.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/ai-configuration-guidelines.md`（T2-C 语义同步，见下）

T2 不改 router、OpenAPI、generated client 或 frontend；如证据要求 status/schema 变化，停止并先建 T2-C，边界固定为 `contracts/openapi.yaml`、`backend/app/routers/configuration.py`、`planning.py`、`publication.py`、`backend/tests/unit/test_contract.py`、`test_runtime_response_metadata.py`、`frontend/src/shared/api/generated/schema.d.ts` 及 configuration mapper/tests。

T2-C 还必须先处理 `putContentHumanizationPrompt` 的已知语义误用：`backend/app/services/platform_configuration.py:745-792` 在全局自然化 Prompt 不存在但请求携带 `expected_revision` 时返回 `REVISION_CONFLICT`，这是资源不存在与 revision 过期混淆，不属于 IntegrityError mapper。T2-C owner 先冻结“不存在 + expected_revision”的既有/新 code、message、details、status 与前端恢复政策；冻结后由 T2 实现，涉及 `platform_configuration.py:745-792`、`backend/app/routers/configuration.py:321-340`、`backend/tests/integration/test_platform_workspace.py`（新增行为测试），以及必要的 `backend/tests/unit/test_contract.py`、`backend/tests/unit/test_runtime_response_metadata.py`。T2-C 文档/spec owner 为 `.trellis/spec/backend/ai-configuration-guidelines.md:44-49,61-64`；若语义或 wire/status/code 变化，依 contract decision 同步该 spec、OpenAPI/generated/frontend。依赖是 T1 完成及 T2-C decision 完成。验收需区分资源缺失和 stale revision，成功首次创建仍允许空 expected revision，失败无 Prompt/成功审计/部分写入；不得在本 planning 文档预先决定新 code，也不得把该分支归入 IntegrityError mapper。

### 2.3 Required validation

- 真实 catalog 名与 `23505` diagnostics；
- 每个 unique 的预检与数据库 race 同 code/details；
- 两连接 barrier：一成功、一领域错误；
- 失败无 audit/revision/profile/header/model 部分状态；
- 受影响 operation 的 HTTP ErrorEnvelope 与 contract/generated gate。

### 2.4 Stop condition

- migration 与 ORM 名称不同时，以真实 head catalog 为准；若必须重命名约束，停止并另立 migration task。
- AI identity 新 code 未获产品/合同批准时，不实现猜测映射。

## Phase 3：T3 identity account constraints

### 3.1 目标

- 复用已获批 T3-C 的 `409 USER_USERNAME_EXISTS`；预检与 `23505 + uq_users_username` race 返回一致结果，其他 diagnostics 保持 unknown。
- 保留 delete user 的 command-scoped `23503 -> USER_IN_USE` 固定 fallback；用两种确定性锁序场景和一条独立真实 `23503` fallback sentinel 证明最终数据库防线，不再要求引用穿透现有 User row lock。

### 3.2 文件边界

- `backend/app/services/identity.py`
- `backend/tests/integration/test_identity_management.py`
- `frontend/src/domains/identity/user-list.model.ts`
- `frontend/src/domains/identity/user-list.model.test.ts`
- `frontend/src/domains/identity/user-list-page.tsx`
- `frontend/src/domains/identity/user-list-page.test.tsx`
- `contracts/database.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/frontend/state-management.md`

`contracts/openapi.yaml`、`backend/app/routers/identity.py`、`backend/tests/unit/test_contract.py`、`backend/tests/unit/test_runtime_response_metadata.py`、`backend/app/errors.py`、identity ORM/migration schema、`frontend/src/domains/identity/user.api.ts`、generated schema 与 `.trellis/spec/backend/error-handling.md` 只作为零 diff validation targets。

进入 T3 前必须完成并批准 `09-05-identity-integrity-error-contract-decision` 的 targeted re-review；该 T3-C 永不执行 `task.py start`。批准后另建 `identity-integrity-error-domain-mapping` implementation child，由新 child 自有 reviewable 三份规划与真实 `implement.jsonl`/`check.jsonl`，显式写明对 T3-C 的依赖，并只启动新 child。

### 3.3 Required validation

- duplicate username 双事务 race：恰一 user + 一准确 field/domain error；
- 删除锁序 A：引用事务先持有真实 FK row，delete 被数据库观测为等待；引用提交后 delete precheck 返回 `USER_IN_USE + details.references`，用户与引用仍存在；
- 删除锁序 B：delete 已持有 User `FOR UPDATE` 并完成零引用 precheck，引用写入被数据库观测为等待；delete 提交后引用方得到真实 `23503`，最终无用户、无引用、无悬空行；
- delete fallback sentinel：已提交真实引用加 test-only counter bypass，使 delete flush 命中真实 `23503`，返回固定 `USER_IN_USE` message 与 `{}`，用户/引用仍存在；
- 锁序测试使用 test-only event/barrier、`pg_stat_activity` wait 证据和有界 timeout，不使用 `sleep`，不修改 production lock；
- 无 `user.created`/`user.deleted` 成功审计残留；
- 真正 expected_revision 仍为 `REVISION_CONFLICT`；
- contract/runtime/generated 零 diff，frontend projection、定向 ESLint、backend Ruff/mypy、`git diff --check` 一致通过；正式 gate 只运行一次，`make verify` 若被选择则替代单独 `make contract-check`。

## Phase 4：T4 content/generation constraints

### 4.1 目标

- `createHumanizationJob` 与 HUMANIZE `retryGenerationJob` 仅按 idempotency unique 与 active-humanization partial unique 映射。
- content task、generation job、content/fact version 的 unique/partial unique 由各 command owner 决定重放、domain conflict 或 unknown。
- CHECK/NOT NULL/不可变 trigger 默认内部失败，不包装为 409。

### 4.2 文件边界

- `backend/app/services/content_planning.py`：content task 部分
- `backend/app/services/content_production.py`
- `backend/app/services/generation.py`：仅 worker source-job unique/failure owner
- `backend/app/services/review.py`
- `backend/app/routers/planning.py`
- `backend/app/routers/production.py`
- `backend/app/routers/product_facts.py`
- `backend/tests/integration/test_content_task_creation.py`
- `backend/tests/integration/test_generation_reliability.py`
- `backend/tests/integration/test_content_review.py`
- `backend/tests/integration/test_content_draft_lifecycle.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/backend/database-guidelines.md`

仅修现有 humanization code 时，边界缩小为 `content_production.py` 中 create 与 HUMANIZE retry 两条 `_create_job` caller、`test_generation_reliability.py`、`backend/tests/unit/test_generation.py` 与 `error-handling.md`。其他新 code 必须先完成 T4-C，边界为 `contracts/openapi.yaml`、Frontend V2 行为文档、`database-guidelines.md`、`backend/tests/unit/test_contract.py`。

### 4.3 Required validation

- `uq_generation_jobs_idempotency_key` 与 active humanization unique 分别触发、分别映射；active-humanization 同时覆盖 create 与 HUMANIZE retry；任意第三约束为 unknown；
- 同 key 同 payload 重放、异 payload `IDEMPOTENCY_CONFLICT`；
- 并发只有一个 job/version/pending review 成功；
- 失败无任务指针、review record、AuditLog、dispatch、副本版本或 revision 残留；
- worker 异常不被 HTTP handler 逻辑影响。

## Phase 5：T5 publication/GEO constraints

### 5.1 目标

- publication work/account/article/issue 的 unique/partial unique 和 FK 归属到明确 command。
- 触发器/跨表 guard 没有稳定 diagnostics 时保持 unknown。
- 保留 append-only history、event-time、删除声明上下文和 revision/state 语义。

### 5.2 文件边界

- `backend/app/services/publication.py`
- `backend/app/services/geo_observation.py`
- `backend/app/routers/publication.py`
- `backend/app/routers/observation.py`
- `backend/tests/integration/test_publication_workflow.py`
- `backend/tests/integration/test_geo_insights.py`
- `backend/tests/integration/test_geo_observation_correction.py`
- `backend/tests/integration/test_geo_observation_detail.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/publication-workbench-guidelines.md`

进入新 publication/GEO code 实现前必须完成 T5-C，边界为 `contracts/openapi.yaml`、Frontend V2 行为文档、上述三份 spec 与 `backend/tests/unit/test_contract.py`；前端 projection 归 T6，除非合同要求同一原子 diff。

### 5.3 Required validation

- publication idempotency/active-content/open-issue/passed-verification 的真实 unique race；
- business precheck 与 DB final authority 一致；
- trigger `23514/55000` unknown sentinel 不泄漏、不 revision；
- 失败无 WorkEvent、verification、PublishedArticle、issue、GEO link、AuditLog、revision 或部分删除；
- event created_at 单调性和既有 deletion tests 不回归。

### 5.4 Review

必须独立高风险只读 review；一次 full review、最多一次 targeted re-review。

## Phase 6：T6 frontend 409 recovery projection reconciliation

### 6.1 进入条件

- T2–T5 实际新增/冻结的 domain codes 已确定；
- 产品明确 status-only 删除 409 是否继续“一律冻结确认”。

### 6.2 目标与文件边界

- 逐 operation 清理已审计的 15 个生产文件中的 status-only 409 判断；
- revision、blocker、idempotency、context stale 分支明确；
- production → test 对照固定为：`frontend/src/domains/configuration/platform-list-page.tsx` → `frontend/src/domains/configuration/platform-list-page.test.tsx`；`frontend/src/domains/configuration/platform-types-page.tsx` → `frontend/src/domains/configuration/platform-types-page.test.tsx`；`frontend/src/domains/configuration/platform-workspace-page.tsx` → `frontend/src/domains/configuration/platform-workspace-page.test.tsx`；`frontend/src/domains/content/content-review-page.tsx` → `frontend/src/domains/content/content-review-page.test.tsx`；`frontend/src/domains/content/content-task-lifecycle.tsx` → `frontend/src/domains/content/content-task-list-page.test.tsx`、`frontend/src/domains/content/content-task-detail-page.test.tsx`；`frontend/src/domains/geo/geo-observation-detail-page.tsx` → `frontend/src/domains/geo/geo-observation-detail-page.test.tsx`；`frontend/src/domains/geo/geo.api.ts` → `frontend/src/domains/geo/geo.api.test.ts`；`frontend/src/domains/geo/query-topic-list-page.tsx` → 拟新增 `frontend/src/domains/geo/query-topic-list-page.test.tsx`（Query Topic 409 code 投影与 request ID）；`frontend/src/domains/identity/user-list-page.tsx` → `frontend/src/domains/identity/user-list-page.test.tsx`；`frontend/src/domains/publication/publication-workspace-actions.tsx` → `frontend/src/domains/publication/publication-workspace-page.test.tsx`；`frontend/src/domains/publication/published-article-detail-page.tsx` → `frontend/src/domains/publication/published-article-detail-page.test.tsx`；`frontend/src/domains/publication/published-content-issue-workspace-actions.tsx`、`frontend/src/domains/publication/published-content-issue-workspace-page.tsx` → `frontend/src/domains/publication/published-content-issue-workspace-page.test.tsx`；`frontend/src/domains/publication/start-publication-dialog.tsx` → `frontend/src/domains/publication/publication-work-page.test.tsx`；`frontend/src/routes/_app/geo/observations/$observationId_.correct.tsx` → `frontend/src/domains/geo/geo-observation-correction-page.test.tsx` 与 `frontend/tests/e2e/geo-observation-correction.spec.ts`。actions/dialog 复用宿主 page 组合测试；Query Topic page 无现成测试，保持拟新增文件 + 行为名，不写虚构 nodeid。
- 文档边界：`docs/frontend-v2/05-business-actions-state-and-api-contract.md`、`08-testing-quality-and-acceptance.md`。generated schema 只在上游 OpenAPI 实际变化时同步；不做视觉改动。

### 6.3 Required validation

- 每个允许 code 有明确 UX fixture；
- 只有真正 revision（及合同明确列出的独立 stale code）保留输入并要求显式 reload；
- blocker 不冒充 revision，idempotency 不自动 replay；
- generated API/typecheck/相关 unit tests 通过。

## 全局合同顺序

任一后续 Task 需要新 status/code/schema 时，必须按以下顺序实施并作为同一原子 diff review：

1. `contracts/openapi.yaml`（wire/status/schema 变化时）；
2. runtime route metadata 和 service `AppError`；
3. backend contract/runtime/integration tests；
4. generated client；
5. frontend domain projection/tests；
6. 稳定 specs 与 Frontend V2 业务/验收文档。

当前 `ErrorDetail.code` 是开放 string；仅增加新的运行时字符串不自动等于公共类型合同已经冻结。是否把 code 变成 enum 是独立的大范围合同决策。

## 全局质量门槛

- 不解析数据库错误文本；只用结构化 diagnostics。
- 每个 mapper 仅拥有本 service command 的 allowlist；unknown 原抛。
- root rollback/savepoint 由业务 command owner 决定，不藏在全局 registry。
- 若未来使用 `Session.begin_nested()`，外层 owner 必须先显式验证/flush 要保留的 pending state；`begin_nested()` 建立 SAVEPOINT 前会无条件 flush，前置 flush 失败必须 root rollback。nested 验证需同时覆盖“局部失败后外层可提交”和“前置/unknown 失败整笔回滚”。
- 真实 PostgreSQL 证明优先；fake exception unit test 仅作为分支补充。
- required targeted checks 先通过，才可运行一次 final/full-scope gate。
- 每个 gate 最多两轮 repair → targeted re-check；同根因复现或第二轮失败即停止。
- 独立 review 一次、最多一次 targeted re-review。
- 提交前必须展示路径受限 commit plan 并取得用户确认；隔离当前 staged artifacts，不使用宽 add/reset/stash。

## 当前阶段关闭条件

- [x] `task.json.status` 保持 `planning`。
- [x] 没有执行 `task.py start`。
- [x] 只写当前 Task artifacts/research。
- [x] 未修改代码、合同、数据库、生产数据、历史 Task。
- [x] 未 commit、archive、push。
- [ ] 等待用户 review 并明确批准后，才可创建/启动推荐的 T1。
