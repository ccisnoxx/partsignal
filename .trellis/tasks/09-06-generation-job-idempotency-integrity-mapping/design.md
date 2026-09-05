# Generation Job 幂等完整性映射设计

## 1. 设计摘要

本任务只在 `content_production.py` 的 Generation Job 创建事务 owner 内补齐两个缺口：调整 GENERATE retry 的 lookup 顺序，以及为 GENERATE create/retry 增加精确 PostgreSQL idempotency race 恢复。复用现有 `_GenerationJobIdentity`、`_find_existing_generation_job`、Task 行锁和 caller-owned transaction，不引入全局 IntegrityError mapper、事务封装器或新公开合同。

稳定边界如下：

- classifier 只读取 PostgreSQL diagnostics 并返回精确约束分类；
- create/retry caller 负责 rollback、winner lookup、身份重验和领域错误选择；
- router 与全局错误 handler 继续负责 HTTP `ErrorEnvelope` 和 request ID；
- 成功 caller 继续 commit 后 dispatch，worker 与补投递机制不变。

## 2. 当前问题

### 2.1 GENERATE retry 的 lookup 太晚

当前 HUMANIZE retry 已在旧 snapshot 验证后构造 identity 并 lookup，而 GENERATE retry 先经过 latest-job、当前 facts/product 等资格校验。第一次 retry 成功会改变 latest Job，因此同 previous + 同 key 的顺序 replay 在发现 winner 前就失败。

### 2.2 GENERATE create/retry 未恢复唯一约束 race

普通 lookup 与 insert 之间仍存在跨 Task 并发窗口。Task 行锁只能串行同一个 Task，不能阻止不同 Task 以同一个全局 idempotency key 同时通过 lookup。数据库唯一约束是最终仲裁者；当前 GENERATE caller 未把其精确 race 转为 replay/conflict。

## 3. 所有权和不变量

| 责任 | 权威 owner | 本任务处理 |
| --- | --- | --- |
| Generation Job identity | `_GenerationJobIdentity` | 原样复用，不新增第二套身份结构 |
| 普通 key lookup/身份比较 | `_find_existing_generation_job` | 保持 pre-insert lookup 与 Humanization 的既有语义 |
| race 后 winner 恢复 | GENERATE create/retry caller 内的窄恢复流程 | rollback 后先验证 identity 完整性，再复用 canonical 比较；不可验证时原抛 |
| PostgreSQL diagnostics 分类 | `content_production.py` 的表内私有 helper | 只接受精确 `sqlstate + constraint_name` |
| rollback 与 winner 恢复 | `create_generation_job` / `retry_generation_job` caller | 捕获后先 rollback，再查询并重验 |
| HTTP envelope/request ID | 既有 router 与异常 handler | 零代码 diff，以 HTTP 测试验证 |
| 同 Task 并发 | Task `SELECT ... FOR UPDATE` | 保持并证明第二请求走普通 lookup |
| 跨 Task 并发 | PostgreSQL 唯一约束 | 一个 winner，loser 精确恢复 |
| dispatch | caller commit 后 `_dispatch_job` | 保持 commit-before-dispatch |

## 4. 精确 classifier

继续采用表内私有、无副作用 classifier。最小实现可以复用并适当重命名当前 Humanization classifier，使其表达“GenerationJob 表约束分类”；也可以增加只服务 GENERATE 的窄 helper。选择以最少重复且 caller allowlist 清晰为准，不建立 registry。

classifier 的输入是捕获到的 `IntegrityError`，只读取以下固定位置：

- `error.orig.sqlstate`；
- `error.orig.diag.constraint_name`。

只有 `error.orig.sqlstate == "23505"` 且 `error.orig.diag.constraint_name` 精确等于已知名称时才返回分类。即使其他属性带有 `23505` 或相似名称，只要规定位置缺失就必须 unknown。GENERATE caller 的 allowlist 只能包含 `uq_generation_jobs_idempotency_key`；Humanization caller 继续允许该约束和 `uq_generation_jobs_active_humanization_source`。字符串猜测、异常 message 解析、约束前缀匹配、index 名兜底或缺失 diagnostics 推断均禁止。

classifier 不得 rollback、查询数据库、dispatch、构造 `AppError` 或吞掉 unknown。

## 5. 目标流程

### 5.1 createGenerationJob

1. 验证 Task 和创建资格并获取 Task 行锁。
2. 构造请求的 canonical `_GenerationJobIdentity`。
3. 普通 lookup：同身份 winner 直接返回；异身份抛 `IDEMPOTENCY_CONFLICT`。
4. 无 winner 时创建候选 Job，并保持现有 flush/commit 边界。
5. 若 flush/commit 前收到 `IntegrityError`：
   - classifier 非精确 idempotency 约束：原样抛出；
   - 精确 idempotency 约束：保存原异常引用并 rollback；
   - rollback 后按 key 直接加载 winner，不先调用会把所有 mismatch 映射为 `409` 的普通 lookup；
   - 先验证 winner 的 canonical identity 字段完整性，再调用唯一的 canonical 比较逻辑；
   - winner 可验证且同身份：作为 replay 返回；
   - winner identity 字段完整且可证明不相同：抛既有 `IDEMPOTENCY_CONFLICT`；
   - winner 缺失或 identity 无法验证：重新抛出保存的原 `IntegrityError`。
6. 仅新建并成功 commit 的请求 dispatch；replay 不重复 dispatch。

### 5.2 GENERATE retryGenerationJob

顺序必须在代码结构和测试中可见：

1. 查找 previous Job，验证 operation/job type 可重试；
2. 验证 previous 状态为 `FAILED`；
3. 锁定 Task 并验证 `OPEN`；
4. 验证 previous 的旧 Generation snapshot；
5. 由 previous snapshot 与 retry 关系构造 canonical identity；
6. 以当前 key 执行 lookup；若命中则立即按身份 replay/conflict；
7. 只有未命中时才执行 latest-job 和当前 facts/product 等新建专用资格检查；
8. 创建候选 retry Job；若发生精确 idempotency 约束 race，按 5.1 的 rollback/requery/revalidate 流程恢复；
9. 新建成功后 commit 再 dispatch；replay 不 dispatch。

previous/FAILED/Task OPEN/旧 snapshot 属于“请求本身是否仍是合法 retry”校验，不能被 replay 跳过；latest/current facts/product 属于“是否可新建另一个 retry”校验，不能阻塞已存在的同 key replay。different key 查不到 winner，因此自然继续受后者约束。

### 5.3 HUMANIZE retryGenerationJob

保持已有顺序和恢复语义不变。若为了复用 classifier 调整私有 helper 名称，HUMANIZE caller 的精确约束 allowlist、rollback 顺序、winner 重验、active-source 映射和 HTTP 结果必须完全回归。

## 6. 并发模型

| 场景 | 仲裁机制 | 预期路径 | 结果 |
| --- | --- | --- | --- |
| 同 previous、同 key，顺序 retry | 普通 lookup | 第二次命中同身份 winner | 同 Job、`202`、一次 dispatch |
| 同 previous、不同 key | 无 lookup winner | latest/current 资格检查 | 不得绕过 latest-job 规则 |
| 同 Task、同 identity 并发 | Task 行锁 | 第二请求取得锁后普通 lookup | 一行 Job、一次 dispatch；不依赖 unique violation |
| 跨 Task、同 key、异 identity 并发 | PostgreSQL 全局唯一约束 | loser 精确约束后 rollback/requery | 一个 winner；loser `409 IDEMPOTENCY_CONFLICT` |
| create 受控同 identity sentinel | 无 current version 的 Task 上预置 winner，并只隐藏 insert 前唯一 lookup | 候选 insert 触发真实精确约束 | rollback 后 `202` replay；不代表正常同 Task race |

## 7. 错误与 HTTP 合同

已知跨 Task loser 使用既有业务错误：

```text
HTTP 409
code: IDEMPOTENCY_CONFLICT
message: 幂等键已用于另一生成请求
details: {}
```

通过真实 HTTP create/retry 请求验证响应体为 `ErrorEnvelope`，且 `ErrorEnvelope.request_id` 与 `X-Request-ID` 相同。不得在 service 内手工拼 envelope 或 request ID。

以下情况必须重新抛出同一个原始 `IntegrityError` 对象，并保持 unknown `500`：

- 非 `23505`；
- diagnostics 或 constraint name 缺失；
- 其他 constraint/index，包括 GENERATE 遇到 `uq_generation_jobs_active_humanization_source`；
- rollback 后 winner 缺失；
- winner identity 无法从持久化 snapshot 可靠重建；
- winner identity 与请求 identity 的比较无法完成。

对原始 GENERATE winner，`input_snapshot` 必须是映射，`platform_prompt` 必须是映射，并存在可解释的 `id` 与 `revision`。字段完整但值不同可证明异身份；字段缺失、结构损坏或类型不可解释属于不可验证，必须原抛。retry GENERATE 的 prompt identity 来自 previous/retry 关系并冻结为 `None`，其余 scalar identity 仍按持久化字段精确比较。该完整性检查只用于 exact-constraint rollback 恢复；普通 lookup 与 Humanization 行为不变。

unknown `500` 只验证现有状态和无副作用边界，不为未承诺的 body 文案建立新公开合同。

## 8. 事务、原子性和 dispatch

- `IntegrityError` 后必须 rollback 才能查询 winner。
- 失败候选事务中可能产生的 Job、ContentVersion、Task 指针/revision、ReviewRecord、AuditLog 必须一并回滚。
- replay 返回已提交 winner，不得再次写关联资源或 dispatch。
- `IDEMPOTENCY_CONFLICT` 与 unknown 重抛均不得 dispatch。
- 新建成功仍先 commit 后 dispatch；broker 异常不改变已经提交的 `PENDING` Job，现有补投递路径继续负责恢复。

## 9. 测试设计

### 9.1 单元测试

- GENERATE retry 的验证/lookup/latest/current 校验调用顺序。
- 第一次 retry 后同 previous + 同 key replay 与 different key 拒绝。
- 精确 diagnostics matrix：固定位置的 `23505 + 正确约束`、非 `23505`、缺 diagnostics、替代位置伪装 `23505`、其他约束、index/近似名称、active-source 约束。
- create/retry 的同身份 winner、异身份 winner、winner 缺失和 identity 无法验证；原始 GENERATE winner 具体覆盖缺失/损坏的 `platform_prompt.id` 与 `revision`，不只 mock matcher 异常。
- unknown 分支断言是原异常对象，且不 dispatch。
- 全量既有 Humanization 单元回归。

### 9.2 真实 PostgreSQL 集成测试

- 查询 current-head catalog，确认 `uq_generation_jobs_idempotency_key` 的实际 constraint 名称与 diagnostics。
- 对 create 与 GENERATE retry 两个入口分别构造两个独立 Session/connection、两个 Task、同 key、异 identity 的 race；使用同步屏障保证两个请求都到达各入口的最终竞争窗口，断言每组只有一个 winner 和一个精确 loser。
- 同 Task 正常并发断言 Task lock 串行，第二个请求普通 lookup replay；只保存一个 Job、dispatch 一次。
- `createGenerationJob` 受控同身份 exact-constraint sentinel：使用无 current version Task，先提交 winner，只对 insert 前唯一一次 lookup 定点隐藏，insert 触发真实约束，rollback 后恢复查询返回 winner；retry 的 exact-constraint 恢复由下述跨 Task race 证明。
- create/retry HTTP `ErrorEnvelope`、`request_id`/`X-Request-ID`。
- known/unknown 路径前后统计 Job、版本、指针/revision、review、audit、dispatch。
- Humanization create/retry/idempotency/active-source 现有真实 PostgreSQL回归。
- commit-before-dispatch、broker failure 保留 `PENDING` 和既有补投递测试继续通过。

并发测试不得用 mock 的 `IntegrityError` 替代真实 race；单元 diagnostics matrix 负责穷举分类边界，真实 PostgreSQL 测试负责证明约束名、事务恢复和并发行为。

## 10. 文档与零 diff

如私有 classifier 的稳定规则或 GENERATE coverage 需要同步，只更新 `.trellis/spec/backend/error-handling.md` 的对应段落。OpenAPI、数据库文档、router、generated client、frontend 和业务设计文档是零 diff 验证目标，因为本任务只兑现已批准的既有合同。

## 11. 停止条件

出现以下任一情况立即停止实现并报告：

- 需要新增公开 code/status 或改变错误 envelope；
- 需要修改数据库 schema、constraint/index 或 migration；
- 需要修改 router、OpenAPI、generated client 或 frontend；
- 需要改变 worker、dispatch/retry policy；
- 需要跨入 Content Task、Content Version review、Fact Version、publication/GEO owner；
- 当前实现无法用现有 `_GenerationJobIdentity` 验证 winner，且解决方案会引入新的公开或持久化 identity 合同。
