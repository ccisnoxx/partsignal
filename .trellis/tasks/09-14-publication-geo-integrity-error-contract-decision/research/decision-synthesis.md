# Research Synthesis：Publication/GEO 完整性与上下文冲突决策

- Date: 2026-09-14
- Scope: 当前仓库 head、完整 migration 链、父任务研究、后端/前端 consumer 与测试；未连接生产数据或修改运行中数据库。

## 证据冲突消解

1. `backend/app/errors.py` 当前没有 `IntegrityError` handler，commit `43c252da` 已完成父任务 T1；旧研究对“当前全局 409”的描述只代表 T1 前状态。本文后续以 default unknown 500 为基线。
2. `0034_publication_workflow_redesign` 首次建立 `fk_content_tasks_published_issue` 为 `RESTRICT`，但 `0037_simplify_deletion_lifecycle._replace_foreign_keys()` 已重建同名 FK 为 `SET NULL`。当前 ORM、`contracts/database.md` 与永久删除行为测试都支持 `SET NULL`。
3. 两条 GEO Article FK 也由 0037 重建为 citation `SET NULL`、publication relation `CASCADE`，与 ORM 一致；publication blocker 和 0038 delete guard 才是禁止越界删除 GEO 历史的业务/数据库双重边界。

## Publication 约束结论

| 约束 | command / operationId | 决策 |
|---|---|---|
| `uq_platform_accounts_profile_identifier_normalized` | platform account create/update | 现有精确 `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` 保持。 |
| `uq_publication_works_idempotency_key` | `create_publication_work` / `createPublicationWork` | 可恢复；同 payload replay，异 payload `IDEMPOTENCY_CONFLICT`。race recovery 允许 rollback 后按已批准 identity 查询 winner。 |
| `uq_publication_works_content_task_id` | 同上 | 可恢复；`PUBLICATION_IDENTITY_CONFLICT`。必须补 content-task precheck，使 precheck 与 DB authority 同义。 |
| `uq_publication_works_active_platform_hash` | 同上 | 可恢复；`PUBLICATION_IDENTITY_CONFLICT`。现有 platform/hash advisory lock 是体验/串行优化，partial unique 是最终权威。 |
| `uq_published_content_issues_one_open` | `open_published_content_issue` / `openPublishedContentIssue` | 可恢复；`PUBLISHED_CONTENT_ISSUE_CONFLICT`。Article row lock 串行正常请求，partial unique 覆盖绕过 writer。 |
| `uq_content_tasks_source_published_content_issue_id` | `create_repair_task` / `createPublishedContentRepairTask` | 可恢复；`REPAIR_TASK_EXISTS`，`details={}`，不查询或采用 winner。 |
| `uq_publication_verifications_one_passed` | `verify_publication_work` | unknown 500；Work lock/state 应避免，命中表示不变量被绕过。 |
| `pk_published_articles`、`uq_published_articles_verification_id` | PASSED verification | unknown 500；Article identity 是不可变完成事务内部不变量。 |
| `pk_publication_attachments` | result registration | unknown 500；既有重复输入预检不批准 DB fallback code。 |
| 所有 FK/CHECK/NOT NULL/trigger/cross-table guard | 多 command | unknown 500；保留结构化 precheck 的现有 4xx，但 DB 异常本身不推断业务语义。 |

所有获批 mapper 都必须同时匹配 `23505` 与 final catalog 的 exact constraint name。unknown 原异常上抛，不解析 `str(error)`；known mapper 由 command owner root rollback，unknown 由 request Session owner rollback/close。

## GEO 12 producer 决策

| # | operationId | 当前条件 | 目标 code / status | 恢复 |
|---|---|---|---|---|
| 1 | `getGeoObservationDetail`、`getGeoObservationCorrectionContext` | root 数不为一或 target 不在 ancestors | `GEO_OBSERVATION_CONTEXT_INCOMPLETE` / 409 | 显式 retry/reload；不返回部分链，不自动 mutation。 |
| 2 | 同上 | descendant 中 target 缺失或重复节点 | 同上 | 同上。 |
| 3 | 同上 | kind/product/platform/query identity 不一致 | 同上 | 阻断并暴露 request ID；需要后端/数据修复。 |
| 4 | 同上 | 分支或环 | 同上 | 不选择任一分支，不自动 merge/replay。 |
| 5 | 同上 | walk 数量与递归节点数不一致 | 同上 | 同上。 |
| 6 | 同上 | detail output 类型与 manual chain 不一致 | 同上 | read-model context failure，不冒充用户并发。 |
| 7 | `createGeoObservation` | `supersedes_id` 已有 successor | `GEO_OBSERVATION_HAS_SUCCESSOR` / 409 | 保留草稿/evidence；显式 reload canonical tail，再由用户决定是否重提。 |
| 8 | `createGeoObservation` | evidence ancestor 缺失 | `GEO_OBSERVATION_CONTEXT_INCOMPLETE` / 409 | 保留现场但保持 blocked；不自动提交。 |
| 9 | `deleteGeoObservation` | ancestor 缺失/cycle/identity 越界 | `GEO_OBSERVATION_CONTEXT_INCOMPLETE` / 409 | 不删除、不自动重试。 |
| 10 | `deleteGeoObservation` | successor 分支 | 同上 | 不选择分支、不删除。 |
| 11 | `deleteGeoObservation` | successor cycle/identity 越界 | 同上 | 不删除。 |
| 12 | `deleteGeoObservation` | 锁定后成员集合/target membership 变化 | `GEO_OBSERVATION_CHAIN_CHANGED` / 409 | 显式重开/刷新确认，禁止自动重发 DELETE。 |

12 项都没有 `expected_revision`，因此都退出 `REVISION_CONFLICT`。使用一个既有 context code 覆盖不可安全恢复的链/投影异常，避免为没有不同恢复动作的 invalid/branch 再建多套 code；只有 successor winner 和锁后 chain changed 有独立、可操作的 stale/blocker 语义。

## Shared idempotency identity

- ordinary：ContentTask 三元 identity 完整相等，且 `ContentTaskGeoSource` 必须不存在。
- GEO：ContentTask 三元 identity 完整相等，且 GEO source 必须存在；source 的 `rule_code`、`date_from`、`date_to`、`published_article_id`、`query_topic_id`、`geo_platform` 全部相等。
- 同 kind + 完整 identity 才 replay。rollback 后 winner 不存在或 ContentTask 必需 identity 不完整时原抛 unknown；ContentTask identity 完整且 GEO source 不存在时是 ordinary winner，GEO loser返回 `IDEMPOTENCY_CONFLICT`；GEO source存在且完整 identity相同才 replay，字段不同返回 `IDEMPOTENCY_CONFLICT`，source自身不完整到无法证明时原抛 unknown。
- 两个合规 command 共用 `content-task-create:{key}` advisory transaction lock，正常请求串行；精确 23505 recovery 仍是数据库最终权威，测试需有 test-only barrier/bypass 证明真实 diagnostics，而不是删 production lock。

## 合同影响

- `contracts/openapi.yaml`：本决策不变；受影响 operation 已有 409，code 是开放 string，details 仍 `{}`。
- runtime response metadata：不变；request ID merge 不感知 code。
- generated client：不变；禁止手改。若 status/schema/details shape 变化，才重新生成。
- `contracts/database.md`：后续各实施 Task 应补 exact constraint-to-code、source-kind identity、final-head FK/catalog sentinel。
- Frontend V2 05/08 与 backend/frontend 稳定 specs：后续 code 实施必须同步恢复语义和测试矩阵；T6 再改 production consumers。
- unknown 500：不加入 OpenAPI，不冻结 JSON envelope/code/media type；实现回归只证明没有 `REVISION_CONFLICT`/SQL/constraint 泄漏，并保留运行时可观测 request ID。

## Sources

- `research/publication-integrity-audit.md`
- `research/geo-conflict-audit.md`
- `research/contract-frontend-impact.md`
- 父任务 `.trellis/tasks/09-04-integrity-error-domain-mapping/research/` 中的 constraint matrix、producer inventory、transaction、testing 与 frontend impact 研究。
