# P04 事实工作区

## Goal

按前端重建清单验收 `/products/$productId/facts`：Markdown 唯一编辑源、revision 保存与提交、冲突保留、待审快照交接。

## Requirements

- 前置 P03/F06 已在本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 3.4 节、`05-business-actions-state-and-api-contract.md` 的 ProductFactsDraft、`08-testing-quality-and-acceptance.md` Phase 2.5，以及 `contracts/openapi.yaml` 的 ProductFactsDraft/Update/FactReviewSubmissionRequest。
- 页面只读取 ProductFactsDraft；不拼接 Product Detail 或 FactVersion，不创建 Evidence 或 Markdown 之外的事实编辑源。
- 保存与提交发送当前基线 `expected_revision` 和 CSRF。保存采用 canonical response；提交只接受已保存草稿，成功从服务端获得待审 FactVersion，刷新 workspace actions/摘要且留在本路由。
- 入口资格由服务端 `available_actions` 给出。409 保留本地草稿与 request ID，只有用户显式 reload 才放弃草稿；exact `FACT_REVIEW_PENDING` 为独立 blocker，不能重复 POST。DirtyGuard 保护导航。
- 使用当前候选生产构建的严格 generated-type fixture 覆盖四档宽度和浏览器错误审计。前端 fixture 不声称验证 PostgreSQL 快照不可变。

## Acceptance Criteria

- [x] 组件/model 测试证明保存、提交、错误恢复和只读动作边界。
- [x] 生产预览浏览器测试证明单一 read model、canonical save/submit、冲突/DirtyGuard/键盘/响应式。
- [x] 记录实际代码、测试证据、未覆盖项与后续 P05/P08。

## Scope

拥有 Fact Workspace 页面/model 与直接测试；发现共享合同问题另行协调。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：本项未修改生产页面、model、API 或 fixture；现有实现已使用单一 ProductFactsDraft read model、Markdown 编辑器、服务端动作 token 和 CSRF/revision 写入。P04 的验收 PRD 为本轮新增记录。
- `fact-workspace.model.test.ts` 与 `fact-workspace-page.test.tsx`：2 files / 23 tests 全通过。覆盖非空 Markdown、expected revision、action gating、save canonical、提交、exact pending blocker、500 fallback、迟到 refetch 不覆盖本地输入、DirtyGuard 与 RETIRED 只读。
- 当前候选生产构建预览 `fact-workspace.spec.ts`：两个 Playwright project 共 12/12 通过。覆盖 direct/refresh 单一 read model、375/768/1024/1440 页面根无溢出、Ctrl/Cmd+S 的 CSRF/revision、save canonical、冲突保留与显式 reload、提交后刷新动作、loading/empty/error/retry、键盘焦点和 DirtyGuard。严格 fixture 拒绝未声明 API 并审计浏览器运行错误。
- 这些结果是本轮执行，不沿用历史 V2 门禁。浏览器 fixture 只验证前端合同；事实 snapshot 的 PostgreSQL 不可变性、服务端权限及锁内最终裁决留在真实栈和 backend integration 证据。下一步 P05 审核工作区；P08 真实 Product Facts 闭环须在 P05/P07 等页面交付后执行。
