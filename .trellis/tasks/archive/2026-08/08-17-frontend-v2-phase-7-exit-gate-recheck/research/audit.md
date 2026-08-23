# Phase 7 Exit Gate Recheck 审计基线

## 1. 当前结论

当前具备进入纯验证 Recheck 的代码前提：System 抽象回顾提交和四个独立 blocker 修正都已在本地 `main`，各 blocker 的最小 owner 验证已通过。尚不能直接宣告 Phase 7 `MET`，因为四个 blocker 合并后的同一仓库候选还没有完成完整独立阶段和唯一最终 `make verify`。

规划阶段没有运行 unit、integration、build、E2E 或 `make verify`，避免在计划批准前消耗门禁次数或产生外部资源。

## 2. Git 与 Task 证据

| 检查 | 结果 |
| --- | --- |
| 分支 | `main` |
| 创建 Task 前工作树 | clean |
| 当前候选 HEAD | `24cc8f81 test(frontend-v2): align platform type permission e2e ownership` |
| System review | `ab748d02` 是 HEAD 祖先 |
| Backend fixture blocker | `9feffdc5` 是 HEAD 祖先 |
| Auth harness blocker | `b4c02fb0` 是 HEAD 祖先 |
| Fact Review blocker | `79cce8ce` 是 HEAD 祖先 |
| Platform Types blocker | `24cc8f81` 是 HEAD |
| 计划态 dirty set | 当前 Task 目录 + 父任务 child link |
| 禁止操作 | 未 pull、push、PR、历史改写、创建分支/worktree或运行门禁 |

## 3. 前一轮失败与 owner 闭环

| 原失败阶段 | 原症状 | 当前 owner 修正 |
| --- | --- | --- |
| backend unit | `ResetPasswordRequest` fixture 缺必填 revision | `9feffdc5` 只修测试 fixture |
| frontend-v2 unit | 19 个 generated-route harness 未 seed canonical Auth Query | `b4c02fb0` 统一 21 个真实消费者到 test-only Auth helper |
| frontend-v2 fixture E2E | Fact Review 仍期待过期 revision | `79cce8ce` 修正 fixture 时序并新增真实 409 Flow D |
| frontend-v2 fixture E2E | Platform Types route 已拒绝但测试等待业务 GET | `24cc8f81` 精确断言 loader 未运行并删除死 403 glue |

没有一个 blocker 改变 OpenAPI、数据库、权限或服务端状态机。Fact Review 对 `deploy/scripts/e2e-local.sh` 的定向 selector 变更已由脚本语法、定向真实栈和精确 cleanup 验证；完整默认 runner 仍必须由本 Recheck 的 `make e2e` 证明。

## 4. 权威 gate 结构

根 `Makefile` 定义：

```text
verify
  -> contract-check
  -> lint
  -> typecheck
  -> test-unit
  -> test-integration
  -> build
  -> e2e
  -> dev compose config
  -> prod compose config
```

`verify` 是 fail-fast。按已批准的全局诊断规则，本 Task 先独立运行全部阶段并集中归因；只有全部通过才运行一次最终 `make verify`。独立执行不是新的测试体系，而是调用同一 Make owner 暴露会被早期失败遮蔽的后续阶段。

## 5. 环境与敏感边界

- `.env` 只检查存在，不输出内容。
- integration 复用 Compose `backend-test` owner；不手工清理数据库或容器。
- `make e2e` 复用 `e2e-local.sh` 的独占非 0 Redis DB、allowlisted 临时数据库、`mktemp` storage、固定端口 preflight 与 EXIT cleanup。
- 未知 port/process/Redis/database/storage owner 只报告，不 kill、不 flush、不宽泛删除。
- 结果记录只保留 stage、exit code、通过/失败/跳过计数、耗时和脱敏 cleanup status；不复制完整 headers、请求正文或 credential。

## 6. 文档当前缺口

- `docs/frontend-v2/07-migration-plan.md` 的 Phase 7 仍只记录四个交付任务，并写明下一项为 System 抽象回顾；尚无最终抽象回顾/Recheck 结论。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md` 已记录 System Users、Audit、Auth、Admin real-stack，但尚无 System abstraction review 与 Phase 7 最终 gate 小节。
- 只有最终 `make verify` 成功后才补充上述事实；失败证据留在本 Task 与父 Task，不把 07/08 提前写成 `MET`。

## 7. 当前风险

1. 完整 stage 可能暴露四个 blocker 之外的新 owner；Recheck 只能归因，不能修复。
2. `make e2e` 与最终 `make verify` 都会运行完整真实栈和 fixture suite，耗时较长；这是用户明确要求的候选前置与最终确认，不通过额外定向重跑扩大次数。
3. E2E 环境冲突或 cleanup 失败本身使 Gate `NOT_MET`；不能用共享 Redis、外部 5173 listener 或残留资源继续制造无效结果。

## 8. 独立诊断结果

| 阶段 | 结果 | 关键证据 |
| --- | --- | --- |
| `make contract-check` | PASS | exit 0 |
| `make lint` | PASS | exit 0 |
| `make typecheck` | PASS | exit 0 |
| `make test-unit` | PASS | backend 201、V1 205、visual 24、V2 457 全部通过 |
| `make test-integration` | PASS | PostgreSQL `117 passed / 146.54s` |
| `make build` | PASS | backend、V1、V2 production build 通过 |
| `make e2e` | PASS | V2 real-stack 16、V1 52、V2 fixture 379 passed / 33 skipped |
| dev/prod Compose config | PASS | 两条 `config --quiet` 均 exit 0 |

E2E 使用从 `.env` 读取但不输出的数据库配置，并仅把容器 hostname 转为宿主机地址；Redis 使用既有允许的非 0 DB 14。三次未满足既有 preflight 的环境探测均在资源创建前退出，修正宿主机连接参数后才执行有效门禁，不涉及代码或配置变更。有效运行的 cleanup 为 Redis `status=deleted`、ports `status=released`、database `status=dropped`、storage `status=removed`。

System/Auth sensitive-path secret artifact assertions 通过，real-stack trace 保持关闭；成功路径未生成 Playwright failure trace/video/report。Task evidence 不保存 credential、请求 header/body、storage state 或临时签名值。

## 9. 唯一最终 Gate

候选在独立阶段后没有 source SHA 变化。唯一一次实际 `make verify` 退出 `0`、总耗时 `19:23.64`；各阶段计数如下：

- backend unit `201 passed / 6.35s`；
- V1 unit `205 passed / 254.86s`，visual contract `24 passed`；
- V2 unit `457 passed / 15.48s`；
- PostgreSQL integration `117 passed / 144.91s`；
- V2 real-stack `16 passed / 1.2m`、V1 E2E `52 passed / 5.5m`、V2 fixture `379 passed / 33 skipped / 4.6m`；
- backend/V1/V2 build 与 dev/prod Compose config 通过；最终 cleanup 全部完成。

最终命令前有一次 shell wrapper 语法检查错误，发生在 `make verify` 进程及任何测试资源启动之前；修正 wrapper 后才执行上述唯一一次实际 gate，因此没有第二次 gate 或机械重跑。

## 10. Phase 7 Exit Gate

**判定：`MET`。** 四个原 blocker 已在同一候选集成通过；八项 System shared invariant 无新反证，未发现新的独立 owner blocker，open P0/P1/P2=`0/0/0`。07/08 只在最终 gate exit 0 后同步；本结论不启动 Phase 8。

收尾检查中两个 Task validation 均 exit 0。全量 `git diff --check` 的两条诊断只来自任务启动前已确认的用户 EOF 空行；排除 `AGENTS.md` 与 07 的既有 EOF hunk后，本任务差异无 whitespace 错误。该用户 hunk 保持未改，提交计划要求选择性暂存。
