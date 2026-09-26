# L3 恢复顺序

1. 复核 `user-list-page.tsx` 所有 current-actor 比较以及 session/user DTO 的 UUID 来源，建立单一 canonical
   identity 合同并补 uppercase 反例。
2. 复核 `beginTransition()`、`createAuthTransitionChannel().acquire()` 与 `failClosedTransition()` 的所有失败
   路径；在不伪造 lock owner 的前提下让缺失/拒绝 acquire 进入本地 fail-closed 收敛。
3. 增加 LockManager 缺失、`request()` 拒绝及 bulk response-loss/current-actor 交错的精确测试；断言 POST
   一次、无 replay、无旧 ADMIN route/cache/continuation、无请求风暴。
4. 运行最小定向检查和资源清理，形成新的本地 fixed candidate。
5. 只能为新候选创建新的 `/Users/sc/...` detached validation checkout，并只运行一次完整 `make verify`；
   成功后再安排 fresh 独立高风险复核。

禁止修改后端权限语义，禁止外推或重跑 `0cf79209` 的完整门禁，禁止在 `NO BLOCKER` 前完成 I03、创建
I04、fetch/push/SSH 或写入 Hostdzire。

## 已完成实现

- 新增 `shared/lib/canonical-uuid.ts`，由同一 Zod parser 验证并把合法 UUID 规范为小写；认证 session、
  User list、create/update/reset response、单项 path、bulk request/result 与页面 current actor 复用该 owner。
- `UserListPage` 的 refresh、单项启停、bulk includes/success 与 self-edit 均只比较 canonical identity；bulk
  exact failure 保持 explicit failure，transport/abort/malformed 结果仍只进入一次 unknown reconciliation。
- `beginTransition()` 对活动 channel 的 LockManager 缺失、同步抛出和异步拒绝调用既有
  `failClosedTransition()`；未获锁时不返回 owner、不执行 command、不写 durable marker、不发 canonical GET。
- channel 的同步 `locks.request()` 抛出路径也删除 pending controller；Provider 卸载关闭旧 channel 后的
  cancellation 不会重新污染共享 QueryClient barrier。

## 定向验证

- Vitest：`providers/query-client/auth-provider/user-list-page`，`4 files / 124 tests`，status `0`；
  `/tmp/partsignal-i03-l3-targeted-vitest.log`，456 bytes，SHA-256
  `99a9cb00d02b259c0a988321cf11f88a8d991650c53ea8a2852c3017bd26bbcd`。
- TypeScript status `0`；受影响 7 个 source/test 文件 ESLint status `0`；`git diff --check` status `0`。
- system-admin real stack：`2 passed / 0 skipped`，secret scan clean，status `0`；
  `/tmp/partsignal-i03-l3-system-admin-real-stack.log`，39,095 bytes，SHA-256
  `d61f6a6aafc46c38b94f488ada1d7f7af217bdea6cd3e283421dbf73de760623`。
- 真实栈清理确认端口 8000/9001/4174/19009、Redis DB 14、`partsignal_e2e_%` 数据库、storage/secret
  临时目录与测试容器均为 0。

## 下一步

把 L2/L1 既有 Trellis 记录、L3 实现/测试/记录和稳定 spec 组装为新 fixed candidate；只为该 commit 创建
全新 detached validation checkout，先跑 26/26 bind sentinel，再单次执行完整 `make verify`。只有完整门禁、
资源归零和 fresh critical review `NO BLOCKER` 全部成立后才统一关闭阻断链与 I03。
