# Frontend V2 Fact Review 409 Revision E2E

## Goal

关闭 Fact Review stale revision 的 E2E 证据缺口：fixture 测试稳定证明 409 UI 行为，隔离 real-stack 测试证明旧 `expected_revision` 真实收到服务端 `409/REVISION_CONFLICT`、前端不自动重放，并在刷新后保留服务端最新 canonical 状态。

## Background

- Phase 7 独立 `make e2e` 诊断中，`fact-review.spec.ts` 的 mobile/desktop 场景实际发送 `expected_revision: 1`，仍断言 `0`，产生两个失败。
- `fact-review.spec.ts:118-128` 在页面加载后、确认 Dialog 打开前把 fixture workspace revision 改为 1；Fact Review query 使用 `refetchOnWindowFocus: always`，因此页面可能在命令前已采用 revision 1。该测试没有稳定制造 stale request。
- production `FactReviewPage` 始终从当前 query target 发送 revision，409/invalid transition 后只 refetch context；backend 在行锁内先比较 `expected_revision`，不匹配即返回 `REVISION_CONFLICT`。当前证据不要求修改 runtime、OpenAPI、数据库或权限合同。
- 已归档 Fact Review task 证明 fixture 409 UX；现有 Product Facts real-stack spec 证明成功批准、退回修订和 Content Editor 闭环，但没有浏览器 stale command → 真实 409 的场景。

## Requirements

1. 保持 backend、OpenAPI、Fact Review runtime、query key、mutation、权限与状态机不变；本任务只改测试、唯一 real-stack runner 的定向入口和对应 infra spec。
2. 修正现有 fixture 409 场景的编排顺序：页面先基于 revision 0 打开批准 Dialog，再把 fixture canonical context 更新为 revision 1，最后确认命令；不得放宽请求 body、request ID、refetch 或 UI canonical 断言。
3. 在现有 `product-facts-real-stack.spec.ts` 增加一个独立场景，复用 login、产品创建、事实保存/提交、列表和 review context helper；不新建 spec、fixture、route mock 或业务 helper framework。
4. real-stack 场景必须先让浏览器加载 revision 0，再通过真实 API 执行一次窄的并发 `REQUEST_CHANGES` 前置，使服务端状态成为 `CHANGES_REQUESTED/revision 1`；该 API mutation 只用于制造另一个写入者，不复制服务端状态判断或成为第二套业务 flow。
5. 浏览器随后以旧 revision 0 发送一次且仅一次 APPROVE；测试必须断言真实 HTTP 409、`REVISION_CONFLICT`、返回 request ID、请求 body 与 CSRF，并证明没有自动重放。
6. 409 后页面必须 refetch canonical context，展示服务端最新状态、移除陈旧动作；最终真实 GET 必须证明 revision 1、`CHANGES_REQUESTED`、并发意见仍在 history 且没有 approve record。
7. 给现有 `deploy/scripts/e2e-local.sh` 增加一个可选的单 V2 real-stack spec 诊断变量；设置时仍复用同一独立 PostgreSQL/Redis/storage/process/cleanup owner，只运行目标 V2 spec，不构建或运行 V1，也不运行其他 V2 specs。变量未设置时 `make e2e` 的完整顺序和行为必须完全不变。
8. 新诊断变量及“定向模式不能替代完整 gate”的约束同步到 `.trellis/spec/infra/e2e-isolation.md`；不更新 `docs/frontend-v2/07`、`08` 的 Phase 7 状态。
9. 本 blocker 只运行 Fact Review fixture spec、Product Facts real-stack spec 和必要静态检查；完整 V2 E2E、`make e2e` 与 `make verify` 留给 Phase 7 Exit Gate Recheck。

## Acceptance Criteria

- [x] fixture mobile/desktop 都稳定发送 `{ expected_revision: 0, comment: '' }`，仅一条 approve 请求，显示 fixture request ID 并刷新到 revision 1。
- [x] real-stack 场景从真实 revision 0 开始；并发 `REQUEST_CHANGES` 返回 canonical revision 1，随后 UI APPROVE 的真实响应为 `409/REVISION_CONFLICT`。
- [x] UI APPROVE 请求只出现一次，携带旧 revision 0 与现有 CSRF；没有自动 retry/replay。
- [x] 409 request ID 在 UI 可见；自动 refetch 后页面展示 `CHANGES_REQUESTED`/revision 1、无批准或退回动作。
- [x] 最终真实 review context 保留并发意见和 revision 1，history 不含 `approve`，不可变 FactVersion 正文未被改写。
- [x] 单-spec runner 设置诊断变量时只运行目标 V2 spec 并完成现有精确 cleanup；变量未设置时默认完整命令清单不变。
- [x] Fact Review fixture spec、Product Facts real-stack spec、typecheck、受影响 TS ESLint、shell syntax、`git diff --check` 与 Trellis task validation 全部通过。
- [x] 无 runtime、backend、OpenAPI、数据库、权限、公共 API、旧 `frontend/`、新 orchestration 或 Phase 7 文档状态变更。

## Out of Scope

- 修改 Fact Review 产品 UX、自动 retry、cache strategy 或错误文案。
- 新增 backend conflict 行为、API endpoint、schema、migration 或权限逻辑。
- 为所有 real-stack tests 创建通用 flow/framework，或拆出第二套数据库/process/cleanup 脚本。
- Platform Types 非管理员 E2E、Phase 7 Recheck、Phase 8、完整 `make e2e` 或 `make verify`。
- task archive、push、PR 或自动开始第四个 blocker。
