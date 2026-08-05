# PartSignal Database Contract

## Conventions

- PostgreSQL 16 is the only supported business database.
- Tables and columns use `snake_case`; identifiers are UUID; timestamps are timezone-aware UTC.
- Mutable aggregates carry an integer `revision`; clients must submit `expected_revision`.
- Alembic is the only schema migration entry point. API and Worker never run migrations on startup.
- Revisions `0001` through `0008` use `app.migration_schema_v1` as a frozen metadata snapshot; future runtime model changes must add a new revision and must not edit that snapshot.
- JSONB is limited to immutable generation snapshots, structured generation output, and audit details. Editable product facts use one Markdown body on `products`; platform rules and normalized fact subgraphs no longer exist after `0025`.
- Review records, publication work events, publication verifications, observations, and audit logs cannot be modified in place。`0027` 仅在物理删除停用用户时允许把匹配 `audit_logs.actor_id` 置空；`0029` 允许管理员按完整更正链删除人工 GEO 观测；`0037` 允许普通删除未成功发布的任务聚合，并允许管理员永久删除已归档任务聚合。发布与 GEO 历史在保留期间仍禁止原地改写，删除只能从显式业务命令进入。

## Migration Order

### 0001 Identity And Audit

`users`, `roles`, `user_roles`, `sessions`, `audit_logs`.

This historical revision created six fixed roles. Revision `0009` migrates them to the current two-account-type model and removes `roles` and `user_roles`.

### 0002 Product Facts

`products`, `reference_parts`, `part_parameters`, `replacement_relations`, `evidences`, `parameter_evidence_links`, `replacement_evidence_links`, `fact_claims`, `claim_evidence_links`, `fact_versions`, `fact_review_records`.

这些规范化事实表和 `fact_versions.snapshot_json` 仅描述历史 revision；`0025` 已将当前事实模型收敛为产品 Markdown 工作区和不可变 Markdown 事实版本，并物理删除规范化事实子图。

### 0003 Content Planning

`query_topics`, `platform_profiles`, `platform_profile_versions`, `content_tasks`.

`platform_profile_versions` 仅描述历史 revision，已由 `0025` 物理删除。当前 `content_tasks` 直接绑定具体 `platform_profile_id` 和同产品的非空 `APPROVED fact_version_id`，不会随配置变化静默改绑。Revision `0032` 为普通任务创建增加可空且唯一的 `idempotency_key`：同键同三字段重放返回原任务，同键异载荷冲突，不同键仍允许相同业务输入；历史任务和发布修复任务保持空值。

### 0004 Content Production

`generation_jobs`, `content_versions`.

`generation_jobs.idempotency_key` is unique. Redis carries only the job UUID. A unique `content_versions.source_job_id` prevents duplicate drafts. Worker execution rechecks the current task, product, and approved fact before and after generation; expired `RUNNING` leases are recovered from PostgreSQL by Celery Beat. Content title, summary, Markdown body, tags, fact references, and hash are immutable after insert.

### 0005 Content Review

`content_review_records` plus immutability and task-version constraints.

Approving a new version and superseding the previous approved version happen in one transaction. Creators may approve their own fact or content versions; all state, evidence, and quality gates still apply.

### 0006 Publication

`platform_accounts`, `publication_records`, `publication_status_events`.

Platform accounts contain an internal business label and operator identifier, never credentials. A concrete platform may own multiple accounts, while one article publication selects exactly one account. A publication permanently binds one approved content version. Reuse of an idempotency key must match content, account, section URL, and attachment IDs; concurrent requests are serialized with PostgreSQL transaction advisory locks. After `PUBLISHED`, URL and content binding cannot change.

Current-state counts come from `publication_records.status`. Period publication metrics and recent activity come from append-only `publication_status_events`, and their shared `as_of` comes from the PostgreSQL clock: a rolling window cohort is the distinct records whose `PUBLISHED` event falls inside `[window_start, as_of)`, verification count is the cohort subset with any later `VERIFIED` event by `as_of`, and exception count is the distinct records receiving `REJECTED`, `REMOVED`, or `VERIFICATION_FAILED` inside the same window. A later removal never removes the historical publication from its original cohort.

### 0007 GEO Observation

`geo_observations`, `geo_observation_citations`, `geo_observation_publications`.

Observations are immutable. Corrections create another observation with `supersedes_id`. Metrics are calculated from source observations rather than persisted as a second source of truth. Revision `0029` later adds one guarded exception that permits administrators to delete an entire manual-observation correction chain.

### 0008 Files

`file_records`, `publication_attachments`, `geo_observation_attachments`, plus historical `evidences.file_record_id`.

Only `VERIFIED` files may be linked. Publication attachments additionally require `category=OPERATION_SCREENSHOT` in both candidate creation and `mark-published`; other modules enforce their own category contracts at their service boundaries. `publication_attachments` is one append-only evidence relation used in both publication phases, with no mutable phase or replacement field. Revision `0025` later deletes `evidences` and its file foreign key; the current head therefore has three actual `file_records` references: platform Logo, publication attachment, and GEO observation attachment. Revision `0029` permits only the GEO attachment rows belonging to a declared full-chain manual-observation deletion to be removed.

### 0009 Configuration Center And AI Generation

`users` gains `account_type` (`ADMIN | ENGINEER`) and `must_change_password`. Existing users with `SYSTEM_ADMIN` become `ADMIN`; all other existing users become `ENGINEER`. After the mapping, `roles` and `user_roles` are removed so `users.account_type` is the only permission source. Disabling a user or resetting a password revokes all active sessions. A transaction may not disable or demote the last active `ADMIN`. Revision `0027` later adds a restricted physical-deletion path for disabled, unreferenced users.

新账号默认启用，管理员提供的 `temporary_password` 只保存安全哈希，并固定写入 `must_change_password=true`；新建账号临时密码最少 12 位，重置临时密码和用户自助改密的正式新密码最少 8 位。列表摘要由 PostgreSQL 对全部用户实时聚合，不保存统计快照，也不从审计推测趋势；`admin_total` 统计全部实际 `ADMIN`，不因停用而排除。单个与批量启停共享同一行锁、revision、最后启用管理员保护、会话撤销和逐用户审计不变量；合法批量命令只把写入前的预期业务错误作为逐项失败，任何数据库、编程或审计异常都回滚整批。用户 CSV 只导出批准的非敏感业务列，完整生成后追加 `user.exported` 审计；停用或重新启用只改变当前用户状态，不删除、改绑或改写任何历史业务与审计外键。

`platform_types` owns a unique category `slug`. Revision `0009` initially placed one mutable Markdown system Prompt under each type; revision `0014` replaced that ownership with one current Prompt per concrete platform。`0025` 又删除了任务上的类型快照和可编辑 Prompt；当前任务只直接绑定具体平台，生成输入由平台 Prompt 与事实版本 Markdown 唯一决定。

`ai_channels` owns an encrypted API key, timeout, and connection state. `ai_channel_headers` belongs only to a channel, normalizes names case-insensitively, and stores exactly one of a plain or encrypted value. `ai_models` belongs to a channel and stores the provider `model_id`, display name, exact JSON request parameters, and model-level test state. Channels and models default disabled. Connection, credential, or Header changes disable the channel and invalidate every child model test; model ID or parameter changes disable and invalidate that model.

`generation_jobs` gains nullable `ai_channel_id` and `ai_model_id` foreign keys using `SET NULL`, provider request metadata, and nullable token usage. `input_snapshot` is the authoritative immutable generation input and retains channel/model identity, non-sensitive connection data, model parameters, final system/user messages, platform identity and approved fact version after current configuration is deleted. Credentials and sensitive Header values never enter the snapshot. `content_versions` removes model-reported fact, evidence, and disclosure ID arrays; traceability comes from `fact_version_id`, `source_job_id`, and the job snapshot.

### 0010 Legacy User Cleanup

This irreversible data migration recognizes only `product_editor`, `product_reviewer`, `content_reviewer`, and `analyst`. It locks all matching users and checks every user-owned business or audit foreign key before deleting any row. Any reference aborts the complete migration and reports the username plus referring table and column; ownership is never reassigned and historical data is never deleted. When no references exist, sessions for the four users are removed before the users. An existing `content_editor` keeps its password, account type, active state, and profile but receives `must_change_password=true` with an incremented revision.

After migration, `seed-demo` idempotently ensures only `admin` and `content_editor`. Their initial passwords come from `PARTSIGNAL_SEED_ADMIN_PASSWORD` and `PARTSIGNAL_SEED_ENGINEER_PASSWORD`; existing accounts are never overwritten. A newly created `content_editor` has account type `ENGINEER` and must change its initial password. At this revision the cleanup was the only physical user-deletion exception; revision `0027` later adds the restricted application deletion contract.

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

Administrators may physically delete a `fact_version` in any status only when neither `content_tasks` nor `content_versions` references it. The service locks the target, reports every non-zero direct reference, explicitly deletes subordinate `fact_review_records`, and deletes the version in the same transaction. Each `fact_review_record` is owned by its exact `fact_version_id`; a version review context must query that parent ID and never aggregate sibling versions through `product_id`. This administrative cleanup is the only exception to normal append-only review history; it never cascades to or rewrites tasks, content, generation, publication, or observation history, and product deletion never implicitly deletes fact versions.

Revision `0016` replaces only the `fact_review_records` append-only trigger. `UPDATE` remains forbidden, and `DELETE` is allowed only when the transaction-local `partsignal.fact_version_delete_id` exactly matches the row's parent version. The service sets that value only after locking the version, proving it has no content references, and recording the safe audit summary. Other append-only tables and the `RESTRICT` foreign key are unchanged; downgrade restores the original generic trigger.

### 0017 Optional Content Humanization

`content_humanization_prompts` is a database-enforced singleton (`id = 1`) containing the only current naturalization Prompt. The migration inserts no row: an administrator must explicitly create the first value, and every row records a real `updated_by` user plus an optimistic-lock `revision`. There is no seed value, environment fallback, platform copy, delete operation, or second runtime source.

`generation_jobs.job_type` is required and limited to `GENERATE | HUMANIZE`; historical rows are backfilled to `GENERATE` before the migration removes the column default. `source_content_version_id` uses `RESTRICT` and is paired with the type: original generation must have no source, while naturalization must have one. A partial unique index on `source_content_version_id` where the type is `HUMANIZE` and status is `PENDING | RUNNING` prevents concurrent active jobs for the same source.

A successful naturalization creates a new immutable `content_versions` row with `source_type = AI`, `source_job_id` pointing to the naturalization job, and `based_on_id` pointing to the frozen source version. It never updates the source. The job snapshot is the authority for the selected model, global Prompt revision and Markdown, complete source article and hash, original approved facts, PUBLIC classification, task requirements, and final messages; credentials remain outside snapshots and Redis still carries only the job UUID.

The API and Worker both require an `OPEN` task, an `AI` source in `DRAFT | CHANGES_REQUESTED`, a non-blank approved `PUBLIC` fact version, and an active product. Worker validation occurs before and after the provider call, including source identity, status, type, task/fact binding, frozen hash, and original generation lineage. Once any `HUMANIZE` job exists, revision `0017` refuses downgrade so immutable AI history cannot become unreadable; deployment must use a forward fix.

New generation snapshots include the concrete platform identity and continue freezing the final system/user messages. Old immutable snapshots may omit the concrete-platform object only for historical reads; new writes must include it. Platform Prompts can diverge after migration, so `0014` does not guess how to merge them on downgrade; rollback requires the pre-migration PostgreSQL backup.

### 0018 Manual GEO Article Observation

`geo_observations.observation_kind` explicitly separates historical `LEGACY_MODEL_RESULT` rows from new `MANUAL_ARTICLE_SEARCH` rows. The migration assigns the legacy discriminator without changing any historical business field. Legacy query/model/answer fields and new `search_platform/search_query` fields are mutually exclusive under a database check; new writes have no target question, model call, web-search flag, answer summary, citation, accuracy, or observation-level recommendation.

At revision `0018`, `geo_observation_publications.recommendation_status` was the authoritative per-article result for manual observations and was limited to `RECOMMENDED | NOT_RECOMMENDED`. Historical associations remained `NULL` and meant “not assessed per article”; the migration never inferred a status from old citations, possible-influence links, or observation-level recommendation. Revision `0029` later removes this field instead of preserving an obsolete compatibility value. The insert trigger continues verifying that every new result belongs to the observation product through `PublicationRecord -> ContentVersion -> ContentTask`, the publication is currently `PUBLISHED | VERIFIED`, and `final_url` is present.

The create service locks the product and all current eligible publication rows, then requires the request to cover that exact publication ID set. Revision `0018` required at least one verified `OPERATION_SCREENSHOT`; revision `0029` makes evidence optional. Article titles, platform identity, links, and publication status remain projections of their existing owners and are not duplicated in GEO storage. Metrics and the default records list use the same filtered set of current correction-chain tails; `include_history=true` is the explicit read path for superseded rows. A row is current only when no `geo_observations.supersedes_id` points to it.

Correction is an append-only service operation over the existing schema: it creates a new `MANUAL_ARTICLE_SEARCH` row whose `supersedes_id` points to the current manual row. The service rejects already-superseded targets and changes to the product, search platform, or search query. No new table, column, index, migration, or duplicated summary field is introduced for the records page.

Manual GEO history is forward-only. Once a `MANUAL_ARTICLE_SEARCH` row exists, revision `0018` refuses downgrade because removing the discriminator, search fields, or article results would destroy immutable business meaning.

### 0019 Product-Driven Content Tasks

`content_tasks.query_topic_id` becomes nullable while retaining its `RESTRICT` foreign key. Existing tasks are not rewritten and keep their real query-topic UUID; new ordinary tasks and repair tasks originating from them store `NULL`. `0025` 后，新普通任务只需产品、同产品非空 `APPROVED` 事实版本和活动具体平台；人工首稿不依赖平台 Prompt，系统 AI 生成才要求当前 Prompt。

`ContentTaskCreate` no longer accepts a query topic. New generation snapshots omit the `query_topic` object entirely rather than storing null, an empty object, or an invented question. Historical tasks still resolve and freeze their real query topic when creating a new generation job. Repair tasks inherit the original task's nullable link, and repair context returns a nullable query-topic projection for explicit new/legacy handling.

Revision `0019` rewrites no task or immutable job snapshot. It refuses downgrade before restoring `NOT NULL` when any product-driven task exists; rollback after new writes requires a forward fix or the pre-migration PostgreSQL backup, never a placeholder query topic.

### 0020 Platform Branding And Task List Projection

`platform_profiles` gains nullable `website_url`, `logo_file_id`, and `logo_external_url`. The uploaded Logo foreign key uses `RESTRICT`; the referenced `file_record` must be a `VERIFIED`, `PUBLIC`, `PLATFORM_LOGO` object before the application accepts it. A database check permits at most one Logo source, so an uploaded file and an external URL are never stored together. Signed object-storage URLs are response projections and are never persisted. Revision `0028` later makes `logo_external_url` read-only for legacy rows; new writes only bind `logo_file_id`.

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

`geo_observation_publications` 在 `0022` 新增可空的 `discovered`、`mentioned`、`cited` 和 `accuracy` 事实，既有行保持 `NULL`。该版本曾要求新人工关系提交累计阶段事实；`0029` 随后删除逐篇推荐和引用，只保留相互独立的 `discovered`、`mentioned` 与可空 `accuracy`。旧模型观测关系必须保持全部逐篇事实为空。插入触发器继续校验发布内容归属、可观测状态和非空公开链接。

洞察只聚合更正链当前链尾中的完整人工观测；服务必须先校验同次观测的全部逐篇关系，再应用内容平台、内容主题或发布内容筛选，不能用筛选隐藏缺失事实。`0029` 后，趋势率、平台率和内容排行统一按相互独立的发现、提及、准确事实计算，不再提供阶段漏斗。问题覆盖先按人工观测、问题主题和精确 GEO 平台去重。曾真实发布且仍被历史观测引用的发布记录在下线后继续可筛选追溯。分母为零时保持 `NULL`，历史不完整记录进入数据质量排除计数，迁移与服务均不推断缺失事实。只要已经写入新主题关联或逐篇洞察事实，迁移就拒绝降级；恢复必须使用前向修复或迁移前备份。

### 0023 Platform Management

版本 `0023` 紧跟 `0022_geo_observation_insights`。`platform_profiles.is_active BOOLEAN NOT NULL` 是具体平台启停的唯一业务状态；迁移把所有既有平台显式回填为 `true`，新建平台也显式写入 `true`。`0025` 后，配置完整只表示存在当前具体平台 Prompt，不保存派生列、汇总行或历史快照。

停用平台仍可查看、编辑、重新启用及维护 Prompt，但所有新建 `ContentTask`（包括发布异常修复任务）、`PlatformAccount` 和 `PublicationRecord` 的服务必须先锁定同一平台行并拒绝 `is_active=false`。停用不修改既有账号的 `is_active`，不修改 Prompt、任务、内容、发布、GEO 或审计历史。平台启用、停用与所有受限新建路径遵循“先锁平台，再检查状态并写入”的统一锁顺序，防止并发检查后写入穿透。

平台配置完整性、账号数量和引用次数均为 PostgreSQL 实时投影。平台引用数直接统计 `content_tasks.platform_profile_id` 的唯一 `ContentTask.id`；最近 30 天使用同一 UTC `as_of` 和半开区间 `[as_of - 30 days, as_of)`，历史数不设时间下界。`content_tasks(platform_profile_id, created_at)` 与 `platform_accounts(platform_profile_id, is_active)` 支持聚合；`audit_logs(target_type, target_id, created_at DESC)` 支持平台创建、编辑、启用和停用的真实时间投影。无对应审计时返回 `NULL`，不得使用迁移时间补造。

在 `0023` 的初始合同中，任一内容任务或平台账号都会阻断平台物理删除。`0037` 已把当前规则收缩为“先停用，仅 `OPEN` 任务和非终态发布工作阻断”，并允许清理平台账号但绝不级联任务。`0023` 降级会删除启停状态，只能在业务确认可丢失当前停用事实后执行；旧迁移与冻结的 `migration_schema_v1.py` 保持不变。

### 0024 Audit Outcome

版本 `0024` 紧跟 `0023_platform_management`，继续以现有 `audit_logs` 作为唯一业务审计来源。表新增必填 `business_module`、`outcome`、`result_message` 和可空 `error_code`；`outcome` 只允许 `SUCCESS | FAILED | DENIED`，`business_module` 只允许契约声明的九个模块。失败的创建命令尚无真实对象，因此 `target_id` 改为可空；任何读取方都必须显式处理该状态，不得补造 UUID。

历史 action/target 组合必须先通过迁移内的完整分类校验，再回填模块。既有同事务追加记录默认为 `SUCCESS`；只有 `ai_model.tested` 的失败测试和 `ai_channel.models_discovered` 的已记录失败按其稳定字段精确回填为 `FAILED`，其他历史结果不得从自由文本或 HTTP 状态猜测。迁移新增 `audit_logs(created_at DESC, id DESC)` 以保证全局分页稳定；既有目标时间索引保留。

`0024` 当时让九类关键命令在业务回滚后以独立事务追加 `FAILED` 或 `DENIED`。`0037` 已移除该运行时行为并清理对应历史；当前只允许保留白名单内的 `SUCCESS` 与业务状态同事务提交。`details` 只保存白名单 `changes/facts`，API 不返回原始 JSONB，也不对其全文检索。

审计时间按 UTC 存储和传输，查询时间窗采用半开区间 `[created_from, created_to)`。`actor_id` 使用 `SET NULL`，响应中的姓名和账号类型是当前用户目录投影而非历史快照。`request_id` 允许重复，只用于关联链路，并限制为 1 至 100 个可打印 ASCII 字符。`0037` 后专用触发器禁止普通 UPDATE，只放行受约束的操作者置空；任务聚合删除可精确删除旧目标审计，但没有通用审计删除 API。

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

### 0026 Publication Account Deduplication

`platform_accounts` 新增非负 `revision`，业务标签与内部运营账号标识均须在 `btrim` 后非空。同一具体平台内，`lower(btrim(account_identifier))` 必须唯一；停用账号仍占用标识，不同具体平台可以保存相同标识。写入边界去除两侧空白但保留大小写用于内部展示。运营标识可以是平台用户名，也可以是“注册手机号 + 持有人”等内部组合，但不得保存密码、Cookie、令牌，不得进入日志或审计详情。

账号编辑和启停固定按“锁具体平台行、锁账号行、校验 expected revision、写业务与脱敏审计”的顺序执行。停用只影响新发布候选，不删除或改写历史引用；平台归属创建后不可编辑。迁移在创建规范化唯一索引前锁表并检查空值与重复组，发现无法无损处理的数据时以 `55000` 失败，不自动合并或删除账号。

人工发布以 `platform_profile_id + ContentVersion.content_hash` 作为平台内容身份。创建登记和 `mark-published` 都对该身份获取事务 advisory lock，并读取发布记录及追加式状态事件：存在非 `REJECTED` 尝试时禁止重复登记；任一记录曾出现 `PUBLISHED` 或 `VERIFIED` 事件后永久禁止同平台同内容再次登记或公开，后续 `REMOVED` 或 `VERIFICATION_FAILED` 不撤销公开事实。只有全部既有尝试从未公开且已进入 `REJECTED` 时，才允许换另一个启用账号重试。不同具体平台互不阻断，幂等键继续只负责同一请求重放。

### 0027 Guard Audit Actor User Delete

版本 `0027` 紧跟 `0026_publication_account_dedup`，不新增业务表或列，只把 `audit_logs` 的通用追加式触发器替换为操作者置空专用守卫。用户删除服务必须先锁定用户表和目标行，只允许删除 `is_active=false` 的账号；活动账号返回 `USER_ACTIVE`。会话沿既有外键级联清理，任一业务外键引用继续由 `RESTRICT` 阻断并映射为 `USER_IN_USE`。

删除事务先设置事务本地 `partsignal.user_delete_id`，随后仅允许在用户删除触发的外键级联上下文中，把匹配用户的 `audit_logs.actor_id` 从该 UUID 更新为 `NULL`，且 `to_jsonb(NEW) - 'actor_id'` 必须与旧行完全一致。错配用户、未声明事务变量、手工直接更新、把空操作者改为其他值、修改其他审计字段以及所有审计 DELETE 均以 `55000` 失败。用户删除成功后追加新的 `user.deleted` 审计事件，由实际执行删除的管理员作为操作者；历史审计事件保留但被删用户的当前目录投影为空。降级恢复原通用触发器。

本 revision 最初只允许删除没有 `generation_jobs` 或 `content_versions` 的 `CANCELLED` 任务；该旧规则已由 `0033` 的任务自有历史删除契约取代。

### 0028 Platform Logo Lifecycle

版本 `0028` 紧跟 `0027_audit_user_delete_guard`。`file_records` 新增可空 `cleanup_after` 与 `deleted_at`，状态扩展为 `DELETING | DELETED`；允许的新增转换只有 `PENDING | VERIFIED | FAILED | ABORTED -> DELETING -> DELETED`。`DELETED` 必须有 `deleted_at`，其他状态必须没有。对象元数据继续不可变。

管理员显式请求 Icon Horse 单候选时，服务端只访问固定 `https://icon.horse/icon/{规范化域名}`，校验 PNG、JPEG、WebP 或 ICO 后先持久化 `PENDING`，再写入自有对象存储并转为 `VERIFIED`。候选和手工上传完成的 `PLATFORM_LOGO` 设置 `cleanup_after = verified_at + 24 hours`；绑定任一平台时锁定文件并清空该字段。替换、清空或删除平台 Logo 后，仅在最后一个实际外键引用解除时设置 `cleanup_after = now() + 7 days`。

清理器以 PostgreSQL 为唯一权威，使用有限批次和 `FOR UPDATE SKIP LOCKED`。它在声明删除前实时检查 `platform_profiles.logo_file_id`、`publication_attachments.file_id`、`geo_observation_attachments.file_id`；不得查询 `0025` 已删除的 `evidences`，也不维护引用计数。到期 `PENDING`、任意 `FAILED | ABORTED`、到期 `VERIFIED` 和已有 `DELETING` 可被扫描；有引用时不得删除，无引用时先提交 `DELETING`，再幂等删除对象，成功后写 `DELETED/deleted_at`，暂时失败则保留 `DELETING` 供下一轮重试。

平台 Logo 外键触发器最终保证非空 `logo_file_id` 只引用 `VERIFIED`、`PUBLIC`、`PLATFORM_LOGO`。迁移把既有已引用 Logo 的 `cleanup_after` 保持为空，把既有无引用 `VERIFIED PLATFORM_LOGO` 设置为迁移时点后七天。`logo_external_url` 本阶段保留用于旧数据只读展示，创建和更新不再接受新的外链；迁移和 Worker 均不联网批量转换旧外链。存在任一 `DELETING | DELETED` 时禁止降级，因为对象删除不可逆。

### 0029 Manual GEO Independent Facts And Deletion

版本 `0029` 紧跟 `0028_platform_logo_lifecycle`。`geo_observation_publications` 物理删除 `recommendation_status` 与 `cited`，人工逐篇事实只保留相互独立且必须显式提交的 `discovered`、`mentioned`，以及允许为空的 `accuracy`（`ACCURATE | PARTIAL | INCORRECT | UNJUDGEABLE`）。迁移不根据旧阶段字段推断新事实；既有 `discovered`、`mentioned`、`accuracy` 原样保留。新建与更正的 `attachment_file_ids` 都允许为空，每个更正版本只关联当次新增文件；读取链尾时按祖先顺序聚合证据，不复制历史关联。

管理员只可按完整更正链物理删除 `MANUAL_ARTICLE_SEARCH` 观测，不能删除单个版本或 `LEGACY_MODEL_RESULT`。服务按产品、根观测、链节点的固定顺序锁定并验证链连续性，再在同一事务设置当前节点的 `partsignal.geo_observation_delete_id`，依次删除该节点的逐篇发布关系、附件关系及观测，最后写入只含稳定 ID 与数量的审计摘要。专用触发器继续禁止全部 UPDATE，只放行父 ID 与事务声明精确匹配的 DELETE；错配、缺少声明或不完整链均失败。

删除事务提交后，仅把已经没有平台 Logo、发布附件或 GEO 附件引用的文件安排进既有延迟清理状态机；清理器仍以三个实际外键为唯一引用权威，不保存引用计数，也不立即删除对象。通用文件清理不再限定 `PLATFORM_LOGO` 分类。审计不得记录搜索词、备注、回答、文件名或文件内容。该迁移会丢弃旧逐篇推荐与引用字段，降级仅恢复空列而不猜测历史值；恢复业务语义必须使用迁移前备份或前向修复。

### 0030 Controlled Publication Record Deletion

版本 `0030` 紧跟 `0029_geo_evidence_management`，不新增业务表或列。发布记录只有在完整状态事件历史从未出现 `PUBLISHED | VERIFIED`，且没有 `geo_observation_citations`、`geo_observation_publications` 或 `publication_attentions` 引用时才可物理删除；当前状态不是删除资格来源。发布关注事项一旦存在就阻断删除，因此经其关联的修复任务也不会失去来源。

删除服务使用现有的“具体平台 + 内容哈希”事务 advisory lock，再锁定发布记录并重新检查全部阻断引用。事务设置 `partsignal.publication_record_delete_id` 后，只允许删除目标记录的未公开状态事件、发布附件关系和记录本身；任何 `PUBLISHED | VERIFIED` 事件即使目标匹配也由数据库拒绝删除。错配目标、未声明事务变量、普通 UPDATE 和对其他聚合的 DELETE 均以 `55000` 失败。

删除成功只审计稳定目标 ID、状态事件数量和附件数量，不保存标题、URL、说明或文件名。解除附件关系后，只有已无平台 Logo、发布附件或 GEO 附件引用的文件才进入既有清理状态机；共享文件继续保留。发布周期指标仍来自保留的公开状态事件，因此受控删除不会改写任何已公开历史。

### 0031 Reusable Platform Prompts

版本 `0031` 紧跟 `0030_publication_record_deletion`。`platform_prompts` 改为独立模板库，以独立 UUID 为主键并新增全局唯一名称；`platform_profiles.platform_prompt_id` 是可空外键并使用 `ON DELETE RESTRICT`。一个平台最多绑定一份当前 Prompt，一份 Prompt 可被多个平台复用；配置完整性、缺失数量和平台投影都只从该外键实时派生。

迁移为每条旧 Prompt 保留原正文、revision、操作者和时间，并使用旧 `platform_profile_id` 作为新 Prompt UUID；名称确定为“平台名称（slug）”。复制和回绑完成后校验行数、正文与绑定关系，任一不一致都中止迁移。降级只允许每份 Prompt 恰好绑定一个平台且不存在未绑定模板，否则以 PostgreSQL `55000` 拒绝；迁移不按正文合并或猜测归属。

Prompt 更新锁定模板行并比较 `expected_revision`；保存前由管理端明确展示全部受影响平台。`0037` 起删除 Prompt 会在同一事务自动解绑全部当前平台并递增其 revision；平台删除仍不删除模板。新原始生成请求同时提交所确认的 Prompt UUID 与 revision，服务端锁定任务、平台及其当前绑定后重新校验，变化时返回 `PLATFORM_PROMPT_CHANGED`，不得使用过期确认。

新原始生成快照只写 `content-markdown-v3`，除既有最终消息、平台、事实、渠道和模型外，还冻结 Prompt 的 UUID、名称与 revision。`content-markdown-v2` 仅作为明确的历史类型继续读取并按原快照重试；后续换绑、更新或删除当前配置都不改变历史作业。自然化继续使用 `humanization-markdown-v2`。

### 0033 Controlled Content Task Owned History Deletion

版本 `0033_task_owned_history_delete` 紧跟 `0032_content_task_idempotency`，不新增业务表或列。只有 `CANCELLED` 任务可物理删除；该任务可以拥有生成作业、内容审核记录以及 `DRAFT | PENDING_REVIEW | CHANGES_REQUESTED` 内容版本。任一 `APPROVED | SUPERSEDED` 内容版本、任一关联发布记录或非空 `source_publication_attention_id` 都返回 `CONTENT_TASK_IN_USE` 并阻断删除。发布记录覆盖其 GEO 引用、文章观测和发布异常历史，修复来源单独阻断，因此任何下游历史都不会被清理。

服务按 UUID 顺序锁定目标任务的生成作业、内容版本和任务行，并在锁内重新检查状态与全部保护关系。事务设置 `partsignal.content_task_delete_id` 后，只允许把匹配任务内容版本的 `source_job_id` 置空，以及删除这些版本的审核记录；普通内容修改、审核记录 UPDATE、未声明或错配任务的 DELETE 继续以 `55000` 失败。服务随后依次删除任务生成作业、审核记录、未批准内容版本和任务，任一步失败都整体回滚。

删除成功只审计任务 UUID 与生成作业、内容版本、审核记录数量，不保存标题、正文、Prompt 或审核说明。产品、事实版本、平台、用户、发布、GEO 和既有审计均保持不变。任务列表与详情用同一批量保护历史投影决定 `DELETE` 动作，服务端仍是最终删除权限和状态权威。

### 0034 Publication Workflow Redesign

版本 `0034_publication_redesign` 紧跟 `0033_task_owned_history_delete`。该 revision 重新建立发布当前态：`publication_works` 保存一次人工发布工作的绑定和阶段，`publication_work_events` 与 `publication_verifications` 保存追加式历史，`published_articles` 保存首次核验成功后形成的只读公开成果，`published_content_issues` 保存发布后的页面问题，`publication_attachments` 只归属于发布工作。

新旧发布状态无法无损映射。迁移必须在替换结构前检查旧发布、关注事项、附件和依赖旧发布身份的 GEO 关系；任一非空时汇总表名与数量并以 PostgreSQL `55000` 中止，不删除、补值或猜测映射。通过预检后删除旧表与旧删除门禁，将 `content_tasks.source_publication_attention_id` 替换为唯一且不可改绑的 `source_published_content_issue_id`，并把 GEO 外键统一替换为 `published_article_id`。downgrade 同样以 `55000` 拒绝，恢复只能使用迁移前备份。

发布工作使用 `PREPARING | PLATFORM_REVIEW | AWAITING_VERIFICATION | ACTION_REQUIRED | COMPLETED | CLOSED`。失败核验只追加当时标题、URL、发布时间和说明快照，并把工作置为 `ACTION_REQUIRED`；后续结果修正仍发生在同一工作上。首次成功核验原子创建与工作同 ID 的 `PublishedArticle`，并完成工作和来源任务。显式关闭必须保存原因、说明、操作者和时间，并原子取消来源任务。成功成果不再回退；后续问题由 `PublishedContentIssue OPEN -> RESOLVED` 独立表达，创建修复任务不会自动解决问题。

工作终态字段、成果、事件、核验和问题历史由触发器冻结或限制为契约允许的状态变化。`0037` 起仍禁止日常单项删除，但管理员永久删除已归档任务时可在同一事务删除该任务拥有的发布聚合。GEO 新观测只能引用没有 `OPEN` 问题且从未以 `RETIRED` 解决问题的 `PublishedArticle`；打开问题与创建观测锁定同一文章，避免资格竞态。

### 0035 Business Workflow Primary Tasks

版本文件 `0035_business_workflow_primary_tasks.py` 紧跟 `0034_publication_redesign`，Alembic revision 为 `0035_business_workflow`。事实版本不再保存可重新提交的 `DRAFT`：事实工作区提交原子冻结一个 `PENDING_REVIEW` 版本，每个产品至多一个待审核版本；既有草稿或多待审核等歧义数据以 PostgreSQL `55000` 阻断迁移，不猜测业务结论。

`content_tasks.current_content_version_id` 是内容单主线的唯一当前指针。迁移只在每个任务的版本历史能确定唯一当前版本时回填；多个候选主线以 `55000` 阻断。当前草稿或退回版本可转为 `ABANDONED`，新修订和自然化结果通过原子更新该指针成为当前版本，旧版本保持不可变历史。数据库触发器校验当前版本必须归属同一任务，每个任务至多一个待审核内容版本。

`publication_works.content_task_id` 固定发布工作的稳定任务身份并取代按内容版本唯一；首次核验成功前，工作可切换到同任务、同平台的当前批准版本。每次切换在事件中冻结前后内容版本，核验记录冻结当次内容版本，成果读取成功核验快照而不是可变工作指针。旧工作、事件和核验只有在归属可唯一确定时才回填，否则以 `55000` 阻断。

`content_task_geo_sources` 按内容任务一对一冻结 GEO 异常规则、分析周期、来源文章或问题、GEO 平台和结构化依据。来源行只允许插入，不允许更新或删除；创建服务必须重新计算当前洞察并与内容任务同事务写入。该迁移包含新的不可逆业务历史，downgrade 固定以 `55000` 拒绝，恢复使用迁移前备份或前向修复。

### 0036 Remove Publication Section URL

版本文件 `0036_remove_publication_section_url.py` 紧跟 `0035_business_workflow`，Alembic revision 为 `0036_remove_section_url`。该 revision 删除没有稳定跨平台含义的 `publication_works.section_url`；开始发布只绑定 `content_version_id` 与 `platform_account_id`，准备更新只允许变更账号并提交 revision 和说明。

迁移先以 0035 的当前定义替换 `partsignal_guard_publication_work()`，仅从准备阶段冻结条件移除栏目地址比较，再删除列；账号冻结、身份不可变、结果登记和状态转换规则保持不变。`0037` 后终态历史仍不可原地修改，但可随已归档任务聚合永久删除。真实公开位置只由结果登记的 `final_url` 保存，并继续匹配具体平台允许域名。

既有栏目地址按已确认的无效数据直接丢弃，不转存到影子列、JSON 或历史表。该值无法确定性恢复，downgrade 固定以 PostgreSQL `55000` 拒绝，恢复必须使用迁移前备份。

### 0037 Simplified Deletion Lifecycle

版本文件 `0037_simplify_deletion_lifecycle.py` 紧跟 `0036_remove_section_url`。`content_tasks` 新增正交的可空 `archived_at`、必填平台名称快照与可空网站 URL 快照；`publication_works` 新增必填平台名称、账号标签和账号标识快照。迁移只从升级时仍受强外键保护的当前行确定性回填，任何缺失都以 PostgreSQL `55000` 中止，不猜测历史显示值。

归档只接受未归档 `COMPLETED` 任务；恢复只清空 `archived_at`，两者都校验并递增 revision，不改变业务状态。默认任务列表只返回未归档任务，`archive_status=ARCHIVED|ALL` 才读取归档范围。普通删除接受未归档 `OPEN | CANCELLED` 任务，拒绝运行中生成作业以及任何成功文章或 GEO 文章关系；它删除任务拥有的草稿、审核、生成和未成功发布工作，但不触碰外部页面。

管理员永久删除只接受已归档任务、匹配 revision 和固定确认文本 `永久删除`。服务锁定并重新计算范围，删除任务拥有的内容、发布成果与问题、发布事件和核验；只删除失去全部文章关系的人工 GEO 更正链，共享 GEO 记录与共享文件保留。删除旧目标审计后只写一条 `content_task.permanently_deleted` 空详情墓碑。归档、恢复及永久删除都不验证或删除外部页面。

平台删除仍要求先停用，并在存在 `OPEN` 内容任务或非终态发布工作时拒绝；它绝不级联删除任务。平台账号随平台删除，终态任务与工作把实时平台/账号外键置空后使用标量快照显示。单独账号删除只由非终态发布工作阻断。Prompt 删除通过共享事务 advisory lock 串行化绑定变更，在同一事务自动解绑全部平台、递增平台 revision 后删除模板；历史生成作业继续读取不可变输入快照。

审计写入收缩为 `RETAINED_AUDIT_ACTIONS` 中的成功事件。迁移删除全部 `FAILED | DENIED` 以及白名单外历史，并把审计门禁收窄为禁止 UPDATE；业务层没有通用审计删除 API，只在任务聚合删除时按精确目标清理旧审计。该迁移、历史审计清理和已执行永久删除不可逆，downgrade 固定以 `55000` 拒绝并要求恢复升级前备份。

## State Machines

```text
FactVersion: PENDING_REVIEW -> APPROVED -> RETIRED
                            \-> CHANGES_REQUESTED

ContentVersion: DRAFT -> PENDING_REVIEW -> APPROVED -> SUPERSEDED
                    \-> ABANDONED    \-> CHANGES_REQUESTED -> ABANDONED

ContentTask: OPEN -> CANCELLED
             OPEN -- first successful PublicationVerification --> COMPLETED
             COMPLETED -- archive/restore --> COMPLETED

GenerationJob: PENDING -> RUNNING -> SUCCEEDED | FAILED
               (applies to both GENERATE and HUMANIZE)

PublicationWork:
PREPARING -> PLATFORM_REVIEW -> AWAITING_VERIFICATION
PREPARING -> AWAITING_VERIFICATION
AWAITING_VERIFICATION -> ACTION_REQUIRED -> AWAITING_VERIFICATION
AWAITING_VERIFICATION | ACTION_REQUIRED -> COMPLETED
PREPARING | PLATFORM_REVIEW | AWAITING_VERIFICATION | ACTION_REQUIRED -> CLOSED

PublishedContentIssue: OPEN -> RESOLVED

PlatformProfile: ENABLED <-> DISABLED

FileRecord: PENDING -> VERIFIED | FAILED | ABORTED | DELETING
            VERIFIED | FAILED | ABORTED -> DELETING -> DELETED
```

State changes not shown above are invalid. A rejected immutable fact or content version is a terminal historical conclusion; correction creates a new immutable version from the editable fact workspace or current content lineage. Frozen payloads are never rewritten.

## Required Constraints

- Product identity is unique by normalized brand plus part number.
- 非空 `content_tasks.idempotency_key` 全局唯一；普通任务创建先按命名请求键获取 PostgreSQL 事务 advisory lock，再判断重放或执行当前业务校验。三字段业务输入本身不唯一。
- Version numbers are unique within their owner: product fact or content task.
- Product or content-task owner rows are locked while allocating the next version number.
- A product has one Markdown fact workspace protected by `facts_revision`; new fact versions freeze its non-blank Markdown and classification.
- 每个产品至多一个 `PENDING_REVIEW` 事实版本；工作区提交直接创建该不可变版本，不存在版本级草稿或原版本重提。
- Approved fact versions permit status-only transition to `RETIRED`; all other columns are immutable.
- Content versions permit only valid status transitions; publishable fields are immutable.
- `content_tasks.current_content_version_id` 是内容主线唯一权威，必须为空或指向同任务版本；审核、修订、自然化、待发布资格和发布版本切换只接受当前版本。
- 每个任务至多一个 `PENDING_REVIEW` 内容版本；放弃当前草稿或退回版本后，指针恢复到该任务最近批准版本，没有批准版本时置空。
- `users.account_type` is the only permission source. `ADMIN` includes all `ENGINEER` abilities and exclusively manages users and configuration.
- At least one active `ADMIN` must remain after every user account-type or active-state update.
- 用户物理删除仅限管理员操作停用账号；会话级联清理，审计操作者按 `0027` 受约束置空，任何业务历史引用都阻断删除。用户实时 `admin_total` 统计全部 `ADMIN`，包括停用账号。
- Sensitive AI values are encrypted with the deployment master key and never returned, audited, logged, or copied into generation snapshots.
- A platform type referenced by a platform profile cannot be deleted. Platform types do not own Prompts after `0014`.
- A concrete platform binds zero or one current Prompt, while one Prompt may be shared by multiple platforms. Missing binding keeps the platform selectable for manual content tasks but makes system AI generation unavailable.
- Platform Prompt update and deletion require optimistic revision matching against the locked template row. Prompt deletion atomically unbinds every current platform and increments each platform revision; platform deletion never deletes the template.
- A concrete platform's `is_active` state is independent from configuration completeness. A disabled platform remains manageable but cannot be used to create a content task, repair task, platform account, or publication work; disabling never mutates existing accounts, configuration, or history.
- Platform completeness, account counts, and task-reference counts are real-time read projections. Completeness is true when the current platform Prompt exists; a task reference is counted once through `content_tasks.platform_profile_id`.
- A concrete platform stores at most one Logo source. New writes only accept a `VERIFIED`, `PUBLIC`, `PLATFORM_LOGO` file; `logo_external_url` remains a nullable read-only legacy field until a later migration, and `website_url` remains an explicit nullable URI.
- File cleanup uses the three actual current-head file foreign keys as its deletion authority. Unconfirmed files retain their configured grace period, detached previously used files retain seven days, and object deletion remains retryable through `DELETING` before a `DELETED` tombstone is recorded.
- Product, fact version, platform profile, platform account, platform type, and user physical deletion is admin-only. Services lock targets and return structured `409` conflicts; the only configured cascades are the approved Prompt auto-unbind, platform-owned account cleanup, and task-aggregate deletion paths.
- A product can be physically deleted only when no `FactVersion`, `ContentTask`, or `GeoObservation` directly references it. A platform profile must first be disabled and requires no `OPEN` content task or nonterminal `PublicationWork`; deleting it never deletes a task. A platform account requires no nonterminal `PublicationWork`; a platform type requires no platform profiles.
- 未归档 `OPEN | CANCELLED` 内容任务可连同其任务聚合删除，但运行中的生成作业、成功文章或 GEO 文章关系阻断普通删除。`COMPLETED` 任务只能先归档；管理员随后可按固定确认文本永久删除整个内部任务聚合，共享 GEO 与文件保留。
- Channel deletion cascades to Headers and models. Historical job foreign keys become null while their immutable snapshots remain readable.
- A model can be enabled only after its own successful test. A channel can be enabled only when at least one child model has passed testing.
- A generation job performs at most one provider call. Expired worker leases fail explicitly; retries create a new job and preserve the original non-sensitive snapshot. Original-generation v2/v3 snapshots may retry from their frozen input; legacy v1 snapshots are read-only.
- Automatic recovery dispatches only overdue `PENDING` jobs. Dispatch counters, queue ages, failure codes, and provider duration diagnostics must never contain prompts, response bodies, credentials, or sensitive Headers.
- Third-party AI egress requires the bound fact version to be explicitly `PUBLIC`; missing, legacy-empty, `INTERNAL`, or `RESTRICTED` fact data is a hard denial.
- Original generation revalidates the user-confirmed current Prompt UUID and revision, then sends exactly one system message equal to that Prompt and one user message equal to the frozen fact Markdown; no prefix, task field, metadata, JSON wrapper, repair, model switch, or fallback is allowed.
- A manual first draft creates a `HUMAN DRAFT` content version with null generation and parent lineage, then uses the same review and publication gates as AI content.
- A publication work can reference only an approved content version whose fact is not retired at creation time.
- A publication account profile must equal the content task's locked platform profile; both the application service and PostgreSQL enforce it.
- A concrete platform may own multiple publication accounts, but their internal identifiers are unique by `lower(btrim(account_identifier))`; disabled accounts retain identity and historical references but are excluded from new publication candidates.
- A publication work selects exactly one account. One content task has at most one work, and one `platform_profile_id + content_hash` has at most one non-closed work.
- 非终态发布工作仅可切换到同任务、同平台的当前批准版本；切换事件记录前后版本，每次核验记录当时版本，成功成果永久读取成功核验快照。
- Result registration requires a valid HTTP(S) URL matching the configured platform domain and may append only verified `OPERATION_SCREENSHOT` evidence. Result fields, evidence, work event and audit commit or fail together.
- A failed verification appends an immutable snapshot and leaves the work pending in `ACTION_REQUIRED`; it never creates an article or completes/cancels the task.
- Task completion has no public manual command. The first successful verification atomically creates the read-only `PublishedArticle` and completes the open source task; completed tasks never revert.
- A nonterminal work may only end without success through explicit close with a structured reason and non-blank comment; close atomically cancels the source task.
- Publication works, events, verifications, articles and issues cannot be individually deleted through business APIs. Published results remain immutable in place; the only aggregate exception is administrator permanent deletion of their archived source task.
- Repair-task creation and issue resolution are separate explicit commands. A repaired issue remains `OPEN` until explicitly resolved, and resolving it does not complete the repair task.
- Fact and content review records are append-only, and every request-changes command requires a non-blank comment.
- Observation accuracy `UNJUDGEABLE` is excluded from the accuracy-rate denominator.
- Manual GEO observations cover every currently eligible `PublishedArticle` for one product and store one independent `discovered`, `mentioned`, and optional `accuracy` result per article. Articles with an open issue or a historical `RETIRED` outcome are ineligible. Evidence screenshots are optional; corrections aggregate ancestor evidence for reads without duplicating file links. Administrators may delete a complete manual correction chain directly; archived-task permanent deletion removes only chains that lose every article relation.
- Historical GEO publication associations with null insight facts remain explicitly incomplete and never enter manual insight denominators.
- GEO 优化任务必须与一条不可变 `content_task_geo_sources` 来源快照同事务创建；服务端重新计算异常，拒绝客户端伪造、过期或数据不足的依据。
- Audit log details must not contain passwords, session cookies, AccessKeys, model keys, or unpublished source documents. Runtime audit accepts only retained successful actions; task aggregate deletion may remove old target logs and preserve one minimal deletion tombstone.
