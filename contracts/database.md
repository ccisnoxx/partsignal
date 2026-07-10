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

Roles are fixed application constants: `SYSTEM_ADMIN`, `PRODUCT_EDITOR`, `PRODUCT_REVIEWER`, `CONTENT_EDITOR`, `CONTENT_REVIEWER`, `ANALYST`. `SYSTEM_ADMIN` manages identities and configuration but does not implicitly receive review permissions.

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

Approving a new version and superseding the previous approved version happen in one transaction. Reviewers cannot approve content they created.

### 0006 Publication

`platform_accounts`, `publication_records`, `publication_status_events`.

Platform accounts contain labels only, never credentials. A publication permanently binds one approved content version. Reuse of an idempotency key must match content, account, section URL, and attachment IDs; concurrent requests are serialized with a PostgreSQL transaction advisory lock. After `PUBLISHED`, URL and content binding cannot change.

### 0007 GEO Observation

`geo_observations`, `geo_observation_citations`, `geo_observation_publications`.

Observations are immutable. Corrections create another observation with `supersedes_id`. Metrics are calculated from source observations rather than persisted as a second source of truth.

### 0008 Files

`file_records`, `publication_attachments`, `geo_observation_attachments`, plus `evidences.file_record_id`.

Only `VERIFIED` files may be linked. Referenced objects cannot be deleted through the application.

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
- A fact or content reviewer must differ from the version creator.
- A publication can reference only an approved content version whose fact is not retired at creation time.
- `PUBLISHED` and `VERIFIED` publications require a valid HTTP(S) URL matching the configured platform domain.
- Observation accuracy `UNJUDGEABLE` is excluded from the accuracy-rate denominator.
- Audit log details must not contain passwords, session cookies, AccessKeys, model keys, or unpublished source documents.
