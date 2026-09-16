# GEO Observation Successor Integrity Mapping

## Goal

本 Task 是 T5-C `publication-geo-integrity-error-contract-decision` 的 T5-I5，只完成一个可 review
目标：把 `createGeoObservation` 中“`supersedes_id` 已有 successor”的业务预检查，以及真实 PostgreSQL
`23505 + uq_geo_observations_supersedes_once`，统一为：

- HTTP `409`
- `code=GEO_OBSERVATION_HAS_SUCCESSOR`
- `message=该 GEO 观测已被纠正`
- `details={}`

本轮仅审计与规划。Task 保持 `planning`；未经用户评审后明确批准，不运行 `task.py start`，不修改生产代码、
测试、合同、数据库、generated client 或前端生产代码，不提交、不归档、不 push。

## Dependencies

- T1 unknown `IntegrityError` boundary 已由工作提交 `43c252da` 完成；不得恢复全局
  `IntegrityError` handler。
- T5-C 合同规划基线为 `771a5826`，继续保持 `planning`。
- T5-I1、T5-I2、T5-I3、T5-I4 已分别由工作提交 `62bb2360`、`a96f6df2`、`a5469871`、
  `d5487430` 完成并归档；只复用它们的 exact diagnostics、root rollback、真实并发、HTTP no-leak、
  Session reuse 与独立 review 方法。
- T5-I6 独立拥有其余 11 个 GEO context/chain producer；T6 独立拥有前端
  `GEO_OBSERVATION_HAS_SUCCESSOR` canonical-context stale 投影。本 Task 不提前实施两者。

## Requirements

### R1：错误语义与 wire 冻结

- `GeoObservation` 没有 `revision` 字段，create payload 也没有 `expected_revision`；successor winner 不是
  optimistic-lock 冲突，禁止继续使用 `REVISION_CONFLICT`。
- 现有 successor precheck 必须改为本 Task 的目标四元组；精确数据库冲突必须返回完全相同的
  status/code/message/details。目标冲突不是 replay，不返回或猜测 winner ID。
- `createGeoObservation` 已声明 409，`ErrorDetail.code` 是开放 string；不得改变 OpenAPI schema、operation
  status、router response metadata、request-ID middleware 或 generated client。

### R2：唯一允许的数据库分类

- 只有 `error.orig.sqlstate == "23505"` 且
  `error.orig.diag.constraint_name == "uq_geo_observations_supersedes_once"` 才是 known conflict。
- classifier 留在 `geo_observation.py` 的 command owner 内，只读上述结构化 diagnostics。不得解析
  `str(error)`、SQL、driver message、表名、前后缀、大小写变体、alias，或按宽泛 `23505` 分类。
- 其他 unique、FK、CHECK、NOT NULL、`23514/55000` trigger/guard、缺失或畸形 diagnostics、非 23505，
  以及 relation flush/commit 错误均原样失败，进入既有 unknown 500 边界。

### R3：current-head PostgreSQL 证据

- `uq_geo_observations_supersedes_once` 是 `geo_observations(supersedes_id)` 上、predicate 为
  `supersedes_id IS NOT NULL` 的独立 partial unique index，不是 `pg_constraint` UNIQUE row。
- 实施前必须在由真实 Alembic head 建立的隔离 PostgreSQL 16 数据库中，以 `pg_index`、`pg_class`、
  `pg_attribute`、`pg_get_indexdef` 和 `pg_get_expr(indpred, indrelid)` 证明：名称、表、唯一键列、predicate、
  `indisunique=true`、`indimmediate=true`、`indisvalid=true`、`indisready=true`、无 expression key、只有一个
  key column，且没有绑定的 `pg_constraint` row。
- 必须以真实重复 `INSERT INTO geo_observations` 证明 psycopg diagnostics 的 exact pair。迁移源码、ORM、
  synthetic exception 或预检查都不能替代该证据；本轮规划未运行数据库写入，不能把该 gate 记为已通过。

### R4：事务 owner 与 catch scope

- production 锁序保持：Product `FOR UPDATE` → eligible PublishedArticle 集合 `FOR UPDATE` → previous
  GeoObservation `FOR UPDATE` → successor precheck → root observation INSERT/flush → publication/attachment
  relation add → commit。
- catch 只包围新 root `GeoObservation` 的首次 `db.flush()`。target exact pair 命中后 command root 必须先
  `db.rollback()`，再构造领域错误；rollback 前不得查询 successor 或使用失败 Session。
- relation add、relation 隐式 flush 和 `commit()` 必须在 catch scope 外；不得通过扩大 catch 把关系/FK/trigger
  错误伪装成 successor conflict。
- known mapper 返回前 Session 已恢复，同一 Session 可继续查询并完成健康命令。unknown direct-service case
  由调用者显式 rollback 后证明同一 Session 可复用；HTTP dependency 继续负责 request rollback/close。

### R5：两条独立并发证据

- 合规路径使用两个独立 Session/connection 与同一 supersedes target。记录不同 backend PID，以第三监测连接、
  `pg_stat_activity`/`pg_blocking_pids` 和目标 SQL 证明 loser 等待既有 Product/Article/previous 行锁，尚未发出
  observation INSERT；winner commit 后 loser 走 precheck。该路径不得声称触发 23505。
- test-only race 只在参与测试的 Session/connection 局部旁路上述应用层 `FOR UPDATE` 串行与 successor
  precheck，保留真实业务输入、数据库 index、FK、CHECK、trigger、root INSERT、relation 写入和 commit。
  monitor 必须证明 loser 正等待真实 `INSERT INTO geo_observations` 的 transaction-id/unique 仲裁，且 blocker
  包含 winner PID；winner commit 后 loser 收到真实 exact diagnostics。
- 两条路径均使用有界 Event/barrier、statement timeout、monitor deadline 和 `finally` 清理；禁止 `sleep`、
  “future 尚未完成”、mock exception 或禁用 schema 防线充当数据库等待证据。
- 两条路径最终都恰有一个 successor；loser 的 status/code/message/details 与已提交 successor precheck 逐字段一致。

### R6：不可变历史与失败原子性

- predecessor、所有祖先、winner successor、其 `GeoObservationPublication`、
  `GeoObservationAttachment` 和关联 `FileRecord` 必须保持既有 append-only/immutable 合同。winner 导致 predecessor
  不再是 tail 是唯一允许的派生变化。
- loser/unknown 不得留下第二个 observation、孤立 publication/attachment relation、部分文件关联、citation、
  ContentTask、`ContentTaskGeoSource`、ContentVersion、ReviewRecord、generation job、PublicationWork/Article/Issue
  状态或 revision 变化，或任何 SUCCESS AuditLog。
- 当前 create command 不写成功 AuditLog；验收应证明零增量，不为本 Task 新增审计行为。

### R7：HTTP 与 no-leak

- 预检查和 exact path 都必须经真实 route 验证四字段 `ErrorEnvelope`，其中 `details={}`，body `request_id`
  与响应 `X-Request-ID`、合法入站 request ID 完全一致。
- unknown HTTP 500 只证明不泄漏 SQL、表名、constraint、driver message 或 traceback；不冻结默认 500 body、
  media type、code 或 ErrorEnvelope，也不向 OpenAPI 增加 500/default/5XX。

### R8：文档与前端边界

- 同步 `contracts/database.md`、Frontend V2 行为/验收文档及 backend/frontend 稳定 spec，记录 exact mapper、
  unknown、rollback、并发、stale recovery 与 release gate。
- 前端生产代码和测试保持零差异。T6 才把 `GEO_OBSERVATION_HAS_SUCCESSOR` 加入 correction page 的
  canonical-context stale code：保留草稿/evidence/request ID，只允许显式 reload，不自动 replay。
- T5-I5 server code 不得单独部署；继续遵守 T5-G → T6 的 release-atomic gate。

## In Scope

### Expected implementation allowlist

- `backend/app/services/geo_observation.py`
- `backend/tests/integration/test_geo_observation_correction.py`
- `contracts/database.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/state-management.md`

### Planning/bookkeeping allowlist

- `.trellis/tasks/09-16-geo-observation-successor-integrity-mapping/**`
- `.trellis/tasks/09-14-publication-geo-integrity-error-contract-decision/task.json`，仅 child 与 notes bookkeeping。

## Protected Owners / Out of Scope

- `frontend/**` 生产代码与测试、`contracts/openapi.yaml`、generated client。
- backend router/schema/runtime metadata/error handler、ORM、migration、数据库 schema。
- T5-I6 的其他 11 个 `REVISION_CONFLICT` producer、GEO deletion chain 逻辑、T6 frontend projection。
- 权限、候选集合、附件、发布关系、append-only/immutable、AuditLog 或删除生命周期的产品语义变化。
- 全局 constraint registry、第二套错误类型、shared transaction runner、兼容 alias 或模糊 fallback。
- 清理或吸收当前工作区其他任务的 dirty/staged 文件；禁止 `git add -A`、`git add .`、`commit -a`、stash、
  reset、checkout、clean。

## Acceptance Criteria

- [ ] AC1：current-head 隔离 PostgreSQL catalog 精确证明目标 partial unique index 的表、单列键、predicate、
  unique/immediate/valid/ready 属性、无 expression 和无 `pg_constraint` row；真实 duplicate INSERT 证明 exact
  `23505 + constraint_name`。
- [ ] AC2：生产 precheck 与 exact mapper 都返回 `409 GEO_OBSERVATION_HAS_SUCCESSOR / 该 GEO 观测已被纠正 / {}`，
  且没有 revision 语义或 winner replay。
- [ ] AC3：classifier 只接受 exact pair；其他 unique、FK、CHECK、NOT NULL、23514/55000、缺失/畸形 diagnostics
  与 catch-scope 外错误全部 fail closed。
- [ ] AC4：合规双 Session 用 backend PID、数据库等待与目标 SQL 证明 production lock 串行；winner commit 后
  loser 走 precheck，最终恰一 successor。
- [ ] AC5：test-only 双 Session race 保留全部数据库防线，以 backend PID、真实 observation INSERT 等待和 exact
  diagnostics 证明 unique 仲裁；loser 与 precheck 四元组完全一致。
- [ ] AC6：known mapper 先 root rollback；同一 Session 在测试额外 rollback 前可查询并完成健康命令。unknown
  direct-service 捕获原异常、由 caller rollback 后同一 Session 可复用。
- [ ] AC7：predecessor/祖先、winner、publication/attachment/file 逐字段保持不变量；loser/unknown 无第二 observation、
  孤立关系、部分文件关联、ContentTask/GEO source、publication 状态或 SUCCESS AuditLog 副作用。
- [ ] AC8：precheck/exact HTTP 409 的四字段 ErrorEnvelope、空 details 和 request-ID 对账精确；unknown HTTP 500
  不泄漏数据库细节且不冻结默认 body。
- [ ] AC9：OpenAPI、router/schema/runtime metadata、generated client 与 frontend 生产代码/测试零差异；T5-I6、
  deletion 和 T6 边界未进入本 Task。
- [ ] AC10：数据库合同、Frontend V2 05/08 与四份稳定 spec 同步；文档明确 T6 才实施前端保留草稿+显式 reload。
- [ ] AC11：required validation、allowlist diff-check、protected-owner baseline 对比和一次独立高风险只读 full review
  全部通过；如有 material finding，最多一次 targeted repair/re-check 与一次 targeted re-review。
- [ ] AC12：optional frontend probe 与 optional backend full suite 均保持非 required；若运行，准确记录结果与证据
  边界，backend full suite 同一 candidate 最多一次，未运行或环境阻断不用越界修复冒充通过。
- [ ] AC13：实际 diff 只包含 implementation allowlist、当前 Task 工件和父 child bookkeeping；现有无关 dirty/staged
  文件的 path status 与 diff fingerprint 不变。

## Stop Conditions

- 目标 index 的表、列、predicate、unique/immediate/valid/ready 属性或 diagnostics 与 current-head 规划不符。
- 无法通过 `23505 + exact constraint_name` 区分目标 index，或只能解析 message/使用宽泛 SQLSTATE。
- 必须修改 ORM/schema/migration、OpenAPI status/schema/details、router/runtime/generated client 或 frontend 生产代码。
- 必须削弱 production 锁、append-only guard、FK/CHECK/trigger、immutable relation 或猜测 successor winner。
- 合规锁路径、test-only real race 或监测只能以 sleep/mock/无界等待/禁用数据库防线完成。
- 工作范围进入 T5-I6 的其他 11 个 producer、删除链逻辑或 T6 frontend projection。
- 两轮与本任务根因相关的 repair/re-check 后仍失败，或唯一 targeted re-review 仍有 material finding。

## Convergence Pass

- 单一目标已收敛为一个 precheck code 替换和一个 command-local exact index mapper；没有 schema、wire shape 或
  frontend production 变化。
- partial unique index 的 catalog 证明方式、production lock 与 unique race 的证据分离、root rollback/catch scope、
  unknown 边界、Session reuse、原子性、HTTP/request ID、文档与 release gate 均可执行。
- 规划明确区分“迁移源码已证明设计意图”与“运行时 current-head PostgreSQL 尚待实施 preflight 证明”；后者是
  硬停止门禁，不以本轮只读审计冒充通过。
- 没有剩余会改变授权、错误 wire、数据生命周期或实现方向的实质未决事项；下一步只等待用户评审与明确实施批准。
