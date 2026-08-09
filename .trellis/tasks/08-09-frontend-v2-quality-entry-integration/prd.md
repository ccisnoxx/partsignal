# Frontend V2 Quality Entry Integration

## 目标

让仓库根质量入口与手动 CI 同时覆盖 V1 和 V2，并为 V2 Foundation 建立针对真实 production build artifact 的最小 Playwright smoke，使 Phase 1 的基础设施可以通过统一门禁进入下一阶段。

## 已确认事实

- 实施基线必须是最新且干净的本地 `main`；本地 `main` 可以领先 `origin/main`，不得 reset、回退、自动 pull 或 push。
- 实施分支为 `codex/frontend-v2-quality-entry-integration`，Task 获批前不创建分支、不激活任务。
- V1 根入口由 `Makefile`、`.github/workflows/ci.yml` 与 `deploy/scripts/e2e-local.sh` 负责；V1 E2E 使用隔离 PostgreSQL、真实 API/Worker/对象存储与 Playwright。
- V2 已具备 Vite production build、TanStack Router、App Shell、Sidebar/mobile navigation、breadcrumb、active navigation 与认证启动请求，但尚无 Playwright 配置和脚本。
- Compose、nginx、Dockerfile 和生产静态目录仍指向 V1，本 Task 只审计、不修改。

## 需求

1. `make bootstrap` 同时安装 `frontend` 与 `frontend-v2` 依赖。
2. `make contract-check` 同时验证 V1/V2 OpenAPI generated types。
3. `make lint`、`make typecheck`、`make test-unit` 同时运行 V1/V2 对应检查。
4. `make build` 保留 backend/V1 Docker build，并增加 V2 production build。
5. `make e2e` 保留现有 V1 隔离 E2E，并增加 V2 Foundation production artifact smoke。
6. `make verify` 继续通过既有 target 组合覆盖合同、lint、typecheck、unit、integration、build、E2E 和 Compose 静态检查。
7. 任一 V1/V2 检查非零退出时，根入口和 CI 必须失败；不得静默跳过、并行包装、过滤错误或固定成功。
8. CI 同时缓存和安装两份 lockfile；保持 `workflow_dispatch`、`verify` job、V1 两路 Vitest shard 与单 worker，不为 V2 增加 shard。
9. V2 smoke 必须由 V2 自己的 Playwright config、脚本和测试目录运行，只添加 Foundation smoke 所需的最小 Playwright 依赖。
10. V2 smoke 必须先构建再通过 `vite preview` 服务真实 `dist`，不得使用 Vite dev server。
11. 如需隔离认证/API，使用显式命名的 Playwright fixture；fixture 不进入运行时代码，也不冒充真实业务 E2E。
12. 同步更新直接受影响的 Frontend V2 测试文档与 frontend/infra Trellis specs。

## V2 Foundation Smoke 验收

- [ ] production build 可以启动，`/` 直接访问成功并渲染 App Shell。
- [ ] `/products` 作为 deep link 可直接访问，刷新后继续渲染 Foundation 页面。
- [ ] 375×900 下 mobile navigation 可打开、导航并关闭。
- [ ] 1440×1000 下 desktop Sidebar 可用。
- [ ] `/products` breadcrumb 与 active navigation 正确。
- [ ] 没有未捕获 `pageerror`、未允许的 `console.error`、失败请求或失败静态资源。
- [ ] 测试通过显式匿名认证 fixture 与真实后端区分；任何未声明 API 请求使测试失败。
- [ ] 不请求或断言 Products 业务数据，不测试 workflow、mutation 或业务权限。

## 整体验收标准

- [ ] 根 `bootstrap`、`contract-check`、`lint`、`typecheck`、`test-unit`、`build`、`e2e`、`verify` 均按批准设计覆盖 V1/V2。
- [ ] CI YAML 保持仅手动触发和 V1 shard，且 `verify` job 覆盖 V2 install/cache、unit、build 和 smoke。
- [ ] V1 build、tests、E2E 和 CI shard 未删除、弱化或改写。
- [ ] 必需的 targeted、npm、Make、CI/Compose 静态检查完成；`make verify` 作为 Phase 1 最终门禁通过，或按规范记录环境阻塞证据。
- [ ] 相关文档/spec 与 Makefile、CI、V2 Playwright 实现一致。
- [ ] 最终 diff 不含部署切换、下一阶段业务功能或无关文件。

## 明确非目标

- Products List、Product Facts 或任何业务页面/业务 Playwright。
- 后端业务逻辑、OpenAPI contract、数据库和权限变更。
- Compose、nginx、Dockerfile、生产静态目录、V2 部署接管或 release/cutover。
- 删除或弱化 V1 build/E2E、删除 `frontend/`、修改 CI 触发策略。
- 根 npm workspace、Nx、Turborepo、concurrently 或其他任务编排框架。
- 额外 CI shard、复杂并行框架、push、merge、archive 或 Phase 2。
