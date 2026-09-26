# I03-4-B1 设计

- principal epoch 由 auth 模块按 `QueryClient` 持有，避免跨测试/多根共享；首次从 auth cache 初始化，后续仅在 `authBoundaryIdentity` 改变时递增。
- AuthProvider 统一经过一个 principal boundary 提交函数：先递增 epoch，再移除非 auth query，最后写入新 auth session。认证 transition epoch 继续只处理认证命令互斥。
- canonical QueryClient 配置在 MutationCache `onMutate` 捕获 principal continuation；自定义 `PrincipalMutation.setOptions()` 同步包装每一次 options 写入，自定义 MutationCache 只创建该 Mutation，并在 retryer `canRun()` 后再触发一次守卫安装。因此即使 `MutationObserver.setOptions()` 发生在 `canRun()` 已放行、retryer 真正动态读取 `mutationFn` 之前，离线恢复与 paused retry 也不能把旧命令发给新主体。旧 completion 到达时先剥离 mutation options 的 success/error/settled callback，再拒绝旧 epoch；auth owner mutation通过 metadata 豁免。
- App Router 仅在用户 id/account type 变化时重建，确保另一用户/权限域切换卸载旧业务 subtree；同一用户的 must-change 等认证边界继续由现有 `router.invalidate()` 重裁决，避免丢失本地密码变更完成状态。
- AI Channel Workspace 的直接 PUT/POST/PATCH/DELETE 与手工 canonical handoff 在调用点捕获 continuation，并在每组同步副作用前重新核对；检查与 `setQueryData`、invalidate 启动、callback/navigation 或 success state 之间不 `await`。AI list 路由 callback 继续显式携带 continuation，覆盖 invalidate 后导航/删除投影。
- 所有异步 mutation callback、`mutateAsync` 工作流、绕过 MutationCache 的用户管理直接写入与三类多段文件上传，都在 owner 处复用同一 continuation；每个异步阶段返回后、下一项 cache/invalidate/navigation/callback/local-success 副作用前复核。生产唯一 per-call mutation callback 也在调用点显式守卫。
- 测试使用真实 deferred response 和真实 AuthProvider identity refresh，切换完成并清空业务 cache 后才 resolve 旧响应，再 flush React/promise continuation。
- 额外 deferred 反例让 HTTP 先成功并进入业务 callback，再在 callback 的第一个 await 期间推进 principal epoch；释放后断言后续 cache/invalidate/navigation/local-success 均不发生。
