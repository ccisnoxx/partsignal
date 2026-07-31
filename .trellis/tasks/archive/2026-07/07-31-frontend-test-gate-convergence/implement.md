# 前端测试门禁收敛：执行计划

## 1. 实施顺序

- [x] 运行 `task.py start` 后重新载入任务上下文和前端质量规范。
- [x] 用正确命令记录完整 Vitest 基线、总耗时和慢用例，不沿用错误工作目录的结果。
- [x] 修改 `mvp-flow.spec.ts`，按 `platform_prompt_id` 验证复用 Prompt、绑定平台和预览链路。
- [x] 通过分文件与分片运行定位 Vitest 耗时根因，记录单独运行与组合运行的差异。
- [x] 在确认的具体慢测试处实施最小修复：GEO 页面测试不再重复渲染完整应用壳层。
- [x] 运行 GEO 定向测试，确认 7/7 通过且没有测试隔离、CSRF 或路由回归。
- [x] 连续两次运行完整前端测试门禁并记录耗时。
- [x] 运行定向和完整 E2E。
- [x] 运行 lint、typecheck 和差异检查。
- [x] 生成测试门禁收敛报告，核对代码、测试和任务文档一致性。

## 2. 必需验证

### 2.1 Vitest 诊断与定向验证

以下命令必须从 `frontend/` 工作目录执行，具体文件列表由测量结果确定：

```bash
npm exec -- vitest run --reporter=verbose
npm exec -- vitest run <确认的慢测试文件>
```

### 2.2 完整前端门禁

```bash
npm --prefix frontend run test
npm --prefix frontend run test
```

两次均须零失败、零跳过，并分别在当前空闲工作站 300 秒内完成。

### 2.3 E2E

项目隔离脚本会创建一次性数据库并把附加参数传给 Playwright：

```bash
deploy/scripts/e2e-local.sh tests/e2e/mvp-flow.spec.ts
make e2e
```

运行前使用项目既有 `.env` 导出 `DATABASE_URL` 与 `REDIS_URL`；仅启动服务不算通过。

### 2.4 静态检查

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
git diff --check
```

## 3. 可选验证

```bash
npm --prefix frontend run build
```

本任务默认不改生产代码，完整构建不是必需门禁；若实际修改 `vite.config.ts` 中影响构建的非测试配置，升级为必需验证。

## 4. 退出门禁

- [x] PS-QA-109 和 PS-QA-110 都有可复现的修复前证据与修复后结果。
- [x] 没有新增依赖、运行框架、兼容分支或永久诊断脚本。
- [x] 没有通过提高超时/worker、跳过测试或弱化断言掩盖问题。
- [x] 没有产品业务代码、后端、合同、数据库和 07-30 任务归档改动；如需扩展已停止并重新评审。
- [x] 已检查差异中无无关文件和 `.playwright-cli` 产物。
- [ ] 提交前展示验证结果和提交计划并取得用户确认；不自动推送。

## 5. 实施诊断记录

### 5.1 正确基线

- 单文件：`DeletionError.test.tsx` 为 1/1，约 0.97 秒；`AppLayout.test.tsx` 为 19/19，约 14.47 秒；`GeoObservationsPage.test.tsx` 原为 7/7，约 47.60 秒。
- 完整两 worker：25/25 文件、175/175 测试通过，耗时 263.41 秒（wall 263.82 秒），测试 CPU 合计 483.36 秒。
- 修订门槛后的连续验收：两次 `npm --prefix frontend run test` 均为 Vitest 175/175、视觉合同 23/23；wall 分别为 233.32 秒和 238.18 秒，均低于 300 秒。
- 完整八 worker 对照：25/25 文件、175/175 测试通过，wall 降至 150.84 秒，但测试 CPU 上升至 724.40 秒。提高 worker 明显增加资源竞争，因此不修改 `maxWorkers`。
- Node 22 容器和本机 Node 24 的同一慢用例分别约 15.6 秒和 13.8 秒，排除 Node 主版本差异。
- 调整公共 cleanup 顺序、移除 `getComputedStyle` 包装、关闭 Vitest CSS 处理均未改善耗时，相关试验改动已撤回。

### 5.2 最小收敛

- `GeoObservationsPage.test.tsx` 改为复用仓库既有页面级 harness 模式，不再为七个页面用例重复加载认证和工作台壳层；7/7 通过，单文件降至约 35.74 秒。
- 完整 Vitest 已证明会完成且零失败，PS-QA-110 应从“挂起/死锁”修正为“两 worker 下约 4 分 24 秒完成”。原 60 秒验收阈值缺乏证据，已按用户批准修订为 300 秒。

### 5.3 已通过检查

- `npm --prefix frontend run e2e -- tests/e2e/mvp-flow.spec.ts --list`：收集 3 个测试。
- `npm --prefix frontend run lint`：通过。
- `npm --prefix frontend run typecheck`：通过。
- `npm --prefix frontend run test:visual-contract`：23/23 通过。
- `git diff --check`：通过。

### 5.4 E2E 收敛

- 端口占用来自开发前端容器。测试期间只停止该容器，隔离 E2E 结束后由 trap 恢复；没有终止用户会话或改造项目脚本。
- `mvp-flow.spec.ts` 同步了生成作业必填 Prompt 身份、发布记录更多菜单、GEO 原生遮罩和移除动作确认文案等当前合同；没有恢复兼容字段或旧界面。
- GEO 详情通过现有“查看观测”按钮打开，避免第一列 Tooltip 悬停定时器与 Drawer 渲染同时触发第三方 `flushSync` 告警；控制台错误、页面错误、失败请求和失败响应仍保持零容忍，没有过滤告警。
- 定向 `deploy/scripts/e2e-local.sh tests/e2e/mvp-flow.spec.ts` 为 3/3 通过，主流程 52.8 秒，总计约 1 分钟。
- 完整 `make e2e` 为 52/52 通过，耗时 4.7 分钟；临时数据库与存储均删除，开发前端已恢复。
- 收口复跑 `npm --prefix frontend run lint`、`npm --prefix frontend run typecheck` 与 `git diff --check` 均通过。
