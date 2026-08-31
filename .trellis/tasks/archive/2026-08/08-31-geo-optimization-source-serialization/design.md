# GEO 优化来源串行化设计

## 1. 设计结论

采用既有行锁协议，不新增隔离层或第二套锁：把内容任务创建服务中现有的目标资源锁定与资格校验提取为唯一内部 owner；普通创建照常调用它，GEO optimization 在幂等 replay miss 后先调用它，再在 Product 锁内复用现有 GEO Insights owner 完成来源读取、复算、typed basis 构造和聚合持久化。

权威顺序冻结为：

```text
Idempotency advisory lock
  → exact replay / conflict comparison
  → PlatformProfile FOR UPDATE
  → Product FOR UPDATE
  → FactVersion FOR UPDATE
  → get_geo_insights（现有规则 owner）
  → source identity / typed basis validation
  → ContentTask flush
  → ContentTaskGeoSource add
  → one commit
```

不能只在 `geo_observation.py` 提前锁 Product。该做法会形成 `Product → PlatformProfile`，与普通创建的 `PlatformProfile → Product` 构成死锁反序。

## 2. 当前 owner 与根因证据

| 职责 | 当前 owner | 证据 | 结论 |
| --- | --- | --- | --- |
| GEO 事实行、链尾和完整范围 | `geo_observation._geo_insight_rows/_complete_geo_insight_scope` | `backend/app/services/geo_observation.py:1354-1502` | 保持唯一计算来源 |
| GEO 下降、长期未提及、覆盖缺口 | `_content_rankings/_question_coverage` | `backend/app/services/geo_observation.py:1629-1858` | 不复制规则 |
| 优化命令编排和 source/basis 写入 | `create_geo_optimization_content_task` | `backend/app/services/geo_observation.py:2197-2326` | 继续持有 GEO 聚合协调职责 |
| 普通任务目标锁序 | `create_content_task` | `backend/app/services/content_planning.py:345-400` | 当前顺序已是 Platform→Product→Fact |
| 活动平台锁 | `lock_active_platform` | `backend/app/services/platform_configuration.py:328-336` | 复用并确保锁后刷新 |
| 人工 GEO 来源变更串行化 | Product 行 | `create_geo_observation` 与删除链路径，`backend/app/services/geo_observation.py:2370-2582` | 优化复算必须先取得同一 Product 锁 |
| 事务 owner | 普通服务或 GEO 外层服务 | `content_planning.py:396-399`、`geo_observation.py:2300-2325` | GEO 的 task/source 继续一次提交 |

当前缺陷位于 `get_geo_insights` 和目标锁之间：命令在 `geo_observation.py:2230-2281` 已完成多语句来源读取和 basis 构造，直到 `:2300` 调用普通创建服务后才取得三类目标锁。按 key 的 advisory lock只串行化同 key 请求，不与人工观测命令共享锁域。

## 3. 目标内部边界

### 3.1 共享目标资源 owner

在 `backend/app/services/content_planning.py` 的普通创建命令附近建立一个窄的内部 owner，职责仅为：

1. 按 `PlatformProfile → Product → FactVersion` 查询并 `FOR UPDATE`。
2. 锁定查询使用 `populate_existing=True` 或等价的强制刷新语义，保证等待锁后不复用 identity map 旧属性。
3. 执行现有活动平台、活动产品、已批准且非空事实、事实属于产品的资格校验。
4. 返回已锁定的资源供同一事务内构造任务；不 flush、不 commit、不处理幂等 replay。

普通 `create_content_task` 保留现有 advisory lock 和三字段 replay 语义，在 replay miss 后调用该 owner，再通过一个只负责构造并 flush ContentTask 的窄内部函数完成原流程。GEO 命令也调用同一 owner和同一构造函数，不通过布尔参数、重复调用普通 command 或复制校验来声称“已经锁定”。

`lock_active_platform` 是现有平台锁 owner；若其查询需要补 `populate_existing=True`，只在该 owner 上做一处新鲜度修正，不在 GEO 服务另写平台查询。

### 3.2 GEO optimization 编排

`create_geo_optimization_content_task` 的目标顺序为：

1. 取得现有 `content-task-create:{idempotency_key}` advisory transaction lock。
2. 读取已有 ContentTask/source：完整 payload 相同则立即 replay；任一字段不同则立即 `IDEMPOTENCY_CONFLICT`。这两条路径不复算当前洞察，也不改写历史。
3. replay miss 后调用共享目标资源 owner，并保留返回的锁后对象。
4. 构造现有 `GeoInsightFilters`，在 Product 锁持有期间调用 `get_geo_insights`。
5. 通过现有分支选择候选并构造 `GeoContentDeclineBasis`、`GeoLongUnmentionedBasis` 或 `GeoQuestionCoverageGapBasis`；候选不再成立则 `GEO_INSIGHT_STALE`。
6. 执行现有发布成果、来源任务产品和冻结平台身份校验。FactVersion 不再通过提前的非锁定 `db.get` 判断，而使用共享 owner 返回的锁后事实。
7. 通过共享任务构造函数 flush ContentTask，添加 `ContentTaskGeoSource`，由 GEO 外层服务一次 commit。

### 3.3 为什么 `READ COMMITTED` 可以保留

本 Task 不把 POST 改成 `REPEATABLE READ`。目标不是让整个数据库在一次快照中静止，而是让会改变所选产品人工 GEO 来源的命令共享 Product 行锁。人工观测新建、更正和删除已经先锁 Product；优化命令先持有同一 Product 锁后，这些来源写事务不能在 GEO 多条查询之间提交。PlatformProfile、Product 和 FactVersion 的状态变更也分别被对应行锁串行化。

发布成果删除已有 FK 和删除守卫：删除先完成时，复算/来源校验失败；来源先提交时，删除被 retained source 阻断。QueryTopic 更新未共享 Product 锁，属于用户明确排除的后续问题，本 Task 不以额外锁或快照层扩大解决范围。

## 4. 行为与合同保持

- Router、角色门禁、CSRF、request/response schema、错误 envelope、HTTP 201/409/422 shape 不变。
- OpenAPI、generated client、ORM schema、迁移和数据库约束不变。
- basis 仍由 typed Pydantic model 的 `model_dump(mode="json")` 产生；不接受客户端 basis。
- 精确 replay 仍返回原任务和不可变 source，不因当前洞察变化重新验证或更新。
- 当前命令不写 AuditLog；实现不得引入成功或失败审计。
- 单一失效条件的现有错误码保持。若同一线性化点同时观察到目标资源失效和 GEO 异常失效，共享目标门禁先失败；不增加兼容错误映射或前端兜底。
- 成功新建仍是 ContentTask flush 后添加 source、最后一次 commit；任何后续 flush/commit 失败由请求 Session 边界 rollback 整个聚合。

## 5. 失败与无副作用

| 路径 | 写入前位置 | 预期结果 |
| --- | --- | --- |
| same-key 完整 payload 不同 | replay comparison | `IDEMPOTENCY_CONFLICT`；零新增 |
| 平台/产品/事实锁后失效 | shared target owner | 既有错误码；零新增 |
| 观测变更后异常消失 | lock 内 GEO recompute | `GEO_INSIGHT_STALE`；零新增 |
| 发布成果不存在或归属不符 | source validation | 既有 409/422；零新增 |
| ContentTask 已 flush、source INSERT/commit 失败 | 聚合提交 | 整个事务 rollback；无孤立任务/source |
| exact replay | replay comparison | 返回原任务；零新增、零 basis 改写 |

所有失败/冲突路径均不得新增 AuditLog。生产调用继续由 `get_db()` 在异常时 rollback；本 Task 不改变服务函数与请求 Session 的 transaction ownership。

## 6. 真实 PostgreSQL 并发回归设计

### 6.1 stale basis 决定性测试

在 `backend/tests/integration/test_geo_insights.py` 使用临时 PostgreSQL、两个独立 Session、`threading.Event` 和数据库锁观测，禁止用 sleep 猜时序：

1. Seed 一个当前确实存在的 `CONTENT_DECLINE` 异常，并记录命令前 ContentTask、source、AuditLog 基线。
2. 事务 B 先 `SELECT Product ... FOR UPDATE`，对当前周期的旧链尾写入能消除异常的更正链尾，flush 但不 commit，并暴露 B 的 backend PID。
3. 事务 A 在独立线程/Session 中记录 `pg_backend_pid()` 后调用真实 `create_geo_optimization_content_task`。
4. 观察 Session 通过 `pg_blocking_pids(A_pid)` 确认 A 的 blocker 正是 B；只有确认数据库锁等待后才允许 B commit。
5. B commit 后，A 继续。目标实现此时才开始 GEO 来源读取，必须看到新链尾并返回 `GEO_INSIGHT_STALE`；测试线程显式 rollback 异常事务。
6. 断言命令 key 对应 ContentTask 为 0、source 为 0，AuditLog 与其他命令业务行相对基线不变。

该交错能区分修复前后：旧实现会在步骤 4 之前基于不可见的新链尾算出旧 basis，随后才在 Product 锁处等待，B commit 后仍会把旧 basis 落库；目标实现会在来源读取前等待，因而不可能落库旧 basis。

### 6.2 三类资源锁后新鲜度

用同样的两个 Session 与 `pg_blocking_pids` 模式，分别让 B 持有并提交：

- `PlatformProfile.is_active = false`；
- `Product.status` 进入非 ACTIVE；
- `FactVersion.status = RETIRED`。

A 必须在对应行锁等待，释放后读取提交值并按既有错误码失败；每个 case 均断言无 ContentTask、source、AuditLog。测试只在临时数据库内写入。

### 6.3 保持性回归

- 保留现有 same-key 双线程测试，证明仍恰好一条任务和一条 source。
- 单元测试记录 shared lock owner 与 `get_geo_insights` 的调用顺序，证明 replay miss 是“先锁、后复算”。
- 单元测试证明 exact replay 和 conflict 都不调用锁内复算，完整九字段比较不缩减。
- 故障注入 source flush/commit 失败，证明已 flush 的 ContentTask 会整体回滚。

## 7. 最小实现文件

预计实现只需触及：

- `backend/app/services/content_planning.py`：提取唯一目标资源锁/校验 owner 和锁后任务构造边界。
- `backend/app/services/geo_observation.py`：把共享锁 owner 移到复算前，并使用锁后资源完成创建。
- `backend/app/services/platform_configuration.py`：仅在现有平台锁查询需要强制刷新时补 `populate_existing=True`。
- `backend/tests/unit/test_geo_insights.py`：更新 fake/session 及锁前复算顺序、replay、无副作用回归。
- `backend/tests/integration/test_geo_insights.py`：新增真实 PostgreSQL stale basis 与资源新鲜度并发测试。
- `backend/tests/integration/test_content_task_creation.py`：仅补共享普通创建行为/锁序回归确有必要的最小断言。

不修改 Router、schema、model、migration、contract、frontend、generated client 或部署文件。

## 8. 已发现但不纳入本 Task

- 普通 ContentTask endpoint 只比较三项 target，可能重放由 GEO endpoint 创建的任务；GEO endpoint 则要求 source 存在，跨 endpoint 语义不对称。
- head schema 的 `content_task_geo_sources` 最终触发器只拦截 UPDATE，不拦截任意 DELETE；修复需要数据库合同/迁移任务。
- QueryTopic 更新未进入 Product 锁域，属于用户明确排除的 query-topic 后续问题。
- repair ContentTask 不是本调用链，不能据此宣称所有 ContentTask 创建都已统一三资源锁序。

这些发现只在审计记录中保留，不添加兼容层，也不扩大本 Task 验收。
