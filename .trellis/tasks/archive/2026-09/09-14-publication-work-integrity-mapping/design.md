# Design

## 1. Current-head evidence

当前 `create_publication_work` 的顺序为：request-key advisory lock、同key precheck、读取平台与content hash、platform/hash advisory lock、Platform/Account行锁、ContentTask行锁、identity precheck、新建Work并flush、追加`CREATED` event、统一flush/projection/commit。

已确认的漂移是 `_ensure_unique_identity` 仍以 `content_version_id` 预查，而current-head ORM/数据库合同已经以 `content_task_id` 作为稳定Work identity。实现只把该预检切换为`content_task_id`，不改变同平台active hash预检、锁顺序或错误tuple。

OpenAPI的`createPublicationWork`已经声明201和409；`ErrorDetail.code`是开放string、`details`是object，router/runtime/generated frontend也已覆盖409。因此本任务是code-only、status-preserving变更，不需要公共wire修改。

## 2. Narrow mapper boundary

只在Work insert的首个`db.flush()`捕获`IntegrityError`：

```text
locks + eligibility + prechecks -> add PublicationWork -> flush
                                                     |
                    23505 + one of 3 exact names ----+--> rollback -> deterministic recovery
                    anything else -------------------+--> original raise

successful Work flush -> append CREATED event -> existing finish/projection/commit
```

mapper不包围`_work_event`或`_finish_work_command`。这样WorkEvent、Verification、Article、Attachment、AuditLog、FK/CHECK/trigger/guard异常不会因靠近该命令而被误分类。

分类只读取`error.orig.sqlstate`与`error.orig.diag.constraint_name`。可以用局部enum/literal表达三个获准名称，但不建立跨域registry，不读取`str(error)`、statement、params、driver message或备用constraint属性。

## 3. Recovery precedence

三个唯一约束可能在同一候选INSERT上同时成立，PostgreSQL最终报告其中一个。因此恢复不能简单按诊断名称直接选择业务code；它必须保留既有同key优先级：

1. 对非获准exact pair原样抛出。
2. 对获准pair先保存请求的`idempotency_key/content_version_id/platform_account_id`标量并rollback root transaction。
3. rollback后按`idempotency_key`查询已提交winner。
4. winner存在且两个请求identity字段都精确相等：返回`publication_work_out(db, winner)` canonical replay。
5. winner存在但任一字段不同：抛既有`IDEMPOTENCY_CONFLICT`，message为`幂等键已用于另一发布工作`，`details={}`。
6. winner不存在：原诊断为content-task或active platform/hash时，抛既有`PUBLICATION_IDENTITY_CONFLICT`，message为`该内容版本或同平台内容已存在发布工作`，`details={}`；原诊断为idempotency key时不能证明winner，原始`IntegrityError`保持unknown。
7. winner字段缺失到不能证明identity时不得猜测；保持unknown并触发既定停止边界。

刚提交的create race winner必为非终态且保留`platform_account_id`，因为非终态Work会阻断账号删除。终态Work账号删除后缺少历史account UUID snapshot是既有范围外缺口；本任务不通过label/identifier猜UUID，也不修改schema。

## 4. Precheck alignment

`_ensure_unique_identity`接收`content_task_id/platform_profile_id/content_hash`：

- 任一Work占用同`content_task_id`即返回既有`PUBLICATION_IDENTITY_CONFLICT`，与`uq_publication_works_content_task_id`一致；不再以`content_version_id`冒充稳定task identity。
- 任一非`CLOSED` Work占用同`platform_profile_id + content_hash`继续返回相同错误，与partial unique一致。
- 调用仍发生在现有Platform/Account及ContentTask锁之后；不提前查询、不改变advisory key或锁次序。

## 5. PostgreSQL and concurrency proof

### Catalog/diagnostics sentinel

在临时数据库升级到head后查询`pg_class/pg_index/pg_constraint/pg_get_indexdef/pg_get_expr`：

- idempotency与content-task为非deferrable unique constraints，分别绑定`idempotency_key`、`content_task_id`；
- active platform/hash是命名partial unique index，列为`platform_profile_id, content_hash`，predicate为`status <> 'CLOSED'`且没有`pg_constraint` row；
- 三种实际冲突分别捕获`sqlstate=23505`和精确`diag.constraint_name`。

若catalog或真实diagnostics不符，立即停止，不改model/migration或稳定spec来掩盖漂移。

### Compliant concurrency

- 同key同payload双Session：用event/barrier暂停winner并以`pg_stat_activity/pg_blocking_pids`有界确认loser等待request-key advisory lock；winner提交后loser返回同一canonical Work。
- 不同key同Work identity双Session：确认loser在既有platform/hash advisory及后续行锁序列后观察winner，由content-task/active precheck返回`PUBLICATION_IDENTITY_CONFLICT`；最终恰一Work。
- 不使用任意时长sleep作为并发正确性证据，不降低隔离级别，不移除production lock。

### Test-only bypass race

- 每个race只在测试进程内、只对参与该场景的Session使用monkeypatch：跳过对应advisory/precheck，并以无`FOR UPDATE`的等价读取替代`_lock_platform_account`与`_lock_approved_publication_context`。替代函数必须执行与production相同的存在性、active、approved/current/open和platform校验；真实Work INSERT、FK、CHECK、trigger与三个unique保持不变，production helper和锁顺序不修改。
- 用SQLAlchemy连接事件确认loser已经发出`INSERT INTO publication_works`，再从`pg_stat_activity.query`与`pg_blocking_pids`有界证明它正等待该INSERT的唯一性裁决；只观察到任意advisory/row lock不算真实unique race证据。barrier在winner首次Work flush后、`CREATED` event/commit前暂停，观察到loser INSERT等待后才释放winner提交。
- 用彼此独立的identity组合隔离idempotency、content-task和active platform/hash三个真实诊断；若同payload天然同时满足多个约束，断言恢复语义与实际返回的获准exact name一致，而不是假定数据库检查顺序。
- idempotency race分别覆盖同payload canonical replay与异payload `IDEMPOTENCY_CONFLICT`；另外两个race覆盖`PUBLICATION_IDENTITY_CONFLICT`。每个场景最后查询数据库证明恰一Work。

## 6. Failure atomicity and HTTP

每个场景使用统一快照，至少记录Work/CREATED event/Verification/Article/GEO关系与source/SUCCESS AuditLog数量，以及ContentTask的status、revision、current pointer。单请求失败以调用前后快照相等为准；并发场景先冻结“winner唯一合法增量”，再证明loser rollback后的最终快照与该winner基线相等，不能把winner新增的一条Work/CREATED event误报为loser副作用。

known HTTP测试通过真实route和request dependency触发exact mapper及precheck，对两个业务code逐字段比较ErrorEnvelope，并对账输入/body/header request ID。unknown HTTP使用真实无关FK等diagnostics，`TestClient(..., raise_server_exceptions=False)`只断言500和敏感字符串不出现，不冻结默认body。

synthetic负例只用于穷举classifier fail-closed：无关unique名、PASSED verification、Article、Attachment、FK/CHECK/trigger SQLSTATE、缺失diag及伪造的非diag alias都返回unknown；它们不替代三个目标的真实PostgreSQL正例。

## 7. Contract/spec impact

- `contracts/database.md`记录三个exact pair、precheck/DB authority、rollback后的幂等优先级、single winner与unknown边界。
- `database-guidelines.md`记录catalog/diagnostics和测试方法；`error-handling.md`记录局部mapper、replay/conflict优先级、cleanup/no-leak；`publication-workbench-guidelines.md`把Work identity修正为ContentTask并记录锁/事件不变量。
- OpenAPI、router、runtime metadata、schema/model/migration、generated client和frontend保持零差异。

## 8. Rollback boundary

若触发停止条件，只回退本任务implementation allowlist内的候选修改；不回退T1/T5-I1、父规划、既有业务提交、用户dirty/staged文件或其他任务工件。规划阶段不实施、不提交、不归档。
