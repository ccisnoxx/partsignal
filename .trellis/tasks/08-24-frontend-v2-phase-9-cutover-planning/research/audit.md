# Research: Frontend V2 Phase 9 Cutover 总体审计

- Query: 审计 Phase 9 Cutover 的仓库内真实部署 owner、V1/V2 构建与路由、staging/production/rehearsal/rollback/monitoring 证据，并形成最小子任务边界。
- Scope: internal
- Date: 2026-08-24

## 1. 前置状态

- 开始时 `git branch --show-current` 为 `main`，`git status --short --branch` 只有 `## main...origin/main [ahead 299]`，无工作区改动；未执行 pull/push。
- `get_context.py` 显示创建前 active task 为 0。随后只按明确授权创建了 planning 状态的本 Task，未运行 `task.py start`。
- Phase 8 父任务登记的 13 个 children 均位于 `.trellis/tasks/archive/2026-08/` 且 `completed`；最终 recheck 为固定候选 `3c93e8b2…`、九阶段 `9/9 exit 0`、唯一最终 `make verify` exit `0`。
- `docs/frontend-v2/07-migration-plan.md:500-512` 与 `08-testing-quality-and-acceptance.md:394-406` 的数字和结论一致，Phase 8 Exit Gate=`MET`。两处“父任务未归档”已被后续归档事实取代。

完整归档对账见 `research/phase8-cutover-doc-audit.md`。

## 2. 当前部署入口：能证明什么

### Staging

仓库当前权威 Runbook 把 `https://geo.962850.xyz` 明确称为 Hostdzire **预发布环境**。声明的流量链路为 DMIT 四层 SNI/端口转发 → WireGuard/proxy protocol → Hostdzire 宿主机 Nginx → 回环 API `19000`、frontend `19080`、fake object storage `19001`（`docs/Hostdzire部署上线流程.md:1-3,25-46`；`deploy/nginx/partsignal.staging.conf.template:1-15,47-76`）。

本 Task 禁止远程连接，因此以上是“仓库声明的 staging 入口”，不是 2026-08-24 的实时主机核验。当前 release/SHA、实际镜像 digest、生效 Nginx 配置仍需后续只读授权确认。

### Production

仓库无法确认 production 是否存在，更不能确认其实际域名、主机或平台：

- `README.md:36-38` 仍声明真实生产 VPS 未启用。
- `deploy/compose.prod.yaml:1-97` 只有 backend/PostgreSQL/Redis，没有 frontend service。
- `deploy/scripts/deploy.sh:4-17` 只处理 backend image、migration、API/worker/scheduler，不发布 frontend。
- `deploy/nginx/partsignal.conf.template:18-59` 是 production 形态模板，静态 root 为 `/var/www/partsignal-frontend/current`，但仓库没有创建、填充或原子切换该目录的脚本。
- 模板里的 `geo.962850.xyz` 不能推导为 production；现行 Runbook 明确把它归为 staging。

结论：production 实际入口、流量切换点和 frontend 发布 owner 均为待用户确认项，不猜测。

## 3. V1/V2 artifact、container、proxy 与 static owner

| 层 | V1 | V2 | Cutover gap |
| --- | --- | --- | --- |
| build | `frontend/package.json:7-18`：`tsc -b && vite build && check-production-assets` → `frontend/dist` | `frontend-v2/package.json:9-20`：`tsc -b && vite build` → `frontend-v2/dist` | V2 无 production asset policy checker |
| source map | `frontend/vite.config.ts:5-9` 显式公开完整 map，并由 build 校验 | `frontend-v2/vite.config.ts:8-34` 未配置，当前默认不生成 | 需批准并显式冻结策略 |
| container | `frontend/Dockerfile:1-15` 构建并用 Nginx 服务 V1 | 无 Dockerfile | staging 无 V2 runtime artifact |
| container fallback/cache | `frontend/nginx.conf:19-32`：assets immutable、index/fallback no-cache、SPA fallback | 无 | V2 deep link 在最终 server 下未证明 |
| staging Compose | `deploy/compose.staging.yaml:126-140` 的 `frontend` 从 `../frontend` 构建并绑定 `127.0.0.1:19080` | 无 | staging 当前配置 owner 是 V1 |
| staging proxy | 外层 Nginx `/api/` 分流，`/assets/` 与 `/` 代理 `frontend:19080` | service/port 不变时可直接复用 | 通常不需改外层模板 |
| production static | 宿主机 Nginx 模板 root `/var/www/partsignal-frontend/current` | 无发布 owner | 实际平台和切换机制未知 |
| CI | 手动 CI 经 `make build` 构建 V1 Docker image | 只构建 V2 裸 dist | V2 container 未进入 release 证据 |

`Makefile:60-73` 的 `verify` 不包含 `make test-deploy-scripts`；`.github/workflows/ci.yml:3-5,43-92` 是手动质量反馈，不是部署门禁。完整部署审计见 `research/deploy-ci-audit.md`。

## 4. V2 staging 接入的精确文件边界

保持既有 Compose service 名 `frontend`、image variable、端口 `19080`、outer upstream 和同源 `/api` 不变，最小预计变更为：

1. 新增 `frontend-v2/Dockerfile`。
2. 新增 `frontend-v2/nginx.conf`，只拥有容器内静态文件、cache 与 SPA fallback。
3. 修改 `deploy/compose.staging.yaml`，只把 `frontend.build.context` 切到 `../frontend-v2`；不新增并行 V2 service。
4. 修改 `deploy/scripts/check-nginx-security.mjs`，保留 V1 校验并覆盖实际 V2 artifact，避免 V1-only 绿灯。
5. 修改 `deploy/scripts/test-deploy-staging.sh`，冻结 V2 build context、container fallback 和既有 deploy 顺序。
6. 修改 `Makefile`，使既有 `make build` 同时构建 V2 container artifact；不复制 CI 命令。
7. 修改 `frontend-v2/vite.config.ts`，显式批准 `sourcemap: false`；除非用户确认受控错误平台，否则不公开 `.map`。
8. 更新 `docs/Hostdzire部署上线流程.md`、`docs/Hostdzire部署附录.md`、`docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md` 的 staging owner、验证和 V1 rollback 说明。

按当前证据不应修改 `deploy/nginx/partsignal.staging.conf.template`、安全头 snippet、`deploy-staging.sh`、production Compose/Nginx 或 `.env`。只有实际 V2 CSP/cache/fallback 证据失败，才在同一 Task 停止并重新规划相应 owner。

## 5. 路由、API 与权限现状

- V1 完整手写路由 owner 为 `frontend/src/app/App.tsx:37-82`；未知路径静默 replace 到 `/`。
- V2 full paths 由 `frontend-v2/src/routeTree.gen.ts:344-394` 生成；根路由没有全局 not-found/legacy catch-all。
- V2 API client 为 `VITE_API_BASE_URL || globalThis.location.origin` 且 `credentials: include`（`frontend-v2/src/shared/api/client.ts:1-8`）。staging 根域部署可复用同源 `/api`；production topology 未知。
- V2 `_app` 匿名用户 replace 到 `/login`，强制改密 replace 到 `/account/security`（`frontend-v2/src/routes/_app/route.tsx:7-29`）。当前登录成功固定到 `/`，不恢复匿名 deep link。
- `_admin` 对非 ADMIN 保留地址并呈现显式 403（`frontend-v2/src/routes/_app/_admin/route.tsx:7-34`）；server API 仍是最终权限 owner。
- V2 fixture/real-stack 已覆盖 canonical direct、refresh、Back/Forward、ENGINEER route/API 403，但运行在 Vite preview，不证明 outer Nginx、CSP、cache 或 production hostname。

完整路由与测试证据见 `research/frontend-route-build-audit.md`。

## 6. production-like data rehearsal 可复用与缺口

可复用：

- `deploy/scripts/e2e-local.sh` 已拥有每次运行独立 PostgreSQL database、Redis logical DB、临时 storage/process 和精确 cleanup。
- `deploy/scripts/backup.sh` 可生成 PostgreSQL 逻辑备份。
- `deploy/scripts/restore-verify.sh` 只恢复到显式 `VERIFY_DATABASE_URL` 并做最小查询验证。
- staging 已使用 fake OSS 与确定性生成器；`docs/deployed-full-functional-acceptance-plan.md` 规定测试对象不得修改历史真实记录。

缺口：仓库没有 production snapshot 来源、脱敏器、字段级脱敏合同、规模基线、production clone 环境、外部副作用总开关或销毁证据。production-like rehearsal 必须在独立数据库/对象 namespace 中执行；production 连接只能按另行授权只读导出，所有 migration/E2E 写入只允许落到 clone。若无法证明源/目标 URL 不同、凭据已降权、PII/credential 已脱敏或外部 AI/OSS/第三方发布已禁用，立即停止。

## 7. 安全、缓存、source map 与错误观测

- V2 默认 asset base 为 `/`；只支持域名根路径部署，不为未证实的子路径新增 base framework。
- outer Nginx 对 `/assets/` 强制一年 immutable，对 index/fallback 强制 `no-cache`（staging template `:62-76`；production template `:45-59`）。V2 hashed lazy chunks适配该策略，但 rollback 必须保留旧 HTML 与旧 assets 同一个 release。
- CSP 的唯一仓库 owner 是 `deploy/nginx/partsignal-security-headers.conf:1-6`；V2 现有 Playwright 不在该 CSP 下运行。任何阻断页面/动作的 CSP/Trusted Types violation 是 staging 停止条件。
- V1 public source map 不应机械继承。当前最小策略是 V2 显式不生成、不发布 map，并验证 JS 无 `sourceMappingURL`、公网 `.map` 为 404。只有确认受控 error platform、上传 owner、访问和保留策略后，才规划 hidden map 上传。
- 仓库只有健康探针、json-file 日志轮转和测试期 console/pageerror/requestfailed audit；没有前端 error SDK、dashboard、alert route、build SHA 注入或自动 rollback。`docs/frontend-v2/08-testing-quality-and-acceptance.md:426-428` 只是观测字段要求，不是已部署能力。

## 8. Cutover gaps（按阻塞级别）

### Cutover 前必须关闭

1. staging 仍服务 V1，V2 无 container/static server owner。
2. production 是否存在、实际入口、切换点和 frontend publisher 未知。
3. legacy redirect 未实现；`/products/:id` 语义冲突，`/content/:versionId` 与 `/publications` 不能安全纯静态映射。
4. V2 final server 的 SPA fallback、lazy chunk、CSP、cache、API base 未验。
5. production-like 数据来源、脱敏、外部副作用和销毁边界未建立。
6. production artifact 的 immutable identity、checksum、原子切换和 previous V1 release 未建立/未确认。
7. frontend-specific rollback drill 未执行，V1 与当前 DB 合同兼容性未证明。
8. 监控来源、基线、阈值、观察窗口、通知 owner 和回滚决策人未知。

### 最后关闭

9. `frontend/`、V1 build/test/deploy pipeline 仍是 rollback 基线，必须保留到 Cutover 观察完成后。

## 9. 必须由用户确认的外部事实

1. production 是否存在；若存在：真实域名、宿主/平台、DNS/TLS 终止、反向代理/静态发布 owner。
2. `geo.962850.xyz` 是否仍为 staging，以及其当前 release/SHA、V1/V2 image 和生效 Nginx 配置。
3. staging 与 production 的 DB、Redis、对象存储、AI/第三方发布、凭据和网络是否完全隔离。
4. production 实际切换点是 DNS、Nginx、静态目录/软链、Compose image、CDN 还是其他平台能力。
5. rehearsal 数据来源、脱敏规则、恢复目标、允许写入/保留范围及外部副作用策略。
6. 现有 monitoring/log/error 产品、dashboard/query、7 日或可用基线、告警 owner 和值班安排。
7. 维护窗口、允许中断、强观察/稳定观察时长、硬/阈值回滚决策人。
8. 最后可用 V1 rollback release/image/SHA、保留位置及与当前数据库的兼容性。
9. source map 是否允许生成、是否有受控上传平台、访问权限和保留期。

## 10. Caveats

- 本审计没有执行网络、浏览器、SSH、DNS、部署、rehearsal 或 full gate；结论只代表当前仓库。
- 本地忽略的 `dist` 不能作为可发布 release/checksum 证据。
- production 模板存在不等于 production 环境存在；Hostdzire staging Runbook 也不能证明实时状态。
- 不建议创建通用 redirect/deployment/telemetry framework；每项先复用现有 TanStack Router、Nginx、Compose、Playwright 和 release 结构。
