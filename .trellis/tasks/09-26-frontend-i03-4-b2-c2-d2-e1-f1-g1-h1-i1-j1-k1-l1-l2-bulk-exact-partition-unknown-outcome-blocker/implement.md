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

## 下一步

精确审查并创建一个包含 L1/L2 Trellis 记录、L2 生产/测试代码和稳定状态规范的本地修复提交。然后只在
新的 `/Users/sc/...` detached checkout 执行 bind sentinel、资源前置核对和唯一一次完整 `make verify`；
完整门禁成功且 identity/资源不漂移后才安排 fresh 独立高风险复核。
