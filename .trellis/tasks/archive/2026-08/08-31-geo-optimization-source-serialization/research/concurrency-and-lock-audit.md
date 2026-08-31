# GEO optimization source 并发与锁审计

## 结论

当前 stale basis 的根因已经确认：`create_geo_optimization_content_task` 在默认 `READ COMMITTED` 下先执行多条 GEO source 查询并构造 basis，之后才通过 `create_content_task` 进入 `PlatformProfile → Product → FactVersion` 行锁域。人工 GEO 观测新建、更正和删除都先锁 Product，因此 Product 是现有来源集合的权威串行化 owner；按 Idempotency-Key 的 advisory lock只保护同 key，不能替代该 owner。

任务与来源的写入已在同一事务内，数据库结构足以保存 typed JSONB basis，不需要迁移。本 Task 的最小方向是复用并冻结现有三资源锁序，把复算移入 Product 锁持有期。

## 关键证据

- GET 的唯一读模型：`backend/app/services/geo_observation.py:2085-2194`。
- source 行、完整范围与规则 owner：同文件 `:1354-1502`、`:1629-1858`。
- 优化命令先复算：同文件 `:2230-2281`；后锁资源：`:2300-2311`。
- 普通创建锁序：`backend/app/services/content_planning.py:371-385`。
- 人工观测创建先锁 Product：`backend/app/services/geo_observation.py:2370-2379`；删除更正链也先锁 Product：`:2470-2546`。
- engine/session 未指定更高隔离：`backend/app/db.py:27-40`；只有 GET Router 使用 `REPEATABLE READ`，`backend/app/routers/observation.py:85-87,352-364`。
- task flush、source add、外层一次 commit：`backend/app/services/content_planning.py:386-399`、`backend/app/services/geo_observation.py:2312-2325`。
- 来源模型和 JSONB 约束：`backend/app/models/content.py:171-210`、`backend/alembic/versions/0035_business_workflow_primary_tasks.py:200-255`。
- 现有同 key PostgreSQL 并发只覆盖唯一聚合，不覆盖 source 变更交错：`backend/tests/integration/test_geo_insights.py:116-182`。

## 精确竞态

```text
B: Product FOR UPDATE
B: 写入未提交的新观测/更正/删除链
A: advisory lock(idempotency key)
A: READ COMMITTED 读取旧 GEO 链尾并构造旧 basis
B: COMMIT
A: PlatformProfile → Product → FactVersion FOR UPDATE
A: 不再复算，INSERT task/source，COMMIT 旧 basis
```

Product 行锁提前到来源读取前后，该时序只能线性化为：B 先提交，则 A 等待并按新状态复算；A 先取得 Product，则 B 等待，A 按锁获得时的状态提交。两者均不会产生“在锁前读旧状态、锁后提交旧 basis”。

## ORM 新鲜度

当前 `get_geo_insights` 会加载 Product，优化命令也会在最终锁之前 `db.get(FactVersion)`；后续 `with_for_update()` 默认不保证覆盖 identity map 中已有实例属性。项目已有 `execution_options(populate_existing=True)` 先例。目标设计必须让三资源锁发生在这些读取之前，并由锁 owner 强制使用锁后数据库值。

## 幂等、审计与失败

- GEO 命令先取得 `content-task-create:{idempotency_key}` advisory transaction lock。
- exact replay 比较三个 target 和六个 source 字段；相同直接返回历史，不比较服务端 basis；任一不同在复算前 `IDEMPOTENCY_CONFLICT`。
- 当前优化创建与普通 task 创建均不调用 `append_audit`。成功、replay、stale、invalid、conflict 的既有预期都是不新增 AuditLog。
- task 在 source 之前 flush，但外层只 commit 一次；正常 Router Session 会在异常时 rollback，因此 source 写入失败不应留下孤立 task。

## 合同结论

`contracts/openapi.yaml` 已表达请求、201 ContentTask、401/403/409/422 和 typed GEO source/basis；`contracts/database.md` 已表达同事务 source snapshot 与既有锁序。审计没有发现本修复需要新增 API 字段、generated client、数据库列、约束或迁移。权限仍由 Router 的 ADMIN/ENGINEER、CSRF 和会话依赖控制。

## 不纳入本 Task 的发现

1. 普通 endpoint 只比较三 target，GEO endpoint 比较完整 source+target，跨 endpoint 使用同 key 的 replay 语义不对称。
2. 最终 head 的 `content_task_geo_sources` trigger只禁止 UPDATE，未禁止任意 DELETE；修复会需要数据库合同和迁移。
3. QueryTopic 更新不共享 Product 锁；用户已将 query-topic 后续问题排除。
4. repair task 不是本调用链，当前没有锁 Product；本 Task 不宣称统一所有 ContentTask 创建路径。

这些发现不影响 stale basis 根因和最小方案，但不能在本 Task 中顺手修复。
