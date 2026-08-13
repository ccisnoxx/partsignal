# Frontend V2 GEO abstraction review — Evidence matrix

日期：2026-08-13（Asia/Shanghai）

## 1. Baseline

- 主工作目录：`/Users/sc/PycharmProjects/partsignal`。
- 规划基线：`main`；创建 Task 前工作区干净，`main...origin/main [ahead 164]`。
- 实施分支：用户批准的 `codex/frontend-v2-geo-abstraction-review`。
- GEO E2E 已进入 main：`937c2a2 test(e2e): complete frontend v2 geo real-stack coverage`。
- 归档与 journal 已进入 main：`1a01e90 chore(task): archive frontend-v2-geo-e2e`、`55ee393 chore: record journal`。
- 本任务只修改 `frontend-v2/`、Frontend V2 文档与相关 Trellis task/spec；未修改 backend、OpenAPI、database、旧 frontend 或 deployment。
- 当前实现已获得提交批准；本任务不推送远端。

## 2. Planning findings（实施前快照）

| ID | 检查项 | invariant | 权威 owner | file:line 证据 | 当前结论 | 严重程度 | 需要修改 | 修改触发条件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | Detail/Correction route UUID identity | route 接受的合法 UUID 与服务端规范化 UUID 必须保持同一资源身份 | GEO Detail model assertion | `frontend-v2/src/routes/_app/geo/observations/$observationId.tsx:13-16`; `frontend-v2/src/routes/_app/geo/observations/$observationId_.correct.tsx:19-27`; `frontend-v2/src/domains/geo/geo-observation-detail.model.ts:22-64` | `z.uuid()` 实测接受大写 UUID；FastAPI path 为 `uuid.UUID` 且 response schema 为 UUID。model 在 28/39/59 行按原始 route string 大小写精确比较，合法 direct URL 会被误判为合同不一致；Correction 也经同一 assertion | **P1** | 是 | 实施获批后在 model owner 规范化身份比较并补回归 |
| F-02 | Observation/Topic mutation cache consumers | mutation 成功后必须失效所有读取已变事实的独立 projection | 各页面 mutation coordinator + domain query keys | `frontend-v2/src/domains/geo/geo-observation-list-page.tsx:72-76`; `new-geo-observation-page.tsx:152-163`; `geo-observation-correction-page.tsx:148-166`; `geo-observation-detail-page.tsx:48-67`; `query-topic-list-page.tsx:123-131`; backend `geo_observation.py:1282-1327,1354-1395`; `content_planning.py:41-73`; `product_detail.py:263-325` | Observation writes 会改变 Insights、Topic observation reference/delete blocker、Product Detail GEO；各 handler 的失效集合不完整，List delete 甚至缺 product identity。Topic mutation 会改变 Insights filter/coverage，但未失效 Insights。现有 component tests只覆盖 Correction 的部分 keys | **P2** | 是 | 实施获批后在现有 handlers 精准补 key 与最小 tests；不建 cache framework |
| F-03 | GEO input primitive usage | Domain UI 不重复实现 Design System 已声明的基础输入交互 | Design System primitives | `docs/frontend-v2/04-design-system-and-interaction-spec.md:21-25`; `frontend-v2/src/domains/geo/new-geo-observation-page.tsx:64,465,539`; `geo-observation-correction-page.tsx:78,580-583`; `geo-insights-page.tsx:152-159,280-281`; `design-system/primitives/select.tsx:29-93` | New/Correction 复制相同 textarea style；Insights 手写两套 native select style，虽然既有 Select 已在同 domain 使用。Design System 声明 Textarea 但当前没有 primitive 文件 | **P2** | 是 | 实施获批后最小补 Textarea primitive，复用现有 Select；不建 Form/Analytics framework |

## 3. Architecture and behavior evidence

| 检查项 | invariant | 权威 owner | file:line 证据 | 当前结论 | 严重程度 | 需要修改 | 修改触发条件 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Route composition | route 只做路由装配 | TanStack routes | `frontend-v2/src/routes/_app/geo/observations/index.tsx:10-40`; `$observationId.tsx:8-45`; `$observationId_.correct.tsx:14-84`; `topics/index.tsx:10-40`; `insights/index.tsx:10-44`; `insights/print.tsx:10-40` | route 只含 search/params、canonical redirect、prefetch、metadata、navigation composition；Correction canonical tail redirect是 route 责任 | 无 | 否 | route 出现表单/业务 join/动作计算时 |
| Dependency direction | `routes -> domains -> design-system/shared`，无反向依赖 | package boundary | `frontend-v2/AGENTS.md:20-23`; `docs/frontend-v2/06-code-architecture-and-project-structure.md:65-88`; 静态 import 扫描 | 未发现 design-system/shared import GEO；GEO 不 import route；跨 domain 只消费 public API/query keys，不导入内部 UI | 无 | 否 | lint/boundary 或静态扫描发现反向 import 时 |
| Domain API ownership | 页面不绕过 domain API/query 层 | `geo.api.ts` | `frontend-v2/src/domains/geo/geo.api.ts:44-171,395-415`；静态扫描显示 domain production 仅此文件调用 `api.GET/POST/...` | GEO query keys、query options、mutations、错误 envelope owner 唯一；页面没有直接调用 generated client | 无 | 否 | 出现页面直接 client 调用或第二 key factory 时 |
| Observation server actions | action eligibility 只能来自 server token | backend action projection + frontend resolver | `backend/app/services/geo_observation.py:386-400,667-803`; `frontend-v2/src/domains/geo/geo-observation-actions.ts:18-83`; `geo-observation-list-page.tsx:305-320`; `geo-observation-detail-page.tsx:200-239` | List/Detail 只消费 `available_actions/primary_task/workflow_stage`；resolver exhaustive，未从 stage/status/role 推导资格 | 无 | 否 | 页面按 status/role 重新计算 action 时 |
| Topic server actions | Topic primary/update/delete 由服务端投影并命令端复核 | content planning service + Topic model/page | `backend/app/services/content_planning.py:41-115,260-297`; `frontend-v2/src/domains/geo/query-topic-list.model.ts:113-126`; `query-topic-list-page.tsx:392-422,698-715` | 开始观测来自 `primary_task`，update/delete 只由 `available_actions`；DELETE 最终重新统计 blockers；409 显式 reload，不 replay | 无 | 否 | 页面从 reference counts 推导 DELETE 或自动 replay 时 |
| Insights server actions | optimization eligibility/source 由服务端投影并 POST 复算 | GEO insight schema/service | `backend/app/schemas/geo_files.py:353-457`; `backend/app/services/geo_observation.py:1596-1847,2085-2194,2197-2326`; `frontend-v2/src/domains/geo/geo-insights.model.ts:149-205`; `geo-insights-report.tsx:178-191` | 页面只用 `primary_task + optimization_action`；schema 校验 action identity；POST 在事务内复算、幂等并写不可变 source | 无 | 否 | 页面按 rate/status 补动作或直接信任旧 action 写入时 |
| Append-only correction | 原 Observation 不原地修改；tail/supersedes 由服务端拥有 | GEO service/read model | `contracts/database.md:59-69,137-149,261-267`; `backend/app/services/geo_observation.py:880-947,982-1151,2370-2467`; `frontend-v2/src/domains/geo/geo-observation-correction.model.ts:99-120` | Correction POST 新建 row；`supersedes_id` 取 context `chain_tail_id`；冻结字段不可改；历史 direct evidence 只读 | 无 | 否 | 出现 update endpoint、客户端猜 tail 或复制祖先 evidence 时 |
| 409/idempotency | 冲突不自动 replay；幂等语义与合同一致 | page state + backend command | `geo-observation-correction-page.tsx` 的 submit/reload paths；`backend/app/services/geo_observation.py:2197-2326,2370-2467`; archived real-stack validation `research/validation.md:45-67` | Observation POST 无 Idempotency-Key，pending 防同页重复；Correction 409 显式 refresh；Optimization 稳定 key、同 key 验证 target/source | 无 | 否 | 自动 replay、换 payload 复用 key 或返回假成功时 |
| Dedicated read models | 页面不跨 API 拼装后端业务投影 | backend routes/services | `backend/app/routers/observation.py:219-283,352-390`; `geo_observation.py:808-837,982-1151,2085-2194`; `content_planning.py:119-185` | List、Detail、Correction Context、Topics list-items、Insights 都是独立窄 read model；Print复用 Insights；浏览器无 join | 无 | 否 | 页面新增跨 endpoint join 或第二 read model 时 |
| API/generated consistency | OpenAPI 是 API 合同，generated types 与其一致 | root contract + generated schema | `contracts/openapi.yaml:599,2973,3032,3049,3094,3125`; `frontend-v2/src/shared/api/generated/schema.d.ts:6223,9254,9343,9370,9435,9486`; `npm run api:check` 实际通过 | OpenAPI 与 V2 generated types 一致；当前 findings 不要求 API/DB变化 | 无 | 否 | `api:check` 失败或修复需公共合同变化时独立升级 |
| Error ownership | 未知/结构化错误显式暴露，不静默 fallback | `geo.api.ts` + page model mappers | `frontend-v2/src/domains/geo/geo.api.ts:260-393`; `geo-observation-detail.model.ts:125-127`; action/model exhaustive branches | 未发现 message parsing、fixed-success、旧字段 fallback 或重复错误 DTO；page-specific error UX 保留局部 owner | 无 | 否 | 出现同一 code 多个冲突语义或静默 default 时 |
| Evidence upload reuse | New/Correction 共享真实传输边界，不提升万能上传框架 | `GeoEvidenceUpload` | `frontend-v2/src/domains/geo/geo-evidence-upload.tsx:1-104`; New/Correction imports；相关 test | 真实双消费者，SHA/transfer/API mapping留在 shared/API边界；没有业务逻辑进入 Design System | 无 | 否 | 第三种上传契约出现且重复稳定时再评估 |
| Screen/Print reuse | 同 URL/query/read model/report，Print readonly | GEO Insights model/API/report | `geo.api.ts:44-85`; `geo-insights-page.tsx:50-125`; `geo-insights-print-page.tsx:1-97`; `geo-insights-report.tsx:27-121`; Screen/Print routes | 两个真实消费者共享 `GeoInsightsReport` 与 formatter；Print无普通导航/options/mutation；没有 report framework | 无 | 否 | 出现 print-only DTO/key/API或业务逻辑提升到 DS时 |
| URL ownership | 列表/Topics/Insights筛选分页进入 canonical URL | GEO model + route | `geo-observation-list.model.ts`; `query-topic-list.model.ts`; `geo-insights.model.ts`; routes 的 validate/middleware/beforeLoad | 三个页面均有唯一 Zod schema、canonical record与URL→API映射；Detail param边界明确（F-01除外） | 无 | 否 | 新筛选只进local state或出现第二schema时 |

## 4. Planning test and exit-gate evidence（实施前快照）

| 检查项 | invariant | 权威 owner | file:line / command evidence | 当前结论 | 严重程度 | 需要修改 | 修改触发条件 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Test layering | unit/component/fixture/real-stack职责互补 | frontend tests + isolated stack | `docs/frontend-v2/08-testing-quality-and-acceptance.md:79-97,238-252,281-287`; `tests/e2e/geo-*.spec.ts` | unit冻结映射/合同，component冻结页面状态，fixture验证production artifact/API allowlist/四档/键盘，real-stack验证连续业务与持久化；没有机械重复删除依据 | 无 | 否 | 同一层出现无新增风险的字面重复时再独立评估 |
| GEO real-stack Flow A | New→Detail→Correction→List，上传、append-only、祖先附件、原记录不变 | `geo-real-stack.spec.ts` + archived validation | `frontend-v2/tests/e2e/geo-real-stack.spec.ts:315-475`; archived `research/validation.md:45-67` | 最近实际 V2 real-stack `12 passed`；Flow A覆盖要求全部链路 | 无 | 否 | 后端/DB/上传/Correction真实流程变化时重跑 |
| GEO real-stack Flow B | CONTENT_DECLINE→幂等Optimization Task→不可变GEO source | 同上 | `geo-real-stack.spec.ts:476+`; archived `research/validation.md:45-55` | Flow B 已真实证明复算、单次幂等POST、response ID handoff、Task Detail source | 无 | 否 | Insights command/idempotency/source schema变化时重跑 |
| Lightweight planning checks | 当前静态审计不以未运行证据冒充通过 | frontend commands | `npm run api:check` 通过；`npm run lint` 通过；`npm run typecheck` 通过；targeted Vitest `6 files / 33 tests` 通过 | 当前代码基线可编译且既有 targeted tests全绿，但这些测试没有覆盖 F-01/F-02 | 无 | 是（测试缺口随F-01/F-02关闭） | 实施时补最小回归并重跑 required commands |
| Product gate | GEO写入后 Product投影一致 | Product Detail read model/cache | `backend/app/services/product_detail.py:263-325`; F-02 | 服务端投影正确，但前端 List delete cache 未精准失效 | **NOT_MET / P2** | 是 | 关闭 F-02 |
| Engineering gate | 行为正确、无未解决 P1/P2 | 本矩阵 | F-01/F-02/F-03 | 当前 1 P1 + 2 P2 | **NOT_MET** | 是 | 三项全部关闭 |
| UX/Accessibility gate | 375/键盘/focus与DS基础交互一致 | fixture E2E + Design System | GEO specs覆盖375/768/1024/1440与focus；F-03 | 响应式证据存在，但输入 primitive 漂移尚未关闭 | **NOT_MET / P2** | 是 | 关闭 F-03并保持既有证据 |
| Architecture gate | 唯一owner与依赖方向 | routes/domain/API/DS | 上述architecture rows | 分层正确；F-02是明确consumer ownership遗漏，F-03是DS边界漂移 | **NOT_MET / P2** | 是 | 关闭 F-02/F-03 |
| Contract/Data integrity gate | append-only/server authority/API一致 | backend/schema/OpenAPI/model | 上述immutability/API rows + F-01 | 持久化与服务端合同正确；合法UUID在前端断言层发生真实contract mismatch | **NOT_MET / P1** | 是 | 关闭 F-01 |
| Testing gate | required行为有可执行回归，fixture与real-stack完整 | tests/docs | 既有real-stack与targeted结果；F-01/F-02当前缺回归 | 大层级完整，但本次发现需要最小regression | **NOT_MET / P2** | 是 | 新回归通过 |
| Documentation gate | 代码/合同/spec/迁移计划一致 | `docs/frontend-v2/*` + `.trellis/spec` | `07-migration-plan.md:418-438` 当前记录“只剩抽象回顾” | 当前如实为 NOT_MET；实施后需记录 findings 与最终 gate | **NOT_MET** | 是 | closeout同步文档 |

## 5. Planning judgment（实施前快照）

### Open severity

- P0: 0
- P1: 1（F-01）
- P2: 2（F-02、F-03）
- P3: 0（未把文件大小、个人风格或未来复用列为问题）

### Phase 5

`NOT_MET`。

精确 blockers：

1. `F-01`：route-valid uppercase UUID 被 Detail/Correction assertion 拒绝。
2. `F-02`：Observation/Topic mutations 未覆盖 Insights、Topic references 与 Product Detail 的全部真实缓存消费者。
3. `F-03`：GEO Insights/New/Correction 存在已证实的 Design System input primitive 漂移。

三个 blocker 均可在同一个当前 review Task 内形成小、可 review 的 frontend-only diff；没有证据要求拆成 API/DB/权限或部署 Task。若实施发现必须跨这些边界，则停止并另提 Task。

## 6. Implementation closeout

### Closed findings

| ID | 实施结果 | 直接证据 | 最终严重程度 |
| --- | --- | --- | --- |
| F-01 | `assertGeoObservationDetail` 在 request/response UUID 身份边界使用大小写不敏感比较；response 内部链关系继续精确校验 | `frontend-v2/src/domains/geo/geo-observation-detail.model.ts`; `geo-observation-detail.model.test.ts` 覆盖 uppercase route ID 与既有真实错配 | Closed |
| F-02 | Observation create/correct/delete 补齐 Insights、Topic list-items 与对应 Product Detail；Topic mutation 补 Insights；List delete 以当前 row 保留 Product identity | `geo-observation-list-page.tsx`; `geo-observation-detail-page.tsx`; `new-geo-observation-page.tsx`; `geo-observation-correction-page.tsx`; `query-topic-list-page.tsx`; 对应 List/Detail/Correction component assertions | Closed |
| F-03 | 新增无 GEO 依赖的最小 Textarea primitive；New/Correction 删除重复 textarea style；Insights filters/Optimization targets 复用既有 Select | `design-system/primitives/textarea.tsx`; `textarea.stories.tsx`; `core-primitives.test.tsx`; 三个 GEO pages；`rg` 只剩 primitive 内原生 textarea | Closed |

### Actual validation

- targeted Vitest：`6 files / 36 tests passed`。
- GEO Insights production-artifact Playwright：mobile/desktop 两个 project，`16 passed`；首轮旧 `selectOption` locator 失败后，按 Base UI combobox 的真实选择交互更新既有 spec，重跑全绿。
- `npm --prefix frontend-v2 run api:check`：通过，OpenAPI types 与根合同一致。
- `npm --prefix frontend-v2 run lint`：通过。
- `npm --prefix frontend-v2 run typecheck`：通过。
- `npm --prefix frontend-v2 run build`：通过；仅保留既有大 chunk warning。
- `git diff --check`：通过。
- 最近归档 GEO real-stack：V2 `12 passed`、V1 Trusted Types `7 passed`、隔离资源清理完成。本任务未修改触发重跑的后端、数据库、OpenAPI、上传、append-only command、Insights 复算或 orchestration。

### Final Phase 5 gate

- Product：`MET`，Observation 写操作精确失效对应 Product Detail。
- Engineering：`MET`，required frontend checks 与受影响 production-artifact E2E 通过。
- UX / Accessibility：`MET`，基础输入统一到 Design System primitive，Base UI Select 的真实键盘/选项交互及既有四档布局通过。
- Architecture：`MET`，route/domain/API/Design System owner 与依赖方向不变，未新增通用 cache/Form/Analytics framework。
- Contract / Data integrity：`MET`，route-valid UUID 正确识别，append-only/server authority/OpenAPI 保持不变。
- Testing：`MET`，本次最小回归、fixture 与最近 real-stack 证据互补。
- Documentation：`MET`，`05/07/08`、frontend spec 与 task artifacts 已同步；`04` 的既有 Textarea/Select 边界无需改写，`09` 没有新增架构决定需要 ADR。

未解决严重程度：P0 `0`、P1 `0`、P2 `0`、P3 `0`。Phase 5 最终结论：`MET`。
