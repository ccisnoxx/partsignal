# Frontend V2 Workbench Vertical Slice 综合审计

## 1. 审计结论

Workbench 的主要架构边界成立：backend service 是聚合业务规则和 canonical href 的唯一 owner；前端仅消费一个 aggregate query；Design System/shared 不含 Workbench 业务语义；component、strict fixture、backend integration、既有 real-stack workflow 与根 gate 职责互补；V1 dashboard 与旧 frontend 保持独立。

实施后 Phase 8 Exit Gate 为 **`NOT_MET`**。计划内签名 URL P1 已关闭，两个删除式 P2 已关闭；独立诊断另确认两个不属于本 Task 精确修改范围的 P1 blocker：V2 非 Workbench 测试环境未声明首页 aggregate 请求，以及 Auth logout 对在途 Workbench GET 的取消/错误收集竞态。文档纠偏 A20 因 Gate 非 `MET` 未写入 `08`，继续作为非阻断 P2 保留。

本 Task 未机械重跑前三个 Task 的定向命令；实施候选按 `implement.md` 完成独立阶段诊断。由于独立阶段非全绿，未运行 `make verify`，也未把 `07`/`08` 标记为完成。

## 2. 前置与历史证据

| 检查 | 证据 | 结论 |
| --- | --- | --- |
| 主工作区 | `git status --short --branch` 在 Task 创建前为 clean `main`，本地 `main` ahead `origin/main` 270 | 通过；未 pull。 |
| aggregate read model | 实施 `545ecde2`；归档 `13f2449b` | 已提交并归档。 |
| Workbench UI | 实施 `59e9e76b`；归档 `d3603678` | 已提交并归档。 |
| Workbench E2E | 实施 `07c4a431`；归档 `f3a9d8f7` | 已提交并归档。 |
| E2E 遗留 Git 状态 | 本地/远端 branch 搜索无 `frontend-v2-workbench-e2e`；`git worktree list --porcelain` 只有主工作区 | 无遗留 branch/worktree。 |
| 禁止操作 | 本轮未执行 pull、push、PR、历史改写、`task.py start` 或建分支 | 符合规划阶段约束。 |

Task 创建后仅出现父 Task `task.json` 更新和本 child Task 规划目录，属于本轮授权的规划产物。

## 3. 完整审计矩阵

| ID | Shared invariant | 关键证据 | 当前 owner | 建议 owner / 动作 | 分类 | Severity / 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| A01 | 单请求一致快照 | `backend/app/routers/workbench.py:14-27`；`backend/tests/integration/test_workbench.py:137-198` | Workbench router transaction dependency | 保持 router；不加事务 wrapper | Keep in Backend Read Model | P1 已满足 |
| A02 | 六类 actionable count 与四域 health | `backend/app/services/workbench.py:63-188,191-327,379-465`；integration `:424-460` | Workbench service | 保持 service；不建 Dashboard/Workflow framework | Keep in Backend Read Model | P1 已满足 |
| A03 | Publication/Issue 状态与动作资格 | service 复用 `publication_work_actions` / `published_content_issue_actions`；权威 helper 在 `backend/app/services/publication_queries.py:88-133,182-200` | 原 Publication/Issue domain | 原 owner 保持；Workbench 只做聚合分类 | Keep in Backend Read Model | P1 已满足 |
| A04 | GEO current correction-chain tail | `backend/app/services/geo_observation.py:147-150,313-383`；Workbench `:252-268,330-370`；integration `:310-450` | GEO query predicate + Workbench window projection | tail 留 GEO；30 日首页聚合留 Workbench | Keep in Backend Read Model | P1 已满足 |
| A05 | rate 分母为 0 时 `null` | service `_rate` `backend/app/services/workbench.py:51-56`；schema `:62-79`；integration `:188-194,447-450` | service 计算，schema 校验 | 保持；前端只格式化合同值 | Keep in Backend Read Model | P1 已满足 |
| A06 | canonical href 与 Workspace eligibility | service `backend/app/services/workbench.py:79-87,109-117,154-184,229-247,318-325,406-458`；前端 `workbench.model.ts:79-89`、page `:57-87` | Workbench service | 服务端保持唯一 owner；前端 passthrough | Keep in Backend Read Model | P1 已满足 |
| A07 | attention 安全字段、top-10、稳定顺序、固定 SQL | service `:394-401`；integration `:452-549` | Workbench service + integration observable contract | 保持 service；不新增 repository/cache | Keep in Backend Read Model | P1 已满足 |
| A08 | attention 排序只有一个业务定义 | 相同 sort key 原位于 service 与 schema；候选已删除 schema validator | Workbench service | 保留 service、`max_length=10` 与 integration assertion | Simplify locally | P2 closed |
| A09 | 响应/error/access log 不含 Workbench 敏感字段 | global middleware `backend/app/main.py:53-85` 只记 path；integration `:466-480` 排除正文、notes、prompt/answer | backend contract/middleware | 保持 | Keep in Backend Read Model | P1 已满足 |
| A10 | OpenAPI/runtime/generated types 一致 | `contracts/openapi.yaml:3188-3198,7854-7954`；两套 generated types 当前逐字一致；归档 contract-check 证据 | OpenAPI | 不修改；实际 drift 才修 | Keep in Backend Read Model | P1 已满足 |
| A11 | V1 dashboard 与 V2 Workbench 并行隔离 | V1 router `observation.py:394-437`、schema `geo_files.py:577-582`、旧 Dashboard 独立 query；V2 additive 注册 | 各自 read model | Phase 9 前保持；旧 frontend 不动 | Keep in Backend Read Model | P1 已满足 |
| A12 | 浏览器只读取一个 aggregate | `workbench.api.ts:24-35` 唯一 GET；component `:63-80`；strict fixture `:104-126` | `workbenchQueryOptions` | 保持单 query | Keep in Workbench Domain | P1 已满足 |
| A13 | route loader/page 共用 Query cache | route `routes/_app/index.tsx:8-12`；page `workbench-page.tsx:22-36`；app 单 QueryClient | Workbench query options + app QueryClient | 不加 hook/store/cache | Keep in Workbench Domain | P1 已满足 |
| A14 | 依赖方向与 shared 纯度 | route 只导入 domain；domain 只导入 DS/shared；手写 DS/shared 搜索无 Workbench/category/权限状态 | route/domain/DS/shared 各自边界 | generated DTO 留 shared API；presentation 留 Workbench | Keep in Design System/shared | P1 已满足 |
| A15 | 前端不复制四域状态机/action registry | model 只含 generated-union label/tone/formatter；page 只呈现 response | backend business owner + Workbench presentation | 保持局部 map；不建跨 domain registry | Keep in Workbench Domain | P1 已满足 |
| A16 | Workbench query API 公共表面最小 | 候选已删除无消费者的 `WorkbenchRequestError`、`status/detail`、`workbenchKeys` 与 label map 导出 | Workbench domain | 保持一个 query options 导出、普通 `Error`、inline key 与私有 label map | Simplify locally | P2 closed |
| A17 | transport ErrorEnvelope guard 重复 | 十个 domain 有同形 local guard | 各 domain transport boundary | 本 Task 不做半套 shared；仅在独立全量 cleanup 有授权时提升 | Promote only after proven consumers | P2 retained，非阻断 |
| A18 | 测试职责互补 | model/component/strict/backend/四条 real-stack/root gate 分别覆盖映射、DOM、production artifact、业务真值、自然 handoff、总门禁 | 各既有测试 owner | 不新建 Workbench real-stack spec/fixture/orchestrator | Keep in Workbench Domain | P1 已满足 |
| A19 | signed capability 不进入日志/失败产物 | dev-storage 已使用 `--no-access-log`；GEO 失败仅记录 pathname，完整 URL 只做不回显 operands 的 boolean equality；真实栈 GEO Flow A/B 通过且日志无签名 query | e2e-local storage lifecycle + GEO failure output | 保持当前最小 owner | Confirmed defect requiring change | **P1 closed** |
| A20 | 08 文档准确描述敏感产物 owner | `08-testing-quality-and-acceptance.md:392` 的保证强于现有实际扫描；shell 无全局 secret scan | 测试文档 | 仅 Gate=`MET` 时纠正；当前不写完成态文档 | Simplify locally | P2 retained，非阻断 |
| A21 | real-stack 局部 response/login glue | 至少七个 spec 有同形局部 helper | 各 real-stack spec | 本 Task 不抽薄共享 helper；未来需统一脱敏错误合同时独立处理 | Promote only after proven consumers | P2 retained，非阻断 |
| A22 | 已有 secret scanner | `frontend-v2/tests/e2e/helpers/secret-artifact.ts` 有 Auth/System Admin 多消费者 | E2E shared test helper | 保持；动态 capability 应在输出 owner 阻止，不复制 scanner | Keep in Design System/shared | P2 keep |
| A23 | exact href 覆盖 | frontend passthrough、主要 real-stack navigation 已覆盖；backend integration 未逐一锁定所有 href | backend integration 为真值 owner | 只有出现 drift/change pressure 才在现有 integration 增加数据驱动断言 | Promote only after proven consumers | P2 retained，非阻断 |
| A24 | 不新增通用抽象 | 当前没有 Dashboard/Metric/PageHeader/Workflow framework；页面局部 SectionHeading 有四个真实调用 | Workbench local component | 保持局部；没有足够消费者不提升 | Promote only after proven consumers | 已满足 |
| A25 | 非 Workbench 测试必须声明首页 aggregate | unit `app-shell.test.tsx:161-164` 用 ProductList shape 响应全部 GET；strict `auth-session.spec.ts:91-99` 与 `platforms.fixture.ts:225-238` 把 `GET /api/v1/workbench` 记为未声明 API | V2 unit/strict fixture owner | 独立 Task 统一补齐根路由 Workbench fixture，不在本审计改测试合同 | Out-of-scope blocker requiring independent Task | **P1 open** |
| A26 | Auth 真实流程中在途首页 query 的取消边界 | `auth-session-real-stack.spec.ts:21-27,41-51` 记录 `requestfailed: GET /api/v1/workbench`；现有无 trace 证据不能确定发生在离开首页还是 logout | Auth/session + query lifecycle owner | 独立 Task 先定向确认时点与 `errorText`，仅对已证明的导航取消做窄处理；不得笼统忽略 Workbench GET | Out-of-scope blocker requiring independent Task | **P1 open** |

## 4. Finding 分类与处置

| 用户要求分类 | Findings | 本 Task 处置 |
| --- | --- | --- |
| Keep in Workbench Domain | A12、A13、A15、A18、A24 | 保持；不移动、不抽象。 |
| Keep in Design System/shared | A14、A22 | 保持 primitives/generated client/已证明 test helper；不导入业务语义。 |
| Keep in Backend Read Model | A01-A07、A09-A11 | 保持 authoritative owner。 |
| Simplify locally | A08、A16、A20 | A08/A16 已关闭；A20 因 Gate 非 `MET` 保留。 |
| Promote only after proven consumers | A17、A21、A23、A24 | 本 Task 不提升；前三项为保留 P2。 |
| Confirmed defect requiring change | A19 | 已按最小范围关闭。 |
| Deferred product/UX decision | 无 | 不新增产品能力；未来需求另行决策。 |
| Out-of-scope blocker requiring independent Task | A25、A26 | 当前只记录证据；等待用户独立授权，不在本 Task 扩修。 |

实施后 open findings 计数：`P0=0`、`P1=2`、`P2=4`。A19（P1）与 A08/A16（P2）已关闭；A25/A26 是两个独立 P1 blocker；A17/A20/A21/A23 为非阻断 P2。

## 5. 精确计划修改范围

| 文件 | 最小动作 | 明确不做 |
| --- | --- | --- |
| `backend/app/schemas/workbench.py` | 删除重复 `validate_attention_order`；保留 rate/window validator 和 attention `max_length=10` | 不改 service、合同、集成数据或排序算法 |
| `frontend-v2/src/domains/workbench/workbench.api.ts` | 保留一个 query options；inline query key；普通 `Error` 保留现有用户信息；移除无消费者 class/status/detail 与多余导出 | 不迁移其他 domain ErrorEnvelope guard，不加 shared helper |
| `frontend-v2/src/domains/workbench/workbench.model.ts` | `workbenchCountLabels` 保持文件私有，不再导出 | 不改 labels、formatter 或 href 行为 |
| `deploy/scripts/e2e-local.sh` | 仅对开发对象存储 Uvicorn 增加原生 `--no-access-log` | 不改 API/AI server 日志、签名协议或生命周期 |
| `frontend-v2/tests/e2e/geo-real-stack.spec.ts` | request failure 只记录 method + pathname；完整 URL 比较改为布尔断言 | 不改 workflow、数据准备、上传协议或新增 helper |
| `docs/frontend-v2/07-migration-plan.md` | 仅最终 MET 时标记 Phase 8 完成与证据 | NOT_MET 时不保留完成状态 |
| `docs/frontend-v2/08-testing-quality-and-acceptance.md` | 仅最终 MET 时写入最终证据并纠正敏感产物 owner | 不声称全局通用 secret scan |

`03`、`05`、`09`、OpenAPI、generated types、V1/旧 frontend 当前一致，不在修改范围。

## 6. 测试责任与既有证据复用

- Backend integration 已证明角色、401、repeatable read、六类真值、GEO tail/null、稳定 top-10、安全字段与 sparse/dense 固定 7 queries。
- Model/component 已证明 generated union 展示、单 aggregate、canonical href passthrough、empty/zero/null 和 fatal/retry。
- Strict fixture 已证明 production artifact、唯一业务 GET、unexpected API、键盘与四档布局；它不冒充 PostgreSQL 真值。
- Product/Content/Publication/GEO real-stack 只在原 workflow 自然状态插入 Workbench handoff；不新增第二 workflow。
- 最终 `make test-*`/`make e2e` 是固定候选的交叉影响与 Phase gate 重验，不是机械重放归档定向发现循环。

前三个归档 Task 已记录的同文件 Ruff/mypy/integration、两文件 Vitest/strict fixture、四条定向 real-stack 命令不在本规划阶段重跑。

## 7. Gate 判定

### `MET`

同时满足：

1. A19 P1 与计划内三个 P2 已按最小范围关闭，未引入新的 P0/P1。
2. 三个 retained P2 有明确 owner、提升门槛且不影响当前正确性/数据完整性/安全/可访问性。
3. 九个独立安全阶段各一次全部通过，真实栈 cleanup 完整且无敏感输出。
4. 固定候选唯一一次 `make verify` 通过。
5. `git diff --check`、Task validate、最终 Git 状态检查通过。
6. 代码、OpenAPI/generated types、测试、`07`/`08` 与 Task 结论一致；V1/旧 frontend 无产品代码变更。

### `NOT_MET`

任一条件成立即判定：未关闭 P0/P1；签名或其他敏感信息仍可进入响应/日志/失败产物；required stage 或最终 `make verify` 非零；cleanup 不完整；合同/types drift；需要数据库、权限、既有状态机或公共合同 blocker；或者 `07`/`08` 与实际证据不一致。

若 `make verify` 意外失败，先完成尚无独立结果且安全的阶段，批量归因并判定 `NOT_MET`；不立即进入一个 blocker 一次重跑的循环。

## 8. Supporting Research

- `research/backend-audit.md`：backend owner、GEO、href、合同、V1 与局部排序重复的逐项证据。
- `research/frontend-audit.md`：单 query、依赖方向、shared purity、presentation/状态机边界与前端 P2。
- `research/e2e-infra-audit.md`：测试分层、签名 URL 泄漏路径、产物安全、独立诊断和 final gate 规则。

## 9. 实施与独立诊断结果

| Command / stage | 结果 | 归因 |
| --- | --- | --- |
| `bash -n deploy/scripts/e2e-local.sh` | PASS | shell 最小语法检查通过。 |
| `make contract-check` | PASS | runtime/OpenAPI 与 V1/V2 generated types一致。 |
| `make lint` | PASS | 无 lint 失败。 |
| `make typecheck` | PASS | 无类型失败。 |
| `make test-unit` | FAIL | backend 201、V1 205、V1 visual-contract 24 通过；V2 462 通过、1 失败，归因 A25。代码/环境未改变，未重跑。 |
| `make test-integration` | PASS | `120 passed in 177.96s`。 |
| `make build` | PASS | backend、V1、V2 artifact 均成功；仅有既有 V2 chunk size warning。 |
| `make e2e` | FAIL | V2 real-stack `15 passed, 1 failed`，失败归因 A26；GEO A/B 与签名 URL 修正证据通过；database/storage/Redis/ports cleanup 全部完成。 |
| `npm --prefix frontend-v2 run e2e` | FAIL（下游独立诊断） | `379 passed, 33 skipped, 4 failed`；Auth mobile/desktop 与 Prompt mobile/desktop 均归因 A25。 |
| `npm --prefix frontend run e2e` | FAIL（下游环境诊断） | package 配置不自启服务，`127.0.0.1:5173/4173` 均 `CONNECTION_REFUSED`；12 failed、40 未运行。根 e2e harness 已清理服务，环境未改变，不重跑；不归因本 Task 产品 diff。 |
| dev Compose config | PASS | `deploy/compose.dev.yaml` 配置有效。 |
| prod Compose config | PASS | `deploy/compose.prod.yaml` 配置有效。 |

`make e2e` 在 real-stack 子阶段 fail-fast，根入口未到 V1 与 V2 strict fixture；因此单独运行安全的 V2 strict fixture 收集下游 blocker。V1 package entry 依赖根 harness 已启动的服务，独立调用只得到连接拒绝，未据此添加产品 finding。未重复失败的根命令。最终 `make verify` 的前置条件未满足，按批准计划未运行。

## 10. Phase 8 Exit Gate

最终判定：**`NOT_MET`**。

- 计划内实现符合 owner、依赖方向、唯一 query、GEO tail/null、canonical href、V1 隔离和最小抽象约束。
- A19 安全缺陷已关闭，未观察到签名 query 进入 GEO 成功日志或失败输出。
- A25、A26 两个 P1 仍开放，且 required independent stages 非全绿，因此不满足 `MET` 条件。
- `docs/frontend-v2/07-migration-plan.md` 与 `08-testing-quality-and-acceptance.md` 未写入 Phase 8 完成声明。
