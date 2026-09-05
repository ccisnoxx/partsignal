# Current-head Generation Job 幂等与完整性证据

## 1. 研究范围

本记录只汇总当前 `main`（T4-C 合同提交 `8d47363b` 后）与本任务直接相关的 owner、调用顺序、约束和测试缺口。最终业务选择以 `09-05-content-integrity-error-contract-decision/research/contract-decision-matrix.md` 为准。

## 2. 当前生产实现

### 2.1 Identity 与 lookup

`backend/app/services/content_production.py` 已有 `_GenerationJobIdentity` 和 `_find_existing_generation_job`。identity 覆盖 Task、retry 来源、模型、job type、source content，并对 GENERATE 保留原 prompt id/revision。该结构已经是幂等比较的单一 owner，本任务不需要增加 DTO、hash 或第二套比较规则。

lookup 已实现：

- key 未使用：返回空；
- key 已使用且 identity 一致：返回既有 Job；
- key 已使用但 identity 不一致：抛既有 `IDEMPOTENCY_CONFLICT`。

### 2.2 事务与 dispatch

`_create_job` 负责 lookup、构造 GenerationJob/input snapshot 和 flush；ContentVersion 只可能由后续 worker 成功终结事务创建。create/retry caller 负责 commit 与 `_dispatch_job`。现有成功路径为 commit-before-dispatch，broker 失败不会删除已提交的 `PENDING` Job。

因此 race 恢复应留在 create/retry caller：只有 caller 同时拥有 transaction rollback、请求 identity 和是否 dispatch 的决策信息。把恢复放进 `_create_job` 会模糊事务 owner，并可能在失败 Session 中查询。

### 2.3 createGenerationJob

create 路径会锁 Task 并执行常规 lookup，但没有捕获 `uq_generation_jobs_idempotency_key` 的精确 `IntegrityError`。同 Task race 受 Task 锁保护；不同 Task 不共享这把锁，仍可能在 lookup 与 insert 之间竞争全局 key。

### 2.4 retryGenerationJob

公共前置部分已验证 previous Job、可重试合同、`FAILED`、Task 锁和 `OPEN`。

HUMANIZE 分支随后验证旧 snapshot、构造 identity 并在 latest-job 前 lookup。GENERATE 分支当前先执行 latest-job 和当前 facts/product 等检查，之后才查询 key/创建 Job。这解释了顺序 replay 缺陷：第一次 retry 成功后，latest Job 已变化，同 key 第二次请求无法先看到 winner。

目标不是把所有校验都移到 lookup 后，而是保持 previous/FAILED/Task OPEN/旧 snapshot 先验证，只把 latest/current 创建资格放到 lookup miss 之后。

### 2.5 当前 IntegrityError 分类

Humanization 已有私有 classifier，只接受 PostgreSQL unique violation 与精确约束名：

- `uq_generation_jobs_idempotency_key`
- `uq_generation_jobs_active_humanization_source`

Humanization caller 在 idempotency 精确命中后 rollback 并查询 winner；active-source 精确命中后 rollback 并直接抛 `HUMANIZATION_ALREADY_ACTIVE`，不回查 active Job。无法验证 idempotency winner 时重新抛出原错误。本任务应复用该 caller-owned rollback 结构，但 GENERATE caller 只能接受 idempotency 约束，不能误接 active-source 约束。

## 3. 合同与数据库证据

### 3.1 OpenAPI

`contracts/openapi.yaml` 中 createGenerationJob、createHumanizationJob、retryGenerationJob 已包含所需 `202` 与 `409` 响应，`ErrorEnvelope`/`ErrorDetail` 已能表达既有 `IDEMPOTENCY_CONFLICT`。不需要新增字段、code schema 或 status。

### 3.2 数据库

`contracts/database.md` 已定义 Generation Job 的 idempotency 与 active Humanization source 约束边界。真实约束名称仍必须由 current-head PostgreSQL catalog 与实际 `IntegrityError.diag.constraint_name` 在实施测试中确认，不能仅凭文档字符串断言。

### 3.3 前端合同

`docs/frontend-v2/05-business-actions-state-and-api-contract.md` 与 generated client 已消费通用错误 envelope；本任务不改变前端行为或公共接口，因此两者只作为零 diff target。

## 4. 现有测试能力与缺口

### 4.1 `backend/tests/unit/test_generation.py`

已有 Generation 创建/retry、snapshot 和部分幂等行为的 service 单元覆盖，但缺少：

- GENERATE retry 的明确调用顺序证据；
- 第一次成功后同 previous + 同 key replay；
- GENERATE create/retry 精确 diagnostics 恢复矩阵；
- winner 缺失/不可验证时原异常对象重抛；
- GENERATE 对 active-source 约束的拒绝。

### 4.2 `backend/tests/integration/test_generation_reliability.py`

已有真实 PostgreSQL 临时库、seed helper、并发屏障/事件、catalog diagnostics、Humanization idempotency/active-source、duplicate worker、lease、broker 补投递和 provider failure 等基础设施。缺少：

- 同 Task GENERATE 正常并发通过锁 + 普通 lookup replay 的证据；
- 跨 Task同 key异 identity 的 GENERATE create/retry 真实 race；
- same-identity exact-constraint sentinel；
- create/retry HTTP `ErrorEnvelope` 和 request ID 一致性；
- known/unknown 对 Job、Version、Task、Review、Audit、dispatch 的完整前后快照。

## 5. 测试构造决策

### 5.1 同 Task 正常并发

使用两个独立数据库 Session/connection 和可观测同步点，让第一个请求持有 Task 锁并完成提交，第二个随后取得锁。断言第二请求的候选 insert 未发生或 classifier 未被调用、普通 lookup 返回同一 Job，最终一行 Job且 dispatch 总计一次。这才是正常同 Task race。

### 5.2 跨 Task异 identity race

两个不同 Task 绕过共享 Task 锁，但使用同一 key。对 create 和 GENERATE retry 两个入口分别同步两个事务，在各自最终 lookup 后竞争 insert/commit，由真实全局唯一约束产生 loser；两个入口还必须分别覆盖 HTTP 恢复合同，不能只凭共享 helper 推断。

### 5.3 create same-identity sentinel

只在 `createGenerationJob` 上使用该 sentinel。选择没有 current content version 的 Task，先提交一个 identity 完全一致的 winner；此时候选 insert 前只有 `_create_job` 内的一次普通 identity lookup。测试只隐藏这一次 lookup，使候选真实 insert 并触发精确唯一约束；rollback 后恢复查询，先验证 winner identity 字段完整性，再返回 `202` replay。它证明防御性恢复分支，但数据库与 Task 锁决定它不是正常同 Task 并发，因此测试名和文档必须显式标记 sentinel。

retry 不能用“预置 winner 后只隐藏第一次 lookup”的同样技巧：winner 已改变 latest-job，且 `_create_job` 仍会再次 lookup。retry 的真实 exact-constraint 证据应来自跨 Task race：两个请求在各自 Task 上通过前置与新建资格，并在各自最后一次普通 lookup 后竞争同一个 key，由一个事务提交 winner、另一个真实触发约束。

### 5.4 rollback 后 identity 可验证性

普通 `_find_existing_generation_job` 将任何 matcher `False` 都解释为异身份 `409`，该语义对 pre-insert lookup 和 Humanization 保持不变。GENERATE exact-constraint 恢复不能直接依赖这一结果：rollback 后应先按 key加载 winner，并验证 canonical identity 所需字段。

对原始 GENERATE winner，`input_snapshot`、`platform_prompt` 及其 `id`/`revision` 必须具备可解释结构；字段完整但值不同才是可证明的异身份，缺失或损坏必须重新抛出原 `IntegrityError`。测试使用实际 winner 对象的缺字段/坏结构，不以 mock matcher 抛异常代替。retry 的 prompt identity 为 `None`，其余 scalar 字段继续精确比较。

### 5.5 HTTP envelope

优先使用现有 FastAPI app/依赖覆盖对真实 create/retry operation 发请求；若集成夹具无法稳定打开并发窗口，可让真实 PostgreSQL race 证明数据库分支，再通过相同 service 异常穿过现有 router/error handler 验证 envelope。不得在测试内复制 envelope 构造逻辑作为唯一证据。

### 5.6 原子性快照

known loser 与 unknown 路径在调用前后记录：

- `generation_jobs`、`content_versions`、`content_review_records`、`audit_logs` 数量/关联行；
- Task 当前版本指针和 revision；
- dispatch spy/counter。

断言候选事务没有第二份资源或副作用。winner 自身的既有资源不计为 loser 泄漏。

## 6. 最小结构决策

根据 `clean-code-design`，本任务的稳定抽象仅有现存 identity、lookup 与一个表内 diagnostics classifier：

- 不新增 repository/factory/strategy；
- 不新增跨表 IntegrityError registry；
- 不创建只转发一个调用的 transaction helper；
- 不把 HTTP 或 broker 行为放入 mapper；
- 若 create/retry 的 rollback/requery 代码只出现两处且上下文不同，优先保持 caller 内显式流程；只有出现完全相同、可独立验证的恢复不变量时才考虑小型私有 helper。

## 7. 实施停止条件

若 current-head 证据显示需要修改公开 code/status、数据库 schema、worker policy、router/OpenAPI/generated client/frontend，或无法用现有 identity 可靠验证 winner，立即停止并回到父任务/T4-C 重新决策，不在本任务内猜测兼容字段或扩大 owner。
