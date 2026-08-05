# 收敛手动 CI 与前端测试耗时

## 目标

让 `git push origin main` 只承担远端备份和发布来源同步，不再自动消耗 GitHub Actions；保留可按需手动执行的完整 CI，并消除当前 GitHub runner 上前端 Vitest 因重复加载完整应用壳层而出现的 30 秒用例超时。

## 背景与确认事实

- `.github/workflows/ci.yml:3-6` 当前同时声明 `workflow_dispatch`、`push` 和 `pull_request`。三个键是并列触发器；GitHub 不区分“备份 push”和“开发 push”。
- 2026-08-05 最新 run `30987954494` 由 `af253fd chore: record journal` 的 `push` 触发。后端 154 个单测通过，前端 Vitest 为 7 个文件、13 个用例超时，完整 Vitest wall time 为 1095.48 秒。
- `docs/Hostdzire部署上线流程.md:50-73` 已明确部署不使用 GitHub Actions 构建产物、不查询 CI 状态，也不等待 CI；快速发布从与 `origin/main` 一致的本地主工作目录制作归档并上传服务器。
- `frontend/vite.config.ts:24-27` 已把 Vitest 限制为 2 个 worker 和 30 秒用例超时。归档任务 `07-31-frontend-test-gate-convergence` 已实测：关闭 CSS、调整 cleanup、移除 `getComputedStyle` 包装、切换 Node 22/24 均没有改善；提高 worker 会增加资源竞争，继续提高 `testTimeout` 只会延迟失败。
- 同一归档任务已证明页面级 harness 有效：`GeoObservationsPage.test.tsx` 不再为每个用例加载认证和工作台壳层后，单文件从约 47.60 秒降至 35.74 秒；完整本地 Vitest 当时连续两次约 233–238 秒。
- 最新失败集中在 `ConfigurationPages.test.tsx`、`ContentEditorPage.test.tsx`、`ContentTasksPage.test.tsx`、`GeoObservationsPage.test.tsx`、`ProductsPage.test.tsx`、`PublicationsPage.test.tsx` 和 `UserManagementPage.test.tsx`。失败用例会随 runner 负载漂移，说明应修共同测试成本，而不是给 13 个用例逐个加超时。

## 范围内需求

### R1. Push 只做备份

- `.github/workflows/ci.yml` 只保留 `workflow_dispatch`；移除 `push` 和 `pull_request` 自动触发。
- 保留现有完整 `verify` 内容和手动运行能力，不删除 CI、不增加自动部署、不让 CI 结果参与发布门禁。
- 不依赖提交消息 `[skip ci]`、`paths-ignore` 或分支命名约定实现主要行为。

### R2. 文档与真实发布链路一致

- 更新 Hostdzire 发布 Runbook 中 GitHub Actions 的定位：它是操作者按需手动执行的完整质量反馈，不会因 push 自动启动，也不是部署门禁。
- 不把当前归档上传发布改成服务器 `git pull`，不在服务器保存新的 GitHub 凭据；这不是解决 CI 触发问题所必需的改动。

### R3. 修复前端测试共同成本

- 先在干净、空闲环境记录当前 7 个慢文件和完整前端门禁基线，保留测试数、失败数、跳过数、wall time、慢用例与 CSS 告警数量。
- 复用已验证的页面级 harness：只加载被测页面所需的 Router、QueryClient、主题和业务 Provider；页面业务测试不重复加载完整认证、全部路由和工作台壳层。
- 每个领域保留必要的完整 `<App />` 路由/权限/壳层集成覆盖；`AppLayout`、`AdminRoute` 和 E2E 继续拥有完整应用链路，不能通过全部替换为孤立组件测试弱化合同。
- 优先修改最新失败的 7 个文件中仍反复 `render(<App />)` 的用例；已经采用有效页面级 harness 的部分保持不动，只处理仍有证据的完整壳层重复加载。
- 不提高 `testTimeout`、不提高同一 runner 的 `maxWorkers`、不关闭 cleanup、不过滤 CSS/console 告警、不新增测试框架或依赖。
- 只有至少三个测试文件需要完全相同且稳定的 Provider 组合时才建立共享测试 render；否则 harness 留在当前测试文件，避免第二套应用装配层。

### R4. 有界的 runner 后备方案

- 页面级 harness 优化后先运行两次完整本地前端门禁；只有本地证据达标而 GitHub runner 仍出现超时或 Vitest wall time 超过 10 分钟，才启用 2 路 Vitest shard。
- 分片必须使用 Vitest 原生 `--shard`，每个 shard 使用 1 个 worker，避免在同一两核 runner 上扩大资源竞争；不得新增自定义分片脚本。
- 分片只影响手动 CI 的执行调度，不改变测试集合、断言、跳过规则或本地权威命令。

## 验收标准

- [ ] AC1：任意 `push` 或 PR 更新不会创建新的 `ci` workflow run；GitHub Actions 页面仍可通过 `workflow_dispatch` 手动启动完整 CI。
- [x] AC2：手动 CI 保留合同、lint、typecheck、后端单元/集成、前端单元、构建、E2E 和 Compose 配置检查，不成为部署前置条件。
- [x] AC3：Hostdzire Runbook 明确 push、手动 CI 与实际归档上传发布三者边界，代码与文档无冲突。
- [x] AC4：最新失败的 7 个前端测试文件全部零失败、零跳过、无 30 秒测试超时；原有业务、权限、路由、确认和请求断言未弱化。
- [x] AC5：同一空闲环境下，优化后的目标文件集合 wall time 相对基线至少下降 20%，或每个改为页面级 harness 的慢文件均有可复现的下降证据。
- [x] AC6：完整 `npm --prefix frontend run test` 连续两次通过；记录测试数和实际耗时，不通过提高超时、worker 或隐藏告警达成。
- [ ] AC7：新配置推送后，手动 GitHub run 的 Vitest 无超时且 wall time 不超过 10 分钟；如只有 runner 仍不达标，则按 R4 启用原生 2 路分片后重新验证。
- [x] AC8：没有新增依赖、测试框架、服务器 GitHub 凭据、自动部署、兼容分支或第二套应用装配架构。

## 范围外

- 改成服务器 `git pull`、GitHub Actions 构建/发布镜像或自动部署。
- 修改产品业务行为、API/数据库合同、权限、路由或应用状态机。
- 为全部测试建立通用 fixture 工厂、测试 DSL 或新的测试运行器。
- 修复与当前变更无关的既有 E2E、视觉或外部服务失败。

## 阻塞问题

无。用户已确认 push 仅用于备份、CI 改为手动触发，并批准页面级 harness 优先、必要时原生分片的方案。
