# Frontend V2 Phase 7 Exit Gate Recheck

## Goal

在四个独立 blocker 已合入本地 `main` 后，对同一个 Phase 7 候选执行完整、可归因且不重复修复的仓库级验证；只有独立阶段全部通过且唯一一次最终 `make verify` 退出 `0`，才把 Phase 7 Exit Gate 从 `NOT_MET` 更新为 `MET`。

本任务是纯验证与证据收口，不开发新产品能力，也不在门禁失败时顺手修改代码或测试。

## Background

`frontend-v2-system-abstraction-review` 在提交 `ab748d02` 后确认 System/Auth 的任务内 P1/P2 已关闭，但仓库级诊断发现四个独立测试 owner blocker，因此未运行最终 `make verify`，Gate 保持 `NOT_MET`。四个 blocker 现已位于 `main`：

| Blocker | Commit | 已完成的定向证据 |
| --- | --- | --- |
| ResetPasswordRequest schema fixture | `9feffdc5` | 补齐必填 `expected_revision`，未改 runtime schema |
| 跨 domain Auth route harness | `b4c02fb0` | 21 files / 158 tests，typecheck、ESLint 通过 |
| Fact Review revision conflict E2E | `79cce8ce` | fixture 10 passed、real-stack 4 passed，cleanup 通过 |
| Platform Types 非管理员 E2E | `24cc8f81` | 定向 2 passed、owner spec 10 passed，typecheck、ESLint 通过 |

创建本 Task 前，`HEAD` 为 `24cc8f81`，上述四个提交及 `ab748d02` 均为其祖先，主工作树干净。创建后只允许当前 Task artifacts 与父任务 child link 形成已知 dirty set。

## Requirements

1. 保持候选产品代码、测试、OpenAPI、数据库、权限合同、公共 API、Makefile、E2E runner、旧 `frontend/` 与 Phase 8/9 不变；Recheck 不拥有任何 blocker 修复。
2. 在 `main` 上验证，不创建分支或 worktree，不 pull、push、PR、历史改写或自动 commit/archive。
3. 最终 gate 前逐项运行 `make verify` 的全部独立阶段：contract-check、lint、typecheck、test-unit、test-integration、build、e2e，以及 dev/prod Compose config；即使某阶段失败，仍完成不依赖该失败且可安全执行的其他阶段，以一次诊断批量暴露当前 blocker。
4. 不重复运行四个 blocker 的定向检查；完整 unit/integration/E2E stage 已覆盖其 owner，定向历史只作为进入 Recheck 的前置证据。
5. `make e2e` 必须继续使用唯一 `deploy/scripts/e2e-local.sh` 隔离 owner；不得输出密码、Cookie、CSRF、Authorization、request body/header 或 storage state。必须观察 database、storage、Redis、port cleanup 状态，未知 owner 或清理失败立即停止后续破坏性动作。
6. 只有所有独立阶段和 Compose config 都退出 `0`、没有未关闭 P0/P1/P2、且候选合理预期通过时，才运行一次且仅一次最终 fail-fast `make verify`。
7. 若任一独立阶段失败或无法安全运行，不执行最终 `make verify`；记录 stage、exit code、最小症状与 owner，维持 `NOT_MET`，并为每个真正独立 owner 建议单独 Task。
8. 若最终 `make verify` 意外非零，不机械重跑；记录失败阶段和 cleanup，维持 `NOT_MET`。除非代码、配置或环境经过独立授权的相关变更，否则不得再次执行完整 gate。
9. 只有最终 gate 退出 `0` 后，才同步 `docs/frontend-v2/07-migration-plan.md` 与 `08-testing-quality-and-acceptance.md`，并把父任务/本 Task evidence 更新为最终 `MET`；保留此前 `NOT_MET` 的历史过程，不改写已归档任务结论。
10. 验证完成后报告实际结果、文档范围、残余风险与精确 commit/archive plan，等待批准；不自动开始 Phase 8。

## Acceptance Criteria

- [x] `main` 候选仍包含 `ab748d02`、`9feffdc5`、`b4c02fb0`、`79cce8ce`、`24cc8f81`，验证前无未识别 dirty 文件。
- [x] contract-check、lint、typecheck、test-unit、test-integration、build、e2e、dev/prod Compose config 均独立退出 `0`，实际计数、耗时和 cleanup 状态已写入 Task evidence。
- [x] System/Auth sensitive-path secret assertions 通过且未生成失败产物；数据库、临时存储、Redis 与固定端口完成既有精确清理。
- [x] 独立阶段全绿后，最终 `make verify` 只运行一次并退出 `0`。
- [x] Phase 7 open P0/P1/P2 为 `0/0/0`，八项 System shared invariant 没有新反证，07/08 与 Task evidence 一致更新为 `MET`。
- [x] 失败路径未触发；Recheck 未夹带任何代码、测试或环境修正。
- [x] 最终 diff 只包含本 Task/父 Task evidence，以及成功路径允许的 07/08 文档；收尾校验结果记录在 Task evidence。
- [x] 未创建分支、worktree、产品代码修改、重复测试、通用 framework、push、PR、未批准 commit/archive 或 Phase 8 工作。

## Out of Scope

- 修复本轮新发现的 unit、integration、build、E2E、环境或清理问题。
- 修改 OpenAPI、数据库、权限、后端 state machine、前端 runtime、测试断言、Makefile 或 E2E orchestration。
- 新增或删除 System、Auth、Configuration、Product、Content、Publishing、GEO 页面与能力。
- 运行 `make test-deploy-scripts`、Storybook、Lighthouse、staging deploy、Phase 8 Workbench 或 Phase 9 Cutover。
- 自动提交、推送、创建 PR、改写历史或在结果报告前归档任何任务。

## Result

候选 `24cc8f81e12247705b59eb3ade4a2cbbdb049d2c` 的全部独立阶段和唯一一次最终 `make verify` 均退出 `0`；最终门禁耗时 `19:23.64`。Phase 7 open P0/P1/P2=`0/0/0`，Exit Gate=`MET`。本 Task 只收口文档与证据，未开始 Phase 8。
