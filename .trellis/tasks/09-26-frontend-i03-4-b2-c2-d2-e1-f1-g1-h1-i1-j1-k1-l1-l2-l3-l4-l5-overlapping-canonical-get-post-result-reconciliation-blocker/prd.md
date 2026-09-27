# I03 L5：在途旧 canonical GET 与结果后 reconciliation 重叠阻断

## Problem

L4 fixed candidate 在 bulk exact current-actor success 返回后调用 Provider-owned reconciliation，但
`AuthProvider.beginTransition()` 会先执行 `assertPrincipalCommandOpen()`。如果结果前启动的 canonical session GET
已经从服务端读取到提交前启用 ADMIN、其响应却仍在途，该 GET 继续持有 command barrier，导致结果后的
reconciliation 在登记更晚覆盖点前直接抛 `ActivePrincipalCommandError`。较早 GET 随后仍可通过现有 generation /
durable-marker guard 提交旧 snapshot，恢复 ADMIN route/cache。

## Exact trigger

1. 当前 ADMIN 发出包含自身的 bulk disable POST，事务保持 in-flight。
2. 另一标签页完成同用户新 binding transition，并让当前标签启动 canonical session GET。
3. 该 GET 已在服务端读取仍启用的 ADMIN，但客户端响应保持延迟，command barrier 尚未释放。
4. bulk self-disable 提交并返回 exact success。
5. `user-list-page.tsx:277` 发起 post-result reconciliation；`auth-provider.tsx:443` 的
   `assertPrincipalCommandOpen()` 立即拒绝。
6. 较早 GET 随后返回并提交提交前 snapshot；没有覆盖点晚于 bulk 结果的新 canonical reconciliation。

## Required outcome

- Provider 必须拥有结果已知型 reconciliation fence：调用时原子登记一个晚于业务结果的覆盖要求。
- 即使已有 barrier/canonical GET 在途，也要保持 fail-closed，并在较早读取完成后串行执行新的 canonical GET。
- Promise 只能在晚于该 fence 的 canonical reconciliation 完成后 resolve；不能把 exact success 降格为 unknown、
  explicit failure 或普通 mutation error。
- Web Lock 缺失/acquire 拒绝、canonical GET 失败和 Provider unmount 继续 fail-closed。
- 页面保留命令前 continuation；旧命令不得借新 epoch 执行 onSuccess、selection/cache invalidation、navigation 或 callback。
- bulk POST 仍恰好一次，L1-L4 所有既有合同不回退，后端权限语义不变。

## Acceptance

- [x] 确定性反例：较早 GET 已读 enabled ADMIN 但响应延迟 → bulk exact success 返回 → 较早 GET 迟到。
- [x] 不抛 `ActivePrincipalCommandError`；结果后必须再有 canonical 401/anonymous，route/cache 从不重开。
- [x] POST 一次；GET 顺序、barrier/epoch、marker/lease、callback/navigation、retry/offline resume 均有断言。
- [x] lock acquire failure、Provider unmount、uppercase UUID、exact/explicit/unknown 三态与无请求风暴不回归。
- [ ] 新 fixed candidate `70add985` 的单次完整门禁在既有 response-loss 双页 recovery 审计等待点失败；
  已建立 L6，新的候选门禁与 fresh 高风险复核尚未完成。

## L5 implemented evidence

- `AuthProvider` 在调用 result reconciliation 时同步登记 fence：保留/建立 command barrier、推进
  principal epoch、清除 auth 与业务 cache，并使较早 query generation 失效。这些动作都早于
  检查或等待已有 barrier。
- Provider 跟踪已真正进入 `loadAuthSession()` 的 canonical read。结果后 transition 取得 Web Lock 并
  写入 durable `STARTED` 后，先等这些读取 settle，再串行发起新 canonical GET；不把
  Query cancel 状态当作网络读取已完成。
- 无法证明覆盖点的并发 fence 不合并，而是在 Provider 队列中逐个完成结果后 canonical
  read。Web Lock 失败、GET 失败、marker 失败或 Provider unmount 不释放旧 snapshot；已精确分类的
  bulk exact success/unknown 也不被 reconciliation 错误改写。
- 单元反例在修复前稳定失败为 `ActivePrincipalCommandError`；修复后 AuthProvider、UserListPage、
  QueryClient 与 Providers 定向为 `4 files / 131 tests` 全绿，TypeScript 与受影响 ESLint 为 status `0`。
- 真实栈 BrowserContext 用 PostgreSQL table lock 保证 bulk 尚未提交，用 Playwright `route.fetch()` 保证旧
  canonical GET 已在服务端读到 enabled ADMIN，再独立延迟客户端 settle；之后先取得 bulk exact
  200，再放行旧 200，最后观察到结果后 401。`2 passed`、POST once、secret scan clean，无请求风暴。
- 定向真实栈日志 `/tmp/partsignal-i03-l5-system-admin-real-stack.log`：40,285 bytes，SHA-256
  `2f781210bb4299201bdade8b0098441865149e088b414947da802627e4f7ebc2`。前后资源快照各 2,472 bytes、
  逐字一致，SHA-256 `e1017f63c6d97a24e35484753f7fe4d98a5c5d129e334f45969983eccb6df031`，
  四端口、Redis DB 14、`partsignal_e2e_%`、临时目录和测试容器均为 0。

## Fixed evidence and recovery point

- blocked candidate commit `c85e282ab89fca0f2c8a5af3094f2202b9ead214`；tree
  `6aa82a5271edd8d62be11cd2cdec225a7f2ac206`；baseline `9100774b0e124d1d834f8c726cf85f2c0e171e5e`。
- unique full gate log `/tmp/partsignal-i03-l4-c85e282-make-verify.log`，status `0`，253,479 bytes，SHA-256
  `80207f1ca200ed40ac41ac4f6d433cee6a8f11cef693659fa07f84f25c034d08`。
- resource snapshot pre/post 2,456 bytes、逐字一致，SHA-256
  `08c2180dc0f2a47b5ff2f70525e86dce666de9db48c3ac87e72971eae3d91524`，所有受控资源为 0。
- fresh review `BLOCKER`；audit id
  `20260926T183412Z-i03-l4-fixed-candidate-final-critical-review-d33ad16c`。
- finding locations：`frontend/src/domains/identity/user-list-page.tsx:277`；
  `frontend/src/app/auth/auth-provider.tsx:306-317,408-417,443`。

## L5 candidate gate result

- fixed candidate `70add985a05844d650c220da279d9ddf1a2644fa`；tree
  `83944d4a574aab3a345fe05bdf095f6d56bc83db`。
- 26/26 bind sentinel status `0`；日志 `/tmp/partsignal-i03-l5-70add985-bind-sentinel.log`，223 bytes，
  SHA-256 `0183c2d5582c091d9fb0df05b0886ec414f69fa71380bc88488bbd55b2c02452`。
- 唯一完整门禁 status `2`；日志 `/tmp/partsignal-i03-l5-70add985-make-verify.log`，160,620 bytes，
  SHA-256 `0e5d124af9ab31bd33ab2572b45377b14a22d5469418f4def104407b55abca6c`。
- backend unit `683`、frontend Vitest `91/841`、PostgreSQL integration `337`、build 均通过；real-stack
  `20 passed / 1 failed`，secret scan clean。失败为 response-loss 子场景两次 GET attempt、服务端两次 401，
  但测试在第二个 Playwright response 事件入账前读取审计数组，位置
  `frontend/tests/e2e/system-admin-real-stack.spec.ts:684-717`。
- pre/post resource snapshot 各 2,472 bytes、逐字一致，SHA-256
  `acb1a66beca8a47798de1b8b2a198ad21562e87cd015e7ddcc5078874c527524`；全部受控资源归零，
  detached checkout 已移除并 prune，原检出区仍为 clean baseline。
- fresh 高风险复核未派发；L6
  `09-26-frontend-i03-4-b2-c2-d2-e1-f1-g1-h1-i1-j1-k1-l1-l2-l3-l4-l5-l6-bulk-response-loss-recovery-audit-wait-blocker`
  是唯一新叶子。本会话不继续修复、不重跑门禁、不创建 I04。
