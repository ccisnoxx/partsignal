# 内容审核视觉基线同步

## 目标

取得用户对当前 `1440×1000` 浅色内容审核只读预览态的明确批准后，只同步过期的 `content-review-light-1440x1000.png`，使 Dashboard 所在目标视觉用例恢复通过；本任务独立提交和收尾后，再返回 `08-02-dashboard-visual-baseline-sync` 运行目标视觉用例与完整 `make e2e`。

## 已确认事实

- 当前 Dashboard 任务已经只替换 `dashboard-light-1440x1000.png`；重跑目标视觉用例时 Dashboard 断言通过，随后内容审核基线以 `47124` 像素、比例 `0.04` 失败。
- 内容审核旧自动基线最后由提交 `7df976d` 更新，记录的是修订编辑态；提交 `2e59943` 随后把修订入口的权威判断从本地状态推断改为 `content.available_actions` 是否包含 `CREATE_REVISION`。
- 当前隔离 E2E 数据中的目标内容不提供 `CREATE_REVISION`，所以 `ContentEditorPage.tsx` 正确默认进入只读“预览”页签；旧基线不再符合现行服务端动作合同。
- 自动基线的权威位置是 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/content-review-light-1440x1000.png`；测试继续固定使用 `1440×1000`、浅色主题、既有 `visualMasks(page, 'content-review')` 和 `maxDiffPixelRatio: 0.02`。
- 规划阶段已用独立 `playwright-cli` 会话从当前开发环境和真实 API 采集候选图：`/tmp/partsignal-content-review-baseline-plan-1440x1000.png`，SHA-256 为 `733c10a0f1fca70810ddd81d9432436abaf031a72dbc852a4313dcab89b3a9b6`。页面 console 为 0 error / 0 warning，相关 API 均为 200，文档宽度为 `1440/1440`，无横向溢出。
- 候选图中的标题、身份、时间、任务、标签、正文、质量计数、操作以及内容队列行数均为采集时的真实动态数据，不成为固定业务合同；用户批准的是当前只读预览态的稳定构图和视觉层级。

## 范围内

1. 向用户展示规划阶段采集的当前内容审核候选图，并取得对该只读预览态和最终规划的明确批准。
2. 将获批原图保存为当前任务 `assets/approved/content-review-1440x1000-light.png`，并由 `manifest.md` 登记原型、SHA-256、尺寸、主题、批准者、北京时间和批准原话。
3. 在当前 Dashboard 基线已替换的工作树上运行目标视觉用例，确认 Dashboard 通过且唯一剩余失败为内容审核旧基线。
4. 使用同一次真实隔离 E2E 产生的 content-review actual PNG，只替换 `content-review-light-1440x1000.png`。
5. 保持内容审核产品代码、服务端 `available_actions` 合同、视觉遮罩、阈值、测试源码、数据准备和 Playwright 配置不变。
6. 重跑目标视觉用例并要求通过；完成 `trellis-check`、范围确认、独立提交和 Trellis 收尾后，再切回 Dashboard 任务运行目标用例与完整 `make e2e`。
7. 保留并排除 `.playwright-cli/`、`frontend/.playwright-cli/`、`frontend/test-results/` 和 `frontend/playwright-report/`，不自动推送。

## 范围外

- 不修改 `ContentEditorPage.tsx`、`RevisionForm.tsx`、API、数据库、OpenAPI、生成类型、CSS、主题或组件。
- 不修改 `cross-page-visual-convergence.spec.ts`、`visualMasks`、`maxDiffPixelRatio`、Playwright 配置或 E2E 数据准备。
- 不更新 Dashboard 或其余九张视觉基线；当前未提交的 Dashboard 基线和 Dashboard Trellis 任务目录不进入本任务提交。
- 不把 `CREATE_REVISION` 恢复为本地状态推断，不伪造动作、固定成功数据或增加兼容 fallback。
- 不在本任务运行完整 `make e2e`；该门禁在本任务完成后回到 Dashboard 任务执行并记录。
- 不处理目标用例之外的新失败；若重跑暴露第三张基线或其他独立问题，停止扩展并报告。

## 验收标准

- [x] AC1：用户明确批准当前 `1440×1000` 浅色内容审核只读预览态及本版最终规划；批准原图和 manifest 位于当前任务 `assets/approved/`，元数据可核验。
- [x] AC2：内容审核产品代码、服务端合同、样式、测试源码、数据准备、配置和依赖均无差异。
- [x] AC3：本任务唯一的自动视觉资产变更是 `content-review-light-1440x1000.png`；Dashboard 及其余九张基线字节不变。
- [x] AC4：内容审核继续使用既有精确动态遮罩与 `0.02` 阈值，不通过扩大阈值、静态结构遮罩、`skip` 或固定成功路径消除失败。
- [x] AC5：目标视觉 E2E 在真实隔离栈中通过；隔离数据库和临时对象存储均输出成功清理证据，Compose frontend 恢复。
- [x] AC6：`trellis-check`、任务文档校验、资产 SHA、单基线边界和 `git diff --check` 通过；无新增规范合同需要同步。
- [x] AC7：提交范围仅包含当前 Trellis 任务目录和一张内容审核自动基线；Dashboard 工作差异和全部 Playwright 诊断产物不纳入提交，不推送。
- [ ] AC8：本任务提交并完成 Trellis 收尾后，重新激活 `08-02-dashboard-visual-baseline-sync`，由后者运行目标视觉用例和完整 `make e2e`。

## 关键决策

- 当前只读预览态是服务端 `available_actions` 合同的正确投影，不回退产品实现去匹配旧编辑态基线。
- 人工批准原图与自动基线分开保存；自动基线允许遮罩动态业务数据，但不得替代人工批准证据。
- 本任务是独立测试资产任务，不作为 Dashboard 任务的子任务，也不混合提交两个任务的文件。
