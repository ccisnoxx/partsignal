# I03-4-B2-C2 Blocker 认证刷新跨快照拼接

## Goal

修复认证刷新把不同权限或不同账号时刻的 /auth/me 与 /auth/csrf 响应拼接为 AuthSession，导致 principal epoch 未推进、旧敏感缓存与迟到 continuation 继续存活的权限边界缺陷。

## Requirements

- 认证 session refresh 不得把不同权限快照或不同浏览器 session 的 `/auth/me` 与 `/auth/csrf` 响应拼接成一个客户端 `AuthSession`。
- 服务端应从同一次已解析 session 返回原子绑定的 user、CSRF token 与可验证的 session generation/binding；客户端在 commit 前拒绝已变化或不匹配的 session snapshot。
- ADMIN→ENGINEER、匿名或另一用户的边界变化必须先推进 principal epoch，再清理全部非 auth QueryCache；旧主体的 pending mutation、offline resume、paused retry 和 callback continuation 均不得重新取得 current 身份。
- 同一主体的普通 CSRF/session revision refresh 必须继续成功，且不无故推进 principal epoch。
- 服务端权限继续最终裁决；客户端修复不能依赖重复读取 `/auth/me`、abort、UI 隐藏、缓存 TTL 或静默吞掉错误关闭交错。
- 需要同步更新 `contracts/openapi.yaml`、runtime schema、generated types、后端路由/服务和前端 owner；具体 endpoint 设计在启动本 blocker 时按合同优先流程确认。
- 修复后使用新固定 commit/tree 重新执行受影响并发测试、完整 clean-checkout `make verify`、资源清理与 fresh 完整候选独立高风险复核；本轮 `6aaf05a5` 绿色门禁不能外推到修改后的候选。
- 不进入 I04，不执行真实部署或远端写操作。

## Acceptance Criteria

- [ ] `/auth/me` 与 session/CSRF snapshot 之间发生 ADMIN→ENGINEER 更新时，客户端只提交新权限 identity，旧敏感 query 被清理，旧 principal continuation 全部失效。
- [ ] 同一 browser context 的双标签页账号替换与响应交错不能产生 `user=A + csrf=B` 或 ABA 混合 session；旧身份 UI 不能使用新身份 token 延续命令。
- [ ] paused retry、offline resume、迟到 mutation callback 和 callback 内 await 在上述交错后均被拒绝；同主体普通 refresh 正向行为保持。
- [ ] OpenAPI/runtime/generated types 一致，后端权限/会话、前端 AuthProvider 与相关集成测试覆盖确定性交错。
- [ ] 新固定候选完成单次 clean-checkout 完整门禁、secret scan、全部资源清理和 fresh `critical_reviewer` `NO BLOCKER` 后，才能恢复 C2/I03 收尾。

## Notes

- 发现于固定候选 `6aaf05a5ad5371493bb20c95b5cbdb5908a27cf9`、tree `8a07b055bcb9f8d2b4038f7e31ac5fab71c815e1` 的 C2 完整门禁后 fresh 独立高风险复核。
- 关键位置：`frontend/src/app/auth/auth-provider.tsx:106`、`:116`、`:123`、`:214`；服务端支撑路径：`backend/app/services/identity.py:503`、`:554`；现有测试缺口：`frontend/src/app/auth/auth-provider.test.tsx:552-565`。
- 父任务：`.trellis/tasks/09-25-frontend-i03-4-b2-c2-clean-checkout-revalidation-i03-closeout/`。
- D1 已完成原子 snapshot 修复、定向验证和 `NO BLOCKER` 独立复核；本 blocker 仍等待新修复提交的全新 clean-checkout 完整复验，因此保持 `in_progress`。
