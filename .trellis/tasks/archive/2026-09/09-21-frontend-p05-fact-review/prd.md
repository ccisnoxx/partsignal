# P05 事实审核

## Goal

验收 `/products/$productId/facts/review` 的单一审核上下文、只读快照/Diff/历史、服务端审核动作和冲突边界。

## Requirements

- 前置 P04/F06 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 3.5 节、`08-testing-quality-and-acceptance.md` Phase 2.6、`contracts/openapi.yaml` 的 ProductFactReviewWorkspace 与 FactVersion 命令。
- 首屏只请求一个 product-scoped review context；服务端提供目标事实版本、Diff 和目标专属 review history。页面只读显示不可变 Markdown，不调用 Product Detail/Facts/版本列表拼接。
- 只有 `available_actions` 决定 `APPROVE`、`REQUEST_CHANGES` 入口；命令带 CSRF 与 expected revision，退回意见非空；成功使用 canonical FactVersion 并刷新 context，409 显示 request ID 且不自动重放。
- 生产预览严格 fixture 覆盖 direct/refresh、状态和错误、键盘/Dialog 焦点、375/768/1024/1440 与浏览器运行错误审计；不把 fixture 当真实业务闭环。

## Acceptance Criteria

- [x] model/组件测试覆盖只读投影、动作 token、命令与错误。
- [x] 生产预览浏览器测试覆盖单一 context、不可变快照、动作、409、错误、焦点与四档宽度。
- [x] 记录实际代码、证据、残余风险和 P07/P08 下一步。

## Scope

拥有 Fact Review 页面/model 与直接测试；不扩展服务端权限合同。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：Fact Review 页面/model/API 与现行蓝图和 OpenAPI 一致，本项未改生产代码或测试。P05 PRD 为本轮新增验收记录。
- `fact-review.model.test.ts` 与 `fact-review-page.test.tsx`：2 files / 12 tests 全通过。覆盖只读投影、服务端动作、批准/退回、非空意见、CSRF/revision、错误映射和焦点行为。
- 当前候选生产构建预览 `fact-review.spec.ts`：两个 Playwright project 共 10/10 通过。覆盖单一 context、不可变 Markdown、服务端 Diff/目标版本历史、APPROVE/REQUEST_CHANGES、409 不重放、loading/empty/404/403/retry、375/768/1024/1440 页面根无横向溢出，以及 Dialog 键盘与焦点。严格 fixture 拒绝未声明 API 并审计浏览器错误。P06 本轮已通过 typecheck/lint，P05 无代码变化，复用静态检查证据。
- fixture 只证明前端消费合同；真实服务端权限、事实版本不可变与跨服务闭环留 P08。下一步 P07 单版本只读详情，然后 P08 真实 Product Facts 流程。
