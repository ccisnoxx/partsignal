# 设计：事实版本审核历史精确归属

## 根因

写入和读取使用了不同 owner：

- 写入：`FactReviewRecord.fact_version_id = version.id`；对应 `AuditLog.target_type = "FactVersion"`、`target_id = version.id`。
- 读取：`_fact_history` 通过 `FactVersion.product_id == fact.product_id` 与 `FactVersion.version <= fact.version` 聚合同产品旧版本。
- 展示：`ProductFactsPage` 用选中版本 ID 请求 `review-context`，随后原样渲染 `review_history`。

因此问题不在前端缓存或共享审计查询，而在事实审核上下文的服务端读取边界。

## 权威关系

| 数据 | 权威 owner | 版本关系 |
| --- | --- | --- |
| 不可变事实快照 | `FactVersion.id` | 同产品以 `(product_id, version)` 唯一 |
| 事实审核命令记录 | `FactReviewRecord.fact_version_id` | 精确从属一个 `FactVersion` |
| 事实业务审计 | `AuditLog(target_type="FactVersion", target_id=FactVersion.id)` | 精确归属一个版本 |
| 事实审核上下文 | 路径 `fact_version_id` | 只装配该版本快照、动作和审核记录 |

`Product` 只拥有可编辑事实工作区及其工作区审计。仓库中没有产品级事实审核时间线投影，因此本缺陷不新增或伪装该能力。

## 数据流

```text
前端选中 FactVersion.id
  → GET /fact-versions/{id}/review-context
  → get_fact_review_context(db, id)
  → 读取 FactVersion(id)
  → 查询 FactReviewRecord.fact_version_id == id
  → FactReviewContext.review_history
  → FactReviewPanel 原样渲染
```

状态命令保持：

```text
FactVersion.id
  → FactReviewRecord.fact_version_id
  → AuditLog(target_type="FactVersion", target_id=FactVersion.id)
```

## 最小修复

只把 `_fact_history` 的查询条件改为 `FactReviewRecord.fact_version_id == fact.id`，保留现有排序、操作者联结和 `ReviewRecord` 响应结构。同步把服务、Router、OpenAPI 与架构文档中的“完整审核历史”明确为“当前目标版本自身的追加式审核历史”。

前端生产组件无需增加过滤逻辑：它已经按版本 ID 请求，并且应信任服务端契约。只增加回归测试，验证 V2 请求与展示不混入 V1。

## 调用方与兼容性

- `_fact_history` 只由 `get_fact_review_context` 调用。
- `get_fact_review_context` 只由事实版本 `review-context` Router 和测试调用。
- `_content_history` 是独立函数，继续按 `ContentVersion.task_id` 返回任务级累计历史。
- 全局 `list_audit_logs` 已按可选 `target_type`、`target_id` 精确过滤，不修改。
- `ReviewRecord`、`FactReviewContext` 字段不变，生成 TypeScript 类型只同步响应描述。

这是响应语义收窄，不是 Schema 形状变化。依赖旧累计行为的外部调用方将看到更少记录；当前仓库唯一前端调用方的交互语义明确是版本详情，因此该变化与页面意图一致。

## 数据与回滚

- 不执行迁移，不更新或删除 `fact_review_records`、`audit_logs`、`fact_versions`。
- 回滚只需恢复查询条件及对应文档；历史数据从未变化。
- 不增加 feature flag、兼容字段、产品级 fallback 或前端二次过滤。
