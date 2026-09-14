# Publication/GEO IntegrityError 与上下文冲突合同决策

## Goal

在父规划任务 `.trellis/tasks/09-04-integrity-error-domain-mapping` 的 T5 边界内，冻结 publication/GEO 的数据库完整性错误、幂等 source-kind identity 和 GEO context/chain 409 语义，并把后续工作拆成一组“一 Task 一可观察目标”的可 review 实施任务。只有获得业务语义且能由 PostgreSQL 结构化 diagnostics 精确证明的约束竞态可转换为领域错误；真正的 `expected_revision` 过期才使用 `REVISION_CONFLICT`；其余数据库异常保持 default unknown 500。

本 Task 只产出 planning/research 工件，保持 `planning`，不运行 `task.py start`，不实施任何生产变更。

## Background

- 父任务 T1 已由 commit `43c252da` 移除全局 `IntegrityError` handler；当前 head 的 unknown `IntegrityError` 已进入 FastAPI/Starlette 默认 500，而不是 `REVISION_CONFLICT`。
- 本规划冻结时，publication 现有 command 大量使用业务预检查、行锁和 advisory transaction lock，但只有平台账号 identity 已按 `23505 + uq_platform_accounts_profile_identifier_normalized` 精确映射；Work、Issue、Repair Task 的数据库最终权威仍缺少对应 mapper。此后 T5-I1 已补齐 Repair Task mapper，其余规划决策不变。
- GEO 12 个 `REVISION_CONFLICT` producer 均未比较 `expected_revision`，`GeoObservation` 也没有 revision owner；这些 code 会误导前端采用 optimistic-lock 恢复语义。
- ordinary ContentTask 与 GEO optimization ContentTask 共用 `content_tasks.idempotency_key`。当前双方对“已提交 winner”的 source-kind 隔离已成立，但 GEO command 尚未覆盖精确 `23505` race recovery。
- `0034` 的 repair source `RESTRICT` 是历史中间态；`0037` 已将同名 FK 改为 final-head `SET NULL`，当前 ORM、删除行为测试和数据库合同一致。规划冻结时的剩余缺口是目标 PostgreSQL catalog sentinel，而不是已证实的 schema 漂移；T5-I1 已完成该 sentinel 验证。

## Confirmed Decisions

1. Publication 可恢复数据库冲突仅包括：Work idempotency、Work 的 content-task identity、active platform/content-hash identity、每 Article 一个 OPEN Issue、每 Issue 一个 Repair Task，以及已正确实现的平台账号 identity。每项都必须匹配 `sqlstate=23505 + exact constraint_name`，并与既有 precheck code 一致。
2. Verification 单 Work 一个 PASSED、PublishedArticle PK/verification unique、attachment PK，以及所有 publication/GEO FK、CHECK、trigger、constraint trigger、跨表 guard、缺失/不稳定 diagnostics 保持 unknown 500；不得解析错误文本或映射成 `REVISION_CONFLICT`。
3. `uq_content_tasks_source_published_content_issue_id` 精确映射为既有 `409 REPAIR_TASK_EXISTS`、`details={}`。合规的两个 HTTP command 会先由 Issue `FOR UPDATE` 串行化；unique race 是绕过/未来不共享该锁的 writer 的数据库最终防线。loser rollback，不查询或返回 winner，不自动 replay。
4. ordinary identity 为 `(product_id, fact_version_id, platform_profile_id) + 不存在 ContentTaskGeoSource`；GEO identity 为相同三元组加“存在 GEO source”及 `rule_code/date_from/date_to/published_article_id/query_topic_id/geo_platform` 全量相等。任一跨 source-kind winner 都返回 `409 IDEMPOTENCY_CONFLICT`，不得 replay 对方。
5. `source_published_content_issue_id` 权威目标是 final-head `ON DELETE SET NULL`：受控永久删除 Article/Issue 时保留 Repair Task并只将其 source 解绑，Repair Task 的 state/revision 不因解绑改变；被删除 Article 所属 Work 的来源 ContentTask 才按实时平台是否存在恢复为 OPEN/CANCELLED、`revision + 1` 并保留 `archived_at`。若真实 catalog 不符，停止业务 mapper 实施并另建 migration 修复 Task；本 Task 不改 schema。
6. GEO 12 个 producer 都不是真正 revision conflict。第 7 项（更正目标已有 successor）使用 `409 GEO_OBSERVATION_HAS_SUCCESSOR`；第 12 项（删除锁定后链成员变化）使用 `409 GEO_OBSERVATION_CHAIN_CHANGED`；其余第 1–6、8–11 项使用既有 `409 GEO_OBSERVATION_CONTEXT_INCOMPLETE`。三者均 `details={}`。
7. `uq_geo_observations_supersedes_once` 的精确 `23505` 与创建前的 successor precheck 使用同一个 `GEO_OBSERVATION_HAS_SUCCESSOR`；其他 GEO IntegrityError 仍 unknown。
8. 上述 code-only/status-preserving 决策不修改 OpenAPI schema、runtime response metadata 或 generated client；相关 operation 已声明 409，`ErrorDetail.code` 仍为开放 string。实现必须同步数据库合同、稳定 specs、Frontend V2 行为/验收文档和 exact-code tests。
9. T5 全部后端任务及独立高风险只读 review 完成前，不得进入 T6 frontend 409 recovery projection reconciliation。

## In Scope

- publication Work/Verification/Article/Issue/Repair Task 的 unique/partial unique/FK/CHECK/trigger 与 command/transaction owner 审计和分类。
- Repair Task 竞态、GEO/ordinary 幂等 identity、GEO 12 个 context/chain producer、final-head FK 行为的合同决策。
- event time、immutable/append-only history、删除事务、revision/state、AuditLog、GEO link、失败原子性、Session reuse 的后续验收设计。
- OpenAPI、runtime metadata、generated client、Frontend V2 文档、稳定 specs 的影响矩阵及 contract-first 顺序。
- 后续 T5/T6 任务拆分、依赖、文件 allowlist、required/optional validation、停止/回滚条件和独立 review gate。

## Out of Scope

- 修改 backend/frontend 生产代码、router、ORM、schema、migration、OpenAPI、generated client、稳定 spec、生产数据或运行中数据库。
- 运行 `task.py start`、创建或启动后续实施 Task、归档本 Task 或父任务。
- 新建全局 constraint registry、第二套错误类型、错误文本解析、宽泛 SQLSTATE 映射、猜测 winner 或把 default 500 纳入公共 ErrorEnvelope 合同。
- 改变 publication/GEO 权限、状态机、read model、event time、append-only/immutable、删除产品语义或 AuditLog 白名单。
- T6 前端生产 409 recovery 实施。

## Acceptance Criteria

- [x] publication/GEO 相关 UNIQUE、partial UNIQUE、FK、CHECK、trigger/constraint trigger 已映射到真实 command、operationId、precheck、flush/commit 和 transaction owner。
- [x] `uq_content_tasks_source_published_content_issue_id` 的合规锁串行、数据库最终 race、`REPAIR_TASK_EXISTS`、rollback、唯一 winner、无副作用和 Session reuse 语义已冻结。
- [x] ordinary/GEO 的双向 source-kind identity 已冻结，两类请求都不能 replay 对方 winner。
- [x] 已纠正 `0034 RESTRICT` 的历史中间态误判；final-head `SET NULL`、catalog sentinel 和条件性迁移停止线明确。
- [x] 12 个 GEO producer 已逐 operation 决定 expected-revision 属性、status/code、前端恢复和 unknown 边界。
- [x] trigger、跨表 guard、不稳定 diagnostics 保持 unknown，不解析 message、不映射 revision。
- [x] event time、immutable/append-only、删除事务、revision/state、AuditLog、GEO link、失败原子性与 Session reuse 已写入后续验收。
- [x] OpenAPI、runtime metadata、generated client、Frontend V2 文档和稳定 specs 的变化矩阵及原子顺序明确。
- [x] 后续 Task 图满足一 Task 一可 review 目标，含依赖、精确文件边界、required/optional validation、停止/回滚条件及独立高风险 review。
- [x] T5 gate 完成后才能进入 T6 frontend 409 recovery projection reconciliation。
- [x] 推荐首个实施 Task 有真实 PostgreSQL diagnostics、并发、HTTP envelope/request ID、unknown 500 不泄漏、原子性和 Session reuse 的可观察验收。
- [x] `prd.md` 已完成 convergence pass；`design.md`、`implement.md` 可 review；两个 JSONL 都是实际条目且无 `_example`。
- [x] 任务保持 `planning`，未运行 `task.py start`，未修改任何禁止范围或无关脏文件。

## Convergence Pass

- 目标、范围、非目标和九项强制决策均已由仓库证据闭合；没有剩余会改变授权、错误 wire 或数据生命周期的产品语义问题。
- 对研究中的两处时态冲突采用当前 head + 完整迁移链为权威：全局 handler 已移除；0037 覆盖 0034 的 FK 中间态。
- 新 GEO code 不增加 schema enum/details 字段，不触发 generated client 变化；若实施时发现 operation status 或 wire shape 必须改变，立即停止并走 contract-first 原子同步，不把该扩展塞入 code-only Task。
- 本规划提交用于冻结后续实施基线；T5-I1 已完成并归档，未改变上述已批准合同。

## Lifecycle Status（2026-09-14）

- T5-I1 `publication-repair-task-integrity-mapping` 已由工作提交 `62bb2360` 完成，并由归档提交 `004097bc` 归档；不得再次归档。
- 本 Task 与顶层父任务 `integrity-error-domain-mapping` 均继续保持 `planning`，不因单个实施子任务完成而归档。
- 下一项明确为 T5-I2 `publication-work-integrity-mapping`；本次状态收敛不创建、不启动或实施该 Task。
