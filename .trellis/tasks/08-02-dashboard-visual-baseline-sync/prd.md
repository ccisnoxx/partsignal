# Dashboard 视觉基线同步

## 目标

依据用户已明确批准的当前 Dashboard 最终外观，只同步已过期的 `dashboard-light-1440x1000.png`，恢复 Dashboard 视觉断言和完整 E2E 门禁，同时保持产品页面、业务口径、视觉测试规则及其余十张基线不变。

## 已确认事实

- 第二轮七组修复集中回归的完整 E2E 为 `44 passed, 8 failed`；其中 Dashboard 基线与当前页面相差 `118054` 像素、比例 `0.09`，是剩余已归因失败之一（`.trellis/tasks/archive/2026-08/08-01-round-2-seven-group-centralized-regression/report.md:36-42`）。
- 当前自动基线最后由提交 `7df976d` 更新；Dashboard 页面随后在提交 `406f3ab` 中按已批准业务合同改为文章发现率、提及率和准确率，删除“未推荐文章”待办，并把入口统一为“发布管理”。
- 上述页面变化属于已归档的观测证据与发布管理任务，不是本任务重新设计的内容；当前 `DashboardPage.tsx` 自 `406f3ab` 后没有新的页面实现提交。
- 自动基线的权威位置是 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts-snapshots/dashboard-light-1440x1000.png`；测试固定使用 `1440×1000`、浅色主题、现有精确动态遮罩和 `maxDiffPixelRatio: 0.02`。
- `.trellis/spec/frontend/visual-system.md` 要求：更新自动视觉基线前必须取得用户对最终页面的明确批准；批准资产需保存于当前任务 `assets/approved/` 并登记 SHA-256、视口、主题、批准者、北京时间和批准原话。
- 规划阶段已通过独立 `playwright-cli` 会话从当前开发环境取得一张真实 `1440×1000` 浅色候选图；Dashboard、GEO 指标和产品请求均为 HTTP 200，console 无错误或警告。候选图暂存于 `/tmp/partsignal-dashboard-baseline-plan-1440x1000.png`，SHA-256 为 `bb8050ace512d2a97320fe7f692254f6a3d9e2d885ab601aebdf63617a346ad6`。
- 用户已于 `2026-08-02 10:39:35 CST` 明确回复“批准”，确认上述候选图作为新的 Dashboard 人工视觉锚点；实施时必须保存该原图并在 manifest 中登记本次批准原话。

## 范围内

1. 取得用户对当前 `1440×1000` 浅色 Dashboard 候选图的明确批准。
2. 将获得批准的原始页面截图保存为当前任务的 `assets/approved/dashboard-1440x1000-light.png`，并在 `assets/approved/manifest.md` 登记可核验元数据。
3. 使用项目真实 API 隔离 E2E 栈生成 Dashboard 的自动化截图结果，只替换 `dashboard-light-1440x1000.png`。
4. 保持既有动态遮罩、截图阈值、测试用例、数据准备和 Playwright 配置不变。
5. 先运行 Dashboard 所在视觉用例，再运行完整 `make e2e`，证明先前的 E2E 合同与焦点修复加上本次基线同步后，全量浏览器门禁不再被已知旧基线阻断。
6. 保留并排除 `.playwright-cli/`、`frontend/.playwright-cli/`、`frontend/test-results/` 和 `frontend/playwright-report/` 诊断产物，不自动推送。

## 范围外

- 不修改 `DashboardPage.tsx`、Dashboard 业务指标、API、数据库、OpenAPI、生成类型、CSS、主题或组件。
- 不修改 `cross-page-visual-convergence.spec.ts`、`visualMasks`、`maxDiffPixelRatio`、Playwright 配置或 E2E 数据准备。
- 不更新其余十张视觉基线，也不批量接受任何新截图。
- 不处理 `Alert.message` 弃用提示、GEO 上传/CORS 诊断、其他页面视觉调整或新的 E2E 失败；若完整门禁暴露独立问题，按失败归因规则记录并分流。
- 不改写已归档的第二轮集中回归报告；最终闭环结论由后续集中收尾任务记录。

## 验收标准

- [x] AC1：用户明确批准当前 `1440×1000` 浅色 Dashboard；批准截图和 manifest 均位于当前任务 `assets/approved/`，文件尺寸、SHA-256、批准者、北京时间和批准原话可核验。
- [x] AC2：产品代码、样式、合同、配置和视觉测试源码均无差异；产品行为与 `406f3ab` 后的当前实现完全一致。
- [x] AC3：工作差异中唯一的自动视觉资产变更是 `dashboard-light-1440x1000.png`；其余十张基线保持字节不变。
- [x] AC4：Dashboard 基线继续使用现有精确动态遮罩与 `0.02` 阈值，不通过扩大阈值、增加静态结构遮罩、`skip`、固定成功数据或兼容 fallback 消除失败。
- [x] AC5：目标视觉 E2E 在真实隔离栈中通过；隔离数据库和临时对象存储均输出成功清理证据。
- [x] AC6：最新代码上的完整 `make e2e` 通过；若出现与本次基线无关的新失败，必须明确归因，不能修改本任务范围外代码或测试使其变绿。
- [x] AC7：提交范围只包含当前 Trellis 任务目录和一张 Dashboard 自动基线；Playwright 诊断产物保持未跟踪且不纳入提交。

## 依赖与关键决策

- 前置实现已完成：E2E `available_actions` 合同同步、发布 Drawer 直接关闭回焦、发布 Drawer 菜单动作快速关闭回焦均已提交并归档。
- 视觉批准决策已解决：当前 `1440×1000` 浅色 Dashboard 是本任务唯一获批页面；任何后续稳定结构差异都必须重新取得批准，不能自动扩张批准范围。
