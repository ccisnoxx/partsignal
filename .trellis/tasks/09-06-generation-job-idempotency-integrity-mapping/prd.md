# Generation Job 幂等完整性映射

## 目标

在不改变公开 API、数据库合同、worker 行为和既有 Humanization 行为的前提下，完成 Content/Generation IntegrityError 合同决策后的第一个独立实现任务：

1. 修正 `GENERATE retryGenerationJob` 的幂等 lookup 顺序；
2. 将 `uq_generation_jobs_idempotency_key` 的精确 PostgreSQL race 合同扩展到 `createGenerationJob` 与 `GENERATE retryGenerationJob`；
3. 以真实 PostgreSQL 并发、HTTP 错误封装和原子性证据证明实现没有扩大错误映射边界。

## 上下文与依赖

- 父任务：`09-04-integrity-error-domain-mapping`，保持 `planning`。
- 规划依赖：`09-05-content-integrity-error-contract-decision`，保持 `planning`；其合同决策已由提交 `8d47363b` 固化。
- 既有 Humanization 修复由提交 `ded73ab5` 提供，本任务只能复用和回归，不得改变其语义。
- `contracts/openapi.yaml` 已为相关操作声明 `202`/`409`，`ErrorDetail.code` 为开放字符串；本任务不新增公开状态码、字段或 error code。

## 已确认的当前实现事实

- `_GenerationJobIdentity` 与 `_find_existing_generation_job` 已定义 Generation Job 幂等身份和“同 key 同身份复用、异身份冲突”的基础语义。
- `create_generation_job` 已持有 Task 行锁，但尚未捕获并精确恢复 idempotency 唯一约束 race。
- `retry_generation_job` 的 HUMANIZE 分支已在 latest-job 检查前完成旧快照验证、身份构造和幂等 lookup；GENERATE 分支仍在 latest-job 与当前事实/产品校验之后查询 key，导致成功重试后同 key 再试无法复用。
- Humanization 已按精确 PostgreSQL `sqlstate + constraint_name` 区分 idempotency 与 active-source 冲突，并在 caller 中 rollback 后重新验证 winner。
- 成功路径由 caller `commit` 后 dispatch；broker 失败时 Job 保持 `PENDING`，由现有补投递机制处理。

## 需求

### R1：冻结 GENERATE retry 校验和 lookup 顺序

`GENERATE retryGenerationJob` 必须依次完成：

1. previous Job 存在且操作合同允许重试；
2. previous Job 状态为 `FAILED`；
3. 对所属 Task 加锁并验证 Task 仍为 `OPEN`；
4. 验证旧 Generation snapshot 完整且合法；
5. 用旧 snapshot 构造 `_GenerationJobIdentity`；
6. 调用 `_find_existing_generation_job` 处理当前 key；
7. 仅在没有现有 winner 时，再验证 latest-job 以及当前事实、产品和其他新建资格，并创建 retry Job。

不得把 previous/FAILED/Task OPEN/旧 snapshot 的校验移到 lookup 之后，也不得让幂等 replay 依赖可能随时间变化的当前事实或产品状态。

### R2：顺序重试与同 Task 正常并发

- 第一次 GENERATE retry 成功后，以同一个 previous Job 和同一个 idempotency key 再次请求，必须返回同一 Job 和 `202`。
- 若 key 不同，则不得复用；仍必须经过 latest-job 与当前创建资格校验。
- 同一 Task 的两个并发 GENERATE 请求必须由 Task 行锁串行化。第一个创建并提交，第二个在取得锁后通过普通 lookup 复用同一 Job；正常路径不应触发唯一约束错误。

### R3：跨 Task PostgreSQL race

两个 Task 使用同一 idempotency key、但具有不同 `_GenerationJobIdentity` 时，真实 PostgreSQL 并发只能提交一个 winner。loser 必须返回：

- HTTP `409`；
- `code = IDEMPOTENCY_CONFLICT`；
- `message = 幂等键已用于另一生成请求`；
- `details = {}`；
- `ErrorEnvelope.request_id` 与响应头 `X-Request-ID` 完全一致。

该合同同时覆盖 `createGenerationJob` 和 `GENERATE retryGenerationJob` 的 race 恢复入口。

### R4：精确 IntegrityError 分类和恢复

- 可识别的 idempotency race 必须同时满足 PostgreSQL `sqlstate == 23505` 与 `constraint_name == uq_generation_jobs_idempotency_key`。
- classifier 只做精确分类，不执行 rollback、不查询 winner、不构造 HTTP 响应。
- caller 捕获可识别错误后必须先 rollback，再以同一 idempotency key 查询 winner；恢复查询必须先确认 winner 的 canonical identity 字段可验证，再使用请求原本构造的 `_GenerationJobIdentity` 比较。普通 pre-insert lookup 与 Humanization 的既有语义保持不变。
- winner 同身份时返回 winner；异身份时映射为上述 `409`。
- 非 `23505`、缺少 diagnostics、其他 constraint/index、rollback 后 winner 不存在、或 winner 身份无法被可靠重建/验证时，必须原样重新抛出捕获到的 `IntegrityError`，由现有边界表现为 unknown `500`。
- GENERATE 路径不得将 `uq_generation_jobs_active_humanization_source` 分类为可恢复的 GENERATE 冲突。

### R5：受控同身份 sentinel

集成测试必须在 `createGenerationJob` 入口包含一个受控 sentinel：使用没有 current content version 的 Task，预先提交同身份 winner，并只对候选 insert 前唯一一次常规 lookup 隐藏该 winner，使候选 insert 真实触发 `uq_generation_jobs_idempotency_key`；rollback 后恢复查询并返回 winner。该测试只证明“精确约束 + 同身份 winner”恢复，不得被描述为同 Task 正常并发模型。retry 入口的真实精确约束由跨 Task race 覆盖，不用这一预置 winner 技巧伪造正常 retry 时序。

### R6：Humanization 保持不变

必须回归 `createHumanizationJob` 与 `HUMANIZE retryGenerationJob` 的：

- 同 key 同身份复用；
- 同 key 异身份 idempotency `409`；
- `uq_generation_jobs_active_humanization_source` 的业务冲突；
- 精确 diagnostics、unknown 原抛与既有 HTTP 语义。

### R7：事务原子性和 dispatch 边界

可识别 loser 和 unknown 异常都不得泄漏本次候选写入或副作用，包括：

- `generation_jobs` 新行；
- `content_versions` 新行；
- Task 当前版本指针或 revision 变化；
- `content_review_records` 或 `audit_logs` 新行；
- broker dispatch。

成功路径继续只在提交数据库事务后 dispatch。dispatch 失败不得回滚已提交 Job，Job 保持 `PENDING` 并继续依赖现有补投递机制。

### R8：最小实现边界

允许修改：

- `backend/app/services/content_production.py`
- `backend/tests/unit/test_generation.py`
- `backend/tests/integration/test_generation_reliability.py`
- `.trellis/spec/backend/error-handling.md`（仅在实现使稳定规则需要补充时）

必须保持零 diff：

- `contracts/openapi.yaml`
- `contracts/database.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `backend/app/routers/production.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `frontend/src/shared/api/generated/schema.d.ts`
- `frontend/src/domains/content`

若实现需要修改公开 API/数据库合同、引入新 error code 或状态码、改变权限/状态机、跨越 Content/Generation owner，必须停止并重新规划。

## 非目标

- 不修改 worker、Celery/Redis 拓扑、provider 调用或补投递策略。
- 不修改 Generation snapshot、prompt/config revision 或模型解析合同。
- 不修改数据库 schema、索引、约束或迁移。
- 不修改 Content Version、审核、发布/GEO、权限或 Task 状态机。
- 不为其他表建立全局 IntegrityError registry、通用事务 runner 或兼容性 fallback。

## 验收标准

- [ ] AC1：GENERATE retry 严格按 R1 顺序执行，旧 snapshot 验证和身份构造位于幂等 lookup 前，latest-job/当前事实/产品校验位于 lookup 后。
- [ ] AC2：第一次 GENERATE retry 成功后，同 previous + 同 key 的顺序重试返回同一 Job 和 `202`，不创建第二行也不重复 dispatch。
- [ ] AC3：同 previous + 不同 key 不复用，仍受 latest-job 和当前创建资格约束。
- [ ] AC4：同 Task 正常并发由 Task 行锁串行，第二个请求经普通 lookup 复用；真实测试证明只产生一个 Job 和一次 dispatch。
- [ ] AC5：跨 Task、同 key、异身份的真实 PostgreSQL race 只有一个 winner，loser 精确返回 R3 的 `409` 合同。
- [ ] AC6：`createGenerationJob` 和 GENERATE `retryGenerationJob` 都有 HTTP 级 `ErrorEnvelope` 证据，且 `request_id == X-Request-ID`。
- [ ] AC7：classifier 仅接受 `23505 + uq_generation_jobs_idempotency_key`，单元矩阵覆盖非 `23505`、缺 diagnostics、其他约束/索引和 active-humanization 约束。
- [ ] AC8：识别 race 后 caller 先 rollback 再查询；恢复入口在比较前验证 winner canonical identity 完整性。winner 同身份复用，身份字段完整且可证明不同时返回 `409`；winner 缺失、原始 GENERATE winner 缺失/损坏 `input_snapshot.platform_prompt.id` 或 `revision`、或其他 identity 无法验证时，原样重新抛出最初的 `IntegrityError`。
- [ ] AC9：`createGenerationJob` 的受控同身份 sentinel 通过真实 PostgreSQL 精确约束进入恢复路径并返回 winner，同时测试命名和说明明确它不是同 Task 正常并发；retry 的真实 exact-constraint 路径由跨 Task race 单独证明。
- [ ] AC10：GENERATE 不会把 `uq_generation_jobs_active_humanization_source` 映射为已知冲突。
- [ ] AC11：Humanization create/retry 的幂等复用、异身份冲突、active-source 冲突和 unknown 路径全部回归通过。
- [ ] AC12：已知 loser 与 unknown 异常均无 Job、Content Version、Task 指针/revision、审核、审计或 dispatch 泄漏。
- [ ] AC13：成功路径仍是 commit-before-dispatch；broker 失败后 Job 保持 `PENDING`，现有补投递行为不变。
- [ ] AC14：用户指定的 targeted pytest、合同测试、Ruff、mypy、`git diff --check` 全部通过；若未运行可选 backend 全套，交付说明替代证据和剩余风险。
- [ ] AC15：仅允许范围出现任务相关 diff，所有公开合同、数据库文档、前端、router、部署和 worker 文件保持零 diff。

## 开放问题

无合同或实现方向上的开放问题。开始实现前仍需用户在后续消息中明确批准；在此之前任务保持 `planning`。
