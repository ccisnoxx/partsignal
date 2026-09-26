# I1 恢复点

## 当前状态

固定候选 `39b1d0f9cc371c2055adae082ce152a255005ab3` / tree `8c2bb5098f89b5cd58cdd138b10c437f0eb48f05` 已完成 H1 实现与定向验证，但其唯一一次 clean-checkout `make verify` 在 frontend Vitest 阶段退出 `2`。按门禁合同，本会话未修复、未重跑完整门禁、未派发 reviewer，也未进入 I04。

## 已确认事实

1. contract/runtime/generated types、Ruff、ESLint、mypy、TypeScript 和 backend unit 已通过；backend unit 为 `683 passed`。
2. frontend Vitest 为 `90 passed / 1 failed files`、`785 passed / 9 failed tests`。
3. 第一个失败是 `providers.test.tsx:292` 等待 active login transition 期间的第二次 `/api/v1/auth/session` GET；H1 的 pre-request barrier 正确阻止了该请求。
4. 该超时留下未完成命令的 durable `STARTED`，而 `providers.test.tsx` 的 `afterEach` 只清 QueryClient 和 mocks，没有清 transition storage；后八项失败是同一污染的级联表现。
5. 完整资源前后快照逐字节一致且全部为 0；detached validation checkout 已精确移除。

## 下一步

1. 在 J1 中把当前暂停记录形成新固定 commit/tree；`3d8d857a` 已消耗唯一完整门禁，不得重跑。
2. 在 `/Users/sc/...` Docker 可共享路径建立新的 detached checkout，并在完整门禁前通过 disposable bind-mount sentinel。
3. sentinel 与资源清理成立后，只运行一次完整 `make verify`；只有退出 0 才派发 fresh `critical_reviewer`。

## 证据

- `/tmp/partsignal-i03-h1-39b1-make-verify.log`：25,236 bytes，SHA-256 `1b177a983fc4fd37729876713a8e9e3aa49ce851cd8b269928025fb6c6486651`。
- `/tmp/partsignal-i03-h1-39b1-make-verify.status`：内容 `2`，SHA-256 `53c234e5e8472b6ac51c1ae1cab3fe06fad053beb8ebfd8977b010655bfdd3c3`。
- `/tmp/partsignal-i03-h1-39b1-resource-pre.log` 与 `/tmp/partsignal-i03-h1-39b1-resource-post.log`：各 2,314 bytes，SHA-256 均为 `b438f95e4daf88e58848c7f8797541c0376567f008296473f5afe4d1822f61f1`。
- I1 定向 Vitest `/tmp/partsignal-i03-i1-targeted-vitest.log`：2 files / 54 tests passed，SHA-256 `a05a929e3439eb5e1e4d9f2557e32755d3040a35bcf4f0c500f8e062ef25f814`；状态文件内容 `0`。
- TypeScript 与精确 ESLint 通过；定向资源日志 `/tmp/partsignal-i03-i1-targeted-resource-post.log` 为 2,314 bytes，SHA-256 `b438f95e4daf88e58848c7f8797541c0376567f008296473f5afe4d1822f61f1`，全部受控资源为 0。
- I1 固定候选 `3d8d857a7c5c457f2d02056e6ebdf6377a762c52` / tree `ac10b6ec0cb41a2e50a3192614883011edefd95f` 的唯一完整门禁已证明 backend unit `683 passed`、frontend Vitest `91 files / 794 tests passed`；随后 Docker Desktop 对 `/private/tmp` checkout 的 bind mount 近空，`backend-test` 找不到 `tests/integration`，顶层退出 `2`。
- 该门禁日志 SHA-256 `b190c54b523b1191900a2fcb7dd0f62fc50f325d2184b1759a5e05aed615383d`；资源前后日志逐字节相同，SHA-256 `9a95d8f158ff5b54732f62bc57f4a7314dccde4a1a0021d9d103b2fc1d3f2ba4`；validation checkout 已移除，已建立 J1 blocker。
