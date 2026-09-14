# Design：Publication/GEO IntegrityError 与上下文冲突合同

## 1. 设计结果

采用“command owner 内窄 mapper + 数据库最终权威 + operation-specific 409 code”的设计。预检查用于稳定用户体验，行锁/advisory lock 用于合规请求串行，但都不替代 PostgreSQL 约束。只在已批准约束上读取 `error.orig.sqlstate` 与 `error.orig.diag.constraint_name`；没有精确 pair 就原样上抛。

不建立全局 registry，不把 trigger/跨表 guard 映射为 revision，不冻结 default 500 body。GEO 的链/上下文错误按恢复动作压缩为 context incomplete、successor winner、chain changed 三类，而不是为每种损坏形态制造 code。

## 2. Authority 与错误生命周期

```text
request precheck/lock
        │
        ├─ 已存在且语义可证明 ──> 既有 409 / replay
        │
        └─ INSERT/flush/commit
                 │
                 ├─ exact 23505 + approved constraint
                 │      ├─ command root rollback
                 │      └─ 同义 domain code / approved replay
                 │
                 └─ 其他 IntegrityError/DBAPIError
                        └─ 原抛 -> request Session rollback/close -> default 500
```

- mapper 只分类，不拥有通用事务策略；每个 standalone HTTP command 拥有自己的 root transaction。
- known mapper 在转 `AppError` 前 rollback，保证同一 Session 可复用。
- unknown 不在 service 中伪装 AppError；直接 service 测试要由调用者显式 rollback，HTTP dependency 负责 request rollback/close。
- `details={}` 是本轮新增/澄清 code 的冻结形状；不在 rollback 后查询 winner ID，不允许客户端把 conflict 当成功。

## 3. Publication 设计

### 3.1 可恢复 unique/partial unique

| final constraint | command | precheck/serialization | target |
|---|---|---|---|
| `uq_publication_works_idempotency_key` | `create_publication_work` | `publication-request:{key}` advisory lock + key lookup | 同 `content_version_id/platform_account_id` replay；不同 payload `IDEMPOTENCY_CONFLICT`。exact 23505 loser rollback 后只按同一 identity 查询 winner。 |
| `uq_publication_works_content_task_id` | 同上 | content/task row lock；后续补 content-task identity precheck | `PUBLICATION_IDENTITY_CONFLICT`。 |
| `uq_publication_works_active_platform_hash` | 同上 | `publication:{platform}:{hash}` advisory lock + active identity lookup | `PUBLICATION_IDENTITY_CONFLICT`。 |
| `uq_published_content_issues_one_open` | `open_published_content_issue` | Article `FOR UPDATE` + OPEN/RETIRED precheck | `PUBLISHED_CONTENT_ISSUE_CONFLICT`。partial unique exact pair只代表已有 OPEN；RETIRED 仍由 precheck处理。 |
| `uq_content_tasks_source_published_content_issue_id` | `create_repair_task` | Issue `FOR UPDATE` + source precheck | `REPAIR_TASK_EXISTS`，不查询 winner，不 replay。 |

平台账号的 `uq_platform_accounts_profile_identifier_normalized` 继续使用现有 mapper，本规划不重复实施。

### 3.2 必须 unknown 的 publication 完整性失败

- `uq_publication_verifications_one_passed`：Work lock、revision/state 和 PASSED transition 已是正常业务边界；DB 命中表示 writer/状态不变量被绕过。
- `pk_published_articles`、`uq_published_articles_verification_id`：Article 是成功 verification transaction 的不可变产物，不存在“采用另一 Article”的批准语义。
- `pk_publication_attachments`：正常命令已有附件输入检查，但没有批准的 DB fallback code。
- PublicationWork/Event/Verification/Article/Issue/Attachment 的其他 PK/FK/CHECK/NOT NULL、append-only trigger、completion/identity/history constraint trigger、Article delete guard、AuditLog 约束：全部 unknown。
- service 的既有 `NOT_FOUND`、`INVALID_STATE_TRANSITION`、`PUBLICATION_CONTEXT_INCOMPLETE`、`PUBLISHED_ARTICLE_IN_USE` 等显式 precheck 保持；这不授权把相应 FK/trigger 异常反推为同一 code。

### 3.3 Repair source 并发语义

合规调用都锁同一 Issue，故两个 HTTP 请求的第二个在 winner commit 后由 precheck 返回 `REPAIR_TASK_EXISTS`。真实 unique violation 需要 test-only barrier/bypass writer 或未来未共享 Issue lock 的 owner 才会出现；不能为制造测试移除 production lock。

无论走 precheck 还是 exact 23505：

- 恰有一个 Repair Task 提交；
- loser 为 `409 REPAIR_TASK_EXISTS` + ErrorEnvelope + request ID + `{}`；
- loser 不产生第二条 task、issue revision/state 变化、event、article、GEO link/source 或 SUCCESS AuditLog；
- exact path rollback 后同一 Session 可查询；
- unknown constraint 原抛，HTTP 500 不包含 SQL、table、constraint 或 driver message。

### 3.4 FK final-head 决策

`fk_content_tasks_published_issue` 的权威目标为 `ON DELETE SET NULL`：

- 0034 `RESTRICT` 是历史中间态；0037 以同名 FK 重建为 `SET NULL` 并使 source nullable。
- Article 永久删除仍由受控 transaction context、聚合锁与 guard 执行；Issue 删除后 Repair Task 保留且 source 变 NULL，该解绑不改变 Repair Task 的 state/revision。被删除 Article 所属 Work 的来源 ContentTask 才按实时平台是否存在恢复为 OPEN 或 CANCELLED、`revision + 1`，并保留原 `archived_at`。
- source 非删除场景保持 immutable；不能用普通 UPDATE 清空。
- 首个实施 Task 必须查询真实 PostgreSQL `pg_constraint`/`pg_get_constraintdef`：约束名准确、`confdeltype='n'`、定义含 `ON DELETE SET NULL`、列可空、unique 名准确。
- 如果目标库不符，立即停止 mapper 工作，保留当前事务/代码不动，另建只拥有 migration/ORM/contract/migration test 的条件性 schema Task；不得在本 Task 或 mapper Task 顺手修 schema。

## 4. GEO 设计

### 4.1 ordinary/GEO 幂等身份

| request kind | winner identity |
|---|---|
| ordinary | `product_id/fact_version_id/platform_profile_id` 全等，且无 `ContentTaskGeoSource` |
| GEO | 同一三元组全等，且有 `ContentTaskGeoSource`；`rule_code/date_from/date_to/published_article_id/query_topic_id/geo_platform` 全等 |

- 同 kind + 完整 identity replay；跨 kind或字段不等返回 `IDEMPOTENCY_CONFLICT`。
- winner 不存在，或必要 ContentTask identity 字段缺失到无法证明来源时，原抛 unknown；ContentTask identity 完整且没有 GEO source 时可明确判为 ordinary winner，返回 `IDEMPOTENCY_CONFLICT`。
- GEO source 存在且完整 identity 相同才 replay；source 存在但任一 identity 字段不同则 `IDEMPOTENCY_CONFLICT`，source 行自身缺少必需数据或无法证明归属时原抛 unknown。
- ordinary command 的已提交/precheck/23505 路径已有反向 GEO guard；后续 GEO Task 只补 GEO owner 的精确 `uq_content_tasks_idempotency_key` race recovery。
- task 与 GEO source 必须同事务提交。source flush/commit 失败回滚 task；不返回 source-less task。

### 4.2 12 个 producer

| producer | operations | target | reason/recovery |
|---|---|---|---|
| `_manual_observation_chain` 5 个分支 | `getGeoObservationDetail`；经调用也影响 `getGeoObservationCorrectionContext` | `GEO_OBSERVATION_CONTEXT_INCOMPLETE` / 409 | root/descendant/identity/branch/cycle/disconnect 均无法安全投影；不返回部分链。 |
| detail output 类型不一致 | 同上 | `GEO_OBSERVATION_CONTEXT_INCOMPLETE` / 409 | read-model contract 不完整，不是用户 revision。 |
| create 的 target 已有 successor | `createGeoObservation` | `GEO_OBSERVATION_HAS_SUCCESSOR` / 409 | 已有更正 winner；保留草稿/evidence，显式 reload tail。 |
| create 的 evidence ancestor 缺失 | `createGeoObservation` | `GEO_OBSERVATION_CONTEXT_INCOMPLETE` / 409 | 无法证明 lineage，保持 blocked。 |
| delete ancestor 缺失/cycle/identity 越界、branch、successor invalid | `deleteGeoObservation` | `GEO_OBSERVATION_CONTEXT_INCOMPLETE` / 409 | 不选择/修补链，不执行任何删除。 |
| delete 锁后节点集合变化 | `deleteGeoObservation` | `GEO_OBSERVATION_CHAIN_CHANGED` / 409 | 可识别并发 stale；显式重新打开确认，不自动 DELETE。 |

`GeoObservation` 没有 revision 字段，上述 12 项全部退出 `REVISION_CONFLICT`。`uq_geo_observations_supersedes_once` 的 exact `23505` 与 successor precheck 统一为 `GEO_OBSERVATION_HAS_SUCCESSOR`；任何其他 unique/FK/check/trigger/55000/23514 仍 unknown。

### 4.3 前端恢复合同（只决策，T6 实施）

- `GEO_OBSERVATION_HAS_SUCCESSOR`、`GEO_OBSERVATION_CHAIN_CHANGED`、既有 `GEO_PUBLICATIONS_CHANGED`：可标记 canonical context stale；保留 draft/evidence/request ID；只允许显式 reload，按新 tail/Article ID 重新对账；禁止自动 replay。
- `GEO_OBSERVATION_CONTEXT_INCOMPLETE`：显示不可绘制/不可执行，保留本地现场但不把 retry 当 mutation；GET retry 只重新读取，仍失败则保持 blocked并提供 request ID。
- unknown 500：generic failure，不解析 message/code，不自动 replay。
- publication `REPAIR_TASK_EXISTS`：T6 显式 reload issue workspace/repair context，从 canonical projection发现已有 task；不从 `{}` 猜 task ID，不把 duplicate POST 当成功。

## 5. 不变量与事务验收

- Publication event `created_at` 继续在 Work lock 后使用 PostgreSQL `clock_timestamp()`，并以 `latest_created_at + 1µs` 保证严格单调；任何 mapper 不改变 `_work_event` 顺序。
- WorkEvent、Verification、Article、GEO observation/relations 保持 append-only/immutable；失败不留下半条 history。
- Verification PASSED 的 verification/article/work/task revision/event/AuditLog 同事务；Article/ContentTask 永久删除的 transaction-local context、GEO blocker、Repair source SET NULL、state/revision、墓碑 AuditLog 同事务。
- GEO create/correction 的 observation/publication/attachment/source 同事务；GEO whole-chain delete 的 root→tail lock、tail→root delete、transaction-local context、cleanup intent 和成功 AuditLog 同事务。
- known mapper rollback 后 Session 可用；unknown HTTP request 由 dependency rollback/close。测试不得通过 fixed-success mock、sleep 或削弱 production lock/schema伪造证据。

## 6. 合同变化矩阵

| owner | 本决策 | 后续动作 |
|---|---|---|
| `contracts/openapi.yaml` | 不变 | 所有目标 operation 已有 409；code 是 string，details 保持 `{}`。 |
| router/runtime response metadata | 不变 | `error_responses` status 集不变；request-ID middleware 不感知 code。 |
| generated client | 不变 | 禁止手改；code-only 预期 generated zero diff。 |
| `contracts/database.md` | 需变 | 分 owner补 constraint→code、双向 source-kind identity、final-head FK/catalog sentinel。 |
| backend specs | 需变 | error/database/publication specs 同步 narrow mapper、unknown、事务和测试。 |
| Frontend V2 05/08 | 需变 | 冻结 code-specific recovery 与验收；生产 consumer 留 T6。 |
| frontend stable specs | 需变 | T5 code 落地时更新 recovery语义；T6 实现前作为输入。 |
| backend contract/runtime tests | 运行且补 exact integration | status/schema/header 应零漂移；不能为 unknown 500 新增 OpenAPI 5xx。 |

如果实现证据要求 status、ErrorEnvelope schema、details 字段或 code enum 改变，当前 code-only Task 立即停止。新的原子顺序为：OpenAPI → router/runtime/service → backend contract/runtime/integration → generated client → frontend parser/consumer/tests → database/design docs与稳定 specs。

## 7. 风险与停止线

- Catalog 与 migration head 不一致：停止，创建条件性 schema Task；不做兼容 alias。
- 真实 PostgreSQL diagnostics 不返回批准的 exact constraint name：停止该 mapper，保留 unknown；不得解析 message。
- 并发测试只能通过移除生产锁或 schema 才能触发：停止，改用 test-only barrier/bypass writer；不改变锁协议。
- 新 code 需要 non-empty details/status/schema：停止并先做独立 contract-first Task。
- 两轮 `repair -> targeted re-check` 后仍失败或同根因重复：按全局收敛规则停止并报告。
- 任一 Task 触及未列入 allowlist 的生产边界、影响 event/deletion/AuditLog 不变量或发现无关脏文件重叠：停止，不吸收用户修改。

## 8. 独立高风险 review

每个涉及数据库并发、公共 code、不可变历史或删除边界的 T5 Task 都要一次独立只读 full review，重点检查 diagnostics allowlist、rollback owner、锁序、winner/replay、unknown 500、事件/删除/AuditLog 原子性和文件越界；只允许一次 targeted re-review。所有 T5 Task 与 review 都通过后，T5 gate 才完成。
