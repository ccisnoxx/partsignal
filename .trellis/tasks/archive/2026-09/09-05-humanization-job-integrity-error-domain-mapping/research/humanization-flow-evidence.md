# Research: Humanization Job IntegrityError 调用路径与事务证据

- Query: 审计 `createHumanizationJob` 与 HUMANIZE `retryGenerationJob` 经 `_create_job` 写入 `generation_jobs` 的完整路径；核对预检、幂等重放、最终 PostgreSQL `23505`、副作用原子性以及 HTTP/Worker Session owner，并为只识别两个既有唯一性 enforcement 提供实施验证依据。
- Scope: mixed（源代码、测试、合同/spec 与开发库 PostgreSQL catalog 只读查询；current-head catalog 待实施前复核）
- Date: 2026-09-05

## Findings

### 1. HTTP operation 与完整调用链

#### `createHumanizationJob`

1. `backend/app/routers/production.py:243-268` 声明 `POST /api/v1/content-versions/{content_version_id}/humanization-jobs`，`operation_id="createHumanizationJob"`，成功状态为 `202`，接受 `HumanizationJobCreate(ai_model_id)` 和 `Idempotency-Key`。路由把同一个 request `DbSession`、当前 `EngineerUser`、request ID 与 key 传给 service。
2. `backend/app/services/content_production.py:440-463` 先读取 source identity，再以 `ContentTask.id` 锁任务（`453-455`），再次以 `ContentVersion.id` 锁源版本（`456-459`），读取 AI model（`461-463`）。这些是请求边界的资源/资格预检，不是数据库唯一性最终防线。
3. 同 key 预检在 `:464-476`：如果已有 `GenerationJob.idempotency_key`，直接进入 `_create_job`，由 `_create_job` 对任务、`retry_of_id`、模型、作业类型和源版本做载荷一致性判定；一致返回已有对象，不一致抛 `IDEMPOTENCY_CONFLICT`。这条 replay 分支不调用 dispatch。
4. 没有同 key 时，`_validate_humanization_source` 在 `:477` 检查任务为 `OPEN`、源为当前 AI `DRAFT|CHANGES_REQUESTED`、事实绑定和内容哈希；活动作业预检在 `:478-486` 查询同源 `HUMANIZE` 且 `PENDING|RUNNING` 的 job，命中即抛 `HUMANIZATION_ALREADY_ACTIVE`。
5. 首次写入在 `:487-495` 调用 `_create_job`。`_create_job` 的公共 owner 在 `:279-387`：若不是 replay，构建不可变 humanization snapshot（`:351-365`）、计算 prompt hash（`:366-368`）、添加 `GenerationJob`（`:369-385`），并在 `:386` 执行 `db.flush()`。因此两个目标唯一性冲突都首先应在这个 flush 边界识别。
6. 当前 create 仅在 `:496-511` 捕获任意 `IntegrityError`，先 root `rollback()`（`:497`），回查 idempotency key（`:498-500`），有行时按业务字段猜测 replay/conflict（`:501-510`），无行时一律猜成 `HUMANIZATION_ALREADY_ACTIVE`（`:511`）。这会把第三唯一约束、CHECK、NOT NULL、FK、trigger 或缺少 diagnostics 的错误误报为 409；也没有检查 `sqlstate` 或 `diag.constraint_name`。
7. 创建成功时 `:512-516` 先 `db.commit()`，再 `_dispatch_job(job)`；`_dispatch_job` 在 `:390-395` 通过 Celery sender 投递 UUID（eager 模式则直接调用 worker）。commit 与 dispatch 是两个边界；dispatch 失败不会撤回已提交的 PENDING job，交给 `generation_dispatch` 的补投递机制。

#### `retryGenerationJob`（只覆盖 `previous.job_type == "HUMANIZE"`）

1. `backend/app/routers/production.py:308-330` 声明 `POST /api/v1/generation-jobs/{generation_job_id}/retry`，`operation_id="retryGenerationJob"`，成功状态为 `202`，接受原 job ID 与 `Idempotency-Key`，调用 `retry_generation_job_command`。
2. service `backend/app/services/content_production.py:519-551` 读取旧 job，检查快照版本、`FAILED` 状态、OPEN 父任务、最新 job 资格；父任务在 `:539-542` 以 `FOR UPDATE` 锁定。
3. 在 `:552-561` 先校验旧快照和事实/产品资格。幂等 key 预检在 `:562-573`：已有 key 直接调用 `_create_job(retry_of=previous)`；同 key 且 `retry_of_id`、任务、模型、job type、source 一致时 replay，否则 `IDEMPOTENCY_CONFLICT`。这条分支同样不 dispatch。
4. 对 HUMANIZE，源版本锁定、哈希/快照一致性检查以及活动作业预检位于 `:574-596`；活动命中立即抛 `HUMANIZATION_ALREADY_ACTIVE`。
5. 真正 retry 写入在 `:597-599` 再次调用 `_create_job`，但没有本地 `try/except IntegrityError`。因此最终 flush 的任意 `IntegrityError` 当前逃逸到 HTTP Session 依赖/全局边界；T4 窄切片必须把同一精确 diagnostics 判定覆盖此处，且只覆盖 HUMANIZE，不改变 GENERATE retry。
6. 成功时 `:600-604` 与 create 一样先 commit、后 dispatch。retry `_create_job` 使用旧作业的 job type、source、model 和原 input snapshot（`:323-350`），不会重建来源正文。

### 2. `_create_job` replay 语义与两个唯一性 enforcement

`_create_job` 的已有 replay 判定集中在 `backend/app/services/content_production.py:295-322`：

- `existing` 由精确 `idempotency_key` 查询（`:295-297`）。
- 期望值来自 `retry_of` 或 humanization source：task、`retry_of_id`、AI model、job type、`source_content_version_id`（`:299-305`）。任一不同即 `IDEMPOTENCY_CONFLICT`（`:306-313`）。
- 原始 GENERATE 另比较 platform Prompt ID/revision（`:314-321`）；HUMANIZE payload 没有额外可变字段，因而同 key 同 task/source/model/type/retry parent 即是同一请求签名。
- 一致时返回 `(existing, False)`（`:322`），调用方不会再次 commit 或 dispatch。

开发库 catalog 的只读观察（开发库 `alembic_version=0038_published_article_delete`，而仓库 Alembic head 为 `0043_geo_platform_identity`；未写入业务数据）如下。由于 `0039`–`0043` 的迁移静态搜索未触及 `generation_jobs`，可推断下列对象未被这些迁移改名或重建，但这不是 current-head catalog 实测：

| enforcement 名称 | catalog 类型 | 表/列 | 精确谓词/定义 | 静态来源 |
|---|---|---|---|---|
| `uq_generation_jobs_idempotency_key` | `pg_constraint.contype='u'` UNIQUE（其物理实现同时表现为同名 unique index） | `generation_jobs(idempotency_key)` | `UNIQUE (idempotency_key)` | `backend/app/models/ai_generation.py:179-184` 的 `unique=True`；命名约定 `backend/app/db.py:12-17`；开发库 catalog `pg_constraint` 观察，current head 仍需复核 |
| `uq_generation_jobs_active_humanization_source` | partial UNIQUE index | `generation_jobs(source_content_version_id)` | `job_type='HUMANIZE' AND status IN ('PENDING','RUNNING')` | `backend/app/models/ai_generation.py:171-176`；`backend/alembic/versions/0017_content_humanization.py:65-71`；开发库 `pg_indexes` 观察，current head 仍需复核 |

当前 `pg_constraint` 查询还确认 generation job 的其他 enforcement 包括 7 个 CHECK、7 个 FK 和 1 个 PK；它们不是本切片的可映射目标。尤其 `backend/app/models/ai_generation.py:137-165,180-223` 定义了 job type/source CHECK 及 task/content/source/retry/actor/AI 配置外键。实现不得因为 flush 发生在 `_create_job` 就把这些错误猜作两个 409。

#### 精确映射矩阵

| 触发时点/条件 | PostgreSQL diagnostics | service 结果 | HTTP/副作用 |
|---|---|---|---|
| 同 key、同 HUMANIZE task/source/model/retry parent，预检或 `_create_job` replay | 无 `IntegrityError`；已存在行 | 返回原 job，`created=False` | `202`；不新增 job，不递增 task revision，不建 ContentVersion/ReviewRecord/AuditLog，不 dispatch |
| 同 key 但 task/source/model/job type/retry parent 不同 | 通常无 flush（已有行分支） | 既有 `IDEMPOTENCY_CONFLICT` | `409 ErrorEnvelope`；原 job 与其他状态不变 |
| 已有同源 `HUMANIZE` PENDING/RUNNING，活动预检命中 | 无 `IntegrityError` | 既有 `HUMANIZATION_ALREADY_ACTIVE` | `409 ErrorEnvelope`；不写入、不 dispatch |
| 两请求越过 key 预检，flush 触发幂等唯一 | `orig.sqlstate == "23505"` 且 `orig.diag.constraint_name == "uq_generation_jobs_idempotency_key"` | root rollback；按 key 读取已提交 winner，再复用 `_create_job` 的字段一致性判定：一致 replay，不一致 `IDEMPOTENCY_CONFLICT` | replay 为 `202` 且不 dispatch；异载荷为 `409`；失败请求不得留下 job/副作用 |
| 两写入者竞争同一活动 humanization source，flush 触发 partial unique | `orig.sqlstate == "23505"` 且 `orig.diag.constraint_name == "uq_generation_jobs_active_humanization_source"` | root rollback 后抛 `HUMANIZATION_ALREADY_ACTIVE` | `409 ErrorEnvelope`；不查询后猜 key，不新增 job/副作用 |
| diagnostics 缺失、SQLSTATE 非 `23505`、constraint 名非上述两项；包括 generation job 的 CHECK/NOT NULL/FK/PK 或 trigger failure | 不满足上述精确双条件 | 原 `IntegrityError` 继续上抛；不解析文本、不二次查询分类 | HTTP request Session 由 `get_db()` rollback/close，进入默认 unknown 500；不得伪装为 409 |

两条 23505 映射必须同时覆盖 create `:487-495` 和 retry HUMANIZE `:597-599`。只在已确认 idempotency diagnostics 后做 winner 查询；不能在 unknown 约束或 diagnostics 缺失后通过回查某行来猜领域含义。

### 3. 事务、原子性与 Session owner

- HTTP route 的 `DbSession` 是 `Annotated[Session, Depends(get_db)]`（`backend/app/deps.py:25`）。`backend/app/db.py:31-40` 为每个请求创建 Session，异常时 rollback，finally close。service 是业务命令的 commit owner；全局/依赖层只负责逃逸异常的清理，不应承担领域分类。
- create/retry 的 `_create_job` 只向当前 Session `add` 一个 GenerationJob 并在 flush 发现唯一性（`:369-387`）。该命令没有 `append_audit`、ContentVersion、ContentReviewRecord、ContentTask 指针或 revision 写入；相关模型定义分别见 `backend/app/models/content.py:28-169`，但这些变化发生在后续 worker，而不在入队命令。
- 对两个已知 23505，mapper 必须在 failed Session 上先 root `db.rollback()` 再查询 winner/抛 `AppError`；否则 SQLAlchemy Session 处于 failed/partial-rollback 状态，不能安全查询或继续 flush。对 unknown 不要自行包装；原异常向上抛，由 `get_db` rollback/close。当前没有 `begin_nested()`/SAVEPOINT 使用，不能为了 mapper 引入第二套事务 owner。
- commit 位于 dispatch 之前（create `:512-515`、retry `:600-603`）。因此 commit 失败时不应投递；commit 成功后 broker 失败由 `backend/app/services/generation_dispatch.py:68-87` 的独立 `SessionLocal.begin()` 记录投递诊断，保留 PENDING 供恢复器处理。mapper 不得移动 commit、追加补偿 dispatch 或把 broker 异常转成业务 409。
- worker 不共用 HTTP request Session：`backend/app/services/generation.py:339-342` 每次 `process_generation_job` 使用独立 `SessionLocal()`，先锁 job；`PENDING -> RUNNING` 在 `:373-379` 单独 commit。供应商返回后再次锁 job/task、创建 `ContentVersion` 并在 `:438-463` flush/commit，同时设置 `ContentTask.current_content_version_id` 和 `task.revision`（`:440-454`）以及 job 成功状态。
- worker 成功路径没有 `ContentReviewRecord` 或 `append_audit`；审核记录只在 `backend/app/services/review.py:389-411` 的人工审核命令产生。worker 任意异常在 `generation.py:473-486` rollback 后把 job 标记为 FAILED 并提交，这是 Worker 自有失败状态，不经过 HTTP `IntegrityError` mapper。因而本切片的“unknown -> 默认 500”验收适用于 create/retry HTTP 写入；若产品要求 worker 的未知数据库故障也必须 HTTP 500，需要另立边界/合同任务，不能偷偷扩大本切片。
- 既有 worker integration 已证明上述边界：并发重复 worker 只产生一个 content version（`backend/tests/integration/test_generation_reliability.py:460-498`），自然化版本链与 source 不可变保持正确（`:501-562`）；这些测试不应被改成复用 HTTP mapper。

### 4. 现有测试覆盖与缺口

#### `backend/tests/integration/test_generation_reliability.py`

- `temporary_database` 在 `:48-76` 建立真实 PostgreSQL 数据库并升级到 head；这是本切片触发真实 catalog/diagnostics 的正确基础设施，缺少数据库时明确 skip，不以 SQLite 替代（`:51-55`）。
- `seed_generation_job`（`:200-351`）、`clone_retry_job`（`:370-386`）和 `seed_humanization_job`（`:389-456`）直接用 psycopg 写入 worker fixture；它们没有调用 `create_humanization_job` 或 `retry_generation_job`，因此不能证明 HTTP service 的 precheck、`_create_job` flush catch 或 ErrorEnvelope。
- 已有测试覆盖 worker duplicate provider/content version（`:460-498`）、真实 HTTP AI provider 的 HUMANIZE execution 与 immutable `based_on_id`（`:501-562`）、lease timeout/retry（`:566-623`）、broker redispatch（`:626-685`）和 provider failure diagnostic（`:766-794`）。没有 create/retry HUMANIZE 的 idempotency replay、异载荷冲突、active conflict、23505 diagnostics、unknown sentinel、task/revision/review/audit 副作用断言或 HTTP request Session cleanup。

#### `backend/tests/unit/test_generation.py`

- `SnapshotSession`（`:46-70`）只模拟 `get/scalar/scalars/execute`，没有 `add/flush/commit/rollback`；因此适合 snapshot/资格投影测试，不适合作为事务/IntegrityError 唯一证据。
- 现有 retry 单元测试仅验证 legacy snapshot 拒绝（`:283-310`）、retry projection/latest job（`:313-403`）和 worker/input guards（`:405-470`）。没有 `_create_job`/`create_humanization_job` 调用、错误 diagnostics 分类、rollback 后 winner 查询或未知错误原抛断言。

### 5. 建议 required validation（实施 task 应固化实际 nodeid）

以下是实现批准前应写入该 Task `implement.md` 的 required validation；命令必须使用实际新增测试 nodeid，不能只依赖宽泛 `-k`：

1. **真实 current-head catalog/diagnostics：** 在实施前由 Alembic `upgrade head` 创建的临时 DB（不得使用当前 `0038` 开发库作为 head 证据）中，只读断言 `pg_constraint` 中 `uq_generation_jobs_idempotency_key` 的 `contype='u'`、`pg_indexes` 中 `uq_generation_jobs_active_humanization_source` 的 predicate/列，并用真实 service flush 竞争至少各触发一次 `23505 + diag.constraint_name`。不能把仅有开发库观察或 monkeypatch 的异常对象当成唯一证明。
2. **create API/service 正例：** 调用真实 `createHumanizationJob`（推荐沿现有 TestClient + `get_db` override 模式）验证首次 `202`、同 key 同 payload 返回同 job 且不增加行/dispatch；同 key 异 model 或 source 返回 `409 IDEMPOTENCY_CONFLICT`，原 job 不变。
3. **create active 冲突：** 已有活动 HUMANIZE job 时验证预检返回 `409 HUMANIZATION_ALREADY_ACTIVE`；另用不会被预检吞掉的最终 unique 竞争验证同 code。
4. **retry HUMANIZE 对称覆盖：** 构造 FAILED HUMANIZE latest job，分别验证同 key 同 retry parent replay、同 key 异 retry parent `IDEMPOTENCY_CONFLICT`、预检 active conflict，以及最终 flush 的两个 diagnostics 与 create 返回相同领域结果；GENERATE retry 仅作回归，不在本切片改变。
5. **unknown sentinel：** 真实 PostgreSQL 至少触发一个未列名 FK（例如 `created_by` 指向不存在用户）或 NOT NULL 作为 service flush sentinel；另以最小 unit sentinel 补 diagnostics 缺失、非 `23505`、第三 constraint/CHECK 分支。所有 unknown 必须原抛，不调用 winner 查询、不返回 `IDEMPOTENCY_CONFLICT`/`HUMANIZATION_ALREADY_ACTIVE`。若要通过测试专用 SQL/监听器制造异常，不得修改生产 schema、约束或生产数据。
6. **失败原子性：** 每个已知冲突与 unknown 失败均在新 Session 查询：只有原有 winner（若适用），无第二 generation job；任务 `current_content_version_id` 与 `revision` 不变；无 ContentVersion、ContentReviewRecord、成功 AuditLog；失败请求 Session rollback 后可继续查询。成功入队只应有一个 PENDING job，dispatch 仍发生在 commit 后。
7. **worker 边界回归：** 运行当前 worker reliability tests，确认 HTTP mapper 变更没有改变独立 `SessionLocal` 的 duplicate worker、HUMANIZE immutable version、late result、broker recovery 和 provider failure 行为；不得把 worker exception 改成 HTTP error handler。

建议 required 命令形状（实施时替换为精确 nodeid，并在 backend 容器/项目既定环境执行）：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_generation_reliability.py -k 'humanization_job_integrity or humanization_retry_integrity'

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/unit/test_generation.py -k 'humanization_job_integrity or generation_integrity'

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_generation_reliability.py -k 'duplicate_workers or humanization_uses_real_http'
```

`-k` 只是规划中的命令形状：实现后若收集数为零，必须替换成实际 nodeid。由于本切片不改 OpenAPI/runtime metadata/generated client/frontend，`make contract-check` 可作为低成本回归检查，但不是证明 diagnostics、并发和事务原子性的替代品；若实现意外需要新增 error code/status、router metadata、contract、generated 或 frontend 文件，应立即停止并升级为 `content-integrity-error-contract-decision`。

## External references

- `backend/pyproject.toml:17,21`：运行依赖约束为 `psycopg[binary]>=3.2,<4`、`sqlalchemy>=2.0.36,<3`；实现只应使用已存在的 DBAPI `orig.sqlstate` 与 `orig.diag.constraint_name` 结构化字段。
- `.trellis/spec/backend/error-handling.md:70-116`：唯一约束 mapper 必须在 flush 边界精确读取 diagnostics，未知约束原抛；`:118-150`：未知 `IntegrityError` 进入默认 server-error boundary，不冻结 500 JSON 合同。
- `.trellis/spec/backend/database-guidelines.md:488-559`：内容生产、幂等 key、humanization 快照、不可变内容版本及失败不部分写入约束。
- `contracts/database.md:127-137,229-237,391-393`：0017 humanization partial unique、snapshot/source 规则、worker/Job 状态与 downgrade 约束。
- `contracts/openapi.yaml:2264-2291,2310-2332`：`createHumanizationJob` 与 `retryGenerationJob` 已有 202/409/ErrorResponse 声明；本切片复用既有 status/code，不应修改公共合同。

## Related specs

- `.trellis/tasks/09-04-integrity-error-domain-mapping/prd.md:46-77,53-77`：三类失败、结构化 diagnostics、unknown 边界与 rollback 所有权。
- `.trellis/tasks/09-04-integrity-error-domain-mapping/design.md:143-158,194-216`：T4 content/generation 目标、只映射两个 generation humanization enforcement、worker/HTTP 事务边界。
- `.trellis/tasks/09-04-integrity-error-domain-mapping/implement.md:204-216`：T4 现有人性化窄切片文件边界及 required validation 方向。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md:183-189,382-388`：浏览器使用 stable Idempotency-Key、humanization/retry token、409 不自动 replay；本切片不改变 frontend projection。

## Caveats / Not Found

- 本次 catalog 证据来自开发数据库的只读查询，且该库 `alembic_version=0038_published_article_delete`，落后于仓库 Alembic head `0043_geo_platform_identity`；没有为捕获真实异常而写入、竞争或清理业务数据，因此本文件没有声称已观察某次 psycopg exception 实例的 `orig.diag` 值。由于 `0039`–`0043` 静态搜索未触及 `generation_jobs`，对象未漂移只是推断；实施前 required gate 必须在隔离的真正 current-head PostgreSQL 中重新查询 catalog，并捕获断言 `23505` 与上述名称。
- 两个服务入口都锁同一个父 `ContentTask`；同一 source 的两个正常 HTTP 请求通常会被任务行锁串行化，活动 partial unique 的最终竞态证明不能简单声称“两条 service 调用自然并发越过预检”。应使用不改变 production lock 的测试专用竞争者/独立 `_create_job` flush 边界，或明确记录该锁导致的等待证据；禁止为制造 race 移除 `FOR UPDATE`。
- 当前 create 的 `except IntegrityError` 会在 rollback 后把“key 查询不到”猜成 active；retry 没有 catch。两者都是本切片必须修正的生产缺口。不得只删 catch 或只增加 broad `23505` fallback。
- `_create_job` 的 HUMANIZE 输入请求 schema 只有 `ai_model_id`（`backend/app/schemas/content.py:254-256`），所以“异 payload”主要表现为不同 model/source/retry parent；actor、request ID 和 HTTP key 不应被误当作 job payload 字段。
- 本次未运行 pytest、`make contract-check`、Alembic upgrade 或 HTTP 请求；只读静态审计与 catalog 查询不替代实施后的 required validation。
- 未发现当前 humanization service 需要新增公共错误码、HTTP status、OpenAPI 字段、generated client 或 frontend wire 变化；若实施过程中出现该证据，必须停止并另立 `content-integrity-error-contract-decision`，不能扩大本 Task。
