# Research: Frontend V1/V2 构建、路由与 Cutover 验证审计

- Query: 审计 `frontend/` 与 `frontend-v2/` 的 package/build/Vite 配置、route tree、API base URL、client fallback、asset base、source map、缓存配置，以及 redirect/deep-link/refresh/history、`/login`、`/`、核心列表、Workspace、System 权限的现有测试证据。
- Scope: internal
- Date: 2026-08-24

## Findings

### 1. 审计边界与证据等级

- 本次只读取仓库文件与现有本地 `dist/` 目录；未运行浏览器、E2E、构建、部署或远程连接。
- 下文“测试覆盖”表示测试源码存在相应断言，不代表本次重新执行通过。最近一次全量通过记录来自 Phase 8 文档：独立 E2E 为 V2 real-stack `16 passed`、V1 `52 passed`、V2 fixture `383 passed / 33 skipped / 0 failed`，最终 `make verify` exit `0`；这是归档候选文档证据，不是本次复验（`docs/frontend-v2/08-testing-quality-and-acceptance.md:394-406`）。
- `dist/` 被 `.gitignore` 的通用 `dist/` 规则排除（`.gitignore:15`），因此当前目录只可作为本机最近构建形态的旁证，不能当作版本化 release artifact 或部署现状权威。

### 2. Files found

| 文件 | 一行说明 |
| --- | --- |
| `frontend/package.json` | V1 build/test/API 生成脚本及 React Router/Ant Design 技术栈。 |
| `frontend/vite.config.ts` | V1 唯一被 npm scripts 显式使用的 Vite 配置，定义 source map、5173 dev proxy。 |
| `frontend/vite.config.js` | 仓库内残留的编译型配置副本；npm scripts 不引用它，且内容已与 TS 配置漂移。 |
| `frontend/Dockerfile` | V1 build stage 与 Nginx 静态运行镜像 owner。 |
| `frontend/nginx.conf` | V1 容器内 SPA fallback、asset/index 缓存 owner。 |
| `frontend/src/app/App.tsx` | V1 手写 React Router route tree 与未知路由 fallback owner。 |
| `frontend/src/shared/api/client.ts` | V1 API base URL、cookie/CSRF/error owner。 |
| `frontend-v2/package.json` | V2 build/test/Storybook/API 生成脚本及 TanStack Router 技术栈。 |
| `frontend-v2/vite.config.ts` | V2 文件路由、自动 code splitting、Tailwind、5174 dev proxy owner。 |
| `frontend-v2/src/routeTree.gen.ts` | TanStack Router 生成的实际 V2 route tree；明确声明当前全部 full paths。 |
| `frontend-v2/src/app/router.ts` | V2 browser router 创建入口。 |
| `frontend-v2/src/app/providers.tsx` | 会话探测后才挂载 Router 的应用入口。 |
| `frontend-v2/src/routes/_app/route.tsx` | V2 登录与强制改密的受保护路由 gate。 |
| `frontend-v2/src/routes/_app/_admin/route.tsx` | V2 ADMIN route boundary 与保留原 URL 的 403 页面。 |
| `frontend-v2/src/shared/api/client.ts` | V2 API base URL/cookie owner。 |
| `frontend-v2/playwright.config.ts` | V2 production build + Vite preview 的 fixture E2E 运行入口。 |
| `frontend-v2/tests/e2e/*.spec.ts` | V2 canonical route、refresh、history、permission 和业务页面证据。 |
| `docs/frontend-v2/02-information-architecture-and-routing.md` | V2 canonical 路由表与计划中的 V1→V2 映射。 |
| `docs/frontend-v2/08-testing-quality-and-acceptance.md` | Phase 8 gate、deployment smoke 要求及已有测试声明。 |
| `deploy/compose.staging.yaml` | 当前 staging frontend 容器 owner，仍指向 `frontend/`。 |
| `deploy/compose.prod.yaml` | 当前 production Compose 不包含 frontend service；只管理 backend/DB/Redis。 |
| `deploy/nginx/partsignal.staging.conf.template` | staging 外层反代、SPA 转发与缓存头 owner。 |
| `deploy/nginx/partsignal.conf.template` | production 静态 release root、SPA fallback 与缓存头 owner。 |
| `deploy/nginx/partsignal-security-headers.conf` | production/staging 共享 CSP 与安全响应头 owner。 |
| `deploy/scripts/check-nginx-security.mjs` | 现有 CSP/HTML/Markdown sink 静态 gate；当前只检查 V1 文件。 |
| `deploy/scripts/e2e-local.sh` | 隔离栈同时构建 V1/V2，并用 Vite preview 提供 V2 artifact。 |
| `Makefile` | 根构建/验证入口；V1 构建容器，V2 只产出本地 `dist/`。 |
| `.github/workflows/ci.yml` | CI 安装并验证 V1/V2，但最终仍通过 `make build` 使用上述不同 artifact 形态。 |

### 3. Build artifact、运行容器与静态资源 owner

#### 3.1 V1

- `npm --prefix frontend run build` 执行 `tsc -b`、`vite build`，随后运行 `scripts/check-production-assets.mjs`（`frontend/package.json:7-18`）。V1 build 不只是编译，还带 production asset gate。
- V1 明确生成 source map：`build.sourcemap: true`（`frontend/vite.config.ts:5-9`）。当前本地忽略目录中的 JS 也带 `sourceMappingURL` 且存在 `.map` 文件，符合配置；该旁证不等于 release 已部署。
- V1 Docker build 是多阶段：Node build 生成 `/app/dist`，最终复制到 `/usr/share/nginx/html` 的 `nginx:1.27-alpine`（`frontend/Dockerfile:1-15`）。
- 容器 Nginx 对 `/assets/` 和 `.map` 使用一年 immutable，对 `index.html` 和 SPA fallback 使用 `no-cache`，并用 `try_files $uri $uri/ /index.html` 支持 direct deep link/refresh（`frontend/nginx.conf:12-31`）。
- staging Compose 的 `frontend` 服务仍使用 `${PARTSIGNAL_FRONTEND_IMAGE:-partsignal-frontend}`、build context `../frontend`、宿主 `127.0.0.1:19080`（`deploy/compose.staging.yaml:126-140`）。因此仓库可确定的 staging frontend 容器 owner 仍是 V1。
- production Compose 没有 frontend service（`deploy/compose.prod.yaml:22-97`）；production Nginx 直接从 `/var/www/partsignal-frontend/current` 读取静态 release（`deploy/nginx/partsignal.conf.template:18-29`）。具体 release 由哪个主机脚本/外部流程写入、当前 symlink 指向哪个 V1 artifact，不能由本审计的 frontend 文件单独证明。

#### 3.2 V2

- V2 build 仅执行 `tsc -b && vite build`，没有 V1 的 production asset checker（`frontend-v2/package.json:9-20`）。
- V2 Vite 开启 TanStack Router `autoCodeSplitting`（`frontend-v2/vite.config.ts:8-13`）；当前本地忽略目录确有多个 hash route chunk，`dist/index.html` 以绝对 `/assets/...` 引用入口和 preload（`frontend-v2/dist/index.html:8-57`）。
- V2 没有配置 `base`，因此沿用 Vite 默认根路径 `/`；当前 artifact 的绝对 `/assets/` 也证明其目标是域名根部署，而不是子路径部署（`frontend-v2/vite.config.ts:8-33`，`frontend-v2/dist/index.html:8-57`）。若 staging 计划挂载到 `/v2/` 子路径，现状不能直接工作，必须显式改变 asset/router base；仓库未显示该方案，不能假定。
- V2 没有 `Dockerfile`、容器 Nginx 配置或静态 release 安装脚本。根 `make build` 只运行 `npm --prefix frontend-v2 run build`，而 V1 会构建 Docker image（`Makefile:60-65`）。因此 V2 当前 artifact owner 是本地/CI `frontend-v2/dist`，不是任何 staging/production container。
- V2 Playwright 默认通过 `npm run build && vite preview --port 4174` 服务 production artifact；如果传入外部 base URL，则不启动 webServer（`frontend-v2/playwright.config.ts:4-30`）。隔离真实栈也以 Vite preview 提供 V2（`deploy/scripts/e2e-local.sh:93-96,122-129,149-176`）。这验证 Vite preview 下的 SPA 行为，不证明 staging 容器 Nginx、production 外层 Nginx、CSP 或缓存策略下的行为。
- 当前 production 静态 Nginx 的根路径和 cache/fallback 规则从文件形态上可复用 V2 根部署 artifact（`deploy/nginx/partsignal.conf.template:28-59`），但仓库没有证据表明 release installer 已接受/安装 V2，也没有执行过正式切换。

#### 3.3 配置漂移

- `frontend/vite.config.js` 是未被 package scripts 使用的第二份配置；它没有 TS 配置中的 `build.sourcemap: true`、动态 proxy target、完整 Vitest 参数（对比 `frontend/vite.config.js:1-14` 与 `frontend/vite.config.ts:1-29`）。Cutover 删除 V1 pipeline 前需要一并确认其是否只是 build 产物/遗留文件，但本 planning task 不应顺手清理。

### 4. API base URL 与同源边界

- V1 和 V2 都把 OpenAPI 路径视为已包含 `/api`，API client 选择 `VITE_API_BASE_URL`，否则回落到当前 origin，并带 cookie（V1：`frontend/src/shared/api/client.ts:43-50`；V2：`frontend-v2/src/shared/api/client.ts:1-8`）。
- V1 对缺失 browser `location` 还有 `http://localhost` 测试兜底（`frontend/src/shared/api/client.ts:45`）；V2 直接读取 `globalThis.location.origin`（`frontend-v2/src/shared/api/client.ts:6`）。这不是部署差异，浏览器中两者都支持同源 `/api`。
- 两套 dev server 都只代理 `/api` 到 `VITE_API_PROXY_TARGET ?? http://localhost:8000`；V1 端口 5173（`frontend/vite.config.ts:10-18`），V2 端口 5174（`frontend-v2/vite.config.ts:19-27`）。
- 隔离 E2E 在 build 时把 `VITE_API_BASE_URL=http://127.0.0.1:8000` 烘焙进 V2 artifact（`deploy/scripts/e2e-local.sh:93-96`）。production/staging 若使用同源 `/api`，build 必须保持 `VITE_API_BASE_URL` 为空/未设置；当前没有 V2 release build owner 固化这一点。
- Cutover gate 需要从最终部署 artifact 发起请求并断言 URL origin/path，而不能只读取源码或复用 E2E 的跨 origin artifact。

### 5. Source map、asset cache、CSP 与错误观测

#### 5.1 Source map

- V1 明确公开生成 source map（`frontend/vite.config.ts:7-9`），且容器对 `.map` 与其他 `/assets/` 一样使用一年 immutable（`frontend/nginx.conf:12-21`）。production 外层 `/assets/` 也会静态公开任意存在的 map（`deploy/nginx/partsignal.conf.template:45-49`）。
- V2 没有 `build.sourcemap`，使用 Vite production 默认值（不生成 source map）；当前本地 V2 `dist/assets` 未找到 `.map`，与此一致。当前 V1/V2 source map 策略不一致，Phase 9 必须显式批准“V2 不发布 map”或“生成 hidden/private map 并由错误平台上传后不公开”；仓库没有错误平台/上传配置，不能猜测。

#### 5.2 Cache 与 client fallback

- production 外层 Nginx：`/assets/` 一年 immutable；`index.html` 和所有 SPA fallback 为 `no-cache`；deep link/refresh 回落 `index.html`（`deploy/nginx/partsignal.conf.template:45-59`）。
- staging 外层 Nginx：`/assets/` 覆盖 upstream cache 为一年 immutable；其他页面覆盖为 `no-cache` 并转发给 frontend 容器（`deploy/nginx/partsignal.staging.conf.template:62-76`）。真正的 SPA fallback 当前仍发生在 V1 容器 `frontend/nginx.conf`，不是外层 staging template。
- V2 没有等价容器配置；因此 staging 若仅把 build context 改到 `frontend-v2/` 会因缺少 Dockerfile/运行层而不能成立。需要单独 staging integration task 明确静态 server owner，不能在 redirect 验证 task 中临时用 Vite preview 冒充。

#### 5.3 CSP

- production/staging 外层共同加载精确 CSP：`default-src 'self'`、脚本仅同源、style 允许 `'unsafe-inline'`、连接允许同源与 HTTPS、Trusted Types policy allowlist 仅 `dompurify`，并要求 script sink 使用 Trusted Types（`deploy/nginx/partsignal-security-headers.conf:1-6`；引用点为 `deploy/nginx/partsignal.conf.template:23-26` 与 `deploy/nginx/partsignal.staging.conf.template:33-36`）。
- 现有 `check-nginx-security.mjs` 只读取 `frontend/index.html`、`frontend/public/theme-init.js`、`frontend/nginx.conf` 和 `frontend/src|public`；没有读取 `frontend-v2/index.html` 或 V2 source（`deploy/scripts/check-nginx-security.mjs:219-226,243-287,290-297`）。因此“安全头模板正确”已有静态 gate，但“V2 artifact 在该 CSP 下可启动、lazy chunks 可加载、Markdown/交互 sink 不触发 Trusted Types/CSP 错误”没有 owner 证据。
- V2 fixture E2E 使用 Vite preview，不附加仓库 CSP；Foundation smoke 虽审计 console/pageerror/requestfailed/失败静态资源并验证 refresh（`frontend-v2/tests/e2e/foundation-smoke.spec.ts:3-40`），仍不能替代部署头验证。

#### 5.4 错误观测

- V2 多数 strict fixture 收集 console、pageerror、requestfailed；Foundation smoke 还把失败 script/stylesheet/image/font 响应列为失败（`frontend-v2/tests/e2e/foundation-smoke.spec.ts:3-18,37-40`）。
- 文档要求前端错误包含 route、user-visible action、error code、request id、app version、build sha，且不得记录 credential（`docs/frontend-v2/08-testing-quality-and-acceptance.md:426-428`）。仓库中未找到 V2 生产错误上报 SDK、endpoint、release/build SHA 注入或 source map 上传流程。现状只有页面错误 UX 与测试期 runtime audit，不等于生产错误观测。

### 6. 当前 route tree：事实

#### 6.1 V1 手写路由

V1 由 `BrowserRouter` + `Routes` 手写，完整 owner 是 `frontend/src/app/App.tsx:37-82`：

- 公共：`/login`。
- 受保护：`/change-password`、`/`、`/products`、`/products/:productId`、`/tasks`、`/tasks/:taskId`、`/content/:contentVersionId`、`/publications`、`/observations`、`/observations/insights`、`/observations/insights/print`、`/observations/topics`、`/observations/:observationId/correct`、`/settings`。
- ADMIN：`/users`、`/audit`、`/configuration/ai[/channels/:channelId]`、`/configuration/platform-types`、`/configuration/platforms`、`/configuration/prompts`（`frontend/src/app/App.tsx:44-74`）。
- 未知路径统一 `<Navigate to="/" replace />`（`frontend/src/app/App.tsx:76`）。
- 匿名访问保存 `location.pathname` 到 login state；强制改密改到 `/change-password`（`frontend/src/app/ProtectedRoute.tsx:7-31`）。

#### 6.2 V2 生成路由

V2 生成树声明的 full paths 位于 `frontend-v2/src/routeTree.gen.ts:344-394`，与蓝图 `docs/frontend-v2/02-information-architecture-and-routing.md:100-140` 基本一致：

- 公共：`/login`、`/account/security`。
- 受保护根与业务：`/`、`/products[/new|/$productId|/$productId/facts|...review|...versions]`、`/content/tasks[/new|/$taskId|/$taskId/editor|/$taskId/review]`、`/content/versions/$versionId`、三类 `/publishing/*`、三类 `/geo/*`、`/settings/platforms[/types|/$platformId]`。
- ADMIN：`/settings/ai[/$channelId]`、`/settings/prompts`、`/system/users`、`/system/audit`（精确路径见 `frontend-v2/src/routeTree.gen.ts:364-394`）。
- V2 根路由没有全局 `notFoundComponent` 或 splat/catch-all；仓库中唯一 `notFoundComponent` 是 ADMIN gate 为非管理员呈现保留 URL 的 403（`frontend-v2/src/routes/_app/_admin/route.tsx:7-17`）。因此未知 V1 path 不会自动回根，也不会自动迁移。

### 7. V1 → V2 redirect map：计划、代码与缺口

`docs/frontend-v2/02-information-architecture-and-routing.md:222-241` 已给出迁移意图，但当前 V2 route 源码中不存在根级 legacy redirect route，V2 测试中也没有 legacy URL redirect suite。当前所有 `redirect()` 都用于 auth、UUID/search canonicalization 或 V2 内部导航，不是 V1 兼容映射。

以下是按现有 V1/V2 route tree 得到的 Cutover 审计表；“候选”不是已实现决定：

| V1 URL | V2 目标候选 | 状态 / 必须明确的规则 |
| --- | --- | --- |
| `/login` | `/login` | 路径不变；需最终部署 direct/refresh。 |
| `/change-password` | `/account/security` | 文档旧路由表遗漏，但代码语义明确；需 legacy redirect。 |
| `/` | `/` | 路径不变；Workbench aggregate 已覆盖。 |
| `/products` | `/products` | 路径不变；需保留/规范化可支持的 query。 |
| `/products/:id` | `/products/:id/facts` 或 `/products/:id` | **关键语义冲突**：V1 该路径直接渲染 Product Facts（`frontend/src/app/App.tsx:49-50`），V2 同路径是 Product Detail，Facts 改到 `/facts`（`frontend-v2/src/routeTree.gen.ts:361,374`）。必须由 Cutover 明确“旧书签保留事实语义”还是接受落到新详情，不能仅按 pathname 不变处理。 |
| `/tasks` | `/content/tasks` | 文档已定义（`docs/frontend-v2/02-information-architecture-and-routing.md:224-227`）；需 query 转换/canonicalization。 |
| `/tasks/:taskId` | `/content/tasks/:taskId` | 静态 ID 映射可行。 |
| `/content/:versionId` | `/content/versions/:versionId` 或 `/content/tasks/:taskId/editor` | 文档明确要求按 task/current relation 分流（`docs/frontend-v2/02-information-architecture-and-routing.md:228`）；纯 Nginx redirect 不足，当前无 resolver。必须决定不可变详情优先还是通过服务端关系解析 current editor，未知/删除 ID 失败语义也要定义。 |
| `/publications` | `/publishing/work|articles|issues` | V1 单页的 `tab=works|articles|issues`、`status/page/selected` 需要 path/query/detail 转换；不能一律跳 `/publishing/work` 后丢失选中资源。 |
| `/observations` | `/geo/observations` | 静态 path 映射；需转换旧 query 名称。 |
| `/observations/insights[/print]` | `/geo/insights[/print]` | 静态 path 映射；日期/platform query 需 canonical 测试。 |
| `/observations/topics` | `/geo/topics` | 静态 path 映射。 |
| `/observations/:id/correct` | `/geo/observations/:id/correct` | 静态 ID 映射；V2 自身会把历史 correction ID canonicalize 到尾记录，但 legacy 入口仍需注册。 |
| `/settings` | `/settings/platforms` | 文档已定义。 |
| `/configuration` | `/settings/ai` | V1 `/configuration` index 会 replace 到 `ai`（`frontend/src/app/App.tsx:64-66`）；文档表遗漏 root alias。 |
| `/configuration/ai` | `/settings/ai` | 文档已定义；query 字段需转换。 |
| `/configuration/ai/channels/:id` | `/settings/ai/:id?tab=basic` | 文档表只列集合 path；V1 detail 书签必须单列。 |
| `/configuration/platform-types` | `/settings/platforms/types` | 文档已定义。 |
| `/configuration/platforms` | `/settings/platforms` | 文档已定义；旧详情由 query-selected identity 承载时需转换到 `/$platformId?tab=...`。 |
| `/configuration/prompts` | `/settings/prompts` | 文档已定义；旧 `platform_prompt_id` 等 query 与 V2 `promptId/new` 不同，需显式转换或明确丢弃。 |
| `/users` | `/system/users` | 文档已定义；V1 `account_type/page_size` 与 V2 `accountType/pageSize` 等字段需要逐项核实。 |
| `/audit` | `/system/audit` | 文档已定义；旧 detail/filter query 到 V2 camelCase schema 需逐项核实。 |
| V1 未知路径 | 明确 404，不建议默认回 `/` | V1 当前静默回根只是旧行为（`frontend/src/app/App.tsx:76`）；V2 无 catch-all。Cutover 应把未知 URL 作为可观察 404，而不是扩大为长期兼容 fallback，除非用户明确要求保留旧行为。 |

#### Redirect owner 选择的最小边界

- 纯静态 path/parameter 映射可由 V2 legacy route 或外层 Nginx 二选一拥有；不要两边都维护同一表。
- 需要 query canonicalization、认证上下文或 API 关系解析的 `/content/:versionId`、`/publications`、旧 configuration selection 不适合只用 Nginx rewrite。
- 现有 TanStack route schema 已拥有 V2 query canonicalization，最小方案是短期 V2 legacy routes 只做输入解析和 `replace` 到 canonical V2 URL；仍需一张唯一映射表及 E2E。不要建立通用 redirect framework。
- redirect 必须使用 `replace`，否则浏览器 Back 会在 legacy→canonical 之间形成循环；现有 auth/canonical redirects 已采用 `replace` 模式（如 `frontend-v2/src/routes/_app/route.tsx:8-13`、`frontend-v2/src/routes/_app/content/tasks/index.tsx:10-18`）。

### 8. Direct deep link、refresh 与 browser history：已有证据

| Surface | 测试源码证据 | 已证明 | 未证明 |
| --- | --- | --- | --- |
| production artifact shell | `frontend-v2/tests/e2e/foundation-smoke.spec.ts:3-40` | Vite preview 下 `/publishing` direct response、App Shell、移动/桌面导航、refresh、失败静态资源/运行时错误审计。 | Nginx/CSP/cache/source map/staging hostname；测试名叫 production artifact 但 server 是 Vite preview。 |
| `/` Workbench | `frontend-v2/tests/e2e/workbench.spec.ts:3-59,61-74` | direct root、单 aggregate、canonical links、四档、loading/error/reload/retry。 | root refresh 的独立成功断言与 legacy redirect。 |
| `/products` | `frontend-v2/tests/e2e/products-list.spec.ts:3-74` | direct、refresh、Back/Forward、search/filter/sort/page、非法参数 canonicalization。 | 从旧 V1 `/products/:id` 保留 Facts 语义。 |
| Product Facts Workspace | `frontend-v2/tests/e2e/fact-workspace.spec.ts:9-44` | direct `/products/:id/facts`、refresh、单 workspace read model、四档与键盘。 | 旧 `/products/:id` redirect。 |
| `/content/tasks` | `frontend-v2/tests/e2e/content-task-list.spec.ts:3-66` | direct、refresh、Back/Forward、canonical query。 | 旧 `/tasks` 与 query redirect。 |
| Content Editor | `frontend-v2/tests/e2e/content-editor.spec.ts:3-28` | List/Detail handoff、canonical editor direct/refresh、单 Editor Context。 | 旧 `/content/:versionId` relation-based 分流。 |
| Platform Workspace | `frontend-v2/tests/e2e/platform-workspace.spec.ts:3-41` | List→Workspace、tab URL、refresh、Back/Forward、大写 UUID canonicalization。 | 旧 query-selected platform handoff。 |
| AI Workspace | `frontend-v2/tests/e2e/ai-channel-workspace-core.spec.ts:6-48`、`ai-channel-workspace-runtime.spec.ts:3-31` | canonical direct/refresh/history、tab query。 | 旧 `/configuration/ai/channels/:id` redirect。 |
| System Users | `frontend-v2/tests/e2e/system-users.spec.ts:3-43` | canonical direct、default query replace、refresh、Back/Forward。 | 旧 `/users` query translation。 |
| System Audit | `frontend-v2/tests/e2e/system-audit.spec.ts:9-35,38-65` | canonical direct/default query、详情 history Back/Forward。 | 旧 `/audit` query translation。 |

现有 fixture 测试广泛直接 `page.goto()` canonical V2 URL，并在多个列表/Workspace 覆盖 reload/Back/Forward；这证明 TanStack Router 与 Vite preview 的客户端历史机制成熟。缺口集中在：legacy 路径、最终 server fallback、最终响应头和最终 artifact。

### 9. `/login`、`/`、核心列表、Workspace 与 System 权限

#### 9.1 Auth fallback

- 受保护 V2 route 在 `beforeLoad` 中把匿名用户 replace 到 `/login`，强制改密用户 replace 到 `/account/security`；组件层重复保护异步失效（`frontend-v2/src/routes/_app/route.tsx:7-29`）。
- Router 在会话探测完成前不挂载，避免受保护 loader 提前请求业务数据（`frontend-v2/src/app/providers.tsx:10-25`）。
- component test 证明匿名 `/` → `/login`、有效 ADMIN `/` → Workbench、must-change `/` → `/account/security` 且没有 App Shell（`frontend-v2/src/app/providers.test.tsx:31-71`）。
- fixture Auth production-artifact test 从匿名 direct `/system/users` 到 `/login`，完成首次改密→`/`、自助改密、ENGINEER `/system/users` 403、logout→`/login`（`frontend-v2/tests/e2e/auth-session.spec.ts:110-160`）。
- real-stack Auth test用真实 cookie/CSRF 重复 login→forced change→`/`→System 403→logout（`frontend-v2/tests/e2e/auth-session-real-stack.spec.ts:14-79`）。
- 缺口：匿名访问 protected deep link 后，V2 当前只 redirect 到 `/login`，没有像 V1 那样保存完整 return-to URL；登录成功固定到 `/`（`frontend-v2/src/routes/login.tsx:16-27`）。Cutover 必须决定旧书签登录后是否应恢复目标；若要求恢复，这是现有行为缺口，不应误判为 redirect 已覆盖。

#### 9.2 Route-level 与 server 权限

- ADMIN subtree 在 `beforeLoad` 检查 `account_type === 'ADMIN'`，否则保留地址并显示专用 403（`frontend-v2/src/routes/_app/_admin/route.tsx:7-34`）。
- Sidebar 对非管理员隐藏 Prompt、AI、Users、Audit，但普通 Platforms 仍可见（`frontend-v2/src/app/navigation.ts:80-93,120-126`）；unit test冻结 ADMIN/非 ADMIN 可见项（`frontend-v2/src/app/navigation.test.ts:26-65`）。
- Auth fixture 已验证 ENGINEER direct `/system/users` 的 route 403（`frontend-v2/tests/e2e/auth-session.spec.ts:151-155`）；AI List/Workspace 和 System Audit fixture 也会把账户改为 ENGINEER 并 reload 后断言专用 403（`frontend-v2/tests/e2e/ai-channel-list.spec.ts:127-131`、`frontend-v2/tests/e2e/ai-channel-workspace-core.spec.ts:132-154`、`frontend-v2/tests/e2e/system-audit.spec.ts:91-111`）。
- System Admin real-stack 对 `/system/users`、`/system/audit` 两个页面和 User/Audit API 的 ENGINEER 403 有真实栈闭环（页面/API段起于 `frontend-v2/tests/e2e/system-admin-real-stack.spec.ts:235-313`）。
- 权限结论：route gate 是 UX，server 仍是最终权威；现有真实栈覆盖 System，Configuration 的真实栈也覆盖 AI/Prompt。Cutover smoke 仍需在最终 artifact/入口下重跑 ADMIN 与 ENGINEER 两种会话，不能仅依赖 hidden nav。

### 10. Cutover gap analysis（frontend 路由/构建范围）

#### P0：在 staging/Cutover 前必须关闭

1. **V2 staging runtime owner 缺失**：staging Compose 仍构建 V1，V2 无 Dockerfile/Nginx runtime；必须在独立 staging integration task 决定并只保留一个静态 server owner。
2. **Legacy redirect 未实现**：文档有意图表，代码/测试为零；`/products/:id` 还有路径相同但语义变化，不能靠静态“相同 URL”跳过。
3. **关系型 legacy 路由未决**：`/content/:versionId` 与 `/publications?tab/selected` 无安全的纯字符串映射。
4. **最终 server fallback 未验**：Vite preview 证据不能替代 staging container + outer Nginx 或 production static Nginx 的 direct/refresh。
5. **V2 CSP gate 缺失**：部署安全头存在，但 checker 与 E2E 都不在 CSP 下验证 V2。
6. **source map 策略未批准**：V1 public maps，V2 no maps；错误观测又要求 build SHA/source context，必须明确策略。
7. **final artifact API base 未验**：E2E artifact烘焙跨 origin，staging/prod预计同源但没有 V2 release build owner。

#### P1：Cutover Gate 必须可观察

1. hash JS/CSS 请求全部 2xx，`/assets/*` immutable；HTML/deep links `no-cache`。
2. `/login`、`/`、`/products`、`/content/tasks`、至少一个 Workspace、`/publishing/work`、`/geo/observations`、ADMIN `/settings/*`、`/system/users`、`/system/audit` direct + refresh + Back/Forward 通过；这也与 deployment smoke 文档要求一致（`docs/frontend-v2/08-testing-quality-and-acceptance.md:408-412`）。
3. 匿名 deep link、must-change、ADMIN、ENGINEER、logout 四种 session 行为在最终入口可观察；是否恢复匿名 deep link 必须先批准。
4. legacy URL逐项 301/302 或 client replace 到唯一 canonical URL，并验证 Back 不循环、query/ID 不丢、未知映射显式失败。
5. console/pageerror/requestfailed、JS chunk 404、CSP violation、API error/request ID 能被观察；不能把 Vite preview strict fixture 当作生产 telemetry。

#### P2：最后独立删除任务

- V1 `frontend/`、`frontend/Dockerfile`、`frontend/nginx.conf`、V1 Playwright/asset checks、Makefile/CI V1 stages、staging V1 image/build context、release scripts中的 V1 artifact 路径必须在 Cutover 观察窗关闭后才进入单独可回滚 Task。
- Phase 9 之前不要删除 V1 source maps、fallback 或 E2E，因为它们仍是 rollback artifact 与行为基线。

### 11. 最小后续验证切片建议（不在本 planning task 实施）

1. **Staging artifact integration**：只让 staging 能明确运行 V2 artifact；Required Validation 为 Docker/Compose config、静态 headers/fallback 的本地隔离测试与 staging 外部写前停止点。
2. **Legacy redirect/deep-link**：只实现并测试批准后的 V1→V2 map；Required Validation 为映射表逐项 direct/refresh/Back、query/ID、auth 与 404，不触碰部署入口。
3. **Production artifact/rollback rehearsal**：冻结同一 V2 release artifact、checksum、API base、CSP/cache/source map 策略，并演练 current↔previous 原子回退；不切生产流量。
4. **正式 Cutover/观察**：只切入口并按可观察 gate/失败判据回滚；不删除 V1。
5. **V1 pipeline removal**：观察窗结束后的最后独立任务，只删除确认不再被 rollback 使用的 V1 source/build/deploy/test owner。

以上拆分复用现有 Nginx、TanStack Router、Playwright 和 release形态，不需要创建通用 deployment 或 redirect framework。

## Code patterns

- API 同源优先：`VITE_API_BASE_URL || location.origin`（`frontend-v2/src/shared/api/client.ts:5-8`）。
- Auth 与 canonicalization 使用 router `replace`（`frontend-v2/src/routes/_app/route.tsx:7-13`；`frontend-v2/src/routes/_app/content/tasks/index.tsx:10-18`）。
- Route tree 由 TanStack plugin 自动 code split/生成（`frontend-v2/vite.config.ts:8-13`；`frontend-v2/src/routeTree.gen.ts:7-9`）。
- URL 恢复由 route schema + Playwright direct/reload/Back/Forward 验证（`frontend-v2/tests/e2e/products-list.spec.ts:44-74`；`frontend-v2/tests/e2e/content-task-list.spec.ts:49-66`）。
- SPA server fallback 与缓存分别由 Nginx location 拥有，而不是客户端 router 猜测（`frontend/nginx.conf:19-31`；`deploy/nginx/partsignal.conf.template:45-59`）。
- ADMIN route保留 forbidden URL 并展示显式 403，不 redirect 到根（`frontend-v2/src/routes/_app/_admin/route.tsx:7-34`）。

## External references

- 无。本次结论完全来自仓库源码、配置、测试与项目文档；未联网，也未核实任何 staging/production 主机或平台事实。
- 依赖版本来自锁定 package 清单：V1 React Router `^7.12.0` / Vite `^7.3.1`（`frontend/package.json:21-53`）；V2 TanStack Router `^1.170.23` / Vite `^8.2.1`（`frontend-v2/package.json:22-69`）。未使用未建立的第三方 API。

## Related specs

- `.trellis/spec/frontend/index.md`：前端规范入口与浏览器验收路由。
- `.trellis/spec/frontend/state-management.md`：URL state、server state、Workspace identity 与 refresh/Back/Forward 合同。
- `.trellis/spec/infra/ci-execution.md`：根质量入口与 V1/V2 CI 执行边界。
- `.trellis/spec/infra/e2e-isolation.md`：V2 production build + preview、真实栈与 fixture E2E 的隔离/清理边界。
- `.trellis/spec/infra/domain-security-operations.md`：staging/production 外部写、Nginx、安全头和回滚必须单独授权；production/staging keepalive 精确值也不可在 frontend task 猜测。
- `frontend-v2/AGENTS.md:53-66`：每个 V2 Task 只保留一个可 review 目标，并验证适用的 direct URL、refresh、Back/Forward。
- `docs/frontend-v2/02-information-architecture-and-routing.md:218-245`：权限、旧路由迁移意图与 V1 路由基线。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md:408-428`：Deployment Smoke、CSP/source map/cache/API base 与 observability 要求。

## Caveats / Not Found

- 未找到 V2 Dockerfile、V2 Nginx/static server config、V2 staging image、V2 production release installer 或已切换入口的仓库证据。
- 未找到任何已实现的 V1→V2 root legacy redirect、legacy redirect test、全局 V2 not-found 页面或 catch-all route。
- 未找到 `/content/:versionId` 的 task/current relation redirect resolver，也未找到 `/publications` tab/selected 到三个 V2资源路由的迁移实现。
- 未找到 V2 source map 上传、错误监控 SDK/endpoint、build SHA 注入或生产 telemetry 配置。
- 未找到在仓库 CSP 下服务 V2 artifact 的自动化 gate；现有安全检查显式读取 V1 文件。
- 无法仅从仓库确定 production `/var/www/partsignal-frontend/current` 当前内容、staging 当前运行 image digest、实际域名流量入口、任何外部 CDN/cache、DNS 或监控平台。必须由主任务列为用户/运维确认项，不能猜测。
- 当前本地 `frontend/dist` 与 `frontend-v2/dist` 的内容和时间只说明本机曾构建，因目录被忽略且本次未重建，不能作为可发布 artifact checksum 或 Cutover Gate 证据。
