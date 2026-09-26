# L1 设计：发送页本地 owner barrier 与 bulk 未知结果

## 所有权边界

`AuthProvider` 继续唯一拥有认证快照、principal epoch、transition marker、跨标签页通知和 canonical
reconciliation。业务页面只能把受控 side effect 作为回调交给 provider，不得自己写 marker、广播、
清全局缓存或拼接 session。

本地 owner 写入 `STARTED` 后必须同步进入和远端页面相同的 fail-closed 状态，但不能通过现有“远端
transition 到达”路径直接 abort 自己的 owner controller。实现应提供显式 owned-barrier entrance：

1. side effect 前推进本地 transition/principal epoch 并关闭旧窗口；
2. 清除非 auth QueryCache；route user 在 barrier 期间视为匿名，但 canonical session cache 不被临时
   UI 状态破坏，冻结受保护路由和新业务命令；
3. 仅把不可转交的 owner capability 传给当前受控 side effect；
4. 合法 snapshot commit、未知结果 reconciliation 与 durable `SETTLED` 完成前不重开窗口。

UI disabled 不是安全边界。imperative mutation/query owner 必须在网络发送前读取同一 barrier/epoch，
因此 `STARTED` 后的新管理员命令即使由旧 callback 直接触发也发送 `0` 个请求。

## Bulk 未知结果分类

bulk status 命令在目标集合包含当前 actor 时分三类：

1. 结构化成功且 `succeeded` 精确包含 actor：走现有 principal boundary terminal；
2. 结构化成功/失败明确证明 actor 未成功：不得触发自身份 transition；
3. 请求已发出但 transport、abort 或响应解析导致 actor 结果未知：进入 provider-owned unknown-result
   reconciliation，保持 fail-closed 并恰好读取一次 canonical session。

该分类不得根据普通异常文本猜测提交状态。页面只传递“请求包含 current actor”及受控命令结果；最终
auth 状态仍只来自 `/api/v1/auth/session`。

## 验证边界

- Provider/identity 单元测试固定 phase、method、path、status 和请求次数，分别证明 owner command、被阻止
  的第二命令以及 canonical recovery。
- Provider + 真实 QueryClient 的确定性交错持有第一个 owner 请求，在 `STARTED` 后从同一发送页尝试第二
  mutation、受保护 route user 与业务 query，断言网络为零，再释放首请求；BrowserContext 双页面测试
  负责验证真实 self 权限命令与 response-loss 终态。
- bulk self-disable response-loss 使用真实后端提交和受控断连；不得用 synthetic 401、focus refetch、
  reload 或 TTL 代替 unknown-result reconciliation。
- durable marker fault、secret scan、隔离数据库/Redis、端口与临时目录清理继续作为阻断门禁。
