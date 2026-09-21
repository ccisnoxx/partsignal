# GEO Observation Context Code Reconciliation

## Goal

本 Task 是 T5-C `publication-geo-integrity-error-contract-decision` 的 T5-I6。单一可 review 目标是把 T5-I5 之外剩余 11 个、没有 `expected_revision` 或 revision owner 的 GEO context/chain producer 从 `REVISION_CONFLICT` 迁出：前 10 个统一为 `409 GEO_OBSERVATION_CONTEXT_INCOMPLETE`，锁链后集合/target membership 变化的最后 1 个为 `409 GEO_OBSERVATION_CHAIN_CHANGED`；所有目标错误保持场景化中文 message 与 `details={}`。

规划已获 2026-09-21 明确实施批准，本 Task 已进入 `in_progress`。本轮按冻结的 allowlist 实施和验证；不提交、不归档、不 push，也不部署或单独发布 backend code。

## Dependencies

- T1 unknown `IntegrityError` boundary：工作提交 `43c252da`，已完成。
- T5-C 合同规划基线：`771a5826`，继续保持 `planning`。
- T5-I1 至 T5-I5：工作提交依次为 `62bb2360`、`a96f6df2`、`a5469871`、`d5487430`、`7fd3ddd2`，均已完成并归档。
- T5-I5 的 `GEO_OBSERVATION_HAS_SUCCESSOR` 不属于本 Task，不能回退或重复实现。
- T6-G独立拥有GEO页面的frontend recovery，新增T6-C`frontend-content-task-geo-chain-recovery-reconciliation`拥有三个共享content-task operation的consumer recovery。T5-I5至少等待T6-G；T5-I6必须同时等待T6-G与T6-C，二者完成前不得部署或发布相关backend code。

## Frozen Requirements

### R1：错误 taxonomy 与 wire

- `GeoObservation` 没有 revision 字段；本 Task 的 11 项均不得继续使用 `REVISION_CONFLICT`。
- 第 1–10 项统一使用 `GEO_OBSERVATION_CONTEXT_INCOMPLETE`；第 11 项使用 `GEO_OBSERVATION_CHAIN_CHANGED`。
- status 保持 409，`details={}`；message 可保持各场景差异，任何 consumer/test 不得解析 message 做业务分支。
- 目标 operation 已声明 409，`ErrorDetail.code` 是开放 string；OpenAPI、router response metadata、runtime metadata、generated client 必须零差异。

### R2：完整上下文与恢复

- Detail/Correction context 出错时整个响应失败，不返回部分 root/tail/selected/history，也不猜测或修补链。
- `GEO_OBSERVATION_CONTEXT_INCOMPLETE` 表示 context 无法安全绘制或执行：保留现场，保持 blocked；GET 可显式重新读取；mutation/delete 不自动 replay。
- `GEO_OBSERVATION_CHAIN_CHANGED` 表示当前调用发现的 canonical chain 集合在锁定阶段发生变化：旧删除确认失效，必须显式刷新/重开并重新确认，禁止自动重发 DELETE。
- 第 11 项不是客户端确认 token 或通用 optimistic lock；不能扩大其语义。

### R3：创建、删除与快照原子性

- correction evidence ancestor 缺失不得创建新 observation、publication relation、attachment relation 或部分文件关联。
- Detail/Correction 的 HTTP owner继续在 `REPEATABLE READ` 下保持 root/tail/selected/history 一致。
- event `tested_at`、append `created_at`、frozen publication identity、observation/publication/attachment immutable 行为不回归。
- 删除失败不得删除任何链节点、relation 或 file，不得写 SUCCESS AuditLog，不得留下部分 cleanup intent。
- 权限、`available_actions`、删除确认、状态投影与路由行为保持不变。

### R4：unknown 数据库边界

- unknown `23514/55000` trigger、FK、CHECK、append-only guard 或其他 `IntegrityError` 继续 default 500，禁止映射成上述两个 409。
- HTTP unknown 500 不得泄漏 SQL、表名、constraint、driver message 或 traceback；不冻结默认 500 body/schema。
- Current head 的 GEO append-only trigger由 0037 重建为 UPDATE-only；0029 的 DELETE target guard 是历史中间态。本 Task 不恢复 schema/migration，也不能把旧 guard 当作当前验收。

### R5：测试证据

- 每个 producer都要按 operation 断言准确 status/code/message/details 与 request ID。
- branch/cycle/incomplete fixture 只能使用独立临时库中的事务内 DDL/受控 SQL，必须在 `finally` 完整回滚、恢复 listener/thread/connection，并以 fresh connection 复核 schema；禁止永久削弱 trigger/index/schema。
- 锁后集合变化必须由真实 PostgreSQL interleaving、独立 connection/backend PID 与有界同步证明，不能用 mock、sleep、timeout 或 future 状态代替。
- `backend/tests/integration/test_geo_observation_deletion.py` 当前不存在，实施时按批准范围新建。

### R6：文档与 release gate

- 同步Frontend V2 05/08与backend/frontend稳定spec，冻结T6-G GEO页面及T6-C content lifecycle的code-specific recovery，但不提前修改frontend production/tests。
- `GEO_OBSERVATION_CONTEXT_INCOMPLETE`与`GEO_OBSERVATION_CHAIN_CHANGED`必须和T5-I5 successor code一起遵守release-atomic gate；共享operation consumer未完成时不能只凭T6-G放行。

## Producer Matrix

11 项的触发条件、message、目标 code、事务 owner、恢复动作和准确证据见 `research/producer-owner-audit.md`。数量已经确认；矩阵不得把 `search_query` 误写成 `query_topic_id` 检查，也不得把删除 helper 当前只校验 product/kind 扩张为 platform/query 业务变化。

## Resolved Owner Expansion

审计确认 `_lock_manual_observation_chain` 不只属于 `deleteGeoObservation`。它经 `publication._task_deletion_scope` 同时服务：

- `getContentTaskPermanentDeletionPreview`
- `deleteContentTask`
- `permanentlyDeleteContentTask`

因此第 8–11 项的真实 operation/事务 owner超出T5-C初始矩阵。该发现曾触发停止线；用户已于2026-09-16明确批准把这三个operation及其integration test owner纳入同一T5-I6。

冻结决策：在不增加production文件的前提下，把上述三个operation纳入同一错误矩阵，并把`backend/tests/integration/test_publication_workflow.py`的对应preview/delete/permanent-delete回归加入implementation allowlist；父T5-C operation matrix同步修订。禁止用caller remap、复制helper或兼容alias隐藏共享owner。

## Implementation Allowlist

- `backend/app/services/geo_observation.py`
- `backend/tests/integration/test_geo_observation_correction.py`
- `backend/tests/integration/test_geo_observation_detail.py`
- `backend/tests/integration/test_geo_observation_deletion.py`（新增）
- `backend/tests/integration/test_publication_workflow.py`（只覆盖共享 content-task operation）
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/state-management.md`
- 当前 Task 工件
- T5-C `task.json` 与 operation matrix 的最小 bookkeeping/修订

## Protected Owners / Out of Scope

- `contracts/openapi.yaml`、默认不变的 `contracts/database.md`。
- ORM、migration、数据库 schema、backend router/schema/runtime metadata、generated client。
- frontend production code/tests；GEO页面由T6-G负责，共享content-task consumer由T6-C负责。
- T5-I5 successor mapper、publication业务语义、权限/状态机/投影、T5-G 或 T6 实施。
- 增强删除 identity 维度、引入确认 token、猜测/修补损坏链、返回部分历史、自动重放 mutation/delete。
- 清理或吸收当前大量无关 dirty/staged 文件；禁止 `git add -A`、`git add .`、`commit -a`、stash、reset、checkout、clean。

## Acceptance Criteria

- [x] AC1：用户已明确批准共享 content-task operation owner 与 implementation allowlist；父 T5-C matrix 已同步。
- [x] AC2：11 个 producer逐项拥有 operation、触发条件、目标 code、message、details、事务 owner和恢复动作；数量与 current head 一致。
- [x] AC3：第 1–10 项精确返回 `409 GEO_OBSERVATION_CONTEXT_INCOMPLETE / 场景 message / {}`；第 11 项精确返回 `409 GEO_OBSERVATION_CHAIN_CHANGED / GEO 观测更正链已变化 / {}`。
- [x] AC4：所有受影响 operation的 HTTP exact wire/request ID 已覆盖；unknown 500 no-leak且不误映射。
- [x] AC5：Detail/Correction 不返回部分链，REPEATABLE READ root/tail/selected/history 一致；create evidence 缺失零写入。
- [x] AC6：GEO delete与获批的共享 content-task owner失败均无链/relation/file删除、cleanup intent或 SUCCESS AuditLog；永久删除事务不留下部分聚合。
- [x] AC7：branch/cycle/identity/incomplete与锁后 membership fixture保留 current-head schema，`finally` 后 catalog/data恢复；不依赖历史 DELETE guard。
- [x] AC8：`tested_at`、`created_at`、frozen publication identity、immutable facts、权限、actions、确认与路由无回归。
- [x] AC9：OpenAPI、router/schema/runtime metadata、generated client、frontend production/tests零差异；相关 operation仍声明409且 code为开放string。
- [x] AC10：Frontend V2 05/08与三份stable spec同步，明确context blocked、chain changed重开确认、T6-G/T6-C owner和release-atomic gate。
- [ ] AC11：required validation、allowlist diff-check、protected-owner fingerprint与一次独立高风险 full review通过；material finding最多一次 targeted repair/re-check与一次 targeted re-review。
- [x] AC12：optional frontend probe与同一 candidate 最多一次 backend full suite按真实结果记录，不把未运行或环境失败写成通过。
- [x] AC13：T5-C与顶层父任务保持 `planning`；本 Task仅在明确实施批准后启动，不提交、归档、push、部署或单独发布 backend code。

## Convergence Status

已完成规划收敛和实施变更。producer count、code taxonomy、wire、恢复、数据库边界、共享operation owner、T6-G/T6-C release gate、精确文件边界与required validation均已冻结；实施 full review 的唯一 P2 已经一次 targeted repair 与一次独立 targeted re-review 确认关闭。用户于 2026-09-21 批准规划进入实施，当前 Task 仍为 `in_progress`：AC11 的前置 protected-owner 指纹未在 preflight 保存，不能追认该门禁通过。发布仍受 T6-G/T6-C release-atomic gate 约束。
