# Research: IntegrityError 事务语义与全局 handler 责任

- Query: 审计 SQLAlchemy Session 在 IntegrityError 后的 failed state、flush/commit/savepoint/rollback 所有者、AuditLog/发布事件/revision 的原子性，以及未知 IntegrityError 应由统一 500 边界还是专用内部错误信封处理。
- Scope: mixed（内部代码、数据库合同、已安装 SQLAlchemy/psycopg 公共 API）
- Date: 2026-09-04

## Findings

### 1. 当前所有权与版本证据

- HTTP 数据库依赖由 `backend/app/db.py:27-29,31-40` 拥有：`SessionLocal` 是 `expire_on_commit=False` 的 SQLAlchemy `Session`，`get_db()` 为单请求创建 Session；正常返回不自动提交，异常时 `session.rollback()`，最后关闭 Session。因此业务 service 是 HTTP 命令的 commit owner，`get_db()` 只是异常清理兜底，不是统一 commit owner。
- 异步 worker 使用独立 owner：`backend/app/services/generation.py:339-342` 用 `SessionLocal()`，在状态推进、内容落库或失败状态写入处显式 commit/rollback（`generation.py:356-379,439-486`）；投递/回收任务使用 `SessionLocal.begin()` 的上下文事务（`generation_dispatch.py:68-87,90-133,136-159`），文件清理也分成声明提交和对象存储操作后的独立 `SessionLocal.begin()`（`file_records.py:257-288`）。这些路径不经过 FastAPI `integrity_error_handler`。
- 依赖版本：`backend/pyproject.toml:2-24` 约束 SQLAlchemy `>=2.0.36,<3`、psycopg `[binary] >=3.2,<4`；`backend/uv.lock:354-355,767-768,831-832,1084-1105` 解析到 FastAPI **0.139.0**、psycopg **3.3.4**、Pydantic **2.13.4**、SQLAlchemy **2.0.51**、Starlette **1.3.1**（本地 `backend/.venv` import metadata 同样为这些版本）。
- 本地安装包的公共 API 证据（`backend/.venv/lib/python3.12/site-packages/sqlalchemy/orm/session.py:4323` 起的 `Session.flush` docstring）明确：flush 在当前 transaction context 发 SQL；若发生错误，整个 transaction 被回滚。`Session.is_active` 的文档（同文件 `:4846-4867`）明确 flush 失败后会进入 partial rollback，必须显式调用 `Session.rollback()` 才能完全回滚并恢复 Session；继续查询/flush 会落入 `PendingRollbackError` 类 failed-state 行为。
- 同一安装包的 `Session.rollback` 文档位于 `session.py:1978-1997`：回滚 topmost database transaction，并丢弃仍在生效的 nested transactions；`Session.begin_nested`（`:1952-1976`）才是显式 SAVEPOINT；`Session.commit`（`:1999-2028`）会先 flush，再提交 outermost transaction，并释放 SAVEPOINT。`expire_all` 文档（`:3196-3222`）指出默认 rollback/commit 会使持久对象过期；`session.py:1098-1125,1344-1403` 的 `_restore_snapshot`/rollback 实现显示新增对象会被 expunge、删除恢复、脏属性恢复。
- psycopg 3.3.4 的公开 DBAPI 异常接口：`psycopg.errors.UniqueViolation`、`ForeignKeyViolation` 等继承 DBAPI error；异常对象公开 `sqlstate` 与 `diag`（本地 `backend/.venv/lib/python3.12/site-packages/psycopg/errors.py` 中 `Diagnostic` 类），`Diagnostic` 公开 `constraint_name`、`table_name`、`column_name`、`sqlstate` 等字段。现有代码使用的 `error.orig.diag.constraint_name` 和 `error.orig.sqlstate` 正是该结构化接口；不得退回 `str(error)`、`message_primary` 或数据库本地化文本。

### 2. 当前错误数据流与目标错误数据流

当前 HTTP 数据流：

```text
请求/参数校验
  -> FastAPI route + DbSession
  -> service 预检查、锁定、修改 ORM 对象/revision、append_audit 或追加事件
  -> db.flush()（需要拿到数据库生成 ID 或尽早发现约束）或 db.commit()（隐式 flush）
       ├─ 成功：commit；返回 response；request_context 写 X-Request-ID
       ├─ service 精确/半精确 catch：rollback；有时映射 AppError；AppError handler -> ErrorEnvelope
       └─ 未处理 IntegrityError：get_db() 的异常清理 rollback；随后
          main.py 注册的 integrity_error_handler -> 409 REVISION_CONFLICT
```

证据：全局注册在 `backend/app/main.py:17,21-28,259-262`；当前 handler 在 `backend/app/errors.py:76-78` 无条件返回 `AppError("REVISION_CONFLICT", "数据约束冲突", 409)`。`error_response()` 只把 AppError 放入既有信封（`errors.py:41-55`）。注意 handler 自身没有 Session 参数，也不负责 rollback；其事务安全依赖 `get_db()` 的生成器异常路径 `db.py:31-40`。worker 事务不走此边界。

建议目标数据流：

```text
请求/参数校验
  -> service command（唯一业务事务 owner）
  -> 先完成必要行锁/expected_revision 检查
  -> 在能识别约束的最窄 flush/savepoint 边界 catch IntegrityError
       ├─ 读取 error.orig.diag.constraint_name / error.orig.sqlstate
       ├─ 仅命中该 command 已声明的约束才 rollback（或回滚其 savepoint）并抛既有 AppError
       └─ 未命中：原样 re-raise；不做字符串解析、不猜 column/value、不构造 revision 冲突
  -> append_audit / event / revision 与业务写入留在同一 transaction
  -> commit；HTTP AppError 继续由 ErrorEnvelope owner 序列化
  -> 未知 IntegrityError 由数据库 Session owner rollback 后进入框架既有 500 boundary
```

这个目标保留三类失败的分界：

1. **真实 expected_revision 过期**：service 在行锁后比较领域对象的 `revision`，直接抛已有 `REVISION_CONFLICT`；它不是数据库 IntegrityError。例：`identity.py:444-449`、`publication.py:459-465`、`product_facts.py:436-440`、`platform_configuration.py:672-685`。
2. **已知约束竞态**：数据库最终唯一/FK 防线在 flush/commit 触发；仅当结构化诊断精确命中该 command 的约束 owner 时映射既有领域 code。数据库合同明确要求 platform type 的 `uq_platform_types_slug` 只映射 `PLATFORM_TYPE_SLUG_EXISTS`，未知 integrity failure 必须可见（`contracts/database.md:77`）。
3. **未知 IntegrityError**：可能是其他 UNIQUE、FK、CHECK、NOT NULL、触发器/迁移守卫或编程错误；必须显式失败，不得统一转成 409、成功或 `REVISION_CONFLICT`。

### 3. service 事务习惯完整盘点

以下是对 `backend/app/services/*.py` 中 `db.flush/commit/rollback/begin_nested` 的静态盘点（计数为调用行数，函数内重复 commit 分别计数）：

| Service | commit | flush | rollback | SAVEPOINT | 事务形态与证据 |
|---|---:|---:|---:|---:|---|
| `ai_configuration.py` | 16 | 2 | 0 | 0 | 创建 channel/model 在 append_audit 后 commit（`ai_configuration.py:461-508,680-715`）；Header、channel/model 修改也由 service commit（如 `:542-677,748-920`）；没有 IntegrityError catch，唯一/FK/CHECK 失败会逃逸到外层。 |
| `content_planning.py` | 5 | 3 | 1 | 0 | platform profile 在 flush catch 后 rollback（`content_planning.py:304-346`）；query topic 创建先 flush、审计再 commit（`:194-223`）；`add_locked_content_task` 只 flush（`:380-401`），`create_content_task` 可选 commit（`:404-443`），GEO 优化命令直接在同一事务追加来源快照并 commit（`geo_observation.py:2313-2334`）。 |
| `content_production.py` | 8 | 4 | 1 | 0 | `_create_job`/`_create_human_content` 只 flush（`content_production.py:369-387,668-690`）；命令提交并在提交后投递作业（`:398-437,487-516`）；自然化作业 catch 后 rollback 并按存在性推断（`:496-511`）。 |
| `file_records.py` | 5 | 0 | 0 | 0 | 上传意图和文件状态命令直接 commit（`file_records.py:90-105,130-167`）；后台清理另用 `SessionLocal.begin()`（`:257-288`），对象存储 I/O 与 DB 状态分离。 |
| `generation.py` | 6 | 1 | 1 | 0 | worker 状态先 commit（`:356-379`），内容版本/Job 成功写入 flush 后 commit（`:439-463`）；任意异常 rollback，重新读取 Job 写 FAILED 并 commit（`:473-486`）。这是 worker 的显式失败状态机制，不应由 HTTP 领域 handler 复用。 |
| `generation_dispatch.py` | 0（显式 `SessionLocal.begin`） | 0 | 0 | 0 | 投递、PENDING 恢复、租约回收使用 begin 上下文自动 commit/rollback（`generation_dispatch.py:68-87,90-159`）；投递诊断异常在已接受业务提交之后只记录日志并返回恢复结果。 |
| `geo_observation.py` | 3 | 2 | 0 | 0 | GEO 优化任务与来源快照同事务 commit（`geo_observation.py:2201-2334`）；观测创建先 flush 关联表再 commit（`:2459-2475`）；删除链逐节点 flush 后由命令 commit（`:2593-2646`）。 |
| `identity.py` | 9 | 2 | 1 | 0 | 创建用户 flush、审计、commit（`identity.py:399-428`）；用户删除 flush catch FK 后 rollback（`:597-649`）；bulk status 在一个事务逐项执行并最终一次 commit（`:557-594`）。合同明确任何数据库/编程/审计异常都应整批回滚（`contracts/database.md:75`）。 |
| `platform_configuration.py` | 10 | 6 | 3 | 0 | platform type 有独立窄 flush helper（`platform_configuration.py:390-424`）；Prompt create/update 在 flush 后 rollback 再查询名字（`:615-742`）；profile 更新/删除 flush 后 commit（`:849-986`）。 |
| `platform_logo_files.py` | 3 | 0 | 1 | 0 | 候选文件先 commit DB，再做对象存储 I/O；失败 helper rollback 后锁行标 FAILED 并另行 commit（`platform_logo_files.py:145-151,154-224`）。这不是 HTTP IntegrityError mapper。 |
| `product_facts.py` | 6 | 4 | 1 | 0 | 产品 create/update flush 后调用精确身份 mapper，再 append_audit/commit（`product_facts.py:395-485`）；事实草稿/审核版本也由同一 service commit（`:633-715`）。 |
| `publication.py` | 14 | 8 | 1 | 0 | PlatformAccount 有窄 flush helper（`publication.py:208-235,272-314`）；Work/事件、验证、成果、删除均在命令内 flush、投影/追加事件或审计后 commit（`:421-555,716-797,838-975,1170-1177,1436-1640`）。 |
| `review.py` | 2 | 1 | 0 | 0 | Fact review 与 Content review 修改 revision、追加 review record/审计后 commit；approve 的 supersede 先 flush（`review.py:300-337,340-412`）。 |
| 其余 query/policy/projection/config helper | 0 | 0 | 0 | 0 | 读模型/校验 helper 不直接持有写事务；唯一例外是上述被命令调用的 flush-only helper。 |

结论：项目没有任何 service 使用 `db.begin_nested()`、`SAVEPOINT` 或通用 transaction decorator。全局 rollback helper 不能假定所有调用者可丢弃整个当前 transaction，因为 `bulk_update_user_status` 明确要求原子整批，而 `create_content_task(commit=False)` / GEO 聚合命令展示了 helper 可能被嵌入更大事务的事实。mapper 必须由 command owner 决定是 root rollback 还是局部 savepoint rollback。

### 4. AuditLog、event、revision 原子性

- 唯一 AuditLog 写入 owner 是 `backend/app/audit.py:141-159`：`append_audit()` 调用 `db.add(_audit_record(entry))`，明确“在调用者当前业务事务内追加，不自行提交”。`_audit_record()` 先执行安全/白名单校验（`audit.py:72-138,141-154`），没有独立连接或独立 commit。代码中没有 service 直接 `AuditLog(...)` 写入；直接实例化只在 `audit.py:143`（迁移快照中的同名类 `migration_schema_v1.py:101` 不属于运行时 owner）。
- `AuditLog` 的数据库字段和约束位于 `backend/app/models/identity.py:69-112`：`business_module`、`outcome` 有 CHECK，actor FK 为 `ON DELETE SET NULL`，其余写入字段多为 NOT NULL。成功审计只能在 `AuditOutcome.SUCCESS`、保留 action 白名单、真实 actor 下写入（`audit.py:72-130`）；失败/未知数据库错误不能伪造成功审计。合同还规定 `audit_logs` 是唯一业务审计来源，失败创建 target_id 可空，读取方不得补 UUID（`contracts/database.md:203-207`）。
- 运行时约 39 个 `append_audit()` 调用均把 AuditLog 放入 service 当前 transaction；典型顺序是先业务对象/状态/revision 修改，再 append，再 commit：用户 `identity.py:471-531`、产品 `product_facts.py:459-485`、Prompt `platform_configuration.py:686-742`、发布 `_audit` `publication.py:120-145`。因此在 commit/flush 的完整性失败后，成功审计行随同 root transaction 回滚；不能出现“错误请求仍留下成功审计”的持久化结果，前提是异常路径不再次 commit。
- 发布状态事件也是同一 Session 的普通 ORM add：`publication.py:421-456` 的 `_work_event()` 写 `PublicationWorkEvent`，不提交；`create_publication_work` 先 flush Work、追加 `CREATED` event，再由 `_finish_work_command` flush、投影、commit（`publication.py:468-555`）。验证成功时同一个 transaction 同时写 verification、work/task 状态、revision、PublishedArticle、event 和成功审计（`publication.py:752-797`）。任何一项失败都应由 root rollback 丢弃整组，避免 revision 已推进而 event/审计缺失。
- review 记录同理：`review.py:308-320,386-410` 先修改版本状态/revision、add `FactReviewRecord`/`ContentReviewRecord`、必要时 append_audit，最终 commit；flush 或 commit 失败时不得保留部分审核记录。
- revision 是 ORM 对象属性的同事务普通 UPDATE，没有独立 revision 表或数据库自动递增 owner：产品 `product_facts.py:459-465`、用户 `identity.py:471-477,668-670`、发布 Work/task `publication.py:592-605,772-779,819-835`、内容 review `review.py:382-411`。rollback 会恢复数据库值并按 SQLAlchemy `_restore_snapshot` 处理内存对象；`expire_on_commit=False` 只影响 commit 后过期，不改变 rollback 的事务恢复语义。若调用方在 rollback 后继续使用对象，应重新读取/锁定，而不能信任失败前的内存 revision。
- 跨进程副作用不能由 DB rollback 逆转：生成命令是在 DB commit 后才 `_dispatch_job`（`content_production.py:433-436,512-515`）；平台 Logo 和文件清理则明确先提交状态、再做对象存储 I/O（`platform_logo_files.py:186-224`, `file_records.py:263-288`）。因此完整性错误的原子性范围是数据库业务状态、AuditLog、事件和 revision；队列/对象存储要继续沿现有“提交后投递/声明后外部 I/O”契约处理。

### 5. 9 个 service catch 的现状与边界

代码中 `IntegrityError` import 出现在 6 个 service，加上 `errors.py` 与 `main.py`；`except IntegrityError` 共 9 个 service 位置：

| Owner / HTTP operationId | 当前检测 | 当前 rollback / mapping | 判断 |
|---|---|---|---|
| `createProduct` / `updateProduct`（`routers/product_facts.py:108-125,157-178`） | `product_facts.py:47-72,405-408,466-469` 读取 `error.orig.diag.constraint_name == "uq_products_normalized_brand"` | helper rollback 后抛 `PRODUCT_ALREADY_EXISTS` 409，details.errors 定位 `body.part_number` 与 `body.brand` | **已有正确样例**。其真实 PostgreSQL integration 证据在 `tests/integration/test_publication_workflow.py:2872-2919`；更新已有记录/审计保留证据在 `tests/integration/test_product_detail.py:301-335`。应保留“只认 constraint_name、未知原抛”的形状。 |
| `createPlatformType` / `updatePlatformType`（`routers/configuration.py:361,383`；service 调用 `:370,393`） | `platform_configuration.py:401-408` 只认 `uq_platform_types_slug` | rollback 后抛 `PLATFORM_TYPE_SLUG_EXISTS` 409，details.errors 定位 `body.slug`（`:409-424`） | **已有正确样例**。合同明确同一约束及未知失败可见（`contracts/database.md:77`）；HTTP 集成断言在 `tests/integration/test_platform_types.py:193-205`。 |
| `createPlatformAccount` / `updatePlatformAccount`（`routers/publication.py:207,231,217-252`） | `publication.py:227-235` 只认 `uq_platform_accounts_profile_identifier_normalized` | rollback 后抛 `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` 409，details.errors 定位 `body.account_identifier`（`:208-224`） | **已有正确样例**。业务预检和真实唯一竞态共用 mapper，测试在 `tests/integration/test_platform_accounts.py:151-203`；合同在 `contracts/database.md:201`。 |
| `deleteUser`（`routers/identity.py:338-359`） | `identity.py:626-633` 以 `error.orig.sqlstate == "23503"` 识别 FK violation | 23503 rollback 后映射 `USER_IN_USE` 409；非 23503 原抛 | **已有正确样例但范围须保持 command-specific**。删除前锁目标、设置事务本地变量、flush FK，再写 user.deleted 审计（`identity.py:597-649`）；数据库合同明确 RESTRICT FK 失败映射 `USER_IN_USE`，审计 actor 置空触发器也在同一删除事务（`contracts/database.md:247-249`）。因为该命令唯一预期是删除用户，sqlstate 23503 可作为当前结构化边界；不要将 23503 全局映射为 USER_IN_USE。 |
| `createPlatformProfile`（`routers/planning.py:228-245`） | `content_planning.py:338-344` 捕获后先 rollback，再查询 `PlatformProfile.slug` | 只要 rollback 后能查到 slug 就抛 `PLATFORM_SLUG_EXISTS`，否则原抛 | **不满足精确诊断要求**：没有检查 constraint_name/sqlstate；任一 CHECK/FK/NOT NULL failure 在同事务中恰好能看到同 slug 时会被误报。应改为命名约束结构化映射，未知原抛；其余行为（Logo cleanup_after 在 `platform_logo_files.py:235-264` 修改后同事务）要求 mapper 不丢掉外层本应保留的写入。 |
| `createPlatformPrompt` / `updatePlatformPrompt`（`routers/configuration.py:503,539`；service 调用 `:513,550`） | `platform_configuration.py:631-637,699-713` 捕获后 rollback，再查询名字 | 查询到同名就 `PLATFORM_PROMPT_NAME_EXISTS` 409，否则原抛 | **不满足精确诊断要求**：应识别唯一约束的 `constraint_name`（模型 `configuration.py:59-77` 的 `name unique=True`，命名约定生成名需以已部署 DB/迁移为准），未知原抛。更新还会先改 Prompt/revision、后 append_audit/commit（`:686-742`），root rollback 可恢复这些修改；若未来被组合事务调用，不能无条件 root rollback。 |
| `createHumanizationJob`（`routers/production.py:247,260-268`） | `content_production.py:487-511` 捕获任何 IntegrityError，root rollback 后查幂等键 | 查到匹配 job 返回已有 job；不匹配抛 `IDEMPOTENCY_CONFLICT`；查不到则抛 `HUMANIZATION_ALREADY_ACTIVE` | **不满足精确诊断要求**：同一 `generation_jobs` 同时存在 idempotency 唯一键和 partial active-humanization unique index（`models/ai_generation.py:132-178,180-187`）。必须分别识别具体结构化 constraint/index 诊断；未知 CHECK/FK/NOT NULL 不能伪装为活动自然化或幂等冲突。 |

所有其他写入 service 没有本地 IntegrityError catch。例如 AI Header/Model 的 normalized/name 唯一约束与 CHECK 在 `models/ai_generation.py:71-107`，创建/更新只 append_audit 后 commit（`ai_configuration.py:542-677,680-715`）；内容版本的 `(task_id, version)`、`source_job_id`、approved/pending partial unique indexes 在 `models/content.py:91-115`，人工版本/审核写入在 `content_production.py:668-879`；发布 Work 的 idempotency/content_task 唯一约束及状态 CHECK 在 `models/publication.py:61-107`，Work/验证路径在 `publication.py:476-797`。这些未命中的错误目前会落入全局错误 handler，因而当前错误 code/status 仍可能是错误的 `409 REVISION_CONFLICT`。

### 6. rollback、savepoint 与业务状态丢失

- SQLAlchemy flush 失败不仅让失败语句失败：其公共文档和本地实现都表明当前 root transaction 已回滚/进入 partial rollback；在调用 `Session.rollback()` 前 Session 不能安全继续使用。因此“捕获后立刻读取数据库判断是哪条约束”必须先 rollback（当前多个 helper 已这么做），否则查询本身会再次失败。
- root rollback 的好处是保证当前 command 的业务行、审计、事件、revision 全部撤销；单请求命令当前通常没有此前待提交业务写入，因此产品、平台类型、账号、用户删除等 standalone command 的 rollback 不会丢失另一个命令的业务状态。对应成功/失败测试断言原记录仍存在且数量不增加：`test_publication_workflow.py:2910-2919`、`test_product_detail.py:332-335`、`test_platform_accounts.py:193-203`。
- root rollback 的风险是它会丢掉**调用者在同一 Session、同一 root transaction 中故意保留的更早写入**。数据库合同要求 `bulkUpdateUserStatus` 对预期 AppError 可逐项失败、但任何数据库/编程/审计异常整批回滚（`contracts/database.md:75`），所以这里不能用 savepoint 来保留前项成功；反之，若某个未来组合命令要求继续保留外层业务写入，应由外层 owner 明确 `with db.begin_nested()`，mapper 只回滚 nested transaction。
- 现有代码没有 SAVEPOINT owner，且 `Session.rollback()` 会 `_to_root=True` 丢弃全部 nested transactions（本地 `session.py:1978-1997`）。因此不应在通用异常 helper 内无条件调用 root rollback；最小安全接口应让 command owner 传入事务策略，或在 standalone command 自己 catch/rollback。若没有真实组合调用路径，不必预先引入共享 savepoint abstraction。
- `Session.begin_nested()` 本身会在建立 SAVEPOINT 之前无条件 flush 当前 Session 的 pending state；因此外层若希望保留既有写入，必须先显式验证并 flush 外层状态、确认 root transaction active，再进入 nested block 添加目标写入。若前置 flush 失败，异常发生在 SAVEPOINT 建立前，不能靠 nested rollback 保留外层状态，必须 root rollback。未来引入 savepoint 时，测试要同时覆盖“nested 目标失败后外层仍可提交”与“前置/unknown 失败整笔回滚”。
- 失败路径中必须避免 rollback 后继续使用未刷新对象：新增对象会被 expunge，删除对象恢复，dirty values 恢复；需要在错误响应中使用 request payload 的字段时使用已验证 request schema，而不是从 rollback 后 ORM 对象猜值。现有产品字段错误 details 是固定 request field names（`product_facts.py:53-72`），符合此边界。

### 7. 全局 handler 去留与公共合同证据

现有合同证据支持**删除专用 `integrity_error_handler`，让未知 IntegrityError 进入统一 500 boundary**：

- `backend/app/errors.py:41-73` 只有 `AppError` 与 `RequestValidationError` 的 ErrorEnvelope 序列化；`integrity_error_handler` 是唯一把任意 SQL 完整性错误硬编码成业务 409 的额外边界（`:76-78`）。
- `backend/app/main.py:259-262` 注册了 AppError、RequestValidationError 和 IntegrityError handler，但没有 `Exception`/500 自定义 handler（全文 `rg` 仅找到这三项）。删除 IntegrityError 注册后，未知错误应由 FastAPI/Starlette 默认 server-error boundary 处理为 500；数据库 Session 仍由 `get_db` 异常路径 rollback，日志保留 server-side exception，不向 wire 暴露 SQL/表名/约束文本。该 transport 行为应在实施 Task 用 HTTP sentinel 实测，不在规划阶段臆称已验证。
- `contracts/openapi.yaml:4162-4168` 的 `ErrorResponse` 定义是“业务或校验错误”，仅引用 `ErrorEnvelope`；`ErrorEnvelope/ErrorDetail` 在 `contracts/openapi.yaml:4191-4205` 只有通用 code/message/details/request_id，没有 `INTERNAL_ERROR`、`DATABASE_ERROR` 或 500 response 的现有 code/status 合同。全局运行时 OpenAPI 的 metadata helper 也只为 route 显式状态追加 ErrorEnvelope（`main.py:155-247`），不自动声明 500。
- 当前 OpenAPI 明确声明的是各 operation 的业务/校验 4xx（例如 `createUser` 409 在 `contracts/openapi.yaml:167-188`、产品路径业务 409 在 `:387-512`）；没有一个 operation 将未知数据库错误声明为 JSON ErrorEnvelope 500。为保留专用内部信封需要先发明稳定 code/status，再按 contract-first 顺序改 static OpenAPI、runtime metadata、generated client、backend contract tests 与所有错误 consumer，当前任务没有这类合同证据，不能猜测。
- `REVISION_CONFLICT` 的客户端恢复语义只适用于真实 revision mismatch。后端已有明确 stale checks（`identity.py:444-449`、`publication.py:459-465` 等），前端多处把 `REVISION_CONFLICT` 导向保留草稿/显式 reload（例如 `frontend/src/domains/content/content-editor-page.tsx:246-305`、`frontend/src/domains/geo/geo-observation-correction-page.tsx:79-82`）。全局 handler 当前将 FK/CHECK/NOT NULL/唯一竞态伪装为该 code，会错误触发恢复路径；移除后只有 service 明确抛的真实 revision AppError 才能进入该 consumer。

该决策不改变已存在的专用业务映射：它们仍由 service 在 flush 边界抛 AppError，继续走同一个 `ErrorEnvelope` owner；只把未知错误从错误的业务 409 还原为框架 500。若产品以后要求所有 500 都是 JSON，必须先建立明确的公共 `INTERNAL_ERROR` 合同和不泄露字段策略，不能在本 Task 直接增加。

### 8. 四个正确样例复核

1. **产品身份唯一约束**：模型 `Product` 的 `(normalized_brand, normalized_part_number)` 在 `product_facts.py:30-37`；命名 convention 生成并由合同确认 `uq_products_normalized_brand`。service 只匹配该 `diag.constraint_name`（`:47-52`），返回既有 `PRODUCT_ALREADY_EXISTS` + 两个字段 loc（`:53-72`），真实 PostgreSQL 等价 normalized 输入测试在 `tests/integration/test_publication_workflow.py:2872-2919`。正确。
2. **Platform Type slug 唯一约束**：运行时模型 `configuration.py:40-55` 的 `slug unique=True`，service helper 只匹配 `uq_platform_types_slug`（`platform_configuration.py:390-424`）；contract 直接要求该约束和未知 failure 可见（`contracts/database.md:77`），HTTP create/update 测试断言 code 与 `body.slug` loc（`tests/integration/test_platform_types.py:193-205`）。正确。
3. **Platform Account normalized identifier**：模型 `publication.py:31-50` 的唯一表达式索引名为 `uq_platform_accounts_profile_identifier_normalized`；service helper 只匹配该 `constraint_name`（`publication.py:227-235`），预检和真实竞态共用 field error（`:191-224`），测试在 `tests/integration/test_platform_accounts.py:151-203`，contract 在 `contracts/database.md:201`。正确。
4. **用户删除 FK**：`delete_user` 在锁定目标、业务引用预检查和事务本地 `partsignal.user_delete_id` 后执行 delete/flush（`identity.py:597-628`）；只认结构化 `sqlstate == "23503"`，非 23503 原抛（`:629-633`），并在成功 flush 后才追加 user.deleted 审计并 commit（`:635-649`）。合同要求 RESTRICT FK 映射 USER_IN_USE、保留历史审计并只允许级联 actor 置空（`contracts/database.md:247-249`），integration 断言 details.references（`tests/integration/test_identity_management.py:675-684`）。正确，但 sqlstate 识别必须继续限定在该 delete command，不得在全局 handler 泛化。

### 9. 最小共享 helper 是否必要

目前证据不支持创建通用 registry、插件、策略框架或第二套错误类型系统：

- 四个正确样例的领域 code、消息和 `details.errors[].loc` 均不同；用户删除是 FK/sqlstate 且 details 结构不同，平台/产品是 constraint_name。把它们合成一个“所有 IntegrityError -> code” helper 会重新制造全局误分类。
- 可复用的最小逻辑只有“安全读取 `error.orig.diag.constraint_name` / `error.orig.sqlstate`，未知返回未命中”的无业务副作用诊断读取；但 Python `getattr(getattr(...))` 现有写法已很窄，新增 helper 只有在后续多个 service 真实重复且能让每个 owner 显式提供 allowlist 时才有价值。
- rollback/savepoint 不能放进一个无上下文 helper：standalone command 需要 root rollback；组合事务或未来批处理可能需要 nested rollback；bulk users 明确要求全批 root rollback。把 rollback 固定在 helper 会产生业务状态丢失或错误保留。
- 推荐实现方向是“每个稳定 service/domain owner 保持显式 mapper；最多抽一个不解析文本的诊断访问小函数”。实施顺序先以独立 T1 移除全局 handler、恢复 unknown 默认 500，再分 owner 修正当前 3 个按回滚后查询误分类的路径；不要按异常类型或文件数量机械合并。

### 10. 建议实施拆分与验证重点（供主任务设计采用）

推荐第一个实施 Task：**unknown IntegrityError boundary correction**，精确边界为 `backend/app/errors.py`、`backend/app/main.py`、`backend/tests/integration/test_ai_channel_management.py`、`backend/tests/unit/test_runtime_response_metadata.py` 和 `.trellis/spec/backend/error-handling.md`。它只移除全局 409 伪装并增加 unknown 500 sentinel；service-owned known mapping 留给后续 configuration、identity、content、publication/GEO Task。

实施顺序：

1. T1 删除 `errors.py` 的 IntegrityError import/handler 与 `main.py` 的注册；加一个真实 DB HTTP sentinel 证明未知约束不返回 `REVISION_CONFLICT`、不泄露 SQL/constraint、服务端得到默认 500；默认 TestClient 若抛 server exception，应用生产配置/transport 层验证 status，而不是修改 handler 生成固定 JSON 500。
2. 后续 owner Task 保留并测试四个正确样例；把 `createPlatformProfile`、Platform Prompt create/update、`createHumanizationJob` 的“rollback 后查 row”改为精确结构化诊断，或在合同未决定专用 code 时 unknown 原抛。产品/平台 type/account 的现有 code/details 不得改。
3. 在每个 command 的最窄 flush 边界确定事务 owner；standalone 失败 root rollback，嵌套调用由外层显式 savepoint owner 管理。确保 append_audit/event/revision 在已知错误前未 commit、未知错误 root rollback 后不留成功副作用。
4. 逐 operation 检查现有 409 metadata：已知业务 code 已落在 ErrorResponse；未知 500 没有既存 wire contract，不添加猜测 code。运行 affected integration tests、完整后端 contract check；若新增公共 code 才按 static/runtime/generated/frontend 全链路更新。

建议 required validation：

- 真实 PostgreSQL：产品、Platform Type、Platform Account 唯一竞态的 constraint_name 映射；用户删除 FK sqlstate；未知 CHECK/FK/NOT NULL/其他 unique sentinel 500；失败请求后检查原记录、AuditLog、PublicationWorkEvent、revision 均未产生成功副作用。
- 并发：同一产品身份、同一 platform type slug、同一 account normalized identifier 两个独立 Session，断言恰有一个写入成功，另一个得到该 owner 的既有领域错误；不能用预检查通过代替数据库最终约束。
- HTTP：确认 `ErrorEnvelope` wire 与 request-id 只用于 AppError/validation；未知 IntegrityError 不产生 `REVISION_CONFLICT`，不向客户端返回 SQL/表名/约束文本；已有前端 revision consumer 测试只由真实 stale AppError 触发。
- `bulkUpdateUserStatus`：预期 AppError 逐项失败仍按合同行为；非预期 DB/审计异常整批 rollback，不能因 helper 局部 savepoint 保留前项。

可选验证：全套 integration、frontend typecheck/consumer tests；仅在合同或 generated client 变化时成为 required。独立 reviewer 应只读复核 service-to-constraint owner、rollback/savepoint 所有权、未知错误 wire 与敏感信息边界。

## Caveats / Not Found

- 本研究未运行 PostgreSQL integration，也未修改代码、合同、测试或 Git 状态；依赖版本来自 `backend/uv.lock` 与 `backend/.venv` 实际 import，未以系统 Python（系统环境无这些 distribution）替代。
- 未找到自定义 `Exception`/500 handler、`begin_nested()` 调用、全局 500 ErrorEnvelope/schema/code、IntegrityError 文本解析或直接在 service 创建 `AuditLog` 的运行时实现；因此“统一 500 boundary”是对当前 FastAPI/Starlette 默认边界的决策，不是现有 JSON 内部错误合同。
- `PlatformProfile.slug`、`PlatformPrompt.name`、`GenerationJob` 幂等/partial unique index 的数据库最终约束名字需在实施 Task 通过实际 PostgreSQL `pg_constraint`/`pg_indexes` 查询确认，不能只依据 SQLAlchemy naming convention 猜测；这是当前按回滚后查询逻辑需要补的证据。
- `createPlatformProfile` 的 rollback 后查询可能在某些真实错误下“恰好”不命中而原抛，但这不能证明分类正确；未命中概率不是结构化约束身份。相同 caveat 适用于 Platform Prompt 和 Humanization Job。
- 全局 `integrity_error_handler` 未显式 rollback；生产 HTTP 路径的安全性来自 `get_db()` 生成器异常 cleanup。任何后续自定义 exception boundary 若绕过依赖清理，必须重新证明 Session rollback owner，不能仅复制 `error_response()`。
- contracts/database.md 的平台类型、平台账号、用户删除条款是当前公共事实；`backend/app/errors.py` 的“数据库唯一性和约束冲突统一显式返回”注释（`:76-78`）与该合同“未知 integrity failures remain visible”冲突，应在实施变更时同步更新，避免文档继续诱导全局 409。

## 11. audit_logs writer / transaction owner 证据（planning CSV 修复）

### 11.1 权威 writer 与 owner 规则

`backend/app/audit.py:141-159` 是运行时唯一的审计构造/写入入口：`_audit_record()` 做白名单、安全结构校验并实例化 `AuditLog`，`append_audit()` 只执行 `db.add()`，明确不 flush、不 commit、不创建独立 Session。运行时 service 没有直接 `AuditLog(...)` writer；迁移快照中的同名类不属于运行时 owner。故 CSV 的 `service_command` 不应只填 `app.audit.append_audit`，而应填“`append_audit` + 实际调用 command/helper”；`transaction_owner` 应填实际 command 的 `db.flush()`/`db.commit()` owner，而不是 append helper。

审计表字段、CHECK 和 actor FK 见 `backend/app/models/identity.py:69-112`；`actor_id -> users.id` 是 `ON DELETE SET NULL`，不是普通业务引用阻断。成功审计在应用层被限制为 `AuditOutcome.SUCCESS`、保留 action 白名单和真实 actor（`audit.py:72-138`），因此 AuditLog 约束失败不能伪造成功审计。审计写入与调用 command 的业务状态、revision、publication event/review record 同一 root transaction；未捕获失败由 `get_db()` 的 `db.rollback()`（`backend/app/db.py:31-40`）兜底。

### 11.2 全部 `append_audit` 调用集合

下表是对 `backend/app/services/**/*.py` 的 AST/`rg` 交叉盘点结果（共 39 个 `append_audit` 语法调用；其中 publication 的 `_audit` 是 1 个 wrapper，后面列出其 3 个调用方）。行号均为当前工作树。

| writer callsite（append） | 实际 service command / 内部路径 | HTTP `operationId` | 最终 flush/commit owner |
|---|---|---|---|
| `identity.py:307` | `export_users` | `exportUsers`（`routers/identity.py:282-299`） | `identity.export_users` 同函数 `db.commit()` `identity.py:327` |
| `identity.py:383` | `change_password` | `changePassword`（`routers/identity.py:183-198`） | 同函数 `identity.py:396` |
| `identity.py:413` | `create_user` | `createUser`（`routers/identity.py:224-242`） | 同函数先 `db.flush()` `identity.py:412`，再 `db.commit()` `:427` |
| `identity.py:511` | `_update_user_locked`，被 `update_user` 与 `bulk_update_user_status` 复用 | `updateUser`、`bulkUpdateUserStatus`（`routers/identity.py:317-335,248-267`） | 外层 `update_user` commit `identity.py:553`；外层 bulk commit `:590`。两者共用同一 root Session；bulk 任何意外异常必须整批 rollback |
| `identity.py:635` | `delete_user` | `deleteUser`（`routers/identity.py:338-359`） | 该函数删除 `db.flush()` `identity.py:628`，成功审计后 `db.commit()` `:649` |
| `identity.py:676` | `reset_user_password` | `resetUserPassword`（`routers/identity.py:366-384`） | 同函数 `identity.py:689` |
| `content_planning.py:208,246,286` | `create_query_topic`、`update_query_topic`、`delete_query_topic` | `createQueryTopic`、`updateQueryTopic`、`deleteQueryTopic`（`routers/planning.py:130-195`） | 分别 `content_planning.py:207/222`、`:260`、`:301`；create 先 flush 再 append/commit，update/delete 由 commit 隐式 flush |
| `product_facts.py:409,470,542,605` | `create_product`、`update_product`、`delete_product`、`delete_fact_version` | `createProduct`、`updateProduct`、`deleteProduct`、`deleteFactVersion`（`routers/product_facts.py:108-195,349-362`） | 分别 `product_facts.py:406/423`、`:467/484`、`:557`、`:630`；前两个已知 identity conflict 在 flush 前后由各自 service 处理 |
| `review.py:322` | `transition_fact_version` 且 `action == "approve"` 时才追加 | 只有 `approveFactVersion`（`routers/product_facts.py:386-403`）；request/retire 同 helper 但不写此审计 | 同函数 `review.py:336` commit；`requestFactVersionChanges`、`retireFactVersion` 仍提交审核记录但不追加该成功审计 |
| `review.py:397` | `transition_content_version` 且 `action == "approve"` 时才追加 | 只有 `approveContentVersion`（`routers/production.py:569-595`）；submit/request 同 helper 但不写此审计 | 同函数 `review.py:411` commit；approve 可能先 flush previous version `:385` |
| `content_production.py:865` | `delete_content_draft` | `deleteContentDraft`（`routers/production.py:437-451`） | 同函数 delete/flush `content_production.py:857,864`，append 后 commit `:879` |
| `geo_observation.py:2569` | `delete_geo_observation` | `deleteGeoObservation`（`routers/observation.py:291-311`） | 同函数链删除 flush `geo_observation.py:2642`，append 后 commit `:2590` |
| `platform_configuration.py:369` | `set_platform_profile_enabled` | `enablePlatformProfile`、`disablePlatformProfile`（`routers/configuration.py:656-686`） | 同函数 `platform_configuration.py:386` |
| `platform_configuration.py:530` | `delete_platform_type` | `deletePlatformType`（`routers/configuration.py:407-424`） | 同函数 `platform_configuration.py:544` |
| `platform_configuration.py:638,714` | `create_platform_prompt`、`update_platform_prompt` | `createPlatformPrompt`、`updatePlatformPrompt`（`routers/configuration.py:499-554`） | 分别 `platform_configuration.py:632/652`、`:700/741`；append 后 commit，commit 仍是隐式 flush 边界 |
| `platform_configuration.py:777` | `put_content_humanization_prompt` | `putContentHumanizationPrompt`（`routers/configuration.py:321-340`） | 同函数先 flush `platform_configuration.py:776`，再 commit `:791` |
| `platform_configuration.py:827` | `delete_platform_prompt` | `deletePlatformPrompt`（`routers/configuration.py:563-578`） | 同函数 `platform_configuration.py:846` |
| `platform_configuration.py:969` | `delete_platform_profile` | `deletePlatformProfile`（`routers/configuration.py:690-704`） | 同函数 flush `platform_configuration.py:984`，commit `:986` |
| `ai_configuration.py:488,525,573,622,664,700,730,784,821,864,906,1039` | `create_ai_channel`、`delete_ai_channel`、`create_ai_channel_header`、`update_ai_channel_header`、`delete_ai_channel_header`、`create_ai_model`、`delete_ai_model`、`update_ai_channel`、`replace_ai_channel_api_key`、`set_channel_enabled`、`update_ai_model`、`set_model_enabled` | 分别 `createAIChannel`、`deleteAIChannel`、`createAIChannelHeader`、`updateAIChannelHeader`、`deleteAIChannelHeader`、`createAIModel`、`deleteAIModel`、`updateAIChannel`、`replaceAIChannelApiKey`、`enableAIChannel`/`disableAIChannel`、`updateAIModel`、`enableAIModel`/`disableAIModel`（router definitions `configuration.py:741-1209`） | 对应 commit 依次为 `ai_configuration.py:507,539,587,636,677,714,745,798,834,877,920,1053`；创建 channel/model 显式 flush 在 `:487/:699`，其余 commit 隐式 flush |
| `publication.py:132`（wrapper） | `_audit`；以下 3 个直接调用方：`delete_platform_account` `:365`、`verify_publication_work` `:788`、`permanently_delete_published_article` `:1167` | `deletePlatformAccount`、`verifyPublicationWork`、`permanentlyDeletePublishedArticle`（`routers/publication.py:324-345,530-553,639-659`） | 分别由 `publication.py:375`、`_finish_work_command` `:468-472`、`:1176` commit；verify 先在 `:764` flush verification，成功时才 `_audit` |
| `publication.py:1566,1626` | `delete_content_task`、`permanently_delete_content_task` | `deleteContentTask`、`permanentlyDeleteContentTask`（`routers/planning.py:373-491`） | 分别 `publication.py:1587`、`:1640`；两者先 `_delete_task_core` flush `:1436`，清理旧 target audit 后再追加最小成功 tombstone |

因此当前有成功 AuditLog writer 的 HTTP operation 集合（去重后）为：

`exportUsers`, `changePassword`, `createUser`, `updateUser`, `bulkUpdateUserStatus`, `deleteUser`, `resetUserPassword`, `createQueryTopic`, `updateQueryTopic`, `deleteQueryTopic`, `createProduct`, `updateProduct`, `deleteProduct`, `deleteFactVersion`, `approveFactVersion`, `approveContentVersion`, `deleteContentDraft`, `deleteGeoObservation`, `enablePlatformProfile`, `disablePlatformProfile`, `deletePlatformType`, `createPlatformPrompt`, `updatePlatformPrompt`, `putContentHumanizationPrompt`, `deletePlatformPrompt`, `deletePlatformProfile`, `createAIChannel`, `deleteAIChannel`, `createAIChannelHeader`, `updateAIChannelHeader`, `deleteAIChannelHeader`, `createAIModel`, `deleteAIModel`, `updateAIChannel`, `replaceAIChannelApiKey`, `enableAIChannel`, `disableAIChannel`, `updateAIModel`, `enableAIModel`, `disableAIModel`, `deletePlatformAccount`, `verifyPublicationWork`, `permanentlyDeletePublishedArticle`, `deleteContentTask`, `permanentlyDeleteContentTask`.

这里的集合只描述实际 append writer，不应把同一 helper 的所有 route 都误列为 writer：例如 `transition_fact_version` 的 request/retire 不满足 `action == "approve"`，`transition_content_version` 的 submit/request 同样不追加成功审计；`createPlatformType`、`updatePlatformType`、`createPlatformProfile`、`updatePlatformProfile`、`createPlatformAccount`、`updatePlatformAccount`、`createGeoObservation` 目前也没有 `append_audit` 调用。

### 11.3 CSV `audit_logs` 行应如何表达

对于 `pk_audit_logs`、`fk_audit_logs_actor_id_users`、`ck_audit_logs_business_module`、`ck_audit_logs_outcome` 和 `not_null:audit_logs.*` 这些 INSERT 可触发的约束行，建议将 13 字段中的关键字段改成以下可复用表达。`audit_logs_append_only` 必须单独处理：`0037_trim_audit_history` 重建后的最终 active trigger 是 `BEFORE UPDATE`，正常 `append_audit()` INSERT 不会触发它。

- `service_command`：`app.audit.append_audit（仅 db.add）; callers: identity.export_users/change_password/create_user/_update_user_locked/delete_user/reset_user_password; content_planning.create/update/delete_query_topic; product_facts.create/update/delete_product/delete_fact_version; review.transition_fact_version[action=approve]/transition_content_version[action=approve]; content_production.delete_content_draft; geo_observation.delete_geo_observation; platform_configuration.set_platform_profile_enabled/delete_platform_type/create/update_platform_prompt/put_content_humanization_prompt/delete_platform_prompt/delete_platform_profile; ai_configuration.create/delete_channel/create/update/delete_header/create/delete/update_model/update_channel/replace_key/set_channel_enabled/set_model_enabled; publication._audit(callers delete_platform_account/verify_publication_work/permanently_delete_published_article)/delete_content_task/permanently_delete_content_task`。CSV 中可按既有单元格换行/分号格式保留完整集合，不能写成只有 helper 的“无 HTTP operationId”。
- `operation_id`：填上述去重后的真实 HTTP 集合；对于 `publication._audit` 展开为 `deletePlatformAccount;verifyPublicationWork;permanentlyDeletePublishedArticle`；对于 `_update_user_locked` 展开为 `updateUser;bulkUpdateUserStatus`；对于动态启停 helper 展开为 enable/disable 两个 operationId。只有 `append_audit` 被内部直接调用且没有 route 时才写“无 HTTP operationId”；本仓库运行时没有这样的独立 writer。
- `current_precheck`：应用层 `validate_audit_entry()` 只校验 Python `AuditEntry` 白名单/类型/长度/安全结构（`audit.py:72-138`），不是 DB PK/FK/CHECK/NOT NULL authority；actor 由调用 command 传入，`deleteUser` 受控删除另有 actor SET NULL trigger 合同。不要写成每个审计约束都有独立 precheck。
- `current_integrity_handling`：`append_audit` 不读取 diagnostics、只 `db.add`；约束错误在后续 owner 的 `flush`/`commit` 触发。除 `deleteUser` 删除 flush 的 command-specific `23503` 分支外，没有 AuditLog constraint 的专用 mapper；其余未捕获错误当前进入 `errors.py:76-78` 全局 `409 REVISION_CONFLICT / 数据约束冲突`。对 trigger 55000/自定义 23514，现有错误 handler 只按异常类型注册，不能证明业务上已正确分类。
- `current_http_status_code_details`：若错误从 HTTP command 的 commit/flush 逃逸，当前全局 handler 为 409、`REVISION_CONFLICT`、`数据约束冲突`、空 details；若是内部 worker/非 HTTP service，则不得虚构 HTTP 结果。`append_audit` 本身的 `ValueError`（输入白名单失败）也不是 IntegrityError，当前没有专门 ErrorEnvelope handler。
- `recommended_status_code_details`：AuditLog PK/CHECK/NOT NULL 及 actor FK 的未知 writer failure 没有已批准专用 code；应保留异常并由默认内部 500 boundary 处理，不发明审计专用 4xx、不暴露 SQL/constraint 文本。`deleteUser` 的业务 FK/actor-delete 合同仍由其 service owner 单独处理，不能推广为全局 audit FK mapper。
- `transaction_owner`：写“上述每个实际 command 的顶层 `Session`（显式 flush/commit 行见表），`append_audit` 不拥有事务”；HTTP 异常时由 `get_db()` `rollback`/close 兜底。`deleteContentTask`/`permanentlyDeleteContentTask` 清理旧审计并在同一事务追加 tombstone；publication verify 将 event/revision/article/audit 一并交给 `_finish_work_command` commit；bulk user 的外层 command 拥有整批 root rollback 语义。
- `required_tests`：至少应以真实 PostgreSQL sentinel 在一个可代表 writer 的命令中分别触发 PK/actor-FK/CHECK/NOT NULL，断言 `diag.sqlstate`/`constraint_name`、未泄露 SQL、未知错误不再返回 `REVISION_CONFLICT`，并检查业务行、revision、event/review record、AuditLog success 行均无部分提交；现有基线测试包括 `backend/tests/unit/test_audit.py:49-56`（只 add 不 commit）、`backend/tests/integration/test_identity_management.py:675-794`（deleteUser 成功/失败及审计）、`:804-1163`（bulk 原子 rollback）、`backend/tests/integration/test_product_detail.py:248-335`（重复更新不增加成功审计）、`backend/tests/integration/test_query_topic_list.py:151-216`（topic audit）、`backend/tests/integration/test_ai_channel_management.py:511-587,796-815`（AI audit/并发删除）、`backend/tests/integration/test_content_draft_lifecycle.py:157-210`（draft delete audit）、`backend/tests/integration/test_publication_workflow.py:2012-2170,2172-2365,2873-2919`（task/article deletion 与 product conflict audit）；这些现有测试尚未覆盖每种 audit_logs 约束的 diagnostics sentinel，需新增最小代表性 unknown/rollback 测试而非机械生成 39 个 writer 测试。

`audit_logs_append_only` 行的直接 owner 证据不同：正常应用写入只有 INSERT；唯一会让应用正常触发该 UPDATE trigger 的路径，是 `identity.delete_user` 删除用户后由 `ON DELETE SET NULL` 级联更新 `audit_logs.actor_id`。该路径通过事务内 `partsignal.user_delete_id` GUC 受控放行，对应 `deleteUser`。普通应用没有直接更新 AuditLog 的 command；非法 UPDATE 应由真实 PostgreSQL sentinel 直接验证 `SQLSTATE 55000`、回滚和无泄露。现有 handler 只注册 `IntegrityError`，在确认 SQLAlchemy 实际包装类型之前，不得把 trigger 失败预写成全局 409 或某个 ErrorEnvelope。`publication._delete_audit_targets` 是 DELETE；最终 active trigger 已不监听 DELETE，因此它不是该 trigger 的 enforcement owner。

### 11.4 关键更正

现有 companion CSV 的 AuditLog INSERT 约束行若写 `service_command=app.audit.append_audit`、`operation_id=无 HTTP operationId（内部审计写入）`、`transaction_owner=app.audit.append_audit 的顶层 Session`，会把 helper 与真实 owner 混淆。正确语义是：`append_audit` 是唯一 writer helper，但所有调用方 command 持有事务；绝大多数 writer 都是 HTTP 命令，只有 service 内部 helper（`_update_user_locked`、publication `_audit`）需要展开到其上层 operationId。`audit_logs` INSERT constraint rows 的测试应选择这些真实 owner 做 sentinel，不能把“无独立 HTTP operationId”当成当前全局事实；`audit_logs_append_only` 则必须按上一节的最终 UPDATE trigger owner 单独建模。
