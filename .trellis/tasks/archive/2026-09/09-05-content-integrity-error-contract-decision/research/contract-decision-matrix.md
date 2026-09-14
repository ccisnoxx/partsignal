# Content/Generation IntegrityError 最终合同决策矩阵

## 1. 决策地位与边界

本文是 `content-integrity-error-contract-decision` 的最终综合研究产物。其结论覆盖并裁决本目录其他 research artifact 中的候选分歧；本任务获批前，这些结论仍是 review candidate，不授权修改生产代码。

本次只决定 content/generation T4-C：普通 Content Task、Generation Job、Content Version 和 Fact Version。`uq_content_tasks_source_published_content_issue_id` 因用户要求仍列入九项审计，但其 production mapping 与 publication/GEO 实施明确留给 T5-C；本任务只冻结 owner、当前顺序行为和 T4-C 的“不实施”边界。

共同边界如下：

- mapper 只能接受 `error.orig.sqlstate == "23505"` 且 `error.orig.diag.constraint_name` 精确等于本 command allowlist 中的名称；禁止读取数据库 message、`str(error)` 或按回查结果猜约束。
- CHECK、NOT NULL、不可变 trigger、未列名 FK、缺失 diagnostics、未知 constraint 和非 `23505` 均保持 unknown。
- 不恢复全局 `IntegrityError -> REVISION_CONFLICT`，不新增全局 registry、通用 mapper framework、repository 或第二套错误类型系统。
- HTTP 已知冲突由 request root transaction rollback 后映射；unknown HTTP 继续进入默认 500，且不冻结 500 body/code/header/media type。
- generation worker 没有 HTTP request ID，也不继承 HTTP 幂等/409 policy；worker 按自身 Job 状态合同重放或显式失败。
- 已完成的 Humanization 合同保持原样：`uq_generation_jobs_idempotency_key` 的同 identity replay / 异 identity `IDEMPOTENCY_CONFLICT`，以及 `uq_generation_jobs_active_humanization_source -> HUMANIZATION_ALREADY_ACTIVE`。

## 2. 总览

| # | 最终 constraint/index | T4-C 最终分类 | 精确结果 |
|---:|---|---|---|
| 1 | `uq_content_tasks_idempotency_key` | replay / 既有领域错误 | 普通 Content Task 同 identity 返回既有任务 201；异 identity 返回 409 `IDEMPOTENCY_CONFLICT`。GEO incoming command 的 mapper 留给 T5-C。 |
| 2 | `uq_content_tasks_source_published_content_issue_id` | T4-C 保持 unknown；T5-C 决策候选 | 顺序 precheck 继续 409 `REPAIR_TASK_EXISTS`；数据库 race 在 T4-C 不新增 mapper。 |
| 3 | `uq_generation_jobs_idempotency_key` | replay / 既有领域错误 | GENERATE create/retry 同 identity 返回既有 Job 202；异 identity 返回 409 `IDEMPOTENCY_CONFLICT`；Humanization 已有行为不变。 |
| 4 | `uq_content_versions_source_job_id` | 顺序 replay；真实唯一冲突显式失败 | worker 启动前已有版本时沿用现有 replay；最终 flush 的精确唯一冲突 rollback 后 Job `FAILED/GENERATION_FAILED`，不新增 post-error replay。 |
| 5 | `uq_content_versions_task_id` | unknown / worker 显式失败 | HTTP 默认 500；worker `FAILED/GENERATION_FAILED`；不改号、不 replay、不映射 revision。 |
| 6 | `uq_content_versions_one_pending_per_task` | 新领域错误 | 409 `CONTENT_REVIEW_PENDING`，message `该任务已有待审核内容版本`，details `{}`；显式 reload，不自动 replay。 |
| 7 | `uq_content_versions_one_approved_per_task` | unknown | HTTP 默认 500；approval 整笔 rollback，不选择 winner。 |
| 8 | `uq_fact_versions_product_id` | unknown | HTTP 默认 500；FactVersion submit 整笔 rollback，不 replay、不改号。 |
| 9 | `uq_fact_versions_one_pending_per_product` | 既有领域错误 | 409 `FACT_REVIEW_PENDING`，message `该产品已有待审核事实版本`，details `{}`；不 replay。 |

## 3. 九项逐条 decision matrix

### 3.1 `uq_content_tasks_idempotency_key`

| 维度 | 冻结结论 |
|---|---|
| 数据与最终名称 | `content_tasks(idempotency_key)`；nullable UNIQUE；最终名显式为 `uq_content_tasks_idempotency_key`。 |
| owner | 普通 command：`content_planning.create_content_task` / `createContentTask`。同表交叉 writer 还有 `geo_observation.create_geo_optimization_content_task` / `createGeoOptimizationContentTask`，但 GEO incoming policy 属于 T5-C。无 worker owner。 |
| 当前协调 | 普通与 GEO 都用 `pg_advisory_xact_lock("content-task-create:<key>")` 并 lookup；普通 identity 当前比较 `product_id/fact_version_id/platform_profile_id`，GEO 还校验 `ContentTaskGeoSource`。普通成功路径锁 platform → product → fact，随后 flush task。 |
| 顺序行为 | 普通同 key、同普通 identity replay 既有 task；异 identity 409。现有正常并发被 advisory lock 串行，不会触发 23505。 |
| PostgreSQL race | 绕过 advisory protocol 的交叉 writer 可在 flush 产生 `23505 + uq_content_tasks_idempotency_key`。普通 caller rollback 后只可 replay 可证明为普通 command 且 identity 完全相同的 winner；GEO source-kind winner即使三字段相同也不得作为普通任务 replay。winner 缺失则 re-raise。 |
| 分类 | replay / 既有领域错误。T4-C 后续任务只实现普通 caller；不得修改 GEO command。若安全区分 source kind 必须改变 GEO command/shared semantics，则停止并交 T5-C。 |
| HTTP 合同 | replay：201 + canonical ContentTask。冲突：409；`code=IDEMPOTENCY_CONFLICT`；`message=幂等键已用于另一内容任务创建请求`；`details={}`；`error.request_id` 与当前 `X-Request-ID` 相同。 |
| 前端恢复 | 新建页保留表单和错误 request ID；精确 `IDEMPOTENCY_CONFLICT` 后废弃旧 key，只有用户再次提交才生成新 key；不自动 replay 异载荷。 |
| worker | 不适用。 |
| 原子性 | 已知或未知失败均不得留下 ContentTask、revision、task pointer、ContentVersion、FactVersion、ReviewRecord、AuditLog 或 dispatch；GEO 的 Task + GeoSource 原子性由 T5-C 负责。 |
| 同步面 | OpenAPI已有201/409且code是开放string；runtime metadata与generated client无结构变化。`contracts/database.md:37`当前只写“同键同三字段重放”，I2必须把ordinary source-kind纳入canonical identity文字但不扩展GEO incoming policy；stable error/database spec补精确diagnostics，Frontend V2既有key规则核对即可。 |
| Required tests | real PostgreSQL catalog/diagnostics；普通同/异 identity race；GEO winner 不被普通 command replay 的 service sentinel；201/409 envelope/request ID；恰一 task、session rollback 后可继续；unknown diagnostics 负例；现有 advisory-lock 并发回归。 |
| 后续 Task | `content-task-idempotency-integrity-mapping`。依赖本决策获批；与 T5-C 共享边界但不得越界实现 GEO incoming mapper。 |

### 3.2 `uq_content_tasks_source_published_content_issue_id`

| 维度 | 冻结结论 |
|---|---|
| 数据与最终名称 | `content_tasks(source_published_content_issue_id)`；UNIQUE；最终名 `uq_content_tasks_source_published_content_issue_id`。 |
| owner | `publication.create_repair_task` / `createPublishedContentRepairTask`；无 worker。 |
| 当前协调 | 锁 `PublishedContentIssue FOR UPDATE`，校验 revision/status，再查已有 repair task；命中现有 `REPAIR_TASK_EXISTS`。 |
| 顺序行为 | 正常重复请求在锁后 precheck 返回 409 `REPAIR_TASK_EXISTS`，不触发数据库 constraint。 |
| PostgreSQL race | 绕过 issue lock 的 writer 才会在 task flush 产生精确 23505。当前没有局部 mapper，T1 后进入 default 500。 |
| 分类 | **T4-C 不实施，数据库 race 保持 unknown。** T5-C 可评审是否把 exact pair 映射为既有 `REPAIR_TASK_EXISTS`；本任务不把候选当作已获批 production contract。 |
| HTTP 合同 | 当前顺序 precheck 已有：409；`code=REPAIR_TASK_EXISTS`；`message=该问题已经创建修复任务`；`details={}`；request ID 由统一 handler 注入。数据库 race 的 T4-C 结果仍为非稳定 500。 |
| 前端恢复 | 当前 issue workspace 对已知 409 保留输入并显式 reload，不自动 replay。数据库 race 的稳定恢复行为留给 T5-C。 |
| worker | 不适用。 |
| 原子性 | task flush 失败时不得修改 issue revision/status，不得留下 task、pointer、version、review、AuditLog 或 dispatch。 |
| 同步面 | 本任务不修改 OpenAPI/runtime/generated/Frontend V2/stable specs；T5-C 重新确认。 |
| Required tests | T5-C：真实 exact diagnostics、恰一 repair task、既有 precheck 与 race 等价性、409 request ID、完整 rollback、unknown 负例。 |
| 后续 Task | 不在 T4-C implementation list；进入 publication/GEO T5-C。 |

### 3.3 `uq_generation_jobs_idempotency_key`

| 维度 | 冻结结论 |
|---|---|
| 数据与最终名称 | `generation_jobs(idempotency_key)`；UNIQUE；最终名 `uq_generation_jobs_idempotency_key`。 |
| owner | `_create_job` 的 HTTP callers：`create_generation_job` / `createGenerationJob`，`create_humanization_job` / `createHumanizationJob`，`retry_generation_job` / `retryGenerationJob`。worker 不创建 Job。 |
| 当前协调 | `_GenerationJobIdentity`比较task、retry source、model、job type、source和GENERATE prompt identity。create GENERATE在新建前lookup；Humanization retry会先验证旧snapshot并lookup，但GENERATE retry当前先执行latest-job检查，之后才lookup key。新Job flush后由caller commit，再dispatch；Humanization create/retry已有exact diagnostics mapper。 |
| 顺序行为 | create同key/same identity可直接返回existing。**当前GENERATE retry不是完整replay**：第一次retry创建新Job后，再以同previous/key请求会先因previous不再是latest而返回`INVALID_STATE_TRANSITION`。目标合同冻结为：验证previous存在/可重试/FAILED、Task仍OPEN及旧GENERATE snapshot后，先计算retry identity并lookup；same key/same identity直接202 replay，只有无winner时才执行“previous必须latest”和当前facts/product资格等新建专用检查。different key仍受latest检查；same key/different identity仍409。 |
| PostgreSQL race | 同Task同identity的正常请求由Task行锁串行，目标顺序应在第二个请求中直接lookup replay，不应依赖unique race。跨Task同key/different identity可以真实同时通过lookup并在flush由PostgreSQL决胜。same-identity exact constraint分支只能用test-only受控competitor/sentinel验证，不能描述成正常可达race。 |
| 分类 | replay / 既有领域错误。仅 exact `23505 + name` 后 root rollback、按 key 回查并重验完整 identity；same replay，different 409；winner 缺失/不可验证 re-raise unknown。 |
| HTTP 合同 | replay：202 + canonical GenerationJob。冲突：409；`code=IDEMPOTENCY_CONFLICT`；`message=幂等键已用于另一生成请求`；`details={}`；当前 request ID 写入 ErrorEnvelope/header。 |
| 前端恢复 | AI Production 对冲突清除 command key、显示 message/request ID；用户显式再次提交。成功 replay 采用 canonical Job 并继续 polling，不触发第二次 provider。 |
| worker | 不消费 request-level idempotency key policy。 |
| 原子性 | known/unknown failure 不得留下第二个 Job、ContentVersion、pointer/revision、ReviewRecord、AuditLog 或 dispatch；成功保持 commit-before-dispatch。 |
| 同步面 | 现有 operation 已有 202/409，code 开放 string；OpenAPI/runtime/generated/Frontend V2 无结构或语义变化。stable error-handling spec 需补 GENERATE create/retry coverage，Humanization 两条既有合同不改。 |
| Required tests | unit exact/missing diagnostics、winner missing、same/different identity；GENERATE retry顺序same-key replay且lookup先于latest/新建资格；跨Taskdifferent-identity真实PG race；test-only same-identity exact-constraint sentinel；HTTP envelope/request ID；dispatch=1；未知约束默认500；Humanization create/retry/active-source全回归。 |
| 后续 Task | `generation-job-idempotency-integrity-mapping`，推荐第一个实施。 |

### 3.4 `uq_content_versions_source_job_id`

| 维度 | 冻结结论 |
|---|---|
| 数据与最终名称 | `content_versions(source_job_id)`；nullable UNIQUE；命名约定得到 `uq_content_versions_source_job_id`。 |
| owner | `generation.process_generation_job` worker 最终 INSERT；无 HTTP operation。 |
| 当前协调 | worker 先锁 Job；非 PENDING 状态早返；provider 前按 source_job_id 查已有版本并将 Job 收敛为 SUCCEEDED；最终阶段重新锁 Job 与 Task，再 insert/flush version。 |
| 顺序行为 | 正常 duplicate delivery 由 Job 行锁/status 或 provider 前 existing lookup replay；现有路径不会合法地让同一 Job 两次 final INSERT。 |
| PostgreSQL race | 若 final flush 仍命中该约束，说明有 writer 绕过 Job lock/final transaction，或存在孤儿/不一致 winner。约束名本身不能证明 winner 已正确更新 task pointer、fact/source identity 和 Job terminal state。 |
| 分类 | **保留现有顺序 replay；精确唯一冲突仍显式失败。** 不新增 post-error winner replay，不映射 HTTP code。 |
| HTTP 合同 | 不适用。 |
| 前端恢复 | Job 最终投影为 `FAILED`，显示公开 `GENERATION_FAILED` / `生成作业执行失败`；不自动创建新版本或自动 retry。 |
| worker | final transaction rollback 后把同一 Job 标为 `FAILED`，`error_code=GENERATION_FAILED`，`error_summary=生成作业执行失败`，清 lease 并 commit。非该 exact pair也沿用 unknown worker failure。 |
| 原子性 | provider 前已提交的 RUNNING/attempt 保留；final ContentVersion、task pointer/revision、Job SUCCEEDED/provider metadata 整笔 rollback；不写 ReviewRecord/AuditLog/dispatch。失败事务只提交 Job FAILED。 |
| 同步面 | 不改 OpenAPI/runtime/generated/Frontend V2；stable spec 可补“pre-provider replay 与 post-flush failure”边界。 |
| Required tests | 正常重复投递单 provider/单 version/SUCCEEDED；真实 exact diagnostics sentinel；冲突后 FAILED、单 version、不动 pointer/revision、无 review/audit/dispatch；worker session rollback 后可继续；CHECK/NOT NULL/FK/其他 unique 同样失败但不伪装。 |
| 后续 Task | 与下一项一起归入 `content-version-identity-integrity-boundary`。 |

### 3.5 `uq_content_versions_task_id`

| 维度 | 冻结结论 |
|---|---|
| 数据与最终名称 | `content_versions(task_id, version)`；UNIQUE；命名约定得到 `uq_content_versions_task_id`。 |
| owner | HTTP：`create_manual_content_version` / `createManualContentVersion`，`create_content_revision` / `createContentRevision`；worker：`process_generation_job`。 |
| 当前协调 | 所有生产 allocator 都先锁 ContentTask，再 `max(version)+1`；HTTP 创建在 flush 后推进 current pointer/revision，worker final transaction同理。 |
| 顺序行为 | 合法 owner 被 Task 行锁串行，不应产生 duplicate version。 |
| PostgreSQL race | 只有旁路 writer、锁协议回归、异常数据或受控 sentinel 才会 23505；冲突不能证明哪一个正文/版本是 canonical。 |
| 分类 | HTTP unknown；worker `FAILED/GENERATION_FAILED`。不 replay、不自动改号、不映射 `REVISION_CONFLICT`。 |
| HTTP 合同 | 默认 500，不冻结 body/code/message/details/request ID。不得泄露 constraint/message。 |
| 前端恢复 | generic server failure；不进入 revision-stale 专用恢复，不自动 replay人工正文。 |
| worker | rollback final transaction，显式 Job FAILED。 |
| 原子性 | HTTP 不得留下 ContentVersion、pointer/revision、review/audit/dispatch；worker保留已提交 RUNNING，回滚 version/pointer/revision/success metadata 后只提交 FAILED。 |
| 同步面 | 不新增 OpenAPI 500、runtime metadata、generated error或Frontend V2 revision语义；database/error specs维持 lock allocator + unknown。 |
| Required tests | real PG catalog/conname；manual、revision、worker三路径；合法双 Session lock 串行；故障 sentinel default 500/no leak 或 worker FAILED；无半写；真实 expected_revision 409 对照。 |
| 后续 Task | `content-version-identity-integrity-boundary`。 |

### 3.6 `uq_content_versions_one_pending_per_task`

| 维度 | 冻结结论 |
|---|---|
| 数据与最终名称 | partial UNIQUE INDEX `content_versions(task_id) WHERE status='PENDING_REVIEW'`；显式名 `uq_content_versions_one_pending_per_task`。 |
| owner | `review.transition_content_version(action="submit-review")` / `submitContentVersion`；无 worker。 |
| 当前协调 | 锁目标 ContentVersion，再锁 Task；校验 expected revision、current pointer、DRAFT状态和质量门禁；无“另一 pending”预检；状态/revision和 ContentReviewRecord 在同一 commit。 |
| 顺序行为 | 正常同一当前版本重复提交会被 revision/status precheck挡住；不同版本请求由 Task锁与current pointer挡住。 |
| PostgreSQL race | 旁路 writer、异常旧 pending 或未来遗漏 owner lock 时，UPDATE/commit 可触发精确 23505。该约束表达已冻结的“每任务至多一个待审核版本”业务状态。 |
| 分类 | 新领域错误，冻结 code `CONTENT_REVIEW_PENDING`；不复用 `REVISION_CONFLICT` 或 `INVALID_STATE_TRANSITION`。 |
| HTTP 合同 | 409；`code=CONTENT_REVIEW_PENDING`；`message=该任务已有待审核内容版本`；`details={}`；`error.request_id == X-Request-ID`。只有 exact pair 映射，其他 diagnostics unknown。 |
| 前端恢复 | 实际consumer是`content-editor-page.tsx`的提交审核Dialog，而非审核页。Editor把该code作为独立pending blocker进入统一冲突UI：保留审核备注、原code和request ID，暂停背景canonical采用；用户显式GET reload前不再次POST，reload失败仍保留输入，成功后才采用canonical editor context。不得把文案或状态伪装为revision conflict。 |
| worker | 不适用。 |
| 原子性 | rollback 目标 status/revision 与待插入 ContentReviewRecord；submit 本身不写 AuditLog；不得动 task pointer/revision、其他版本或 dispatch。 |
| 同步面 | operation已声明409、code为开放string，因此OpenAPI/runtime/generated无diff。必须同步`.trellis/spec/backend/error-handling.md`、必要的database guideline、Frontend V2 content editor/review动作合同，以及`content-editor-page.tsx`/必要model/tests；不把code加全局enum。审核页仅承担approve/request-changes，不是submit consumer。 |
| Required tests | classifier exact/negative；真实partial-index23505；precheck/race均准确；409 envelope/request ID；完整rollback；`content-editor-page.test.tsx`断言备注/code/request ID保留、背景不采用、reload失败保留、reload成功采用canonical、POST仅一次；expected revision409对照。 |
| 后续 Task | 与 approved 项一起归入 `content-version-review-state-integrity-mapping`。 |

### 3.7 `uq_content_versions_one_approved_per_task`

| 维度 | 冻结结论 |
|---|---|
| 数据与最终名称 | partial UNIQUE INDEX `content_versions(task_id) WHERE status='APPROVED'`；显式名 `uq_content_versions_one_approved_per_task`。 |
| owner | `review.transition_content_version(action="approve")` / `approveContentVersion`；无 worker。 |
| 当前协调 | 锁 content/task；读取旧 approved，先改为 SUPERSEDED 并 flush，再把目标设 APPROVED，追加 ContentReviewRecord 与 SUCCESS AuditLog，最终 commit。 |
| 顺序行为 | 合法 approve 在 Task锁内原子 supersede + approve，不应触发 index。 |
| PostgreSQL race | 旁路 owner、预置非法双 approved 或锁/状态机回归可触发 23505；仅凭约束无法安全选择哪个版本应保留。 |
| 分类 | unknown；不新增“已有批准版本”409，不映射 revision/state error。 |
| HTTP 合同 | 默认 500，不冻结 ErrorEnvelope/code/details/request ID。 |
| 前端恢复 | generic failure；不自动 reload/replay，不误判为 revision conflict。 |
| worker | 不适用。 |
| 原子性 | rollback 旧 approved 的 SUPERSEDED/revision、新目标 APPROVED/revision、ReviewRecord与SUCCESS AuditLog；task pointer保持原值，task revision不变。 |
| 同步面 | 不新增OpenAPI 500、runtime/generated或frontend code；stable spec只记录unknown与事务原子性。 |
| Required tests | real PG partial-index诊断；成功 supersede+approve；故障时 default 500/no leak及完整rollback；expected revision 409对照；frontend generic 5xx不自动 replay。 |
| 后续 Task | `content-version-review-state-integrity-mapping`。 |

### 3.8 `uq_fact_versions_product_id`

| 维度 | 冻结结论 |
|---|---|
| 数据与最终名称 | `fact_versions(product_id, version)`；UNIQUE；命名约定得到 `uq_fact_versions_product_id`。 |
| owner | `product_facts.submit_fact_review` / `submitProductFactReview`。`replaceProductFactsDraft` 只更新 Product workspace，不是 owner；无 worker。 |
| 当前协调 | Product `FOR UPDATE`；校验active/revision/body；查询 pending；`max(version)+1`；flush FactVersion 后添加 FactReviewRecord并commit。 |
| 顺序行为 | 同产品请求由 Product锁串行；后到请求通常在 pending precheck返回领域错误。 |
| PostgreSQL race | 旁路锁/异常 allocator才产生23505，无法证明winner正文或version应被重放。 |
| 分类 | unknown；不 replay、不改号、不映射 `FACT_REVIEW_PENDING` 或 `REVISION_CONFLICT`。 |
| HTTP 合同 | 默认500，不冻结body/code/message/details/request ID。 |
| 前端恢复 | generic failure；不自动提交或按revision刷新。 |
| worker | 不适用。 |
| 原子性 | rollback新FactVersion与FactReviewRecord；不改Product workspace/facts_revision、ContentTask pointer、ContentVersion、AuditLog或dispatch。 |
| 同步面 | OpenAPI/runtime/generated/Frontend V2无变更；database/error spec维持allocator lock与unknown。 |
| Required tests | real PG catalog/conname、Product锁串行、unknown 500/no leak、无Version/ReviewRecord半写、session可继续、pending/revision已知错误对照。 |
| 后续 Task | `fact-version-integrity-mapping`。 |

### 3.9 `uq_fact_versions_one_pending_per_product`

| 维度 | 冻结结论 |
|---|---|
| 数据与最终名称 | partial UNIQUE INDEX `fact_versions(product_id) WHERE status='PENDING_REVIEW'`；显式名 `uq_fact_versions_one_pending_per_product`。 |
| owner | `product_facts.submit_fact_review` / `submitProductFactReview`；无worker。 |
| 当前协调 | Product锁后显式pending lookup；命中现有 `FACT_REVIEW_PENDING`；否则分配version、flush FactVersion、添加FactReviewRecord、commit。 |
| 顺序行为 | 正常重复/并发在precheck返回既有409，不触发index。 |
| PostgreSQL race | 绕过owner lock或受控competitor可在flush产生 exact 23505；它与precheck表达同一“已有pending”业务事实。 |
| 分类 | 复用既有领域错误；不replay。 |
| HTTP 合同 | 409；`code=FACT_REVIEW_PENDING`；`message=该产品已有待审核事实版本`；`details={}`；当前 request ID写入ErrorEnvelope/header。 |
| 前端恢复 | 现有Fact workspace刷新canonical workspace，保留错误和request ID；不自动再次提交，reload后按服务端available actions收敛。 |
| worker | 不适用。 |
| 原子性 | rollback新FactVersion与FactReviewRecord；不改Product workspace/facts_revision；无AuditLog/dispatch/task pointer/content version。 |
| 同步面 | operation已有409且code开放string；OpenAPI/runtime/generated无diff。实施时补stable error/database spec和frontend回归；Frontend V2既有语义只需核对/必要时澄清。 |
| Required tests | exact classifier negative matrix；真实partial-index race；precheck与race除request ID外同合同；恰一pending/ReviewRecord；rollback/session复用；frontend reload/保留request ID/no replay。 |
| 后续 Task | `fact-version-integrity-mapping`。 |

## 4. 实施拆分与依赖

| 推荐顺序 | 后续 implementation Task | 单一可 review 目标 | 硬依赖 / 交界 |
|---:|---|---|---|
| 1 | `generation-job-idempotency-integrity-mapping` | 只补 GENERATE create/retry 的 Job idempotency exact race，保持 Humanization 已有两条合同。 | 本决策获批；T1、Humanization 已完成。 |
| 2 | `content-task-idempotency-integrity-mapping` | 只补普通 `createContentTask` 的 exact unique race与ordinary winner identity；不改 GEO incoming command。 | 本决策获批；若source-kind判断需改GEO/shared contract，转T5-C。 |
| 3 | `content-version-identity-integrity-boundary` | 一次审查 `source_job_id` worker source identity与`task_id,version` allocator：保留pre-provider replay，post-flush失败；HTTP unknown/worker FAILED。 | Task 1先完成以避免同时修改generation测试/fixture。 |
| 4 | `content-version-review-state-integrity-mapping` | 同一review owner内：pending映射新`CONTENT_REVIEW_PENDING`，approved保持unknown，并证明整笔事务原子。 | Task 3完成后；不依赖其业务代码，但复用content-version diagnostics证据。 |
| 5 | `fact-version-integrity-mapping` | 同一`submit_fact_review` owner内：product/version unknown，pending复用`FACT_REVIEW_PENDING`。 | 本决策获批；代码上可独立，按单分支review顺序置后。 |
| T5-C | publication/GEO 独立合同与实现任务 | `source_published_content_issue_id`及GEO incoming/shared-key语义。 | 不属于本任务，不由上述Task偷偷实现。 |

## 5. 推荐第一个实施任务的精确验收

推荐首先创建 `generation-job-idempotency-integrity-mapping`，因为 GENERATE create/retry 的真实跨Task race可达、已有Humanization mapper与测试模式可复用，并且不需要新增公共code。

验收标准：

1. GENERATE retry先验证previous存在、contract可重试、状态FAILED、Task仍OPEN及旧snapshot，然后在latest-job与当前facts/product等“新建专用资格”之前计算identity并lookup。第一次retry成功后，同previous/key的顺序重试返回同一Job 202；different key仍由latest-job规则拒绝。
2. 同Task同identity并发由Task锁串行，第二请求走上述lookup replay；只持久化一个Job且dispatch总计一次。该正常路径不得依赖unique violation。
3. 跨Task同key/different identity的真实PostgreSQL race只有一个winner；败者rollback后返回HTTP409，准确`IDEMPOTENCY_CONFLICT`、`幂等键已用于另一生成请求`、`details={}`，ErrorEnvelope request ID与`X-Request-ID`一致。
4. test-only受控same-identity exact-constraint sentinel证明rollback后可202 replay；不得把它描述为正常同Task race。
5. mapper只接受`23505 + uq_generation_jobs_idempotency_key`；non-23505、缺sqlstate、缺constraint_name、其他constraint/index及winner missing均重新抛出原IntegrityError并维持unknown500。
6. Humanization现有`uq_generation_jobs_idempotency_key`与`uq_generation_jobs_active_humanization_source`行为、`IDEMPOTENCY_CONFLICT`与`HUMANIZATION_ALREADY_ACTIVE`准确合同全部回归通过；GENERATE不误映射active-humanization index。
7. known/unknown失败都不留下第二个GenerationJob、ContentVersion、task pointer/revision、ReviewRecord、AuditLog或broker dispatch；成功仍commit-before-dispatch，broker失败仍留PENDING供补投递。
8. required validation包含retry顺序测试、精确diagnostics unit matrix、真实PG catalog/跨Taskrace、受控same-identity sentinel、create/retry HTTP envelope/request-ID与side-effect断言；full backend suite为optional，未运行时记录残余风险。
9. 变更仅限稳定owner与必要测试/spec；不改OpenAPI、runtime metadata、generated client、frontend、数据库schema，不引入全局mapper/framework/repository/第二错误类型系统。

## 6. 仍需后续实证的缺口

- 九项最终名称中，未显式命名的三项由当前SQLAlchemy naming convention、冻结metadata和ORM三方推导；各implementation Task仍须在current-head真实PostgreSQL catalog中断言最终名称和`orig.diag.constraint_name`。
- 当前工作区研究未运行新race/HTTP/frontend测试；planning结论不能替代实现后的真实PostgreSQL证据。
- 父research把FactVersion owner误写为`replaceProductFactsDraft`并曾记录过时全局409；本任务以当前代码的`submitProductFactReview` owner和unknown default500为准，不修改父任务文件。
- ContentTask普通/GEO共享全表idempotency key且identity比较不对称。T4-C只批准普通incoming边界；完整双向cross-command语义必须在T5-C复核。
- ORM对`source_published_content_issue_id`的`SET NULL`声明与历史migration的`RESTRICT`证据存在漂移候选；它不改变本次唯一性分类，留给T5-C/数据库合同审计，不在本任务修复。
