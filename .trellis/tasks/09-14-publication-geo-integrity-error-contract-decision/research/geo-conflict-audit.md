# Research: GEO IntegrityError 与 context/chain conflict 审计

- Query: 审计 GEO 观测的 `REVISION_CONFLICT`、上下文/更正链完整性、IntegrityError 边界，以及 GEO/普通 ContentTask 共享幂等键的 source-kind 身份隔离。
- Scope: mixed（内部代码、迁移、合同、backend spec、集成测试与前端恢复契约）
- Date: 2026-09-14

## Findings

本审计以父任务研究 `.trellis/tasks/09-04-integrity-error-domain-mapping/research/revision-conflict-producer-inventory.md` 的 12 个 GEO 条目为输入，并交叉核对 `.trellis/spec/backend/error-handling.md`、`.trellis/spec/backend/database-guidelines.md`、`.trellis/spec/backend/available-actions-contract.md`、`contracts/database.md` 以及 GEO 三组集成测试；相关前端恢复证据来自 `frontend/src/domains/geo/` 与 `docs/frontend-v2/05-business-actions-state-and-api-contract.md`。

### 1. 当前数据模型和错误边界

`GeoObservation` 是不可变、append-only 的观测事件：ORM 只有产品、主题、平台/查询、`tested_at`（事件时间）、`created_at`（写入时间）和自引用 `supersedes_id`，没有 `revision`、可写 `state` 或状态机字段（`backend/app/models/geo_files.py:24-57`）。当前/历史由“是否存在 successor”派生（`backend/app/services/geo_observation.py:151-154`）；列表、指标和 insights 默认只读 chain tail，详情显式返回 root/tail/selected/history（`geo_observation.py:317-388`, `874-882`, `986-1094`）。因此，`REVISION_CONFLICT` 在这些路径中并不是客户端提交的 `expected_revision` 失败：请求没有 `expected_revision` 字段，且读取和删除也没有 revision 比较。它目前被复用为“服务端发现链结构与当前读模型不一致”或“尾节点已被更正”的占位错误。

当前 head 没有全局 `IntegrityError` handler（`backend/app/errors.py:23-58`，`backend/app/main.py` 中亦无 GEO handler）；`get_db` 只在异常时 rollback、最后关闭 session（`backend/app/db.py:31-40`）。backend 错误规范要求仅按 `orig.sqlstate` 与 `orig.diag.constraint_name` 精确匹配已批准的约束，未知 IntegrityError 重新抛出为默认 500，严禁解析异常文本（`.trellis/spec/backend/error-handling.md`）。所以 GEO 的 service `AppError` 与未知数据库错误必须保持两条边界：稳定的业务/完整性场景在提交前用显式检查产生稳定 code；未命名或不稳定的 trigger/FK/check/跨表 guard 诊断不能被宽泛映射为 `REVISION_CONFLICT`。

迁移 0007 为 `supersedes_id` 建立非空部分唯一索引 `uq_geo_observations_supersedes_once`（`backend/alembic/versions/0007_geo_observation.py:18-32`）。它是并发更正时的最终数据库约束，但 `create_geo_observation` 未捕获该唯一冲突（`backend/app/services/geo_observation.py:2378-2475`），因此同一前序节点并发更正可能落到原始 23505/默认 500。0029/0034 的 append-only 与跨表 guard 会抛出 55000/23514，且 `RAISE EXCEPTION` 没有稳定 `diag.constraint_name`（`backend/alembic/versions/0029_manual_geo_independent_facts.py:44-140`, `0034_publication_workflow_redesign.py:610-659`）；不能依赖错误文本或把整个 SQLSTATE 类别映射成可恢复的 409。

### 2. 逐一核验父任务识别的 12 个 GEO producer

下表将父任务 `revision-conflict-producer-inventory.md` 的 12 个位置拆成独立决策。`expected_revision` 一栏均为“否”：代码没有读取/比较该输入，也没有 GeoObservation revision owner。建议 code 是契约建议，不代表当前实现已经提供。

| # / operation（位置） | 触发条件与实际语义 | 真正 `expected_revision`？ | 建议 code / HTTP | 前端恢复与 unknown 处理 |
|---|---|---|---|---|
| 1. `_manual_observation_chain`（`geo_observation.py:884-904`） | 向上递归找 root 后，root 数不为 1 或目标不在祖先集合；静态链断裂/孤链 | 否 | `GEO_OBSERVATION_CHAIN_INVALID` / 409 | 详情、context 显示链损坏；不可盲目重放。可提供显式“重新加载”仅用于获取新服务端状态。未知 IntegrityError 仍 500，禁止文本解析。 |
| 2. `_manual_observation_chain`（`907-928`） | root 向下递归后目标缺失或节点重复；读快照下的结构不一致 | 否 | `GEO_OBSERVATION_CHAIN_INVALID` / 409 | 同上；409 不应被解释为用户 revision 乐观锁。前端现有通用 409 提示可保留 request id。 |
| 3. `_manual_observation_chain`（`930-938`） | 任一节点不是 MANUAL，或 product/platform/query 与目标不一致；跨类型/跨产品链污染 | 否 | `GEO_OBSERVATION_CHAIN_INVALID` / 409 | 静态数据损坏，保留草稿但不要自动重放/改写链；需要运维/数据修复任务。不要把 trigger 55000/23514 文本映射成此 code。 |
| 4. `_manual_observation_chain`（`940-946`） | successor map 出现两个 child 或 walk 形成 cycle；分支/环 | 否 | `GEO_OBSERVATION_CHAIN_BRANCH`（或统一 `...CHAIN_INVALID`）/ 409 | 只展示错误并允许显式刷新；没有安全的客户端合并策略。delete 同类分支应使用同一稳定契约。 |
| 5. `_manual_observation_chain`（`948-950`） | 从 root 到 tail 的有序 walk 数量不等于递归节点数量；链不完整 | 否 | `GEO_OBSERVATION_CHAIN_INVALID` / 409 | 不自动提交更正；前端的 `REVISION_CONFLICT` 兼容集合应在专用 code 落地时扩展，但不解析 message。 |
| 6. `get_geo_observation_detail`（`geo_observation.py:986-1029`） | 批量 projection 返回的 history item 不是 `ManualGeoObservationOut`；服务内部类型/数据投影不一致 | 否 | `GEO_OBSERVATION_CONTEXT_INCOMPLETE` / 409（或专用 `...PROJECTION_INVALID`） | 这是服务器 read-model contract 错误，不是用户冲突；前端只给可重试的 409 失败视图，不自动重放。unknown 仍默认 500。 |
| 7. `create_geo_observation`（`2378-2428`） | 指定 `supersedes_id` 的前序节点已经有 successor；已有更正胜出 | 否 | `GEO_OBSERVATION_HAS_SUCCESSOR` / 409 | 更正页标记 context stale，保留草稿和上传文件，用户显式 reload 后合并最新 tail（现有前端已对 `GEO_PUBLICATIONS_CHANGED`/`REVISION_CONFLICT` 采用该模式）。这是最接近“并发冲突”的路径，但仍非 expected_revision。 |
| 8. `create_geo_observation`（`2429-2435`） | 沿 supersedes 链读祖先时缺失父节点；不可证明新更正的 lineage | 否 | `GEO_OBSERVATION_CHAIN_INVALID` / 409 | 不重放；提示链不可用并保留草稿。该 service 预检查应继续 fail-explicit，不能以零/空祖先替代。 |
| 9. `_lock_manual_observation_chain`（`geo_observation.py:2478-2509`） | 删除前锁链时父节点缺失、cycle、产品/类型不匹配；删除目标链无法证明 | 否 | `GEO_OBSERVATION_CHAIN_INVALID` / 409 | 删除页应阻止操作并要求显式刷新/管理员介入；不得自动选择某条分支。未知 DB guard/trigger 错误不转此 code。 |
| 10. `_lock_manual_observation_chain`（`2510-2532`） | successor 遍历发现两个 child；删除链分支 | 否 | `GEO_OBSERVATION_CHAIN_BRANCH` / 409 | 显示不可删除；不自动 retry（retry 只会重复危险的全链删除）。前端确认文案已经说明删除整条链不可逆。 |
| 11. `_lock_manual_observation_chain`（`2533-2539`） | descendant child cycle 或产品/类型不匹配；删除链跨边界 | 否 | `GEO_OBSERVATION_CHAIN_INVALID` / 409 | 仅人工修复/显式刷新；链不能由客户端推断。 |
| 12. `_lock_manual_observation_chain`（`2540-2553`） | 锁定后的节点数量/目标 membership 与预期不同；链在锁定/读取过程中变化 | 否 | `GEO_OBSERVATION_CHAIN_CHANGED` / 409 | 这是 delete 的并发变化，不是 revision 字段。建议只允许用户显式重新打开/刷新；不自动重复 DELETE。未知 IntegrityError 仍不转换。 |

补充：`_manual_observation_chain` 的统一 `REVISION_CONFLICT` 当前覆盖第 1–5 项，详情的输出类型检查覆盖第 6 项；创建覆盖第 7–8 项；删除锁链覆盖第 9–12 项（`geo_observation.py:904,928,938,946,950,1029,2428,2435,2509,2532,2539,2553`）。建议专用 code 是否分成三种应由父任务合同决策，但至少必须把“已有 successor（可恢复并发）”与“静态损坏/分支/投影错误（不可安全重放）”分开。

### 3. 命令、路由、权限和状态转换

- 详情 GET、纠正 context GET、insights 使用连接级 `REPEATABLE READ`（`backend/app/routers/observation.py:85-88,258-280,365-371`）；列表是 current-tail read model。context 会调用 detail 后再验证是 MANUAL 且 tail 有 `CORRECT` action；非手工观测为 `INVALID_STATE_TRANSITION` 409，权限不足为 403（`geo_observation.py:1096-1108`）。`available_actions` 是 projection，不是授权边界；路由分别强制 ADMIN/ENGINEER 的 correction/create 和仅 ADMIN 的 delete（`observation.py:274-311,329-347`），service 仍须重验。
- 创建 observation 锁 Product、QueryTopic 和当前 eligible PublishedArticle 集，要求客户端文章 id 集完全相等；候选变化产生 `GEO_PUBLICATIONS_CHANGED` 409，非法证据/重复截图/不一致产品平台等为 422（`geo_observation.py:2378-2475`）。它创建 immutable row、publication relations、attachment relations 后一次 commit；没有 audit success entry，也没有 `expected_revision`。
- 删除走完整 root→tail 锁链，再 tail→root 显式删除 citation/publication/attachment/observation；每个 observation 删除前设置 transaction-local `partsignal.geo_observation_delete_id`，DB trigger 只允许匹配的全链删除（`geo_observation.py:2557-2647`；`0029_manual_geo_independent_facts.py:95-140`）。成功后只写 `geo_observation.deleted` 审计，details 是稳定的 root/id/count 字段，最后同一事务 commit（`geo_observation.py:2557-2590`, `backend/app/audit.py:80-159`, `backend/app/audit_types.py:33-80`）。失败由 `get_db` rollback；触发器、FK 和跨表 guard 是最终边界。
- GEO 没有可变 workflow state；`workflow_stage`、`primary_task`、actions 都是 read-model 投影。`tested_at` 是业务事件时间并用于日期过滤/metrics/insights（`geo_observation.py:157-173`），`created_at` 是 append 时间；当前没有校验 correction 的 `tested_at` 必须单调，这不是当前合同明确要求，不能补猜测性约束。

### 4. Append-only、外键、发布链接和迁移终态

0029/0034 的 guard 保证 manual/legacy independent facts 形状、relation 与 PublishedArticle/PublicationWork 的有效状态，且 append-only delete 必须带 transaction-local setting。合同要求手工 GEO 历史保留、删除必须是管理员显式删除整个 archived aggregate；发布/文章仍被 GEO 引用时不能 silent cascade。`PublishedArticle` 删除 command 会检查 GEO 引用并拒绝，0038 migration 也有跨表 delete guard；永久删除 content-task aggregate 时才调用完整 chain delete helper（`backend/app/services/publication.py:1062-1076,1111-1120,1321-1340,1471`，`backend/alembic/versions/0038_published_article_delete.py:67-80`）。

`0034` 建立 GEO Article 外键时使用 `RESTRICT`，但这只是中间迁移状态。`0037_simplify_deletion_lifecycle._replace_foreign_keys()` 已将 `fk_geo_citations_published_article` 重建为 `SET NULL`、`fk_geo_publications_published_article` 重建为 `CASCADE`（`backend/alembic/versions/0037_simplify_deletion_lifecycle.py:187-206`），与当前 ORM `GeoObservationCitation`/`GeoObservationPublication` 一致（`backend/app/models/geo_files.py:59-89`）。业务上的“不静默删除 GEO 历史”由 publication service blocker 与 `0038` Article delete guard 最终执行，不能只依据 FK 动作判断删除被允许。后续只需增加 final-head catalog sentinel；若真实目标库与 head 不符则停止并另立迁移修复任务，不在错误 mapper 中掩盖。

### 5. 共享 ContentTask 幂等键的双向 source-kind identity

普通 ContentTask 与 GEO optimization 共用 `content_tasks.idempotency_key` 的全局唯一约束（`backend/app/models/content.py:28-38,70-88`）。GEO 的 `create_geo_optimization_content_task` 先以相同 advisory xact lock `content-task-create:{key}` 串行化，然后读取 `ContentTaskGeoSource`：同 key 且 GEO source 的完整 product/fact/platform/rule/date/article/topic 身份相同才 replay；source 缺失或任一字段不同则 `IDEMPOTENCY_CONFLICT` 409（`backend/app/services/geo_observation.py:2201-2231`）。因此“普通 winner 已存在”不会被当成 GEO winner。

普通命令 `create_content_task` 的反向判断也显式拒绝 GEO winner：`_is_content_task_idempotency_integrity_error` 只接受精确 23505 + `uq_content_tasks_idempotency_key`（`backend/app/services/content_planning.py:426-433`）；`_content_task_has_ordinary_identity` 发现 `ContentTaskGeoSource` 即返回 false，随后统一 `IDEMPOTENCY_CONFLICT`（`content_planning.py:436-461`）。唯一冲突捕获后先 rollback，再查询 winner；winner identity 不完整则重新抛出原始错误，未知诊断不被伪装（`content_planning.py:464-519`）。

现状的缺口在 race 路径而非已提交 winner：GEO 命令本身没有对应的 IntegrityError catch。若普通请求和 GEO 请求同时都读不到 key，普通请求先 flush/commit 后，GEO 的 `add_locked_content_task` flush 可能收到 23505 并默认 500；反向亦应统一验证。建议后续在 GEO command 复用同一精确诊断 helper：捕获后 rollback，重新加载 winner；无 `ContentTaskGeoSource` → `IDEMPOTENCY_CONFLICT`，有完整相同 GEO source → replay，有 source/target 差异 → `IDEMPOTENCY_CONFLICT`，winner 缺失/不完整 → 原始错误。绝不能仅按 `ContentTask` 行存在来 replay GEO，也不能按异常字符串识别 source-kind。task 与 source 必须仍在同一事务中创建；source flush 失败必须 rollback task（现有测试已覆盖）。

GEO source 是一对一、不可变的 source snapshot（`backend/app/models/content.py:171-210`），普通 task API 响应不会泄漏 idempotency_key/source snapshot（`backend/app/schemas/projections.py:189-200`）。该 identity 隔离满足“两个 source-kind 不能 replay 对方 winner”的业务原则，但应补并发双向测试以证明失败路径和 session 可复用性。

### 6. 前端恢复契约和当前测试覆盖

- correction page 当前把 `GEO_PUBLICATIONS_CHANGED`、`REVISION_CONFLICT` 视为 context stale；保留 draft/uploads，不自动 replay，用户显式 reload 后按 article id 合并并更新 canonical tail（`frontend/src/domains/geo/geo-observation-correction-page.tsx:79,170-220,285-291`）。若引入 `GEO_OBSERVATION_HAS_SUCCESSOR`/`...CHAIN_CHANGED`，需分别加入“可刷新并发变化”集合；静态 `CHAIN_INVALID/BRANCH` 应显示不可恢复错误而非重复 mutation。route 对所有 409 仍只显示通用 workbench unavailable（`frontend/src/routes/_app/geo/observations/$observationId_.correct.tsx:78-83`），不能用 message 文本分流。
- detail page 409 目前是通用链/上下文失败视图，用户显式 retry；操作按钮完全依据 server `available_actions`（`frontend/src/domains/geo/geo-observation-detail-page.tsx:391-410`, `frontend/src/domains/geo/geo-observation-actions.ts:18-50`）。detail model 对链 id/order/flags 做结构契约断言，未知响应是本地 contract mismatch，不应与 HTTP conflict 混淆。
- `test_geo_observation_correction.py:95-334` 覆盖完整链纠正、原始 immutable、非 tail `REVISION_CONFLICT`、证据重用、平台变更和 candidate set 变化；`338-443` 覆盖 legacy rejection 与链长无关 query count。`test_geo_observation_detail.py:65-254` 覆盖 root/tail/history/evidence 与查询数，`256-302` 覆盖 missing publication 的 context incomplete 和 child query mismatch 的 chain conflict。
- `test_geo_insights.py:234-271` 覆盖 frozen platform identity；`275-340` 覆盖两个 GEO 请求同 key 的原子性/完整 payload；`343-414` 覆盖等待 observation commit 后 stale；`417-491` 覆盖在锁下重新验证 platform/product/fact；`494-538` 覆盖 source flush 失败回滚。现有测试没有普通/GEO 共享 key 的双向 race，也没有 exact GEO unique 23505 的稳定响应、unknown 23514/55000 的默认边界或失败后同一 Session reuse。

## 可 review 的后续任务切分

1. **错误合同与 code ownership**：确定 `GEO_OBSERVATION_HAS_SUCCESSOR`、`GEO_OBSERVATION_CHAIN_INVALID`、`GEO_OBSERVATION_CHAIN_BRANCH`、`GEO_OBSERVATION_CHAIN_CHANGED` 是否四分或压缩为三类；明确均为 409、均不携带 `expected_revision`，并在 openapi、error matrix、前端 error mapping 中对齐。静态损坏与并发可恢复冲突必须分开。
2. **GEO create 的精确唯一冲突处理**：新增只匹配 `23505` + `uq_geo_observations_supersedes_once` 的 mapper/catch，rollback 后确定 successor winner；其他 IntegrityError/trigger/FK/check/跨表 guard 继续 unknown 500/55000 边界，不解析文本。
3. **共享 idempotency source-kind race**：抽取或复用普通 task 的精确 key-diagnostic 判定，在 GEO command 加上 rollback→winner identity→replay/conflict 逻辑；保持 task/source 原子事务，禁止 source-less ordinary row 作为 GEO replay。
4. **final-head catalog sentinel**：核实 0037 后 GEO Article FK 的 `SET NULL`/`CASCADE` 与 ORM 一致，并同时证明 publication blocker/0038 guard 仍阻止越界删除；目标库若偏离 head，另立 schema 修复任务。
5. **读模型/前端恢复**：为新 code 更新 structured error contract；correction page 仅对 successor/candidate/chain-changed 做显式 reload，chain-invalid/branch/projection-invalid 禁止自动 mutation retry；detail 继续显示 request id 与显式 retry。
6. **审计与 session/事务回归**：确认 create/correction 不产生 retained audit，delete 成功只写稳定 ids/counts；验证 AppError、精确映射的 IntegrityError、未知 trigger 错误在 rollback 后同一 Session 可继续安全读，且失败不留下 task/source/GEO relations。

## 建议验证场景

- 同一 `supersedes_id` 两个并发 POST：断言一个成功、另一个稳定 `GEO_OBSERVATION_HAS_SUCCESSOR` 409；检查仅一条 successor、原始/胜者均 append-only，失败 session rollback 后仍可查询。
- 构造 root 缺失、target 不在递归节点、跨 product/platform/query、分支、cycle、节点数变化六类链故障：逐一断言专用 409 code，不根据中文 message 做客户端分支，不发生删除或自动更正。
- GET detail/correction context 在同一 REPEATABLE READ snapshot 下验证 root/tail/selected/evidence/action 一致；改变已发布文章或平台 live row 后，仍使用 PublicationWork frozen identity；缺 context 时明确 409 且不填零值。
- 普通 ContentTask 与 GEO optimization 使用同一个 key 的四个排列（ordinary 先提交、GEO 先提交、ordinary/GEO 各自 race）：同 kind+完整 identity 才 replay；跨 kind 或 identity 任一字段不同均 `IDEMPOTENCY_CONFLICT` 409；source flush/commit 失败无残留。
- 对 `uq_content_tasks_idempotency_key` 和 `uq_geo_observations_supersedes_once` 分别注入精确 23505，断言 rollback 后 winner resolution；注入无命名 trigger 23514/55000、FK/check、append-only guard，断言不被转换成 REVISION_CONFLICT 且响应不泄漏 SQL 文本。
- 删除管理员完整手工链与 legacy/single/incomplete/branch：验证 root→tail 锁和 tail→root 删除、transaction-local config、引用文件仅延迟 cleanup、文章被 GEO 引用时 RESTRICT；成功审计只含允许的稳定字段，失败无审计/部分删除。

## Caveats / Not Found

- 父任务既有 inventory 将 GEO 12 个 service producer 统计为 `REVISION_CONFLICT`，但当前代码没有 `expected_revision` 或 GeoObservation revision owner；“revision conflict”应视为待合同决策的历史命名，不能直接沿用为 optimistic-lock 语义。
- 既有资料中关于“全局 IntegrityError handler”的描述与当前 head 不一致；本审计以当前 `errors.py`、router 与 `get_db` 为准：未知 IntegrityError 目前走默认 500。若主任务另行恢复全局 handler，必须继续遵守 exact sqlstate+constraint_name 和 unknown rethrow 规范。
- `0034` 的两个 `RESTRICT` 是历史中间态；final head 由 `0037` 重建为与 ORM 一致的 `SET NULL`/`CASCADE`。尚缺真实目标库 catalog sentinel，不能把源码一致性误报成已验证部署状态。
- `create_geo_observation` 的 `request_id` 参数当前未用于 GEO audit；创建/纠正没有 retained audit 记录，只有 delete 成功记录 `geo_observation.deleted`。这符合当前 audit whitelist/合同，但若未来要审计 mutation，应先更新契约而非悄然增加字段。
- 当前测试没有删除 service 的完整集成覆盖，也没有跨 source-kind idempotency race、GEO unique 23505 mapper、未知 guard diagnostics 或 session reuse 的证明；这些是实现后必须补的验证缺口。
