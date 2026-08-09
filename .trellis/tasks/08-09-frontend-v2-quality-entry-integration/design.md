# Frontend V2 Quality Entry Integration — Design

## 设计概览

继续使用根 `Makefile` 作为本地聚合入口和 `.github/workflows/ci.yml` 作为手动 CI 编排，不引入 workspace 或新运行框架。每个现有 target 在 V1 命令后顺序追加对应 V2 npm script；Make 和 GitHub Actions 以原生非零退出传播失败。

V1 E2E 保持由 `deploy/scripts/e2e-local.sh` 管理真实隔离服务。V2 Foundation smoke 独立存在于 `frontend-v2/`，由 Playwright `webServer` 执行 V2 build 后启动 `vite preview`，仅验证生产 artifact 的 App Shell/Router 基础能力。

## 根质量入口

- `bootstrap`：backend sync → V1 `npm ci` → V2 `npm ci`。
- `contract-check`：backend contract check → V1 generated types check → V2 generated types check。
- `lint`、`typecheck`、`test-unit`：保留 backend/V1，末尾追加 V2 对应 script。
- `build`：保留 backend/V1 Docker build，末尾追加 V2 `npm run build`。
- `e2e`：先运行现有 V1 隔离 E2E，成功后运行 V2 smoke。
- `verify`：不引入第二套逻辑，继续组合现有 targets；其覆盖面随各 target 扩展。

每条命令使用独立 recipe 行，不使用 `-` 前缀、`|| true`、`continue-on-error` 或并行聚合。第一个失败保留真实退出码并停止当前入口。

## CI 设计

`verify` job 的 `setup-node` 使用 multiline `cache-dependency-path` 同时包含两份 lockfile，并顺序 `npm ci` 两个前端。合同、lint、typecheck、build 与 E2E 继续调用 Make targets，因此自然覆盖 V2。

V1 Vitest 仍只在 `frontend-test` 的两路 shard 中执行；`verify` job 保留 V1 visual-contract，并直接运行一次未分片的 V2 Vitest。现有 Chromium 安装步骤保留，V2 使用与 V1 当前锁定版本一致的 `@playwright/test`，不增加浏览器或并行框架。

CI 仍只有 `workflow_dispatch`。本 Task 不 push，因此只做 YAML 与 Compose 静态验证；远端手动 run 不属于本次授权。

## V2 Playwright 与 production artifact

`frontend-v2/playwright.config.ts` 约定：

- `testDir: './tests/e2e'`、`workers: 1`、`fullyParallel: false`，不添加 retries 或任意 timeout。
- `webServer.command`：`npm run build && npm exec -- vite preview --host 127.0.0.1 --port 4174 --strictPort`。
- `webServer.url` 和 `baseURL`：`http://127.0.0.1:4174`；`reuseExistingServer: false`。
- 两个 Chromium projects：375×900 与 1440×1000；两者运行同一 Foundation smoke，不是 CI shard。
- 失败 trace 输出到已被根 `.gitignore` 覆盖的 `frontend-v2/.cache/playwright-results`。

`frontend-v2/package.json` 只新增 `e2e: playwright test` 与 `@playwright/test` dev dependency。Playwright config 和 E2E 测试纳入 `tsconfig.node.json`；现有 `vite.config.ts` 在保留 Vitest 默认 exclude 的基础上排除 `tests/e2e/**`，避免把 Playwright spec 导入为 unit suite，不新增独立 tsconfig。

## Auth/API Fixture 边界

自动 fixture `foundationApi` 只处理 `GET /api/v1/auth/me`，返回匿名 `204`，从而让 App Shell 在没有真实后端时完成认证启动。fixture 捕获所有其他 `/api/v1/**` 请求，返回显式隔离错误并在 teardown 断言列表为空。

fixture 只位于 `frontend-v2/tests/e2e/fixtures/`，不导入 `src/`，不提供业务数据，不实现运行时 fallback。V1 隔离 E2E 继续代表真实服务场景；V2 测试明确命名为 Foundation fixture smoke。

## Smoke 数据流

```text
Playwright
→ webServer 执行 V2 build
→ vite preview 服务 frontend-v2/dist
→ 浏览器 direct URL / refresh / navigation
→ foundationApi 仅隔离 auth/me
→ 页面错误、失败请求和静态资源失败汇总
→ 任一异常或未声明 API 使测试失败
```

测试先直接访问 `/`，再直接访问和刷新 `/products`，并分别验证 desktop/mobile navigation、breadcrumb 与 active state。Products 仅为已存在的 Router Foundation 占位页，不读取业务数据。

## 兼容、运维与回滚

- 不改变公共 API、OpenAPI generated shape、数据库、运行时环境变量或部署指向。
- 不修改 V1 Playwright 配置、tests、`deploy/scripts/e2e-local.sh`、Compose、nginx 或 Dockerfile。
- 回滚点是实施分支创建时记录的最新 `main` commit。未合并前仅反向撤销本 Task diff 或放弃临时分支，不 reset、回退或覆盖用户改动。
- 若 Docker、数据库、Redis、浏览器或网络不可用，保留精确命令与首个失败证据；未通过 `make verify` 不宣称 Phase 1 完成。
