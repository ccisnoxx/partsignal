# I03-4-B1 身份主体 epoch 与迟到 mutation 防护

## Goal

在认证主体边界建立单调 epoch，并拒绝身份切换后迟到的业务 mutation 客户端副作用。

## Requirements

- 认证 owner 以现有 `authBoundaryIdentity` 管理每个 QueryClient 的单调 principal epoch；主体变化先推进 epoch，再清理全部非 auth query。认证命令 epoch 与 principal epoch 保持独立。
- 普通同主体 session/CSRF/revision refresh 不推进 principal epoch；ADMIN→ENGINEER、匿名或另一用户必须推进。
- 共享 mutation 边界捕获请求发起时的 principal epoch，并在 TanStack mutation 成功回调前拒绝旧主体 continuation；认证 owner 自身的 mutation 明确豁免。
- 绕过 MutationCache 的直接 API 请求，以及 AI Channel Workspace 中手工采用 canonical response 的 continuation，必须在任何 cache、invalidate、导航、成功回调或局部成功状态前同步核对捕获值。
- 覆盖配置保存、API Key replacement、Header/lifecycle/model 等同一 Workspace 的手工 canonical/callback 路径；搜索到的其他 mutation 路径需记录由共享边界覆盖或不适用的具体原因。
- 服务端继续最终裁决权限、revision 与 409；当前主体错误不得吞掉，旧主体迟到结果只丢弃客户端 continuation，不假定服务端请求未提交。
- 不修改 OpenAPI、数据库、后端权限、部署或 I04；不运行完整 `make verify`。

## Acceptance Criteria

- [ ] ADMIN 发起 pending 配置 PATCH 或 API Key PUT 后切换为 ENGINEER、匿名或另一用户，迟到成功不写任何非 auth QueryCache、不 invalidate、不导航、不调用成功 callback、不恢复旧局部成功状态。
- [ ] 同一主体普通 session/CSRF refresh 后，合法 mutation canonical response 仍正常采用。
- [ ] AuthProvider、AI Channel Workspace 及所有实际修改消费者的定向 Vitest 通过；修改文件 ESLint、frontend typecheck、`git diff --check` 通过。
- [ ] fresh `critical_reviewer` 确认 principal epoch 顺序、消费者覆盖、deferred 测试与权限/并发边界为 `NO BLOCKER`。
- [ ] 创建本地修复提交并记录 commit/parent/tree；候选工作区 clean，原检出区保持不变。
- [ ] 本子任务标记 completed；blocker 父任务、I03-4、I03 和总体交付保持 in_progress，下一任务固定为基于修复 commit 的 clean-checkout 完整复验与收尾。

## Notes

- 父任务：`.trellis/tasks/09-25-frontend-i03-4-auth-boundary-late-mutation-blocker/`。
- 旧绿色完整门禁仅证明 `88992307cdf42b3935f30938bc73f750dd9cde4b`；修改后的候选只运行本任务授权的定向门禁。
