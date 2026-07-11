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

`platform_types` owns a unique category `slug`; `platform_prompts` stores at most one mutable Markdown system Prompt per type. `platform_profiles.platform_type_id` is nullable only for migrated profiles and uses `RESTRICT` on delete. New profiles and new content tasks require an explicit type. `content_tasks.platform_type_snapshot` freezes the selected type identity while `user_prompt_markdown` remains an editable task draft protected by `revision`.

`ai_channels` owns an encrypted API key, timeout, and connection state. `ai_channel_headers` belongs only to a channel, normalizes names case-insensitively, and stores exactly one of a plain or encrypted value. `ai_models` belongs to a channel and stores the provider `model_id`, display name, exact JSON request parameters, and model-level test state. Channels and models default disabled. Connection, credential, or Header changes disable the channel and invalidate every child model test; model ID or parameter changes disable and invalidate that model.

`generation_jobs` gains nullable `ai_channel_id` and `ai_model_id` foreign keys using `SET NULL`, provider request metadata, and nullable token usage. `input_snapshot` is the authoritative immutable generation input and retains channel/model identity, non-sensitive connection data, model parameters, system/user messages, approved fact values, and task requirements after current configuration is deleted. Credentials and sensitive Header values never enter the snapshot. `content_versions` removes model-reported fact, evidence, and disclosure ID arrays; traceability comes from `fact_version_id`, `source_job_id`, and the job snapshot.

### 0010 Legacy User Cleanup

This irreversible data migration recognizes only `product_editor`, `product_reviewer`, `content_reviewer`, and `analyst`. It locks all matching users and checks every user-owned business or audit foreign key before deleting any row. Any reference aborts the complete migration and reports the username plus referring table and column; ownership is never reassigned and historical data is never deleted. When no references exist, sessions for the four users are removed before the users. An existing `content_editor` keeps its password, account type, active state, and profile but receives `must_change_password=true` with an incremented revision.

After migration, `seed-demo` idempotently ensures only `admin` and `content_editor`. Their initial passwords come from `PARTSIGNAL_SEED_ADMIN_PASSWORD` and `PARTSIGNAL_SEED_ENGINEER_PASSWORD`; existing accounts are never overwritten. A newly created `content_editor` has account type `ENGINEER` and must change its initial password. The one-time migration is the only physical user-deletion exception and does not add an application deletion API.

## State Machines

```text
FactVersion: DRAFT -> PENDING_REVIEW -> APPROVED -> RETIRED
                               \-> CHANGES_REQUESTED

ContentVersion: DRAFT -> PENDING_REVIEW -> APPROVED -> SUPERSEDED
                                  \-> CHANGES_REQUESTED

ContentTask: OPEN -> COMPLETED | CANCELLED

GenerationJob: PENDING -> RUNNING -> SUCCEEDED | FAILED

PublicationRecord:
PENDING_MANUAL_PUBLISH -> PLATFORM_REVIEW -> PUBLISHED -> VERIFIED
                       -> REJECTED
PUBLISHED -> REMOVED | VERIFICATION_FAILED

FileRecord: PENDING -> VERIFIED | FAILED | ABORTED
```

State changes not shown above are invalid. `CHANGES_REQUESTED` records are historical; corrected facts or content create a new version rather than rewriting the rejected version.

## Required Constraints

- Unique product and reference part identities use normalized manufacturer/brand plus part number.
- Version numbers are unique within their owner: product fact, platform profile, or content task.
- Product or content-task owner rows are locked while allocating the next version number.
- Approved fact snapshots permit status-only transition to `RETIRED`; all other columns are immutable.
- Content versions permit only valid status transitions; publishable fields are immutable.
- `users.account_type` is the only permission source. `ADMIN` includes all `ENGINEER` abilities and exclusively manages users and configuration.
- At least one active `ADMIN` must remain after every user account-type or active-state update.
- Sensitive AI values are encrypted with the deployment master key and never returned, audited, logged, or copied into generation snapshots.
- A platform type referenced by a platform profile cannot be deleted; deleting an unreferenced type cascades only to its current Prompt.
- Channel deletion cascades to Headers and models. Historical job foreign keys become null while their immutable snapshots remain readable.
- A model can be enabled only after its own successful test. A channel can be enabled only when at least one child model has passed testing.
- A generation job performs at most one provider call. Expired worker leases fail explicitly; retries create a new job and preserve the original non-sensitive snapshot.
- A publication can reference only an approved content version whose fact is not retired at creation time.
- `PUBLISHED` and `VERIFIED` publications require a valid HTTP(S) URL matching the configured platform domain.
- Observation accuracy `UNJUDGEABLE` is excluded from the accuracy-rate denominator.
- Audit log details must not contain passwords, session cookies, AccessKeys, model keys, or unpublished source documents.
