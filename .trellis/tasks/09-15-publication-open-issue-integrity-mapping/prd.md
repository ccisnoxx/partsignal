# Publication OPEN Issue 完整性错误精确映射

## Goal

只让 `openPublishedContentIssue` 在命中真实 PostgreSQL
`23505 + uq_published_content_issues_one_open` 时，与既有业务预检查一致返回
`409 PUBLISHED_CONTENT_ISSUE_CONFLICT`，并以真实 catalog/diagnostics、Article 行锁并发、
test-only partial unique race、HTTP ErrorEnvelope、unknown 500、失败原子性和 Session reuse
证明该边界。

用户已批准最终规划，本 Task 已运行 `task.py start` 并进入 `in_progress`。当前实施、required
validation 与独立高风险只读 review 按本文件冻结边界推进；提交、归档和 push 仍未获授权。

## Dependencies

- T1 unknown `IntegrityError` boundary 已完成，工作提交 `43c252da`；本任务不得恢复全局
  `IntegrityError` handler。
- T5-I1 `publication-repair-task-integrity-mapping` 已完成并归档，工作提交 `62bb2360`；
  复用其 exact diagnostics、root rollback、HTTP no-leak 与并发测试方法，不修改其成果。
- T5-I2 `publication-work-integrity-mapping` 已完成并归档，工作提交 `a96f6df2`、归档提交
  `a3085df0`；复用其 partial unique catalog、bounded PostgreSQL wait 和 zero-diff 门禁方法。
- 父规划 T5-C `publication-geo-integrity-error-contract-decision` 的冻结基线为 `771a5826`；
  T5-C 与顶层 `integrity-error-domain-mapping` 均继续保持 `planning`。

## Requirements

- mapper 只接受 `error.orig.sqlstate == "23505"` 且
  `error.orig.diag.constraint_name == "uq_published_content_issues_one_open"`；不得读取或解析
  SQL、driver message、`str(error)`、备用 constraint 属性或 constraint alias。
- 只在 `open_published_content_issue` 新增 `PublishedContentIssue` 后的首次 Issue `flush()`
  捕获；projection、commit、Repair Task、Work、GEO、删除和其他 publication command 不进入
  mapper。
- OPEN precheck、RETIRED precheck 与 exact unique loser复用同一稳定 tuple：
  `409 / PUBLISHED_CONTENT_ISSUE_CONFLICT / 文章已有开放问题或已退役 / details={}`。
  exact path 不查询、返回或采用 winner，不自动 replay。
- 合规并发继续由 Article `FOR UPDATE` 串行：两个 Session 对同一 Article 打开 OPEN Issue，
  一个成功；另一个有界证明等待 winner，winner commit 后由既有 precheck返回同一领域错误。
  不使用 sleep，不移除、交换或削弱 production lock。
- test-only bypass race 只作用于参与场景的测试 Session：保留 Article 存在性校验、真实 Issue
  INSERT、FK/CHECK/trigger 和 partial unique，只去除制造数据库最终竞态所必需的 Article 行锁与
  Issue precheck。loser 必须真实等待目标 INSERT 的唯一性裁决并收到 exact pair，最终只有一个
  OPEN Issue。
- current-head PostgreSQL catalog 必须证明目标是 `published_content_issues` 上的命名 partial
  unique index，key 为 `published_article_id`，predicate 精确等价于 `status = 'OPEN'`，且不附着
  普通 `pg_constraint` unique row；真实 violation 必须证明 diagnostics 名称准确。
- RETIRED 语义继续由既有 precheck拥有；旁路 RETIRED precheck 后的真实 INSERT trigger
  `23514` 仍为 unknown。RESTORED 历史继续允许后续新 OPEN Issue。
- 其他 Issue UNIQUE/PK、CHECK、FK、NOT NULL、INSERT/UPDATE/DELETE trigger、其他
  publication constraint trigger、缺失/非字符串 diagnostics、错误 SQLSTATE 和其他 constraint
  均原样上抛；不得转成 `PUBLISHED_CONTENT_ISSUE_CONFLICT` 或 `REVISION_CONFLICT`。
- known exact path 在抛 `AppError` 前 rollback root transaction；同一 Session 无需测试补 rollback
  即可继续查询和执行后续健康 command。unknown direct-service case 由调用者显式 rollback，HTTP
  request dependency 负责 rollback/close。
- known HTTP 409 返回完整四字段 ErrorEnvelope；`details={}`，body `request_id`、响应
  `X-Request-ID` 和合法入站 request ID 精确对账。unknown HTTP 500 只冻结 status 与 no-leak，
  不冻结默认 body、media type、code 或 ErrorEnvelope。
- 失败不得留下第二个 Issue、Repair Task、Article identity/verification binding 变化、
  PublicationWork status/revision 变化、ContentTask status/revision/current pointer 变化、WorkEvent、
  Verification、GEO link/source 或 SUCCESS AuditLog。并发场景只允许 winner Issue 及由它派生的
  Article `OPEN_ISSUE` 健康投影这一项合法变化。
- 保持 Article lock、event time、append-only/immutable history、删除 transaction-local context、
  权限、状态机、revision 和 AuditLog owner不变。
- OpenAPI、router、runtime metadata、generated client、Frontend V2 文档和 frontend 生产/测试
  保持零差异。若证据要求改变 status、details 或 wire schema，立即停止并回到 contract-first
  决策。

## In Scope

### Implementation allowlist

- `backend/app/services/publication.py`
- `backend/tests/integration/test_publication_workflow.py`
- `contracts/database.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/backend/publication-workbench-guidelines.md`

### Planning artifacts

- `.trellis/tasks/09-15-publication-open-issue-integrity-mapping/**`
- `.trellis/tasks/09-14-publication-geo-integrity-error-contract-decision/task.json`，仅允许当前
  child bookkeeping 与 notes 更新。

## Out of Scope

- T5-I1 Repair Task、T5-I2 Publication Work、任何 GEO、T5-G 或 T6 前端投影行为。
- Verification、PublishedArticle、Attachment、其他 Issue constraint 的领域映射。
- ORM、schema、migration、OpenAPI、router、runtime metadata、generated client、Frontend V2 或
  frontend production/test 修改。
- 改变 Article lock、event time、append-only/immutable history、删除事务、权限、状态机、revision
  或 AuditLog 设计。
- 全局/shared constraint registry、错误文本解析、宽泛 23505 映射、winner 查询/replay，或把
  default 500 纳入公共 ErrorEnvelope 合同。

## Acceptance Criteria

- [x] current-head 真实 PostgreSQL catalog证明 index 名称、表、唯一性、key 和 OPEN predicate
  精确，且目标 partial index 没有对应普通 unique `pg_constraint` row。
- [x] 真实 partial unique violation返回
  `23505 + uq_published_content_issues_one_open`；mapper只接受该 exact pair且不解析错误文本。
- [x] 合规两个 Session 对同一 Article 的命令以有界 barrier/wait 证据证明 loser 等待 Article
  `FOR UPDATE`、等待期间未发 Issue INSERT；winner提交后 loser由precheck返回同义冲突，最终
  恰一 OPEN Issue。
- [x] test-only bypass race证明 loser 已发送 Issue INSERT并由winner阻塞，winner提交后真实收到
  exact diagnostics；真实 FK/CHECK/trigger/index保持生效，最终恰一 OPEN Issue。
- [x] 已有 OPEN、已有 RETIRED 与 exact mapper 的 code/message/status/details完全对账；RETIRED
  仍由precheck裁决，RESTORED后可重新打开，RETIRED trigger旁路保持unknown。
- [x] Issue PK/其他unique、CHECK、FK、NOT NULL、trigger、constraint trigger、缺失diagnostics、
  错误 SQLSTATE 和其他constraint全部fail closed，不转目标code或`REVISION_CONFLICT`。
- [x] known mapper先rollback且同一Session无需额外rollback即可查询winner并完成另一健康Issue
  command；unknown direct-service显式rollback后可复用，HTTP dependency完成cleanup。
- [x] known HTTP返回精确409 ErrorEnvelope，message为`文章已有开放问题或已退役`、
  `details={}`，body/header/入站request ID一致；unknown HTTP 500不泄漏SQL、表名、constraint、
  driver message或traceback，且不冻结default 500 body。
- [x] 所有loser/unknown失败的快照证明无第二Issue、Repair Task、Article identity/verification
  binding变化、Work状态/revision变化、task状态/revision/current pointer变化、event、verification、
  GEO link/source或SUCCESS AuditLog；并发结果只包含winner Issue及其派生健康投影这一合法变化。
- [x] Article lock、event time、append-only/immutable history、删除事务、权限、状态机、revision和
  AuditLog既有回归不变。
- [x] required validation、allowlist `git diff --check`、OpenAPI/runtime/generated/frontend零差异
  检查全部通过；optional full suite按一次性gate准确记录。
- [x] required checks后完成一次独立高风险只读full review；若有material finding，最多一次
  targeted repair/re-check与一次targeted re-review，最终无未关闭material finding。
- [x] 实际diff仅包含implementation allowlist与当前Task工件/父child bookkeeping；全部既有
  unrelated dirty/staged文件与preflight baseline一致。

以上验收已由本次执行记录、required gates 与独立只读 review 证据满足；勾选状态本身不替代这些原始证据。

## Stop Conditions

- normal Article lock等待不能通过有界数据库证据证明，或必须移除、换序、削弱production
  Article lock才能继续。
- current-head catalog不是已冻结的partial unique定义，真实diagnostics不能精确区分目标constraint，
  或只能靠解析错误文本分类。
- 必须修改ORM/schema/migration，或改变status、details、ErrorEnvelope/OpenAPI wire。
- 必须改变event time、append-only/immutable history、删除事务、权限、状态机、revision或AuditLog。
- 工作范围进入Repair Task、Publication Work、GEO、T5-G或T6/frontend projection。
- 两轮与本任务根因相关的repair/re-check后仍失败，或独立re-review仍有material finding；停止并报告
  当前证据、已尝试修复与剩余风险。

## Convergence Pass

- 单一目标、约束身份、业务错误tuple、transaction owner、normal lock与bypass race证据、unknown
  边界、失败原子性、wire零差异、allowlist、required/optional gate、停止和回滚条件均已闭合。
- 父研究中T1前的全局handler描述与“先保持unknown”是历史审计状态；当前权威以T1提交
  `43c252da`、T5-C冻结基线`771a5826`及本Task依赖为准。
- 父规划对Frontend V2同步的通用描述由本次更具体授权覆盖：T5-I3保持Frontend V2零差异；任何
  新恢复语义转入后续contract-first/T6决策，不在本Task扩张。
- 没有剩余会改变授权、wire、数据生命周期或实施方案的实质未决事项；下一步只在用户明确批准
  最终规划后运行`task.py start`。
