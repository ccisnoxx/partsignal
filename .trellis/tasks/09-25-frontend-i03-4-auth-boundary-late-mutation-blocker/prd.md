# I03-4 Blocker 身份边界迟到 mutation 缓存回写

## Goal

修复旧身份下已发出的业务 mutation 在身份切换后迟到成功并重新写回共享 QueryCache 的权限边界并发缺口。

## Requirements

- 以 `frontend/src/app/auth/auth-provider.tsx` 的 `authBoundaryIdentity` 与身份切换缓存隔离合同为权威边界；旧主体发起的异步请求在身份 epoch 变化后不得执行任何业务 cache 写入、invalidate、导航或成功回调。
- 覆盖 API Key 替换、配置保存及其他 `mutateAsync`/直接 API 请求完成后手工采用 canonical response 的路径，不只局部修复一个 Dialog。
- 身份变化可以 abort 可取消请求，但不能只依赖 abort；服务端可能已经提交，客户端仍须以单调认证主体 epoch 拒绝迟到 continuation。
- 保留服务端权限裁决、revision/409 语义、canonical response 采用和现有 Query owner；不得用静默 fallback、吞错或只隐藏页面替代缓存边界。
- 修复完成后重新建立 clean candidate 并执行受影响测试、完整门禁、资源清理与 fresh 独立高风险复核；旧 I03-4 绿色日志不能外推到修改后的候选。
- 不进入 I04，不执行发布或远端部署。

## Acceptance Criteria

- [ ] ADMIN 发起 pending PUT/PATCH 后切换为 ENGINEER、匿名或另一用户，再迟到 resolve 旧响应；全部 microtask 完成后，所有非 auth QueryCache 仍为空且没有旧页面状态、invalidate 或导航回写。
- [ ] 所有手工 canonical cache 写入路径在执行副作用前核对发起时与当前 `authBoundaryIdentity`/epoch，身份不一致时显式丢弃客户端 continuation。
- [ ] deferred mutation 测试不只 unmount：它实际完成身份切换、等待清理与路由重裁决、再 resolve 旧响应并断言缓存边界。
- [ ] 受影响 unit/component 测试、lint、typecheck 与完整 `make verify` 通过，secret scan 和资源清理完成。
- [ ] 新固定 commit 从 clean Git worktree 重建，fresh `critical_reviewer` 对权限/并发边界结论为 `NO BLOCKER`，随后才能重新完成 I03-4。

## Notes

- 发现于 I03-4 clean-checkout 全门禁后的 fresh 独立高风险复核；该复核结论不是 `NO BLOCKER`。
- 关键位置：`frontend/src/app/auth/auth-provider.tsx:54`、`frontend/src/domains/configuration/ai-channel-workspace-page.tsx:168`、`:722`；验证缺口位于 `frontend/src/domains/configuration/ai-channel-workspace-page.test.tsx:694`。
- 原验证对象 `88992307cdf42b3935f30938bc73f750dd9cde4b`、tree `209bde2da6f8df6163b8a5370d4d277645cbf91a`；日志 `/tmp/partsignal-i03-4-clean-verify.log`，状态文件 `/tmp/partsignal-i03-4-clean-verify.status`。
