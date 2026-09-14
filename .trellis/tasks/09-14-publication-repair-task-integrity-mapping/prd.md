# Publication Repair source 完整性错误精确映射

## Goal

让 `createPublishedContentRepairTask` 在命中真实 PostgreSQL `23505 + uq_content_tasks_source_published_content_issue_id` 时，与现有业务预检查一致返回 `409 REPAIR_TASK_EXISTS`，并以数据库 catalog、并发竞争、HTTP ErrorEnvelope、unknown 500、事务原子性和 Session reuse 证明该边界。

## Requirements

- 只在 `create_repair_task` 的 Repair Task insert/flush owner 内增加精确诊断分类；禁止全局 handler、错误文本解析、宽泛 23505 或 constraint alias。
- 预检查与 exact unique loser复用同一 `REPAIR_TASK_EXISTS` code/message/status/details；`details={}`，不查询、返回或采用 winner，不自动 replay。
- 合规同 Issue请求继续依赖 Issue `FOR UPDATE` 串行；数据库 unique是绕过/未来不共享该锁 writer的最终权威。测试不得移除或削弱production lock/schema。
- exact mapper转 AppError前 rollback root transaction；同一 Session随后可查询。unknown原抛，由request Session owner rollback/close；direct service测试由调用者rollback。
- 保持 final-head `fk_content_tasks_published_issue ON DELETE SET NULL`：Article/Issue删除时Repair Task仅解绑source，state/revision不变；原Article来源ContentTask才恢复OPEN/CANCELLED、`revision+1`并保留`archived_at`。
- 保持event `clock_timestamp()` + `latest+1µs`、append-only/immutable history、删除transaction-local context、revision/state、AuditLog和GEO link原子性。
- unknown FK/CHECK/trigger/cross-table guard/其他constraint保持default 500，不返回`REVISION_CONFLICT`或`REPAIR_TASK_EXISTS`，不泄漏SQL、表、约束或driver message。
- 只修改本任务allowlist；OpenAPI、router/runtime metadata、ORM/migration、generated client和frontend保持不变。

## In Scope

- `backend/app/services/publication.py`
- `backend/tests/integration/test_publication_workflow.py`
- `backend/tests/integration/test_migrations.py`
- `contracts/database.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/backend/publication-workbench-guidelines.md`

## Out of Scope

- Publication Work、OPEN Issue、Verification/Article或GEO的其他constraint mapper。
- schema、migration、ORM、OpenAPI/status/details、runtime metadata、generated client、frontend变更。
- 建立共享constraint registry或改变publication lock/state/deletion/audit设计。
- 自动提交、push、归档父规划任务或启动后续T5-I2任务。

## Acceptance Criteria

- [x] 真实PostgreSQL catalog断言unique constraint名称准确；source FK同名、`confdeltype='n'`/定义含`ON DELETE SET NULL`，source列nullable。
- [x] 合规两Session同Issue竞争展示真实`FOR UPDATE`等待：恰一创建成功，另一路在winner commit后由precheck返回`REPAIR_TASK_EXISTS`；使用event/barrier、`pg_stat_activity`和有界timeout，不使用sleep。
- [x] test-only bypass writer触发真实`23505`且`diag.constraint_name=uq_content_tasks_source_published_content_issue_id`；loser得到与precheck除request ID外一致的domain response。
- [x] HTTP exact path返回409统一ErrorEnvelope，body request_id与响应`X-Request-ID`对账，`details={}`，不返回winner task。
- [x] 不同constraint、缺失diagnostics及trigger/guard sentinel均保持unknown 500，不泄漏数据库细节，不新增OpenAPI 500合同。
- [x] known rollback后同一Session可查询Issue/winner；unknown direct-service rollback后Session可用，HTTP dependency完成cleanup。
- [x] 失败无第二ContentTask、Issue revision/state、WorkEvent、Verification、Article、GEO source/link或SUCCESS AuditLog。
- [x] Article删除回归明确区分：Repair Task保留且仅source置NULL、state/revision不变；原Article来源ContentTask恢复OPEN/CANCELLED、revision+1且archived_at保留。
- [x] event time、append-only/immutable、删除事务和AuditLog既有测试不回归。
- [x] required validation全部通过；独立高风险只读review无未关闭material finding。
- [x] 实际diff仅包含allowlist；未吸收当前无关dirty files，未commit或push。

## Stop Conditions

- 真实catalog不是final-head定义：停止并另建`publication-repair-source-fk-catalog-alignment`，不得在本Task改schema。
- diagnostics不能精确识别目标constraint，或实现需要改变status/details/OpenAPI：停止并回到contract-first决策。
- 只能通过削弱production lock/schema制造竞态：停止，改用test-only barrier/bypass writer。
- 两轮repair/re-check后同一根因仍失败：停止并报告证据、尝试和当前状态。
