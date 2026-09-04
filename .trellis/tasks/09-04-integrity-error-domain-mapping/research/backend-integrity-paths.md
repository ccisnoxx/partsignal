# Research: 后端 IntegrityError 路径

- Query: 全量盘点后端 IntegrityError import、捕获点、全局 handler，以及所有可能由 flush/commit 触发数据库完整性约束的路径；追踪 router operationId、schema/业务预检、事务回滚、审计/事件/修订写入和未映射到领域错误的风险。
- Scope: internal
- Date: 2026-09-04

## Findings

### 1. 搜索范围与总数

对 backend/app/**/*.py、backend/alembic/versions/**/*.py、backend/tests/**/*.py、contracts/**/*.md|yaml 和后端 Trellis spec 做了全文搜索；命令使用 rg -n --hidden --glob '!**/.venv/**'，并以模型、当前迁移和 service/router 调用链交叉核对。

在后端应用源中，定义的路径数如下（“路径”定义为：一个本地 except IntegrityError 分支，或一个可能让 flush/commit 抛出该异常的 service 函数/worker 写入边界；同一 helper 被多个 operation 调用时按调用链列出但不重复计数 helper）：

| 类别 | 数量 | 精确搜索结果 |
|---|---:|---|
| IntegrityError import | 8 | identity.py:13、product_facts.py:10、publication.py:12、content_planning.py:8、platform_configuration.py:11、content_production.py:13、main.py:17、errors.py:11 |
| except IntegrityError | 9 | identity.py:629；product_facts.py:407,468；publication.py:230；content_planning.py:340；platform_configuration.py:405,633,701；content_production.py:496 |
| 全局 handler 定义/注册 | 1 / 1 | backend/app/errors.py:76-78；backend/app/main.py:261 |
| db.flush() | 33 | 见第 4 节完整清单 |
| db.commit() | 87 | 见第 4 节完整清单 |
| savepoint / nested transaction | 0 | backend/app、backend/alembic 搜索 begin_nested|savepoint|SAVEPOINT 无结果 |

按命令合并本地捕获路径为 11 个 operationId：deleteUser（1）、createProduct/updateProduct（2）、createPlatformType/updatePlatformType（2）、createPlatformProfile（1）、createPlatformPrompt/updatePlatformPrompt（2）、createHumanizationJob（1）、createPlatformAccount/updatePlatformAccount（2）。之所以是 11 而不是 9，是因为 platform type helper、product identity helper、platform account helper 各自被两个命令共享；9 是 Python 语法上的 except 站点数。其余会触发写入边界的 operationId 没有本地 IntegrityError 映射，异常可落到全局 handler；worker 路径另计，不是 HTTP 命令。

没有发现 session.flush/commit 或其他 session 别名写入；上述 db 是全部写入边界。没有在测试中找到对 IntegrityError 或其 SQLSTATE 的直接模拟/断言；现有 REVISION_CONFLICT 测试主要测试业务 revision 预检，例如 backend/tests/integration/test_query_topic_list.py:193、test_product_detail.py:693,758,772、test_identity_management.py:702,747。

### 2. 统一事务与错误边界

- backend/app/db.py:27-39 的 SessionLocal 使用 expire_on_commit=False；get_db() 在请求异常时执行 session.rollback()，最后关闭 session。因而未处理的 IntegrityError 会回滚请求内尚未提交的写入，再到全局 handler；但异常前若 service 自己已经 commit，该提交不会被依赖回滚撤销。
- backend/app/errors.py:76-78 的 integrity_error_handler() 对所有逃逸的 IntegrityError 统一返回 HTTP 409、code REVISION_CONFLICT、message 数据约束冲突，details 为空；backend/app/main.py:261 将其注册为全局 handler。该映射不读取 constraint 或 SQLSTATE，故所有未捕获 unique/FK/CHECK 冲突都会被误归入 revision 冲突，且无法定位字段。
- backend/app/audit.py:157-159 的 append_audit() 只把 AuditLog 加入当前事务，不自行提交。多数成功命令在约束 flush 成功后追加审计，再统一 commit；已知冲突分支回滚后抛 AppError，不会保留成功审计。
- .trellis/spec/backend/error-handling.md:61-116 明确要求：在业务边界 flush，只读取 error.orig.diag.constraint_name；已确认约束须先 rollback() 再抛带 details.errors[].loc=["body", field] 的领域错误；未知 IntegrityError 原样抛出，不得用统一 REVISION_CONFLICT 或解析数据库英文消息。

### 3. 9 个本地捕获点及调用链

| 捕获点与调用方 | Router / operationId / 输入边界 | 当前识别与 HTTP 结果 | 事务、审计和风险判断 |
|---|---|---|---|
| identity.py:629-633，delete_user() (:597-649) | routers/identity.py:338-344，deleteUser；请求含 expected_revision | 读取 error.orig.sqlstate；仅 23503 回滚并返回 USER_IN_USE, 409，details 为空；其他异常 raise | 正确执行 failed-flush 后 rollback；行锁、引用计数和受控删除先行，成功审计 :635-648、commit :649 在 flush 后。将所有 user RESTRICT FK 统一为 USER_IN_USE 是按 SQLSTATE 而非 constraint 名称的既有特例，未把未知 SQLSTATE 吞掉。 |
| product_facts.py:407-408，create_product() (:395-424) | routers/product_facts.py:108-115，createProduct；ProductCreate | _product_identity_conflict() (:47-63) 只接受 uq_products_normalized_brand；回滚后 PRODUCT_ALREADY_EXISTS, 409，details 定位 body.part_number、body.brand，type product_identity_exists | 正确样例；flush :406 后捕获，未知 constraint 原样抛出；审计 :409-422、commit :423 仅在成功 flush 后。 |
| product_facts.py:468-469，update_product() (:427-485) | routers/product_facts.py:159-165，updateProduct；含 expected_revision 和身份字段 | 同一 _product_identity_conflict()，结果同上 | 正确样例；先行锁行/revision 检查，失败 flush 后 helper rollback；审计、commit :484。 |
| platform_configuration.py:405-408，_flush_platform_type() (:401-424) | create_platform_type() :390-398 -> routers/configuration.py:358-363，createPlatformType；update_platform_type() :478-498 -> :380-385，updatePlatformType；platform type schema | 读取 diag.constraint_name，仅 uq_platform_types_slug 进入 rollback :409，返回 PLATFORM_TYPE_SLUG_EXISTS, 409，details 定位 body.slug，type platform_type_slug_exists；其他 constraint 原样抛出 | 正确的 constraint-name 样例。create/update 成功路径只有 commit :397/:498，当前未观察到成功 AuditLog。 |
| content_planning.py:340-344，create_platform_profile() (:304-346) | routers/planning.py:232-235，createPlatformProfile；profile schema 含 slug | 先查询 slug 并返回 PLATFORM_SLUG_EXISTS (:319-320)；flush :339 后捕获，rollback :341，再按 slug 查询 :342-343，存在则返回同 code 409、details 空，否则原样抛出 | 不符合当前 spec 的 post-rollback re-query：未读取 constraint identity，可能把同时存在的同名行误当作本次 IntegrityError 原因；成功 commit :345，无成功审计。 |
| platform_configuration.py:633-637，create_platform_prompt() (:615-652) | routers/configuration.py:499-506，createPlatformPrompt；prompt name/body schema | flush 后 broad catch；rollback :634 后查询 name :635-636，找到则 PLATFORM_PROMPT_NAME_EXISTS, 409、details 空，否则原样抛出 | 未按 constraint name 识别的 re-query 映射；未知 FK/CHECK/其他 unique 若恰有同名行会被误报。成功审计 :638-651、commit :652。 |
| platform_configuration.py:701-713，update_platform_prompt() (:656-742) | routers/configuration.py:536-542，updatePlatformPrompt；含 expected_revision、可改 name | rollback :702 后按排除当前 id 的 name 查询 :703-712，命中返回 PLATFORM_PROMPT_NAME_EXISTS, 409、details 空；未命中原样抛出 | 与 create 相同的宽映射风险；成功审计 :714-740、commit :741。 |
| content_production.py:496-511，create_humanization_job() (:440-516) | routers/production.py:243-250，createHumanizationJob；humanization request | _create_job() flush :386 失败后 rollback :497，以 idempotency key 查询 :498-500；精确相同 job 则返回既有 job，不同参数返回 IDEMPOTENCY_CONFLICT, 409，无 raced row 则 HUMANIZATION_ALREADY_ACTIVE, 409 | 事务处理顺序正确，但异常分类没有读取 diag.constraint_name，所以 FK/CHECK/其他 unique 也可能被误判为 humanization active；成功 commit :513 后 dispatch。 |
| publication.py:230-235，_flush_platform_account() (:227-235) | create_platform_account() :272-286 -> routers/publication.py:203-210，createPlatformAccount；update_platform_account() :290-313 -> :228-235，updatePlatformAccount；account identifier schema | 仅 uq_platform_accounts_profile_identifier_normalized 进入 rollback :233，抛 PLATFORM_ACCOUNT_IDENTIFIER_EXISTS, 409，details 的 body.account_identifier/type platform_account_identifier_exists（helper :191-224）；其他 constraint 原样抛出 | 正确样例；成功审计/事务由各调用方在 helper 后 commit :286/:313。 |

另有 identity.create_user() 的预检查和未捕获 flush：identity.py:399-427（createUser，router :224-231）先查 User.username，重复时主动返回 REVISION_CONFLICT (:402-403)，但最终 db.flush():412 仍可因 users.username unique、FK 或其他约束进入全局 handler；这不是唯一约束的稳定领域映射。成功审计 :413-425、commit :427。

### 4. 全部 flush / commit 触发面

以下清单是对 backend/app/**/*.py 全部 db.flush/commit 的完整结果；不含纯查询和没有写入的 router。每个 flush/commit 都可能把 ORM 待写状态在 PostgreSQL 最终约束处变成 IntegrityError（若迁移触发器自定义 SQLSTATE，则实际 SQLAlchemy wrapper 需真实 PG 验证）。括号中列出主要 HTTP operationId 或 worker。

#### 显式 flush（33 个）

| 文件 | 行号 | 符号 / 调用链 |
|---|---|---|
| identity.py | 412, 628 | create_user (createUser)、delete_user (deleteUser) |
| product_facts.py | 406, 467, 654, 706 | create_product/update_product、replace_product_facts (replaceProductFactsDraft)、submit_fact_review (submitProductFactReview) |
| publication.py | 229, 469, 546, 764, 875, 943, 972, 1436 | account helper；_finish_work_command（create/update/preparation/platform-review/result/switch/verify/close publication）；create_publication_work；verify_publication_work；open issue；repair task；resolve issue；_delete_task_core |
| content_planning.py | 207, 339, 400 | create_query_topic (createQueryTopic)、create_platform_profile、add_locked_content_task (createContentTask及 GEO task) |
| review.py | 385 | transition_content_version（submit/approve/requestContentVersionChanges） |
| geo_observation.py | 2460, 2642 | create_geo_observation (createGeoObservation)、_delete_manual_observation_chain (deleteGeoObservation) |
| ai_configuration.py | 487, 699 | create_ai_channel (createAIChannel)、create_ai_model (createAIModel) |
| platform_configuration.py | 404, 632, 700, 776, 896, 984 | platform type helper/create/update；prompt create/update；put_content_humanization_prompt；update_platform_profile；delete_platform_profile |
| content_production.py | 386, 687, 857, 864 | _create_job（createGenerationJob/createHumanizationJob/retryGenerationJob）；_create_human_content（manual/revision）；delete_content_draft |
| generation.py | 439 | process_generation_job worker 创建 ContentVersion |

#### 全部 commit（87 个，按文件/行号）

这是完整行号清单；符号可由同文件 function inventory 精确定位，关键 HTTP operationId 在第 5 节映射。

    identity.py: 327,350,357,396,427,553,590,649,689
    product_facts.py: 423,484,557,630,656,715
    publication.py: 286,313,332,375,472,877,944,974,1176,1481,1496,1529,1587,1640
    content_planning.py: 222,260,301,345,442
    review.py: 336,411
    file_records.py: 104,134,144,150,166
    ai_configuration.py: 507,539,587,636,677,714,745,798,834,877,920,944,970,993,1014,1053
    platform_configuration.py: 386,397,498,544,652,741,791,846,899,986
    content_production.py: 434,513,601,717,752,813,879,923
    geo_observation.py: 2333,2474,2590
    generation.py: 360,370,379,383,463,486
    platform_logo_files.py: 151,190,224

其中 generation.py:360,370,379,383,463,486 是 Celery worker 的状态/结果事务，不是 HTTP response 的直接 commit；file_records.py:134,144 是上传失败状态的显式提交；platform_logo_files.py:151 是 candidate failed 状态提交。它们仍是完整性错误的写入边界，不能只审查带 IntegrityError import 的 service。

### 5. 未捕获路径与 router operationId 投影

#### Identity、事实与规划

- createUser -> identity.create_user (identity.py:399-427)：用户名预检查只覆盖已存在行；flush:412 逃逸到全局 REVISION_CONFLICT 的 details 为空。login、logout、changePassword 分别在 identity.py:331-350、:354-357、:360-396 commit；Session 的 token_hash unique (models/identity.py:53-57) 和用户 FK 等异常均未本地映射。
- bulkUpdateUserStatus -> identity.py:557-590、updateUser -> :534-553、resetUserPassword -> :652-689：均无 Integrity catch，最终 commit 进入全局 handler。deleteUser 是唯一针对 user FK 的本地 SQLSTATE 分支。
- createProduct/updateProduct 是第 3 节的正确映射；deleteProduct commit product_facts.py:557；deleteFactVersion commit :630。replaceProductFactsDraft flush/commit :654/:656；submitProductFactReview flush/commit :706/:715，均无 catch。
- approveFactVersion、requestFactVersionChanges、retireFactVersion 通过 review.transition_fact_version (review.py:283-336) commit，无 Integrity catch；其中新增 review 记录的 FK/append-only 约束可能逃逸到全局。
- createQueryTopic flush/commit content_planning.py:207/222；updateQueryTopic commit :260；deleteQueryTopic commit :301。对应 planning.py:134-180，没有 Integrity catch。
- createPlatformProfile 是第 3 节宽 re-query catch。createContentTask (planning.py:288-301) 通过 add_locked_content_task 的 flush content_planning.py:400，成功 commit :442；ContentTask 的 idempotency unique、FK、open_requires_platform/archive CHECK (models/content.py:31-87) 未映射。createGeoOptimizationContentTask 也调用相同 helper，geo_observation.py:2201-2333 commit :2333，共享同一未捕获 flush 路径。

#### 内容生产与 review

- createGenerationJob (production.py:220)、retryGenerationJob (:312) 和 createHumanizationJob (:247) 都调用 content_production._create_job 的 flush:386；只有 humanization 在 :496 捕获。前者及 retry 的异常进入全局 REVISION_CONFLICT；后者可能错误映射为 active/idempotency 冲突。对应成功 commit :434/:601/:513。
- createManualContentVersion (production.py:358) 与 createContentRevision (:495) 调用 _create_human_content，flush content_production.py:687 后分别 commit :717/:752，无 catch。ContentVersion 的 (task_id,version)、source_job_id、partial approved/pending unique 和状态 CHECK (models/content.py:95-149) 都可能落入全局 handler。
- updateContentDraft commit content_production.py:813；deleteContentDraft flush :857/:864、commit :879；abandonContentVersion commit :923，均无 Integrity catch。submit/approve/request routes (production.py:544-595) 经 review.transition_content_version，先在 review.py:385 flush 前一版本状态，再 commit:411；若后续 review insert/约束失败，依赖回滚会撤销前一状态 flush。
- generation.process_generation_job (generation.py:339-495) 在 worker 中 flush:439 写内容；外层 except Exception (:473-486) rollback 后把 job 标为 FAILED，写入 error_code（AppError 保留业务 code，否则 GENERATION_FAILED），再 commit :486。因此 worker 的 ContentVersion IntegrityError 不到 HTTP 全局 handler，也不产生成功内容/修订；失败状态 commit 本身若失败则无额外本地恢复。

#### 配置、AI、发布、文件、GEO

- createPlatformType/updatePlatformType 使用正确的 uq_platform_types_slug helper；deletePlatformType commit platform_configuration.py:544。createPlatformPrompt/updatePlatformPrompt 使用第 3 节宽 re-query catch；putContentHumanizationPrompt flush/commit :776/:791；updatePlatformProfile flush/commit :896/:899；deletePlatformProfile flush/commit :984/:986；profile enable/disable commits :386 (set_platform_profile_enabled)。除三处 catch 外均会落入全局。
- AI service 没有任何 IntegrityError import/catch。createAIChannel flush/commit ai_configuration.py:487/507；header create/update/delete commits :587/:636/:677；createAIModel flush/commit :699/:714；model/channel update、key replacement、enable/disable、delete、discover/test 都在 :539,745,798,834,877,920,944,970,993,1014,1053 commit。AI channel/header/model 的 unique、FK、protocol/timeout/status CHECK (models/ai_generation.py:29-128) 若失败均由全局 handler 变成空 details REVISION_CONFLICT。
- createPlatformAccount/updatePlatformAccount 使用正确 helper；enable/disable/delete commit publication.py:332/:375。createPublicationWork (publication.py:476-555，flush :546，_finish_work_command :469/:472) 以及 preparation/platform review/result/content-version switch/close (routers/publication.py:429-562) 都无 Integrity catch。PublicationWork 的 idempotency/content-task unique、partial active unique、FK/CHECK (models/publication.py:64-145) 可能进入全局。
- verifyPublicationWork flush publication.py:764 后加入 PublishedArticle 并走 _finish_work_command；一条事务中 PublicationVerification partial unique、PublishedArticle verification FK/unique 失败会回滚，不产生成功 audit/event。openPublishedContentIssue、createPublishedContentRepairTask、resolvePublishedContentIssue 分别 flush/commit :875/:877、:943/:944、:972/:974，对应 operationId 为 routers/publication.py:666、:761、:788，问题的 one-open/source-task unique 和 CHECK 未映射。
- Published article/task permanent delete 和生命周期 command (publication.py:1097-1176, :1400-1640) 在 commit :1176,:1481,:1496,:1529,:1587,:1640 或 task core flush :1436；服务端已有 row lock、引用/生命周期预检和迁移触发器，但不存在 Integrity catch。未知 FK/unique 仍落入全局；迁移自定义错误可能并非 IntegrityError（见第 6 节）。
- createFileUploadIntent/completeFileUpload/abortFileUpload (routers/files.py:40-90) 经 file_records.py commits :104,:134,:144,:150,:166，无 catch。FileRecord.object_key unique、uploader FK/CHECK (models/geo_files.py:98-106) 是潜在完整性边界；失败状态 commit 是设计中的显式状态转换。
- createPlatformLogoCandidate (routers/configuration.py:588) 经 platform_logo_files.py:154-224，初始/验证 commit :190/:224，失败 commit :151，无 Integrity catch；底层 FileRecord 约束错误进入全局。
- createGeoObservation (routers/observation.py:333) 在 geo_observation.py:2378-2474 flush/commit :2460/:2474；观测 publication/attachment composite PK、FK (models/geo_files.py:77-85,119-125) 失败进入全局。deleteGeoObservation (observation.py:294) 经 :2557-2590 commit，删除链内部 flush :2642，无 catch。

### 6. 当前模型/迁移约束和错误类型边界

已核对当前 ORM model 与最新迁移中仍存在的约束，未按旧迁移中已删除的约束添加映射：

| 领域 | 当前约束证据 | 可触发路径 | 当前映射结论 |
|---|---|---|---|
| User/session/audit | models/identity.py:33-57,74-100：username unique、session token_hash unique、FK、audit CHECK/FK | create/login/logout/user mutations/audit append | 只有 delete user 的 23503 被本地转 USER_IN_USE；其余全局 REVISION_CONFLICT。 |
| Product/facts | models/product_facts.py:30-38,63-115：normalized identity unique、fact version product/version unique、FK/CHECK | create/update product、fact draft/version/review | product identity 是正确精确映射；facts 写入和 review 未映射。 |
| Platform config/profile | models/configuration.py:46,66,84,103-122：type slug、prompt name、singleton/check、profile slug/logo/FK | platform type/prompt/profile/humanization prompt | type helper 精确；prompt/profile 的 broad re-query 或无 catch；unknown 仍可能统一 REVISION_CONFLICT。 |
| Content task/version/job | models/content.py:31-149,171-209：task idempotency、version composite/partial unique、FK/CHECK | planning, generation, human content, review | humanization broad catch 是最大误分类点；其他最终约束全局化。 |
| AI | models/ai_generation.py:29-128：header/model composite unique、FK/CHECK | all AI config operationId | 没有本地 IntegrityError 路径。 |
| Publication | models/publication.py:31-49,64-145,178-190,215-255,279-290：account normalized unique、work unique/partial/CHECK、verification/article/issue/attachment unique/FK | account/work/verify/issue/repair/delete | account 精确；其余最终约束全局化。 |
| Files/GEO | models/geo_files.py:77-85,98-106,119-125 | upload/logo/observation | 无本地 catch；全局映射。 |

迁移中的关键保护也已核对：0037_simplify_deletion_lifecycle.py:130-145 创建 content task/publication checks，:148-235 调整关系 FK，:238-354 和 :358-475 创建不可变/删除保护触发器；0043_geo_insight_platform_identity.py:21-99,136-158 的 publication guard 与 platform snapshot guard 显式使用 ERRCODE 55000 或 23514；0027_guard_audit_actor_user_delete.py:17-33 的 audit actor guard 使用 55000。这类 PL/pgSQL RAISE EXCEPTION 的 SQLAlchemy 异常包装类型/driver 字段需真实 PostgreSQL integration 验证，不能从迁移文本猜测为必然 IntegrityError。普通 PostgreSQL unique/FK/CHECK 通常是 23505/23503/23514，但本审计未运行真实数据库重现。

### 7. 成功审计、事件、修订与部分写入风险

- 业务 service 通常把 success audit/event/revision 写入排在成功 flush 后、同一 commit 前：如 product product_facts.py:409-423，user delete identity.py:635-649，platform prompt platform_configuration.py:638-652，account 通过 publication helper 后 commit。对这些路径，known catch 的 rollback 不会留下成功审计或事件。
- publication._work_event() 在 publication.py:421-457 追加工作事件，_finish_work_command() 在 :468-472 flush/commit；publication create/verify 先写主记录并在同一事务加入事件。其任一 IntegrityError 未捕获时，依赖 rollback 会撤销主记录、事件及待审计写入；没有 savepoint 或中间 commit。
- review.transition_content_version() 在 review.py:385 先 flush 旧版本状态、随后写 review 并在 :411 commit。后续完整性失败时整个 request rollback，故不会留下只改状态未写 review 的部分提交。
- create_publication_work() 的初始对象 flush :546 后仍在 _finish_work_command 再 flush/commit；这不是中间 commit。create_geo_optimization_content_task() 在调用 add_locked_content_task (content_planning.py:400) 后继续加 source 并在 geo_observation.py:2333 commit，同一事务。
- generation worker 在 generation.py:360-383 先提交 job 状态（如 queued/running 等），再外部生成；成功内容写入 flush :439、commit :463，失败 rollback 后将 FAILED commit :486。这是跨事务 worker 状态设计，不是 HTTP 请求的部分成功；但任务状态 commit 已发生时，后续生成 IntegrityError 不能由同一 rollback 撤销早先状态提交。
- replace_product_facts() (product_facts.py:633-656) 和 add_locked_content_task() (content_planning.py:380-442) 观察到没有 append_audit；platform type/profile create/update 也只有 commit，没有观察到 success AuditLog。此处仅记录当前行为，不能推断业务是否要求补审计。

### 8. 正确样例、REVISION_CONFLICT 泄漏面与建议给主 agent

正确样例是 product identity、platform type slug、platform account identifier：均在 flush 边界检查已确认 diag.constraint_name，rollback 后抛稳定领域 code；product/account 还提供字段 details。identity.delete_user 是按已知 SQLSTATE 23503 的窄 FK 业务特例，未知 SQLSTATE 不吞。

仍可能落入全局 REVISION_CONFLICT 的面非常广：identity.create_user 的最终 username flush、content task/job/version、fact version/review、AI 全部 commit/flush、publication work/verification/issues、file/GEO，以及所有未列入本地 catch 的普通 FK/CHECK/unique。全局 handler 当前不区分 revision stale、唯一标识冲突、资源被引用和内部数据库故障；details 为空，违反当前错误处理 spec 对已确认字段冲突和未知异常的区分。

尤其需要主 agent 保留并单独评估：

1. create_humanization_job 的 catch 在 rollback 后靠“是否能查到 raced row”分类，未核对约束身份，可能返回 HUMANIZATION_ALREADY_ACTIVE/IDEMPOTENCY_CONFLICT。
2. create_platform_profile、create_platform_prompt、update_platform_prompt 在 rollback 后 re-query name/slug；这能把未知约束误归为已存在，且 details 不能定位字段。
3. 所有未捕获异常目前都由 errors.py:76-78 统一返回 REVISION_CONFLICT；应保持未知错误不被 service 猜测；若保留全局安全 envelope，需由主任务决定其 status/code 契约，但不能让它成为所有已知领域冲突的唯一 owner。
4. 任何新增映射应只放在实际拥有写入/事务的 service 边界，以 constraint name 或已确认 SQLSTATE 为键；不能只加强预检查，也不能解析 str(error)。

## Caveats / Not Found

- 本次是静态只读审计，未连接真实 PostgreSQL，也未执行并发 duplicate、FK/CHECK、触发器 sentinel；不能声称每个迁移 RAISE EXCEPTION 在当前 psycopg/SQLAlchemy 版本必然包装成 IntegrityError，需由 integration gate 验证 orig.diag.constraint_name/sqlstate。
- 迁移历史含已被后续版本删除或替换的约束/触发器；本文件只把当前 ORM 和最新仍安装的迁移作为映射依据，不对旧约束名称建立兼容猜测。
- db.commit() 会隐式 flush，因此没有显式 flush 的所有 commit 仍是完整性边界；worker 和上传失败路径的多次 commit 是有意的状态机边界，需按各自事务语义测试。
- 未发现 savepoint、nested transaction、SAVEPOINT 或 begin_nested；当前所有本地恢复都是整事务 rollback()，不存在局部回滚保护。
- 未发现后端测试直接构造 IntegrityError、断言 global handler 的 details，或验证已知 constraint 的字段定位；现有 REVISION_CONFLICT 测试验证的是预检查/版本竞争，不覆盖本任务所需数据库约束错误域。
