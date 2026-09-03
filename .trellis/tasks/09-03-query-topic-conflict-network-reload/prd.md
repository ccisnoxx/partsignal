# Query Topic 409 显式重载网络新鲜度

## Goal

关闭 Query Topic 编辑与删除在 `409 REVISION_CONFLICT` 后的 P1 一致性缺口：用户点击“重新读取规范版本”时，只能用该次点击之后新发起的 `/api/v1/query-topics` 请求的成功响应解除冲突冻结，不能把 30 秒内的 fresh cache 或点击前已在途响应误判为重新读取成功。

## Background

- `queryTopicsQueryOptions()` 对完整 Query Topic options 设置 `staleTime: 30_000`（`frontend/src/domains/geo/geo.api.ts:141`）。这个缓存服务于普通 options 消费者，本身不是缺陷。
- 编辑与删除 Dialog 的 `reloadCanonical()` 当前都直接调用 `queryClient.fetchQuery(queryTopicsQueryOptions())`（`frontend/src/domains/geo/query-topic-list-page.tsx:518`、`:699`）。TanStack Query 可以在数据仍 fresh 时直接返回缓存，也可以复用同 key 的在途请求。
- 因此显式 reload 可能没有发起点击后的新 GET，却清除 `409`、采纳旧 revision 并重新启用保存或删除。这违反“服务端为最终权威；冲突后只允许显式重新读取恢复，且 mutation 不自动重放”的既定合同。
- 当前 E2E 只验证第一次 cache miss 的 reload，未预热相同 options query，无法暴露该问题。

## Requirements

- 编辑 PATCH 与删除 DELETE 两个 `409` 恢复入口必须共享同一条、局部且明确的网络新鲜度语义。
- 每次用户点击显式 reload 后，必须取消 exact options query key 上点击前的在途请求，并以 `staleTime: 0` 发起一次新的 `/api/v1/query-topics` GET；只有该请求成功返回的数据可作为本次恢复依据。
- 成功读取后，编辑 Dialog 才可用服务端 canonical 字段和 revision 重置表单、清除冲突错误与 request ID、恢复保存能力。
- 成功读取后，删除 Dialog 才可采用服务端 revision 并解除冲突冻结；目标已不存在或服务端不再提供 `DELETE` 时，继续沿用当前显式提示与禁止删除语义。
- 新 GET 失败时，不得使用已有缓存作为成功结果；编辑草稿、原始冲突信息与 request ID 必须保留，保存/删除继续禁用，且不得发送新的 PATCH/DELETE。
- reload 本身以及 reload 失败后的任何自动流程都不得重放 mutation；后续 PATCH/DELETE 只能由用户再次明确提交或确认触发。
- 保留 `queryTopicsQueryOptions()` 的全局 `staleTime: 30_000`，不得为了本修复改变其他 options 消费者的缓存策略。
- 使用现有 query key、query function、错误映射和 Dialog 状态 owner；不得引入第二 API 实现、额外全局状态、nonce query key、cache-busting 参数、缓存清空、轮询、重试循环、allowlist 或隐藏 fallback。
- 回归测试必须先预热完整 options cache，并分别证明编辑与删除显式 reload 在 cache fresh 时仍发起新 GET；至少一个路径还要证明 GET 失败不会被旧缓存伪装为成功。

## Scope

### In Scope

- `frontend/src/domains/geo/query-topic-list-page.tsx` 中 Query Topic 编辑/删除冲突恢复的共享网络读取边界。
- `frontend/tests/e2e/fixtures/geo-topics.fixture.ts` 中完整 options GET 的请求计数与可控失败注入。
- `frontend/tests/e2e/geo-topics.spec.ts` 中编辑、删除 409 恢复的 fresh-cache 回归覆盖。

### Out of Scope

- backend、`contracts/openapi.yaml`、generated client、数据库合同和业务状态转换。
- `/api/v1/query-topics/list-items` 的分页列表读取、全局 options 缓存时长和普通窗口聚焦刷新行为。
- Dialog 打开后 target row snapshot 不随列表更新的问题；该问题属于独立的 `query-topic-dialog-live-projection`。
- 统一 error domain mapping；本 Task 不创建或启动 `integrity-error-domain-mapping`。
- 自动 merge、mutation 自动重试、冲突覆盖写或新增后端 detail endpoint。

## Acceptance Criteria

- [x] AC1：编辑 PATCH 返回 `409` 后，即使完整 options query 在 30 秒 fresh window 内，点击“重新读取规范版本”仍产生一次新的 `/api/v1/query-topics` GET，并且采纳该请求返回的 canonical 字段与 revision。
- [x] AC2：删除 DELETE 返回 `409` 后，即使完整 options query 仍 fresh，点击显式 reload 仍产生一次新的 GET；只有成功响应提供的最新 revision 才能重新启用“确认删除”。
- [x] AC3：点击前 exact options query 若仍在途，恢复流程不会把该旧请求的结果作为成功；本次可采纳结果来自点击后重新发起的请求。
- [x] AC4：显式 GET 失败时，旧 cache 不会解除冲突；编辑草稿、`409` 提示/request ID 和动作禁用状态保持，且 PATCH/DELETE 请求数不增加。
- [x] AC5：显式 GET 成功前后均不自动重放 PATCH/DELETE；恢复成功后仍需用户再次提交/确认，并使用新 revision。
- [x] AC6：目标不存在或服务端已移除 `DELETE` 时保持现有显式提示和服务端最终权威，不以缓存或本地快照恢复动作资格。
- [x] AC7：`queryTopicsQueryOptions()` 的默认 30 秒缓存、OpenAPI、generated client、backend、数据库合同及既定业务 HTTP 行为均无变更。
- [x] AC8：generated-type 严格 fixture 会记录完整 options GET，未声明 API 仍显式失败；编辑与删除回归在 mobile/desktop Playwright project 均通过。
- [x] AC9：frontend lint、typecheck、`api:check`、Task validate 与 task-scope trailing-whitespace 检查通过；可选全量 suites 若未运行，必须记录为 `NOT_RUN` 而非通过。

## Notes

- 本 Task 是已归档 Frontend V2 功能合同一致性基线发现的独立 P1 修复，不建立 parent 关系。
- 用户已批准并启动实施；当前候选已完成代码、回归与独立检查，等待提交确认。
