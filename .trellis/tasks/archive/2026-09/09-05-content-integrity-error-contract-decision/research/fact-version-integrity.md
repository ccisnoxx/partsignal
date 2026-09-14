# Research: Fact Version IntegrityError 合同决策

- Query: 审计 `uq_fact_versions_product_id` 与 `uq_fact_versions_one_pending_per_product` 的真实 owner、竞态路径、领域错误候选、事务原子性、前端恢复和后续实施拆分。
- Scope: mixed
- Date: 2026-09-05

## Files found

- `backend/app/services/product_facts.py`：产品事实工作区、FactVersion 提交/删除及 Product 锁和版本分配 owner。
- `backend/app/services/review.py`：FactVersion 审核状态转换、FactReviewRecord 与批准审计 owner。
- `backend/app/routers/product_facts.py`：事实工作区、提交和审核 HTTP operationId 映射。
- `backend/app/models/product_facts.py`：当前 Product、FactVersion、FactReviewRecord ORM 约束声明。
- `backend/app/db.py`：SQLAlchemy 唯一约束 naming convention，确定 `uq_fact_versions_product_id` 名称。
- `backend/app/migration_schema_v1.py`、`backend/alembic/versions/0002_product_facts.py`：FactVersion 初始 `(product_id, version)` 唯一结构及其建表来源。
- `backend/alembic/versions/0035_business_workflow_primary_tasks.py`：`uq_fact_versions_one_pending_per_product` partial unique index。
- `backend/app/errors.py`、`backend/app/main.py`：AppError 信封、request ID 注入边界和 unknown IntegrityError 500 边界。
- `backend/tests/integration/test_publication_workflow.py`、`backend/tests/integration/test_product_detail.py`：已有事实提交顺序、重复预检、revision 和工作区回归。
- `backend/tests/integration/test_content_task_creation.py`、`backend/tests/integration/test_content_review.py`、`backend/tests/integration/test_content_draft_lifecycle.py`：只消费 FactVersion 的内容命令/审核回归，非本约束写入 owner。
- `backend/tests/unit/test_generation.py`、`backend/tests/unit/test_runtime_response_metadata.py`：generation 局部 diagnostics classifier 与无全局 IntegrityError handler 回归。
- `frontend/src/domains/product/fact-workspace-page.tsx`、`frontend/src/domains/product/fact-workspace.model.ts`、`frontend/src/domains/product/product.api.ts`：事实提交错误映射、刷新/保留输入和 request ID 展示。
- `frontend/src/domains/product/fact-workspace-page.test.tsx`：事实工作区冲突与提交前端回归。
- `contracts/database.md`、`contracts/openapi.yaml`、`frontend/src/shared/api/generated/schema.d.ts`、`docs/frontend-v2/05-business-actions-state-and-api-contract.md`：数据库、HTTP、生成类型和 Frontend V2 既有合同。

## Findings

### 约束与数据库 owner

| 约束 | 表、字段、最终名称 | 证据与语义 |
|---|---|---|
| `uq_fact_versions_product_id` | `fact_versions(product_id, version)`，`UNIQUE`；运行时命名约定由 `backend/app/db.py:11-18` 的 `uq_%(table_name)s_%(column_0_name)s` 生成最终名称 | 冻结初始元数据在 `backend/app/migration_schema_v1.py:304-327` 声明未命名 `UniqueConstraint("product_id", "version")`；`backend/alembic/versions/0002_product_facts.py:29-60` 用该元数据创建表。当前 ORM 仍在 `backend/app/models/product_facts.py:60-90` 保持相同唯一身份；故 catalog 名称为 `uq_fact_versions_product_id`，不是按错误消息猜测的别名。`contracts/database.md:415-417` 规定 owner 内版本号唯一且分配时锁 owner。 |
| `uq_fact_versions_one_pending_per_product` | `fact_versions(product_id)`，partial `UNIQUE INDEX WHERE status = 'PENDING_REVIEW'` | 明确命名于 `backend/alembic/versions/0035_business_workflow_primary_tasks.py:173-185`；当前 ORM 在 `backend/app/models/product_facts.py:64-79` 复现同一谓词。`contracts/database.md:417-419` 明确每产品最多一个 `PENDING_REVIEW`，工作区提交直接创建不可变版本。 |

### Service、HTTP 与 review owner

唯一生产写入 owner 是 `backend/app/services/product_facts.py:660-716` 的 `submit_fact_review`：

1. 它在 `:669` 以 `SELECT ... FOR UPDATE` 锁定 `Product`，在 `:674-677` 校验产品状态、`facts_revision` 和非空 Markdown。
2. 在 `:678-684` 预检同产品 `PENDING_REVIEW`；命中时已经有稳定的 `AppError("FACT_REVIEW_PENDING", "该产品已有待审核事实版本", 409)`，details 因 `AppError` 默认值为空对象（`backend/app/errors.py:23-38`）。
3. 在 `:685-695` 读取同产品 `max(version)` 并加一，在 `:696-705` 创建 `PENDING_REVIEW` 的不可变 `FactVersion`，在 `:706` flush；随后在 `:707-714` 增加 `FactReviewRecord`，在 `:715` commit。
4. 对应 HTTP operation 是 `submitProductFactReview`：`backend/app/routers/product_facts.py:287-310`，`POST /api/v1/products/{product_id}/fact-review-submissions`，成功 `201`，当前 route 已声明 `409`。

`replace_product_facts`（`backend/app/services/product_facts.py:633-657`，operation `replaceProductFactsDraft`，`backend/app/routers/product_facts.py:220-240`）只锁并更新 `Product.facts_body_markdown`、分类和 `facts_revision`，不插入 FactVersion，不能触发这两条约束。`delete_fact_version` 只在 `backend/app/services/product_facts.py:560-630` 删除已锁定版本；删除不存在或唯一冲突路径。`transition_fact_version`（`backend/app/services/review.py:283-337`）只锁定一个既有 FactVersion 并做 `PENDING_REVIEW -> APPROVED|CHANGES_REQUESTED` 或 `APPROVED -> RETIRED` 的状态更新；review operation 分别是 `approveFactVersion`、`requestFactVersionChanges`、`retireFactVersion`（`backend/app/routers/product_facts.py:383-455`），不会插入相同 `(product_id, version)`，且从 `PENDING_REVIEW` 转出会移除 partial-index 谓词，不能制造新的 pending 冲突。

没有 worker owner：`generation.py` 只读取并校验 FactVersion（例如 `backend/app/services/generation.py:192-210`），生成 worker 创建 ContentVersion/Job，不创建 FactVersion。`fact_review_records` 的 owner 是目标 FactVersion（`backend/app/models/product_facts.py:103-118`），不是独立的 pending allocator。

### 决策矩阵

| 约束 | 预检、锁、allocation | 正常顺序与真实 PostgreSQL race | replay / 领域错误 / unknown | 公共错误合同与前端恢复 | worker、事务及审计 | 后续测试与实施任务 |
|---|---|---|---|---|---|---|
| `uq_fact_versions_product_id` | `submit_fact_review` 先锁 `Product`（`product_facts.py:669`），然后 `max(version)+1`（`:685-695`）；没有幂等键或 winner lookup。`replace_product_facts` 与 review transition 不分配新版本。 | 正常重复提交在 pending 预检处结束；并发提交因同一 Product 行锁串行，先提交者创建/提交 vN，后者取得锁后重新看到 pending，返回既有 `FACT_REVIEW_PENDING`，不会到 unique insert。若绕过 owner 锁、测试注入同一事务重复版本、旧代码/人工 SQL 造成相同 tuple，PostgreSQL 才会在 `flush()` 产生 `sqlstate=23505` 且 `diag.constraint_name="uq_fact_versions_product_id"`。数据库冲突不能可靠证明哪个请求是 winner。 | **保持 unknown**；不 replay，也不新增 `FACT_VERSION_*` code。该约束表示 version allocator/数据库状态异常，不是可由客户端安全重试或恢复的语义。只有同时精确匹配 `23505 + constraint_name` 才能识别为该 sentinel；未匹配、缺 diagnostics、其他 SQLSTATE/constraint 原样抛出。禁止 message/`str(error)` 解析、按 product/version 查询猜分类或全局映射为 `REVISION_CONFLICT`。 | 不产生公共领域错误，因此不冻结新的 status/code/message/details；HTTP 走既有 unknown IntegrityError 500 boundary，不保证 ErrorEnvelope。若未来产品决定新增公共 code，必须另行冻结语义后再实施。本约束不要求 OpenAPI、runtime metadata、generated client 或前端改动。前端对 unknown 仅使用既有 generic request failure，不自动 reload/replay；如果 future code 被批准，需新增明确组件分支，而非按 message 判断。 | 无 worker。`submit_fact_review` 的 `Product` 锁、工作区 `facts_revision` 检查、FactVersion 插入和 FactReviewRecord 插入均在同一 root Session 事务（`:669-715`）；`request_id` 传入但当前命令不写 AuditLog，亦无 dispatch、task pointer、content/fact version 后续副作用。flush 失败时事务已失败，依赖 `get_db` 的 rollback/close 清理请求 Session；产品工作区、版本和审核记录都不应部分提交。 | `fact-version-identity-unknown`（建议后续独立 implementation Task）：真实 PostgreSQL 约束 catalog/diagnostics sentinel；服务 unit 只验证结构化 classifier 不接管 unknown；HTTP sentinel 断言 500/non-leak、无新 FactVersion/ReviewRecord、facts_revision 与后续查询不变。可用 test-only flush hook/同事务冲突注入制造真实 constraint，不改生产锁/schema。 |
| `uq_fact_versions_one_pending_per_product` | 同一 `submit_fact_review` 先锁 Product、预检 pending（`:678-684`），再分配版本/插入 pending（`:685-706`）；无幂等 lookup。已存在 pending 时已有 `FACT_REVIEW_PENDING`，不存在另一个写 owner。 | 正常重复提交及锁内并发均是已有预检错误。若两个写入在预检后都保留了插入边界（例如 test-only hook 在既有 command boundary 注入 competitor），PostgreSQL partial unique index 只允许一条 pending，败者在 `flush` 产生 `23505 + uq_fact_versions_one_pending_per_product`。Review transition 从 pending 转出（`review.py:308-320`）会先离开谓词；与 submit 的锁顺序最终是提交/预检先后，不应替换为版本级查询猜测。 | **映射为既有 `FACT_REVIEW_PENDING`**，不 replay。该约束的失败语义与现有预检完全一致，且没有 request idempotency key，无法安全 replay 某个 winner。mapper 只允许 `sqlstate == "23505"` 且精确 `diag.constraint_name`；命中后由 root caller rollback 再抛 AppError；未知约束和 diagnostics 缺失原抛。 | 冻结复用合同：`HTTP 409`；`code=FACT_REVIEW_PENDING`；`message=该产品已有待审核事实版本`；`details={}`；`request_id` 由统一 `error_response` 从 `request.state.request_id` 注入（`backend/app/errors.py:40-53`），不是 service 传入的 `request_id` 字段。`POST submitProductFactReview` 已有 409 response（`contracts/openapi.yaml` 约 `:621-643`；generated `schema.d.ts:6455-6489`），故复用时不需要 OpenAPI/runtime metadata/generated client 改动。Frontend V2 已规定两个写入口锁内复核、`FACT_REVIEW_PENDING` 由 code 驱动并禁止静默覆盖/自动 replay（`docs/frontend-v2/05-business-actions-state-and-api-contract.md:155-161`）。当前 UI：`fact-workspace-page.tsx:188-208` 将该 code 刷新 canonical workspace；Dialog 在 `:434-447` 展示 message 与 request ID、保留页面；`product.api.ts:255-305` 只按结构化 details.errors 定位字段，details 为空时展示 form message。实现后应保持这一行为；不需要前端代码改动，只需补测试。稳定 spec 应补充精确 `23505 + uq_fact_versions_one_pending_per_product` 的局部 mapper 规则，但本 planning 任务不编辑 stable spec。 | 无 worker。根事务原子边界是 Product 锁/预检、FactVersion、FactReviewRecord 与 commit（`product_facts.py:669-715`）；没有 AuditLog（`request_id` 当前只由 HTTP middleware 回显），没有 dispatch、task pointer、ContentVersion、后续 fact version 或 revision 写入。已知冲突 rollback 后不应有新版本、审核记录或产品工作区变更；未知路径由 request dependency rollback/close，不能写失败 AuditLog。 | `fact-version-pending-conflict`（后续独立 implementation Task）：局部 mapper + caller rollback；真实 PostgreSQL partial-index sentinel；HTTP 顺序预检与 flush 竞态除 request ID 外同合同；两个 Session/连接并发测试使用 event/barrier、有界 timeout，验证恰一 pending、败者 409、无重复 FactVersion/ReviewRecord、Session rollback 后可继续查询。补充 frontend `fact-workspace-page.test.tsx` 对既有 `FACT_REVIEW_PENDING` reload/保留输入/request ID 的回归断言；无需修改 OpenAPI/generated 类型。 |

### 原子性与 review/audit 观察

- `submit_fact_review` 当前没有 `append_audit`；`request_id` 只是 API 层传入参数，命令没有写成功 `AuditLog`。因此“版本 + FactReviewRecord + AuditLog”并非三者原子写入，而是本实现的两个业务行在同一 commit 内原子写入，AuditLog 不存在。后续 implementation 不应为了映射冲突临时增加审计副作用；若产品要审计事实提交，必须另行冻结 action/details 合同。
- `transition_fact_version` 在批准时写 `FactReviewRecord`、状态/revision 和 `fact_version.approve` SUCCESS AuditLog（`review.py:308-336`）同一 commit；`request-changes`/`retire` 没有 AuditLog。两条本次约束不由 transition 插入，因而不应在 review owner 添加无关 mapper。
- `facts_revision` 只在 `replace_product_facts` (`product_facts.py:642-653`) 递增；提交审核不递增它。失败冲突不应改变工作区 revision、FactVersion revision、ContentTask pointer、ContentVersion、review history 或 dispatch。
- 当前 unknown boundary 是应用只注册 `AppError` 与 `RequestValidationError` handlers（`backend/app/main.py:257-258`），runtime regression 已断言 `IntegrityError` 不在 handler 集合（`backend/tests/unit/test_runtime_response_metadata.py:1050-1054`）。故 unknown 500 不应被写进稳定 ErrorEnvelope 或 generated error union。

### 文件与测试审计

- 已有业务回归：`backend/tests/integration/test_publication_workflow.py:2776-2869` 验证第一次提交、重复提交得到 `FACT_REVIEW_PENDING`、退回后工作区修订、第二个 pending 版本和三条 FactReviewRecord；这是顺序预检覆盖，不是 PostgreSQL partial-index race。
- `backend/tests/integration/test_product_detail.py:575-584` 覆盖提交事实审核；`:731-833` 覆盖工作区保存、stale revision、提交、提交后继续修改和停用状态。仍没有两条约束的 `orig.sqlstate`/`orig.diag.constraint_name` 断言。
- `backend/tests/integration/test_content_task_creation.py:62-73` 仅构造 approved FactVersion 供任务创建；内容任务创建读取批准事实，不插入事实版本。`backend/tests/integration/test_content_review.py` 和 `backend/tests/integration/test_content_draft_lifecycle.py` 只消费已存在 FactVersion，不能作为本 mapper 的 owner test。
- `backend/tests/unit/test_generation.py` 的 IntegrityError classifier（`:287-305`）属于 generation humanization，不能复用为 FactVersion 全局 registry；`backend/tests/unit/test_runtime_response_metadata.py:1050-1054` 只证明无全局 IntegrityError handler。应为 product_facts 局部 mapper 增加独立 unit cases（精确组合、未知约束、非 23505、无 diagnostics）。
- OpenAPI 当前 `submitProductFactReview` route 已声明 `409`（`contracts/openapi.yaml:621-643`），generated operation 已同步 `409 ErrorResponse`（`frontend/src/shared/api/generated/schema.d.ts:6455-6489`）；ErrorDetail.code 是任意 string（`:2109-2117`），没有 code union 可供 FactReview 冲突扩展。复用既有 code 无生成物变化。
- 前端现有 `FACT_REVIEW_PENDING` 恢复证据：`frontend/src/domains/product/fact-workspace-page.tsx:188-208` 在 submit 失败时 `onReload()`；`:212-220` 的显式 reload 才重置表单/baseline；`:434-447` 的 Dialog 保留错误与 request ID。`frontend/src/domains/product/product.api.ts:255-305` 只按 `detail.code` 和结构化 details 处理错误，禁止 message parsing。`frontend/src/domains/product/fact-workspace-page.test.tsx` 已有冲突/提交回归（检索到 `:182-187`、`:273-289`），后续应补或确认 pending race 场景。

### 后续实施任务与依赖

建议按稳定 owner 与独立可验证目标拆分，不合并为大型 T4 implementation：

1. **T4-C1 `fact-version-pending-conflict-mapping`**：只在 `product_facts.submit_fact_review` 的 root flush 边界识别 `23505 + uq_fact_versions_one_pending_per_product`，复用 `FACT_REVIEW_PENDING`，由 caller rollback；补 unit、PostgreSQL sentinel、HTTP 顺序/竞态及 frontend regression。依赖本合同决策；推荐第一个实施。
2. **T4-C2 `fact-version-identity-unknown-boundary`**：为 `23505 + uq_fact_versions_product_id` 建立局部 sentinel 负例/unknown 验证，确保不新增 code、不 replay、不映射 `REVISION_CONFLICT`，并补真实 PostgreSQL 500/non-leak 与事务 cleanup。依赖 T4-C1 的 mapper边界，但生产代码可以独立；建议第二个实施。
3. **T4-C3 `fact-version-contract-and-regression-gate`**：仅在前两项通过后执行合同/运行时 metadata、稳定 spec 规则和全量受影响回归的独立 gate；复用既有 OpenAPI/generated，无需改动时以检查证明不漂移。依赖 T4-C1、T4-C2。

依赖图：`T4-C1 → T4-C2 → T4-C3`。没有 worker implementation task；generation、content version、publication/GEO 和全局 registry 均不在本 Fact Version 子任务范围。

## External references

- PostgreSQL 18 Appendix A：`23505` 是 `unique_violation`，并明确建议应用使用 SQLSTATE 而不是文本；同时说明约束名以独立 diagnostics 字段提供，适合本任务的 `orig.sqlstate + orig.diag.constraint_name` 精确匹配：<https://www.postgresql.org/docs/current/errcodes-appendix.html>。
- PostgreSQL partial indexes：partial unique index 的谓词只约束满足谓词的行；本任务的 `uq_fact_versions_one_pending_per_product` 仅覆盖 `status='PENDING_REVIEW'`：<https://www.postgresql.org/docs/current/indexes-partial.html>。

## Related specs

- `.trellis/spec/backend/error-handling.md:61-118,155-186`：只允许精确 SQLSTATE/constraint diagnostics；未知 IntegrityError 不映射公共业务 code；自然化 mapper 由 caller 控制 rollback。
- `.trellis/spec/backend/database-guidelines.md:498-552,600-626`：Markdown FactVersion、每产品单 pending、审核记录归属与不可变性。
- `contracts/database.md:411-419`：版本号 owner 唯一、owner 锁分配、每产品至多一个 pending。
- `contracts/openapi.yaml:621-643,697-740`：事实提交与审核 operation 的现有 `409 ErrorResponse` 声明。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md:155-161,291-295`：事实工作区错误恢复、按 code 而非 message 驱动前端。

## Caveats / Not Found

- 当前 production 代码没有 FactVersion IntegrityError mapper；`product_facts.py` 仅为产品身份唯一约束实现局部 `_product_identity_conflict`（`:47-72`）。本研究不修改它，也不建议扩展为全局 mapper。
- `uq_fact_versions_product_id` 的最终名称来自 SQLAlchemy naming convention；没有在当前文本中直接出现该字符串的 `CREATE CONSTRAINT`，但命名约定、冻结元数据和当前 ORM 三者一致，需后续真实 PostgreSQL catalog test 最终确认。
- 当前 `submit_fact_review` 的 service `request_id` 未用于 AuditLog；“AuditLog 原子性”只能报告为不存在，而不是推断其应当存在。若产品要求 `fact_version.submit` 成功审计，应另立合同决策。
- 由于 Product 行锁使正常 HTTP 并发走 pending 预检，真实 partial-index flush race 需要 test-only event/flush 注入或等价受控边界；不能通过删除/绕过生产锁、改 schema、sleep 或伪造 `IntegrityError` 代替真实 PostgreSQL diagnostics。
- 本文件未涵盖 publication/GEO 约束（留给 T5-C），也未审计或改动任何生产代码、OpenAPI、generated client、稳定 spec、测试或数据库。
