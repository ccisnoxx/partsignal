# P9.1 Staging 接入审计

## 结论

仓库内的最小接入点是 `deploy/compose.staging.yaml` 中现有 `frontend` service 的 build context。service 名称、镜像变量、`127.0.0.1:19080:80`、外层 Nginx upstream、网络和资源限制均可复用，不需要并行 V1/V2 service 或新的部署框架。

仓库只能证明“配置预期”，不能证明当前远程 staging 的实际平台、主机、URL、运行 commit 或上一 V1 release。`https://geo.962850.xyz` 是现有 runbook/config 中的 staging 候选地址，必须在远程操作授权后只读确认，不得据此猜测生产拓扑。

## 当前 owner 与证据

| 关注点 | 当前仓库 owner | 证据与影响 |
| --- | --- | --- |
| staging 静态站点 service | `deploy/compose.staging.yaml` 的 `frontend` | 当前 build context 为 `../frontend`，镜像变量为 `PARTSIGNAL_FRONTEND_IMAGE`，端口为 `19080:80`。P9.1 只切 context。 |
| V1 production artifact | `frontend/Dockerfile`、`frontend/nginx.conf` | 已有 Node build + Nginx runtime、SPA fallback 和缓存规则；必须保留供回滚。 |
| V2 production artifact | 尚无 Docker/Nginx owner | `frontend-v2/package.json` 只有 Vite build；需补 `Dockerfile`、`nginx.conf` 和 `.dockerignore`。 |
| 外层 staging 路由/安全头 | `deploy/nginx/partsignal.staging.conf.template` 与 security snippet | 已将 `/api/`、`/object-storage/`、`/assets/` 和 `/` 分流，并统一拥有 CSP/安全头；当前无需修改。 |
| staging 编排 | `deploy/scripts/deploy-staging.sh` | 以通用 service 名 `frontend` 执行 build/up/loopback smoke；切 context 后可复用。 |
| fast redeploy | `deploy/scripts/redeploy-staging-fast.sh` | 将 staging Compose 列为关键路径；本次变更会被主动拒绝，外部激活必须走完整 runbook。 |
| build/CI owner | `Makefile`、`.github/workflows/ci.yml` | CI 调用 `make build`；只需让 Makefile 的既有入口构建 V2 镜像，无需改 workflow。 |
| API base URL | `frontend-v2` API client / Vite config | runtime 默认同源 `location.origin`，开发期 `/api` proxy 仅用于 dev；不应增加 staging 专用 fallback。 |
| source map | `frontend-v2/vite.config.ts` | 未显式设置，Vite production 默认关闭；Cutover 要求可审计，需显式 `sourcemap: false` 并在镜像/HTTP 检查。 |
| V2 client routes | `frontend-v2` route tree | 已包含 `/login`、`/`、核心列表、Workspace 和 `/settings`、`/system` 管理路由；容器需要统一 SPA fallback。 |

## Gap analysis

1. `frontend-v2/` 缺少 production container owner；不能被现有 Compose 直接构建。
2. `frontend-v2/` 缺少 `.dockerignore`；工作区现有 `node_modules` 约 434 MiB，若直接作为 context 会造成无意义上传和不稳定构建。
3. V2 source map 依赖工具默认值，缺少显式 release contract。
4. 现有容器配置检查只覆盖 V1；没有证明 V2 deep link、asset 404、缓存和 `.map` 行为的可重复门禁。
5. `test-deploy-staging.sh` 未冻结 staging frontend context，配置可能回退到 V1 而不被发现。
6. 现有 runbook 的浏览器路由仍含 V1 `/configuration/ai`，且安全检查说明只描述 V1 theme/index。
7. 远程 staging 的真实状态、上一 V1 release/tag、实际 URL 和 V2 CSP/runtime 行为均未验证。

## 最小设计边界

- 新增一个 V2 Dockerfile、一个 V2 Nginx 配置和一个 `.dockerignore`；复用 V1 已验证的构建/缓存形态，不抽象共享模板。
- 新增一个针对 V2 容器的 shell 回归脚本；Makefile 提供唯一 `build-frontend-v2` target 给根构建和该检查复用。
- 扩展现有安全检查和 staging deploy mock；不新建通用安全/部署测试框架。
- 不改外层 staging Nginx、安全 snippet、deploy script、fast deploy script 或 CI workflow，因为现有 owner 已满足合同。

## 外部未知事实

- `geo.962850.xyz` 在执行日是否仍为 staging，以及其真实主机/平台。
- staging 当前运行的 release、commit、镜像 tag 与 Compose 配置。
- 上一 V1 release/tag 的精确路径、镜像可用性及数据库兼容性。
- 真实边缘/CDN 是否覆写 cache、CSP 或 source map 可见性。
- 可用的只读/发布凭据及其权限边界。

这些事实只在用户另行授权远程操作后确认；任何不一致均是停止条件，不通过猜测或新增兼容配置消解。

