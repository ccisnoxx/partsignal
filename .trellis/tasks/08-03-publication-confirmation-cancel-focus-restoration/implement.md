# 发布确认取消回焦修复：实施计划

## 0. 规划与启动门禁

- [x] 用户评审并批准 `prd.md`、`design.md` 与本实施计划。
- [x] 批准后运行：

```bash
python3 ./.trellis/scripts/task.py start 08-03-publication-confirmation-cancel-focus-restoration
```

- [x] 启动后运行 `trellis-before-dev`，完整读取任务文档、前端组件/Hook/质量规范和将修改的源码。
- [x] `08-03-pre-release-final-candidate-acceptance-rerun` 保持规划状态，直到本修复提交并归档。

## 1. 冻结与失败基线

- [x] 记录 `main` HEAD、`origin/main`、工作区与当前服务状态；确认除两个规划任务目录外没有未识别差异。
- [x] 静态确认外部菜单动作通过 `initialAction` 进入，Drawer 内动作通过命令按钮进入；外层 `drawerFocus` 与直接关闭链保持现状。
- [x] 先补充或强化针对性组件回归并运行，证明旧实现的取消后焦点断言失败；不得用延时、轮询或弱化断言制造复现。

## 2. 最小实现

- [x] 在 `PublicationDrawer` 内把现有关闭回调传给 `PublicationRegistration`；不修改外层 Drawer 生命周期。
- [x] 在 `PublicationRegistration` 复用 `useFocusReturn()` 登记 Drawer 内命令按钮。
- [x] 收敛单一取消处理：共同清理附件、dirty 和 mutation；外部 `initialAction` 关闭 Drawer，内部动作隐藏动作区并恢复对应命令按钮。
- [x] 确认取消不发送发布命令请求，不改变成功提交、删除和 URL 权威边界。
- [x] 更新 `hook-guidelines.md` 的条件区域焦点规则，不重复现有 Drawer 关闭说明。

## 3. 针对性组件验证

- [x] 在 `frontend/` 目录运行：

```bash
npm exec -- vitest run src/features/publications/PublicationsPage.test.tsx
```

- [x] 记录通过、失败、跳过数量和耗时；外部菜单取消与 Drawer 内取消两条回归必须通过。
- [x] 运行：

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

## 4. 真实隔离浏览器回归

- [x] 执行前停止开发 Compose 的 `worker`、`scheduler` 并确认 Redis `celery` 队列为空，避免其消费隔离任务；记录执行前服务和资源清单。
- [x] 不修改 E2E 数据准备，在真实隔离栈运行现有 MVP 用例：

```bash
PLAYWRIGHT_HTML_OPEN=never \
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
REDIS_URL=redis://127.0.0.1:56379/0 \
deploy/scripts/e2e-local.sh \
  tests/e2e/mvp-flow.spec.ts \
  --project=e2e \
  --grep '批准事实到人工发布和 GEO 观测保持完整追溯'
```

- [x] 记录通过、失败、跳过数量、耗时与首个失败；取消和直接关闭两条焦点链均须通过。
- [x] 确认本轮数据库与临时对象存储输出 `status=deleted` 且实际不存在；恢复开发 `worker`、`scheduler` 并验证健康。

## 5. 质量与差异复核

- [x] 运行 `git diff --check`、`git status --short`、`git diff --stat`，逐项核对修改边界。
- [x] 使用 `trellis-check` 复核焦点所有权、URL、无请求、测试强度、规范同步及无第二套 ref/fallback。
- [x] 确认没有后端、合同、CSS、依赖、视觉资产、Playwright 配置或无关差异；精确清理测试报告和本轮工具诊断产物。

## 6. 报告、提交与后续

- [x] 在任务 `report.md` 记录根因、变更、组件/E2E 结果、资源清理和残余风险。
- [ ] 提交前向用户展示精确范围和提交信息并取得确认；不自动 push。
- [ ] 提交并归档后恢复 `08-03-pre-release-final-candidate-acceptance-rerun`，更新其冻结候选与最终规划；本任务不提前运行七项发布门禁。

## 7. 可选验证

- 完整 `npm --prefix frontend run test` 与完整 `make e2e` 留给紧随其后的发布候选复验；本任务以针对性组件测试、lint、typecheck 和 MVP 真实浏览器回归作为必需证据。
