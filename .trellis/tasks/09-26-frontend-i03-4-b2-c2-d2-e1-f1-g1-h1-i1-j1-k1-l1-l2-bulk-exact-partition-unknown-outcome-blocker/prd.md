# I03-4-B2-C2-D2-E1-F1-G1-H1-I1-J1-K1-L1-L2 Blocker bulk 响应精确分区与畸形信封未知结果收敛

## Goal

修复 fixed candidate 3513db0968af4dd522ae62d2a7feb385055baa3f 的 fresh critical review 确认的 P1：bulk current-actor 对 shape-valid 但语义不完整的 200 及 malformed 4xx 误判为明确未变更；补精确一一分区、严格 ErrorEnvelope 与 canonical unknown-result reconciliation 后，形成新候选并重新执行全新 detached checkout 单次完整门禁及 fresh critical review。

## Requirements

- `bulkUpdateUserStatus()` 必须根据原始请求 `items` 和目标 `status` 严格验证 HTTP 200 结果：每个请求
  `user_id` 必须且只能出现在 `succeeded` 或 `failures` 一次，不允许遗漏、重复、交叉或外来 ID；每个
  success 的 `is_active` 必须与请求目标一致。
- current actor 精确出现在 `succeeded` 时进入既有受控 principal boundary；精确出现在 `failures` 时
  是 explicit failure，不触发 boundary；其他无法证明的语义不完整或畸形结果必须抛专用 unknown outcome，
  由 AuthProvider-owned canonical reconciliation 收敛，且不得重发 bulk POST。
- 4xx `ErrorEnvelope` 必须按 OpenAPI 严格解析，至少要求 `code`、`message`、`request_id`、`details`，并
  拒绝合同外结构；不能严格证明为命令前明确失败时必须归入 unknown。
- 保留 L1 已通过的本地 owner barrier、QueryClient query/mutation/retry/offline resume 防线、路由
  fail-closed、durable marker/lease、两页 canonical recovery、marker fault、secret scan 和资源清理。
- 不修改后端权限合同，不把 malformed 响应当成功，不重放具有未知提交结果的 POST。

## Acceptance Criteria

- [x] shape-valid 但有遗漏、重复、交叉、外来 ID 或成功状态错误的 200 均被分类为 unknown；current actor
      精确失败仍不触发 principal boundary。
- [x] 缺少 `details` 或含合同外结构的 malformed 4xx 不会被误判为 explicit failure。
- [x] 回归测试证明 bulk POST 恰好一次，current-actor unknown 恰好一次调用 Provider reconciliation，
      每页 canonical session recovery 次数保持合同值，无请求风暴和旧 ADMIN route/cache/continuation 恢复。
- [ ] 定向 Vitest、TypeScript、ESLint、真实栈 BrowserContext 与资源清理通过，形成新的 fixed candidate
      commit/tree。
- [ ] 在新的 `/Users/sc/...` detached checkout 中 bootstrap，通过 26/26 bind sentinel，清理并确认资源
      归零后只运行一次完整 `make verify`；退出 `0`、identity/工作区不漂移、资源再次归零。
- [ ] fresh `critical_reviewer` 给出 `NO BLOCKER`；否则继续在首次远程写入前停止。

## Notes

- 阻断 fixed candidate：commit `3513db0968af4dd522ae62d2a7feb385055baa3f`，tree
  `997e4973d1927fd28dacc05c570a7ebfa71138c9`。
- 阻断位置：`frontend/src/domains/identity/user.api.ts:179,195,253`；
  `frontend/src/domains/identity/user-list-page.tsx:251,269`。
- 固定门禁本身可信：唯一 `make verify` 退出 `0`；日志 SHA-256
  `d9a148266f99a8a2d2804a8d50dac1dc7790ac3ae4769e03f987abc6f9b760b3`；pre/post 资源日志
  SHA-256 均为 `d65efb68838d0510e8da8ac32c35006d2370e934fd006de17b7e226ce839294d`，资源归零。
- reviewer audit id：`20260926T145246Z-i03-l1-auth-owner-barrier-implementation-cc18ecda`。
- I03 与全部上游任务保持 `in_progress`；I04 未创建；没有 fetch、push、SSH 或 Hostdzire 写入。
- L2 定向实现已通过 `4 files / 114 tests` Vitest、TypeScript、ESLint、contract/generated check 与
  `system-admin-real-stack.spec.ts` `2 passed`；真实栈 secret scan clean，运行前后资源快照逐字一致且全部为零。
