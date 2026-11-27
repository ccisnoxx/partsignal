# I03 L4 Blocker bulk exact success 的 stale continuation 丢失 post-result auth boundary

## Goal

修复 fixed candidate `b7318ef67c40301cc2b2f745e04e7f543e40eab8` fresh critical review 确认的
P1：current-actor bulk exact success 在请求期间若先被另一标签页推进 principal epoch，会跳过结果已知之后的
AuthProvider-owned principal boundary，却仍被标记为 handled 并捕获新 continuation。

## Trigger

1. 当前 ADMIN 发出包含自身的 bulk disable POST，请求保持 in-flight。
2. 另一标签页完成同一用户的新 session binding transition；本命令的旧 continuation 变为 stale。
3. 该 transition 的 canonical session GET 先读取到仍启用的 ADMIN。
4. bulk 事务随后提交自停用并返回 exact success。
5. `user-list-page.tsx:271-279` 因旧 continuation stale 跳过 `runAuthBoundary()`，但仍设置
   `authBoundaryHandled=true` 并捕获当前 epoch continuation。

## Requirements

- exact current-actor success 必须在业务结果已知之后完成一次 Provider-owned canonical reconciliation；不能因命令前
  continuation stale 而静默跳过。
- 只有 boundary 实际完成，或 Provider 明确把本结果合并进一个保证晚于该结果的 reconciliation，才可标记
  `authBoundaryHandled` 并捕获新 continuation。
- bulk POST 必须保持恰好一次，不得用 replay、reload、focus、TTL 或后续 401/403 猜测结果。
- 保持 L1-L3 的 owner command barrier、exact partition、strict ErrorEnvelope、canonical UUID、Web Lock
  fail-closed、durable transition/lease 与跨标签页合同。
- 不修改后端权限语义。

## Acceptance Criteria

- [x] 确定性交错测试：hold bulk POST，完成另一标签页同用户新 binding 及其首次 canonical GET，再释放 self-disable exact success。
- [x] bulk POST 恰好一次；结果返回后再次权威收敛为匿名/401，ADMIN route/cache 不恢复。
- [x] 旧命令不能借新 continuation 执行 onSuccess/navigation/callback；explicit failure 与 unknown 三态不回归。
- [x] 定向检查、真实栈、资源清理、新 fixed candidate、全新 checkout 单次完整门禁均通过。
- [ ] fresh critical review 对完整候选给出 `NO BLOCKER` 后，才允许关闭 L4/L3 与 I03 父链。

## Evidence

- 阻断候选：commit `b7318ef67c40301cc2b2f745e04e7f543e40eab8`；tree
  `4a6c789d5b2687641eeca6c2da4f1ab7e348f4db`。
- 候选唯一完整 `make verify` 退出 `0`；日志 252,114 bytes，SHA-256
  `b16c14451d41f82aa577313433b5bfd521edcf5a2f3746156595cbd925642b0c`。
- 实际计数：backend unit 683、Vitest 91 files / 834 tests、PostgreSQL integration 337、real-stack
  21、fixture 494 passed / 44 skipped；secret scan、lifecycle、deploy 与 Compose 门禁通过。
- 26/26 bind sentinel SHA-256
  `7a568218e315269abc11a5eadf1a004a6ce1297f3bb20ac6e6fdbb6696e64931`。
- pre/post resource snapshot 各 2,314 bytes 且逐字一致，SHA-256
  `05009caecc2bce2c826ace5920af15a58b8aff2d5ebf29c0b5e03c6af66a5b1d`；受控资源全部为 0。
- fresh review：`BLOCKER`；audit id
  `20260926T170307Z-i03-l3-canonical-uuid-and-lock-fail-closed-9ae850cc`。

## L4 implementation evidence

- `UserListPage` 对 exact current-actor success 不再读取旧 continuation 的 current 状态来决定是否执行边界，
  而是在结果已知后无条件调用 Provider-owned canonical reconciliation；boundary 完成后保留原 continuation，
  不捕获新 epoch 给旧 `onSuccess`、cache write 或 navigation 使用。
- 回归测试在修复前稳定失败（post-result reconciliation `0` 次）；修复后相关
  `providers/query-client/auth-provider/user-list-page` 为 `4 files / 126 tests`，status `0`。日志
  `/tmp/partsignal-i03-l4-targeted-vitest.log`，718 bytes，SHA-256
  `9b5195ace97f793c8e70a58e0722af556baadb9d543e5d41eabb99cf8a56392b`。
- TypeScript 与受影响 4 文件 ESLint 均为 status `0`；`git diff --check` status `0`。
- 真实栈 `system-admin-real-stack.spec.ts` 为 `2 passed`，新增 held exact bulk → 新 binding
  canonical 200 → bulk exact 200 → 两页 canonical 401 的精确顺序；POST 一次、durable marker `SETTLED`、
  route/cache 不恢复且 secret scan clean。最终用例以 PostgreSQL table lock 证明 bulk 事务已实际等待；日志
  40,532 bytes，SHA-256 `fde0ef4d12fc44f49554898fa38a80c1261b48623de431d31cfcd8fb37183892`。
- 定向真实栈前后资源快照各 2,314 bytes、逐字一致，SHA-256
  `05009caecc2bce2c826ace5920af15a58b8aff2d5ebf29c0b5e03c6af66a5b1d`；四端口、Redis DB 14、
  `partsignal_e2e_%`、临时目录和测试容器均为 0。

本任务只记录恢复点；当前会话不继续修复、不重跑完整门禁、不创建 I04、不执行远程动作。

## L4 fixed candidate 与 fresh blocker

- fixed candidate：commit `c85e282ab89fca0f2c8a5af3094f2202b9ead214`；tree
  `6aa82a5271edd8d62be11cd2cdec225a7f2ac206`。
- 26/26 bind sentinel 退出 `0`；日志 223 bytes，SHA-256
  `3f46388e2ea69ee0ec8ee38ae21bba33851adf9699b4ba8c3dc81d6de03b3f34`。
- 唯一一次完整 `make verify` 退出 `0`；日志
  `/tmp/partsignal-i03-l4-c85e282-make-verify.log`，253,479 bytes，SHA-256
  `80207f1ca200ed40ac41ac4f6d433cee6a8f11cef693659fa07f84f25c034d08`。实际通过：backend unit
  683、Vitest 91 files / 836 tests、PostgreSQL integration 337、real-stack 21、fixture 494 passed /
  44 skipped，以及 secret scan、production build、Docker、Compose、lifecycle 和部署脚本检查。
- 门禁 pre/post resource snapshot 各 2,456 bytes、逐字一致，SHA-256
  `08c2180dc0f2a47b5ff2f70525e86dce666de9db48c3ac87e72971eae3d91524`；四端口、Redis DB 14、
  `partsignal_e2e_%` 数据库、临时资源与测试容器均为 0。validation checkout 已归档并 prune；原检出区
  `9100774` 与候选工作树均干净。
- fresh critical review 结论为 `BLOCKER`；audit id
  `20260926T183412Z-i03-l4-fixed-candidate-final-critical-review-d33ad16c`。新 P1 是结果前 canonical GET 已读到
  旧 ADMIN、但响应仍在途并持有 command barrier 时，结果后的 reconciliation 会在
  `assertPrincipalCommandOpen()` 被拒绝；较早 GET 随后仍可提交旧快照。已建立 L5 子任务作为唯一恢复点。
