# Current-head 普通 Content Task 幂等完整性证据

## 1. 研究范围与权威顺序

本记录汇总当前 `main` 上普通 `createContentTask` 的实现、合同、事务和测试证据。最终业务选择依次以用户本次冻结要求、`09-05-content-integrity-error-contract-decision/research/contract-decision-matrix.md` 和本 Task PRD 为准。

旧研究 `09-05-content-integrity-error-contract-decision/research/content-task-idempotency.md` 曾提出同时修改普通与 GEO writer，并包含 publication repair 建议；最终矩阵已将 I2 收窄为普通 caller。当前 Task 因此不继承旧研究的双向 GEO 或 repair 实施范围。

## 2. 当前生产实现

### 2.1 普通 owner

- `backend/app/services/content_planning.py:426-465` 的 `create_content_task` 是普通 command owner。
- `:436-443` 使用 `content-task-create:{key}` transaction advisory lock 并按 `idempotency_key` lookup。
- `:444-450` 当前只比较 `product_id`、`fact_version_id`、`platform_profile_id`，尚未检查 `ContentTaskGeoSource`。
- `:371-399` 按 platform → product → fact 顺序锁定并校验活动平台、活动产品、同产品的非空批准事实。
- `:402-423` 的 `add_locked_content_task` 写入普通 task 并直接 flush；`:452-465` 的 caller 尚未捕获精确 idempotency `IntegrityError`。

### 2.2 GEO 交叉 owner

- `backend/app/services/geo_observation.py:2201-2234` 使用相同 advisory lock namespace 和全表 key lookup，但会额外比较 `ContentTaskGeoSource` 的 rule/period/article/topic/platform identity。
- `:2313-2334` 在同一事务创建 `ContentTask` 与 `ContentTaskGeoSource`。
- 普通 lookup 未检查 source，GEO lookup 会拒绝 source 缺失，形成当前不对称；本 Task只修正“GEO winner 不可被普通 command replay”这一普通 caller 方向。

### 2.3 约束与 Session owner

- ORM `backend/app/models/content.py:31-34` 声明 `uq_content_tasks_idempotency_key`；migration `backend/alembic/versions/0032_content_task_idempotency.py:19-23` 创建相同名称。
- `backend/app/db.py:31-40` 的 request Session owner 在异常退出时 rollback。局部 exact-race recovery 若要继续查询 winner，必须在 caller 中先 root rollback。
- `backend/app/errors.py:40-53` 产生稳定 `AppError` envelope；`backend/app/main.py:261-295` 的 middleware 设置并回写 `X-Request-ID`。
- T1 历史 Task `archive/2026-09/09-04-unknown-integrity-error-boundary-correction` 已完成；当前 `main.py` 只注册 `AppError` 与 request validation handler，不存在全局 IntegrityError 业务映射。

## 3. 合同证据

- `contracts/openapi.yaml:1901-1924` 的 `createContentTask` 已声明 `201` replay 与 `409 ErrorResponse`；`ContentTaskCreate` 保持三字段 body，Idempotency-Key 保持 8–128 header。
- `contracts/database.md:37,414` 记录 nullable unique key、同 identity replay 和数据库唯一性，但尚未完整记录最终 constraint 名称、ordinary source kind 与 rollback/requery。
- `.trellis/spec/backend/database-guidelines.md:499-515,534-556` 冻结普通创建、advisory lock 和前端幂等语义，但当前只写“三字段”，需补普通/GEO source-kind discriminator 和 exact-race 边界。
- `.trellis/spec/backend/error-handling.md:70-88,156-176` 已要求已知识别只读结构化 diagnostics、unknown 原抛且默认 500 body 不成为新合同；本任务不修改该文件。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md:133-137` 已冻结前端失败重试复用 key、payload 改变或 `IDEMPOTENCY_CONFLICT` 后换 key 的行为，无需修改。

## 4. 当前测试能力与缺口

### 4.1 Backend integration

`backend/tests/integration/test_content_task_creation.py` 已有：

- `:155-288` 顺序 same identity replay、不同平台冲突和资源资格校验；
- `:290-329` 两 Session 正常同 key 并发，只断言最终一行和同 ID。

缺少：

- GEO winner 负例；
- 准确 409 body/request ID；
- 对正常并发只执行一次 insert 的直接证据；
- current-head catalog/真实 `23505 + constraint_name`；
- rollback 后 same/different/GEO winner 恢复；
- winner missing、identity 不完整、unknown 原异常与不泄漏；
- 全部失败副作用和 Session reuse 快照。

### 4.2 Frontend

- `frontend/src/domains/content/new-content-task-page.tsx:141-168` 使用 command signature 复用 key，在 `IDEMPOTENCY_CONFLICT` 后清空 key，同时保留表单。
- `frontend/src/domains/content/new-content-task-page.test.tsx` 的“`IDEMPOTENCY_CONFLICT` 废弃冲突键，下次显式提交生成新键”用例已经覆盖本任务要求的恢复策略。
- 因前端合同和实现均不变，当前证据支持只运行该测试而保持前端零 diff。

## 5. 测试构造决策

### 5.1 正常并发

保留现有两个独立 Session 与 barrier，以 SQL statement listener 或等价稳定观测统计 `INSERT INTO content_tasks`。预期只有第一个请求 insert，第二个请求取得 advisory lock 后直接 lookup replay。

### 5.2 exact-constraint sentinel/race

真实 PostgreSQL unique violation 不能通过现有正常同 key writer 产生，因为它们遵守同一 advisory lock。测试需在普通 pre-insert lookup 后暂停 caller，让另一个不获取该 lock 的独立 Session 直接提交 winner，再继续 caller 的正常 insert。该构造只模拟遗漏锁协议的 writer/最终数据库防线，并必须在测试名称和说明中标记 sentinel/race。

分别构造：

- winner 为同三个目标字段、无 GEO source：rollback 后 201 replay；
- winner 为不同普通 identity：rollback 后准确 409；
- winner 为同三个目标字段但带 `ContentTaskGeoSource`：rollback 后准确 409。

### 5.3 不可达/unknown 分支

真实 exact unique violation通常必然存在 winner；winner missing、identity 损坏和 diagnostics 缺失需用窄测试替身触发，但断言必须保留原异常对象，不能把 mock 当作真实 diagnostics 的唯一证据。真实 catalog 和真实 duplicate insert另行证明 SQLSTATE/name。

### 5.4 HTTP 与原子性

使用现有 TestClient dependency override 模式通过实际 middleware/handler 验证准确 AppError envelope 和 request ID。unknown sentinel 关闭 server exception re-raise，只检查 500 和敏感字符串缺失。

失败前后至少比较 ContentTask 行、winner ID/status/revision/current pointer/source、ContentVersion、FactVersion、ReviewRecord、AuditLog；普通 service 没有 dispatcher，测试应记录该事实，不伪造不存在的生产调用。

## 6. 停止条件

- 若 current-head PostgreSQL catalog 与 migration/ORM 名称不同，停止并回到 schema/migration 规划。
- 若只改普通 caller 无法判断 `ContentTaskGeoSource` existence，或必须修改 GEO incoming/shared policy，停止并转 T5-C。
- 若需要新增公开 contract/status/code、修改 router/generated client/frontend 或数据库 schema，停止并重新做合同决策。
