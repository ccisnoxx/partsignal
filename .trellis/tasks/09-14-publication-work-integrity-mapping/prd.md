# Publication Work 完整性错误精确映射

## Goal

让 `createPublicationWork` 对 current-head PostgreSQL 的三个精确唯一约束形成与既有 precheck/replay 完全一致的最终失败语义，并以真实 catalog/diagnostics、合规锁并发、test-only bypass race、HTTP ErrorEnvelope、unknown 500、事务原子性和 Session reuse 证明该边界。

## Dependencies

- T1 unknown `IntegrityError` boundary 已完成，工作提交 `43c252da`；本任务不得恢复全局 `IntegrityError` handler。
- T5-I1 `publication-repair-task-integrity-mapping` 已完成并归档，工作提交 `62bb2360`；复用其 exact diagnostics、root rollback、HTTP no-leak 与并发测试模式，不再次归档。
- 父规划 T5-C `publication-geo-integrity-error-contract-decision` 已冻结本任务的 code/constraint、事务和前后端边界；T5-C 与顶层 `integrity-error-domain-mapping` 均保持 `planning`。

## Requirements

- 只允许 `SQLSTATE 23505` 且 `error.orig.diag.constraint_name` 精确等于 `uq_publication_works_idempotency_key`、`uq_publication_works_content_task_id` 或 `uq_publication_works_active_platform_hash` 时进入 known mapper；不读取 driver message、SQL 文本或非 `diag` alias，不做模糊匹配。
- mapper 只包围 `create_publication_work` 新增 `PublicationWork` 后的首个 Work `flush()`；后续 event/projection/commit，以及 Verification、Article、Attachment、GEO 和删除路径不进入该 mapper。
- 保持幂等优先级：任一获准 exact constraint 竞争失败后先 rollback，再按请求 `idempotency_key` 查询已提交 winner。winner 的 `content_version_id` 与 `platform_account_id` 均与请求相同才返回 canonical replay；任一不同返回 `409 IDEMPOTENCY_CONFLICT`，沿用既有 message 与 `details={}`。
- exact `uq_publication_works_idempotency_key` 但 rollback 后没有 winner，或 winner 的持久身份不完整到不能证明请求身份时，原始 `IntegrityError` 保持 unknown；不得猜 winner、返回其他 Work 或补默认身份。
- exact content-task/active platform-hash 冲突在没有同 key winner时返回 `409 PUBLICATION_IDENTITY_CONFLICT`，完整复用既有 code/message/status/`details={}`。
- 把现有 identity precheck 从 `content_version_id` 对齐到 current-head 唯一身份 `content_task_id`；active `platform_profile_id + content_hash` precheck 保持。两项 precheck 与 exact mapper必须同义。
- 保持现有锁顺序：request-key advisory lock → 读取请求 identity → platform/hash advisory lock → Platform/Account 行锁 → ContentTask 行锁 → precheck → Work flush。不得为测试移除、交换或削弱 production lock。
- 合规并发和 test-only bypass PostgreSQL race都必须恰有一个 `PublicationWork`；同 key同 payload的loser采用canonical replay，同 key异payload返回`IDEMPOTENCY_CONFLICT`，content-task或active platform/hash loser返回`PUBLICATION_IDENTITY_CONFLICT`。
- known exact path rollback 后同一 Session 可继续查询；unknown由原异常路径及请求 Session owner rollback/close，不在 service 内改写为业务错误。
- 失败请求不得留下候选 Work、`CREATED` WorkEvent、ContentTask status/revision/current pointer变化、PublishedArticle、PublicationVerification、GEO link/source或 SUCCESS AuditLog。
- HTTP known 409 必须返回精确 `ErrorEnvelope` 四字段，`details={}`，且 body `request_id`、响应 `X-Request-ID` 和合法输入 request ID 对账。unknown HTTP 500只冻结status与不泄漏：不得出现SQL、表名、约束名、driver message或traceback；不冻结默认500 body/media type，也不把500加入OpenAPI。
- 保持 Publication event 的 PostgreSQL `clock_timestamp()` 与 `latest + 1µs` 单调性、append-only/immutable history、现有 lock/state/revision、删除 transaction-local context和审计原子性。
- OpenAPI、router、runtime metadata、ORM/schema/migration、generated client和frontend生产代码保持零差异。若证据要求新增wire字段/status/details shape，先停止并回到contract-first决策。

## In Scope

### Implementation allowlist

- `backend/app/services/publication.py`
- `backend/tests/integration/test_publication_workflow.py`
- `contracts/database.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/backend/publication-workbench-guidelines.md`

### Planning artifacts

- `.trellis/tasks/09-14-publication-work-integrity-mapping/**`
- `.trellis/tasks/09-14-publication-geo-integrity-error-contract-decision/task.json`，仅允许保留本 child 链接。

## Out of Scope

- T5-I3 的 OPEN Issue mapper、任何 GEO/T6 行为或前端 projection reconciliation。
- PASSED Verification、PublishedArticle、Attachment、其他 unique/FK/CHECK/NOT NULL/trigger/guard 的领域映射。
- ORM、schema、migration、OpenAPI、router、runtime metadata、generated client或frontend修改。
- 改变事件时间、锁顺序、append-only/immutable history、删除事务、状态机、revision或AuditLog设计。
- 建立全局/shared constraint registry，解析数据库错误文本，或把任何数据库约束映射成 `REVISION_CONFLICT`。

## Acceptance Criteria

- [ ] current-head PostgreSQL catalog证明三个唯一对象的名称、列和active predicate准确；三个真实冲突分别观测到`23505 + exact constraint_name`。
- [ ] precheck按`content_task_id`和active platform/hash判断，完整复用既有`PUBLICATION_IDENTITY_CONFLICT` tuple。
- [ ] mapper只接受三个exact pair；其他命名unique、PASSED verification、Article、Attachment、FK、CHECK、trigger/guard、缺失diagnostics和不稳定diagnostics全部fail closed并保留unknown 500，绝不成为`REVISION_CONFLICT`。
- [ ] 同key同`content_version_id/platform_account_id`在precheck和exact race都返回同一个canonical Work；同key异payload在两条路径都返回同义`IDEMPOTENCY_CONFLICT`。
- [ ] content-task identity与active platform/hash在precheck和exact race都返回同义`PUBLICATION_IDENTITY_CONFLICT`。
- [ ] 合规双Session并发真实展示advisory/row-lock等待与winner提交后收敛；test-only session-scoped bypass保留相同读取校验与真实INSERT/FK/CHECK/trigger/unique，以barrier和`pg_stat_activity`证明loser等待在目标Work INSERT，不用sleep、production删锁、schema改动或fixed-success mock；每种竞争最终恰一Work。
- [ ] known rollback后同一Session可读取winner和其他持久对象；unknown direct-service调用由测试显式rollback后可复用，HTTP dependency完成rollback/close。
- [ ] 所有loser与unknown失败的持久化快照证明：无候选Work、无`CREATED` event、无task state/revision/current pointer变化、无Article/Verification/GEO link/source和SUCCESS AuditLog。
- [ ] known 409的code/message/details/request ID/header与precheck完全对账；unknown 500不泄漏且未冻结非合同body。
- [ ] 既有publication event-time、工作流、不可变历史和删除事务测试不回归。
- [ ] required validation、allowlist `git diff --check`、OpenAPI/runtime/generated/frontend零差异检查全部通过；optional full suite最多运行一次并准确报告结果。
- [ ] 验证与review共享总计最多两轮与本任务根因相关的repair/re-check；完成一次独立高风险只读full review和最多一次targeted re-review，且无未关闭material finding。
- [ ] 实际diff仅包含实施allowlist与本任务Trellis工件；所有既有无关dirty/staged文件保持原样。

## Stop Conditions

- 任一目标约束不能由真实 PostgreSQL `23505 + diag.constraint_name` 精确区分。
- rollback 后winner identity不能由现有持久字段证明，且需要新增wire字段、持久identity owner、schema或migration；特别是不得把终态Work账号删除后的历史replay问题顺带扩进本mapper。
- 必须改变publication event-time、现有锁顺序、状态机、revision、删除事务或append-only/immutable边界。
- 实现必须修改ORM/schema/migration、OpenAPI/router/runtime metadata/generated client/frontend，或跨入T5-I3、GEO、T6范围。
- 两轮repair/re-check后同一根因仍失败；停止并报告证据、已尝试修复和剩余风险。
