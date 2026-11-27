# L2 实现与恢复顺序

1. 读取 OpenAPI bulk success/error schema、`user.api.ts` 请求实现、页面三态分支和现有 identity/真实栈测试。
2. 在 API 边界加入原请求到响应的精确一一分区与目标状态验证；严格解析 4xx ErrorEnvelope。
3. 让所有语义不完整或畸形响应进入专用 unknown outcome；current actor 精确 failure 保持不触发边界。
4. 增加遗漏、重复、交叉、外来 ID、错误成功状态、缺失 `details` 与合同外字段的精确测试；断言 POST
   不重放、reconciliation 次数唯一。
5. 运行相关 Vitest、TypeScript、ESLint、真实栈 BrowserContext 与资源清理，形成新 fixed candidate。
6. 在全新 `/Users/sc/...` detached checkout bootstrap，执行 26/26 bind sentinel；清理与资源归零后仅运行
   一次完整 `make verify`，再核对 identity、工作区和资源。
7. 只有完整门禁退出 `0` 且资源归零才派发 fresh `critical_reviewer`；只有 `NO BLOCKER` 才完成
   L2/L1/K1/上游 blocker/I03，并进入 I04。

禁止重跑 `3513db09` 的完整门禁、复用已移除 validation checkout、手工放宽后端合同、把 malformed 响应
当成功或明确失败，以及在 NO BLOCKER 前进行 fetch/push/SSH/Hostdzire 操作。

## 已完成实现

- `user.api.ts` 在 POST 前严格解析并规范化 bulk request，拒绝非法、重复及大小写不同但 identity 相同的
  UUID；请求发出后不做任何 replay。
- 200 响应在 strict shape parse 后按规范化请求 ID 验证精确一一分区，并校验每个 success 的
  `is_active` 已达到目标状态；遗漏、重复、交叉、外来 ID、错误目标状态和畸形 JSON/shape 均抛
  `UserBulkStatusUnknownOutcomeError`。
- 400/401/403/422 只有严格满足 OpenAPI `ErrorEnvelope` 与 nested `ErrorDetail` 的 required/type/
  additional-properties 规则时才进入 explicit failure；畸形信封与意外状态进入 unknown outcome。
- 页面既有三态和 AuthProvider owner 未改变：actor success 进入 principal boundary，actor failure 保留
  canonical session，actor unknown 只 reconciliation 一次；POST 始终恰好一次。
- `.trellis/spec/frontend/state-management.md` 已记录精确分区、严格信封和不重发合同。

## 定向证据

- Vitest：`providers/query-client/auth-provider/user-list-page`，`4 files / 114 tests`，skip `0`，status `0`；
  `/tmp/partsignal-i03-l2-targeted-vitest.log`，456 bytes，SHA-256
  `520b067398f6cd9ab359d8bb89538e538d11f708aa13548d3ddaff1b59cb8f96`。
- TypeScript status `0`：`/tmp/partsignal-i03-l2-targeted-typecheck.log`，67 bytes，SHA-256
  `8477c7fd19e83d96189389c781883aebc77712d52c0de19c573ad4bf5e0d7d6b`。
- ESLint status `0`：`/tmp/partsignal-i03-l2-targeted-eslint.log`，144 bytes，SHA-256
  `e1d2b69f2a3d6d5db02aea98ae61f1a6b8d01f26327d89cd0c0311d1db347f9b`。
- runtime OpenAPI + generated types status `0`：`/tmp/partsignal-i03-l2-contract-check.log`，537 bytes，
  SHA-256 `90c8ab646a7f67456f9753950505940f410c02cb2048ea9a38bdd8dc37fdfe40`。
- system-admin real stack：`2 passed / 0 skipped`，bulk response-loss 使用同一 BrowserContext 两页，secret
  scan clean，status `0`；`/tmp/partsignal-i03-l2-system-admin-real-stack.log`，39,068 bytes，SHA-256
  `1a7628c82b76cc528ad91fc58bd71d890e7662eaef15b20f5826deda3cab3c46`。
- 运行前后资源日志均为 2,314 bytes、SHA-256
  `d65efb68838d0510e8da8ac32c35006d2370e934fd006de17b7e226ce839294d`，逐字一致；端口
  8000/9001/4174/19009、Redis DB 14、`partsignal_e2e_%` 数据库、storage/secret/lifecycle/deploy 临时目录
  与 test containers 全部为 `0`。`git diff --check` status `0`。

## 固定候选与唯一完整门禁

- 本地修复提交：`0cf79209607a7504f6f0f0019d11ee2d682d5b3d`；parent
  `3513db0968af4dd522ae62d2a7feb385055baa3f`；tree
  `35d51a49b39912d7bc45c5b4f6bc00743acfc028`。
- bootstrap：`/tmp/partsignal-i03-l2-0cf79209-bootstrap.log`，3,205 bytes，SHA-256
  `e6d5439611f12faf754b4d111af867bfa0adb279bb81403c0adb47fb4c81f4f5`，status `0`。
- bind sentinel：host/container integration 文件均为 `26`，container 内
  `/app/tests/integration/test_migrations.py` 可见；日志
  `/tmp/partsignal-i03-l2-0cf79209-bind-sentinel.log`，223 bytes，SHA-256
  `0380004e017135737aee8bad6473cc53755745251a6744ffb5e857981a269d17`，status `0`。
- 唯一完整 `make verify`：`/tmp/partsignal-i03-l2-0cf79209-make-verify.log`，251,941 bytes，SHA-256
  `c73ebad14f9689a43fb85506af12d7876f3768d80d80758d6c50388e0a323040`，status `0`。backend unit
  `683`、Vitest `91 files / 824 tests`、PostgreSQL integration `337`、real-stack Playwright
  `21 passed`、fixture Playwright `494 passed / 44 skipped`，其余 contract/types、lint/typecheck、构建、
  lifecycle、两次 secret scan、deploy harness、TMPDIR cleanup 与 Compose 门禁全部通过。
- pre/post resource snapshot 均为 2,314 bytes、SHA-256
  `170a5696b088b17beb9451f0715309d5305aa39776bb8b0371b00b784c465d0a`，逐字一致；受控资源全部为 `0`。
- 门禁后 HEAD/tree 未漂移，tracked/non-ignored untracked 为空，`git diff --check` 通过。
- fresh review 后 validation checkout 已用 `git worktree remove` 安全移除并执行 `git worktree prune`；最终
  资源日志 `/tmp/partsignal-i03-l2-0cf79209-resource-final.log` 为 2,314 bytes、SHA-256
  `170a5696b088b17beb9451f0715309d5305aa39776bb8b0371b00b784c465d0a`，与门禁 pre/post 快照一致且全部为零。

## Fresh review 阻断与恢复顺序

fresh `critical_reviewer` 结论为 `BLOCKER`，audit id
`20260926T164042Z-i03-l2-fresh-fixed-candidate-critical-review-23c028b0`：

1. `user-list-page.tsx` 使用大小写敏感的原始 UUID 比较 current actor，而 `user.api.ts` 已把请求和响应 UUID
   规范化为小写；合法 uppercase UUID 可使 actor success/unknown/self-edit 跳过正确边界。
2. `beginTransition()` 在 `channel.acquire()` 成功后才建立本地 barrier；浏览器没有 Web Lock 或
   `locks.request()` 拒绝时会在 fail-closed 前抛出。对已发出的 bulk unknown reconciliation，这会留下旧
   ADMIN route/cache/continuation。

L3 必须统一 current-actor canonical identity，并保证 owner lock acquisition 失败也立即、持久地
fail-closed；补 uppercase actor 与 Web Lock 缺失/拒绝的确定性测试后重新形成候选。不得在本会话修改实现、
重跑完整门禁、完成 I03 或创建 I04。
