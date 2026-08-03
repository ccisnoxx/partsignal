# 视觉基线与测试合同一致性恢复：实施计划

> 当前状态：第 0～7 节实施与报告已完成，AC1～AC7 全部通过；用户已确认精确提交计划，按批准范围提交且不自动 push。

## 0. 启动与规范门禁

- [x] 用户明确批准 `prd.md`、`design.md` 与本实施计划。
- [x] 运行 `python3 ./.trellis/scripts/task.py start 08-03-visual-baseline-test-contract-consistency-restoration`。
- [x] 按 Trellis 上下文读取工作流、开发者身份、任务文档及 `.trellis/spec/frontend/visual-system.md`；不修改规范已有的 `0.02` 合同。

## 1. 冻结执行边界

- [x] 记录当前 `main` 的完整 HEAD、`git status --short --branch`、与 `origin/main` 的关系及现有未跟踪文件。
- [x] 记录 PostgreSQL、Redis、Frontend 与本地 E2E 所需端口状态；不得把启动服务视为通过证据。
- [x] 确认 `56ae5ac5b660438c2f8a6adfef6c82005e6136b2` 的父提交是 `20108f2326f010bebff683cb29c75078d67cfb25`，并确认后者持有设计清单中的 11 个路径。
- [x] 逐项计算父提交 blob 的 SHA-256；任一项与 `design.md` 不一致即停止。

## 2. 精确恢复 11 张基线

- [x] 使用 Git 原生恢复能力，从完整源提交精确恢复设计清单中的 11 个路径；命令必须显式限定这些文件，不恢复目录外内容，不使用 `--update-snapshots`。
- [x] 确认目标目录恰有 11 张任务内基线，桌面文件为 1440×1000、移动文件为 375×900。
- [x] 对工作区文件运行 `shasum -a 256`，确认与 `design.md` 完全一致。
- [x] 确认 `.playwright-cli/`、`frontend/.playwright-cli/` 和其他快照未被恢复或改动。

## 3. 恢复统一阈值合同

- [x] 在 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts` 中把移动代表页截图改为固定 `maxDiffPixelRatio: 0.02`。
- [x] 删除只为 Prompt/GEO `0.035` 例外服务的注释和条件表达式，不改截图名称、主题、视口、遮罩、动画、光标或测试名称。
- [x] 运行 `rg -n "0\\.035|maxDiffPixelRatio" frontend/tests/e2e/cross-page-visual-convergence.spec.ts`，确认不存在放宽值或按页面阈值分支。
- [x] 运行 `npm --prefix frontend run lint` 与 `npm --prefix frontend run typecheck`。

## 4. 目标视觉用例

- [x] 不传 `--update-snapshots`，在真实隔离栈中运行：

```sh
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
REDIS_URL=redis://127.0.0.1:56379/0 \
deploy/scripts/e2e-local.sh \
  tests/e2e/cross-page-visual-convergence.spec.ts \
  --project=e2e \
  --grep '九张代表页基线与 Dashboard、内容审核桌面锚点可重复'
```

- [x] 记录通过、失败、跳过数量、耗时，以及 `E2E_CLEANUP` 的数据库和对象存储结果。
- [x] 目标视觉用例零失败，可以进入第 5 节。
- [x] 截图差异停止门禁已核对：本节没有截图差异，未生成或接受 actual/diff，未更新快照、扩大阈值/遮罩或修改产品。

## 5. 完整 E2E

- [x] 运行：

```sh
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
REDIS_URL=redis://127.0.0.1:56379/0 \
make e2e
```

- [x] 记录完整测试计数、耗时与首个失败；完整 E2E 为 `52 passed / 0 failed / 0 skipped`，满足 AC5。
- [x] 确认隔离数据库和临时对象存储均输出 `status=deleted` 且实际不存在，Frontend 已恢复到执行前状态。
- [x] 独立失败边界已核对：本次没有独立失败，未修改范围外代码。

## 6. 清理与质量复核

- [x] 精确清理本轮 `test-results`、`playwright-report` 和工具诊断产物；保留任务文档、批准资产与必要结果证据。
- [x] 运行 `git diff --check`，并复核 `git status --short`、`git diff --stat`、测试源码差异和 11 个 PNG 路径。
- [x] 确认产品代码、CSS、主题、API、合同、数据库、迁移、权限、业务行为、Playwright 配置和其他快照均无差异。
- [x] 使用 `trellis-check` 完成任务级质量复核。现有 `visual-system.md` 已准确表达合同，本任务未引入新的视觉规则，因此不重复修改规范。

## 7. 报告与提交边界

- [x] 在当前任务中记录源提交、11 个 SHA、目标视觉 E2E、完整 E2E、lint、typecheck、清理结果及残余风险。
- [x] 提交前向用户展示精确提交计划并取得确认；用户已确认按所列范围提交，不自动 push。
- [x] 允许提交：当前任务目录、`cross-page-visual-convergence.spec.ts` 的单一阈值修正、清单中的 11 张已批准基线。
- [x] 明确排除：`.playwright-cli/`、`frontend/.playwright-cli/`、测试报告目录、未批准候选、产品代码和所有无关文件。
- [x] 本任务完成后，另行在新冻结提交上重跑“上线前最终发布候选验收”；不在本任务内代替该发布结论。
