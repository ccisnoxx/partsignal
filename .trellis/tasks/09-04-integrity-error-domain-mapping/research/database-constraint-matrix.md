# Research: Database constraint matrix

- Query: 全量审计 Alembic migration、运行时 ORM model、`contracts/database.md` 中的 PostgreSQL 约束，并将约束与 IntegrityError、service command、HTTP operationId 及诊断字段对齐。
- Scope: mixed（内部代码、迁移、数据库合同；不依赖外部数据库实例）
- Date: 2026-09-04

## Findings

### 1. 统计口径、范围和实际搜索

审计范围为 `backend/alembic/versions/0001..0043_*.py`（43 个线性 revision 文件）、`backend/app/models/*.py`（7 个运行时模型文件）、冻结模型 `backend/app/migration_schema_v1.py`、`backend/app/services/*.py`、`backend/app/routers/*.py`、`backend/app/errors.py`、`backend/app/main.py` 与 `contracts/database.md`。未把 `.venv`、`__pycache__`、缓存或生成物当作源代码约束。

实际使用的搜索式包括：

```text
rg -n --glob '*.py' --glob '!**/__pycache__/**' '(IntegrityError|UniqueConstraint|ForeignKeyConstraint|CheckConstraint|ExcludeConstraint|ForeignKey\\(|unique\\s*=|nullable\\s*=\\s*False|primary_key\\s*=\\s*True|Index\\(|create_(unique_)?index|CREATE (UNIQUE )?INDEX|add_constraint|create_check_constraint|create_foreign_key|create_unique_constraint|op\\.f)'
rg -n 'op\\.(create|drop|alter).*constraint|op\\.create_foreign_key|op\\.create_unique_constraint|op\\.create_check_constraint|create_(unique_)?index|ADD CONSTRAINT|CREATE (CONSTRAINT )?TRIGGER|CREATE UNIQUE INDEX'
rg -n 'operation_id=|@router\\.(get|post|put|patch|delete)' backend/app/routers
rg -n 'db\\.(flush|commit)\\(' backend/app/services
rg -n '^#{1,4} |constraint|Constraint|UNIQUE|unique|foreign key|FOREIGN KEY|CHECK|NOT NULL|EXCLUDE|trigger|index|索引|约束' contracts/database.md
```

#### 文件与规范索引

- `backend/alembic/versions/0001_identity_audit.py` 至 `0043_geo_insight_platform_identity.py`：完整线性 migration 链，共 43 个 revision 文件。
- `backend/app/models/*.py`、`backend/app/migration_schema_v1.py`、`backend/app/db.py`：运行时 ORM metadata、冻结迁移 metadata、naming convention 与当前表/约束来源。
- `backend/app/services/*.py`、`backend/app/routers/*.py`、`backend/app/errors.py`、`backend/app/main.py`：写入 owner、operationId、IntegrityError 捕获与全局边界。
- `contracts/database.md`：数据库迁移语义、当前不变量、FK/唯一性/不可变/删除合同。

相关项目规范为 `.trellis/spec/backend/database-guidelines.md`、`.trellis/spec/backend/error-handling.md`、`.trellis/spec/backend/quality-guidelines.md` 与 `.trellis/workflow.md`；它们要求 PostgreSQL 作为业务状态唯一来源、结构化 diagnostics、未知错误显式失败及真实数据库验证。

外部参考：本次没有使用外部网页、第三方文档或版本说明；结论仅基于上述仓库文件、静态 ORM metadata 枚举和 Alembic source/offline 试跑。驱动 diagnostics 的最终字段形状仍需真实 PostgreSQL integration sentinel 验证。

运行时 `Base.metadata`（`backend/app/db.py:17-25`，导入全部模型由 `backend/app/models/__init__.py:1-8` 完成）给出的当前 head 统计如下：

| 类别 | 数量 | 统计说明 |
|---|---:|---|
| 业务表 | 31 | 不含 `alembic_version`；含当前 ORM 注册表，不含已由 0025/0034 删除的旧表 |
| PRIMARY KEY | 31 | 每表一个，复合主键仍计一个约束 |
| FOREIGN KEY | 74 | 每个 `ForeignKeyConstraint` 计一个；复合 FK 若出现也按约束计数 |
| CHECK | 44 | ORM 当前 `CheckConstraint`；部分 DB 实际名字与 ORM naming convention 不同 |
| UNIQUE constraint | 18 | `UniqueConstraint`，包括可空列上的唯一约束（PostgreSQL 的 NULL 语义仍适用） |
| UNIQUE index | 8 | 仅统计 `Index(unique=True)`；不是 18 个全部索引 |
| 其他普通索引 | 10 | 普通索引不是完整性约束，但列入命名审计以免与唯一索引混淆 |
| NOT NULL | 242 | 列级、无独立 `constraint_name`；按非空列计数 |

因此，“表约束”总数为 **167**（31+74+44+18）；把唯一索引也算作唯一性权威时为 **175**；把列级 NOT NULL 也列入数据库边界时为 **417**，其展开口径是 **31 PK + 74 FK + 44 CHECK + 18 UNIQUE constraint + 8 UNIQUE index + 242 NOT NULL**。PK 列与 NOT NULL 列存在语义重叠（主键必然非空），但按用户要求分别审计，不能将二者去重后再报数。此外，迁移链定义了 **39 个最终 active trigger instance**（36 个普通 trigger、3 个 `CONSTRAINT TRIGGER`）；触发器不进入 `pg_constraint`，下文单独列出，不能与 167 混加为 PostgreSQL constraint 总数。`EXCLUDE` 未发现。

### 2. IntegrityError 路径与 operationId

全仓库静态发现 **9 个 `except IntegrityError` 语法位置**、**6 个 service 文件级 import**（catch 分布在 6 个 service 文件），按业务命令合并为 **7 类 service handling path**：用户删除、产品 identity、平台类型 slug、平台 profile slug、平台 Prompt name、平台账户 normalized identifier、自然化/幂等作业；另有 **1 个全局 handler**。`ai_configuration.py` 有大量 flush/commit，但没有 IntegrityError import/catch；`content_planning.py` 的 import 与 catch 只覆盖平台 profile 创建。

| 路径 | 精确位置 | 触发命令 / HTTP operationId | 当前识别与结果 | 评估 |
|---|---|---|---|---|
| 产品创建 | `backend/app/services/product_facts.py:47-57,395-423` | `create_product`；`createProduct`（`backend/app/routers/product_facts.py:108-123`） | 读取 `error.orig.diag.constraint_name`；仅 `uq_products_normalized_brand` → `PRODUCT_ALREADY_EXISTS`/409，`details.errors.loc=[body,brand/part_number]`；否则重新抛出 | 已有正确结构化唯一映射；rollback 在 helper 内 |
| 产品更新 | `product_facts.py:427-485`，catch `:467-469` | `update_product`；`updateProduct`（`product_facts.py:157-177`） | 复用同一 helper；唯一竞态正确，其他 CHECK/FK/NOT NULL 仍流向全局 | 已有正确映射，但未知失败当前错误地进入全局统一码 |
| 用户删除 | `identity.py:597-649`，catch `:627-633` | `delete_user`；`deleteUser`（`routers/identity.py:338-355`） | 仅看 `error.orig.sqlstate == '23503'` → rollback → `USER_IN_USE`/409；不看 `diag.constraint_name` | 业务上覆盖 RESTRICT FK，但 SQLSTATE 只能说明任意 FK，不能稳定区分具体业务引用；CHECK/其他 23503 之外失败显式上抛 |
| 平台类型创建/更新 | `platform_configuration.py:401-424`；调用 `:390-397,478-498` | `create_platform_type`/`update_platform_type`；`createPlatformType`/`updatePlatformType`（`routers/configuration.py:356-398`） | `diag.constraint_name == 'uq_platform_types_slug'` → `PLATFORM_TYPE_SLUG_EXISTS`/409，定位 `body.slug`；其他重新抛出 | 已有正确结构化唯一映射 |
| 平台 profile 创建 | `content_planning.py:304-346`，catch `:338-344` | `create_platform_profile`；`createPlatformProfile`（`routers/planning.py:228-242`） | rollback 后再查询同 slug；命中 → `PLATFORM_SLUG_EXISTS`/409，否则重新抛出 | 预检/竞态结果依赖查询而非 `constraint_name`；对未知错误正确不吞，但已知映射尚不满足结构化诊断要求 |
| 平台 Prompt 创建/更新 | `platform_configuration.py:615-742`，catch `:631-637,699-713` | `create_platform_prompt`/`update_platform_prompt`；`createPlatformPrompt`/`updatePlatformPrompt`（`routers/configuration.py:498-554`） | rollback 后重新按名称查询；命中 → `PLATFORM_PROMPT_NAME_EXISTS`/409，否则重新抛出 | 已知唯一竞态有结果，但识别依赖二次查询，不是约束诊断；更新失败后 rollback 也会丢失当前 Session 未提交状态 |
| 自然化作业 | `content_production.py:440-516`，catch `:496-511` | `create_humanization_job`；`createHumanizationJob`（`routers/production.py:243-262`） | rollback；若幂等键查询到同一任务 → 重放，否则不同幂等键 → `IDEMPOTENCY_CONFLICT`，查不到则直接假定活动自然化 → `HUMANIZATION_ALREADY_ACTIVE`/409 | 同时覆盖 idempotency UNIQUE 和 partial UNIQUE；没有读取 `diag.constraint_name`，未知 IntegrityError 会被伪装成活动自然化冲突 |
| 全局边界 | `backend/app/errors.py:76-79`; 注册于 `backend/app/main.py:259-261` | 所有未被 service 捕获的 operation | 固定 `REVISION_CONFLICT`/409，message `数据约束冲突` | 明确违反真实 revision、已知 constraint race、未知 IntegrityError 三分法；不能保留为当前公共语义 |

补充的写入点（虽未 catch，也可能在 flush/commit 触发约束或触发器）可由 `rg -n 'db\\.(flush|commit)\\(' backend/app/services` 复核：`identity.py:327-689`、`product_facts.py:406-715`、`platform_configuration.py:386-986`、`content_planning.py:207-442`、`content_production.py:386-923`、`publication.py:229-1640`、`ai_configuration.py:487-1053`、`geo_observation.py:2333-2642`、`review.py:336-411`、`file_records.py:104-166`、`platform_logo_files.py:151-224`、`generation.py:360-486`。这些命令的精确 owner 以对应 router 的 `operation_id` 为准；当前除上述 **7 类 service handling path** 外均由统一异常边界接管，故属于“可能错误落入全局 handler”路径。

### 3. 当前 head constraint-to-domain-error matrix

逐行规范化 companion matrix：[database-constraint-companion.csv](./database-constraint-companion.csv)。该 CSV 为每个当前 head PK/FK/CHECK/UNIQUE/UNIQUE INDEX/NOT NULL 及 39 个最终 active trigger instance 单列一行，共 456 条数据行、13 个字段；NOT NULL 使用 `not_null:<table>.<column>` 作为稳定审计键，并明确无数据库 `constraint_name`。

下面的矩阵以 **Alembic 最终创建/替换的数据库名称为 authority**；括号内是运行时 ORM metadata 推导出的名字。两者不同是实际发现，不是建议新增兼容别名。`model` 行号指向约束或字段声明，`migration` 行号指向建立/替换它的 migration，`contract` 行号指向 `contracts/database.md` 对该不变量的最近权威描述。

#### 3.1 PRIMARY KEY（31 个，其他）

为避免分组展示掩盖审计字段，以下所有约束矩阵行（包括压缩的 PK/FK/CHECK/NOT NULL 行；触发器“其他”表也沿用同一语义）统一采用这些字段语义；行内未重复的内容继承默认值，行内明确的 owner、诊断、code 或测试覆盖优先：

| 字段 | 覆盖全体矩阵行的默认分类/含义 |
|---|---|
| `current` | 当前行为：service 已映射、全局 handler、或未捕获后显式内部失败；不把静态建议写成现状。 |
| `precheck` | 业务查询/advisory lock/版本比较只能是竞态优化，不是完整性权威；无预检即记为“无/未发现”。 |
| `status` | PostgreSQL SQLSTATE（常见 `23505`/`23503`/`23502`/`23514`）或触发器 `55000`；未发生错误则说明正常级联/写入。 |
| `code` | 当前 AppError code；没有合同证据时写“尚无稳定 code/待决”，不得凭空新增。 |
| `details` | 只允许结构化、合同批准的字段定位；禁止依赖 `str(error)`、英文数据库文本或错误 substring。 |
| `target` | 目标表与列/谓词，即矩阵的 `table / columns` 或同等列描述。 |
| `transaction owner` | 触发写入的 service command/worker 及其顶层 Session owner；catch 后必须 rollback，批量/嵌套事务需评估 `begin_nested()`。 |
| `tests` | 必须以真实 PostgreSQL sentinel 验证 diagnostics、HTTP operationId、rollback 与无成功审计；仅 mock `IntegrityError` 不足。 |

下列表格为篇幅将这些字段折叠到“可能触发 owner / 当前与建议领域结果”等列；因此每一行均继承并覆盖以上 `current/precheck/status/code/details/target/transaction owner/tests` 字段，而不是遗漏字段。

| constraint_name | table / columns | migration / model / contract | 可能触发的写命令、诊断与结论 |
|---|---|---|---|
| `pk_<table>`（31 个） | `users.id`, `sessions.id`, `audit_logs.id`, `products.id`, `fact_versions.id`, `fact_review_records.id`, `query_topics.id`, `platform_profiles.id`, `content_tasks.id`, `generation_jobs.id`, `content_versions.id`, `content_review_records.id`, `platform_accounts.id`, `publication_works.id`, `publication_work_events.id`, `publication_verifications.id`, `published_articles.id`, `published_content_issues.id`, `geo_observations.id`, `geo_observation_citations.id`, `file_records.id`, `platform_types.id`, `platform_prompts.id`, `content_humanization_prompts.id`, `ai_channels.id`, `ai_channel_headers.id`, `ai_models.id`, `content_task_geo_sources.content_task_id`, `publication_attachments.(publication_work_id,file_id)`, `geo_observation_publications.(observation_id,published_article_id)`, `geo_observation_attachments.(observation_id,file_id)` | 初始/重建表定义分别见 `migration_schema_v1.py:49,65,73-76,84,105,127,157,174,211,239,257,271,284,297,309,334,352,366,377,394,430,480,523,541,554,580,600,632,648,661,686,699`、`alembic/versions/0034_publication_workflow_redesign.py:137,186,224,249,316,346-350`、`0035_business_workflow_primary_tasks.py:200-254`；当前字段见 `models/identity.py:35,52,97`、`product_facts.py:39,81,107`、`configuration.py:30,44,64,85,109`、`content.py:46,116,157,189`、`ai_generation.py:45,87,109,179`、`publication.py:51,108,153,192,217,257,289`、`geo_files.py:28,63,79,95,121`；contract `database.md:409-460` 的各聚合约束 | `current`：无 service mapper，落全局；`precheck`：无（UUID default 使冲突通常不可达）；`status`：`23505` + `diag.constraint_name` 通常可稳定识别；`code/details`：尚无 PK 专用 code，禁止映射 `REVISION_CONFLICT` 或泄漏 DB details；`target`：本行列出的 PK；`transaction owner`：对应 create* service/worker；`tests`：真实 PG 重复 UUID sentinel + rollback/no-success-audit。 |

说明：上表按同一命名模式压缩展示 31 行，计数仍为 31；`roles`、`user_roles`、旧 publication 表等仅存在于历史 revision，不计当前 head。

#### 3.2 UNIQUE constraint（18 个）与 UNIQUE index（8 个）

| constraint_name（数据库） | table / columns 或 predicate | 类型；migration / model / contract | 可能触发 owner / 当前与建议领域结果 |
|---|---|---|---|
| `uq_users_username` | `users(username)` | UNIQUE；`migration_schema_v1.py:50` / `models/identity.py:36` / `database.md:73-75` | `createUser`：当前无 service catch，未知全局 `REVISION_CONFLICT`；建议新增经 `diag.constraint_name` 精确映射的用户名称重复错误，合同尚无 code，需先完成 T3-C 决策；仅当获批结果实际改变 wire/status/schema 时才修改 OpenAPI |
| `uq_sessions_token_hash` | `sessions(token_hash)` | UNIQUE；`migration_schema_v1.py:85` / `models/identity.py:53` / `database.md:73` | `login`：随机 token collision 理论可达，当前全局；未知/内部 sentinel，不应伪装 revision |
| `uq_products_normalized_brand` | `products(normalized_brand,normalized_part_number)` | UNIQUE；`migration_schema_v1.py:124`、`product_facts.py:32` / `models/product_facts.py:32` / `database.md:411` | `createProduct`,`updateProduct`：已正确 → `PRODUCT_ALREADY_EXISTS`/409，`details.errors` 定位 body identity |
| `uq_fact_versions_product_id` | `fact_versions(product_id,version)` | UNIQUE；`migration_schema_v1.py:304-314`（元数据 `UniqueConstraint` 在 :308）、`backend/alembic/versions/0034_publication_workflow_redesign.py` 前继承 / `models/product_facts.py:65` / `database.md:413-416` | `submitProductFactReview`、审核/版本创建：服务锁 owner 分配版本但并发 sentinel 仍可能触发；当前全局，建议按约束 owner 明确 version allocation conflict 或证明不可达 |
| `uq_platform_types_slug` | `platform_types(slug)` | UNIQUE；`0009_config_center.py:57-60` / `models/configuration.py:46` / `database.md:77` | `createPlatformType`,`updatePlatformType`：已正确 → `PLATFORM_TYPE_SLUG_EXISTS`/409，`body.slug` |
| `uq_platform_profiles_slug` | `platform_profiles(slug)` | UNIQUE；`0003_content_planning.py:3-16` + `migration_schema_v1.py:362-370` / `models/configuration.py:111` / `database.md:193-201` | 仅 `createPlatformProfile` 写 slug：当前预检并在 catch 后按 slug 二次查询，未读 diagnostics；建议只在该 conname 命中时映射现有 `PLATFORM_SLUG_EXISTS`；更新 schema 不含 slug，故只有创建命令是 owner |
| `uq_platform_prompt_templates_name` | `platform_prompts(name)` | UNIQUE；`0031_reusable_platform_prompts.py:16-44,114-115` / `models/configuration.py:66` / `database.md:281-285` | `createPlatformPrompt`,`updatePlatformPrompt`：当前预检并在 catch 后按 name 二次查询，未读 diagnostics；建议只按真实 DB name 精确映射现有 `PLATFORM_PROMPT_NAME_EXISTS` |
| `uq_file_records_object_key` | `file_records(object_key)` | UNIQUE；`migration_schema_v1.py:657-669`（字段/unique 在 :664） / `models/geo_files.py:98` / `database.md:65-69,431-432` | `createFileUploadIntent`,`completeFileUpload`：当前全局；object key 通常由服务生成，未知 IntegrityError 必须内部失败 |
| `uq_generation_jobs_idempotency_key` | `generation_jobs(idempotency_key)` | UNIQUE；`0004_content_production.py:3-16` + `migration_schema_v1.py:426-435`（字段/unique 在 :434） / `models/ai_generation.py:183` / `database.md:43,81` | `_create_job` 的三个 HTTP caller `createGenerationJob`,`createHumanizationJob`,`retryGenerationJob` 都先按 key/payload 预检；只有 create humanization 当前宽 catch 且未区分约束。建议仅在该 conname 后按 payload决定重放或现有 `IDEMPOTENCY_CONFLICT` |
| `uq_content_tasks_idempotency_key` | `content_tasks(idempotency_key)`，历史 NULL 不冲突 | UNIQUE；`0032_content_task_idempotency.py:15-23` / `models/content.py:33,76` / `database.md:37,412` | `createContentTask`：同键由 advisory lock 预检；当前无 catch，未知全局；建议已知重复区分同载荷重放与异载荷 `IDEMPOTENCY_CONFLICT` |
| `uq_content_tasks_source_published_content_issue_id` | `content_tasks(source_published_content_issue_id)` | UNIQUE；`backend/alembic/versions/0034_publication_workflow_redesign.py:724-727` / `models/content.py:72-74` / `database.md:301,454` | `createPublishedContentRepairTask`：服务锁 issue；竞态当前全局，建议映射 repair task already exists（合同尚无稳定 code） |
| `uq_content_versions_task_id` | `content_versions(task_id,version)` | UNIQUE；初始 frozen schema、`models/content.py:96` / `database.md:413-420` | `createManualContentVersion`,`createContentRevision` 经 `_create_human_content` INSERT，`generation.process_generation_job` worker INSERT；owner 锁 task 后分配版本。未知失败不可伪装 revision conflict |
| `uq_content_versions_source_job_id` | `content_versions(source_job_id)` | UNIQUE；初始 frozen schema、`models/content.py:97` / `database.md:43,418,421` | worker `generation.py:439-486`、内容版本创建：防止一作业多草稿；当前全局；建议按 source job duplicate 显式内部/业务错误 |
| `uq_publication_works_idempotency_key` | `publication_works(idempotency_key)` | UNIQUE；`0034_publication_workflow_redesign.py:138-141` / `models/publication.py:66,109` / `database.md:55,447` | `createPublicationWork`：advisory lock + 载荷重放；当前无 catch，建议同键同载荷重放、异载荷 `IDEMPOTENCY_CONFLICT` |
| `uq_publication_works_content_task_id` | `publication_works(content_task_id)` | UNIQUE；`0035_business_workflow_primary_tasks.py:116-121` / `models/publication.py:67,110` / `database.md:447` | `createPublicationWork`：一任务一 work，当前全局；应映射已有 publication work（合同 code 待决策） |
| `uq_published_articles_verification_id` | `published_articles(verification_id)` | UNIQUE；`0034_publication_workflow_redesign.py:250-253` / `models/publication.py:221-224` / `database.md:451-453` | `verifyPublicationWork`：完成触发器与 service 同事务创建；当前全局，竞态 sentinel 必须证明仅一个 article |
| `uq_ai_channel_headers_channel_id` | `ai_channel_headers(channel_id,normalized_name)` | UNIQUE；`0009_config_center.py:197` / `models/ai_generation.py:76` / `database.md:79` | `createAIChannelHeader`,`updateAIChannelHeader`：当前全局；建议 `AI_CHANNEL_HEADER_NAME_EXISTS`（合同尚无 code） |
| `uq_ai_models_channel_id` | `ai_models(channel_id,model_id)` | UNIQUE；`0009_config_center.py:233` / `models/ai_generation.py:103` / `database.md:79` | `createAIModel`,`updateAIModel`：当前全局；建议模型身份重复 code（合同尚无） |
| `uq_platform_accounts_profile_identifier_normalized` | unique expression `(platform_profile_id,lower(btrim(account_identifier)))` | UNIQUE INDEX；`0026_publication_account_dedup.py:66-71` / `models/publication.py:39-48` / `database.md:201,446` | `createPlatformAccount`,`updatePlatformAccount`：`publication.py:227-235` 已按 `diag.constraint_name` → `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`/409，定位 `body.account_identifier` |
| `uq_fact_versions_one_pending_per_product` | partial unique `fact_versions(product_id)` WHERE `status='PENDING_REVIEW'` | UNIQUE INDEX；`0035_business_workflow_primary_tasks.py:174-185` / `models/product_facts.py:74-79` / `database.md:416,309` | `submitProductFactReview`：当前全局；建议 `FACT_REVIEW_ALREADY_PENDING`（合同尚无稳定 code），不是 revision conflict |
| `uq_content_versions_one_pending_per_task` | partial unique `content_versions(task_id)` WHERE `status='PENDING_REVIEW'` | UNIQUE INDEX；`0035_business_workflow_primary_tasks.py:186-198` / `models/content.py:104-108` / `database.md:420,311` | `submitContentVersion` / revision flow：当前全局；建议 pending review conflict（合同尚无 code） |
| `uq_content_versions_one_approved_per_task` | partial unique `content_versions(task_id)` WHERE `status='APPROVED'` | UNIQUE INDEX；初始 frozen schema + current model `content.py:99-103` / `database.md:418-420` | `approveContentVersion`：事务 supersede 旧批准版本；当前全局，异常必须回滚整批 |
| `uq_generation_jobs_active_humanization_source` | partial unique `generation_jobs(source_content_version_id)` WHERE `job_type='HUMANIZE' AND status IN ('PENDING','RUNNING')` | UNIQUE INDEX；`0017_content_humanization.py:65-71` / `models/ai_generation.py:166-175` / `database.md:129` | `_create_job` 的 `createHumanizationJob` 与 HUMANIZE `retryGenerationJob` 都会写入该谓词；两者都有活动作业预检，只有 create 当前把无幂等命中的任意 IntegrityError 猜成 `HUMANIZATION_ALREADY_ACTIVE`，retry 无 catch。只能在该 index 诊断时映射现有码 |
| `uq_publication_verifications_one_passed` | partial unique `publication_verifications(publication_work_id)` WHERE `outcome='PASSED'` | UNIQUE INDEX；`0034_publication_workflow_redesign.py:226-232` / `models/publication.py:185-190` / `database.md:450-451` | `verifyPublicationWork`：仅首个 PASSED；当前全局，数据库最终权威应与完成触发器共同证明 |
| `uq_publication_works_active_platform_hash` | partial unique `(platform_profile_id,content_hash)` WHERE `status <> 'CLOSED'` | UNIQUE INDEX；`0034_publication_workflow_redesign.py:147-153` / `models/publication.py:99-105` / `database.md:447-448` | `createPublicationWork`：同平台内容的活动 work 竞态，当前全局；建议已有 work/identity conflict code（合同待定） |
| `uq_published_content_issues_one_open` | partial unique `published_content_issues(published_article_id)` WHERE `status='OPEN'` | UNIQUE INDEX；`0034_publication_workflow_redesign.py:318-324` / `models/publication.py:249-254` / `database.md:303,454` | `openPublishedContentIssue`：当前全局；建议 `PUBLISHED_CONTENT_ISSUE_ALREADY_OPEN`（合同待定） |

注：上表 18 个 UNIQUE constraint + 8 个 UNIQUE index 共 26 个唯一性 enforcement；排版按一行一个约束。普通索引 10 个（例如 `ix_generation_jobs_ai_channel_created_at`、`ix_content_tasks_*`、`ix_audit_logs_*`）只影响查询，不应进入 IntegrityError mapper。

#### 3.3 FOREIGN KEY（74 个）

以下按表压缩展示；每个 `<db_name>: column → target [ondelete]` 是一条独立 FK，合计 74。括号中的 ORM 名称仅在有差异时显示。migration 行是当前 head 创建/替换 owner；早期同名 FK 由 `migration_schema_v1.py` naming convention 建立。

| table | constraint_name: columns → referenced table/column | 类型、精确来源、命令 owner / 诊断 |
|---|---|---|
| `ai_channel_headers` | `fk_ai_channel_headers_channel_id_ai_channels`: channel_id → ai_channels.id [CASCADE] | FK；`0009_config_center.py:183-197` / `models/ai_generation.py:75-91` / contract `database.md:79`；create/update/delete AI channel header、channel deletion。23503 + diag constraint_name 可稳定识别；级联删除通常不是错误 |
| `ai_channels` | `fk_ai_channels_created_by_users`: created_by → users.id [RESTRICT] | `0009_config_center.py:163-180` / `models/ai_generation.py:33-59`；`createAIChannel`。未知 actor 只应显式内部失败 |
| `ai_models` | `fk_ai_models_channel_id_ai_channels`: channel_id → ai_channels.id [CASCADE]; `fk_ai_models_created_by_users`: created_by → users.id [RESTRICT] | `0009_config_center.py:208-234` / `models/ai_generation.py:102-124`；create/update/delete/test model；23503 可稳定识别具体 FK |
| `audit_logs` | `fk_audit_logs_actor_id_users`: actor_id → users.id [SET NULL] | `0001_identity_audit.py:1-120` frozen schema、`models/identity.py:73-109`；所有 append audit。`database.md:424,460`；actor 删除是受控 SET NULL，不应映射 USER_IN_USE |
| `content_humanization_prompts` | `fk_content_humanization_prompts_updated_by_users`: updated_by → users.id [RESTRICT] | `0017_content_humanization.py:16-36`（实际迁移名 `fk_content_humanization_prompts_updated_by_users`）/ `models/configuration.py:84-91`；`putContentHumanizationPrompt` |
| `content_review_records` | content_version_id → content_versions.id [RESTRICT]; actor_id → users.id [RESTRICT] | frozen schema、`models/content.py:153-168`；所有 review append/delete aggregate；`database.md:418,455`；FK 23503 只表示引用失败，不能统一 revision |
| `content_task_geo_sources` | `fk_content_task_geo_sources_task`: content_task_id → content_tasks.id [RESTRICT]; `fk_content_task_geo_sources_article`: published_article_id → published_articles.id [SET NULL]; `fk_content_task_geo_sources_topic`: query_topic_id → query_topics.id [RESTRICT]; `fk_content_task_geo_sources_actor`: created_by → users.id [RESTRICT] | `backend/alembic/versions/0035_business_workflow_primary_tasks.py:200-254` / `models/content.py:171-208`；`createGeoOptimizationContentTask`、task/article/topic/user deletion。ORM 名为 `fk_content_task_geo_sources_*_<target>`，DB 使用 migration short names；contract `database.md:315,459` |
| `content_tasks` | `fk_content_tasks_query_topic_id_query_topics`: query_topic_id → query_topics.id [RESTRICT]; `fk_content_tasks_product_id_products`: product_id → products.id [RESTRICT]; `fk_content_tasks_fact_version_id_fact_versions`: fact_version_id → fact_versions.id [RESTRICT]; `fk_content_tasks_current_content_version_id`: current_content_version_id → content_versions.id [RESTRICT]; `fk_content_tasks_created_by_users`: created_by → users.id [RESTRICT]; `fk_content_tasks_platform_profile_id`: platform_profile_id → platform_profiles.id [SET NULL]（ORM 长名）；`fk_content_tasks_published_issue`: source_published_content_issue_id → published_content_issues.id [SET NULL]（ORM 长名） | `0025_markdown_facts_direct_platform.py:528-541`、`backend/alembic/versions/0035_business_workflow_primary_tasks.py:67-90`、`backend/alembic/versions/0034_publication_workflow_redesign.py:716-728`、`0037_simplify_deletion_lifecycle.py:150-171` / `models/content.py:47-84`；`createContentTask`,`createPublishedContentRepairTask`, current-pointer writes, aggregate delete. Contract `database.md:37,419,434-435` |
| `content_versions` | based_on_id → content_versions.id [RESTRICT]; task_id → content_tasks.id [RESTRICT]; fact_version_id → fact_versions.id [RESTRICT]; source_job_id → generation_jobs.id [RESTRICT]; created_by → users.id [RESTRICT] | frozen schema / `models/content.py:95-148`; manual/AI/revision/humanization/content delete；`database.md:43,418,421` |
| `fact_review_records` | fact_version_id → fact_versions.id [RESTRICT]; actor_id → users.id [RESTRICT] | frozen schema / `models/product_facts.py:103-116`; fact review/delete version；`database.md:417,455` |
| `fact_versions` | product_id → products.id [RESTRICT]; created_by → users.id [RESTRICT]; approved_by → users.id [RESTRICT] | frozen schema / `models/product_facts.py:64-100`; submit/approve/retire/delete product/user；`database.md:416-417,434` |
| `file_records` | uploader_id → users.id [RESTRICT] | frozen schema / `models/geo_files.py:91-113`; file commands and user deletion |
| `generation_jobs` | content_task_id → content_tasks.id [RESTRICT]; content_version_id → content_versions.id [RESTRICT]; source_content_version_id → content_versions.id [RESTRICT]; retry_of_id → generation_jobs.id [RESTRICT]; ai_channel_id → ai_channels.id [SET NULL]; ai_model_id → ai_models.id [SET NULL]; created_by → users.id [RESTRICT] | initial/follow-up `0009_config_center.py:244-252` and model `models/ai_generation.py:132-228`; `createGenerationJob`,`createHumanizationJob`,`retryGenerationJob`, worker, task/channel/model deletes. DB actual AI FK names are short (`fk_generation_jobs_ai_channel_id`, `fk_generation_jobs_ai_model_id`) while ORM names are long. Contract `database.md:81,436-440` |
| `geo_observation_attachments` | observation_id → geo_observations.id [RESTRICT]; file_id → file_records.id [RESTRICT] | `0008_files.py:20-30`、`migration_schema_v1.py:694-704` / `models/geo_files.py:116-125`; `createGeoObservation`, file cleanup, manual chain deletion；`database.md:69,267-269,432` |
| `geo_observation_citations` | observation_id → geo_observations.id [RESTRICT]; `fk_geo_citations_published_article`: published_article_id → published_articles.id [SET NULL]（ORM 长名） | original frozen FK + `backend/alembic/versions/0034_publication_workflow_redesign.py:729-736`, `0037_simplify_deletion_lifecycle.py:194-199` / `models/geo_files.py:59-71`; observation creation/deletion, article delete；`database.md:305,333` |
| `geo_observation_publications` | observation_id → geo_observations.id [RESTRICT]; `fk_geo_publications_published_article`: published_article_id → published_articles.id [CASCADE]（ORM 长名） | original frozen FK + `backend/alembic/versions/0034_publication_workflow_redesign.py:737-743`, `0037_simplify_deletion_lifecycle.py:200-206` / `models/geo_files.py:74-88`; manual observation/article aggregate delete；`database.md:305,333,457-458` |
| `geo_observations` | product_id → products.id [RESTRICT]; query_topic_id → query_topics.id [RESTRICT]; supersedes_id → geo_observations.id [RESTRICT]; tested_by → users.id [RESTRICT] | frozen schema / `models/geo_files.py:24-54`; create/correct/delete observation, product/topic/user delete；`database.md:63,457-459` |
| `platform_accounts` | platform_profile_id → platform_profiles.id [CASCADE] | `0037_simplify_deletion_lifecycle.py:180-185` replacement / `models/publication.py:51-59`; account CRUD, platform deletion；`database.md:335,446` |
| `platform_profiles` | platform_type_id → platform_types.id [RESTRICT]（DB short `fk_platform_profiles_platform_type_id`）；platform_prompt_id → platform_prompts.id [RESTRICT]（DB `fk_platform_profiles_platform_prompt_id`）；logo_file_id → file_records.id [RESTRICT] | `0009_config_center.py:847-855`; `0031_reusable_platform_prompts.py:45-56`; `0020_platform_branding_task_list.py:18-25` / `models/configuration.py:99-123`; create/update/delete platform, prompt/logo/type deletion；`database.md:77,281,431,434` |
| `platform_prompts` | `fk_platform_prompt_templates_updated_by_users`: updated_by → users.id [RESTRICT]（ORM `fk_platform_prompts_updated_by_users`） | `0031_reusable_platform_prompts.py:16-44` / `models/configuration.py:59-75`; prompt CRUD/user delete；`database.md:281-285` |
| `platform_types` | created_by → users.id [RESTRICT] | `0009_config_center.py:818-828` / `models/configuration.py:40-56`; type CRUD/user delete |
| `publication_attachments` | `fk_publication_attachments_work`: publication_work_id → publication_works.id [RESTRICT]（ORM 长名）；file_id → file_records.id [RESTRICT] | `0034_publication_workflow_redesign.py:330-350` / `models/publication.py:279-290`; result registration, aggregate/article/task delete；`database.md:299,305,432,453` |
| `publication_verifications` | `fk_publication_verifications_work`: publication_work_id → publication_works.id [RESTRICT]（ORM 长名）；`fk_publication_verifications_content_version_id`: content_version_id → content_versions.id [RESTRICT]（ORM 长名）；actor_id → users.id [RESTRICT] | `0034_publication_workflow_redesign.py:188-224`; `0035_business_workflow_primary_tasks.py:141-170` / `models/publication.py:175-208`; verify work, aggregate delete；`database.md:303,448-453` |
| `publication_work_events` | `fk_publication_work_events_work`: publication_work_id → publication_works.id [RESTRICT]（ORM 长名）；actor_id → users.id [RESTRICT]; `fk_publication_work_events_from_content_version_id`: from_content_version_id → content_versions.id [RESTRICT]; `...to_content_version_id`: to_content_version_id → content_versions.id [RESTRICT] | `0034_publication_workflow_redesign.py:159-186`; `0035_business_workflow_primary_tasks.py:123-139` / `models/publication.py:149-171`; all publication state commands and aggregate deletion；`database.md:303,313,448,453` |
| `publication_works` | content_version_id → content_versions.id [RESTRICT]; content_task_id → content_tasks.id [RESTRICT]; platform_profile_id → platform_profiles.id [SET NULL]; platform_account_id → platform_accounts.id [SET NULL]; closed_by → users.id [RESTRICT]; created_by → users.id [RESTRICT] | `0034_publication_workflow_redesign.py:49-145`; `0035_business_workflow_primary_tasks.py:83-121`; `0037_simplify_deletion_lifecycle.py:166-185` / `models/publication.py:61-145`; publication create/update/register/verify/close and platform/account/task deletes；`database.md:329,333,434-448` |
| `published_articles` | id → publication_works.id [RESTRICT]; verification_id → publication_verifications.id [RESTRICT] | `0034_publication_workflow_redesign.py:233-253` / `models/publication.py:212-226`; first successful verify, article aggregate delete；`database.md:303,305,451-453` |
| `published_content_issues` | `fk_published_content_issues_article`: published_article_id → published_articles.id [RESTRICT]（ORM 长名）；opened_by → users.id [RESTRICT]; resolved_by → users.id [RESTRICT] | `0034_publication_workflow_redesign.py:255-316` / `models/publication.py:229-276`; open/resolve issue, repair task, article/task aggregate delete；`database.md:303,333,454` |
| `sessions` | user_id → users.id [CASCADE] | frozen schema / `models/identity.py:48-64`; login/logout/user delete；`database.md:73,424` |

FK 诊断边界：`23503 + diag.constraint_name` 能稳定识别最终 FK；只看 `sqlstate`（当前 `delete_user`）不能判断是哪一条业务引用，虽然该服务前置统计了业务 FK。`SET NULL`/`CASCADE` 正常执行不产生错误；手工更新历史触发器产生的是 `55000`，不是 FK mapper 输入。

#### 3.4 CHECK（44 个）

| table | constraint_name（数据库实际）与表达式 | model / migration / contract；owner 与当前状态 |
|---|---|---|
| `users` | `ck_users_ck_users_account_type`: `account_type IN ('ADMIN','ENGINEER')` | `models/identity.py:32-42`; `0009_config_center.py:31-38`; `database.md:73,422-424`；create/update/bulk user；23514，当前全局 |
| `ai_channels` | `ck_ai_channels_ck_ai_channels_timeout`: `timeout_seconds BETWEEN 10 AND 600`; `ck_ai_channels_protocol_type`: `protocol_type IN ('openai-compatible-chat-completions')`; `ck_ai_channels_provider_brand`: provider brand enum | `models/ai_generation.py:33-43`; `0009_config_center.py:163-182`、`0021_ai_channel_model_management.py:42-52`; `database.md:79,169-177`；AI channel create/update；23514，当前全局 |
| `ai_channel_headers` | `ck_ai_channel_headers_ck_ai_channel_headers_exactly_one_value`: plain/encrypted exactly one；`ck_ai_channel_headers_ck_ai_channel_headers_sensitivity_matches_storage`: sensitivity matches storage | `models/ai_generation.py:75-85`; `0009_config_center.py:183-208`; `database.md:79`；create/update header；23514，当前全局 |
| `ai_models` | `ck_ai_models_ck_ai_models_test_status`: `UNTESTED|PASSED|FAILED` | `models/ai_generation.py:102-109`; `0009_config_center.py:208-234`; `database.md:79,437`；model create/update/test；23514，当前全局 |
| `generation_jobs` | `ck_generation_jobs_ck_generation_jobs_response_duration_90f5`, `...prompt_tokens_nonnegative`, `...completion_tokens_c8ed`, `...total_tokens_nonnegative`：nullable 数值非负；`ck_generation_jobs_dispatch_attempt_count_nonnegative`; `ck_generation_jobs_job_type`; `ck_generation_jobs_job_type_source` | `models/ai_generation.py:136-165`; `0009_config_center.py:265-280`、`0011_generation_reliability.py:30-34`、`0017_content_humanization.py:54-63`; `database.md:91,129,438-440`；generation worker/create/retry；23514，当前无 service mapper |
| `products` | `ck_products_revision_nonnegative`: revision >= 0；`ck_products_facts_classification`: classification enum | `models/product_facts.py:31-38`; `0002_product_facts.py` frozen schema、`0025_markdown_facts_direct_platform.py:517-526`; `database.md:217,411,415`；product/facts commands；23514，当前全局；真实 revision 冲突不是 CHECK |
| `fact_versions` | `ck_fact_versions_classification`: classification enum；`ck_fact_versions_status_business_workflow`: status enum | `models/product_facts.py:64-75`; `0025_markdown_facts_direct_platform.py:522-526`、`0035_business_workflow_primary_tasks.py:174-178`; `database.md:217,309,416-417`；submit/approve/retire；23514，当前全局 |
| `content_tasks` | `ck_content_tasks_open_requires_platform`; `ck_content_tasks_archive_state`: `archived_at` 与 status 合法组合 | `models/content.py:32-44`; `0037_simplify_deletion_lifecycle.py:130-138`、`0038_published_article_delete.py:13-22`、`0039_published_article_delete_missing_platform.py:13-22`; `database.md:327-341,412,419,435`；create/archive/restore/delete/article deletion；23514，当前全局 |
| `content_versions` | `ck_content_versions_status_business_workflow`: six-state workflow | `models/content.py:95-115`; `0035_business_workflow_primary_tasks.py:186-191`; `database.md:418-421,311`； content version commands；23514，当前全局 |
| `content_task_geo_sources` | `ck_content_task_geo_sources_rule_code`; `..._period`; `..._snapshot_object` | `models/content.py:175-184`; `0035_business_workflow_primary_tasks.py:217-229`; `database.md:315,459`；GEO optimization task creation；23514，当前全局 |
| `platform_profiles` | `ck_platform_profiles_logo_single_source`: file/external URL 至多一个 | `models/configuration.py:103-108`; `0020_platform_branding_task_list.py:26-30`; `database.md:431`；平台 profile 更新/logo；23514，当前全局 |
| `platform_accounts` | `ck_platform_accounts_revision_nonnegative`; `..._label_nonblank`; `..._identifier_nonblank` | `models/publication.py:32-42`; `0026_publication_account_dedup.py:51-65`; `database.md:201,446`；account CRUD；23514，当前全局 |
| `publication_works` | `ck_publication_works_status_valid`; `...revision_nonnegative`; `...result_complete`; `...close_complete`; `...close_reason_valid`; `ck_publication_works_live_configuration` | `models/publication.py:65-106`; `0034_publication_workflow_redesign.py:81-105`、`0037_simplify_deletion_lifecycle.py:140-145`; `database.md:303,329,443,448,452`；all publication work commands；23514，当前全局 |
| `publication_verifications` | `ck_publication_verifications_outcome_valid`; `...failed_comment_nonblank` | `models/publication.py:179-185`; `0034_publication_workflow_redesign.py:204-211`; `database.md:303,448-450`；verify work；23514，当前全局 |
| `published_content_issues` | `ck_published_content_issues_kind_valid`; `...status_valid`; `...revision_nonnegative`; `...description_nonblank`; `...resolution_complete` | `models/publication.py:233-247`; `0034_publication_workflow_redesign.py:274-297`; `database.md:303,454`；open/resolve issue；23514，当前全局 |
| `content_humanization_prompts` | `ck_content_humanization_prompts_singleton`: id = 1 | `models/configuration.py:84-85`; `0017_content_humanization.py:34-35`; `database.md:129`；put singleton prompt；23514，当前全局 |
| `audit_logs` | `ck_audit_logs_business_module`; `ck_audit_logs_outcome` | `models/identity.py:73-85`; `0024_audit_outcome.py:208-220`; `database.md:203-211,337,460`；all audit append；23514，当前全局 |

CHECK 识别只能依赖 `sqlstate=23514` + `diag.constraint_name`（对有稳定名字的表约束）；当前 model 与 migration 对部分 name 不一致，mapper 必须以真实 migration DB name 为 key。若是 PL/pgSQL trigger 的 `RAISE ... ERRCODE='23514'`，`diag.constraint_name` 通常为空，不能与表 CHECK 混为同一个 mapper key。

#### 3.5 NOT NULL（242 个列级约束）

NOT NULL 没有可供 `diag.constraint_name` 使用的独立名字；PostgreSQL diagnostics 稳定提供 `sqlstate=23502` 与 `diag.table_name/column_name`（具体 DBAPI 驱动需 integration sentinel 验证）。下表完整列出 242 个非空列，model 精确 owner 为对应字段行；migration 的初始 `nullable=False` 来自 frozen schema，后续增补/收紧见所列 revision。

| table | NOT NULL columns（数量） | model 精确来源 |
|---|---|---|
| `ai_channel_headers` | id, channel_id, name, normalized_name, is_sensitive（5） | `models/ai_generation.py:87-93` |
| `ai_channels` | id, name, description, protocol_type, provider_brand, base_url, api_key_ciphertext, api_key_updated_at, timeout_seconds, is_enabled, revision, created_by, created_at, updated_at（14） | `models/ai_generation.py:45-63`; additions `0021_ai_channel_model_management.py:17-41` |
| `ai_models` | id, channel_id, display_name, model_id, request_parameters, is_enabled, test_status, revision, created_by, created_at, updated_at（11） | `models/ai_generation.py:109-127` |
| `audit_logs` | id, business_module, action, target_type, outcome, result_message, details, request_id, created_at（9） | `models/identity.py:97-112`; tightening `0024_audit_outcome.py:205-207,249` |
| `content_humanization_prompts` | id, template_markdown, revision, updated_by, created_at, updated_at（6） | `models/configuration.py:85-95`; `0017_content_humanization.py:16-36` |
| `content_review_records` | id, content_version_id, action, comment, actor_id, created_at（6） | `models/content.py:157-169` |
| `content_task_geo_sources` | content_task_id, rule_code, date_from, date_to, basis_snapshot, created_by, created_at（7） | `models/content.py:189-210`; `0035_business_workflow_primary_tasks.py:200-216` |
| `content_tasks` | id, product_id, fact_version_id, platform_profile_name_snapshot, status, revision, created_by, created_at, updated_at（9） | `models/content.py:46-86`; snapshot tightening `0037_simplify_deletion_lifecycle.py:118-124`, time `0041_content_task_list.py:19-29` |
| `content_versions` | id, task_id, fact_version_id, version, source_type, title, summary, body_markdown, tags, content_hash, status, revision, quality_issues, change_summary, created_by, created_at（16） | `models/content.py:116-148`; body/classification analogue in `0025_markdown_facts_direct_platform.py:509-516` |
| `fact_review_records` | id, fact_version_id, action, comment, actor_id, created_at（6） | `models/product_facts.py:107-116` |
| `fact_versions` | id, product_id, version, status, body_markdown, classification, change_summary, revision, created_by, created_at（10） | `models/product_facts.py:81-100`; `0025_markdown_facts_direct_platform.py:509-516` |
| `file_records` | id, category, original_filename, object_key, content_type, size, sha256, access_level, status, uploader_id, upload_expires_at, created_at（12） | `models/geo_files.py:95-110` |
| `generation_jobs` | id, content_task_id, idempotency_key, job_type, status, input_snapshot, adapter_name, prompt_template_version, prompt_hash, attempt_count, dispatch_attempt_count, created_by, created_at（13） | `models/ai_generation.py:179-227`; additions `0011_generation_reliability.py:22-32`, job type `0017_content_humanization.py:40-63` |
| `geo_observation_attachments` | observation_id, file_id（2） | `models/geo_files.py:120-125` |
| `geo_observation_citations` | id, observation_id, url, source_type（4） | `models/geo_files.py:63-71` |
| `geo_observation_publications` | observation_id, published_article_id（2） | `models/geo_files.py:78-85` |
| `geo_observations` | id, observation_kind, product_id, tested_at, notes, tested_by, created_at（7） | `models/geo_files.py:28-55`; manual columns intentionally nullable per `0018/0022` |
| `platform_accounts` | id, platform_profile_id, label, account_identifier, is_active, revision（6） | `models/publication.py:51-59`; revision `0026_publication_account_dedup.py:47-50` |
| `platform_profiles` | id, name, slug, allowed_domains, revision, is_active（6） | `models/configuration.py:109-125`; is_active `0023_platform_management.py:17` |
| `platform_prompts` | id, name, template_markdown, revision, updated_by, created_at, updated_at（7） | `models/configuration.py:64-76`; table rebuilt `0031_reusable_platform_prompts.py:16-44` |
| `platform_types` | id, name, slug, revision, created_by, created_at, updated_at（7） | `models/configuration.py:44-56` |
| `products` | id, part_number, normalized_part_number, brand, normalized_brand, category, status, revision, facts_revision, facts_body_markdown, facts_classification, created_at, updated_at（13） | `models/product_facts.py:39-57`; facts additions `0025_markdown_facts_direct_platform.py:491-507` |
| `publication_attachments` | publication_work_id, file_id（2） | `models/publication.py:283-290`; `0034_publication_workflow_redesign.py:330-350` |
| `publication_verifications` | id, publication_work_id, content_version_id, outcome, actual_title_snapshot, final_url_snapshot, published_at_snapshot, comment, actor_id, created_at（10） | `models/publication.py:192-208`; content version tightening `0035_business_workflow_primary_tasks.py:162-170` |
| `publication_work_events` | id, publication_work_id, action, to_status, comment, actor_id, created_at（7） | `models/publication.py:153-171` |
| `publication_works` | id, idempotency_key, content_task_id, content_version_id, platform_profile_name_snapshot, platform_account_label_snapshot, account_identifier_snapshot, content_hash, status, revision, created_by, created_at, updated_at（13） | `models/publication.py:108-145`; snapshot tightening `0037_simplify_deletion_lifecycle.py:118-124` |
| `published_articles` | id, verification_id（2） | `models/publication.py:217-226` |
| `published_content_issues` | id, published_article_id, kind, description, status, revision, opened_by, opened_at（8） | `models/publication.py:257-276` |
| `query_topics` | id, canonical_question, intent_type, variants, revision, created_at（6） | `models/configuration.py:30-38` |
| `sessions` | id, token_hash, csrf_hash, user_id, expires_at, created_at, last_seen_at（7） | `models/identity.py:52-64` |
| `users` | id, username, display_name, password_hash, account_type, is_active, must_change_password, revision, created_at（9） | `models/identity.py:35-46`; account_type tightening `0009_config_center.py:31-35` |

NOT NULL 失败当前不会进入任何 service mapper；若后续产品要给用户可恢复错误，必须先以 `23502 + table/column` 精确映射，不能从英文 message 猜字段，也不能把它们统一成 409 revision。

### 4. 触发器型“其他”完整性守卫（不在 167 个 pg_constraint 内）

迁移中的 `CREATE TRIGGER` 搜索得到以下当前 head 家族；同一 trigger 在多个 revision 被 replace/recreate 只计最终 active instance，不将历史重复创建计数。静态计数为 **39**（普通 trigger 36、constraint trigger 3），与 companion CSV 的 trigger 行一一对应。触发器错误多使用 `55000`（拒绝/不可变/迁移失败）或 `23514`（跨表资格），通常没有 `constraint_name`，故只能由专门 owner 处理，不能放入通用 IntegrityError constraint registry。

| table / trigger 家族 | 最终 migration / model / contract | 守卫内容与可能 owner |
|---|---|---|
| `audit_logs_append_only` | `0037_simplify_deletion_lifecycle.py:459-466`（最终仅 `BEFORE UPDATE`；复用 `0027_guard_audit_actor_user_delete.py:15-29` 的 `55000` guard）；`models/identity.py:69-112`; `database.md:337,460` | 正常应用只有 `deleteUser` 通过 FK `ON DELETE SET NULL` 触发受控 actor UPDATE；普通 `append_audit` INSERT 和聚合清理 DELETE 不触发最终 trigger。非法直接 UPDATE 是显式 `55000`，不得映射为 `REVISION_CONFLICT` 或 `USER_IN_USE` |
| `fact_versions_guard`, `fact_review_records_append_only`, `products_identity_guard` | 初始 `0002_product_facts.py:64-120`，后续 `0016_fact_review_cleanup.py:28-42`、`0035_business_workflow_primary_tasks.py` 替换；`models/product_facts.py:27-116`; `database.md:417,455` | 事实版本/审核 append-only、批准后身份不可变；facts commands 的 `flush/commit` 可能触发，55000 不可解释为 revision |
| `content_tasks_platform_guard`, `content_tasks_current_content_version_guard`, `content_tasks_repair_source_guard` | `0025_markdown_facts_direct_platform.py:385-453`; `0035_business_workflow_primary_tasks.py:328-343`; `0034_publication_workflow_redesign.py:587-600`；`models/content.py:28-88`; `database.md:305,311,419,454` | 任务平台/当前指针/修复来源归属，跨表错误 23514 或 55000；`createContentTask`,`createPublishedContentRepairTask`,`updateContentDraft` 等必须保留显式失败 |
| `content_versions_guard`, `content_versions_delete_guard` | `0035_business_workflow_primary_tasks.py:258-326`; `0040_content_draft_management.py:104`；`models/content.py:91-151`; `database.md:418,421,345-349` | 内容版本不可变/状态机/受控草稿删除；内容 production/review/delete commands；未知触发器错误不得变成 `REVISION_CONFLICT` |
| `publication_works_validate_insert`, `publication_works_validate_platform_snapshot`, `publication_works_guard`, `publication_works_completion_guard` | `0034_publication_workflow_redesign.py:386-523`、`0035_business_workflow_primary_tasks.py:352-522`、`0043_geo_insight_platform_identity.py:136-159`; `models/publication.py:61-147`; `database.md:303,313,329,443-453` | 发布 work 身份、状态、平台等值、完成原子性；`create/update/register/verify/closePublicationWork`。其中 insert/platform qualification 可能为 23514 且无 constraint_name |
| `publication_verifications_validate_insert`, `publication_verifications_append_only`, `published_articles_append_only`, `published_content_issues_validate_insert/guard`, publication attachment guards | `0034_publication_workflow_redesign.py:460-603`、`0037_simplify_deletion_lifecycle.py:260-304`、`0038_published_article_delete.py:86-101`; `models/publication.py:149-290`; `database.md:303-305,448-453` | 核验快照、成果/问题/附件不可变、问题归属、verified file；publication commands、article/issue commands、aggregate delete；55000/23514 均不能走通用 revision |
| `geo_observation_publications_article_result_guard`, observation/citation/publication/attachment append-only | 初始 `0007_geo_observation.py:34-40`、`0018_manual_geo_observation.py:116`、`0022_geo_observation_insights.py:110-203`、`0029_manual_geo_independent_facts.py:46-91,256`、`0037_simplify_deletion_lifecycle.py:339-351`; `models/geo_files.py:24-125`; `database.md:63,265-269,457-458` | GEO 文章归属、事实完整性、完整链删除；`createGeoObservation`,`deleteGeoObservation`, article/task aggregate delete；手工 SQL sentinel 必须验证 55000/23514 |
| `file_records_guard`, `platform_profiles_require_logo_file`, file link verified guards | `0008_files.py:56-88`; `0028_platform_logo_lifecycle.py:132`; `0034_publication_workflow_redesign.py:600-603`; `models/geo_files.py:91-113`, `models/configuration.py:119-123`; `database.md:69,431-432` | 文件 metadata/status 不可变，logo/attachment 必须 verified；file/logo/platform/publication commands |
| `platform_profiles_prepare_delete`, `publication_*_delete_guard` | `0037_simplify_deletion_lifecycle.py:451-463`; `0038_published_article_delete.py:23-101`; `models/configuration.py:99-125`, publication models；`database.md:329-337` | 只允许声明事务上下文的聚合删除、平台删除阻断；永久删除 commands；55000 只表示受控边界，不是 revision |

以上表格按最终 active instance 展开计数为 39；同一 trigger 在历史 revision 的重复 `CREATE` 不重复计数，动态 GEO append-only 模板按最终生成的表实例计数。由于本次未连接数据库，实际实施前仍应在真实 PostgreSQL 用 `pg_trigger`/`pg_constraint` 复核 active set。

### 5. 当前错误数据流、目标边界和事务语义

当前数据流：

```text
service flush/commit
  ├─ 已知少数唯一竞态 → service catch → rollback → AppError → ErrorEnvelope
  └─ 其余 IntegrityError → 全局 integrity_error_handler
                         → 409 REVISION_CONFLICT / 数据约束冲突
```

目标数据流应为：

```text
真实 expected_revision 比较失败 → service AppError(REVISION_CONFLICT)
已知 constraint_name/sqlstate 竞态 → 所属 service owner rollback/savepoint → 精确领域 AppError
未知 IntegrityError / 非约束触发器异常 → rollback → 统一内部错误边界（不泄漏 SQL、表、约束、stack）
```

- SQLAlchemy 在 `flush`/`commit` 收到 `IntegrityError` 后 Session 进入 failed state；继续查询前必须 rollback，或在局部 `begin_nested()` savepoint 中回滚并保持外层事务状态。当前多个 helper 直接 `db.rollback()`，它是整个 Session transaction owner，不是 savepoint；这对顶层 HTTP command 尚可，但若嵌套在批量命令/同事务聚合中会丢失本应保留的外层状态。
- `identity.delete_user` 在 `db.flush()` 失败后 rollback 并抛 AppError；但其触发器设置、delete 及待写 audit 必须由同一顶层事务 owner 统一回滚，不能在全局 handler 中二次猜测。
- `product_facts`、`platform_configuration`、`publication`、`content_production` 的已知唯一 catch 应在最终 owner 的 flush 边界读取结构化 diagnostics；若需要保留外层审计/批量状态，实施设计需改为 savepoint，而不是无条件 Session rollback。
- 所有失败都不得留下 SUCCESS `AuditLog`、事件、revision 递增或部分删除。`append_audit` 发生在多数命令的 flush 后、commit 前（例如 `product_facts.py:409-423`、`platform_configuration.py:638-652`），因此 mapper 必须在 audit 前完成；数据库触发器拒绝时整笔事务回滚。
- 并发唯一约束测试必须证明：业务预检只是优化，不是权威；两个请求同一目标仅一个 commit 成功；失败者从 `diag.constraint_name` 得到同一 domain code；失败者无 SUCCESS audit、事件、revision 或半成品。仅 mock `IntegrityError` 不足以证明。

### 6. 命名、未命名和 diagnostics 可识别性

1. 运行时 `db.py:21-25` 的 naming convention 会把无名 ORM `UniqueConstraint`/`CheckConstraint`/FK 生成名字；但历史 migration 是冻结 schema，不能让 ORM 名称追赶旧 DB。
2. 具体已核实差异包括：
   - `platform_prompts` DB 为 `uq_platform_prompt_templates_name`（`0031_reusable_platform_prompts.py:42-44`），ORM 推导为 `uq_platform_prompts_name`；updated_by DB 为 `fk_platform_prompt_templates_updated_by_users`，ORM 为 `fk_platform_prompts_updated_by_users`。
   - `content_tasks.platform_profile_id` DB 为 `fk_content_tasks_platform_profile_id`（`0025_markdown_facts_direct_platform.py:534-541`），ORM 推导为 `fk_content_tasks_platform_profile_id_platform_profiles`；source issue DB 为 `fk_content_tasks_published_issue`（`0034_publication_workflow_redesign.py:716-728`），ORM 更长。
   - publication workflow 的 `publication_work_events_work`、`publication_verifications_work`、`published_content_issues_article`、`publication_attachments_work`、`content_task_geo_sources_*`、GEO article FKs 使用 migration short names，而 ORM 推导为 long names；`generation_jobs.ai_channel_id/ai_model_id` 也由 0009 的 short op names 建立。
   - 无名/显式 Check 的命名也不完全相同：例如初始 AI checks 在 migration SQL 里是 `ck_ai_channels_ck_ai_channels_timeout` 等，而 0021 新增的 `ck_ai_channels_protocol_type`/`...provider_brand` 是显式 short name；当前 ORM metadata 会推导另一组带表名的名字。
3. `23505`/`23514`/`23503` 配合 DBAPI `diag.constraint_name` 对命名 UNIQUE/CHECK/FK 通常可稳定识别；`23502` 需使用 `diag.table_name + diag.column_name`，没有约束名；`55000` trigger/迁移 sentinel 通常只有 SQLSTATE 与自定义 message，不得解析 message 做业务映射。
4. 禁止 `str(error)`、英文数据库文本、substring、猜测 column/value、查询“是否出现了某行”来反推 constraint。二次查询可辅助区分幂等重放，但不能替代 diagnostics 识别。
5. 不存在 EXCLUDE constraint；没有发现手写 `ExcludeConstraint`、`EXCLUDE` 或 `op.create_exclude_constraint`。普通 index 也没有完整性语义。

### 7. 历史 migration / contract 覆盖与未决点

- 已逐文件搜索 0001-0043；当前 head 删除/替换的历史约束包括：旧 roles/user_roles、结构化 facts/evidences/part_parameters/replacement tables、`platform_profile_versions`、旧 publication tables、publication attention FK/UNIQUE、GEO `recommendation_status`/`cited`/insight checks、content task generation classification checks、旧 platform FK 与 publication FK。它们仍是迁移审计证据，但不计当前 head 167。
- `contracts/database.md:39-69,71-81,83-105,123-145,151-159,193-211,217-235,245-269,279-337,343-363` 记录 migration 语义；`database.md:409-460` 是当前必需约束与不可变/删除/状态合同。合同没有为大多数 UNIQUE/FK/CHECK/NOT NULL 逐项列出 constraint name，也没有定义新的 duplicate domain code。
- 需要主任务确认的合同问题：用户创建重复 username、`createPlatformProfile` slug race、Prompt name、AI header/model、pending/approved version、publication work/article issue 等新领域 code/status/details；未知 IntegrityError 的内部 500 envelope 是否已有 runtime/OpenAPI owner。没有合同证据时不能在本审计中发明 code。
- `contracts/database.md:77` 明确 platform type slug 仅有已知正确映射；`database.md:201` 明确 platform account normalized identifier 已正确映射；`database.md:85` 的迁移错误矩阵说明引用预检要汇总全部位置；这些是当前可直接复用的领域 owner 证据。
- 代码与 frozen migration 的 FK 名称差异必须在真实 PostgreSQL 集成测试中通过 `pg_constraint.conname` 验证；本次只运行了 ORM metadata 枚举和 Alembic source/offline 可读审计，没有连接数据库，也没有声称实际 catalog 已验证。
- `alembic upgrade head --sql` 在 `0010_user_cleanup.py:57` 因 offline bind 为 None 而中断，因此不能用一份完整 offline SQL 证明 0010 之后所有 DDL；后续 migration source 与 runtime model 已逐文件检查。该失败是研究工具限制，不是 schema 失败结论。

### 8. 后续实施索引（非权威）

最终实施拆分的唯一权威是 [`design.md` 第 9 节](../design.md#9-后续实施任务拆分) 与 [`implement.md` Phase 1–6](../implement.md)；本矩阵只保留稳定领域索引，不再复写文件边界、依赖顺序或详细验收计划：

- **T1**：纠正 unknown `IntegrityError` boundary，不新增领域 code。
- **T2 / T2-C**：收敛 configuration 已有码约束并先决策独立语义问题；platform profile slug 仅覆盖 `createPlatformProfile` 创建竞态。
- **T3 / T3-C**：先决定 `uq_users_username` 的准确业务合同，再让 `createUser` 预检与真实 `23505` race 一致。
- **T4 / T4-C**：首个可实施子目标同时覆盖 `createHumanizationJob` 与 HUMANIZE `retryGenerationJob`，其余 content/generation 新 code 先完成合同决策。
- **T5 / T5-C**：publication/GEO 的可恢复约束与 context code 决策及实现。
- **T6**：后端 code 稳定后的 frontend 409 recovery projection reconciliation。

OpenAPI、generated client 与 frontend 仅在相关决策获批且实际改变 wire/status/schema 时同步；本矩阵不对这些跨层修改作预授权。数据库 schema/migration 默认不因 mapper 变化而修改。

## Caveats / Not Found

- 未发现 `EXCLUDE` 约束、`ExcludeConstraint`、`op.create_exclude_constraint`，也未发现通过 Redis 保存业务状态的约束来源。
- 未运行 Git 操作、未修改代码/合同/spec/其他 task 工件；本文件是唯一写入。
- 未连接真实 PostgreSQL，因此 `pg_constraint` 中最终 `conname`、驱动 `diag` 字段形状及当前 active trigger catalog 仍需 integration sentinel 验证；本文件明确区分 migration 预期与 ORM 推导名称。
- migration `0010_user_cleanup.py:57` 的 offline SQL 生成因其运行时查询逻辑而在 `upgrade head --sql` 中断；这不影响对该 revision 源码及其后所有 revision 的静态搜索，但不应把离线 SQL 输出当作完整最终 schema dump。
- 一些表的初始约束由 `migration_schema_v1.py` 的 metadata `create_all` 建立，源文件行号是模型类/字段声明而非单独 `CREATE CONSTRAINT` 语句；这正是 frozen schema 的设计，不能改写旧 migration 追赶当前 ORM。
