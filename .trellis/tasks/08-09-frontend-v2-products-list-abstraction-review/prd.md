# Frontend V2 Phase 2.2 — Products List 抽象回顾

## 目标

审查 Frontend V2 第一张业务页 `/products` 形成的 Product domain、route、Table Kit、Auth 和测试边界，确认哪些实现继续留在 Product domain，哪些已经由真实消费者证明属于 Design System/shared invariant；只修复有具体证据的缺陷并做必要的小型局部简化，不新增业务能力。

## 已确认事实

- 审查基线为本地干净 `main`：`afa347c92a83deb27fcfd77f07c033bbdbf9ee9a`；Products List 实现提交为 `4e21412`，已通过 `ad0d219` 归档。
- 实施分支为 `codex/frontend-v2-products-list-abstraction-review`，只承载本 Task。
- Products List 的旧临时分支已从本地与 remote-tracking refs 删除。
- 当前 route 只负责 search validation、canonical redirect、prefetch、CSRF 注入和 composition；URL state 由 TanStack Router 权威持有，TanStack Table 只消费受控 engine state。
- Product domain 使用 generated types，拥有 URL→API mapping、query options、action/status mapping、格式化和页面组合；Design System 的 RowActions/Table Kit 不识别 Product token。
- Products Playwright fixture 位于 `tests/e2e/fixtures`、使用 generated types、拒绝未声明 API，明确不代表真实后端业务闭环。
- 已确认一项 P2 缺陷：删除条件“重新检查”在 refetch 后无条件清空目标，即使服务端仍返回 blocker 也会关闭弹窗。
- 已确认测试边界存在可删除重复：AppShell suite 全局 mock Product API 并重复 Product normalization；component/E2E 重复完整 URL 流程、六 token 穷尽 href 和独立长文本场景。

## 需求

1. 按严重度记录 evidence-backed findings，并为每项保留 `file:line`、影响、归属与处理结论。
2. 将审查项归类为 Keep in Product Domain、Keep in Design System/shared、Simplify locally、Promote only after second consumer、Confirmed defects requiring change、Deferred product/UX decisions。
3. Table Kit 继续保持可组合 primitives/pattern，不新增 DataTable、server-list hook 或只转发参数的 wrapper。
4. `ProductsListPage` 只承担 Product 列表页面 composition、局部列与交互；不得因文件长度拆分无第二消费者的模块。
5. route 继续只拥有 search validation、canonicalization、prefetch 和 composition；不得把 Product mapping 或业务资格移入 route。
6. URL state 继续由 Router 权威持有；TanStack Table 只持有表格 engine state，不新增第二份 pagination/filter/sort 状态。
7. URL→API 参数、query key/options、DELETE mutation、Product action/status registry、current fact/time formatter、筛选 Select 和错误解析继续留在 Product domain，除非出现稳定第二消费者。
8. UI 不得直接消费 ErrorEnvelope、raw generated API mapping 或手写重复 DTO；Primary/overflow 只消费服务端 typed projection。
9. RowActions 不包含 Product 业务逻辑；Auth 暴露 CSRF 和 Foundation smoke 的职责保持通用语义。
10. 修复 blocker 重新检查行为：仍有 blocker 时保持弹窗并显示最新投影；blocker 消失或产品离开列表时由派生状态自动关闭。
11. 简化测试边界时保留最强证明层：model unit 穷尽合同映射，component 覆盖页面状态与 mutation，Playwright 覆盖代表性 production-artifact 用户流程。
12. `UPDATE` 继续显示禁用“编辑产品 / V2 编辑入口待定义”，直到独立 Product 编辑 UX/路由获批；本 Task 不把它变成兼容层或可用入口。

## 验收标准

- [x] findings 按严重度排序并包含准确 `file:line`；六类归属矩阵完整。
- [x] blocker 重新检查在阻断仍存在时保持打开并更新内容，阻断消失时自动关闭。
- [x] AppShell 测试中的 Product API mock 只作用于需要该业务 route 的测试，Product normalization 不再由共享 shell suite 重复拥有。
- [x] model unit 继续穷尽六个 `primary_task`；component/E2E 删除重复覆盖后仍分别证明自身边界。
- [x] Table Kit、RowActions、route、URL/Query/Table state ownership、API mapping、query invalidation 和 generated type 边界保持不变。
- [x] 不新增 shared abstraction、业务能力、依赖、路由、backend/OpenAPI/database 修改或兼容 fallback。
- [x] 针对性 unit/component、lint、typecheck、Products Playwright 与 `git diff --check` 全部通过。
- [x] 最终 diff 不超过实施计划文件上限，且没有夹带 New Product 或其他后续 Task。

## 明确非目标

- New Product、Product Detail、Fact Workspace/Review、Fact Version Detail 或任何新业务路由。
- backend、OpenAPI、database、generated schema、V1、部署或权限修改。
- Design System 大规模重构、跨 domain abstraction、通用错误处理框架。
- 通用 action/status/date/filter registry、DataTable、server-list hook 或第二套 DTO。
- 重写 Products List、改变批准业务行为、解决 Product 编辑 UX。
- 新依赖、commit、merge、push、archive 或开始 New Product。
