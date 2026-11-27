# I03 L6 Blocker bulk response-loss 双页 recovery response 审计等待缺口

## Goal

修复完整门禁中 bulk response-loss 场景在两次 canonical GET 均发出且服务端均返回 401 时，测试在第二个 Playwright response 事件入账前读取审计数组而产生的验收阻断。

## Requirements

- 保留 L1-L5 已建立的 AuthProvider owner、result-known fence、exact/explicit/unknown 三态、POST once、
  durable marker/lease 与 fail-closed 合同；本 blocker 不授权改变业务行为或后端权限。
- 真实栈必须确定性等待 owner 与 observer 的 canonical recovery response 均完成，再读取
  `runtimeAudit.responses`。不能以两页已经导航到 `/login` 推断两个页面各自的 `response` 事件均已入账。
- 继续分别证明：bulk POST attempt 恰好一次且浏览器未消费响应；两次 canonical GET attempt；服务端与浏览器
  各观察到两次 401；无 request storm、未声明 cancellation、console/page error 或 secret artifact。
- 修复只属于 E2E 观测/等待所有权；不得增加 timeout 猜测、轮询、重复 POST，或放宽为“至少一次”响应。
- 形成新的 fixed candidate 后使用全新 `/Users/sc/...` detached checkout，先运行 26/26 bind sentinel，再且仅一次
  运行 `make verify`；资源归零后才允许 fresh 独立高风险复核。

## Acceptance Criteria

- [ ] response-loss 场景用每页明确的 canonical response completion 或等价确定性闸门，证明两次 401 均已 settle。
- [ ] 既有双闸门 stale exact-success 场景继续证明 old read 200 → bulk exact 200 → old response settle →
  post-result 401，且 POST 一次、旧 route/cache 不重开。
- [ ] 定向 system-admin real-stack、secret scan、diff check 与资源清理通过。
- [ ] 新候选唯一一次完整 `make verify` 通过，pre/post resource snapshot 逐字一致。
- [ ] fresh `critical_reviewer` 相对总体 baseline 复核为 `NO BLOCKER` 后才能关闭 L6/L5 与 I03 阻断链。

## Confirmed gate evidence

- blocked candidate `70add985a05844d650c220da279d9ddf1a2644fa`，tree
  `83944d4a574aab3a345fe05bdf095f6d56bc83db`，baseline
  `9100774b0e124d1d834f8c726cf85f2c0e171e5e`。
- 单次完整门禁日志 `/tmp/partsignal-i03-l5-70add985-make-verify.log`，status `2`，160,620 bytes，
  SHA-256 `0e5d124af9ab31bd33ab2572b45377b14a22d5469418f4def104407b55abca6c`。
- 已通过：backend unit `683`、frontend Vitest `91 files / 841 tests`、PostgreSQL integration `337`、
  production frontend/backend build；real-stack 为 `20 passed / 1 failed`，secret scan clean。
- 失败时 runtime audit 记录两次 recovery GET attempt，服务端日志记录两次 401，但
  `runtimeAudit.responses` 只入账一次；触发位置
  `frontend/tests/e2e/system-admin-real-stack.spec.ts:684-717`。页面快照已是登录页，说明 route fail-closed，
  但这不是第二个页面 `response` 事件已入账的同步点。
- Playwright error context `/tmp/partsignal-i03-l5-70add985-system-admin-error-context.md`，13,637 bytes，
  SHA-256 `8be89432fa9bd9c9daa262e4618790d144626e588c4fe90b3839050a1e4b3938`。
- 资源 pre/post 快照均为 2,472 bytes、逐字一致，SHA-256
  `acb1a66beca8a47798de1b8b2a198ad21562e87cd015e7ddcc5078874c527524`；四端口、Redis DB 14、
  `partsignal_e2e_%`、临时资源与测试容器均为 0，detached checkout 已移除并 prune。
- 本会话不修改或重跑完整门禁，不安排 fresh review，不创建 I04。

## L6 implementation and new gate evidence

- L6 只修改 `frontend/tests/e2e/system-admin-real-stack.spec.ts`：在触发 bulk response loss 前，owner 与
  observer 分别注册 phase + origin + GET + exact pathname + 401 的 `waitForResponse`；bulk 服务端提交后先
  `Promise.all` 等两页 response，再读取 runtime audit。AuthProvider、UserListPage 与 backend 无 diff。
- 定向 runtime audit：`1 file / 13 tests`；日志 `/tmp/partsignal-i03-l6-runtime-audit-unit.log`，346 bytes，
  SHA-256 `a81c7b0410dc68d821bf734061d4255f1f0bf3cf1472c780dc30bef9810a4a3d`。Vitest 输出明确通过；其后外层
  zsh 证据包装器因误用只读变量 `status` 以 status `1` 退出，因此没有把该包装器状态误记为测试失败，也未无依据重跑。
- 定向 System Admin：`2 passed`、secret scan clean；日志
  `/tmp/partsignal-i03-l6-system-admin-targeted.log`，40,278 bytes，SHA-256
  `6e6db4640eb1dc4d74e4f4ea25070d4ba9bc47d54963c585ab804f3f466e0959`；测试 status `0`，其后包装器仅因
  hash 输出转义错误退出，哈希已用独立只读命令计算；资源归零，`git diff --check` 通过，未重跑测试。
- fixed candidate `d0f985cf09b663f928e5e0566b1ca84401248de9`，tree
  `5f918935441eff622ce31c8539d689584c2090a3`。新 detached checkout bootstrap 成功，有效 bind sentinel
  `26/26`；首次 sentinel wrapper 因内联 Python 引号转义在断言前 SyntaxError，修正 wrapper 后才得到有效
  26/26 证据，两份日志均保留。
- 该候选唯一完整 `make verify` status `2`：backend unit `683`、Vitest `91 files / 841 tests`、
  PostgreSQL integration `337`、production frontend/backend build 均通过；real-stack `20 passed / 1 failed`，
  secret scan clean。System Admin 两项均通过，失败转移到既有 auth-session A→B→A 用例的 product response
  release 编排死锁，已建立 L7。
- 完整门禁日志 `/tmp/partsignal-i03-l6-d0f985cf-make-verify.log`，160,770 bytes，SHA-256
  `ca8610d8e04b2c1ab326e720a5d13434ea2a77f4f9eced8cd8aa14517a5d2047`。pre/post resource snapshot
  各 4,140 bytes、逐字一致，SHA-256 `31af6c044228e3086e0456129f5c7b05930535dee107c34e46430e9db3ca45d8`；
  validation checkout 已移除并 prune，原检出区仍为 baseline 且 clean。
- L6 产品范围没有扩展，但因完整门禁仍红，L6/L5 和全部 I03 父链继续 `in_progress`；fresh review 未派发，
  I04 未创建。
