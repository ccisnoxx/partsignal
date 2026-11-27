# I03-4-B2-C2-D2-E1-F1-G1 Blocker 跨标签页孤儿 STARTED 永久锁死

## Goal

固定候选 94fd8aae 的唯一一次完整 make verify 与资源清理均通过，但 fresh critical review 发现认证 transition 发布 STARTED 后发送页崩溃或关闭会留下无 owner、租约或孤儿回收的持久 marker，导致所有标签页和重载永久关闭 canonical session read barrier。

## Requirements

- `STARTED` 必须具有可判定且 crash-safe 的 owner/租约；发送页崩溃、关闭、浏览器终止或永久离线时，其他标签页和重载页面必须能识别并回收孤儿，而不依赖销毁时执行 `finally`。
- 孤儿回收必须先推进认证 transition generation 与 principal epoch、使旧 read/mutation/callback/retry/offline continuation 继续失效并清理非 auth QueryCache，然后才允许 canonical `/api/v1/auth/session` 收敛。
- 不得简单忽略、删除或按固定时间无条件放过 `STARTED`，以免真实仍在进行的 session replacement 重新打开旧主体窗口。
- marker/channel payload 不得携带 user、CSRF、Cookie、token、密码、session secret 或其他凭据；持久状态必须有明确版本、owner、租约与回收语义。
- 必须覆盖存活标签页观察发送页在 `STARTED` 后关闭/崩溃，以及全部标签页关闭后重新打开的恢复路径；证明不会永久 auth error、不会恢复旧主体、不会形成 refetch storm。
- 保留现有 A→B/ABA、迟到 continuation、权限降级、退出、改密、请求流量和 secret scan 合同。
- 修复后运行定向单元与同一 BrowserContext 双页面真实栈验证并清理资源；形成新的固定 commit/tree，再在又一个全新 detached checkout 中只运行一次完整 `make verify`。
- 只有完整门禁退出 0、门禁后资源为 0 且另一名 fresh `critical_reviewer` 给出 `NO BLOCKER`，才允许完成 F1/E1/D2/I03 父链并创建 I04。

## Acceptance Criteria

- [x] orphan `STARTED` 的 owner、租约、回收和 canonical refetch 由单一明确 owner 实现，且不能重开旧主体窗口。
- [x] 单元测试覆盖 marker 版本/有效期、active lease、孤儿回收、去重和无秘密 payload。
- [x] 同一 BrowserContext 真实栈覆盖发送页在 `STARTED` 后终止、存活页恢复及全页面重载恢复，并证明无旧主体恢复、无请求风暴和 secret artifact。
- [x] 定向验证与完整资源清理通过，并形成新的固定 commit/tree。
- [x] 全新 detached checkout 中唯一一次完整 `make verify` 退出 0，门禁前后资源全部为 0。
- [ ] fresh `critical_reviewer` 给出 `NO BLOCKER`。

## Notes

- 触发候选：commit `94fd8aaecfc683b9117764a879658731e91f88e6`，tree `23d67ad5c778a1a7115de262626f52afad8f6546`。
- fresh critical review 审计 Bundle：`20260926T093221Z-i03-e1-f1-final-critical-review-591abf2a`，结论 `BLOCKER`。
- 关键位置：`frontend/src/app/auth/auth-transition-channel.ts:57-59`、`frontend/src/app/auth/auth-provider.tsx:215-227`、`frontend/src/app/auth/auth-provider.tsx:337-347`。
- 完整门禁退出 0 与资源清理证据有效；本 blocker 来自绿色门禁未覆盖的发送方 crash/close 生命周期反例。
- 定向实现采用 v2 durable marker、origin-scoped 独占 Web Lock 和 10 秒可续租 lease；Web Lock 证明 active owner，lease 仅界定取得锁后的持久恢复等待，不依赖页面销毁回调。
- 最终定向真实栈第三轮通过 3 个用例（含原有 ABA、新增 crash/reload 与正常 auth flow），日志 `/tmp/partsignal-i03-g1-auth-real-stack-r3.log` 为 30,705 bytes，SHA-256 `d7bd64ffa4bfc9cf0ecd3f0168d2efa67d6cffdec4e9e677e2f5e96db0ec613a`；状态 0，状态文件 SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`。
- 定向验证后资源日志 `/tmp/partsignal-i03-g1-targeted-resource-post.log` 为 1,686 bytes，SHA-256 `16b58ab4bdf15f1faa16e2669a4be22f885b32a0f7137d9b95c9585924e3ae16`；原始 TMPDIR、canonical TMPDIR、`/tmp`、四端口、Redis DB 14、E2E 数据库和 frontend test containers 全部为 0。
- 前两轮非绿色结果均保留：第一轮暴露重载在 unresolved `STARTED` 下提前 auth read 的真实 owner 缺口；第二轮暴露测试等待落在默认 5 秒而实现 lease 为 10 秒。分别修复 owner barrier 与精确等待后才运行第三轮；未无诊断重复门禁。
- I04 未创建；未 fetch、push、SSH、连接 Hostdzire 或执行任何远程写入。
- G1 固定候选为 commit `e35c402efcce990ce3345ab6e89755f11bb008e0`、tree `6f16122f37e79a956798feb9d3552c2df455e945`。全新 detached checkout 的唯一一次完整 `make verify` 退出 0；日志 `/tmp/partsignal-i03-g1-e35c-make-verify.log` 为 244,408 bytes，SHA-256 `f510170ee5fc69ef6e7d6e4cc054a4417abd91eb18b406815518a9be8efe25e5`；状态文件 SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`。
- 门禁前后资源日志均为 1,686 bytes 且 SHA-256 同为 `e2b7931e1626fef71eb9d0535608b799230d4a372a32c94fb5665afb0aaf67a9`；全部受控临时资源、四端口、Redis DB 14、E2E 数据库和测试容器为 0；validation worktree 已移除。
- fresh critical review 审计 Bundle `20260926T102735Z-i03-g1-final-critical-review-09a780fd` 结论为 `BLOCKER`：durable `SETTLED` 未作为权威状态重放、错过终态可使 transition ID 永久残留，且畸形/未知/不可读 marker 被折叠为“无 marker”而 fail-open。已建立 H1 子 blocker；本次绿色门禁不得复用于 H1 修改后的候选。
