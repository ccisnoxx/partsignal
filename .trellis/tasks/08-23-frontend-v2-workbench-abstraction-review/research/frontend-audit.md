# Research: Workbench 前端 ownership、依赖与抽象审计

- Query: 审计 Frontend V2 Workbench query/model/page/route/component tests、strict fixture、OpenAPI V1/V2 generated types 与 Design System/shared 依赖；判断单 aggregate、单 Query owner、canonical href、业务状态机隔离及过度抽象。
- Scope: internal
- Date: 2026-08-23

## Findings

### 1. 结论与严重级别

- **P0：0**。未发现 Phase 8 Exit Gate 阻断项。
- **P1：0**。未发现必须在本任务修复的正确性、合同、状态 ownership 或依赖方向缺陷。
- **P2：2**。均为非阻断复杂度债：`F-FE-01` 是 Workbench API 的未消费导出/状态字段；`F-FE-02` 是十个 domain 重复的 transport `ErrorEnvelope` guard。前者可在本任务最小删除；后者禁止只迁移 Workbench，等待独立跨 domain cleanup 授权。
- **Frontend 初判：MET（静态审计）**。最终 Phase 8 仍必须以全仓独立阶段与唯一一次 `make verify` 的实际结果为准；本研究没有重跑前三个已归档 Task 的定向测试或最终门禁。

### 2. 文件范围

#### Workbench 实现与测试

- `frontend-v2/src/routes/_app/index.tsx`：根 route metadata、aggregate prefetch 与 domain page composition。
- `frontend-v2/src/domains/workbench/workbench.api.ts`：唯一 query options、query key、generated client 调用和错误投影。
- `frontend-v2/src/domains/workbench/workbench.model.ts`：Workbench-local 展示模型、穷尽 label/tone 与 rate/date 格式化。
- `frontend-v2/src/domains/workbench/workbench-page.tsx`：单 query 的 loading/error/success UI 与四个页面区块。
- `frontend-v2/src/domains/workbench/workbench.model.test.ts`：六类 count、category/health union 与 null/zero rate 的 model 证据。
- `frontend-v2/src/domains/workbench/workbench-page.test.tsx`：单 aggregate、canonical href、空态与 retry 的 component 证据。
- `frontend-v2/tests/e2e/fixtures/workbench.fixture.ts`：generated-type strict fixture、API allowlist 与 runtime error 审计。
- `frontend-v2/tests/e2e/workbench.spec.ts`：production artifact 单 GET、键盘、四档布局及状态矩阵。

#### 合同、shared 与 Design System

- `contracts/openapi.yaml`：`GET /api/v1/workbench` 和完整 Workbench schema 权威合同。
- `frontend-v2/src/shared/api/generated/schema.d.ts`：V2 OpenAPI generated types。
- `frontend/src/shared/api/schema.d.ts`：V1 generated types；与 V2 generated 文件逐字一致，但旧 UI 无 Workbench 消费者。
- `frontend-v2/src/shared/api/client.ts`：唯一 generated `openapi-fetch` client。
- `frontend-v2/src/app/query-client.ts`、`frontend-v2/src/app/providers.tsx`：应用唯一 `QueryClient` 实例及 Provider/Router context owner。
- `frontend-v2/src/design-system/primitives/badge.tsx`、`button.tsx`、`skeleton.tsx`：Workbench 复用的无业务语义 primitives。

#### 相关规划、规范与既有证据

- `frontend-v2/AGENTS.md`：固定 `routes -> domains -> design-system/shared`、Query server-state、禁止客户端 join/state machine/global store。
- `.trellis/spec/frontend/state-management.md`：TanStack Query/URL/local state ownership 与全局 Store 禁令。
- `.trellis/spec/frontend/hook-guidelines.md`：单 query 不包装成隐藏 owner 的 hook。
- `docs/frontend-v2/03-page-and-workflow-blueprint.md`、`05-business-actions-state-and-api-contract.md`、`07-migration-plan.md`、`08-testing-quality-and-acceptance.md`、`09-architecture-decisions.md`：Workbench 页面、aggregate、Phase 8、测试分层和 ADR-046。
- `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-ui/{prd.md,design.md,implement.md,research/audit.md,task.json}`：UI 的规划、边界与已提交定向证据。
- `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-e2e/{prd.md,design.md,implement.md,research/audit.md,task.json}`：四个 real-stack owner 的规划与已提交证据。

### 3. 审计矩阵与 shared invariant ownership

| Shared invariant | 当前 owner | 精确证据 | 建议 owner | 判定 / 分类 | Severity |
| --- | --- | --- | --- | --- | --- |
| 浏览器只读取一个 aggregate | `workbenchQueryOptions` | `workbench.api.ts:24-35` 仅一个 `queryFn`，`workbench.api.ts:28` 唯一业务调用为 `/api/v1/workbench`；component 在 `workbench-page.test.tsx:63-80` 断言一次调用；strict fixture 在 `workbench.fixture.ts:104-118,125-126` 拒绝所有未声明业务 API | 保持 Workbench domain query owner | Keep in Workbench Domain | — |
| route loader 与 page 共用一个 TanStack Query owner/cache | `workbenchQueryOptions` + app `QueryClient` | route 在 `routes/_app/index.tsx:8-12` 用同一 options/key prefetch，page 在 `workbench-page.tsx:22-36` 用同一 options；app 只有 `query-client.ts:1-3` 的实例，并由 `providers.tsx:25,30-36` 同时提供给 Router/Query | 保持现状；不加 hook/store/cache | Keep in Workbench Domain | — |
| 六类 count、四域 health、attention category 只做 UI presentation，不重建业务 | Workbench backend read model 为业务 owner；frontend model 为展示 owner | OpenAPI 固定字段/union：`openapi.yaml:7878-7888,7889-7904,7929-7954`；前端只做 typed label/tone：`workbench.model.ts:15-49`；页面直接消费服务端 `summary` 与返回顺序：`workbench-page.tsx:70-110` | 业务判断保持 backend；label/tone 保持 Workbench domain | Keep in Backend Read Model / Keep in Workbench Domain | — |
| canonical href 由服务端提供 | backend aggregate schema/service | 单链接 `href` 与多链接 `links` 合同在 `openapi.yaml:7854-7877`；single count 只补文案并原样转交 href：`workbench.model.ts:79-89`；page 原样赋值 `<a href>`：`workbench-page.tsx:57-61,76-87`；unit/fixture 分别锁定 server query：`workbench-page.test.tsx:67-73`、`workbench.spec.ts:17-33` | 保持 backend href owner；frontend 不生成 filter/Workspace 资格 | Keep in Backend Read Model | — |
| GEO denominator=0 保持 `null`，不猜 0 | backend aggregate rate；frontend formatter | OpenAPI `value: number|null`：`openapi.yaml:7905-7912` / generated `schema.d.ts:5249-5252`；formatter 明确 `null -> 暂无数据`：`workbench.model.ts:92-98`；model test：`workbench.model.test.ts:49-52`；strict artifact 同时断言 `0%` 与 `暂无数据`：`workbench.spec.ts:39-42,78-85` | current-tail/分母/rate 算法只在 backend；frontend 仅格式化合同值 | Keep in Backend Read Model / Keep in Workbench Domain | — |
| 依赖方向 route → domain → DS/shared | 文件布局与 imports | route 只向 domain：`routes/_app/index.tsx:3-4`；page 向 DS/shared/domain-local：`workbench-page.tsx:3-16`；API/model 只向 shared generated/client：`workbench.api.ts:1-4`、`workbench.model.ts:1`；全量搜索未发现 DS/shared 手写代码导入 `@/domains`/routes，Workbench domain 也未导入 route 或其他 domain | 保持现状 | Keep in Workbench Domain / Keep in Design System/shared | — |
| DS/shared 不拥有 Workbench DTO/category/权限/业务状态 | generated schema 是合同载体；手写 DS/shared 只拥有机制/primitives | 手写 `frontend-v2/src/design-system` 与 `src/shared`（排除 generated）搜索无 `Workbench`/category token；Badge/Button/Skeleton 仅定义视觉 variant/primitive：`badge.tsx:7-55`、`button.tsx:6-59`、`skeleton.tsx:1-13`。generated schema 包含 DTO 是合同生成职责：`schema.d.ts:5218-5283`，不是 shared 业务判断 | generated types 留 shared API；presentation map 留 Workbench | Keep in Design System/shared / Keep in Workbench Domain | — |
| 不复制四域状态机/action registry | Workbench backend read model + 各 domain 原 owner | Workbench source 中没有 Product/Content/Publication/GEO domain import；唯一 token maps 是 aggregate category/status 的展示映射 `workbench.model.ts:24-43`，不产生 action、href、资格或状态转换；`workbench-page.tsx:98-107` 直接显示 response status/summary | 保持 Workbench-local presentation；禁止跨 domain action framework | Keep in Workbench Domain | — |
| V1 Dashboard / 旧 frontend 不成为第二数据源 | V1 原实现；新 endpoint additive | ADR-046 明确边界 `09-architecture-decisions.md:301-318`；旧 `frontend/src` 除 generated schema 外无 `/api/v1/workbench`/Workbench DTO 使用；V1/V2 generated 文件 `cmp` 结果为完全相同，V1 仅获得 additive contract types | V1 页面保持不消费；Phase 9 前不删除/改写 | Keep in Backend Read Model | — |
| component / strict fixture / real-stack 职责互补 | 各自测试 owner | model/component：`workbench.model.test.ts:22-52`、`workbench-page.test.tsx:62-108`；strict artifact：`workbench.fixture.ts:88-127`、`workbench.spec.ts:3-85`；real-stack 责任边界文档：`08-testing-quality-and-acceptance.md:386-392`；前三个 Task 已有执行证据：UI `implement.md:128-138`，real-stack `implement.md:76-78` | 保持三层；不要新建 `workbench-real-stack.spec.ts` 或第二 fixture/orchestrator | Keep in Workbench Domain | — |
| 敏感信息不进入响应/UI/log/trace/video/artifact | backend safe metadata contract + test configuration | OpenAPI attention 只含 category/id/title/summary/time/href：`openapi.yaml:7929-7941`；ADR 安全边界：`09-architecture-decisions.md:315-318`；strict fixture只使用合成 user/CSRF/metadata：`workbench.fixture.ts:14-19,27-63,108-117`，runtime log 只记错误文本/方法/URL：`:96-103`；Playwright real-stack trace 关闭：`playwright.config.ts:23-26`，strict failure trace 只包含合成数据；未配置 video/screenshot | 保持现状；不得输出真实 response/body/header/cookie/storage state | Keep in Backend Read Model / Keep in Workbench Domain | — |

### 4. 八类分类结果

#### Keep in Workbench Domain

1. `workbenchQueryOptions` 是唯一 aggregate query owner；route 与 page 都调用同一 factory，不是两个 cache/source（`workbench.api.ts:24-35`、`routes/_app/index.tsx:8-12`、`workbench-page.tsx:22-36`）。
2. `workbench.model.ts` 的 count/category/health/rate 映射是 typed presentation adapter，不是四域 state machine/action registry。`satisfies Record<...>` 使 generated union 扩展时 typecheck 失败（`workbench.model.ts:15-49`）。
3. `SectionHeading`、`WorkbenchLoading`、`WorkbenchContent` 均保留在单文件局部边界（`workbench-page.tsx:39-164`）；没有为了单页消费者提升到 shared。`SectionHeading` 有四个真实调用，局部 helper 具有实际重复，不是 one-line forwarding wrapper。
4. Vitest fixture 与 Playwright fixture 保持独立：前者验证 component/query presentation，后者验证 production artifact route-loader/cache dedupe、unexpected API、键盘和响应式。共享 fixture 会把不同 runtime/test boundary 绑在一起，不建议抽象。

#### Keep in Design System/shared

1. Workbench 只复用既有 `Badge`、`Button`、`Skeleton`。当前非 test/story consumer 数分别为 31、68、25，均是已证明的视觉 primitives，不是 one-consumer Workbench 抽象。
2. `src/shared/api/generated/schema.d.ts` 保持 generated API type authority，`src/shared/api/client.ts:1-8` 保持无业务判断的 transport client。手写 DS/shared 不识别 Workbench category、权限、状态或 href。

#### Keep in Backend Read Model

1. 六类 counts、四域 health、GEO rate、attention 选择/排序与 canonical href 都由 OpenAPI aggregate 投影表达；前端没有 join、排序、总数求和、qualification 或 filter 重建。
2. 前端不检查 denominator 自行计算 rate；它只区分服务端 `value === null` 与合法数值。current correction-chain tail 算法必须继续只属于 backend。
3. Attention response 的安全字段集合保持 backend contract；前端不请求正文、notes、prompt、外部正文、request payload 或 raw audit detail。

#### Simplify locally

1. **F-FE-01 / P2**：`WorkbenchRequestError`、`workbenchKeys` 在 `workbench.api.ts:9-35` 定义，并在 `:68` 导出，但仓库内没有外部 importer；`WorkbenchRequestError.status/detail` 也没有消费者。它不是运行时 defect，但扩大了 domain public surface，并为只读单 query 保留了未用状态。最小修正建议：只导出 `workbenchQueryOptions`；是否连同 class/status/detail 和单方法 `workbenchKeys` 一并折叠，实施前以最小 diff 和既有 error message/retry component test 为界。不得借此重构其他 domain。

#### Promote only after proven consumers

1. **F-FE-02 / P2**：`isErrorEnvelope` 的 13 行实现从 `workbench.api.ts:53-66` 起，与 Audit/Product/Identity/Platform/GEO/AI Channel/Publication/Prompt/Content 共十个 domain 完全重复。它是 transport shape guard，不含业务判断，已有真实消费者；但在 Phase 8 只迁移 Workbench 会产生半套第二模式，整批迁移会跨十个 domain、扩大验证面。建议本任务不改；仅在独立、明确授权的 shared API error cleanup 中一次性提升并移除全部副本。

#### Confirmed defect requiring change

- 无。静态审计未发现行为、数据、合同或可访问性 defect；`F-FE-01/02` 仅为 P2 复杂度债，不应伪装为 Phase 8 blocker。

#### Deferred product/UX decision

- 无。没有证据支持新增 Dashboard、Metric、PageHeader、Workflow、图表、自动刷新或跨 domain framework；这些不是本阶段缺口。

#### Out-of-scope blocker requiring independent Task

- 无 Phase 8 blocker。`F-FE-02` 若要处理必须是独立跨 domain cleanup，但它不影响 Phase 8 Exit Gate。

### 5. 测试证据分层

- **Model test**：穷尽 presentation maps、single/multi link shape 与 null/zero formatter（`workbench.model.test.ts:22-52`）。
- **Component test**：query function 到 UI 的 observable boundary、canonical href、empty/zero/null、fatal request ID 与 retry（`workbench-page.test.tsx:62-108`）。它不验证 route loader cache dedupe。
- **Strict fixture Playwright**：production artifact + route loader/page 共用缓存只发一次 GET，任何其他业务 API 使 teardown 失败，并覆盖 keyboard 和 375/768/1024/1440（`workbench.fixture.ts:88-127`、`workbench.spec.ts:3-85`）。它不验证 PostgreSQL 业务聚合算法。
- **Backend integration / real-stack**：backend integration 应验证 fixed-query/read-model 业务规则；四个既有 real-stack workflow 验证真实 domain state → aggregate → canonical Workspace/Detail。其职责已记录在 `08-testing-quality-and-acceptance.md:386-392`，不应新增重复编排。
- 已归档 UI task 记录定向 Vitest 2 files/6 tests、Playwright 6 tests、api:check/typecheck/lint/build 通过（`frontend-v2-workbench-ui/implement.md:128-138`）；real-stack task 记录 Product 4、Content 2、Publication 3、GEO 2 条通过（`frontend-v2-workbench-e2e/implement.md:76-78`）。按本任务要求，本研究未机械重跑这些命令。

### 6. External references / versions

- 本审计不需要联网资料；行为判断来自仓库锁定依赖、generated contract 与当前实现。
- TanStack Query `^5.101.4`、TanStack Router `^1.170.23`、`openapi-fetch ^0.17.0`、React `^19.2.8`：`frontend-v2/package.json:22-35`。
- `openapi-typescript ^7.13.0`、Playwright `^1.61.1`：`frontend-v2/package.json:43-62`。
- generated types 由 `frontend-v2/package.json:19-20` 的 `api:generate/api:check` 从 `contracts/openapi.yaml` 产生；本研究没有手写或修改 DTO。

### 7. Related specs / authoritative decisions

- `frontend-v2/AGENTS.md`：依赖方向、server/URL/form/local state owner、single context endpoint 与禁止模式。
- `.trellis/spec/frontend/state-management.md:1-18`：TanStack Query 为 server state owner，禁止全局 Store。
- `.trellis/spec/frontend/hook-guidelines.md` 的 Data Fetching/Common Mistakes：不为单 query 包装隐藏 query key/retry 的 hook，不在 effect 复制可派生状态。
- `docs/frontend-v2/03-page-and-workflow-blueprint.md:15-50`：单 Workbench aggregate、无 join、null/zero 与 canonical href。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md:261-285`：aggregate 业务 owner、current-tail/null/sorting/safe metadata 与 V1 隔离。
- `docs/frontend-v2/07-migration-plan.md:500-506`：Phase 8 退出条件。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md:386-392`：strict fixture 与四个 real-stack owner 的互补职责及敏感产物约束。
- `docs/frontend-v2/09-architecture-decisions.md:301-318`：ADR-046 的唯一 read-model owner、安全边界和禁止通用 framework 决策。

## Caveats / Not Found

1. 本研究角色禁止 Git 操作，因此“旧 frontend 历史上没有被修改”不能通过 diff/commit 追溯证明；可证明的是当前旧 UI 源码除 additive generated schema 外没有 Workbench endpoint/DTO consumer，且 V1/V2 generated schema 当前逐字一致。
2. 未运行浏览器、Vitest、typecheck、lint、build 或完整 gate；采用当前源码、合同、已归档执行证据和静态搜索，避免机械重跑前三个 Task 已证明的定向命令。
3. 本文件只覆盖 frontend ownership/abstraction。backend service 的 SQL、current-tail、权限、排序和固定查询次数由 backend audit/集成证据 owner 给最终结论。
4. 最终 Phase 8 `MET/NOT_MET` 必须等待所有独立安全阶段与唯一一次最终 `make verify` 的实际结果；任何 P0/P1、contract drift、敏感信息泄漏或门禁失败都应改判 `NOT_MET`。
