# K1 恢复点

## 当前固定证据

- fixed candidate：commit `d10217f2177f7dc47f4df6acfcaedb2c451cc3ef`，tree
  `3fd475c313a2b6c2e4ad515b2d6f7fade22eebf9`。
- bind sentinel：`test_migrations.py` 可见，container/checkout integration 文件均为 `26`。
- 唯一完整门禁：`/tmp/partsignal-i03-j1-d102-make-verify.log`，245,664 bytes，SHA-256
  `2b6e9040454bc7290c767efe3bc89bdba6c29ed892bf3983822b9d073a279058`，status `0`。
- pre/post 资源 snapshot：2,314 bytes，SHA-256
  `170d6a39fd09b4f1c55b2228c782ec0b515b30dce672a34682e1e084f2b06a54`，逐字一致。
- fresh review：`BLOCKER`，audit id
  `20260926T121350Z-i03-j1-fixed-candidate-final-critical-review-aa00ca69`。

## 下一次恢复顺序

1. 定位 `AuthProvider` 本地 transition 的 commit/finish/error 相位，先补“服务端已提交但响应丢失”与
   terminal marker 写失败的失败测试，再实现本地 owner 的唯一 authoritative terminal
   reconciliation。
2. 提供 AuthProvider-owned 当前主体 boundary API，把 self edit、single status 与 bulk status 的
   exact successful current-actor 路径接入该 API；不得由页面复制 transition 或仅调用 refresh。
3. 增加同一 BrowserContext 双页面确定性交错：logout 响应丢失、自降为 ENGINEER、自停用；延迟并
   释放旧 callback/cache，精确断言每页 auth read、无请求风暴、无旧 principal 恢复并保持 secret
   scan clean。
4. 运行最小定向 Vitest、TypeScript/ESLint 和真实栈验证，完成资源清理后形成新的固定
   candidate commit/tree。
5. 在新的 `/Users/sc/...` detached checkout 中 bootstrap，先执行 26/26 只读 bind sentinel；清理
   和资源归零后，只运行一次完整 `make verify`。
6. 只有完整门禁退出 `0`、资源归零、identity 未漂移，才派发另一名 fresh
   `critical_reviewer`。只有 `NO BLOCKER` 才恢复 I03 收尾与 I04。

## 禁止事项

- 不重跑 `d10217f` 的完整门禁。
- 不用 focus refetch、服务端 401/403、TTL 或页面 reload 代替跨标签页 boundary。
- 不把 unknown terminal 当普通 mutation error 后解除 barrier。
- 不把 session binding、CSRF、Cookie、token、密码或用户快照放入 transition 消息或日志。
- reviewer `NO BLOCKER` 前不创建 I04，不 fetch/push/SSH，不连接 Hostdzire，不执行远程写入。

## 已完成实现与定向证据

- `AuthProvider` 的未提交 transition 在 owner 成功写入 durable `SETTLED` 后显式调用本地
  authoritative reconcile；发送页不依赖 `BroadcastChannel` 自回送。`SETTLED` 写入失败会进入
  `failClosedTransition`，不会重新开放旧认证快照。
- `AuthProvider` 新增唯一 `runPrincipalBoundary` 边界：命令前发布 `STARTED`、传递 abort signal、
  命令后读取原子 `/api/v1/auth/session` 并 commit，最后发布 `SETTLED`。Identity 页面只调用该边界，
  没有复制 marker、广播、epoch 或 cache 协议。
- self edit 与 single enable/disable 在请求发出前进入边界；self reset-password 同样由边界承载；bulk
  只在 `succeeded` 精确包含当前主体时触发边界，失败项和其他用户不会误触发。边界完成后的页面回调
  捕获新 continuation，旧 principal continuation 不能写回。
- 定向 Vitest：`auth-provider.test.tsx` 与 `user-list-page.test.tsx` 共 `66` tests 通过；覆盖响应丢失、
  terminal marker 写失败、self edit、single status、self reset-password、bulk exact-success 与
  current-actor failure owner。
- 定向 TypeScript 与 ESLint 均退出 `0`。
- 真实栈退出响应丢失场景通过：真实 logout 仅提交一次；同一 BrowserContext 两页各一次 canonical
  session read，均为 `204`；Playwright `1 passed`，secret scan clean，隔离数据库、Redis DB 14、
  端口 `8000/9001/4174/19009` 与临时对象目录全部清理。
- 真实栈 self permission 场景通过：自降权 PATCH 一次，两页各一次 `200` session recovery；自停用
  PATCH 一次，两页各一次 `401` session recovery；backup admin 完成首次改密后按最新 revision 停用并
  删除，seed admin 恢复；Playwright `1 passed`，secret scan clean，全部隔离资源清理。

## 待完成

K1 已形成 commit `57d08a5eb9bf911b1552617029885dc91be196f6`、tree
`9fc486b23120d8278db927b9ad45092ac71a82aa`，并在全新 detached checkout 中完成 26/26 bind
sentinel 与唯一一次完整 `make verify`。门禁日志 SHA-256 为
`b1f7d94f15a35f0d469339f023b1d45384eb04234804804e420f3f89044d4291`，status `0`；pre/post 资源
snapshot SHA-256 均为 `844ea854ef9bb2f2312cf9097997260020a3b3762c303b797192e3e865a2c712`，全部归零；
validation checkout 已移除。

fresh review 结论仍为 `BLOCKER`（audit id
`20260926T134151Z-i03-k1-fixed-candidate-final-critical-review-4656ade3`）：

1. 本地 transition owner 写入 `STARTED` 后未同步关闭发送页的新 command window；首请求延迟期间可启动
   第二个管理员命令。
2. bulk self-disable 请求发生在 principal boundary 外；服务端已提交但响应丢失时不会进入 canonical
   unknown-result reconciliation。

后续工作转入子任务
`09-26-frontend-i03-4-b2-c2-d2-e1-f1-g1-h1-i1-j1-k1-l1-local-owner-barrier-bulk-unknown-outcome-blocker`。
K1 保持 `in_progress`，I03/I04 与所有远程动作继续暂停。
