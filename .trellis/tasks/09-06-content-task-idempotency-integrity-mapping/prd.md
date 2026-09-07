# Content Task 幂等 IntegrityError 映射

## 目标

在不改变公开 API、数据库 schema、GEO incoming command 或前端恢复语义的前提下，完成 Content/Generation IntegrityError 合同决策后的第二个独立 implementation Task：让普通 `createContentTask` 在命中精确 PostgreSQL `23505 + uq_content_tasks_idempotency_key` 时，按普通 Content Task 的 canonical identity 安全恢复 winner，并让所有未知完整性错误继续显式失败。

## 上下文与依赖

- 父任务：`09-04-integrity-error-domain-mapping`，继续保持 `planning`。
- 合同决策 owner：`09-05-content-integrity-error-contract-decision`，继续保持 `planning`；本任务依赖其已经批准的 I2 决策，不能用父子树位置替代该显式依赖。
- T1 `unknown-integrity-error-boundary-correction` 已归档，当前 runtime 不再注册全局 `IntegrityError -> REVISION_CONFLICT` handler；unknown 继续进入默认 500 boundary。
- `humanization-job-integrity-error-domain-mapping` 与 `generation-job-idempotency-integrity-mapping` 已完成；可借鉴“精确 diagnostics、caller rollback、winner revalidation”的局部模式，但不得传播其 Generation/Humanization identity 或 worker 语义。
- 当前工作区已有 `.gitignore`、`artifacts/` 和 `backend/app/schemas/configuration.py` 等范围外改动；全部保持不动，不纳入本任务 diff、验证或后续提交。

## 已确认的当前实现事实

- `create_content_task` 先获取 `content-task-create:{idempotency_key}` 的 PostgreSQL transaction advisory lock，再按 key lookup；当前只比较三个目标字段，未排除带 `ContentTaskGeoSource` 的 GEO 任务，也未恢复 flush 的精确唯一约束错误。
- 普通 ContentTask 新建只写一条 `ContentTask`；不会创建 `ContentVersion`、`FactVersion`、`ReviewRecord`、AuditLog、task pointer/revision 或 dispatch。
- `create_geo_optimization_content_task` 使用相同 advisory lock namespace 和同一唯一键，但拥有独立的 GEO source snapshot identity；本任务只允许把它作为普通 command 的 winner 负例，不修改 GEO command。
- `createContentTask` 已声明 `201` 与 `409`，`ErrorEnvelope`、request ID header 和 generated client 已能表达既有 `IDEMPOTENCY_CONFLICT`；无需新增 status、code、字段或生成物。
- 普通新建页已经在 `IDEMPOTENCY_CONFLICT` 后保留安全表单、废弃冲突 key，并只在用户下一次显式提交时生成新 key；现有组件测试已经覆盖该行为。

## 需求

### R1：冻结普通 canonical identity

普通 `createContentTask` 的 canonical identity 必须由以下四部分共同决定：

1. `product_id`；
2. `fact_version_id`；
3. `platform_profile_id`；
4. ordinary source kind，即不存在 `ContentTaskGeoSource`。

actor、request ID、创建时间和幂等键本身不是 identity 字段。带 `ContentTaskGeoSource` 的任务即使三个目标字段完全相同，也不得被普通 command 当作 replay winner。

### R2：顺序 replay 与冲突

- 同 key、同普通 canonical identity 返回既有 `ContentTask`，HTTP 保持 `201`，不创建第二行或其他副作用。
- 同 key、不同目标字段，或 winner 是 GEO task，返回既有准确合同：HTTP `409`、`code=IDEMPOTENCY_CONFLICT`、`message=幂等键已用于另一内容任务创建请求`、`details={}`。
- `ErrorEnvelope.error.request_id` 必须与响应头 `X-Request-ID` 一致。

### R3：正常 advisory-lock 并发保持不变

普通同 key 并发继续由现有 transaction advisory lock 串行。后到请求取得锁后必须通过普通 lookup replay；真实测试应证明只发出一次 ContentTask insert，不把该正常路径误述为 unique-violation race。

### R4：精确 IntegrityError 分类

- 仅当 `error.orig.sqlstate == "23505"` 且 `error.orig.diag.constraint_name == "uq_content_tasks_idempotency_key"` 时，普通 caller 才可进入恢复。
- 禁止解析 `str(error)`、数据库英文 message、constraint 前缀、字段值或替代 diagnostics 位置；不得建立全局 mapper、registry 或第二套错误类型系统。
- diagnostics 缺失、非 `23505`、其他 constraint/index，以及 FK/CHECK/NOT NULL/trigger 等完整性错误都必须原样重新抛出捕获到的 `IntegrityError`。

### R5：rollback 后 winner 恢复

精确 constraint 失败后，普通 caller 必须：

1. 保存原始 `IntegrityError`；
2. 对 request Session 执行 root `rollback()`；
3. 按原 key 查询已提交 winner；
4. 验证 winner 的 canonical identity 可判定；
5. 同普通 identity 时 replay，普通异 identity或 GEO source kind 时抛既有 `IDEMPOTENCY_CONFLICT`。

winner 缺失、必需 identity 字段不完整或无法可靠判定时，必须重新抛出最初的 `IntegrityError`，不得猜测为冲突。已知恢复完成后同一 request Session 必须可继续查询。

### R6：真实 PostgreSQL 证据

- current-head PostgreSQL catalog 和真实异常都必须证明 SQLSTATE 为 `23505`、constraint name 为 `uq_content_tasks_idempotency_key`。
- 使用独立 Session 与受控测试同步点，在普通 pre-insert lookup 之后让一个绕过 advisory protocol 的 writer 提交 winner，真实触发数据库最终约束；该 sentinel/race 不得被描述为正常同 key 并发模型。
- exact-constraint 恢复至少覆盖普通同 identity、普通异 identity、GEO winner 三种 winner；另覆盖 winner missing、identity 不完整和 unknown diagnostics matrix。

### R7：原子性与不泄漏

- 已知 loser 与 unknown 失败都不能留下候选 ContentTask 或改变 winner。
- 失败后只有一个 ContentTask，不产生 ContentVersion、FactVersion、ReviewRecord、task pointer/revision、AuditLog 或 dispatch。
- unknown HTTP 500 响应不得泄漏 SQL、表名、constraint name、driver message 或堆栈；不冻结默认 500 的具体 body/code/header/media type。

### R8：前端与公共合同零变更

- 普通新建页继续保留安全表单、废弃冲突 key，并等待用户显式再次提交后生成新 key；不得自动 replay 异 identity。
- 现有前端组件测试已经覆盖该恢复语义，本任务只运行回归，不修改前端文件；若实施时证据证明缺口，先停止并重新 review 范围，不能直接扩大。
- `contracts/openapi.yaml`、runtime response metadata、generated client、router 和公共 status 集必须保持零变更。

### R9：文档同步

- `contracts/database.md` 补充 `uq_content_tasks_idempotency_key` 的准确名称、ordinary source kind、数据库最终仲裁和 rollback/requery 边界，避免把规则误写为所有唯一约束均返回 409。
- `.trellis/spec/backend/database-guidelines.md` 补充普通 ContentTask 的精确 diagnostics、GEO winner 负例、unknown 原抛与无副作用要求。
- 不修改 OpenAPI 或 Frontend V2 业务动作文档；它们的现有公开状态、请求体和前端恢复语义均未变化。

## 实现文件边界

允许修改：

- `backend/app/services/content_planning.py`
- `backend/tests/integration/test_content_task_creation.py`
- `contracts/database.md`
- `.trellis/spec/backend/database-guidelines.md`

只读并要求零 diff：

- `backend/app/services/geo_observation.py`
- `backend/app/routers/planning.py`
- `backend/app/routers/observation.py`
- `contracts/openapi.yaml`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `frontend/src/shared/api/generated/schema.d.ts`
- `frontend/src/domains/content/new-content-task-page.tsx`
- `frontend/src/domains/content/new-content-task-page.test.tsx`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`

## 非目标

- 不修改 `createGeoOptimizationContentTask`、GEO frontend、GEO incoming/shared-key policy 或双向跨 command identity。
- 不处理 `uq_content_tasks_source_published_content_issue_id`、publication repair、Generation Job、Content Version、Fact Version 或 worker。
- 不修改数据库 schema、migration、约束、公共 status、error code、权限或状态机。
- 不新增 repository、事务 runner、通用 mapper/framework、错误文本解析或兼容性 fallback。

## 验收标准

- [ ] AC1：普通顺序同 key、同四部分 canonical identity 返回同一 ContentTask 和 `201`。
- [ ] AC2：普通顺序同 key、不同目标字段返回准确 `409 IDEMPOTENCY_CONFLICT` 合同。
- [ ] AC3：预存在或 race 后的 GEO winner 都不能被普通 command replay；返回同一准确 `409`。
- [ ] AC4：正常同 key 并发由 advisory lock 串行，后到请求走 lookup，数据库中只有一行且只执行一次 ContentTask insert。
- [ ] AC5：真实 PostgreSQL catalog/异常证明 `23505 + uq_content_tasks_idempotency_key`，受控 sentinel/race 与正常并发在测试命名和断言中明确区分。
- [ ] AC6：exact constraint 后先 rollback 再查 winner；同普通 identity replay，普通异 identity/GEO winner 冲突，request Session 可继续查询。
- [ ] AC7：winner missing、identity 不完整、diagnostics 缺失、非 `23505` 或其他 constraint 时重新抛出同一个原始 `IntegrityError`。
- [ ] AC8：known 与 unknown 失败均无候选任务、版本、事实、审核、pointer/revision、审计或 dispatch 泄漏。
- [ ] AC9：HTTP 409 的 status/code/message/details/request ID 精确；unknown 500 不泄漏 SQL、表名、constraint 或数据库 message。
- [ ] AC10：普通前端冲突恢复回归通过，且前端生产代码和测试保持零 diff。
- [ ] AC11：OpenAPI、router、runtime metadata、generated client、公共 status 和 GEO owner 保持零 diff。
- [ ] AC12：required targeted tests、Ruff、mypy、`git diff --check`、文档/零 diff gates 全部通过；可选全套未运行时记录替代证据与剩余风险。
