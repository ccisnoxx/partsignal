# T5-I6 Producer 与真实 Owner 审计

- 日期：2026-09-16
- 模式：只读源码、合同、migration、测试与前端影响审计；未运行测试或数据库写入
- 结论：剩余producer数量确为11；删除锁链的4个producer还会从3个content-task operation传播。该发现曾触发owner mismatch停止线，现已由用户批准纳入同一T5-I6。

## 1. 逐 producer 矩阵

下表行号对应当前 `backend/app/services/geo_observation.py`。现状 11 项均为 HTTP 409、`code=REVISION_CONFLICT`，且 `AppError` 默认产生 `details={}`。目标保持 message、status 与 details，仅按已批准语义替换 code。

| # | operation / producer | 精确触发条件 | 当前 message | 目标 code | 事务 owner 与恢复动作 | 证据 |
|---|---|---|---|---|---|---|
| 1 | `getGeoObservationDetail`、`getGeoObservationCorrectionContext` / `_manual_observation_chain` | ancestor CTE 的 root 数不为 1，或 target 不在 ancestor ID 集合 | GEO 观测更正链不完整 | `GEO_OBSERVATION_CONTEXT_INCOMPLETE` | REPEATABLE READ read owner；完整 GET 失败，保留现场并 blocked，只允许显式 GET reread | `geo_observation.py:905` |
| 2 | 同上 | descendant 结果没有 target，或 `len(nodes_by_id) != len(nodes)` | GEO 观测更正链不完整 | 同上 | 不返回部分历史，不猜测节点 | `geo_observation.py:929` |
| 3 | 同上 | 节点 kind 非 MANUAL，或 product、`search_platform`、`search_query` 与 target 不一致 | GEO 观测更正链不完整 | 同上 | 保持 blocked；不修补 identity | `geo_observation.py:939` |
| 4 | 同上 | ordered walk 当前节点有多个 successor，或下一节点已在 ordered ID 集合 | GEO 观测更正链存在分支 | 同上 | 不选择分支，不自动 merge/replay | `geo_observation.py:947` |
| 5 | 同上 | ordered walk 节点数与完整 descendant nodes 数不一致 | GEO 观测更正链不完整 | 同上 | 不返回部分链 | `geo_observation.py:951` |
| 6 | 同上 / `get_geo_observation_detail` | manual history 的 output 不是 `ManualGeoObservationOut` | GEO 观测更正链类型不一致 | 同上 | 整个 detail/context 失败；不返回部分 root/tail/selected/history | `geo_observation.py:1030` |
| 7 | `createGeoObservation` / `create_geo_observation` | 有 `supersedes_id` 且本次含新增 verified evidence；遍历 ancestor 时 parent 缺失 | GEO 观测更正链不完整 | 同上 | 发生在新 observation/relation 写入前；保留草稿与上传文件，blocked，只能显式重读 context，不自动 POST | `geo_observation.py:2529` |
| 8 | `deleteGeoObservation` 与共享 content-task operations / `_lock_manual_observation_chain` | ancestor 缺失、ancestor ID 已见，或 ancestor product/kind 越界 | GEO 观测更正链不完整 | 同上 | 在删除/cleanup/audit 前失败；不得猜测链或执行 mutation | `geo_observation.py:2609` |
| 9 | 同上 | successor 查询返回多个节点 | GEO 观测更正链存在分支 | 同上 | 不选择分支，不删除 | `geo_observation.py:2632` |
| 10 | 同上 | successor ID 已在 chain IDs，或 successor product/kind 越界 | GEO 观测更正链不完整 | 同上 | 保持 blocked，不删除 | `geo_observation.py:2639` |
| 11 | 同上 | 锁定 remaining 后节点数与已发现 chain IDs 不同，或 target 不在锁定集合 | GEO 观测更正链已变化 | `GEO_OBSERVATION_CHAIN_CHANGED` | GEO DELETE：显式重开/刷新并重新确认；content preview显式reload；普通DELETE与permanent-delete POST都必须刷新/重开/重新确认，禁止自动重发 | `geo_observation.py:2653` |

矩阵精度说明：第 3 项的“query identity”当前只比较 `search_query`，不比较 `query_topic_id`；第 8、10 项只比较 product/kind，不比较 platform/query。本 Task 是 code reconciliation，不能把更严格的 identity 校验伪装成既有条件。第 11 项比较同一服务调用内“已发现 ID 集”与“后续锁定结果”，没有客户端确认 token，也不能宣称它覆盖确认弹窗打开后的全部变化。

## 2. 事务与快照 owner

- Detail/Correction：`backend/app/routers/observation.py:85-87` 的 `_geo_observation_read_snapshot` 设置 `REPEATABLE READ`；两个 operation 分别在 `:263`、`:279` 使用。Correction context 调用 detail service，所以第 1–6 项从两个 GET 传播。失败时 request DB owner rollback/close，服务不得返回部分快照。
- Create：Product、eligible article 集和 previous observation 依序锁定。第 7 项发生在新 observation 构造与首次 flush 前，因此不能创建 observation、publication/attachment relation 或部分文件关联。
- GEO Delete：先锁 Product、root 与 remaining chain；`_delete_manual_observation_chain` 成功后才 tail→root 删除并登记 cleanup；`delete_geo_observation` 再写 SUCCESS AuditLog 并 commit。第 8–11 项必须在这些副作用前失败。
- Content-task aggregate：共享锁链 helper 还在 deletion preview、普通 delete scope 与 permanent delete scope 中执行；这些 operation 不属于 GEO read snapshot，也不都属于 DELETE mutation。

## 3. 已解决的停止线：T5-C 遗漏共享调用面

`backend/app/services/publication.py:1429` 的 `_task_deletion_scope` 调用 `_lock_manual_observation_chain`。它从以下 operation 可达：

| operationId | 路由证据 | service 调用证据 | 可观察影响 |
|---|---|---|---|
| `getContentTaskPermanentDeletionPreview` | `backend/app/routers/planning.py:464` | `publication.py:1509` | GET preview 可返回新的 GEO context/chain code；不是 GEO REPEATABLE READ owner。 |
| `deleteContentTask` | `planning.py:373` | `publication.py:1667` | scope 在 archive/GEO blocker 之前计算，坏链 code 会先于既有 blocker 返回。 |
| `permanentlyDeleteContentTask` | `planning.py:478` | `publication.py:1724`，并在 `:1729` 再调用 `_delete_manual_observation_chain` | preview scope 与实际整链删除都受共享 producer 影响。 |

这三个operation也已在OpenAPI与router声明409，因而不需要schema/status变更；但它们改变了operation owner、恢复动作、HTTP exact-code tests与allowlist。T5-C`decision-synthesis.md`初稿把第9–12项只归于`deleteGeoObservation`，与current head不一致。用户已明确批准扩大到共享publication/content-task测试；仍禁止复制helper、局部remap或保留错误的`REVISION_CONFLICT`来绕过统一owner。

## 4. Current-head 数据库事实与 fixture 约束

- `0029_manual_geo_independent_facts.py:95-140` 曾让四张 GEO 表的 append-only trigger 同时监听 UPDATE/DELETE，并用 `partsignal.geo_observation_delete_id` 守卫目标。
- `0037_simplify_deletion_lifecycle.py:338-354` 已把同名 trigger 重建为 **UPDATE only**。服务仍设置 GUC，但 current head 的 GEO DELETE 不再由 0029 target guard 执行。规划不得把历史中间态写成当前门禁，也不得在本 Task 恢复 migration/schema。
- `backend/tests/integration/test_geo_observation_deletion.py` 当前不存在，应作为新测试 owner；现有测试没有直接覆盖 service 整链删除。
- branch 需要在独立测试库的外层事务内临时 drop partial unique index并 rollback DDL+数据；cycle 优先用单 SQL 的预分配 UUID 互指构造，若不可行只能在同一事务内局部 disable/enable 指定 UPDATE trigger后 rollback。禁止 `DISABLE TRIGGER ALL`、`session_replication_role` 或永久 schema 变化。
- 锁后 membership 测试必须用独立连接、受控 Event/SQLAlchemy listener 与 PostgreSQL lock 证据安排 interleaving；timeout 或 mock exception 不能代替真实集合变化。
- listener、线程、连接、事务和临时数据库必须在 `finally` 收束；清理后用 fresh connection 复核 index 与 trigger catalog。现有 publication 临时库 helper 在 migration subprocess 失败前尚未进入 `finally`，不得原样复制该缺口。

## 5. 合同与前端只读影响

- 四个原计划 GEO operation 均已声明 409；`ErrorDetail.code` 是开放 string，`details` 是开放 object。OpenAPI、router/runtime metadata、generated client预期零差异。
- 新发现的三个 content-task operation也已声明 409，所以 owner 扩展仍不要求 OpenAPI shape/status 修改，但必须纳入 exact wire 和恢复语义验收。
- 当前correction页面仍把`REVISION_CONFLICT`当stale，只识别它与`GEO_PUBLICATIONS_CHANGED`；detail/list delete也没有`GEO_OBSERVATION_CHAIN_CHANGED`的reload/reopen/reconfirm blocker。T6-G必须移除GEO revision语义并实现context blocked与chain-changed恢复。
- 共享content-task consumer位于`frontend/src/domains/content/content-task-lifecycle.tsx`；当前对任意409自动invalidate，permanent-delete POST还可能保留旧确认文本。T6-C必须按code冻结preview、普通DELETE与永久删除POST的显式reload/reopen/reconfirm/no-replay。
- Frontend V2 05/08与backend/frontend stable spec需要冻结code-based恢复，不能解析message。T5-I6 release gate必须同时等待T6-G与T6-C。

## 6. 结论与已批准决策

producer数量与code决策无歧义。用户已于2026-09-16批准把三个content-task operation纳入同一T5-I6的producer operation矩阵，并把`backend/tests/integration/test_publication_workflow.py`的对应preview/delete/permanent-delete回归加入allowlist；生产修改仍只在`geo_observation.py`。父T5-C矩阵与当前PRD/design/implement已同步。独立full planning review发现的T6-C release-owner P2已经唯一一次targeted re-review确认关闭，未引入新material矛盾。caller remap、helper复制或保留GEO `REVISION_CONFLICT`均不在批准方案内。
