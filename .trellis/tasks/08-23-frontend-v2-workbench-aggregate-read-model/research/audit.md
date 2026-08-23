# Workbench Aggregate Read Model 实施审计

## 1. 当前缺口

- `GET /api/v1/dashboard/summary` 位于 `backend/app/routers/observation.py`，`DashboardSummary` 位于 `schemas/geo_files.py`，只返回五个整数。
- 旧 endpoint 把所有 nonterminal publication 合为一类，仅统计 30 日 legacy GEO `PARTIAL/INCORRECT`，没有 manual chain tail、rate、health、attention identity 或 href。
- V1 Dashboard 同时请求 summary 和 geo metrics 后浏览器拼装；这是 Phase 8 明确禁止的模式。
- V2 generated types 已包含旧 endpoint，但 V2 `/` 尚未使用任何业务 API。

## 2. 可复用的权威事实

- Fact：`FactVersion.status=PENDING_REVIEW`；目标由 `product_id` 进入 `/products/{id}/facts/review`。
- Content：canonical list 只按 `ContentTask.current_content_version_id` 投影流程；Workbench
  同样只统计该当前版本的 `PENDING_REVIEW`，通过所属 `ContentTask.id` 进入 review Workspace。
- Publication：`PublicationWork.status` 与 `publication_work_actions(...)` 已拥有 primary task/section 规则；`AWAITING_VERIFICATION` 单列，`PREPARING|PLATFORM_REVIEW|ACTION_REQUIRED` 归 publication actions。
- Issue：`PublishedContentIssue.status=OPEN` 与 `published_content_issue_actions(...)` 已拥有 direct owner。
- GEO：`_current_observation_clause()` 是 legacy/manual correction tail 的共享谓词；manual accuracy 位于 `GeoObservationPublication.accuracy`；现有 metrics 排除 `null/UNJUDGEABLE` 分母。

## 3. Canonical links

- Fact count：`/products?page=1&factStatus=PENDING_REVIEW&workflowStage=FACT_REVIEW_PENDING`
- Content count：`/content/tasks?workflowStage=REVIEW_PENDING&archiveStatus=ACTIVE&page=1&pageSize=20`
- Publication verification：`/publishing/work?status=AWAITING_VERIFICATION&page=1&pageSize=20`
- Publication actions：分别使用 `PREPARING`、`PLATFORM_REVIEW`、`ACTION_REQUIRED` 的既有 list URL。
- Content issues：`/publishing/issues?status=OPEN&page=1&pageSize=20`
- GEO accuracy：分别使用 `accuracy=PARTIAL`、`accuracy=INCORRECT`，并保留 `page=1&pageSize=20`。

Item link 直接使用真实资源 ID 进入现有 Workspace/Detail；backend 返回 href，后续 Workbench frontend 不导入其他 domain registry 重建链接。

## 4. 边界结论

- 新建 `schemas/workbench.py`、`services/workbench.py`、`routers/workbench.py` 是最小稳定 owner；不扩写 Observation/GEO owner。
- 旧 Dashboard 保持原样是 Phase 9 前的有界兼容，不是第二个 V2 owner。
- 不需要新表、migration、缓存或通用聚合 framework。
- integration test 应验证固定 query count而非追求单 SQL；同一 request/session 和冻结 `generated_at` 足以消除浏览器 waterfall 与 per-item N+1。
