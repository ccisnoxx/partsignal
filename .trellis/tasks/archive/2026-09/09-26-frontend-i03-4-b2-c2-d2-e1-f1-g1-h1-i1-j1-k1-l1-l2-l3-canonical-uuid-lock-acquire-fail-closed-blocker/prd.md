# I03 L3 Blocker canonical UUID 与 Web Lock acquire fail-closed

## Goal

修复 fixed candidate `0cf79209607a7504f6f0f0019d11ee2d682d5b3d` fresh critical review 确认的两个
P1：current actor 使用未规范化、大小写敏感的 UUID 比较；Web Lock 不可用或 acquire 失败时在建立本地
principal barrier 前抛出，使已提交或未知结果的命令可能继续暴露旧 ADMIN 状态。

## Requirements

- current actor、选中项、API request 与 API response 必须使用同一 canonical UUID identity；合法 uppercase UUID
  不得绕过 actor success、actor unknown、self-edit 或其他 principal boundary 判定。
- lock acquisition 失败必须进入 AuthProvider-owned fail-closed 收敛，关闭旧 route/cache/query/mutation/retry/
  offline resume/continuation；不得把取得 lock 失败当作命令未提交，也不得伪造 owner capability。
- bulk unknown reconciliation 继续保持 POST 恰好一次；不得因 lock failure 重发 POST、页面 reload、focus
  refetch、TTL 或后续 401/403 猜测结果。
- 保留 L2 已通过的 bulk 200 精确一一分区、严格 ErrorEnvelope、L1 owner command barrier、durable
  transition/lease 与跨标签页收敛。

## Acceptance Criteria

- [x] uppercase current actor 的 exact success、explicit failure、unknown 和 self-edit 均进入正确三态分支。
- [x] `navigator.locks` 缺失与 `locks.request()` 同步抛出/异步拒绝均在发送页 fail-closed，旧 ADMIN route/cache/continuation
      不恢复；没有伪 owner 或请求风暴。
- [x] 已发出 bulk unknown 场景 POST 恰好一次，canonical reconciliation 尝试次数符合合同，partial feedback
      不把 unknown 冒充 explicit failure。
- [x] 相关 Vitest、TypeScript、ESLint、真实栈 BrowserContext、secret scan 与资源清理通过，形成新候选。
- [ ] 新候选在全新 detached checkout 的唯一完整门禁通过，资源归零且 fresh critical review 为
      `NO BLOCKER`，才允许统一完成 I03。`b7318ef` 的门禁已通过，但 fresh review 为 `BLOCKER`，因此本项未完成。

## Evidence

- 阻断候选：commit `0cf79209607a7504f6f0f0019d11ee2d682d5b3d`；tree
  `35d51a49b39912d7bc45c5b4f6bc00743acfc028`。
- fresh review audit id：`20260926T164042Z-i03-l2-fresh-fixed-candidate-critical-review-23c028b0`。
- 候选唯一完整门禁退出 `0`；日志 SHA-256
  `c73ebad14f9689a43fb85506af12d7876f3768d80d80758d6c50388e0a323040`；该证据只属于阻断候选，不能外推。
- L3 fixed candidate：commit `b7318ef67c40301cc2b2f745e04e7f543e40eab8`；tree
  `4a6c789d5b2687641eeca6c2da4f1ab7e348f4db`。
- 26/26 bind sentinel 退出 `0`；日志 SHA-256
  `7a568218e315269abc11a5eadf1a004a6ce1297f3bb20ac6e6fdbb6696e64931`。
- 唯一完整 `make verify` 退出 `0`；日志 `/tmp/partsignal-i03-l3-b7318ef-make-verify.log`，252,114 bytes，
  SHA-256 `b16c14451d41f82aa577313433b5bfd521edcf5a2f3746156595cbd925642b0c`。backend unit 683、
  Vitest 91 files / 834 tests、PostgreSQL integration 337、real-stack 21、fixture 494 passed / 44 skipped；
  secret scan、lifecycle、deploy 与 Compose 门禁通过。
- pre/post resource snapshot 各 2,314 bytes、逐字一致，SHA-256
  `05009caecc2bce2c826ace5920af15a58b8aff2d5ebf29c0b5e03c6af66a5b1d`；受控资源全部为 0。
- fresh review `BLOCKER`：`user-list-page.tsx:271-279` 的 exact current-actor success 在命令 continuation
  stale 时跳过 post-result boundary，却仍标记 handled 并捕获新 continuation。已建立 L4 子 blocker；audit id
  `20260926T170307Z-i03-l3-canonical-uuid-and-lock-fail-closed-9ae850cc`。
