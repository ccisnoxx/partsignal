# I03-4-B2-C2-D2-E1 恢复点

## 当前结论

固定候选 `d168dcd8` 的完整本地门禁与资源清理均通过，但 fresh 独立高风险复核发现跨标签页认证边界仍不完整，因此 D2/I03 不能收尾，I04 不得创建或执行。

## 下一步

1. 重新读取认证合同、AuthProvider、principal epoch、mutation continuation 与现有并发测试的完整权威单元。
2. 先设计跨标签页 transition owner、session binding epoch 和消息生命周期；明确无凭据 payload、去重和失败收敛。
3. 实现最小跨标签页边界修复，并把现有“同 user/new binding 保留缓存”测试改为 session-boundary 失效合同。
4. 增加同一 BrowserContext 双 page 的 A→B 与 ABA 确定性交错测试，覆盖迟到 read/mutation、paused retry、offline resume 与 callback 内 await。
5. 运行定向验证与完整资源清理，形成新固定 commit/tree。
6. 在全新 detached checkout 中只运行一次完整 `make verify`；通过后再派发 fresh `critical_reviewer`。

## 禁止事项

- 不把 channel 通知当作认证或权限裁决。
- 不在通知中传递 CSRF、Cookie、token、密码或完整用户敏感信息。
- 不以扩大测试 allowlist、关闭 refetch、增加 sleep 或静默吞错代替状态所有权修复。
- 不复用本轮 detached checkout 或完整门禁结果验证修改后的候选。
- 在新复核 `NO BLOCKER` 前不创建 I04，不进行任何远程写入。

## 2026-09-26 实现检查点

- `authBoundaryIdentity` 现在包含 `session_binding`；同 binding 普通 refresh 不推进 epoch，同 user/new binding 先推进 epoch、清理非 auth QueryCache，再提交 canonical session。
- 新增 `auth-transition-channel.ts`，以 BroadcastChannel 传递即时事件、以 localStorage marker 覆盖 storage/focus/visibility 恢复；事件严格校验 UUID、version 和 phase，并按 event ID 去重，不携带 user、CSRF、Cookie、token 或密码。
- Auth command 在 STARTED 前先失效本标签页 continuation；其他标签页收到 STARTED 后取消旧 auth barrier、置空旧 session并清业务 cache，只在所有已见 transition SETTLED 后 refetch 原子 session。抢占发生在 begin/cancel 窗口时，发送方仍配对关闭 SETTLED。
- 单元定向：TypeScript、ESLint、`auth-provider.test.tsx + query-client.test.ts` 30/30 通过；`git diff --check` 通过。
- 真实栈定向：`auth-session-real-stack.spec.ts` 2/2 通过；新增同 BrowserContext 双页面 ADMIN A→ENGINEER B→ADMIN A，并把旧 A 的真实产品 201 响应延迟至 ABA 后释放，未发生旧导航、重复 mutation、运行时错误或 secret artifact 泄漏。
- 下一步：冻结定向资源证据，检查完整 diff，形成新固定 commit/tree；再创建全新 detached checkout并只运行一次完整 `make verify`。E1、D2 与 I03 父链继续保持 `in_progress`。
