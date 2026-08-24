# Research: 部署、CI、演练与回滚现状审计

- Query: 只读审计 `deploy/`、`Makefile`、CI 与仓库内 staging/production/rollback/monitoring 文档，确认环境入口、V1/V2 artifact/container/proxy/static owner、CSP/cache/source map/observability，以及 production-like rehearsal/rollback 的现有机制与缺口。
- Scope: internal
- Date: 2026-08-24

## Findings

### 1. 结论摘要

1. 仓库明确记录的唯一实际公网部署是 **Hostdzire staging**：公网 URL 为 `https://geo.962850.xyz`，DMIT 只做四层 SNI/端口转发与 `proxy_protocol`，Hostdzire 运行宿主机 Nginx 和固定 `partsignal-staging` Compose 栈（`docs/Hostdzire部署上线流程.md:1-3,25-40`）。由于本任务禁止远程连接，以上只能证明“仓库声明的现状”，不能证明 2026-08-24 的实时主机状态。
2. 仓库**不能证明存在已启用的 production 环境或其实际入口**。`README.md:36-38` 仍声明真实生产 VPS 未启用；`deploy/compose.prod.yaml` 和 `deploy/nginx/partsignal.conf.template` 只是生产形态配置，且前者没有 frontend 服务、后者指向未被任何仓库脚本发布的 `/var/www/partsignal-frontend/current`（`deploy/compose.prod.yaml:22-97`; `deploy/nginx/partsignal.conf.template:18-29`）。生产域名、平台、主机、TLS/DNS 入口和当前 release 都必须由用户确认，不能把 staging 域名猜成 production。
3. staging 当前 frontend owner 完整落在 V1：`frontend/Dockerfile` 构建 V1 `dist` 并交给容器内 Nginx（`frontend/Dockerfile:1-15`）；staging Compose 的 `frontend` 服务从 `../frontend` 构建并绑定 `127.0.0.1:19080`（`deploy/compose.staging.yaml:126-140`）；外层 staging Nginx 再把 `/assets/` 和其他 SPA 请求代理到该端口（`deploy/nginx/partsignal.staging.conf.template:7-10,62-76`）。
4. V2 当前只有 `npm run build` 生成的 `frontend-v2/dist` 和本地 `vite preview` 验证，没有 Dockerfile、容器内 Nginx 配置、Compose service 或远端发布 owner（`frontend-v2/package.json:9-20`; `frontend-v2/playwright.config.ts:23-31`; 全仓库 Dockerfile 清单只有 `backend/Dockerfile` 与 `frontend/Dockerfile`）。
5. 现有 staging rollback 可回到旧 release 的 V1 容器，但 `current` 只是“最后验收记录”，不是流量开关。真正回滚要从旧 release 用旧标签重启固定 Compose 服务，重新验收后才更新 `current`（`docs/Hostdzire部署上线流程.md:129-137`; `docs/Hostdzire部署附录.md:450-480`）。这正好支持 V2 staging 可逆接入，但 formal production cutover 尚无同等可执行机制。
6. 现有 CI 是手动完整质量反馈，不是部署门禁；它构建 V1 容器和 V2 裸 `dist`，不构建 V2 容器，也不运行 `make test-deploy-scripts`（`.github/workflows/ci.yml:3-5,55-76`; `Makefile:60-73`）。
7. CSP 与 Nginx 校验当前是 V1-specific。脚本读取 `frontend/index.html`、`frontend/public/theme-init.js`、`frontend/nginx.conf` 并扫描 V1 Markdown sink（`deploy/scripts/check-nginx-security.mjs:219-240,286-296`）；若 staging 改为 V2，它仍可能“绿灯”却没有校验实际被服务的 V2 artifact。
8. source map 策略存在明确漂移：V1 显式 `sourcemap: true`，build 后强制校验每个 JS 的完整公开 map 与敏感信息边界（`frontend/vite.config.ts:5-9`; `frontend/package.json:7-15`; `frontend/scripts/check-production-assets.mjs:93-175`; `frontend/README.md:57-61`）；V2 未设置 `build.sourcemap`，当前 `frontend-v2/dist` 实际为 `0` 个 `.map`，也没有对应校验脚本（`frontend-v2/vite.config.ts:8-34`; `frontend-v2/package.json:9-20`）。Cutover 前必须批准“继续禁用”或建立经审计的 map 发布策略，不能无意继承 V1 公共 map 行为。
9. 仓库已有日志轮转、健康探针、浏览器/HTTP smoke 和人工只读诊断，但没有前端错误收集器、APM、告警路由、错误率 dashboard 或自动 rollback。V2 文档只“建议”记录 route/action/error code/request id/app version/build sha（`docs/frontend-v2/08-testing-quality-and-acceptance.md:426-428`），代码与部署配置中没有该遥测 owner。

### 2. Files found

| 路径 | 一句话说明 |
| --- | --- |
| `deploy/compose.staging.yaml` | 当前 Hostdzire staging 的完整 Compose 栈；frontend 明确是 V1 context/image owner。 |
| `deploy/compose.prod.yaml` | 后端、PostgreSQL、Redis 的 production 形态；没有 frontend service。 |
| `deploy/compose.dev.yaml` | 本地共享开发栈；只编排 V1 dev frontend。 |
| `frontend/Dockerfile` | V1 Node build → Nginx 静态镜像。 |
| `frontend/nginx.conf` | V1 容器内 SPA fallback、asset/index cache owner。 |
| `deploy/nginx/partsignal.staging.conf.template` | staging 外层 Nginx；API/object storage/frontend 三 upstream。 |
| `deploy/nginx/partsignal.conf.template` | production 形态外层 Nginx；API 反代 + 宿主机静态目录。 |
| `deploy/nginx/partsignal-security-headers.conf` | production/staging 公网 CSP/HSTS 等六项安全头唯一仓库 owner。 |
| `deploy/scripts/deploy-staging.sh` | staging full/fast 共用的构建、迁移、启动和回环 smoke。 |
| `deploy/scripts/redeploy-staging-fast.sh` | 从 clean synchronized `main` 打包、上传、构建、探测并更新 `current` 的现有 staging 快速入口。 |
| `deploy/scripts/test-deploy-staging.sh` | staging deploy 顺序和 Nginx timeout 的纯本地 mock 自检。 |
| `deploy/scripts/deploy.sh` | production 形态后端部署入口；不处理前端 artifact。 |
| `deploy/scripts/backup.sh` | 对指定 Compose PostgreSQL 做权限受限逻辑备份。 |
| `deploy/scripts/restore-verify.sh` | 把备份恢复到显式一次性数据库并做最小可查询验证。 |
| `deploy/scripts/e2e-local.sh` | 独立数据库、Redis logical DB、临时 storage 上的 V1/V2 真实栈 E2E 编排。 |
| `deploy/scripts/smoke.sh` | 只检查 API `live`/`ready`。 |
| `deploy/scripts/check-nginx-security.mjs` | 当前 V1 HTML/theme/DOM sink 与外层 CSP/Nginx 的静态一致性门禁。 |
| `Makefile` | 本地质量入口；V1 Docker artifact + V2 npm artifact，部署脚本测试独立于 `verify`。 |
| `.github/workflows/ci.yml` | 仅 `workflow_dispatch` 的手动 CI；不打包或发布 release。 |
| `frontend-v2/package.json` | V2 build/test/Playwright 命令 owner。 |
| `frontend-v2/vite.config.ts` | V2 route code splitting/dev proxy owner；没有 asset base 或 source map 明示。 |
| `frontend-v2/playwright.config.ts` | V2 production `dist` 经 `vite preview` 的本地 artifact smoke owner。 |
| `frontend-v2/src/shared/api/client.ts` | V2 API base URL owner，默认同源。 |
| `docs/Hostdzire部署上线流程.md` | 当前 staging 发布/验收/停止/回滚的主 Runbook。 |
| `docs/Hostdzire部署附录.md` | staging 初始化、完整发布、备份恢复、Nginx、验收、回滚细节。 |
| `docs/operations.md` | 跨环境安全、数据、备份和回滚原则。 |
| `docs/deployed-full-functional-acceptance-plan.md` | 已部署 staging 的风险、业务、数据隔离和验收矩阵。 |
| `docs/frontend-v2/07-migration-plan.md` | Phase 9 任务序列、Cutover Gate 和 V1→V2 route map。 |
| `docs/frontend-v2/08-testing-quality-and-acceptance.md` | V2 production artifact、Deployment Smoke 与可观察性要求。 |
| `.trellis/spec/infra/ci-execution.md` | 手动 CI 与部署边界的稳定契约。 |
| `.trellis/spec/infra/domain-security-operations.md` | DNS/Nginx/证书/HSTS、环境写授权和回滚契约。 |
| `.trellis/spec/infra/e2e-isolation.md` | V1/V2 隔离真实栈/production-artifact 测试契约。 |

### 3. 当前入口：可证明与不可证明

#### 3.1 Staging（仓库声明明确，实时状态未验证）

- 公网 URL：`https://geo.962850.xyz`（`docs/Hostdzire部署上线流程.md:1-3`; `deploy/scripts/redeploy-staging-fast.sh:53-56`）。
- 流量路径：DMIT 公网入口 → WireGuard/proxy protocol → Hostdzire 宿主机 Nginx → API `127.0.0.1:19000`、frontend `127.0.0.1:19080`、object storage `127.0.0.1:19001`（`docs/Hostdzire部署上线流程.md:27-40`; `deploy/nginx/partsignal.staging.conf.template:1-15,47-76`）。
- Compose 项目：`partsignal-staging`；共享配置 `/root/partsignal/shared/.env.staging`；release `/root/partsignal/releases/<release-id>`；数据 `/root/partsignal-data`（`docs/Hostdzire部署上线流程.md:31-37`）。
- staging 使用真实 PostgreSQL/Redis/Celery，但 `fake-oss` 和确定性生成器，不使用 production OSS/模型凭据（`docs/Hostdzire部署上线流程.md:42-46`; `docs/Hostdzire部署附录.md:140-170,181-183`）。

#### 3.2 Production（仓库不足以确认）

- `deploy/compose.prod.yaml` 定义名为 `partsignal` 的后端栈，只暴露 API 回环端口，完全没有前端服务（`deploy/compose.prod.yaml:1-4,22-97`）。
- `deploy/scripts/deploy.sh` 只拉取/启动 `api worker scheduler`、迁移并探测 API，不构建、上传或切换 frontend（`deploy/scripts/deploy.sh:4-17`）。
- `deploy/nginx/partsignal.conf.template` 仍写 `server_name geo.962850.xyz` 并从 `/var/www/partsignal-frontend/current` 提供静态文件（`deploy/nginx/partsignal.conf.template:18-29`），但仓库没有任何脚本创建、填充或切换该目录。
- 较旧设计文档描述 `/var/www/geo-frontend/current` 和软链切换（`docs/GEO系统前后端技术与部署方案.md:720-729,801-818`），与当前模板路径不一致，且主 Runbook 已把同一域名明确归类为 staging。因此它只能视为历史设计线索，不能作为当前 production 事实。
- `README.md:36-38` 声明真实生产 VPS 未启用。若用户已在仓库外建立 production，该事实、入口和 owner 必须另行提供。

**必须由用户确认的外部事实：**

1. 是否存在 production；若存在，其域名、DNS/TLS 终止点、宿主/平台、Nginx/反代 owner、当前 V1 release 与静态根目录是什么。
2. `geo.962850.xyz` 是否仍只代表 staging，还是已被人工提升为 production；仓库文本目前只支持前者。
3. production 是否使用 `compose.prod.yaml`，以及前端静态 artifact 是通过仓库外手工、CI/CD、对象存储/CDN，还是其他机制发布。
4. staging 当前运行 release、`current` 指向、实际镜像和宿主机生效 Nginx 配置；本规划未连接主机，均未实时核验。

### 4. V1 / V2 artifact、container、proxy、static owner

| 层 | V1 当前 owner | V2 当前 owner | Gap |
| --- | --- | --- | --- |
| Build artifact | `npm --prefix frontend run build` → `frontend/dist`；build 含 source-map/敏感信息检查（`frontend/package.json:7-18`） | `npm --prefix frontend-v2 run build` → `frontend-v2/dist`（`frontend-v2/package.json:9-20`） | V2 无 production asset policy checker。 |
| Container image | `frontend/Dockerfile`：Node 22 build，`dist` 复制到 Nginx（`frontend/Dockerfile:1-15`） | 无 | V2 无 Docker artifact。 |
| Container static/fallback | `frontend/nginx.conf`：`/assets` immutable、`index.html`/fallback no-cache、SPA fallback（`frontend/nginx.conf:1-32`） | 无 | V2 staging 无端口 `80` owner。 |
| Staging Compose | `frontend` service，context `../frontend`，image `${PARTSIGNAL_FRONTEND_IMAGE:-partsignal-frontend}:<release>`，host `19080`（`deploy/compose.staging.yaml:126-140`） | 无 | 目前 staging 必然服务 V1。 |
| Staging outer proxy | `/assets/` 和 `/` 均代理 `partsignal_staging_frontend`，保持 API 与 object-storage 分流（`deploy/nginx/partsignal.staging.conf.template:47-76`） | 可复用相同 service name/port | 只要 V2 容器保持 `frontend:80` 和同源 `/api`，外层代理无需为框架改写。 |
| Production frontend | Nginx 模板静态 root `/var/www/partsignal-frontend/current`（`deploy/nginx/partsignal.conf.template:28-29`） | 无 | 无仓库内 static publish/symlink script；实际 owner 未知。 |
| CI | `make build` 构建 V1 Docker image（`Makefile:60-63`） | `make build` 仅运行 V2 npm build | V2 container/served artifact 未进入 CI 或 `make verify`。 |

V2 `dist/index.html` 当前使用根绝对路径 `/assets/...`，Vite 自动生成大量哈希 route chunks；这与“部署在域名根路径”匹配，但不支持未经设计的子路径部署。`frontend-v2/vite.config.ts:8-34` 未定义 `base`，因此 asset base 采用 Vite 默认 `/`。不要为 Phase 9 预先建立通用多-base framework。

### 5. V2 staging 接入：最小精确文件边界

在不改变外层 upstream 名、端口和 API 同源路径的前提下，最小实现应让现有 `frontend` service 换成 V2 artifact，而不是新增并长期维护 V1/V2 两套 staging 路由。

**预计必须新增/修改：**

1. `frontend-v2/Dockerfile`（新增）：复制 V2 lockfile，执行既有 `npm run build`，把 `dist` 放入 Nginx 静态目录。
2. `frontend-v2/nginx.conf`（新增）：只拥有容器内 `/assets/`、`index.html` 与 SPA fallback；不重复外层 CSP/HSTS。由于 Docker build context 不能读取兄弟目录 `frontend/nginx.conf`，直接复用现有文件并不可行，新增 V2 同职责文件是最小边界。
3. `deploy/compose.staging.yaml`：`frontend.build.context` 从 `../frontend` 切到 `../frontend-v2`；保持 service name、image variable、port `19080`、network 和资源限制不变，使现有外层 Nginx 无需改路由。
4. `deploy/scripts/check-nginx-security.mjs`：保留 V1 检查直到最终删除 Task，同时增加对实际 V2 HTML、V2 container Nginx 与 V2 渲染路径的 CSP-compatible 静态门禁；不能让 V1-only 检查冒充 V2 安全通过。
5. `deploy/scripts/test-deploy-staging.sh`：增加 staging compose frontend context/image owner 与 V2 container fallback 的静态断言；保留 full/fast 顺序和 `30s < 35s` 检查。
6. `Makefile`：在保留 V1 Docker build 的同时构建 V2 Docker artifact，并让 `test-deploy-scripts` 继续作为 Cutover 明确 Required Validation；当前 `make verify` 只证明 V2 裸 `dist`（`Makefile:60-73`）。
7. `frontend-v2/vite.config.ts`：把批准后的 source-map 策略写成显式 build contract。建议沿用当前实际行为 `sourcemap: false`，除非用户已有受控错误平台需要上传非公开 map。
8. `docs/Hostdzire部署上线流程.md`、`docs/Hostdzire部署附录.md`、`docs/frontend-v2/07-migration-plan.md`、`docs/frontend-v2/08-testing-quality-and-acceptance.md`：更新 staging frontend owner、V2 artifact 验收和仍保留的 V1 rollback 路径。

**按当前证据不应修改：**

- `deploy/nginx/partsignal.staging.conf.template`：现有 service/port/API/object-storage/cache 分流可直接服务 V2；只有真实 CSP/cache/deep-link 验证失败才修改。
- `deploy/nginx/partsignal-security-headers.conf`：当前 CSP 不含 inline/eval script，V2 也没有内联启动脚本；先验证，不为“V2”标签改写。
- `deploy/scripts/deploy-staging.sh`：它已按 generic `frontend` service build/up/smoke（`deploy/scripts/deploy-staging.sh:23-43`），无需新增 V2 分支。
- `.env.example` 和 Hostdzire `PARTSIGNAL_FRONTEND_IMAGE`：保留既有 image variable 与 release ID 即可回滚；为 V2 改名只会扩大环境迁移面。
- `deploy/compose.prod.yaml`、production Nginx/DNS：staging 接入 Task 不应提前碰 production。

**CI 说明：** `.github/workflows/ci.yml` 已执行 `make build`，因此若 V2 container build 被纳入该 target，手动 CI 会自然覆盖，不必再复制命令。是否把 `make test-deploy-scripts` 加入手动 CI 属 release policy 决定；当前稳定 spec 明确 CI 不是 Hostdzire 发布门禁（`.trellis/spec/infra/ci-execution.md:27-35`）。

### 6. API base URL、route fallback、asset/cache、CSP、source map

#### API base URL

- V2 client 使用 `VITE_API_BASE_URL || globalThis.location.origin`，默认同源且携带 Cookie（`frontend-v2/src/shared/api/client.ts:1-8`）。staging 外层 Nginx 把 `/api/` 代理到 API（`deploy/nginx/partsignal.staging.conf.template:47-52`），因此根域部署无需 build-time API URL。
- staging shared env 明确 `VITE_API_BASE_URL=`，`APP_BASE_URL/CORS` 指向 `https://geo.962850.xyz`（`docs/Hostdzire部署附录.md:140-170`）。
- production 实际域名和 API topology 未知；若不是同源，必须先确认 cookie/CORS/TLS contract，不能猜 URL。

#### Client routing fallback / deep link

- V1 container 的 `try_files $uri $uri/ /index.html` 已提供 SPA fallback（`frontend/nginx.conf:29-32`）；staging 外层代理所有非 API/object-storage 请求到 frontend（`deploy/nginx/partsignal.staging.conf.template:70-76`）。V2 container 必须保留等价 fallback。
- production static template自身也有 `try_files ... /index.html`（`deploy/nginx/partsignal.conf.template:51-59`），但实际静态目录没有仓库发布 owner。
- 当前部署 Runbook 的 fallback smoke 仍访问旧 V1 路径 `/products/route-fallback-check`（`docs/Hostdzire部署附录.md:376-391`）；Phase 9 必须改为 V2 canonical deep links，覆盖 direct/refresh/Back/Forward，而不是只验证任意路径返回 HTML。

#### Asset cache

- staging outer Nginx 对 `/assets/` 强制 `public, max-age=31536000, immutable`，其他页面 `no-cache`（`deploy/nginx/partsignal.staging.conf.template:62-76`）。production template同样如此（`deploy/nginx/partsignal.conf.template:45-59`）。
- V2 当前 Vite artifact 使用哈希 chunk 名，适合 immutable cache；`index.html` 必须 no-cache，且 rollback 前后旧 hashed assets 需要与旧 release/image 一起保留。
- Runbook 已要求验证 asset 的 immutable/Vary、index/fallback no-cache、安全头共存（`docs/Hostdzire部署附录.md:376-402`）。V2 staging Task 应复用这些探针并加至少一个 lazy route chunk 请求，不新增 cache framework。

#### CSP

- 唯一仓库 owner 是 `deploy/nginx/partsignal-security-headers.conf`；CSP 为 self-only scripts、允许 inline styles、HTTPS connect/images，并启用 Trusted Types（`deploy/nginx/partsignal-security-headers.conf:1-6`; `docs/operations.md:12-17`）。
- 外层 production/staging 模板均 include 该 snippet 并使用 `add_header_inherit merge`，容器配置不得重复安全头（`deploy/nginx/partsignal.conf.template:23-26`; `deploy/nginx/partsignal.staging.conf.template:33-36`; `deploy/scripts/check-nginx-security.mjs:269-287`）。
- V2 Playwright 当前通过 `vite preview` 运行，没有外层 CSP，所以 Phase 8 production-artifact 全绿不能证明 V2 在真实 CSP 下可运行。staging 接入必须以真实响应头运行 `/login`、lazy routes、Markdown、Dialog/Menu、上传等 smoke，并把任何 CSP/Trusted Types violation 视为停止条件。

#### Source map

- V1：公开完整 map 是明确文档和 build contract（`frontend/README.md:57-61`）。
- V2：当前 Vite 配置未启用 map，观察到的 `frontend-v2/dist` 中 `.map` 数量为 `0`；没有敏感信息扫描或 map 上传机制。
- 最小建议：V2 明确保持 maps disabled，Required Validation 断言 production artifact 无 `.map`、JS 无 `sourceMappingURL`、公网任意 `<chunk>.js.map` 返回 `404`。只有用户确认已有受控错误平台、上传凭据 owner 与保留策略时，才考虑 hidden map 上传；不要匿名公开 V2 源码来模拟 V1。

### 7. CI 与 release gate 现状

- CI 只由 `workflow_dispatch` 手动触发（`.github/workflows/ci.yml:1-5`）；这与 infra spec 一致，不因 push/PR 自动运行（`.trellis/spec/infra/ci-execution.md:1-12`）。
- `verify` 安装 V1/V2、运行 contract/lint/typecheck/unit/integration、`make build`、E2E 和 dev/prod Compose config（`.github/workflows/ci.yml:43-76`）。V1 Vitest 另用两个 shard（`.github/workflows/ci.yml:78-92`）。
- `make build` 当前构建 backend image、V1 frontend image、V2 dist（`Makefile:60-64`）。这证明 V2 production bundle 可生成，不证明 V2 Nginx image、cache/fallback/security headers 或 staging Compose。
- `make test-deploy-scripts` 独立存在但不属于 `make verify`（`Makefile:65-73`）；Phase 9 文档也明确 Cutover/deploy 修改要额外运行该入口（`docs/frontend-v2/07-migration-plan.md:596-602`）。
- 现有 deploy-script test 通过 mock 证明 full/fast 顺序和关键门禁，但不会构建真实 V2 image，也不会启动 Nginx/浏览器（`deploy/scripts/test-deploy-staging.sh:23-128`）。必须补最小静态 owner 断言，再以 staging 实际 artifact smoke 覆盖运行时。

### 8. Production-like data rehearsal：现有机制、可安全执行方式与缺口

#### 可复用的现有机制

1. `deploy/scripts/e2e-local.sh` 创建唯一临时 PostgreSQL database，使用独占非 0 Redis DB 和 `mktemp` storage，结束时精确 drop/delete/stop（`deploy/scripts/e2e-local.sh:18-99,116-180`; `deploy/scripts/e2e-database.py:14-53`; `deploy/scripts/e2e-environment.py:17-89`）。它已能在同一真实服务栈运行 V2 real-stack 后运行 V1，适合验证功能与清理，不会接触生产数据。
2. staging full deploy 使用独立持久 PostgreSQL、Redis/Celery、`fake-oss` 和 seed-demo（`deploy/compose.staging.yaml:24-140`; `deploy/scripts/deploy-staging.sh:23-43`）。已部署验收计划要求所有新对象使用 `E2E-ACCEPT-<run-id>`，不修改历史/真实业务记录（`docs/deployed-full-functional-acceptance-plan.md:532-570`）。
3. `backup.sh` 能从明确 Compose DB 生成逻辑备份（`deploy/scripts/backup.sh:1-17`）；`restore-verify.sh` 强制恢复到显式 `VERIFY_DATABASE_URL` 并做最小表查询（`deploy/scripts/restore-verify.sh:1-12`）。Runbook 明确禁止把该 URL 指向 staging 主库（`docs/Hostdzire部署附录.md:275-302,482-488`）。

#### 建议的最小 rehearsal 定义

- 默认采用**生产形态、合成隔离数据**，而不是复制生产数据：使用 staging 同构 Compose/V2 image，在独立 database/schema、独立 Redis logical DB、独立 object root 上准备具名 `CUTOVER-REHEARSAL-<run-id>` 数据，运行 route/permission/workspace/read-write/refresh/history 流程，最后证明只有该隔离资源被清理。
- 数据至少覆盖：空/小/跨页列表、长 Markdown、历史不可变链、revision conflict、管理员/工程师、归档/禁用/blocker、缺失可选值、无分母 `NULL`、lazy route chunks。已有 `seed-demo` 和 E2E fixtures 可提供业务形状，但不应声称代表 production cardinality。
- 所有 production-like 写操作必须落在 rehearsal clone；production 只允许未来单独获批的只读备份/统计，绝不把 UI/API 指向 production DB。

#### Gap / 用户确认项

- 仓库没有 production snapshot source、脱敏/掩码工具、数据复制流程、数据量基线、PII 分类或 rehearsal clone Compose override。`restore-verify.sh` 只证明两张表可查询，不会启动应用栈或验证业务数据质量。
- 必须由用户确认“production-like”是指业务状态覆盖、数据量/分布，还是允许使用 production 的脱敏快照。若要求后者，需要独立数据授权、导出 owner、加密传输/存储、脱敏规则、保留期和销毁证据；当前 Task 不应猜测或实现。
- staging 目前 `seed-demo` 会写入持久 staging DB（`deploy/scripts/deploy-staging.sh:33-36`）；不能把对现有 staging 主库的完整写流误称为隔离 rehearsal。
- 不应新增通用 deployment/data framework。若现有 E2E 编排无法承载 production-like 数据量，单独规划一个只服务本次演练的最小 clone/fixture 入口。

### 9. Rollback：现有机制与缺口

#### Staging 已有机制

- release 不可覆盖，`current` 保存最后验收记录，至少保留一个已验证旧 release 与镜像（`docs/Hostdzire部署附录.md:423-446`）。
- 回滚时输入经格式校验的旧 release ID，进入旧 release 的 `deploy/`，用旧 `PARTSIGNAL_VERSION` 重启 `worker scheduler api frontend fake-oss`，然后重新执行公网、浏览器和主机验收（`docs/Hostdzire部署附录.md:450-478`）。
- 只切 `current` 不改变固定 Compose 容器，因此不能作为应用回滚（`docs/Hostdzire部署上线流程.md:129-133`）。
- Nginx 回滚必须同时恢复同一个 release 的 staging template 与 security snippet，`nginx -t` 后 reload（`docs/Hostdzire部署附录.md:478-480`）。
- 数据库默认不 downgrade；若旧代码与新 schema/state machine 不兼容，先停相关写流量与 Scheduler，再由负责人决定前滚或备份恢复（`docs/Hostdzire部署附录.md:482-488`; `docs/operations.md:46-54`）。

#### 对 V2 staging 的直接结论

只要 V2 staging 继续复用 `frontend` service、`19080` 和 release-specific image tag，旧 release 的 compose context/tag 即能恢复 V1；无需 `/v1`/`/v2` 双路由、feature flag 或新 traffic switch。回滚演练必须证明：V2 → 旧 V1 container → V1 canonical routes/登录/API 正常 → 再回到 V2 候选，且两次均验证 cache 没有把新 `index.html` 与旧 hashed chunks 混用。

#### Production gap

- production actual entry/owner 未知；仓库 production Compose 无 frontend，而静态 Nginx root 无发布/回滚脚本。因此不能把 staging 的 Compose rollback 自动套用到 production。
- formal production artifact task 必须先建立一个且只有一个可逆 owner：要么 versioned frontend container + fixed upstream，要么 versioned static directory + atomic symlink。不能并存两种权威机制。
- 观察窗口、错误率阈值、API 5xx/latency、前端 runtime error、认证失败率和 rollback trigger 当前均无自动度量来源。没有 telemetry 时只能用 Nginx/API/container logs + 有界真实浏览器 probes +人工计数，不能宣称实时错误率门禁。
- 切换 Task 前必须由用户确认观察 owner、窗口长度、业务低峰窗口、P0/P1 判据和谁有外部回滚授权。自动 rollback 当前既不存在也不应在规划中臆造。

### 10. Observability 与 Cutover gap analysis

| 能力 | 当前证据 | Cutover gap |
| --- | --- | --- |
| API health | `/api/health/live`、`ready`，Compose healthcheck 和 `smoke.sh`（`deploy/compose.staging.yaml:96-100`; `deploy/scripts/smoke.sh:1-7`） | 只能证明存活/依赖，不证明路由、权限或业务正确。 |
| Container logs | production/staging 使用 json-file `10m × 3`（`deploy/compose.staging.yaml:18-22`; `deploy/compose.prod.yaml:16-20`） | 无集中检索、retention beyond local rotation、alert owner。 |
| Browser runtime | 完整发布要求登录前后无 console error/warning、失败资源/路由（`docs/Hostdzire部署附录.md:404-414`） | 手工/单次，不是持续观测。 |
| Host diagnostics | `docker ps`、`nginx -t`、端口、内存、磁盘（`docs/Hostdzire部署附录.md:512-527`） | 无阈值、周期和告警。 |
| Frontend error context | 文档建议 route/action/error code/request id/app version/build sha（`docs/frontend-v2/08-testing-quality-and-acceptance.md:426-428`） | 无实现、endpoint、vendor、privacy/retention owner；V2 artifact 也未注入 build sha。 |
| MVP monitor design | 旧设计列 HTTPS/ready/worker/DB/VPS/OOM/OSS/AI 指标，并明确未部署 Prometheus/Grafana（`docs/GEO系统前后端技术与部署方案.md:927-941`） | 设计建议不是已部署证据；production-like/error-rate gate 不能据此判定。 |
| CI feedback | 手动全量 CI（`.github/workflows/ci.yml:1-92`） | 不是发布或实时健康门禁，失败也不阻断 Hostdzire 脚本。 |

最低可行 Cutover 观测不应先造通用监控平台。可复用现有日志与探针，要求每个候选绑定 release ID/commit、记录固定时间窗内 Nginx/API 5xx、容器 restart/OOM、live/ready、关键 V2 路由浏览器 console/request failures 和业务 P0/P1；任何一项无法观察则 Gate 为 `BLOCKED`。若用户要求量化 frontend runtime error rate，必须先独立批准错误收集 owner，而不是用浏览器 smoke 冒充。

### 11. Related specs and contracts

- `.trellis/spec/infra/ci-execution.md:1-35`：CI 只有 `workflow_dispatch`，提供完整质量反馈但不是 Hostdzire 发布门禁。
- `.trellis/spec/infra/domain-security-operations.md:1-58`：DNS/Nginx/HSTS/证书写操作必须单独授权、先快照和验证，不能从只读规划推导写授权。
- `.trellis/spec/infra/domain-security-operations.md:100-131`：production/staging API upstream 必须保持 Nginx `30s < Uvicorn 35s`，部署自检锁定。
- `.trellis/spec/infra/e2e-isolation.md:1-36,68-93`：V1/V2 real-stack 使用独立 DB/Redis/storage；V2 production artifact 由 `vite preview` 验证，不等同 deployed Nginx/CSP。
- `.trellis/spec/infra/development-object-storage.md:21-27`：development/staging 默认都占用 `127.0.0.1:19001`，环境 owner 冲突必须显式处理，不能自动停范围外栈。
- `docs/frontend-v2/07-migration-plan.md:514-541`：Phase 9 必须拆 staging、rehearsal、redirect/deep-link、production artifact、rollback、cutover/observe、V1 deletion；Cutover Gate 要求最后才删除 V1。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md:408-428`：部署后路由、JS/API/fallback/cache/CSP/source map 和错误上下文验收。

### 12. External references / versions

- 本研究未访问网络，也未连接 staging/production；没有把实时 DNS、证书、容器、Nginx 或平台状态当作已验证事实。
- 仓库要求 Hostdzire 外层 Nginx `>=1.29.3`，文档记录曾确认 `1.29.8`，原因是依赖 `add_header_inherit merge`（`docs/Hostdzire部署上线流程.md:38-40`; `docs/Hostdzire部署附录.md:73-78`）。实时版本未核验。
- V1 Docker build 使用 `node:22-alpine` 与 `nginx:1.27-alpine`（`frontend/Dockerfile:1-15`）；V2 `package.json` 要求 Node `^22.22.2 || >=24.15.0`（`frontend-v2/package.json:6-8`），新 V2 Dockerfile 必须选满足 engine 的已批准 Node 版本，不能机械复制 V1 较宽泛的 tag 后假定兼容。
- V2 使用 Vite `^8.2.1`，默认 asset base/source-map 行为应以安装 lockfile 与实际 artifact 为准（`frontend-v2/package.json:43-69`）；本研究观察当前 `dist` 为根 `/assets/` 且无 `.map`。

## Caveats / Not Found

1. 未连接 DMIT、Hostdzire、DNS、证书、容器 registry、对象存储、CI 服务或任何 production/staging 环境；所有“当前”结论均限定为仓库可证明状态。
2. 未找到 production 域名、生产主机/平台、production frontend 发布脚本、V2 Dockerfile、V2 container Nginx、V2 source-map checker、前端遥测服务、集中日志、告警或自动 rollback。
3. 未找到 production 数据规模/分布、脱敏规则、production-like snapshot owner 或专用 rehearsal clone。现有 `seed-demo`/fixtures 能证明业务形状，不能证明生产容量。
4. `deploy/nginx/partsignal.conf.template` 与较旧 `docs/GEO系统前后端技术与部署方案.md` 的 static root 路径不一致；当前主 Runbook 只权威描述 staging，不能据此拼出 production 操作。
5. Phase 8 文档记录的 production artifact/E2E 全绿是在本地 `vite preview` 与隔离服务上取得，未覆盖 deployed V2 Nginx、CSP、cache、真实 staging ingress 或 production data。
6. source map 建议为本研究的最小安全默认：维持 V2 当前 disabled 行为。若用户已有错误平台或明确要求公开 map，需重新批准策略并扩展相应安全/发布验证。
