# Design：GEO Observation Successor 精确 IntegrityError 映射

## 1. Current-head owner 与已知缺口

`create_geo_observation` 当前依次锁 Product、eligible PublishedArticle 集合和 previous GeoObservation，再查询
`supersedes_id` 是否已有 successor。若已存在，它返回 `REVISION_CONFLICT`；若不存在，则新增 root observation，
在首次 `flush()` 后才追加 publication/attachment relations，最后 commit。

数据库最终权威由 migration `0007_geo_observation` 创建：

```text
UNIQUE INDEX uq_geo_observations_supersedes_once
ON geo_observations (supersedes_id)
WHERE supersedes_id IS NOT NULL
```

这是独立 partial unique index，不是 ORM owner，也没有对应 `pg_constraint` row。当前 root flush 没有本地
`IntegrityError` catch；并发或旁路 writer 命中它时会进入 default unknown 500。`GeoObservation` 没有 revision，
所以 precheck 与最终 index 应统一为 successor-specific code，而不是 revision conflict。

## 2. Narrow classifier 与 catch boundary

在 `geo_observation.py` 增加 command-local 私有 classifier，只接受：

```text
orig.sqlstate == "23505"
orig.diag.constraint_name == "uq_geo_observations_supersedes_once"
```

catch 只包围根 observation 的首次 `db.flush()`：

```text
root INSERT/flush
  ├─ exact pair -> root rollback -> GEO_OBSERVATION_HAS_SUCCESSOR
  └─ anything else -> raise original IntegrityError

add publication relations
add attachment relations
commit
  └─ any failure -> unknown/request-owner rollback
```

classifier 不拥有 rollback、HTTP 或通用事务策略。exact path 不查询 winner：index 已精确证明同一
`supersedes_id` 已有 committed/in-flight winner，业务批准的结果只是 blocker，不是 replay。rollback 必须先发生，
错误对象构造只能使用冻结常量，不能读取 expired ORM state。

## 3. PostgreSQL catalog 与 diagnostics gate

实施 preflight 在由真实 Alembic head 建立的临时 PostgreSQL 16 数据库中查询：

- `pg_index`：`indisunique`、`indimmediate`、`indisvalid`、`indisready`、`indnkeyatts/indnatts`、
  `indexprs`、`indpred`；
- `pg_class/pg_namespace/pg_am`：schema、table、index 与 access method；
- `pg_attribute + indkey ordinality`：唯一 key 精确为 `supersedes_id`；
- `pg_get_indexdef` 与 `pg_get_expr(indpred, indrelid)`：完整定义与 predicate；
- `LEFT JOIN pg_constraint ON conindid=indexrelid`：目标独立 index 无 constraint row。

“non-deferrable”不能以空 `condeferrable` 冒充：独立 index 没有 constraint row，应以
`indimmediate=true` 与独立 index 结构共同证明。随后用合法 committed predecessor 和两个真实 successor INSERT
取得 psycopg `IntegrityError.orig.sqlstate/diag.constraint_name`；只有 exact pair 才允许继续实现。

本轮规划不写数据库，故只确认了 migration/ORM/service 结构，没有把 runtime catalog 或 diagnostics 记为已通过。

## 4. 并发证据模型

### 4.1 合规 production lock 路径

两个独立 Session 执行相同 correction payload，分别记录 `pg_backend_pid()`。winner 在 root INSERT 后、commit 前
通过有界 Event 暂停；loser 按原生产路径进入。第三条 fresh/autocommit 监测连接必须证明：

- loser `wait_event_type='Lock'`；
- `pg_blocking_pids(loser_pid)` 包含 winner PID；
- 当前语句是 Product、PublishedArticle 或 previous 的 `SELECT ... FOR UPDATE`；
- loser 尚未发送 `INSERT INTO geo_observations`。

winner commit 后，loser 获取锁并由 successor precheck 返回目标 409。该用例证明 production serialization 与
precheck，不触发也不声称触发 unique violation。

### 4.2 Test-only 真实 unique race

仅对两个测试 Session 安装 connection/session-local SQLAlchemy hooks，精确旁路为到达最终 index 所必需的
`FOR UPDATE` 与 successor precheck；生产函数签名、业务资格检查、index、FK、CHECK、trigger、root INSERT、
relations 和 commit 不变。使用完整合法 Topic 和 current-head constraints，不复用现有历史空 Topic fixture 的
临时 DROP CONSTRAINT 手法。

winner 在 root INSERT 已执行但未 commit 时暂停；loser 发出真实 root INSERT。监测连接必须同时观察：

- loser SQL 是 `INSERT INTO geo_observations`；
- `wait_event_type='Lock'`、transaction-id/unique 仲裁等待；
- blocker PID 含 winner；必要时以 `pg_locks` 的未授予/已授予 transactionid lock 补证。

释放 winner 后，winner commit，loser 收到真实 target exact pair，由 mapper root rollback 后返回目标错误。
所有 hooks、Events、futures、statement timeout 与监测 deadline 在 `finally` 有界清理；不使用 sleep 或 future
状态猜测。

## 5. Session 与 HTTP 证据

- known direct-service exact loser：捕获 AppError 后，测试不得先 rollback；立即用同一 Session 查询 actor、
  predecessor 和唯一 successor，再完成一个健康命令，证明 mapper 已恢复 failed transaction。
- unknown direct-service：使用真实非目标 PostgreSQL 完整性失败；捕获原 `IntegrityError`，由 caller 显式
  rollback，再用同一 Session 查询并完成健康命令。
- precheck HTTP：先提交 successor，再经真实 route 发 correction POST。
- exact HTTP：使用 request dependency 的 test Session 和仅该连接可见的 test-only race hook，使 loser request
  走真实 target 23505；断言与 precheck 完全相同的四字段 envelope 和 request ID。
- unknown HTTP：通过 isolated test DB 的非目标真实 constraint/trigger 失败与
  `raise_server_exceptions=False` 证明 500 no-leak；不对 body/media type/稳定 code 作断言。

## 6. 原子性快照

测试在独立 verify Session 中按稳定 ID 比较，而不只看全表 count：

- predecessor/祖先所有字段及原 publication/attachment facts 不变；
- 唯一 winner successor 的 `supersedes_id`、完整 article result 集合和本次 attachment 集合正确；
- loser 专用已验证文件仍存在、未被关联，status/cleanup metadata 不变；
- 无第二 observation、孤立 publication/attachment/citation relation；
- ContentTask、GEO source、ContentVersion、ReviewRecord、generation job、PublicationWork/Article/Issue、
  publication event/verification/attachment 与 AuditLog 快照无 loser 增量；
- create command 的 SUCCESS AuditLog 增量为零；不为本 Task 新增审计。

## 7. 合同与 release 边界

| owner | T5-I5 action |
|---|---|
| `contracts/openapi.yaml` | 零差异；operation 已有 409，code 为 string。 |
| router/runtime/generated | 零差异；request-ID 与 status metadata 不感知新 code。 |
| `contracts/database.md` | 记录 partial index、exact mapping、unknown 与事务/并发权威。 |
| backend specs | 记录 command-local classifier、catch scope、rollback、Session reuse 和测试证据。 |
| Frontend V2 05/08 + frontend specs | 冻结 successor stale recovery 与 T6 owner。 |
| frontend production/tests | 零差异；optional test 仅兼容探针。 |

T5-I5 完成不授权单独部署 server code。T5-G 完成后由 T6 把新 code 加入 correction page 的 stale 集合；T6 前
前端仍只识别 `GEO_PUBLICATIONS_CHANGED/REVISION_CONFLICT`，因此 release 必须保持原子 gate。

## 8. Current-head migration caveat

`0029` 曾为 GEO 四张表安装 transaction-variable DELETE guard；`0037` 已把这四张表的 append-only trigger 改为
`BEFORE UPDATE`，并调整 PublishedArticle FK lifecycle。T5-I5 只验证 correction INSERT/immutable relation，不能把
历史 migration 的 DELETE guard 当作 current-head 事实，也不得借本 Task修复 deletion spec 漂移；任何删除逻辑
发现交给独立 owner。

## 9. Rollback boundary

规划阶段只允许当前 Task artifacts 与父 task child/notes bookkeeping。实施获批后，只撤销本 Task
implementation allowlist 中可识别的 candidate diff；不得回退 T1、T5-I1..I4、T5-C、其他任务或用户现有
dirty/staged 文件。catalog、diagnostics、锁证据或 schema 不符时保留 unknown 行为并停止，不增加兼容 alias。
