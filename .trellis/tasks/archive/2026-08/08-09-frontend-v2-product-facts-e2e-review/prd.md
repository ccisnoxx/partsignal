# Frontend V2 Phase 2.8 — Product Facts 完整 E2E 与 Vertical Slice 抽象回顾

## 目标

以真实 PostgreSQL、真实 FastAPI 和 Frontend V2 production artifact 验证 Product Facts vertical slice 的跨页面业务闭环，并基于现有实现证据评估 Phase 2 退出条件。仅允许实施真实闭环所需的最小 E2E 调整、Product Facts 缺陷修复和已被多个页面证明稳定的小型去重；不得用 fixture、假页面或固定成功路径掩盖产品缺口。

## 已确认范围

- 保留现有 fixture-based Products 页面测试；新增的真实栈 E2E 只覆盖跨页面与服务端状态转换。
- Flow A：创建产品、录入并保存事实、提交审核、批准、打开不可变 Fact Version Detail，并验证服务端 `primary_task` 变为 `CREATE_CONTENT_TASK`。
- Flow B：创建产品、录入事实、提交审核、请求修改、返回工作区修改并保存、重新提交、批准，并验证目标 `FactVersion` 的审核历史没有串入其他版本。
- 真实闭环必须运行独立测试 PostgreSQL、真实 FastAPI 和 V2 production build；不得使用 Vite dev server 代替 production artifact。
- Product Facts 业务 API 不得通过 `page.route` 或 `fixture.fulfill` 模拟。允许使用测试 API 建立登录会话或验证数据库外部结果，但主流程必须经 V2 UI 操作。
- 优先复用 `deploy/scripts/e2e-local.sh` 的数据库隔离、seed、服务启动和清理机制，不创建第二套完整 orchestration。
- 使用唯一测试数据并依赖现有数据库隔离统一销毁；不访问生产服务、真实 OSS 或真实 AI，不增加复杂逐记录清理器。
- 审查 Products List、New、Detail、Fact Workspace、Fact Review、Fact Version Detail 的交互、状态映射、query keys、API error mapping、action registry、资格判断、DTO/API join 和 design-system 边界。

## 边界与约束

- 不实现 `/content/tasks/new` 页面。批准后至少验证服务端 `CREATE_CONTENT_TASK` 与正确的 `/content/tasks/new?productId=...` 交接链接；后端创建内容任务的证明不是 V2 Content Task UI E2E。
- 不实现新的 Fact History 列表路由或业务页面。若当前 `VIEW_FACT_HISTORY` 进入 Product Detail 不满足 Phase 2 要求，应记录为明确 gap 并建议独立后续 Task。
- 不重写现有全部 fixture E2E，不新增通用 E2E framework、page-object hierarchy 或测试 DSL。
- 不为 Content Review 预建 abstraction、`ReviewWorkspace`、`VersionDetail` framework 或通用状态机。
- 不修改无关 backend、deployment 或 V1 页面；不增加固定成功路径、silent fallback 或页面本地状态机。
- 抽象只允许来自至少两个真实页面已稳定复用的纯 UI pattern；优先删除重复代码，不为未来需求扩展。

## 验收标准

- [x] planning artifacts 给出当前 Product Facts E2E coverage matrix，以及 fixture-based 与真实栈 E2E 的明确边界。
- [x] 给出复用现有入口的最小 harness 调整方案，并明确 production artifact、独立 PostgreSQL、真实 FastAPI、登录、seed 与清理方式。
- [x] 为 Flow A、Flow B 列出逐步 UI 操作、唯一数据、API/数据库断言与跨页面状态断言。
- [x] 明确 `/content/tasks/new` 缺口的本 Task 处理边界，不把后端验证表述为 V2 UI E2E。
- [x] 基于蓝图、迁移计划、路由与实现证据判断 Fact History 列表是否为 Phase 2 gap；若是，提出独立后续 Task，不在本 Task 实现。
- [x] 输出 vertical slice abstraction review findings，并把候选修改限制为有调用/重复证据的小型去重或纯 UI 提升。
- [x] 列出允许实施的小型重构、明确排除项、预计修改文件、required validation、optional full-suite validation、风险与阻塞项。
- [x] 给出证据支持的 Phase 2 exit gate 判断；存在缺口时不得宣称全部退出条件已满足。
- [x] 计划确认前不运行 `task.py start`，不修改业务代码。

## 已确认结论

- 当前 V2 Product domain 有 32 个 fixture-based 页面用例，另有 1 个 Foundation smoke；没有真实 PostgreSQL/FastAPI 的跨页面 Product Facts flow。
- 最小 harness 方案是扩展 `deploy/scripts/e2e-local.sh`：复用其数据库隔离、seed、服务启动和 cleanup，在同一生命周期构建并运行 V2 production preview；Makefile 无需增加入口。
- `/content/tasks/new` 尚未实现。本 Task 只验证服务端 `CREATE_CONTENT_TASK` 与正确 handoff href；完整 Content Task UI 属于 Phase 3。
- Fact History 只有单版本 Detail，没有列表 query/route/page；`VIEW_FACT_HISTORY` 回到 Product Detail 不能扫描全部历史。这是明确的 Product Facts gap，应由独立后续 Task `frontend-v2-fact-history` 处理。
- Vertical slice 没有结构性抽象问题。唯一有充分重复证据的小型重构是把 `Confidentiality` label registry 收敛到现有 `product.model.ts`，删除 Fact Review 的第二份 mapping。
- 当前 Phase 2 exit gate 为 `NOT_MET`。即使本 Task 的真实 Flow A/B 通过，Fact History gap 关闭前也不能宣称 Product Facts 全部 Phase 2 条件满足。

## 规划证据

- `research/e2e-coverage-and-harness.md`
- `research/flows-and-exit-gaps.md`
- `research/vertical-slice-abstraction-review.md`
- `research/implementation-results.md`
