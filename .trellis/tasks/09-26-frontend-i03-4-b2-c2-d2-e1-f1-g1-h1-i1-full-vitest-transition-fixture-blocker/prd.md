# I03-4-B2-C2-D2-E1-F1-G1-H1-I1 Blocker 完整 Vitest 命令期读取合同与 durable marker 隔离

## Goal

固定候选 39b1d0f9 的唯一一次完整 make verify 在 frontend Vitest 失败：providers.test 仍期待 active auth command 后发出第二次 canonical session GET，违反 H1 的 pre-request barrier；首个超时遗留 durable STARTED，导致同文件后续 8 个用例级联 fail-closed/加载。

## Requirements

- `providers.test.tsx` 的三项迟到 session read 场景必须让旧读取在认证命令取得 owner、发布 `STARTED` 之前已经真实发出；命令开始后再触发的读取应在网络前被拒绝，不得为了满足旧调用次数而放宽产品 barrier。
- 登录、退出和改密命令完成后，命令前已在途的旧匿名、旧 ADMIN 或 must-change snapshot 即使迟到，也不得恢复旧主体、旧 CSRF、业务缓存或路由。
- 测试必须在每个 case 后清理 v1/v2 durable transition marker，避免一个断言失败遗留的 `STARTED` 污染同文件后续用例；清理只属于测试隔离，不得改变 Production recovery 合同。
- 保留 `auth-provider.test.tsx` 中 active command 期间 canonical GET 次数不增加的精确断言，以及 H1 的 invalid/legacy fail-closed、孤儿回收、真实 BrowserContext 和 secret scan 覆盖。
- 先运行精确 Vitest、TypeScript、ESLint 和资源清理；形成新的固定 commit/tree 后，在全新 detached checkout 中只运行一次完整 `make verify`。
- 只有新完整门禁退出 0、资源清理成立且 fresh `critical_reviewer` 给出 `NO BLOCKER`，才允许完成 I1/H1 及其祖先任务并创建 I04。

## Acceptance Criteria

- [x] 三项迟到 session read 测试均证明请求在命令前已在途，迟到结果不会覆盖 canonical 身份或恢复业务副作用。
- [x] active command 期间的新 auth read 仍在网络前被拒绝，精确请求次数合同未放宽。
- [x] durable marker 测试隔离使单个失败不能把 `STARTED` 传播到后续 case；相关定向检查与资源清理通过。
- [ ] 新固定候选在全新 detached checkout 中唯一一次完整 `make verify` 退出 0，门禁前后资源为 0。
- [ ] fresh `critical_reviewer` 给出 `NO BLOCKER`。

## Notes

- 触发候选：commit `39b1d0f9cc371c2055adae082ce152a255005ab3`，tree `8c2bb5098f89b5cd58cdd138b10c437f0eb48f05`。
- 唯一一次完整门禁在 frontend Vitest 终止：backend unit `683 passed`；Vitest `90 passed / 1 failed files`、`785 passed / 9 failed tests`，顶层退出码 `2`。
- 首个失败位于 `frontend/src/app/providers.test.tsx:292`：登录已经发布 `STARTED` 后，测试仍等待第二次 session GET；H1 的 pre-request guard 正确地让调用数保持 1。
- 首个断言超时使 deferred 登录未完成并留下 durable `STARTED`；同文件未清理 localStorage，随后 8 个用例因 fail-closed/loading 级联失败。该级联不构成八个独立产品缺陷。
- 门禁日志 `/tmp/partsignal-i03-h1-39b1-make-verify.log`：25,236 bytes，SHA-256 `1b177a983fc4fd37729876713a8e9e3aa49ce851cd8b269928025fb6c6486651`；状态文件 SHA-256 `53c234e5e8472b6ac51c1ae1cab3fe06fad053beb8ebfd8977b010655bfdd3c3`。
- 门禁前后资源日志均为 2,314 bytes 且逐字节相同，SHA-256 `b438f95e4daf88e58848c7f8797541c0376567f008296473f5afe4d1822f61f1`；validation worktree 已移除。
- 未派发 reviewer；I04 未创建；未 fetch、push、SSH、连接 Hostdzire 或执行远程写入。
- I1 最小修改仅触及 `providers.test.tsx`：三项 stale refetch 移到认证命令之前，并在 `afterEach` 精确移除 v1/v2 transition key；H1 产品实现未改。
- 定向 Vitest 为 2 files / 54 tests passed，日志 SHA-256 `a05a929e3439eb5e1e4d9f2557e32755d3040a35bcf4f0c500f8e062ef25f814`；TypeScript 与精确 ESLint 通过。定向资源日志 2,314 bytes，SHA-256 `b438f95e4daf88e58848c7f8797541c0376567f008296473f5afe4d1822f61f1`，全部计数为 0。
