# I03 L8 Blocker authPrincipalBoundary 离线暂停用户 mutation 跨 epoch 发网

## Goal

修复 fresh 高风险复核确认的发布阻断：页面级 Users mutations 使用 `meta.authPrincipalBoundary` 时，
全局 MutationCache 在离线 pause 之前没有绑定发起 principal continuation，命令可在角色 ABA 和 principal
epoch 变化后恢复并真正发出旧管理员写请求。

## Requirements

- 区分 AuthProvider 内部允许跨 epoch 完成 canonical reconciliation 的特殊 mutation 与页面级权限 mutation；
  不得继续让两者共享会跳过 principal continuation 捕获的模糊 meta 语义。
- Users 单行命令、bulk 命令与 edit 命令必须在进入 TanStack Query pause/retry 点之前捕获发起 principal
  continuation，并在每次 mutationFn 执行、retry 和发网之前调用 `assertCurrent()`。
- 角色 ADMIN→ENGINEER→ADMIN 的 same-session ABA、离线暂停与恢复、retry 均不得令旧命令调用 API；
  不能只阻止成功回调或 cache 写回。
- 保留 L5 result-known reconciliation、L6 双页 response completion gate 与 L7 A→B→A response release
  编排；不得修改后端权限语义或以 session 撤销、401/403、UI 隐藏代替 pre-send fence。
- 增加稳定的单行、bulk、edit 离线暂停与 retry 反例，精确断言 principal epoch 变化后 API mutation
  function 调用次数为零；同时回归 AuthProvider 内部 terminal reconciliation。
- 修复后形成新的固定候选，重新执行定向验证、全新 `/Users/sc/...` detached checkout 的 26/26 sentinel
  与唯一一次完整 `make verify`，资源归零后再安排 fresh `critical_reviewer`。

## Acceptance Criteria

- [x] 页面级 principal commands 在 pause 之前稳定绑定发起 principal continuation。
- [x] 单行、bulk、edit 命令在 principal epoch/角色 ABA 后恢复时均在发网前显式拒绝，API 调用为零。
- [x] AuthProvider 内部跨 epoch canonical reconciliation 仍可完成，且 meta 所有权不再与页面命令混用。
- [x] L5/L6/L7 定向回归、类型/静态检查、secret scan 与资源清理通过。
- [ ] 新候选唯一完整门禁通过且 fresh 高风险复核为 `NO BLOCKER`；之后才允许关闭 I03 阻断链。

## Trigger evidence

- 触发候选：commit `731cc728df3611d34357de3a189319aaf116e679`，tree
  `30565e93b0c70ea4e74a9301feb20a228cff701a`；总体基线
  `9100774b0e124d1d834f8c726cf85f2c0e171e5e`。
- 候选唯一完整 `make verify` 退出 `0`；日志
  `/tmp/partsignal-i03-l7-731cc728-make-verify.log`，253,113 bytes，SHA-256
  `5ad14c045cb1baf733ac825931b7054520db6093ee402ccd216ffb5661506801`。
- pre/post resource snapshot 逐字一致，均为 4,140 bytes，SHA-256
  `353c7f5e73c01e9242ab0a240ba49088754638597bf00ef52f6a90a394ae9fad`；全部受控资源为 `0`。
- fresh review audit id：
  `20260927T044820Z-i03-l7-fixed-candidate-fresh-high-risk-review-a92785f6`，最终结论 `BLOCKER`。
- 关键位置：`frontend/src/app/query-client.ts:98,153-157`、
  `frontend/src/domains/identity/user-list-page.tsx:212-256,893-905`；验证缺口在
  `frontend/src/app/query-client.test.ts:140` 附近。
- 红测先证明旧 meta 在离线 ABA 后调用 mutation/API：QueryClient `2` 个反例失败，
  Users 单行/bulk/edit `3` 个反例分别真正调用 PATCH/POST/PATCH 一次。

## L8 实现与定向证据

- Query 认证收敛使用 `authSessionReconciliation`；只有 AuthProvider logout 使用
  `authProviderReconciliationOwner`；Users 单行、bulk、edit 使用 `authPrincipalCommand`。
  页面 meta 不跳过 MutationCache enqueue continuation，`PrincipalMutation` 每次执行/retry 均在
  API 前检查同一发起 epoch。
- 定向 Vitest `3 files / 121 tests` 通过；新测试精确证明 single/bulk/edit 的
  API 调用为 `0`，bulk 不进入 unknown reconciliation，不失效 Users cache 或清理
  selection。日志 `/tmp/partsignal-i03-l8-auth-unit-component-r2.log`，423 bytes，SHA-256
  `ada290111d0bb575faa781eda50131f63486856b37ef529f9e35e6440fdf5af9`。
- frontend TypeScript 退出 `0`；受影响文件 ESLint 退出 `0`。System Admin L5/L6 用例
  `1 passed`，日志 33,948 bytes，SHA-256
  `8bab42e03b1c0263674ba0dd960fa48ade3b67acc073b4d230ac6acdacc65f50`；Auth Session L7
  A→B→A 用例 `1 passed`，日志 29,325 bytes，SHA-256
  `df5b43097bbe82ee490eea57831c1b31f7c030bdb9c92e6e0be07b9d840e4ee2`。两次 secret scan 均 clean。
- 实施前后资源快照各 4,028 bytes、逐字一致，SHA-256
  `a693567498b7f23396c373fb90461afdb0fd9c140dbee7e9d02a35bbd413d8c2`；四端口、Redis DB 14、
  `partsignal_e2e_%`、受控临时资源与测试容器全部为 `0`。
