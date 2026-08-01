# 发布抽屉直接关闭焦点恢复实施计划

## 1. 前置流程

- [x] 用户批准本规划后运行 `python3 ./.trellis/scripts/task.py start 08-01-publication-drawer-direct-close-focus-restoration`。
- [x] 开始写代码前使用 `trellis-before-dev` 重新加载前端规范，并复核主工作目录仍在 `main`、除已知诊断产物和当前任务外无未识别改动。
- [x] 不创建分支，不拉取远端，不修改或纳入 `.playwright-cli/` 与 `frontend/.playwright-cli/`。

## 2. 实施顺序

- [x] 在 `PublicationWorkspace` 移除外层 `PublicationDrawer` 的动态 key，使关闭回调所有者保持同一实例。
- [x] 在 `PublicationDrawer` 把候选/发布记录/初始动作身份限制到内容边界；内容身份变化时清除外层 dirty，保留既有局部状态隔离。
- [x] 新增候选无 dirty 直接关闭回归，关闭前显式聚焦 Drawer 关闭按钮。
- [x] 强化发布记录直接关闭测试，使断言证明焦点确实从 Drawer 内返回原触发器。
- [x] 保留并复跑 dirty→继续编辑 / 放弃并关闭用例；不改共享 Hook 或业务请求。
- [x] 在 `.trellis/spec/frontend/hook-guidelines.md` 增加一条稳定规则：`afterOpenChange(false)` 所有者必须存活到关闭完成，动态 key 只能放在需要重置的内容边界。
- [x] 搜索复核 `PublicationDrawer` 只有该工作台一个调用方，且没有第二份 Drawer 打开状态、延时、DOM 查询或 fallback。

## 3. 必需验证

### 3.1 针对性组件回归

在 `frontend/` 工作目录执行：

```bash
npx vitest run src/features/publications/PublicationsPage.test.tsx
```

必须确认新增直接关闭用例、既有 dirty 关闭用例和发布记录关闭用例均通过。

### 3.2 前端静态门禁

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint
```

### 3.3 真实浏览器定向验证

使用 `playwright-cli` 命名内存会话，不保存认证状态；按开发环境既有认证方式登录后执行：

```bash
playwright-cli -s=publication-drawer-focus open http://localhost:5173/publications
playwright-cli -s=publication-drawer-focus snapshot
```

用快照中的稳定 role/ref 完成两条链：

1. “准备人工发布”→候选 Drawer→聚焦并点击“关闭”；
2. “发布记录”Tab→主入口或“更多操作”→Drawer→按 `Escape`。

每条链在 Drawer 隐藏后执行：

```bash
playwright-cli -s=publication-drawer-focus eval "document.activeElement?.outerHTML"
playwright-cli -s=publication-drawer-focus eval "location.search"
playwright-cli -s=publication-drawer-focus console warning
playwright-cli -s=publication-drawer-focus close
```

验收：`activeElement` 是本次打开 Drawer 的同一触发器，查询参数已清除，没有本次改动引入的 console error/warning。若共享开发数据缺少候选或发布记录，使用已有项目数据准备流程补齐；不得伪造产品成功或修改共享业务记录来绕过验收。

## 4. 可选验证

必需验证通过后，仅在耗时和环境允许且失败归因规则允许时执行：

```bash
npm --prefix frontend run test
npm --prefix frontend run build
```

`make e2e` 不作为本独立任务提交阻断：集中回归已经确认它仍受范围外的旧 `available_actions` fixture、自然化期待和 Dashboard 视觉基线阻断。在这些资产没有发生相关变化前不重复运行同一已知失败；待对应独立任务完成后统一重跑完整 E2E。

## 5. 质量检查与提交流程

- [x] 必需验证通过后运行 `trellis-check`，按本任务 PRD、设计、前端规范和完整 diff 检查。
- [x] 检查外层 Drawer 在 `open=false` 至 `afterOpenChange(false)` 期间保持同一 React 实例。
- [x] 检查内容 key 只负责局部状态隔离，URL 仍是唯一打开状态来源。
- [x] 检查没有同步聚焦、延时、轮询、DOM 猜测、fallback、新依赖或无关重构。
- [x] 检查新增/实质修改的 TypeScript 注释、开发者可见文本和前端规范均使用中文；新增的 dirty 身份边界注释与规范文本均为中文。
- [x] 展示精确提交文件清单和提交说明，等待用户确认后再提交。
- [ ] 提交成功后才进入 `task.py archive` 和会话日志收尾；归档/日志可能产生独立 Trellis bookkeeping 提交，执行前先说明。

## 6. 预计提交边界

计划一个工作提交：

```text
fix: 修复发布抽屉直接关闭焦点恢复
```

工作提交预计只包含：

- `frontend/src/features/publications/PublicationWorkspace.tsx`
- `frontend/src/features/publications/PublicationDrawer.tsx`
- `frontend/src/features/publications/PublicationsPage.test.tsx`
- `.trellis/spec/frontend/hook-guidelines.md`
- `.trellis/tasks/08-01-publication-drawer-direct-close-focus-restoration/`

不包含 `.playwright-cli/`、`frontend/.playwright-cli/`、其他未识别文件、归档和会话日志；不自动推送。

## 7. 实施与验证结果（2026-08-02）

- `npx vitest run src/features/publications/PublicationsPage.test.tsx --reporter=dot`：通过，1 个测试文件、17 个用例全部通过；仅出现范围外既有的 Ant Design `Alert.message` 弃用提示和 jsdom CSS 解析提示。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `playwright-cli` 命名会话：候选关闭按钮链与发布记录 Escape 链均在 Drawer 完全关闭后恢复同一触发器，选择查询参数已清除，无 console warning/error；未保存认证状态。
- `trellis-check`：通过；确认单一调用方、URL 单一状态源、内容身份隔离、无 debug、延时、轮询、DOM 猜测、fallback、新依赖或无关重构。
- 可选全前端测试与 build 未运行：本任务为局部前端生命周期修复，完整受影响测试文件与静态门禁已覆盖提交风险；集中回归中的已知范围外阻断未发生相关变化。
