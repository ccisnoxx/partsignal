# 内容审核视觉基线同步实施计划

## 1. 启动前门禁

- [x] 用户已明确批准规划阶段展示的 `1440×1000` 浅色内容审核只读预览候选图。
- [x] 用户已在最终规划摘要之后明确批准本版 `prd.md`、`design.md`、`implement.md`。
- [x] 已获得上述批准并运行：

```bash
python3 ./.trellis/scripts/task.py start 08-02-content-review-visual-baseline-sync
```

- [x] 启动后已加载 `trellis-before-dev` 前端上下文，完整读取当前任务三份文档、前端规范和目标视觉用例。
- [x] 已确认主工作目录位于 `main`；Dashboard 基线、Dashboard 任务目录和既有 Playwright 诊断产物均作为已识别的范围外工作差异保留。

## 2. 固化人工批准证据

- [x] 已将获批原图保存为 `assets/approved/content-review-1440x1000-light.png`，未重绘、压缩。
- [x] 已新建 `assets/approved/manifest.md`，登记对应原型、最终文件名、SHA-256、尺寸、主题、批准者、北京时间和批准原话。
- [x] 已用 `file` 与 `shasum -a 256` 复核 manifest；动态业务数据和队列行数未写成固定合同。

## 3. 确认并替换唯一旧基线

在不自动接受快照的前提下运行：

```bash
deploy/scripts/e2e-local.sh \
  tests/e2e/cross-page-visual-convergence.spec.ts \
  --project=e2e \
  --grep "九张代表页基线与 Dashboard、内容审核桌面锚点可重复"
```

- [x] 预变更运行 setup 通过，Dashboard 断言通过，主用例唯一失败为 `content-review-light-1440x1000.png`；差异为 `47331` 像素、比例 `0.04`，与规划证据一致。
- [x] 已用 `rg --files frontend/test-results` 定位唯一 content-review actual PNG，尺寸为 `1440×1000`，SHA-256 为 `d476bf23fdaec3b66ad5a747a957b9905722bf2b527da89fa667290eeeb2b68e`。
- [x] 已对照获批原图核对只读预览态的稳定构图；自动图中的动态身份和内容仅由既有选择器遮罩。
- [x] 已只用该 actual PNG 替换 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/content-review-light-1440x1000.png`。
- [x] 已确认测试源码、产品代码、配置、依赖、Dashboard 基线和其余九张基线均无新增差异；Dashboard SHA-256 仍为 `c007102426a341daf9f27e99c76729e5b8b5f9e3644942188aa6825bf58b448d`。

## 4. 必需验证

### 4.1 目标视觉回归

基线替换后重跑同一命令，要求 setup 与目标用例通过；记录通过/失败数量、耗时、两张桌面锚点结果、隔离数据库/临时对象存储清理和 Compose frontend 恢复结果。

执行结果：setup 和主用例共 `2 passed (12.1s)`，主用例耗时 `9.5s`；Dashboard 与 content-review 两个桌面锚点均通过。隔离数据库 `partsignal_e2e_20260802_22027` 和临时对象存储均已删除，Compose frontend 已恢复并监听 `127.0.0.1:5173`。

### 4.2 资产与范围门禁

```bash
file \
  .trellis/tasks/08-02-content-review-visual-baseline-sync/assets/approved/content-review-1440x1000-light.png \
  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/content-review-light-1440x1000.png
shasum -a 256 \
  .trellis/tasks/08-02-content-review-visual-baseline-sync/assets/approved/content-review-1440x1000-light.png \
  frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/content-review-light-1440x1000.png
git diff --check
git status --short
```

- [x] 两张目标图片均为 `1440×1000` PNG，manifest 与批准图 SHA-256 一致。
- [x] 相对本任务启动时新增的自动基线差异只有 content-review；Dashboard 既有工作差异保持字节不变。
- [x] `.playwright-cli/`、`frontend/.playwright-cli/`、`frontend/test-results/` 和 `frontend/playwright-report/` 不进入提交范围。

## 5. 可选验证

本任务不修改 TypeScript、CSS、合同、构建配置或运行时，以下检查不作为提交阻断：

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
```

只有目标 E2E 暴露与编译或生产资产直接相关的新证据时，才运行对应最小检查。

实际情况：隔离 E2E 两次均执行了 `npm --prefix frontend run build`，其中包含 `tsc -b`、Vite build 和生产资产检查，均通过。未单独运行 lint，因为本任务没有 TypeScript、CSS 或配置差异。

## 6. 质量、提交与任务切换

- [x] 已运行 `trellis-check`：任务文档、批准 SHA、精确基线 SHA、11 张基线清单、产品/测试源码零差异、build/typecheck、目标 E2E、清理与 frontend 恢复均通过。
- [x] 已运行 `trellis-update-spec` 判断；无需修改规范，因为批准、11 张基线、真实栈和 `available_actions` 投影规则已由现有规范完整覆盖，本次没有新增实现合同。
- [x] 已在提交前展示精确文件清单并取得用户确认，不自动推送。
- [ ] 预计一个工作提交：

```text
test: 同步内容审核视觉基线
```

- [x] 提交范围仅包含：
  - `.trellis/tasks/08-02-content-review-visual-baseline-sync/`
  - `frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/content-review-light-1440x1000.png`
- [x] 已明确排除 Dashboard 任务目录、Dashboard 基线及全部 Playwright 诊断产物。
- [ ] 本任务提交并完成 Trellis 收尾后，重新启动 `08-02-dashboard-visual-baseline-sync`，再运行目标视觉用例与完整 `make e2e`。
