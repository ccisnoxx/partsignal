# FactVersion IntegrityError mapping

## 目标

在 `product_facts.submit_fact_review` 这一唯一生产 command owner 内，冻结并实施 `FactVersion` 的两个数据库最终边界：`uq_fact_versions_product_id` 保持 unknown/default 500，只有 `uq_fact_versions_one_pending_per_product` 的精确 PostgreSQL diagnostics 才复用既有 409 `FACT_REVIEW_PENDING`。两条失败路径必须共享完整 root transaction rollback，并由真实 PostgreSQL、HTTP 和前端恢复测试证明无部分写入、无 replay、无错误类型混淆。

本 Task 当前只完成 planning convergence，不运行 `task.py start`，不修改 production/test/spec/docs，不实施、不提交、不归档、不 push。实施必须等待用户后续明确批准。

## 依赖与单一 review 目标

- 父任务：`.trellis/tasks/09-04-integrity-error-domain-mapping`，继续保持 `planning`。
- 合同决策 owner：`.trellis/tasks/09-05-content-integrity-error-contract-decision`，继续保持 `planning`。
- 已完成前置实现：`generation-job-idempotency-integrity-mapping`、`content-task-idempotency-integrity-mapping`、`content-version-identity-integrity-boundary`、`content-version-review-state-integrity-mapping`。
- 最近完成的 I4 提交：工作 `fc834372`、归档 `1667376c`、journal `22224081`。
- 本 Task 只有一个可 review 目标：同一 `submit_fact_review` transaction 中两条 `FactVersion` unique enforcement 的分类、回滚与 Fact Workspace 恢复。不得混入 `replaceProductFactsDraft`、Content Version、Content Task、Generation Job、publication/GEO 或 T6 全局 409 投影。

## Current-head 已确认事实

- `backend/app/services/product_facts.py` 的 `submit_fact_review` 是唯一生产 `FactVersion` INSERT owner：先对 Product 执行 `FOR UPDATE`，再完成 product/revision/正文/pending precheck，分配 `max(version) + 1`，插入 `PENDING_REVIEW` FactVersion，随后插入一条 FactReviewRecord 并 commit。
- `replace_product_facts` 只更新 Product workspace Markdown、classification 与 `facts_revision`；它不是 `FactVersion` INSERT owner，禁止依据父任务早期 research 修改该函数。
- 已用仓库 `temporary_database()` 创建独立 PostgreSQL 数据库并执行 `alembic upgrade head` 到 `0043_geo_platform_identity`。真实 catalog 确认：
  - `uq_fact_versions_product_id` 是 `(product_id, version)` 的 unique constraint/backing index；
  - `uq_fact_versions_one_pending_per_product` 是 `product_id` 上、predicate 为 `status = 'PENDING_REVIEW'` 的 partial unique index。
- 同一 current-head 临时库中的真实冲突确认：
  - version identity：`sqlstate=23505`、`diag.constraint_name=uq_fact_versions_product_id`；
  - pending partial unique：`sqlstate=23505`、`diag.constraint_name=uq_fact_versions_one_pending_per_product`。
- 正常同 Product 并发由 Product row lock 串行；后到请求应在取得锁后由既有 pending precheck 返回 `FACT_REVIEW_PENDING`，而不是把 unique violation 当作正常控制流。
- `submitProductFactReview` 已声明 409，`ErrorDetail.code` 是开放 string，`FACT_REVIEW_PENDING` 已存在；公共 OpenAPI、router metadata 与 generated schema 不需要改变。
- Fact Workspace 当前会在 `FACT_REVIEW_PENDING` 后发起 refetch，但尚未证明 pending 后禁止第二次 POST、刷新失败保留原始错误/request ID，以及 malformed `details`/空 request ID 的安全 fallback；这些是实施期需补齐的最小证据/行为。

## 允许与只读 owner

实施阶段默认允许修改：

- Backend：`backend/app/services/product_facts.py`、`backend/tests/integration/test_publication_workflow.py`、`backend/tests/integration/test_product_detail.py`。
- Frontend：`frontend/src/domains/product/fact-workspace-page.tsx`、`fact-workspace-page.test.tsx`；只有纯错误投影确有需要时才修改 `fact-workspace.model.ts`、`fact-workspace.model.test.ts`。
- 稳定文档/spec：`.trellis/spec/backend/error-handling.md`、`.trellis/spec/backend/database-guidelines.md`、`.trellis/spec/frontend/state-management.md`、`docs/frontend-v2/05-business-actions-state-and-api-contract.md`。

实施阶段只读且必须零 diff：

- `backend/app/routers/product_facts.py`
- `contracts/openapi.yaml`
- `contracts/database.md`（当前唯一性/锁描述准确；只有实施证据证明既有描述失真时才 scope stop 并请求最小同步授权）
- `frontend/src/shared/api/generated/schema.d.ts`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- 数据库模型、`backend/app/migration_schema_v1.py`、schema 与 Alembic migration
- `backend/app/services/review.py`
- ContentVersion、ContentTask、Generation Job、publication/GEO owner

## 冻结需求

### R1. 精确结构化 diagnostics

生产分类只能读取 `IntegrityError.orig.sqlstate` 与 `IntegrityError.orig.diag.constraint_name`。不得解析数据库 message、`str(error)`、SQL 文本、表名或 substring，不得建立全局 mapper、通用 constraint registry 或第二套错误类型系统。

仅以下 exact pair 可识别为稳定 pending blocker：

```text
sqlstate == "23505"
constraint_name == "uq_fact_versions_one_pending_per_product"
```

缺少 `orig`/`diag`/字段、非 `23505`、其他 constraint/index、近似名称，以及 CHECK、FK、NOT NULL、trigger failure 均为 unknown，并重新抛出原始 `IntegrityError`。

### R2. Version identity 保持 unknown

即使精确命中 `23505 + uq_fact_versions_product_id`，也必须在 root rollback 后重新抛出原始 `IntegrityError`，由现有 default 500 边界处理。不得：

- 返回 `FACT_REVIEW_PENDING`、`REVISION_CONFLICT` 或任何新增业务 code；
- replay 已有 FactVersion、查询后猜 winner、自动增加/重新分配 version 或再次提交；
- 根据数据库错误文本或事后查询推导 canonical version；
- 冻结默认 500 的 body、code、details 或 media type。

unknown 500 不得泄漏 SQL、表名、constraint、driver message 或 stack。

### R3. Pending partial unique 的唯一映射

只有 R1 exact pair 在完整 root rollback 后可复用：

- HTTP status：409
- code：`FACT_REVIEW_PENDING`
- message：`该产品已有待审核事实版本`
- details：`{}`
- `error.request_id` 与响应头 `X-Request-ID` 完全相同

既有 precheck 与数据库最终路径除当前 request ID 外，status、code、message、details 必须完全一致。不得 replay、自动再次 POST、将 blocker 当成 revision stale，或把任意 `23505` 映射为 pending。

### R4. Product lock 与 precheck 优先级

- `submit_fact_review` 必须继续首先对 Product 使用 `FOR UPDATE`，不得为测试削弱、旁路或移除生产锁。
- 正常同 Product 并发应由 Product lock 串行，后到请求走既有 pending precheck；unique violation 只是最终数据库 authority 的受控失败证据。
- 真正 stale 的 `expected_revision` 继续返回既有 `REVISION_CONFLICT`。
- Product inactive、事实正文为空、权限拒绝及其他现有 precheck 的 owner、顺序、status/code/message/details 保持不变；新增 catch 不得包裹并改写这些 AppError。

### R5. 统一 root rollback 与 Session 恢复

两类 `IntegrityError` 必须由 `submit_fact_review` 这一 transaction owner 统一 root `db.rollback()`；classifier 本身无副作用且不拥有 rollback。rollback 后同一 request Session 必须可以继续查询。

不得在 catch 中 commit、replay、自动重试、创建 savepoint、打开第二个业务事务或查询 winner。若当前调用关系无法由 command owner完成 root rollback，实施必须停止并报告。

### R6. 事务无副作用

version unknown 与 pending known 两类失败都必须证明：

- 不留下候选 FactVersion；
- 不留下候选 FactReviewRecord；
- Product workspace Markdown、classification 与 `facts_revision` 不变；
- 既有 pending FactVersion 的内容、状态与 revision，以及其既有 FactReviewRecord 不变；
- ContentTask pointer 与 ContentVersion 不变；
- 不产生 SUCCESS AuditLog；
- 不产生 broker dispatch；
- rollback 后 request Session 与独立验证 Session 都能查询一致的持久化基线。

正常 Product-lock 并发最终只能存在一个 pending FactVersion 及与其对应的一条 submit FactReviewRecord，不得出现第二条部分记录。受控 exact-constraint sentinel 与正常并发对照必须在测试命名和断言中明确分离。

### R7. 成功与既有错误回归

成功 `submit_fact_review` 继续创建一个不可变 pending FactVersion 与一条对应 FactReviewRecord；版本分配、返回模型和 commit 次数保持既有行为。真实 stale revision 仍走 `REVISION_CONFLICT`，不得被 pending/version identity 分支覆盖。

### R8. Fact Workspace pending 恢复

前端只按结构化 `code` 识别 exact `FACT_REVIEW_PENDING`，并满足：

- 显示服务端准确 message 与非空 request ID；
- 保留用户可安全保留的 workspace 本地输入和提交 Dialog 的 change summary；
- 提交 POST 恰一次，pending blocker 存续时禁止再次提交，不自动 replay；
- pending blocker 由按 `productId` 隔离的 Fact Workspace editor 持有，同时保护页面提交入口与 Dialog confirm；关闭/重开 Dialog 不得解除 blocker；
- 不进入 `REVISION_CONFLICT` 专用分支；
- 发起一次明确的 canonical workspace refetch，并区分真正成功与保留旧 data 的失败结果；
- 刷新失败时保留 pending 错误、request ID、本地输入与 blocker；
- 刷新成功后采用服务器 read model，并只依据 `available_actions` 收敛页面动作；服务器已有 pending 时不得继续提供重复提交；
- 不根据 message 文本判断类型。

### R9. 前端 negative 与 unknown 500

- malformed/missing/non-object `details`、其他 code、缺失或空白 request ID 必须安全进入 summary fallback，不抛渲染异常、不猜 pending/revision 类型。
- version identity 的 unknown 500 走 generic server failure：不自动 reload、不自动 replay、不猜 version、不伪装为 pending 或 revision conflict。
- 合法且结构完整的既有 `INVALID_STATE_TRANSITION` 保持其独立 canonical refetch 行为，但不归类为 pending/revision blocker；其余未知 code 才走 generic fallback。不得用本 Task 顺便重构共享 product API error system。

### R10. 公共合同、schema 与文档

- `contracts/openapi.yaml`、router response metadata、generated schema、`contracts/database.md`、数据库模型/schema/migration 保持零 diff。
- 不新增公共 error code、不新增稳定 500 response、不修改数据库约束/状态机/权限。
- 仅按实际 implementation diff 在四个允许的稳定 spec/docs 中同步 exact diagnostics、Product-lock/root rollback、pending no-replay 和 unknown generic 500 的必要语义；不复制测试技巧或扩写无关 UI。

### R11. 验证与独立复核

实施必须完成用户指定的真实 PostgreSQL、backend、frontend、一致性 gate 及一次独立只读 review。每个 validation/review gate 最多两轮 `repair -> targeted re-check`；独立 review 为一次 full pass，修复 material finding 后最多一次 targeted re-review。full backend/frontend suite 与完整 build 为 optional，未运行时记录替代证据与残余风险。

## 验收标准

- [ ] AC1：current-head 临时 PostgreSQL（Alembic head）证明两个目标对象的真实名称、unique 属性、列、predicate/backing constraint 关系，并由真实冲突证明两个 exact `23505` diagnostics；无 skip。
- [ ] AC2：classifier exact/negative matrix 证明只有 `23505 + uq_fact_versions_one_pending_per_product` 可转换；version identity、缺 diagnostics、非 23505、其他/近似 constraint、CHECK/FK/NOT NULL/trigger-like 均原抛同一 `IntegrityError`。
- [ ] AC3：version identity exact failure 完成 root rollback 后保持 default 500/no-leak，不返回 pending/revision、不 replay、不改号、不查询猜 winner，且不固化 500 payload/media type。
- [ ] AC4：pending exact failure 完成 root rollback 后返回固定 409 `FACT_REVIEW_PENDING`/message/`{}`，body/header request ID 相同。
- [ ] AC5：pending precheck 与 exact constraint HTTP 路径除 request ID 外 status、code、message、details 完全一致。
- [ ] AC6：正常两个同 Product 提交由真实 Product lock 串行，后到请求走 pending precheck；最终恰有一个 pending FactVersion 及其一条 submit FactReviewRecord。
- [ ] AC7：两类失败均证明候选 FactVersion/FactReviewRecord 不存在，Product workspace/classification/revision、既有 pending、ContentTask pointer、ContentVersion、SUCCESS AuditLog 与 dispatch 保持基线。
- [ ] AC8：两类失败 root rollback 后同一 request Session 可继续查询，独立 Session 复核持久化状态一致。
- [ ] AC9：成功 submit 回归通过；stale revision、inactive Product、空 Markdown、权限及其他既有 precheck 的合同与优先级不变。
- [ ] AC10：Fact Workspace exact pending 显示准确 message/request ID，保留本地输入和 change summary，pending 后 POST 恰一次且不进入 revision 分支；关闭并重开 Dialog或再次触发页面入口仍不能产生第二次 POST，且 blocker 不泄漏到其他 `productId`。
- [ ] AC11：pending canonical refetch 失败保留原始错误/request ID/editor-owned blocker，并同时闸住页面入口与 Dialog confirm；成功则采用服务器 read model，清理临时 blocker 后只由 `available_actions` 重评动作。
- [ ] AC12：unknown 500 不 reload/replay/猜 version；malformed details、其他 code、缺失/空 request ID 安全 fallback，且不根据 message 分类。
- [ ] AC13：指定 backend integration/unit、Ruff、backend app mypy、相关 Vitest、受影响 ESLint 与 frontend typecheck 通过，或按已冻结失败归因规则准确记录无关阻断。
- [ ] AC14：`git diff --check`、Trellis task validation、JSONL 解析与所有公共/只读 owner 零 diff gate 通过，并检查只读路径下未跟踪文件。
- [ ] AC15：四个允许 spec/docs 与最终代码/测试一致；无需修改的允许文档在 closeout 中说明原因。
- [ ] AC16：完成一次独立只读 implementation review，覆盖真实 PostgreSQL diagnostics、root rollback、前端 no-replay 和文件边界；修复 material finding 后最多一次 targeted re-review。

## 范围外与停止条件

范围外包括：公共 status/ErrorDetail/OpenAPI/generated client、数据库 schema/migration、FactVersion 状态机、权限、全局 IntegrityError mapper/registry、`replaceProductFactsDraft` 重构、Content Version/Task、Generation Job、publication/GEO、T6 全局 409 投影、视觉重做/配色/动效及无关重构。

若 current-head catalog/diagnostics 与冻结名称或定义不符，或实现需要改变公共合同、schema、状态机、权限、Product lock，或只能依赖 message parser、宽泛 `23505`、winner inference、自动改号/replay 才能完成，则立即停止并报告证据，不扩大本 Task。
