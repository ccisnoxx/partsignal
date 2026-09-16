# GEO Content Task 幂等 IntegrityError 映射

## Goal

只为 `createGeoOptimizationContentTask` 补齐真实 PostgreSQL
`23505 + uq_content_tasks_idempotency_key` 的精确 race recovery，并冻结 ordinary/GEO
双向 source-kind identity。正常 advisory-lock 串行、既有 GEO anomaly 复算、ordinary command owner、
公开 HTTP wire、数据库 schema 与前端行为均保持不变。

本 Task 的规划已由用户于 2026-09-16 明确批准，当前为 `in_progress`。实现仍严格受本 PRD 的
allowlist、protected owner、验证门禁与停止条件约束；提交、归档、push 和启动后续 Task 不在本次授权内。

## Dependencies

- T1 unknown `IntegrityError` boundary 已完成，工作提交 `43c252da`；本任务不得恢复全局
  `IntegrityError` handler。
- T5-C `publication-geo-integrity-error-contract-decision` 的冻结规划基线为 `771a5826`，继续保持
  `planning`。
- T5-I1、T5-I2、T5-I3 已分别由工作提交 `62bb2360`、`a96f6df2`、`a5469871` 完成；只复用其
  exact diagnostics、root rollback、并发、HTTP no-leak 与独立 review 方法，不修改其成果。
- ordinary `content-task-idempotency-integrity-mapping` 已完成并归档；其生产 owner
  `backend/app/services/content_planning.py` 已具备反向 GEO guard 与 exact race recovery，本任务只读回归。
- T5-I5 successor code、T5-I6 context/chain code 与 T6 frontend projection 均是后续独立任务，不得
  在本 Task 提前实施。

## Requirements

### R1：精确数据库分类

- 只有 `error.orig.sqlstate == "23505"` 且
  `error.orig.diag.constraint_name == "uq_content_tasks_idempotency_key"` 才是已知 race。
- classifier 留在 `geo_observation.py` 的 command owner 内，只读取上述固定结构化 diagnostics；不得读取
  `str(error)`、SQL、driver message、备用 constraint 属性、前后缀或 alias。
- 非目标 unique、FK、CHECK、NOT NULL、trigger、缺失/畸形 diagnostics、非 `23505` 及 catch scope
  外的 source flush/commit 错误均原样失败，不转为 `IDEMPOTENCY_CONFLICT` 或其他领域错误。

### R2：ordinary canonical identity

ordinary winner 只有在以下事实都可证明时成立：

1. `product_id`、`fact_version_id`、`platform_profile_id` 与 ordinary 请求一致；
2. 不存在 `ContentTaskGeoSource`。

完整 ordinary winner 与 GEO 请求共用同一 key 时，始终返回既有
`409 IDEMPOTENCY_CONFLICT`；ordinary 与 GEO 双方都不得 replay 对方。

### R3：GEO canonical identity

GEO winner 必须同时满足：

1. `ContentTask.product_id`、`fact_version_id`、`platform_profile_id` 与请求一致；
2. 存在该 task 的一对一 `ContentTaskGeoSource`；
3. `rule_code`、`date_from`、`date_to`、`published_article_id`、`query_topic_id`、
   `geo_platform` 全部与请求一致；
4. source 具有由 `rule_code` 决定的完整可证明形状：
   - `CONTENT_DECLINE | LONG_UNMENTIONED`：`published_article_id` 非空，
     `query_topic_id/geo_platform` 为空；
   - `QUESTION_COVERAGE_GAP`：`published_article_id` 为空，
     `query_topic_id/geo_platform` 非空。

`basis_snapshot`、`created_by`、actor、request ID 与创建时间不是幂等 identity。只有同 GEO kind 且上述
完整 identity 全等时才 canonical replay；identity 完整但任一字段不同均返回
`IDEMPOTENCY_CONFLICT`。

### R4：不可证明 winner fail closed

- exact race rollback 后 winner 不存在，或 `ContentTask` 必需 identity 缺失时，重新抛出最初的
  `IntegrityError`。
- winner task identity 完整且没有 GEO source 时，可明确证明是 ordinary winner，返回
  `IDEMPOTENCY_CONFLICT`。
- GEO source 存在但必要 identity 不完整时，重新抛出最初的 `IntegrityError`，不得猜测、补默认值或
  将历史 source 误判为不同 GEO identity。
- current-head `0037` 允许内容型 GEO source 在来源文章删除后由 FK `SET NULL`；该合法历史形状正是
  “source 存在但 identity 不可证明”的主要边界。
- 已提交 winner 的既有顺序 precheck 没有原始 `IntegrityError` 可重抛，保持当前语义：完整同 GEO
  identity replay，其余返回既有冲突；本 Task 的 unknown tri-state 仅用于 exact race recovery。

### R5：事务 owner 与 catch scope

- catch 只包围 `add_locked_content_task(...)` 触发的 ContentTask 首次 INSERT/flush；source add、source
  隐式 flush、projection 和 commit 不得纳入该 mapper。
- exact pair 命中后，GEO command root 必须先 `rollback()`，再按 key 查询已提交 winner并执行 R2–R4。
- task 与 `ContentTaskGeoSource` 继续同一 root transaction 提交；任何 source flush/commit 失败都必须
  回滚已 flush 的 task，不得留下 source-less GEO task。
- known recovery 后同一 Session 无需测试补 rollback 即可继续查询和执行健康命令；unknown
  direct-service case 由调用者显式 rollback 后证明 Session 可复用，HTTP request dependency负责 cleanup。

### R6：真实 PostgreSQL 与并发证据

- current-head catalog 必须证明目标约束属于 `content_tasks(idempotency_key)`、名称精确、非 deferrable，
  且真实 duplicate INSERT diagnostics 为目标 exact pair。
- 合规同 key GEO 请求继续由共享 advisory transaction lock 串行；用独立 Session/connection、指定 SQL、
  backend PID、`wait_event_type`/blocker 与有界 barrier/wait 证明 loser 等待并在 winner commit 后走 precheck。
- test-only bypass race 只绕过参与连接的幂等 precheck/advisory 协议，保留真实资格校验、production资源锁、
  task INSERT、FK/CHECK/trigger 和 unique。共享同一product/fact/platform的same GEO、source-only差异与
  ordinary/GEO跨kind场景，不虚构unique INSERT wait：在首次lookup后、production资源锁前增加仅测试连接可见的
  PostgreSQL advisory latch，证明worker在数据库等待；winner完整提交task/source后释放latch，worker继续执行
  全部production锁并在真实task INSERT收到exact diagnostics。
- 只有winner与loser不共享target资源的不同task identity场景，才要求loser在真实
  `INSERT INTO content_tasks`等待未提交winner并核对指定blocker PID。该场景单独证明unique仲裁等待；两类证据
  均不得削弱production `FOR UPDATE`或FK。
- 覆盖 ordinary 先提交、GEO 先提交、同 GEO identity、不同 GEO identity，以及 ordinary/GEO 双方绕过
  precheck 的 race 排列。ordinary loser + 完整GEO winner的双Session/数据库等待场景新增在允许修改的
  `test_geo_insights.py`中并调用unchanged ordinary service；既有`test_content_task_creation.py`只提供反向guard
  与真实diagnostics回归，不冒充并发等待证据。
- 所有 barrier/event/monitor/future/statement 与 lock timeout均有界，异常路径在 `finally` 释放；不使用
  `sleep` 或“future 尚未完成”替代 PostgreSQL 等待证据。

### R7：错误 wire 与 no-leak

- known conflict 继续返回：HTTP `409`、`code=IDEMPOTENCY_CONFLICT`、
  `message=幂等键已用于另一内容任务创建请求`、`details={}`。
- ErrorEnvelope 四字段完整，body `request_id` 与响应 `X-Request-ID` 及合法入站 request ID 对账。
- unknown HTTP 500 不泄漏 SQL、表名、constraint、driver message 或 traceback；不得新增 OpenAPI 500、
  冻结默认 500 body，或假定其为 ErrorEnvelope。

### R8：失败原子性

- loser 或 unknown 不得留下候选 ContentTask、额外 `ContentTaskGeoSource`、GEO relation、ContentVersion、
  ReviewRecord、AuditLog、revision/current pointer/status 变化或其他部分状态。
- canonical winner 的 task/source/basis snapshot、status、revision、current pointer 与关联历史保持不变；
  并发最终只有 winner 聚合。

### R9：合同和文档边界

- `contracts/database.md` 只补 GEO exact mapper、双向 source-kind identity 与事务仲裁事实。
- `.trellis/spec/backend/database-guidelines.md` 补 GEO command owner、tri-state winner revalidation、并发和
  原子性规则。
- `.trellis/spec/backend/error-handling.md` 补局部 exact classifier、catch scope、known rollback、unknown
  rethrow/no-leak 与 Session reuse。
- OpenAPI、router、schema、runtime metadata、generated client、Frontend V2 文档和 `frontend/**` 零行为差异。

## In Scope

### Expected implementation allowlist

- `backend/app/services/geo_observation.py`
- `backend/tests/integration/test_geo_insights.py`
- `contracts/database.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/error-handling.md`

### Planning/bookkeeping allowlist

- `.trellis/tasks/09-16-geo-content-task-idempotency-integrity-mapping/**`
- `.trellis/tasks/09-14-publication-geo-integrity-error-contract-decision/task.json`，仅 child 与 notes bookkeeping。

## Read-only regression / protected owners

- `backend/app/services/content_planning.py`
- `backend/tests/integration/test_content_task_creation.py`
- `backend/tests/integration/test_publication_workflow.py`
- `contracts/openapi.yaml`
- `backend/app/routers/observation.py`
- backend schema、runtime metadata、错误 handler 与 response projection
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- generated client、Frontend V2 与 `frontend/**`

## Out of Scope

- 修改 ordinary command owner、`add_locked_content_task`、跨领域 shared mapper/registry 或新通用抽象。
- 修改 ORM、schema、migration、约束、GEO source lifecycle、权限、状态机或 AuditLog owner。
- 新增/改变 HTTP status、error code、message、details、ErrorEnvelope 或请求/响应 schema。
- T5-I5 successor unique、T5-I6 context/chain code、T5-G 或 T6 frontend recovery。
- 修复 pytest 同名模块 collection mismatch、清理缓存、重命名/新增测试文件或越界修改测试配置。

## Acceptance Criteria

- [ ] AC1：真实 current-head catalog 与 duplicate INSERT 证明
  `23505 + uq_content_tasks_idempotency_key`，且目标是非 deferrable 单列 unique。
- [ ] AC2：顺序 ordinary→GEO、GEO→ordinary 双向同 key均为准确
  `IDEMPOTENCY_CONFLICT`，双方不 replay 对方。
- [ ] AC3：顺序 GEO 同 key、完整同 identity replay；task三字段或六个 source identity字段任一可证明
  不同均冲突。
- [ ] AC4：正常 GEO 并发由 advisory lock串行，数据库只有一个 task/source，且只执行一次 task INSERT。
- [ ] AC5：test-only真实 bypass race 覆盖同GEO identity、source-only差异、不同task identity与ordinary
  winner；共享资源场景以precheck后的PostgreSQL latch等待+winner完整提交证明顺序，不共享资源场景以目标INSERT
  wait证明unique仲裁，所有loser均收到真实exact diagnostics。
- [ ] AC6：ordinary loser + 完整GEO winner在`test_geo_insights.py`以独立Session和数据库等待证明反向race；
  ordinary command既有反向guard测试只读回归通过，生产实现与既有测试文件零差异。
- [ ] AC7：exact race 后先 root rollback再重查；同 GEO identity replay，完整异 identity/ordinary winner冲突，
  同一 Session 可继续查询与完成健康命令。
- [ ] AC8：winner missing、ContentTask identity不完整、GEO source必要字段不完整时重新抛出同一个原始
  `IntegrityError`；不得猜测或补默认值。
- [ ] AC9：非目标 unique、FK、CHECK、NOT NULL、trigger、缺失/畸形 diagnostics、非23505，以及 source
  flush/commit中的同名异常全部 fail closed。
- [ ] AC10：task/source同事务；known/unknown失败和所有loser均无 source-less task、额外source、GEO relation、
  AuditLog、revision/current pointer/status或其他部分状态，winner不可变。
- [ ] AC11：known HTTP 409 ErrorEnvelope、message、details与body/header request ID精确；unknown HTTP 500
  不泄漏敏感数据库信息且不冻结默认body。
- [ ] AC12：required validation、allowlist `git diff --check`、protected-owner零差异和一次独立高风险只读
  full review全部通过；如有material finding，最多一次targeted repair/re-check和一次targeted re-review。
- [ ] AC13：optional full backend suite同一candidate最多运行一次；若因已知两个同名
  `test_geo_insights.py` collection mismatch失败，准确归因且不清缓存、不改pytest配置、不越界修复或重跑。
- [ ] AC14：实际diff只包含implementation allowlist、当前Task工件与父child bookkeeping；所有既有无关
  dirty/staged文件保持preflight baseline。

## Stop Conditions

- 必须修改 ordinary `content_planning` service、`add_locked_content_task` 或普通测试生产语义。
- 必须引入跨领域 shared mapper/registry、新事务 runner或新的通用抽象。
- 必须修改 ORM/schema/migration、约束、source lifecycle，或无法由 current-head catalog证明目标结构。
- 真实 diagnostics 不能精确区分目标 pair，或只能依赖错误文本/alias/模糊 23505。
- 必须猜测不完整 winner/source identity，或必须把不可证明 source 当作 replay/conflict。
- 必须新增/改变 HTTP status、code、message、details、OpenAPI/runtime/generated/wire schema。
- 工作范围进入 T5-I5、T5-I6、T5-G 或 T6 frontend projection。
- 需要重命名/新增测试文件、改变pytest import mode、清缓存或修复既有 full-suite collection mismatch。
- 两轮与本任务根因相关的 repair/re-check 后仍失败，或 targeted re-review仍有material finding。

## Convergence Pass

- 单一可 review目标已收敛为 GEO owner 内的单个 exact constraint recovery；ordinary owner、schema与wire无改动。
- exact classifier、catch scope、root rollback、tri-state winner identity、双向 source-kind隔离、事务原子性、
  并发证据、HTTP/no-leak、Session reuse、allowlist与停止条件均可执行。
- current-head `0037` 的 article `SET NULL` 解释了不可证明历史source，不构成schema修复授权。
- 没有剩余会改变授权、wire、数据生命周期或实现方向的实质未决事项；下一步只等待用户评审与明确实施批准。
