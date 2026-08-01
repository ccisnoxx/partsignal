# 24 表门禁目标收敛实施计划

## 0. 开始门禁

- [x] 用户批准当前 `prd.md`、`design.md`、`implement.md`。
- [x] 批准后运行 `python3 ./.trellis/scripts/task.py start 08-01-24-table-gate-target-convergence`；批准前不启动任务、不修改产品或测试代码。
- [x] 运行 `trellis-before-dev`，重新读取任务文档、研究记录及前端 `visual-system.md`、`component-guidelines.md`、`quality-guidelines.md`。
- [x] 确认主工作区仍为 `main`；保留并排除 `.playwright-cli/` 与 `frontend/.playwright-cli/` 诊断产物。

## 1. 实施顺序

- [x] 完整复核两个目标 E2E 文件和 24 个 `TableRegion` 来源，确认规划批准后可访问名称与条件渲染没有变化。
- [x] 在 `sitewideTableInventory` 为 24 项登记 `regionLabel`，仅为两张弹窗表登记 `dialogName`；保留 24 项数量与静态源码标记门禁。
- [x] 把表格边界辅助函数改为接收精确 region `Locator`，将省略文本、固定列和数据行查询限定在目标内，移除 24 表路径的全局选择与零表跳过。
- [x] 改造主循环：每个 surface 打开一次，对该 surface 的全部清单项逐个断言唯一、可见并执行原检查；失败信息带清单项和视口上下文。
- [x] 强化 `shared-data.setup.ts` 的完整图就绪判定，并按设计补齐条件表最小数据；只使用真实 API、本地假 AI 服务和隔离对象存储。
- [x] 让目标解析稳定选择 `VISUAL-` 完整图；人工观测弹窗选择对应产品，模型发现弹窗使用对应已配置渠道。
- [x] 做一次不提交的负向探针，确认不存在的 `regionLabel` 会让目标项失败且背景表不能替代；恢复文件后执行正式验证。
- [x] 运行必需验证、`trellis-check`、完整 diff 与范围复核；只修复由本任务引入且属于当前范围的失败。
- [x] 运行 `trellis-update-spec` 判断；已有规范覆盖时记录无需更新，不重复维护同一事实。

## 2. 必需验证

### 2.1 24 表定向隔离 E2E

在仓库根目录使用项目隔离脚本执行：

```bash
deploy/scripts/e2e-local.sh \
  tests/e2e/cross-page-visual-convergence.spec.ts \
  --project=e2e \
  --grep "全站 24 张业务表"
```

当前 shell 必须按项目既有方式提供 `DATABASE_URL` / `REDIS_URL`；不得改脚本、连接生产库或用共享业务库代替隔离数据库。必须记录：

- setup project 通过，24/24 项在 `1440×1000` 与 `375×900` 精确命中；
- 两张弹窗表由各自 dialog 内 region 满足；
- 原有文档溢出、region 边界、长文本、键盘、行高和固定列检查通过；
- 一次性数据库与临时对象存储输出 `status=deleted`。

### 2.2 静态质量门禁

在仓库根目录执行：

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint
```

### 2.3 清单与范围核对

```bash
git diff --check
rg -n "page\.locator\('\.table-region:visible'\)|inspectCurrentTableSurface" \
  frontend/tests/e2e/cross-page-visual-convergence.spec.ts
git status --short
```

- 定向搜索用于确认 24 表路径不再依赖页面全局替代或静默跳过；若同文件 200% zoom 代表用例仍保留独立全页扫描，必须在 diff 复核中说明其调用边界。
- 工作 diff 只包含两个 E2E 文件与本任务资料；不包含生产源码、后端、合同、迁移、依赖、快照或诊断产物。

## 3. 可选验证

必需验证通过后，只有在时间和环境允许时执行：

```bash
npm --prefix frontend run test
make e2e
```

- 完整前端测试用于排除共享 setup 或测试工具的跨文件回归。
- `make e2e` 用于确认扩充后的 setup 不影响其余 E2E；完整 E2E 也会在七项全部完成后的集中回归再次执行，因此不默认重复两次。
- 本任务不改生产 UI/CSS，不单独重复三主题、真实 200% zoom、全路由截图或对象存储恢复专项；集中回归统一覆盖。

## 4. 质量检查

- [x] 运行 `trellis-check`，按 PRD、设计、前端规范和完整 diff 检查。
- [x] 确认每项只存在一个权威 `regionLabel`，没有选择器候选数组、首项 fallback、条件跳过或超时轮询。
- [x] 确认共享数据只补 24 表呈现所需最小关联，不复制完整 `mvp-flow`、不覆盖已有业务对象、不增加第二套 fixture 框架。
- [x] 确认生产组件、可访问名称、业务请求、状态、权限和 API 合同均未改变。
- [x] 对实质修改的 TypeScript 测试/准备代码完成中文文件说明、非显然分支和开发者错误文本检查。

## 5. 风险与回滚点

1. 完整图创建顺序必须满足服务端状态机；任一步失败先对照 `mvp-flow.spec.ts` 的现有真实顺序，不增加宽松状态或固定成功响应。
2. GEO 洞察需要已发布文章、问题主题和观测同时存在；只补其中一项会让条件表缺失，应由 setup 最终就绪断言直接暴露。
3. region 边界 helper 改为目标相对查询后，不能误删 200% zoom 代表用例仍需要的全页扫描；若职责不同，保留两个明确调用入口而不是一个可选参数大全。
4. 若定向 E2E 暴露与本变更无关的环境失败，记录精确请求/进程与清理结果，不越界修改后端或部署脚本。

## 6. 预计提交边界

计划一个工作提交：

```text
test: 收敛 24 表门禁目标
```

工作提交预计只包含：

- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`
- `frontend/tests/e2e/shared-data.setup.ts`
- `.trellis/tasks/08-01-24-table-gate-target-convergence/task.json`
- `.trellis/tasks/08-01-24-table-gate-target-convergence/prd.md`
- `.trellis/tasks/08-01-24-table-gate-target-convergence/design.md`
- `.trellis/tasks/08-01-24-table-gate-target-convergence/implement.md`
- `.trellis/tasks/08-01-24-table-gate-target-convergence/research/current-state.md`

提交前必须展示精确文件清单并等待用户确认；不包含任务归档、会话日志或 Playwright 诊断产物，不自动推送。提交完成后再单独进入 Trellis 归档与会话日志收尾。

## 7. 实施与验证记录

- 必需静态门禁：`git diff --check`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run lint` 均通过。
- 必需隔离 E2E：指定本地 `DATABASE_URL` / `REDIS_URL` 运行 `deploy/scripts/e2e-local.sh tests/e2e/cross-page-visual-convergence.spec.ts --project=e2e --grep "全站 24 张业务表"`，setup 与主用例 2/2 通过；24 项在 `1440×1000` 和 `375×900` 都完成精确 region 与原边界检查，两张弹窗表限定在各自 dialog。
- 隔离清理：最终运行输出一次性数据库与临时对象存储 `status=deleted`，临时停止的开发前端容器已恢复。
- 负向探针：临时将“内容任务列表”改为不存在的 `regionLabel`，用例在 `内容任务列表 / tasks / 不存在的内容任务列表 @ 1440px` 以 0 命中按预期失败；临时改动已恢复，恢复后正式门禁通过。
- 失败归因：首次隔离运行与已启动的开发前端端口冲突，通过运行期停止并退出恢复容器解决，未改部署脚本；后续真实失败暴露最佳内容排行至少需 3 条独立观测，已按后端权威实现补齐数据。
- `trellis-check` 已完成；检查中将洞察就绪查询收紧到当前图的 `publication_record_id`，避免其他产品的全局数据误证当前图。
- `trellis-update-spec` 判断为无需更新：现有前端规范已覆盖 `TableRegion`、真实 API E2E、长文本压力与局部滚动；24 项库存身份由本测试与归档任务权威承载。
- 可选的完整前端测试与 `make e2e` 未重复执行：本任务只改两个目标 E2E 文件，已用完整隔离栈直接覆盖改动路径；全量 E2E 留待七项全部完成后的集中回归。
