# Research: fact-version-integrity current-head 后端边界

- Query: 核对 `FactVersion` 两条唯一性 enforcement 的 current-head owner、PostgreSQL catalog/diagnostics、事务与锁边界、unknown/pending 分类及后端测试落点。
- Scope: mixed
- Date: 2026-09-14

## Findings

### 1. 权威 INSERT owner 已确认

当前生产代码中唯一的 FactVersion 新建路径是 `submit_fact_review`：

- `backend/app/services/product_facts.py:660-716` 的 `submit_fact_review` 锁定目标 Product（`SELECT ... FOR UPDATE`，`:669`），依次校验 Product 活跃状态、`facts_revision`、非空 Markdown（`:672-677`），查询同产品待审核版本（`:678-684`），计算 `max(version) + 1`（`:685-695`），构造并 `db.add()` 一个 `PENDING_REVIEW` FactVersion（`:696-705`），在 `db.flush()` 触发数据库最终约束（`:706`），再添加对应 `FactReviewRecord`（`:707-714`）并 `db.commit()`（`:715`）。
- `backend/app/routers/product_facts.py:287-310` 将该 command 暴露为 `POST /api/v1/products/{product_id}/fact-review-submissions`，`operationId=submitProductFactReview`，成功状态 201，并已声明 409（`:287-292`）。路由在 service 前执行 account type 检查（`:302`），不会改变 service 的数据库 owner。
- `replace_product_facts` 仅是 `backend/app/services/product_facts.py:633-657` 的 workspace 更新：同样锁 Product（`:642`），更新 `facts_body_markdown`、`facts_classification` 和 `facts_revision`（`:651-653`），flush/commit（`:654-656`），没有 `FactVersion(...)` 构造或插入。因此其 HTTP `operationId=replaceProductFactsDraft`（`backend/app/routers/product_facts.py:220-240`）绝不是这两条 FactVersion 约束的 owner。
- `transition_fact_version` 位于 `backend/app/services/review.py`，只锁定并更新既有 FactVersion 状态/revision，事实审核路由对应 approve/request-changes/retire（`backend/app/routers/product_facts.py:383-455`）；它不会分配新的 `(product_id, version)`，也不是 INSERT owner。生成 worker 只消费 FactVersion，未发现创建 FactVersion 的路径。

这直接纠正父任务早期把 `uq_fact_versions_product_id` owner 写成 `replaceProductFactsDraft` 的过时结论；本 task 只能以 current-head `submit_fact_review` 为准，不修改 `replace_product_facts`。

### 2. 两个数据库对象的静态定义与真实 catalog

静态 source 证据：

- `backend/app/db.py:12-18` 的 SQLAlchemy naming convention 是 `uq_%(table_name)s_%(column_0_name)s`。
- current ORM `backend/app/models/product_facts.py:60-80` 保留 `UniqueConstraint("product_id", "version")`（`:65`），并声明显式命名的 partial unique index `uq_fact_versions_one_pending_per_product`，字段 `product_id`、predicate `status = 'PENDING_REVIEW'`（`:74-79`）。
- 历史冻结 metadata `backend/app/migration_schema_v1.py:304-327` 仍显示初始 `(product_id, version)` 未命名 UniqueConstraint（`:307-308`）；`backend/alembic/versions/0002_product_facts.py:29-60` 通过 metadata 建表。`backend/alembic/versions/0035_business_workflow_primary_tasks.py:173-185` 显式建立 pending partial index：`fact_versions(product_id)`、`unique=True`、predicate `status = 'PENDING_REVIEW'`。
- `contracts/database.md:413-419` 规定版本号在 owner 内唯一、owner 行锁分配，以及每产品至多一个 `PENDING_REVIEW` 事实版本；没有要求为本 task 增加 schema/migration。

我在本地 Docker PostgreSQL 16.14 上执行只读 catalog 查询（容器 `partsignal-dev-postgres-1`，host port 55432），结果为：

```text
uq_fact_versions_one_pending_per_product
  pg_get_indexdef: CREATE UNIQUE INDEX uq_fact_versions_one_pending_per_product
    ON public.fact_versions USING btree (product_id)
    WHERE ((status)::text = 'PENDING_REVIEW'::text)
  indisunique=true, indisprimary=false, predicate=((status)::text = 'PENDING_REVIEW'::text)
  backing_constraint=NULL  # 它是 partial unique index，不是 pg_constraint

uq_fact_versions_product_id
  pg_get_indexdef: CREATE UNIQUE INDEX uq_fact_versions_product_id
    ON public.fact_versions USING btree (product_id, version)
  indisunique=true, indisprimary=false, predicate=NULL
  backing_constraint=uq_fact_versions_product_id  # pg_constraint.contype='u'
  pg_get_constraintdef: UNIQUE (product_id, version)
```

实际 catalog 还显示 `fact_versions` 的 PK、三个 FK、分类/status CHECK；它们不是本 task 的两个唯一性 owner。真实对象名称和定义因此已由 catalog 确认，不应只依赖命名约定或数据库错误文本。

### 3. 两类真实 PostgreSQL diagnostics

在同一个 catalog 数据库内，使用已存在的 Product/actor，以独立事务执行受控 INSERT，并在每次 probe 后无条件 `ROLLBACK`；没有持久化测试数据。插入补齐了 `revision=0` 等 NOT NULL 字段，避免先被无关的 `23502` 截断。

1. 对已存在的 `(product_id, version=1)` 插入新的 UUID 行，捕获：

```text
sqlstate='23505'
diag.constraint_name='uq_fact_versions_product_id'
diag.table_name='fact_versions'
diag.column_name=None
diag.schema_name='public'
diag.message_primary='duplicate key value violates unique constraint "uq_fact_versions_product_id"'
diag.message_detail='Key (product_id, version)=(..., 1) already exists.'
```

2. 在同一事务先插入一个新 `PENDING_REVIEW` 版本，再插入同产品另一版本，第二次 INSERT 捕获：

```text
sqlstate='23505'
diag.constraint_name='uq_fact_versions_one_pending_per_product'
diag.table_name='fact_versions'
diag.column_name=None
diag.schema_name='public'
diag.message_primary='duplicate key value violates unique constraint "uq_fact_versions_one_pending_per_product"'
diag.message_detail='Key (product_id)=(...) already exists.'
```

两个真实结果都来自 `psycopg.errors.UniqueViolation` 包装的 SQLAlchemy `IntegrityError`。实现分类只能读取 `error.orig.sqlstate` 与 `error.orig.diag.constraint_name` 的精确组合；`message_primary`、`message_detail`、`str(error)` 仅作为本次观测记录，不能成为生产匹配依据。

### 4. 锁、顺序与错误分类

`submit_fact_review` 的正常顺序是 Product 行锁 → Product precheck → pending lookup → max/version 分配 → FactVersion flush → FactReviewRecord → commit（`backend/app/services/product_facts.py:669-715`）。因此：

- 合法同产品并发会在 Product `FOR UPDATE` 串行；后到请求重新获取锁后应看到已提交的 pending，并在 `:678-684` 返回既有 `FACT_REVIEW_PENDING`，正常路径不依赖 unique violation。
- `uq_fact_versions_product_id` 只表达 allocator/数据库身份不变量。精确 `23505 + uq_fact_versions_product_id` 也不能证明哪个正文、版本或下游记录是 canonical winner，因此保持 unknown：原始 `IntegrityError` 重新抛出，禁止 replay、自动改号、查询后猜 winner、映射 `FACT_REVIEW_PENDING` 或 `REVISION_CONFLICT`。
- `uq_fact_versions_one_pending_per_product` 与现有 pending precheck 表达同一个稳定 blocker。仅精确 `23505 + uq_fact_versions_one_pending_per_product` 才允许在 command owner 的 root rollback 后抛 `AppError("FACT_REVIEW_PENDING", "该产品已有待审核事实版本", 409)`；details 应保持空对象。不得把任意 `23505`、其他 unique/index、CHECK/FK/NOT NULL/trigger 失败映射为 pending。
- 缺少 `sqlstate`、缺少 `diag`、constraint name 不同、非 `23505` 或不属于该 command 的异常都应原样抛出。分类器不负责 rollback；root rollback 必须由 `submit_fact_review` 的事务 owner 控制，以确保异常 Session 恢复后才能查询/继续使用。

当前 `backend/app/db.py:31-40` 的 `get_db()` 在逃逸异常时 rollback 并 close；`backend/app/main.py:257-258` 只注册 AppError 与 RequestValidationError handler。`backend/tests/unit/test_runtime_response_metadata.py:1050-1054` 已断言 `IntegrityError` 不在应用 handler 集合。因此 product/version unknown 应继续进入框架默认 500 boundary，不冻结 body/code/details/media type，不泄漏 SQL、表名、constraint、driver message 或 stack。

### 5. 事务与副作用边界

`submit_fact_review` 当前在单一 request Session root transaction 中完成 Product 读取/锁、FactVersion INSERT、FactReviewRecord INSERT 和 commit（`:669-715`）。它不修改 workspace：`facts_revision` 只在 `replace_product_facts` `:651-653` 递增；也不写 AuditLog、ContentTask pointer、ContentVersion 或 broker dispatch。故两种失败均需证明：

- 新候选 FactVersion 与候选 FactReviewRecord 均不留下；Product 的 workspace Markdown、classification、`facts_revision` 不变。
- 已有 pending FactVersion 的正文、状态、revision 及对应 FactReviewRecord 不变；不能 replay 或再提交。
- ContentTask pointer、ContentVersion、成功 AuditLog、broker dispatch 均保持基线（当前 command 本身不产生这些副作用）。
- `db.flush()` 触发异常后，必须先 rollback；随后同一 Session 可以查询 Product/FactVersion/FactReviewRecord，独立 Session 还应验证持久化计数与内容。pending race 最终只能保留一个 pending FactVersion 及其一条 submit-review FactReviewRecord，不能出现第二条部分记录。

### 6. 后端测试落点与候选命令

现有行为基线：

- `backend/tests/integration/test_publication_workflow.py:2776-2869` 的 `test_fact_workspace_submission_creates_one_pending_snapshot_and_new_revision_after_return` 已验证首次 submit、顺序重复 submit 得到 `FACT_REVIEW_PENDING`、退回后 workspace 修订、第二个 pending version 及三条 FactReviewRecord；它是 precheck 回归，不是真实 partial-index race。
- `backend/tests/integration/test_product_detail.py:527-707` 已覆盖 product-level fact review context、submit、request-changes、approve、空摘要 422 和 stale revision 409；`:710-833` 覆盖 workspace save、stale save/submit、submit 后 workspace 变更、inactive Product。它同样没有两条 unique constraint 的真实 diagnostics/no-side-effect 断言。
- `backend/tests/unit/test_contract.py:1152-1255` 冻结 fact workspace/submission 的 operation status、schema 和空摘要校验；本 task 默认应只作为零 diff validation target。`backend/tests/unit/test_runtime_response_metadata.py:1041-1054` 冻结 ErrorEnvelope 字段和无全局 IntegrityError handler；同样不应改。
- 测试共用 `test_publication_workflow.py:139-165` 的 `temporary_database()`：读取 `PARTSIGNAL_TEST_DATABASE_URL`，创建独立 PostgreSQL 数据库并运行 Alembic `upgrade head`，因此真实约束/name/diagnostics 测试应放在 publication workflow 或新增同目录 fact integrity integration 文件，而不能用 SQLite 代替。

后续 implementation 的 required validation 可采用：

```bash
cd backend && uv run pytest tests/integration/test_publication_workflow.py -q
cd backend && uv run pytest tests/integration/test_product_detail.py -q
cd backend && uv run pytest tests/unit/test_contract.py tests/unit/test_runtime_response_metadata.py -q
cd backend && uv run ruff check app tests
cd backend && uv run mypy --config-file pyproject.toml app
```

其中应新增/落点的行为不是宽泛文件通过，而是：

1. catalog assertion：两对象 `indisunique`、columns、partial predicate、`uq_fact_versions_product_id` 的 `pg_constraint` backing relation。
2. classifier exact/negative matrix：两 exact pair；缺 diagnostics；非 23505；其他 constraint/index；CHECK/FK/NOT NULL/trigger-like sentinel；均断言 unknown 原异常未被转换。
3. pending precheck 与受控最终 partial-index path：除当前 request ID 外，HTTP 409 的 code/message/details 完全相同，ErrorEnvelope request ID 与 `X-Request-ID` 一致；不得自动 replay。
4. Product lock 对照：两个独立 Session 使用 event/barrier 和有界 timeout 证明正常后到请求因 Product lock 串行并走 pending precheck；不得为测试削弱生产 lock。
5. transaction atomicity：version unknown 与 pending known 各自断言候选 FactVersion/FactReviewRecord 不存在、workspace/revision/已有 pending/ContentTask/ContentVersion/AuditLog/dispatch 不变；失败 request Session rollback 后可查询。以数据库受控 sentinel 触发最终 constraint，不能仅 mock `IntegrityError`。
6. regression：成功 submit、真实 stale `expected_revision` `REVISION_CONFLICT`、inactive/blank/permission precheck 优先级保持；`test_contract.py`、`test_runtime_response_metadata.py` 不需修改，仅验证零漂移。

Frontend recovery 由主任务另行审阅；后端这里仅确认现有公共接口已声明 409 且 `ErrorDetail.code` 为开放 string，故复用 `FACT_REVIEW_PENDING` 不要求 OpenAPI/router metadata/generated schema 变更。

## External references

- PostgreSQL 16.14（本地实际 server）：`23505` 为 `unique_violation`；结构化 constraint identity 通过 psycopg diagnostics 暴露。本次 catalog 与异常均为真实 PostgreSQL，而非 SQLite。
- SQLAlchemy 2.0.51、psycopg 3.3.4（本地安装版本）；项目依赖范围见 `backend/pyproject.toml:7-34`，SQLAlchemy Session failed-state/rollback 行为是后续实现需遵守的事务前提。
- PostgreSQL partial index 文档：<https://www.postgresql.org/docs/current/indexes-partial.html>
- PostgreSQL error codes/diagnostics 文档：<https://www.postgresql.org/docs/current/errcodes-appendix.html>

## Related specs

- `.trellis/spec/backend/error-handling.md:118-171,233-265`：唯一约束只按结构化 diagnostics 精确映射；Content/Fact version identity unknown 不得改写为 revision；未知 IntegrityError 进入默认 500。
- `.trellis/spec/backend/database-guidelines.md:498-552`：事实工作区、FactVersion 非空冻结、owner lock/version 约束及不建立第二来源；`:609-671`：FactReviewRecord 按 FactVersion 精确归属。
- `contracts/database.md:411-419`：owner 内版本唯一、owner 锁分配、每产品最多一个 pending FactVersion；`:27-31`：历史 0002 与当前 Markdown facts 演进背景。
- `.trellis/tasks/09-04-integrity-error-domain-mapping/{prd.md,design.md,implement.md}`：unknown boundary、service owner、rollback 和实施拆分总约束。
- `.trellis/tasks/09-05-content-integrity-error-contract-decision/{prd.md,design.md,implement.md,research/contract-decision-matrix.md,research/fact-version-integrity.md,research/public-contract-frontend-impact.md}`：T4-C 已冻结的 FactVersion 两项分类、前端/公共合同零 diff 和后续 `fact-version-integrity-mapping` 目标。

## Caveats / Not Found

- 首轮只读 probe 所用长驻 Docker 数据库的 Alembic `alembic_version` 是 `0038_published_article_delete`，不能单独代表 current head；本文件末尾的 fresh `0043` 补充复核已关闭该 planning 证据缺口。后续 implementation 仍须在自己的 `temporary_database()` current-head fixture 中再次断言，不能把任一 planning probe 代替最终 gate。
- 本次真实 diagnostics probe 仅在事务中插入并回滚，证明了 PostgreSQL 诊断字段和名称，未运行完整 service race、HTTP ErrorEnvelope、rollback/session reuse 或前端测试；这些仍是 implementation required validation。
- 现有 Product lock 使合法正常并发不应触发 unique violation；partial-index race 需 test-only event/barrier/受控 competitor 或等价真实数据库装置，不能将旁路 sentinel 写成正常生产路径，也不能修改 production lock/schema。
- `FactReviewRecord` 的 `action/comment/actor_id` 插入发生在 FactVersion flush 之后；若 FactReviewRecord 本身后续失败，root transaction 仍须整体 rollback。当前 `submit_fact_review` 没有成功 AuditLog 或 dispatch，不能为了证明原子性新增它们。
- `request_id` 参数传入 `submit_fact_review` 但未写入数据库；HTTP body/header 的 request ID 由 `backend/app/main.py:261-295` middleware 与 `backend/app/errors.py:40-53` ErrorEnvelope handler 负责。unknown 500 不应据此推导稳定 ErrorEnvelope。
- 未发现 `replace_product_facts`、`transition_fact_version` 或 generation worker 写入 FactVersion 的其他生产 INSERT owner；测试 fixture 中直接构造 `FactVersion(...)`（例如 `test_publication_workflow.py:185-205`、`test_product_detail.py:105-115`）只是数据准备，不改变 owner 结论。

## Planning convergence 补充：fresh current-head 复核

主 agent 随后复用本文件定位的 `temporary_database()`，创建独立 PostgreSQL 数据库并完整执行 `alembic upgrade head`；命令结束时 fixture 使用 `DROP DATABASE ... WITH (FORCE)` 清理。该 fresh database 的实际 head 为 `0043_geo_platform_identity`，得到：

```text
catalog name=uq_fact_versions_one_pending_per_product
definition=CREATE UNIQUE INDEX uq_fact_versions_one_pending_per_product
  ON public.fact_versions USING btree (product_id)
  WHERE ((status)::text = 'PENDING_REVIEW'::text)
predicate=((status)::text = 'PENDING_REVIEW'::text)

catalog name=uq_fact_versions_product_id
definition=CREATE UNIQUE INDEX uq_fact_versions_product_id
  ON public.fact_versions USING btree (product_id, version)
predicate=None

version_identity sqlstate=23505
constraint_name=uq_fact_versions_product_id

pending_partial sqlstate=23505
constraint_name=uq_fact_versions_one_pending_per_product
```

因此本文件先前关于长驻 `0038` 数据库不能充当 current-head 证据的 caveat 已由 fresh `0043` probe 消除。该 planning probe 只冻结约束 identity/definition；后续 implementation required gate 仍必须在自己的 fresh current-head fixture 中重复，并补齐 service、HTTP、rollback、并发和零 skip 证据，不能把本次 probe 当作实现验收通过。
