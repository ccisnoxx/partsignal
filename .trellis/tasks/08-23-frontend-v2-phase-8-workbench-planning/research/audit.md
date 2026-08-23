# Phase 8 Workbench 现状审计

## 1. 审计范围

- 权威需求：`docs/frontend-v2/02`、`03`、`05`、`06`、`07` Phase 8、`08`、`09` ADR-015/016/017/020。
- API/backend：`contracts/openapi.yaml`、`backend/app/routers/observation.py`、`backend/app/schemas/geo_files.py`、Product/Content/Publication/GEO models/services/queries。
- Frontend V2：`routes/_app/index.tsx`、App Shell/navigation、相关 domain list/search/deep link、Design System/shared、generated API types。
- V1 参照：`frontend/src/features/dashboard/DashboardPage.tsx` 及其测试；只审计，不修改。
- 测试：Foundation strict fixture、业务 strict fixtures、四个相关 real-stack specs、`deploy/scripts/e2e-local.sh`。

## 2. 权威需求证据

- `03-page-and-workflow-blueprint.md:15-41`：`/` 是 Operations Inbox / Workspace；每项待办直接进入具体 Workspace；禁止快捷入口宫格。
- `05-business-actions-state-and-api-contract.md:261-265`：首页必须使用专用 aggregate read model，返回六类计数、workflow health、GEO summary、recent attention items；禁止浏览器拼装分页列表。
- `07-migration-plan.md:500-506`：Workbench 最后实现；Phase 8 Exit 要求 API 独立、不复制 domain state machine、所有待办可操作、首页不以 vanity metrics 为核心。
- `09-architecture-decisions.md:73-85`：Read Model 优先、Domain Vertical Slice、Workbench 最后实现。

## 3. 当前实现证据

### A01 — V2 `/` 仍是占位页

- `frontend-v2/src/routes/_app/index.tsx` 只有 `navId/breadcrumb` 和静态标题/说明，没有 domain、query 或业务 API。
- `frontend-v2/src/app/navigation.ts` 已把 Workbench canonical route 固定为 `/`；App Shell/auth boundary 已就绪，无需新增壳层或导航系统。

结论：Phase 8 只需替换 route component 并增加一个本地 Workbench domain，不需要新 route pattern。

### A02 — 旧 Dashboard API 不满足 Phase 8

- `contracts/openapi.yaml:3178-3187,7833-7842` 只有 `DashboardSummary` 五个整数。
- `backend/app/routers/observation.py:394-437` 在 Observation router 内逐项查询 pending fact/content、所有 nonterminal publication、open issue 和近 30 日 legacy GEO accuracy error。
- `backend/app/schemas/geo_files.py:577-582` 把 `DashboardSummary` 放在 GEO schema owner。
- 无 backend test 直接冻结该 endpoint 的聚合语义。

缺口：没有 publication verification/action 分离、workflow health、人工 GEO 链尾口径、nullable rate、recent item 身份与 deep link，也没有独立 Workbench owner。`pending_publications` 混合多个工作阶段，`recent_accuracy_errors` 忽略人工逐篇准确性。

结论：不扩写错误 owner；新增 V2 专用 `/api/v1/workbench`，旧 endpoint 原样保留给 V1 到 Phase 9。

### A03 — V1 Dashboard 是反例，不是复用目标

- `frontend/src/features/dashboard/DashboardPage.tsx` 并发请求 `/dashboard/summary` 和 `/geo-metrics` 后在浏览器 join。
- V1 根据 count 布尔值推导 health，使用旧路由，并展示 Sidebar 已覆盖的快捷入口宫格。

结论：V1 行为与 Phase 8 目标冲突，但仍是 Phase 9 前的受保护旧实现；本阶段不修改、搬运或抽象它。

### A04 — canonical deep link 已存在

| 类别 | count/filter 入口 | item 入口 |
| --- | --- | --- |
| Fact Review | `/products?page=1&factStatus=PENDING_REVIEW&workflowStage=FACT_REVIEW_PENDING` | `/products/{product_id}/facts/review` |
| Content Review | `/content/tasks?workflowStage=REVIEW_PENDING&archiveStatus=ACTIVE&page=1&pageSize=20` | `/content/tasks/{task_id}/review` |
| Publication Verification | `/publishing/work?status=AWAITING_VERIFICATION&page=1&pageSize=20` | `/publishing/work/{work_id}#verification` |
| Publication Action | 对应 `PREPARING`、`PLATFORM_REVIEW` 或 `ACTION_REQUIRED` 的 canonical list URL | `/publishing/work/{work_id}` 的服务端主任务 section |
| Content Issue | `/publishing/issues?status=OPEN&page=1&pageSize=20` | `/publishing/issues/{issue_id}#issue` 或服务端投影的修复入口 |
| GEO Accuracy | `/geo/observations?accuracy=PARTIAL&page=1&pageSize=20` / `INCORRECT` | `/geo/observations/{observation_id}` |

Product、Content、Publication、GEO 的 search schema 已分别拥有 canonical URL。Workbench 不应导入这些 model/action registries 再拼链接；backend aggregate 应返回已校验的 `href`，Workbench 前端只校验允许的站内路径并渲染链接。

### A05 — GEO 当前态与 rate owner 可复用

- `backend/app/services/geo_observation.py:_current_observation_clause` 是 legacy/manual correction chain tail 的共享谓词。
- `geo_observation_list_query` 已统一 legacy row accuracy 与 manual `GeoObservationPublication.accuracy` 筛选。
- `_accuracy_list_indicator` / `get_geo_metrics` 已明确 `ACCURATE` 分子、排除 `null/UNJUDGEABLE` 的可判断分母与 nullable rate。

结论：Workbench service 应复用这些已验证谓词/口径，不能重写一套“最新观测”或把无分母率填成零。为保持首页“近期”语义，规划固定返回服务端计算的最近 30 个 UTC 自然日 window。

### A06 — Design System 没有 Workbench 级抽象

- 当前可复用资源是 Button、Badge、Skeleton 等 primitive、语义 token 和现有响应式 App Shell。
- V2 没有 PageHeader、MetricTile、Dashboard、AttentionQueue 等共享组件。

结论：在 `domains/workbench` 内直接组合语义 HTML、primitive 和 Tailwind utility。一个页面不证明新的共享抽象；不得从 V1 复制 Ant Design 组件或预建 Workbench framework。

### A07 — Foundation fixture 与 Workbench API 会发生 owner 冲突

- `foundation-smoke.spec.ts` 当前访问 `/` 并断言 Workbench 占位标题。
- `fixtures/foundation.fixture.ts` 只允许 auth/me 与 auth/csrf，任何业务 API 都失败；这是正确的 App Shell-only 边界。

结论：Foundation smoke 改到一个不请求业务 API 的受保护壳层 route，只断言 App Shell/导航/重载；Workbench 另建 generated-type strict fixture，禁止把业务 API 放宽进 Foundation。

### A08 — real-stack 已有唯一业务编排 owner

- `product-facts-real-stack.spec.ts` 已产生 pending fact review。
- `content-review-real-stack.spec.ts` 已覆盖内容提交/审核。
- `publication-workspace-real-stack.spec.ts` 已覆盖 verification failure、ACTION_REQUIRED、PublishedContentIssue。
- `geo-real-stack.spec.ts` 已通过 V2 UI 建立 manual observation。
- `deploy/scripts/e2e-local.sh` 已拥有 PostgreSQL/FastAPI/V2 production preview、secret scan 与 cleanup 生命周期。

结论：Phase 8 E2E 不创建 `workbench-real-stack.spec.ts` 后重复四条 mutation workflow，而是在这些现有流程的自然状态检查点访问 `/`，验证相应 count/item/href 与服务端最终状态。

## 4. Finding 分类与 owner

| ID | 级别 | Finding | 归类 | Owner / 处理 |
| --- | --- | --- | --- | --- |
| F01 | P1 scope | 旧 Dashboard API 无法正确表达 Phase 8 | Confirmed gap requiring planned change | aggregate child 新建独立 owner；不改旧 endpoint |
| F02 | P1 scope | V2 `/` 尚无产品实现 | Confirmed gap requiring planned change | UI child 替换占位页 |
| F03 | P1 scope | Foundation smoke 当前占用 `/` | Simplify locally | UI child 迁移壳层断言，新增 Workbench fixture |
| F04 | P1 scope | Workbench 跨四域的 real-stack 证据尚不存在 | Promote only through existing owners | E2E child 扩展四个既有 workflow spec，不建第二编排 |
| F05 | Keep | domain 状态、动作、revision、chain tail 已有权威 owner | Keep in domain/backend services | aggregate 只复用，不复制 |
| F06 | Keep | Button/Badge/Skeleton、semantic tokens、App Shell 可复用 | Keep in Design System/shared | UI 直接组合 |
| F07 | Deferred | 个性化、实时刷新、通知、复杂严重度排序没有已批准需求 | Deferred product/UX decision | 不进入 Phase 8 MVP |
| F08 | P2 historical | 旧 Dashboard endpoint 缺直接 backend test 且 owner 不理想 | Phase 9 legacy debt | 本阶段不为即将淘汰的旧 endpoint 补框架/重构 |

## 5. P0/P1/P2 与 blocker 结论

- 当前独立 blocker：无。
- P0：0。
- Phase 8 必交付 P1 scope：F01–F04，已分别映射到前三个子 Task。
- 非阻塞 P2：F08，仅随 V1 在 Phase 9 删除；不影响新 V2 独立 read model。
- 不需要数据库 migration、权限合同修改、旧 frontend 修改或先行 framework Task。
