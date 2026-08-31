# Research: authenticated-readonly-scope

- Query: 波次 2 已认证只读 UI/UX/导航审计的路由范围、允许交互、截图优先级、停止条件及 Playwright 参考
- Scope: internal
- Date: 2026-08-30

## Findings

### 1. 认证边界与请求不变量

canonical 路由表在 `docs/frontend-v2/02-information-architecture-and-routing.md:100-140`，生成后的精确 `fullPath` 在 `frontend/src/routeTree.gen.ts:1013-1365`。`frontend/src/routes/_app/route.tsx:8-35` 的 `_appRoute.beforeLoad` 是统一认证边界：无用户跳到 `/login?redirect=...`，`user.must_change_password` 跳到 `/account/security`，否则渲染 `AppShell`。`frontend/src/routes/_app/_admin/route.tsx:7-34` 的 `AdminRoute.beforeLoad` 只允许 `account_type === "ADMIN"`，否则以 `AdminForbidden` 显示 403；隐藏导航不是权限控制。

`frontend/src/app/auth/auth-provider.tsx:45-57` 的 `loadAuthSession` 只执行 `GET /api/v1/auth/me` 和 `GET /api/v1/auth/csrf`；登录本身由 `useAuthActions.signIn` 在 `frontend/src/app/auth/auth-provider.tsx:105-119` 执行一次 `POST /api/v1/auth/login`。登录成功后，已认证审计的网络不变量应为：除上述认证请求外，页面数据请求只能是 `GET`，不得出现业务 `POST`、`PUT`、`PATCH`、`DELETE`。`frontend/src/shared/api/client.ts:1-8` 没有全局 401 自动跳转，因此发现会话失效后必须由审计人员停止，不得靠自动重登继续。

### 2. ADMIN 只读路由矩阵

下表中的 `$productId`、`$taskId`、`$workId`、`$articleId`、`$issueId`、`$observationId`、`$versionId`、`$platformId`、`$channelId` 是 canonical 路由参数，不应在计划中虚构具体 ID；实际运行只使用列表中已显示的真实 ID。所有“打开”均指 GET 后观察，不表示可填写或提交表单。

| 精确 canonical 路由 | 页面 owner / 代码证据 | ADMIN 可执行的只读交互 | 必须禁止的提交或命令 |
|---|---|---|---|
| `/login` | `frontend/src/routes/login.tsx:9-43` `LoginRoute`；`frontend/src/domains/auth/login-page.tsx:30-49` | 观察登录错误、密码可见性控件和返回地址；按授权凭据登录一次 | 不猜测或重复试密码；不得把密码写入日志、截图或研究文件。唯一允许的 POST 是用户明确授权的登录本身 |
| `/account/security` | `frontend/src/routes/account/security.tsx:8-37` `AccountSecurityRoute`；`frontend/src/domains/auth/account-security-page.tsx:31-49` | 仅在 guard 强制转入时确认页面、文案、字段和可访问性 | `change-password` 是 POST；非强制情形不得输入、提交或修改密码。若被强制改密，按第 4 节立即停下 |
| `/` | `frontend/src/routes/_app/index.tsx:6-14` `IndexRoute` / `WorkbenchPage`；`frontend/src/domains/workbench/workbench-page.tsx:22-105` | 查看聚合指标、健康状态、卡片链接；在失败态点“重试” | 不得把卡片链接后的写入流程当作动作；不得触发任何业务命令 |
| `/products` | `frontend/src/routes/_app/products/index.tsx:10-43` `ProductsRoute`；`frontend/src/domains/product/products-list-page.tsx:121-235` | 搜索、筛选、排序、分页、刷新、打开产品详情；可观察“删除条件”对话框 | 不得点“新建产品”、删除、确认删除或任何行级写操作；`products-list-page.tsx:73-115,250-305` 明确存在删除 mutation/RowActions |
| `/products/new` | `frontend/src/routes/_app/products/new.tsx` `ProductCreateRoute`（canonical tree 见 `routeTree.gen.ts:1050-1058`） | 如需核对路由和空表单布局，只可 GET 后观察并返回 | 不得填写、保存或提交新产品；建议最小审计集合不打开该路由 |
| `/products/$productId` | `frontend/src/routes/_app/products/$productId.tsx:7-29` `ProductDetailRoute`；`product-detail-page.tsx:71-130,134-219` | 查看事实摘要、版本/内容/发布/GEO/活动链接；可观察删除条件对话框 | 不得进入并确认编辑、删除或其他写操作；详情页的 update/delete mutation 由 `product-detail-page.tsx:71-130,286-310` 暴露 |
| `/products/$productId/facts` | `frontend/src/routes/_app/products/$productId_.facts.tsx:7-19` `ProductFactsRoute`；`fact-workspace-page.tsx:79-143` | 查看只读投影、事实状态、Tab/历史链接；仅在服务端 `available_actions` 不含写动作时操作筛选/导航 | 不得在事实表单输入、保存或提交 `SAVE`/`SUBMIT_REVIEW`；页面包含 save/submit mutation |
| `/products/$productId/facts/review` | `frontend/src/routes/_app/products/$productId_.facts.review.tsx` `FactReviewRoute`；`fact-review-page.tsx:59+` | 查看差异、审核历史、版本链接 | 不得批准或请求修改；`fact-review.model.ts:57` 会从 `available_actions` 解析动作，按钮出现也不代表允许线上执行 |
| `/products/$productId/facts/versions?page=1&pageSize=20` | history route 的 search canonicalization 与 loader；`fact-history-page.tsx:37-83,122-135` | 分页、刷新、打开不可变版本详情 | 不得编辑或回写历史版本 |
| `/products/$productId/facts/versions/$versionId` | version detail route loader；`fact-version-detail-page.tsx:28-61,76-167` | 查看“只读/不可变快照”、时间线及来源链接 | 不得修改、恢复或提交版本 |
| `/content/tasks` | `frontend/src/routes/_app/content/tasks/index.tsx:10-40` `ContentTaskListRoute`；`content-task-list-page.tsx:172-250` | 搜索、状态/平台筛选、分页、刷新；打开任务详情、editor、review 链接 | 不得新建、生成、取消、归档、恢复或删除任务；页面的 `useContentTaskLifecycle` 在 `content-task-list-page.tsx:73-121` 具有 mutation 能力 |
| `/content/tasks/new` | `frontend/src/routes/_app/content/tasks/new.tsx` `ContentTaskCreateRoute`（canonical tree 见 `routeTree.gen.ts:1111-1120`） | 仅可核对新任务表单布局后返回 | 不得填写、生成或提交任务；建议不纳入截图 |
| `/content/tasks/$taskId` | `frontend/src/routes/_app/content/tasks/$taskId.tsx:7-21` `ContentTaskDetailRoute`；`content-task-detail-page.tsx:63-121,165-338` | 查看状态、只读标识、产品/版本/发布/GEO 链接 | 不得执行生命周期动作或删除；详情页的只读判断不能替代服务器权限 |
| `/content/tasks/$taskId/editor` | `frontend/src/routes/_app/content/tasks/$taskId_.editor.tsx:7-21` `ContentEditorRoute`；`content-editor-page.tsx:141-171,215-230` | 只观察编辑器、Markdown、状态和布局；不改动输入框 | 不得创建/保存版本、提交审核、删除或放弃；editor 是明确的写入边界 |
| `/content/tasks/$taskId/review` | `frontend/src/routes/_app/content/tasks/$taskId_.review.tsx:7-21` `ContentReviewRoute`；`content-review-page.tsx:55-85,108-121,191-207` | 查看审核上下文、差异、历史和只读提示 | 不得批准或请求修改；两个审核按钮对应 mutation |
| `/content/versions/$versionId` | `frontend/src/routes/_app/content/versions_.$versionId.tsx:7-21` `ContentVersionDetailRoute`；`content-version-detail-page.tsx:48-104,106-210` | 查看 Markdown、血缘、审核时间线和不可变快照；返回来源任务 | 不得编辑、恢复、发布或生成新版本 |
| `/publishing/work` | `frontend/src/routes/_app/publishing/work/index.tsx:11-49` `PublicationWorkRoute`；`publication-work-page.tsx:60-155,250-300,404-450` | 查看摘要、ready queue、筛选、分页和工作项链接；可观察可执行能力投影但不打开提交流程 | 不得启动发布；不要点击/确认 `StartPublicationDialog` |
| `/publishing/work/$workId` | `frontend/src/routes/_app/publishing/work/$workId.tsx:12-57` `PublicationWorkspaceRoute`；`publication-workspace-page.tsx:54-75,159-247,267-341` | 切换 hash Tab，查看上下文、事件/历史、文章/内容链接和只读状态 | 不得更新准备信息、平台审核、结果、验证、切换、关闭、上传；不点击复制发布包/附件下载（即使底层可能为 GET，也会产生外部文件副作用） |
| `/publishing/articles` | `frontend/src/routes/_app/publishing/articles/index.tsx:10-37` `PublishedArticlesRoute`；`published-article-list-page.tsx:44-88,117-222` | 搜索、分页、打开已发布文章详情并观察最终 URL | 不得登记问题或提交任何文章变更 |
| `/publishing/articles/$articleId` | `frontend/src/routes/_app/publishing/articles/$articleId.tsx:10-26` `PublishedArticleDetailRoute`；`published-article-detail-page.tsx:55-74,121-145,247-361` | 查看已发布不可变快照、链接和历史 | 不得点“登记内容问题”、填写或提交 `OpenIssueDialog` |
| `/publishing/issues` | `frontend/src/routes/_app/publishing/issues/index.tsx:10-35` `PublishedIssuesRoute`；`published-content-issue-list-page.tsx:46-179` | 状态/类型筛选、分页、刷新、打开 issue 详情 | 不得修复、解决、删除或启动关联任务 |
| `/publishing/issues/$issueId` | `frontend/src/routes/_app/publishing/issues/$issueId.tsx:12-57` `PublishedIssueWorkspaceRoute`；`published-content-issue-workspace-page.tsx:51-71,140-304` | 切换 hash 区块，查看问题、不可变历史和来源链接 | 不得创建修复任务、解决问题或执行 workspace actions |
| `/geo/observations` | `frontend/src/routes/_app/geo/observations/index.tsx:10-39` `GeoObservationsRoute`；`geo-observation-list-page.tsx:66-145,151-347` | 搜索、筛选、排序、分页、打开观测详情；可观察删除条件对话框 | 不得新建、删除或进入修正提交流程 |
| `/geo/observations/new` | `frontend/src/routes/_app/geo/observations/new.tsx` `GeoObservationCreateRoute`（canonical tree 见 `routeTree.gen.ts:1255-1263`） | 仅可核对空表单布局后返回 | 不得上传、填写或提交观测记录；建议不纳入截图 |
| `/geo/observations/$observationId` | `frontend/src/routes/_app/geo/observations/$observationId.tsx:8-44` `GeoObservationDetailRoute`；`geo-observation-detail-page.tsx:41-48,106-139,211-379` | 查看只读记录、证据链、引用文章和来源链接 | 不得删除、修正或创建优化；避免下载外部文件 |
| `/geo/observations/$observationId/correct` | `frontend/src/routes/_app/geo/observations/$observationId_.correct.tsx:14-75` `GeoObservationCorrectRoute` | 只在需要核对 guard/上下文时打开并立即返回，观察字段布局 | 不得填写或提交修正；该 route 的目的就是写入边界，不属于最小截图集 |
| `/geo/insights` | `frontend/src/routes/_app/geo/insights/index.tsx:10-43` `GeoInsightsRoute`；`geo-insights-page.tsx:57-174,205-301` | 日期/下拉筛选、重置、刷新、打印链接、查看洞察和关联链接 | 不得打开或提交“创建 GEO 优化任务”的 `OptimizationDialog` |
| `/geo/insights/print` | print route 的 canonical search/loader；`frontend/src/routes/_app/geo/insights/print.tsx` | 可作为 1440 宽度打印布局的可选截图；仅观察 | 不得触发浏览器打印、保存或下载；非核心波次 2 路由 |
| `/geo/topics` | `frontend/src/routes/_app/geo/topics/index.tsx:10-40` `GeoTopicsRoute`；`query-topic-list-page.tsx:98-175,426-460,613-645` | 搜索、排序、分页、打开业务引用对话框和引用链接 | 不得创建、编辑、删除主题；`query-topic-list-page.tsx:192-320,666-760` 含写入/删除 UI |
| `/settings/platforms` | `frontend/src/routes/_app/settings/platforms/index.tsx:13-59` `PlatformsRoute`；`platform-list-page.tsx:68-186` | 筛选、分页、打开平台详情和只读平台类型页面；观察 enable/disable 状态 | 不得启用、停用、删除、上传或修改平台 |
| `/settings/platforms/types` | `frontend/src/routes/_app/_admin/settings.platforms.types.tsx:7-23` `PlatformTypesRoute`；`platform-types-page.tsx:53-174` | 查看平台类型列表、重试、删除条件 | 不得新建、编辑、删除类型 |
| `/settings/platforms/$platformId?tab=overview`、`?tab=accounts`、`?tab=generation` | `frontend/src/routes/_app/settings/platforms/$platformId.tsx:20-123` `PlatformWorkspaceRoute`；`platform-workspace-page.tsx:107-225` | 在三个精确 Tab 之间观察概览、账号、生成配置和服务端状态；仅用 URL/Tab 导航 | 不得编辑、切换状态、管理账号、上传 Logo、删除、测试连接或保存配置 |
| `/settings/prompts` | `frontend/src/routes/_app/_admin/settings.prompts.tsx:20-79` `PromptsRoute`；`prompt-workspace-page.tsx:67-81,423,567,687-753` | 查看 prompt 列表、搜索/选择和已存在的只读预览；不触发预览生成 | 不得新建、保存、删除、复制或生成 preview；preview 组件自身也有 mutation |
| `/settings/ai` | `frontend/src/routes/_app/_admin/settings.ai.tsx:14-76` `AIChannelsRoute`；`ai-channel-list-page.tsx:80-96` | 筛选、分页、打开渠道详情；仅观察掩码后的配置状态 | 不得创建/编辑/删除渠道、发现模型、测试连接、启停渠道或改 API key/headers |
| `/settings/ai/$channelId?tab=basic`、`?tab=request`、`?tab=models`、`?tab=usage`、`?tab=logs` | `frontend/src/routes/_app/_admin/settings.ai_.$channelId.tsx:15-83` `AIChannelWorkspaceRoute` | 只读切换五个 Tab；优先观察 `usage`/`logs` 的表格、请求统计和日志 | 不得保存基本信息/request、发现或测试模型、写 API key/headers、删除/启停；敏感字段只看“已配置”掩码状态，不能复制 |
| `/system/users` | `frontend/src/routes/_app/_admin/system.users.tsx:11-49` `SystemUsersRoute`；`user-list-page.tsx:100-209,243-305` | 搜索、筛选、分页、观察用户行和权限标签 | 不得新建、编辑、重置密码、启停、删除、批量操作或导出；导出即使底层 GET，也会产生文件副作用 |
| `/system/audit` | `frontend/src/routes/_app/_admin/system.audit.tsx:14-46` `SystemAuditRoute`；`system-audit-page.tsx:55-82,125-214` | 搜索/筛选、分页、点行或键盘 Enter 打开只读详情 pane；移动端观察 Sheet | 审计页无业务写入，但仍不得从详情中的链接进入写流程，不得执行任何命令或下载 |

App Shell 导航可按 `frontend/src/app/navigation.ts:54-127` 核验：工作区（`/`、`/products`）、内容运营（`/content/tasks`、`/publishing/work`、`/publishing/articles`、`/publishing/issues`）、GEO（`/geo/insights`、`/geo/topics`、`/geo/observations`）、业务配置（平台、Prompt、AI）和系统管理（用户、审计）。`frontend/src/app/layout/app-shell.tsx:41-109,130-220` 负责桌面侧栏、移动 Sheet、面包屑和主内容焦点；允许打开导航、观察 active/`aria-current`、面包屑和返回，不允许把导航到写入页误当成可执行写操作。账户菜单可打开并观察 `/account/security` 链接（`app-shell.tsx:224-277`），但不要点击退出；退出是 POST 的会话状态变更，放到最终清理例外处理。

旧路由只做重定向核验，不作为第二套业务页面：`frontend/src/routes/-legacy-routing.model.ts:64-214` 和各 legacy route（如 `frontend/src/routes/_app/tasks/index.tsx:5-8`、`_app/audit.tsx:5-8`、`_app/users.tsx:5-8`）均应最终落到上表 canonical 路径。必要时只验证一次旧到新的 URL 结果，不重复截图、不在旧路由上作业务结论。

### 3. 最小截图集合与响应式优先级

建议每个尺寸先截以下代表集合；ID 使用当前列表首个可见真实值，截图不得暴露密码、API key、私密 header、未授权个人数据或完整外部 token。

| 优先级 | 1440 截图路由 | 375 截图路由 | 必看内容 |
|---|---|---|---|
| P0 | `/` | `/` | App Shell、桌面侧栏/移动导航 Sheet、面包屑、主内容焦点、健康状态和无横向溢出 |
| P0 | `/products` | `/products` | 密集 TableShell、搜索/筛选/分页、行操作呈现但不执行、空/错误态边界 |
| P0 | `/content/tasks/$taskId` 或 `/products/$productId` | 同一路由 | 代表性只读详情、状态 badge、跨域链接、窄屏字段换行；二者择一即可减少敏感数据暴露 |
| P1 | `/publishing/articles/$articleId` 或 `/publishing/work/$workId` | `/publishing/articles/$articleId` | 不可变发布快照、hash Tab/链接；移动端只看内容不点写入 action |
| P1 | `/geo/observations/$observationId` | `/geo/observations/$observationId` | 证据链/引用链接、只读记录和移动端纵向排版 |
| P1 | `/settings/ai/$channelId?tab=usage` 或 `?tab=logs` | 同一路由 | ADMIN-only 导航、敏感配置掩码、统计/日志表格和窄屏滚动 |
| P0 | `/system/audit`（选一行打开详情） | `/system/audit`（打开移动 Sheet） | ADMIN 权限、筛选、只读详情 pane/Sheet、键盘行打开；最适合作为权限与只读证据 |

1440 优先核验侧栏、密集表格、详情 pane、面包屑、状态和完整信息层级；`frontend/src/app/layout/app-shell.tsx:41-109` 的桌面布局目标是 13rem 侧栏加主内容。375 优先核验移动 Sheet 导航、筛选控件换行、TableShell 只在表格内部横向滚动、详情/Drawer/Sheet 的 Escape 与焦点恢复、长文本不溢出。`.trellis/spec/frontend/visual-system.md:116-123` 要求覆盖 375/768/1024/1440、无页面级横向溢出、键盘可用且触控目标至少 44px；`docs/frontend-v2/08-testing-quality-and-acceptance.md:505-529` 另要求桌面 1440、窄屏 390/320 和 200% 缩放。当前 Playwright 配置实际为 375x900 与 1440x1000（`frontend/playwright.config.ts:7-31`），所以 1440x900、320、768、1024 仍需手工/额外运行时补齐，不能把现有配置当成全部响应式证据。

### 4. 强制停止条件

- **强制改密：** 若 `GET /api/v1/auth/me` 返回 `must_change_password=true`，`_appRoute.beforeLoad` 会在 `frontend/src/routes/_app/route.tsx:18-20` 强制转到 `/account/security`。只能确认页面和停止；不得绕过、猜测或代填新密码。只有用户在安全渠道完成改密并重新明确授权后，才可继续波次 2。
- **权限不符：** 登录后 `account_type` 不是 `ADMIN`，或任一 admin route（`/settings/prompts`、`/settings/ai`、`/system/users`、`/system/audit`、`/settings/platforms/types`）返回 403/`AdminForbidden`，立即停止该分支并记录 URL、状态和脱敏界面；不得改用 ENGINEER、猜测隐藏 URL 或通过前端绕过。
- **登录失败：** 401、凭据错误、登录页面明确错误、CSP/runtime 错误或认证服务 5xx 均停止；`frontend/src/domains/auth/login-page.tsx:30-49` 的错误必须保留为证据，不得重复试密码或在文件中记录凭据。现有测试对 401 的断言只能作为行为参考。
- **会话失效：** 任一已认证请求出现 401/`AUTH_REQUIRED`、`/api/v1/auth/me` 变为 204、CSRF 错误，或路由重新跳 `/login`，立即停止后续导航/点击，保留当前脱敏截图和响应证据，不自动重登。必要的最终会话关闭可执行一次 logout 作为清理例外，但不得把它算作业务只读证据。
- **环境/数据身份漂移：** 现有波次基线显示公网目标为 staging/预发布（release `mvp-20260830-133651-a663bcce`，不是已证明的 Production Cutover）；若页面环境标识、健康检查、版本或数据身份与基线漂移，先停止扩展并报告，不把结果写成生产验收。
- **敏感信息泄露或出现未预期写请求：** 若页面显示未掩码秘密，或网络出现登录以外的业务 `POST/PUT/PATCH/DELETE`，立即停止、不要确认弹窗、不要重试，并保存脱敏请求方法/URL 证据。

### 5. 可借鉴但不能作为线上证据的 Playwright 文件

- `frontend/tests/e2e/foundation-smoke.spec.ts:3-40`：App Shell、桌面/移动导航、reload、runtime error 的选择器和断言参考。
- `frontend/tests/e2e/auth-session.spec.ts:119-228`：登录、强制改密、ENGINEER 403、logout、登出后重定向；该文件通过 `page.route` fixture 拦截 API（同文件 `:42-114`），不能证明公网行为。
- `frontend/tests/e2e/auth-session-real-stack.spec.ts:14-82`：本地隔离真实栈的强制改密、工作台、admin 403、logout 流程；需要本地环境开关，仍不是公网证据。
- `frontend/tests/e2e/legacy-routing.spec.ts:10-114`：legacy→canonical、query 规范化、history、登录 return-to、强制改密、403、404；可用于路由设计，不可替代线上截图/网络记录。
- 与本矩阵对应的页面选择器、Tab、URL 状态和只读文案可参考：`workbench.spec.ts`、`products-list.spec.ts`、`product-detail.spec.ts`、`fact-workspace.spec.ts`、`fact-review.spec.ts`、`fact-history.spec.ts`、`fact-version-detail.spec.ts`、`content-task-list.spec.ts`、`content-task-detail.spec.ts`、`content-editor.spec.ts`、`content-review.spec.ts`、`content-version-detail.spec.ts`、`publication-work-list.spec.ts`、`publication-workspace.spec.ts`、`published-articles.spec.ts`、`published-content-issues.spec.ts`、`geo-insights.spec.ts`、`geo-observations.spec.ts`、`geo-observation-detail.spec.ts`、`geo-topics.spec.ts`、`platform-list.spec.ts`、`platform-types.spec.ts`、`platform-workspace.spec.ts`、`prompt-workspace.spec.ts`、`ai-channel-list.spec.ts`、`ai-channel-workspace-core.spec.ts`、`ai-channel-workspace-runtime.spec.ts`、`system-audit.spec.ts`、`system-users.spec.ts`。
- 对真实栈隔离边界，`.trellis/spec/infra/e2e-isolation.md:1-25,61-70` 明确要求独立 DB/Redis/storage，并指出 fixture/本地真实栈不能证明线上业务；`docs/deployed-full-functional-acceptance-plan.md:57-97` 规定线上证据应包含环境、版本、时间、URL、截图和网络/日志脱敏信息。因此上述 Playwright 仅能提供测试设计、选择器和预期行为参考。

## Caveats / Not Found

本研究未登录公网、未读取或请求任何 ADMIN 凭据，也未运行浏览器，因此没有新增线上 ADMIN session、权限、响应式截图或网络 HAR 证据。上述矩阵是基于 canonical 路由、代码 guard、页面 mutation 位置和既有测试的执行边界；执行波次 2 时仍需把登录成功、`must_change_password=false`、`account_type=ADMIN`、所有页面请求方法和脱敏截图逐项记录。旧验收计划中的“波次 2”包含创建、审核、发布等写入闭环，本文件刻意将其重划为用户要求的已认证只读 UI/UX/导航子集，不能宣称业务闭环已验收。
