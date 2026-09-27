# L7 设计边界

## 根因

auth-session A→B→A 用例用 page route 把真实产品 POST response 持有在 `releaseProduct.promise`，以便在 response settle 前切换 principal。当前编排却先 `await` 触发该命令的按钮 `click()`，再等待 `productAccepted` 并创建 page B。完整门禁本次运行中，Playwright 的 click action 一直等待仍被 route 持有的提交链完成；route 又等待测试后续才会释放的 gate，形成循环等待。服务端 POST 201 与“创建中…”页面快照共同证明命令已接受但客户端 response 未 settle。

## 所有权

修复属于 `frontend/tests/e2e/auth-session-real-stack.spec.ts` 的动作触发/response 释放所有权。应让触发 click 与服务端 accepted gate 可以并行推进，并在受控时点观察、释放和等待各自 promise；不能改变应用 product mutation、认证状态机或后端权限。

## 不变量

- 产品 POST 仍恰好一次，真实服务端返回 201；不能通过第二次点击、reload 或直接 API mutation 绕开。
- A→B→A 三个 session binding 必须彼此不同；旧 A continuation settle 后不得导航到 created product。
- runtime audit 继续精确验证四个非幂等流量元组，console/page/request failure 仍为零。
- 清理中的 cookie secret 注册不能掩盖测试主体的首个失败；如需调整，仅能保留 secret scan 和 context 生命周期合同，不可吞错。
- L6 system-admin response completion gate 与 L5 产品逻辑保持冻结。
