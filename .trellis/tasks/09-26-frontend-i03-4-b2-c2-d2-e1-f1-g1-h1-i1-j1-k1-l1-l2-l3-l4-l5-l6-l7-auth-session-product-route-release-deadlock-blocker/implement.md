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
