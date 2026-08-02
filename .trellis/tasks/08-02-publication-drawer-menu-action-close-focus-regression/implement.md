# 发布 Drawer 菜单动作关闭焦点回归实施计划

## 1. 开始门禁

- [x] 用户评审并批准本任务最新 `prd.md`、`design.md`、`implement.md`。
- [x] 批准后运行 `python3 ./.trellis/scripts/task.py start 08-02-publication-drawer-menu-action-close-focus-regression`；批准前不修改产品或测试代码。
- [x] 实施前使用 `trellis-before-dev` 加载前端上下文，并复核主工作目录仍在 `main`，除当前任务、既有 `test-results` / Playwright 报告和 `.playwright-cli/` 诊断产物外没有未识别改动。
- [x] 不创建分支、不拉取远端、不自动推送，不纳入任何诊断产物。

## 2. 实施顺序

- [x] 在 `PublicationDrawer` 关闭 Ant Drawer 的 `focusTriggerAfterClose`，保留默认焦点圈定与自动入焦。
- [x] 增加单一入场完成 ref，覆盖 rc Drawer 在入场动画完成前直接关闭且不触发 `afterOpenChange(false)` 的分支。
- [x] 增加中文注释，说明业务回焦所有权和快速关闭生命周期边界。
- [x] 将现有发布记录更多菜单回归改为 `userEvent` 交互，证明菜单项真实获焦后关闭仍返回原触发器。
- [x] 复跑候选直接关闭、发布记录直接入口和 dirty 确认用例，确认既有修复不回退。
- [x] 在 `.trellis/spec/frontend/hook-guidelines.md` 补充稳定约束：显式业务回焦必须关闭重复内建回焦，并覆盖入场未完成的直接关闭。
- [x] 搜索确认没有第二处焦点目标、延时、DOM 查询、fallback 或无关重构。

## 3. 必需验证

### 3.1 针对性组件回归

在 `frontend/` 目录执行：

```bash
npx vitest run src/features/publications/PublicationsPage.test.tsx --reporter=dot
```

必须确认发布记录菜单动作、候选直接关闭和 dirty 关闭链全部通过。

### 3.2 真实浏览器回归

沿用上一任务已验证的隔离环境变量和空闲 Redis 逻辑库，运行现有 MVP 文件：

```bash
deploy/scripts/e2e-local.sh tests/e2e/mvp-flow.spec.ts
```

必须确认：

- `mvp-flow.spec.ts:781-794` 的原 `toBeFocused()` 断言通过；
- Drawer 的 `record` 查询参数按原流程清除；
- 隔离数据库、服务进程和临时对象存储由脚本成功清理；
- 不通过修改测试断言、超时或数据准备绕过问题。

若完整 MVP 在焦点断言之后暴露范围外失败，只记录实际结果并按失败归因处理；不得擅自扩展本任务。

### 3.3 前端静态门禁

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint
git diff --check
```

## 4. 可选验证

必需验证通过后，仅在环境和耗时允许时执行：

```bash
npm --prefix frontend run test
npm --prefix frontend run build
```

完整 `make e2e` 留到 Dashboard 视觉基线等剩余事项完成后的集中回归；本任务不重复承担已知独立失败。

## 5. 质量检查与收尾

- [x] 必需验证完成后运行 `trellis-check`，对照 PRD、设计、前端规范和完整 diff 检查。
- [x] 确认 `focusTriggerAfterClose: false` 只关闭重复回焦，`trap` 与 `autoFocus` 仍保持默认。
- [x] 确认组件测试真实经过菜单项焦点，不是触发器从未失焦的假通过。
- [x] 运行 `trellis-update-spec` 判断；已更新现有 Hook 规范，未创建新规范文件。
- [x] 展示精确提交文件清单、验证结果和提交说明，用户已确认按该范围提交。
- [ ] 提交成功后才运行 `task.py archive` 和 `add_session.py`；执行前说明项目配置可能要求独立 Trellis bookkeeping 提交。

## 5.1 实施与验证结果

- 组件 TDD：增强后的菜单动作测试在旧实现下先失败，收到焦点的仍是临时菜单项；关闭内建回焦后组件用例通过。真实 E2E 随后暴露快速关闭不触发 `afterOpenChange(false)`，补齐生命周期分支后原焦点断言通过。
- 发布页组件回归：`PublicationsPage.test.tsx` 17/17 通过；仅有既有 jsdom CSS 解析输出和范围外 Ant Alert `message` 弃用提示。
- 静态门禁：typecheck、lint、生产构建、`git diff --check` 通过。
- 真实浏览器：`mvp-flow.spec.ts:794` 原 `toBeFocused()` 断言通过，测试继续执行到第 851 行；随后因独立 GEO 上传请求 `OPTIONS 400` 未显示文件名而失败，不归因于本次焦点改动。隔离数据库和临时对象存储均成功删除，进程已停止。

## 6. 预计提交边界

计划一个工作提交：

```text
fix: 修复发布菜单动作关闭回焦
```

预计只包含：

- `frontend/src/features/publications/PublicationDrawer.tsx`
- `frontend/src/features/publications/PublicationsPage.test.tsx`
- `.trellis/spec/frontend/hook-guidelines.md`
- `.trellis/tasks/08-02-publication-drawer-menu-action-close-focus-regression/`

`PublicationWorkspace.tsx` 与 `mvp-flow.spec.ts` 只作权威核对和验证，预计不修改。不包含 `frontend/test-results/`、`frontend/playwright-report/`、`.playwright-cli/`、`frontend/.playwright-cli/`、其他未识别文件、归档和会话日志；不自动推送。
