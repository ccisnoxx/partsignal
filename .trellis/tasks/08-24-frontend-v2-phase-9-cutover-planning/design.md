# Frontend V2 Phase 9 Cutover — Design

## 1. 设计结论

采用七个有前后依赖的独立 Task：先让现有 staging 的唯一 `frontend` service 服务 V2，再解决 legacy route/deep-link；随后并行准备隔离数据演练与 production artifact，合流做 rollback drill，最后才允许 production cutover/观察，V1 删除永远最后。

不建立并行长期 V1/V2 staging、通用 deployment framework、通用 redirect engine 或新的状态 owner。V1 作为可执行 rollback artifact 保留到 P9.7。

## 2. 环境与发布 owner

### 2.1 Staging

```text
https://geo.962850.xyz（仓库声明，未远程核验）
  → DMIT L4 forwarding
  → Hostdzire host Nginx + CSP/cache
      ├─ /api/            → 127.0.0.1:19000
      ├─ /object-storage/ → 127.0.0.1:19001
      └─ /assets/ + SPA   → 127.0.0.1:19080
                               → Compose service frontend
```

P9.1 保持 `frontend` service 名、port、image variable 和 outer Nginx 不变，只把 container build owner 从 `frontend/` 切到 `frontend-v2/`。这样旧 release/tag 仍能以相同服务接口恢复 V1。

### 2.2 Production

仓库只提供 backend Compose 与宿主机静态 Nginx 模板，没有可证明的实际 production。P9.4 在用户提供或授权只读核验真实 owner 前不得选择 publisher 或切换技术；若实际仍采用 `/var/www/partsignal-frontend/current`，只实现该平台所需的 immutable release directory + atomic pointer，不抽象其他平台。

## 3. V2 staging artifact

P9.1 的唯一运行产物是由 `frontend-v2/Dockerfile` 构建的 Nginx image：

- build stage 复用 `frontend-v2/package-lock.json` 与现有 `npm run build`；
- runtime 只复制 `dist` 与 V2 container `nginx.conf`；
- `/assets/*` 必须 immutable，`index.html` 与 SPA fallback 必须 `no-cache`；
- `/api` 仍由 outer Nginx 同源代理，build 不烘焙 staging hostname；
- container 不重复 CSP/HSTS，安全头仍由 outer Nginx 唯一拥有；
- V2 `sourcemap: false` 显式化，artifact 不含 `.map` 或 `sourceMappingURL`。

预期修改文件见 `research/audit.md` 第 4 节。外层 staging Nginx 与 `deploy-staging.sh` 先复用；只有实测失败才停止并变更规划。

## 4. Legacy redirect 与 deep-link 合同

### 4.1 单一 owner

短期兼容由 V2 TanStack legacy routes 拥有，使用 router `replace` 进入 canonical V2 URL；Nginx 只拥有 SPA fallback，不再维护第二张 redirect 表。理由是 `/publications` 需要 query/selected 解析，`/content/:versionId` 需要明确资源语义，纯 Nginx rewrite 不足。

不做全局“未知 path → `/`”。V2 根级 not-found 显式 404；已登记 legacy path 才转换。兼容 routes 在 P9.7 随 V1 retirement 一并删除或由用户另定保留期。

### 4.2 路径映射

| V1 | V2 canonical | 决策 |
| --- | --- | --- |
| `/login` | `/login` | 原路径 |
| `/change-password` | `/account/security` | replace |
| `/` | `/` | 原路径，Workbench |
| `/products` | `/products` | 原路径，search 由 V2 schema canonicalize |
| `/products/:productId` | `/products/:productId` | V1/V2 pathname 相同，运行时无法识别“旧书签”；保留已建成的 V2 Product Detail canonical contract，并验证可从详情进入 `/facts`。若必须保留旧事实页语义，需要另改 V2 公共路由合同，不伪装成 redirect |
| `/tasks` | `/content/tasks` | 转换已支持的 query 名；未知 query 不静默传递 |
| `/tasks/:taskId` | `/content/tasks/:taskId` | ID 原样保留 |
| `/content/:versionId` | `/content/versions/:versionId` | ID 是 content version，确定性进入不可变详情；不新增 backend resolver 猜 current task/editor |
| `/observations` | `/geo/observations` | 转换已支持 search |
| `/observations/insights` | `/geo/insights` | 转换日期/platform search |
| `/observations/insights/print` | `/geo/insights/print` | 同上 |
| `/observations/topics` | `/geo/topics` | 静态映射 |
| `/observations/:id/correct` | `/geo/observations/:id/correct` | ID 原样保留，后续由 V2 canonicalize chain tail |
| `/settings` | `/settings/platforms` | V1默认设置页 |
| `/configuration` | `/settings/ai` | V1 index 默认 AI |
| `/configuration/ai` | `/settings/ai` | 集合映射 |
| `/configuration/ai/channels/:id` | `/settings/ai/:id?tab=basic` | detail ID 原样保留 |
| `/configuration/platform-types` | `/settings/platforms/types` | 静态映射 |
| `/configuration/platforms` | `/settings/platforms` | 支持的 selected ID 转成 workspace path，否则集合 |
| `/configuration/prompts` | `/settings/prompts` | 支持的 prompt ID 转成 V2 search，否则集合 |
| `/users` | `/system/users` | snake_case legacy search 转 V2 camelCase |
| `/audit` | `/system/audit` | legacy filter/detail search 逐项转换 |

`/publications` 单独按以下优先级解析：

1. `kind=work&selected=<id>` → `/publishing/work/<id>`；
2. `kind=article&selected=<id>` → `/publishing/articles/<id>`；
3. `kind=issue&selected=<id>` → `/publishing/issues/<id>`；
4. `tab=articles` → `/publishing/articles`；
5. `tab=history&status=RESOLVED` → `/publishing/issues?status=RESOLVED`；
6. `tab=history` 的 closed work 只有在 V2 canonical work list 明确支持 `CLOSED` 后才映射；当前不支持，是 P9.2 的停止/决策点；
7. 其他 → `/publishing/work`，仅转换 V2/backend 已支持的 filter。

如果 legacy query 需要新 API、数据 lookup 或无法保持资源 identity，P9.2 停止并提出最小 blocker；不得丢参后宣称成功。当前批准候选明确把 `/content/:versionId` 定向到 version detail，因此不需要 relation resolver。`/products/:productId` 则接受“同一产品 identity、页面职责从 Facts 变为 Detail”的已知语义变化；这是无法通过 URL redirect 消除的 Cutover 决策。

### 4.3 Browser 行为

- 已认证：legacy direct → canonical，refresh 保持 canonical，Back/Forward 不形成 legacy/canonical loop。
- 匿名：protected deep link → `/login?redirect=<原始安全站内 URL>`；登录成功 replace 回 canonical target。`redirect` 只允许同源绝对路径，禁止 scheme/host 与开放重定向。
- 强制改密：先到 `/account/security`，完成后再回 approved target；若现有合同不允许恢复，则 P9.2 明确记录固定回 `/`，不能测试成另一种行为。
- 无权限：ADMIN legacy/canonical path 对 ENGINEER 保留地址并显示 403；对应 API 仍返回 403。
- 未知路径或不存在资源：显式 404/既有 API error，不回 `/`、不伪成功。

## 5. 核心 route acceptance matrix

最终入口至少覆盖：

- public/auth：`/login`、匿名 protected deep link、首次强制改密、logout；
- root/list：`/`、`/products`、`/content/tasks`、`/publishing/work`、`/geo/observations`；
- Workspace/Detail：Product Facts、Content Editor/Review、Publication Work、GEO Observation、Platform、AI Channel；
- ADMIN：`/settings/ai`、`/settings/prompts`、`/system/users`、`/system/audit`；
- ENGINEER：系统/管理员路由显式 403，直接 API 同样 403；普通 Platform 路由仍按现有权限可用。

每个代表 route 验证 direct、refresh；有 URL state/workspace tab 的 route 还验证 Back/Forward。浏览器审计同时捕获 console error、pageerror、requestfailed、失败 script/style/image/font、CSP violation 与未声明 API。

## 6. Production-like data rehearsal

```text
production read-only export（单独授权）
  → approved sanitization before general access
  → isolated rehearsal PostgreSQL + isolated object namespace
  → migrations / V2 artifact / route & business smoke write only to clone
  → evidence + cleanup verification
```

硬边界：

1. production 连接凭据只允许只读导出；不运行 migration、test、seed 或 mutation。
2. source 与 target DSN 必须显式解析并证明不同；target 不能是 production host/database。
3. 账号标识、联系方式、token、API key、prompt secret、外部 URL credential 等按批准字段清单脱敏；未知敏感字段停止，不做猜测替换。
4. AI、邮件、真实 OSS、第三方发布和 scheduler 外部副作用禁用；使用现有 deterministic/fake adapter 或专用低权限 rehearsal 配置。
5. 所有写入只在 clone；对象使用独立 prefix/bucket，不覆盖 production object。
6. rehearsal 完成后销毁 clone/prefix 属独立外部删除授权；未获授权则隔离保留并报告，不顺手清理。

不为一次 rehearsal 创建通用 anonymization/platform framework。若 production 数据不能合法脱敏，改用经业务 owner 批准的 production-scale synthetic fixture；不得把普通小 fixture 宣称为 production-like。

## 7. Artifact、cache、CSP、source map 与观测

### Artifact

- release identity 至少含 Git SHA、构建时间、artifact checksum、V2 package lock checksum、API base mode、source map policy。
- V2 HTML 与其 hashed assets 同 release 原子发布；旧 V1/V2 release 在观察期内不删除。
- production 实际 owner 未确认前，P9.4 不编写 publisher。

### API/base/cache

- 默认同源 `location.origin` + `/api/v1/*`；若 production 跨源，必须先独立确认 CORS/Cookie/TLS，不烘焙猜测 URL。
- 所有 HTML/deep link `200` 且 `no-cache`；hashed JS/CSS `200` 且 `public, max-age=31536000, immutable`；缺失 asset `404`，不能 fallback 到 HTML。
- lazy route chunk 在 direct、导航、refresh 与 rollback 后均可加载；旧 assets 与旧 HTML 一起保留。

### CSP/source map

- 复用现有 self-only script CSP 与 Trusted Types；不增加 `unsafe-eval` 或宽松 policy。
- 默认 V2 source map disabled，artifact 与公网都无 `.map`；若用户确认 error platform，P9.4 可改为 hidden map 上传并从 public artifact 排除。

### Error observation

必须能按 release/build SHA 关联：route、用户可见 action、error code、request id、HTTP status、JS chunk/asset failure、CSP violation；不得记录 cookie、credential、请求 body 或敏感响应。若没有已部署平台，正式 Cutover 前至少建立可重复的 synthetic probes + Nginx/API log query 和明确人工 owner；不伪装成 APM。

## 8. 正式切换与观察

### 前置

- P9.5 rollback drill=`MET`；Cutover Gate 其余项全绿。
- 用户确认 exact production endpoint、切换控制点、V1 previous release、维护窗口、监控查询和回滚决策人。
- 再取得一次仅针对该 release、该入口、该窗口的 production 写授权。

### 建议观察窗口（待用户确认）

- T0–15 分钟：每分钟 synthetic critical-route probe，现场 owner 不离席。
- T+15–120 分钟：每 5 分钟 probe，持续检查 error/API/CSP/asset 指标。
- T+2–24 小时：稳定观察；24 小时内无 P0/P1 才完成 P9.6。
- P9.7 不早于 P9.6 完成；V1 artifact 的外部保留期由用户另行确认，不在 P9.7 顺手删除。

### 立即回滚（任一即触发）

- 认证/session/强制改密不可用，或 ADMIN/ENGINEER 权限越权。
- production 数据完整性/敏感信息风险，或任何意外 schema/config 写入。
- `/login`、`/`、核心列表/Workspace 中任一关键 canary 连续两次失败。
- 可复现 redirect loop、SPA refresh 失败、API base/CORS 错误、lazy chunk/关键 asset 404。
- CSP/Trusted Types 阻断关键页面或动作。
- artifact/release identity 不可确认，或 V1 rollback target 不再可用。

### 阈值回滚（需用户用真实监控补齐）

`frontend uncaught/page-load error rate`、API 5xx、API p95、登录失败率必须以已确认 dashboard 与近期同窗口基线定义。仓库没有流量和监控证据，当前不能安全写死百分比。P9.4/P9.6 若仍无法给出查询、基线、阈值、持续时间和 decision owner，Cutover Gate=`NOT_MET`，不得以“继续观察”替代。

## 9. Cutover Gate

### `MET`

同时满足：

1. 固定 clean-main SHA 的 V2 immutable artifact、checksum、API base 和 source map policy可追溯。
2. staging 实际入口（经授权核验）服务该 V2 release；V2 container/outer Nginx 的 fallback、CSP、cache 与 lazy chunks 全绿。
3. legacy map逐项 direct/refresh/Back/Forward，无循环、无 identity 丢失；未知 path 显式 404。
4. `/login`、`/`、核心列表、代表 Workspace、Settings/System 的匿名、must-change、ADMIN、ENGINEER 与 server API 权限矩阵全绿。
5. isolated production-like rehearsal 完成，有 production 零写入、脱敏/副作用控制和 cleanup/隔离证据。
6. production artifact publisher/切换点、previous V1 release、Nginx/config snapshot 与 rollback command 已冻结。
7. rollback drill 从 V2→V1→V2 成功，V1 与当前 DB contract 兼容，耗时在批准窗口内。
8. source map 公布/隐藏策略、错误日志/dashboard/query、build SHA、baseline、阈值、通知和决策 owner 已批准。
9. release gate 的独立阶段、`make test-deploy-scripts` 和唯一最终 `make verify` 均 exit `0`；open P0/P1/P2=`0/0/0`。
10. production cutover 的 exact 写授权已给出；P9.7 尚未开始，V1 source/pipeline/artifact 仍可用。

### `NOT_MET`

任一 Required Validation 非零/不可运行，外部事实或授权缺失，出现未关闭 P0/P1/P2、隐式 fallback、无法回滚、production 数据写风险、不可观察阈值，或 V1 已被提前删除，即为 `NOT_MET`。不机械重跑，也不把未知写成通过。

## 10. 回滚策略

1. Cutover 前记录 production 生效入口/Nginx/config snapshot、V1 release SHA/checksum 与 V2 release SHA/checksum。
2. 只回切 frontend 流量/static pointer/container image 到最后已验证 V1 release；本 Phase 不含 DB migration，因此不做 database downgrade。
3. 若实际切换需要 Nginx，先恢复同 release 模板/snippet，`nginx -t` 后 reload；若是平台 pointer/image，则使用该平台原生原子机制。
4. 回切后验证 health、`/login`、`/`、V1 核心 route、API session、cache/CSP；持续观察到失败信号恢复。
5. 保留失败 V2 release、日志和现场；删除/cleanup 另行授权。
6. 若任何子 Task 引入 DB/permission/public contract 变化，停止并重新规划，不能继续使用“frontend-only rollback”假设。

## 11. V1 retirement

P9.7 只在 P9.6 24 小时观察完成且用户再次批准后开始。它删除 repo 内 `frontend/` 及 V1-only Makefile/CI/deploy/security/test/docs owner，保留 production 外部 previous artifact 直到单独批准的保留期结束。回滚方式是 revert P9.7 commit 并用保留 artifact 重建；不在该 Task 删除外部镜像、release、backup 或数据。
