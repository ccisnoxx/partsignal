# Frontend V2 逐路由功能合同一致性矩阵

审计日期：2026-08-30（Asia/Shanghai）。

范围：Frontend V2 37 条 canonical 路由、对应 backend 权威实现、OpenAPI/generated client 和当前测试。

性质：静态只读审计 + 已有运行证据复核；本文件不代表已执行全套测试或生产写验证。

## 0. 2026-09-03 最终收尾快照

下表的逐路由结论保留 2026-08-30 审计时点事实；本节记录之后由独立 Task 形成的处置结果，不把历史缺口改写为“从未存在”。当前只读核对确认 37 条 canonical 路由仍全部存在，默认 `make contract-check` 已覆盖冻结 OpenAPI 与 FastAPI runtime 的完整 response 合同，generated client 只读再生成零漂移。

| 原始发现 | 最终处置 | 证据 |
|---|---|---|
| 发布换版后可复用旧登记结果核验新内容（P0） | 已由独立 Task 关闭；read model 与 command guard 共享换版后重新登记资格 | `4a7979e8` |
| `/geo/topics` 显式合法 `page_size` 返回 422（P1 blocker） | 已关闭；真实 FastAPI HTTP 边界覆盖 10/20/50、默认 20 和非法值 422 | `5add828a` |
| GEO optimization 可在锁外复算并落库 stale basis（P1） | 已关闭；复算进入统一资源锁域，并以真实 PostgreSQL 并发测试证明 | `15250902` |
| Content Editor `SUBMIT_REVIEW` 409 恢复不一致（P1） | 已关闭；统一 conflict owner，仅显式 reload 成功后采用 canonical context | `56f92699` |
| Platform/Profile/Account/User 删除 Dialog 保存陈旧投影（P1） | 已关闭；本地仅保存稳定 ID，展示、资格和 revision 从当前 exact query projection 派生 | `abd41e1c` |
| Audit 未知 action 击穿整页（P1） | 已关闭；坏行和坏筛选项局部严格失败，不泄漏未知 token | `180d0ad3` |
| contract checker 忽略非 2xx 和部分 HTTP method（P1） | 已关闭；默认门禁比较完整 status/media/Header/schema/Link，并覆盖八种 OpenAPI operation method | `000a0d27`、`b2bc3c68` |

六个直属子任务均已归档为 `completed`，parent 关系正确。`publication-verification-final-authority` 是原矩阵推荐的首个独立 P0 Task，不是父 Task 的直属 child，但同样已归档完成。

后续线上只读验收仍保留 2026-08-30 的 `FAIL`、`NOT_RUN` 和 `BLOCKED` 证据；其后独立完成的移动触控目标/审计空态修复 `78635bdb` 与 Prompt 名称单独编辑保存状态修复 `6a3dd72d` 不反向改写该验收结果。矩阵中其余合同决策、P1/P2/P3 和测试收口建议没有因本父 Task 归档而自动完成。`integrity-error-domain-mapping` 按用户要求继续暂缓，未创建、未启动。

## 1. 读表说明

### 1.1 证据层级

- `U`：frontend model/component test。
- `F`：fixture Playwright E2E；证明 production artifact 与前端交互，不证明真实 backend binding。
- `R`：真实栈 Playwright。
- `B-H`：backend HTTP/router integration。
- `B-S`：backend service/PostgreSQL integration；不证明 HTTP query 参数绑定。
- `C`：OpenAPI/generated 静态合同。

### 1.2 共用边界

- 37 条文档 canonical 路由均存在；未发现 canonical URL 缺失。route tree 见 `frontend/src/routeTree.gen.ts`。
- 所有 `/_app` 路由统一经过认证与 `must_change_password` gate：`frontend/src/routes/_app/route.tsx`。管理员路由统一经过 `frontend/src/routes/_app/_admin/route.tsx`，前端 403 只作 UX boundary，服务端仍为最终权限 owner。
- API DTO 从 `frontend/src/shared/api/generated/schema.d.ts` 引用；生产代码除服务端签名文件传输 URL 外未发现 raw API 旁路或第二套 response DTO。
- 初始审计时 generated schema 与 `contracts/openapi.yaml` 的只读再生成 diff 为零，二者均有 128 个 path；backend runtime operation map 与冻结合同共有 162 个 `(path, method, operationId)`。当时 checker 只比较请求和首个 2xx response；该缺口后来由 `non-2xx-contract-check` 及方法覆盖修复关闭，当前默认门禁比较每个 operation 的完整 response contract。

### 1.3 严重度

`P0` 数据完整性/不可变历史风险；`P1` 主流程阻塞或最终权威/并发合同缺口；`P2` 明确但可恢复的一致性偏差；`P3` 元数据/文案/验证粒度；`符合` 表示本轮未发现独立实质缺口。

## 2. Auth 与 Workbench

| 路由 / Pattern | 文档业务目标 | 当前实现 / API read model | stage / primary / actions 来源 | 前端推导或接口拼接 | URL 与 loading / empty / error / conflict / permission | immutable / readonly | 现有测试 | 结论、严重度、后续 Task |
|---|---|---|---|---|---|---|---|---|
| `/login` / Form | 建立 session；保留合法 return-to；强制改密优先 | `POST /api/v1/auth/login` → `AuthSession`；成功后刷新 `/auth/me` 与 `/auth/csrf` | `must_change_password`、account type 均来自 session；本页无资源 action projection | 无业务拼接；`approvedReturnTo` 只做站内 URL 安全约束 | `redirect` 由 route schema 持有；loading/error 有表面；匿名可访问 | 密码只在本地 secret form，不进 URL/query cache | U `login-page.test.tsx`；F `auth-session.spec.ts`；R `auth-session-real-stack.spec.ts`；B-H `test_identity_management.py` | `P2`：Auth owner 把 `ErrorEnvelope` 压成普通 Error，丢失 code/request_id/field errors。Task `auth-error-envelope-projection` |
| `/account/security` / Form | 强制或主动改密；成功后以服务端 session 决定是否解除 gate | `POST /api/v1/auth/change-password`，随后 `/auth/me` + `/auth/csrf` | `must_change_password` 只从刷新后的 session 读取 | 无推导；不在浏览器直接清 flag | route 区分 auth loading/error/anonymous；成功 replace `/` | 新旧密码不持久化 | U `account-security-page.test.tsx`；F/R auth session；B-H identity | 同上 `P2`，与 `/login` 共用 `auth-error-envelope-projection`，不拆第二 Task |
| `/` / Workspace-Inbox | 一次性呈现全局计数、待办、系统健康和 GEO 摘要 | `GET /api/v1/workbench` → `WorkbenchAggregate` | aggregate 内 task/href/health 为服务端投影；页面无 mutation | 无跨域 waterfall；只补展示 label，合法 0 与 null 分开 | canonical `/`；initial loading/error、attention empty；已有 data 后刷新失败无 notice | 只读 aggregate | U `workbench-page.test.tsx`；F `workbench.spec.ts`；R auth/publication；B-H/S `test_workbench.py` | `P3`：stale refresh 可见性；可并入 `readonly-surface-stale-state`，不阻塞主线 |

## 3. Product 与 Content

| 路由 / Pattern | 文档业务目标 | 当前实现 / API read model | stage / primary / actions 来源 | 前端推导或接口拼接 | URL 与 loading / empty / error / conflict / permission | immutable / readonly | 现有测试 | 结论、严重度、后续 Task |
|---|---|---|---|---|---|---|---|---|
| `/products` / Table | 搜索、筛选产品并从服务端任务投影进入下一步 | `GET /api/v1/products` → Product list items | `workflow_stage/primary_task/available_actions/deletion` 直接来自 item；registry 只映射 token | 无逐行请求；不按 status/role补动作 | q/stage/status/page/pageSize/sort canonical；loading/empty/filtered/error/stale/越界；409 mutation 不重放 | 非历史页；删除由服务端实时复核 | U `products-list-page.test.tsx`；F `products-list.spec.ts`；R product/content；B-S publication workflow | `P2`：删除 blocker 只有 type/count，缺精确下钻 URL；Dialog focus 需运行核验。Task `product-deletion-blocker-navigation-and-focus`，依赖 blocker→canonical filter 决策 |
| `/products/new` / Form | 创建最小 Product 并进入 canonical Detail | `POST /api/v1/products` → Product | 无资源 action；服务端校验唯一性 | 无拼接/默认产品事实 | 无业务 search；表单 loading/error；成功按 canonical id 导航 | 非历史页 | U `new-product-page.test.tsx`；F `new-product.spec.ts`；R product facts；B-S creation | `符合`；现有合同不要求 Idempotency-Key |
| `/products/$productId` / Detail | 查看产品摘要并按服务端动作编辑、进入 facts 或处理删除 | `GET /api/v1/products/{id}/detail` → `ProductDetail`；PATCH/DELETE 带 revision | detail 的 primary/actions/deletion 为唯一资格源 | 单 detail，无列表回查或跨接口 join | lowercase UUID/detail route error；update/delete 409 保留上下文并显式刷新 | 非历史页；slug/字段按合同编辑 | U `product-detail-page.test.tsx`；F `product-detail.spec.ts`；R；B-H `test_product_detail.py` | `P2`：复用删除 blocker 导航缺口；同 `product-deletion-blocker-navigation-and-focus` |
| `/products/$productId/facts` / Workspace | 维护 Product 当前事实草稿并提交审核 | `GET /api/v1/products/{id}/facts` → Fact Workspace context；PUT facts、POST submission | task/action 直接来自 context/version projection | 无 detail+history 拼接；mode/action registry 不计算资格 | direct URL；loading/error；save/submit 409 保留表单、显式 reload | 已批准 FactVersion 不原地改；Workspace 只编辑允许草稿 | U `fact-workspace-page.test.tsx`；F `fact-workspace.spec.ts`；R flow；B-H/S product detail | `符合`；route identity 额外断言仅为低风险测试建议 |
| `/products/$productId/facts/review` / Workspace | 审核 immutable fact snapshot | `GET .../fact-review-context`；approve/request-changes 命令带 revision | target `available_actions` 为唯一动作源 | 单 review context；不按 status补审核动作 | loading/error；409 refresh/no replay；权限由服务端命令复核 | Markdown/事实快照只读；审核记录 append-only | U `fact-review-page.test.tsx`；F `fact-review.spec.ts`；R；B-H/S | `符合` |
| `/products/$productId/facts/versions` / readonly Table | 查看 Product 事实版本历史 | `GET .../fact-history` → server-paged history | 无 business action；无 primary | 单 history read model；校验 product identity | page/pageSize canonical；loading/empty/error/越界 | 全表只读、无操作列 | U `fact-history-page.test.tsx`；F `fact-history.spec.ts`；R direct；B-H/S | `符合` |
| `/products/$productId/facts/versions/$versionId` / readonly Detail | 查看指定 immutable FactVersion | `GET /api/v1/fact-versions/{id}` | 无动作 | 单 detail；响应 `product_id` 与 URL 不一致即阻断 | UUID/detail loading/error/404；无 conflict | 明确只读不可变快照 | U `fact-version-detail-page.test.tsx`；F `fact-version-detail.spec.ts`；R direct；缺专用 B-H GET 测试 | 功能 `符合`；`P3` HTTP test gap，归 `functional-contract-test-closure` |
| `/content/tasks` / Table | 服务端筛选内容工作队列并进入当前主任务 | `GET /api/v1/content-tasks` → list items；filter option 读取平台列表 | item 的 workflow/primary/actions/deletion 直接消费 | 无逐行 Product/Version/Generation/Publication join；平台选项是允许的过滤数据 | q/workflowStage/archiveStatus/platformId/page/pageSize canonical；loading/empty/error/stale/越界 | archived 只读由服务端动作归零；删除实时复核 | U `content-task-list-page.test.tsx`；F `content-task-list.spec.ts`；R publication；B-S list | `P2`：删除 blocker 缺精确链接；legacy `/tasks` converter 固定 pageSize=10 与文档默认20不一致。Tasks `content-task-deletion-blocker-navigation`（依赖 filter 合同）与 `content-task-legacy-canonical-page-size` |
| `/content/tasks/new` / Form | 基于服务端 creation options 创建内容任务 | `GET /content-tasks/creation-options`；`POST /content-tasks` + Idempotency-Key | eligibility/options 均由 creation options；无浏览器补资格 | creation options 是批准的单一表单 read model；handoff 经服务端选项校验 | `productId` handoff canonical；loading/error/empty/blocked；409保留输入 | 新建页非历史；Markdown不在此生成第二正文 | U `new-content-task-page.test.tsx`；F `new-content-task.spec.ts`；R；B-H creation | `符合` |
| `/content/tasks/$taskId` / Detail-Workspace shell | 查看内容任务、当前阶段和服务端主动作 | `GET .../detail` → `ContentTaskDetail`；生命周期命令 | workflow/primary/actions/deletion 直接来自 detail | 单 detail；`readonly` status 只控制 Badge，不控制资格 | loading；403/404/generic 分离；409 lifecycle 保留并刷新 | archived/terminal 只读由服务端 projection 保证 | U `content-task-detail-page.test.tsx`；F；R publication；B-H | `P2`：删除 blocker 导航同 `content-task-deletion-blocker-navigation` |
| `/content/tasks/$taskId/editor` / 三栏 Workspace | 以 Editor Context 编辑 Markdown、生成/人化并提交审核 | `GET .../editor-context`；manual/revision/update/submit、generation job APIs | task/version primary/actions 与 job summary actions 为服务端来源 | 首屏单 context；活动 job 可按合同 secondary query；无 token+无 job 时仍显示 AI 区，终态 job query 语义有合同未决 | loading/error；save/delete/abandon 409进入统一显式 reload；`SUBMIT_REVIEW` 409只在 Dialog显示普通错误 | Markdown sole editable body；批准历史不改写 | U `content-editor-page.test.tsx`、AI tests；F `content-editor.spec.ts`；R content AI/publication；B-H/S | `P1`：submit-review 冲突恢复缺口，Task `content-editor-command-conflict-recovery`。`P2`：AI surface/tracking，Task `content-ai-production-surface-and-tracking-contract`，先决策 FAILED retry owner |
| `/content/tasks/$taskId/review` / Workspace | 审核 immutable ContentVersion | `GET .../review-context`；approve/request-changes 带 revision | actions 仅来自 context | 单 read model，无 status补动作 | loading/error；409 refresh/no replay；permission 由 backend | Markdown snapshot 只读、review append-only | U `content-review-page.test.tsx`；F `content-review.spec.ts`；R；B-H | 功能 `符合`；route title/error 英文为 `P3`，并入相关页面维护，不单开 Task |
| `/content/versions/$versionId` / readonly Detail | 查看不可变内容版本、生成与审核历史 | `GET /api/v1/content-versions/{id}` | 无 mutation/action | 单 detail；id mismatch 阻断 | loading；无 generation/review 显式 empty；403/404/generic 分离 | 全页 readonly；Markdown snapshot 单一来源 | U `content-version-detail-page.test.tsx`；F；R direct；B-H | `符合` |

## 4. Publishing

| 路由 / Pattern | 文档业务目标 | 当前实现 / API read model | stage / primary / actions 来源 | 前端推导或接口拼接 | URL 与 loading / empty / error / conflict / permission | immutable / readonly | 现有测试 | 结论、严重度、后续 Task |
|---|---|---|---|---|---|---|---|---|
| `/publishing/work` / Queue + Table | 查看发布总览、ready items 与工作列表，启动发布工作 | 三个文档批准的独立 read model：`publication-workbench-summary`、`publication-ready-items`、`publication-works` | rows/actions 均为服务端 projection；START token + Idempotency-Key | 三个独立区块不是客户端业务 join；不从 status补 START | URL filter/page canonical；initial loading/empty/error；已有缓存后任一区块 refetch error 会隐藏旧数据 | 非历史页；仅浏览未修改内容 snapshot | U `publication-work-page.test.tsx`；F `publication-work-list.spec.ts`；R workspace；B-H/S | `P2`：cached refetch error。Task `publishing-work-cached-refetch-error` |
| `/publishing/work/$workId` / Workspace | 准备、登记、核验、换版或关闭一个发布工作 | `GET .../workspace-context`；preparation/platform-review/result/verification/content-version/close commands | 前端动作从 `available_actions`；但 backend `publication_work_actions` 与 verify command guard 不共享完整换版资格 | 前端单 workspace context；页面少量说明从 raw status 分支，不控制按钮 | UUID/hash canonical；loading/error；409 stale + explicit reload；服务端 permission | publication package/Markdown/timeline只读；verification/event/PublishedArticle append-only | U `publication-workspace-page.test.tsx`；F；R full flow；B-H/S | **`P0`**：换版后可用旧 result 核验新 version，形成错误 immutable verification/PublishedArticle。首个 Task `publication-verification-final-authority`。另 `P2` raw status 说明归 `publication-workspace-display-projection` |
| `/publishing/articles` / readonly Table | 浏览不可变发布成果 | `GET /api/v1/published-articles` | 当前页面不提供 row action；OpenAPI item 存在更多 primary/actions/deletion 语义 | 单 list，无 join | URL q/platform/page canonical；loading/empty/error，后台失败保留缓存 | 列表按 V2 蓝图只读 | U `published-article-list-page.test.tsx`；F；R；B-H/S | **合同冲突 `P1`**：页面蓝图只读，但 OpenAPI 暴露 GEO/history/permanent delete 投影。先做 `article-v2-capability-contract-decision`，不得由前端猜 |
| `/publishing/articles/$articleId` / readonly Detail | 查看成果快照并移交内容问题 | `GET /published-articles/{id}`；当前仅消费 `OPEN_ISSUE` command | OPEN_ISSUE 来自 token；其余 OpenAPI actions 被忽略 | 单 detail；无跨域 join | loading；初始403/404无无效retry；OPEN_ISSUE 409显式 reload | immutable published snapshot | U `published-article-detail-page.test.tsx`；F；R；B-H/S | 同上合同冲突 `P1`，依赖 `article-v2-capability-contract-decision` 后再决定实现/删减合同 |
| `/publishing/issues` / Table | 服务端筛选内容问题并进入修复流程 | `GET /published-content-issues` | primary/overflow 全从 item token | 单 list | status/page canonical；loading/empty/error/stale | issue list非历史，但成果内容只读 | U仅成功投影；F/R；B-S，缺 route HTTP | 功能 `符合`；状态测试薄弱 `P3`，归 `functional-contract-test-closure` |
| `/publishing/issues/$issueId` / Workspace | 查看只读成果、创建 repair task 或 resolve issue | `workspace-context` + 打开 Dialog 后 `repair-context` | primary/actions 从 server；mutation带 revision | 首屏单 context；repair options 按需，符合合同 | UUID/hash canonical；loading/error；409 explicit reload | published content只读；issue历史保留 | U/F/R；B-S | `符合` |

## 5. GEO

| 路由 / Pattern | 文档业务目标 | 当前实现 / API read model | stage / primary / actions 来源 | 前端推导或接口拼接 | URL 与 loading / empty / error / conflict / permission | immutable / readonly | 现有测试 | 结论、严重度、后续 Task |
|---|---|---|---|---|---|---|---|---|
| `/geo/observations` / Table | 服务端筛选观测链并进入 detail/correction/delete | `GET /geo-observations/list-items` | list合同只要求 `available_actions`；前端不补 workflow/primary | 单 list；无逐行 detail | q/product/platform/topic/date/page/sort canonical；loading/empty/error/stale；delete 409 | 历史链 append-only；整链永久删除仅 ADMIN 例外 | U `geo-observation-list-page.test.tsx`；F；R；B-H/S | `符合` |
| `/geo/observations/new` / Workspace Form | 基于 eligible publications 和 topics 创建观测 | product search + `/query-topics` options + `/geo-observation-publications`，再 POST observation | creation eligibility由 options endpoint；无资源 action | 文档明确许可的表单 options 组合，不是业务 snapshot join | handoff search；loading/error/empty/blocked；`GEO_PUBLICATIONS_CHANGED`保留输入、显式刷新 | 创建新 append-only root；附件走签名上传 | 无 page U，仅 model；F；R；B-S，无专用 B-H create | 功能 `符合`；测试 gap `P3`归 `functional-contract-test-closure` |
| `/geo/observations/$observationId` / readonly Detail | 查看当前 tail、修订链、证据和可用纠正/删除入口 | `GET .../{id}/detail` | tail primary/actions直接来自 detail | 单 detail，校验 chain identity | UUID/tail canonical；loading；403/404/409区分标题但均显示 retry | 全历史 readonly/append-only | U/F/R；B-H/S | 核心 `符合`；403/404无效 retry为 `P3`，归 `readonly-error-state-normalization` |
| `/geo/observations/$observationId/correct` / Workspace | 对 tail 追加 correction，保留冻结上下文和 dirty草稿 | `GET .../correction-context`；POST correction | eligibility/context来自 server | 单 correction context；route canonical 到 tail | route-level pending/error；409 stale、显式 reload并 replace canonical；dirty guard | 追加新版本，不原地改历史 | U/F/R；B-H/S | `符合` |
| `/geo/insights` / Analytics Workspace | 一次性读取洞察并在当前事实基础上创建优化任务 | `GET /geo-insights`；`POST /geo-insights/optimization-content-tasks` | read model的 primary/optimization action来自服务端 | 首屏单 insights；Dialog 按需 creation options | 7个 search params canonical；loading/error/stale；409保留输入 | insights只读；优化命令写 ContentTaskGeoSource basis snapshot | U/F/R；B-S | **`P1`**：命令在默认 READ COMMITTED 下复算后才进入 Product 锁域，可落库 stale basis。Task `geo-optimization-source-serialization` |
| `/geo/insights/print` / Print | 用同一筛选和 read model打印只读洞察 | 同 `GET /geo-insights` | 同上但无动作 | 无额外 API | 与主页 search canonical；print layout；只读 | 纯 readonly | U/F；无独立 R；backend同 insights | `符合`；真实栈 print缺口归 test closure，不单开功能 Task |
| `/geo/topics` / Table | 管理 Query Topic、查看引用并用于 Observation | `GET /query-topics/list-items`；CRUD；完整 `/query-topics`仅用于 options/冲突 reload | item primary/actions/deletion/references均来自服务端；不按引用数推 DELETE | 列表与完整 options职责分离；无资格推导 | URL q/sort/page/pageSize canonical；当前任何显式 page_size 10/20/50 均在 FastAPI binding 422，首次加载和重试被阻断 | Topic 可编辑；引用与删除投影必须随 server最新状态 | model U，无 page U；F fixture；无 R；B-S绕过HTTP | **已知 `P1 blocker`**：`planning.py` 缺 `BeforeValidator(int)`，Task `query-topic-list-page-size-http-parsing-blocker`。另有 `P1`：冲突 reload可能命中30秒 fresh cache、Dialog保存整行快照；分别 Tasks `query-topic-conflict-network-reload`、`query-topic-dialog-live-projection`，均在HTTP blocker后验收 |

## 6. Settings、System

| 路由 / Pattern | 文档业务目标 | 当前实现 / API read model | stage / primary / actions 来源 | 前端推导或接口拼接 | URL 与 loading / empty / error / conflict / permission | immutable / readonly | 现有测试 | 结论、严重度、后续 Task |
|---|---|---|---|---|---|---|---|---|
| `/settings/platforms` / Table | 搜索平台 profile、查看 readiness并执行服务端允许的管理动作 | `GET /platform-profiles` | item primary/actions/deletion直接消费；`isAdmin`只显示类型入口 | 单 list，无 role补动作 | q/type/status/config/page canonical；loading/empty/error/stale；focus refresh | ENGINEER投影只读由server actions归零；slug不在列表改 | U `platform-list-page.test.tsx`；F；无R；B-H/S | **`P1`**：blocker Dialog保存完整行快照，focus refresh后不采用最新 deletion/actions。Task `fresh-deletion-projection-dialogs` |
| `/settings/platforms/types` / Settings Table | ADMIN维护 Platform Type及删除引用条件 | `GET /platform-types` + CRUD | primary/actions/deletion来自 server；ADMIN route + backend permission | 单 list，无拼接 | route 403；loading/empty/stale/error；409 reload | 类型可编辑，历史引用由删除规则保护 | U/F；无R；B-H/S | **`P1`**：同 deletion snapshot不变量，归 `fresh-deletion-projection-dialogs`。`P3` breadcrumb父层缺失归 `route-navigation-metadata-conformance` |
| `/settings/platforms/$platformId` / Tab Workspace | Overview配置、Accounts管理、Generation绑定 | 首屏 `GET /platform-profiles/{id}`；active tab按需 `/platform-accounts`、prompt options | profile/account actions与deletion均来自 server；`isAdmin`不授予写资格 | 文档允许的active-tab secondary queries；非无条件 waterfall | UUID/tab canonical；detail initial/stale error；Accounts/Prompt已有data后error会隐藏旧surface；accounts无focus refresh | profile slug readonly；Prompt Markdown不在本页编辑；secret不回显 | U/F；无R；B-H/S | **`P1`** Accounts blocker快照且无focus refresh，归 `fresh-deletion-projection-dialogs`。`P2` secondary stale处理归 `configuration-secondary-stale-state` |
| `/settings/prompts` / List + Workspace | ADMIN管理唯一Markdown Prompt并执行真实Preview | list/detail/preview-options按URL选择；CRUD/preview commands | detail actions来自server；未知token显式失败 | q对已加载library本地过滤为文档允许；detail/options按需 | q/promptId/new canonical；list/detail loading/empty/error/stale；409保留草稿显式reload | Markdown sole source；无UPDATE时readonly；历史生成不回写 | U/F；R AI config；B-H/S | `符合`；fixture缺unknown-request sentinel归 test closure |
| `/settings/ai` / Table | ADMIN查看安全Channel summary并进入配置 | `GET /ai-channels` → summaries；CRUD/enable/disable/delete | primary/actions/deletion来自server | 单安全list，不读取base URL/header/secret/models | q/status/provider/sort/page canonical；loading/empty/error/stale；409 | 不显示credential/header value | U/F；R；B-H/S | `符合`；fixture sentinel gap归 test closure |
| `/settings/ai/$channelId` / Tab Workspace | 配置channel、headers/models并查看usage/logs | detail + active tab的models/usage/audit endpoints | detail/model/header actions均为server projection | 当前为4个独立刷新面板；是否要求同一snapshot尚未冻结 | UUID/tab/period/page canonical；secondary区块多有stale notice，但detail refetch error静默且无focus refresh | protocol readonly；credentials replacement-only、gcTime0；audit只读 | U/F；R full flow；B-H/S | `P2` detail stale归 `configuration-secondary-stale-state`。`P2` nullable actor历史丢失 Task `ai-channel-audit-null-actor`。同快照要求先做 `ai-channel-workspace-read-contract-decision` |
| `/system/users` / Server Table | ADMIN服务端筛选用户并执行单项/批量命令 | `GET /users` + create/update/reset/delete/bulk/export | user primary/actions/deletion/revision来自server；不按account/status补资格 | 单 list；selection只保存id/username/revision并绑定query scope | q/accountType/status/page canonical；loading/empty/error/stale；409；ADMIN boundary | 临时密码只在一次性secret dialog；Audit历史删除actor置null | U/F；R；B-H/S | **`P1`**：删除条件Dialog仍保存完整User快照，归 `fresh-deletion-projection-dialogs`。copy差异 `P3` |
| `/system/audit` / Table + Detail Pane | ADMIN检索append-only审计，未知shape局部安全失败 | list/filter-options/detail三个只读 GET | 无业务mutation；action label registry只负责安全展示 | 无Users/业务对象join；detail按需 | 完整filter+logId canonical；list/options/detail独立loading/error；未知list action当前抛至route error | append-only，只投影allowlist字段，不显示raw JSON | U/F；R；B-H/S | **`P1`**：未知合法action击穿整页，不符合“局部显式失败”。Task `audit-list-projection-failure-isolation` |

## 7. 逐路由之外的权威合同缺口

| 缺口 | 事实与影响 | 严重度 | 独立 Task |
|---|---|---:|---|
| 任意 `IntegrityError` 都映射为 `REVISION_CONFLICT` | `backend/app/errors.py` 全局伪装唯一/外键/CHECK等约束；客户端会按“刷新revision”错误恢复，真实业务原因被隐藏 | P1 | `integrity-error-domain-mapping` |
| contract checker忽略非2xx | 当前工具只比较首个2xx；冻结合同与runtime OpenAPI在401/403/404/409响应集合已有代表性漂移仍全绿 | P1 | `non-2xx-contract-check`；可与上项并行，先完成更利于后续修复门禁 |
| AI test/discovery历史与数据库合同冲突 | `contracts/database.md`要求append-only channel history包含test/discovery结果；实现与审计白名单不记录，测试甚至冻结失败不审计 | P1合同决策 | `ai-operation-history-contract-reconciliation`；先定合同，再拆实现 |
| AI channel audit过滤nullable actor | 全局Audit允许删除用户后actor为null保留历史，channel history却过滤actor null | P2 | `ai-channel-audit-null-actor` |
| route metadata与IA差异 | Content legacy pageSize=10、动态breadcrumb缺identity、Platform Types hierarchy与文档label/order差异 | P2/P3 | `content-task-legacy-canonical-page-size` 与 `route-navigation-metadata-conformance` 分开 |
| 测试层级缺口 | GEO topics/new无page U，多个route仅B-S无B-H，四类fixture允许fallback，若干真实栈direct URL缺失 | P3 | 所有功能修复稳定后执行 `functional-contract-test-closure` |

## 8. 已知 `/geo/topics` 阻塞项冻结

### 8.1 根因

`backend/app/routers/planning.py:list_query_topic_items` 当前参数是：

```python
page_size: Annotated[QueryTopicPageSize, Query()] = 20
```

FastAPI收到查询字符串 `"20"` 后在 `Literal[10, 20, 50]` 校验前没有转换为整数；合法显式值因此返回 422。相邻已修复的 GEO Observation owner 使用：

```python
page_size: Annotated[GeoObservationPageSize, BeforeValidator(int), Query()] = 20
```

OpenAPI、generated type、前端数值映射与 service分页均正确；错误仅在HTTP router binding。前端每次都显式发送 `page_size`，所以列表首次加载、搜索、排序、翻页和重试都被阻断。

### 8.2 已有运行证据

- 已部署只读请求 `GET /api/v1/query-topics/list-items?sort=QUESTION_ASC&page=1&page_size=20` 两次返回 422；最终请求 ID `1651e80e-3374-4b48-891b-376c546fadfc`，证据在 `artifacts/deployed-acceptance/20260830-195237-v2-auth-final/acceptance-report.md`。
- 本地只读 TestClient 复现：省略 `page_size` 为200；显式10/20/50均422，error loc为`query/page_size`且input为字符串`"20"`。
- service integration直接传Python int，fixture把URL值自行 `Number(...)` 后固定200，GEO real-stack未访问该列表，因此现有测试未挡住。

### 8.3 独立修复 Task 验收

Task：`query-topic-list-page-size-http-parsing-blocker`。只修改 backend router 参数绑定和真实HTTP边界测试；不得修改OpenAPI、generated、frontend、service、database或用前端省略参数规避。

1. 显式 `page_size=10/20/50` 均由实际FastAPI router解析为对应Python `int`并返回200 `QueryTopicListPage`。
2. 省略参数继续使用整数默认20。
3. 非枚举值继续返回冻结的422 `VALIDATION_ERROR`，不得放宽枚举。
4. 采用既有 `BeforeValidator(int)` 模式，不增加wrapper或兼容字段。
5. 新TestClient测试必须经过真实router binding，只override DB/auth/service collaborator，不得直接调用service代替HTTP。
6. runtime OpenAPI与冻结静态合同测试继续通过，OpenAPI/generated内容不变。
7. 定向ruff、mypy和新HTTP回归通过。
8. 部署后以同一只读URL验证首次加载和一次显式重试不再422，展示合法列表或空态。

## 9. 后续 Task 依赖顺序

以下表格保留初始审计提出的依赖计划；已关闭项和继续暂缓项以本文件第 0 节为准。未出现在直属 child 列表中的建议仍只是独立后续候选，不因本父 Task 完成而被创建或启动。

### 9.1 执行序列

| 顺序 | Task | 目标 | 依赖 |
|---:|---|---|---|
| 1 | `publication-verification-final-authority` | 封住换版后旧结果核验新内容的服务端最终权威 | 本基线 review；无API shape/DB migration依赖 |
| 2 | `query-topic-list-page-size-http-parsing-blocker` | 关闭当前可复现 `/geo/topics` 422 | 无代码依赖；部署后复验为关闭条件 |
| 3A | `geo-optimization-source-serialization` | 锁内复算GEO来源，禁止stale basis落库 | 冻结与ContentTask一致的 `PlatformProfile → Product → FactVersion` 锁序 |
| 3B | `content-editor-command-conflict-recovery` | 让SUBMIT_REVIEW复用统一409显式reload | 无外部合同依赖 |
| 3C | `fresh-deletion-projection-dialogs` | 平台/类型/账号/用户Dialog以ID从最新query派生 | 现有deletion/actions合同；不依赖API变更 |
| 3D | `audit-list-projection-failure-isolation` | 未知action仅局部安全失败 | 先确认row级失败表面，不扩OpenAPI enum |
| 3E | `non-2xx-contract-check` | 冻结所有operation错误响应集合/shape | 无业务实现依赖 |
| 3F | `integrity-error-domain-mapping` | 已知constraint在service owner映射，未知显式失败 | 建议接入3E的新门禁；不与3E合并 |
| 4A | `query-topic-conflict-network-reload` | 409显式reload保证网络读取canonical状态 | Task 2完成，页面可真实加载 |
| 4B | `query-topic-dialog-live-projection` | Topic Dialog从最新list data派生 | Task 2完成；可与4A独立review |
| 4C | `publishing-work-cached-refetch-error` | 保留三个区块已有data并提示后台失败 | 无合同变更 |
| 4D | `configuration-secondary-stale-state` | Accounts/Prompt options/AI Detail统一stale surface | 无合同变更 |
| 4E | `auth-error-envelope-projection` | 登录/改密保留code/request_id/field errors | 现有OpenAPI ErrorResponse |
| 5A | `article-v2-capability-contract-decision` | 统一Article蓝图与OpenAPI action/delete能力 | 决策后再建具体backend/OpenAPI/frontend实现Task |
| 5B | `ai-operation-history-contract-reconciliation` | 决定test/discovery是否进入append-only历史 | 决策后再同步DB文档/审计/OpenAPI/测试 |
| 5C | `content-ai-production-surface-and-tracking-contract` | 隐藏无能力空面板并冻结FAILED retry owner | 先冻结terminal job read model语义 |
| 5D | `deletion-blocker-navigation-contract` | 冻结blocker type到精确canonical filter URL | 完成后分别建Product与ContentTask导航实现Task |
| 5E | `ai-channel-workspace-read-contract-decision` | 明确4面板独立刷新或统一snapshot | 仅决策，不顺手建context endpoint |
| 6 | P2/P3局部任务 | metadata、readonly error、nullable actor、legacy pageSize | 不阻塞P0/P1 |
| 7 | `functional-contract-test-closure` | 补page U、B-H、sentinel、必要真实栈direct URL | 依赖相关功能与合同决策稳定 |

### 9.2 可并行边界

顺序1必须最先实施。顺序2紧随其后关闭现网可复现阻塞。3A–3F彼此可独立评审，但都不得夹带4–7的前端体验或测试清理。合同决策5A/5B/5C/5D/5E只冻结语义，不与实现混在同一Task。

## 10. 推荐的第一个实施 Task

### Task

`publication-verification-final-authority`

最终状态：已完成并归档，工作提交为 `4a7979e8`。

### 唯一评审目标

发布工作切换 `content_version_id` 后，旧的登记结果立即失效；服务端read model和verification command共享同一资格不变量，只有新的 `RESULT_REGISTERED` 才重新开放 `VERIFY`。不改变OpenAPI shape，不修改数据库结构，不处理其他Publication UI或P2错误态。

### 精确验收标准

1. `publication_work_actions` 对任意非终态 status，只要最新业务事件为 `CONTENT_VERSION_CHANGED` 且其后没有新的 `RESULT_REGISTERED`，都不得返回 `VERIFY`，唯一 `primary_task` 为 `REGISTER_RESULT`。
2. `verify_publication_work` 在持有PublicationWork锁后执行同一资格检查；即使旧 `actual_title/final_url/published_at` 非空，也必须返回HTTP/service `409 INVALID_STATE_TRANSITION`，不得仅依赖UI隐藏。
3. 拒绝路径不得新增 `PublicationVerification`、`PublicationWorkEvent`、`PublishedArticle` 或AuditLog，不得改变Work/ContentTask status、revision、`content_version_id`、current pointers或旧结果字段。
4. 对 `AWAITING_VERIFICATION` 和 `ACTION_REQUIRED` 两种换版前状态各有一条直接命令负向PostgreSQL integration；至少一条通过真实HTTP endpoint验证error envelope的status/code/request_id。
5. 新登记结果后，最新事件为 `RESULT_REGISTERED`，read model重新返回 `VERIFY`；使用当前content version和新结果核验PASSED时，现有原子完成、immutable verification和PublishedArticle行为保持不变。
6. 现有“换版→无VERIFY→重新登记→恢复VERIFY”测试保留；新增测试不能只断言按钮或read model，必须直接尝试命令。
7. 必需验证：定向publication unit/integration、相关ruff、mypy、runtime OpenAPI frozen operation check。OpenAPI/generated/database migration无diff。
8. 最终diff仅限Publication action eligibility owner、verification command guard和定向测试；不夹带workspace copy、缓存错误、Article合同或GEO修复。

## 11. 审计限制

- 本轮未运行全套Vitest、Playwright、backend integration或真实并发测试；测试覆盖结论来自代码和现有用例清单。
- OpenAPI/generated同步和backend operation map一致，不等于业务语义、query binding或非2xx合同一致；本文件已单独列出这些缺口。
- `/geo/topics` 使用已有部署只读证据和本地HTTP边界复现；没有在本Task重新操作生产环境。
- 数据库trigger/migration未做全量实现审计；数据库结论限定为本次路由对应的service/ORM行为与`contracts/database.md`对照。
- 2026-09-03 父 Task 收尾只运行路由闭集、完整 contract/generated gate、Trellis 文档与 Git/归档关系轻量核对；没有重复运行各子任务已经通过的完整 Vitest、Playwright、backend integration、真实 PostgreSQL 并发或仓库级 `make verify`。
