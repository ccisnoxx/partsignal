# 技术设计

## 边界

本次变更只移除截图式视觉回归的生产者、存储物、入口和文档：GitHub Actions 工作流、Playwright 视觉测试、PNG 基线、本地测试产物、npm 脚本、截图专用配置和唯一专用依赖。

Playwright 仍作为功能 E2E 运行器保留；`tests/e2e/theme.spec.ts` 等非截图测试继续使用现有 `testDir`、浏览器设备、重试、报告器、基础 URL 和 trace 配置。

## 配置与依赖处理

- 从 `frontend/package.json` 删除 `test:visual` 与 `@axe-core/playwright`。
- 使用 npm 原生命令同步移除 `package-lock.json` 中对应直接依赖和传递记录，不手写锁文件结构。
- 从 `frontend/playwright.config.ts` 删除 `snapshotPathTemplate` 和 `expect.toHaveScreenshot`，保留其余配置。
- 从 `frontend/README.md` 删除视觉基线命令和说明，将章节聚焦于界面主题及人工无障碍验收。

## 删除范围

- `.github/workflows/visual-baselines.yml`
- `frontend/tests/e2e/visual-regression.spec.ts`
- `frontend/tests/e2e/visual-regression.spec.ts-snapshots/`
- `frontend/test-results/`（本地忽略产物）

其中工作流和 49 个 PNG 当前已有未提交修改。用户已明确授权删除整套链路，因此删除覆盖这些已有视觉基线改动；其他脏文件不在范围内。

## 契约与数据

没有运行时数据流、API、数据库或业务契约变化。代码中的 `snapshot`、`platform_type_snapshot` 和 `input_snapshot` 是业务历史数据，不属于 Playwright 视觉基线，保持原样。

## 长期任务边界

扫描其他活跃 Trellis 任务，只修改会驱动后续执行的验收项和实施约束：视觉回归待办改为功能 E2E、主题检查及“不得恢复截图式视觉基线”。既有研究数据保留并标注为链路移除前的历史证据；`.trellis/tasks/archive/` 不修改。

## 兼容性与回滚

删除后 `npm run test:visual` 将不再存在，这是明确要求的行为变化。其余 `npm run e2e`、单元测试和构建命令保持可用。

若后续恢复视觉基线，应通过 Git 历史整体恢复本任务提交，而不是保留失效脚本或空快照目录。
