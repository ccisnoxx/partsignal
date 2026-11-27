# Design：GEO Observation Context/Chain Code Reconciliation

## 1. 设计目标

本设计只重命名错误的领域语义，不改变链构建、锁序、权限、状态、HTTP status、details、schema 或前端生产行为：

```text
read/create/static-delete context 无法完整证明
  -> 409 GEO_OBSERVATION_CONTEXT_INCOMPLETE / details={}

同一调用中发现的 delete chain 集与后续锁定结果不一致
  -> 409 GEO_OBSERVATION_CHAIN_CHANGED / details={}

T5-I5 successor precheck / exact unique
  -> 409 GEO_OBSERVATION_HAS_SUCCESSOR / details={}（保持不变）

unknown IntegrityError / DB guard
  -> 原抛 -> request owner rollback/close -> default 500
```

`REVISION_CONFLICT` 继续只属于真正拥有 revision/expected_revision 的其它 domain operation，不能全局搜索替换。

## 2. Producer owner

权威逐项表在 `research/producer-owner-audit.md`。逻辑上分为四组：

- R（Read）：`_manual_observation_chain` 与 detail output type，共 6 项；HTTP detail/correction-context 都由 REPEATABLE READ snapshot owner调用。
- C（Create）：evidence ancestor缺失，共 1 项；发生在新 observation/relation写入前。
- D（GEO Delete）：`_lock_manual_observation_chain` 的 4 项；发生在删除、cleanup intent与SUCCESS AuditLog前。
- P（Content-task aggregate）：D 的同一 4 个 producer经 `publication._task_deletion_scope` 复用，传播到 preview、普通 delete 与 permanent delete。

P 是本轮审计新增的真实 owner。用户已批准把它纳入同一T5-I6；父T5-C matrix、恢复与测试边界同步修订。

## 3. 已批准的 owner 决策

P 纳入同一T5-I6，不拆helper，也不在caller remap：

1. 领域事实仍是同一 GEO chain context，不因调用入口不同而改变 code。
2. production 修改仍只在 `geo_observation.py` 的 11 个 producer；不需要改 `publication.py`。
3. 三个 content-task operation已声明 409，OpenAPI/router/runtime/generated仍零差异。
4. 新增的范围只是 operation matrix、HTTP/事务回归与父规划修订；测试 owner为 `test_publication_workflow.py`。

明确禁止的方案：

- 在 publication caller把新 code remap回 `REVISION_CONFLICT`：继续暴露不存在的 GEO revision，并制造 operation-dependent alias。
- 复制/分叉锁链 helper：引入两套链不变量与漂移风险。
- 忽略共享调用面：无法证明所有可观察 operation 的 wire与失败原子性。

## 4. Read 与 Create 事务设计

### 4.1 Detail / Correction context

- Router在 service前设置连接 transaction isolation为 `REPEATABLE READ`。
- `_manual_observation_chain` 任一完整性检查失败，整个 endpoint返回409；不构造或返回部分 detail。
- output type mismatch仍属于 context incomplete，不是用户 stale revision。
- 失败只允许显式 GET reread；后续 T6-G在 cached refresh失败时需冻结旧 action，不能用旧 projection执行 mutation。

### 4.2 Create evidence lineage

- 仅当 correction带新增 evidence 时沿 ancestor链检查文件复用。
- parent缺失时在 observation构造、flush、relation add与commit前失败；因此实现仅替换 code，不引入 rollback/requery。
- 草稿与已上传但未关联的 evidence保持客户端/文件生命周期现状；不自动 replay POST。

## 5. Delete 与共享 aggregate 设计

### 5.1 GEO delete

- 保持 Product → root → remaining node的锁序。
- ancestor/branch/cycle/product/kind越界仍为 static context incomplete。
- 当前调用先发现 `chain_ids`，再锁定 remaining；锁定结果数量或 target membership不同才使用 chain changed。
- 所有四个分支都在 relation/observation delete、file cleanup intent、SUCCESS AuditLog与commit之前失败。

### 5.2 Content-task preview/delete/permanent-delete

- `_task_deletion_scope` 为 Article/GEO relation计算 exclusive chain；坏链时同一 code从共享 helper传播。
- preview是GET，不得描述为DELETE重试；恢复为保留诊断现场、显式reload preview，仍失败则blocked，不得继续使用旧preview。
- ordinary `deleteContentTask` 在archive/GEO blocker前构造scope；坏链应返回 context code且不删除task aggregate。
- permanent-delete实际是POST mutation；它在scope后再次调用完整chain delete。坏链/chain changed必须让整个root transaction失败，不得留下Article/Issue/GEO/task部分删除或墓碑SUCCESS AuditLog；chain changed后旧preview与确认文本失效，未来consumer必须显式刷新/重开并重新确认。
- 上述语义已经批准并写回父T5-C matrix与测试边界。

## 6. PostgreSQL fixture 与 current-head migration

### 6.1 Current-head truth

0037把 GEO 四表 append-only trigger重建为 UPDATE-only。0029的 DELETE target guard函数仍可能存在，但不再由 current-head同名 trigger执行。实施不得恢复 migration、schema或以历史测试冒充 current-head门禁；服务设置的 `partsignal.geo_observation_delete_id` 保持现状，本 Task不清理它。

### 6.2 损坏链 fixture

- Branch：只在隔离临时库的外层事务内 drop `uq_geo_observations_supersedes_once`，插入两个同 parent后继，完成断言后rollback DDL+数据；fresh connection复核index definition。
- Cycle：优先用单 SQL、预分配 UUID构造互指行并保留FK/unique。若PostgreSQL约束时序阻止，允许在同一外层事务内仅disable指定 `geo_observations_append_only` UPDATE trigger，完成受控UPDATE后立即enable并最终rollback。禁止 `DISABLE TRIGGER ALL`、`session_replication_role`或commit削弱后的schema。
- Identity：只能断言当前owner已有检查。Read校验kind/product/platform/search_query；Delete校验kind/product。增加平台/query删除校验是行为扩展，不属于code reconciliation。
- Lock-set changed：用独立Session、backend PID、Event/listener与lock evidence把第二连接变化安排在发现IDs与锁remaining之间；若真实FK/row lock使该interleaving不可达，触发停止条件，不能用mock/timeout伪造。

所有listener、Event、future、thread、connection、transaction和临时库在`finally`有界清理。先放行并收束线程，再移除listener、rollback与dispose；最后复核schema和baseline数据。

## 7. HTTP、合同与前端边界

- 目标 GEO operation与新发现的三个 content-task operation都已声明409。
- `ErrorDetail.code`为string，details为object；code-only变化不生成client diff。
- 每个受影响operation的HTTP测试需断言四字段ErrorEnvelope、`details={}`、body/header/inbound request ID对账。
- unknown 500只验证no-leak，不新增OpenAPI 500/default response。
- Frontend production/tests不属于本Task。T6-G拥有GEO correction/detail/list；T6-C拥有`content-task-lifecycle.tsx`及其list/detail consumer。Frontend V2和stable spec冻结：context incomplete保持blocked，chain changed刷新/重开/重新确认，successor/candidate stale显式reload，全部no replay且不解析message。

## 8. 原子性与回归

- Read：无部分 root/tail/selected/history。
- Create：无新observation、publication/attachment relation或部分file关联。
- GEO delete：无节点/relation/file删除，无cleanup intent，无SUCCESS AuditLog。
- Content-task aggregate：preview无写入；普通DELETE与permanent-delete POST mutation均无Article/Issue/GEO/task部分删除、cleanup或SUCCESS audit。
- `tested_at`、`created_at`、frozen publication identity、immutable facts、权限、actions、确认与route保持现状。
- T5-I5 successor mapper与exact 23505 classification不得修改。

## 9. Stop / rollback boundary

以下任一项立即停止：

- producer数量、触发条件或调用owner再次与矩阵不符。
- fixture必须永久disable/drop schema防线，或真实lock interleaving不可证明。
- 需要ORM/migration/schema、HTTP status/details/ErrorEnvelope/OpenAPI或frontend production变更。
- 需要增强identity规则、确认token、猜测/修补链、返回部分历史或自动重放mutation。
- 范围进入T5-G/T6或改变publication业务语义。

规划阶段的rollback只删除本Task可识别工件和父bookkeeping；不触碰现有大量无关dirty/staged变更。
