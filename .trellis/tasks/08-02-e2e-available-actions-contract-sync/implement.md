# E2E `available_actions` 合同同步实施计划

## 1. 开始门禁

- [x] 用户评审并批准本任务最新 `prd.md`、`design.md`、`implement.md`。
- [x] 批准后运行 `python3 ./.trellis/scripts/task.py start 08-02-e2e-available-actions-contract-sync`；批准前不修改测试或产品代码。
- [x] 实施前加载 `trellis-before-dev` 前端上下文，完整读取三个目标 E2E 文件、`playwright.config.ts`、质量规范和动作投影稳定合同。
- [x] 确认主工作区仍在 `main`；只保留已知 Playwright 诊断产物，不拉取远端、不创建分支。

## 2. 实施顺序

- [x] 在 `compatibility.spec.ts` 为认证用户补 `available_actions: []`，为产品列表项补 `available_actions: ['UPDATE']`。
- [x] 在 `trusted-types.spec.ts` 为两处认证用户补 `[]`，为产品补 `['UPDATE']`，为非空事实工作区补 `['SAVE', 'CREATE_VERSION']`。
- [x] 在 `mvp-flow.spec.ts` 把“Prompt 未配置”分支的自然化按钮期待改为禁用；保留直接 POST 的 `409/HUMANIZATION_PROMPT_MISSING` 断言。
- [x] 用本次自然化预览 POST 返回的作业 ID 等待 `SUCCEEDED`，再验证按钮恢复、源内容不变及当前动作包含 `CREATE_HUMANIZATION_JOB`。
- [x] 发布候选路由把匹配账号改为空时同步清空 `REGISTER`，保留设置链接与按钮禁用验证。
- [x] 保留 Prompt 保存后的按钮启用、自然化作业创建、快照和内容追溯断言，不改变测试数据准备或清理流程。
- [x] 搜索确认三个目标 mock 没有遗漏的 required `available_actions`，且差异中没有产品 fallback、`as any`、默认动作或新 fixture 抽象。

## 3. 必需验证

### 3.1 E2E 环境变量

沿用 `.env` 的开发凭据，只把 Compose 内部主机名改为现有宿主机映射；命令不得输出变量值：

```bash
set -a
. ./.env
set +a
export DATABASE_URL="$(printf '%s' "$DATABASE_URL" | sed 's/@postgres:5432/@127.0.0.1:55432/')"
export REDIS_URL="$(printf '%s' "$REDIS_URL" | sed 's#redis://redis:6379#redis://127.0.0.1:56379#')"
```

### 3.2 三个目标文件的隔离 E2E

```bash
deploy/scripts/e2e-local.sh \
  tests/e2e/compatibility.spec.ts \
  tests/e2e/trusted-types.spec.ts \
  tests/e2e/mvp-flow.spec.ts
```

必须确认：

- compatibility 与 Trusted Types 在配置匹配的 Chromium、Firefox、WebKit 项目通过；
- MVP 未配置 Prompt 时按钮禁用且直接命令返回既有领域错误，配置后完整自然化链通过；
- 脚本退出时隔离数据库和临时对象存储清理成功，没有遗留服务进程。

### 3.3 合同与前端静态门禁

```bash
make contract-check
npm --prefix frontend run typecheck
npm --prefix frontend run lint
git diff --check
```

## 4. 可选验证与明确延后

- `make e2e` 延后到独立的 `dashboard-visual-baseline-sync` 任务完成后统一运行；当前已知 Dashboard 基线未变化，立即重跑只会重复同一项已归因失败。
- `npm --prefix frontend run test` 与 `make build` 不作为本测试资产任务的提交阻断；没有组件、生产代码、构建配置或依赖变化。
- 若目标 E2E 暴露与本次字段/期待无关的环境或既有失败，按失败归因规则记录，不擅自扩展修复范围。

## 5. `trellis-check` 与规范判断

- [x] 在任务断言跑通且范围外失败完成归因后运行 `trellis-check`，对照 PRD、设计、稳定合同和完整 diff 检查。
- [x] 确认每个 mock 的动作数组有权威依据，未猜测 `DELETE` 等依赖数据库事实的动作。
- [x] 确认自然化用例同时保留投影层和命令守卫层证据，Prompt 配置后的成功链没有削弱。
- [x] 确认没有修改 OpenAPI、生成类型、后端、前端产品实现、Dashboard 基线、Alert 属性或 E2E 基础设施。
- [x] 运行 `trellis-update-spec` 判断；稳定合同已明确 required 字段、动态投影、前端 fixture 对照和禁止 fallback，无需重复修改规范。
- [ ] 展示精确提交文件清单、验证结果和提交说明，等待用户确认后提交。

## 6. 预计提交边界

计划一个工作提交：

```text
test: 同步 E2E 可用动作合同
```

预计只包含：

- `frontend/tests/e2e/compatibility.spec.ts`
- `frontend/tests/e2e/trusted-types.spec.ts`
- `frontend/tests/e2e/mvp-flow.spec.ts`
- `.trellis/tasks/08-02-e2e-available-actions-contract-sync/`

不包含 `.playwright-cli/`、`frontend/.playwright-cli/`、Dashboard 视觉基线、其他未识别文件、归档和会话日志；不自动推送。提交成功后才进入 `task.py archive` 与会话日志收尾，执行前说明可能产生 Trellis bookkeeping 提交。

## 7. 实施与验证结果（2026-08-02）

- `make contract-check`：通过；后端运行时操作、OpenAPI 与生成类型一致。
- `npm --prefix frontend run typecheck`、`npm --prefix frontend run lint`、`git diff --check`：通过。
- compatibility 与 Trusted Types：Chromium、Firefox、WebKit 及 Firefox 无 backdrop 目标均通过；required `available_actions` mock 不再触发运行时错误。
- MVP 当前任务段：未配置 Prompt 时按钮禁用且直接命令返回 `409/HUMANIZATION_PROMPT_MISSING`；自然化预览按新作业 ID 等待成功；配置后动作恢复、第二次自然化作业、快照、源内容不变与发布候选空动作均通过。
- 首次 E2E 使用默认 `5173` 时命中 Colima 长期端口转发；改用 `PARTSIGNAL_E2E_BASE_URL=http://127.0.0.1:5174` 后进入隔离前端。共享 Redis DB 0 还存在长期 worker 竞争，后续验证使用空闲逻辑库 15 隔离 Celery 队列；未修改部署脚本或共享服务。
- 目标 E2E 尚未整体通过：MVP 在本任务断言全部通过后，于 `mvp-flow.spec.ts:794` 的既有发布 Drawer 关闭焦点断言失败。该路径属于已归档的 `08-01-publication-drawer-direct-close-focus-restoration`，与本任务 diff 无调用链关系；当前任务不修改产品焦点实现或削弱断言，AC5 保持未完成。
- 每次隔离运行均报告临时数据库和对象存储删除成功，后台服务由脚本关闭；现有 Playwright 诊断产物保持未跟踪。
- 完整 `make e2e` 仍按规划延后到 Dashboard 基线任务；当前范围外焦点失败也必须先独立处理或确认门禁处置后再运行。
