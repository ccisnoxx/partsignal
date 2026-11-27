# C02 创建内容任务

## Goal

验收 `/content/tasks/new` 的 creation-options、Product handoff、三字段选择、幂等创建和响应 ID 导航。

## Requirements

- 前置 C01/P08/F06 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 4.2 节、`05-business-actions-state-and-api-contract.md` New Content Task、`08-testing-quality-and-acceptance.md` Phase 3.2 及 OpenAPI ContentTaskCreate/CreationOptions。
- 表单只选择 Product、该产品非空已批准 FactVersion、活动 Platform。首屏一次读取 creation-options；`productId` handoff 保留 URL，失效资格必须显式提示且不静默改选。
- `POST` 精确发送三个 ID、CSRF 与同 payload 稳定 Idempotency-Key；更改 payload 或 `IDEMPOTENCY_CONFLICT` 后换 key。pending 防重复、DirtyGuard、结构化错误和 request ID 完整；成功采用响应 `id` 导航 Detail 并失效列表。
- 当前候选 production preview 的严格 fixture 覆盖 direct/refresh/Back/Forward、四档宽度与浏览器错误；P08 的真实栈 Flow A 对 Product handoff 有本轮补充证据。

## Acceptance Criteria

- [x] model/组件测试证明三字段、handoff、键语义、错误与导航。
- [x] 生产预览浏览器测试证明选择、命令、URL、DirtyGuard、焦点与响应式。
- [x] 记录实际代码、证据与 C03 下一步。

## Scope

拥有 New Content Task 页面/model 与直接测试；不把其他 Content 工作流复制到创建页。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：现有创建页/model/API 已满足三字段、服务端 options、URL handoff、稳定幂等键和响应 ID 导航；本项未改生产代码或测试。C02 PRD 是本轮验收记录。
- `new-content-task.model.test.ts` 与 `new-content-task-page.test.tsx`：2 files / 16 tests 通过。当前候选生产构建预览 `new-content-task.spec.ts` 两个 Playwright project 20/20 通过，覆盖 List/Detail 入口、direct/refresh/Back/Forward、不合格 Product 显式提示、dependent selection、精确三字段 POST 与同 payload key 重用/冲突换 key、pending 防重、结构化错误、DirtyGuard、响应 ID Detail 导航、四档宽度及焦点。严格 fixture 拒绝未声明 API 并审计浏览器错误。
- P08 本轮隔离真实栈 Flow A 已另外证明 Product approved fact handoff → 真正创建 ContentTask → Detail。全套 Content 真实闭环仍留 C08。下一步 C03 任务详情。
