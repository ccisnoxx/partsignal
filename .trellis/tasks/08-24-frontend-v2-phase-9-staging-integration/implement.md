# P9.1 Staging 接入实施计划

## 前置条件

- 从最新 clean `main` 开始；当前任务已获批准并运行 `task.py start` 后才实施。
- 实施前重新读取本任务 `prd.md`、`design.md`、`implement.md` 与注入的 Trellis specs。
- 不创建临时分支，除非用户再次明确授权；不 pull、push、SSH 或部署。

## Step 1：建立 V2 production artifact

**单一目标：** 让 `frontend-v2/` 可被现有静态站点容器模式构建和提供。

变更：

- 新增 `frontend-v2/.dockerignore`。
- 新增 `frontend-v2/Dockerfile`。
- 新增 `frontend-v2/nginx.conf`。
- 修改 `frontend-v2/vite.config.ts`，显式 `sourcemap: false`。

停止条件：需要新增依赖、改变 API base URL、把安全头复制到容器层或修改 V2 产品行为。

## Step 2：切换 staging build owner

**单一目标：** 让现有 staging `frontend` service 构建 V2，而不改变运行拓扑。

变更：

- `deploy/compose.staging.yaml` 仅修改 `frontend.build.context`。
- `Makefile` 增加/复用 `build-frontend-v2`，确保根 `make build` 构建该镜像。

停止条件：必须改变 service 名、端口、镜像变量、网络、外层 Nginx、发布脚本或 production 文件。

## Step 3：补可重复的本地门禁

**单一目标：** 在不连接 staging 的情况下证明 V2 artifact 与 staging 配置合同。

变更：

- 新增 `deploy/scripts/test-frontend-v2-container.sh`。
- 修改 `deploy/scripts/test-deploy-staging.sh`，冻结 V2 context 与原命令序列。
- 修改 `deploy/scripts/check-nginx-security.mjs`，加入 V2 覆盖并保留 V1 专有规则。
- 将新检查接入现有 Makefile target，不创建通用 test framework。

停止条件：检查需要真实凭据、远程环境、业务写入，或只能通过放宽现有安全/缓存合同通过。

## Step 4：更新权威文档

**单一目标：** 让 staging 发布、验证和 V1 回滚步骤与已实现配置一致。

变更：

- `docs/Hostdzire部署上线流程.md`
- `docs/Hostdzire部署附录.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`

只记录已实现/已观察事实。外部 staging 未执行时标记为 pending，不得提前宣告 Gate=MET。

## Required Validation（本地）

### 已批准的验证支持范围

用户已批准将 `frontend-v2/tests/e2e/geo-observations.spec.ts` 纳入本任务的最小验证支持范围。只把 sort 请求的同步断言替换为同文件分页断言既有的 `expect.poll` 模式；不得修改页面代码、fixture、超时、重试、产品行为或其他测试。先运行该文件的 `foundation-mobile` 定向用例；通过后只运行一次完整 `make verify`。

按失败归因原则顺序执行：

```bash
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
make build-frontend-v2
make test-deploy-scripts
make build
make verify
git diff --check
python3 .trellis/scripts/task.py validate frontend-v2-phase-9-staging-integration
```

- `make test-deploy-scripts` 必须覆盖 V2 container runtime、staging context、Nginx/security 与发布脚本 mock。
- 本任务属于 staging release readiness，`make verify` 是 Required；只在 targeted gates 通过后运行一次。
- `.env.staging` 不存在时不创建/猜测，因此本地不以真实 staging Compose interpolation 代替远程前置检查。
- 失败仅修复可归因于本任务且在范围内的问题；环境/既有失败如实记录，不扩展任务。

## Optional Validation

- 无。已把与本次 staging release boundary 直接相关的完整根门禁列为 Required。

## 提交边界

本地门禁通过后，先向用户展示精确 diff、验证结果和 commit plan。仅在确认后提交一个原子 commit，建议 message：

```text
feat(deploy): 接入 frontend v2 staging artifact
```

该 commit 只包含本任务列出的 artifact、staging owner、门禁、runbook、Phase 9 文档和任务产物；不包含 V1 删除、production、backend/contracts 或无关文件。

## 外部操作（提交后另行授权）

### A. push

push `main` 是独立授权点；未授权不得执行。

### B. staging 只读盘点

确认实际 staging URL/主机、远程目标 commit、当前 release、上一 V1 release/tag、回滚命令和前置条件。SSH host-key 冲突、目标不明或 V1 rollback 不可用时停止。

### C. staging 激活

使用完整 staging runbook，不使用 fast redeploy。任何备份、迁移前置、build/up 或健康检查失败均停止并按已确认路径回滚。

### D. 只读验收

- HTTP：loopback API/首页、公开 `/login`、`/`、实际 hashed assets、缺失 asset、`.map`、cache/CSP headers。
- 浏览器：`/login`、`/`、`/products`、`/content/tasks`、`/publishing/work`、`/geo/observations`、ADMIN `/settings/ai` 与 `/system/audit`；验证 direct link、refresh、前进/后退和权限拒绝。
- 检查 console、page errors、failed requests、CSP violation 和 chunk 加载。
- 不访问 P9.2 legacy redirect 验证，不写业务数据。

### E. 失败回滚

从上一 V1 release 目录使用其原 Compose/tag 恢复 `frontend`，复验 loopback 与公开入口。不得回退数据库、删除 release 或切 production。

## 完成条件

- 本地 Required Validation 全绿并提交。
- 经单独授权的 staging Gate 全绿，或若尚未授权则任务不得标记 completed。
- observed evidence、回滚结果（若触发）和 remaining external unknowns 已写入任务/runbook。
- 未删除或提前弃用任何 V1 owner，且未开始 P9.2 及后续任务。
