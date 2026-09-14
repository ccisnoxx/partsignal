# Research: Content Task idempotency

> 决策状态：本文记录ContentTask分支审计和候选建议。最终综合矩阵受用户T5-C边界约束，未采纳“在T4-C同时修改GEO incoming与publication repair mapper”；以`research/contract-decision-matrix.md`为最终决策。

- Query: 审计 `content_tasks` 上 `uq_content_tasks_idempotency_key` 与 `uq_content_tasks_source_published_content_issue_id` 的写入者、并发路径、错误合同和后续实施拆分。
- Scope: internal
- Date: 2026-09-05

## Findings

### 结论摘要

这两项都是 PostgreSQL `UNIQUE` 约束，不应由全局 `IntegrityError` 处理器统一转换。当前工作树在 `backend/app/main.py:257-258` 只注册 `AppError` 与请求校验处理器；因此未捕获的 `IntegrityError` 仍由默认服务器错误边界处理，且 `backend/app/main.py:261-295` 仅保证响应头 `X-Request-ID`。后续映射必须在各自 command owner 的 `flush()` 附近局部捕获，只依据 `error.orig.sqlstate == "23505"` 和精确 `error.orig.diag.constraint_name`，其他约束（包括 FK、CHECK、NOT NULL、不可变 trigger）原样上抛。

`uq_content_tasks_idempotency_key` 的普通创建路径已经有事务级 advisory lock 和 lookup，正常同 key 并发不会到达数据库唯一冲突；但 GEO 优化创建也写入同一列并使用同一 advisory lock 前缀，且两边的 canonical identity 比较不对称。因此实现任务必须把“普通内容任务”和“GEO 优化任务”视为不同 command/source kind：普通任务不能 replay GEO 任务，GEO 任务也不能 replay 普通任务；跨 command 重用同 key 应稳定返回既有 `IDEMPOTENCY_CONFLICT`。

`uq_content_tasks_source_published_content_issue_id` 是发布内容问题到修复任务的唯一绑定。`create_repair_task` 已有行锁与 precheck，正常重复请求稳定返回既有 `REPAIR_TASK_EXISTS`；数据库映射只是对绕过问题行锁的竞争写入提供防御性等价结果，不应发明第二个错误码或 replay 任意已有修复任务。

## Authoritative owners and transaction evidence

### 普通内容任务

- `backend/app/services/content_planning.py:426-465` 的 `create_content_task` 是普通 Content Task command owner。它先在 `content-task-create:{idempotency_key}` 上执行 `pg_advisory_xact_lock`（`436-439`），再按 `idempotency_key` lookup（`440-443`）。已存在任务的三个 identity 字段（`product_id`、`fact_version_id`、`platform_profile_id`）全相同则直接返回既有对象（`450`），任一不同则抛 `AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一内容任务创建请求", 409)`（`444-449`）。
- 未命中后以固定顺序锁定平台、产品和事实版本：`lock_content_task_creation_resources` 在 `backend/app/services/content_planning.py:371-399` 中通过 `lock_active_platform` 锁平台，随后对 Product 和 FactVersion 使用 `FOR UPDATE`（`376-396`），并检查活动产品、批准且非空事实和产品归属（`381-399`）。
- `add_locked_content_task` 在 `backend/app/services/content_planning.py:402-423` 构造普通任务，明确写入 `query_topic_id=None` 和 `idempotency_key`（`409-419`），`db.flush()` 位于 `421-423`。`create_content_task` 仅在 `commit=True` 时 commit（`463-465`）；没有 revision 增量、`current_content_version_id` 指针、ContentVersion、ReviewRecord、AuditLog 或 dispatch 副作用。
- HTTP owner 是 `backend/app/routers/planning.py:284-306` 的 `POST /content-tasks`，operationId 为 `createContentTask`，成功状态 201，声明 401/403/404/409/422。它透传 `request.state.request_id`（`299-305`）和 `Idempotency-Key`（`291-298`）。
- `backend/app/db.py:31-40` 的 `get_db` 对请求异常 rollback 并关闭 session。局部映射如果在 flush 后捕获 `IntegrityError`，必须先读取结构化诊断，再 rollback；否则 SQLAlchemy session 不能继续查询 winner。`backend/app/errors.py:40-53` 将 `AppError` 序列化为 `code/message/details/request_id`，`main.py:261-295` 同时写 `X-Request-ID`。

### GEO 优化 Content Task 交叉 owner

- `backend/app/services/geo_observation.py:2201-2234` 的 `create_geo_optimization_content_task` 同样对 `content-task-create:{idempotency_key}` 加 advisory lock（`2210-2213`）并 lookup 全表 `ContentTask.idempotency_key`（`2214-2217`）。它比较普通任务三字段外，还比较 `ContentTaskGeoSource` 是否存在及其 `rule_code/date_from/date_to/published_article_id/query_topic_id/geo_platform`（`2218-2231`）；任何差异返回同一个 `IDEMPOTENCY_CONFLICT`。
- GEO 未命中时复用 `lock_content_task_creation_resources`（`2239-2246`），通过共享 `add_locked_content_task` flush ContentTask（`2313-2319`），随后添加 `ContentTaskGeoSource` 并在同一事务 commit（`2320-2334`）。因此 source row 写入失败时，ContentTask 也必须 rollback，不能留下无来源的半成品。
- HTTP owner 是 `backend/app/routers/observation.py:381-406` 的 `createGeoOptimizationContentTask`（具体路由不属于本次 publication/GEO 约束扩展，但它是第一项唯一键的实际写入者）。
- 当前不对称点：普通 command 的 lookup 只比较三字段，不检查是否存在 `ContentTaskGeoSource`；所以在相同三字段下可能错误 replay GEO 任务。反向 GEO lookup 会因 `source is None` 而冲突。这个事实不能通过只修改 `content_planning.py` 的单一 caller 安全解决，必须在第一项实施任务中同时覆盖两个 command owner，或冻结一个由两者共同调用的最小 identity 判定（不得引入全局 registry、通用 mapper framework 或第二套错误类型系统）。

### 发布内容问题修复任务

- `backend/app/services/publication.py:886-950` 的 `create_repair_task` 是 `source_published_content_issue_id` 的 command owner。它先对 `PublishedContentIssue` `FOR UPDATE`（`895-897`），校验存在、revision 和 OPEN 状态（`898-903`），再 lookup 已绑定的 ContentTask（`904-910`）；命中即抛现有 `AppError("REPAIR_TASK_EXISTS", "该问题已经创建修复任务", 409)`，details 默认 `{}`。
- 之后校验发布上下文、产品、平台和批准事实（`911-936`），在 `937-946` 构造修复 ContentTask，写入 `source_published_content_issue_id=issue.id`，不写 `idempotency_key`；`db.add`/`flush` 在 `947-948`，commit 在 `949`。该 command 不修改 issue revision/status，不设置任务 current-content pointer，不生成 ContentVersion、ReviewRecord、AuditLog 或 dispatch。
- HTTP owner 是 `backend/app/routers/publication.py:757-782` 的 `createPublishedContentRepairTask`，成功状态 201，声明 401/403/404/409/422；该接口没有 `Idempotency-Key` header，故重复绑定语义是“已有修复任务错误”，不是按请求键 replay。
- `backend/tests/integration/test_publication_workflow.py:1633-1687` 已覆盖首次创建、source binding 和 workspace projection，但没有 duplicate/race 或真实 constraint diagnostic 覆盖。

## Constraint decision matrix

下表中的“当前顺序/真实 race”区分了正常 command 的锁序列与绕过应用锁的 PostgreSQL 竞争。所有映射均限定为精确 SQLSTATE 和 constraint name；同一 `flush()` 中命中其他 constraint 时必须保持 unknown。

| 约束（表/字段/最终名称） | 可触发 owner（service / operationId / worker） | 现有预检、锁、lookup 或 allocation | 当前顺序与真实 PostgreSQL race | 决策与精确公共合同 | 原子性与 worker | 后续测试、同步和 Task |
|---|---|---|---|---|---|---|
| `content_tasks.idempotency_key`；migration `0032_content_task_idempotency.py:15-23` 创建 `uq_content_tasks_idempotency_key`；ORM `backend/app/models/content.py:32-34,76`。字段 nullable，PostgreSQL UNIQUE 允许多个 NULL；普通任务写非空 key，repair/historical 任务可为 NULL。 | 普通：`content_planning.create_content_task`（`backend/app/services/content_planning.py:426-465`）/ `createContentTask`（`backend/app/routers/planning.py:284-306`）。共享表写入者还包括 GEO：`geo_observation.create_geo_optimization_content_task`（`backend/app/services/geo_observation.py:2201-2334`）/ `createGeoOptimizationContentTask`（`backend/app/routers/observation.py:381-406`）。无 ContentTask worker owner；generation worker 不写此表。 | 普通和 GEO 都先取得同一 advisory xact lock（普通 `content_planning.py:436-443`，GEO `geo_observation.py:2210-2217`）。普通 precheck 只比较三字段并 replay；GEO 比较三字段和 `ContentTaskGeoSource` source identity（`geo_observation.py:2218-2231`）。资源锁定顺序为 platform → product → fact（`content_planning.py:371-399`）。没有 version allocation。 | 正常同 key 请求在 advisory lock 上串行，后到者 lookup winner，故已有 integration 并发测试实际验证的是 advisory lock（`backend/tests/integration/test_content_task_creation.py:290-329`），不是 23505。若另一个 writer 不取得同一 advisory lock，或未来新增 writer 绕过该协议，两个 insert 可在 `flush` 竞争，失败者收到 `23505 + uq_content_tasks_idempotency_key`；不能依赖错误文本。已知 constraint 的 catch 必须 rollback 后重新 lookup winner：canonical identity 相同 replay，异 identity `IDEMPOTENCY_CONFLICT`；winner 缺失或诊断不是该 exact pair 原样上抛 unknown。 | 普通同 key 同三字段：复用既有 replay，HTTP 201，返回同一 ContentTask。普通同 key 异三字段：复用 `IDEMPOTENCY_CONFLICT`，HTTP 409，message **`幂等键已用于另一内容任务创建请求`**，details **`{}`**。跨普通/GEO command（即使三字段相同）必须冻结为异 source kind，返回同一 `IDEMPOTENCY_CONFLICT`，不能把 GEO 当普通任务 replay 或反之。错误信封由 `errors.py:40-53` 提供 `request_id`；响应头由 `main.py:286` 提供相同 `X-Request-ID`。不要新增 error code。 | 普通仅 flush 一个 ContentTask；replay 无 insert/flush side effect。GEO 的 ContentTask 与 ContentTaskGeoSource 在 `geo_observation.py:2313-2334` 同一事务；任一已知或 unknown IntegrityError 都 rollback 两者。没有 revision、task pointer、content/fact version、review record、AuditLog、dispatch；worker policy 不适用，禁止把 HTTP 409/replay policy 带入 generation worker。请求异常由 `get_db` rollback（`db.py:31-40`）；局部 catch 后查询 winner 前也必须 rollback。 | PostgreSQL integration：用真实 PG 制造绕过 advisory lock 的 duplicate race，断言 `orig.sqlstate=="23505"`、`orig.diag.constraint_name=="uq_content_tasks_idempotency_key"`；验证 winner 同 identity replay、异 identity 409、session rollback 后可复用、恰一行且无旁作用；另测同 flush 的 FK/CHECK/NOT NULL 仍 unknown。Service/HTTP：扩展 `test_content_task_creation.py:155-208,290-329`，覆盖 ordinary/GEO cross-command identity、201/409 body、request ID header。Frontend：普通页面现有 `new-content-task-page.tsx:141-168` 在 `IDEMPOTENCY_CONFLICT` 清 key、保留表单；需补 cross-command/API mapping contract test，GEO mapping `geo.api.ts:268-310` 的 409 stale 行为也要与冻结合同对齐。无 worker test。OpenAPI 已有 201/409 和开放 ErrorDetail code（`contracts/openapi.yaml:1899-1924`）；generated client 无 schema 变化，runtime metadata 无新增字段。需在实施中同步 `contracts/database.md:37`、`.trellis/spec/backend/database-guidelines.md:499-515` 与必要的 Frontend V2 幂等说明（当前 `docs/frontend-v2/05-business-actions-state-and-api-contract.md:137` 只说明普通流程），不应改 generated client。实施 Task：**`content-task-idempotency-domain-mapping`**。依赖 T1 unknown boundary 和本 T4-C 合同批准；这是推荐第一个实施任务，必须覆盖普通与 GEO 两个实际 writer。 |
| `content_tasks.source_published_content_issue_id`；ORM 字段 `backend/app/models/content.py:71-75`（`unique=True`），migration `backend/alembic/versions/0034_publication_workflow_redesign.py:716-728` 创建最终 `uq_content_tasks_source_published_content_issue_id`。 | `publication.create_repair_task`（`backend/app/services/publication.py:886-950`）/ `createPublishedContentRepairTask`（`backend/app/routers/publication.py:757-782`）。无 worker owner；publication/GEO downstream constraints 留在后续 T5-C，本行只处理修复任务来源唯一性。 | Issue `FOR UPDATE`（`publication.py:895-897`）与 source binding precheck（`904-910`）已经把同 issue 的正常请求串行化；不存在 idempotency key 或 version allocation。 | 正常并发中后到者等待 issue lock，随后 precheck 命中并返回既有 `REPAIR_TASK_EXISTS`，不触发数据库 unique。绕过 issue lock 的 writer 或未来遗漏锁的 writer 可能在 `flush` 触发 `23505 + uq_content_tasks_source_published_content_issue_id`；局部 catch 应 rollback 后抛 `REPAIR_TASK_EXISTS`。不能按 message/`str(error)` 判断，也不能把 source unique 误报成 generic 409 或 replay 任意任务；非该 exact pair 保持 unknown。 | 复用既有领域错误：HTTP 409，code **`REPAIR_TASK_EXISTS`**，message **`该问题已经创建修复任务`**，details **`{}`**，request ID 与 `X-Request-ID` 按 `errors.py:40-53`、`main.py:261-295`。不新增 code，不返回 201 replay，因为 repair operation 没有请求键且客户端需要重新载入 canonical workspace。前端 `published-content-issue-workspace-actions.tsx:109-208` 当前保留输入、标记 `contextStale` 并要求显式 reload；该行为应冻结为 duplicate source 的恢复策略。 | Issue 本身只读锁定、revision/status 不变；task insert 与 flush/commit 在一个 service transaction（`publication.py:937-950`）。没有 revision increment、task pointer、ContentVersion、FactVersion、ReviewRecord、AuditLog、dispatch；无 worker policy。`get_db` rollback 保障 HTTP 异常，但直接 service 调用的测试必须 rollback 后复用 session。 | PostgreSQL integration：真实竞争 source binding，断言 exact `23505`/`uq_content_tasks_source_published_content_issue_id`，只有一个 task，失败 transaction 可 rollback/reuse，issue revision/status 和其他历史不变；unknown constraint sentinel。Service/HTTP：扩展 `test_publication_workflow.py:1656-1671`，断言既有 `REPAIR_TASK_EXISTS`、409 envelope、request ID/header。Frontend：保留/补 workflow 409 stale + explicit reload 测试，不自动 replay。OpenAPI 已声明 409（`contracts/openapi.yaml:3568-3617`），ErrorDetail code 开放，generated client/runtime metadata 不需结构变化；需补 `contracts/database.md:301-305,327-337`、`.trellis/spec/backend/database-guidelines.md:425` 对既有 code 与 race fallback 的明确说明，Frontend V2 `docs/frontend-v2/05-business-actions-state-and-api-contract.md:213-215` 已基本表达恢复策略。实施 Task：**`content-repair-source-identity-domain-mapping`**。依赖 T1 与本 T4-C；可在第一项之后独立实施，或与第一项并行但必须各自 review。 |

## 领域错误合同与边界

### 复用的领域错误

1. `IDEMPOTENCY_CONFLICT`（既有 code）：HTTP 409；普通和 GEO 的 message 均冻结为 `幂等键已用于另一内容任务创建请求`；details `{}`；响应 body 的 `error.request_id` 和 `X-Request-ID` 必须匹配当前 request ID。恢复是保留用户表单、废弃冲突 key，并在下一次真正的新 command signature 提交时生成新 key；同一 canonical identity 的成功 replay 是 201，不产生新行。普通页面已经在 `frontend/src/domains/content/new-content-task-page.tsx:141-168` 清除该 key；GEO 页面在 `frontend/src/domains/geo/geo-insights-page.tsx:244-250,298-299` 还会将 409 视为 stale，实施时需明确两种 command 的 UI policy，不能把 HTTP request policy 传播给 worker。
2. `REPAIR_TASK_EXISTS`（service 已存在的既有 code）：HTTP 409；message `该问题已经创建修复任务`；details `{}`；request ID/header 同上。前端保留输入并要求显式 reload，以服务端 workspace 为准；不自动 replay。

### 必须保持 unknown 的情况

- 只要 `sqlstate` 不是 `23505`，或 `diag.constraint_name` 不是当前行的精确名称，就重新抛出原始 `IntegrityError`。
- 同一次 ContentTask flush 中的 FK、CHECK、NOT NULL、不可变 trigger 或其他未列名唯一约束均 unknown；禁止解析数据库 message、`str(error)`、driver 文本或猜测冲突字段。
- 当前工作树没有全局 IntegrityError → `REVISION_CONFLICT`；不要恢复这种全局兜底。

## 后续实施拆分与依赖

1. **`content-task-idempotency-domain-mapping`（推荐第一个）**：在普通 `create_content_task` 与 GEO `create_geo_optimization_content_task` 的实际写入边界建立最小局部 `23505 + uq_content_tasks_idempotency_key` 映射；统一 command/source-kind canonical identity；捕获后 rollback，再 replay winner 或抛现有 `IDEMPOTENCY_CONFLICT`。补真实 PostgreSQL race、服务/HTTP 和普通/GEO frontend contract tests。不得触碰 generation job、ContentVersion、FactVersion 或 publication/GEO 的其他约束。
2. **`content-repair-source-identity-domain-mapping`**：仅在 `publication.create_repair_task` 的 flush 边界处理 `23505 + uq_content_tasks_source_published_content_issue_id`，映射为既有 `REPAIR_TASK_EXISTS`；补真实 PG race、service/HTTP 和 issue workspace frontend tests。依赖第 1 项不影响业务语义，但建议第 1 项完成后实施，以先固定共享 ContentTask writer 的局部错误处理边界。
3. 父计划中的 generation job idempotency/worker source identity、Content Version identity/pending-approved、Fact Version identity/pending 应分别按稳定 command owner 继续拆成独立 implementation Tasks；本研究不把它们合并进 Content Task 任务。每个 task 都应单独冻结 worker policy，不能沿用 HTTP replay/409 假设。

## Contract/documentation impact

- `contracts/openapi.yaml` 的两个 operation 已声明 201/409，`ErrorDetail.code` 是开放字符串；复用既有码不需要 schema、generated client 或 runtime metadata 结构变化（普通 operation 位置 `contracts/openapi.yaml:1899-1924`，repair operation `3573-3617`）。如果要在 operation description 中写清 replay 与 duplicate-source 恢复，可作为 implementation 文档同步，但不应因本决策重生成 client。
- `contracts/database.md:37` 已描述普通 key nullable/unique 与 replay；`contracts/database.md:301-305,327-337` 描述发布问题来源绑定。需要补充跨 command source-kind identity、source unique 复用 `REPAIR_TASK_EXISTS` 和 exact diagnostic fallback，避免把文档写成“所有唯一约束都是 409”。
- `.trellis/spec/backend/database-guidelines.md:425,499-515` 已冻结普通幂等与不可改绑方向；应补上真实 race 的 rollback/re-query 规则与 GEO 交叉 owner。`.trellis/spec/backend/error-handling.md:128-138` 已对 generation 的结构化诊断给出 precedent，但不能因此建立全局 mapper/framework。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md:137` 已说明普通流程在 conflict 后换 key；`213-215` 已说明 issue repair 409 保留输入并显式 reload。需仅补充跨 command/shared table 的边界和 GEO 页面的一致性，不引入新的错误类型系统。

## Caveats / Not Found

- 本审计未运行 task.py、测试、数据库或浏览器；未修改业务代码、合同、稳定 spec、测试、数据库或生产数据。
- `backend/app/models/content.py:71-75` 的 ORM 外键声明 `ondelete="SET NULL"`，而 `0034_publication_workflow_redesign.py:716-723` 的 migration 创建 FK 使用 `ondelete="RESTRICT"`；这是已有 schema/model drift，不能在本 T4-C 通过猜测修复。它不改变本行唯一约束名，但 implementation/review 应先确认哪个是线上 authoritative behavior。
- `ContentTask` 的 `source_published_content_issue_id` 是 nullable 且模型使用 `unique=True`；PostgreSQL 对 NULL 不执行唯一冲突，故该约束只约束真实 repair binding。不要将历史/普通/GEO 空值误当成重复来源。
- 现有普通并发测试（`backend/tests/integration/test_content_task_creation.py:290-329`）验证 advisory lock 后的单行结果，不验证真实 `IntegrityError.diag.constraint_name`。现有 repair workflow 测试（`backend/tests/integration/test_publication_workflow.py:1656-1671`）验证首次绑定，不验证 duplicate/race。真实 PostgreSQL 测试环境和可控竞争入口仍需 implementation task 设计；不应为测试而削弱生产锁协议。
- 本文件只覆盖用户列出的两项 ContentTask 约束。publication/GEO 的其他约束、generation job、ContentVersion、FactVersion 约束留在父任务 T4-C 的其他 research/implementation 拆分；publication/GEO constraint expansion 仍属于后续 T5-C。
