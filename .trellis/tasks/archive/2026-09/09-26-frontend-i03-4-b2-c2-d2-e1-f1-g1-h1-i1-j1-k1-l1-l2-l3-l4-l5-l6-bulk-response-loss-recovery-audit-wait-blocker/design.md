# L6 设计边界

## 根因

response-loss 子场景在 bulk POST 已由服务端提交但浏览器响应被 abort 后，两个页面都发出了 canonical
`/auth/session` GET；服务端日志也确认两个请求均返回 401。测试随后只等待 owner/observer 进入登录路由，再同步读取
`runtimeAudit.responses`。跨标签页 durable transition 可以先使另一个页面 fail-closed 并导航登录，因此“登录页已可见”
不能证明该页面自己的 Playwright `response` handler 已执行，形成观测竞态。

## 所有权

修复应放在 `system-admin-real-stack.spec.ts` 的 response-loss 场景，通过两个页面各自注册的精确
`waitForResponse`/completion gate 或等价确定性机制等待目标 GET 401 settle。通用 runtime audit 继续负责被动审计，
不为单一场景增加轮询、任意 sleep 或隐藏容错。

## 不变量

- 仍需精确断言 POST attempt=1、POST response=0、canonical GET attempt=2、401 response=2。
- 不能因为服务端日志已有两个 401 就跳过浏览器 response 证明；也不能把断言放宽为至少一次。
- response completion gate 必须在触发 bulk 之前安装，避免再次引入监听窗口。
- 不改 AuthProvider/UserListPage、后端权限、业务 cache 或状态机；L5 candidate 行为保持冻结。
- 门禁失败后只形成新候选再运行新的单次完整门禁，不重跑 `70add985`。

## 新门禁结论

L6 response completion 所有权已按上述设计实现，定向 System Admin 与完整门禁中的 System Admin 两项均通过。
新的唯一完整门禁被另一个既有 auth-session 真实栈用例阻断：产品 POST response 由 route gate 持有，而测试先
`await click()`，导致无法推进到后续 `releaseProduct`。该问题不属于 L6 response audit 或 L5 产品合同，已由
L7 只读恢复记录承接；L6 实现保持冻结。
