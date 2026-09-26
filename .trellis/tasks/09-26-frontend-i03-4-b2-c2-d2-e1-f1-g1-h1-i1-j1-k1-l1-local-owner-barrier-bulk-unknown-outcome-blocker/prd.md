# I03-4-B2-C2-D2-E1-F1-G1-H1-I1-J1-K1-L1 Blocker 本地 owner command barrier 与 bulk 未知结果收敛

## Goal

修复固定候选 `57d08a5eb9bf911b1552617029885dc91be196f6` 的 fresh
`critical_reviewer` 确认的两项 P1：本地 transition owner 在写入 `STARTED` 后未立即关闭发送页的
旧 principal command window；bulk self-disable 在服务端已提交但响应丢失时未进入 AuthProvider
拥有的未知 principal 结果收敛。I03 与 I04 在本任务完成并经新候选完整复验前保持暂停。

## Requirements

- `AuthProvider` 发起本地 principal transition 时，必须在业务 side effect 前同步建立发送页本地
  auth barrier、推进 principal epoch、清理非 auth QueryCache，并阻止新的业务命令、认证读取和受保护
  导航；不得依赖 `BroadcastChannel` 或 storage event 自回送。
- 本地 owner barrier 不得中止自己即将发送的受控命令。owner 命令使用明确的内部执行能力；其他在
  `STARTED` 后产生的 mutation、query、navigation 和旧 continuation 必须 fail-closed，直到合法
  commit/reconciliation 与 durable `SETTLED` 完成。
- 增加确定性发送页反例：持有第一个 self-demotion、self-disable 或 logout 请求，在 `STARTED` 后尝试
  第二个管理员 mutation 与受保护导航，精确断言第二个请求网络次数为 `0`，且旧路由、缓存和 principal
  不可恢复。
- bulk status 请求若包含当前 actor，服务端可能已经提交 self-disable、但 transport/abort 使结果未知
  时，必须进入 AuthProvider-owned unknown-principal-result reconciliation。结构化响应明确表明当前 actor
  失败时不得误触发 principal boundary；exact successful target 继续走既有成功边界。
- 增加真实同一 BrowserContext 双页面 bulk self-disable 响应丢失测试：bulk POST 精确一次；两页各自
  只做一次 canonical `/api/v1/auth/session` recovery；旧 ADMIN route/cache/continuation 不可恢复；无
  请求风暴；durable marker 失败保持 fail-closed；secret scan clean。
- 校正或移除与后端权限合同不一致的 self reset-password 单元 fixture；不得为了保留前端用例而扩大
  后端权限或伪造可达行为。
- 保留 durable v1/v2 marker、Web Lock owner/lease、孤儿回收、pre-request barrier、active command
  零 auth read、跨标签页 ABA、原子 session snapshot 和资源清理合同。

## Acceptance Criteria

- [x] 本地 transition owner 在 side effect 发出前已进入发送页 barrier；第一个 owner 命令可执行，后续
      业务 mutation、auth read、导航和旧 continuation 在 terminal 收敛前均被阻止。
- [x] 确定性测试在 `STARTED` 后持有第一个请求并证明第二个管理员 mutation/network request 为 `0`；
      不是只通过隐藏按钮、禁用 UI 或事后 401/403 实现。
- [x] bulk self-disable 的未知 transport outcome 进入唯一 AuthProvider reconciliation；exact structured
      failure 不触发；成功、失败和未知三类结果均有精确请求次数和 phase 断言。
- [x] 同一 BrowserContext 双页面 response-loss 场景通过，POST 一次、每页 canonical recovery 一次、
      无旧 principal/cache/route 恢复、无请求风暴且 secret scan clean。
- [x] 与后端合同不一致的 self reset-password fixture 已校正，未修改或弱化服务端权限合同。
- [x] 定向 Vitest、TypeScript/ESLint、真实栈 BrowserContext 与完整资源清理通过，形成新的固定
      candidate commit/tree。
- [x] 在新的 `/Users/sc/...` detached checkout 中 bootstrap，先通过 26/26 只读 bind sentinel；sentinel
      清理及资源归零后只运行一次完整 `make verify`，退出 `0`、资源归零且 identity 未漂移。
- [ ] fresh `critical_reviewer` 对新候选给出 `NO BLOCKER` 后，才允许完成 I03、创建 I04、fetch/push、
      SSH 或任何 Hostdzire 写入。

## Notes

- 阻断复核 audit id：
  `20260926T134151Z-i03-k1-fixed-candidate-final-critical-review-4656ade3`。
- K1 固定候选完整门禁可信：backend unit `683`、Vitest `91 files / 800 tests`、PostgreSQL
  integration `337`、real-stack Playwright `21 passed`、fixture Playwright
  `494 passed / 44 skipped`，其余构建、lifecycle、secret、deploy harness 与 Compose 门禁均通过。
- 唯一完整门禁日志：`/tmp/partsignal-i03-k1-57d08-make-verify.log`，250,592 bytes，SHA-256
  `b1f7d94f15a35f0d469339f023b1d45384eb04234804804e420f3f89044d4291`，status `0`。
- pre/post 资源 snapshot 均为 2,314 bytes，SHA-256
  `844ea854ef9bb2f2312cf9097997260020a3b3762c303b797192e3e865a2c712`，逐字一致且受控资源全部为 `0`。
- 本轮未创建 I04，未 fetch、push、SSH 或执行任何 Hostdzire 写入。
- L1 定向证据：TypeScript、ESLint 退出 `0`；`providers/query-client/auth-provider/user-list-page`
  `4 files / 94 tests` 通过；真实栈 `system-admin-real-stack.spec.ts` `2 passed`，包含 bulk POST 一次、
  两页各一次 401 canonical recovery、无请求风暴及 secret scan clean。日志
  `/tmp/partsignal-i03-l1-system-admin-real-stack-final.log`，39,000 bytes，SHA-256
  `0e68c2aa688709476bc303d66778063abaedf343730906cda9b22d4f6caf8c0d`；端口、E2E 数据库、Redis DB 14
  与隔离 storage 均已归零。
- 独立并发审计指出并推动补齐 QueryClient query barrier、明确 owner capability、bulk runtime 分类与
  Provider-owned reconciliation；审计代理只读，未修改文件。
- L1 fixed candidate：commit `3513db0968af4dd522ae62d2a7feb385055baa3f`，tree
  `997e4973d1927fd28dacc05c570a7ebfa71138c9`。
- 新 detached checkout 的 bootstrap 与 26/26 bind sentinel 通过；唯一完整 `make verify` 退出 `0`。
  日志 `/tmp/partsignal-i03-l1-3513db-make-verify.log`，251,816 bytes，SHA-256
  `d9a148266f99a8a2d2804a8d50dac1dc7790ac3ae4769e03f987abc6f9b760b3`。pre/post resource snapshot
  均为 2,314 bytes，SHA-256
  `d65efb68838d0510e8da8ac32c35006d2370e934fd006de17b7e226ce839294d`，逐字一致且全部归零；validation
  checkout 已移除。
- fresh `critical_reviewer` 结论为 `BLOCKER`：bulk 200 仅做字段形状校验，未验证请求 ID 在
  `succeeded`/`failures` 中形成无遗漏、无重复、无交叉、无外来 ID 的精确一一分区，也未核对成功项
  `is_active`；malformed 4xx `ErrorEnvelope` 也可能被误判为明确失败。已创建 L2 子任务继续收敛，I03
  与 I04 继续暂停。
- L2 已完成精确分区、目标状态、请求 identity 与严格错误信封修复，并通过 `4 files / 114 tests`、
  TypeScript、ESLint、contract/generated check、system-admin 真实栈 `2 passed`、secret scan 与前后资源
  归零。L2 fixed candidate `0cf79209607a7504f6f0f0019d11ee2d682d5b3d` / tree
  `35d51a49b39912d7bc45c5b4f6bc00743acfc028` 的全新 clean-checkout 唯一完整门禁也通过。
- L2 fresh review 仍为 `BLOCKER`：current-actor UUID 比较未与 API canonical lowercase identity 对齐；Web
  Lock 缺失或 acquire 拒绝会在本地 barrier 建立前抛出。L3 唯一叶子负责这两项 P1；I03/I04 继续暂停。
