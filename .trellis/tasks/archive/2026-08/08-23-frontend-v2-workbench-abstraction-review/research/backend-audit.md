# Research: Workbench backend owner、合同与安全边界审计

- Query: 完整审计 Workbench backend router/schema/service/integration tests 及 OpenAPI、V1/V2 generated types，确认六类 actionable count、四域 health、GEO summary、attention item、排序、canonical href、权限/错误/日志敏感信息、抽象边界与 V1 保留状态。
- Scope: internal
- Date: 2026-08-23

## Findings

### 1. 结论摘要

- 后端 Workbench 聚合边界成立：`GET /api/v1/workbench` 由独立 router 进入 `get_workbench_aggregate()`；service 是六类 Workbench eligibility/count、四域 health、30 日 GEO summary、attention 聚合、最终排序和 canonical href 的唯一投影 owner。它只复用原领域已有的 GEO 链尾查询及 Publication/Issue 纯动作投影，不复制写状态机，也不调用内部 HTTP、Redis 或缓存。
- GEO 口径成立：issue 与 rate 都经 `geo_observation_list_query()` 的 current-tail 谓词；manual rate 只统计链尾逐篇结果，准确率分母排除 `null/UNJUDGEABLE`；任一分母为零时 `_rate()` 返回 `value=None`，Pydantic 与集成测试共同冻结该不变量。
- 权限和安全边界成立：endpoint 使用统一 `CurrentUser`，ADMIN/ENGINEER 投影一致，匿名为 401；Workbench 响应只选择稳定 ID、安全标题/摘要、时间与站内 href，未选择正文、notes、prompt、issue description、凭据或请求载荷。Workbench 自身不写日志；全局访问日志只记录 request ID、method、path、status、elapsed time。
- OpenAPI、FastAPI response schema 与两套 generated types 的字段和 operation 对齐；两份 generated type 文件当前逐字一致。V1 `GET /api/v1/dashboard/summary`、`DashboardSummary` 与旧 Dashboard 的两个既有查询仍独立存在，不引用 Workbench DTO/service；归档 Task 的已记录实施证据明确声明未修改 V1 产品代码。
- 没有确认的行为 defect、P0/P1/P2 blocker、数据库/权限/公共合同 blocker、错误通用抽象、死代码或需提升为共享 framework 的真实消费者。唯一低风险简化候选是 schema 重复编码 attention 排序 key；它目前只是响应断言而非第二个数据来源，但与 service 的精确 sort lambda 重复，建议在本 abstraction review 内删除该 validator，保留 service 排序与 integration observable assertion。

### 2. 精确审计矩阵

| ID | 级别 | 用户分类 | Shared invariant / 当前 owner | 证据与判断 | 建议 owner / 最小动作 |
| --- | --- | --- | --- | --- | --- |
| B01 | P1（已满足） | Keep in Backend Read Model | 单请求一致快照；router 只拥有 HTTP/auth/transaction boundary | `backend/app/routers/workbench.py:14-16` 以 route dependency 设置 `REPEATABLE READ`；`:19-27` 只声明合同、注入 `DbSession`/`CurrentUser` 并转交 service。`backend/tests/integration/test_workbench.py:137-198` 证明 ADMIN/ENGINEER 同响应、匿名 401、两次均为 repeatable read。 | 保持 router 局部；不要新增事务 wrapper/interface。 |
| B02 | P1（已满足） | Keep in Backend Read Model | 六类 actionable count 与四域 health；`get_workbench_aggregate` | `backend/app/services/workbench.py:63-188` 投影 fact/content/publication；`:191-327` 投影 open issue/GEO issue；`:379-392` 统一收集；`:402-465` 形成六类 count 和四域 health。`backend/tests/integration/test_workbench.py:424-460` 精确断言 `1/1/1/3/1/2` 与六类 attention。 | 保持 Workbench service；不要抽出 Dashboard/Workflow framework。 |
| B03 | P1（已满足） | Keep in Backend Read Model | Publication/Issue 原状态机仍由各自 domain pure helper 持有；Workbench 只拥有 aggregate eligibility/href | `backend/app/services/workbench.py:31-34` 复用 `publication_work_actions` 与 `published_content_issue_actions`；`:132-188`、`:229-248` 消费返回的 primary task。原 owner 位于 `backend/app/services/publication_queries.py:88-133`、`:182-200`。Workbench 本地 status set 只是六类聚合分类，不实现 transition/mutation。 | 原 domain helper 保持状态机 owner；Workbench 保持局部聚合映射，不提升 cross-domain registry。 |
| B04 | P1（已满足） | Keep in Backend Read Model | GEO current correction-chain tail 与 30 日 window；`geo_observation_list_query` + Workbench rate projection | `backend/app/services/geo_observation.py:147-150` 定义唯一 tail predicate；`:313-383` 的 V2 list query 无条件应用 tail，并统一 legacy/manual accuracy。Workbench `backend/app/services/workbench.py:252-268` 复用该 query 形成 PARTIAL/INCORRECT issue IDs；`:330-370` 对同一 current manual IDs 聚合 rate；`:375-377` 固定 30 个 UTC 自然日。测试 `backend/tests/integration/test_workbench.py:310-419` 构造被 correction 取代的 parent、current bad、UNJUDGEABLE tail 与窗口外 legacy，`:424-450` 证明 count/rate。 | tail 继续由 GEO query owner 持有；Workbench 只拥有首页窗口与聚合。 |
| B05 | P1（已满足） | Keep in Backend Read Model | 无样本率必须为 null；service 计算，schema 执行结构边界校验 | `backend/app/services/workbench.py:51-56` 分母为零返回 `None`；`backend/app/schemas/workbench.py:62-79` 拒绝 numerator/denominator/value 不一致；`backend/tests/integration/test_workbench.py:188-194` 直接证明 `0/0/null`，`:447-450` 证明准确率只用可判断分母。 | 保持现状；该 schema 校验防止数据完整性退化，不是第二业务来源。 |
| B06 | P1（已满足） | Keep in Backend Read Model | canonical href 与 Workspace section；Workbench service | item href 由 `backend/app/services/workbench.py:79-87`、`:109-117`、`:154-184`、`:229-247`、`:318-325` 构造；count/filter href 集中在 `:406-458`。schema `backend/app/schemas/workbench.py:22-38`、`:101-107` 只验证非空站内相对路径。规划合同明确多链接是既有精确单状态 filter，而不是扩展下游多状态 API：`.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/design.md:73-84`。 | 保持 service owner；前端只消费 href，不新建 route registry。 |
| B07 | P1（已满足） | Keep in Backend Read Model | attention 安全投影、稳定 top-10、固定查询次数 | service 每类查询先 limit 10，最终在 `backend/app/services/workbench.py:394-401` 按 `occurred_at DESC, category ASC, resource_id ASC` 合并截断；只 select/输出 title-safe metadata。`backend/tests/integration/test_workbench.py:452-480` 证明六类、稳定顺序并排除事实/内容正文、issue description、notes、prompt/answer；`:483-549` 证明 sparse/dense 均固定 7 statements 且 top-10。 | 保持 service 与现有 integration owner；不追求单 SQL，也不新增 repository/cache。 |
| B08 | P2 | Simplify locally | attention sort 的业务定义应只在 service 出现 | 精确 sort lambda 同时存在于 `backend/app/services/workbench.py:394-401` 与 `backend/app/schemas/workbench.py:119-131`。后者只是断言，不改变响应，但形成两个必须同步修改的排序定义；observable integration 已在 `backend/tests/integration/test_workbench.py:461-465` 冻结 service 输出。 | 最小候选：删除 `WorkbenchAggregate.validate_attention_order`；保留 `max_length=10`、service 排序和 integration assertion。无需新 helper/module。此项是可局部消除的重复，不是行为 defect 或独立 blocker。 |
| B09 | P1（已满足） | Keep in Backend Read Model | 响应/错误/日志不得暴露敏感数据 | Workbench service/router 无 logger。global middleware `backend/app/main.py:53-85` 只记录 request ID、method、`request.url.path`、status、elapsed，不记录 query/header/body/cookie。Workbench 的两处领域错误 `backend/app/services/workbench.py:168-169`、`:315-316` 只返回固定 generic message；统一 ErrorEnvelope 位于 `backend/app/errors.py:31-48`，不含 traceback。测试敏感 marker 排除见 B07。 | 保持现状。trace/video/浏览器报告不属于本 backend 文件范围，由 E2E 审计 owner 核对。 |
| B10 | P1（已满足） | Keep in Backend Read Model | OpenAPI/runtime/generated contract 单一来源 | `contracts/openapi.yaml:3188-3198` 声明唯一 GET 与 200/401；`:7854-7954` 精确定义 required 六类 count、四域 health、nullable rate、六类 attention 与 max 10。runtime schema 对应 `backend/app/schemas/workbench.py:13-132`。V1/V2 types 在 `frontend/src/shared/api/schema.d.ts:1983-1997,5230-5283,9703-9722` 与 `frontend-v2/src/shared/api/generated/schema.d.ts` 同位置一致；本次 `cmp -s` 退出 0。归档证据 `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-aggregate-read-model/implement.md:66-73` 记录 `make contract-check`、两套 `api:check`、mypy、integration 全通过。 | OpenAPI 保持权威；无实际不一致，不修改合同或 generated files。 |
| B11 | P1（已满足） | Keep in Backend Read Model | V1 Dashboard 与 V2 Workbench 是有界并行读取面，不共享 DTO/glue | V1 endpoint 仍在 `backend/app/routers/observation.py:394-437` 返回五整数 `DashboardSummary`，schema 在 `backend/app/schemas/geo_files.py:577-582`；旧 frontend 仍通过 `frontend/src/shared/api/queryOptions.ts:36-40` 读取它，并在 `frontend/src/features/dashboard/DashboardPage.tsx:29-46` 独立消费 summary/geo metrics。V2 router 另在 `backend/app/main.py:33,126` additive 注册。归档 PRD `...aggregate-read-model/prd.md:23-24,42-43` 与 design `:69-85` 明确 V1 未改动边界。 | 保持到 Phase 9；不要抽出 V1/V2 Dashboard 共享 DTO 或 glue。 |
| B12 | P2（无新增项） | Promote only after proven consumers | Dashboard/Metric/Workflow/ReadModel 跨域 framework | 当前 backend 只有一个 `services/workbench.py` 聚合 owner，helpers 均为局部纯函数或复用已有 domain owner；未发现 interface/factory/repository/cache/registry。`_workbench_read_snapshot` 虽单消费者，但拥有明确 HTTP transaction lifecycle，不是薄转发 wrapper。 | 不提升。只有出现多个真实、同语义消费者且重复形成稳定 change boundary 时再评估。 |

### 3. 八类 finding 汇总与 P0/P1/P2

| 用户分类 | P0 | P1 | P2 | Backend 审计结论 |
| --- | ---: | ---: | ---: | --- |
| Keep in Workbench Domain | 0 | 1（B01，后端 Workbench router/schema/service cohesive slice） | 0 | 保持当前局部边界。 |
| Keep in Design System/shared | 0 | 0 | 0 | 本 backend 审计无 Design System/shared finding；由 frontend 审计核对。 |
| Keep in Backend Read Model | 0 | 9（B02-B07、B09-B11，均已满足） | 0 | owner、合同、安全、兼容均成立。 |
| Simplify locally | 0 | 0 | 1（B08） | 删除重复排序 validator 是唯一建议最小改动。 |
| Promote only after proven consumers | 0 | 0 | 1（B12：当前明确不提升） | 没有真实消费者证据，不新增 framework。 |
| Confirmed defect requiring change | 0 | 0 | 0 | 未发现行为或数据合同 defect。 |
| Deferred product/UX decision | 0 | 0 | 0 | 未发现需产品决策的 backend 问题。 |
| Out-of-scope blocker requiring independent Task | 0 | 0 | 0 | 未发现数据库、权限、既有状态机或公共合同 blocker。 |

说明：表内“已满足”的 P1 是审计矩阵中被核对的关键 Phase 8 不变量，不是 open finding。Backend open finding 为 `P0/P1/P2 = 0/0/1`，且该 P2 可在当前 Task 以删除代码的局部修正关闭。

### 4. Files found

- `backend/app/routers/workbench.py` — Workbench HTTP、认证与一致快照边界。
- `backend/app/schemas/workbench.py` — Workbench response shape 与 ratio/window/order 边界校验。
- `backend/app/services/workbench.py` — 六类 count、四域 health、GEO summary、attention、排序和 href 聚合 owner。
- `backend/tests/integration/test_workbench.py` — PostgreSQL 角色、snapshot、current tail、null rate、敏感字段、顺序和固定查询次数证据。
- `backend/app/services/geo_observation.py` — current correction-chain tail 与 V2 accuracy filter 权威查询。
- `backend/app/services/publication_queries.py` — Publication Work 与 Published Content Issue 的原 domain 纯动作/primary-task owner。
- `backend/app/deps.py`、`backend/app/errors.py`、`backend/app/main.py` — 统一认证、ErrorEnvelope 与 path-only access log 边界。
- `contracts/openapi.yaml` — Workbench frozen API contract，同时保留 DashboardSummary。
- `frontend/src/shared/api/schema.d.ts`、`frontend-v2/src/shared/api/generated/schema.d.ts` — OpenAPI 生成的 V1/V2 type evidence。
- `backend/app/routers/observation.py`、`backend/app/schemas/geo_files.py`、`frontend/src/features/dashboard/DashboardPage.tsx` — V1 Dashboard 保留证据。
- `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-aggregate-read-model/{prd.md,design.md,implement.md,research/audit.md,task.json}` — 已归档规划、范围和实施验证证据。

### 5. Code patterns

- HTTP boundary → cohesive service：`backend/app/routers/workbench.py:19-27` → `backend/app/services/workbench.py:373-474`。
- 复用原领域 predicate/pure projection，不复制 state machine：`backend/app/services/workbench.py:27-34,170,229-233`。
- 固定次数 windowed query + 合并 top-N：每类 SQL `LIMIT 10` 后 `backend/app/services/workbench.py:394-401` 合并。
- 响应 schema 只约束 contract shape；不存在 default/fallback/compatibility alias：`backend/app/schemas/workbench.py:22-117`。
- PostgreSQL 是唯一数据源；本 slice 没有 Redis、全局 store、应用 cache 或内部 HTTP client import。

### 6. External references / versions

- 未使用外部网页或第三方教程；判断完全基于仓库冻结合同、安装锁与真实代码。
- 本地锁定版本：FastAPI `0.139.0`（`backend/uv.lock:345-346`）、Pydantic `2.13.4`（`:793-794`）、SQLAlchemy `2.0.51`（`:1009-1010`）。审计没有依赖未验证的第三方私有 API。

### 7. Related specs

- `.trellis/spec/backend/available-actions-contract.md:3-49` — 服务端状态/动作最终权威、前端不得按角色或状态重建。
- `.trellis/spec/backend/error-handling.md:12-20` — `AppError` 与 ErrorEnvelope 边界。
- `.trellis/spec/backend/logging-guidelines.md:1-51` — 当前仍为待填模板，因此敏感日志判断以真实 middleware 与项目规则为准。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md:261-285` — Workbench aggregate、GEO、attention、安全与 V1 保留权威合同。
- `docs/frontend-v2/09-architecture-decisions.md:301-318` — ADR-046 唯一 owner、snapshot 与 scope boundary。
- `.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/design.md:71-91` — 六类聚合、canonical links、tail 与固定查询约束。

## Caveats / Not Found

- 本研究是只读规划审计，按用户要求没有运行新的定向测试或完整门禁；复用了已归档 aggregate Task 在 `implement.md:66-73` 的已提交验证证据。最终候选仍须按主任务计划执行安全独立阶段及一次 `make verify`。
- Trellis research role 禁止 Git 操作，因此“V1 历史上未改动”的结论来自归档 Task scope/evidence与当前代码边界，未在本子审计中重放历史 diff；main session 的 clean-main/归档提交前置检查负责补足 Git 证据。
- Browser trace、video、Playwright report 与 real-stack shell 脱敏不在本 backend 文件范围；这里只确认 response/error/access-log/backend-test 边界。E2E 研究必须单独给出 trace/video/report 结论。
- 未发现 backend P0/P1 blocker。若不采纳 B08，必须在最终 design 中明确其是有意保留的 response invariant assertion，并接受排序合同需双点同步的 P2 维护成本；不要为消除它新增共享 helper/module。
