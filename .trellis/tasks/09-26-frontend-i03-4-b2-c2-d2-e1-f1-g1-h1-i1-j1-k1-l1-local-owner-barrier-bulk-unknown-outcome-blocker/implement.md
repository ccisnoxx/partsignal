# L1 实现与待执行门禁

## 已完成实现

- QueryClient 级 active-command barrier 同时覆盖 mutation、query、retry/offline resume 与 continuation
  捕获；AuthProvider 在 durable `STARTED` 与业务 side effect 前同步关闭发送页，并只向当前 Web Lock
  owner 暴露不可转交的 capability。owner signal 不被自身 barrier abort。
- 已挂载 Router 在本地命令期间保留 owner component 生命周期；route user 与业务 query 仍 fail-closed，
  登录/改密 terminal callback 可在 canonical commit 后完成导航。
- bulk status API 对合法 200 做 runtime parse；合同内结构化 4xx 是明确失败，transport/abort、畸形 200
  与意外响应是专用 unknown outcome。包含当前 actor 的 unknown 只调用 AuthProvider reconciliation，
  不重发 POST。
- 已删除不可达的 self reset-password 前端分支和 fixture，保留后端禁止 self reset 的权限合同。
- 定向 TypeScript、ESLint 退出 `0`；Vitest `4 files / 94 tests` 通过。真实栈
  `system-admin-real-stack.spec.ts` `2 passed`，secret scan clean；日志
  `/tmp/partsignal-i03-l1-system-admin-real-stack-final.log`，39,000 bytes，SHA-256
  `0e68c2aa688709476bc303d66778063abaedf343730906cda9b22d4f6caf8c0d`。运行后端口、E2E 数据库、
  Redis DB 14 与 storage 全部归零。

## 待执行

1. 将本实现、稳定 spec 和当前 Trellis 暂停记录收敛为新的 fixed candidate commit/tree。
2. 在全新 `/Users/sc/...` detached checkout bootstrap，先执行 26/26 bind sentinel，清理并资源归零后
   只运行一次完整 `make verify`。
3. 完整门禁退出 `0`、资源归零且 identity 未漂移后，派发 fresh `critical_reviewer`。只有
   `NO BLOCKER` 才完成 L1/K1/上游 blocker/I03，并创建 I04。

## 历史固定证据

## 当前固定证据

- fixed candidate：commit `57d08a5eb9bf911b1552617029885dc91be196f6`，tree
  `9fc486b23120d8278db927b9ad45092ac71a82aa`。
- bind sentinel：`/app/tests/integration/test_migrations.py` 可见，container/checkout integration 文件
  均为 `26`；日志 `/tmp/partsignal-i03-k1-57d08-bind-sentinel.log`，status `0`。
- 唯一完整门禁：`/tmp/partsignal-i03-k1-57d08-make-verify.log`，250,592 bytes，SHA-256
  `b1f7d94f15a35f0d469339f023b1d45384eb04234804804e420f3f89044d4291`，status `0`。
- pre/post 资源 snapshot：2,314 bytes，SHA-256
  `844ea854ef9bb2f2312cf9097997260020a3b3762c303b797192e3e865a2c712`，逐字一致。
- validation checkout identity 未漂移且 clean，随后已精确移除；当前只保留原检出区和候选 worktree。
- fresh review：`BLOCKER`，audit id
  `20260926T134151Z-i03-k1-fixed-candidate-final-critical-review-4656ade3`。

## Fresh review 的两个 P1

1. `frontend/src/app/auth/auth-provider.tsx` 的本地 owner 在 `beginTransition` 后没有同步建立发送页 barrier；
   自己发布的 BroadcastChannel/storage 事件不会自回送，因此首请求延迟期间可启动新的管理员命令，且
   新命令会捕获新 epoch continuation。
2. `frontend/src/domains/identity/user-list-page.tsx` 的 bulk 请求整体在 boundary 外执行；只有解析到
   `result.succeeded` 后才进入边界。服务端已提交 self-disable、但响应丢失时，没有 STARTED/SETTLED、
   epoch、cache/session recovery。

非阻断证据缺口：当前 self reset-password 单元用例构造了服务端合同不可达的 self action；恢复时应
校正该 fixture，不扩大后端权限。

## 下一次恢复顺序

1. 先补发送页反例，证明本地 owner 在 `STARTED` 后、首请求仍被持有时，第二个管理员 mutation 和受保护
   导航当前会越过屏障；再实现不自 abort 的 owned-barrier entrance。
2. 把 auth read、业务 mutation/query、router 与旧 continuation 统一接到本地 active-command barrier；
   精确断言被阻止的新增网络请求为 `0`。
3. 为包含 current actor 的 bulk 命令建立成功、明确失败、unknown transport outcome 三分支；未知结果
   只能由 AuthProvider canonical reconciliation 收敛。
4. 增加真实同一 BrowserContext 双页面 bulk self-disable response-loss 测试，并保留 marker fault、
   ABA、secret scan 与资源清理断言；校正不可达的 self reset-password fixture。
5. 运行最小定向 Vitest、TypeScript/ESLint 和真实栈验证；资源清理后形成新的固定 candidate
   commit/tree。
6. 在另一个新的 `/Users/sc/...` detached checkout bootstrap，先运行 26/26 只读 bind sentinel；
   sentinel 清理和资源归零后，只运行一次完整 `make verify`。
7. 只有完整门禁退出 `0`、资源归零、identity 未漂移，才派发另一名 fresh `critical_reviewer`；只有
   `NO BLOCKER` 才恢复 I03 收尾并创建 I04。

## 禁止事项

- 不重跑 `57d08a5e` 的完整门禁，也不复用已移除的 validation checkout。
- 不以禁用 UI、focus refetch、事后 401/403、TTL 或页面 reload 代替发送页本地 barrier。
- 不把 bulk transport error 一律当成功或一律当明确失败；unknown outcome 必须 canonical reconcile。
- 不在 marker、消息、fixture、日志或响应证据中写入 session binding、CSRF、Cookie、token、密码或凭据。
- reviewer `NO BLOCKER` 前不完成 I03、不创建 I04、不 fetch/push/SSH、不连接 Hostdzire、不执行远程写入。
