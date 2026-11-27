# I03-4-B2-C2-D2-E1-F1-G1-H1-I1-J1 Blocker Docker 可共享路径 validation checkout 预检

## Goal

固定候选 3d8d857a 的唯一一次 make verify 在 PostgreSQL integration 前失败：宿主 checkout 位于 /private/tmp 且有 26 个 tracked integration 文件，但 Docker Desktop bind mount /app 仅 1 个条目、tests/integration 不存在。需在 Docker 可共享的 /Users 路径创建新 detached checkout，并在完整门禁前做只读 bind-mount sentinel。

## Requirements

- 下一次 validation checkout 必须创建在 Docker Desktop 已共享的 `/Users/sc/...` 路径下，不得再使用解析到 `/private/tmp` 的目录。
- bootstrap 后、完整门禁前，使用权威 `deploy/compose.dev.yaml` 的 `backend-test` service 执行只读 bind-mount sentinel，确认容器内 `/app/tests/integration` 存在且能看到宿主 tracked integration 文件。
- sentinel 只能验证挂载可见性，不运行 integration suite、不改变数据库、不替代 `make verify`；失败时必须在完整门禁前停止并清理 checkout。
- 不修改 Compose volume、Makefile 或测试路径来适配不可共享的临时目录；仓库配置已经正确解析为 checkout 的绝对 backend 路径。
- `3d8d857a` 已消耗其唯一一次完整门禁，禁止重跑。恢复时先把本 blocker 记录纳入新的固定 commit/tree，再创建新的 detached checkout。
- 新 checkout 的资源前置检查和 bind sentinel 全部通过后，才允许执行一次完整 `make verify`；只有退出 0、资源归零后才派发 fresh `critical_reviewer`。

## Acceptance Criteria

- [x] 新固定候选形成，候选工作区 clean，原检出区仍为 clean 的固定 main。
- [x] `/Users/sc/...` 下的新 detached checkout identity 精确匹配，bootstrap 只产生 ignored 内容。
- [x] 完整门禁前的 disposable `backend-test` sentinel 能看到 `/app/tests/integration` 和精确 tracked 文件，容器清理完成。
- [x] 新 checkout 中唯一一次完整 `make verify` 退出 0，门禁前后资源为 0。
- [ ] fresh `critical_reviewer` 给出 `NO BLOCKER`。

## Notes

- 触发候选：commit `3d8d857a7c5c457f2d02056e6ebdf6377a762c52`，tree `ac10b6ec0cb41a2e50a3192614883011edefd95f`。
- 该候选完整门禁中 contract、lint、typecheck、backend unit `683 passed`、frontend Vitest `91 files / 794 tests passed`；随后 `backend-test` 报 `tests/integration` 不存在并退出 4，顶层退出 2。
- 宿主 checkout 的 `backend/tests/integration` 有 26 个 tracked 文件；Compose config 将 bind source 正确解析为 `/private/tmp/.../backend`。只读诊断容器显示 `/app` 存在但只有 1 个条目，`/app/tests/integration` 不存在，证明 Docker Desktop 未共享该临时路径。
- 门禁日志 `/tmp/partsignal-i03-i1-3d8d-make-verify.log`：3,602 bytes，SHA-256 `b190c54b523b1191900a2fcb7dd0f62fc50f325d2184b1759a5e05aed615383d`；状态文件内容 `2`，SHA-256 `53c234e5e8472b6ac51c1ae1cab3fe06fad053beb8ebfd8977b010655bfdd3c3`。
- 门禁前后资源日志均为 2,314 bytes、逐字节相同，SHA-256 `9a95d8f158ff5b54732f62bc57f4a7314dccde4a1a0021d9d103b2fc1d3f2ba4`；validation checkout 已移除。
- 未派发 reviewer；I04 未创建；未 fetch、push、SSH、连接 Hostdzire 或执行远程写入。
- J1 恢复已形成 fixed candidate `d10217f2177f7dc47f4df6acfcaedb2c451cc3ef` / tree
  `3fd475c313a2b6c2e4ad515b2d6f7fade22eebf9`。`/Users/sc/...` detached checkout 的 bind sentinel
  证明 container/checkout integration 文件均为 `26`，唯一完整门禁退出 `0`，pre/post 资源逐字一致且
  全部为 `0`，validation checkout 已移除。
- fresh `critical_reviewer` 结论为 `BLOCKER`，确认 unknown terminal 发起页未 canonical 收敛，以及
  当前主体自降权/自停用未推进其他同源标签页 principal boundary。后续转入子任务 K1；I03/I04
  继续暂停，远程写入仍为 `0`。
