# I03 L7 Blocker auth-session A→B→A 真实栈产品响应释放死锁

## Goal

修复新 L6 fixed candidate 的唯一完整门禁中，既有 auth-session A→B→A 真实栈用例在产品 POST 已被服务端接受后仍阻塞于 `click()`，直到测试超时的问题。

## Requirements

- 本 blocker 只拥有 `frontend/tests/e2e/auth-session-real-stack.spec.ts` 的确定性测试编排及必要的测试观测；不得修改 L6 response completion gate、L5 产品逻辑、AuthProvider、UserListPage 或后端权限语义。
- 保留真实服务端产品 POST 恰好一次、A→B→A session binding、旧 continuation 不导航到已创建产品、runtime traffic 精确计数、secret scan 与资源清理合同。
- 触发产品 POST 后必须能在不依赖被拦截 response settle 的情况下证明服务端已接受命令，再完成 B 登录、A replacement 登录与旧 response 的受控释放。
- 不用 sleep、任意 timeout、轮询、重复 POST、reload 或放宽精确计数规避死锁。
- 修复后形成新的 fixed candidate；在新的 `/Users/sc/...` detached checkout 中先通过 26/26 bind sentinel，再且仅一次运行 `make verify`。

## Acceptance Criteria

- [x] A→B→A 用例不再让 `page.click()` 与 route `releaseProduct` 形成循环等待。
- [x] 产品 POST attempt/response 仍精确为 1/1，真实服务端 201 被证明，旧 continuation 不执行导航。
- [x] L6 system-admin response-loss 与 stale exact-success 场景继续通过，L5 产品代码保持冻结。
- [ ] 新候选唯一完整 `make verify` 通过，secret scan clean，pre/post resource snapshot 逐字一致。
- [ ] 新门禁绿色、资源归零、代码冻结后才允许 fresh `critical_reviewer`；只有 `NO BLOCKER` 才关闭 L7/L6/L5 与 I03 阻断链。

## Confirmed gate evidence

- L6 fixed candidate `d0f985cf09b663f928e5e0566b1ca84401248de9`，tree
  `5f918935441eff622ce31c8539d689584c2090a3`，baseline
  `9100774b0e124d1d834f8c726cf85f2c0e171e5e`。
- 唯一完整门禁日志 `/tmp/partsignal-i03-l6-d0f985cf-make-verify.log`，status `2`，160,770 bytes，
  SHA-256 `ca8610d8e04b2c1ab326e720a5d13434ea2a77f4f9eced8cd8aa14517a5d2047`。
- 已通过：contract、lint、typecheck、backend unit `683`、frontend Vitest `91 files / 841 tests`、
  PostgreSQL integration `337`、production frontend/backend Docker build；real-stack 为 `20 passed / 1 failed`，
  secret scan clean。后续 fixture E2E、deploy/lifecycle 脚本与最终 Compose 门禁因 `make e2e` 失败未执行。
- 失败用例 `frontend/tests/e2e/auth-session-real-stack.spec.ts:101`。服务端日志已记录一次产品 POST `201`，
  error context 页面仍停在 `/products/new` 且按钮为“创建中…”。代码在 `:135-152` 的 route handler 等待
  `releaseProduct.promise`，而 `:158` 先 `await click()`，直到 `:198` 才释放 response，形成可见的等待环。
- 超时后的 `finally` 在 `:251` 调用 `registerCurrentRealStackCookies()` 时 BrowserContext 已被测试 runner 关闭，
  因而又产生 `Storage.getCookies` 协议错误；这是超时后的二次错误，不是最初阻塞点。
- error context `/tmp/partsignal-i03-l6-d0f985cf-auth-session-error-context.md`，5,860 bytes，SHA-256
  `fcd5b6dcf3d92d69384a41f85557180ccd646c583b736443c1924a2d8fa9017d`。
- resource pre/post snapshot 各 4,140 bytes、逐字一致，SHA-256
  `31af6c044228e3086e0456129f5c7b05930535dee107c34e46430e9db3ca45d8`；四端口、Redis DB 14、
  `partsignal_e2e_%`、临时资源与测试容器均为 0，validation checkout 已移除并 prune。
- 本会话不修复 L7、不重跑完整门禁、不派发 fresh review、不创建 I04。

## L7 implementation and targeted evidence

- `auth-session-real-stack.spec.ts` 只将创建产品的 `click()` 保存为未完成 promise；先等待
  `productAccepted`，完成 B 登录与 replacement A 登录，再释放旧 response，最后等待旧
  click/response settle。没有重复点击、reload、直接 API mutation、sleep、轮询或计数放宽。
- A→B→A 定向真实栈 `1 passed`；日志 `/tmp/partsignal-i03-l7-auth-session-targeted.log`，
  28,861 bytes，SHA-256 `ee8aa97eeb0bb61b09027e93d5efb274e3a0be40f29c1b7c61fa7298351f0cac`，
  status `0`。服务端只观察到一次 `POST /api/v1/products` `201`；四个非幂等流量元组精确匹配，
  旧 continuation 没有导航到已创建产品，secret scan clean。
- L6 System Admin 定向场景 `1 passed`（用例内同时覆盖 response-loss 与 stale exact-success）；
  日志 `/tmp/partsignal-i03-l7-system-admin-targeted.log`，33,941 bytes，SHA-256
  `7e27b209f9cd6b400b8e913ad4587782944c98acdc91a0774409319c17d62870`，status `0`，secret scan clean。
  `system-admin-real-stack.spec.ts`、AuthProvider、UserListPage 与后端均无 L7 diff。
- runtime audit unit `1 file / 13 tests`，status `0`；日志
  `/tmp/partsignal-i03-l7-runtime-audit-unit.log`，353 bytes，SHA-256
  `2635a94f4d1ab25f382904db4e8510900c8e79febbbe1b85b48fc5f9f9643678`。
- 定向运行前后资源快照各 4,140 bytes、逐字一致，SHA-256
  `7970731c9d53c924dcc869108491b7e5836d2206234443fc4bd85723a8e35799`；四端口、Redis DB 14、
  `partsignal_e2e_%`、临时目录与测试容器均为 0。`git diff --check` 通过。
- 时间顺序修复后 finally 的 cookie secret 登记正常完成；不再有关闭 context 上的
  `Storage.getCookies` 二次错误。没有证据支持修改 secret 注册或吞掉 cleanup 错误，因此 helper 保持不变。
