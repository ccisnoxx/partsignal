# DEF-02 当前数据流与根因证据

## 验收证据

- 报告：`acceptance-report.md` 的 DEF-02 记录 V2 详情混入 V1 历史。
- 截图：`E-fact-v2-history-leak.png` 中弹窗标题与事实版本 ID 指向 V2，但时间线事件标记为 V1。
- 目标产品：`d73c7434-0ce5-47b5-ac94-072936cc4279`。
- V1：`b90171fe-083e-4639-ba1a-c96b3554c301`；V2：`0c2a0b2e-275d-4d7f-92f9-dddc726599bc`。

## Owner 与写入

- `backend/app/models/product_facts.py:58-106`
  - `FactVersion.id` 是版本身份；
  - `(product_id, version)` 唯一；
  - `FactReviewRecord.fact_version_id` 非空外键精确指向一个版本。
- `backend/app/services/review.py:227-290`
  - 状态转换锁定路径指定的 `FactVersion.id`；
  - 追加 `FactReviewRecord(fact_version_id=version.id)`；
  - 追加 `AuditLog(target_type="FactVersion", target_id=version.id)`。
- `backend/app/services/product_facts.py:309-365`
  - 新版本审计同样使用 `target_type="FactVersion"` 与新版本 UUID。
- `backend/app/audit.py:139-157`
  - `AuditEntry.target_id` 原样字符串化写入 `audit_logs.target_id`。

结论：版本审核记录和事实版本业务审计的权威 owner 都是 `FactVersion.id`，不是 `Product.id`。

## 查询与响应

- `backend/app/services/review.py:72-98`
  - `_fact_history` 当前错误地按 `FactVersion.product_id == fact.product_id` 且 `FactVersion.version <= fact.version` 聚合同产品旧版本。
- `backend/app/services/review.py:157-166`
  - `get_fact_review_context` 读取目标版本后直接把该累计结果放入 `review_history`。
- `backend/app/routers/product_facts.py:273-282`
  - 路径参数是精确的 `fact_version_id`，Router 没有产品级时间线参数。
- `contracts/openapi.yaml:436-446,3331-3352`
  - 响应结构包含每条记录的 `target_id`、`target_version`，但描述只写“完整审核历史”，未明确 owner 范围。

## 前端展示

- `frontend/src/features/product-facts/ProductFactsPage.tsx:82-86`
  - React Query key 与请求路径都使用选中的事实版本 ID。
- `frontend/src/features/product-facts/ProductFactsPage.tsx:312-324`
  - `FactReviewPanel` 原样渲染 `context.review_history`，没有产品级拼接或前端过滤。

结论：前端请求目标正确；服务端响应已经混入 V1，前端只是忠实展示。

## 共享调用方检查

- `_fact_history` 只被 `get_fact_review_context` 调用。
- `get_fact_review_context` 只被事实版本审核 Router 与测试调用。
- `backend/app/services/review.py:101-127` 的 `_content_history` 是独立的内容任务级历史，不应随 DEF-02 修改。
- `backend/app/services/audit_logs.py:258-350` 已按可选 `target_type` 和 `target_id` 构造精确条件，不是本缺陷根因。
- 仓库中不存在产品级事实审核时间线 API 或分区组件。

## 既有测试缺口

- `backend/tests/integration/test_publication_review_closure.py:3198-3252` 只对单个新事实版本检查末尾四条历史，未构造同产品多版本各自有审核记录的场景，因此累计查询仍能通过。
- `frontend/src/features/product-facts/ProductFactsPage.test.tsx` 已覆盖事实版本列表和入口，但未 mock `review-context` 或验证 V1/V2 历史边界。

## 最小修复结论

把 `_fact_history` 的条件改为 `FactReviewRecord.fact_version_id == fact.id`，保留现有排序和响应结构。同步明确公开 API 的版本级语义并补后端、前端各一个针对性回归场景；不新增产品级时间线、迁移、fallback 或共享审计改动。
