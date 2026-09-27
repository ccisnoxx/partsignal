# L6 下一恢复点

1. 从 `70add985a05844d650c220da279d9ddf1a2644fa` 恢复，不修改 L5 AuthProvider 实现。
2. 在 `frontend/tests/e2e/system-admin-real-stack.spec.ts:664-717` 为 owner 与 observer 预先安装各自的 canonical
   recovery 401 completion gate；触发 bulk response loss 后，等待两个 response 真正 settle，再读取 runtime audit。
3. 保留 route/login/cache、POST once、attempt/response、durable marker、no-storm 与 secret 断言；不得用 sleep、轮询、
   重复 POST 或放宽计数。
4. 定向运行 system-admin real-stack、相关 runtime audit unit、secret scan、diff check，并确认资源归零。
5. 形成新 fixed candidate；在新的 `/Users/sc/...` detached checkout 中先通过 26/26 bind sentinel，再执行唯一一次
   `make verify`。不得重跑 `70add985` 的门禁。
6. 只有新门禁绿色、资源归零、代码冻结后才派发 fresh `critical_reviewer`；NO BLOCKER 后再关闭全部 I03 阻断链。

本会话因单次完整门禁失败到此停止，不实施上述修复，不创建 I04。
