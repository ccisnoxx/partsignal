# Dashboard 视觉基线同步设计

## 1. 设计结论

不修改 Dashboard，也不修改视觉测试规则。当前页面的业务语义变化已经由 `406f3ab` 及其归档任务批准，根因只是旧自动快照没有随之更新；最小修复是保留一份新的人工批准原图，并用项目既有真实 E2E 栈生成后只替换一张 Dashboard 自动基线。

## 2. 根因与权威位置

```text
7df976d 更新旧 Dashboard 自动基线
  → 406f3ab 按现行 GEO/发布合同修改 Dashboard 稳定文案和结构
  → DashboardPage.tsx 与业务测试已同步
  → dashboard-light-1440x1000.png 未同步
  → 完整 E2E 以 9% 稳定像素差失败
```

| 责任 | 权威位置 | 本任务处理 |
| --- | --- | --- |
| 当前业务内容和页面结构 | `frontend/src/features/dashboard/DashboardPage.tsx`、已归档观测/发布任务 | 只读核对，不修改 |
| 视觉规则与批准要求 | `.trellis/spec/frontend/visual-system.md` | 完整遵守，不修改 |
| 截图流程、遮罩和阈值 | `frontend/tests/e2e/cross-page-visual-convergence.spec.ts` | 只读复用，不修改 |
| 人工批准证据 | 当前任务 `assets/approved/` | 新增批准原图与 manifest |
| 自动回归资产 | `.../dashboard-light-1440x1000.png` | 唯一自动基线变更 |

## 3. 两类视觉资产

### 3.1 人工批准原图

- 使用真实开发 API 数据、`1440×1000` CSS 视口和浅色主题采集，不做重绘、压缩或业务数据伪造。
- 保存为 `.trellis/tasks/08-02-dashboard-visual-baseline-sync/assets/approved/dashboard-1440x1000-light.png`。
- `manifest.md` 记录对应原型 `07-25-frontend-visual-system-recalibration/assets/prototypes/13-dashboard.png`、文件 SHA-256、尺寸、主题、批准者、北京时间和用户批准原话。
- 原图中的身份和业务数值只证明真实页面状态，不成为固定产品事实。

### 3.2 自动视觉基线

- 继续由 `cross-page-visual-convergence.spec.ts` 在隔离 E2E 栈中生成。
- 继续使用 `visualMasks(page, 'dashboard')` 遮罩身份和动态业务数值；稳定文案、卡片边界、行数、分栏、壳层和间距不得被新增遮罩覆盖。
- 继续使用 `maxDiffPixelRatio: 0.02`，不改测试名称、运行项目或截图路径模板。
- 只将本次测试产生的 `dashboard-light-1440x1000` 实际图替换到现有基线路径；不得批量更新整组快照。

## 4. 执行与验证流

1. 用户批准规划阶段展示的最终候选图后，保存该原图并登记 manifest。
2. 运行目标视觉用例但不自动接受快照，确认唯一预期失败仍是 Dashboard，并取得 Playwright 生成的实际图。
3. 核对实际图尺寸、目标文件名和当前批准构图后，只替换 Dashboard 基线。
4. 在基线发生预期变化后重跑同一目标用例，要求 setup 与主用例通过并完成隔离清理。
5. 运行完整 `make e2e`，验证之前的合同、焦点和基线问题共同闭环。
6. 检查 Git 差异，只允许当前任务资料和单张 Dashboard 基线进入提交候选。

## 5. 失败处理

- 若目标用例除 Dashboard 外还出现其他快照差异，停止，不接受其他快照。
- 若实际图与获批页面存在稳定结构差异，停止并重新回到人工批准，不把新图直接视为已批准。
- 若完整 `make e2e` 暴露与本次资产无调用链关系的失败，保留本任务证据并单独归因；不得修改产品代码、测试期待、CORS、Alert 或其他基线。
- 若隔离数据库、临时存储或服务未成功清理，任务不能进入提交阶段。

## 6. 取舍与回滚

- 不使用 `--update-snapshots` 批量接受：一次用例包含十一张基线，批量更新会扩大误纳风险。
- 不修改 Dashboard 以匹配旧图：旧图绑定的是已被现行业务合同替代的推荐/引用口径。
- 不增加遮罩或放宽阈值：稳定文案与结构变化正是视觉基线应保护的内容。
- 回滚只涉及当前任务批准资产和单张 Dashboard 基线；无迁移、数据或部署操作。任何回滚前先核对精确目标，不使用宽范围 Git 恢复命令。

## 7. 实施发现

Dashboard 基线替换后，其截图断言已通过；同一测试随后暴露了独立的 `content-review` 旧基线。该差异已由独立任务 `08-02-content-review-visual-baseline-sync` 取得用户批准并在提交 `6696959` 中同步，没有扩张本任务的基线边界。该前置任务完成后，本任务重跑目标视觉用例和完整 `make e2e` 均通过。
