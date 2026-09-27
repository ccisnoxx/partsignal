# L7 下一恢复点

1. 从 fixed candidate `d0f985cf09b663f928e5e0566b1ca84401248de9` 恢复；不得修改 L6 的
   `system-admin-real-stack.spec.ts` response completion gate 或任何 L5 产品实现。
2. 在 `frontend/tests/e2e/auth-session-real-stack.spec.ts:135-159` 重排触发所有权，使 click 的未完成状态不阻止
   `productAccepted`、page B 登录和后续受控 `releaseProduct`；不得重复 POST 或用 timeout/sleep 猜测。
3. 保留 `:194-248` 的 old response、旧 continuation、session binding 与精确 runtime traffic 断言。
4. 单独调查并处理 `:249-252` 超时后 cleanup 二次错误是否会掩盖首个失败；不得削弱 secret artifact 注册。
5. 运行相关定向 auth-session real-stack、runtime audit/secret scan、diff check 并确认资源归零。
6. 形成新的 fixed candidate；在新的 `/Users/sc/...` detached checkout 中先通过 26/26 sentinel，再执行唯一一次
   `make verify`。不得重跑 `d0f985cf` 的完整门禁。
7. 只有新门禁绿色、资源归零、代码冻结后才派发 fresh `critical_reviewer`；NO BLOCKER 后再关闭全部 I03 阻断链。

本会话因新的唯一完整门禁失败到此停止，不实施 L7 修复，不创建 I04。

## 本会话实施与定向验证

1. 产品创建 `click()` 不再在 `productAccepted` 前被 await；测试保存 `pendingProductClick`，
   依次等待真实服务端接受、B 登录、A replacement 登录，然后释放 product response 并
   等待 old response、route fulfill 与 click settle。
2. A→B→A 定向真实栈 `1 passed`；真实产品 POST `201` 且 attempt/response `1/1`，
   三个 session binding 仍互不相同，旧 continuation 不导航，runtime error 与 secret artifact 为零。
3. 冻结的 L6 System Admin 定向用例 `1 passed`，runtime audit `13/13`，两次真实栈 secret scan 均 clean；
   定向前后资源快照逐字一致且所有受控资源为 0。
4. L7 diff 只有 `auth-session-real-stack.spec.ts` 的 promise 编排与本任务记录；L6 gate、
   L5 产品逻辑、AuthProvider、UserListPage、后端权限、session helper 与 runtime audit 均未修改。
5. 下一步是形成新 fixed candidate，再从该 commit 创建全新 `/Users/sc/...` detached checkout；
   先执行 26/26 bind sentinel，再且仅一次执行 `make verify`。
