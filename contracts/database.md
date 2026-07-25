# PartSignal Database Contract

## Conventions

- PostgreSQL 16 is the only supported business database.
- Tables and columns use `snake_case`; identifiers are UUID; timestamps are timezone-aware UTC.
- Mutable aggregates carry an integer `revision`; clients must submit `expected_revision`.
- Alembic is the only schema migration entry point. API and Worker never run migrations on startup.
- Revisions `0001` through `0008` use `app.migration_schema_v1` as a frozen metadata snapshot; future runtime model changes must add a new revision and must not edit that snapshot.
- JSONB is limited to immutable generation snapshots, structured generation output, and audit details. Editable product facts use one Markdown body on `products`; platform rules and normalized fact subgraphs no longer exist after `0025`.
- Review records, status events, observations, and audit logs are append-only.

## Migration Order

### 0001 Identity And Audit

`users`, `roles`, `user_roles`, `sessions`, `audit_logs`.

This historical revision created six fixed roles. Revision `0009` migrates them to the current two-account-type model and removes `roles` and `user_roles`.

### 0002 Product Facts

`products`, `reference_parts`, `part_parameters`, `replacement_relations`, `evidences`, `parameter_evidence_links`, `replacement_evidence_links`, `fact_claims`, `claim_evidence_links`, `fact_versions`, `fact_review_records`.

这些规范化事实表和 `fact_versions.snapshot_json` 仅描述历史 revision；`0025` 已将当前事实模型收敛为产品 Markdown 工作区和不可变 Markdown 事实版本，并物理删除规范化事实子图。

### 0003 Content Planning

`query_topics`, `platform_profiles`, `platform_profile_versions`, `content_tasks`.

`platform_profile_versions` 仅描述历史 revision，已由 `0025` 物理删除。当前 `content_tasks` 直接绑定具体 `platform_profile_id` 和同产品的非空 `APPROVED fact_version_id`，不会随配置变化静默改绑。

### 0004 Content Production

`generation_jobs`, `content_versions`.

`generation_jobs.idempotency_key` is unique. Redis carries only the job UUID. A unique `content_versions.source_job_id` prevents duplicate drafts. Worker execution rechecks the current task, product, and approved fact before and after generation; expired `RUNNING` leases are recovered from PostgreSQL by Celery Beat. Content title, summary, Markdown body, tags, fact references, and hash are immutable after insert.

### 0005 Content Review

`content_review_records` plus immutability and task-version constraints.

Approving a new version and superseding the previous approved version happen in one transaction. Creators may approve their own fact or content versions; all state, evidence, and quality gates still apply.

### 0006 Publication

`platform_accounts`, `publication_records`, `publication_status_events`.

Platform accounts contain labels only, never credentials. A publication permanently binds one approved content version. Reuse of an idempotency key must match content, account, section URL, and attachment IDs; concurrent requests are serialized with a PostgreSQL transaction advisory lock. After `PUBLISHED`, URL and content binding cannot change.

Current-state counts come from `publication_records.status`. Period publication metrics and recent activity come from append-only `publication_status_events`: a rolling window cohort is the distinct records whose `PUBLISHED` event falls inside `[window_start, as_of)`, verification count is the cohort subset with any later `VERIFIED` event by `as_of`, and exception count is the distinct records receiving `REJECTED`, `REMOVED`, or `VERIFICATION_FAILED` inside the same window. A later removal never removes the historical publication from its original cohort.

### 0007 GEO Observation

`geo_observations`, `geo_observation_citations`, `geo_observation_publications`.

Observations are immutable. Corrections create another observation with `supersedes_id`. Metrics are calculated from source observations rather than persisted as a second source of truth.

### 0008 Files

`file_records`, `publication_attachments`, `geo_observation_attachments`, plus `evidences.file_record_id`.

Only `VERIFIED` files may be linked. Publication attachments additionally require `category=OPERATION_SCREENSHOT` in both candidate creation and `mark-published`; other modules enforce their own category contracts at their service boundaries. `publication_attachments` is one append-only evidence relation used in both publication phases, with no mutable phase or replacement field. Referenced objects cannot be deleted through the application.

### 0009 Configuration Center And AI Generation

`users` gains `account_type` (`ADMIN | ENGINEER`) and `must_change_password`. Existing users with `SYSTEM_ADMIN` become `ADMIN`; all other existing users become `ENGINEER`. After the mapping, `roles` and `user_roles` are removed so `users.account_type` is the only permission source. Application users remain non-deletable business identities. Disabling a user or resetting a password revokes all active sessions. A transaction may not disable or demote the last active `ADMIN`.

用户管理工作台不增加表、列或迁移。新账号默认启用，管理员提供的 `temporary_password` 只保存安全哈希，并固定写入 `must_change_password=true`。列表摘要由 PostgreSQL 对全部用户实时聚合，不保存统计快照，也不从审计推测趋势。单个与批量启停共享同一行锁、revision、最后启用管理员保护、会话撤销和逐用户审计不变量；合法批量命令只把写入前的预期业务错误作为逐项失败，任何数据库、编程或审计异常都回滚整批。用户 CSV 只导出批准的非敏感业务列，完整生成后追加 `user.exported` 审计；停用或重新启用只改变当前用户状态，不删除、改绑或改写任何历史业务与审计外键。

`platform_types` owns a unique category `slug`. Revision `0009` initially placed one mutable Markdown system Prompt under each type; revision `0014` replaced that ownership with one current Prompt per concrete platform。`0025` 又删除了任务上的类型快照和可编辑 Prompt；当前任务只直接绑定具体平台，生成输入由平台 Prompt 与事实版本 Markdown 唯一决定。

`ai_channels` owns an encrypted API key, timeout, and connection state. `ai_channel_headers` belongs only to a channel, normalizes names case-insensitively, and stores exactly one of a plain or encrypted value. `ai_models` belongs to a channel and stores the provider `model_id`, display name, exact JSON request parameters, and model-level test state. Channels and models default disabled. Connection, credential, or Header changes disable the channel and invalidate every child model test; model ID or parameter changes disable and invalidate that model.

`generation_jobs` gains nullable `ai_channel_id` and `ai_model_id` foreign keys using `SET NULL`, provider request metadata, and nullable token usage. `input_snapshot` is the authoritative immutable generation input and retains channel/model identity, non-sensitive connection data, model parameters, final system/user messages, platform identity and approved fact version after current configuration is deleted. Credentials and sensitive Header values never enter the snapshot. `content_versions` removes model-reported fact, evidence, and disclosure ID arrays; traceability comes from `fact_version_id`, `source_job_id`, and the job snapshot.

### 0010 Legacy User Cleanup

This irreversible data migration recognizes only `product_editor`, `product_reviewer`, `content_reviewer`, and `analyst`. It locks all matching users and checks every user-owned business or audit foreign key before deleting any row. Any reference aborts the complete migration and reports the username plus referring table and column; ownership is never reassigned and historical data is never deleted. When no references exist, sessions for the four users are removed before the users. An existing `content_editor` keeps its password, account type, active state, and profile but receives `must_change_password=true` with an incremented revision.

After migration, `seed-demo` idempotently ensures only `admin` and `content_editor`. Their initial passwords come from `PARTSIGNAL_SEED_ADMIN_PASSWORD` and `PARTSIGNAL_SEED_ENGINEER_PASSWORD`; existing accounts are never overwritten. A newly created `content_editor` has account type `ENGINEER` and must change its initial password. The one-time migration is the only physical user-deletion exception and does not add an application deletion API.

### 0011 Generation Reliability

`generation_jobs` gains nullable `last_dispatch_attempt_at` and non-negative `dispatch_attempt_count` fields plus a partial due-time index for `PENDING` rows. These fields are diagnostic metadata inside the existing Job aggregate; `generation_jobs.status` remains the only execution authority and Redis continues to carry only the Job UUID.

After the API commits a new Job, Broker dispatch failure leaves it `PENDING`. Celery Beat redispatches only rows whose `COALESCE(last_dispatch_attempt_at, created_at)` is older than the configured threshold, using PostgreSQL row locks and a bounded batch. Only a Worker that atomically changes `PENDING` to `RUNNING` may call the provider, so accepted-but-unrecorded Broker messages and concurrent recovery remain harmless duplicates.

The execution lease is calculated from the immutable snapshot as `started_at + input_snapshot.channel.timeout_seconds + GENERATION_FINALIZE_GRACE_SECONDS`; the grace must be positive. Expired `RUNNING` Jobs become `FAILED/WORKER_LOST` and are never automatically dispatched again. If the provider accepted a request before the Worker lost its result, only an explicit retry may create a new traceable Job.

### 0012 AI Data Classification

该 revision 曾在 `content_tasks` 上引入生成输入分级字段。`0025` 已物理删除这些字段；当前分级只属于产品事实工作区和不可变事实版本，第三方模型出站只接受 `FactVersion.classification=PUBLIC`。PostgreSQL 仍是分级唯一来源，Redis 不保存分级状态。

### 0013 Publication And Review Closure

`publication_attentions` is the authoritative business queue for a publication that reaches `REMOVED` or `VERIFICATION_FAILED`. One publication can create at most one attention. An attention must be inserted as revision-zero `OPEN`, may only become `RESOLVED`, cannot be deleted, and resolution requires an actor, UTC time, and non-blank comment. `content_tasks.source_publication_attention_id` is nullable and unique, so one attention creates at most one repair task without introducing a second task model. Both the attention binding and a non-null repair source are immutable.

Every new `publication_record` must use an active account whose `platform_profile_id` equals the task's direct `platform_profile_id`. The application service validates account activity and platform equality with explicit errors; the PostgreSQL insert trigger is the final protection for the cross-table platform equality. The first related publication that reaches `VERIFIED` changes an `OPEN` task to `COMPLETED` in the same transaction. A later publication loss never reopens or cancels that task; it creates the unique attention instead. A task with `PENDING_MANUAL_PUBLISH`, `PLATFORM_REVIEW`, or `PUBLISHED` publication state cannot be cancelled.

The repair command fixes product and direct platform from the original task. Historical tasks also retain their real query-topic link; product-driven tasks keep that link null. It must explicitly select a non-blank `APPROVED` fact version for the same product. Creating the repair task does not resolve the attention.

Fact and content review records remain append-only. `request-changes` requires a non-blank comment, while submit and approve comments remain optional. Revision `0013` extends both database status guards so `CHANGES_REQUESTED -> PENDING_REVIEW` is valid without changing the immutable version payload. Review contexts are read projections over the locked fact/content versions, evidence file status, generation snapshot, deterministic version diff, actor summary, and stable review history; they do not persist a second copy.

Before `0013`, `python -m app.cli preflight-integrity` must return an empty JSON array. It reports stable IDs for `COMPLETED_WITHOUT_VERIFIED_PUBLICATION` when a completed task has no append-only `VERIFIED` publication status event, and for non-terminal `PUBLICATION_PLATFORM_MISMATCH`; a publication that was verified and later removed remains valid completion history, while an explicitly `REJECTED`, `REMOVED`, or `VERIFICATION_FAILED` mismatch remains traceable but no longer blocks deployment. The command exits non-zero when any issue exists and never changes history. The migration repeats the critical check so direct Alembic execution cannot bypass the deployment gate. Once any attention or repair source exists, downgrade is refused and deployment must move forward.

### 0014 Platform Prompt Ownership

`platform_prompts.platform_profile_id` is the primary key and references `platform_profiles.id` with `ON DELETE CASCADE`; each concrete platform owns zero or one current Markdown Prompt. The migration creates a replacement table and copies each legacy type Prompt to every existing profile of that type. A legacy Prompt whose type has no concrete platform produces no row. The old table and `platform_type_id` column are removed; there is no dual read, dual write, type-level compatibility endpoint, or fallback Prompt.

The current Prompt row also owns its `revision` and `updated_at`. Platform collection projections expose that exact `updated_at` as nullable `prompt_updated_at`; they do not reuse platform audit time or persist a duplicate field. Prompt update and physical deletion both lock the current row and compare the caller's required `expected_revision`; a stale command returns `REVISION_CONFLICT` without deleting or auditing a false success.

该 revision 曾以不可变 `platform_profile_versions` 管理平台规则。`0025` 已物理删除规则版本表、管理工作台、规则状态机、影响摘要和任务规则引用；当前具体平台只维护一个可选的当前 Markdown Prompt。

Administrators may physically delete a `fact_version` in any status only when neither `content_tasks` nor `content_versions` references it. The service locks the target, reports every non-zero direct reference, explicitly deletes subordinate `fact_review_records`, and deletes the version in the same transaction. This administrative cleanup is the only exception to normal append-only review history; it never cascades to or rewrites tasks, content, generation, publication, or observation history, and product deletion never implicitly deletes fact versions.

Revision `0016` replaces only the `fact_review_records` append-only trigger. `UPDATE` remains forbidden, and `DELETE` is allowed only when the transaction-local `partsignal.fact_version_delete_id` exactly matches the row's parent version. The service sets that value only after locking the version, proving it has no content references, and recording the safe audit summary. Other append-only tables and the `RESTRICT` foreign key are unchanged; downgrade restores the original generic trigger.

### 0017 Optional Content Humanization

`content_humanization_prompts` is a database-enforced singleton (`id = 1`) containing the only current naturalization Prompt. The migration inserts no row: an administrator must explicitly create the first value, and every row records a real `updated_by` user plus an optimistic-lock `revision`. There is no seed value, environment fallback, platform copy, delete operation, or second runtime source.

`generation_jobs.job_type` is required and limited to `GENERATE | HUMANIZE`; historical rows are backfilled to `GENERATE` before the migration removes the column default. `source_content_version_id` uses `RESTRICT` and is paired with the type: original generation must have no source, while naturalization must have one. A partial unique index on `source_content_version_id` where the type is `HUMANIZE` and status is `PENDING | RUNNING` prevents concurrent active jobs for the same source.

A successful naturalization creates a new immutable `content_versions` row with `source_type = AI`, `source_job_id` pointing to the naturalization job, and `based_on_id` pointing to the frozen source version. It never updates the source. The job snapshot is the authority for the selected model, global Prompt revision and Markdown, complete source article and hash, original approved facts, PUBLIC classification, task requirements, and final messages; credentials remain outside snapshots and Redis still carries only the job UUID.

The API and Worker both require an `OPEN` task, an `AI` source in `DRAFT | CHANGES_REQUESTED`, a non-blank approved `PUBLIC` fact version, and an active product. Worker validation occurs before and after the provider call, including source identity, status, type, task/fact binding, frozen hash, and original generation lineage. Once any `HUMANIZE` job exists, revision `0017` refuses downgrade so immutable AI history cannot become unreadable; deployment must use a forward fix.

New generation snapshots include the concrete platform identity and continue freezing the final system/user messages. Old immutable snapshots may omit the concrete-platform object only for historical reads; new writes must include it. Platform Prompts can diverge after migration, so `0014` does not guess how to merge them on downgrade; rollback requires the pre-migration PostgreSQL backup.

### 0018 Manual GEO Article Observation

`geo_observations.observation_kind` explicitly separates historical `LEGACY_MODEL_RESULT` rows from new `MANUAL_ARTICLE_SEARCH` rows. The migration assigns the legacy discriminator without changing any historical business field. Legacy query/model/answer fields and new `search_platform/search_query` fields are mutually exclusive under a database check; new writes have no target question, model call, web-search flag, answer summary, citation, accuracy, or observation-level recommendation.

`geo_observation_publications.recommendation_status` is the authoritative per-article result for manual observations and is limited to `RECOMMENDED | NOT_RECOMMENDED`. Historical associations remain `NULL` and mean “not assessed per article”; the migration never infers a status from old citations, possible-influence links, or observation-level recommendation. An insert trigger verifies that every new result belongs to the observation product through `PublicationRecord -> ContentVersion -> ContentTask`, the publication is currently `PUBLISHED | VERIFIED`, and `final_url` is present.

The create service locks the product and all current eligible publication rows, then requires the request to cover that exact publication ID set. Every manual observation includes at least one verified `OPERATION_SCREENSHOT`. Article titles, platform identity, links, and publication status remain projections of their existing owners and are not duplicated in GEO storage. Metrics and the default records list use the same filtered set of current correction-chain tails; `include_history=true` is the explicit read path for superseded rows. A row is current only when no `geo_observations.supersedes_id` points to it. Legacy model metrics and manual per-article recommendation metrics have separate denominators.

Correction is an append-only service operation over the existing schema: it creates a new `MANUAL_ARTICLE_SEARCH` row whose `supersedes_id` points to the current manual row. The service rejects already-superseded targets and changes to the product, search platform, or search query. No new table, column, index, migration, or duplicated summary field is introduced for the records page.

Manual GEO history is forward-only. Once a `MANUAL_ARTICLE_SEARCH` row exists, revision `0018` refuses downgrade because removing the discriminator, search fields, or article results would destroy immutable business meaning.

### 0019 Product-Driven Content Tasks

`content_tasks.query_topic_id` becomes nullable while retaining its `RESTRICT` foreign key. Existing tasks are not rewritten and keep their real query-topic UUID; new ordinary tasks and repair tasks originating from them store `NULL`. `0025` 后，新普通任务只需产品、同产品非空 `APPROVED` 事实版本和活动具体平台；人工首稿不依赖平台 Prompt，系统 AI 生成才要求当前 Prompt。

`ContentTaskCreate` no longer accepts a query topic. New generation snapshots omit the `query_topic` object entirely rather than storing null, an empty object, or an invented question. Historical tasks still resolve and freeze their real query topic when creating a new generation job. Repair tasks inherit the original task's nullable link, and repair context returns a nullable query-topic projection for explicit new/legacy handling.

Revision `0019` rewrites no task or immutable job snapshot. It refuses downgrade before restoring `NOT NULL` when any product-driven task exists; rollback after new writes requires a forward fix or the pre-migration PostgreSQL backup, never a placeholder query topic.

### 0020 Platform Branding And Task List Projection

`platform_profiles` gains nullable `website_url`, `logo_file_id`, and `logo_external_url`. The uploaded Logo foreign key uses `RESTRICT`; the referenced `file_record` must be a `VERIFIED`, `PUBLIC`, `PLATFORM_LOGO` object before the application accepts it. A database check permits at most one Logo source, so an uploaded file and an external URL are never stored together. Signed object-storage URLs are response projections and are never persisted.

The content-task list remains a read projection and adds no duplicate display columns. It joins each task's direct platform and displays the platform's current name, website, and Logo. The projected AI status is the latest `generation_job` whose `job_type = GENERATE`, ordered deterministically by `created_at DESC, id DESC`; `HUMANIZE` jobs are content-version post-processing and never replace the task's generation status. The projection batches products, platforms, Logo files, publication state, and generation status instead of issuing per-task queries.

Revision `0020` refuses downgrade when any platform branding field is non-null. Removing populated branding requires a forward fix or a pre-migration backup rather than silent data loss.

### 0021 AI Channel And Model Management

`ai_channels` gains required `description`, `protocol_type`, and `provider_brand` fields. Existing rows are migrated with an empty description, the sole implemented protocol `openai-compatible-chat-completions`, and `CUSTOM` brand; the migration never infers a brand from a name or URL. The protocol and brand columns have database checks and no runtime default, so new writes must submit one registered pair. Protocol chooses the real request adapter; brand is controlled display and filtering metadata only. A name, description, or brand-only change preserves connection state, while Base URL, protocol, API Key, or Header changes disable the channel and invalidate all child model tests.

Channel latest-test state remains a deterministic projection over `ai_models`: among models with `last_tested_at`, the row ordered by `last_tested_at DESC, id DESC` is authoritative; a channel without a tested model projects `UNTESTED` and a null time. No channel-level test column or second status state machine is added. Channel collection counts, Header count, enabled-model count, and latest test are read projections rather than persisted summaries.

`generation_jobs(ai_channel_id, created_at)` supports channel usage windows. Usage statistics include both allowed business job types, `GENERATE` and `HUMANIZE`, and never include model tests or discovery because those operations do not create generation jobs. Counts include all selected jobs, success and failure count only terminal states, `last_used_at` is the maximum non-null `started_at`, and durations or token totals aggregate only provider-reported non-null values; an empty aggregate remains null rather than being estimated or replaced with zero. The query never scans snapshots or reconstructs ownership after a deleted channel has set the job foreign key to null.

Channel operation history remains a projection over the append-only `audit_logs` table. New model create, update, enable, disable, delete, and test entries include the non-sensitive `channel_id` in `change_summary`; existing models also relate older entries through their current foreign key. Historical events for already-deleted models without `channel_id` remain only in the global audit log and are not guessed into a channel history. Model discovery and testing record only status, counts, and stable error codes, never credentials, Header values, provider response bodies, or complete sensitive errors.

The provider execution invariant remains `AT_MOST_ONCE`: after any request byte is sent, no automatic provider retry is allowed. An explicit retry creates a new `generation_jobs` row linked through `retry_of_id`, retaining its own immutable, non-sensitive snapshot. The UI therefore exposes the fixed policy “仅手动重试” and no retry-count configuration.

### 0022 GEO Observation Insights

版本 `0022` 紧跟 `0021_ai_channel_model_management`，保证 Alembic 只有一个线性 head；它不修改 AI 渠道数据或约束。

新建 `MANUAL_ARTICLE_SEARCH` 观测必须关联真实 `query_topic_id`。`0022` 之前的人工观测通过 `NOT VALID` 约束保留历史 `NULL`，洞察聚合会明确排除这些记录，不把它们猜测到某个问题主题。首次追加式更正历史空主题记录时必须补充真实主题，后续更正不得改变主题。

`geo_observation_publications` 新增可空的 `discovered`、`mentioned`、`cited` 和 `accuracy` 事实，既有行保持 `NULL`。新人工关系必须提交全部事实，并满足累计阶段 `cited -> RECOMMENDED -> mentioned -> discovered`；只有 `ACCURATE` 要求已达到引用阶段。旧模型观测关系必须保持全部逐篇事实为空。插入触发器继续校验发布内容归属、可观测状态和非空公开链接。

洞察只聚合更正链当前链尾中的完整人工观测；服务必须先校验同次观测的全部逐篇关系，再应用内容平台、内容主题或发布内容筛选，不能用筛选隐藏缺失事实。趋势率、平台率、内容排行和漏斗统一以“人工观测 × 发布内容关系”为基础单位；问题覆盖先按人工观测、问题主题和精确 GEO 平台去重。曾真实发布且仍被历史观测引用的发布记录在下线后继续可筛选追溯。分母为零时保持 `NULL`，历史不完整记录进入数据质量排除计数，迁移与服务均不推断缺失事实。只要已经写入新主题关联或逐篇洞察事实，迁移就拒绝降级；恢复必须使用前向修复或迁移前备份。

### 0023 Platform Management

版本 `0023` 紧跟 `0022_geo_observation_insights`。`platform_profiles.is_active BOOLEAN NOT NULL` 是具体平台启停的唯一业务状态；迁移把所有既有平台显式回填为 `true`，新建平台也显式写入 `true`。`0025` 后，配置完整只表示存在当前具体平台 Prompt，不保存派生列、汇总行或历史快照。

停用平台仍可查看、编辑、重新启用及维护 Prompt，但所有新建 `ContentTask`（包括发布异常修复任务）、`PlatformAccount` 和 `PublicationRecord` 的服务必须先锁定同一平台行并拒绝 `is_active=false`。停用不修改既有账号的 `is_active`，不修改 Prompt、任务、内容、发布、GEO 或审计历史。平台启用、停用与所有受限新建路径遵循“先锁平台，再检查状态并写入”的统一锁顺序，防止并发检查后写入穿透。

平台配置完整性、账号数量和引用次数均为 PostgreSQL 实时投影。平台引用数直接统计 `content_tasks.platform_profile_id` 的唯一 `ContentTask.id`；最近 30 天使用同一 UTC `as_of` 和半开区间 `[as_of - 30 days, as_of)`，历史数不设时间下界。`content_tasks(platform_profile_id, created_at)` 与 `platform_accounts(platform_profile_id, is_active)` 支持聚合；`audit_logs(target_type, target_id, created_at DESC)` 支持平台创建、编辑、启用和停用的真实时间投影。无对应审计时返回 `NULL`，不得使用迁移时间补造。

平台物理删除在任一内容任务或平台账号存在时返回结构化 `409`，不得自动停用、级联删除或改写历史。`0023` 降级会删除启停状态，只能在业务确认可丢失当前停用事实后执行；旧迁移与冻结的 `migration_schema_v1.py` 保持不变。

### 0024 Audit Outcome

版本 `0024` 紧跟 `0023_platform_management`，继续以现有 `audit_logs` 作为唯一业务审计来源。表新增必填 `business_module`、`outcome`、`result_message` 和可空 `error_code`；`outcome` 只允许 `SUCCESS | FAILED | DENIED`，`business_module` 只允许契约声明的九个模块。失败的创建命令尚无真实对象，因此 `target_id` 改为可空；任何读取方都必须显式处理该状态，不得补造 UUID。

历史 action/target 组合必须先通过迁移内的完整分类校验，再回填模块。既有同事务追加记录默认为 `SUCCESS`；只有 `ai_model.tested` 的失败测试和 `ai_channel.models_discovered` 的已记录失败按其稳定字段精确回填为 `FAILED`，其他历史结果不得从自由文本或 HTTP 状态猜测。迁移新增 `audit_logs(created_at DESC, id DESC)` 以保证全局分页稳定；既有目标时间索引保留。

成功业务状态和成功审计仍在一个事务内提交。经批准的九类关键命令在业务错误或权限拒绝时先回滚业务事务，再使用独立短事务追加 `FAILED` 或 `DENIED`；其他现有写命令暂时保持成功审计。请求解析、未登录、失效会话、强制改密和 CSRF 失败属于访问边界，不写业务审计。`details` 只保存服务端白名单 `changes/facts` 或经明确兼容投影的历史安全字段，API 不返回原始 JSONB，也不对其全文检索。

审计时间按 UTC 存储和传输，查询时间窗采用半开区间 `[created_from, created_to)`。`actor_id` 继续使用 `SET NULL`，响应中的姓名和账号类型是当前用户目录投影而非历史快照。`request_id` 允许重复，只用于关联链路，并限制为 1 至 100 个可打印 ASCII 字符。表级 append-only 触发器继续禁止 `UPDATE/DELETE`；若存在空 `target_id` 的失败创建记录，降级必须拒绝恢复 `NOT NULL`，不得删除或篡改历史。

### 0025 Markdown Facts And Direct Platform Tasks

版本 `0025` 紧跟 `0024_audit_outcome`，一次性删除结构化产品事实和平台规则版本两套已废弃业务模型。历史迁移、`migration_schema_v1.py` 和既有不可变生成快照保持冻结；当前 Schema 只由本 revision、运行时 ORM 和本契约表达。

`products` 新增 `facts_body_markdown TEXT NOT NULL` 与 `facts_classification VARCHAR(16) NOT NULL`，后者只允许 `PUBLIC | INTERNAL | RESTRICTED`；既有 `facts_revision` 继续作为事实工作区乐观锁。新产品初态正文为空且分级为 `RESTRICTED`，保存事实命令必须拒绝去除空白后为空的正文并原样保存非空 Markdown。`fact_versions` 以 `body_markdown` 和 `classification` 替换 `snapshot_json`；新版本必须从同一产品工作区冻结非空正文与分级，历史空版本可继续被旧记录引用，但不能创建新内容任务。

迁移使用 revision 文件内冻结的确定性 Markdown 渲染器分别处理当前规范化工作区和每个历史 `snapshot_json`。渲染器只按固定章节、稳定记录顺序和字段顺序输出数据库已有值，不总结、归并、补值或调用 AI。分级取已有 Evidence 中限制最高的值，顺序为 `RESTRICTED > INTERNAL > PUBLIC`；没有可确定 Evidence 分级时写入 `RESTRICTED`。渲染和行数校验完成后删除 `parameter_evidence_links`、`replacement_evidence_links`、`claim_evidence_links`、`part_parameters`、`replacement_relations`、`fact_claims`、`evidences`、`reference_parts`，但不删除独立 `file_records`。

`content_tasks` 新增 `platform_profile_id UUID NOT NULL REFERENCES platform_profiles(id) ON DELETE RESTRICT` 和 `(platform_profile_id, created_at)` 索引。迁移通过原 `platform_profile_version_id -> platform_profile_versions.platform_profile_id` 唯一回填；任一任务无法回填时整个 revision 失败。随后删除 `platform_profile_version_id`、`platform_type_id`、`platform_type_snapshot`、`user_prompt_markdown`、任务分级三字段、受众、角度、转化目标、格式、长度与 `canonical_url`，以及对应检查与索引。`query_topic_id` 和 `source_publication_attention_id` 保持原义。

删除全部 `platform_profile_versions` 数据和表。`PlatformProfile` 是任务与发布的唯一平台身份，`PlatformPrompt` 是系统 AI 的唯一当前 system Prompt，`PlatformProfile.allowed_domains` 是发布 URL 的唯一平台域名规则。平台配置完整只表示已配置当前 Prompt；缺少 Prompt 不阻止创建内容任务或人工首稿，只阻止系统 AI 作业。平台引用数直接统计 `content_tasks.platform_profile_id`，平台物理删除由任务和平台账号直接引用共同阻断。

新普通内容任务请求精确写入 `product_id`、同产品非空 `APPROVED fact_version_id` 和活动 `platform_profile_id`，并固定 `query_topic_id=NULL`。发布异常修复任务继承原任务的平台和可空目标问题，只允许选择同产品非空 `APPROVED fact_version_id`；不复制已删除任务要求。发布平台等值的应用校验与 PostgreSQL 触发器都直接比较 `content_tasks.platform_profile_id` 和 `platform_accounts.platform_profile_id`。

新原始生成快照使用 `contract_version=content-markdown-v2`，冻结非敏感渠道、模型、平台身份、事实版本身份及分级、`system_message` 和 `user_message`。实际供应商请求必须恰好包含两条消息：system 正文逐字等于创建作业时读取的 `PlatformPrompt.template_markdown`，user 正文逐字等于 `FactVersion.body_markdown`；校验空白时不得改写原字符串。只有事实版本分级为 `PUBLIC` 才允许第三方出站。系统不再追加固定前缀、任务 Prompt、任务要求、产品元数据、事实 JSON 或平台规则。

自然化继续复用现有 `generation_jobs`，新快照版本为 `humanization-markdown-v2`，只冻结当前自然化 Prompt、来源文章、来源原始作业、事实版本身份及最终消息，不读取结构化事实、任务要求或平台规则。历史 `chat-json-v1` 与 `humanization-json-v1` 快照不改写且只读；不得从旧快照创建重试。迁移锁定 `generation_jobs` 并在发现任一旧契约 `PENDING | RUNNING` 作业时失败，部署必须先停止新流量并清空或显式终止旧作业。

任务级人工首稿直接创建 `ContentVersion(source_type=HUMAN, source_job_id=NULL, based_on_id=NULL, status=DRAFT)`，不创建生成作业。标题、摘要、Markdown 正文、标签和变更说明仍由现有内容版本契约校验；后续人工修订、审核、唯一批准版本、人工发布、状态事件和内容哈希与 AI 草稿完全共用。

事实与内容审核上下文不再投影 Evidence 状态。质量检查删除平台规则长度/禁用表达、任务受众/角度/格式/长度和结构化参数数字来源检查，只保留严格四字段模型 JSON、标题/摘要/正文非空、Markdown 安全渲染、内容哈希、状态转换、唯一批准版本和发布域名等确定性边界。

该 revision 的 downgrade 明确失败。恢复旧结构化关系或规则版本只能使用迁移前 PostgreSQL 备份，不得根据 Markdown 或历史快照反向猜测数据。

## State Machines

```text
FactVersion: DRAFT -> PENDING_REVIEW -> APPROVED -> RETIRED
                               \-> CHANGES_REQUESTED -> PENDING_REVIEW

ContentVersion: DRAFT -> PENDING_REVIEW -> APPROVED -> SUPERSEDED
                                  \-> CHANGES_REQUESTED -> PENDING_REVIEW

ContentTask: OPEN -> CANCELLED
             OPEN -- first related PublicationRecord.VERIFIED --> COMPLETED

GenerationJob: PENDING -> RUNNING -> SUCCEEDED | FAILED
               (applies to both GENERATE and HUMANIZE)

PublicationRecord:
PENDING_MANUAL_PUBLISH -> PLATFORM_REVIEW -> PUBLISHED -> VERIFIED
                       -> REJECTED
PUBLISHED -> REMOVED | VERIFICATION_FAILED
VERIFIED -> REMOVED | VERIFICATION_FAILED

PublicationAttention: OPEN -> RESOLVED

PlatformProfile: ENABLED <-> DISABLED

FileRecord: PENDING -> VERIFIED | FAILED | ABORTED
```

State changes not shown above are invalid. A rejected immutable fact or content version may be resubmitted after its editable source/workflow has been corrected, but its frozen payload is never rewritten. Content body changes still create a new immutable content version.

## Required Constraints

- Product identity is unique by normalized brand plus part number.
- Version numbers are unique within their owner: product fact or content task.
- Product or content-task owner rows are locked while allocating the next version number.
- A product has one Markdown fact workspace protected by `facts_revision`; new fact versions freeze its non-blank Markdown and classification.
- Approved fact versions permit status-only transition to `RETIRED`; all other columns are immutable.
- Content versions permit only valid status transitions; publishable fields are immutable.
- `users.account_type` is the only permission source. `ADMIN` includes all `ENGINEER` abilities and exclusively manages users and configuration.
- At least one active `ADMIN` must remain after every user account-type or active-state update.
- Sensitive AI values are encrypted with the deployment master key and never returned, audited, logged, or copied into generation snapshots.
- A platform type referenced by a platform profile cannot be deleted. Platform types do not own Prompts after `0014`.
- A concrete platform owns zero or one current Prompt. Deleting the Prompt keeps the platform selectable for manual content tasks but makes system AI generation unavailable until a Prompt is configured again.
- Platform Prompt update and deletion require optimistic revision matching against the locked current row. Its list `prompt_updated_at` is a nullable projection of `platform_prompts.updated_at`, never a stored summary or the platform profile's own update time.
- A concrete platform's `is_active` state is independent from configuration completeness. A disabled platform remains manageable but cannot be used to create a content task, repair task, platform account, or publication record; disabling never mutates existing accounts, configuration, or history.
- Platform completeness, account counts, and task-reference counts are real-time read projections. Completeness is true when the current platform Prompt exists; a task reference is counted once through `content_tasks.platform_profile_id`.
- A concrete platform stores at most one Logo source. Uploaded Logos must reference a `VERIFIED`, `PUBLIC`, `PLATFORM_LOGO` file; external Logo URLs and website URLs remain explicit nullable URI fields.
- Product, platform profile, platform account, and platform type physical deletion is admin-only. Services lock the target, count direct references, and return structured `409 details.references`; they never cascade, reassign, or rewrite immutable business history.
- A product can be physically deleted only when no `FactVersion`, `ContentTask`, or `GeoObservation` directly references it. A platform profile requires no content tasks or platform accounts; a platform account requires no `PublicationRecord`; a platform type requires no platform profiles.
- Channel deletion cascades to Headers and models. Historical job foreign keys become null while their immutable snapshots remain readable.
- A model can be enabled only after its own successful test. A channel can be enabled only when at least one child model has passed testing.
- A generation job performs at most one provider call. Expired worker leases fail explicitly; retries create a new job and preserve the original non-sensitive v2 snapshot. Legacy v1 snapshots are read-only and cannot be retried.
- Automatic recovery dispatches only overdue `PENDING` jobs. Dispatch counters, queue ages, failure codes, and provider duration diagnostics must never contain prompts, response bodies, credentials, or sensitive Headers.
- Third-party AI egress requires the bound fact version to be explicitly `PUBLIC`; missing, legacy-empty, `INTERNAL`, or `RESTRICTED` fact data is a hard denial.
- Original generation sends exactly one system message equal to the current platform Prompt and one user message equal to the frozen fact Markdown; no prefix, task field, metadata, JSON wrapper, repair, model switch, or fallback is allowed.
- A manual first draft creates a `HUMAN DRAFT` content version with null generation and parent lineage, then uses the same review and publication gates as AI content.
- A publication can reference only an approved content version whose fact is not retired at creation time.
- A publication account profile must equal the content task's locked platform profile; both the application service and PostgreSQL enforce it.
- `PUBLISHED` and `VERIFIED` publications require a valid HTTP(S) URL matching the configured platform domain.
- Candidate evidence and `mark-published` result evidence must be verified `OPERATION_SCREENSHOT` files and share the append-only `publication_attachments` relation. Result evidence, final URL, publication time, status event, and audit record commit or fail together.
- Task completion has no public manual command. The first verified publication completes an open task atomically; completed tasks never revert.
- Open publication attention is the only publication-loss todo source. Repair-task creation and attention resolution are separate explicit commands.
- Fact and content review records are append-only, and every request-changes command requires a non-blank comment.
- Observation accuracy `UNJUDGEABLE` is excluded from the accuracy-rate denominator.
- Manual GEO observations cover every currently `PUBLISHED | VERIFIED` article for one product, use exactly one complete cumulative stage result per article, associate a real query topic, and include at least one verified operation screenshot.
- Historical GEO publication associations with null insight facts remain explicitly incomplete and never enter manual insight denominators.
- Audit log details must not contain passwords, session cookies, AccessKeys, model keys, or unpublished source documents.
