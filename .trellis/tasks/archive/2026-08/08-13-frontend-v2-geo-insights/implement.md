# Frontend V2 GEO Insights — 实施计划

## 1. 执行前提与分支生命周期

- 用户已明确批准本 `prd.md/design.md/implement.md` 整体计划及 `PublicationWork.platform_profile_id_snapshot` 数据库迁移。实现已从当时最新且干净的 `main` 启动，并记录在临时分支 `codex/frontend-v2-geo-insights`。

- 临时分支只承载本 Task。验证完成后先给出 commit plan 并等待确认；不自动 push。提交、合并回 `main` 后删除本地分支，并只在确实存在同名远端分支时请求/执行清理。
- 若迁移预检发现 PublishedArticle 已失去实时 Platform UUID、实现需要新增 Print/Workbench/完整 GEO real-stack E2E、或必须改变未规划公共合同，立即停止并提交证据，不猜测数据或扩大范围。

## 2. 精确预计文件范围

### 2.1 契约、数据库与后端

- `contracts/openapi.yaml`
- `contracts/database.md`
- `backend/alembic/versions/0043_geo_insight_platform_identity.py`（新增，最终 revision 名以当前 head 复核为准）
- `backend/app/models/publication.py`
- `backend/app/schemas/geo_files.py`
- `backend/app/services/publication.py`
- `backend/app/services/geo_observation.py`
- `backend/app/routers/observation.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_geo_insights.py`
- `backend/tests/integration/test_geo_insights.py`（新增）
- `backend/tests/integration/test_migrations.py`

不新增 GEO service layer、repository、action framework 或第二套幂等 helper。Content Task creation-options 与 `create_content_task` 只复用，不计划修改其公开合同。

### 2.2 生成类型

- `frontend/src/shared/api/schema.d.ts`
- `frontend-v2/src/shared/api/generated/schema.d.ts`
- `frontend/src/features/geo-observations/GeoInsightsPage.test.tsx`（只补 required nullable generated 字段，旧 UI 不变）

### 2.3 Frontend V2 route、页面与 navigation

- `frontend-v2/src/app/navigation.ts`
- `frontend-v2/src/app/navigation.test.ts`
- `frontend-v2/src/domains/geo/geo.api.ts`
- `frontend-v2/src/domains/geo/geo.api.test.ts`
- `frontend-v2/src/domains/geo/geo-insights.model.ts`（新增）
- `frontend-v2/src/domains/geo/geo-insights.model.test.ts`（新增）
- `frontend-v2/src/domains/geo/geo-insights-page.tsx`（新增，含页面局部趋势与短 Dialog）
- `frontend-v2/src/domains/geo/geo-insights-page.test.tsx`（新增）
- `frontend-v2/src/routes/_app/geo/insights/route.tsx`（新增）
- `frontend-v2/src/routes/_app/geo/insights/index.tsx`（新增）
- `frontend-v2/src/routeTree.gen.ts`（生成）

### 2.4 唯一必要的 Observation handoff

- `frontend-v2/src/routes/_app/geo/observations/new.tsx`
- `frontend-v2/src/domains/geo/new-geo-observation.model.ts`
- `frontend-v2/src/domains/geo/new-geo-observation.model.test.ts`
- `frontend-v2/src/domains/geo/new-geo-observation-page.tsx`

Observation List 已支持 `queryTopicId/geoPlatform/from/to` 精确 URL/API 筛选，因此不计划修改它。

### 2.5 Strict production fixture E2E

- `frontend-v2/tests/e2e/fixtures/geo-insights.fixture.ts`（新增）
- `frontend-v2/tests/e2e/geo-insights.spec.ts`（新增）
- `frontend-v2/tests/e2e/fixtures/new-geo.fixture.ts`
- `frontend-v2/tests/e2e/new-geo-observation.spec.ts`
- `frontend-v2/tests/e2e/foundation-smoke.spec.ts`（仅更新新增 GEO navigation 入口断言，若现有断言需要）

### 2.6 权威文档与直接相关 specs

- `docs/frontend-v2/01-technical-architecture.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`
- `.trellis/spec/backend/available-actions-contract.md`
- `.trellis/spec/frontend/state-management.md`

### 2.7 明确不修改

- `frontend-v2/package.json` / lockfile：不增加 ECharts 或其它依赖。
- `docs/frontend-v2/02-information-architecture-and-routing.md`：现有 canonical route/URL ownership 已正确。
- `docs/frontend-v2/03-page-and-workflow-blueprint.md`：现有 6.6 页面区块已准确。
- `docs/frontend-v2/04-design-system-and-interaction-spec.md`：现有 Analytics/Filter/状态/响应式规则已准确。
- 旧 `frontend/` 业务 UI；只重新生成 schema 并 typecheck。
- `/geo/insights/print`、打印/PDF、Workbench、完整 GEO real-stack E2E、GEO 抽象回顾、通用 Chart/Analytics/workflow framework。
- 若实现证明某个预计文件无需改，直接省略；若需增加未列生产文件，先确认是满足已批准合同的最小 owner，不借机扩展。

## 3. 实施步骤

### Step 1：先更新 OpenAPI

1. 新增 `GeoInsightOptimizationAction`。
2. 给 Content Performance/Coverage item 增加 required nullable `optimization_action`，固定它与 `primary_task` 的一致性语义。
3. 收紧 `GeoOptimizationContentTaskCreate` source identity 描述，补 GET 401 与 POST 401/403。
4. 不改变现有 rate/ranking/recommendation/data-quality shape 和七个 GET filters。

完成条件：页面不需要依据 section/status/rule 推断命令；旧 V1 可继续忽略 additive 字段。

### Step 2：实现并验证平台身份 migration

1. 增加 PublicationWork 无外键 UUID snapshot，回填实时 ID。
2. 对无法回填的 PublishedArticle 明确中止；不按名称、审计或随机 UUID 修复。
3. 更新 ORM、PublicationWork create owner 与数据库 history guard。
4. migration test 覆盖正常回填、平台删除后 snapshot 保留、不可修改、无法回填 upgrade 失败和有历史依赖时 downgrade 拒绝。

完成条件：已发布且仍被 GEO 引用的关系不因实时平台删除丢失稳定 Content Platform identity。

### Step 3：修复 Insights read model owner

1. GET route 复用 `_geo_observation_read_snapshot`。
2. options/rows 改读 PublicationWork frozen ID/name；删除对可删除实时平台的必需内连接。
3. `get_geo_insights` 接收 actor，并直接投影异常 source；目标 Product/Platform/Fact 只在按需 creation-options 与写命令中校验。
4. Declining/Long/Coverage 由服务端生成 action source；无权限或无可执行 source 时保留精确查看/补样本 primary task。
5. 保持 correction-tail、完整性、三种分母、排行、Coverage、Recommendation 与 unavailable 阈值不变。

完成条件：一个 repeatable-read response 可完整绘页，动作与 actor/异常 source 一致，历史平台记录仍可筛选。

### Step 4：修复优化命令的最终复算与幂等

1. GEO command 在读取 existing task 前取得与普通 Content Task create 相同的 advisory transaction lock。
2. replay 同时比较 target Product/Platform/Fact 与 immutable GEO source；不同 payload 返回 `IDEMPOTENCY_CONFLICT`。
3. Coverage 复算加入 `product_id` 与 `content_platform_id=platform_profile_id`；Content anomaly 继续用 exact Article 并校验其 owner。
4. 相同 key 并发只创建一个 ContentTaskGeoSource；stale 仍返回 `GEO_INSIGHT_STALE`，不增加 fallback。

完成条件：服务端最终资格、source snapshot、target 与 idempotency 形成一个原子命令。

### Step 5：生成类型并验证兼容

1. 从同一 OpenAPI 重新生成 V1 与 V2 schema。
2. 再运行相同生成命令，确认 generated files 不再变化。
3. 检查没有 handwritten API DTO、cast、兼容别名或手改 generated file。

完成条件：OpenAPI 是唯一 API 类型 owner，V1 UI 未修改且 typecheck 通过。

### Step 6：实现 URL model、API 与 route

1. `geo-insights.model.ts` 只承载 search parse/canonical/API mapping、rate/period 文案、primary task 穷尽 resolve 和 POST body Zod 组合。
2. `geo.api.ts` 增加 `geoKeys.insights()`、GET query options、POST mutation 与 structured error；不复制 Content Task creation options。
3. 新 parent/index route 声明 navId/Breadcrumb、显式 UTC 30 日 canonical URL、prefetch 和 Router search history。
4. navigation 加“GEO 洞察”，route tree 由 TanStack plugin 生成。

完成条件：direct URL、refresh、Back、Forward、invalid primitive 与 reset 有 model/route 证据；七个 API 参数一一映射。

### Step 7：实现 Insights 页面与局部 SVG

1. 组合既有 FilterBar/Input/Select/Card/TableShell/Badge/状态 primitives。
2. 首次 loading、保留旧数据的 refresh error、empty/partial/unavailable/error/retry 分开呈现。
3. 三张 KPI/趋势卡不补零；局部 SVG `aria-hidden`，原生 details/table 提供逐日等价数据。
4. Platform、Content、Coverage、Recommendations、Data Quality 全部直接渲染 generated response；不重新排序、算阈值或造 Recommendation link。
5. primary task resolver 只生成设计中已验证的 canonical target；未知 token 显式失败。

完成条件：所有 section、空分母差异、无颜色依赖、键盘替代与四档布局由 unit/E2E 覆盖。

### Step 8：实现短 Optimization Dialog

1. 只在 non-null `optimization_action` 上打开 Dialog。
2. 复用 Content Task creation-options；用 RHF+Zod 管理三项 target，source 只读。
3. 复用 `{signature,key}` 生命周期；同步 submit guard 防双击，不自动 retry。
4. stale/409/资格变化保留 values/request ID，禁用旧上下文提交；显式 reload Insights/options 后清 key 并校验仍存在的选项。
5. 成功精确失效 Insights、Content list、Product detail、条件性 Topic list，并用 response ID 进入 Content Task Detail。

完成条件：请求 header/body、稳定 key、冲突 request count、输入保留、显式 reload、cache keys 和 canonical success navigation 有直接测试。

### Step 9：补齐 Coverage ADD handoff

1. New Observation search 增加 strict `geoPlatform`。
2. 与既有 `queryTopicId` 一样只做一次初始化，预填 `search_platform`；非法/不存在值明确提示。
3. direct URL/refresh 保持相同表单，不改创建 payload、候选、证据或 Correction 行为。

完成条件：Coverage 的 `ADD_OBSERVATION` 进入精确 Topic+GEO Platform 创建上下文。

### Step 10：建立 strict generated fixture

1. `geo-insights.fixture.ts` 的 response/request 均由 generated schema 约束；只声明 auth/csrf、单一 Insights GET、按需 creation-options、optimization POST 和成功后的 task detail。
2. 其它 `/api/v1/**`、请求失败、未预期 console/page error 在 teardown 失败；fixture 不复制 backend 指标计算。
3. 覆盖 URL→API、direct/refresh/Back/Forward/reset、loading/error/retry、empty/partial/unavailable、三类无数据差异、各区块、精确 drill-down、Recommendation 无伪链接。
4. 覆盖 action actor、Dialog options、稳定 key、double submit、stale/409 不 replay、显式 reload、成功 ID 导航与 cache 引起的请求。
5. 覆盖键盘 details/table/Dialog focus 和 375/768/1024/1440 document 根无溢出。
6. New Geo fixture 只补 `geoPlatform` handoff，不扩成完整 GEO real-stack E2E。

完成条件：页面 production build 状态机与请求边界有 strict fixture 证据，未声明 API 直接失败。

### Step 11：同步文档、验证与自审

1. `01` 固定当前轻量 SVG 决策及 ECharts 引入条件；`05` 记录 read model/action/idempotency/drill-down；`07` 更新 Phase 5；`08` 固定验收；`09` 新增 Insights read model/identity/action ADR。
2. backend action spec 记录 actor-aware action source；frontend state spec 记录七参数 URL、单 GET 与 Dialog key 生命周期。数据库 owner 只写 `contracts/database.md`，不复制到多处。
3. 运行第 5 节 required validation；只修复与本 Task 有因果关系的问题。
4. diff 自审：无客户端指标/资格计算、无旧 V1 UI 改动、无伪链接、无自动 replay、无 silent fallback、无第二 identity owner、无 ECharts/框架、无 Print/Workbench/完整 real-stack E2E。
5. 对改动 Python 做 touched-scope 中文 docstring/异常/日志检查；不加机械注释。
6. 汇报 required/optional 结果、migration preflight 风险与残余风险；提交前另给 commit plan 并等待确认。

## 4. 验收与测试映射

| 验收范围 | 主要验证 |
| --- | --- |
| OpenAPI/action source/错误响应 | contract unit；生成类型；V1/V2 typecheck |
| snapshot/筛选/分母/完整性/历史平台 | GEO unit + PostgreSQL integration + migration test |
| command revalidation/idempotency/source | GEO unit + PostgreSQL integration；同 key 并发与 replay matrix |
| URL/direct/history/reset/invalid | model/API/navigation tests；Insights strict E2E |
| KPI/trend/section/empty/partial/unavailable | page unit；Insights strict E2E |
| drill-down/New handoff | model/page tests；Insights + New Geo E2E |
| Dialog/stale/cache/success | API/page unit；Insights strict E2E request counts/navigation |
| a11y/responsive/no overflow | page semantics；production E2E 四档视口与 keyboard |
| exclusions/docs/diff | build artifact、未声明请求 teardown、文档与 diff 自审 |

## 5. 验证命令

### 5.1 Required validation

这些检查直接覆盖本 Task 的公共合同、数据库 migration、服务端 owner、页面状态和 production fixture：

```bash
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:generate
make contract-check
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:generate

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_geo_insights.py -q

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_geo_insights.py \
  backend/tests/integration/test_migrations.py::test_0043_geo_insight_platform_identity -q

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/alembic/versions/0043_geo_insight_platform_identity.py \
  backend/app/models/publication.py \
  backend/app/schemas/geo_files.py \
  backend/app/services/publication.py \
  backend/app/services/geo_observation.py \
  backend/app/routers/observation.py \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_geo_insights.py \
  backend/tests/integration/test_geo_insights.py \
  backend/tests/integration/test_migrations.py

UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app

npm --prefix frontend-v2 run test -- \
  src/app/navigation.test.ts \
  src/domains/geo/geo.api.test.ts \
  src/domains/geo/geo-insights.model.test.ts \
  src/domains/geo/geo-insights-page.test.tsx \
  src/domains/geo/new-geo-observation.model.test.ts

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend run typecheck

npm --prefix frontend-v2 run e2e -- \
  tests/e2e/geo-insights.spec.ts \
  tests/e2e/new-geo-observation.spec.ts

git diff --check
python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-13-frontend-v2-geo-insights
```

说明：

- 第二次 API generation 后必须没有新 diff。
- migration/integration 使用项目既有 PostgreSQL test instance；环境未启动时先按仓库既有方式启动，环境失败不能记作通过。
- migration test 的最终 node name 以实现时新增测试函数为准，并在 `implement.md` 同步成真实可执行命令。
- Insights E2E 是 generated strict fixture + production build，不宣称真实后端闭环；New Geo E2E 只验证新增 handoff。

### 5.2 Optional full-suite validation

以下是更广的回归面，不是默认完成条件；required failure 指向共享回归、release 准备或用户另行要求时再执行：

```bash
npm --prefix frontend-v2 run test
make test-unit
make test-integration
```

`npm --prefix frontend-v2 run e2e` 和 `make verify` 会运行本 Task 明确排除的完整/真实栈 E2E，不列为本 Task optional command；只有用户另行授权完整 GEO real-stack/全库 release gate 时才执行。

## 6. 残余风险与止损点

- migration 无法恢复在本 revision 前已经丢失的 Platform UUID；预检失败就是正确止损点。恢复策略必须由真实数据证据驱动并单独批准。
- Coverage 卡片只是通用异常候选，最终 Product/Platform 选择可能让服务端复算变 stale；页面必须把 409 呈现为资格变化，不把它当实现错误或自动换目标。
- Recommendation 当前没有 V2-safe path；本 Task 有意不显示链接。要增加链接需先修订 server contract，同时评估 V1 兼容，不能在页面映射旧路径。
- 本地 SVG 只覆盖当前三个单指标日趋势。未来只有在出现多轴、大数据量、缩放/brush 或经验证的维护收益时才重新评估 ECharts；本 Task 不预留图表 framework。
- strict fixture 不替代完整 GEO real-stack E2E，后者是明确排除的独立 Task。

## 7. 回滚

- 页面回滚删除 Insights route/page/model、navigation、fixture/spec 和 New Observation `geoPlatform` handoff，重新生成 route tree。
- API 回滚移除 additive action schema/field，并恢复后端 actor/action projection；已创建的合法 Content Task 与 immutable GEO source 不作为代码回滚对象。
- migration downgrade 只有在没有任何 PublicationWork 已依赖 snapshot 作为唯一平台 ID 时允许；否则显式拒绝，必须保留列并以前向修复回滚应用。不得为方便回滚丢失历史身份。
- 重新生成 V1/V2 schema，恢复直接相关 docs/specs，并运行相应 required contract/typecheck。
