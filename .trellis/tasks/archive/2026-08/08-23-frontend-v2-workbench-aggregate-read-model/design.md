# Workbench Aggregate Read Model — Design

## 1. Owner 与数据流

```text
GET /api/v1/workbench
  → routers/workbench.py
  → services/workbench.py
  → existing Product/Content/Publication/GEO models + stable pure predicates
  → PostgreSQL
  → schemas/workbench.py WorkbenchAggregate
```

router 只注入 `DbSession`/`CurrentUser`；service 拥有聚合口径、时间 window、排序与 href；schema 拥有严格输出 shape。旧 Observation router/schema 不被扩写。

新 router 复用现有 Product/GEO 聚合读取模式，以 route dependency 在认证查询前为同一 DbSession 设置 `REPEATABLE READ`；不新增事务 abstraction。

## 2. 合同

### 2.1 Schema

- `WorkbenchLink { label, href }`
- `WorkbenchCount { value, href }`
- `WorkbenchMultiLinkCount { value, links }`
- `WorkbenchActionableCounts` 六个 required 字段
- `WorkbenchHealthStatus = CLEAR|ATTENTION`
- `WorkbenchWorkflowHealthItem { status, summary }`
- `WorkbenchWorkflowHealth` 四个 required 字段
- `WorkbenchRate { numerator, denominator, value|null }`
- `WorkbenchWindow { date_from, date_to }`
- `WorkbenchGeoSummary { window, discovery_rate, mention_rate, accuracy_rate }`
- `WorkbenchAttentionCategory` 六类 typed token
- `WorkbenchAttentionItem { category, resource_id, title, summary, occurred_at, href }`
- `WorkbenchAggregate { generated_at, actionable_counts, workflow_health, geo_summary, recent_attention_items }`

Pydantic validators 保证：rate 分子不大于分母，分母为零时 value 必须为 null，links 非空，attention 最多 10 条且顺序稳定。只验证 response 自身 invariant，不复制数据库业务状态机。

### 2.2 时间

service 入口只调用一次 `datetime.now(UTC)`；`date_to=generated_at.date()`，`date_from=date_to-29 days`。所有 GEO query 使用 `[date_from 00:00 UTC, date_to+1 day 00:00 UTC)`。

### 2.3 Count 与 health

- Fact/Pub verification/Issue 使用明确 current status count；Content 只统计
  `ContentTask.current_content_version_id` 指向的 `PENDING_REVIEW`，与 canonical list owner 一致。
- Publication action 是三个可操作状态 count 之和；links 分列三种 canonical filter。
- GEO issue 统计符合时间 window 的 current observation tail：legacy row 为 `PARTIAL/INCORRECT`；manual observation 只要至少一个 article result 为两者之一即计一条 observation，避免逐篇重复扩大 count。
- health 完全由服务端对对应 count 是否为零投影：零为 `CLEAR`，非零为 `ATTENTION`。Publication 合并 verification/action/issue，GEO 使用 accuracy issue。

### 2.4 GEO rates

复用 current-tail、时间范围与现有 `GeoMetrics.article_*` 逐篇语义；WorkBench 三个 rate 只使用 manual article results，避免把 legacy observation 与 article result 混成同一分母：

- manual discovery/mention 分母为 article result 数；分子为 `True`。
- accuracy 分母排除 `null/UNJUDGEABLE`；分子为 `ACCURATE`。
- legacy 不进入 GEO summary rate，但仍可进入 `geo_accuracy_issues` count/recent attention。
- 无 manual article result 样本时返回 `value=null`。

若现有产品文档或服务明确要求不同的 legacy/manual合并口径，实施时停止并回到规划，不猜测。

### 2.5 Attention items

每类先以数据库查询取得最多 10 个候选及其必要 identity/title/time，再合并排序截断到 10。全部读取位于同一 `REPEATABLE READ` request/session；查询数固定为类别数加固定聚合查询，不随行数增长，禁止 item loop 内访问数据库。

item title/summary 只使用安全 metadata：产品 label、内容标题、平台/工作简述、issue kind、GEO query/platform；不返回正文、notes、prompt、external content 或 raw error。

Publication/Issue item href 复用现有 pure action projection决定 section；若 projection 不适合无完整 DTO 的批量路径，则 Workbench service 对已验证 status 使用局部穷尽映射，不创建跨域通用 registry。

## 3. 兼容与文件范围

预计修改：

- `backend/app/main.py`
- `backend/app/routers/workbench.py`
- `backend/app/schemas/workbench.py`
- `backend/app/services/workbench.py`
- `backend/tests/integration/test_workbench.py`
- `contracts/openapi.yaml`
- `frontend/src/shared/api/schema.d.ts`
- `frontend-v2/src/shared/api/generated/schema.d.ts`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/09-architecture-decisions.md`（ADR-046）
- 当前 Task artifacts

不修改旧 endpoint/schema/V1 Dashboard、数据库、任何 V2 route/domain/UI/E2E。

## 4. 回滚

本变更 additive 且无 migration。回滚删除 Workbench router/service/schema/test、main 注册和 OpenAPI/generated/doc 条目即可；旧 V1 runtime 无依赖。只反向应用本 Task 确切 hunks。
