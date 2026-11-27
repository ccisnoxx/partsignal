# L3 设计：canonical actor identity 与 acquire-failure barrier

## Identity 边界

把 UUID canonicalization 放在 current-actor 判定的共同所有者处，并让 bulk selection、API request/result 与
self-edit 使用同一 identity 表示。比较不能依赖服务端恰好回显与 session/user-list 相同的字母大小写。

共享 `canonicalUuidSchema` 负责先验证 UUID、再转换为小写；`AuthProvider` 拥有 session ingress，
`user.api.ts` 拥有 Users wire ingress/egress，页面 Props 入口再次固化 current actor 后只做 exact equality。

## Lock failure 边界

Web Lock 仍是跨标签页 owner capability 的必要条件；无法取得 owner 时不能执行 owner 命令，也不能伪造
transition commit。但 acquisition error 必须触发 AuthProvider 已有的 fail-closed 路径，使发送页立即撤销
旧 principal 可用性并保持 canonical recovery 所需的 durable 状态。恢复过程不得重发非幂等命令。

acquire fault 不写 durable marker，保留现有合法 marker 或缺失状态；无锁写 `STARTED/SETTLED` 会伪造 owner。
只有仍为 Provider 当前活动 channel 的 rejection 可以进入 fail-closed，卸载关闭旧 channel 导致的取消不得在
cleanup 后重新建立 QueryClient barrier。`locks.request()` 同步抛出也必须释放 pending request bookkeeping。

## 验证边界

用确定性单元测试分别覆盖 uppercase actor、缺失 LockManager、`request()` 同步/异步拒绝，以及已发出 bulk
response-loss 后 reconciliation 无法 acquire 的交错。断言网络次数、barrier/epoch/cache/route 状态、
reconciliation 次数和 durable 状态，而不是只断言错误文本。
