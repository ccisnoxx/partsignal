# 24 表门禁目标收敛

## 目标

修复第二轮全项目回归中的 `PS-QA2-TEST-001`：让“全站 24 张业务表”E2E 对清单中的每一项验证唯一、明确的运行时 `TableRegion`，目标缺失或命中错误表时必须失败，不能再由同页或弹窗背景中的其他表替代。

## 背景与已确认事实

- 权威来源：
  - `.trellis/tasks/archive/2026-08/07-31-sitewide-functional-regression-testing-round-2/report.md`
  - `.trellis/tasks/archive/2026-08/07-31-sitewide-functional-regression-testing-round-2/research/findings.md`
  - `.trellis/tasks/archive/2026-08/07-31-sitewide-functional-regression-testing-round-2/research/table-action-delete-matrix.md`
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts` 已维护 24 项源码清单，但运行时循环先按 `surface` 去重，再扫描页面全部可见 `.table-region`；同一页面有多张表时，没有逐个证明当前清单项存在。
- `inspectCurrentTableSurface` 在页面没有可见表时直接跳过，因此缺失目标也可能不失败。
- 打开“登记人工观测”和“获取模型”弹窗后，现有扫描仍可命中背景“观测记录列表”或“模型列表”；第二轮报告只能另用精确 dialog 选择器补证，说明正式门禁本身不可靠。
- 生产 `TableRegion` 已统一提供 `role="region"` 和 `aria-label`；24 项均能映射到现有可访问名称，GEO 内容排行采用既有具体表面“表现最佳内容 Top 5”作为该清单项的运行时代表，不需要修改产品组件。
- 隔离 E2E 的 `seed-demo` 只创建账号；当前 `shared-data.setup.ts` 只保证产品、批准事实、平台、内容任务/人工版本和 AI 渠道，尚不能稳定呈现 AI 作业、请求 Header、模型、GEO 文章候选及三类 GEO 洞察表。

## 根因

1. 24 项清单只登记源码标记和页面分组，没有登记运行时目标的可访问名称与弹窗作用域。
2. 几何辅助函数拥有页面全局选择权，并带有“没有表就跳过”的成功路径；调用方没有把待验收对象传给它。
3. 共享 E2E 数据的“已准备”判定只检查四类资源非空，没有验证这些资源是否组成能呈现全部条件表格的同一业务图。

## 范围内

1. 为现有 24 项清单逐项登记稳定的 `TableRegion` 可访问名称；两张弹窗表同时登记其 dialog 作用域。
2. 将表格几何、长文本、固定列和首行悬停检查收敛到调用方传入的精确 `Locator`，移除 24 表门禁中的页面全局替代与静默跳过。
3. 同一 `surface` 打开一次后，逐项断言该 surface 下登记的每个目标恰好命中一个可见 region，再对该 region 执行原有桌面和移动边界检查。
4. 最小扩充现有共享 E2E 数据和就绪判定，使条件渲染目标在隔离栈中确定出现：AI 作业、请求 Header、模型/日志、已发布文章候选、GEO 观测及洞察。
5. 复用当前 API、假 AI 服务、对象存储和 `mvp-flow.spec.ts` 已验证的业务顺序；测试数据失败必须显式暴露，不增加固定成功响应或猜测 fallback。
6. 保留 24 项静态源码清单与源码标记检查，使生产表面被删除或重命名时门禁继续失败。

## 范围外

- 不修改生产 React 组件、`TableRegion`、CSS、视觉 Token、路由、权限、API、数据库或业务状态机。
- 不改变 24 表清单数量，不把三张内容排行子表扩成新的清单口径，也不重做 24 套 Page Object。
- 不新增 E2E 框架、依赖、通用 fixture 层、截图基线或独立数据生成脚本。
- 不修改 `mvp-flow.spec.ts` 的纵向业务验收；只参考其已验证的最小 API 顺序。
- 不处理 UI/UX、对象存储、验收文档、`available_actions` 或其他回归组。
- 不提交 `.playwright-cli/`、`frontend/.playwright-cli/` 诊断产物，不推送远端。

## 需求

1. 每个清单项必须同时拥有静态源码标记和运行时 `regionLabel`；运行时定位使用 `getByRole('region', { name, exact: true })`，不得回退到首个或任意 `.table-region`。
2. 两张弹窗表必须先在对应 dialog 内定位，再定位 region；背景页面的同名或其他表均不能满足断言。
3. 每个目标在对应作用域内必须恰好出现一次且可见；零个或多个匹配都应给出包含清单标签、surface 和视口的失败信息。
4. 原有文档无横向溢出、region 边界、长文本压力、键盘可达、行高和固定列背景检查必须保留，但只能读取当前登记 region 的后代。
5. 共享数据必须以一套可辨识、关联完整的视觉验收图为单位判断就绪；部分旧数据不得让准备阶段提前返回。
6. 条件表数据只补到“能稳定渲染一行并覆盖真实调用链”的最低状态，不制造第二套全流程测试，也不清理或覆盖操作者已有业务数据。
7. 桌面 `1440×1000` 与移动 `375×900` 都必须逐项完成 24/24 目标验证。

## 验收标准

- [x] AC1：`sitewideTableInventory` 仍为 24 项，且 24/24 均登记静态源码标记和明确的运行时 region 可访问名称。
- [x] AC2：每个 surface 打开后，其全部登记目标均在正确页面或 dialog 作用域内恰好命中一个可见 `TableRegion`；任一目标缺失时用例失败。
- [x] AC3：“产品文章观测结果”只能由“登记人工观测”dialog 内的同名 region 满足；“远端模型列表”只能由“获取模型”dialog 内的同名 region 满足。
- [x] AC4：几何、长文本、固定列和悬停检查均限定在当前目标 region；不存在页面全局 `.table-region` fallback，也不存在零表静默跳过。
- [x] AC5：共享准备数据能在全新隔离数据库中确定呈现 AI 作业、请求 Header、模型、渠道日志、GEO 文章候选、平台表现、内容排行和覆盖矩阵；使用真实项目 API 与本地测试适配器。
- [x] AC6：24 张表在 `1440×1000` 和 `375×900` 两个视口全部通过目标存在性与原有边界检查，E2E 隔离数据库和临时存储精确清理。
- [x] AC7：不修改生产源码、合同、后端、数据库迁移、依赖或其他 E2E 文件；类型检查、Lint 和范围检查通过。

## 依赖与阻塞问题

- 本任务只依赖项目现有本地 PostgreSQL、Redis、对象存储适配器和假 AI 服务；`deploy/scripts/e2e-local.sh` 已负责隔离和清理。
- 不依赖剩余文档决策或全局 `available_actions` 合同决策，可以独立实施。
- 当前无产品/架构决策阻塞；实施前仍需用户批准本版 `prd.md`、`design.md`、`implement.md`，之后才允许运行 `task.py start`。
