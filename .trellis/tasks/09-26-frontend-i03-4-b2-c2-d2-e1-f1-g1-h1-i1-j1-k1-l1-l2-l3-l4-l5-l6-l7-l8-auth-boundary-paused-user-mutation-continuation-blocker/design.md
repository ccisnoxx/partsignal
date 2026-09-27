# L8 设计边界

## 已确认根因

TanStack Query 会先调用全局 `MutationCache.onMutate`，再启动 retryer。当前 `query-client.ts` 对
`meta.authPrincipalBoundary === true` 直接返回，因此 mutation 若在离线状态 pause，尚未运行
`mutationFn` 就已失去“发起 principal”的稳定 continuation。Users 单行和 bulk 命令直到
`mutationFn` 开始才捕获 continuation；edit 虽较早捕获，但在发出 API 请求后才检查。角色 ABA 让 barrier
重新开放时，旧命令可能按新 epoch 继续或在检查前已经发网。

## 必须保持的不变量

1. 页面级权限 mutation 的 principal 身份在 enqueue/onMutate 时绑定，而不是 resume 时重新捕获。
2. continuation fence 必须在每次实际发网和 retry 之前执行；post-response 检查只能作为额外防线。
3. AuthProvider 内部 terminal/canonical reconciliation 的跨 epoch 权限是窄而明确的 owner，不与页面命令
   共用一个会跳过全局 guard 的 meta 标志。
4. 角色 ABA、offline resume 与 retry 后，旧 mutation 不调用 API、不写 cache、不 invalidate、不导航。
5. 服务端权限继续最终裁决，但客户端不能把短暂恢复的权限解释为旧用户意图仍有效。

## 非本任务主因的复核警告

- L7 超时后若 BrowserContext 已关闭，cookie secret 注册可能产生二次错误并覆盖主体异常；修复时必须保留
  正常路径 secret 注册失败的可见性，不能无条件吞错。
- SIGKILL 后 process-group disappearance 的布尔结果当前未被消费；这不会把失败门禁变绿，但会削弱
  post-run secret scan 的静止性证据。是否拆分后续 blocker 应在 L8 主因完成后另行评估。

## 已采用的所有权合同

1. `authSessionReconciliation` 只属于 AuthProvider canonical session query，不再同时表示
   mutation owner。
2. `authProviderReconciliationOwner` 是 AuthProvider terminal/canonical mutation 的窄范围豁免；
   production 中只有 AuthProvider logout 使用。
3. `authPrincipalCommand` 显式表示页面命令可由 Provider 合法提交新 epoch，但它不跳过
   enqueue/pre-send continuation。页面仍以 Provider 返回的 canonical continuation 守卫成功后副作用。
4. MutationCache 保持发起 continuation 的唯一 pre-send 所有权；Users mutationFn/submit 中的
   continuation 只防护 response 后 callback，不能在 offline resume 时重新授权旧命令。
