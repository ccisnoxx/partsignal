# P9.1 Staging 接入设计

## 核心不变量

P9.1 只替换 staging `frontend` service 的静态 artifact owner，不改变对外拓扑：外层 Nginx、API/object-storage upstream、service 名、镜像变量、端口、网络和资源限制保持不变。V1 源码及旧 release 始终保留为回滚 owner。

## 仓库变更

### 1. V2 production artifact

- `frontend-v2/Dockerfile` 复用 V1 的 Node 22 Alpine build + Nginx 1.27 Alpine 结构，执行 `npm ci` 和 `npm run build`，runtime 只复制 `dist/` 与 V2 Nginx 配置。
- `frontend-v2/.dockerignore` 排除 `node_modules`、`dist`、Vite/cache/coverage、TypeScript build info 和 macOS metadata；不引入新工具。
- `frontend-v2/nginx.conf`：
  - `/assets/` 使用 `try_files $uri =404` 和 immutable cache；不存在资源绝不返回 SPA。
  - `/index.html` 与 `/` client-route fallback 使用 no-cache。
  - 安全头不在容器层重复声明，仍由外层 Nginx 唯一拥有。
- `frontend-v2/vite.config.ts` 显式设置 `build.sourcemap: false`。

### 2. staging owner 切换

`deploy/compose.staging.yaml` 只把现有 `frontend.build.context` 从 `../frontend` 改为 `../frontend-v2`。保留 `PARTSIGNAL_FRONTEND_IMAGE`，使上一 V1 release/tag 仍能用原 Compose/release 内容启动。

### 3. 最小验证 owner

- `Makefile` 增加 `build-frontend-v2`，由根 `build` 和 V2 容器回归检查共同复用；不增加通用镜像矩阵。
- 新增 `deploy/scripts/test-frontend-v2-container.sh`，用固定本地测试镜像和精确、可清理的临时容器验证：
  - client route 返回 `index.html` 且 no-cache；
  - 实际 hashed asset 为 immutable；
  - 缺失 asset 为 404；
  - 镜像内无 `.map`，JS 无 `sourceMappingURL`。
- `deploy/scripts/test-deploy-staging.sh` 增加对 `../frontend-v2` context 的断言，并保留既有完整/快速发布命令序列验证。
- `deploy/scripts/check-nginx-security.mjs` 在现有检查中加入 V2 index、V2 container Nginx 和 `frontend-v2/src`；保留 V1 theme 与 Markdown owner 专有检查，不抽象第二套框架。

### 4. 文档 owner

- `docs/Hostdzire部署上线流程.md`：记录 staging V2 owner、完整发布要求、V2 smoke routes、source map/cache/CSP 检查及 V1 回滚步骤。
- `docs/Hostdzire部署附录.md`：替换 V1 route 示例，补 direct deep link/asset/source-map 的诊断命令。
- `docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md`：记录 P9.1 仓库 Gate 与外部 Gate；真实 staging 未验证前不得标记 MET。

## 不修改的 owner

- `deploy/nginx/partsignal.staging.conf.template` 和 security snippet：现有 API/asset/root 分流与安全头 owner 足够。
- `deploy/scripts/deploy-staging.sh`：通用 `frontend` service 流程足够。
- `deploy/scripts/redeploy-staging-fast.sh`：现有关键路径保护会正确拒绝本次变更。
- `.github/workflows/ci.yml`：现有 `make build` 会继承 Makefile 的 V2 镜像门禁。
- production 配置、backend、contracts、数据库、V1 文件：全部保持不变。

## staging 激活与验证

仓库提交和 push 不自动触发远程操作。另获授权后按以下顺序：

1. 只读确认目标为 staging、远程 commit、当前 release、上一 V1 release/tag、备份/迁移前置条件和回滚命令。
2. 使用完整 staging runbook 发布目标 commit；禁止 fast redeploy。
3. 验证 loopback API/首页和公开 HTTPS。
4. 以唯一 `playwright-cli` session `frontend-v2-p9-staging-integration` 做只读浏览器检查：登录、导航、直接 deep link、刷新、前进/后退、权限拒绝、chunk/request/console/CSP；结束后关闭并确认 session 不再存在。
5. 验证 cache headers、缺失 asset 404、公开 `.map` 404 和无 `sourceMappingURL`。
6. 全部通过后才更新 runbook/任务中的 observed evidence；验证期间不创建或修改业务数据。

## 失败与回滚

以下任一项触发立即停止并回滚：关键页面不可达、API/session 失效、权限行为错误、deep link/refresh/history 失败、关键 chunk/asset 失败、CSP violation、错误率异常、公开 source map、缓存策略错误或无法确认目标/上一 V1 release。

回滚使用发布前确认的上一 V1 release 目录和 tag，执行该旧 release 自身的 Compose `frontend` build/up，再复验 loopback 与公开入口。`current` 仅是 release 记录，不作为流量切换；不回退数据库、不删除 V2 release、不修改 production。

