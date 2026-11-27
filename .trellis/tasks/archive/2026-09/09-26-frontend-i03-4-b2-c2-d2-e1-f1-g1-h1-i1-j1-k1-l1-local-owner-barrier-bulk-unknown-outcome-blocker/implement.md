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

## 当前状态

- L1 实现已收敛为 fixed candidate `3513db0968af4dd522ae62d2a7feb385055baa3f`，tree
  `997e4973d1927fd28dacc05c570a7ebfa71138c9`。
- 全新 detached checkout 的 bootstrap、26/26 bind sentinel、唯一一次完整 `make verify`、资源归零和
  identity 检查全部通过；validation checkout 已精确移除。
- fresh `critical_reviewer` 给出 `BLOCKER`，因此 L1、K1、上游 blocker 与 I03 均保持
  `in_progress`，I04 不存在，未 fetch/push/SSH，也没有任何 Hostdzire 写入。

## 历史固定证据

## 当前固定证据

- L1 fixed candidate：commit `3513db0968af4dd522ae62d2a7feb385055baa3f`，tree
  `997e4973d1927fd28dacc05c570a7ebfa71138c9`。
- bind sentinel：`/app/tests/integration/test_migrations.py` 可见，container/checkout integration 文件均为
  `26`；日志 `/tmp/partsignal-i03-l1-3513db-bind-sentinel.log`，223 bytes，SHA-256
  `23274752095695d3916194e5893cebb4ff8f1b218da2a77513158748015e8930`，status `0`。
- 唯一完整门禁：`/tmp/partsignal-i03-l1-3513db-make-verify.log`，251,816 bytes，SHA-256
  `d9a148266f99a8a2d2804a8d50dac1dc7790ac3ae4769e03f987abc6f9b760b3`，status `0`。
- pre/post resource snapshot：2,314 bytes，SHA-256
  `d65efb68838d0510e8da8ac32c35006d2370e934fd006de17b7e226ce839294d`，逐字一致且资源归零。
- validation identity 未漂移、tracked/non-ignored untracked 为空、`git diff --check` 通过；checkout 已移除。
- fresh review：`BLOCKER`；audit id
  `20260926T145246Z-i03-l1-auth-owner-barrier-implementation-cc18ecda`。

## L1 fresh review 的 P1

`frontend/src/domains/identity/user.api.ts` 的 bulk 200 runtime schema 只检查字段形状，没有根据原请求验证
精确一一分区。形状合法但遗漏 current actor 的 `{"succeeded":[],"failures":[]}` 会被页面当成明确未变更，
从而跳过 `runAuthBoundary()` 与 `reconcileAuthBoundary()`。此外 4xx `ErrorEnvelope` 没有严格要求合同字段
`details` 并拒绝合同外结构，畸形错误也可能被误判为明确失败。若服务端实际已提交 self-disable，两个页面
会继续保留旧 ADMIN session、route、cache 与 continuation。

L2 必须在 API 边界验证：无遗漏、重复、交叉、外来 ID，成功项状态与请求一致；只有 current actor 精确
出现在 `failures` 才是 explicit failure，其他无法证明的结果一律由 AuthProvider canonical reconciliation
收敛，且不得重发 POST。

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

1. 在 API 边界对 bulk 200 响应与原始请求执行精确一一分区和目标状态校验，并严格解析 4xx
   `ErrorEnvelope`；不能证明 current actor 明确失败的 malformed/semantic-invalid 响应归入 unknown。
2. 增加遗漏、重复、交叉、外来 ID、错误成功状态和缺少 `details` 的 4xx 测试；断言 POST 一次、
   unknown 恰好一次 Provider reconciliation、精确 current-actor failure 不触发 boundary。
3. 运行最小定向 Vitest、TypeScript/ESLint 与真实栈验证，完成资源清理后形成新 fixed candidate
   commit/tree；本轮 Trellis 记录随候选一起收敛，不单独制造暂停提交。
4. 在另一个新的 `/Users/sc/...` detached checkout bootstrap，先运行 26/26 bind sentinel；sentinel 清理和
   资源归零后，只运行一次完整 `make verify`。
5. 只有完整门禁退出 `0`、资源归零且 identity 未漂移，才派发另一名 fresh `critical_reviewer`；只有
   `NO BLOCKER` 才依次完成 L2、L1、K1、上游 blocker 和 I03，然后创建 I04。

## L2 定向修复交接

- L2 已在 API 边界补齐请求 identity 前置拒绝、200 精确一一分区/目标状态校验与 strict OpenAPI
  `ErrorEnvelope` 分类；unknown 不重发 POST，只进入一次 Provider-owned reconciliation。
- 定向证据全部通过：Vitest `4 files / 114 tests / 0 skipped`，TypeScript、ESLint、contract/generated
  check 均 status `0`；system-admin real stack `2 passed / 0 skipped`，secret scan clean。
- 真实栈前后资源日志逐字一致，端口、Redis DB 14、E2E 数据库、storage/secret/lifecycle/deploy 临时目录
  与测试容器全部为零；`git diff --check` status `0`。
- 下一步只创建 L2 fixed candidate，然后在全新 detached checkout 执行本候选唯一一次完整门禁；此前
  L1 `3513db09` 的成功门禁不外推到 L2。

## 禁止事项

- 不重跑 `3513db09` 的完整门禁，也不复用已移除的 validation checkout。
- 不以禁用 UI、focus refetch、事后 401/403、TTL 或页面 reload 代替发送页本地 barrier。
- 不把 bulk transport error 一律当成功或一律当明确失败；unknown outcome 必须 canonical reconcile。
- 不在 marker、消息、fixture、日志或响应证据中写入 session binding、CSRF、Cookie、token、密码或凭据。
- reviewer `NO BLOCKER` 前不完成 I03、不创建 I04、不 fetch/push/SSH、不连接 Hostdzire、不执行远程写入。

## L2 fixed candidate fresh review 交接

- fixed candidate：commit `0cf79209607a7504f6f0f0019d11ee2d682d5b3d`；tree
  `35d51a49b39912d7bc45c5b4f6bc00743acfc028`。
- 唯一完整门禁退出 `0`；日志 `/tmp/partsignal-i03-l2-0cf79209-make-verify.log`，251,941 bytes，SHA-256
  `c73ebad14f9689a43fb85506af12d7876f3768d80d80758d6c50388e0a323040`。bind sentinel `26/26`，前后资源
  snapshot 逐字一致且全部归零。
- fresh review 结论 `BLOCKER`，audit id
  `20260926T164042Z-i03-l2-fresh-fixed-candidate-critical-review-23c028b0`。两个 P1 是 current-actor UUID
  大小写 identity 漂移，以及 Web Lock acquire 失败发生在 fail-closed barrier 之前。
- review audit bundle 已 finalize 且 verify `passed`；validation checkout 已安全移除并 prune，最终资源快照
  与门禁 pre/post 相同且全部为零。
- 已创建 L3 唯一叶子。下一会话先修复并定向验证 L3，再形成新候选；不能外推或重跑本次
  `0cf79209` 完整门禁。
