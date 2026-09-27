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
