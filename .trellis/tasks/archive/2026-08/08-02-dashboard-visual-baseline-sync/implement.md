# Dashboard 视觉基线同步实施计划

## 1. 启动前门禁

- [x] 用户已于 `2026-08-02 10:39:35 CST` 明确回复“批准”，确认当前 `1440×1000` 浅色 Dashboard 候选图。
- [x] 用户已批准本版 `prd.md`、`design.md`、`implement.md`，并已运行：

```bash
python3 ./.trellis/scripts/task.py start 08-02-dashboard-visual-baseline-sync
```

- [x] 启动后已加载 `trellis-before-dev` 前端上下文，完整读取当前任务三份文档、前端规范和目标视觉用例。
- [x] 已确认主工作目录位于 `main`；除已知 `.playwright-cli/` 诊断产物和当前任务目录外没有未识别改动。

## 2. 固化人工批准证据

- [x] 已将用户批准的原始 `1440×1000` 浅色截图保存为 `assets/approved/dashboard-1440x1000-light.png`，未重绘、压缩。
- [x] 已新建 `assets/approved/manifest.md`，登记对应原型、最终文件名、SHA-256、尺寸、主题、批准者、北京时间和批准原话。
- [x] 已用 `file` 与 `shasum -a 256` 复核 manifest，身份和业务数值未写成固定合同。

## 3. 生成并替换唯一自动基线

先用项目隔离栈运行目标用例，不自动接受快照：

```bash
deploy/scripts/e2e-local.sh \
  tests/e2e/cross-page-visual-convergence.spec.ts \
  --project=e2e \
  --grep "九张代表页基线与 Dashboard、内容审核桌面锚点可重复"
```

- [x] 首次运行 setup 通过，主用例唯一失败为 `dashboard-light-1440x1000.png`，差异为 `118054` 像素、比例 `0.09`，与集中回归记录一致。
- [x] 已使用 `rg --files frontend/test-results` 精确定位唯一 Dashboard actual PNG，尺寸为 `1440×1000`，SHA-256 为 `c007102426a341daf9f27e99c76729e5b8b5f9e3644942188aa6825bf58b448d`。
- [x] 已对照人工批准原图检查稳定构图；自动图中的动态身份和数值仅由既有 `visualMasks` 遮罩。
- [x] 已只用该实际图替换 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/dashboard-light-1440x1000.png`。
- [x] 已确认 `cross-page-visual-convergence.spec.ts`、其余基线、Playwright 配置、产品代码和依赖均无差异。

## 4. 必需验证

### 4.1 目标视觉回归

基线替换后重跑相同命令，要求 setup 与目标用例零失败：

```bash
deploy/scripts/e2e-local.sh \
  tests/e2e/cross-page-visual-convergence.spec.ts \
  --project=e2e \
  --grep "九张代表页基线与 Dashboard、内容审核桌面锚点可重复"
```

必须记录：通过/失败数量、实际耗时、Dashboard 截图比较结果、隔离数据库和临时对象存储清理结果。

执行结果：独立内容审核基线任务提交 `6696959` 完成后重跑，setup 与主用例均通过，结果为 `2 passed (12.0s)`，主用例耗时 `9.3s`；Dashboard 与内容审核两处截图断言均通过。隔离数据库 `partsignal_e2e_20260802_23506` 与临时对象存储均已删除，Compose frontend 已恢复。

### 4.2 完整浏览器门禁

```bash
make e2e
```

必须记录完整通过/失败/跳过数量和耗时，并确认先前的 `available_actions`、自然化、发布 Drawer 回焦、24 表及 Dashboard 基线均不再失败。若出现新的独立失败，按归因规则停止扩展并报告。

执行结果：`52 passed (5.1m)`，失败 0、跳过 0。先前的 `available_actions`、自然化、发布 Drawer 回焦、24 表及 Dashboard/内容审核视觉基线均未再失败；隔离数据库 `partsignal_e2e_20260802_23750` 与临时对象存储均已删除，Compose frontend 已恢复。

### 4.3 差异与资产门禁

```bash
file \
  .trellis/tasks/08-02-dashboard-visual-baseline-sync/assets/approved/dashboard-1440x1000-light.png \
  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/dashboard-light-1440x1000.png
shasum -a 256 \
  .trellis/tasks/08-02-dashboard-visual-baseline-sync/assets/approved/dashboard-1440x1000-light.png \
  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/dashboard-light-1440x1000.png
git diff --check
git diff --name-status
```

- [x] 两张目标图片均为 `1440×1000` PNG；manifest 与批准图 SHA-256 一致。
- [x] 自动基线差异仅有一张 Dashboard PNG；其余十张基线字节不变。
- [x] `.playwright-cli/`、`frontend/.playwright-cli/`、`frontend/test-results/` 和 `frontend/playwright-report/` 不进入提交范围。

## 5. 可选验证

以下检查不作为本任务提交阻断，因为任务不修改 TypeScript、CSS、合同、构建配置或产品运行时：

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
```

若必需 E2E 暴露编译或生产资产问题，再运行对应最小检查；不得无证据扩大修改范围。

## 6. 质量、提交与收尾

- [x] 已重跑 `trellis-check`：任务文档、批准资产 SHA、11 张基线计数、单张 Dashboard 基线差异、产品/测试源码零差异与 `git diff --check` 均通过；目标视觉用例为 `2 passed (12.0s)`，完整 `make e2e` 为 `52 passed (5.1m)`，两轮隔离资源均成功清理。
- [x] 已运行 `trellis-update-spec` 判断；无需修改规范，因为人工批准、11 张自动基线、遮罩/阈值、真实栈和失败归因规则均已由 `visual-system.md`、`quality-guidelines.md` 与项目工作流覆盖，本次没有新增实现合同。
- [x] 提交前已展示精确文件清单并取得用户确认，不自动推送。
- [x] 用户确认以下工作提交信息：

```text
test: 同步 Dashboard 视觉基线
```

- [x] 用户确认提交范围仅包含：
  - `.trellis/tasks/08-02-dashboard-visual-baseline-sync/`
  - `frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/dashboard-light-1440x1000.png`
- [ ] 提交后按用户指示运行 `task.py archive` 和会话日志收尾；执行前说明可能产生独立 Trellis bookkeeping 提交。
