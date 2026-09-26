# I03-4-B2-C2-D2-E1-F1-G1-H1 Blocker 持久 transition 收敛与协议 fail-closed

## Goal

固定候选 `e35c402e` 的唯一一次完整 `make verify` 与资源清理均通过，但 fresh critical review 发现认证 transition 仍以即时事件累积推导 barrier，未把 durable terminal marker 当作权威状态；同时未知、畸形、不可读或旧协议 marker 会被折叠为“无 marker”并 fail-open。

## Requirements

- channel 初始化、focus/visibility/storage 恢复和 orphan recovery 必须对当前 durable marker 执行同一个权威 reconciliation；`SETTLED` 不能只被记为已见事件或静默返回。
- Provider 不得用可能永久累积的 transition ID `Set` 推导持久 barrier。错过即时 `SETTLED` 后，读取 durable terminal state 必须淘汰对应或更旧的 transition，并确定性开放恰好一次 canonical `/api/v1/auth/session` 读取。
- 必须覆盖 render 的 lazy initializer 读到 `STARTED`、effect 安装前 marker 已变为 `SETTLED` 的交错；页面不得永久停留在 auth loading/barrier。
- 必须区分 marker key 不存在、marker 存在但格式/版本非法，以及 storage 读取异常。只有确证 key 不存在才能按无 active transition 处理；非法、未知或不可读 marker 必须推进 principal/transition 失效、清业务缓存并保持 barrier 或显式错误，不能启动 canonical read。
- 对旧 v1 key/channel/lock 是否曾进入可运行或 Production 产物给出可核验证据；若不能证明未部署，则实现明确 migration fence 或双协议协调，不允许新旧页面各自持有互不相见的认证状态机。
- 保留 origin-scoped exclusive Web Lock 作为 owner liveness 权威、STARTED-before-side-effect、heartbeat lease、SETTLED-before-release、marker secrecy、session binding epoch、A→B/ABA、迟到 continuation 和权限边界。
- 增加确定性单元与真实同一 BrowserContext 测试：初始化 STARTED→SETTLED 竞态、丢失即时 SETTLED 后 durable 收敛、T1 遗留后 T2、未知/畸形/不可读 marker fail-closed；精确断言 phase/method/path/status/count，不得产生请求风暴。
- 定向验证与完整资源清理通过后形成新的固定 commit/tree；在又一个全新 detached checkout 中只运行一次完整 `make verify`，不得复用 `e35c402e` 的门禁结果。
- 只有新门禁退出 0、门禁后资源为 0 且另一名 fresh `critical_reviewer` 给出 `NO BLOCKER`，才允许完成 H1/G1/F1/E1/D2/I03 并创建 I04。

## Acceptance Criteria

- [x] durable `STARTED/SETTLED` 在所有初始化与恢复入口由单一权威 reconciliation 收敛，错过即时事件不会永久阻塞或重复 auth read。
- [x] marker 缺失与无效/不可读状态被明确区分；未知、畸形和需要迁移的旧协议状态 fail-closed。
- [x] 单元与真实 BrowserContext 测试覆盖 reviewer 的全部确定性交错和精确流量断言，secret scan 与资源清理通过。
- [ ] 形成新固定候选，并在全新 detached checkout 中唯一一次完整 `make verify` 退出 0，门禁前后资源为 0。
- [ ] fresh `critical_reviewer` 给出 `NO BLOCKER`。

## Notes

- 触发候选：commit `e35c402efcce990ce3345ab6e89755f11bb008e0`，tree `6f16122f37e79a956798feb9d3552c2df455e945`。
- 触发审查 Bundle：`20260926T102735Z-i03-g1-final-critical-review-09a780fd`；独立结论为 `BLOCKER`，Bundle 已 finalize/verify。
- P1 反例一：render 从 durable `STARTED` 初始化 barrier，effect 安装前 marker 变为 `SETTLED`；channel baseline 只 remember 不通知 Provider，导致永久 barrier。
- P1 反例二：页面错过 T1 即时 `SETTLED`，recovery 读到 durable terminal 后静默返回；T1 永久留在 Set，后续 T2 收敛也不能开放 auth read。
- P1 反例三：parser/read 把 key 缺失、JSON 损坏、额外字段、未知版本、非法字段和 storage 异常统一为 `null`；Provider 因此启用 canonical read，形成 fail-open。
- 既有完整门禁事实仍有效，但不覆盖上述未建模并发交错。日志 `/tmp/partsignal-i03-g1-e35c-make-verify.log` SHA-256 `f510170ee5fc69ef6e7d6e4cc054a4417abd91eb18b406815518a9be8efe25e5`；门禁前后资源快照 SHA-256 均为 `e2b7931e1626fef71eb9d0535608b799230d4a372a32c94fb5665afb0aaf67a9`。
- I04 未创建；未 fetch、push、SSH、连接 Hostdzire 或执行任何远程写入。
- 实现将 durable read 建模为 `ABSENT | VALID | INVALID(reason=INVALID|LEGACY|UNREADABLE)`；channel 初始化、BroadcastChannel、storage、focus、visibility 与 recovery mismatch 都重新读取同一 durable slot，再由 Provider 的单一 barrier owner reconcile。
- Provider 已移除 transition ID `Set`；最新合法 durable identity/phase 会淘汰旧 T1，新的 terminal state 只触发一次 canonical refetch。marker 无效或不可读会推进 principal/transition 失效、清业务缓存、清 canonical session、展示显式 Auth Error，并在网络请求前拒绝 `/api/v1/auth/session`。
- v1 commit `c99529cf` 不在任何 remote-tracking branch 或 tag，且 `origin/main` 不包含它；实现仍额外检查 `partsignal.auth-transition.v1`，只要存在就 fail-closed，不依赖“未部署”假设放行。
- 定向 TypeScript 与精确 ESLint 通过；Vitest 为 2 files / 44 tests passed。最终真实栈为 4 passed，覆盖初始化 STARTED→SETTLED、T1 terminal 丢失后 T2、未知 v2 与 legacy v1 零 auth read，以及既有 ABA、owner crash/reload 与正常 Auth 流程。
- 最终真实栈日志 `/tmp/partsignal-i03-h1-auth-real-stack-r2.log` 为 31,373 bytes，SHA-256 `2fa4ad93af641256ba261cbf10f1cbd8d72937d5314be7fc17d3f482fcbfb615`；状态文件 SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`。secret scan clean，数据库、存储、Redis 与四端口 cleanup 成功。
