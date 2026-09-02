# Research: Publication 事件时间顺序根因与权威归属

- Query: 调查 `test_publication_verification_final_authority_rejects_awaiting_switch_over_http` 的时间顺序失败，确认 PublicationWorkEvent 时间排序的真实 owner，并给出最小修复边界。
- Scope: mixed（仓库源码、历史提交、只读 PostgreSQL 诊断与 PostgreSQL 官方文档）
- Date: 2026-09-02

## Findings

### 1. 失败发生在 HTTP 请求之前，真正断点是跨时钟比较

失败测试在发起 FastAPI 请求前先建立两个 SQLAlchemy Session：

- `switch_db` 先执行 `select(func.now())`，得到长事务的开始时间，然后执行 `pg_sleep(0.001)`；
- 嵌套的 `register_db` 调用 `register_publication_result`，在同一 Work 上取得行锁、写入 `RESULT_REGISTERED` 事件并提交；
- 测试再按 `PublicationWorkEvent.created_at DESC, id DESC` 读取该事件，并断言 `switch_transaction_started_at < result_registered_event.created_at`；
- 只有这个断言之后才在约 1853 行创建 `TestClient` 并提交 HTTP 核验请求。

因此这不是 Wave 3 router metadata 或 HTTP response 差异。Wave 3 的 PostgreSQL 回归记录为 `3 passed / 1 failed`，唯一失败为该断言；观察到的值是 PostgreSQL `now()` `2026-09-02 07:54:18.175778+00`，而事件的 Python 生成时间为 `2026-09-02 07:54:18.164377+00`，相差约 11.401ms，事件时间反而早于较早开启的数据库事务时间。

测试本身验证的是有效的并发不变量：先开启但尚未取得 Work 锁的换版命令，不能让其后实际取得锁并提交的 `CONTENT_VERSION_CHANGED` 排在已经提交的 `RESULT_REGISTERED` 之前。测试的比较对象有问题在于它把数据库时钟与应用进程时钟直接比较，而不是测试在 HTTP 层失败。

### 2. `PublicationWorkEvent.created_at` 的当前写入 owner 是 `_work_event`

`backend/app/models/publication.py:149-171` 定义 `PublicationWorkEvent.created_at` 为非空、`server_default=func.now()` 的 timestamptz；迁移 `backend/alembic/versions/0034_publication_workflow_redesign.py:159-187` 与之对应，且没有为该表增加第二个序列/命令序号列。事件 UPDATE/DELETE 由 `publication_work_events_append_only` trigger 拒绝（同文件 `:591-596`），但没有数据库触发器替代应用层决定事件的业务时间。

当前 `_work_event`（`backend/app/services/publication.py:421-454`）是唯一的业务写入 helper：

1. 它先以 `max(created_at)` 读取当前 Work 最新事件；调用者已经在 `_lock_work`（`:457-463`）取得 Work 行锁；
2. 它以应用进程 `datetime.now(UTC)` 生成候选时间；
3. 若候选时间不晚于历史最大值，则加 1 微秒；
4. 显式把时间写入 `PublicationWorkEvent`，而不是依赖数据库默认值。

所有生产写路径都集中到该 helper：创建 Work（`publication.py:529-553`）、换版（`:556-604`）、准备信息更新（`:607-639`）、平台审核标记（`:642-662`）、结果登记/再登记（`:665-711`）、核验成功/失败（`:714-780`）和关闭（`:791-833`）。未发现另一个生产代码路径直接插入 `PublicationWorkEvent`；测试中存在为损坏/删除保护场景构造历史行的 fixture，但它们不是生产 writer。

### 3. 时钟语义证明当前候选时间源不满足跨 Session 合同

本地开发 PostgreSQL 的只读诊断（`partsignal-dev-postgres-1`，TimeZone 为 `UTC`）观察到：

- 同一事务内第一次查询：`now()` 与 `transaction_timestamp()` 相同；`statement_timestamp()` 与 `clock_timestamp()` 是当时的数据库实际时间；
- `pg_sleep(0.050)` 后，同一事务再次查询时 `now()`/`transaction_timestamp()` 仍保持第一次查询值，而 `statement_timestamp()` 与 `clock_timestamp()` 前进约 60ms；
- 该诊断中 Python 进程在第一次 SQL 查询前的 `datetime.now(timezone.utc)` 比 PostgreSQL 返回值早约 34ms，说明当前应用进程与数据库容器的墙上时钟并非同一可直接比较的时间源。

PostgreSQL 官方 [Date/Time Functions and Operators](https://www.postgresql.org/docs/current/functions-datetime.html) 明确规定：`now()` 是当前事务开始时间（等价于 `transaction_timestamp()`）；`statement_timestamp()` 是当前语句开始/收到命令的时间；`clock_timestamp()` 是函数调用瞬间的实际当前时间，并且在单个 SQL 语句内也会变化。由此可得：

- 依赖模型 `server_default=now()` 会复现旧问题：等待 Work 锁的长事务可能用更早的事务起点写出更早事件；
- 当前 `datetime.now(UTC)` 避开了 PostgreSQL 事务起点，但把事件时间交给了另一台主机的时钟，当前失败正是该跨主机偏差；
- `clock_timestamp()` 是同一 PostgreSQL 时间域内、在取得 Work 锁并读取历史事件之后的实际时间，适合作为持久化事件排序的候选 authority；`statement_timestamp()` 也属于数据库时间域，但表示语句接收时间而非调用瞬间，若 SQL/flush 路径发生延迟，其语义较弱。

### 4. 读取方一致地把 `created_at` 当作事件顺序 authority

没有读取方按 UUID 推断状态顺序；生产读取都显式使用时间排序：

- Work list 的 latest event 窗口按 `PublicationWorkEvent.created_at DESC, id DESC`（`backend/app/services/publication_queries.py:655-678`），并由 `_work_list_item` 把结果交给唯一的 `publication_work_actions` owner（`:381-436`）；
- Work detail、Workspace Context 与 PublishedArticle detail 的完整事件历史按 `created_at ASC, id ASC`（`publication_queries.py:440-478`, `:518-562`, `:823-843`），所以最新事件/时间线都依赖同一字段；
- 核验 command 在锁 Work 后也按 `created_at DESC, id DESC` 读取 latest event（`backend/app/services/publication.py:723-742`），并复用 `publication_work_actions`；
- Workbench 通过相关子查询按同样的 `created_at DESC, id DESC` 选最新 action（`backend/app/services/workbench.py:132-151`）；
- Product detail 与 Content Task detail 将 PublicationWorkEvent 的 `created_at` 作为跨域 activity 的 `timestamp`，再与其它事件按 `timestamp DESC` 统一展示（`backend/app/services/product_detail.py:112-157`、`backend/app/services/content_task_detail.py:147-176`）。

删除/归档聚合中的 `.order_by(PublicationWorkEvent.id)`（`publication.py:998-1004`, `:1219-1222`）只是锁定/删除行的确定性遍历，不是 read model 的时间排序 authority。`id` 是 UUID，不能替代事件时间。当前 `created_at` 也没有数据库命令序号约束，因此真正的顺序 invariant 必须由 `_work_event` 在 Work 锁内维护。

### 5. 历史修复意图支持“service writer 修复”，不支持弱化测试

归档提交 `4a7979e8 fix(publication): enforce verification authority after version switch`（2026-08-31）新增当前 `_work_event` 的 `max(created_at)` + 1 微秒逻辑，并同时新增本次失败测试。其 design/prd/research 明确记录：

- 同一 Work 的事件时间必须按 Work 锁内命令顺序严格单调；
- 不能依赖 PostgreSQL 事务起始时间 `now()`；
- 先开始、后取得 Work 锁的双 Session 回归用于冻结该顺序；
- Work list、Workspace、核验 command 都共享 `created_at DESC, id DESC`。

该提交的意图是修正“事务级 now 导致命令顺序倒置”，但实现选择 `datetime.now(UTC)` 只解决了数据库内部事务时间问题，没有解决应用与 PostgreSQL 时钟域分裂。最新失败表明事件时间的 authority 仍在 `_work_event`，而不是把断言删除或把测试改成只验证 HTTP status。

### 6. 推荐的最小方案与替代方案

推荐在 `_work_event` 这一唯一 writer 中，在 Work 锁已取得且读取 `latest_created_at` 之后，以同一数据库的 `clock_timestamp()` 取候选 `created_at`，继续保留已有 `latest_created_at + 1 microsecond` 下限。该变更只调整事件时间的来源，不改变 Work status、revision、结果字段、权限、事务提交边界、Verification/PublishedArticle 创建、错误代码或 response schema。它同时满足：

- 后取得锁的命令不会使用长事务的 `now()`；
- 事件时间与测试使用的 PostgreSQL 时间在同一时钟域；
- 数据库时钟回拨或同一微秒碰撞时，既有 max+1 微秒下限仍保证同一 Work 严格单调；
- 现有所有按 `created_at` 排序的读取方继续使用同一字段，无需第二排序系统。

替代方案及其边界：

1. 仅把测试改成比较 `RESULT_REGISTERED.created_at < CONTENT_VERSION_CHANGED.created_at`：如果不修 writer，应用时钟仍可能与数据库时间域漂移；若时序断言改弱，还会失去“先开事务后取锁”这一回归保护。不能作为唯一修复。
2. 改用 `statement_timestamp()`：比应用 `datetime.now` 可比较，但它代表语句接收时间，不是函数调用瞬间；可以作为经论证的数据库时钟方案，但不如 `clock_timestamp()` 直接表达事件写入时刻。
3. 继续使用 Python 时间并要求主机 NTP 同步：把业务顺序合同交给部署环境，不能保证多容器、多 worker 或测试环境，排除。
4. 新增数据库 sequence/单调整数或按 Work 增加 command-order 列：能表达顺序但会改变持久化 schema、migration、合同和所有读模型，远超本 bug 的最小边界；当前 Work 行锁与时间字段已经提供足够 owner。

### 7. 建议 touch set、验收与回滚边界

建议实现任务的最小生产 touch set 是：

- `backend/app/services/publication.py`：仅调整 `_work_event` 的候选时间源，删除不再使用的 `datetime`/`timedelta` import 仅在确认无其它调用后进行；该文件其余状态、权限、事务和错误路径不动。

建议测试 touch set 是：

- `backend/tests/integration/test_publication_workflow.py`：保留现有 `test_publication_verification_final_authority_rejects_awaiting_switch_over_http` 的真实双 Session、锁等待、HTTP/CSRF、409 与零副作用覆盖；若需增强诊断，可把时间断言明确为同一 PostgreSQL 时钟域的 `clock_timestamp()` 基线或保留现有事务起点比较，不得删除锁顺序场景。仅在现有断言仍不能清楚表达修复后的 invariant 时才改测试。

建议验收至少包括：

- 该失败测试在真实 PostgreSQL、应用与数据库容器环境通过；
- 既有失败核验→换版→再登记→成功闭环继续通过，且 `RESULT_REGISTERED`、`CONTENT_VERSION_CHANGED` 及后续事件按 `created_at ASC, id ASC` 展示；
- 创建、准备更新、平台审核、登记、核验失败/成功、关闭等所有 `_work_event` 调用路径仍写入非空且同 Work 严格递增时间；
- Work list、Workspace、PublishedArticle、Workbench、Product detail、Content Task detail 的 latest/timeline 投影仍选择正确事件；
- 既有权限、状态转换、revision、事务原子性、error-domain mapping 和 HTTP response 合同无差异；
- ruff/mypy、相关 PostgreSQL 集成测试和独立只读 Review 通过；不修改 OpenAPI、generated client、数据库 schema/migration 或 Wave 3 router 文件。

回滚边界为 `_work_event` 的局部候选时间源与必要测试断言；无需数据回填、迁移或破坏性操作。回滚不能恢复为“删除时序断言”或改变历史事件排序合同。若实施发现存在不经 Work 锁追加事件的生产路径，或者需要 schema/order sequence 才能保证顺序，应停止并重新规划，而不是扩大本独立 Task。

## Related Specs

- `.trellis/spec/backend/publication-workbench-guidelines.md:321-359`：换版后必须重新登记结果；同一 Work 事件时间必须按 Work 锁内命令顺序严格单调。
- `.trellis/spec/backend/publication-workbench-guidelines.md:108-135`、`:3` 相关读取合同：Work/Article read model 使用服务端排序事件并保持 PostgreSQL 为业务状态唯一来源。
- `.trellis/spec/backend/database-guidelines.md`：PostgreSQL 是业务状态 authority，事务与锁边界必须由服务端保持。
- `.trellis/spec/backend/quality-guidelines.md`：并发、跨层合同与真实 PostgreSQL 行为需要定向回归和独立 review。

## Historical References

- `.trellis/tasks/archive/2026-08/08-30-publication-verification-final-authority/prd.md`
- `.trellis/tasks/archive/2026-08/08-30-publication-verification-final-authority/design.md`
- `.trellis/tasks/archive/2026-08/08-30-publication-verification-final-authority/research/root-cause-and-boundary.md`
- `.trellis/tasks/archive/2026-08/08-30-publication-verification-final-authority/implement.md`
- Commit `4a7979e8`：首次引入 Work 锁内 max+1 微秒事件时间与该双 Session sentinel。

## Caveats / Not Found

- 未执行失败测试的第二次重跑，也未修改生产代码/测试；本研究只使用 Wave 3 已记录的失败输出、源码、历史提交和只读数据库时钟诊断。按失败归因规则，修复任务启动后再运行正式 sentinel。
- 当前 PostgreSQL 开发容器的 `docker exec date` 输出只显示到秒，不能作为微秒级时钟比较证据；微秒级证据来自同一连接的 SQL 函数结果与 Wave 3 失败值。
- 未发现生产代码绕过 `_work_event` 直接插入 PublicationWorkEvent，也未发现按 UUID 或数据库插入顺序替代 `created_at` 的 read owner。测试 fixture 的直接插入/按 id 遍历属于测试/删除准备，不是生产状态写入 authority。
- 研究结论推荐 `clock_timestamp()`，但实施前仍需确认项目 SQLAlchemy/PostgreSQL 版本对该无参函数的表达和返回类型无需额外 cast；若类型检查或最小集成 probe 发现约束，应停在同一 writer owner 内修正，不增加第二时间来源。
