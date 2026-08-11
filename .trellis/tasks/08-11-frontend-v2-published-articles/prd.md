# Frontend V2 Published Articles List + readonly Detail

## Goal

交付 Published Articles 的 canonical 列表 `/publishing/articles` 与只读详情 `/publishing/articles/$articleId`，让已认证运营人员能够从 Publication Workspace 的 `COMPLETED` 交接进入已核验发布成果，并在单次列表或详情读取中查看冻结发布结果、来源内容版本、首次成功核验、发布事件和可追溯 lineage。

## 用户价值

- 发布工作完成后有稳定、可复制、可刷新和可直接访问的成果入口，不再落到未注册路由。
- 列表可按服务端搜索、排序和分页扫描已核验成果，不在浏览器截取或过滤当前页。
- 详情明确区分 PublishedArticle、来源 ContentVersion payload 和成功 verification snapshot 的只读边界，且不通过多个全局接口拼接页面。

## 权威来源与现状审计

### 已确认事实

- `docs/frontend-v2/02-information-architecture-and-routing.md`、`03-page-and-workflow-blueprint.md` 与 ADR-009/011 已确认三组发布资源 URL；本任务只实现 PublishedArticle 的 List + Detail。
- `frontend-v2/src/domains/publication/publication-workspace-page.tsx`、Content Task Detail 与 Product Detail 已生成 `/publishing/articles/{id}` handoff；`PublishedArticle.id == PublicationWork.id`，但 `frontend-v2/src/routes` 尚未注册该 URL。
- `GET /api/v1/published-articles` 当前一次返回列表行所需的实际标题、最终 URL、来源内容标题/版本、平台/账号、发布时间、首次成功核验时间与健康投影；URL domain 可由合法 `final_url` 在展示层确定性解析，不需要新增合同字段。
- 列表当前只有 `page/page_size`，固定按首次成功核验时间倒序；没有服务端搜索或显式排序合同。V1 也只做固定分页。
- `GET /api/v1/published-articles/{article_id}` 当前只在列表项上增加 `content_hash`、成功 `verification` 与 `issues`；缺少 Approved Content Markdown snapshot、ContentVersion lineage 和 Publication event timeline，无法一次绘制目标详情。
- 现有 `ContentVersionDetail` 已提供来源内容 payload、Fact identity、生成 lineage 与 review lineage；Article detail 可以在服务端同一事务中复用该 read model，不需要第二套内容 DTO 或浏览器二次 GET。
- PublishedArticle 通过 `verification_id` 固定指向首次 `PASSED` verification；成功核验同一事务创建与 PublicationWork 同 ID 的成果并完成 Work/ContentTask。数据库触发器保护 PublishedArticle、verification、event 与终态 Work 的不可变/append-only 边界。
- Article 查询当前优先显示仍存在的 Platform/Account 实时名称，可能随配置修改而漂移；终态 Work 已保存名称、账号标签与账号标识 snapshot，成果页应只显示这些冻结身份。
- Article list/detail 都由多条 SQL 组成，当前没有 `REPEATABLE READ`；issues 或关联上下文并发变化时可能形成一次响应内的混合时点。
- 运行时实际存在结构化 401/403/404/409/422，但 OpenAPI 的两个 GET 只声明 200/422。
- 当前读取权限是启用且完成密码变更的已认证 `ADMIN` 或 `ENGINEER`；ADMIN 虽能收到删除投影，本任务也不得显示删除入口。

### 合同缺口判断

- **列表行：部分满足。** 现有 row DTO 足够绘制既定五列，但服务端缺搜索和显式排序。
- **详情：不满足。** 现有 DTO 缺来源内容 snapshot、lineage 和 publication timeline；浏览器再请求 PublicationWork/ContentVersion/Verification 会违反 read-model 边界。
- **endpoint 形态：现有 list/detail 两个窄 endpoint 正确。** 不共用一个万能 endpoint，不新增 Workspace context；只 additive 扩展各自真实消费者需要的字段/参数。

## In Scope

- 注册 `/publishing/articles` 与 `/publishing/articles/$articleId`，补齐 route metadata、Publishing 子导航、direct/refresh/Back/Forward 与 canonical handoff。
- 列表 URL state：可选 `q`、必填 canonical `page/pageSize`、可选非默认 `sort`；非法或额外 search params replace 到 canonical URL。
- 列表 API additive 增加 `search` 与 typed `sort`；搜索、排序、count 和分页全部由 PostgreSQL 完成。
- 固定列表列：发布内容（actual title + URL domain）、平台/账号、发布时间、首次核验（Passed + time）、内容健康；标题链接详情。由于本任务不实现任何 Article command，列表没有操作列。
- Detail additive 返回来源 `ContentVersionDetail` 与服务端排序的 `PublicationWorkEvent[]`；保留现有字段以兼容现有消费者。
- Detail section：成果身份与公开 URL、冻结平台/账号和发布时间、来源内容不可变 snapshot、首次成功 verification snapshot、Content/Fact/Generation lineage、Publication timeline、只读健康摘要。
- 列表与详情使用同一 `REPEATABLE READ` 请求快照；终态平台/账号只展示 Work snapshot。
- OpenAPI 补齐实际 401/403/404/409/422 structured error responses，并重新生成受影响 TypeScript schema。
- Backend integration、Frontend component/model、production-artifact fixture Playwright 与独立 real-stack 读取验收。
- 更新直接受影响的 V2 页面、read-model、测试和迁移路线文档。

## Out of Scope

- PublishedArticle 编辑、删除、永久删除 preview、重新核验或任何 mutation UI。
- `OPEN_ISSUE`、`PERMANENT_DELETE`、`START_PRODUCT_OBSERVATION`、`HANDLE_CONTENT_ISSUE` 等 Article action registry/入口；不从 status 推导替代动作。
- Published Content Issues 列表/Workspace、修复任务、解决命令；Article detail 只可显示现有健康摘要，不提供 issue route 或操作。
- GEO references、GEO 页面或观测创建。
- Publication Work、ContentVersion、Verification 多个全局接口的浏览器 join。
- 完整 Publishing E2E checkpoint、Phase 4 vertical-slice 抽象回顾、Workbench、V1 UI/路由重做。
- 新 DataTable、Detail framework、全局 Store、运行时依赖、通用 read-model builder 或未来占位路由。
- 数据库 schema/migration；现有不可变约束已经足够。

## Requirements

### R1 — Canonical routing 与导航

- `/publishing/articles` 是唯一成果列表 URL；`/publishing/articles/$articleId` 是唯一成果详情 URL。
- Publishing 导航区分“发布工作”和“发布成果”的 active item；父 route 不用 pathname 特判。
- Publication Workspace `COMPLETED` handoff、Content Task Detail 与 Product Detail 既有链接继续指向 Article Detail，不创建兼容 alias。

### R2 — Server-side list contract

- URL `q` 映射 API `search`；去除两侧空白后为空则移除，最大 200 字符。
- API `PublishedArticleSort` 只允许 `VERIFIED_DESC | VERIFIED_ASC | PUBLISHED_DESC | PUBLISHED_ASC | TITLE_ASC | TITLE_DESC`；默认 `VERIFIED_DESC`。
- 搜索覆盖冻结/稳定显示字段：actual title、source content title、final URL、platform name snapshot、account label snapshot、account identifier snapshot。
- 每种排序都必须追加稳定的 `PublishedArticle.id ASC` 次排序；count 和 rows 使用同一搜索谓词。
- V2 `pageSize` 只提供 10/20/50；保持 API 现有 1..100 兼容范围，避免破坏 V1。
- 改变 q/sort/pageSize 时回到 page 1；不得在分页结果上本地筛选或排序。

### R3 — Readonly detail read model

- Article detail 只发一个 `GET /api/v1/published-articles/{article_id}`。
- 响应 additive 增加 `source_content: ContentVersionDetail` 与 `events: PublicationWorkEvent[]`，由服务端在同一 snapshot 中装配；不得新增第二个 Content snapshot DTO。
- `source_content.content.id` 必须等于 Article 的 `content_version_id`，其 `content_hash` 必须等于 Article/Work 冻结 hash；不一致显式返回 `409 PUBLICATION_CONTEXT_INCOMPLETE`。
- `verification.outcome` 必须为 `PASSED`，并与 PublishedArticle 的固定 `verification_id`、Work/result snapshot 相符；未知或断裂上下文显式失败，不补默认值。
- 平台名称、账号标签和账号标识只使用终态 Work snapshot；实时 profile/account ID 可以保留为关联身份，但不决定历史显示文本。
- events 按服务端 `created_at ASC, id ASC` 返回；页面不得重新定义业务顺序。

### R4 — Immutable/read-only UI

- 列表与详情不展示 action column、StickyActionBar、表单、编辑器、删除、重新核验或 issue/GEO 写入口。
- Markdown 使用既有 sanitized `MarkdownPreview`；对外 URL 使用安全的新标签页链接并展示可读 domain。
- 页面明确显示“只读 / 不可变发布成果”和“首次成功核验快照”，且不把后续 ContentVersion 状态变化解释为可编辑资格。

### R5 — Permission 与 structured error

- 当前 `ADMIN`/`ENGINEER` read permission 保持不变；服务端仍是最终权限权威。
- OpenAPI list 声明 401/403/409/422，detail 声明 401/403/404/409/422。
- 前端：401 进入既有会话失效流程；403 显示无权限；404 显示成果不存在；409 显示追溯上下文不完整；其余错误保留 `request_id` 与 retry。
- 已有 cached data 的 background refresh 失败不得卸载当前只读 snapshot。

### R6 — Scope discipline

- 不改 V1 runtime/page/test，不新增通用组件或依赖。
- OpenAPI 变更会使两套 generated schema 都必须机械更新；旧前端 generated schema 是否属于“不得修改 frontend/”的例外，需用户在实施批准时明确。

## Acceptance Criteria

- [ ] `/publishing/articles?page=1&pageSize=20` 可 direct/refresh/Back/Forward，未知或非法 search 被 canonical replace，且只发一个 list GET。
- [ ] q、三组可见排序列与分页全部映射到服务端参数；页面没有本地过滤、分页截取或跨接口 join。
- [ ] 列表严格显示五列且无操作列；actual title 链接 canonical detail，URL domain、长标题和健康状态在四档宽度可读。
- [ ] `/publishing/articles/$articleId` 只发一个 detail GET，并显示公开结果、冻结平台/账号、来源 Markdown snapshot、首次 PASSED verification、lineage 与 publication timeline。
- [ ] Article/Work/verification/source content ID 与 hash 边界由 backend integration test 证明；断裂上下文返回结构化 409，不渲染部分拼装结果。
- [ ] Publication Workspace `COMPLETED` 链接进入同 ID Article Detail；Article ID 与 Work ID 相同。
- [ ] ADMIN 与 ENGINEER 均可读；401/403/404/409/422 的 OpenAPI、runtime 与页面行为一致并显示 request ID。
- [ ] 页面没有 form、contenteditable、mutation request、删除 preview、issue/GEO/verification action，也不按 status 推导业务动作。
- [ ] fixture Playwright 拒绝未声明 API；独立真实栈从已完成发布成果进入列表与详情，浏览器业务请求均为 GET。
- [ ] 375/768/1024/1440、keyboard、visible focus、table semantics、external-link label、无页面级横向溢出通过。
- [ ] OpenAPI、backend、两套 generated types、V2 docs/tests 一致；`contracts/database.md` 无需更新，因为没有持久化 invariant 变化。

## 实施授权

- 用户已批准 `contracts/openapi.yaml` 机械重新生成 `frontend/src/shared/api/schema.d.ts`，并明确该文件是“不修改 `frontend/`”的唯一例外；V1 runtime、页面、测试和手工兼容修改仍被禁止。
