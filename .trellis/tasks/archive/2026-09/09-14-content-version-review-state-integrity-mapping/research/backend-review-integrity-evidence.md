# Research: Content Version review state IntegrityError 与事务原子性

- Query: 证据化 `review.transition_content_version` 对 `uq_content_versions_one_pending_per_task` 与 `uq_content_versions_one_approved_per_task` 的 command ownership、PostgreSQL diagnostics、rollback 顺序、HTTP 默认错误边界与后端测试矩阵；确认公共合同和只读 owner 的零 diff 范围。
- Scope: mixed（内部代码、迁移/ORM/合同与现有测试模式；未连接外部 PostgreSQL 实例）
- Date: 2026-09-14

## Findings

### 1. 阅读范围与 owner

已逐行读取并核对本任务要求的工作流、backend error/database spec、两个父任务规划与相关 research、`backend/app/services/review.py`、`backend/app/routers/production.py`、`backend/tests/integration/test_content_review.py`、`backend/tests/unit/test_contract.py`、`backend/tests/unit/test_runtime_response_metadata.py`、`contracts/openapi.yaml` 与 `contracts/database.md`。为确认跨层边界，另外读取了 `backend/app/errors.py`、`backend/app/main.py`、`backend/app/db.py`、`backend/app/models/content.py`、`backend/app/migration_schema_v1.py`、相关 Alembic migration，以及 identity/product/generation/content-task 的精确 diagnostics 与 rollback 测试。

| 文件 | 事实/用途 |
|---|---|
| `backend/app/services/review.py:340-412` | `transition_content_version` 是 submit-review、approve、request-changes 共用的状态转换 command owner。 |
| `backend/app/routers/production.py:541-563` | `submitContentVersion` 直接把请求转给该 owner，传入 `request.state.request_id` 与 `action="submit-review"`。 |
| `backend/app/routers/production.py:566-589` | `approveContentVersion` 先由 router 断言 `ADMIN/ENGINEER`，再转给同一 owner，传入 `action="approve"`。权限边界不应由 IntegrityError 分支改变。 |
| `backend/app/errors.py:15-52` | `AppError` 与 `ErrorEnvelope` handler；已知领域错误输出 `code/message/details/request_id`，默认 `details` 是 `{}`。 |
| `backend/app/main.py:261-295` | request middleware 生成/接受 `X-Request-ID`，正常获得 response 后回写同值 header；没有注册 SQLAlchemy `IntegrityError` handler。 |
| `backend/app/db.py:31-40` | `get_db` 在请求依赖捕获任意异常时执行 `session.rollback()`，随后关闭 Session。 |

### 2. 两个 partial unique index 的真实代码定义

- `backend/app/models/content.py:91-115` 的 `ContentVersion.__table_args__` 定义了两个显式 named PostgreSQL partial unique indexes：
  - `backend/app/models/content.py:98-103`：`uq_content_versions_one_approved_per_task`，唯一 key `task_id`，谓词 `status = 'APPROVED'`。
  - `backend/app/models/content.py:104-109`：`uq_content_versions_one_pending_per_task`，唯一 key `task_id`，谓词 `status = 'PENDING_REVIEW'`。
- 初始 `content_versions` 表由 `backend/alembic/versions/0004_content_production.py:11-16` 通过冻结的 `app.migration_schema_v1.Base` 创建；冻结模型在 `backend/app/migration_schema_v1.py:466-479` 保留 approved index 的同名定义。
- pending index 由 `backend/alembic/versions/0035_business_workflow_primary_tasks.py:186-198` 明确创建，`op.create_index(..., unique=True, postgresql_where=sa.text("status = 'PENDING_REVIEW'"))`。该 migration 同时在 `:186-190` 加入 content status CHECK。
- `contracts/database.md:415-423` 冻结版本号、owner lock、current pointer 与“每任务至多一个 `PENDING_REVIEW` 内容版本”；本文件不允许修改 schema/migration 或 `contracts/database.md`。当前 branch 没有可用 `PARTSIGNAL_TEST_DATABASE_URL`/`DATABASE_URL`，因此尚未执行 `pg_indexes`/真实冲突查询；implementation 必须在 fresh current-head PostgreSQL 中证明两个名称、`indexdef` 谓词与驱动 diagnostics，不能只凭 ORM 命名推断。

建议的 implementation catalog 证据（测试内使用参数绑定）是按两个名称查询 `pg_indexes` 的 `indexdef`，并断言对应表、`UNIQUE INDEX`、`(task_id)` 与 `WHERE ... status ... 'PENDING_REVIEW'/'APPROVED'`；随后在同一 current-head 数据库对每个 predicate 触发真实冲突，断言 `error.orig.sqlstate == "23505"` 且 `error.orig.diag.constraint_name` 精确等于目标 index 名。不得把 `message_primary`、`str(error)`、SQL 文本或约束别名作为 classifier 输入。

### 3. `transition_content_version` 的顺序与事务边界

`review.py` 的现行顺序如下，前半段是必须保持的 precheck 优先级：

1. `:351-353` 以 `ContentVersion.id` `FOR UPDATE` 锁定目标；不存在则 `NOT_FOUND`。
2. `:354-356` 检查 `content.revision`，过期立即抛 `REVISION_CONFLICT`（409）。
3. `:358-360` 以 `ContentTask.id` `FOR UPDATE` 锁定任务；`:360-361` 校验 `task.current_content_version_id == content.id`，失败是 `CONTENT_VERSION_NOT_CURRENT`（409）。
4. `:362-366` 应用 `CONTENT_TRANSITIONS[action]`，非法状态是 `INVALID_STATE_TRANSITION`（409）；`:367-368` 对 request-changes 空白意见返回 `REVIEW_COMMENT_REQUIRED`（当前 HTTP 校验边界）。
5. `:369-372` 在 submit-review/approve 前执行 blocking quality gate，失败仍是 `INVALID_STATE_TRANSITION`（409）。
6. approve 专属 `:373-386`：读取事实并要求 `APPROVED`（`:373-374`，否则 `FACT_NOT_APPROVED`）；查询同 task 的另一 `APPROVED` 版本（`:375-381`），若存在则先改为 `SUPERSEDED`、revision 加一并在 `:382-385` 显式 `db.flush()`。
7. `:387-396` 才把目标 content 改为 transition target、递增 revision，并添加 `ContentReviewRecord`。submit-review 的目标通常由 `DRAFT` 变为 `PENDING_REVIEW`；approve 的目标由 `PENDING_REVIEW` 变为 `APPROVED`。submit-review 本身没有 AuditLog。
8. approve 在 `:397-410` 追加 `content_version.approve` 的 `SUCCESS` AuditLog；`:411` 单一 `db.commit()`。SQLAlchemy commit 会为尚未 flush 的目标状态、ReviewRecord 与 AuditLog 执行最终 flush。
9. `:412` 返回投影。当前实现没有任何 `IntegrityError` import/catch/classifier；因此两 index 命中都按原始异常向上抛，HTTP 侧依赖默认 500。

实现约束：分类与 catch 必须留在该 command owner 的最窄作用域，且只对 `action == "submit-review"` 的 `23505 + uq_content_versions_one_pending_per_task` 产生 `AppError("CONTENT_REVIEW_PENDING", "该任务已有待审核内容版本", 409, {})`。catch 应覆盖 approve 已有的显式 `db.flush()` 与最终 commit 可能发生的晚期 flush；在 exact pending 命中后先 root `db.rollback()` 再抛 AppError。approved exact 命中不得被当成已批准业务冲突：原始 `IntegrityError` 必须继续上抛，不能新增 mapper、winner 查询或 replay。unknown 分支不应吞掉或改写原异常。

### 4. rollback 原子性证据与失败时可观察状态

- submit-review 在现行代码中只在 commit 前修改目标 `ContentVersion.status/revision` 并加入 ReviewRecord（`:387-396`）；没有 task pointer/revision、其他版本、AuditLog 或 dispatch 写入。因此 pending exact conflict 必须回滚这三个候选副作用，并保持 `ContentTask.current_content_version_id`、`ContentTask.revision`、其他版本、AuditLog 与 dispatch 不变。
- approve 在同一 root transaction 中依次可能修改原 approved 的 `SUPERSEDED/status/revision`（`:382-385`）、目标 `APPROVED/status/revision`（`:387-389`）、ReviewRecord（`:390-396`）和 SUCCESS AuditLog（`:397-410`）。approved exact 失败必须整体 rollback，令原 approved 恢复原 status/revision，目标恢复原 status/revision，ReviewRecord/AuditLog 不存在；task pointer/revision 未在 service 内修改且仍须保持原值。
- `db.flush()`/`db.commit()` 引发 SQLAlchemy `IntegrityError` 后，Session 需要 root `rollback()` 才能继续查询。请求依赖 `get_db` 提供兜底 rollback（`backend/app/db.py:31-40`）；service 对已批准 pending exact 分支必须自己 rollback 后再抛 `AppError`，否则 handler/依赖前的 Session 处于 failed transaction 状态。
- unknown 500 不能泄漏原始 `IntegrityError` 的 SQL、表名、index/constraint、driver message 或 stack。现有 content-task HTTP sentinel（`backend/tests/integration/test_content_task_creation.py:466-515`）以 `TestClient(..., raise_server_exceptions=False)` 断言 500 文本不包含这些敏感片段，但不冻结默认 body/media type。Content review 的 implementation 应复用这个模式并新增 approved exact sentinel；不要把默认 500 固定成 `ErrorEnvelope`。

### 5. HTTP/ErrorEnvelope 与只读公共 owner

- `AppError` 的 `error_response`（`backend/app/errors.py:40-52`）固定业务 ErrorEnvelope 字段：`code`、`message`、`details`、`request_id`。request middleware `backend/app/main.py:265-286` 将请求头中的合法 `X-Request-ID` 放入 `request.state`，handler body 与 response header 可保持同值。
- pending exact 409 应断言：`response.status_code == 409`；`response.json()["error"] == {"code":"CONTENT_REVIEW_PENDING","message":"该任务已有待审核内容版本","details":{},"request_id": supplied_id}`；`response.headers["X-Request-ID"] == supplied_id`。不返回 constraint、table、version ID 或数据库 details。
- unknown approved 500 只断言 status 与 no-leak；不冻结 body、code、details、request ID 是否存在、`Content-Type` 或 media type。默认 exception boundary 没有全局 IntegrityError handler，`backend/tests/unit/test_runtime_response_metadata.py:1041-1055` 已冻结 ErrorEnvelope 仅适用于业务 handler，并断言 `IntegrityError not in app.exception_handlers`。
- `contracts/openapi.yaml:2458-2474` 的 `submitContentVersion` 与 `:2492-2508` 的 `approveContentVersion` 均已有 200、401、403、404、409、422、400，错误均引用 `ErrorResponse`；`contracts/openapi.yaml:4192-4206` 的 `ErrorDetail.code` 是开放 `string`，不是枚举。`backend/tests/unit/test_contract.py:182-219` 已把两个 operation 纳入 409 status 集合；`test_runtime_response_metadata.py:780-797` 明确禁止为这类 operation 添加 5xx/default response。
- 因此本任务的只读/零 diff owner 必须保持不变：`contracts/openapi.yaml`、`contracts/database.md`、`backend/app/routers/production.py`、`backend/tests/unit/test_contract.py`、`backend/tests/unit/test_runtime_response_metadata.py`、`frontend/src/shared/api/generated/schema.d.ts` 及 schema/migration。若实现需要改变 status、ErrorDetail、稳定 500 response、router metadata、DB schema、权限或状态机，应停止并上报，而不是扩大本 task。

### 6. 可复用的 exact diagnostics 与 rollback 模式

- `backend/app/services/identity.py:412-423` 是最直接模板：在 `db.flush()` catch `IntegrityError`，同时检查 `orig.sqlstate == "23505"` 与 `orig.diag.constraint_name == "uq_users_username"`；命中先 `db.rollback()`，再抛稳定 AppError；其余原样 `raise`。
- `backend/app/services/content_production.py:360-383`、`backend/tests/unit/test_generation.py:300-348` 展示了 classifier 的 negative matrix：缺 `orig`/`diag`、`None` constraint、其它 constraint、错误 SQLSTATE、CHECK/FK/NOT NULL/trigger-like SQLSTATE 都返回 false/unknown，不看 `str(error)`。
- `backend/app/services/content_planning.py:426-433,488-515` 展示 caller-owned rollback：classifier 只识别 exact pair，caller 执行 `db.rollback()`，再做允许的 recovery；本任务不允许 approved 回查 winner，因此 only-pending mapper 必须保持更窄。
- `backend/app/services/ai_configuration.py:107-117` 与 `backend/app/services/platform_configuration.py:653-660,724-730` 也遵循局部 constraint owner、`flush()` catch、非 exact 原抛；可借其中文注释/命名风格，但不能抽取全局 mapper。
- `backend/tests/integration/test_identity_management.py:1116-1165` 是缺失 diagnostics 的真实 Session 模式：patch flush 抛带 `sqlstate` 但无 `diag` 的原异常，断言原对象身份保留，显式 rollback 后 Session 可继续查询。
- `backend/tests/integration/test_content_task_creation.py:418-464` 是 unknown matrix：SimpleNamespace 构造 `sqlstate/diag`，覆盖 missing diagnostics、other constraint、other SQLSTATE、winner missing/incomplete，断言原 IntegrityError 身份与 rollback/query 次数；`:466-515` 是 HTTP 500 no-leak sentinel。review 测试应复用形式但不要引入 winner query。

## Design / Implement 约束与建议测试矩阵

### A. classifier unit matrix

建议新增 review-local 私有 classifier 的参数化测试（名称可由 design 决定），正例仅：

| action | sqlstate | `diag.constraint_name` | 预期 |
|---|---|---|---|
| submit-review | `23505` | `uq_content_versions_one_pending_per_task` | exact pending，允许转 `CONTENT_REVIEW_PENDING` |

必须为 unknown/re-raise 的负例包括：approved exact 名称；pending 名但 SQLSTATE 为 `23514`/`23503`/`23502`/`55000`；`diag=None`；`constraint_name=None`；其它 unique/PK；`orig=None`；以及 `IntegrityError` 无 diagnostics。附带 `message_primary`/SQL 字符串的 sentinel，用于证明未解析错误文本。若 classifier 接收 action，approve 命中 pending name 也不得映射。

### B. PostgreSQL/catalog 与事务 integration

在 `backend/tests/integration/test_content_review.py` 文件级范围内，使用既有 `temporary_database()`（`test_publication_workflow.py:140-165`）创建独立 PostgreSQL、Alembic upgrade head；不得 SQLite 替代。建议覆盖：

1. `pg_indexes` 断言两个真实 index 名、表、key、partial predicate；分别以真实 SQL 触发 `23505`，断言 `orig.sqlstate`/`orig.diag.constraint_name`。
2. pending exact sentinel：在目标 command 已完成必要 precheck 后，以一次性 test-only competitor/event 在目标最终 flush 前写入同 task 的另一个 pending，令 submit 命中 exact index；断言 HTTP 409 envelope/request ID/header，不能依赖错误文本。
3. pending rollback snapshot：目标 status/revision、待新增 ReviewRecord、task pointer/revision、其他 ContentVersion、AuditLog、dispatch 计数均与基线一致；原 request Session rollback 后可继续 `SELECT`，独立 Session 再核验持久化状态。
4. approved exact sentinel：在 approve 已把原 approved 置 `SUPERSEDED` 并 flush 后，以一次性 test-only competitor 让目标最终 APPROVED 写入命中 exact index；断言原始 unknown 500/no-leak，原 approved/target status+revision、ReviewRecord、SUCCESS AuditLog、task pointer/revision 完整恢复。不要查询 winner、自动 supersede/reload/replay。
5. 成功回归：既有 `test_content_review.py:199-283` 的 approve/request-changes/review history/body/snapshot；新增成功 submit，核验一条 ReviewRecord 与目标 `PENDING_REVIEW`。approve 成功继续核验旧 approved `SUPERSEDED`、目标 `APPROVED`、恰一 approved。
6. 优先级对照：expected_revision stale 仍为 `REVISION_CONFLICT`（现有 `:227-256`）；非当前版本仍 `CONTENT_VERSION_NOT_CURRENT`；非法状态仍 `INVALID_STATE_TRANSITION`；权限拒绝仍 403；blocking quality gate 仍原 code/status。每个对照都应在 IntegrityError catch 之前失败，且不产生 flush side effect。
7. session/HTTP unknown：`raise_server_exceptions=False`；断言 unknown 500 不含 `INSERT INTO`、`content_versions`、任一 index 名、driver message 或 `Traceback`，不检查默认 JSON/body/media type。失败后以新 Session 读取，且请求依赖 Session cleanup 不影响后续请求。

并发/注入必须使用 event/barrier、一次性 SQLAlchemy event 或独立 connection 和有界 timeout；不可通过移除 Task/Version lock、修改 schema/migration、sleep 或伪造“成功的真实 PG diagnostics”来制造证据。由于正常 owner 按 content→task 锁序串行，合法双 submit 的第二次通常在 precheck 得到 revision/state error；partial-index race 应明确标注为受控旁路/sentinel，而非正常 owner 行为。

### C. 不应修改的内容

- 不建立全局 `IntegrityError` handler、constraint registry、第二套 error type system 或 generic mapper。
- 不把任何 23505、approved exact 或 identity/version unique 映射为 `REVISION_CONFLICT`；只有 `review.py:354-356` 的真实 expected revision stale 保留该 code。
- 不解析 `str(error)`、driver message、表名或 index 文本；不在 rollback 后查询并选择 canonical winner。
- 不让 submit pending blocker 进入 Content Review Page 的 approve-only 分支；前端消费由后续 editor task 负责，本 backend task 只提供稳定 409 与原子性证据。
- 不修改 `backend/app/routers/production.py`、OpenAPI、generated schema、database contract、数据库 schema/migration、权限模型或状态机；若必要性被证据证明，停止报告。

## Related specs

- `.trellis/spec/backend/error-handling.md:61-116`：局部 exact diagnostics mapper、已确认冲突 rollback、其它 IntegrityError 默认 500；`:173-205`：无全局 IntegrityError handler、未知错误不冻结 ErrorEnvelope。
- `.trellis/spec/backend/database-guidelines.md:346-353`：ContentVersion allocator/final transaction 及失败整体 rollback；`:733-749`：SUCCESS AuditLog 与业务写入同事务提交或回滚。
- `contracts/database.md:415-423`：版本 owner lock、current pointer 与每任务至多一个 pending 内容版本。
- `contracts/openapi.yaml:2458-2474,2492-2508,4192-4206`：两个 operation 已声明 409，ErrorDetail.code 开放 string，统一 ErrorEnvelope schema。
- `.trellis/tasks/09-05-content-integrity-error-contract-decision/research/contract-decision-matrix.md:124-148`：本次最终决策为 pending exact -> `CONTENT_REVIEW_PENDING`，approved exact -> unknown 500。
- `.trellis/tasks/09-05-content-integrity-error-contract-decision/research/content-version-integrity.md:15-28,57-72`：现行锁序、flush/commit 副作用与既有测试缺口；其中旧候选名称 `CONTENT_REVIEW_ALREADY_PENDING` 已被本次批准合同覆盖，implementation 必须使用 `CONTENT_REVIEW_PENDING`。

## Caveats / Not Found

- 没有可用 `PARTSIGNAL_TEST_DATABASE_URL` 或 `DATABASE_URL`，本研究未执行真实 current-head PostgreSQL catalog、partial-index collision、驱动 diagnostics、lock wait 或 integration test；这些是 implementation 的 required evidence，不可由 ORM/migration 静态定义替代。
- 当前 `review.py` 没有 IntegrityError catch、显式 final flush 或 local classifier；pending exact 在当前代码中会于 implicit commit flush 进入默认 500，approved exact 的显式 supersede flush/最终 commit 也会原样失败。design/implement 必须明确 catch 覆盖范围与 rollback owner，不能假定已有 helper。
- approved index 在冻结 bootstrap model 与 ORM 中可确认，现有 Alembic 目录只显式出现 pending index；其实际 current-head 存在性必须通过 fresh migration catalog 证明。不得为此修改 migration/schema 或添加兼容 fallback。
- `content_review.py` 当前只有成功/优先级回归（`backend/tests/integration/test_content_review.py:30-103,199-283`），没有两个 partial unique 的 diagnostics、HTTP failure、完整 rollback 或 session reuse 覆盖。
- 默认 500 的 response body/code/header/media type 不属于稳定合同；middleware 只在 `call_next` 返回 response 后回写 `X-Request-ID`（`backend/app/main.py:285-286`），因此 unknown exception 的 header 行为也不应在本 task 固化。
- 本研究未运行测试、未写入生产代码/spec/contract、未执行 `task.py start`、未进行 Git 操作或数据库写入；唯一新增文件是本 research artifact。
