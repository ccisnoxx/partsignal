# Frontend V2 Workbench Aggregate Read Model

## 1. 目标

新增 V2 独立 `GET /api/v1/workbench`，在服务端一次请求内投影 Workbench 所需的 actionable counts、workflow health、30 日 GEO summary、recent attention items 和 canonical href。本 Task 只交付合同与 backend read model，不实现 `/` UI 或 real-stack Workbench 断言。

## 2. 前置依赖

- 父规划 `frontend-v2-phase-8-workbench-planning` 已获用户批准并提交为 `ed713940`。
- Phase 7 Exit Gate 已为 `MET`。
- 本 Task 必须先于 `frontend-v2-workbench-ui`、`frontend-v2-workbench-e2e` 与 Phase 8 abstraction review 完成。

## 3. Requirements

1. 新 endpoint 使用现有 `CurrentUser`，ADMIN/ENGINEER 都可读；服务端是资格、当前版本、状态与链尾的最终 owner。
2. 响应包含六类固定 actionable count：`fact_reviews`、`content_reviews`、`publication_verifications`、`publication_actions`、`content_issues`、`geo_accuracy_issues`。
3. 单状态类别返回一个 canonical filter link；`publication_actions` 和 `geo_accuracy_issues` 返回多个现有 canonical filter link，不扩展下游 list search contract。
4. workflow health 只对 Product Fact、Content、Publication、GEO 返回 `CLEAR|ATTENTION` 和服务端 summary，不创建新业务状态机或严重度阈值。
5. GEO summary 使用请求开始时冻结的最近 30 个 UTC 自然日 window，只统计 current correction-chain tail；rate 返回 numerator、denominator、`value|null`，分母为零时不得填 `0`。
6. recent attention items 最多 10 条，按 `occurred_at DESC, category ASC, resource_id ASC` 稳定排序；每条有安全摘要、稳定资源 ID 和直接 Workspace/Detail href。
7. 查询次数固定且不随 recent item 数量增长；禁止 per-item query、内部 HTTP join、Redis 或应用缓存。
8. 响应不得包含正文、prompt、secret、token、Cookie、CSRF、request header/body、审计 raw details 或外部页面内容。
9. 保留 V1 `frontend/`、旧 `/api/v1/dashboard/summary` 和 `DashboardSummary` 原样到 Phase 9。
10. 更新 OpenAPI、V1/V2 generated types、Frontend V2 05 合同文档和 ADR-046；不修改 database contract。

## 4. Out of scope

- `/` Workbench route/page、Design System、strict fixture 或 real-stack E2E。
- Workbench mutation、客户端 cache invalidation、轮询、通知、排序配置或个性化。
- 数据库 migration、权限合同、既有业务状态机、公共 mutation API 或 V1 页面修改。
- 通用 Dashboard/Workflow/Action/ReadModel framework，兼容 alias 或一个 consumer 的抽象层。

若正确实现要求改变上述范围，停止并报告，不在本 Task 扩围。

## 5. Acceptance Criteria

- [x] `GET /api/v1/workbench`、schema、router、service 与 `app.main` 注册形成独立 backend owner。
- [x] 六类 count/link、四域 health、30 日 current-tail GEO rates 和 top-10 attention 口径由 PostgreSQL integration 冻结。
- [x] ADMIN/ENGINEER 都可读；anonymous 继续使用统一 401 合同，响应无敏感字段。
- [x] empty/partial/full、时间边界、manual/legacy tail、`UNJUDGEABLE/null`、稳定排序与固定 query count 均有直接测试。
- [x] `make contract-check`、定向 Ruff、backend mypy、定向 integration、V1/V2 `api:check` 全部通过。
- [x] V1 endpoint/schema/page/tests、数据库、旧 `frontend/` 产品代码和 Phase 8 UI/E2E 未修改。
- [x] 05、ADR-046、Task evidence 与实际合同一致；无新 framework、N+1、silent fallback 或第二来源。
