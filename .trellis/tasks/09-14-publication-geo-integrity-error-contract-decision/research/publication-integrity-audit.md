# Research: Publication 与数据库完整性边界审计

- Query: 审计 publication 工作流、Article/Issue/Repair Task 与 PostgreSQL 完整性约束的边界；裁定 `uq_content_tasks_source_published_content_issue_id` 并发竞态的错误映射；核对外键删除动作、事件时间、不可变历史、revision/state、AuditLog 和失败后 Session 复用。
- Scope: internal（源码、ORM、迁移、规范、合同、集成测试）
- Date: 2026-09-14

## Findings

### 1. 审计范围与权威文件

已读取并交叉核对以下文件。行号以当前工作树为准。

| 文件 | 证据范围与用途 |
| --- | --- |
| `backend/app/services/publication.py:120-145`、`:383-1181`、`:1184-1645` | Publication Work、Verification、Article、Issue、Repair Task 及 Content Task 命令、锁、flush/commit、审计和删除事务。 |
| `backend/app/routers/publication.py:118-130`、`:133-808` | 读写路由、权限依赖、CSRF、请求级隔离级别和 operation id。 |
| `backend/app/models/publication.py:28-290` | PlatformAccount、PublicationWork/Event/Verification、PublishedArticle/Issue/Attachment 的 ORM 约束及外键动作。 |
| `backend/app/models/content.py:28-88`、`backend/app/models/geo_files.py:59-85` | ContentTask 的 Repair source 外键，以及 GEO 与 PublishedArticle 的引用动作。 |
| `backend/alembic/versions/0034_publication_workflow_redesign.py:49-745` | Publication 表、触发器、历史约束、原始 `RESTRICT` source FK 和唯一约束。 |
| `backend/alembic/versions/0035_business_workflow_primary_tasks.py:100-170`、`:328-522` | Work 与业务 ContentTask 绑定、事件/验证快照 FK、状态触发器。 |
| `backend/alembic/versions/0036_remove_publication_section_url.py:11-93` | 迁移后的触发器替换及 section_url 移除。 |
| `backend/alembic/versions/0037_simplify_deletion_lifecycle.py:148-229`、`:238-436` | source FK 改为 `SET NULL`、GEO/Work FK 动作、删除上下文和 source immutable guard。 |
| `backend/alembic/versions/0038_published_article_delete.py:25-103`、`0039_published_article_delete_missing_platform.py:11-50`、`0043_geo_insight_platform_identity.py:104-182` | 受控 Article 删除、平台缺失时 CANCELLED、平台身份快照的数据库最终约束。 |
| `backend/app/services/publication_queries.py:80-1225` | 状态/action 投影、读模型不变量、删除 blocker 和 GEO/repair context。 |
| `backend/app/services/geo_observation.py:2337-2647`、`backend/app/services/workbench.py:198-235`、`backend/app/services/content_task_detail.py:242-275` | Article/Issue/GEO 竞态、锁顺序、跨边界 read model。 |
| `backend/app/errors.py:1-79`、commit `43c252da`、`.trellis/tasks/09-04-integrity-error-domain-mapping/research/{database-constraint-matrix,backend-integrity-paths,transaction-handler-design,api-frontend-impact,revision-conflict-producer-inventory}.md` | 核对父任务 T1 已移除全局 IntegrityError handler，并复用父任务的精确诊断映射和事务失败复用结论。 |
| `backend/tests/integration/test_publication_workflow.py:617-2868`、`:2988-3447` | 读模型、状态转换、事件时钟、Article 删除、Repair source unbind、GEO blocker 和 DB guard 的现有证据。 |
| `contracts/database.md:299-343`、`:411-437`、`contracts/openapi.yaml:3182-3667`、`:6655-7993` | 当前数据库/删除契约和 publication API/read-model 错误外形。 |
| `.trellis/spec/backend/error-handling.md:82-123`、`:273-305`、`publication-workbench-guidelines.md:7-9`、`:41-198`、`:267-363` | 完整性错误映射、未知 500、事务、生命周期、删除、RR 读和事件时间的项目规范。 |

未使用外部文档；本结论以仓库中的 PostgreSQL/SQLAlchemy 使用方式、迁移和测试为依据。

### 2. 权限、状态和事务边界

路由的权限边界是清楚的：所有 publication 读接口使用 `CurrentUser`，工程师/管理员写接口通过 `ContentEditor` 或 `_run_publication_command` 的 `assert_account_types`（`backend/app/routers/publication.py:123-130`）二次校验；平台账户删除和 PublishedArticle 预览/永久删除使用 `AdminUser`（`:324-345`、`:627-659`）；写操作均有 CSRF 校验。服务端仍是最终权限和状态权威，前端 action 仅为投影。

Publication Work 的命令在取得 Work `FOR UPDATE` 后校验 expected revision 和状态（`publication.py:464-478`、`:563-840`），用 `_work_event` 追加历史，最后由 `_finish_work_command` 统一 `flush -> refresh/projection -> commit`。Verification 的 flush、状态/revision、Article 创建、完成事件、AuditLog 和最终 commit 在同一事务（`:721-802`）。Issue open/resolve 与 Repair Task 创建也在一条命令事务中（`:843-980`），但没有统一的 publication-specific `IntegrityError` 映射。

Article 删除先锁 Task、Work、Article、events、verifications、issues 和关联文件，再计算 Repair Task/GEO blocker（`:983-1076`）；通过 `partsignal.published_article_delete_id` 设置事务上下文后删除整个受控聚合（`:1102-1181`）。数据库触发器只允许该受控上下文删除，否则以 `SQLSTATE 55000` 拒绝（`0038:25-103`）。删除完成后保留 Repair Task并将其 source FK 置 NULL，Repair Task 的 state/revision不变；若原 Article 所属 Work 的来源 ContentTask仍有实时平台则该来源任务恢复为 OPEN，否则置为 CANCELLED，并递增该来源任务 revision（`publication.py:1161-1169`，`contracts/database.md:329-339`）。该行为是事务整体原子操作，不应拆成先提交删除、再修复任务的两步。

默认 `get_db` 在请求异常时 rollback 并 close（`backend/app/db.py:31-40`）。服务层若捕获数据库异常并转成可恢复 `AppError`，必须先 rollback；否则 SQLAlchemy Session 处于 failed transaction 状态，后续查询会报 `PendingRollbackError`。现有精确映射样例 `_flush_platform_account`（`publication.py:227-241`）读取 `error.orig.sqlstate` 与 `error.orig.diag.constraint_name`，匹配后 rollback，再抛出业务错误，未知异常原样抛出。这是 publication 修复任务应复用的边界模式。

当前命令使用 root Session transaction，没有 `begin_nested()`；因此在可独立提交的 HTTP command 中，根事务 rollback 足够。若以后把 `create_repair_task` 嵌入更大事务，不能未经所有权设计就回滚整个外层事务；应明确事务拥有者，或在命令边界引入 savepoint 并补测试。

### 3. 约束、SQLSTATE 与诊断识别矩阵

| 约束/触发器 | 定义位置与真实名称 | SQLSTATE/诊断稳定性 | 当前路径 | 建议决策 |
| --- | --- | --- | --- | --- |
| Repair source 唯一 | `0034:724-728`，`uq_content_tasks_source_published_content_issue_id`；ORM `content.py:71-75` | PostgreSQL 唯一冲突为 `23505`，`diag.constraint_name` 为该命名约束，名称是稳定的机器边界。 | `create_repair_task` 先查 source（`publication.py:904-910`），重复时显式 `REPAIR_TASK_EXISTS`；`flush` 在 `:948`，没有异常映射，竞态进入当前默认 unknown 500。 | **只匹配 `23505 + uq_content_tasks_source_published_content_issue_id`，rollback 后映射既有 `REPAIR_TASK_EXISTS`/409。** 不能用错误消息文本或“回滚后再查”猜测。未知 IntegrityError 继续 500。 |
| Issue 每 Article 一个 OPEN | ORM partial index `uq_published_content_issues_one_open`（`publication.py` model `:249-255`）；迁移 `0034:319-329` | 这是命名 partial unique index；实际 PostgreSQL `23505` 的诊断应以 final catalog sentinel 验证。 | `open_published_content_issue` 锁 Article 且先查询 OPEN（`publication.py:843-883`），普通应用调用已串行；无 catch。 | 不把所有 `23505` 归为同一错误。若合同明确需要竞态稳定码，应另行精确映射该 index；当前没有足够证据扩展范围，未知冲突保留 500。 |
| Work active platform/hash 唯一 | `uq_publication_works_active_platform_hash`（`publication.py:99-105`，迁移 `0034:147-153`） | Partial unique 的 `23505`/`diag.constraint_name` 需以真实 PG catalog 确认。 | `_ensure_unique_identity` 预查（`:396-423`），创建 Work 还持有 advisory xact lock（`:383-387`、`:490-535`）；flush `:551` 无 catch。 | 已有 `PUBLICATION_IDENTITY_CONFLICT` 预检查，但不应把未知 DB 错误或其他约束误映射成它；若要覆盖绕过 advisory lock 的写入，单独定义精确 sentinel 和测试。 |
| Work idempotency / content task 唯一 | `uq_publication_works_idempotency_key`、`uq_publication_works_content_task_id`（ORM `:66-67`；迁移 `0034:138-146`、`0035:100-121`） | 命名唯一约束的 `23505` 可识别；但 idempotency key 还允许同 key replay/conflict（`publication.py:491-500`）。 | 先锁 idempotency advisory key、检查现有 Work；flush/commit 无统一 catch。 | 只保留既有 replay/显式冲突业务路径；不可用一个全局 `REVISION_CONFLICT` 兜底所有唯一错误。新增映射需先明确合同。 |
| Verification 一个 PASSED | `uq_publication_verifications_one_passed`（ORM `:185-190`，迁移 `0034:225-232`） | 命名 partial unique index，`23505`/diag 需 catalog 验证。 | Work lock 和状态检查避免正常重复；`:769` flush、`:775-791` 状态/Article/event 无 catch。 | 保持未知 DB 完整性错误 500；不要按消息推断为重复验证。 |
| Attachment 复合主键 | `publication_attachments` 的 `(publication_work_id,file_id)`（ORM `:279-290`，迁移 `0034:330-350`） | 冲突为 `23505`，诊断名称可能是约束/索引名，需真实 catalog sentinel。 | 注册结果先检查附件重复（`publication.py:672-718`），插入后 flush 无 catch。 | 预查只优化错误体验；未定义稳定业务码时不扩展映射。 |
| Publication/Issue/History guard | `0034:354-606`、`0035:328-522`、`0037:238-436` | 非法生命周期/删除为 `55000`；不变量触发器为 `23514`。PL/pgSQL `RAISE` 通常没有可用 `diag.constraint_name`，消息也不是稳定 API。 | 服务层先将常见状态/version 错误转 `AppError`；绕过服务的 DB 错误没有 publication-specific catch。当前 `errors.py:76-79` 的全局 IntegrityError handler 会错误映射为 `REVISION_CONFLICT`。 | 不按消息解析，不把 `55000/23514` 或未知 IntegrityError 伪装成 revision conflict；未知数据库异常应 re-raise，交由默认 500。 |
| Article deletion guard/GEO refs | `0038:46-84` 触发器，GEO FK 及 blocker 见 `geo_files.py:59-85`、`0037:187-206` | 受控上下文外删除为 `55000`，不是可恢复业务冲突；引用 FK 动作需看 final migration。 | 服务在删除前报告 `PUBLISHED_ARTICLE_IN_USE`（`publication.py:1062-1076`），数据库在错误上下文再次拒绝；集成测试验证二者。 | 保留 blocker 409 与 DB guard 500/数据库边界；不可通过级联或静默吞错删除 GEO 历史。 |

规范明确要求已知唯一冲突“精确约束名 + SQLSTATE”映射，未知 `IntegrityError` 原样抛出为默认 500（`.trellis/spec/backend/error-handling.md:82-123`、`:273-305`）。当前 `backend/app/errors.py` 已无全局 `IntegrityError` handler，父任务 T1 的 commit `43c252da` 已恢复该边界；publication 后续只需在 command owner 内增加获批约束的窄映射，不建立第二套全局错误注册表。

### 4. `uq_content_tasks_source_published_content_issue_id` 竞态裁定

结论是：该约束的竞态应映射 `REPAIR_TASK_EXISTS`，而不是 `REVISION_CONFLICT` 或未知的通用冲突。

原因和并发语义如下：

1. `create_repair_task` 对 Issue `FOR UPDATE`（`publication.py:895-903`），普通 HTTP 调用在同一 Issue 上已串行；第二个正常调用通常会在第一个事务提交后读到 source task，并由预检查 `:904-910` 返回 `REPAIR_TASK_EXISTS`。
2. Issue 行锁不是数据库唯一约束的替代品。直接写入、不同命令路径、历史脚本或锁顺序不同的事务仍可能让两个事务都通过预检查，随后在 INSERT/flush 处发生唯一冲突。该数据库约束是最终权威，必须覆盖这一窗口。
3. PostgreSQL loser 事务只会收到 `SQLSTATE 23505` 和精确 `diag.constraint_name=uq_content_tasks_source_published_content_issue_id`。胜者保留唯一 Repair Task；败者 rollback 后抛出与预检查相同的 `REPAIR_TASK_EXISTS`/409，不应自动 reload、重试、返回胜者对象或用事后查询猜测。这保持“一个 Issue 至多一个 source Repair Task”的原子语义，并允许客户端按已知可恢复冲突刷新。
4. `db.flush()` 在 `publication.py:948` 是最窄的错误捕获点；应在该 flush 周围匹配精确 pair，先 rollback 再抛 `AppError`。若 commit 仍可能触发同一非 deferrable 唯一约束，则 commit 边界也必须由同一事务拥有者覆盖，但不能捕获整个函数后误把 FK/check/trigger 等其他错误映射成 `REPAIR_TASK_EXISTS`。
5. 预检查和 DB 冲突都不能改变 Issue revision、AuditLog、其他事件或已提交 task。Repair Task 创建当前没有 `_audit` 调用（`:886-950`），因此失败也不应产生成功审计记录；未来若增加 AuditLog，应与 task insert 同一事务。

失败后的 Session 规则：精确 mapper rollback 后，同一个 Session 可以继续查询 Issue/已存在 Repair Task；应加入测试证明 Session 未残留 failed transaction。未知 IntegrityError 不捕获为 AppError，默认 request dependency 会 rollback/close；直接调用服务的测试若要复用该 Session，必须由调用者 rollback，不能把“Session 可继续用”当作未知异常行为。

### 5. source FK 的 RESTRICT/SET NULL 差异

表面上存在差异，但 final head 没有 ORM/迁移漂移：

- `0034:716-723` 初次创建 `fk_content_tasks_published_issue` 时使用 `ondelete="RESTRICT"`。
- `0037:148-164` 明确 drop/recreate **同名** FK `fk_content_tasks_published_issue`，改为 `ondelete="SET NULL"`，并在 `:218-229` 调整可空性。
- 当前 ORM `ContentTask.source_published_content_issue_id` 是 nullable + `ForeignKey(..., ondelete="SET NULL")`（`backend/app/models/content.py:71-75`）。
- Article 删除服务没有显式先将 Repair Task source 设 NULL，而是删除 Issue（`publication.py:1130-1160`）并依赖最终 FK SET NULL；集成测试 `test_published_article_permanent_delete_restores_source_task_and_owned_history`（`test_publication_workflow.py:2550-2587`）验证删除后 Repair Task 保留且 source 为 NULL。该解绑不改变 Repair Task 的 state/revision；`publication.py:1162-1168` 恢复 OPEN/CANCELLED并递增 revision的是被删除 Article 所属 Work 的来源 ContentTask。`0037` 的 source guard（`:308-323`）允许删除上下文中的嵌套 source nulling，并禁止其他 source 改写。

所以不能依据 0034 的中间状态判定当前删除会 RESTRICT；部署/测试必须确保已升级到包含 0037 的 head。建议在迁移回归中查询 `pg_constraint`/`pg_get_constraintdef`，以同名 FK 断言最终 `ON DELETE SET NULL`，并以唯一约束名断言 Repair source sentinel。当前测试验证了行为，但没有直接验证 catalog 上的动作和约束名。

GEO 引用也有历史到最终动作变化：`0037:194-206` 将 GEO citation Article FK 改为 SET NULL、GEO publication Article FK 改为 CASCADE；但 `0038:64-80` 的 Article 删除 guard 在受控删除上下文中仍检查 GEO 引用并拒绝删除。因此应用的 blocker/数据库 guard 仍是保留 GEO 历史和阻止越界删除的主边界，不能仅看到 CASCADE 就把 GEO 删除当作允许的业务行为。

### 6. 事件时间、不可变历史、revision 与 read model

`_work_event` 每次先在锁定的 Work 上查现有最大 `created_at`，再调用 `clock_timestamp()`（`publication.py:426-461`）。它使用数据库真实时钟，而不是事务开始的 `now()` 或应用时钟；若时钟不前进，则以最大时间加 1 微秒，保证 `(created_at,id)` 排序严格单调。测试 `test_event_timestamp_uses_strict_database_clock_floor`（`test_publication_workflow.py:2200-2260`）验证了未来时间事件和 +1 微秒 floor。关闭/解决/归档等业务字段仍用应用 `datetime.now(UTC)`（如 `publication.py:823-831`、`:953-980`、`:1475-1645`），这些字段不是 Work 事件顺序权威；读模型事件使用 `created_at,id` 稳定排序（`publication_queries.py:440-481`、`:784-844`）。

迁移触发器将历史边界放在数据库：Work 状态/revision/结果完整性、终态 Article、Verification 快照、Issue 只能 OPEN→RESOLVED、source 只写一次、Event/Verification/Article/Attachment append-only，分别见 `0034:354-606`、`0035:328-522`、`0037:238-436`。服务层的 `expected_revision` 和 action map（`publication.py:464-478`、`publication_queries.py:88-137`）是可读的业务冲突；数据库触发器是绕过服务时的最终防线。

Verification PASS 路径在同一事务内插入不可变快照，完成 Work/Task、递增 task revision、创建 Article、追加 COMPLETED event 和 AuditLog（`publication.py:758-801`）。任何 flush/trigger/unique/FK 失败都应使上述变更整体回滚，不能留下已完成 task、孤立 article 或成功审计。Article 删除则在同一事务锁定并删除受控历史，保留 approved ContentTask/ContentVersion；集成测试覆盖删除成功、平台已删时 CANCELLED、GEO blocker 和失败无成功 AuditLog（`test_publication_workflow.py:2422-2868`）。Issue open/resolve 和 Repair Task 成功路径目前没有 publication `_audit` 调用（`publication.py:843-980`）；这不是凭本审计推定为 bug，但若产品要求每个 Issue transition 都可审计，应作为单独合同决策，不在错误映射中顺带扩展。

Article/Issue 读路由通常设置 `REPEATABLE READ`（`backend/app/routers/publication.py:118-121`；Issue/Article 路由范围 `backend/app/routers/publication.py:582-754`），read model 对 Verification/Work snapshot/source hash 等不变量失败时返回 `PUBLICATION_CONTEXT_INCOMPLETE`（`backend/app/services/publication_queries.py:784-844`、`:967-985`）。Work detail `get_publication_work`（`backend/app/routers/publication.py:398-410`）未调用该 RR helper，是与其他 publication read surface 的一致性覆盖差异；本次仅记录，不建议在 Repair 错误映射任务中顺带改变读事务语义。

GEO 创建锁定候选 Article（`geo_observation.py:2337-2397`），打开 Issue 锁 Article（`publication.py:843-883`），Article 删除锁整个聚合并检查 GEO 引用。由此正常服务路径可避免“已打开问题仍被选为 GEO”或“删除时新 GEO 引用漏检”的竞态；不过现有测试是顺序行为测试，尚未证明两事务真正互相等待的锁竞态。

### 7. 现有测试证据与缺口

已有证据包括：

- Work/Article 状态感知的 live identity 与终态 snapshot（`test_publication_workflow.py:693-850`）；
- 缺少事件或 malformed context 返回结构化 409（`:852-903`、`:2153-2197`）；
- workspace `REPEATABLE READ`、固定五条语句与一致 action projection（`:1116-1254`）；
- 失败 Verification 保持 Action Required，切换 content version 后旧 Verification 保留且 stale verify 不得写入（`:1547-1922`）；
- Event database clock floor（`:2200-2260`）；
- Article 永久删除后的历史删除、Repair source NULL、source task OPEN/CANCELLED 与 revision（`:2422-2712`）；
- GEO observation/citation 与 optimization source blocker、受控上下文外 DB 55000 拒绝、失败无成功 AuditLog（`:2720-2868`）；
- 迁移测试覆盖 0034/0035/0036/0037/0038 的升级、快照回填、guard 和外键置空行为（`backend/tests/integration/test_migrations.py:3451-3905`）。

关键缺口：

1. `test_publication_workflow.py` 虽导入 `IntegrityError`/`DBAPIError`（`:22-23`），但没有两 Session/真实 PostgreSQL 竞态测试，不能证明 `diag.constraint_name` 识别或 loser rollback 后 Session reuse。
2. 没有针对 `uq_content_tasks_source_published_content_issue_id` 的 `23505` 精确映射断言；当前会进入默认 unknown 500，而不是既有 `REPAIR_TASK_EXISTS`。
3. 没有 unknown IntegrityError 的 HTTP 500（无稳定业务 code）回归，也没有确保错误消息不泄露内部约束细节的断言。
4. 没有直接查询最终数据库 catalog，验证同名 source FK 的 `SET NULL` 和唯一约束的真实名称；行为测试只间接证明了 SET NULL。
5. 没有真正并发的 Article lock/GEO candidate/delete race 测试；现有 blocker 测试充分证明顺序语义，但未证明锁等待和最终 trigger 竞态。
6. 现有 event floor 测试直接插入未来 Event 作为 fixture，绕过 append-only service path；它证明时钟 floor，但不等同于生产可写入能力。

**“Publication Repair source 完整性错误精确映射与最终 FK/事务回归”**。

该任务只覆盖以下闭环：

1. 在 `create_repair_task` 的 INSERT/flush 边界精确匹配 `SQLSTATE 23505` 与 `uq_content_tasks_source_published_content_issue_id`，rollback 后返回既有 `REPAIR_TASK_EXISTS`/409；其他 IntegrityError re-raise，避免新增全局模糊 registry。
2. 增加真实 PostgreSQL 两 Session 并发测试：一个 Issue 只能提交一个 Repair Task；loser 得到稳定业务码、其事务完全 rollback；捕获后同一 Session 可继续读取已提交 Issue/Task。另测未知完整性错误走默认 500（新 Session/请求边界），不把约束名泄漏给 API。
3. 增加 migration/catalog sentinel，断言 final `fk_content_tasks_published_issue` 为 `ON DELETE SET NULL`、source 可空、唯一约束名准确；保留现有 Article 删除行为断言，确认删除 Issue 后 Repair Task 保留、source NULL且其 state/revision不变，原 Article 来源 ContentTask的 OPEN/CANCELLED、revision、archived_at 与 audit 原子一致。
4. 不恢复或新增全局 `IntegrityError` handler，不在该实现任务里扩展到其他 publication unique/index。

建议该任务的 required validation 为对应 integration/migration tests 和类型/lint 最小检查；Article/GEO 真并发锁测试可作为同一事务回归中的最后一个测试场景，若实现成本明显扩大，应另立任务而不是在错误映射中加入未审查的锁协议。

## Related specs / contracts / external references

- `.trellis/spec/backend/error-handling.md:82-123`、`:273-305`：已知约束精确映射；未知 IntegrityError 默认 500；请求依赖负责 rollback/close。
- `.trellis/spec/backend/publication-workbench-guidelines.md:41-90`、`:156-198`、`:267-363`：Issue/Repair source 唯一写入、状态与删除上下文、RR read、DB clock event、不可变历史。
- `contracts/database.md:299-343`、`:411-437`：Publication/Article/Issue/Repair 生命周期、source FK SET NULL、保留 Repair Task 并恢复 source task 状态。
- `contracts/openapi.yaml:3182-3667`、`:6655-7993`：路由权限响应外形、workspace/action/read model；错误 envelope 的 `code` 是字符串，未为 `REPAIR_TASK_EXISTS` 建枚举限制。
- External references: none（未进行网络检索；未连接运行中的 PostgreSQL catalog）。

## Caveats / Not Found

- 0034 的 `RESTRICT` 是中间迁移状态，0037 已以同名 FK 改成 final `SET NULL`；若目标环境未完整升级到 0037，行为会不同，需由部署迁移版本和 catalog sentinel 确认。
- 本审计没有执行并发写入、迁移或测试命令，也没有读取运行中数据库的 `pg_constraint`；`diag.constraint_name` 对 partial unique index 的最终返回值仍应由真实 PostgreSQL sentinel 固化。
- 未发现另一个 publication Repair source 错误码合同；`REPAIR_TASK_EXISTS` 来自现有 service precheck（`publication.py:904-910`），OpenAPI 允许该字符串，但尚无专门 schema enum。
- Issue resolve/open、Repair Task create 当前未调用 publication `_audit`；是否要求所有 Issue transition 追加 AuditLog 需要产品/合同决策，不能从现有删除与 Work 审计证据推断。
- Work detail 路由未设置 RR，是读一致性潜在差异；本报告不把它扩大为本次 integrity mapper 的必改项。
