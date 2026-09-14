# Research: generation job integrity

> 决策状态：本文记录generation分支审计和候选建议。最终综合矩阵未采纳`uq_content_versions_source_job_id`在final flush失败后的新增winner replay，而是保留provider前既有replay、final unique failure收敛为`FAILED/GENERATION_FAILED`；以`research/contract-decision-matrix.md`为最终决策。

- Query: 审计 content/generation job 的 IntegrityError 合同，冻结 `uq_generation_jobs_idempotency_key`、自然化活动源版本唯一性以及 worker 的 `source_job_id` 身份约束；区分 HTTP request policy 与 generation worker policy，并给出 T4-C 后续独立实施拆分。
- Scope: internal / mixed
- Date: 2026-09-05

## Findings

### 审计范围与结论

本文件深审 generation job、worker source identity 以及与 worker 共享的 content-version 唯一性约束。ContentTask 与 FactVersion 的完整 decision matrix 由父任务的其他 research artifact 负责；下文只记录交界点，避免给同一约束建立第二个 owner。

结论如下：

1. `uq_generation_jobs_idempotency_key` 应扩展现有自然化实现，覆盖 `GENERATE` create/retry。只有 PostgreSQL `sqlstate == "23505"` 且 `orig.diag.constraint_name` 精确等于该名称时才进入映射；不能解析数据库 message 或 `str(error)`。
2. 相同 canonical request identity 的幂等竞态重放已提交 winner；同 key 不同 identity 返回既有 `IDEMPOTENCY_CONFLICT`。查不到 winner 或 identity 无法验证时重新抛出原始异常，走 unknown 500，不猜测、不创建第二个 job。
3. `uq_generation_jobs_active_humanization_source` 保持已完成的 Humanization 映射：`HUMANIZATION_ALREADY_ACTIVE`，不因本任务重写或泛化为全局错误。
4. `uq_content_versions_source_job_id` 是 worker 的 source identity。正常路径已有提交前查找，重复投递/重复 worker 已能重放已有版本；若最终 flush 仍观察到精确 unique race，建议 worker 回滚后按 `source_job_id` 查 winner 并将同一 job 收敛为 `SUCCEEDED`。winner 缺失或不可验证时保持 worker 显式失败（`FAILED` + `GENERATION_FAILED`），不是 HTTP 409。
5. `uq_content_versions_task_id` 是版本号分配不变量，不能映射为 `REVISION_CONFLICT`，也不能从冲突异常安全推断 replay。正常 owner 已锁 task；异常竞态默认 unknown（worker 记录 `GENERATION_FAILED`，HTTP 侧默认 500）。
6. `uq_content_versions_one_pending_per_task` 是用户可理解的“已有待审核版本”状态竞争，建议新增稳定 `CONTENT_REVIEW_PENDING`（409，`该内容任务已有待审核版本`，details `{}`）。`uq_content_versions_one_approved_per_task` 的 approve 流程已经在 task lock 下将旧 approved 标记为 `SUPERSEDED`；若该唯一不变量仍失败，说明锁/状态实现异常，保持 unknown，不新增一个把内部不变量伪装成可恢复冲突的 code。

### 约束与 PostgreSQL 证据

| constraint / index | 表、字段与最终名称 | PostgreSQL 形态与证据 |
|---|---|---|
| `uq_generation_jobs_idempotency_key` | `generation_jobs.idempotency_key`；模型声明 `unique=True`（`backend/app/models/ai_generation.py:183-184`） | unnamed unique 通过 `backend/app/db.py:12-18` 的命名约定得到该名称；`test_generation_reliability.py:645-709` 从 catalog 读取 `pg_constraint` 并断言 `23505` 与精确诊断。 |
| `uq_generation_jobs_active_humanization_source` | `generation_jobs.source_content_version_id`；Humanization active 状态 | `backend/alembic/versions/0017_content_humanization.py:61-71` 创建部分 unique index；`test_generation_reliability.py:645-709` 说明它在 `pg_index` 而非 `pg_constraint`，并检查 index predicate；模型索引也在 `backend/app/models/ai_generation.py:166-176`。 |
| `uq_content_versions_source_job_id` | `content_versions.source_job_id` | `backend/app/models/content.py:91-109` 的 unnamed `UniqueConstraint("source_job_id")` 按 `backend/app/db.py:12-18` 命名；它保证一个 generation job 至多落一个草稿。 |
| `uq_content_versions_task_id` | `content_versions.(task_id, version)` | `backend/app/models/content.py:91-109` 的 unnamed `(task_id, version)` unique 按首字段命名；它是版本号分配不变量，不是请求 revision token。 |
| `uq_content_versions_one_pending_per_task` | `content_versions.task_id`，`status = 'PENDING_REVIEW'` 部分索引 | `backend/app/models/content.py:104-109` 与 `backend/alembic/versions/0035_business_workflow_primary_tasks.py:173-198`。 |
| `uq_content_versions_one_approved_per_task` | `content_versions.task_id`，`status = 'APPROVED'` 部分索引 | `backend/app/models/content.py:98-103`；approve 路径应先 supersede 旧版本再设置新版本。 |

### `uq_generation_jobs_idempotency_key` decision matrix

| 维度 | 决策 |
|---|---|
| command / operation owner | `content_production.create_generation_job`（HTTP operationId `createGenerationJob`，`backend/app/services/content_production.py:471-510`）；`create_humanization_job`（`createHumanizationJob`，`...:513-593`）；`retry_generation_job`（`retryGenerationJob`，`...:596-734`）。三者最终都通过 `_create_job`（`...:368-460`）写 `GenerationJob`。HTTP route 在 `backend/app/routers/production.py:216-240`、`:243-268`、`:308-330` 提供 `202` 与既有 `409`。 |
| worker owner | `backend/app/worker.py:41-56` 只接收 job UUID 并调用 `process_generation_job`；它不创建 generation job，不应采用 HTTP Idempotency-Key policy。 |
| identity / precheck | `_GenerationJobIdentity` 在 `backend/app/services/content_production.py:280-336` 冻结 task、retry source/job、model、job type 及原始 generation 的 prompt id/revision；actor/request id 不参与 identity。`_find_existing_generation_job`（`:339-350`）先按 key 查询，identity 不同即既有 `IDEMPOTENCY_CONFLICT`。create GENERATE 还有 task `FOR UPDATE` 与 current pointer guard（`:481-493`）；Humanization create/retry 先做 key lookup 与 source/active precheck（`:545-565`、`:635-695`）。这些 precheck 只是优化，不能替代 flush。 |
| 顺序路径 | create same key/same identity直接返回已有job，`created=False`。Humanization retry在旧snapshot校验后先lookup；**GENERATE retry当前在`:646-653`先检查previous是否latest，直到`:661-672`才lookup**，因此第一次retry创建新Job后同previous/key顺序重试会误返回`INVALID_STATE_TRANSITION`。最终方案要求GENERATE在旧snapshot与必要静态前置后先做identity lookup，只有无winner才执行latest/当前资格等新建检查。新key走`_create_job`，flush后caller commit，再dispatch。 |
| 真实 PostgreSQL race | 两个独立 Session 都可能在 precheck 看到无 row；唯一约束在 flush/commit 处只允许一个 winner。Humanization 路径已在 `...:576-588`、`:715-729` 捕获并先 rollback；该 catch 目前只对两个 Humanization constraint 生效。GENERATE create/retry 当前没有 catch，因而同 key race 仍是 unknown 500，未完成本 T4-C 要求的合同。 |
| decision | 将精确 `23505 + uq_generation_jobs_idempotency_key` 纳入现有 caller-scoped mapper，覆盖 GENERATE 与 HUMANIZE。rollback 后按 key 取 winner 并重新验证 frozen identity：same identity replay winner；不同 identity复用既有 `IDEMPOTENCY_CONFLICT`；winner missing 或无法验证则 re-raise 原始 IntegrityError。不能把其它 unique、FK、CHECK 或 NOT NULL 归入此分支。 |
| public contract | replay：原 job 的既有 `202` GenerationJob response；冲突：HTTP `409`，`code=IDEMPOTENCY_CONFLICT`，`message=幂等键已用于另一生成请求`，`details={}`。request ID 由 common `ErrorEnvelope` handler 注入（`backend/app/errors.py:23-58`），不是 identity，也不能由 service 自己伪造。 |
| frontend recovery | `frontend/src/domains/content/content-ai-production.tsx:149-187` 保持已有 job 状态；冲突路径清除 command key 后显示服务器 message，用户重新提交才取得新 key，不自动创建或 replay 另一 payload。稳定 command key 与 polling 规则见 `docs/frontend-v2/05-business-actions-state-and-api-contract.md:181-190`。 |
| worker policy | worker 不处理此 request-level constraint，因为它不接收 Idempotency-Key，也不创建 job。job dispatch 只携带 UUID；broker 失败保留 PENDING，由 `generation_dispatch.py:68-133` 补投递。 |
| atomicity | 已知 HTTP conflict 只在 flush 异常后 rollback；不 commit `GenerationJob`、不 dispatch、不改 `ContentTask.current_content_version_id`/revision、ContentVersion、review record、AuditLog。成功路径必须维持 commit-before-dispatch（`...:507-510`），避免 broker 失败回滚已持久化 job。 |
| docs / generated / specs | `ErrorDetail.code` 在 `contracts/openapi.yaml:4192-4206` 与 generated `schema.d.ts` 是开放 string，route 已声明 409；无需新增 schema 类型或 generated client 字段。实施时应在 `.trellis/spec/backend/error-handling.md` 记录 GENERATE coverage，并让 implementation task 检查 OpenAPI、runtime metadata 与 frontend 文档无不一致；禁止引入 global registry/通用 mapper framework。 |
| required tests | unit：沿用 `backend/tests/unit/test_generation.py:287-445` 的精确 diagnostics/missing winner/unknown 断言，并增加 GENERATE create/retry 分支，断言 classifier 不读 message。integration real PG：`test_generation_reliability.py:645-805` 的 catalog + same-key two-session barrier 模式扩展到 GENERATE，验证一 winner、一 replay/409、无多余 dispatch 与 side effects；补 HTTP envelope request_id 与 unknown 500。 |

### `uq_generation_jobs_active_humanization_source`（已完成合同冻结，必须保持）

| 维度 | 决策 |
|---|---|
| owner / trigger | `create_humanization_job`（`createHumanizationJob`）与 HUMANIZE 分支 `retry_generation_job`（`retryGenerationJob`）；它们都锁 task/source（`content_production.py:523-532`、`:673-685`），并查询 `PENDING/RUNNING` active job（`:556-565`、`:687-695`）。 |
| precheck / race | active 查询是优化；两个请求仍可能同时通过 precheck，partial unique index 在 flush 决胜。该对象没有 `pg_constraint` 诊断，必须读取 `orig.diag.constraint_name` 的 index name，并同时要求 `sqlstate=23505`。 |
| exact public contract | 保持 `HTTP 409`、`code=HUMANIZATION_ALREADY_ACTIVE`、`message=该源版本已有活动自然化作业`、`details={}`、request ID 由 ErrorEnvelope handler 注入。已有 catch `...:576-588`、`:715-729` rollback 后直接抛此 AppError；不按 key 查询 winner，也不把 active 冲突改成 `IDEMPOTENCY_CONFLICT`。 |
| frontend / worker | 前端沿用 AI production 错误展示与 canonical job refresh/polling；不自动重放另一 Humanization。worker 只执行已创建的 job，不把 HTTP active policy 复用为 worker error。 |
| atomicity / tests | known conflict 不 commit、不 dispatch、不写 content/review/audit/task pointer；existing real PG active race 与 create/retry 测试在 `backend/tests/integration/test_generation_reliability.py:808-873`，unit exact classifier 在 `backend/tests/unit/test_generation.py:287-445`。这些测试和 `ded73ab5` 引入的语义应保持，不应被 GENERATE mapper 重构破坏。 |

### `uq_content_versions_source_job_id` worker source identity decision matrix

| 维度 | 决策 |
|---|---|
| owner / trigger | 仅 generation worker `process_generation_job`（`backend/app/services/generation.py:339-495`）；HTTP generation commands 不直接创建 ContentVersion。最终 insert 在 `...:419-439`，`source_job_id=job.id`。 |
| precheck / lock | worker 独立 `SessionLocal`（`:341`）先 `FOR UPDATE` job；在调用 provider 前查 `ContentVersion.source_job_id == job.id`（`:342-361`）。provider 返回后重新锁 job、锁 task，并 max(version)+1（`:386-417`）。这是 source identity lookup 与 task/version allocation 的双重防护。 |
| 顺序与 race | 正常重复投递：第一 worker 把 job 置 RUNNING 并 commit（`:373-379`），最终同一事务插入 version、设置 task pointer/revision、标记 job SUCCEEDED 并 commit（`:419-463`）；第二 worker 因 job lock/status 或前置 source lookup return。现有真实测试 `test_generation_reliability.py:940-979` 已证明重复处理只有一个 provider call、一个 source version、最终 SUCCEEDED。若两个异常路径都越过 lookup，PG unique 在 `db.flush()`（`:438-439`）阻止第二个 version。 |
| decision | 精确 `23505 + uq_content_versions_source_job_id` 属于可安全判定的 source identity race：final transaction rollback 后按同一 `job.id` 查询 winner；若存在，重放 winner 的 `content_version_id`，将原 job 收敛为 SUCCEEDED。禁止按错误 message 解析，禁止按 task/version 或 body 猜 winner。 |
| winner replay | winner 存在时不再次调用 provider、不插入第二个 ContentVersion、不增加 task revision、不覆盖已有 current pointer；只在新的 worker transaction 中更新同一 GenerationJob 的 `SUCCEEDED`、winner id、finished_at、lease 清理并 commit。worker 没有 HTTP request ID、AuditLog、ContentReviewRecord 或 dispatch side effect。 |
| winner missing / unknown | rollback 后 winner 缺失、查询无法验证，或 diagnostics 不是精确 `23505 + uq_content_versions_source_job_id`：保持 unknown worker policy。沿用 broad failure 收敛为 `GenerationJob.status=FAILED`、`error_code=GENERATION_FAILED`、`error_summary=生成作业执行失败`，清 lease 并 commit（`...:473-495`）；不要返回公共 409，也不要伪造 `IDEMPOTENCY_CONFLICT`/`REVISION_CONFLICT`。 |
| lease / atomicity | RUNNING lease 与 attempt 在 provider 前单独 commit（`:373-383`），不会因 final failure 回滚；final content insert、task pointer/revision、job success、provider metadata 是一个事务（`:419-463`）。flush 冲突 rollback 应删除未提交 version/pointer/revision；已提交 source winner 不受影响。`generation_dispatch.py:136-159` 对过期 RUNNING 标记 `WORKER_LOST`，迟到 worker 在 `...:392-394` 检查非 RUNNING 后 return，不能覆盖失败终态。 |
| frontend / contract | worker replay 不产生新 HTTP operation，也不改变 OpenAPI；前端最终轮询到同一 SUCCEEDED job 并刷新 editor context（`content-ai-production.tsx:119-134`）。worker failure 通过 GenerationJob status/error code 展示（`:219-230`），不能套用 request `IDEMPOTENCY_CONFLICT` recovery。 |
| required tests | real PostgreSQL：强制让两个独立 worker/session 在 source lookup 后同时 flush，断言 catalog diagnostics 精确、仅一个 ContentVersion(source_job_id)、job 最终 SUCCEEDED、task pointer/revision 单次变化、无 review/audit/dispatch 重复；provider call 至多一次。另测 winner missing/unverifiable：job FAILED + `GENERATION_FAILED`，无 duplicate version。保留已有重复 worker、lease expiry、broker redelivery tests（`:940-1166`、`:1247-1275`）。 |

### `uq_content_versions_task_id` 与状态唯一性矩阵

| constraint | command / owner | 预检、顺序与 race | T4-C decision / contract | 原子性、前端与测试 |
|---|---|---|---|---|
| `uq_content_versions_task_id` | `createManualContentVersion`、`createContentRevision` 由 `content_production.py:777-882` 的 `_create_human_content` 分配版本；worker `generation.py:395-439` 也按 task 分配 max+1。HTTP routes 在 `production.py:354-377` 等。 | manual/revision 先锁 task，再 max(version)+1（`:832-882`）；worker provider 后锁 task 再计算（`generation.py:395-417`）。正常路径序列化；绕过 task lock 或故障注入才会在 unique flush 竞争。 | 保持 unknown；不映射 `REVISION_CONFLICT`，不从唯一冲突 replay 任意 version。HTTP 未知 IntegrityError 走默认 500；worker 按其显式失败策略记录 `FAILED/GENERATION_FAILED`。若未来发现常规路径能触发，先修 lock/allocation owner，再重新做合同决策。 | rollback 必须覆盖尚未提交的 ContentVersion、pointer、revision、review/audit；不能产生 dispatch。required tests 用真实 PG 精确诊断验证 lock/max allocation，而不是把异常 message 当合同；不新增 OpenAPI code。 |
| `uq_content_versions_one_pending_per_task` | `submitContentVersion` 及 `review.transition_content_version`（`backend/app/services/review.py:340-412`）；提交/状态变更与 ContentReviewRecord 同事务。 | content 与 task 锁顺序在 `review.py:351-359`；代码没有独立“已有 pending” precheck，数据库 partial unique 是最终 enforcement。并发 submit 或不同 content lock 顺序可能撞 partial index。 | 建议新增稳定 `CONTENT_REVIEW_PENDING`：HTTP 409，`message=该内容任务已有待审核版本`，`details={}`，request ID 由 envelope 注入。只按 `23505 + uq_content_versions_one_pending_per_task` 映射；其他状态/constraint unknown。前端刷新 canonical editor/review context，保留本地输入，不自动 replay/覆盖。 | known conflict rollback 整个 transition，不写目标 status/revision、ContentReviewRecord、AuditLog、task pointer。需要 real PG two-session submit race、exact diagnostics、HTTP envelope/request ID、frontend conflict refresh tests；OpenAPI route 已有 409，但公共 code 需在稳定 error spec、runtime metadata 与 frontend 文档中明确，generated client 仍可维持 open string。 |
| `uq_content_versions_one_approved_per_task` | `approveContentVersion`，由 `review.transition_content_version` approve 分支负责（`review.py:366-411`）。 | 先在 task/content lock 下找到旧 approved，将其改 `SUPERSEDED` 并 flush，再把目标改 APPROVED（`:371-395`）；正常路径不应违反 partial unique。 | 保持 unknown。唯一冲突表示 supersede/lock/invariant 实现异常，不把内部 invariant 转成用户可恢复 409，不新建 `REVISION_CONFLICT` 或另一公共 code。 | rollback 应同时撤销旧 approved supersede、目标 status/revision、review record、AuditLog；不留下半个审批。需要 real PG/sentinel exact diagnostic regression，证明 normal approve 仍原子 supersede+approve；unknown 500 不泄露数据库信息。前端不得将其误判为 revision conflict。 |

### HTTP policy 与 worker policy 的边界

HTTP service 使用 request-scoped Session，已知 IntegrityError 必须在 flush 处窄捕获、rollback 后返回 AppError；ErrorEnvelope 的 `request_id` 来自请求 middleware（`backend/app/errors.py:40-58`）。HTTP 幂等冲突可以 replay 已提交资源或返回 409，因为 caller 拥有 canonical request identity、稳定 key 和可重试命令。

generation worker 使用独立 `SessionLocal`，接收 job UUID，不拥有原始 HTTP request policy。它在 provider 调用前提交 RUNNING lease，最终把内容版本、task pointer/revision、job terminal state 放在一个 final transaction；异常由 worker 持久化为 `FAILED`，而不是向不存在的 HTTP caller 抛 409。dispatch 只在 request service commit 后尝试投递，broker failure 留 PENDING 由补投递流程恢复（`backend/app/services/generation_dispatch.py:68-159`）。

因此不能为了表面统一，把 `uq_generation_jobs_idempotency_key`、`uq_content_versions_source_job_id` 或 unknown IntegrityError 全部转换成同一个公共 code；也不能把 worker `GENERATION_FAILED` 反向当作请求幂等冲突。

### 现有 Humanization 映射与提交上下文

当前代码中 `_classify_humanization_integrity_error`（`content_production.py:353-365`）只允许两个精确 constraint name；create/retry Humanization catch 分支（`:576-588`、`:715-729`）先 rollback，再按约定处理。unit 测试（`backend/tests/unit/test_generation.py:287-445`）覆盖 exact `23505`、unknown constraint、non-`23505`、缺 diagnostics、winner missing 以及 GENERATE retry 不走 Humanization classifier；integration tests（`backend/tests/integration/test_generation_reliability.py:645-873`）覆盖真实 PostgreSQL catalog、same-key race、active-source race、无副作用与 unknown 500。

这与已完成 Humanization 工作提交 `ded73ab5 fix(content): map humanization job integrity conflicts` 的合同一致：

- `uq_generation_jobs_idempotency_key` → same identity replay / different identity `IDEMPOTENCY_CONFLICT`；
- `uq_generation_jobs_active_humanization_source` → `HUMANIZATION_ALREADY_ACTIVE`；
- 只在已知 diagnostics 后 rollback；winner 缺失重新抛原异常；
- 不扩散到 GENERATE、worker 或全局错误 handler，除非本 T4-C 审批后由独立 implementation task 明确实施。

### 后续 implementation Task 拆分与依赖

按稳定 command owner 和独立验证目标，建议拆分如下：

| 顺序 | 建议 Task | 主要 owner / 验证边界 | 依赖 |
|---|---|---|---|
| 1（推荐首个） | `generation-job-idempotency-contract-implementation` | `content_production.py`；扩展 GENERATE create/retry 的窄 mapper，保持 Humanization 两个分支；unit + real-PG HTTP/race/dispatch tests。 | T4-C decision approved；T1 unknown boundary 已完成。 |
| 2 | `generation-worker-source-identity-implementation` | `generation.py`；处理精确 `uq_content_versions_source_job_id` winner replay、winner missing 显式 FAILED；独立 Session、lease、provider、pointer/revision 原子性 tests。 | T4-C approved；可与 Task 1 并行，但建议 Task 1 后落地以先稳定 job identity 测试夹具。 |
| 3 | `content-task-idempotency-implementation` | `content_planning.py` / `createContentTask`；保持同 key/same payload replay 与 mismatch `IDEMPOTENCY_CONFLICT`，另行处理 source published issue 约束。 | T4-C approved；与 Task 1/2 无代码依赖，可并行。 |
| 4 | `content-version-identity-and-review-state-implementation` | `content_production.py` manual/revision 与 `review.py` submit/approve；`uq_content_versions_task_id` unknown、pending 新 code、approved unknown；同步必要稳定 specs/OpenAPI metadata/frontend behavior。 | Task 2（共享 worker content-version owner）完成或至少接口冻结；Task 1 可并行。 |
| 5 | `fact-version-identity-and-review-state-implementation` | `product_facts.py`；`uq_fact_versions_product_id` unknown 与 `uq_fact_versions_one_pending_per_product` 复用既有 `FACT_REVIEW_PENDING`，real-PG/service/frontend tests。 | T4-C approved；与 Task 1-4 可并行。 |
| 6 | `frontend-contract-follow-through`（若实现任务不各自包含） | content AI/review/fact workspace 对新增稳定 code 的 refresh、key retention、request ID 展示；generated client/runtime metadata 校验。 | 依赖实际新增公共 code（尤其 Task 4/5）及对应后端 tests。 |

Task 1 不应顺手改 worker source identity、content review 或 fact review；每个 Task 保持一个可 review 的行为目标。Task 4 若最终按本决策新增 `CONTENT_REVIEW_PENDING`，必须在实现前同步冻结 code/message/details/request ID 和 frontend recovery，不得先写代码再补语义。

### 推荐第一个实施任务的精确验收标准

推荐先实施 `generation-job-idempotency-contract-implementation`：它直接补齐现有 Humanization mapper 对 GENERATE create/retry 的缺口，复用已存在的 identity 与测试模式，且不引入新公共 code。

验收标准：

1. `createGenerationJob` 与 GENERATE `retryGenerationJob` 对同一 key、同一 `_GenerationJobIdentity` 的真实 PostgreSQL race 只能产生一个 `GenerationJob`；另一请求 rollback 后返回同一个已持久化 job（202），不 dispatch 第二次。
2. 同一 key、不同 task/model/job type/source/prompt snapshot identity 返回 HTTP 409，精确 `IDEMPOTENCY_CONFLICT`、`幂等键已用于另一生成请求`、`details={}`；ErrorEnvelope 带当前 request ID，不泄露 SQL message/table/index。
3. mapper 仅接受 `orig.sqlstate == "23505"` 与精确 `orig.diag.constraint_name == "uq_generation_jobs_idempotency_key"`；unknown constraint、non-23505、缺 diagnostics、winner missing 均保留原 IntegrityError/默认 500，不能 fallback 到 `REVISION_CONFLICT`。
4. 已有 Humanization `IDEMPOTENCY_CONFLICT`、`HUMANIZATION_ALREADY_ACTIVE`、active race、winner missing、GENERATE-not-classified unit tests 全部保持通过；不得改变 `ded73ab5` 的 two-name scope。
5. known conflict 不产生新的 generation job、ContentVersion、task current pointer/revision、ContentReviewRecord、AuditLog 或 broker dispatch；成功路径仍 commit-before-dispatch，broker failure 保留 PENDING。
6. required validation 至少包括现有 unit classifier tests、real-PG catalog diagnostic test、two-session race/side-effect integration tests 及 HTTP envelope/request-id assertions；full backend suite 可作为 optional validation，并记录未跑项目与残余风险。

### 关联但交由父任务其他 research artifact 的约束

| constraint | 本文件处理边界 |
|---|---|
| `uq_content_tasks_idempotency_key` | 属于 `content_planning.createContentTask` 的 request contract；本文件只要求 Task 3 与 generation job policy 保持相同“预检不替代 flush、exact diagnostics”原则。 |
| `uq_content_tasks_source_published_content_issue_id` | publication/source identity 约束，非本 T4-C generation job 合同；不要在此任务映射，按父计划后续 content/publication 决策处理。 |
| `uq_fact_versions_product_id` | FactVersion allocation owner 在 `product_facts.py`；本文件不重复冻结，交由 FactVersion implementation task。 |
| `uq_fact_versions_one_pending_per_product` | 现有 `FACT_REVIEW_PENDING` 语义与前端 recovery 由 fact research artifact 冻结；worker generation policy 不适用。 |

## Files found

- `.trellis/workflow.md` — Trellis 阶段、research artifact 与 planning-only 工作流要求。
- `.trellis/spec/backend/error-handling.md` — DB 最终权威、精确 diagnostics、rollback 与 unknown 500 边界。
- `.trellis/spec/backend/database-guidelines.md` — 幂等 key、版本分配与 PostgreSQL 最终约束原则。
- `.trellis/spec/backend/ai-configuration-guidelines.md` — GenerationJob/Humanization job、provider 调用与状态语义。
- `.trellis/tasks/09-04-integrity-error-domain-mapping/prd.md` — 父计划目标及 T4-C 范围。
- `.trellis/tasks/09-04-integrity-error-domain-mapping/design.md` — 已完成 Humanization 映射与待决 T4-C 边界。
- `.trellis/tasks/09-04-integrity-error-domain-mapping/implement.md` — 既有实现任务与测试门槛。
- `.trellis/tasks/09-04-integrity-error-domain-mapping/research/backend-integrity-paths.md` — backend owner、flush 与异常路径总览。
- `.trellis/tasks/09-04-integrity-error-domain-mapping/research/database-constraint-matrix.md` — 九项约束的父矩阵与待决项。
- `.trellis/tasks/09-04-integrity-error-domain-mapping/research/database-constraint-companion.csv` — 约束、owner、候选合同辅助数据。
- `.trellis/tasks/09-04-integrity-error-domain-mapping/research/api-frontend-impact.md` — operationId、ErrorEnvelope、前端恢复与生成端影响。
- `.trellis/tasks/09-04-integrity-error-domain-mapping/research/testing-strategy.md` — real PostgreSQL、race、worker 与前端测试策略。
- `backend/app/services/content_production.py` — generation/humanization job identity、precheck、flush、commit/dispatch 与现有 Humanization mapper。
- `backend/app/services/generation.py` — 独立 worker Session、lease、provider 调用、ContentVersion source identity 与失败收敛。
- `backend/app/services/generation_dispatch.py` — commit 后 dispatch、PENDING 补投递、lease expiry recovery。
- `backend/app/worker.py` — Celery generation UUID owner。
- `backend/app/services/review.py` — content submit/approve 状态转移、review record 与 AuditLog 事务。
- `backend/app/services/product_facts.py` — FactVersion submit 的锁、pending precheck 与 flush（本文件仅交界记录）。
- `backend/app/routers/production.py` — create/retry generation/humanization operationId 与 202/409 route contract。
- `backend/app/models/ai_generation.py` — GenerationJob unique key 与 active Humanization partial index。
- `backend/app/models/content.py` — ContentVersion source_job/version/pending/approved unique constraints。
- `backend/app/db.py` — SQLAlchemy constraint naming convention。
- `backend/alembic/versions/0017_content_humanization.py` — active Humanization partial unique index migration。
- `backend/alembic/versions/0032_content_task_idempotency.py` — ContentTask idempotency migration（交界）。
- `backend/alembic/versions/0035_business_workflow_primary_tasks.py` — content version pending/approved partial indexes。
- `backend/tests/unit/test_generation.py` — exact classifier、rollback/query ownership 与 unknown tests。
- `backend/tests/integration/test_generation_reliability.py` — catalog diagnostics、HTTP race、Humanization mapping、duplicate worker、lease/dispatch tests。
- `backend/tests/integration/test_content_review.py` — content review fixtures and transition coverage。
- `backend/tests/integration/test_content_draft_lifecycle.py` — content version lifecycle fixtures and allocation coverage。
- `backend/tests/integration/test_content_task_creation.py` — ContentTask idempotency tests（交界）。
- `backend/tests/unit/test_contract.py` — API contract checks（待 implementation follow-through）。
- `backend/tests/unit/test_runtime_response_metadata.py` — runtime metadata checks（待 implementation follow-through）。
- `frontend/src/domains/content/content-ai-production.tsx` — AI job command key、409 handling、polling 与 terminal refresh。
- `frontend/src/domains/content/content.api.ts` — generation API headers、ErrorEnvelope/request ID 与 ContentRequestError。
- `frontend/src/domains/product/fact-workspace-page.tsx` — fact pending/revision frontend recovery（交界）。
- `frontend/src/shared/api/generated/schema.d.ts` — generated open string ErrorDetail/GenerationJob types。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md` — stable command idempotency、polling、409 recovery。
- `contracts/openapi.yaml` — GenerationJob routes and ErrorEnvelope schema。
- `contracts/database.md` — generation/content-version invariants and worker state semantics。
- `backend/pyproject.toml` / `backend/uv.lock` — SQLAlchemy, psycopg, FastAPI and Celery versions。

## Code patterns

- `backend/app/services/content_production.py:339-350` — key lookup and canonical identity mismatch produce the existing `IDEMPOTENCY_CONFLICT`.
- `backend/app/services/content_production.py:353-365` — classifier is constrained to exact PostgreSQL SQLSTATE and constraint/index names; no error message parsing.
- `backend/app/services/content_production.py:458-460` — `_create_job` flushes before caller transaction decides commit/dispatch.
- `backend/app/services/content_production.py:576-588` and `:715-729` — completed Humanization catch policy: classify, rollback, replay idempotency winner or raise `HUMANIZATION_ALREADY_ACTIVE`.
- `backend/app/services/content_production.py:507-510`, `:589-593`, `:730-734` — successful request transaction commits before broker dispatch.
- `backend/app/services/generation.py:342-361` — worker locks job and replays an existing source-job ContentVersion before provider work.
- `backend/app/services/generation.py:373-383` — worker commits RUNNING lease before external provider call.
- `backend/app/services/generation.py:419-463` — ContentVersion insert, task pointer/revision, job success and provider metadata share final commit.
- `backend/app/services/generation.py:473-495` — worker rollback then explicit FAILED persistence; non-AppError maps to `GENERATION_FAILED` without leaking database text.
- `backend/app/services/generation_dispatch.py:68-87` — dispatch failures do not undo committed job and leave PENDING for recovery.
- `backend/app/services/review.py:351-411` — content transition locks content/task, writes review/audit side effects and commits atomically.
- `backend/app/models/content.py:91-109` — version/source/pending/approved uniqueness declarations.
- `backend/app/db.py:12-18` — final unnamed unique names derive from table and first column.
- `backend/tests/integration/test_generation_reliability.py:940-979` — duplicate worker behavior already verified with one source job version.
- `backend/tests/integration/test_generation_reliability.py:1107-1166` — broker acceptance/loss, redispatch and duplicate processing behavior.

## External references

- PostgreSQL current documentation, unique indexes: <https://www.postgresql.org/docs/current/indexes-unique.html> — unique enforcement is database-side and concurrent inserts must be handled at the transaction boundary.
- SQLAlchemy 2.0 Session rollback documentation: <https://docs.sqlalchemy.org/en/20/orm/session_basics.html#rolling-back> — failed flush leaves the Session needing rollback before further queries.
- Psycopg 3 diagnostics API: <https://www.psycopg.org/psycopg3/docs/api/errors.html> — structured SQLSTATE/diagnostic attributes are the supported source for PostgreSQL error classification.
- Installed versions observed in `backend/pyproject.toml` and `backend/uv.lock`: SQLAlchemy `2.0.51`, psycopg `3.3.4`, FastAPI `0.139.0`, Celery `5.6.3` (ranges in pyproject are SQLAlchemy `>=2.0.36,<3`, psycopg `>=3.2,<4`, FastAPI `>=0.115,<1`, Celery `>=5.4,<6`).

## Related specs

- `.trellis/spec/backend/error-handling.md:61-181` — narrow known IntegrityError mapping, exact diagnostics, existing Humanization contract and unknown boundary。
- `.trellis/spec/backend/database-guidelines.md:501-516` — ContentTask idempotency and PostgreSQL constraints as final authority。
- `.trellis/spec/backend/ai-configuration-guidelines.md:9-15,49-67,113,186` — GenerationJob state, Humanization snapshot and explicit retry semantics。
- `contracts/database.md:37-43,81-83,129-137,181,229-237,413-423` — job/source identity, immutable versions, task pointer and allocation invariants。
- `contracts/openapi.yaml:2174-2216,2310-2331,4192-4206` — generation operations, 202/409 responses and open ErrorEnvelope code field。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md:112-137,181-190` — canonical mainline, stable command key, terminal refresh and 409 recovery。

## Caveats / Not Found

- 本 research agent 遵守只读研究边界，没有运行 `git` 命令；`ded73ab5` 未通过 `git show` 独立读取。提交语义由当前工作树中的 `_classify_humanization_integrity_error`、catch 分支及 unit/integration tests 交叉证实，implementation 前仍应由主任务确认提交是否与当前文件一致。
- 当前 worker 已有“flush 前 source_job lookup”和 duplicate-worker 覆盖，但没有看到直接强制 `uq_content_versions_source_job_id` 在最终 `db.flush()` 处发生 race、然后 replay committed winner 的测试；这是 Task 2 的关键缺口。
- 当前 GENERATE create/retry 没有 catch `uq_generation_jobs_idempotency_key` race；Humanization 的 mapper 不能直接假定适用于 GENERATE，因为 retry eligibility、identity 与 side effect owner 不同。需先批准本 T4-C，再实现 Task 1。
- 当前 content review submit 没有显式 pending-other precheck；`uq_content_versions_one_pending_per_task` 的 `CONTENT_REVIEW_PENDING` 是本决策建议的新公共 code，尚未写入 OpenAPI/stable spec/frontend 代码，不能在本 planning task 中提前实施。
- 当前 approve 流程通过 supersede 旧 approved 避免 `uq_content_versions_one_approved_per_task`；没有把“唯一冲突”作为用户可恢复 409 的现成产品语义。若产品未来要求该语义，必须另开 contract decision，而不是沿用 `REVISION_CONFLICT`。
- 未执行测试、迁移或运行时数据库操作；本文件中的 race 结论基于源代码、现有测试和约束声明。需要 PostgreSQL integration environment 才能验证新的 source-job flush race 与 GENERATE idempotency race。
- `uq_content_tasks_*` 与 `uq_fact_versions_*` 只记录与 generation owner 的交界，完整合同、前端行为及 implementation 顺序应以父任务其他 research artifact 为准；publication/GEO 约束不纳入 T4-C。
