# PartSignal Database Contract

## Conventions

- PostgreSQL 16 is the only supported business database.
- Tables and columns use `snake_case`; identifiers are UUID; timestamps are timezone-aware UTC.
- Mutable aggregates carry an integer `revision`; clients must submit `expected_revision`.
- Alembic is the only schema migration entry point. API and Worker never run migrations on startup.
- Revisions `0001` through `0008` use `app.migration_schema_v1` as a frozen metadata snapshot; future runtime model changes must add a new revision and must not edit that snapshot.
- JSONB is limited to immutable snapshots, versioned rules, structured generation input/output, and audit details. Editable product facts remain normalized.
- Review records, status events, observations, and audit logs are append-only.

## Migration Order

### 0001 Identity And Audit

`users`, `roles`, `user_roles`, `sessions`, `audit_logs`.

This historical revision created six fixed roles. Revision `0009` migrates them to the current two-account-type model and removes `roles` and `user_roles`.

### 0002 Product Facts

`products`, `reference_parts`, `part_parameters`, `replacement_relations`, `evidences`, `parameter_evidence_links`, `replacement_evidence_links`, `fact_claims`, `claim_evidence_links`, `fact_versions`, `fact_review_records`.

`part_parameters` owns exactly one of `product_id` and `reference_part_id`. A submitted fact snapshot requires evidence for each replacement relation and each critical parameter. `fact_versions.snapshot_json` is constructed by the server; clients never provide a snapshot.

### 0003 Content Planning

`query_topics`, `platform_profiles`, `platform_profile_versions`, `content_tasks`.

`content_tasks` binds a concrete `APPROVED fact_version` and `ACTIVE platform_profile_version`. These foreign keys never silently move to newer versions.

### 0004 Content Production

`generation_jobs`, `content_versions`.

`generation_jobs.idempotency_key` is unique. Redis carries only the job UUID. A unique `content_versions.source_job_id` prevents duplicate drafts. Worker execution rechecks the current task, product, and approved fact before and after generation; expired `RUNNING` leases are recovered from PostgreSQL by Celery Beat. Content title, summary, Markdown body, tags, fact references, and hash are immutable after insert.

### 0005 Content Review

`content_review_records` plus immutability and task-version constraints.

Approving a new version and superseding the previous approved version happen in one transaction. Creators may approve their own fact or content versions; all state, evidence, and quality gates still apply.

### 0006 Publication

`platform_accounts`, `publication_records`, `publication_status_events`.

Platform accounts contain labels only, never credentials. A publication permanently binds one approved content version. Reuse of an idempotency key must match content, account, section URL, and attachment IDs; concurrent requests are serialized with a PostgreSQL transaction advisory lock. After `PUBLISHED`, URL and content binding cannot change.

### 0007 GEO Observation

`geo_observations`, `geo_observation_citations`, `geo_observation_publications`.

Observations are immutable. Corrections create another observation with `supersedes_id`. Metrics are calculated from source observations rather than persisted as a second source of truth.

### 0008 Files

`file_records`, `publication_attachments`, `geo_observation_attachments`, plus `evidences.file_record_id`.

Only `VERIFIED` files may be linked. Referenced objects cannot be deleted through the application.

### 0009 Configuration Center And AI Generation

`users` gains `account_type` (`ADMIN | ENGINEER`) and `must_change_password`. Existing users with `SYSTEM_ADMIN` become `ADMIN`; all other existing users become `ENGINEER`. After the mapping, `roles` and `user_roles` are removed so `users.account_type` is the only permission source. Application users remain non-deletable business identities. Disabling a user or resetting a password revokes all active sessions. A transaction may not disable or demote the last active `ADMIN`.

`platform_types` owns a unique category `slug`. Revision `0009` initially placed one mutable Markdown system Prompt under each type; revision `0014` replaces that ownership with one current Prompt per concrete platform. `platform_profiles.platform_type_id` is nullable only for migrated profiles and uses `RESTRICT` on delete. New profiles and new content tasks require an explicit type. `content_tasks.platform_type_snapshot` freezes the selected type identity while `user_prompt_markdown` remains an editable task draft protected by `revision`.

`ai_channels` owns an encrypted API key, timeout, and connection state. `ai_channel_headers` belongs only to a channel, normalizes names case-insensitively, and stores exactly one of a plain or encrypted value. `ai_models` belongs to a channel and stores the provider `model_id`, display name, exact JSON request parameters, and model-level test state. Channels and models default disabled. Connection, credential, or Header changes disable the channel and invalidate every child model test; model ID or parameter changes disable and invalidate that model.

`generation_jobs` gains nullable `ai_channel_id` and `ai_model_id` foreign keys using `SET NULL`, provider request metadata, and nullable token usage. `input_snapshot` is the authoritative immutable generation input and retains channel/model identity, non-sensitive connection data, model parameters, system/user messages, approved fact values, and task requirements after current configuration is deleted. Credentials and sensitive Header values never enter the snapshot. `content_versions` removes model-reported fact, evidence, and disclosure ID arrays; traceability comes from `fact_version_id`, `source_job_id`, and the job snapshot.

### 0010 Legacy User Cleanup

This irreversible data migration recognizes only `product_editor`, `product_reviewer`, `content_reviewer`, and `analyst`. It locks all matching users and checks every user-owned business or audit foreign key before deleting any row. Any reference aborts the complete migration and reports the username plus referring table and column; ownership is never reassigned and historical data is never deleted. When no references exist, sessions for the four users are removed before the users. An existing `content_editor` keeps its password, account type, active state, and profile but receives `must_change_password=true` with an incremented revision.

After migration, `seed-demo` idempotently ensures only `admin` and `content_editor`. Their initial passwords come from `PARTSIGNAL_SEED_ADMIN_PASSWORD` and `PARTSIGNAL_SEED_ENGINEER_PASSWORD`; existing accounts are never overwritten. A newly created `content_editor` has account type `ENGINEER` and must change its initial password. The one-time migration is the only physical user-deletion exception and does not add an application deletion API.

### 0011 Generation Reliability

`generation_jobs` gains nullable `last_dispatch_attempt_at` and non-negative `dispatch_attempt_count` fields plus a partial due-time index for `PENDING` rows. These fields are diagnostic metadata inside the existing Job aggregate; `generation_jobs.status` remains the only execution authority and Redis continues to carry only the Job UUID.

After the API commits a new Job, Broker dispatch failure leaves it `PENDING`. Celery Beat redispatches only rows whose `COALESCE(last_dispatch_attempt_at, created_at)` is older than the configured threshold, using PostgreSQL row locks and a bounded batch. Only a Worker that atomically changes `PENDING` to `RUNNING` may call the provider, so accepted-but-unrecorded Broker messages and concurrent recovery remain harmless duplicates.

The execution lease is calculated from the immutable snapshot as `started_at + input_snapshot.channel.timeout_seconds + GENERATION_FINALIZE_GRACE_SECONDS`; the grace must be positive. Expired `RUNNING` Jobs become `FAILED/WORKER_LOST` and are never automatically dispatched again. If the provider accepted a request before the Worker lost its result, only an explicit retry may create a new traceable Job.

### 0012 AI Data Classification

`content_tasks` gains nullable `generation_data_classification`, `generation_data_classified_by`, and `generation_data_classified_at`. The three fields are either all `NULL` or all present, classification is limited to `PUBLIC | INTERNAL | RESTRICTED`, and the classifier foreign key uses `RESTRICT`. Historical tasks remain unclassified; the migration never infers or backfills `PUBLIC`.

Saving a task Prompt replaces the complete generation-input classification and records the actor and UTC time in the same revisioned update. A third-party model Job may be created or retried only when the task input is explicitly `PUBLIC` and every Evidence in the bound immutable fact snapshot is `PUBLIC`. The Job snapshot freezes the classification evidence used for that decision. PostgreSQL remains the classification source of truth; Redis carries no classification state.

### 0013 Publication And Review Closure

`publication_attentions` is the authoritative business queue for a publication that reaches `REMOVED` or `VERIFICATION_FAILED`. One publication can create at most one attention. An attention must be inserted as revision-zero `OPEN`, may only become `RESOLVED`, cannot be deleted, and resolution requires an actor, UTC time, and non-blank comment. `content_tasks.source_publication_attention_id` is nullable and unique, so one attention creates at most one repair task without introducing a second task model. Both the attention binding and a non-null repair source are immutable.

Every new `publication_record` must use an active account whose `platform_profile_id` equals the profile of the task's locked `platform_profile_version_id`. The application service validates account activity and platform equality with explicit errors; the PostgreSQL insert trigger is the final protection for the cross-table platform equality. The first related publication that reaches `VERIFIED` changes an `OPEN` task to `COMPLETED` in the same transaction. A later publication loss never reopens or cancels that task; it creates the unique attention instead. A task with `PENDING_MANUAL_PUBLISH`, `PLATFORM_REVIEW`, or `PUBLISHED` publication state cannot be cancelled.

The repair command fixes product and platform from the original task. Historical tasks also retain their real query-topic link; product-driven tasks keep that link null. It must explicitly select an `APPROVED` fact version for the same product and the current `ACTIVE` version for the same platform profile. The remaining planning fields are copied as editable defaults. Creating the repair task does not resolve the attention.

Fact and content review records remain append-only. `request-changes` requires a non-blank comment, while submit and approve comments remain optional. Revision `0013` extends both database status guards so `CHANGES_REQUESTED -> PENDING_REVIEW` is valid without changing the immutable version payload. Review contexts are read projections over the locked fact/content versions, evidence file status, generation snapshot, deterministic version diff, actor summary, and stable review history; they do not persist a second copy.

Before `0013`, `python -m app.cli preflight-integrity` must return an empty JSON array. It reports stable IDs for `COMPLETED_WITHOUT_VERIFIED_PUBLICATION` when a completed task has no append-only `VERIFIED` publication status event, and for non-terminal `PUBLICATION_PLATFORM_MISMATCH`; a publication that was verified and later removed remains valid completion history, while an explicitly `REJECTED`, `REMOVED`, or `VERIFICATION_FAILED` mismatch remains traceable but no longer blocks deployment. The command exits non-zero when any issue exists and never changes history. The migration repeats the critical check so direct Alembic execution cannot bypass the deployment gate. Once any attention or repair source exists, downgrade is refused and deployment must move forward.

### 0014 Platform Prompt Ownership

`platform_prompts.platform_profile_id` is the primary key and references `platform_profiles.id` with `ON DELETE CASCADE`; each concrete platform owns zero or one current Markdown Prompt. The migration creates a replacement table and copies each legacy type Prompt to every existing profile of that type. A legacy Prompt whose type has no concrete platform produces no row. The old table and `platform_type_id` column are removed; there is no dual read, dual write, type-level compatibility endpoint, or fallback Prompt.

A concrete platform may exist without an `ACTIVE platform_profile_version` or without a current Prompt. Administrators can still classify the platform, create and activate new immutable rule versions, and maintain its Prompt. Engineers may create a content task only with an `ACTIVE` rule version whose concrete platform currently has a Prompt. Deleting an unreferenced `ACTIVE` rule version leaves the profile in the explicit “no effective rule” state and never activates another version automatically.

Revision `0015` changes only `partsignal_guard_platform_version()`: creating a `platform_profile` still does not create a rule row, `DRAFT -> DRAFT` rule updates are revision-protected and permitted, and `ACTIVE` or `RETIRED` rule payloads remain database-enforced immutable. `platform_profile_id`, `version`, and `created_at` stay immutable in every state. A platform's current rule is always derived from its sole `ACTIVE platform_profile_version`; no `current_rule_id` or second source of truth is stored. The revision rewrites no business rows, and its downgrade restores the original all-status payload guard.

Administrators may physically delete a `fact_version` in any status only when neither `content_tasks` nor `content_versions` references it. The service locks the target, reports every non-zero direct reference, explicitly deletes subordinate `fact_review_records`, and deletes the version in the same transaction. This administrative cleanup is the only exception to normal append-only review history; it never cascades to or rewrites tasks, content, generation, publication, or observation history, and product deletion never implicitly deletes fact versions.

Revision `0016` replaces only the `fact_review_records` append-only trigger. `UPDATE` remains forbidden, and `DELETE` is allowed only when the transaction-local `partsignal.fact_version_delete_id` exactly matches the row's parent version. The service sets that value only after locking the version, proving it has no content references, and recording the safe audit summary. Other append-only tables and the `RESTRICT` foreign key are unchanged; downgrade restores the original generic trigger.

### 0017 Optional Content Humanization

`content_humanization_prompts` is a database-enforced singleton (`id = 1`) containing the only current naturalization Prompt. The migration inserts no row: an administrator must explicitly create the first value, and every row records a real `updated_by` user plus an optimistic-lock `revision`. There is no seed value, environment fallback, platform copy, delete operation, or second runtime source.

`generation_jobs.job_type` is required and limited to `GENERATE | HUMANIZE`; historical rows are backfilled to `GENERATE` before the migration removes the column default. `source_content_version_id` uses `RESTRICT` and is paired with the type: original generation must have no source, while naturalization must have one. A partial unique index on `source_content_version_id` where the type is `HUMANIZE` and status is `PENDING | RUNNING` prevents concurrent active jobs for the same source.

A successful naturalization creates a new immutable `content_versions` row with `source_type = AI`, `source_job_id` pointing to the naturalization job, and `based_on_id` pointing to the frozen source version. It never updates the source. The job snapshot is the authority for the selected model, global Prompt revision and Markdown, complete source article and hash, original approved facts, PUBLIC classification, task requirements, and final messages; credentials remain outside snapshots and Redis still carries only the job UUID.

The API and Worker both require an `OPEN` task, an `AI` source in `DRAFT | CHANGES_REQUESTED`, an approved fact version, an active product, and complete `PUBLIC` task/evidence classification. Worker validation occurs before and after the provider call, including source identity, status, type, task/fact binding, frozen hash, and original generation lineage. Once any `HUMANIZE` job exists, revision `0017` refuses downgrade so immutable AI history cannot become unreadable; deployment must use a forward fix.

New generation snapshots include the concrete platform identity and continue freezing the final system/user messages. Old immutable snapshots may omit the concrete-platform object only for historical reads; new writes must include it. Platform Prompts can diverge after migration, so `0014` does not guess how to merge them on downgrade; rollback requires the pre-migration PostgreSQL backup.

### 0018 Manual GEO Article Observation

`geo_observations.observation_kind` explicitly separates historical `LEGACY_MODEL_RESULT` rows from new `MANUAL_ARTICLE_SEARCH` rows. The migration assigns the legacy discriminator without changing any historical business field. Legacy query/model/answer fields and new `search_platform/search_query` fields are mutually exclusive under a database check; new writes have no target question, model call, web-search flag, answer summary, citation, accuracy, or observation-level recommendation.

`geo_observation_publications.recommendation_status` is the authoritative per-article result for manual observations and is limited to `RECOMMENDED | NOT_RECOMMENDED`. Historical associations remain `NULL` and mean “not assessed per article”; the migration never infers a status from old citations, possible-influence links, or observation-level recommendation. An insert trigger verifies that every new result belongs to the observation product through `PublicationRecord -> ContentVersion -> ContentTask`, the publication is currently `PUBLISHED | VERIFIED`, and `final_url` is present.

The create service locks the product and all current eligible publication rows, then requires the request to cover that exact publication ID set. Every manual observation includes at least one verified `OPERATION_SCREENSHOT`. Article titles, platform identity, links, and publication status remain projections of their existing owners and are not duplicated in GEO storage. Metrics are derived from current correction-chain tails; legacy model metrics and manual per-article recommendation metrics have separate denominators.

Manual GEO history is forward-only. Once a `MANUAL_ARTICLE_SEARCH` row exists, revision `0018` refuses downgrade because removing the discriminator, search fields, or article results would destroy immutable business meaning.

### 0019 Product-Driven Content Tasks

`content_tasks.query_topic_id` becomes nullable while retaining its `RESTRICT` foreign key. Existing tasks are not rewritten and keep their real query-topic UUID; new ordinary tasks and repair tasks originating from them store `NULL`. The product, its selected `APPROVED fact_version`, the concrete platform's `ACTIVE platform_profile_version`, the current platform Prompt, and the existing task requirement fields are sufficient to create a new task.

`ContentTaskCreate` no longer accepts a query topic. New generation snapshots omit the `query_topic` object entirely rather than storing null, an empty object, or an invented question. Historical tasks still resolve and freeze their real query topic when creating a new generation job. Repair tasks inherit the original task's nullable link, and repair context returns a nullable query-topic projection for explicit new/legacy handling.

Revision `0019` rewrites no task or immutable job snapshot. It refuses downgrade before restoring `NOT NULL` when any product-driven task exists; rollback after new writes requires a forward fix or the pre-migration PostgreSQL backup, never a placeholder query topic.

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

FileRecord: PENDING -> VERIFIED | FAILED | ABORTED
```

State changes not shown above are invalid. A rejected immutable fact or content version may be resubmitted after its editable source/workflow has been corrected, but its frozen payload is never rewritten. Content body changes still create a new immutable content version.

## Required Constraints

- Unique product and reference part identities use normalized manufacturer/brand plus part number.
- Version numbers are unique within their owner: product fact, platform profile, or content task.
- Product or content-task owner rows are locked while allocating the next version number.
- Approved fact snapshots permit status-only transition to `RETIRED`; all other columns are immutable.
- Content versions permit only valid status transitions; publishable fields are immutable.
- `users.account_type` is the only permission source. `ADMIN` includes all `ENGINEER` abilities and exclusively manages users and configuration.
- At least one active `ADMIN` must remain after every user account-type or active-state update.
- Sensitive AI values are encrypted with the deployment master key and never returned, audited, logged, or copied into generation snapshots.
- A platform type referenced by a platform profile cannot be deleted. Platform types do not own Prompts after `0014`.
- A concrete platform owns zero or one current Prompt. Deleting the current Prompt or an unreferenced `ACTIVE` rule version keeps the platform manageable but removes it from the engineer-selectable set until both an `ACTIVE` rule and current Prompt exist.
- Product, platform profile/version, platform account, and platform type physical deletion is admin-only. Services lock the target, count direct references, and return structured `409 details.references`; they never cascade, reassign, or rewrite immutable business history.
- A product can be physically deleted only when no `FactVersion`, `ContentTask`, or `GeoObservation` directly references it. A platform rule version requires no `ContentTask`; a platform profile requires no rule versions or platform accounts; a platform account requires no `PublicationRecord`; a platform type requires no platform profiles.
- Channel deletion cascades to Headers and models. Historical job foreign keys become null while their immutable snapshots remain readable.
- A model can be enabled only after its own successful test. A channel can be enabled only when at least one child model has passed testing.
- A generation job performs at most one provider call. Expired worker leases fail explicitly; retries create a new job and preserve the original non-sensitive snapshot.
- Automatic recovery dispatches only overdue `PENDING` jobs. Dispatch counters, queue ages, failure codes, and provider duration diagnostics must never contain prompts, response bodies, credentials, or sensitive Headers.
- Third-party AI egress requires an explicit complete `PUBLIC` task classification and only `PUBLIC` Evidence in the bound fact snapshot. Missing historical classification is a hard denial, never a compatibility default.
- A publication can reference only an approved content version whose fact is not retired at creation time.
- A publication account profile must equal the content task's locked platform profile; both the application service and PostgreSQL enforce it.
- `PUBLISHED` and `VERIFIED` publications require a valid HTTP(S) URL matching the configured platform domain.
- Task completion has no public manual command. The first verified publication completes an open task atomically; completed tasks never revert.
- Open publication attention is the only publication-loss todo source. Repair-task creation and attention resolution are separate explicit commands.
- Fact and content review records are append-only, and every request-changes command requires a non-blank comment.
- Observation accuracy `UNJUDGEABLE` is excluded from the accuracy-rate denominator.
- Manual GEO observations cover every currently `PUBLISHED | VERIFIED` article for one product, use exactly one binary recommendation result per article, and include at least one verified operation screenshot.
- Historical GEO publication associations with a null per-article result remain explicitly unassessed and never enter manual article recommendation metrics.
- Audit log details must not contain passwords, session cookies, AccessKeys, model keys, or unpublished source documents.
