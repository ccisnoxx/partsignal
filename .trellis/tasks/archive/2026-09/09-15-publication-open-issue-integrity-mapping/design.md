# Design

## 1. Current-head evidence

当前 `open_published_content_issue` 的生产顺序为：按 `article_id` 取得
`PublishedArticle FOR UPDATE` → 读取该 Article 的全部 Issue → 检查 OPEN 与历史 RETIRED →
构造 OPEN Issue → 首次 `flush()` → canonical projection → `commit()`。

既有 precheck 已冻结：存在 OPEN，或任一历史 Issue 的 `resolution_outcome == "RETIRED"`，均返回
`409 PUBLISHED_CONTENT_ISSUE_CONFLICT`、消息`文章已有开放问题或已退役`、`details={}`。
current-head ORM/migration将 `uq_published_content_issues_one_open` 声明为
`published_article_id WHERE status = 'OPEN'` 的命名 partial unique index；RETIRED 由独立 INSERT
trigger保护，不属于该 partial unique 的语义。

OpenAPI 的 `openPublishedContentIssue` 已声明201与409，`ErrorDetail.code`是开放string、
`details`是object；router/runtime/generated frontend均已有该status。因此这是code-only、
status-preserving的数据库最终边界补齐，不需要公共wire修改。

## 2. Narrow mapper boundary

只在新增 Issue 后的首个 `db.flush()` 捕获 `IntegrityError`：

```text
Article FOR UPDATE -> OPEN/RETIRED precheck -> add OPEN Issue -> flush
                                                               |
           23505 + uq_published_content_issues_one_open --------+-> rollback -> existing conflict
           any other diagnostics -------------------------------+-> original raise

successful Issue flush -> projection -> commit
```

classifier只读取 `error.orig.sqlstate` 与 `error.orig.diag.constraint_name`。建议复用一个局部错误工厂
构造 precheck 与 exact path 的同一 tuple；不建立全局/shared registry，不读取`str(error)`、SQL、
params、driver message或备用constraint属性。

projection与commit保持catch之外。即使后续投影、flush、commit或unrelated deferred constraint给出
相同diagnostics，也不能被这个Issue INSERT mapper误分类。

## 3. Domain recovery semantics

1. 非 exact pair原样上抛，不先rollback或查询业务winner。
2. exact pair说明另一个OPEN Issue已成为数据库winner；command root先`rollback()`。
3. rollback后直接抛既有`PUBLISHED_CONTENT_ISSUE_CONFLICT`，不查询winner、不返回Issue、不replay。
4. known失败后的同一Session可以继续查询或执行健康command；unknown由外层Session owner清理。

OPEN与RETIRED虽然共享客户端错误tuple，但owner不同：OPEN既可由precheck也可由partial unique最终裁决；
RETIRED只能由现有precheck/INSERT trigger裁决，不能因共享code而归入unique mapper。RESTORED历史不满足
partial predicate或RETIRED guard，应继续允许新OPEN。

## 4. PostgreSQL catalog and diagnostics proof

在升级到current head的临时PostgreSQL中查询`pg_class/pg_index/pg_attribute/pg_constraint`以及
`pg_get_indexdef/pg_get_expr`，证明：

- index名称精确为`uq_published_content_issues_one_open`，归属表为
  `published_content_issues`且`indisunique=true`；
- 唯一key只包含`published_article_id`；
- predicate规范化后精确等价于`status = 'OPEN'`；
- 它是独立partial unique index，没有通过`conindid`关联的普通unique constraint row。

随后用真实INSERT制造两个OPEN Issue，捕获driver返回的`sqlstate=23505`与
`diag.constraint_name=uq_published_content_issues_one_open`。catalog文本、ORM和migration只说明预期，
不能替代真实diagnostics正例。

真实负例至少覆盖：PK/其他unique、Issue FK、Issue CHECK、RETIRED INSERT trigger；synthetic
classifier矩阵补充缺失diag、非字符串constraint、错误sqlstate、大小写/前后缀/alias。UPDATE/DELETE
guard、publication constraint trigger与catch外late failure用于证明作用域不扩张；不为测试新增schema
或trigger。

## 5. Compliant Article-lock concurrency

两个独立Session按production path打开同一Article的OPEN Issue：

1. winner执行Article `SELECT ... FOR UPDATE`并在该语句返回后由connection-local event暂停；
2. loser记录backend PID并执行同一command；
3. monitor在有界deadline内同时断言loser当前query是目标Article的`SELECT ... FOR UPDATE`、
   `wait_event_type='Lock'`且`pg_blocking_pids(loser)`包含winner PID；
4. 连接事件证明loser等待期间没有发送`INSERT INTO published_content_issues`，classifier也未被调用；
5. 释放winner，winner提交一个Issue；loser取得锁后读取已提交Issue，由precheck返回同一tuple；
6. 最终只有一个OPEN Issue。

所有`Event.wait`、monitor loop和future result均使用显式timeout，并在`finally`释放barrier、移除listener。
不使用`sleep`或“future尚未完成”代替数据库等待证据。既有通用`_wait_for_pg_lock`只证明任意Lock，
本场景需要更精确的query与blocker断言。

## 6. Test-only partial-unique race

为证明数据库最终权威，两个参与Session均使用测试进程内、connection/session-scoped的最小旁路：

- Article读取仍执行相同存在性判断，但仅移除这两个测试连接上的`FOR UPDATE`；
- 两边Issue precheck在首个INSERT前由barrier同步并隐藏现有Issue；
- 真实Issue INSERT、Article/opened_by FK、CHECK、INSERT trigger与partial unique index全部保留；
- production helper、锁顺序、schema和迁移完全不改。

winner完成Issue INSERT flush但尚未commit时暂停；loser随后发送真实Issue INSERT。monitor必须在有界时间
内证明loser当前query是`INSERT INTO published_content_issues`、正在等待Lock、blocker包含winner PID；
然后释放winner提交。loser必须捕获真实exact pair，known mapper rollback并返回同义409。独立verify
Session最后证明恰一OPEN Issue。

若无法把等待点与目标INSERT唯一性裁决区分，测试不算通过；不得把Article FK锁、任意advisory/row lock、
synthetic IntegrityError或已提交winner后的顺序duplicate冒充真实race。

## 7. RETIRED and unknown boundaries

- 顺序precheck分别覆盖既有OPEN与历史RETIRED，冻结同一错误tuple；classifier在这两条precheck路径
  都不应被调用。
- RESTORED历史后再次open成功，证明partial predicate只覆盖当前OPEN。
- test-only仅隐藏RETIRED precheck后执行真实INSERT，数据库guard返回`23514`并保持unknown；它不能
  因业务message相近而映射目标code。
- 真实opened_by FK HTTP sentinel用于证明unknown request cleanup与no-leak；其他FK/CHECK/trigger和
  constraint trigger由真实直接写/late failure及synthetic classifier负矩阵共同覆盖。

unknown direct-service测试在捕获原异常后由调用者rollback，再证明Session可用；HTTP dependency在
异常路径rollback/close。unknown 500只断言status与敏感内容未泄漏，不断言固定文本、media type、
ErrorEnvelope或body request ID。

## 8. Failure atomicity and HTTP

建立Issue创建专用快照，至少记录：全部Issue identity/status/revision、OPEN数量、Repair Task/source、
Article identity/verification binding、PublicationWork status/revision、来源ContentTask
status/revision/current pointer、WorkEvent、Verification、GEO publication/citation/source以及SUCCESS
AuditLog数量。

单请求失败要求前后快照相等；并发场景先冻结winner Issue及其派生Article `OPEN_ISSUE`健康投影这一项
合法变化，再证明loser没有任何额外增量。
known rollback reuse必须在同一个失败Session上、不由测试额外rollback，直接查询winner并在另一健康Article
完成open command。

HTTP通过真实route/request dependency分别触发OPEN precheck、RETIRED precheck和exact mapper，逐字段
比较`code/message/details/request_id`并对账`X-Request-ID`。unknown HTTP用真实无关FK/trigger失败，
`TestClient(..., raise_server_exceptions=False)`只断言500与SQL、table、constraint、driver message、
traceback、目标业务code均不出现。

## 9. Contract/spec impact

- `contracts/database.md`：记录目标partial unique exact pair、Article lock/precheck、RETIRED owner、
  rollback/single-winner和unknown边界。
- `database-guidelines.md`：记录partial index catalog/diagnostics、精确Article wait、test-only INSERT wait
  与失败快照方法。
- `error-handling.md`：记录局部classifier、同义错误工厂、known root rollback、unknown/no-leak与catch范围。
- `publication-workbench-guidelines.md`：记录OPEN Issue的Article lock、partial unique最终权威、RETIRED和
  immutable/deletion/event不变量。
- OpenAPI、router、runtime response metadata、ORM/schema/migration、Frontend V2、generated client和
  frontend保持零差异。

若实现证据需要status、details或wire shape变化，停止本Task并按
OpenAPI → router/runtime/service → backend contract/runtime/integration → generated client → frontend
consumer/tests → database/design/spec的contract-first顺序另行决策。

## 10. Rollback boundary

planning阶段没有生产候选变更可回滚；触发停止条件时保留审计与规划工件，不运行`task.py start`。
实施获批后，只回退本Task implementation allowlist内可识别的候选改动；不回退T1、T5-I1、T5-I2、
T5-C基线、既有业务提交、用户dirty/staged文件或其他Task工件。catalog/schema不符时由独立migration
决策处理，不修改历史migration、不加入兼容alias。
