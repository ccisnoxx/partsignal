# FactVersion IntegrityError mapping 设计

## 1. 设计目标与 owner

本设计只在 `product_facts.submit_fact_review` 的 root transaction 中处理 `FactVersion` INSERT 的两个数据库最终边界。`uq_fact_versions_product_id` 是 allocator/数据不变量异常，保持 unknown；`uq_fact_versions_one_pending_per_product` 与既有 pending precheck 表达同一稳定 blocker，只有其 exact diagnostics 可映射为既有 `FACT_REVIEW_PENDING`。

`replace_product_facts` 只拥有 Product workspace update，不构造或插入 FactVersion。本 Task 不修改它，也不沿用父任务早期 research 的过时 owner 判断。

## 2. 后端边界

### 2.1 Command-local 精确 classifier

在 `backend/app/services/product_facts.py` 中增加最小、无副作用的局部 helper 或等价局部逻辑，只判断：

```python
sqlstate == "23505"
and constraint_name == "uq_fact_versions_one_pending_per_product"
```

helper 只读取结构化 diagnostics，不查询数据库、不 rollback、不解析 `str(error)`/driver message/SQL，不匹配 alias 或 substring。`orig`、`diag` 或目标字段缺失即返回 unknown。

分类矩阵：

| diagnostics | 结果 |
|---|---|
| `23505 + uq_fact_versions_one_pending_per_product` | pending known；由 command rollback 后转既有 409 |
| `23505 + uq_fact_versions_product_id` | unknown；rollback 后原样 re-raise |
| `23505 + 其他/近似 constraint` | unknown；rollback 后原样 re-raise |
| 非 `23505`、缺字段、CHECK/FK/NOT NULL/trigger-like | unknown；rollback 后原样 re-raise |

### 2.2 Root transaction catch

保持 Product `FOR UPDATE`、所有 service precheck 和 version allocation 顺序不变。只在已进入本 command 的写入/flush/commit 边界捕获 `IntegrityError`：

1. 无条件执行 root `db.rollback()`，恢复该 command 在 request Session 中的全部未提交状态并解除 failed-transaction 状态。
2. exact pending pair 抛出 `AppError(code="FACT_REVIEW_PENDING", message="该产品已有待审核事实版本", status_code=409)`；沿用默认空 details。
3. version identity 或任意其他 unknown 使用 bare `raise` 重新抛出原始 `IntegrityError`，保留 exception identity/traceback，由现有 default 500 boundary 处理。

catch 不 commit、不重试、不自动分配下一版本、不 replay、不查询 winner，不创建 savepoint/第二事务。classifier 与 mapping 只属于此 command owner，不提升为全局 registry。

### 2.3 Lock、precheck 与成功路径

保持当前顺序：Product row lock → active/revision/nonblank checks → pending lookup → `max(version)+1` → FactVersion flush → FactReviewRecord → commit。新增 catch 不改写 flush 前的 `AppError`。

正常并发设计仍是同 Product row lock 串行：第一请求成功创建 pending 后，第二请求获得锁并由 pending precheck 返回既有 409。数据库 unique violation 是绕过/窗口下的最终 authority，不是正常控制流。

成功路径仍只创建一个 pending FactVersion 和一条对应 FactReviewRecord，并返回原有 read model；不增加 AuditLog 或 broker dispatch，因为当前 command 没有这些成功副作用。

## 3. 真实 PostgreSQL 与事务证明

### 3.1 Current-head catalog/diagnostics

复用 `test_publication_workflow.py` 的 `temporary_database()`，每次创建独立 PostgreSQL 数据库并 `alembic upgrade head`。测试直接查询 `pg_class`、`pg_index`、`pg_constraint`/`pg_get_indexdef`/`pg_get_expr`，断言：

- `uq_fact_versions_product_id` 唯一覆盖 `(product_id, version)`，无 predicate，并有关联 unique constraint；
- `uq_fact_versions_one_pending_per_product` 唯一覆盖 `product_id`，predicate 精确表达 `PENDING_REVIEW`，且作为 partial unique index 存在。

用真实 INSERT 分别触发两个 `23505`，从 `IntegrityError.orig.sqlstate` 与 `.diag.constraint_name` 断言 exact pair；测试不得以 SQLite、mock exception、ORM 命名约定或 message 文本替代最终证据，且 integration run 必须报告零 skip。

### 3.2 Exact-constraint 受控 sentinel

Product lock 使合法第二个业务请求不会自然到达 unique violation，因此 exact failure 测试使用 test-only、一次性、作用域限定的 SQLAlchemy flush/connection listener（或同等真实数据库装置）：

- listener 只绑定目标 Session/marker，在 pending precheck 之后、候选 ORM INSERT flush 前，使用同一 root transaction 插入一条受控 competitor；
- version sentinel 插入同一 `(product_id, version)`、非 pending 的 competitor，使候选真实命中 `uq_fact_versions_product_id`；
- pending sentinel 插入不同 version 的 pending competitor，使候选真实命中 `uq_fact_versions_one_pending_per_product`；
- listener 必须 one-shot，并在 `finally` 中移除；测试断言确实观察目标 diagnostics，避免未触发 listener 的假阳性；
- competitor 与候选都随 root rollback 消失。该装置只证明数据库最终 failure path，不伪装为正常 Product-lock race，也不进入 production 代码。

若无法在不改 schema、不削弱 Product lock、不依赖 sleep/mock 的前提下稳定制造 exact diagnostics，则停止并报告，不用错误 constraint 冒充。

### 3.3 正常 Product-lock 并发对照

另设两个独立 Session/connection，以 event/barrier 和有界 timeout 协调同 Product 请求：第一请求持有 Product lock 并最终 commit；第二请求确认经历数据库等待，随后读取 committed pending 并走 precheck。不得用无界 sleep 或修改生产查询。

终局断言数据库只有一个 pending FactVersion，并只有一条指向它的 submit FactReviewRecord。该用例与 transaction-local sentinel 分开命名、分开解释。

### 3.4 原子性快照

每条 exact failure 在调用前后由 request Session（rollback 后）和独立验证 Session 比较：

- 候选/competitor FactVersion、候选 FactReviewRecord；
- Product `facts_body_markdown`、`facts_classification`、`facts_revision`；
- 既有 pending FactVersion 的 body/status/revision 及其既有 FactReviewRecord；
- ContentTask `current_content_version_id` 等 pointer 与 ContentVersion；
- SUCCESS AuditLog；
- broker dispatch spy/counter。

version identity 与 pending known 都不得留下候选或部分记录。当前 command 不拥有 workspace、ContentTask/ContentVersion、AuditLog 或 dispatch 写入；测试通过前后快照和调用计数证明这些边界未被未来修改意外穿透，而不是为测试添加虚构副作用。

## 4. HTTP 边界

### 4.1 Pending known

通过真实 HTTP command 路径分别覆盖既有 precheck 与受控 exact partial-index failure，断言两者除当前 request ID 外均为：409、`FACT_REVIEW_PENDING`、`该产品已有待审核事实版本`、`details={}`。每条 response 的 body `error.request_id` 必须等于 `X-Request-ID`。

### 4.2 Version/other unknown

version exact 与 negative matrix 中的 unknown 至少有真实 HTTP 覆盖，断言 status 500 与 no-leak；response 不得包含 SQL、表名、两个 constraint 名、driver message 或 stack。测试不得断言当前默认 500 是否 JSON、具体 code/details/body 或 media type，避免把实现偶然形状升级为公共合同。

OpenAPI、router metadata、generated schema 和 runtime handler inventory 均保持零 diff；现有 unit contract/runtime metadata tests 只运行不修改。

## 5. 前端状态设计

### 5.1 Fact-review 局部恢复投影

在 `fact-workspace.model.ts` 的事实审核错误投影边界做最小结构校验，避免 malformed `details` 进入共享 mapper 后解引用失败。只有同时具备结构化 exact `code === "FACT_REVIEW_PENDING"`、合法对象 `details` 与非空 request ID 时，才产生 pending recovery decision；message 仅用于展示，不用于分类。

真正 `REVISION_CONFLICT` 保持独立 decision。合法且结构完整的既有 `INVALID_STATE_TRANSITION` 保持现有独立 canonical refetch decision，但既不是 pending blocker，也不是 revision conflict。除此之外的其他 code、unknown 500、非标准 payload、malformed details、缺失/空白 request ID 返回 generic summary fallback。此逻辑只服务 Fact Workspace，不修改共享 `product.api.ts`、不建立第二套全局 error type system。

### 5.2 Pending blocker 生命周期

按 `productId` 隔离的 `FactWorkspaceEditor` 持有 pending blocker（message、request ID）；Fact Review Dialog 只展示该状态并保留 change summary。页面 `SUBMIT_REVIEW` 入口与 Dialog confirm 必须共同消费同一 blocker，避免 Dialog 生命周期成为状态 owner。exact pending 到达后：

1. 立即阻止 confirm 再次发起 POST；原 POST 总次数保持一。
2. 不设置 revision-conflict 状态，不使用 revision 文案。
3. 页面发起一次明确的 canonical refetch；refetch API 必须区分真实成功与“保留旧 query data 的失败”，不能把 stale cached data 当成成功。
4. refetch 失败：editor 保留原 pending message/request ID 与 blocker，Dialog 保留 input，同时允许现有刷新错误区域展示失败；不得恢复页面入口或 confirm。用户关闭再重开 Dialog、或再次触发旧页面 action，都不能产生第二次 POST；导航到其他 `productId` 时不得继承该 blocker。
5. refetch 成功：采用返回的服务器 workspace，清理临时 blocker，并只由其 `available_actions` 重新决定页面动作；已有 pending 的 canonical model 不再提供 `SUBMIT_REVIEW`。Dialog 可保持打开展示原错误，confirm 继续禁用，用户可自行关闭。

workspace 本地 dirty 输入按现有安全策略保留；不得因 pending 恢复覆盖未保存 Markdown。关闭 Dialog 不触发 replay。

### 5.3 Unknown 500 与 negative fallback

version identity/default 500 保持 generic failure：只显示安全 summary，不触发 canonical refetch、不自动 replay、不猜 version。除结构完整的既有 `INVALID_STATE_TRANSITION` 独立 refetch 分支外，其他 code 或 malformed envelope 都不进入 pending/revision recovery。测试用“message 文本与 pending 相同、code 不同”的反例证明页面不按文案分类，并用单独回归证明 `INVALID_STATE_TRANSITION` 没有被误删或误投影。

## 6. 测试结构

Backend：

- `test_publication_workflow.py` 承担 current-head catalog/真实 diagnostics、classifier matrix、受控 exact failures、Product-lock 并发、完整原子性、Session reuse、HTTP envelope/no-leak 与成功 submit 回归。
- `test_product_detail.py` 承担事实 workspace/read-model、stale revision、inactive/blank 与必要的 Product-level 回归；仅在能提升边界证据时补断言，不复制所有数据库 fixture。
- `test_contract.py` 与 `test_runtime_response_metadata.py` 只运行，证明公共响应与全局 handler inventory 未漂移。

Frontend：

- model tests 覆盖 exact pending/revision decision、malformed details、其他 code、缺失/空 request ID 与 message-mismatch fallback。
- page tests 覆盖 message/request ID、本地输入、POST once、刷新失败后关闭/重开仍无法再次 POST、刷新成功、canonical `available_actions`、不进入 revision、既有 `INVALID_STATE_TRANSITION` 独立 refetch，以及 unknown 500 no reload/no replay。

## 7. 稳定文档同步

- `error-handling.md`：记录 FactVersion pending exact pair、version/unknown 原抛、command root rollback 与 unknown 500 no-leak。
- `database-guidelines.md`：记录 `submit_fact_review` 是 INSERT/transaction owner、Product lock 正常并发与两条失败原子性；不复制 DDL。
- `state-management.md`：记录 Fact Workspace pending blocker、safe payload 投影、explicit canonical refetch、`available_actions` 与 no replay。
- Frontend V2 文档：同步同一业务动作恢复语义。

`contracts/database.md` 当前 owner uniqueness、Product lock 与 one-pending 描述仍准确，保持零 diff；若实施发现其失真，先停止并请求最小同步授权。

## 8. 风险与停止条件

- catalog/diagnostics 与 frozen identity 不同：停止，不新增 alias、message parser 或 migration。
- root rollback 无法由 command owner完整恢复 Session/状态：停止，不引入隐式 savepoint 或额外事务 owner。
- normal concurrency 只能通过削弱 Product lock 或 sleep 才可测：停止并重新报告测试装置缺口。
- pending 映射需要改变公共 status/OpenAPI/generated type，或 unknown 需要 winner inference/replay：停止。
- 前端只能通过共享错误系统重构、message 判断或自动 POST 才能恢复：停止。

## 9. 回滚策略

后续实施 diff 保持 owner 局部：移除 `submit_fact_review` 的 classifier/catch 可恢复旧后端行为；移除 Fact Workspace 的局部 pending blocker/投影可恢复旧前端行为；测试与稳定文档同步反向删除。无 migration、数据修复、公共 schema 或 generated artifact，因此不需要部署级数据回滚。
