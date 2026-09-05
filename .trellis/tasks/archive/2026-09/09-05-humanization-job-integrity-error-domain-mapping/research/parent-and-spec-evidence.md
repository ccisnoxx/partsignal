# Research: Humanization Job IntegrityError 父计划与后端 spec 证据

- Query: 为 `humanization-job-integrity-error-domain-mapping` 规划 T4 的第一个窄切片，核对父任务对 unknown/default 500、精确 constraint-name 映射、事务所有权、原子副作用和文件边界的要求。
- Scope: internal
- Date: 2026-09-05

## Findings

### 1. 父计划已经批准的 T4 边界

父任务 PRD 把总目标定义为：已知数据库约束由业务 command 的 service owner 精确映射；只有真实 `expected_revision` 过期才继续使用 `REVISION_CONFLICT`；未知 `IntegrityError` 必须显式失败（父 PRD `:3-7`）。父计划同时确认：未知错误回到 FastAPI/Starlette 默认 500，不冻结新的 JSON body/code/header/request ID；已知映射只能依赖结构化 PostgreSQL diagnostics；新增 code、稳定 JSON 500 或前端恢复政策必须先走 contract-first（父 PRD `:16-22`）。

父设计将 T4 第一窄切片明确写成：

- `createHumanizationJob` 与 HUMANIZE 类型的 `retryGenerationJob` 都通过 `_create_job` 写 `generation_jobs`；
- 仅识别 `uq_generation_jobs_idempotency_key` 和 `uq_generation_jobs_active_humanization_source`；
- 仅复用现有 `IDEMPOTENCY_CONFLICT` 与 `HUMANIZATION_ALREADY_ACTIVE`；
- 其他 unique、CHECK、NOT NULL、不可变 trigger 默认内部失败；
- 窄切片文件边界为 `backend/app/services/content_production.py`、`backend/tests/integration/test_generation_reliability.py`、`backend/tests/unit/test_generation.py`、`.trellis/spec/backend/error-handling.md`（父设计 `:252-256`；父 implement `:183-216`）。

父计划的“仅修现有 humanization code”说明比完整 T4 更窄：不应顺手修改 `content_planning.py`、`generation.py`、`review.py`、router、OpenAPI、generated client 或前端；若其他 content/generation unique 需要新 code，先另立 `content-integrity-error-contract-decision`（父 implement `:191-208`）。因此本子任务的 PRD/design/implement 必须把“shared `_create_job` 的非 HUMANIZE caller 不改变”写成验收边界，不能因为 helper 共用而扩张到 `createGenerationJob` 或 worker。

### 2. 两个目标约束的精确映射矩阵

| 数据库诊断（必须同时满足） | 表/列与定义证据 | 本子任务 HTTP owner / 现状 | 目标领域结果 | 预检、回查和副作用规则 |
|---|---|---|---|---|
| `sqlstate=23505` 且 `diag.constraint_name == "uq_generation_jobs_idempotency_key"` | `generation_jobs(idempotency_key)` UNIQUE；`backend/alembic/versions/0004_content_production.py:3-16`、`backend/app/migration_schema_v1.py:426-435`（字段/unique 证据 `:434`）、`backend/app/models/ai_generation.py:183`；父矩阵 `research/database-constraint-matrix.md:107` | `_create_job` 的 `createHumanizationJob` 与 HUMANIZE `retryGenerationJob`；当前 create humanization 在 `content_production.py:496-511` 先 rollback 后按 key 回查，retry 没有对应精确 catch（父路径审计 `research/backend-integrity-paths.md:46`、`transaction-handler-design.md:101`） | 复用既有 `IDEMPOTENCY_CONFLICT`，保持既有 `409`、message、details/ErrorEnvelope；同 key 同 payload 返回已存在 job 的既有 replay 结果 | 业务预检仍可提前 replay/conflict，但不能取代 DB；命中该 conname 后才允许 rollback 并回查同 key。回查只用于比较已验证的 canonical payload：相同 payload replay 且不得产生新副作用；不同 payload 抛 `IDEMPOTENCY_CONFLICT`。若 conname、SQLSTATE 或 diagnostics 缺失，禁止回查后推断为幂等冲突。 |
| `sqlstate=23505` 且 `diag.constraint_name == "uq_generation_jobs_active_humanization_source"` | `generation_jobs(source_content_version_id)` partial UNIQUE INDEX，谓词 `job_type='HUMANIZE' AND status IN ('PENDING','RUNNING')`；`backend/alembic/versions/0017_content_humanization.py:65-71`、`backend/app/models/ai_generation.py:166-175`、业务合同 `database.md:129`；父矩阵 `research/database-constraint-matrix.md:121` | `createHumanizationJob` 与 HUMANIZE `retryGenerationJob` 都是 owner，均有活动作业预检；当前 create 对任意 IntegrityError 无诊断地猜 `HUMANIZATION_ALREADY_ACTIVE`，retry 无 catch（父路径审计 `research/backend-integrity-paths.md:46`、`transaction-handler-design.md:101`） | 复用既有 `HUMANIZATION_ALREADY_ACTIVE`，保持既有 `409`、message、details/ErrorEnvelope；create 与 retry 行为一致 | 只在该精确 `23505 + constraint_name` 命中后返回 active 冲突；不得用“查不到幂等行”作为 active 证据，也不得把任意 23505/其他异常降级为此 code。失败 root transaction 不得留下 job、version、review、task pointer、revision、AuditLog 或 dispatch。 |

这里的“constraint_name”以实施期当前 head PostgreSQL 返回的 DBAPI diagnostics 为最终权威。父静态审计已记录 migration/model 名称，但本研究阶段没有执行数据库连接或写入测试；实施 required validation 必须实测两个名称、`23505` 和 partial index 的 `diag.constraint_name`，若 catalog 名称与上述值不一致，立即停止，不得加 alias、模糊匹配或 migration 改名来掩盖差异。

两行以外的所有 IntegrityError 均保持 unknown：未列名 unique、diagnostics 缺失、非 `23505`、CHECK（通常 `23514`）、NOT NULL（通常 `23502`）、FK（通常 `23503`）和 trigger/迁移 guard（可能 `55000` 或无 constraint name）都不能映射到这两个 409。父设计允许的字段组合是 UNIQUE/PK 的 `sqlstate + constraint_name`；禁止 `str(error)`、`message_primary`、英文数据库文本、substring、猜 column/value，且二次查询不能替代诊断识别（父设计 `:69-77`；错误处理 spec `:74-79`、`:104-115`）。

### 3. Unknown/default 500 边界必须被保留

父设计已决定删除专用全局 `integrity_error_handler`：它把任意完整性错误硬编码成 `409 REVISION_CONFLICT`，而 `ErrorEnvelope` 只服务于业务/校验错误；OpenAPI 没有 ordinary unknown 500 的稳定 code/shape（父设计 `:174-183`）。后端错误处理 spec 的现行合同是：

- 未经 service 以已确认 constraint identity 显式映射的 IntegrityError 原样上抛，由 FastAPI/Starlette 默认 server-error boundary 返回 500；`get_db()` 负责 request Session rollback/close（`.trellis/spec/backend/error-handling.md:118-138`）；
- 默认 500 body、code、Header、media type 不是冻结的 `ErrorEnvelope`，不得新增 OpenAPI 500、generated 类型或前端分支（同 `:125-130`）；
- 已确认约束才在最窄事务边界 rollback 后抛现有 409 AppError（同 `:132-150`）。

因此本子任务只能在 service owner 内增加/修正这两行 allowlist；不能恢复全局 handler、不能把 unknown 改成 `REVISION_CONFLICT`，也不能为 unknown 发明 `INTERNAL_ERROR`/`DATABASE_ERROR`。如果实际验证显示需要稳定 500 JSON、改变 409 status/schema、增加新 code 或修改既有 frontend recovery，则停止并转交 `content-integrity-error-contract-decision`，不扩大本任务四文件边界。

### 4. Session、flush/commit 和 worker 所有权

父事务研究的 owner 规则如下：

- HTTP `get_db()` 每请求创建 SQLAlchemy Session；正常路径不自动 commit，异常路径 rollback 并 close，证据为 `backend/app/db.py:31-40`；它是 request cleanup owner，不是业务 commit owner（父 `research/transaction-handler-design.md:9-16`）。
- `_create_job` 在 `backend/app/services/content_production.py:386` flush；三类 generation caller 的成功 commit 分别在其 command owner，humanization create 为 `:512-515`，retry 的成功边界在父路径清单记为 `:601`（父 `research/backend-integrity-paths.md:102`）。因此 mapper 必须位于 humanization command 可观察的 flush/commit 边界，不能藏在全局 handler。
- Flush 失败后 Session 进入 partial rollback/failed state；在同一 Session 查询或再次 flush 前必须显式 rollback。SQLAlchemy 2.0.51/psycopg 3.3.4 的版本和行为证据见父设计 `:121-131` 及父 `research/transaction-handler-design.md:13-16`。
- `append_audit()` 只向当前 Session add，不自行 commit（`backend/app/audit.py:141-159`；父事务研究 `:81-87`）。所以失败处理必须在成功 audit、revision、task pointer、review/version 等同一事务提交前截断；不能在 rollback 后再次 commit 一个失败命令。
- dispatch 遵守“数据库 commit 后投递”边界（`backend/app/services/content_production.py:433-436,512-515`；父事务研究 `:87`）。唯一冲突或 unknown 失败不得触发 dispatch；若已发生跨进程 I/O，不能声称 DB rollback 能补偿它，需停止并报告超出本切片。
- worker 使用独立 `SessionLocal()`，`backend/app/services/generation.py:339-342`；worker 内容写入异常在 `:473-486` rollback 后把 job 标为 FAILED 并提交。worker 不经过 FastAPI `IntegrityError` handler，HTTP mapper 不得修改其 failure owner、`GENERATION_FAILED` 语义或 worker 的 retry/lease 状态（父 `research/backend-integrity-paths.md:102-105`、`transaction-handler-design.md:11-16`）。

当前仓库无 `begin_nested()`/SAVEPOINT 使用。父设计要求：root rollback/savepoint 必须由 command owner 决定，mapper/helper 不能无条件拥有 rollback；`Session.begin_nested()` 建立 SAVEPOINT 前会无条件 flush，若未来发现 retry 被嵌入组合事务，需先另做事务设计而不是在本子任务中偷偷引入 savepoint（父设计 `:125-131`、`:289-299`）。本子任务的 implement 必须先证明两条 HTTP command 是独立事务 owner；证明不了就停止。

### 5. 预检、replay、竞态和原子性验收要求

父 DB 指南把内容生产合同固定为：任务创建幂等键长度为 8–128；同 key 同三字段 replay、同 key 异载荷 `409 IDEMPOTENCY_CONFLICT`；Redis 不保存幂等状态，数据库是最终权威（`.trellis/spec/backend/database-guidelines.md:499-515`）。对本子任务应转化为以下可观察验收：

1. create 与 HUMANIZE retry 分别验证同 key 同 payload 的 replay 不插入第二个 job、不生成副本 content version、不移动 task pointer、不写 review record/AuditLog、不增加 revision、不 dispatch；返回既有 canonical job。
2. 同 key 异 payload 必须是既有 `IDEMPOTENCY_CONFLICT`，原 job/任务/版本/审核/审计/revision 不变；不能先删除或覆盖既有 job。
3. active humanization 预检命中和数据库最终 `uq_generation_jobs_active_humanization_source` 竞态都返回 `HUMANIZATION_ALREADY_ACTIVE`；必须覆盖 create 与 HUMANIZE retry，且两条路径行为一致。
4. 两个独立 Session/connection 经过 barrier 同时越过预检时，数据库最终只允许一个活动 job；败者得到目标领域错误，失败方没有成功 AuditLog/dispatch/版本/审核/指针/revision。不得以 sleep 或伪造异常证明竞态。
5. 以第三约束/错误类别做 unknown sentinel：未列名 constraint、diagnostics 缺失、非 `23505`、CHECK、NOT NULL、FK、trigger failure 都原样进入默认 500；至少一个真实 PostgreSQL sentinel 必须证明数据库 diagnostics，不得只用 fake `IntegrityError` 作为唯一证据。若某类别无法在现有 command 合法触发，implement 应记录不可达证据并停止增加 test-only 生产绕过，而不是改变生产状态机。

父错误 spec 的测试基线同样要求真实 PostgreSQL 触发精确 constraint、断言稳定 code/details、原记录仍存在且重复记录未提交（`.trellis/spec/backend/error-handling.md:81-100`）；父测试研究补充“没有现有测试直接断言 `orig.diag.constraint_name`/`.sqlstate`，mock 只能补充分支，不能证明 catalog、failed state、锁等待或真实 HTTP rollback”（父 `research/testing-strategy.md:107-112`）。

### 6. Spec 与合同预期改动

本子任务唯一允许修改的 spec 是 `.trellis/spec/backend/error-handling.md`。实施后应在“数据库唯一约束精确映射”场景中补充/校正：

- humanization command 只允许 `23505 + uq_generation_jobs_idempotency_key` → `IDEMPOTENCY_CONFLICT`，以及 `23505 + uq_generation_jobs_active_humanization_source` → `HUMANIZATION_ALREADY_ACTIVE`；
- idempotency 的回查只在已确认诊断后用于同载荷 replay/异载荷 conflict；
- create 与 HUMANIZE retry 共用规则，未知 diagnostics 原抛；
- rollback、成功审计、revision、review、task pointer、content version 与 commit-after-dispatch 的原子性责任归 command owner。

`.trellis/spec/backend/database-guidelines.md` 已有该领域的内容生产合同（`499-523`），本子任务只读依赖，不应在本四文件 slice 中改写；若新增/修订它成为必要条件，说明边界已不再是本用户批准的窄切片，应停止并请主 agent 重新规划。`contracts/openapi.yaml`、runtime route metadata、generated client、Frontend V2 文档和 frontend code 都保持零 diff，因为两种 code/status/details 已是既有 operation 合同（父设计 `:185-201`）；任何需要新增 code/status/schema 或新的前端 recovery 必须改走 contract decision。

### 7. 实施期 required validation（供子任务 implement.md 固化）

以下是应写入子任务 `implement.md` 的 required validation；命令中的新增测试 nodeid 应在实现后用真实测试名替换，不得用宽泛 `-k` 掩盖零收集：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_generation_reliability.py

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_generation.py

make contract-check
```

集成文件中的 required 行为必须至少覆盖：两个约束的真实 catalog/`sqlstate`/`diag.constraint_name`；create 和 HUMANIZE retry 的 active conflict；同 key 同 payload replay；同 key 异 payload `IDEMPOTENCY_CONFLICT`；双 Session barrier 竞态单写成功；unknown sentinel 与不泄漏的默认 500；失败无 job/version/review/task pointer/AuditLog/revision/dispatch；request Session rollback 后独立查询可用。unit 只补充 mapper 的 diagnostics 缺失、非 `23505`、未知 constraint 和 worker/HTTP owner 边界，不替代真实 PG。

`make contract-check` 在本 slice 不表示要改 OpenAPI，而是证明 operation/status/schema/runtime/generated 仍无漂移。`backend/tests/integration/test_generation_reliability.py` 全文件若包含超出本 slice 的既有失败，应只修当前路径归因的 failure；不得为通过 gate 修改不在四文件边界的测试或生产代码。`make verify`、全 backend integration、lint/typecheck 可作为 targeted checks 全通过后的 optional final gate；按父计划规则，正式 full gate 只运行一次，失败后不在同一回合自动重复（父 implement `:289-299`）。

### 8. 停止条件、回滚边界与 review 要求

必须停止并向主 agent 报告、不得自行扩张的条件：

- current-head catalog 返回的约束名不是上述两个精确值，或 partial unique diagnostics 只有无法稳定识别的值；
- 需要新增 domain code、改变现有 status/message/details/ErrorEnvelope、声明新的 500、修改 OpenAPI/runtime metadata/generated client/frontend；
- 为区分异常必须解析数据库文本、猜字段/值、使用模糊 alias，或在 diagnostics 未命中后靠回查推断；
- 需要修改 `createGenerationJob`、worker `generation.py`、router、其他 service、数据库 migration/schema、生产数据或更多 spec；
- 两条 command 不是独立事务 owner，或必须引入组合事务/savepoint 才能保留外层写入；
- 无法在不削弱生产锁/状态机的情况下建立真实 PG race/unknown sentinel；
- 失败后发现已有成功 dispatch 或跨进程副作用发生在 commit 前，导致现有原子性合同无法证明。

回滚只允许撤销本子任务四文件内的 mapper、测试和 `error-handling.md` 条款，并同时撤销对应验收；不回滚数据库 schema，不恢复全局 unknown→revision handler，不修改父任务/历史任务/其他脏文件，不使用 reset、checkout、stash 或清理命令。独立 review 必须核对：两个 allowlist 的精确性、预检/最终 DB authority 一致性、failed Session cleanup、无成功副作用、HTTP/worker Session owner 分界和零公共合同漂移；父计划规定一次 full review、最多一次 targeted re-review，同问题或新 MEDIUM 以上问题即停止（父设计 `:297-310`）。

## Caveats / Not Found

- 本研究只读取了父任务 PRD/design/implement、workflow、后端 `error-handling`/`database-guidelines` spec 及父任务已有研究证据；未运行 `task.py start`、测试、数据库写入、HTTP 请求或 Git 操作。
- 父研究提供了 migration/model 的精确名称和代码行号，但本支线没有直接连接 current-head PostgreSQL catalog；实施 required validation 必须重新观察真实 diagnostics，不能把静态名称当作运行时已验证事实。
- 研究未修改 `prd.md`、`design.md`、`implement.md`、生产代码、合同、spec、测试或数据库；唯一允许的写入是本文件。
- 未发现当前仓库使用 SAVEPOINT/nested transaction 的证据；若实施期发现真实组合事务调用路径，现有窄设计不足以安全决定 rollback/savepoint，必须停止并另行规划。
- 未在本研究阶段新增或决定任何公共错误码；两个目标 code/status/details 均按父计划视为既有合同，不能以本文件发明新 wire 行为。
