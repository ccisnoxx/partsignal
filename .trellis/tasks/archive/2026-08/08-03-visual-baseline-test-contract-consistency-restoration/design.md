# 视觉基线与测试合同一致性恢复：执行设计

## 1. 设计结论

采用最小恢复方案：用 Git 原生能力从 `20108f2326f010bebff683cb29c75078d67cfb25` 精确恢复 11 张既有自动基线，并把视觉测试中 Prompt、GEO 移动截图的条件阈值改回固定 `0.02`。不修改产品代码、视觉实现、测试框架、Playwright 配置或 E2E 数据准备。

本任务不创建新的基线生成器、兼容层或第二份视觉合同。`.trellis/spec/frontend/visual-system.md` 继续作为唯一规则来源，Git 对象与归档批准记录提供资产来源证据。

## 2. 权威来源

| 对象 | 权威来源 | 用途 |
| --- | --- | --- |
| 视觉规则 | `.trellis/spec/frontend/visual-system.md` §8.1 | 固定 11 张基线、`0.02` 阈值及禁止规避方式 |
| 自动基线二进制 | Git 提交 `20108f2326f010bebff683cb29c75078d67cfb25` | 唯一初始恢复源 |
| 人工批准链 | `07-25-frontend-visual-system-recalibration`、Dashboard 与内容审核归档任务的 `assets/approved/manifest.md` | 证明对应页面或锚点已经人工批准 |
| 截图断言 | `frontend/tests/e2e/cross-page-visual-convergence.spec.ts` | 唯一需要修改的测试源码 |
| 隔离执行与清理 | `deploy/scripts/e2e-local.sh` | 创建临时数据库和对象存储、启动真实 API 栈并清理 |

## 3. 精确资产清单

以下 SHA-256 是父提交中的原始 blob 内容哈希；实现时必须逐项复核：

| 文件名 | SHA-256 |
| --- | --- |
| `content-review-light-1440x1000.png` | `d476bf23fdaec3b66ad5a747a957b9905722bf2b527da89fa667290eeeb2b68e` |
| `dashboard-light-1440x1000.png` | `c007102426a341daf9f27e99c76729e5b8b5f9e3644942188aa6825bf58b448d` |
| `geo-insights-dark-1440x1000.png` | `06650ab9935e12dba095f67a6b4be65b14d243c392b645ba0a044335ef95010b` |
| `geo-insights-light-1440x1000.png` | `3a5d690dae3c8dd8a6d1a971c7713172445be7642ca6a626e5b675c523b56ad7` |
| `geo-insights-light-375x900.png` | `c082f74b299b01c7159558040f73c5b910a6618acccf430a2c8b4b4bd914d6aa` |
| `prompts-dark-1440x1000.png` | `caf31322293ecd64d44fbbc877ca9a7c284e7a2eebf483f1e7a10e65ad4ea815` |
| `prompts-light-1440x1000.png` | `4ae4691e7dfa6dc45620feb806fe374a51556e963d8b1bebc958904987a9f16d` |
| `prompts-light-375x900.png` | `bbb8b82ad66ce91aecbf356a4830e01495e8fb8740f72e64762be10961c18d81` |
| `users-dark-1440x1000.png` | `1383abbccd99256d73d843db75ad3d94760c5c9c75d64b62fb8a749de8775e14` |
| `users-light-1440x1000.png` | `163a96a99fa2062c6e8c8ef1199c111371b757cbf6200d32e11d585075faa365` |
| `users-light-375x900.png` | `467b6409bc1235cac48ec2d99afeaf243ee2ef287a59848fed6f4507eeb32964` |

全部文件恢复到 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/`。文件名中的桌面图片必须为 1440×1000，移动图片必须为 375×900。

## 4. 执行流

```text
冻结 HEAD、工作区和服务状态
  -> 验证父提交 11 个源 blob 与清单一致
  -> 精确恢复 11 张基线并复核数量、尺寸、SHA
  -> 将条件阈值改为固定 0.02
  -> 静态确认截图名称、视口、主题、遮罩与配置未变
  -> 运行目标视觉用例（禁止更新快照）
       -> 通过：运行完整 make e2e
       -> 失败：停止；按页面/主题/视口提取候选并请求批准
  -> 复核隔离资源清理与最终差异边界
```

## 5. 失败与批准规则

| 情况 | 处理 |
| --- | --- |
| 源 blob 不存在、数量不为 11、SHA 或尺寸不符 | 立即停止，不从运行 actual 补齐 |
| 目标视觉用例在 `0.02` 下通过 | 进入完整 `make e2e` |
| 目标视觉用例产生稳定视觉差异 | 保留精确 expected/actual/diff 证据，按失败项请求用户批准；不得自动更新 |
| 失败证明需要修改产品、遮罩、配置或 E2E 数据 | 返回规划评审，不扩大本任务 |
| 完整 E2E 出现独立失败 | 如实记录并停止，不顺带修复 |
| 隔离数据库或临时对象存储未清理 | 视为验收阻断，先完成精确清理再退出 |

如需等待视觉批准，只把对应失败候选复制到当前任务的临时候选目录供查看，再清理 `test-results`、`playwright-report` 和工具诊断目录；未批准候选不进入提交。

## 6. 修改边界

允许产生差异的路径仅为：

- 当前任务目录下的 `prd.md`、`design.md`、`implement.md`、`task.json` 及实施证据；
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts` 中移动截图阈值分支及其失效注释；
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/` 下清单所列 11 张 PNG。

明确排除产品 TSX/CSS、主题、合同、数据库、部署配置、Playwright 配置、`.playwright-cli/`、`frontend/.playwright-cli/` 及其他快照。

## 7. 验证设计

必需验证：

1. 对 11 张恢复文件运行数量、PNG 尺寸和 SHA-256 复核。
2. 静态确认 `cross-page-visual-convergence.spec.ts` 不含 `0.035`，11 张截图均使用 `0.02`，截图名称、遮罩、主题和视口未改变。
3. 运行前端 lint 与 typecheck，证明测试源码改动合法。
4. 使用真实隔离 API 栈只运行目标视觉用例，且不传 `--update-snapshots`。
5. 运行完整 `make e2e`，记录测试计数、耗时和清理结果。
6. 执行 `git diff --check`、路径清单与最终差异复核。

合同、后端单元/集成测试和独立镜像 build 不列为本任务必需项：本任务不改变这些边界，且 `deploy/scripts/e2e-local.sh` 已执行前端 build。视觉闭环完成后，新的冻结提交仍须另行运行上线前最终发布候选验收的七项门禁。

## 8. 回退

如实施未通过，只逆向移除本任务恢复的 11 张文件并撤销测试源码中的单个阈值修改；不得使用宽范围重置、删除或清理命令。Trellis 规划与失败证据保留，供后续审批或重新立项。
